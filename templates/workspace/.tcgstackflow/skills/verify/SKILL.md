---
name: verify
description: Build a test plan from a task's acceptance criteria, document it (or push it to Jira), run the verification (unit + E2E + app behavior), and record a pass/fail verdict in the task log. Used by the Tester agent on IN_TEST tasks. Does not edit production code — proposes fixes back to the Coder. Pushing the test plan to Jira is a HIGH action (approval-gated).
---

# Verify

## When to use this skill

Invoke when a task is `IN_TEST` (the Reviewer approved the code) and you (as the Tester) need to confirm it actually works against its acceptance criteria. Also use when the user says "test ES-1234", "verify this works", "run the E2E for X", "write a test plan for X".

**Do not use this skill** for static code review (that's `review-diff`) or to write production code (that's the Coder).

## Instructions

You verify behavior dynamically and produce a documented test plan. Acceptance criteria in `TASK details {ID}.md` are the oracle — a task passes only when each criterion is demonstrably exercised.

### Procedure

1. **Read the contract.** From `tasks/active/{ID}/TASK details {ID}.md`, list every subtask's acceptance criterion. If a Jira ticket is the source of truth, fetch it (Atlassian MCP) for the canonical criteria.

2. **Build the test plan.** One entry per criterion:
   - **method** — `unit` | `integration` | `e2e` | `manual`
   - **what to run** — the exact command or steps (per-project command from `config.yaml` in multi-project workspaces)
   - **expected** — the observable result that proves the criterion
   Cover the criterion's happy path *and* the edge it names (e.g. "no schedule → manual edit").

3. **Document the test plan.** Choose a destination:
   - **Documentation (default)** — record the plan in the `### TEST START` log entry; at task completion, propose a `wiki/testing/{ID}.md` page to the Ingester so it becomes durable wiki knowledge.
   - **Jira (opt-in, HIGH)** — push the plan to the Jira ticket (as a comment, or a Test/Xray issue if the project uses it) via the Atlassian MCP. This is a **HIGH external write** — issue the permission request per `governance.md` first, record approval, then push. Set `test_plan_location: 'jira:{ID}'`.

4. **Run the verification.**
   - Unit/integration: the project's (per-sub-project) `test` command.
   - E2E: Cypress (`cypress run --spec …`), reading results from the Cypress MCP if available.
   - Manual/behavior: launch the app and check what the suite can't (the `run` discipline — start it, exercise the path, observe).
   - Treat a flaky spec (passes on retry) as flaky, not failing — note it, propose quarantine/repair.

5. **Record results** in a `### TEST START` entry (shape in `agents/tester.md`): each criterion → pass/fail + evidence (command output, screenshot path, Cypress run id), plus the suites run.

6. **Verdict + hand-off.**
   - **Pass** (every criterion verified) → set status `VALIDATED`, hand to the Ingester.
   - **Fail** → set status `IN_PROGRESS`, hand back to the Coder with the failing criteria and evidence.

### Refactor-typed tasks (behavior-preservation oracle)

For a **Refactor** task (from `/tcgflow-refactor`, executed by the Refactorer) the oracle is **behavior-preservation**, not new acceptance behavior — you are the real gate that the broad change introduced no silent regression:

- **Run the full relevant suite and confirm it stays green with behavior identical to before the refactor.** The public API/contract is unchanged unless the task states otherwise.
- **Verify characterization/golden-master tests exist for areas that were under-covered before the refactor** — those tests *are* the oracle for a refactor. If the area had no safety net and none was written, you cannot prove behavior was preserved.
- A **behavior change** (or a **missing safety net** over a refactored area) is a **FAIL** → set status `IN_PROGRESS`, hand back to the Refactorer/Coder with the divergence (or the missing characterization coverage) and evidence.

### Anti-patterns

- **"Green suite" ≠ verified.** If the tests don't touch the acceptance criterion, the criterion is unverified — add coverage (and log it) or mark fail.
- **Editing production code to pass.** Propose the fix; the Coder owns it.
- **Silent Jira writes.** Pushing a test plan to Jira is HIGH — never without a recorded approval.
- **Blanket commands in multi-project workspaces.** Use the sub-project's own `test` command.
- **Bouncing on flake.** Distinguish flaky from failing; don't kick a task back for a retry-passing spec.
- **Passing a refactor because the suite is green without checking the suite actually covers the refactored behavior.** Under-covered refactors need characterization tests as the oracle — a green-but-blind suite proves nothing.

## Test-plan document shape (when filed to `wiki/` or Jira)

```markdown
# Test Plan — {TASK_ID}: {title}

| # | Criterion | Method | Command / Steps | Expected | Result |
|---|---|---|---|---|---|
| 1 | {acceptance criterion} | e2e | `pnpm cypress run --spec …` | {observable} | ✅ / ❌ |
| 2 | … | unit | `pnpm test:unit …` | … | … |

**Environment:** {local / which sub-project / browser}
**Run on:** {date} · **Verdict:** PASS / FAIL
```
