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

1. **Verify the task ID is fresh.** Check `tasks/active/`, `tasks/completed/`, and `tasks/archive/` for the ID. If it exists anywhere, surface the conflict — propose either reopening the prior task or picking a new ID. Where the ID was found decides what happens next:
   - **Nowhere** — it is a new task. Continue at step 2.
   - **In `tasks/active/`** — surface it, then offer a third option alongside those two: **refine it in place.** Update the sections of the existing `TASK details {ID}.md`; do not create a folder and do not pick a new ID. Step 2 is skipped and step 3 reduces to re-mirroring `## Key Requirements` against the revised `## Acceptance Criteria` — the folder and the log file already exist, but a refine that sharpens the criteria must not leave the log's mirror stale. Step 5 leaves the existing status alone, and step 6 edits the task's existing `tasks/README.md` row rather than appending a second one. Refining still needs the user's yes. This branch is what keeps `/tcgflow-plan {ID}` usable on a task `/tcgflow-new-feature` already wrote: discovery writes the two files at `PLANNED`, and a later plan pass sharpens the same two files.
   - **In `tasks/completed/` or `tasks/archive/`** — a conflict, never a refine. A finished or archived task is a record; reopening it is a call the user makes explicitly, and the alternative is a new ID.
2. **Create the folder** at `tasks/active/{ID}/`.
3. **Write `TASK {ID}.md` — the implementation log scaffold.** Top sections only — no entries yet (those come from `update-task-log` once the Coder starts). Its `## Key Requirements` mirrors the details file's feature-level `## Acceptance Criteria` — the same list as bullets, not a second set of criteria. See template below.
4. **Write `TASK details {ID}.md` — the planning doc.** Use the template below. Fill in:
   - **`Stacked on: {ID}`** — an optional field line directly under `Status:`, not a section. Present only on a task written as one slice of an approved split; omit the line entirely otherwise.
   - **Overview** — one paragraph from the resolved grill output.
   - **Acceptance Criteria** — feature-level, numbered, each one a condition someone can check once the feature ships. Distinct from the per-subtask `**Acceptance:**` lines, which are unchanged — a feature-level criterion says what the feature must do, a per-subtask one says what that one subtask must satisfy. A task normally carries both, and they are not the same list.
   - **Out of scope** — bulleted: what was deliberately left out, with the reason in half a line. Carried from the grill's or `frame-feature`'s out-of-scope list.
   - **Context** — wiki pages (discovered via the `wiki-search` skill (qmd), not by hand-grepping the wiki; `index.md` is the fallback) and prior related tasks, as `[[wikilinks]]`.
   - **Stack/Technologies** — the slice of the project's stack this task touches.
   - **Key Files** — best-effort list from grill output.
   - **Risk** — any HIGH/CRITICAL actions the plan implies. Empty if none.
   - **Subtasks** — flat list (no nesting), each with status, size, acceptance criterion, and files. Subtask IDs follow the convention `{TASK_ID}-{LANE}-{N}` (e.g. `ES-6900-FE-1`, `BUG-flaky-cypress-BE-1`). Lanes are conventional, not enforced — common ones are `FE`, `BE`, `DB`, `INFRA`, `TEST`, `DOCS`.
   - **Open Questions** — anything the grill explicitly deferred. The Coder must resolve before starting the affected subtask.
5. **Set the status line — on a new task only.** A new task's top status line reads `PLANNED` in both files. A refine leaves the existing status untouched: the branch fires on any ID in `tasks/active/`, and rewinding an `IN_PROGRESS` or `IN_REVIEW` task to `PLANNED` re-queues it with the Coder in the Cockpit.
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
- **A second folder for a task that already exists.** An ID already in `tasks/active/` is refined in place. A `{ID}-v2/` folder, or a fresh ID picked to dodge the conflict, breaks the two-file rule by another route.
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

{Mirror of the details file's feature-level `## Acceptance Criteria`, as bullets. Where a task has
none, summarise the per-subtask acceptance criteria instead.}

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
Stacked on: {previous-ID}   <!-- optional; only on a task written as one slice of an approved split -->

## Overview

{One paragraph: what is this task, why, what is the desired outcome.}

## Acceptance Criteria

1. {Feature-level, checkable once the feature ships.}
2. {…}

## Out of scope

- {What was deliberately left out, and why in half a line.}

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

`## Acceptance Criteria`, `## Out of scope` and `Stacked on:` are additive — a task file written
before they existed is still valid, and nothing rewrites old files to add them. Two notes on them:

- `Stacked on:` is written by `frame-feature`'s splitting protocol, on each slice after the first,
  and names the slice below it. Omit the line on every other task. Nothing in the workspace reads
  it yet — it is a record for a human now, and the input to PR stacking later.
- The feature-level `## Acceptance Criteria` never replaces the per-subtask `**Acceptance:**`
  lines, and neither list is derived from the other. Write both.
