# Worktree autopilot: parallel per-task runs to a ready-for-PR state, with a human-invoked PR command

ADR 0040 shipped `isolation: in-place | branch` and deferred `worktree` (and ADR 0026 deferred
same-project parallel) because a git worktree fragments the git-tracked `.tcgstackflow/` single source
of truth. This ADR implements `worktree` **and** the "autopilot" workflow: enable it and every launched
task runs in its own worktree, auto-chains **planner → coder → reviewer** in parallel, then waits for a
human to review and open its PR. It lifts ADR 0026's parallel deferral **for worktree runs only**.

## Decision

- **`isolation: worktree`** is now supported (completing ADR 0040's enum). A worktree run executes in a
  dedicated per-task git worktree (`<repo>.worktrees/<TASK-ID>` on branch `tcgflow/<TASK-ID>`), reused
  across the chain (detect-and-continue), created once after the budget gate.
- **`orchestrator.autopilot`** (default off) is the UX bundle: a launch defaults to worktree isolation
  + chain, and the chain **stops after a clean reviewer pass** (no tester/ingester), emitting a
  `ready-for-pr` signal. Still overridable per launch.
- **Parallel for worktree runs.** The run-manager gains a second lane: worktree runs run concurrently
  up to `orchestrator.max_parallel` (default 3); in-place/branch keep the single per-repo slot (ADR 0026
  unchanged for the shared working tree). The per-task guard still blocks a duplicate run on one task.
- **PR is human-invoked, never automatic.** A per-task command (Cockpit "⑂ PR" action **and**
  `geekstackflow pr <TASK-ID>`) previews the branch's commits + diff, then on confirm pushes the branch
  and opens a **draft** PR via `gh` (or returns a GitHub compare URL if `gh`/remote is absent). Push +
  open-PR are HIGH (governance.md); the explicit command **is** the approval. No auto-merge.

## How the worktree resolves the ADR 0040 blockers

- **The agent works entirely inside its worktree** (cwd = `run.exec_root`, relative paths) — code and
  its task-log/Status writes land on the worktree branch. No prompt-path surgery.
- **`.qmd` is symlinked** into the worktree (`<repo>/.qmd`). `.qmd/` is gitignored, so the symlink adds
  no git noise, and wiki search (ADR 0030) works against the shared index.
- **Server artifacts stay at the repo root; agent artifacts live in the worktree.** The run record is
  written to `<repo>/.tcgstackflow/runs/` (so Cockpit token history + budget accounting see in-flight
  parallel runs), while the loop reads task **Status** for hand-off detection from the worktree (where
  the agent wrote it). `run.project_path` (repo root) stays the record/budget/concurrency key;
  `run.exec_root` (worktree) drives spawn cwd, `git_base`, the diff endpoint, and the settle read.

## Governance / safety

- Autopilot agent runs are governed exactly as today; a HIGH action mid-run pauses into the Approvals
  inbox — so returning later surfaces either ready PRs **or** pending approvals.
- **Push + open PR stay HIGH and human-invoked.** No unattended remote writes; `gh`/remote absent
  degrades to a compare URL, never fails the run. Worktree create/reuse is MEDIUM (like a branch);
  worktree removal is manual only (deletion is HIGH) — orphaned worktrees are pruned, not force-removed.
- **Cost is the real constraint.** Parallel autopilot fires many real agent runs; `max_parallel` bounds
  concurrency, not total spend. The budget guard still applies per launch.

## Considered options

- **Fully-automatic PR at chain end** — rejected: it makes two HIGH actions unattended on every task.
  The user chose a per-worktree "review then open" command; the command is the human gate.
- **Full pipeline (through tester/ingester) before the PR** — rejected for autopilot v1: the user chose
  planner→reviewer; stopping at reviewer also removes the shared-`.qmd` re-embed race between parallel
  runs (no ingester in the loop).
- **Thread an explicit `workspaceRoot` everywhere instead of symlinking `.qmd`** — rejected: the
  everything-in-the-worktree + `.qmd` symlink model is simpler and needs no agent-prompt rewrite.
- **Relax the lock for all isolations** — rejected: in-place/branch share the working tree, so they must
  stay serialized (ADR 0026). Only worktree runs are safe to parallelize.

## Consequences

- `config.yaml` `orchestrator` gains `autopilot`, `max_parallel`, and `pr.{remote,base,draft}` — a
  `workspace_schema` bump 7 → 8 (idempotent migration).
- New `ui/server/pr.cjs` (the PR command core, canonical `branchFor`); `git.cjs` gains worktree ops;
  `run-manager.cjs` gains the parallel lane; the Cockpit gains autopilot Settings, a PR review dialog,
  and a "Start all" action.
- ADR 0026 is partially superseded: same-project parallel is now allowed for worktree runs (bounded).
  The still-deferred pieces are automatic merge and a conflict-resolution surface.
