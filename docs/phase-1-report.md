# CodeMeet — отчёт PHASE 1

PHASE 1 завершён 1 октября 2026 года. Backend работает с настоящим PostgreSQL через Prisma и GraphQL Yoga. Frontend сохраняет каркас PHASE 0. PHASE 2 не начата; commit и push не выполнялись.

## 1. Что создано

- `packages/db`: Prisma schema, migration, централизованный client/factory и idempotent seed.
- PostgreSQL-only `docker-compose.yml`, init SQL для отдельной test database и `.env.example`.
- Schema-first Yoga на существующем HTTP server; `GET /health` сохранён, `/graphql` обслуживает queries и mutations.
- Тонкие resolvers, request context, TEMP DEMO AUTH, Zod validation, controlled errors и два domain service.
- Jest integration suite с настоящей БД, SQL constraints, concurrency и transaction rollback tests.
- Root/workspace database scripts, обновлённые environment/Turbo settings, README и architecture doc.

## 2. Итоговая структура

```text
apps/
  web/                              # Next.js, PHASE 0
  api/
    src/
      index.ts
      server.ts
      graphql/
        schema.graphql
        schema.ts
        resolvers.ts
        context.ts
        errors.ts
        yoga.ts
      services/
        question.service.ts
        interview.service.ts
        shared.ts
    scripts/copy-schema.mjs
    tests/
      graphql.integration.test.mjs
      support/database.mjs
    jest.config.mjs
    package.json
    eslint.config.mjs
    tsconfig.json
    tsconfig.build.json
packages/
  config/                           # shared ESLint и strict TypeScript
  db/
    prisma/
      schema.prisma
      migrations/
        migration_lock.toml
        20261001000000_phase_1/migration.sql
      seed.ts
    src/
      client.ts
      index.ts
      seed-data.ts
      generated/                    # generated output, ignored
    prisma.config.ts
    package.json
    eslint.config.mjs
    tsconfig.json
    tsconfig.build.json
docker/postgres/init-test-db.sql
docs/
  architecture.md
  phase-1-report.md
docker-compose.yml
.env.example
README.md
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
```

