# Tasks live in a sibling folder, not nested inside the wiki, and have exactly one home

INX's real working structure has `.taskRef/` (tasks) and `ai-mem/docsRef/` (wiki) as *siblings*, not nested. Tasks are operational artifacts with their own lifecycle (active → completed → archive); the wiki is the distilled knowledge layer. Keeping them sibling makes that lifecycle explicit and lets `.tcgstackflow/tasks/` be moved, renamed, or replaced without touching the wiki. INX also shows an unintended duplication — `.taskRef/` at the project root *and* `ai-mem/taskRef/` mirroring it — that we explicitly do not replicate: each task folder has exactly one home.

## Decisions

- Task workspace lives at `.tcgstackflow/tasks/` (sibling to `wiki/`), not under `wiki/`.
- Each task has exactly **two files** (`TASK {ID}.md` + `TASK details {ID}.md`) — no per-subtask file splits. (See CONTEXT.md "Two-file rule".)
- Task folder structure mirrors INX's lifecycle: `active/{ID}/`, `completed/{ID}/`, `archive/{category}/{ID}/`, and `.weekly/` for generated timesheets.
- `tasks/README.md` is the running task index — table of Active / Recently Completed / Archive, updated whenever a task moves between folders.

## Consequences

- The ingest skill reads from `tasks/completed/{ID}/` (and optionally `archive/`) but never modifies the task files themselves.
- Tempo timesheet generation lives at `tasks/WEEKLY_TIMESHEET_INSTRUCTIONS.md` and writes drafts to `tasks/.weekly/` — keeps the Tempo concern co-located with task data, off the wiki entirely.
- Wiki has no `task-history.md` page; the source of truth for task history is the task folders + `log.md` ingest entries pointing back at them.
