# MCP-derived task skills — one task per source, shared shape, dedup against existing tasks

Production tooling (Snyk for vulnerabilities, Cypress for test failures, Datadog for incidents and monitor alerts, etc.) routinely surfaces work that should become tracked tasks. V1 adds a family of skills that convert MCP output into `PLANNED` (or, for live incidents, `IN_PROGRESS`) tasks with the standard two-file shape. Three source-specific skills ship: `task-from-snyk`, `task-from-cypress`, `task-from-datadog`. Each pairs with a slash command (`/tcgflow-task-from-{source}`). All follow the same shape so the pattern is reusable when new sources (Sentry, GitHub Security Advisories, Lighthouse CI, etc.) get added.

## Shared shape

Every MCP-derived task skill follows the same five-step procedure:

1. **Query the source** via its MCP, or accept a pasted report if the MCP isn't configured.
2. **Dedup against existing tasks** (`tasks/active/`, `tasks/completed/`, `tasks/archive/`) — if a prior task with a recorded decision exists, surface that decision rather than recreating.
3. **Group findings** by the unit that makes sense for the source — vulnerable package for Snyk, spec file for Cypress, incident or monitor for Datadog. Avoid one-task-per-finding noise.
4. **Generate one task per group** via `plan-task`. Task ID follows a source-specific prefix (`SEC-…`, `TEST-…`, `INC-…`/`OPS-…`). Subtasks carry source-specific acceptance criteria. For multi-project workspaces, `**Project:** {name}` is set per subtask.
5. **Risk and governance interaction** — severity from the source maps to risk levels per `governance.md`. Affected paths cross-referenced against `governance.md`'s Project-Specific Rules; flagged paths escalate risk one level.

## Why source-specific skills, not one generic skill

A generic `task-from-mcp` skill would require the AI to know every MCP's data shape, severity scheme, dedup strategy, and grouping unit. Source-specific skills bake in that knowledge, are easier to test individually, and let the per-source acceptance-criteria templates live alongside the source-specific procedure. The shared shape (above) is the contract that keeps them coherent.

Adding a new source (e.g. Sentry) is a new SKILL.md + a new slash command following the same shape — a ~20-minute job, plus an ADR entry if the source introduces new governance interactions.

## Why one task per group, not one per finding

A package with 5 CVEs that all resolve with the same upgrade is one piece of work, not five. A spec failing 8 tests due to one bad selector is one fix, not eight. Grouping at the source's natural unit (package / spec / incident) matches reality and keeps `tasks/active/` browsable.

## Why dedup is mandatory

MCPs surface the same findings repeatedly until they're resolved upstream. Without dedup, every `/tcgflow-task-from-snyk` invocation would recreate the same tasks. The dedup pass against `archive/` is especially important — a prior `accepted-risk` decision in `governance.md` should not be silently overwritten by recreating the task.

## Consequences

- V1 starter skill count goes from 10 to **13**: existing 10 plus `task-from-snyk`, `task-from-cypress`, `task-from-datadog`.
- V1 slash command count goes from 10 to **13**: existing 10 plus `/tcgflow-task-from-{snyk,cypress,datadog}`.
- README, `CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md` skill tables updated.
- `audit-workspace` skill gains a future detector (next minor release) for MCP-derived tasks that reference an MCP not in `config.yaml`'s recommended/optional list.
- New sources can be added one at a time; the shared shape keeps them coherent.
- Live incident handling (the `task-from-datadog` skill writing tasks with status `IN_PROGRESS` and timestamp-of-acknowledgement in the first log entry) is the precedent — other sources can follow the same convention if they support "live" semantics.
