# CodeMeet — PHASE 2 report

Дата: 2 октября 2026. PHASE 2 реализована; PHASE 3 не начата. Commit и push не выполнялись. Frontend получает данные настоящего API; MSW используется только в tests.

## 1. Итоговая frontend architecture

Pipeline: Next.js → Apollo Client → generated TypedDocumentNode → GraphQL Yoga → services → Prisma → PostgreSQL.

`apps/web/src/app` содержит Server Component layout и небольшие route wrappers. Domain UI, forms и operations находятся в `features/questions` и `features/interviews`. `shared/api` содержит Apollo factory/provider, cache policies, error helper и generated documents; `shared/ui` — небольшие общие элементы и CSS. Пустые layers и отдельная UI library не создавались. Apollo является единственным server-state store; React и React Hook Form хранят local UI/form state.

Реализованы `/dashboard`, `/questions`, `/questions/new`, `/interviews/new`. `/` перенаправляет на dashboard. Дополнительный `/interviews/[id]` показывает summary, задачи, участников и Start/Finish; это позволяет действию Open открыть существующее интервью. Interview Room, editor, auth и realtime отсутствуют.

Dashboard показывает recent interviews, question count, status filter и navigation. Library поддерживает server search/language/difficulty, Load more и loading/error/empty/loaded states. Все отображаемые interview statuses приходят из API; frontend не вычисляет бизнес-статус.

## 2. Apollo + Next.js

Установлены Apollo Client 4.3.1, Next.js 16.3.8, React 19.3.0, GraphQL 16.14.2. React hooks импортируются из `@apollo/client/react`. HttpLink берёт endpoint из `NEXT_PUBLIC_GRAPHQL_URL`; application code не содержит адреса localhost. Отсутствующий или невалидный HTTP(S) URL показывает configuration state.

