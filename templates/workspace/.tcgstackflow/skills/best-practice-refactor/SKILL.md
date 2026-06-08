---
name: best-practice-refactor
description: Improve code structure without changing behavior. Two scopes — the narrow "cleanup pass" the Coder runs on its own diff before handoff (remove orphaned imports/dead code, drop scratch, autofix touched files), and the broad refactor the Refactorer runs on demand against a target area (deduplication, cohesion, dead-code removal), guarded by characterization tests. Behavior-preservation is the contract: tests stay green, public API unchanged unless stated.
---

# Best-Practice Refactor

This skill has **two scopes**. Read the one that applies — they share heuristics but differ in breadth and authorization.

- **Cleanup pass** (mandatory, automatic, diff-scoped) — every Coder runs this before handing off. "Clean up after your own change."
- **Refactor** (broad, manual, gated) — the Refactorer runs this on demand via `/tcgflow-refactor`. "Improve a target area."

> **The line that reconciles this with the global minimal-change preference:** the cleanup pass touches only what *your change* wrote or orphaned — it is **not** "surrounding cleanup" or "refactors beyond the task." A broad refactor *is* surrounding work, which is exactly why it is its own explicitly-invoked task, never bundled into a feature.

---

## Scope A — Cleanup pass (Coder, every task, before `IN_REVIEW`)

### When to use

After a Coder's subtasks are Done, before setting status to `IN_REVIEW`. Mandatory.

### What it covers (diff-scoped only)

Run against **only the files this task touched**:

1. **Remove imports your change orphaned** — imports no longer referenced after your edits.
2. **Remove dead code your change created** — functions/branches/variables your change made unreachable or unused; commented-out scratch and `console.log`/debug left from iterating.
3. **Run the formatter/linter autofix on touched files only** — the project's `lint --fix` / formatter, scoped to changed files. Do **not** reformat untouched files or reorder imports in files you didn't edit.
4. **Tidy what you wrote** — obvious local readability fixes *within the lines you changed* (a clearer name, collapsing a needless temp). Nothing structural beyond the change.

### What it must NOT do

- Touch files the task didn't change.
- Refactor surrounding code, extract abstractions, or "improve while I'm here." That is a `/tcgflow-refactor` task, not a cleanup pass.
- Anything that alters behavior. The existing tests must stay green with no test changes needed for the cleanup itself.

### Log it

Note the cleanup in the task log (an `update-task-log` entry, `tags: [cleanup]`) — what was removed/autofixed — so the Reviewer can confirm it happened.

---

## Scope B — Broad refactor (Refactorer, `/tcgflow-refactor`, gated)

### When to use

The user explicitly asked for a refactor of a target area (a file, module, or directory) via `/tcgflow-refactor`. Executed by the **Refactorer** role.

### Contract: behavior-preservation

A refactor is correct only if **observable behavior is unchanged**: the test suite stays green, and the public API/contract is unchanged unless the proposed scope explicitly says otherwise. This is the acceptance oracle the Tester verifies.

### Procedure

1. **Survey read-only.** Search the target with `wiki-search` for relevant architecture/domain context, then read the code. Identify concrete opportunities:
   - Duplication past the rule-of-three (the project's own threshold; don't abstract two occurrences).
   - Dead code, unused exports, unreachable branches.
   - Import hygiene and obvious cohesion problems (a function doing three jobs, a module mixing concerns).
   - Naming that actively misleads.
   Skip "clever" rewrites and speculative abstraction — readability over cleverness.
2. **Check the safety net.** Determine whether the target has tests that exercise its current behavior.
   - **Adequately covered** → proceed.
   - **Under-covered** → **write characterization (golden-master) tests first** that capture current behavior, so there is an oracle to preserve against. Where characterization isn't feasible, **narrow the scope** to the covered parts and log the rest as "needs tests before it can be refactored." Never broad-refactor uncovered code on faith.
3. **Propose the task (approval gate).** Draft the two-file refactor task: scope, the enumerated opportunities as subtasks, and a **behavior-preservation acceptance** per subtask (plus "characterization tests added" where step 2 required them). Present it and **wait for explicit OK** before editing — this is the plan-before-code gate.
4. **Execute** one subtask at a time, logging YAML entries (`update-task-log`, `tags: [refactor]`). Keep each step behavior-preserving and runnable; run the suite frequently.
5. **Hand off** to the Reviewer (status `IN_REVIEW`). The Refactorer never self-approves.

### Anti-patterns

- **Refactoring without a safety net.** Under-covered target → characterization tests first, or narrow scope. No exceptions.
- **Smuggling behavior changes** into a refactor. If behavior should change, that's a feature task for the Planner/Coder, not a refactor.
- **Scope creep beyond the approved task.** The approved subtask list is the contract; new opportunities found mid-refactor are logged for a follow-up, not silently added.
- **Premature abstraction.** Three similar lines beat a wrong abstraction. Honor the rule-of-three.
