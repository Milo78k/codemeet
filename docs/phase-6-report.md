# PHASE 6 — Guest Join, Participant Identity и WebSocket Authorization

## Результат

Реализован guest flow для интервью: интервьюер создаёт одноразовый invite, кандидат проверяет ссылку, вводит имя и получает отдельную participant identity. GraphQL и WebSocket проверяют её на сервере до выдачи interview data и начала Yjs sync. PHASE 7 не начиналась; Awareness UI/live cursors и CodeRunner не добавлялись.

Схема потока:

```text
Invite URL (/join/<raw-token>)
  → GuestToken (в БД только SHA-256 hash)
  → joinInterview
  → InterviewParticipant(role=CANDIDATE)
  → ParticipantSession (в БД только SHA-256 hash)
  → GraphQL Authorization header / первый WebSocket application message
  → membership + role + interview status + question attachment checks
  → Yjs room sync
```

## Invite и participant identity

Используется уже существующая модель `GuestToken` с `interviewId`, `expiresAt` и `usedAt`; новая invite-модель не создавалась. Для participant credential добавлена `ParticipantSession`: её hash уникален, у записи есть expiry и `revokedAt`. Это даёт серверу способ проверить предъявителя независимо от display name и participant ID, а также отозвать и ограничить по времени его сессию.

Invite и participant session используют 32 cryptographically random bytes (256 bits entropy), представленные как 43 символа base64url. PostgreSQL получает только SHA-256 hash с unique index; raw token возвращается вызывающей стороне один раз. Invite действует 48 часов и доступен для интервью в состоянии READY или IN_PROGRESS. Session действует 7 дней. SHA-256 digest ищется точным индексированным запросом; приложение не сравнивает secret с хранимым значением, поэтому отдельное constant-time сравнение здесь не применяется.

`joinInterview` выполняет в одной Serializable transaction проверку invite, срока действия и статуса интервью, условное присвоение `usedAt`, создание Candidate participant, ParticipantSession и одного `CANDIDATE_JOINED` event. Условный update требует, чтобы `usedAt` всё ещё был `null`; при параллельном join выигрывает один запрос, второй отклоняется, а serialization conflict повторяет transaction. Raw token не добавляется в application error message и не логируется.

Для MVP выбран `sessionStorage`: credential переживает refresh в той же вкладке, но не становится долговременным общим browser credential, как при `localStorage`. Хранение только в памяти потеряло бы session при refresh. `sessionStorage` доступен JavaScript страницы и не защищает от XSS; при закрытии вкладки клиентская копия удаляется, а серверная запись остаётся до expiry или revoke. HttpOnly cookie и CSRF strategy отложены, поскольку web и API сейчас могут работать на разных origins/ports.

Invite token неизбежно находится в `/join/<token>` URL согласно заданному flow. Join page выставляет `Referrer-Policy: no-referrer`; production reverse proxy и access logs должны редактировать invite path. Participant session token не помещается в URL: Apollo посылает его через `Authorization: Bearer`, WebSocket — первым текстовым application message после открытия соединения.

## Identity, GraphQL и роли

Identity отделена от authorization. Без `Authorization` локальный API сохраняет существующую TEMP DEMO AUTH interviewer identity. Bearer header разрешается только через непустую действующую ParticipantSession и связанного Candidate participant; неверный bearer не переключается обратно на demo interviewer. Настоящий Auth.js login для интервьюера не реализовывался.

Добавлен `currentParticipant`. Кандидат может получить interview только при membership в нём; запрос к другому interview возвращает `null`. Candidate owner queries и mutations отклоняются сервером. В candidate response скрыты creator/User relations и другие participants. Reusable task metadata заменяется frozen snapshot, а список candidate questions ограничен текущим `activeQuestion`, чтобы не раскрывать будущие prompts. `InterviewNote` отсутствует в GraphQL schema. UI дополнительно скрывает interviewer navigation, Finish и переключение вопроса, но безопасность обеспечивается resolver/service guards.

Интервьюер сохраняет question navigation и Finish через TEMP DEMO AUTH. Кандидат видит текущую задачу и collaborative editor, но не может переключить `activeQuestion` или завершить интервью. После присоединения к READY интервью страница сессии сообщает, что сначала интервьюер должен запустить интервью. Обе роли используют один Session UI.

## WebSocket authorization и Yjs

Сервер принимает WebSocket только с разрешённым Origin и корректным room ID. До создания/получения Yjs room он ожидает первым application message JSON identity payload. Candidate session сверяется по hash, expiry и revoke state; затем проверяются Candidate role и принадлежность participant к interview из room ID. Interviewer handshake подтверждает TEMP interviewer identity и его Interviewer membership. После этого сервер проверяет `IN_PROGRESS`, принадлежность `InterviewQuestion` этому interview и наличие snapshot starter code. Только затем отправляет `authenticated` acknowledgement и Yjs sync step.

