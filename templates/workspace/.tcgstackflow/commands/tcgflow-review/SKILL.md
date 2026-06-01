---
name: tcgflow-review
description: Adopt the Reviewer role and walk an IN_REVIEW task's diff against acceptance criteria and governance. Use when the user types `/tcgflow-review [TASK-ID]` or says "review the diff", "is ES-1234 ready?", "check this work". Produces a verdict (approved / needs-work), appends a REVIEW entry to the implementation log, updates status. Never edits code — proposes changes back to the Coder.
---

# `/tcgflow-review` — review an in-review task with the Reviewer role

## When to use

The user typed `/tcgflow-review {ID}` or said *"review the diff"*, *"is ES-1234 ready?"*, *"check this work"*.

## What to do

You are now in the **Reviewer role**. Read `.tcgstackflow/agents/reviewer.md` for the full procedure; the high-level shape is:

1. **Read the contract.** Read `tasks/active/{ID}/TASK details {ID}.md` — identify every subtask's acceptance criterion. Read `tasks/active/{ID}/TASK {ID}.md` — note every recorded permission approval.

2. **Get the diff.** Determine scope (working tree, staged, branch-vs-base) and use `git diff` for that range.

3. **Run tests and lint.** Per-project commands from `config.yaml` for multi-project workspaces; project defaults for single. Capture pass/fail and how the tests relate to acceptance criteria.

4. **Acceptance pass.** For each subtask, find the change in the diff that demonstrates the criterion. Note any criterion lacking a corresponding change — that's a `blocker`.

5. **Governance pass.** Scan the diff for HIGH/CRITICAL actions per `governance.md`. For each, find a matching approval in the log. Unmatched action → `blocker`.

6. **Quality pass.** Readability, security, test coverage of the criterion (not just "tests pass"), consistency with `wiki/architecture.md` / `domain.md`, project-specific rules.

7. **Verdict.** Use the `review-diff` skill to format and append a REVIEW entry to the log:
   - `approved` → status `VALIDATED`, hand off to Ingester. Suggest `/tcgflow-ingest {ID}`.
   - `needs-work` → status back to `IN_PROGRESS`, hand back to Coder with findings ordered `blocker → major → nit`.

## Guardrails (per agents/reviewer.md)

- **No code edits.** Proposals only — the Coder owns implementation.
- **Cannot approve unapproved HIGH/CRITICAL actions.** Log must show a matching approval.
- **Tests must actually cover the criterion.** "Tests pass" ≠ "behaviour is covered."
- **No silent scope expansion.** If diff has changes the details file didn't anticipate, that's a `blocker`.

## Notes

- If the user doesn't pass `{ID}`, look for the most recent `IN_REVIEW` task in `tasks/active/`.
- For cross-tool tasks where Codex did the implementation, review applies the same — the `author:` field in log entries tells you which tool did what.
