# Plan — per-run git isolation (`in-place | branch | worktree`)

Implements ADR 0040. Ships `in-place | branch` now; `worktree` is designed here but deferred behind the workspace-root seam (§Worktree follow-up).

## Goal

Let an orchestrated run (Cockpit → subprocess) run on a **task branch** instead of always mutating the current branch in place, configurable per-project and per-run, with a "already on the right branch → just continue" short-circuit. No automatic merge-back.

## Decisions (locked)

- **D1 — Modes.** `in-place` (default, = today), `branch` (ship now), `worktree` (deferred). Enum lives once in `read.cjs` as `ISOLATION_MODES = ['in-place','branch']`; `worktree` is a known-but-unsupported value the server rejects.
- **D2 — Default `in-place`, byte-for-byte.** Absent config + no override ⇒ `in-place`; the run-record omits the `isolation`/`branch` fields when `in-place`, so existing records/tests are unchanged.
- **D3 — Two controls.** Per-project default in `config.yaml` (`orchestrator.isolation`) + Settings tab; per-run override in the run controls. Override wins.
- **D4 — Branch name auto-derived + task-keyed.** `tcgflow/<sanitized task_id>`. Keyed by `task_id` so the coder→reviewer→tester→ingester chain shares one branch (detect-and-continue).
- **D5 — No auto-merge.** Branch left for manual integration. Merge/parallel/conflict-surface stay in a future ADR (0026).
- **D6 — Fail closed on checkout failure.** If `ensureBranch` can't proceed (conflicting dirty tree, git error), the run fails `isolation-failed` — never runs on the wrong branch.
- **D7 — RAW-* exempt.** `RAW(-|$)` ingester runs are always `in-place` (single-shot, write under `.tcgstackflow/`).

## Seam changes (branch mode — this release)

1. **`ui/server/git.cjs`** — add, alongside `head`/`diffSince`, sharing the injectable `exec`:
   - `currentBranch(cwd, exec)` → `git -C cwd rev-parse --abbrev-ref HEAD` (null on failure/detached).
   - `branchExists(cwd, branch, exec)` → `git -C cwd show-ref --verify --quiet refs/heads/<branch>` (bool).
   - `ensureBranch(cwd, branch, exec)` → detect-and-continue: already-on ⇒ no-op; exists ⇒ `checkout`; else ⇒ `checkout -b`. Returns `{ branch, action: 'already-on'|'switched'|'created' }`. Throws on git failure (caller fails the run).
2. **`ui/server/read.cjs`**
   - Export `ISOLATION_MODES`.
   - `readConfig` → `cfg.orchestrator.isolation` (normalized, default `in-place`).
   - `serializeRunRecord` → emit `isolation:`/`branch:` **only when not in-place**.
   - `parseRunRecord` → read them back (`str`-normalized).
   - `setIsolation(workspaceDir, mode)` — surgical `editBlockLine` write (validates enum).
3. **`ui/server/run.cjs`**
   - `readIsolation(workspaceDir)` (mirrors `readRoleTool`), `branchFor(taskId)`, `resolveIsolation(run, workspaceDir)` (override > project default > `in-place`; RAW ⇒ `in-place`).
   - In `runLoop`: after the budget gate, before the placeholder write, run isolation setup once; capture `git_base` **after** the checkout so the base reflects the task branch's HEAD. Store `L.isolation`/`L.branch`; emit an `isolation` SSE event. On throw → fail `isolation-failed` (mirror the over-budget early-return).
   - Thread `isolation`/`branch` into `writeRunRecord`'s serialize input.
   - Export `ISOLATION_MODES` (re-export from `read`).
4. **`ui/server/index.cjs`**
   - `POST /api/run` — destructure `isolation`; 400 `unknown-isolation` if not in `ISOLATION_MODES`; pass into `enqueue` extras (spread onto the run at `run-manager.cjs:67`, so the executor sees `run.isolation`).
   - `POST /api/project/settings` — accept `isolation`, call `read.setIsolation`.
   - Diff endpoint unchanged (branch mode = same working tree).
5. **`templates/workspace/.tcgstackflow/config.yaml`** — add `isolation: in-place` under `orchestrator:` (documented in the optional-keys comment); bump `workspace_schema: 7` + ladder comment.
6. **`init.js`** — `LATEST_SCHEMA = 7`; ladder comment; MIGRATIONS `{from:6,to:7}` that idempotently inserts `isolation: in-place` under `orchestrator:` (skip if the orchestrator block already has `isolation:`) and refreshes `runs/README.md`.
7. **`ui/src/App.vue` + `api.js`** — per-run isolation `<select>` next to the chain toggle (`chainOn` sibling); per-project default select in Settings (mirrors `auto_advance`), sent via `saveSettings`; thread `isolation` into the `startRun`/`quickRun` payloads; per-run badge (follow the `wiki_discovery` badge). *UI can't be headless-smoked — verify in the browser.*

## Tests

- `git.test.cjs` — `ensureBranch` fake-`exec`: already-on ⇒ no checkout; exists ⇒ `checkout <b>`; missing ⇒ `checkout -b <b>`; git failure propagates. `branchExists` argv + exit mapping.
- `read-cjs.test.cjs` — `serializeRunRecord` omits fields when `in-place`, emits when `branch`; round-trip through `parseRunRecord`; `setIsolation` surgical write + enum guard; `readConfig` isolation default.
- `run-guards.test.cjs` / `run-executor.test.cjs` — `resolveIsolation` precedence + RAW exemption; `runLoop` calls `ensureBranch` for branch mode with a fake git and pins cwd/base after; `isolation-failed` path.
- `init-migrations.test.cjs` — 6→7 inserts the key once; idempotent on re-run; a workspace already carrying `isolation:` is untouched.
- `router-handlers.test.cjs` — `POST /api/run` rejects `unknown-isolation`; accepts `branch`; settings write round-trips.

## Worktree follow-up (deferred — its own PR/ADR extension)

Introduce an explicit **`workspaceRoot`** (always the repo root) distinct from the run's **`cwd`** (the worktree), threaded through: `run.cjs` `workspaceDir`/`buildTaskDetail`/`git_base`; the diff endpoint (point `diffSince` at the persisted worktree path); the agent prompt (absolute workspace path so relative `.tcgstackflow/...` resolves to the repo root); and qmd (index lives at the repo root). Keep the run lock keyed on the repo, prune orphaned worktrees in `reconcileOrphanedRuns`. Only then flip `worktree` from "rejected at the door" to supported. Still no auto-merge.
