---
name: tcgflow-task-from-snyk
description: Generate a PLANNED task from Snyk MCP findings — security vulnerabilities grouped by vulnerable package. Use when the user types `/tcgflow-task-from-snyk` or asks "create tasks from Snyk", "process the latest vulnerabilities", "what security issues do we have?". Dispatches to the `task-from-snyk` workspace skill which dedups against existing tasks, groups by package, and creates one PLANNED task per package with subtasks per finding.
---

# `/tcgflow-task-from-snyk` — create a task from Snyk findings

## When to use

The user typed `/tcgflow-task-from-snyk` or said *"create tasks from Snyk"*, *"process the latest vulnerabilities"*, *"what security issues do we have?"*.

## What to do

Run the `task-from-snyk` skill in `.tcgstackflow/skills/task-from-snyk/SKILL.md`. High-level flow:

1. **Query the Snyk MCP** (or ask the user to paste a Snyk report if the MCP isn't configured) for current findings on this project. Filter to CRITICAL + HIGH severity by default; surface MEDIUM/LOW separately.
2. **Dedup against existing tasks** in `tasks/active/`, `tasks/completed/`, and `tasks/archive/`. If a prior task with an `accepted-risk` decision exists for the same finding, surface the decision rather than recreating.
3. **Group by vulnerable package** — one task per package, subtasks per CVE.
4. **Create the task** via `plan-task`: ID `SEC-{YYYY-MM-DD}-{package-slug}`, status `PLANNED`, Risk section escalated based on severity, `**Project:** {name}` per subtask in multi-project workspaces.
5. **Suggest `/tcgflow-code {ID}`** to start fixing.

## Notes

- The skill produces the PLANNED task; the actual upgrade/patch work routes through the standard Coder → Reviewer flow with governance checks on dependency upgrades (HIGH).
- For projects with the Snyk MCP not configured, the skill will ask the user to paste a Snyk report (JSON or human-readable) and proceeds from there.
- See ADR 0018 for the MCP-derived-tasks pattern.
