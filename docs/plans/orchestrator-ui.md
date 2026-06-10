# ORCH-cockpit-runner — Orchestrator UI build plan

**Status:** PLANNED
**Owner:** —
**Provenance:** `/grill-with-docs` design session → locked in `CONTEXT.md` (Cockpit / Run / Run tokens / Status override / Orchestrator) + **ADR 0032** (Cockpit becomes Orchestrator, read-only retired) + **ADR 0033** (Run-token capture & per-Run storage). Binding execution-model ADRs: **0024** (run-state in files, no DB), **0025** (execution model + per-role tool map), **0026** (sequential-within-project concurrency), **0027** (in-run pause-and-approve governance), **0023** (cockpit panels), **0021** (workspace_schema + additive upgrade), **0008** (risk levels), **0004** (two-file rule).

> This plan was produced by a fan-out workflow (6 subsystem designers → synthesis → adversarial completeness critic). The critic found 5 high-severity blockers and ~20 open questions; **all are resolved below** before any code. This doc lives under `docs/` (not the `.tcgstackflow/` two-file task structure) because this repo is the geekstackflow *tool source* and has no dogfooded workspace — see the design session.

---

## 0. Build progress

| Phase | Status | Notes |
|---|---|---|
| **0 — Prereqs** | ✅ done | TEST-0 (`npm test`), API-0 (real fixture, field names locked + `--include-partial-messages` finding) |
| **1 — `runs/` schema 4** | ✅ done | SCHEMA-1..6; fresh-init/upgrade converge on schema 4; idempotent migration; verified |
| **2 — Server data layer** | ✅ done | SRV-1..9; canonical writer + task-detail/status endpoints; 13 unit tests + HTTP smoke (all error paths) |
| **3 — Run manager** | ✅ core done | RUN-1/2/3/4/6/7 (`run-manager.cjs` + 8 tests). RUN-5/RUN-8 landed in Phase 4 |
| **4 — Executor** | ✅ done | API-1..9 + RUN-5 + RUN-8 (`run.cjs` + executor tests + HTTP smoke). Spawn→parse→flush verified against the **real** fixture; runs gated behind `governanceGateReady` (API-8) until Phase 5 |
| **5 — Governance gate** | ✅ done | GOV-1..6. Classifier (fail-safe), approvals registry + loopback intake, **zero-dep stdio MCP `approve` server**, gate wired into the spawn (`governanceGateReady` now true → runs ENABLED), GOV-6 records decisions via the canonical writer. Full pause-and-approve loop tested end-to-end (approve + deny) over real stdio+HTTP |
| **6 — Vue UI** | ✅ done | UI-0..6 — detail panel (plan + log timeline), per-role/per-task token views, Status override dropdown, live Run button + SSE stream + live token counter, governance approve/deny modal (CRITICAL needs rollback ack). SPA builds clean (83 KB) and is served from `dist/`; bundle contains the governance UI |

**Status: BUILD COMPLETE.** All 7 phases done. **50 tests across 9 files** + HTTP smokes, all green; the SPA builds and is served.

