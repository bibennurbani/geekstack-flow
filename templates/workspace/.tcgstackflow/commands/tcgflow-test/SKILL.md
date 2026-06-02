---
name: tcgflow-test
description: Adopt the Tester role and dynamically verify an IN_TEST task — build a test plan from acceptance criteria, document it (or push to Jira), run unit/E2E/app verification, and record a pass/fail verdict. Use when the user types `/tcgflow-test [TASK-ID]` or says "test ES-1234", "verify this works", "run the E2E", "write a test plan for X". Pass → VALIDATED (Ingester); fail → IN_PROGRESS (Coder).
---

# `/tcgflow-test` — verify a task with the Tester role

## When to use

The user typed `/tcgflow-test {ID}` or said *"test ES-1234"*, *"verify this works"*, *"run the E2E for X"*, *"write a test plan"*. Typically after `/tcgflow-review` approved the code (status `IN_TEST`).

## What to do

You are now in the **Tester role**. Read `.tcgstackflow/agents/tester.md` for the full procedure; the shape is:

1. **Verify readiness** — status should be `IN_TEST`. If it's still `IN_REVIEW`, run `/tcgflow-review` first; if `IN_PROGRESS`, it's not ready.
2. **Build the test plan** from the task's acceptance criteria (the oracle) using the `verify` skill — one check per criterion, with method (unit/integration/e2e/manual), command, and expected result.
3. **Document the test plan** — default to the task log (+ propose a `wiki/testing/{ID}.md` page at completion). To push it to **Jira**, that's a HIGH action: issue the `governance.md` permission request first, then push via the Atlassian MCP.
4. **Run the verification** — per-project `test` command (multi-project: the right sub-project), Cypress for E2E, launch the app for behavior the suite can't cover.
5. **Record a TEST entry** with each criterion's pass/fail + evidence, and the suites run.
6. **Verdict:**
   - **Pass** → status `VALIDATED`, hand to the Ingester (suggest `/tcgflow-ingest {ID}`).
   - **Fail** → status `IN_PROGRESS`, hand back to the Coder with failing criteria + evidence.

## Guardrails (per agents/tester.md)

- **No production-code edits** — propose fixes to the Coder. May add missing *test* coverage (and log it).
- **Acceptance criteria are the oracle** — "suite green" isn't enough if it doesn't exercise the criterion.
- **Per-project commands** in multi-project workspaces.
- **HIGH actions gated** — Jira push / shared-env runs need a recorded approval.
- **Flaky ≠ failing** — note flakes, propose quarantine, don't bounce the task for a retry-passing spec.

## Notes

- Lifecycle: `IN_PROGRESS → IN_REVIEW (review-diff) → IN_TEST (verify) → VALIDATED (ingest)`. The Tester is the dynamic gate after the Reviewer's static gate.
- If the user doesn't pass `{ID}`, pick the most recent `IN_TEST` task in `tasks/active/`.
