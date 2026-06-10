# Cockpit (`ui/`)

The local Cockpit-Orchestrator over your geekstackflow projects (ADR 0032): it browses every workspace **and** launches, streams, and governs agent runs. Vue 3 + Vite SPA, served by a zero-dependency Node `http` server.

## Architecture

```
ui/
├── server/
│   ├── read.cjs                 # pure data layer — read-only projections over .tcgstackflow/ files
│   │                            #   (reuses ../../init.js for registry + version parsing; one source of truth)
│   ├── index.cjs                # zero-dep http server: JSON endpoints + serves the built SPA (dist/)
│   ├── run.cjs                  # executor: spawns `claude` headless, continuation loop until IN_REVIEW or 6 iters,
│   │                            #   Status safety-net, Discuss chat, abort
│   ├── run-manager.cjs          # per-project run queue + transient overlay
│   ├── approvals.cjs            # pending-approval registry
│   ├── governance-mcp.cjs       # stdio MCP `approve` tool — the in-run governance gate (ADR 0027)
│   ├── governance-classify.cjs  # risk classification behind the gate
│   ├── session-report.cjs       # session JSONL telemetry, $-cost estimates (PRICING), HTML export
│   └── fixtures/                # test fixtures
├── public/fonts/    # self-hosted fonts for the dark editorial theme
├── src/             # Vue 3 + Vite SPA — App.vue is the entire single-file cockpit/orchestrator UI
├── index.html       # Vite entry
├── vite.config.js   # build → dist/; dev server proxies /api → :4729
└── package.json     # Vue/Vite deps live HERE — the root CLI (init.js) stays zero-dependency
```

The server binds `127.0.0.1` only — single local user, no auth (ADR 0020). It is now the Orchestrator (ADR 0032): run launch/stream/abort, in-run governance approvals, status overrides, and settings writes all live on this same server. The one remaining future write is `upgrade`.

> **Server lib:** ADR 0022 named Hono; we use Node's built-in `http` — zero-dep, even thinner, testable without an install. ADR 0022 explicitly allowed a substitute. The SPA stack (Vue 3 + Vite) is unchanged.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ ok, tool_version, latest_schema }` |
| `GET /api/projects` | registry list, each with `workspace_schema` + `update_available` |
| `GET /api/agents` | cross-project agents overview: queue + tokens + profile per role (drives the Home agent grouping and agent pages) |
| `GET /api/project?path=…` | one project: config, version, action_queue, tasks (+`tokens_total`, +`run_state` overlay), wiki summary |

### Orchestrator endpoints (consumed by the SPA)

| Endpoint | Returns / does |
|---|---|
| `GET /api/project/task?path=…&id=…` | task detail: `details_body` (plan markdown), `timeline[]` (parsed `### ENTRY START` entries: `timestamp, author, summary, files[], why, validation[], tags[]`, optional `governance{}`/`blocker{}`, and `via`/`status_from`/`status_to` for cockpit overrides), `tokens.by_role{role→{input,output,cache_read,cache_creation}}`, `tokens.total{…}`, `tokens.runs[]` (`{run_id, role, session_id, state, tokens}` per durable run record under `runs/{task-id}/` — drives the per-run report/diff/transcript actions) |
| `GET /api/project/task/report?path=…&id=…[&run=…]` | session-report JSON — token/tool/$-cost telemetry aggregated from the task's session JSONLs; `run=` scopes to one run |
| `GET /api/project/task/report.html?path=…&id=…[&run=…]` | standalone HTML export of the session report (one-click "Generate analysis") |
| `GET /api/project/task/run?path=…&id=…&run=…` | one run's frontmatter + transcript (runs/ viewer) |
| `GET /api/project/task/run/diff?path=…&id=…&run=…` | git diff of the project vs the run's `git_base` (recorded at run start); `{git_base: null, note}` when no base was captured |
| `POST /api/project/task/status` | body `{path,id,status}` → rewrites the canonical `Status:` line + auto-appends a `human`/`via:cockpit` log entry (ADR 0032). The **UI does not write the log itself.** |
| `POST /api/project/settings` | body `{path, roles{role→tool}, budget_usd}` → written to `config.yaml` (`orchestrator.roles` + `orchestrator.budget_usd`) |
| `POST /api/run` | body `{project_path,task_id,role}` → enqueue+launch → `{run_id,state}`. `501` if the role maps to `codex` (ADR 0025 — Codex runner deferred); `503` only if the governance gate is explicitly disabled (it is enabled by default — GOV-4) |
| `GET /api/run/stream?run_id=…` | **SSE.** Events: `delta` (text chunk), `tokens` (running `{input,output,cache_read,cache_creation}`, accumulated across continuation iterations), `status` (`started`/`continuing {iter}`/`aborting`/`aborted`/`error`), `approval_request` (pause card: `approval_id,action,risk,why,files[],rollback`), `approval_resolved`, `done` (final `{session_id,tokens,iterations}`) |
| `GET /api/runs` · `GET /api/run?id=…` | `{ runs, governance_ready }` — in-memory runs grouped by project (see `GET /api/runs/history` for durable records) · one run's transient record |
| `GET /api/runs/history` | durable run records across the whole workspace, newest first |
| `POST /api/run/message` | Discuss chat: body `{project_path,session_id,message}` → `{chat_id}` (read-only session resume — subscribe the SSE stream on `chat_id`) |
| `POST /api/run/abort` | body `{run_id}` → kills the live child and finalizes the run as aborted (Stop button) |
| `POST /api/run/approval` | body `{approval_id,decision}` (browser decision resolves a pending approval) |
| `POST /api/run/approval-request` | loopback intake from the governance MCP gate — token-authenticated, long-polls until the browser decides |

