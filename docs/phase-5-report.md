# CodeMeet — PHASE 5 report

Дата: 2 октября 2026. Реализовано совместное редактирование одного source file двумя браузерными клиентами. GraphQL и collaboration WebSocket используют один `apps/api` HTTP server. Проверены TypeScript, lint, frontend tests, transport integration tests, production build и браузерный smoke на двух независимых контекстах. PostgreSQL в среде финальной проверки остановлен, поэтому тесты с реальной БД не удалось выполнить. Commit/push не выполнялись; следующая фаза не начиналась.

## Stack и протокол

Frontend использует `yjs@13.6.33`, `y-websocket@3.1.0` и `y-monaco@0.1.6`; API использует те же Yjs версии, `y-protocols@1.0.7`, `lib0@0.2.119` и `ws@8.22.0`. Установленный `y-websocket` предоставляет browser provider, но не документированный поддерживаемый серверный API для встраивания в существующий HTTP server. Поэтому API содержит небольшой transport adapter, который использует официальный Yjs sync/awareness protocol из `y-protocols`; собственный CRDT или несовместимый текстовый протокол не написан. Частные package internals не импортируются.

`Y.Text("code")` подходит для текущей модели ровно одного редактируемого source file: это collaborative текстовая последовательность с concurrent edit convergence и небольшим API. `Y.Map`, `Y.Array` и `Y.XmlFragment` здесь не нужны. Room ID формируется и парсится общими функциями `createCollaborationRoomId`/`parseCollaborationRoomId` из `@codemeet/shared` и включает одновременно interview ID и InterviewQuestion ID.

WebSocket upgrade endpoint `/collaboration/{encodedRoomId}` закреплён за HTTP server GraphQL API; дополнительный порт или сервис не добавлен. Клиент берёт endpoint из `NEXT_PUBLIC_REALTIME_URL`. API сверяет `Origin` с настроенными web origins. Payload ограничен 1 MiB, compression отключён. Ошибки и lifecycle logs не содержат содержимое редактора.

## Room и источники состояния

На каждую комнату API держит один `Y.Doc`, `Awareness`, connections и listeners в in-memory registry. `getOrCreateRoom` хранит Promise инициализации в отдельном registry, поэтому параллельное первое подключение ждёт один DB lookup и получает один документ. Перед добавлением комнаты сервер разбирает и валидирует identity, проверяет существующий IN_PROGRESS InterviewQuestion, связь с Interview и непустой snapshot. При первой инициализации snapshot один раз записывается в `Y.Text("code")`; последующие clients получают уже существующий room state.

После initial sync `Y.Text` — источник истины текущего mutable code. y-monaco связывает его с уже существующей stable Monaco model через PHASE 4 editor-ready hook; новый editor не создаётся. Draft store зеркалит актуальный общий текст, чтобы существующий dirty UI показывал `Modified` на всех клиентах, но Apollo cache не хранит live code. Reset меняет Y.Text одной Yjs transaction после существующего confirmation flow. Active question остаётся GraphQL business mutation, а typing идёт по Yjs/WebSocket без GraphQL mutation на каждый input.

При смене вопроса binding, observers и provider старого room освобождаются. Новый room подключается только для активного question. При возврате к уже посещённому вопросу API room возвращает последнее состояние. Локальный Y.Doc сохраняется между question switches в рамках живого Session workspace и освобождается на окончательном unmount. Отложенный release выдерживает React StrictMode cleanup/setup; provider повторно используется, если workspace owner ещё существует.

Provider использует встроенное переподключение y-websocket. Если соединение пропадает, клиентский Y.Doc может продолжать принимать локальные updates; по reconnect штатный Yjs state exchange сводит их с сервером без замены документа по last-write-wins. Browser smoke подтвердил независимые клиентские updates и их convergence; transport test также проверил offline edit и state exchange после reconnect.

В UI показываются только `Connecting…`, `Connected`, `Reconnecting…` и `Disconnected`; число участников, avatars, курсоры и тексты о presence не добавлены. `disableBc: true` отключает BroadcastChannel, чтобы локальные браузерные tabs не маскировали работу API WebSocket.

## Ограничения и безопасность

API проверяет origin, room identity, статус Interview, attachment relationship и snapshot. Он использует существующий TEMP DEMO AUTH principal, но participant identity authorization и guest membership ещё нет; знание room ID не следует считать защищённым production доступом. Это transport validation, а не полноценная authorization.

Новое соединение с FINISHED интервью отклоняется, и frontend не открывает collaboration room на FINISHED Session. Уже подключённый room повторно проверяет interview status при следующем новом connection, но отдельного business event канала в PHASE 5 нет: если интервью завершить из другого процесса при уже открытом WebSocket, существующее соединение может оставаться открытым. Бизнес-операция Finish не была изменена.

Комнаты и Yjs документы живут только в памяти API. Refresh получает актуальную версию, пока API процесс и room registry живы. Restart API теряет изменения и новая комната заново инициализируется из persistent `snapshotStarterCode`. Durable Yjs persistence, cross-process room routing, event recovery, replay, Redis, presence UI, Auth.js, guest invites и запуск пользовательского кода остаются вне фазы.

## Проверки

| Проверка                                        | Результат                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Shared, API и web build/typecheck               | PASS; выполнялись последовательные package проверки                                                                                  |
| Prisma schema validation                        | PASS                                                                                                                                 |
| Root lint                                       | PASS                                                                                                                                 |
| Prettier format check                           | PASS для изменённых документационных файлов после финального форматирования                                                          |
| Frontend Jest/RTL                               | PASS: 77 tests, 11 suites                                                                                                            |
| API transport/Yjs/CORS без PostgreSQL           | PASS: 23 tests, 3 suites                                                                                                             |
| Production build                                | PASS: Prisma, API и Next.js/Turbopack                                                                                                |
| Два браузерных контекста                        | PASS: A→B и B→A sync, concurrent convergence, switch A→B→A, shared Reset; typing не отправляет GraphQL mutation                      |
| PostgreSQL-backed API/collaboration integration | Не запущено: PostgreSQL на `127.0.0.1:55432` не принимал соединения; установка/запуск DB tooling не предпринимались                  |
| Root `pnpm typecheck`                           | Turbo параллельно вызвал два Prisma generate, один завершился с известным EEXIST; API и web package typecheck прошли последовательно |

Для browser smoke при недоступной PostgreSQL использован временный тестовый API на настоящем `createApiServer` и WS adapter, с in-memory Prisma fixture и двумя starter questions. Это проверяет реальный frontend, Monaco binding, GraphQL session flow и Yjs WebSocket, но не заменяет тест реальной схемы/миграций PostgreSQL. В обоих browser console встретилось по generic `Failed to load resource: 404`; в normal scenario иных browser errors или warnings не зарегистрировано. Endpoint конкретного resource по console text определить не удалось.
