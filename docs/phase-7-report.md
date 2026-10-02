# CodeMeet — PHASE 7 report

Дата: 2 октября 2026. Реализованы question-scoped Awareness, participant presence, remote selections и цветные caret labels поверх PHASE 5/6 WebSocket/Yjs architecture. Commit и push не выполнялись; PHASE 8 не начиналась.

## 1. Baseline

Перед работой: ветка `feature/phase-7-awareness`, HEAD `e6bd10d feat: implement CodeMeet through phase 6`, working tree clean. Прочитаны `README.md`, `docs/architecture.md`, `docs/phase-5-report.md` и `docs/phase-6-report.md`; проверены существующие handshake, Y.Doc room, Monaco binding, identity lookup, question switching и cleanup.

Baseline проверки, запущенные до изменений: API/web/shared lint, API/web/shared typecheck, GraphQL Codegen check, Prisma schema validation, frontend 12 suites / 86 tests и database-free API transport/CORS/Yjs suites 3 suites / 27 tests прошли. Полный Prettier baseline уже не проходил на `apps/web/src/shared/api/errors.ts` и `docs/phase-5-report.md`. PostgreSQL не слушал локальные порты 5432/55432, `pg_isready` и Docker отсутствовали. Node был `22.14.0` при требовании `>=22.15.0 <23`; pnpm не был доступен.

## 2. Awareness architecture

Используется Awareness из установленного `y-protocols@1.0.7`; документ по-прежнему синхронизируется стандартным y-websocket/Yjs protocol. Backend держит Awareness в памяти той же комнаты, что и Y.Doc, и не пишет её в PostgreSQL.

## 3. Identity и trust

После WebSocket authentication API связывает socket с identity из проверенного источника: Candidate ParticipantSession либо найденный interviewer InterviewParticipant. Все входящие Awareness состояния проходят серверную нормализацию: `user` целиком заменяется trusted `{ participantId, displayName, role }`; произвольные поля, включая токены/permissions, удаляются. Один socket может владеть одним Awareness client ID. Попытка обновить чужой ID с новым clock отклоняется; точные/stale echoes уже принятого чужого состояния, которые y-websocket может переслать обратно, безопасно игнорируются.

Из selection принимаются только валидные Yjs relative positions к корневому `Y.Text("code")`. Неверная selection отбрасывается, но авторизованное presence остаётся. Awareness user не используется для server-side privilege checks.

## 4. Presence UI

В активной Session над editor toolbar отображается компактный список Participants с точкой, display name и ролью. UUID, email, session token и дополнительные profile поля не показываются. Локальный участник добавляется только при активном WebSocket; remote state удаляется из списка после Awareness removal.

## 5. Question-scoped presence

Список участников и курсоры относятся к комнате `Interview + InterviewQuestion`. Клиенты на разных вопросах не обмениваются presence. При смене вопроса старый editor subtree размонтируется, binding/provider освобождаются, новый question подключается отдельно. Global interview presence не добавлено.

## 6. Remote cursors и selections

Проверен API установленного `y-monaco@0.1.6`: `MonacoBinding` принимает editor set и Awareness, сам пишет относительные anchor/head positions и рисует remote selection. Дополнительная Monaco decoration отображает caret и display name как injected text, без HTML. Курсорные позиции разрешаются относительно текущего Y.Doc; позиции не сериализуются в GraphQL.

## 7. Deterministic colors

FNV-1a hash от participantId выбирает один цвет из фиксированной палитры шести насыщенных цветов с контрастным текстом на светлом editor фоне. Цвет не случайный и не сохраняется в БД. Цвет selection, caret label и presence dot используют один и тот же participantId.

## 8. Multiple connections

Разные Awareness client IDs одного человека показывают независимые курсоры, но список участников дедуплицируется по participantId. Если тот же participant присутствует локально и как remote state другой вкладки, UI показывает его один раз.

## 9. Cleanup lifecycle

Cleanup удаляет Awareness/editor listeners, Monaco decorations и временный cursor style; y-monaco binding уничтожается вместе с editor. Question provider освобождается после отложенного owner check, поэтому React StrictMode cleanup/setup сохраняет один provider. Awareness instance и его clock повторно используются при возврате в ту же question room; локальное состояние очищается перед повторным входом и при окончательном уничтожении interview documents.

## 10. Disconnect и reconnect

Используются стандартные y-websocket reconnect и Awareness null-state/timeout removal; собственного heartbeat нет. Reconnect сохраняет существующий Awareness clock и локальную identity/selection, после соединения provider повторно отправляет local state. При полном provider teardown локальное состояние очищается, а повторный вход в ту же room продолжает clock без stale-update collision.

## 11. Y.Doc и Awareness

Y.Doc/Y.Text — collaborative source code в памяти API. Awareness — только эфемерные presence/cursor/selection metadata. Awareness update не меняет Y.Text и не меняет dirty state, который сравнивает текущий код с snapshot starter code.

## 12. GraphQL, Yjs и Awareness

GraphQL/Apollo остаётся источником business state: Interview status, active question, participant/session бизнес-данные и permissions. Y.Doc/Y.Text синхронизирует исходный код. Awareness передаёт presentation state активной room. `setActiveQuestion` остаётся GraphQL mutation; Awareness не используется как event bus.

