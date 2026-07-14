---
name: plan-task
description: Generate the two-file structure (`TASK {ID}.md` + `TASK details {ID}.md`) for a new task and fill the details file with a flat subtask list plus acceptance criteria. Use this after `grill-task` has resolved ambiguities. The skill creates the task folder under `tasks/active/{ID}/`, scaffolds the implementation log, writes the details file, and appends a row to `tasks/README.md`. Two-file rule is enforced strictly — never produces per-subtask files.
---

# Plan Task

## When to use this skill

Invoke this skill when:

- A task is ready to be written down — every subtask has a clear acceptance criterion (typically after `grill-task` has run).
- You have a Jira-style ID (`ES-1234`) or a project-specific convention (`BUG-{slug}`).
- The user has approved the scope and you're not silently inventing subtasks.

**Do not use this skill** for ad-hoc work that doesn't deserve a task folder, or to "stub a task" that has no acceptance criteria yet — the Planner's job is to refuse to stub speculative work.

## Instructions

You are writing two files inside `tasks/active/{ID}/` and adding one row to `tasks/README.md`. **Never create additional task files** — the two-file rule is the strongest invariant in this workspace.

### Procedure

1. **Verify the task ID is fresh.** Check `tasks/active/`, `tasks/completed/`, and `tasks/archive/` for the ID. If it exists anywhere, surface the conflict — propose either reopening the prior task or picking a new ID.
2. **Create the folder** at `tasks/active/{ID}/`.
3. **Write `TASK {ID}.md` — the implementation log scaffold.** Top sections only — no entries yet (those come from `update-task-log` once the Coder starts). See template below.
4. **Write `TASK details {ID}.md` — the planning doc.** Use the template below. Fill in:
   - **Overview** — one paragraph from the resolved grill output.
   - **Context** — wiki pages (discovered via the `wiki-search` skill (qmd), not by hand-grepping the wiki; `index.md` is the fallback) and prior related tasks, as `[[wikilinks]]`.
   - **Stack/Technologies** — the slice of the project's stack this task touches.
   - **Key Files** — best-effort list from grill output.
   - **Risk** — any HIGH/CRITICAL actions the plan implies. Empty if none.
   - **Subtasks** — flat list (no nesting), each with status, size, acceptance criterion, and files. Subtask IDs follow the convention `{TASK_ID}-{LANE}-{N}` (e.g. `ES-6900-FE-1`, `BUG-flaky-cypress-BE-1`). Lanes are conventional, not enforced — common ones are `FE`, `BE`, `DB`, `INFRA`, `TEST`, `DOCS`.
   - **Open Questions** — anything the grill explicitly deferred. The Coder must resolve before starting the affected subtask.
5. **Set the top status line in both files to `PLANNED`.**
6. **Append a row to `tasks/README.md`** in the Active Tasks table, with the task ID, one-line description, `In Progress` status placeholder, and a relative link to the folder. _Note: status in the README is a coarse human label; the canonical status lives in the details file._

### Output

A single short message to the user confirming:

- Task ID and folder location
- Subtask count
- Any open questions that need resolution before coding starts

Plus the two files on disk and the README update.

### Anti-patterns

- **Speculative subtasks.** If `grill-task` deferred a branch, list it under Open Questions, do not invent a subtask for it.
- **Bundled scope.** If the user has said "X and also Y" and Y is a separate concern, write only X and surface Y as a candidate new task. The Planner refuses scope bundles.
- **Nested subtask files.** Never `TASK {ID}-FE-1.md`. The two-file rule is non-negotiable — append to the existing files.
- **Acceptance criteria as restatements.** "Acceptance: it works" is invalid. Each criterion is a checkable condition.

## Templates

### `TASK {ID}.md` (implementation log scaffold)

```markdown
# TASK {ID} — {short title}

Last updated: {YYYY-MM-DD}
Status: PLANNED

## Overview

{Pulled from the details file's Overview section.}

## Key Requirements

{Bulleted summary of acceptance criteria across all subtasks.}

## Stack/Technologies

{From details file.}

## Key Files

{From details file.}

## Implementation Log

_(Append YAML entries here via the `update-task-log` skill.)_
```

### `TASK details {ID}.md` (planning doc)

```markdown
# TASK details {ID}

Status: PLANNED

## Overview

{One paragraph: what is this task, why, what is the desired outcome.}

## Context

{Wiki pages + prior tasks, as `[[wikilinks]]` where supported.}

## Stack/Technologies

{Languages, frameworks, libraries this task touches.}

## Key Files

{Best-effort list of files the Coder will likely modify.}

## Risk

{HIGH/CRITICAL actions implied. Empty if none.}

## Subtasks

- {ID}-{LANE}-1 — {subtask title} — Todo — {S | M | L | Nh}
  - **Acceptance:** {one-line, checkable condition}
  - **Files:** {comma-separated paths}

- {ID}-{LANE}-2 — ...

## Open Questions

{Items the grill deferred. Coder resolves these before starting the affected subtask.}
```
