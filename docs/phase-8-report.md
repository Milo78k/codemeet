# CodeMeet — PHASE 8 report

PHASE 8 добавляет доставку бизнес-уведомлений в Interview Session. События помогают участникам быстро увидеть persistent state, но сами не являются business state и не заменяют GraphQL/PostgreSQL.

## 1. Цель и границы

Interviewer может менять активный вопрос или завершить интервью через существующие GraphQL mutations. После успешной database transaction API уведомляет подключённых участников того же интервью. Candidate автоматически получает актуальный Interview, переключает Question без reload и прекращает collaboration после Finish.

Реализованы только `ACTIVE_QUESTION_CHANGED` и `INTERVIEW_FINISHED`. Yjs persistence, replay, event sourcing, broker, GraphQL subscriptions, code execution, chat и video не входят в эту фазу.

## 2. Socket architecture

Session Events используют отдельное WebSocket соединение и endpoint `/session-events/:interviewId` на том же API HTTP server. Существующий `/collaboration` сохраняет стандартный binary y-websocket framing для Yjs и Awareness; application JSON не внедряется в binary protocol. Так два независимых lifecycle и формата сообщений не конфликтуют и не требуют нового процесса/порта.

## 3. Event protocol

Первое client сообщение аутентифицирует соединение. Server подтверждает его `{"type":"authenticated"}`, после чего отправляет `{"type":"session-event","event":...}`. Общий shared package задаёт discriminated union и runtime parsers. Невалидные JSON messages/events игнорируются безопасно.

Event payloads являются invalidation и намеренно не несут `activeQuestionId` или копию status:

- `ACTIVE_QUESTION_CHANGED { interviewId, occurredAt }`
- `INTERVIEW_FINISHED { interviewId, occurredAt }`

Это оставляет один источник истины и не позволяет stale или поддельному event записать business state в Apollo cache.

## 4. Interview scope и Question scope

Session channel подписан на Interview ID и остаётся активным при переключении вопросов. Yjs/Awareness остаётся в room конкретной пары interview/question. Candidate получает событие в Interview channel, перечитывает Interview и использует прежний UI lifecycle для закрытия старой Question room и открытия новой.

## 5. Canonical source of truth

GraphQL и PostgreSQL хранят Interview status, active question, membership и audit events. Y.Doc/Y.Text хранит совместный текст в памяти API; Awareness хранит ephemeral presence, cursor и selection. Session Events сообщают об изменении persistent business state, затем Apollo запрашивает его заново.

Refetch выбран вместо копирования `activeQuestionId` из event в cache: это минимальный надёжный путь, использующий существующую авторизованную query и единую логику switching. Запросы от близких уведомлений объединяются в короткое окно и сериализуются. Echo initiator получает тот же refetch; canonical state и keyed lifecycle делают его idempotent.

## 6. Active question flow

`setActiveQuestion` проверяет owner, статус, принадлежность вопроса и отсутствие лишнего перехода. В Serializable transaction сервис обновляет `Interview.activeQuestionId` и сохраняет audit `InterviewEvent`. Resolver публикует event только после успешного возврата transaction; повторное присвоение уже активного вопроса не отправляет уведомление.

Получив event, каждый клиент перечитывает Interview. Candidate автоматически переключает задачу без reload; существующий Session lifecycle уничтожает binding/provider старой комнаты и подключает новую. Interviewer также получает echo, но состояние уже согласовано с результатом его mutation.

## 7. Finish flow

`finishInterview` транзакционно меняет статус и пишет `INTERVIEW_FINISHED` audit row. После commit API публикует `INTERVIEW_FINISHED`. Candidate refetches canonical Interview, видит `FINISHED`, получает существующий read-only UI и прекращает Yjs/Awareness collaboration. Ошибка до commit не порождает transport event.

## 8. Reconnect и пропущенные события

События эфемерны и не буферизуются. После каждой успешной socket authentication frontend refetches canonical Interview, включая первое подключение и reconnect. Поэтому offline client может пропустить любое число уведомлений, но после восстановления соединения видит текущий active question/status. События не упорядочиваются как лог; при переходах A → B → C итог определяет свежий GraphQL query. Отдельного polling loop нет.

## 9. Duplicates и инициатор

Server отправляет событие всем авторизованным участникам, включая initiator. Client refetch idempotent, а существующий Session state не создаёт дублирующий room provider при одинаковой Question. Если несколько событий приходят во время одного refetch, hook выполняет один дополнительный запрос после текущего вместо параллельного шквала.

## 10. Authorization

