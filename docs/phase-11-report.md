# CodeMeet — PHASE 11: Interview Results

**Status: PHASE 11 complete. Automated checks, manual browser smoke and visual re-test passed.** Manual review findings and fixes are documented below. Results remain a read-only summary of persisted session facts; they do not score candidates or judge solution correctness.

## 1. Goal

Give the interviewer a durable summary after Finish: interview metadata, candidate, ordered question snapshots, code run summaries and persisted key events.

## 2. Route and navigation

Results use `/interviews/[id]/results`. The interviewer can open the route from the finished interview overview or the finished interviewer session state. The candidate finished state has no Results link.

## 3. Data model decision

No Prisma schema change or migration is needed. Existing `Interview`, `InterviewQuestion`, `InterviewParticipant`, `CodeRun` and `InterviewEvent` contain the required facts. Counts, latest-run selections, duration and timeline presentation are derived at read time; no duplicate Results snapshot is stored.

## 4. GraphQL design

`interviewResults(id)` is one coherent summary query. It returns interview status/metadata, participant display names, persisted timestamps, duration when computable, question summaries, per-question run count/latest run, bounded timeline events and a flag when older timeline activity was omitted. Full run history uses the existing paginated `codeRuns` query only when a question is expanded.

## 5. Authorization

The resolver obtains the interviewer from the trusted API context and the service requires `Interview.createdById` to match. Missing/foreign interviews return `NOT_FOUND`; candidate identities are rejected with `FORBIDDEN`; anonymous requests require authentication. Authorization happens before source or aggregate data is loaded. Frontend link visibility is not a security boundary.

## 6. Aggregation

All reads use a Repeatable Read transaction. `totalQuestions` comes from ordered attachments. A grouped query obtains per-question counts and maximum `createdAt`; a second grouped query chooses the maximum run ID at each question's maximum timestamp; one bounded `findMany` fetches those runs. `totalRuns` is the sum of grouped counts. The tie-break is deterministic by `createdAt DESC, id DESC`.

Duration is the non-negative difference between persisted `startedAt` and `finishedAt`. It is unavailable when either timestamp is null or the interval is invalid. No timestamps are invented.

## 7. Snapshot semantics

Question title, language and difficulty come from `InterviewQuestion` snapshot columns. Reusable `Question` current content is never used to represent historical question content. Legacy missing snapshot fields remain unavailable in the UI rather than being silently replaced.

## 8. Run history reuse

The latest source/output is shown read-only in the question summary. Expanding run history mounts the PHASE 10 `GetCodeRuns` pagination query and reuses `CodeRunHistory`; no second history implementation, execution button, restore action or optimistic local history is added.

## 9. Timeline

Only persisted `INTERVIEW_STARTED`, `QUESTION_CHANGED`, `CANDIDATE_JOINED` and `INTERVIEW_FINISHED` events are included. `INTERVIEW_CREATED` is treated as setup noise; `CODE_RUN` events are not synthesized because the existing run writer does not persist them. The newest 100 key events are returned and presented oldest-to-newest. Question labels resolve through the frozen attachment snapshot.

## 10. UI

The page contains interview metadata, candidate/interviewer names, status, timestamps, duration, total questions/runs, ordered question cards, latest run details, lazy paginated history and a compact timeline. Copy explains that Results are descriptive and not an automated candidate score.

## 11. Empty and unavailable states

- DRAFT, READY and IN_PROGRESS interviews return a controlled `available: false` result; source and run details are not loaded.
- Finished interviews with no runs show a question-level empty state.
- Missing candidate display name, timestamps, legacy snapshot fields and timeline events have explicit fallbacks.
- Authorization/network failures use the existing controlled error UI.

## 12. Security and privacy

The backend only returns Results for the owner interviewer. Candidate queries cannot return interviewer aggregates or source snapshots. The Results service and UI do not log source code. The current interviewer identity remains TEMP DEMO AUTH, so production multi-user ownership depends on a future authentication phase.

## 13. Performance

Summary aggregation has a constant number of database queries independent of question count. It does not load all `CodeRun` rows: only grouped counts, one latest run per question and at most 101 event rows are selected. Full history is lazy and retains PHASE 10's page size/limit. No polling, Session Events, Yjs, Awareness or Worker runtime is needed.

## 14. Tests and final checks

### PASS

- Root `corepack pnpm check`: Prettier, GraphQL Codegen check, lint and typecheck passed.
- Prisma validate and generate passed; no migration was needed.
- Frontend: 21 suites, 167 tests passed.
- API/PostgreSQL: 10 suites, 132 tests passed.
- Production build passed and contains `/interviews/[id]/results`.
- Local Results query returned ISO timestamps for the interview, each latest run and each timeline event; candidate bearer access returned `FORBIDDEN` without Results data.
- `git diff --check` passed after these fixes.

## 15. Manual smoke

**MANUAL BROWSER SMOKE: PASS**

**VISUAL RE-TEST: PASS**

Confirmed manually:

