# CodeMeet — PHASE 9: Safe Code Runner

PHASE 9 adds a browser-only Run action to the active Interview Session. User source is not executed inside the Node/GraphQL API process. Run output is ephemeral and visible only in the initiating browser. The first manual browser smoke failed on `Unexpected token 'export'`; the cause and fix are recorded below. **PHASE 9 implementation and manual browser smoke are complete.**

## 1. Execution engine

**Dedicated first-party Web Worker.** The web build produces `public/code-runner/runner.worker.js` from a small worker entry module. The editor sends the captured source and metadata over a transferred `MessagePort`; the worker sends bounded logs and one terminal result back over that private port. The page does not embed user code in HTML or send it to the API.

## 2. Why this engine

CodeMeet currently edits one source file per Question in Monaco. A worker fits this shape, uses the browser's existing JavaScript engine, keeps synchronous work off the React/Monaco thread, and provides `Worker.terminate()` for actual interruption. It adds no execution dependency or external service. It does not attempt to implement a JavaScript engine.

## 3. Alternatives considered

| Option                   | Fit for current Monaco                                                            | Language/runtime                                        | Stop behavior                                                    | Cost and constraints                                                                                 | Decision                                              |
| ------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Sandpack                 | Custom Monaco integration is available; stronger fit for file-based React preview | JavaScript, packages and React project workflows        | Runtime/frame lifecycle rather than a minimal one-snippet worker | Bundler/runtime integration and a larger surface; unnecessary for a single snippet                   | Deferred until React preview is a product requirement |
| WebContainers            | Full browser Node workspace, terminal and filesystem                              | Broad Node/npm workflows                                | Can stop browser processes, but has a larger runtime lifecycle   | SharedArrayBuffer/cross-origin isolation, browser restrictions and possible commercial API licensing | Too broad for this phase                              |
| Dedicated browser Worker | Directly accepts current Monaco text                                              | JavaScript, plus TypeScript transpilation; no React DOM | `Worker.terminate()` stops the worker immediately                | Small first-party adapter; it is not a hostile-code VM and has no hard memory quota                  | **Selected**                                          |