Upgrade требует разрешённый Origin и валидный Interview ID. Candidate передаёт session token первым JSON application message, не в URL; сервер проверяет token, expiry/revocation, Candidate role и Interview membership через существующую PHASE 6 логику. Interviewer использует существующий API context и допускается только при interviewer membership этого Interview. Subscriber registry разделена по Interview ID, поэтому другая комната не получает событие. Auth rejection закрывает socket, а frontend не запускает бесконечный retry для permanent authorization close codes.

## 11. Server and frontend tests

API integration tests запускают настоящий HTTP/WebSocket API и PostgreSQL test database. Они покрывают authorized subscriptions, cross-interview isolation, interviewer/candidate delivery, публикацию после commit, no-op и failed mutations, failed finish, invalid/cross-interview auth, disconnect cleanup, reconnect и отсутствие replay.

Frontend tests проверяют parsing/валидацию, reconnect/backoff, отказ auth, refetch после connect и event, automatic A → B → A переключение, cleanup/start room, duplicate/foreign/malformed events, восстановление missed event после reconnect, FINISHED/read-only, уничтожение collaboration и закрытие socket при unmount. Существующие PHASE 5–7 regression suites прогоняются полным набором.

## 12. Manual browser smoke

Результат: **MANUAL BROWSER SMOKE: PASS** в двух независимых browser contexts.

Проверено:

- Automatic active question switching без refresh; старая Yjs/Awareness room очищается, Participants/cursors появляются в новой.
- Typing и cursors продолжают работать после переключения.
- Возврат на предыдущий Question автоматический; shared code сохранён.
- Offline → Online выполняет canonical GraphQL resync без manual refresh; duplicate provider/participant отсутствуют.
- Finish Interview приходит realtime; Candidate видит FINISHED, editor read-only, collaboration и presence очищаются.
- Network подтверждает Session Events через WebSocket, по одной GraphQL mutation на business action, typing через Yjs/WebSocket, отсутствие polling и mutation на каждый символ.
- Browser Console проверена: новых runtime errors нет.

Reconnect проверен в том же Candidate tab/context после Offline → Online.

## 13. Limitations

Fanout registry хранится в памяти единственного API process. Broadcast может потеряться после SQL commit и до отправки, но reconnect refetch восстанавливает актуальный state. Пока приложение рассчитано на один API instance; простое горизонтальное масштабирование не гарантирует межпроцессную доставку. Yjs document по-прежнему теряется при рестарте API. Interviewer auth всё ещё использует общий TEMP DEMO AUTH principal. Уже открытый socket не получает отдельное немедленное событие revoke.

## 14. Technical debt

- При масштабировании добавить durable outbox/shared pub-sub вместе с координацией Yjs rooms.
- Добавить явное немедленное закрытие session-event socket при revoke participant session.
- Перейти от TEMP DEMO AUTH к реальной interviewer authentication до production use.
- Yjs persistence и crash recovery остаются отдельными задачами.

## 15. Следующий этап

После review PHASE 8 дальнейший roadmap можно планировать отдельно. Эта фаза не включает CodeRunner/Sandpack/WebContainers и не начинает следующую продуктовую фазу.

## Verification results

### PASS

- `corepack pnpm check`: Prettier format check, GraphQL codegen check, lint и typecheck.
- `corepack pnpm db:validate`: Prisma schema validation.
- API integration tests: 8 suites / 108 tests.
- Frontend tests: 15 suites / 105 tests.
- `corepack pnpm build`: production build всех workspace packages.
- `git diff --check`.
- Manual browser smoke: два независимых contexts, все проверки из раздела 12 PASS.
- PostgreSQL Compose service: healthy; `GET /health` и GraphQL `{ __typename }` вернули успешный ответ.
- Frontend dev server запущен; HTTP endpoint отвечает. Session Events auth route дополнительно проверен через живой API socket handshake.

### FAILED

Нет.

### SKIPPED

Нет.

## Runtime notes

- Проверки выполнялись на Node `22.15.0` через уже установленный nvm version; системная Node установка не менялась.
- API уже работал на `http://localhost:4000`; frontend запущен штатным dev script на `http://localhost:3000`. PostgreSQL работает через Compose на `127.0.0.1:5432`.
- API Jest output содержит `ExperimentalWarning` для Node VM Modules и повторяющиеся `pg` deprecation warnings о параллельном `client.query()`; все 108 tests прошли.
- Production build сообщает, что `public/monaco/ts.worker.js` имеет размер около 6.7 MB. Build успешен.
- Commit и push не выполнялись.