**Task/run token counters are raw counts** (ADR 0033); the **Session Report** additionally estimates $-cost from a list-price `PRICING` table (ADR 0034 — cost is scoped to the report), and an optional `orchestrator.budget_usd` (set via `POST /api/project/settings`) powers the Home spend hero. **SSE note:** the Vite dev proxy (`/api → :4729`) streams responses (http-proxy does not buffer), so the live `delta`/`tokens` stream works under `npm run dev`; the production Node server streams natively.

## How a run works

- **Continuation loop:** `POST /api/run` spawns `claude` headless (`run.cjs`). Iteration 0 sends the role prompt; later iterations `--resume` the session with a continue nudge, until the agent advances Status to IN_REVIEW+ or the cap of 6 iterations. Tokens accumulate across iterations.
- **Status safety-net:** on a clean exit where the agent did not advance Status, the server sets IN_REVIEW itself — via the canonical writer (`read.writeTaskStatus`), never a second writer.
- **Governance gate:** `governance-mcp.cjs` exposes a stdio MCP `approve` tool to the agent; HIGH/CRITICAL actions long-poll back to `POST /api/run/approval-request` (token-authenticated, loopback-only) until you decide in the browser. Decisions are recorded in the task log via the canonical writer (GOV-6). `setGovernanceGateReady(false)` is the runtime kill switch.
- **Discuss chat:** `executor.chat()` resumes the session read-only (restricted `allowedTools`, no permission-prompt tool) and returns a `chat_id` to subscribe the SSE on; chats append to the same session JSONL, so the Session Report grows with them.
- **Session Report:** `session-report.cjs` parses `~/.claude/projects/*/<session_id>.jsonl`, aggregates tool/token telemetry, estimates $-cost via `PRICING` (ADR 0034), and renders the standalone HTML export. Also surfaced as the `/tcgflow-session-report` command.
- **Lifecycle:** on boot, the server reconciles orphaned runs across every registered workspace (durable "aborted at pause point" entries, ADR 0027 — RUN-8). On SIGINT/SIGTERM it kills in-flight children and marks their runs aborted (API-9); a killed run does **not** advance its task.

## Run it

**Production (what `geekstackflow ui` does):** serves the built SPA from `dist/`.

```bash
cd ui && npm install && npm run build   # produces dist/
geekstackflow ui                         # or: node server/index.cjs [port]  (or GSF_UI_PORT)
```

**Before the SPA is built**, the server serves a built-in vanilla-JS fallback page — a minimal read-only cockpit (projects, action queue with Copy-prompt, tasks, recent wiki log) — so something works the moment you run it, no `npm install` required. Build the SPA for the full Orchestrator UI (runs, live streams, governance, reports, chat).

**Dev (hot reload):** run the API server and the Vite dev server side by side.

```bash
node server/index.cjs        # API on :4729
npm run dev                  # Vite on :4730, proxies /api → :4729
```

## Data model

Everything rendered is a **projection of files that already exist** in `.tcgstackflow/` — no database (ADR 0024). The action queue is computed from task status via the status→next-agent map in `read.cjs` (`PLANNED→coder`, `IN_REVIEW→reviewer`, `VALIDATED→ingester`, …). Each run also leaves a **durable record** at `runs/{task-id}/{run-id}.md` with frontmatter `{task, role, session_id, tokens{input,output,cache_read,cache_creation}, state, ended_at, git_base?}` — the persistence layer behind `/api/runs/history`, the transcript viewer, and the per-run diff. The Orchestrator runs tasks directly via `POST /api/run` (ADR 0032); the pre-build fallback page still offers a "Copy prompt" button as a manual escape hatch.
