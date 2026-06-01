---
name: tcgflow-task-from-cypress
description: Generate a PLANNED task from Cypress test failures and flaky specs — grouped by spec file, classified as flaky / genuinely-broken / test-itself-wrong / pending. Use when the user types `/tcgflow-task-from-cypress` or asks "create tasks from failing tests", "what's flaky?", "process the Cypress run". Dispatches to the `task-from-cypress` workspace skill.
---

# `/tcgflow-task-from-cypress` — create a task from Cypress results

## When to use

The user typed `/tcgflow-task-from-cypress` or said *"create tasks from failing tests"*, *"what's flaky?"*, *"process the Cypress run"*, *"fix the E2E suite"*.

## What to do

Run the `task-from-cypress` skill in `.tcgstackflow/skills/task-from-cypress/SKILL.md`. High-level flow:

1. **Get failing/flaky specs** from the Cypress MCP, a local `cypress run` output, or a CI run pasted by the user.
2. **Classify each failure** as `flaky` / `genuinely-broken` / `test-itself-wrong` / `pending` and propose the matching acceptance criterion.
3. **Dedup** against prior tasks referencing the same spec file. If found, append a subtask to the existing task rather than recreate.
4. **Group by spec file** — one task per spec, subtasks per failing test in that spec.
5. **Create the task** via `plan-task`: ID `TEST-{YYYY-MM-DD}-{spec-slug}`, status `PLANNED`, Risk MEDIUM (HIGH if the spec is under a `governance.md`-flagged critical path like `cypress/e2e/critical/**`), `**Project:** {name}` per subtask in multi-project workspaces (Cypress specs almost always live in a specific frontend sub-project).
6. **Suggest `/tcgflow-code {ID}`** to start fixing.

## Notes

- The skill captures screenshot paths and log artifacts from the run so the coder can inspect failures without re-running locally.
- Flaky specs get an acceptance criterion involving consecutive-pass count (or quarantine), not just "spec passes once" — different failure mode.
- See ADR 0018 for the MCP-derived-tasks pattern.
