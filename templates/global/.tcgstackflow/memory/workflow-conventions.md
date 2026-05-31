---
title: Workflow Conventions
priority: P0
updated: 2026-05-30
status: current
---

# Workflow Conventions

How the user likes to work, regardless of project.

## Task discipline

- **No code before `PLANNED`.** A task without acceptance criteria is not ready to be implemented.
- **Two-file rule is strict.** `TASK {ID}.md` + `TASK details {ID}.md`. Never split per subtask.
- **Grill before plan.** When acceptance criteria are unclear, interview first — never invent.
- **One subtask at a time** during implementation. Finish, log, then move on.

## Wiki discipline

- **Log-first ingestion.** Wiki edits go through `wiki/log.md` for traceability.
- **New pages and deletions need explicit approval.** Existing-page updates flow without ceremony.
- **Don't pre-stub pages.** Pages are born when an ingest needs them, not when the structure says they should exist.

## AI tool conventions

- Default tool is **Claude Code** for planning, reviewing, and ingesting.
- Implementation may be delegated to **Codex** or **Antigravity** when the cost/quality math favours it — via manual prompt handoff.
- **Claude is the planner**; cheaper tools execute against tight plans Claude wrote.

## Scheduling

- Work starts 07:00–08:00 local time.
- Lunch 12:00–13:00, flexible around fixed meetings.
- Tempo timesheet submitted at end of week (Friday afternoon ideally).
- Friday afternoon is also good for `lint-wiki` runs.

## Communication

- Surface uncertainty rather than invent.
- Push back on scope creep — the Planner refuses to silently bundle.
- Don't ask the user to repeat what's in writing already.
