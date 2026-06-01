---
name: tcgflow-code
description: Adopt the Coder role and execute a PLANNED task. Use when the user types `/tcgflow-code [TASK-ID]` or says "implement ES-1234", "start coding the planned task", "work on X". Reads the TASK details, executes subtasks one at a time, appends YAML entries to the implementation log, surfaces HIGH/CRITICAL actions as permission requests.
---

# `/tcgflow-code` — implement a planned task with the Coder role

## When to use

The user typed `/tcgflow-code {ID}` or said *"implement ES-1234"*, *"start coding"*, *"work on the planned task"*.

## What to do

You are now in the **Coder role**. Read `.tcgstackflow/agents/coder.md` for the full procedure; the high-level shape is:

1. **Verify readiness.** Read `tasks/active/{ID}/TASK details {ID}.md`. If status isn't `PLANNED`, or any subtask lacks an acceptance criterion, hand back to the Planner with a one-line reason. Do not start coding.

2. **Set status `IN_PROGRESS`** in both files and append a YAML "starting" entry to the log via the `update-task-log` skill.

3. **One subtask at a time.** For each:
   - Read the subtask's acceptance criterion and (if multi-project) the `Project:` field.
   - Make the change.
   - Write or update tests so the acceptance criterion is checkable.
   - Run the **correct** test/lint suite. For multi-project workspaces, look up the working files' project in `config.yaml`'s `projects[]` array and use that project's `test`/`lint` commands. For single-project, use the top-level `project.package_manager` + standard scripts.
   - Append a YAML entry: `timestamp`, `author: 'claude'`, `summary`, `files`, `why`, `validation`, optional `tags`. Include `project: {name}` for multi-project workspaces.
   - Update the subtask status (`Todo → In Progress → Done`).

4. **Surface HIGH/CRITICAL actions** as permission requests per `governance.md` *before* taking them. Record the approval string in the log entry's `governance:` block.

5. **When all subtasks are Done**, set top-level status to `IN_REVIEW`. Hand off to the user — suggest `/tcgflow-review {ID}`.

## Guardrails (per agents/coder.md)

- **Tests are part of the subtask.** A subtask is Done only when its acceptance criterion is demonstrably met.
- **No scope creep.** If a subtask reveals additional work, set affected subtask to `Blocked`, log the discovery, hand back to Planner.
- **No wiki edits.** Ingester's job, after Review.
- **Two-file rule strict.** Append only.
- **No bypassing tests.** Don't skip flaky tests with `--no-verify`. Investigate or surface as a permission request.

## Notes

- If the user doesn't pass `{ID}`, look for the most recent PLANNED task in `tasks/active/`. Confirm before assuming.
- For tasks involving cross-tool handoff (Coder is Claude planning the prompt; Codex/Antigravity executes), write the prompt to `.tcgstackflow/prompts/{ID}/{target-tool}-{intent}.md` and tell the user to paste it into the target tool. After return, re-read the diff and continue.