## 13. Security

До Awareness frame сервер требует успешного handshake и существующего authorized room connection. Сохраняются PHASE 6 Origin, session, role, interview membership, question attachment, snapshot и `IN_PROGRESS` checks. Проверено: чужой interview, неверный/истёкший/revoked candidate session и чужой Awareness client ID не получают доступ; client-supplied role/name не становятся identity. Token не включён в Awareness, WebSocket URL или realtime logs. Awareness не записывает InterviewEvent и не вызывает business writes.

Остающееся ограничение: interviewer до Auth.js использует общий TEMP DEMO AUTH principal. Это не полноценная production authentication для нескольких интервьюеров.

## 14. BroadcastChannel validation

В существующем provider подтверждён `disableBc: true`; это направляет обмен клиентов через API WebSocket. Transport suite использует независимые WebSocket clients и подтвердил двусторонний Awareness/Yjs обмен. Проверка двух реальных browser profiles, доказывающая маршрут без BroadcastChannel, отдельно не выполнена: в доступном in-app browser runtime не было браузерных контекстов.

## 15. Tests

Frontend: 12 Jest/RTL suites / 88 tests PASS. Включают metadata mapping, стабильную палитру, dedupe/remove, trusted local/remote roles, передачу Awareness в MonacoBinding, dirty state, question switch/re-entry, unmount, StrictMode и отсутствие collaboration на FINISHED Session.

API database-free suites: `collaboration.transport`, `cors`, `yjs-convergence` — 3 suites / 29 tests PASS. Transport покрывает auth-before-sync, trusted Awareness для interviewer/candidate, spoof stripping, обе стороны получают изменения, room/question isolation, disconnect removal, client ID hijack, Yjs sync и отсутствие InterviewEvent writes.

## 16. Two-browser smoke

SKIPPED. In-app browser runtime discovery вернул пустой список browser contexts. Для этой проверки не использовались альтернативные browser runners. Настоящие UI scenarios двух независимых browser contexts — presence, remote cursor/selection, typing и switch/disconnect/rejoin — остаются ручной проверкой после появления browser runtime.

## 17. Limitations

Awareness живёт только пока API process держит комнату; рестарт API сбрасывает Y.Doc edits и presence. Candidate не получает business-event о `activeQuestion` и должен обновить Session. Уже открытое соединение не получает немедленное внешнее Finish/revoke событие. Presence обещает online только в текущей authorized Question room, а не во всём приложении.

## 18. Technical debt

Нужны реальный interviewer auth, durable Yjs document storage/recovery и business-event delivery для lifecycle изменений. Не проведён визуальный аудит Monaco decorations в настоящих браузерах и независимых профилях. Palette ограничена шестью цветами, поэтому разные participant IDs могут иметь одинаковый цвет; ID остаётся стабильным и collision не означает одинаковую identity.

## 19. Что логично дальше

Следующая отдельная фаза по roadmap — browser code execution/runtime limits. Перед её началом следует повторить двухклиентский browser smoke для PHASE 7; работа в следующую фазу в этом изменении не начиналась.

## 20. Пять вопросов интервьюера

1. Как сервер связывает client-controlled Awareness с уже авторизованной participant identity?
2. Почему remote selection стоит передавать в Yjs как relative positions, а не как обычные line/column координаты?
3. Как provider reconnect и clock ordering предотвращают stale Awareness state после возврата в Question room?
4. Почему BroadcastChannel отключён при авторизованной WebSocket архитектуре?
5. Чем ephemeral Awareness отличается от Y.Doc persistence и GraphQL business state?

## Проверки

### PASS

- API, web и shared typecheck; Web Next route type generation.
- API, web, shared и root ESLint.
- GraphQL Codegen `--check`.
- Prisma schema validation с локальным placeholder DATABASE_URL; подключение к БД этим не проверяется.
- Изменённые source/docs файлы проходят Prettier check.
- Frontend Jest/RTL: 12 suites / 88 tests.
- API database-free transport/CORS/Yjs: 3 suites / 29 tests; loopback listener понадобился на разрешённом sandbox execution.
- API TypeScript production compilation + schema copy.
- Monaco worker generation и Next.js production build.
- `git diff --check`.

### SKIPPED

- PostgreSQL-backed API/guest authorization integration tests и проверки migration/seed: локальные порты 5432/55432 закрыты, PostgreSQL, Docker и `pg_isready` отсутствуют.
- Два независимых браузерных клиента, cursor/selection визуальная проверка, Question switch и browser disconnect smoke: browser runtime не предоставил browser contexts.
- Root `pnpm check` и `pnpm build`: `pnpm` не установлен; текущий Node `22.14.0` ниже проектного минимума `22.15.0`. Эквивалентные package typecheck/lint/build задачи, доступные напрямую из локальных binaries, были выполнены отдельно.

### FAILED

- Полный repository `prettier --check .` по-прежнему завершается ошибкой только на двух файлах, которые уже не проходили baseline: `apps/web/src/shared/api/errors.ts` и `docs/phase-5-report.md`. PHASE 7 их не меняла; все изменённые файлы отформатированы и проверены.

Новые зависимости не устанавливались, конфигурация и миграции не менялись. DB reset, seed, commit и push не выполнялись.