**Added after Phase 6 — Session Report (ADR 0034):** a per-task token/cost telemetry view in the editorial `session_report.html` style. `session-report.cjs` locates each Run's **Claude Code session JSONL** by `session_id`, parses per-turn `usage` + `tool_use` + timestamps, aggregates across the task's Runs, and prices it (per-model list table — **adds $-cost, amending ADR 0033's raw-tokens-only**, scoped to this report). `GET /api/project/task/report` feeds a dark editorial Cockpit page (hero + metrics, token cards, cost waterfall, tool-calls-by-type, per-turn cache-read trace) reached via "Session report ↗" on the task detail; a "Generate analysis ↗" button copies a prompt to author the full editorial HTML (narrative + recommendations) in the user's AI tool. Verified live: INX/MIGRATE-GSF → 51 turns, 25 tool calls, ~$12.96, 3.44M tokens processed. Verified against reality (the captured `claude` stream-json fixture + the real MCP child driving the full approve/deny loop). Nothing committed yet (per "commit later").

**Deferred / not done (deliberate):**
- The **vanilla-JS fallback** page (`FALLBACK_HTML` in `index.cjs`) was *not* extended with the run/governance UI — the built Vue SPA is the deliverable; the fallback stays a read-only degraded view that points you to build the SPA.
- **No real-agent run was launched** end-to-end (cost/safety). The executor's spawn→parse→flush is proven against the captured fixture; the governance loop is proven with the real MCP child + a harness intake. A live `claude` run + the optional GOV-4 real-CLI smoke are the natural first manual verification.
- **Codex runner** remains a 501 stub (ADR 0025 defers it; D9).

**Post-restyle additions:** standalone HTML report export (`GET /api/project/task/report.html` + `renderReportHtml`) wired to a one-click "Open report ↗"; the `tcgflow-session-report` command for the AI-authored editorial version; a runs/transcript viewer (`GET /api/project/task/run` + `readRunTranscript` + a modal); agent-filtering the task table; per-project + Home agent cards; dark `FALLBACK_HTML`.

**First real orchestrated run (2026-06-10, DEMO-1 in a throwaway workspace):** the full pipeline ran end-to-end against a live `claude` — spawn → stream-json → tokens captured (in 7.6k / out 3.7k / cache-read 318k / cache-write 26k) → `runs/` record written → **D1 Status safety-net fired** (PLANNED→IN_REVIEW) → transcript persisted → Session Report populated (23 turns, 13 tool calls, ~$3.77). **Honest gaps surfaced:** the agent *recognized* the HIGH governance rule ("I must pause for a permission request before creating HELLO.md") but the single `claude -p` turn-set **ended after setup, before the gated write** — so HELLO.md was never created and **the governance pause never fired (0 approvals)**. Finding: headless single-invocation runs may not complete multi-step tasks, and the gate only triggers if the agent reaches the gated action. A continuation (`--continue`) or interactive run would be needed to drive completion + the pause.

**Phase-4 notes:** D1 honored — the agent owns `TASK {ID}.md` writes; the server writes only the `runs/` record + a Status safety-net (fires only if a clean run left Status un-advanced; verified). D2 — one launch door `POST /api/run`. API-9 — SIGINT/SIGTERM kills children + marks runs aborted. The live `POST /api/run` returns **503 until Phase 5** wires the gate; the executor mechanics are proven now via the injected fake-`claude`.

## 1. Overview

Turn the **read-only Cockpit** into the **Orchestrator**: the local Node server launches `claude` headlessly against a task, streams progress to the browser over SSE, captures token usage, writes a per-Run record to a new `runs/` area, and the Cockpit gains a rich task-detail panel (plan + implementation-log timeline + per-role/per-task token breakdown), a manual Status override, a live Run button, and an in-run governance approve/deny modal.

The one invariant that survives the read-only reversal (ADR 0032): **files are the single source of truth — no second store.** Every write targets a canonical task file or the new `runs/` area; never a database.

### Hard ordering constraints
1. **`runs/` schema-4 foundation lands first** — every downstream writer/reader needs the on-disk area, and fresh-init + upgrade must converge on schema 4.
2. **Server read+write data layer and the run-manager land before** the executor that spawns `claude` and before the UI that consumes endpoints.
3. **The governance gate is wired before any HIGH/CRITICAL orchestrated run is enabled — enforced in code, not just prose** (see API-8).

### Canonical owners (no duplicate writers/locks)
| Concern | Single owner | Reused by |
|---|---|---|
| Task-file write (Status rewrite + `### ENTRY START` append) | `SRV-7` `appendLogEntry` / `writeTaskStatus` in `read.cjs` | API-7, GOV-6, RUN-8 |
| Per-project run lock + queue | `run-manager.cjs` active-slot (RUN-2/RUN-3) | executor via injected `launch(run)` (RUN-6) |
| JSON request-body parsing | `SRV-6` `readJsonBody` in `index.cjs` | SRV-8, RUN-5/API-6 |
| Run prompt string | `API-1` `buildRunPrompt` in `run.cjs` | Copy-prompt (App.vue) + executor |
| SSE channel keyed by `run_id` | `API-6` | GOV-2, UI-5, UI-6 |

---

## 2. Resolved decisions (the critic's open questions, decided)

These were ambiguous in the raw synthesis; resolved here so the build is unblocked. Each is grounded in a binding ADR.

| # | Question | **Decision** | Rationale |
|---|---|---|---|
| D1 | **Writer authority** — agent vs server writes `TASK {ID}.md`? | **Agent owns all `TASK {ID}.md` writes** (it runs `coder.md`: self-logs + sets `IN_REVIEW`). Server owns **only** the `runs/` transcript+tokens (API-5) and a **Status safety-net** (API-7) that fires *only if* a clean-exit agent left status un-advanced. **No double write.** | ADR 0024: "an orchestrated run is an automated coder writing the same entry." Eliminates the file race. |
| D2 | **Endpoint route naming** — enqueue vs start redundancy | **One run-launch door: `POST /api/run` `{project_path, task_id, role}`** (enqueues; promotes to running immediately if the project slot is free; returns `{run_id, state}`). Drop `/api/run/start`. Reads: `GET /api/runs`, `GET /api/run?id=`, `GET /api/run/stream?run_id=`. Writes: `POST /api/run/approval`, `POST /api/project/task/status`. Read: `GET /api/project/task?path=&id=`. | Removes the two-doors-to-one-room hazard; matches the zero-router path-switch server. Pinned in UI-0 as a Phase-1 contract. |
| D3 | **`run_id` vs `session_id` as transcript filename** | **Server-generated `run_id` names the file** (`runs/{task-id}/{run-id}.md`); `session_id` lives in frontmatter. | `run_id` is needed up front (to return from `POST /api/run` and key the in-memory record) before any stream event arrives. **Refines ADR 0033's** "session_id names the transcript." |
| D4 | **End-marker frontmatter field** (crash discriminator) | Add **`state: running \| done \| failed \| aborted`** (+ `ended_at` ISO ts) as **Orchestrator-written** fields beyond ADR-0033's human keys. Ratified in SCHEMA-1's README; written by API-5; read by RUN-7. | ADR 0033 fixed only `task/role/session_id/tokens`; the orphan-scan needs a terminal marker. Documented as a refinement, one definition. |
| D5 | **Cockpit-override YAML keys** | **`via: cockpit`, `status_from: <old>`, `status_to: <new>`** — ratified by extending `update-task-log/SKILL.md` (SCHEMA-6) as documented optional fields, so manual + cockpit writers agree. | ADR 0032 fixed semantics, not keys; the skill template is the single schema source. |
| D6 | **Two `Status:` lines** (`TASK {ID}.md` vs `TASK details {ID}.md`) | **`TASK {ID}.md` is canonical** for cockpit read/write (read.cjs already prefers it). The details-file Status may diverge (accepted). | Avoids picking the wrong file; matches existing `readTask` precedence. |
| D7 | **De-dup on launch** | **Always queue**; the UI **disables the Run button** when the task already has an active/queued run (RUN-4 overlay). No 409. | Single-user MVP; prevents accidental double-launch at the UX layer. |
| D8 | **Cross-project concurrency cap** | **No machine-wide cap** (per-project = 1 only); comment marks a global cap as a deferred MVP simplification. | ADR 0026 caps per-project, silent on global; defer. |
| D9 | **Codex policy-layer parity** | **Explicit ADR-0027 deviation:** Codex is sandbox-only (`--sandbox workspace-write`), no approval bridge yet. Moot now — `API-2` returns **501** for any role mapped to codex. | ADR 0025/0033 defer Codex behind Claude; record the deviation. |
| D10 | **Loopback control transport** | **HTTP long-poll on `127.0.0.1`** with the MCP child's socket timeout disabled; Unix-domain-socket noted as a later refinement. | Zero-dep, controllable on loopback. |
| D11 | **`Last updated:` date format** | **User's local date** for the `Last updated:` line (matches human Coders); entry `timestamp` stays **ISO-8601 UTC**. | Consistency with existing convention. |
| D12 | **UI run-launch role + tool** | Run button defaults to the task's computed `next_agent`, with an **optional role override** selector. **Claude-only** this slice (Codex option disabled-with-tooltip). | Sensible default; Codex runner deferred. |
| D13 | **Fresh-init `runs/` structure** | **README-only**; the executor creates `runs/{task-id}/` on demand (API-5). | No empty per-task dirs to track. |
| D14 | **Dev Vite proxy SSE** | UI-5 verifies/configures the `/api → :4729` proxy to **not buffer SSE**; explicit proxy config added if needed. | Live stream must flush under `npm run dev`. |

### New subtasks added to close critic blockers
- **TEST-0** — there is *no test runner today*; wire `node --test` so every `.test.cjs` AC is actually runnable. (Blocker #2)
- **API-0** — capture & commit a *real* `claude -p … --output-format stream-json --verbose` fixture; pin `usage` + `session_id` shapes. (Blocker #5 — single highest-leverage de-risk for the token feature)
- **SCHEMA-5** — scaffold + migrate the `orchestrator.roles` config block (ADR 0025's cost-spreading map). Without it `API-2` always defaults to claude and the feature is unconfigurable. (Blocker #1)
- **SCHEMA-6** — ratify the cockpit-override keys in `update-task-log/SKILL.md`. (Gap #5)
- **API-8** — **code-level** governance-readiness guard: the executor refuses a run whose `governance.md` would classify any action HIGH/CRITICAL until the gate (GOV-4) flips `governanceGateReady = true`. (Ordering blocker)
- **RUN-8** — startup reconcile-write: append a durable "run aborted at pause point" `### ENTRY START` (via SRV-7) for orphaned runs, satisfying ADR 0027 line 27. (Blocker #3)

---

## 3. Build phases & subtasks

Sizes: **S** ≈ <½ day, **M** ≈ ½–1 day, **L** ≈ 1–2 days. Acceptance criteria are condensed to the checkable essentials.

### Phase 0 — Prerequisites (de-risk + harness)

**TEST-0 · S** — Test runner. *Files:* `package.json`.
- `"test": "node --test ui/server/**/*.test.cjs"` added (Node built-in, **zero new deps**). `npm test` runs and passes (0 tests OK initially).
- `smoke` script unchanged; CI/smoke note added to run `npm test`.

**API-0 · S** (prereq for API-4) — **✅ DONE.** Captured a real `claude -p … --output-format stream-json --verbose` run from claude **2.1.169** → `ui/server/fixtures/claude-stream.ndjson` (sanitized; provenance in `ui/server/fixtures/README.md`).
- **Confirmed against reality:** event sequence `system → assistant → rate_limit_event → result`; `session_id` first on the **`system`** event; `usage` on the **`result`** event with the exact ADR-0033 names (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`); `total_cost_usd` present (ignored).
- **⚠ Finding (shapes API-3/API-4):** *without* `--include-partial-messages` the reply arrives as **one whole `assistant` event — no `text_delta`s**. Token capture needs only `result`; **live delta streaming (UI-5) requires `--include-partial-messages`** + a second fixture captured with that flag.

### Phase 1 — `runs/` schema foundation (additive schema 3→4)

**SCHEMA-1 · S** — `runs/` README + frontmatter contract. *Files:* `templates/workspace/.tcgstackflow/runs/README.md`.
- Non-empty (git-trackable) README; states `runs/` is a top-level area sibling to `tasks/`/`wiki/`/`raw/`; record path `runs/{task-id}/{run-id}.md`.
- Documents the **full** run-record frontmatter: ADR-0033 keys `task`, `role` (enum: planner|coder|reviewer|tester|ingester|refactorer), `session_id`, `tokens.{input,output,cache_read,cache_creation}` **plus** the D4 Orchestrator fields `state` + `ended_at`, **plus** the D3 note "`run_id` names the file; `session_id` is recorded here."
- Notes transcript body = Raw source; `runs/` may be git-ignored per-project (does *not* add it to `.gitignore` by default).

**SCHEMA-2 · S** — Bump `LATEST_SCHEMA` 3→4. *Files:* `init.js`.
- `const LATEST_SCHEMA = 4;`; schema-history comment gains `// schema 4 = runs/ area + orchestrator.roles map (ADR 0024/0025/0032/0033)`.
- `require('./init.js').LATEST_SCHEMA === 4`; `npm run smoke` passes.

**SCHEMA-3 · M** (dep SCHEMA-1, SCHEMA-2) — Idempotent 3→4 migration. *Files:* `init.js`.
- Replace the line-~319 `// Future: {from:3,to:4…}` placeholder with a real `MIGRATIONS` entry that `mkdir -p`s `runs/` and writes `runs/README.md` **only if absent** (sourced from the template, mirroring the wiki_search 2→3 migration).
- Idempotent (returns change count; 0 on re-run); a pre-existing `runs/ES-1/abc.md` is **byte-identical** after re-run. `MIGRATIONS.some(m=>m.to===4)` is true. Test under `npm test`.

**SCHEMA-4 · S** (dep SCHEMA-2) — Template config stamp 2→4. *Files:* `templates/workspace/.tcgstackflow/config.yaml`.
- `workspace_schema: 4` with updated comment. Fresh `node init.js <tmp>` stamps 4 and scaffolds `runs/README.md`; immediate `upgrade` of it applies **0** migrations (fresh-init and upgrade converge — closes the prior 2-vs-3 stamp gap).

**SCHEMA-5 · M** (dep SCHEMA-2, SCHEMA-3) — `orchestrator.roles` config block. *Files:* `templates/workspace/.tcgstackflow/config.yaml`, `init.js`.
- Template `config.yaml` gains an `orchestrator:` block with a `roles:` map defaulting **all six roles to `claude`**.
- The 3→4 migration additively inserts the block into existing `config.yaml` **only when absent** (mirrors wiki_search migration). Test: a config lacking the block gains it on upgrade; one already having it is untouched.

**SCHEMA-6 · S** — Ratify cockpit-override keys. *Files:* `templates/workspace/.tcgstackflow/skills/update-task-log/SKILL.md`.
- Document `via`, `status_from`, `status_to` as **optional** fields (used by cockpit Status overrides; `author: human`, `via: cockpit`). SRV-3/SRV-7/UI reference this as the schema source.

### Phase 2 — Server read+write data layer (`ui/server/read.cjs`, `index.cjs`)

**SRV-1 · S** — `findTaskFolder(workspaceDir, id)` → `{bucket, folder}` across active/completed/archive (incl. archive category subfolders); `null` for unknown, never throws.

**SRV-2 · M** (dep SCHEMA-1) — `parseFrontmatter` + `readRunsForTask`. Walk `runs/{id}/*.md`, parse token frontmatter → `{ total, by_role, runs[] }` (ADR-0033 field names). Absent `runs/` → all-zero, no error (forward-compat). A run missing `role` → grouped under `unknown`, still counted. Fixture-tested.

**SRV-3 · M** — `parseTaskLogTimeline(text)`. Line-based parse (no YAML dep) splitting on `### ENTRY START`, bounded by next marker or EOF; ignores the italic placeholder; returns ordered `{timestamp, author, summary, files[], why, validation[], tags[], governance?, blocker?, via?, status_from?, status_to?, raw}`. `[]` for placeholder-only files. Fixture test incl. one normal + one cockpit-override entry. *(First real programmatic parser — the generate-timesheet "shared logic" lives in a skill prompt, not code.)*

**SRV-4 · S** (dep SRV-1,2,3) — `buildTaskDetail(projectPath, id)` → `{id, bucket, status, next_agent, title, details_body, timeline, tokens}`; `{error:'task-not-found'}` / `{error:'not-a-workspace'}` shapes; exported.

**SRV-5 · S** (dep SRV-2) — Attach `tokens_total` to each `buildProjectDetail` task (purely additive; queue/Jira logic unchanged).

**SRV-6 · S** — `readJsonBody(req)` — zero-dep, 64 KB cap, 400 on oversize/malformed (no crash). The single shared body parser.

**SRV-7 · L** (dep SRV-1) — **Canonical task-file writer.** `writeTaskStatus(projectPath, id, newStatus, opts)` + lower-level `appendLogEntry(folder, id, fields)`.
- Rewrites **only** the first `^Status:` line in `TASK {ID}.md`; every other byte identical.
- Appends one `### ENTRY START` with `author: human`, `via: cockpit`, `status_from`/`status_to` (SCHEMA-6 keys); bumps `Last updated:` (local date, D11).
- Captures old status before rewrite; inserts a Status line if missing (no silent loss). **Free-form** — any non-empty status, no transition gating (ADR 0032). **Surfaces errors** (not best-effort) — caller maps to 4xx/5xx. Header comment rescopes "never throws" to the read projections only.
- *This is the only task-file writer in the server.* Fixture-tested for byte-safety.

**SRV-8 · M** (dep SRV-6,7) — `POST /api/project/task/status` `{path,id,status}` → 200 refreshed task; 400/404/405/500 mapped explicitly. `127.0.0.1` only; listed in startup log.

**SRV-9 · S** (dep SRV-4) — `GET /api/project/task?path=&id=` → `buildTaskDetail` JSON; 400 on missing params; routed before the `/api/` 404.

### Phase 3 — Run manager / concurrency (`ui/server/run-manager.cjs`)

**RUN-1 · S** — Run lifecycle. Five transient states (`queued/running/paused/failed/done`); pure transition fn rejects illegal transitions; in-memory record `{run_id, project_path, task_id, role, state, created_at, started_at?, ended_at?, last_error?}`. `run_id` generated locally (distinct from `session_id`). Zero-dep.

**RUN-2 · M** (dep RUN-1) — Registry: `Map` keyed by resolved `project_path`, each `{active, waiting[]}`. `enqueue` promotes immediately if slot free else FIFO-queues. `complete/fail` clears slot and promotes the head. Tests: two same-project → 1 running/1 queued; two different-project → both running (ADR 0026). *(Absorbs the server-core LOCK-1.)*

**RUN-3 · S** (dep RUN-2) — Lock = the active slot (no lockfile). `tryAcquire/release/isProjectBusy`. Comment: two server processes would each hold an independent lock; mitigated by the fixed-port bind (4729).

**RUN-4 · M** (dep RUN-2) — Overlay transient state onto the file-derived queue. `buildProjectDetail` takes an **optional** `overlay` param (default `{}` → byte-identical to current output; regression-tested) and annotates `run_state` without overwriting durable status. read.cjs never imports run-manager (injection only).

**RUN-6 · S** (dep RUN-2) — Launcher seam: `createRunManager({launch})` calls injected `launch(run)` once on `queued→running`; default no-op stub for tests; exposes `complete/fail/abort` callbacks. run-manager never imports `child_process`.

**RUN-7 · M** (dep RUN-1, SCHEMA-1) — Crash reconcile (read side). Registry empty on start. `scanOrphanedRuns` reads `runs/{id}/*.md` best-effort; classifies terminal (has `state`/`ended_at`, D4) vs half-written (no marker → orphaned), surfaced as `run_state:'aborted'`; never auto-deletes (transcripts immutable). Fixture test. No-`runs/` → `[]`.

**RUN-8 · S** (dep RUN-7, SRV-7) — Crash reconcile (durable write). On startup, for each orphaned run, append a `### ENTRY START` "run aborted at pause point" entry to `TASK {ID}.md` **via SRV-7** (author `orchestrator`, the run's last-known point), satisfying **ADR 0027 line 27**. Idempotent (don't re-append for an already-recorded abort). *(Closes critic blocker #3.)*

**RUN-5 · M** (dep RUN-2,3,4,6, SRV-6) — Run endpoints (the D2 canonical set). `POST /api/run` `{project_path, task_id, role}` validates (registered workspace; role in enum) → enqueue → `{run_id, state}`. `GET /api/runs` grouped by project (Home). `GET /api/run?id=` one record (404 unknown). `GET /api/project?path=` now passes `overlayFor(path)` into `buildProjectDetail`. Body via `readJsonBody`. Update the "read-only today" header/README (sanctioned by ADR 0032).

### Phase 4 — Orchestrator executor (`ui/server/run.cjs`, `index.cjs`)

**API-1 · S** — `buildRunPrompt(taskId, agent)` — byte-identical to the App.vue/index.cjs copy-prompt string; asserted equal. Single source for orchestrated prompt + clipboard.

**API-2 · S** — `readRoleTool(workspaceDir, role)` parses `orchestrator.roles` (SCHEMA-5) with the read.cjs regex style. Returns `claude` when absent/unmapped (ADR 0025 default); a role mapped to `codex` → **501** `{error:'runner-not-implemented'}`; unknown role → 400. Test: all six default roles → `claude`; `coder→codex` mapping → 501.

**API-3 · M** (dep API-1,2, RUN-2) — Spawn. `child_process.spawn('claude', ['-p', prompt, '--output-format','stream-json','--verbose','--include-partial-messages'], {cwd: projectPath, env})` — **argv array, never `shell:true`**. (`--include-partial-messages` is required for the `text_delta` events UI-5 streams — confirmed by API-0; drop it only if a run needs tokens-but-no-live-output.) cwd = project working tree (never `.tcgstackflow`). ENOENT (no `claude` on PATH) → `fail()` `{error:'runner-spawn-failed'}`, server stays up. Child tracked on the run record for API-9 kill. **Verification incl. a missing-CLI run.**

**API-4 · M** (dep API-3, **API-0 ✅**) — Line-buffered NDJSON parser with carry buffer; non-JSON lines ignored. `text_delta` → transcript buffer + SSE `delta`; whole `assistant` events (no-partial-messages mode) → transcript too. `session_id` captured from first event carrying it (the `system` event). Final `result.usage` → `run.tokens` (ADR-0033 names; `cache_read`/`cache_creation` default 0). `total_cost_usd` ignored. **Test against the committed `ui/server/fixtures/claude-stream.ndjson`** — field names are now locked to the real 2.1.169 shape.

**API-5 · M** (dep API-4, SCHEMA-1, RUN-7) — On exit 0, write `runs/{task-id}/{run-id}.md` (mkdir recursive). Frontmatter = ADR-0033 keys + D4 `state: done` + `ended_at` + `session_id` (empty if never seen — degrade, don't drop). Transcript written once (immutable Raw).

**API-7 · M** (dep API-5, SRV-7) — **Reconciliation / Status safety-net (D1).** The agent owns `TASK {ID}.md` writes; the server does **not** append a distilled entry. On **clean exit**: if the agent did **not** advance status, the server bumps Status to `IN_REVIEW` + a one-line "orchestrated run completed" note **via SRV-7** (idempotent against a status the agent already set). On **non-zero exit / abort**: no Status change, no advancing entry; run marked `failed` (partial transcript still flushed). Two-file rule preserved.

**API-6 · M** (dep API-7, API-4, RUN-6, SRV-6) — Wire the launcher + streaming. Register `run.cjs` as the run-manager's `launch(run)` (replaces the RUN-6 stub). `POST /api/run` (D2) spawns on promotion. `GET /api/run/stream?run_id=` → `text/event-stream`, replays buffered deltas then live `delta`/`status`/`done`; client disconnect unsubscribes without killing the run. `GET /api/run?id=` returns state+tokens. `/api/health|projects|project` unchanged; `127.0.0.1` only.

**API-8 · S** (dep API-6, API-2) — **Governance-readiness guard (code-level ordering enforcement).** A module flag `governanceGateReady` defaults **false**. On `POST /api/run`, classify the task's prospective actions (via GOV-1 once it exists; until then, **refuse any run** whose `governance.md` is non-trivial / treat as not-ready) — if any would be HIGH/CRITICAL and `!governanceGateReady`, return **423/409** `{error:'governance-gate-not-ready'}`. GOV-4 flips the flag true once the gate is wired. *(Closes the "ungated HIGH/CRITICAL run between Phase 4 and 5" hole — enforced in code, not prose.)*

**API-9 · S** (dep API-6) — Abort. SIGINT/SIGTERM kills tracked children → `abort()` (ADR 0027 "server stop = aborted"). Aborted run does **not** advance the task; partial transcript flushed for forensics; per-project lock released (RUN-3). Verification actually signals a running server.

### Phase 5 — In-run governance gate — *flips `governanceGateReady` true*

**GOV-1 · M** — `classify(tool_name, input, projectRules) → LOW|MEDIUM|HIGH|CRITICAL`. Pure, zero-dep, **fail-safe: unknown → HIGH**. Built-in table matches `governance.md` taxonomy (read→LOW, edit/test→MEDIUM, push/install/rm→HIGH, force-push/reset/secrets/CI→CRITICAL). Project rules can **raise** (never lower) a level. Compound commands take the **max** segment. Unit-tested per level + auth/** escalation + compound-max + unknown→HIGH. *Files:* `governance-classify.cjs` + `.test.cjs`.

**GOV-2 · M** (dep GOV-1, API-6) — Approval registry + loopback intake. In-memory pending `{approval_id, run_id, action, risk, why, files, rollback, status, resolve}` (no file/DB). `POST /api/run/approval` `{run_id, approval_id, decision}` (browser) resolves; 404 unknown. Internal `POST /api/run/approval-request` (MCP child) registers + **holds open (long-poll, no timeout)** until resolved; per-run opaque token (env) → 403 on mismatch. Emits `approval_request`/`approval_resolved` on the run's SSE channel. Unit-tested register/resolve/double-resolve. *Files:* `approvals.cjs`, `index.cjs`.

**GOV-3 · L** (dep GOV-1, GOV-2) — Zero-dep stdio MCP permission server exposing tool `approve`. Implements `initialize`/`tools/list`/`tools/call` over stdin/stdout JSON-RPC (Node core). On call: classify; LOW/MEDIUM → immediate allow; HIGH/CRITICAL → POST intake (GOV-2) and **block** until decision. Result is the **confirmed Claude permission contract**: `{"behavior":"allow","updatedInput":…}` or `{"behavior":"deny","message":"<action> deferred to human"}`. **Fail closed** on any classifier/transport error. Tool name `mcp__tcgflow_governance__approve`. Piped test incl. fail-closed. *Files:* `governance-mcp.cjs` + `.test.cjs`.

**GOV-4 · M** (dep GOV-3, API-3) — Wire the gate into `run.cjs` spawn. Add `--mcp-config <generated govcfg>`, `--permission-prompt-tool mcp__tcgflow_governance__approve`, keep `--output-format stream-json --verbose` (token flags unbroken). MCP child env: `GSF_WORKSPACE_DIR`, `GSF_CONTROL_URL`, `GSF_RUN_ID`, `GSF_RUN_TOKEN`. **Sandbox backstop:** `--allowedTools` = LOW/MEDIUM ceiling, permission mode `default` (**never** `bypassPermissions`/`dontAsk`). Codex adapter → `--sandbox workspace-write` (D9, deferred). govcfg written to a temp location, cleaned on run end. **Flips `governanceGateReady = true` (API-8).** Optional slow integration smoke: a LOW `claude -p` run proceeds without an approval event and still emits `result.usage`+`session_id`.

**GOV-6 · S** (dep GOV-2, SRV-7, API-7) — Record the decision in the task-log `governance:` block **via SRV-7** (same shape as the manual flow; ADR 0027/0008): `action, risk, decision (approved|deferred), via: cockpit`. A DENY records "`{action} deferred to human`" and the run continues. **No write for LOW/MEDIUM** auto-proceeds. Single writer (SRV-7) — no race with the agent (the agent does not self-log server-mediated approvals).

### Phase 6 — Vue SPA Orchestrator UI (`ui/src/App.vue`, `style.css`)

**UI-0 · S** — Endpoint contract doc in `ui/README.md` using the **D2 canonical paths**: documents task-detail read shape (plan, log[], tokens.by_role/total, runs[]), SSE event names (`delta`, `tokens`, `approval_request`, `status`, `approval_resolved`, `done` carrying authoritative usage+session_id), the Status-override POST body `{path,id,status}` (server auto-logs, UI does not), and **raw tokens only** (no $/cross-project).

**UI-1 · M** (dep UI-0, SRV-9) — `selectedTask` state + click-to-open inline detail panel; `openTask` fetches `GET /api/project/task`; close/nav clears it; existing Home/per-project/loading views unregressed.

**UI-2 · M** (dep UI-1) — Render plan body + log timeline (newest-first): author chip, summary, why, files as code chips, validation list; `governance{}` → distinct marker; `blocker{}` → reason+needs; only schema fields (incl. D5 keys); graceful degrade on malformed.

**UI-3 · M** (dep UI-1) — Token panel: per-role rows (`by_role`) with input/output/cache_read/cache_creation, `.agent-{role}` colors; bold per-task total; `toLocaleString` + tabular-nums; **no `$`/cost/cross-project** (grep-verified); empty → note that only orchestrated Runs contribute tokens.

**UI-4 · M** (dep UI-1, SRV-8) — Status override `<select>` (canonical set, current preselected); change → `POST /api/project/task/status`; on success re-fetch detail (badge + auto-log entry appear); on error inline message + revert; **free-form** (any option from any state).

**UI-5 · L** (dep UI-1, UI-3, UI-0, API-6) — Run button → `POST /api/run` `{path,id,role}` (D12 default next_agent + override) → open `EventSource` on `/api/run/stream`. Run state machine (idle/running/paused/done/error); `delta` → scrollable monospace pane; `tokens` → live counter; `done` → record session_id+usage, close stream, re-fetch detail (durable breakdown refreshes). EventSource torn down on close/nav/error. **D14:** note dev proxy must not buffer SSE.

**UI-6 · M** (dep UI-5, GOV-2) — Governance modal on `approval_request`: shows ADR-0027 recipe (Action/Risk/Why/Files/Rollback/Approve·Deny) → `POST /api/run/approval`; pending until `approval_resolved`. Deny = non-fatal (run continues, "deferred to human"). **CRITICAL** requires acknowledging the rollback line before Approve enables (ADR 0008). The zero-dep `FALLBACK_HTML` in `index.cjs` gains a minimal approve/deny affordance. On SSE reconnect mid-pause, re-fetch outstanding approvals.

---

## 4. Verification strategy

- **Unit (`npm test`, Node `node --test`, zero-dep):** RUN-1/2/3/4/6/7, SRV-2/3/4/7, API-2/4, GOV-1/2/3, SCHEMA-3/5 migrations. All `.test.cjs` co-located under `ui/server/`.
- **Fixture-pinned:** the token parser (API-4) against the **real captured** stream-json (API-0); the task-log parser/writer (SRV-3/7) against TASK-file fixtures incl. placeholder-only and cockpit-override.
- **Regression guards:** `buildProjectDetail` with empty overlay is byte-identical to today (RUN-4); SRV-7 changes only the Status line + appended entry.
- **Integration smoke (slow/optional if `claude` absent):** GOV-4 gated run proceeds for LOW, token capture unbroken; API-9 abort on signal; missing-CLI ENOENT path (API-3).
- **Manual app verification:** launch the Cockpit, open a task, run the coder role on a trivial task, watch deltas + live token counter, see the durable breakdown after `done`, exercise a HIGH action → approve/deny.

## 5. Top risks (residual, after resolutions)
- **Stream-json shape drift** — pinned by the API-0 fixture; re-capture if the `claude` version changes.
- **Hand-rolled MCP stdio** (GOV-3) — only 3 methods implemented; pin to documented JSON-RPC line framing.
- **Two server instances** double-running a project — mitigated only by fixed-port bind; documented, not enforced.
- **Long-poll idle timeouts** (GOV-2/3) — MCP child must disable its socket timeout; UDS is the fallback.
- **Distillation heuristics** — avoided: the agent self-logs (D1); the server doesn't summarize a free-form transcript.

## 6. Recommended ADR follow-ups (small, post-build or alongside)
- **Amend ADR 0033** with D3 (`run_id` names the file; `session_id` in frontmatter) + D4 (Orchestrator-written `state`/`ended_at` beyond the human keys).
- **Note on ADR 0027** recording the D9 Codex deviation (sandbox-only until a Codex approval bridge).
- These are one-line refinements, not new decisions — capture them when the build confirms the shapes.

## 7. Defaults chosen without asking (all reversible)
D7 always-queue + UI-disables-duplicate · D8 no cross-project cap · D10 HTTP long-poll loopback · D11 local date for `Last updated:` · D12 Claude-only this slice. Flag any you'd change before Phase 3/4/6 respectively.

---
*Generated from a fan-out plan workflow (6 designers → synthesis → completeness critic, ~713k tokens). Next: `/tcgflow-code` per phase, or build Phase 0→1 first to land the schema + harness.*
