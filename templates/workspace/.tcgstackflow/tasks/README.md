# Tasks

Task tracking hub. Each task is **exactly two files** kept inside its own folder.

> **The two-file rule is strict.** Never create per-subtask files like `TASK {ID}-FE-1.md`, `FIXES.md`, etc. Append to the existing two files instead. See [agents/coder.md](../agents/coder.md) for why.

## Lifecycle

```
active/{ID}/  →  completed/{ID}/  →  archive/{category}/{ID}/
   ↑                                          ↑
Planner creates                Ingester moves          User periodically
                              after ingestion         clears completed/
```

## Files inside each task folder

- `TASK {ID}.md` — implementation log. Append-only YAML entries from the Coder + review entries from the Reviewer.
- `TASK details {ID}.md` — the plan. Overview, subtasks (flat list), acceptance criteria.

## Active Tasks

| Task | Description | Status | Location |
|---|---|---|---|
| _(empty — Planner adds rows here)_ | | | |

## Recently Completed

| Task | Description | Completed | Location |
|---|---|---|---|
| _(empty — Ingester adds rows here)_ | | | |

## Archive

Older completed and abandoned tasks, grouped by category for findability. Categories grow organically — common ones the Ingester or user create:

| Category | Tasks | Location |
|---|---|---|
| _(empty — user/Ingester moves folders here as the project evolves)_ | | |

**Common archive categories** (use what fits, invent more as needed):

| Category | When to use |
|---|---|
| `stale/` | Tasks that lived in `active/` but were never finished and are no longer being worked on. Keep the two files intact for posterity. |
| `{feature-area}/` | Older completed tasks grouped by feature (e.g. `scheduler/`, `ag-grid/`, `auth/`, `payments/`). |
| `misc/` | Catch-all for completed tasks that don't fit a feature area. |
| `spike/` | Exploratory or research-only tasks that didn't produce shipped code. |

## Statuses

| Status | Meaning | Who sets it |
|---|---|---|
| `DRAFT` | Details file being written, not ready yet | Planner |
| `PLANNED` | All subtasks have acceptance criteria; ready for Coder | Planner |
| `IN_PROGRESS` | Coder is actively working | Coder |
| `BLOCKED` | Blocked on an external dependency or user input | Coder |
| `IN_REVIEW` | All subtasks Done; awaiting Reviewer (static: code is *right*) | Coder |
| `IN_TEST` | Reviewer approved; awaiting Tester (dynamic: code *works*) | Reviewer |
| `VALIDATED` | Tester verified behavior; awaiting Ingester | Tester |
| `INGESTED` | Ingester folded into wiki; task complete | Ingester |

Lifecycle: `DRAFT → PLANNED → IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED` (with `BLOCKED` as a side state). Reviewer checks the code is right; Tester checks it works.

## Folder structure

```
tasks/
├── README.md                            ← this file
├── WEEKLY_TIMESHEET_INSTRUCTIONS.md     ← Tempo flow
├── active/{ID}/                         ← in-progress tasks
├── completed/{ID}/                      ← recently completed
├── archive/{category}/{ID}/             ← older completed
└── weekly/                             ← generated timesheets
```

## Cross-tool handoff prompts

If a task is being executed in another AI tool (e.g. Codex), the Planner writes the prompt to `../prompts/{ID}/`. See [ADR 0002](../../docs/adr/0002-manual-handoff-only-in-v1.md) in the geekstack-flow repo for the rationale.