1. Title contains no technical ISO suffix — PASS.
2. Started / Finished timestamps — PASS.
3. Duration — PASS.
4. Run timestamps — PASS.
5. Timeline timestamp order and display — PASS.
6. No `Invalid Date` values — PASS.
7. Run-history pagination visibility — PASS.
8. Skip-link visibility and focus behavior — PASS.
9. Successful run output — PASS.
10. Runtime-error output — PASS.
11. Latest-run details consistency — PASS.
12. Run History consistency — PASS.

The standalone **No output.** browser scenario was not run manually; it is covered by automated frontend tests.

### Findings and changes after initial smoke

- Direct PostgreSQL inspection for `cmutmd98s000b1yv8ounftx6c` showed populated `Interview.startedAt` (`2026-10-04 09:29:29.468`) and `finishedAt` (`2026-10-04 09:29:29.857`), four CodeRuns with distinct persisted `createdAt` values, and persisted `InterviewEvent.createdAt` values. No schema or lifecycle change was needed.
- Root cause: GraphQL had explicit ISO timestamp resolvers for `Interview` and `CodeRun`, but none for the new `InterviewResults`, `InterviewResultsRun` and `InterviewTimelineEvent` types. GraphQL's default `String` serialization converted `Date` objects to numeric millisecond strings such as `1791106169468`; the browser then parsed those as dates and showed `Invalid Date`. Added explicit `toISOString()` field resolvers.
- Duration was already derived from persisted `finishedAt - startedAt` (389 ms for this interview). The UI floored sub-second values to `0 sec`; it now shows the persisted short duration in milliseconds. Missing or invalid duration/timestamps show `—`.
- Every smoke CodeRun's `createdByParticipantId` points to the interviewer participant, whose persisted role/name are `INTERVIEWER` / `Demo Interviewer`. The candidate is `Phase 11 Candidate`. API actor mapping correctly returns each run's linked participant; no actor remapping/filtering was needed. A regression test covers interviewer and candidate runs.
- Run history previously showed timestamps only to the minute and always rendered disabled pagination controls. It now shows local time through milliseconds, and hides pagination when there is no previous or next page; backend pagination is unchanged.
- The duplicate duration KPI was removed; duration remains in the interview metadata block.
- Manual UI review found raw `stdout` / `stderr` labels in latest-run details, persisted Run History and the current Code Runner Output panel. A shared presentation component now labels them **Output** / **Errors** in all three places without renaming backend, GraphQL or Prisma fields.
- Empty stderr is hidden. Empty stdout is hidden when Errors has content. When both are empty, the UI shows one compact **No output.** state. Runtime errors stay under Errors and are not duplicated into Output.
- Skip to content already uses a visually hidden position and becomes visible on keyboard focus (`.skipLink` / `.skipLink:focus`). No accessibility fix was needed.
- The raw title suffix was already part of the persisted title of the local smoke interview; the Results UI displays the title verbatim and does not append a timestamp. Both local smoke interview titles were changed to human-readable labels only.
- `formatDateTime` uses browser-local time for both full summary timestamps and compact detail timestamps. It parses the ISO offset once and does not apply a manual timezone conversion. Summary uses a localized date plus seconds; run history and timeline use compact local time with milliseconds.
- A shared `formatDuration` formats milliseconds, seconds, minutes/seconds, and hours/minutes. The interview duration still derives only from persisted `finishedAt - startedAt`; the smoke value remains 389 ms.
- Manual re-test confirmed the date/time, duration, title, pagination, skip-link and run-output fixes listed above. The standalone no-output state is verified automatically rather than manually.

Completed interviewer demo: `PHASE 11 Results Manual Smoke`, ID `cmutmd98s000b1yv8ounftx6c`; route `http://localhost:3000/interviews/cmutmd98s000b1yv8ounftx6c/results`. It contains two frozen questions and four representative CodeRuns (three for Two Sum; one for Group By), a joined `Phase 11 Candidate`, start/question-change/finish events, and is already `FINISHED`. These demo runs were submitted through the existing `recordCodeRun` mutation as client-reported fixtures; preparation did not execute code in the Worker. The candidate Results query was denied server-side. The local API and web dev servers are running.

No-runs empty-state interview: `PHASE 11 Results Empty-State Smoke`, ID `cmutmbede00001yv84j100ke6`; route `http://localhost:3000/interviews/cmutmbede00001yv84j100ke6/results`.

Candidate denial was verified through the API integration flow, not a second browser context. The separate **No output.** browser scenario was not manually exercised and remains covered by the frontend test suite.

## 16. Limitations

- Results do not assess correctness, solve status, candidate quality or best run.
- `SUCCESS` means only the browser reported a Worker completion without runtime error.
- The timeline only includes event types currently persisted by the application and omits older events beyond its 100-event window.
- Legacy interviews without snapshot columns cannot recover historical reusable question content.
- Offline run results are not queued if PHASE 10 could not persist them.

## 17. Technical debt

- Replace TEMP DEMO AUTH with production interviewer authentication.
- Add an explicit paginated timeline query if interviews can exceed the 100-event display window.
- Decide a retention/deletion policy for source snapshots and output.
- Private notes remain a separate future capability and are not included in Results.

## 18. State when PHASE 11 closed

At PHASE 11 close, private interviewer notes with server-side ownership and authorization remained future work. PHASE 12 is the final polish phase; it does not add private notes or other large product capabilities.
