# Orchestrator concurrency: sequential within a project, concurrent across projects

Session 1 raised parallel FE/BE agents and the worktree-conflict risk that comes with them. The Orchestrator forces a concurrency decision. A clean distinction dissolves most of the problem: agents in *different* projects can't conflict (separate working trees); agents in the *same* working tree can.

## Decision

- **Sequential within a project.** At most one active orchestrated run per project working tree at a time (planner → coder → reviewer → ingester, one at a time). No worktree coordination, no merge conflicts, one stream per project.
- **Concurrent across projects.** Different registered projects are separate repos/working trees, so their runs are isolated and may run at the same time. The Home view can legitimately show, e.g., INX's coder and run-by-strength's reviewer running concurrently.
- **Same-project parallel is deferred.** Running FE and BE coders on one project simultaneously requires git-worktree isolation per agent plus an integration/merge step. Deferred until sequential is proven *and* a real task demands the wall-clock saving.

## Why defer same-project parallel

- The merge step is a feature with its own design (two worktrees reconciled, human-resolved conflicts) — not a flag.
- Sequential-within-project is conflict-free and covers the overwhelming majority of real work.
- The `runs/` model (ADR 0024) and the action queue (ADR 0023) already hold N entries, so parallel is **additive** — enabling it later needs no rework of those.
- Same earn-the-complexity discipline as ADR 0001/0002.

## Consequences

- The Home action queue and per-project run badges are designed now to show multiple concurrent runs *across* projects (N independent single-runs) — free, since each is isolated.
- The per-project view assumes *one* active run; that assumption is cheap to relax when same-project parallel (worktrees) arrives.
- When same-project parallel lands, it uses the `isolation: 'worktree'` pattern (one git worktree per parallel agent) plus a merge/integration step and a Cockpit conflict-resolution surface — a future ADR.
- A simple per-project run lock (one active run per working tree) is the only concurrency primitive the first Orchestrator needs.
