---
name: task-from-cypress
description: Generate a PLANNED task from Cypress test results — failing specs, flaky tests, and pending tests. Groups by spec file, creates one task with subtasks per failure pattern. Use when the user types `/tcgflow-task-from-cypress` or asks "create tasks from failing tests", "what's flaky?", "process the Cypress run". Classifies each failure as flaky / genuinely broken / test-itself-wrong and proposes appropriate acceptance criteria.
---

# Task from Cypress

## When to use this skill

The user typed `/tcgflow-task-from-cypress` or said: *"create tasks from failing tests"*, *"what's flaky?"*, *"process the Cypress run"*, *"fix the E2E suite"*. Triggered manually or by inspecting a recent CI run.

## Procedure

1. **Get failing/flaky specs.** Sources, in order of preference:
   - The Cypress MCP if configured (gives structured run data: failure count per spec, retries, screenshots).
   - The local `cypress/` folder + a recent `cypress run` output if the user just ran it.
   - A CI run output pasted by the user.

2. **Classify each failure** — propose one of these labels per spec (user adjusts):
   - **flaky** — passed previously, fails sometimes. Acceptance: "spec passes 10 consecutive runs locally" or "spec moved to quarantine list per `governance.md`."
   - **genuinely-broken** — application bug. Acceptance: "spec passes against current build; root-cause documented in subtask body."
   - **test-itself-wrong** — selectors are stale, fixtures wrong, assertions outdated. Acceptance: "spec rewritten against current UI; new selector strategy documented."
   - **pending** — test exists but is `.skip`'d or has open TODOs. Acceptance: "remove `.skip`, implement remaining steps, spec passes."

3. **Dedup against existing tasks.** Search `tasks/active/`, `tasks/completed/`, `tasks/archive/` for prior tasks referencing the same spec file. If found, append a new subtask to the existing task instead of creating a duplicate.

4. **Group by spec file.** One task per spec file, with subtasks for each failing test in that spec. A single spec failing on multiple tests means one task with N subtasks.

5. **Generate one task per spec:**
   - **Task ID:** `TEST-{YYYY-MM-DD}-{spec-slug}` (e.g. `TEST-2026-05-31-monitoring-program-form`). Strip `.cy.ts`/`.cy.tsx` extension and slugify.
   - **Status:** `PLANNED`.
   - **Risk:** typically MEDIUM. Bumps to HIGH if the spec is in a path `governance.md` flags as critical (e.g. `cypress/e2e/critical/**`).

6. **For multi-project workspaces**, set `**Project:** {name}` per subtask. Cypress specs almost always belong to one frontend sub-project; identify it by the spec file's path.

7. **Surface the screenshots and logs.** If the MCP/run produced artifacts, capture paths in each subtask's body so the coder can inspect them without re-running.

8. **Use `plan-task`** to scaffold the two files. Update `tasks/README.md`.

9. **Report:** count of tasks created, classification breakdown (flaky / broken / test-wrong / pending), any quarantine candidates the user might want to triage immediately.

## Anti-patterns

- **One task per failing test.** Bundling per spec is the right unit — usually fixes share root cause.
- **Treating flaky as genuinely-broken.** A flaky spec that passes 9/10 runs isn't broken; it's brittle. Different acceptance criterion.
- **Recreating tasks for already-quarantined specs.** If a spec is in the quarantine list per `governance.md`, the task already happened. Surface the existing entry; don't recreate.
- **Skipping pending tests.** A `.skip`'d test is a debt marker, not noise. It belongs as a subtask with acceptance "implement or delete with rationale."

## Output

A `PLANNED` task at `tasks/active/TEST-{date}-{spec}/` with the two files + a row in `tasks/README.md`. Suggest `/tcgflow-code {ID}` to start fixing.

## Governance interaction

Specs under paths flagged in `governance.md` Project-Specific Rules (commonly `cypress/e2e/critical/**` for happy-path checkouts, auth flows, payment) get HIGH risk by default. The reviewer enforces this — they cannot mark such tasks VALIDATED without the spec actually passing.