Frontend WebSocket adapter не сообщает y-websocket об `open` до acknowledgement, поэтому y-websocket не может отправить начальный Yjs sync раньше авторизации. Token не находится в WebSocket URL и не печатается в лог. Истекающая participant session закрывает уже открытый socket по expiry времени. Yjs protocol semantics не менялись ради auth; authorization обёртывает transport.

`activeQuestion` остаётся GraphQL business state, не переносится в Yjs. Новый realtime channel `QUESTION_CHANGED` не добавлялся. Кандидату нужно обновить Session, чтобы увидеть смену задачи; новый WebSocket connection проверит актуальное interview state и room membership.

## Границы транзакций и security limitations

- Invite creation проверяет владельца и допустимый interview state в Serializable transaction.
- Join атомарно расходует invite, создаёт participant/session и audit event. Повторное использование контролируемо отклоняется.
- `CANDIDATE_JOINED` — единственное новое business event в join flow. Подключение socket, ping и редакторские изменения не добавляются в interview audit log.
- TEMP DEMO AUTH — общий локальный interviewer principal, не production authentication и не multi-user access boundary.
- `sessionStorage` credential остаётся доступен JavaScript; для production потребуются XSS hardening и решение о cookie/session delivery.
- Invite token в path может присутствовать в browser history и proxy access logs; production proxy должен исключить token из логов. Referrer policy ограничивает передачу token другим страницам.
- Revoke и переход интервью в FINISHED запрещают новые WebSocket connections, но отдельный межпроцессный realtime revoke/finish event для уже открытого socket не реализован. Socket гарантированно закрывается при истечении participant session.
- Активный Yjs документ пока in-memory; restart API теряет edits. Durable persistence и recoverable history не входят в PHASE 6.
- Candidate следует переключённому active question после refresh; отдельный event channel не создавался.

## Проверки

Проверки с результатом:

- API eslint — PASS.
- Web eslint — PASS.
- Web Jest — PASS: 12 suites, 86 tests.
- GraphQL codegen `--check` — PASS.
- API, web и shared TypeScript typecheck — PASS.
- Prisma schema validation/client generation — PASS.
- API TypeScript build — PASS.
- Web production build — PASS.
- API no-DB suites `collaboration.transport`, `cors`, `yjs-convergence` — PASS: 27 tests (нужен loopback bind; запуск выполнен с разрешением sandbox).

Проверки, которые нельзя подтвердить в этой среде:

- Guest authorization integration suite не запускался: PostgreSQL недоступен, локальные порты 5432/55432 закрыты, `pg_isready` и Docker не установлены. Поэтому DB-backed invite/session race и реальные GraphQL/WebSocket integration сценарии остаются непроверенными здесь.
- Root `pnpm check` не запускался как единая команда: в проекте закреплён `pnpm@10.34.6`, на PATH его нет; доступный pnpm 11.9.0 вне заявленного диапазона, а Corepack не смог скачать закреплённую версию из-за недоступной сети. Для независимых проверок использовались установленные локальные binaries напрямую.
- Установленный shell Node `22.14.0`, тогда как проект требует `>=22.15.0 <23`. Web tests прошли с локально установленным Jest и `--experimental-vm-modules`; единая root команда на требуемом Node/package manager не подтверждена.
- Полный Prettier check сообщает о форматировании в `apps/web/src/shared/api/errors.ts` и историческом `docs/phase-5-report.md`; эти файлы не менялись в PHASE 6. `docs/architecture.md` и этот отчёт отформатированы.

Не устанавливались зависимости и не менялись package manager/configuration для обхода ограничений среды. Миграция подготовлена, но не применялась к недоступной базе. DB reset, commit и push не выполнялись.

## Технический долг и следующая фаза

Для production остаются настоящий interviewer authentication, более строгая credential delivery strategy, управление revoke/expiry активных соединений и persistence Yjs documents. Необходимы запуск migration и DB-backed integration suite на PostgreSQL. Это report перечисляет возможные следующие работы; PHASE 7 в рамках этой задачи не начиналась. Awareness UI/live cursors и CodeRunner также не реализовывались.

## Пять вопросов на интервью

1. Как одноразовая ссылка защищена от replay при двух параллельных запросах на join?
2. Почему база хранит hash invite/session tokens, а не сами bearer secrets?
3. Как сервер отличает authentication/identity от authorization доступа к interview и room?
4. Почему candidate credential хранится в `sessionStorage`, и какие риски это оставляет?
5. Как WebSocket может проверить identity до Yjs sync, не отправляя секрет в URL?
