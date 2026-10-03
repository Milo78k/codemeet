# API integration failure diagnosis

Дата: 2 октября 2026. Ветка `feature/phase-7-awareness`. PHASE 8 не начиналась; commit и push не выполнялись.

## Четыре повторявшихся сбоя

1. **WebSocket initial sync timeout — сочетание дефекта теста и production-дефекта.** До исправления сценарий падал 5/5: тест отправлял бинарный Yjs Sync Step 1 сразу после `open`, до PHASE 7 authentication, и сервер закрывал socket с кодом `4401` (`Authentication is required.`). Helper не слушал `close`, поэтому реальное закрытие выглядело как timeout. При правильном handshake обнаружился production-дефект: `authenticated` отправлялся как бинарный frame, хотя browser adapter ждёт текстовый JSON и сам закрывал такое соединение с кодом `4401`. API теперь отправляет текстовый frame; helper аутентифицирует интервьюера до Sync Step 1, сообщает close/error и освобождает socket/listeners. Изменены `apps/api/src/collaboration/collaboration-server.ts`, `apps/api/src/types/ws.d.ts` и `apps/api/tests/collaboration.integration.test.mjs`. Исправленный sync сценарий прошёл 5/5.

2. **Concurrent attachment/start — production retry bug.** Изолированный исходный тест прошёл 5/5, но падал в двух полных прогонах. Контролируемое воспроизведение вернуло `TransactionWriteConflict` в 7/30 гонок. Исходная ошибка адаптера: `DriverAdapterError`, `cause.kind = TransactionWriteConflict`, SQLSTATE `40001` (`could not serialize access due to read/write dependencies among transactions`). Yoga маскировал её как `INTERNAL_SERVER_ERROR`. Retry распознавал Prisma `P2034`, но Prisma PostgreSQL adapter возвращал другой тип ошибки. Retry теперь распознаёт только этот конкретный adapter conflict, остаётся ограниченным тремя попытками и после исчерпания возвращает контролируемый `CONFLICT`. Изменён `apps/api/src/services/shared.ts`; добавлены две детерминированные проверки в `apps/api/tests/serializable-transaction.test.mjs`. Конкурентный integration сценарий прошёл 10/10; обе проверки retry прошли.

3–4. **Две candidate authorization проверки — неверное ожидание теста.** Оба исходных сценария падали 5/5 из-за ожидания одной ошибки. Запрос одновременно выбирает два независимых nullable root fields: `currentParticipant` и `interview`. Для invalid/expired/revoked токена GraphQL вернул ожидаемую domain ошибку для каждого поля: `This participant session is invalid or expired.`, code `UNAUTHENTICATED`, paths `['currentParticipant']` и `['interview']`. Это field-level ошибки GraphQL, а не duplicate parent/child errors и не утечка private data. Проверка теперь утверждает обе точные ошибки и их paths. Production authorization не ослаблялась. Изменён `apps/api/tests/guest-authorization.integration.test.mjs`. Сценарии expired и revoked прошли по 5/5.

## Предупреждения и безопасность

`pg@8.23.1` продолжает выдавать deprecation warning о `client.query()` при уже выполняющемся запросе. Предупреждение подтверждает очередь запросов на pg Client; trace проходит через `@prisma/adapter-pg` `PgTransaction.performIO` и Prisma query interpreter. Приложение не использует raw `pg.Client`, а тестовые HTTP mutations не разделяют явную Prisma transaction: каждый test helper создаёт отдельную схему, Prisma использует pool. Это предупреждение адаптера/драйвера; конкретная ошибка гонки отдельно получена как SQLSTATE `40001`. Предупреждение остаётся, dependency не менялась.

Полный API набор подтвердил отказ неаутентифицированному WebSocket, ограничение candidate собственным interview/private data, Yjs sync и server-bound Awareness identity. Данные приложения не сбрасывались; integration helper удаляет только созданные им временные схемы `cm_test_*`.

## Проверки

### PASS

- Изолированные исправленные сценарии: WebSocket 5/5, attachment/start 10/10, expired candidate 5/5, revoked candidate 5/5.
- Full API: 7 suites / 104 tests; frontend: 12 suites / 88 tests.
- Root lint, typecheck, GraphQL codegen check, Prisma validate и production build.
- Детерминированные retry regression tests: 2/2.

### FAILED

- `pnpm format:check`: только ранее известные `apps/web/src/shared/api/errors.ts` и `docs/phase-5-report.md`; они не менялись.

### SKIPPED

- Ручной smoke в двух независимых браузерах: этот запуск проверял API и автоматические frontend tests, не интерактивные browser contexts.

Node также выводит ожидаемый Jest `ExperimentalWarning` для VM Modules; production build сообщает, что `public/monaco/ts.worker.js` имеет размер около 6.7 MB. Commit и push не выполнялись.
