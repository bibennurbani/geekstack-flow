# Per-run git isolation: `in-place | branch | worktree`, isolation-without-merge, worktree deferred

ADR 0026 reserved a "future ADR" for the `isolation: 'worktree'` pattern. This is (the first half of) that ADR. It adds a per-run, per-project-configurable **git-isolation mode** to orchestrated runs so a run can create/continue a task branch (or, later, a worktree) instead of always mutating the project's current branch in place.

## Context

Today every orchestrated run (Cockpit → headless subprocess) executes **in place** at `cwd: run.project_path` (`ui/server/run.cjs:225`). The only git touch is capturing HEAD as `git_base` at launch (`ui/server/git.cjs`) so the diff viewer can show "changes since this run began". There is no branch/worktree handling. Teams that want a branch-per-task (PR-per-task, keep `main` clean, easy rollback of a bad run) have to do it by hand around the run.

## Decision

Add `orchestrator.isolation` with three modes and an auto-detect "continue" short-circuit:

| Mode | Behaviour | Auto-detect ("already there → just continue") |
|---|---|---|
| `in-place` *(default — byte-for-byte today's behaviour)* | run on the current branch in the project working tree | n/a |
| `branch` | ensure the task's branch `tcgflow/<TASK-ID>` exists and is checked out, then run in the same working tree | if HEAD is already `tcgflow/<TASK-ID>`, do **not** re-create/switch — just run |
| `worktree` *(**deferred** — see below)* | run in a dedicated git worktree for the task | if the worktree exists, reuse it |

Settable **two ways** (mirroring `auto_advance`): a per-project default in `config.yaml` / the Settings tab, and a per-run override in the run controls. Per-run override wins; absent everywhere ⇒ `in-place`.

### Isolation WITHOUT merge-back

A run in `branch`/`worktree` mode **never merges back automatically**. The branch/worktree is left intact for the human to integrate (open a PR / merge manually). This is the line ADR 0026 drew — *"the merge step is a feature with its own design (two worktrees reconciled, human-resolved conflicts) — not a flag."* Automatic merge-back, same-project **parallel** runs, and a Cockpit conflict-resolution surface remain deferred to their own ADR.

### Keyed by task, not run — so the chain shares one branch

A task's lifecycle is four separate runs (coder → reviewer → tester → ingester, via `maybeChain`), each a fresh `runLoop`. Isolation is keyed on **`task_id`** (stable across the chain), not `run_id`. The coder creates `tcgflow/<TASK-ID>`; reviewer/tester/ingester detect they are already on it and continue — so downstream roles see the coder's changes. This *is* the "if it was already on the correct branch, just continue" behaviour.

### `worktree` is deferred (and why)

`.tcgstackflow/` is **git-tracked by default** (`init.js` only gitignores `.obsidian` state, `.qmd/`, `migration-notes/`). A `git worktree` gets its own checkout of the tracked workspace, which fragments the single source of truth:

1. The continuation loop reads task Status from the **repo-root** workspace (`read.buildTaskDetail(run.project_path, …)`, `run.cjs:291`; `workspaceDir = project_path/.tcgstackflow`, `run.cjs:266`) while the agent (cwd = worktree) writes Status/log to the **worktree's** copy — so the loop can't see the hand-off, the safety-net misfires, and the chain reads stale status.
2. The Cockpit reads task Status from the repo root, so the agent's updates are stranded on the branch until merged.
3. `.qmd/` is gitignored ⇒ the worktree has no qmd index, breaking the mandatory wiki-search layer (ADR 0030) for that run.

Making `worktree` correct requires a **"workspace-root ≠ working-cwd" seam** — threading an explicit workspace root (always the repo root) through `read.cjs`, the loop's task reads, `git_base`/diff, the agent prompt, and qmd — so code changes isolate in the worktree while the workspace stays single-source. That is genuinely "a feature with its own design", so `worktree` is documented here but **not implemented in this release**; the server rejects a `worktree` request until the seam lands. See `docs/plans/run-git-isolation.md`.

## Invariants preserved

- **Sequential-within-project (ADR 0026).** The run lock is keyed on the resolved **project path** (`run-manager.cjs:35`), which `branch` mode never changes — one working tree, one active run. Isolation does **not** relax the lock. (The eventual `worktree` mode must keep the lock keyed on the repo, not the worktree path, or it would silently allow two concurrent runs in one repo.)
- **cwd pinning (ADR 0035).** `branch` mode runs in the same `cwd` as today, so Claude `--resume` still finds the session across continuation iterations. (`worktree` mode must pin cwd to the worktree and keep it within the repo's worktree scope.)
- **Files-as-truth, no new store (ADR 0024).** Isolation state is recorded as **additive run-record frontmatter** (`isolation`, `branch`) — no second store. An `in-place` record is byte-identical to today's (the fields are omitted when `in-place`).

## Governance

Creating/switching a local branch is **MEDIUM** per `governance.md` ("do it, log it in `TASK {ID}.md`") — no permission gate, but the action is recorded on the run. We do **not** delete branches/worktrees automatically (deletion is HIGH), so there is no destructive teardown to gate; orphaned state is reconciled, not force-removed.

## Config / schema

`orchestrator.isolation` is a new `config.yaml` key ⇒ **`workspace_schema` bump 6 → 7** with an idempotent migration that inserts `isolation: in-place` into existing `orchestrator:` blocks (ADR 0021 additive-update). The run-record fields need no bump (additive frontmatter, like `tool`/`gate` in ADR 0035).

## Considered options

- **In-place only, branch by hand** — rejected: the branch-per-task workflow is common enough to be a first-class toggle; doing it by hand around the orchestrator is error-prone.
- **Ship `worktree` now as a cwd swap** — rejected: fragments the tracked `.tcgstackflow/` source of truth (above); would silently break the loop's hand-off detection.
- **Auto-merge on chain completion** — rejected for now: ADR 0026 scopes merge + conflict resolution to its own design.
- **`in-place | branch` now, `worktree` after the workspace-root seam** — *chosen*.

## Consequences

- `config.yaml` gains `orchestrator.isolation` (default `in-place`); schema 7 migration.
- `git.cjs` gains `currentBranch` / `branchExists` / `ensureBranch` (injectable `exec`, same seam as `head`/`diffSince`).
- The executor sets up the branch once per run (after the budget gate, before the loop), records `isolation`/`branch`, and fails the run cleanly (`isolation-failed`) if the checkout can't proceed (e.g. a conflicting dirty tree) rather than running on the wrong branch.
- The Cockpit gains a per-run isolation `<select>` + a per-project default + a per-run badge.
- `worktree` is a documented, rejected-at-the-door value until the follow-up lands.