Полный список root/web/config files находится в [README](../README.md#структура-репозитория). GraphQL SDL принадлежит `apps/api`; общий package появится при необходимости второго consumer. GraphQL и будущий realtime module остаются внутри одного API process.

## 3. Prisma models и relations

| Модель                 | Назначение                                                           |
| ---------------------- | -------------------------------------------------------------------- |
| `User`                 | Unique email, автор задач/интервью/заметок, registered membership    |
| `Interview`            | Creator, status, active question, started/finished timestamps        |
| `InterviewParticipant` | Role, nullable User для guest candidate, display name                |
| `Question`             | Reusable задача, language/difficulty, описание и starter code        |
| `InterviewQuestion`    | Membership задачи в интервью и уникальный order                      |
| `GuestToken`           | Unique token hash, expiry/used timestamps; raw token не хранится     |
| `CodeRun`              | Code snapshot, result, stdout/stderr, duration и optional actor      |
| `InterviewNote`        | Interview, User author, text; permissions реализуются с note service |
| `InterviewEvent`       | Типизированный event enum, JSONB payload, timestamp                  |

Composite foreign keys защищают membership active question, задачи CodeRun и optional participant actor в том же interview. SQL CHECK запрещает отрицательный order и INTERVIEWER без User; partial unique index допускает одного CANDIDATE на интервью.

Исторические связи используют `Restrict`. Только owned edge `InterviewQuestion → Interview` имеет `Cascade`; удаление reusable задачи запрещено, пока на неё ссылаются interview attachments/runs. Active или использованный в CodeRun attachment также защищён. Hard delete API отсутствует. Подробный разбор constraints/delete behavior: [architecture](architecture.md#domain-model-и-database-invariants).

Seed создаёт `demo@codemeet.local` / Demo Interviewer, Two Sum (JS/EASY), Group By (TS/MEDIUM), React Counter (React/TSX/EASY), один DRAFT interview с двумя задачами, interviewer participant и created event. Stable IDs и upsert с пустым update исключают дублирование и сохраняют пользовательские изменения при повторном запуске.

## 4. GraphQL operations

| Operations                         | Поведение                                                     |
| ---------------------------------- | ------------------------------------------------------------- |
| `health`                           | Проверка процесса без обращения к БД                          |
| `questions`, `question(id)`        | Owner-scoped задачи; search/language/difficulty, limit/offset |
| `interviews`, `interview(id)`      | Owner-scoped интервью; status, limit/offset                   |
| `createQuestion`, `updateQuestion` | Создание и partial update задачи                              |
| `createInterview`                  | DRAFT + creator participant + INTERVIEW_CREATED               |
| `addQuestionToInterview`           | Attachment с order; DRAFT становится READY                    |
| `setActiveQuestion`                | Только прикреплённая задача, QUESTION_CHANGED                 |
| `startInterview`                   | DRAFT/READY → IN_PROGRESS, timestamp и event                  |
| `finishInterview`                  | IN_PROGRESS → FINISHED, timestamp и event                     |

SDL содержит `User`, `Question`, `Interview`, `InterviewParticipant`, `InterviewQuestion`, pagination types, enums и inputs. JSON не используется вместо основных GraphQL contracts. Примеры GetQuestions/CreateInterview/AddQuestion/StartInterview и HTTP invocation: [README](../README.md#примеры-graphql-operations).

## 5. Business rules

- `READY` достижим: attachment переводит DRAFT в READY. Seed DRAFT уже содержит задачи и допускает прямой start.
- Start требует хотя бы одну задачу и выбирает первую active question, если её ещё нет. Finish возможен только из IN_PROGRESS. Из FINISHED нельзя прикреплять/переключать задачи.
- Повторное attachment и занятый order дают `CONFLICT`; active question должна принадлежать interview. Повторное назначение текущей active question — no-op без нового event.
- Owner scope применяется к queries и mutations; чужая запись не раскрывается. Context централизует identity; клиент не выбирает User через headers/inputs.
- TEMP DEMO AUTH требует явного `DEMO_AUTH_ENABLED=true` и запрещён при `NODE_ENV=production`. Без него business operations дают `UNAUTHENTICATED`; health работает.
- Zod проверяет title 1..200 после trim, description 1..20,000, starter code до 100,000 с сохранением whitespace, limit 1..100, offset/order 0..1,000,000. Пустой starter code разрешён. Partial update требует хотя бы одно поле и отклоняет null.
- Controlled errors используют `BAD_USER_INPUT`, `NOT_FOUND`, `CONFLICT`, `INVALID_STATE`, `UNAUTHENTICATED`; unexpected errors маскируются как `INTERNAL_SERVER_ERROR`, без Prisma messages/stack.
- Relations заранее загружаются Prisma include. Вложенные resolvers не выполняют запрос для каждого элемента; DataLoader сейчас не нужен. Prisma может выполнять несколько batched relation queries.

## 6. Transactions

Создание interview/participant/event, attachment/READY, active question/event и start/finish/timestamps/events выполняются в `Serializable` transactions. Вся операция повторяется при Prisma `P2034`, максимум три попытки. Conditional updates включают owner и допустимый status; unique constraints исключают duplicate attachments/orders. Ошибка event insertion откатывает бизнес-изменение.

Lists читают items и total count в `RepeatableRead`, чтобы pagination metadata соответствовала одному snapshot. Seed выполняется в одной transaction. Question update включает owner непосредственно в database operation.

## 7. Индексы

| Индекс                                                                      | Причина                                    |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| Unique `User.email`, `GuestToken.tokenHash`                                 | Identity и будущий invite lookup           |
| `Interview.status`, `Interview.createdById`, `Question.createdById`         | Status filters и owner scope               |
| Unique `InterviewQuestion(interviewId, questionId)`                         | Membership и защита от повторной задачи    |
| Unique `InterviewQuestion(interviewId, order)`                              | Order uniqueness и упорядоченная выборка   |
| Unique `InterviewParticipant(interviewId, userId)`                          | Повторный registered membership запрещён   |
| Unique `InterviewParticipant(interviewId, id)`                              | Composite FK для CodeRun actor             |
| Partial unique candidate по `interviewId`                                   | Один candidate на interview, включая guest |
| `InterviewEvent(interviewId, createdAt)`, `CodeRun(interviewId, createdAt)` | Timeline и runs                            |

Составные indexes с первым `interviewId` покрывают этот левый префикс; отдельные одноимённые indexes для InterviewQuestion/Participant дублировали бы доступ. Текстовый search использует contains; full-text/trigram index отложен до измерения объёмов и запросов.

## 8. Test strategy

47 Jest integration tests работают с реальными Yoga/services/Prisma/PostgreSQL. Требуется отдельная `TEST_DATABASE_URL` с именем БД, заканчивающимся `_test`. Suite создаёт случайную schema `cm_test_<uuid>`, применяет committed migration, seed и после завершения удаляет только эту schema. Prisma adapter явно получает schema из URL. Developer public schema не сбрасывается. Cleanup также выполняется при setup error.

Проверены все десять обязательных сценариев, filters, partial update, whitespace/empty code, ownership, SQL constraints и membership FKs, controlled/masked errors, idempotent seed, concurrent attachments/start/finish и rollback при настоящей SQL ошибке записи event. Prisma не мокается. Есть HTTP проверка существующего health и GraphQL на одном server. Jest запускает compiled ESM; browser/realtime tests появятся вместе с поведением.

## 9. Результаты checks

Проверенное окружение: macOS arm64, Node.js 22.23.3, pnpm 10.34.6, настоящий PostgreSQL 17.10. Host Node 22.14 недостаточен для текущей зависимости Yoga; `engines` требует 22.15+, `.nvmrc` выбирает ветку 22. Проверки использовали временный Node без изменения глобальной установки.

| Check                                           | Результат                                                   |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                | PASS, lockfile соответствует manifests                      |
| `pnpm format`, `pnpm format:check`              | PASS                                                        |
| `pnpm lint`                                     | PASS, max warnings 0                                        |
| `pnpm typecheck`                                | PASS, strict TypeScript во всех packages                    |
| `pnpm test`                                     | PASS, 1 suite, 47/47 tests                                  |
| `pnpm build`                                    | PASS, web + db + api; повторная сборка через Turbo cache    |
| `pnpm db:validate`                              | PASS                                                        |
| `pnpm db:generate`                              | PASS, Prisma Client 7.10.0                                  |
| `pnpm db:migrate`                               | PASS, migration применена к настоящему PostgreSQL           |
| `pnpm db:seed`, два запуска                     | PASS; 1 user, 3 questions, 1 DRAFT interview, 2 attachments |
| HTTP `GET /health`, GraphQL health/seed queries | PASS                                                        |
| HTTP lifecycle и API restart                    | PASS, persistent state/events сохраняются                   |
| Docker Compose runtime                          | Не запущен: Docker CLI/engine отсутствуют в окружении       |

End-to-end smoke запустил compiled API через workspace start command, прочитал seed из БД, создал question/interview, прошёл `DRAFT → READY → IN_PROGRESS → FINISHED`, переключил active question и проверил четыре durable events (created, changed, started, finished). После остановки и повторного запуска API сохранились FINISHED, active question и interviewer participant. API и временный PostgreSQL остановлены после проверки.

Compose configuration и команды готовы, но запуск контейнера в этом окружении не проверен. Backend flow проверен на native PostgreSQL той же major version. Реальные временные credentials хранились вне repository; `.env`/generated client/build outputs/caches исключены из Git.

## 10. Technical debt / TODO

- Заменить TEMP DEMO AUTH настоящими sessions/membership permissions; до этого backend не предоставляет authenticated production business API. GuestToken, Note и CodeRun имеют только persistence models.
- Добавить snapshots reusable Question на attachment, чтобы последующее изменение library не переписывало историю интервью; текущие attachments читают живую Question.
- При публичном API определить query cost/depth limits и cardinality вложенных relations; текущий maximum limit ограничивает верхний список. Eager includes могут выбирать данные вне selection set.
- Проверить Compose runtime на машине с Docker. CI и app images относятся к PHASE 11.
- Сохранять SQL CHECK/partial unique constraints при review будущих Prisma migrations. Archive/retention policy и business version/idempotency keys появятся с соответствующими операциями.
- Совместимо обновить lint/test/Prisma stack при доступности исправлений upstream. Нынешние warnings не скрываются.

### Точный ESLint warning

Package: `eslint@9.39.5`. Installer: `WARN deprecated eslint@9.39.5`. Registry message: `This version is no longer supported. Please see https://eslint.org/version-support for other options.` Официальная таблица устанавливает EOL v9 на 6 августа 2026 года. Это warning именно ESLint. Installed `eslint-plugin-react@7.37.5` допускает ESLint до `^9.7`, поэтому крупный upgrade до v10 сейчас нарушил бы заявленную совместимость. Lint проходит; немедленный upgrade runtime не требуется, обновление tooling остаётся долгом. [ESLint version support](https://eslint.org/version-support/)

Также наблюдаются transitive `glob@10.5.0`, Jest ExperimentalWarning VM Modules и warning `pg@8.23.1` о concurrent client.query на одной connection. Trace последнего указывает на Prisma adapter/runtime при relation reads, а не самостоятельное использование pg в приложении. Postinstall `@parcel/watcher` и `unrs-resolver` блокируется pnpm policy; prebuilt bindings работают в проверенном окружении.

## 11. Что оставлено для PHASE 2 и следующих фаз

PHASE 2: GraphQL Code Generator, frontend operations/typed documents, Apollo provider, filter-aware pagination/cache policies и подключение frontend к API. Эти зависимости и функциональность сейчас не добавлены.

Auth.js/guest join, WebSocket/Yjs/Monaco/presence, code execution, notes/results UI, Redis/Kafka, отдельный realtime app и repository layer не реализовывались. Realtime будет модулем существующего `apps/api`.

## 12. Вопросы технического интервьюера

1. Зачем Serializable transactions вместе с conditional updates и unique constraints? Что повторяется при P2034 и почему event не дублируется?
2. Как composite foreign keys запрещают чужую active question и CodeRun actor? Что произойдёт при delete referenced attachment?
3. Как Prisma includes предотвращают текущий N+1 и при каких запросах потребуется DataLoader или выборка по selection set?
4. Почему tests создают schema в отдельной database? Как гарантируется cleanup без удаления development data?
5. Почему reusable Question требует snapshot на InterviewQuestion до сохранения итогов интервью и как это влияет на историю?
