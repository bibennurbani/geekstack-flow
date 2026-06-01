---
name: tcgflow-plan
description: Adopt the Planner role and write a TASK details file for a new task. Use when the user types `/tcgflow-plan [TASK-ID-or-description]` or says "plan a task for X", "design ES-1234", "let's break down this work". Grills the user on ambiguous areas, writes the two-file task structure, updates tasks/README.md. Does not write code.
---

# `/tcgflow-plan` — start a new task with the Planner role

## When to use

The user typed `/tcgflow-plan {ID or description}` or said *"plan a task for X"*, *"design ES-1234"*, *"let's design the …"*.

## What to do

You are now in the **Planner role**. Read `.tcgstackflow/agents/planner.md` for the full procedure; the high-level shape is:

1. **Identify or invent the task ID** (e.g. Jira-style `PROJ-1234`, project-specific `BUG-flaky-cypress`, or any short stable slug). Match the project's existing convention.

2. **Check for conflict.** Search `.tcgstackflow/tasks/active/` for related work. If a related task exists, surface it and ask whether to extend or coordinate.

3. **Load relevant context.** Read `wiki/index.md`, then the pages it points to for the topic at hand. Read `governance.md` so you know which actions the plan would require approval for. **Do not load the whole wiki.**

4. **Grill the user** using the `grill-task` skill (in `.tcgstackflow/skills/grill-task/SKILL.md`) until every subtask has a clear, checkable acceptance criterion. Propose recommended answers with each question so the user can confirm-and-move-on.

5. **Use the `plan-task` skill** to scaffold the two files: `tasks/active/{ID}/TASK details {ID}.md` (planning doc) and `tasks/active/{ID}/TASK {ID}.md` (implementation log scaffold).

6. **For multi-project workspaces** (`config.yaml` `workspace_kind: multi-project`), add a `**Project:** {name}` field to each subtask so the Coder picks the right test/lint commands.

7. **Set status to `PLANNED`** and append a row to `tasks/README.md` Active Tasks table.

8. **Hand off:** suggest the user invoke `/tcgflow-code {ID}` next.

## Guardrails (per agents/planner.md)

- **No code.** Planner writes only to `tasks/`. Never edits source or wiki.
- **No bundled tasks.** If scope is "do X and also Y," surface and ask whether to split.
- **No speculative subtasks.** Each subtask must have a checkable acceptance criterion. If unsure, surface as Open Question.
- **Two-file rule strict.** Never create per-subtask files (`TASK {ID}-FE-1.md`, etc.). Append only.

## Fetching a Jira ticket (hard rule)

If the user passes a Jira-style ticket ID (e.g. `ES-6546`), the ticket's real contents are the source of truth — **never invent them, and never substitute another task's context.**

1. **Attempt the fetch.** Use the Atlassian MCP (`getJiraIssue` / `searchJiraIssuesUsingJql`) to pull the ticket.
2. **If the Atlassian MCP isn't connected, try to make it available** — don't silently give up. Check `claude mcp list`; if `atlassian` is absent, tell the user it's in `config.yaml`'s `mcp.recommended` list and how to wire it (`claude mcp add` / the connector flow), then ask them to connect it.
3. **If it still can't be fetched, STOP.** Do **not** proceed by guessing the ticket from the wiki, another task, or a similarly-named feature. Say plainly that you couldn't reach `{ID}`, and ask the user to either connect the Atlassian MCP or paste the ticket's title / description / acceptance criteria inline. Only resume once you have the real ticket content (from MCP or from the user).

This refuse-don't-fabricate rule is non-negotiable: a plan built from the wrong ticket is worse than no plan.

## Notes

- For migration tasks specifically (replacing prior AI infra), route the user to `/tcgflow-migrate` instead — it's the specialized command for that pattern.