References: [Sandpack](https://sandpack.codesandbox.io/), [WebContainers browser support](https://developer.stackblitz.com/platform/webcontainers/browser-support), [WebContainer API FAQ](https://developer.stackblitz.com/guides/user-guide/general-faqs), [Worker termination](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate).

## 4. Supported languages

- `JAVASCRIPT`: ordinary script snippets are passed to the worker without transpilation. If a starter includes `export` declarations, those declarations are lowered to worker-local CommonJS bindings so the classic execution body contains no ESM marker.
- `TYPESCRIPT`: supported through lazy `typescript.transpileModule` in the worker, with `module: CommonJS` and legacy module detection. No explicit `isolatedModules` option is set; `transpileModule` compiles one source file and does not type-check. Static imports, external packages and module graphs are outside the current scope. TypeScript without module syntax produces classic script code without a synthetic `export {}`.
- `REACT_TSX`: explicitly unsupported for execution. It needs a React preview, entry files and package/runtime semantics. The UI disables Run and says so instead of pretending to execute it.

The TypeScript compiler comes from the existing dependency and is emitted as a lazy worker chunk; no dependency was added. The current generated compiler chunk is about 3.4 MB before transfer compression and is requested only for TypeScript execution.

## 5. Source snapshot semantics

The click handler synchronously reads `model.getValue()` from the active Monaco model and immediately copies that string into the run request. The model is bound to the active Question's Y.Text. Later edits cannot mutate the captured string; the next Run reads the new model value. Starter code, React state and Apollo cache are not used as execution sources.

## 6. Timeout and termination

The browser controller starts a five-second deadline and terminates the active Worker on timeout. This stops a `while (true) {}` loop instead of only ignoring its Promise. The Worker is also terminated after success/error and on cancel, active-question unmount, Finish or component unmount. The deadline includes Worker and TypeScript compiler startup time.

## 7. Console capture

`console.log`, `console.info`, `console.warn` and `console.error` are captured in arrival order. Runtime and transpilation errors become a bounded stderr entry and a typed `runtime_error` result. The parent React tree handles the error as data in Output; it is not thrown as an application exception.

## 8. Output limits and serialization

At most 100 entries, 2,000 characters per entry and 20,000 characters of captured log text are retained. One `[output truncated]` marker replaces further output. Strings, primitives, `undefined`, `Error`, arrays and plain objects are rendered as bounded readable text; circular references become `[Circular]`. This is not a DevTools object inspector.

## 9. Security boundary

The Worker receives only the source snapshot, language, question ID and run ID. No app closure, DOM, sessionStorage, guest/session token, Apollo client, GraphQL helper, DATABASE_URL, private Interview note or environment secret is passed to it. The main API process never evaluates or imports user source. The API and Prisma schema were not changed for this feature. Browser Worker isolation and CSP are mitigations, not a guarantee against hostile code or browser-engine vulnerabilities; the browser has no hard memory quota here.

## 10. Network access

The Next response for `/code-runner/:path*` sets `default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'`. `connect-src 'none'` blocks normal `fetch`, XHR, WebSocket and similar connections from the Worker; external script origins are not allowed. `'self'` is retained so the lazy TypeScript compiler chunk can load for TypeScript and exported-starter adaptation. Therefore same-origin script loading is still possible, and this is not a claim that every network-capable browser API is fully removed. Deployment must preserve the worker response CSP; verify it after adding a CDN or reverse proxy.

## 11. CodeRun persistence decision

The existing Prisma `CodeRun` model was reviewed and remains unchanged. No GraphQL CodeRun operations or services existed. Run state/output stays local because a browser-reported result is not trusted evidence, and persistence would require a separate authorization, API validation and retention contract. No result is broadcast to the other participant.

## 12. Interaction with Yjs

Y.Text remains the shared source of truth. The runner reads a string from its bound Monaco model at click time. Run status, logs and results are not written to Y.Doc/Y.Text, Awareness, Session Events, Apollo or GraphQL. Typing continues through the existing Yjs WebSocket.

## 13. Question switching

Each run is tagged with `interviewQuestionId` and `runId`. Switching Question unmounts the keyed editor, terminates any Worker and clears its local Output. A late result from Question A cannot render in Question B.

## 14. Finish behavior

Only the `IN_PROGRESS` session exposes an enabled Run action. Finish moves the session to its existing finished view, unmounts the editor and terminates the Worker. The finished session remains read-only and has no Run action. A cancelled/late message cannot restore a running state.

## 15. Tests

Runner controller tests cover source immutability, ordered messages, runtime error normalization, timeout calling `terminate`, cancellation, question identity, unsupported TSX, output caps, circular values and TypeScript transpile/syntax diagnostics. Frontend tests cover Run availability, running/disabled state, output, unsupported language, current remote Y.Text update, immutable snapshot during later edits, next Run using new source, reset source, question change cleanup, disabled/finished UI and unmount cleanup. Worker-entry tests execute the bundled worker artifact in a separate Node Worker thread; they exercise generated-source handling and worker termination, but do not replace the real-browser retest below.

## 16. Manual browser smoke

**MANUAL BROWSER SMOKE: PASS (2026-10-03).** The initial run failed because the seeded Two Sum JavaScript starter begins with `export function twoSum(...)`. CodeRunner captures and sends the complete current Monaco/Y.Text source unchanged, then passes it to `new Function`, whose classic-script grammar rejects that ESM declaration before reaching the test statement. A regression reproduction using the seeded starter plus `console.log("hello")` confirmed the Worker request contained the export-bearing source and returned the same parser failure. After the transform fix, the user manually confirmed:

- The seeded starter containing `export` executes without `SyntaxError: Unexpected token 'export'`.
- JavaScript `console.log("hello");` runs and prints `hello`.
- `throw new Error("boom");` reports the user error `Error: boom`.
- `while (true) {}` times out after about five seconds; the active Worker is terminated and the UI remains responsive.
- TypeScript `const value: number = 42; console.log(value);` runs and prints `42`.
- User source executes in the dedicated browser Worker; it is not sent to or executed by the Node/GraphQL API process.

The fix leaves ordinary JavaScript without module syntax unchanged. The language adapter uses the existing TypeScript compiler only for TypeScript or source containing `import`/`export` keywords; TypeScript is emitted with `module: CommonJS` and legacy module detection, and starter exports are lowered to local `exports` bindings. Static imports and external packages remain unsupported. The bundled Worker remains a module Worker for its own shared/lazy chunks; user executable code is classic script code. The manual retest used the prepared `IN_PROGRESS` interview with JavaScript and TypeScript questions. Its invite token is not stored in this report.

The live HTTP checks passed: API health and GraphQL responded; dashboard, interviewer session and candidate join routes returned HTTP 200; the worker asset returned HTTP 200 with the configured CSP. These checks complement, and do not replace, the successful manual browser smoke above.

## 17. Limitations

Execution is browser-only, single-file and limited to snippets; there is no stdin, Node filesystem, external package installation, React preview, cross-participant output, server verification or hard memory ceiling. TypeScript is transpiled without type checking. Static imports and external packages are unsupported. Same-origin script chunks remain loadable for TypeScript and export adaptation.

## 18. Technical debt

- If stronger hostile-code isolation becomes necessary, evaluate a separately hosted origin/service with a reviewed resource budget; do not silently widen the API process.
- Decide whether React TSX preview has enough product value to justify Sandpack or another multi-file runtime.
- Add production deployment tests confirming the CSP headers survive proxy/CDN configuration.
- Add trusted server-side run persistence only with explicit authorization and untrusted-result semantics.

## 19. State when PHASE 9 closed

PHASE 9 was complete when this report was written; PHASE 10 had not yet started at that point. PHASE 10 and PHASE 11 are now complete. Current overall project status is recorded in the README and PHASE 12 report.

## Verification results

### PASS

- `corepack pnpm check`: format, GraphQL codegen check, lint and typecheck.
- `corepack pnpm db:validate`: Prisma schema validation.
- Frontend tests: 17 suites, 133 tests passed.
- API/PostgreSQL integration tests: 8 suites, 108 tests passed.
- `corepack pnpm build`: production build, including generated Monaco and Code Runner workers.
- Actual bundled runner entry executed in isolated Node Worker thread tests: plain JavaScript source unchanged, seeded JavaScript `export function` starter runs, `throw new Error("boom")`, JavaScript syntax error, TypeScript `42` and syntax error, no synthetic ESM markers, static import rejection, console order, circular values, output cap and real timeout termination.
- Local HTTP: `/health`, GraphQL `{ __typename }`, dashboard/session/join routes, and worker static asset/CSP.
- `git diff --check`.

### FAILED

None in the final verification run.

### SKIPPED

- DevTools Network/Console inspection was not part of the requested PHASE 9 retest and is not claimed here.
