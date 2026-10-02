# CodeMeet — PHASE 4 report

> Исторический отчёт о состоянии на конец PHASE 4. PHASE 5 добавила Yjs collaboration поверх предусмотренного Monaco integration point; актуальные детали см. в [PHASE 5 report](phase-5-report.md).

Дата: 2 октября 2026. Monaco Editor Foundation реализована; final root check, production build и production/development browser smoke завершены. Backend, Prisma, GraphQL contract и snapshots не менялись. Commit/push и следующие фазы не выполнялись. Диагностика Monaco при преднамеренном worker fault остаётся техническим долгом, описанным ниже.

## 1. Monaco integration choice

Выбран `@monaco-editor/react 4.7.0` с `monaco-editor 0.57.0`: wrapper предоставляет editor instance и существующий model через `onMount`, поэтому будущий binding не требует замены редактора. Stable wrapper явно поддерживает React 19 в peer dependencies. Версии проверены по registry на дату работы: [wrapper](https://registry.npmjs.org/@monaco-editor%2freact/4.7.0), [Monaco](https://registry.npmjs.org/monaco-editor/0.57.0), [esbuild 0.28.2](https://registry.npmjs.org/esbuild/0.28.2).

`loadMonaco()` импортирует локальный ESM package и вызывает `loader.config({ monaco })` до mount wrapper. Default AMD/CDN loader не используется. Этот способ поддерживается [официальным README wrapper](https://github.com/suren-atoyan/monaco-react#loader-config).

Прямой `monaco-editor` также подходит для Next.js с этой ESM/worker strategy и предоставляет полный editor/model API. Он требует самостоятельно связать DOM ref, `editor.create`, layout, subscriptions и disposal с React lifecycle. Для MVP wrapper берёт lifecycle editor instance, а ownership моделей остаётся в нашем manager; доступ через `onMount`/`editor.getModel()` сохраняет возможность будущего Yjs binding.

Два standalone module-worker bundle собираются `esbuild` в `public/monaco/editor.worker.js` и `public/monaco/ts.worker.js`. JS/TS используют TypeScript worker, остальные editor tasks — editor worker. Same-origin `MonacoEnvironment.getWorker` создаёт browser Worker с `type: 'module'`; build отделён от Next worker bundling. Основание: [официальная Monaco ESM integration](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md) и [esbuild Build API](https://esbuild.github.io/api/#build-api). В 0.57 учтены новые exported subpaths и namespace `monaco.typescript`, вместо старого `monaco.languages.typescript`.

## 2. Next.js client boundary

Route page и layout сохраняют server wrappers; существующий Apollo Session client component остаётся прежней boundary PHASE 3. Browser adapter загружается из domain editor через `next/dynamic` с `ssr: false`, как предусмотрено [Next lazy-loading documentation](https://nextjs.org/docs/app/guides/lazy-loading). Runtime проверяет наличие browser environment; Monaco не SSR-rendered.

## 3. Editor component architecture

Session передаёт snapshot language/starter code, interview ID, attachment ID и workspace draft store. `InterviewCodeEditor` управляет toolbar, dirty state, Reset и bounded loading/error states. `MonacoAdapter` скрывает wrapper API, модель и callback readiness. `model-manager` владеет моделями; `draft-store` — локальными значениями и workspace lifetime; `monaco-runtime` — ESM initialization, compiler defaults и workers.

Пока chunk/runtime загружается, виден placeholder/skeleton. Import/render/model/worker failure показывает «Code editor could not be loaded.» и Retry. Scoped timeout 20 секунд завершает зависшую загрузку. Worker `error`/`messageerror` передаётся подписчикам runtime; cleanup отписывает adapter. Retry сохраняет draft strings, освобождает собственные модели и создаёт новую dynamic adapter boundary. Новые модели получают прежние URI и тексты; undo history при recovery может сброситься.

## 4. Monaco model lifecycle

Первое открытие создаёт model из captured starter code; следующие открытия возвращают ту же owned model без `setValue` при render. Wrapper использует `keepCurrentModel`, поэтому переключение вопроса не уничтожает модель и её undo history.

`saveViewState={false}` отключает module-global URI cache wrapper: после Session teardown он не удерживает старые editor view states. Cursor/scroll restoration между вопросами отдельно не реализована. Manager отвергает чужую модель с тем же URI и не dispose её. При окончательном Session unmount собственные модели освобождаются.

Error recovery дополнительно освобождает модели до remount: когда models count становится нулевым, публичный model lifecycle заставляет Monaco очистить cached core worker/fallback. Runtime перенастраивает JS/TS defaults для перезапуска language workers. Private Monaco API не используется; normal switching сохраняет модели и undo.

## 5. Stable model identity

URI имеет вид `codemeet://interview/{interviewId}/question/{interviewQuestionId}/main.ts`; IDs кодируются, extension определяется языком. Ключом служит конкретный InterviewQuestion attachment, поэтому одна reusable Question в разных интервью получает разные документы. URI стабилен между renders/switches и пригоден для будущего соответствия shared document ↔ Monaco model.

## 6. Language mapping

| Backend enum | Monaco language | Extension |
| ------------ | --------------- | --------- |
| JAVASCRIPT   | javascript      | .js       |
| TYPESCRIPT   | typescript      | .ts       |
| REACT_TSX    | typescript      | .tsx      |

Mapping исчерпывающе типизирован через generated enum; `toLowerCase()` не используется. Общие JS/TS defaults: ESNext target/module, ReactJSX, allowNonTsExtensions, allowJs и strict. `.tsx` URI включает TSX parsing. Semantic diagnostics сохранены; полный React/node_modules type universe не загружается.

## 7. Draft strategy

Session создаёт in-memory Map по attachment ID и manager Monaco models. `onChange` синхронно обновляет только local draft; `useSyncExternalStore` обновляет toolbar. A → B → A сохраняет текст A, изменения B независимы.

Server `Interview.activeQuestion` остаётся единственным business authority. Switching отправляет существующую typed GraphQL mutation только с interview/question IDs; код в GraphQL не передаётся. Ошибка mutation оставляет текущую модель и draft. Начальный контент берётся только из InterviewQuestion snapshot; missing legacy snapshot не подменяется изменяемой Question.

## 8. Dirty/reset strategy

`isDirty = currentValue !== capturedStarterCode`. Toolbar показывает текст Modified/Unmodified вместе с визуальным индикатором. Reset доступен для готовой dirty модели и требует отдельного confirmation. Cancel/Escape сохраняет draft; Confirm вызывает `model.setValue(snapshotStarterCode)` и обновляет local store. Другие вопросы сохраняются, dirty state текущего вопроса снимается. Render/effect не сбрасывает введённый код.

## 9. StrictMode behavior

Model ownership принадлежит workspace, а не каждому mount wrapper. Store retain/release откладывает финальное disposal до microtask с проверкой generation: синхронный development cleanup/setup повторно retain workspace и сохраняет модели. Окончательный unmount освобождает их. Adapter отменяет использование позднего load result, отписывает runtime errors и выполняет cleanup readiness callback. Singleton ESM promise предотвращает повторную инициализацию.

## 10. Test strategy

Добавлено 26 frontend tests поверх 48 прежних. Jest/RTL/MSW проверяют language/URI mapping, initial/empty starter, independent drafts, dirty state, A → B → A, confirmation/cancel/reset, GraphQL switch failure, finished gating, loading, failure/Retry и сохранение edits после runtime failure.

Отдельные lifecycle tests используют model stub с учётом live models/listeners: reuse без overwrite, foreign ownership, idempotent disposal, StrictMode retain/release, real React StrictMode и смена workspace. Adapter/wrapper заменён stub; syntax-highlighting pixels и internals Monaco не тестируются в jsdom. Настоящие chunks/workers/editor проверяются browser smoke.

## 11. Accessibility

Toolbar использует visible labels и native buttons; dirty state не передаётся одним цветом. Monaco сохраняет собственную accessibility support и aria label. Reset — native modal dialog с labelled heading/description; initial focus на Cancel, Escape отменяет, после закрытия focus возвращается к Reset либо editor. Loading имеет status, failure — alert. Fake textarea в product отсутствует.

## 12. Responsive behavior

Editor получает явную высоту: desktop `clamp(340px, 48vh, 540px)`, mobile 350px, узкие viewport до 360px — 320px. `min-width: 0`, restrained toolbar и automaticLayout позволяют editor вписываться в существующий Session layout. Theme — built-in `vs`. Девять стабильных options задают layout, minimap, font/tab size, wrap, scroll, brackets и accessibility. Production viewport 1440/768/390/320px проверены: document horizontal overflow отсутствует, editor height не меньше 300px. Fresh development viewport 320px также прошёл.

## 13. Checks

Окружение: Node 22.23.3, pnpm 10.34.6, настоящий PostgreSQL. Generated workers исключены из formatter/linter source checks, входят в Turbo build outputs и пересобираются существующими web dev/build scripts через `pnpm editor:workers`. Worker files не коммитятся.

| Проверка                                 | Подтверждённый результат                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Frontend Jest/RTL/MSW                    | PASS: 74 tests, 10 suites                                                                                             |
| Backend PostgreSQL integration/CORS      | PASS: 83 tests, 2 suites                                                                                              |
| Standalone workers build                 | PASS: editor ~300KB, TS service ~6.7MB minified до transport compression                                              |
| Runtime/build-script ESLint и Prettier   | PASS                                                                                                                  |
| Final root `pnpm check`                  | PASS: format, lint, strict typecheck и GraphQL Codegen check                                                          |
| Production build                         | PASS: web/API/db, включая rebuild после recovery patch                                                                |
| API/Prisma/GraphQL regression hashes     | PASS: 37 файлов совпадают с baseline                                                                                  |
| Production browser desktop flow          | PASS: Create/Start, настоящий Monaco JS/TS/TSX, edit/reset и A → B → A                                                |
| Switching network / Reset keyboard/focus | PASS: no GetInterview refetch при switch; native confirmation и focus return                                          |
| Production responsive                    | PASS: 1440/768/390/320px, без horizontal overflow, editor height ≥300px                                               |
| Refresh / Finish / FINISHED gate         | PASS: refresh возвращает starter baseline; Finish закрывает editor                                                    |
| Backend content / browser GraphQL        | PASS: snapshots неизменны; code отсутствует в variables; 20 responses HTTP 200 без GraphQL errors                     |
| Worker fault / Retry                     | PASS: controlled failure, draft + Modified сохранены, real suggestions восстановлены; vendor diagnostics описаны ниже |
| Development StrictMode                   | PASS: JS/TS/TSX drafts, 3 leave/reopen cycles, fresh 320px; duplicate models/listener warnings отсутствуют            |

Подтверждено **157 tests, 12 suites PASS**, final root check и production build. `pnpm check` выполнен с тем же `NEXT_PUBLIC_GRAPHQL_URL`, что build (API port 4100). Browser smoke использует production frontend/API и настоящий PostgreSQL: Create → Start → Session → edit A → edit B → return A сохранил независимые drafts; проверены JS, TS и TSX, reset и native keyboard/focus behavior. Refresh вернул snapshot starter baseline. Finish собственного нового интервью создал FINISHED state; direct Session показала finished gate без editor.

Prisma readback подтвердил неизменность snapshots после edits; код отсутствует в GraphQL variables. Все 20 GraphQL responses вернули HTTP 200 без errors и explicit CORS для `http://localhost:3000`. В normal production flow page errors — 0; наблюдался один существующий favicon 404.

В отдельном fault test оба worker requests удерживались до ввода draft, затем abort вызвал controlled failure UI. Retry сохранил текст и Modified, новые workers восстановили реальные suggestions. При намеренном abort vendor Monaco дополнительно выдал fallback warning, две console-записи `undefined` и два uncaught `Event`; этот fault path не объявляется полностью чистым по диагностике.

Настоящий Next dev с `reactStrictMode: true` проверен отдельно: JS/TS/TSX drafts, три Session leave/reopen cycles, ожидаемый discard drafts после выхода и повторное создание моделей без duplicates. Page errors — 0, model/listener warnings отсутствуют; только существующий favicon 404. Jsdom не служит доказательством работы настоящего Monaco.

Просмотренные screenshots: [desktop production](screenshots/editor-desktop.png), [mobile production](screenshots/editor-mobile.png), [320px development](screenshots/editor-mobile-320.png). Последний artifact содержит стандартный Next dev indicator. API health подтвердил `status: ok`, GraphQL `__typename` — HTTP 200. Dev frontend оставлен на localhost:3000, API — 4100, PostgreSQL — 55432.

## 14. Technical debt

- TypeScript service worker тяжёлый; CDN нет, deployment должен отдавать generated public assets вместе с Next build. Повторную сборку обеспечивают dev/build scripts и Turbo outputs.
- React declaration files и полноценное project/module resolution отсутствуют; TSX syntax доступен, некоторые React semantic diagnostics остаются ожидаемыми.
- Caret/scroll position не восстанавливается между вопросами. Если понадобится, view-state store должен принадлежать Session с явным cleanup.
- Retry после editor/worker failure пересоздаёт модели из draft strings; undo history в этом recovery workflow может потеряться.
- Преднамеренный abort workers вызывает vendor fallback/console/uncaught Event diagnostics даже при controlled failure UI и успешном Retry. Узкого публичного API Monaco для безопасного подавления этой диагностики не найдено. Глобальные console/error handlers не маскируются; fault-path diagnostics остаются upstream technical debt.
- В существующем cold-cache root check воспроизведена scheduling race: DB build и DB typecheck с внутренним build одновременно запускают Prisma generate в один output directory. Final check прошёл с тем же build environment, что production build: dependency build использовал cache и generate выполнялся один раз. Scheduling race не исправлялась и может повториться на cold cache; backend/scripts не переписывались. Раздельный generate task или явная последовательность остаются инфраструктурным долгом.
- Multi-client synchronization, durable drafts и автоматизированная cross-browser QA требуют отдельных задач. Existing auth/transport limitations PHASE 3 сохраняются.

## 15. Future Yjs binding point

Internal `onEditorReady({ editor, monaco, model })` возвращает optional cleanup. Будущий collaboration adapter сможет подключить `Y.Text` к существующей stable model и освободить binding раньше disposal editor/workspace. Session не получает Monaco internals и не требует переписывания business active-question flow. Yjs, y-monaco и transport сейчас отсутствуют.

## 16. Ограничения PHASE 4

Drafts существуют только в текущем mounted workspace. Full refresh, уход из Session и Finish могут уничтожить edits; backend code не сохраняется, UI прямо предупреждает об этом. FINISHED Session не монтирует editor. Toolbar содержит только language, Modified/Unmodified и Reset.

Код редактируется и не исполняется. Application не добавляет eval/new Function, script injection, iframe execution или runner. WebSocket, Yjs, awareness, presence, subscriptions, save mutations, Auth/guest flow, Sandpack/WebContainers и CodeRunner не реализованы. Работа заканчивается PHASE 4.

## 17. Пять вопросов технического интервьюера

1. Почему editor draft идентифицируется InterviewQuestion attachment ID, а business active question — source Question ID? Какие проблемы возникнут при одном глобальном text value?
2. Как `keepCurrentModel`, workspace ownership и generation-checked microtask cleanup сохраняют drafts/undo в StrictMode, одновременно освобождая модели после final unmount?
3. Почему Reset реализован подтверждённым `model.setValue`, а initial snapshot применяется только при создании? Как отличить пустой starter code от missing snapshot?
4. Зачем workers собираются отдельно от Next, и как локальный ESM loader, failure subscription и Retry проверяются иначе, чем domain logic в jsdom?
5. Как future Yjs binding использует existing model и cleanup callback? Кто станет authority для content и как избежать перезаписи shared text starter code при reconnect?