Выбран **обычный ApolloProvider + client fetching**. Оценён официальный `@apollo/client-integration-nextjs` 0.14.5 с совместимыми peer ranges. Он полезен для RSC, prefetch и streaming SSR; эти функции пока не требуются. Дополнительный integration package не установлен. Для дальнейшего SSR следует использовать официальный package с request-scoped client и cache hydration. [Apollo App Router integration](https://www.apollographql.com/docs/react/integrations/nextjs)

Root `.env` используется web/api. `apps/web/scripts/next.mjs` вызывает встроенный Node `loadEnvFile`, затем импортирует Next CLI; shell env имеет приоритет. Первоначальная попытка запускать Next с env-file CLI flag ломала production workers (`ERR_WORKER_INVALID_EXEC_ARGV`); launcher устранил проблему без нового env dependency. Публичный URL встраивается при build: его production изменение требует rebuild, секреты в него не помещаются.

Для браузера добавлен environment-driven `CORS_ALLOWED_ORIGINS`: только конкретные HTTP(S) origins, без wildcard, reflection и credentials. Yoga возвращает разрешённый origin и `Vary: Origin`; denied origins не получают access-control headers. CORS регулирует чтение браузером, а не заменяет authentication. HttpLink сейчас использует `credentials: 'omit'`.

## 3. Client/server boundary

Root layout не имеет `use client`. Он включает отдельный `WebApolloProvider`; client directive есть только у provider и interactive feature components. Server children можно передавать через provider boundary без превращения их модулей в Client Components.

Client создаётся через lazy `useState` на экземпляр provider, без module-level singleton. В браузере cache сохраняется между route transitions; серверные render instances не делят его между requests. Все Apollo `useQuery` имеют `ssr: false`: сами Client Components тоже могут render на сервере, поэтому запросы отключены явно.

Client fetching упрощает PHASE 2: authenticated SEO не требуется, backend не нужен во время build, нет двух владельцев одной entity в RSC и Apollo cache. Layout/routes остаются серверными и позволяют позже добавить официальный prefetch. При нынешнем варианте initial HTML содержит shell/loading state, а данные появляются после hydration.

## 4. GraphQL Codegen

Единственный source of truth — `apps/api/src/graphql/schema.graphql`. Codegen читает локальный SDL напрямую; вторую schema или endpoint introspection artifact не создавали. Production build не зависит от запущенного API.

`apps/web/codegen.ts` использует `typescript-operations` 6.1.9 и `typed-document-node` 7.1.1, CLI 7.4.3. Выбор соответствует текущей рекомендации Apollo 4 для operations v6: минимальные operation types и precompiled documents. Client preset оценён, но его дополнительный runtime/fragment masking здесь не нужен. React hooks plugin не используется. [Apollo Codegen recommendation](https://www.apollographql.com/docs/react/development-testing/graphql-codegen)

Config: `nonOptionalTypename: true`, `skipTypeNameForRoot: true`, `useTypeImports: true`, enum values сохраняются без переименования. Operations v6 генерирует необходимые input/enum types вместе с operation types; отдельный plugin для полной копии schema types не требуется.

Десять operations организованы по domain:

- `features/questions/api/questions.graphql`: GetQuestions, GetQuestion, CreateQuestion, UpdateQuestion.
- `features/interviews/api/interviews.graphql`: GetInterviews, GetInterview, CreateInterview, AddQuestionToInterview, StartInterview, FinishInterview.

Root scripts: `pnpm graphql:codegen`, `pnpm graphql:codegen:watch`, `pnpm graphql:codegen:check`. Check использует стандартный CLI `--check`; custom validator не нужен. Root `check`, web build/typecheck вызывают check. Turbo inputs для build/typecheck включают внешний API SDL, поэтому schema changes не скрываются cache hit. [Codegen dry-run mode](https://the-guild.dev/graphql/codegen/docs/config-reference/codegen-config#dry-run-mode)

Generated `shared/api/generated/graphql.ts` сохраняется в repository и предназначен для version control. Это делает результат reviewable и позволяет CI обнаружить stale output. Trade-off — generated diff и необходимость regeneration при изменениях SDL/operations. Файл исключён из Prettier/ESLint, чтобы сохранять raw output, но проверяется TypeScript и Codegen. Реальный commit по заданию не выполнен.

## 5. Generated type flow

Конкретный путь dashboard:

1. SDL определяет `Interview.id`, `title`, `status: InterviewStatus!` и поле `Query.interviews`.
2. `GetInterviews` выбирает `InterviewFields`, включая id/title/status, и pageInfo.
3. Codegen создаёт `GetInterviewsDocument` как `TypedDocumentNode<GetInterviewsQuery, GetInterviewsQueryVariables>` в `shared/api/generated/graphql.ts`.
4. `DashboardPage` передаёт document в Apollo hook без ручного result interface.
5. React отображает `interview.title` и `<StatusBadge status={interview.status} />`; status выводится как generated union `DRAFT | READY | IN_PROGRESS | FINISHED`.

```tsx
const interviews = useQuery(GetInterviewsDocument, {
  ssr: false,
  variables: { limit: 6, offset: 0 },
});
const rows = interviews.data?.interviews.items;
// rows, row.id/title/status и variables выведены из document.
```

Ручные QuestionQueryResult/InterviewQueryResult/CreateQuestionVariables отсутствуют. Form values выводятся из Zod, component props используют generated fragments. Тип внутреннего cached page описывает normalized references/offset slots, а не GraphQL response.

Проверены два отрицательных сценария: изменение generated output приводит к exit code 1 в `graphql:codegen:check`; operation с несуществующим field тоже приводит к exit code 1. Временные изменения после проверки восстановлены; финальный check проходит.

## 6. Apollo cache

`User`, `Question`, `Interview` используют стандартный Apollo identity `__typename:id`; дополнительные keyFields не нужны. Domain fragments возвращают id/typename и используемые поля. Mutation response автоматически обновляет normalized entity, включая вложенные questions/users.

Questions list keys включают search/language/difficulty/limit; interviews — status/limit. Разные filters и размеры страниц изолированы. Dashboard question count с limit 1 не смешивается с library limit 12, recent interviews используют limit 6. Empty filters пропускаются в variables: API PHASE 1 принимает omitted optional arguments, а явный null отклоняет. Реальный browser smoke обнаружил эту разницу; frontend исправлен, добавлены regression tests без изменения backend validators.

## 7. Pagination

`fetchMore` запрашивает следующий server offset: `pageInfo.offset + pageInfo.limit`. Merge сохраняет incoming items в исходных offset slots; предыдущие страницы остаются. Read удаляет holes и дубликаты по entity ID только из rendered result; длина очищенного списка не используется как следующий offset.

Ответ offset 0 заменяет ранее загруженные pages, чтобы refetch после mutations не оставлял устаревший хвост. Out-of-order ответ более ранней страницы не откатывает cursor/hasNextPage самой дальней страницы. Buttons блокируются во время запроса; ошибки Load more отображаются с сохранением предыдущего списка.

Offset pagination наследует ограничения backend при конкурентном изменении ordering: дедупликация не гарантирует отсутствие пропусков при вставках между запросами. Cursor pagination оставлена на будущее.

## 8. Mutations и cache updates

| Mutation               | Стратегия                                                                                                                         | Причина                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| CreateQuestion         | Normalize response + evict только ROOT_QUERY.questions; переход в library загружает первую страницу                               | Новый item влияет на search/filter membership, порядок и totalCount |
| CreateInterview        | Normalize response + evict только ROOT_QUERY.interviews                                                                           | Новое интервью влияет на порядок/status-filter lists                |
| AddQuestionToInterview | Normalize full interview + evict interviews lists                                                                                 | Меняются questions, count и DRAFT → READY membership                |
| StartInterview         | Normalize full interview + evict interviews lists; dashboard refetch только собственного списка с offset 0                        | READY → IN_PROGRESS может исключить row из status filter            |
| FinishInterview        | Normalize full interview + evict interviews lists; dashboard refetch только собственного списка с offset 0                        | IN_PROGRESS → FINISHED меняет membership и timestamps               |
| UpdateQuestion         | Document готов; normalization обновляет entity, будущая edit form должна evict questions lists при изменении filter/search fields | Edit UI относится к PHASE 3                                         |

Summary query получает изменения entity из normalized cache. `refetchQueries: ["всё"]`, ручной prepend в произвольный paginated list и optimistic business statuses не используются. `cache.modify` не выбран: одного mutation row недостаточно для точного пересчёта всех filtered pages/counts.

## 9. Forms и validation

React Hook Form 7.89.0 + Zod 4.6.5 + resolver 5.9.1. Question form содержит title/description/difficulty/language/starterCode. Title и description trim, limits совпадают с API; starterCode допускает пустую строку и сохраняет whitespace. После успеха открывается `/questions?created=1` с success notice. Validation, GraphQL error и submitting states видимы; controls disabled во время submit.

Interview form требует title и минимум одну question. CreateInterview вызывается только после submit, затем selected IDs добавляются последовательно. Local workflow хранит полученный interview ID и подтверждённые attachments. При partial failure UI показывает existing ID, attached count, failed question и Retry remaining questions; title/selection блокируются.

Retry сначала выполняет network-only GetInterview и сверяет сохранённые attachments, затем добавляет только отсутствующие IDs. После неопределённого attachment response тоже выполняется reconciliation. Повторный CreateInterview при этом не вызывается. Atomic create-with-questions mutation потребовала бы расширить стабильный backend, поэтому не выбрана.

Если потерян сам CreateInterview response и ID неизвестен, UI блокирует повторный submit и предлагает проверить dashboard: без idempotency key безопасно восстановить ID невозможно. Recovery state хранится в памяти страницы; reload не удаляет серверное интервью, но теряет pending selection. Это явно оставлено technical debt.

Labels связаны с controls, field errors имеют `aria-describedby`/`aria-invalid`, notices используют alert/status, есть skip link и focus styles. Общий error helper различает BAD_USER_INPUT, NOT_FOUND, CONFLICT, INVALID_STATE, INTERNAL_SERVER_ERROR и безопасно обрабатывает network errors без stack trace. Status actions доступны только для server READY/IN_PROGRESS; invalid transitions отображают controlled GraphQL error.

## 10. Tests

Frontend: **21/21 PASS, 5 suites** — Jest 30, React Testing Library, MSW 3 GraphQL handlers. Tests работают с настоящими Apollo hooks/HttpLink/cache и пользовательскими actions; client/cache создаются заново для каждого render. Fixtures используют generated operation types. Next navigation mock ограничен routing side effects.

Все 15 обязательных сценариев покрыты: Questions loading/list/empty/error/search/filter/load more; CreateQuestion validation/submit/GraphQL error; CreateInterview requires question/success/backend error; Start/invalid transition. Дополнительно проверяются dedup/filter reset, Finish, partial retry без второго create, потерянный create response, dashboard pagination и отсутствие null optional filters.

Backend: **67/67 PASS, 2 suites** — все исходные 47 integration tests + 20 новых CORS tests. PostgreSQL используется без mock Prisma; прежняя test database isolation сохранена. CORS cases проверяют реальные HTTP headers, preflight, allowed/denied/no origin и validation configuration.

Jest ESM запускается с VM Modules; Next SWC трансформирует TS/TSX. `jest-fixed-jsdom` сохраняет совместимые Node fetch globals для MSW. Tests проверяют поведение, а не private Apollo internals.

## 11. Проверки

Проверено на Node 22.23.3, pnpm 10.34.6, native PostgreSQL 17.10. Host Node 22.14 не удовлетворял существующему engine requirement; совместимый Node использовался из временного каталога без глобального изменения системы.

| Проверка                                              | Результат                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm format`, `pnpm format:check`                    | PASS                                                                        |
| `pnpm lint`, `pnpm typecheck` через root `pnpm check` | PASS                                                                        |
| `pnpm graphql:codegen` и `pnpm graphql:codegen:check` | PASS                                                                        |
| Codegen watch startup                                 | PASS: отслеживает SDL и operation files; после проверки остановлен          |
| Stale generated output / несовместимая operation      | Ожидаемый FAIL с exit code 1; исходники восстановлены                       |
| `pnpm test`                                           | PASS: 21 frontend + 67 backend = 88 tests, 7 suites                         |
| `pnpm build`                                          | PASS: web production build и backend packages                               |
| `pnpm db:validate`                                    | PASS                                                                        |
| GraphQL smoke                                         | PASS: реальные browser requests к Yoga/PostgreSQL, HTTP 200 и explicit CORS |
| Frontend smoke                                        | PASS: production Next.js, Chrome, desktop 1440px и mobile 390px             |

Browser smoke прошёл dashboard → library → search/language filter → CreateQuestion → CreateInterview → две attachments → READY → Start → IN_PROGRESS → Finish → FINISHED. После reload сохраняется FINISHED. Прямая проверка PostgreSQL подтвердила две interview questions, по одному CREATED/STARTED/FINISHED event для созданного интервью и точное сохранение starterCode whitespace. Dashboard видит новое интервью и фильтрует FINISHED. Browser exceptions отсутствуют; mobile library не имеет горизонтального overflow.

Дополнительный smoke вызвал generated GetQuestions → GetQuestion → UpdateQuestion через production Apollo factory против того же API; HTTP `/health` и GraphQL health тоже прошли. Вместе с browser flow выполнены все десять требуемых generated operations. Update касался только временной smoke-задачи; edit UI не создавался.

In-app Browser недоступен в окружении (bootstrap не получил browser; list пуст). После проверки plugin использован headless установленный Chrome с временным Playwright и отдельным fresh profile. Вспомогательные инструменты остаются вне repo; browser verification использует реальные данные, без MSW.

Docker CLI/engine отсутствует, поэтому Compose в этой сессии не проверялся; использован уже подготовленный native PostgreSQL той же major version. Credentials хранятся вне repository; `.env.example` содержит только placeholders. PHASE 2 не меняет SDL, Prisma schema/migrations, transactions, services или test database infrastructure. Единственное backend дополнение — CORS transport configuration и его tests.

Screenshots просмотрены после capture: [dashboard](screenshots/dashboard.png), [library](screenshots/questions.png), [mobile library](screenshots/questions-mobile.png).

## 12. Technical debt / TODO

- Настоящая authentication и credential-aware CORS принадлежат будущей auth фазе. Сейчас сохраняется TEMP DEMO AUTH PHASE 1.
- Partial setup recovery после reload и unknown create response требуют persistence/idempotency или atomic backend workflow.
- Offset pagination при конкурентных изменениях не даёт cursor guarantees; при росте данных стоит пересмотреть API.
- SSR/prefetch и Apollo official integration добавляются при реальной потребности, вместе с request isolation/hydration tests.
- Query fragments пока возвращают полные используемые objects, включая starterCode; при росте library стоит разделить list/details selections.
- Dependency warnings остаются видимыми: ESLint 9 EOL при текущем peer range react plugin, transitive glob/node-domexception/whatwg-encoding, Jest VM Modules, Prisma/pg concurrent-query warning. Совместимый upgrade lint/test/db stack следует делать отдельно. Заблокированные pnpm postinstall для Parcel watcher/unrs-resolver не мешали проверенным bindings и запуску watch/build/tests.
- CI и Docker images web/api относятся к PHASE 11; check commands уже пригодны для CI.

## 13. Что остаётся PHASE 3

По отдельному заданию: Question details/editing UI с уже generated GetQuestion/UpdateQuestion, улучшение library UX и cache invalidation для editing. Dashboard/forms из расширенного задания PHASE 2 уже реализованы и не требуют повторного создания в следующей фазе.

Auth/guest flow, Interview Room, Monaco, WebSocket, Yjs, presence и code execution относятся к последующим фазам. Ничего из этого не начато. Работа останавливается после PHASE 2.

## 14. Пять вопросов технического интервьюера

1. Почему normalized cache обновляет Interview после mutation, но не может автоматически исправить membership, порядок и totalCount всех filtered lists?
2. Как keyArgs, merge и read работают вместе при offset pagination? Почему offset нельзя считать по длине дедуплицированного списка?
3. Как TypedDocumentNode связывает SDL, operation variables/result и Apollo hook? Где CI обнаружит несовместимое поле или stale generated artifact?
4. Почему `use client` само по себе не выключает server render и как изменятся provider/cache lifetime при переходе на Apollo Next.js integration с SSR?
5. Как восстановить create-and-attach workflow после потерянного mutation response, не создавая дубликат интервью? Какие гарантии дают reconciliation, idempotency key и atomic mutation?
