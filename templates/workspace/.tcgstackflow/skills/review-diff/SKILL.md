---
name: review-diff
description: Walk an `IN_REVIEW` task's diff against its acceptance criteria, the project's `governance.md`, and standard code-quality heuristics. Produce a verdict (`approved` | `needs-work`) plus a findings list, append a REVIEW entry to `TASK {ID}.md`, and update the top-level status. Used by the Reviewer agent. Never edits code — proposes changes back to the Coder.
---

# Review Diff

## When to use this skill

Invoke this skill when:

- A task's status is `IN_REVIEW` and you (as the Reviewer) are picking it up.
- You have access to the diff for the work — either the working tree, the staged changes, or the diff against a base branch (depending on how the task was scoped).
- You can run the project's tests and lint.

**Do not use this skill** to review tasks that aren't yet `IN_REVIEW`, or to edit code directly. The Reviewer proposes; the Coder implements.

## Instructions

You are walking a diff and deciding whether the task can move to `VALIDATED`. Hold the work to three contracts: (1) the subtask acceptance criteria, (2) `governance.md`, (3) baseline code quality.

### Procedure

1. **Read the contract.** Read `tasks/active/{ID}/TASK details {ID}.md` — identify every subtask's acceptance criterion. Read `tasks/active/{ID}/TASK {ID}.md` — note every recorded permission approval.
2. **Get the diff.** Determine the diff scope from the task (working tree / staged / branch diff). Use `git diff` for the appropriate range.
3. **Run tests and lint.** Whatever the project's standard commands are. Capture pass/fail and coverage of the acceptance criteria.
4. **Acceptance pass.** For each subtask, find the change in the diff that demonstrates the criterion. Note any criterion that lacks a corresponding change — that's a `blocker` finding.
5. **Governance pass.** Scan the diff for actions whose risk level is HIGH or CRITICAL per `governance.md` (migrations, auth/security edits, dependency installs, force pushes, CI/CD changes, deletions of significant files). For each, find a matching approval in the log. Unmatched action = `blocker`.
6. **Quality pass.** Walk the diff for:
   - Readability — naming, function length, nested complexity
   - Security — input validation, secret handling, authn/authz boundaries
   - Tests — exist for the acceptance criteria, actually exercise the behaviour (not just smoke "compiles")
   - Consistency — alignment with the wiki: use the `wiki-search` skill (qmd) to surface the feature / domain / architecture pages the diff actually touches (not only `wiki/architecture.md` + `wiki/domain.md`; `index.md` is the fallback when qmd is unavailable), e.g. uses the project's preferred naming, doesn't reintroduce a deleted concept
   - Cleanup pass — the Coder's diff leaves no imports or dead code *its own change* orphaned, no commented-out scratch; touched files are formatted. Missing cleanup is a `nit`/`major`, not a `blocker`.
   - Project rules — anything in `governance.md`'s Project-Specific Rules section
7. **Decide the verdict.**
   - **All criteria met + zero blockers** → verdict `approved`.
   - **Any blocker** → verdict `needs-work`. List blockers first, nits second.
8. **Append a REVIEW entry** to `TASK {ID}.md` using the shape below.
9. **Update status.**
   - `approved` → set top-level status to `IN_TEST` in both `TASK {ID}.md` and `TASK details {ID}.md`. Hand off to the **Tester** (`/tcgflow-test`) for dynamic verification before the task is `VALIDATED`.
   - `needs-work` → set status back to `IN_PROGRESS`, hand back to Coder.

### Output

A short message to the user summarising verdict + blockers (if any). Plus the REVIEW entry appended to the log and status updates on disk. The Reviewer never says "I've fixed it" — that's the Coder's job.

### Anti-patterns

- **Approving on green tests alone.** "Tests pass" ≠ "tests cover the acceptance criterion." Verify the tests actually exercise the behaviour.
- **Editing code yourself.** The Reviewer proposes via the findings list. The Coder implements the fix and re-submits for review.
- **Approving unapproved HIGH/CRITICAL actions.** If the log lacks a matching `governance:` block for a HIGH/CRITICAL change, that's a blocker regardless of code quality.
- **Burying blockers under nits.** Findings are ordered: `blocker`, then `major`, then `nit`. Don't make the Coder dig.
- **Scope drift.** If the diff contains changes the details file didn't anticipate, that's a `blocker` — kick back for re-planning, don't silently approve. **EXCEPTION — refactor-typed tasks** (from `/tcgflow-refactor` / the Refactorer): broad structural change is the intended scope, so it is **not** scope drift. For these, judge against **behavior-preservation** (suite green, public API unchanged unless the task says so) instead of feature acceptance, and rely on the **Tester** to confirm behavior is unchanged.

## REVIEW entry shape

Append to `## Implementation Log` in `TASK {ID}.md`:

```yaml
### REVIEW START
timestamp: '2026-05-30T16:45:00Z'
author: 'claude'
verdict: 'needs-work'                  # 'approved' | 'needs-work'
acceptance:
  - subtask: 'ES-6900-FE-1'
    criterion: 'frequency field added to yup schema with frequency options'
    met: true
    where: 'MonitoringProgramForm.vue:42-58'
  - subtask: 'ES-6900-FE-4'
    criterion: 'selecting schedule auto-populates frequency; no schedule allows manual pick'
    met: false
    where: 'MonitoringProgramForm.vue:142'
    note: 'watcher fires before schedules ref is populated — first render flickers'
governance_check:
  high_actions:
    - {action: 'pnpm install vee-validate@5', approved_in_log: true}
  critical_actions: []
  project_rules: 'no violations'
tests:
  status: 'green'
  coverage_note: 'unit tests cover ES-6900-FE-1 and -FE-3; ES-6900-FE-4 lacks a test for the empty-schedule path'
findings:
  - severity: 'blocker'
    where: 'ES-6900-FE-4 / MonitoringProgramForm.vue:142'
    issue: 'Auto-sync watcher fires before schedule list loads — frequency briefly flickers on first render'
    suggested_fix: 'Gate the watcher on the schedules ref being populated, or initialise from server-side hydration'
  - severity: 'major'
    where: 'ES-6900-FE-4 tests'
    issue: 'No test exercises the empty-schedule manual-pick path described in the acceptance criterion'
    suggested_fix: 'Add a unit test that mounts the form with no schedules and asserts the frequency dropdown is editable'
  - severity: 'nit'
    where: 'MonitoringProgramForm.vue:78'
    issue: 'Inline string "Recommended Frequency" should live in en.json'
    suggested_fix: 'Move to en.json under monitoringPrograms.fields.frequency.label and use $t()'
```

## Field reference

| Field | Notes |
|---|---|
| `verdict` | `approved` only when zero blockers and all acceptance criteria met. |
| `acceptance` | One entry per subtask. `met: false` items must appear in `findings` as blockers. |
| `governance_check` | List every HIGH/CRITICAL action in the diff and whether it has a matching approval in the log. |
| `tests` | Status + coverage note. "Coverage" here means "do tests exercise the acceptance criteria," not "what's the % line coverage." |
| `findings` | Ordered by severity: `blocker` → `major` → `nit`. Each has `where`, `issue`, `suggested_fix`. |
