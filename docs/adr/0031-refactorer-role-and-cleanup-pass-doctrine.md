# Coders always do a diff-scoped cleanup pass; a new manually-invoked Refactorer owns broad refactors

The user wants two things that, taken naively, contradict the project's own doctrine: (1) Coders should *always* tidy up at the end of a task, and (2) there should be a way to run a broad "best-practice" refactor on demand. But the **global** `preferences.md` says "don't add features, refactors, or new abstractions beyond what the task requires" and "a bug fix doesn't need surrounding cleanup," and the `review-diff` skill treats unanticipated diff changes as a **blocker**. This ADR resolves the conflict by splitting the request along **scope and authorization**.

## Design

**Cleanup pass — mandatory, automatic, diff-scoped (Coder).**
Every Coder, before handing off to the Reviewer, leaves *its own* changed files clean: removes imports and dead code *its change* orphaned, drops commented-out scratch, and runs the formatter/linter autofix on **touched files only**. This is "clean up after your own change," explicitly **not** "surrounding cleanup" or refactoring beyond the task — so it coexists with the global minimal-change preference rather than overturning it. The `preferences.md` and Copilot "Prime Directives" lines are clarified (not deleted) to draw this line. The **Reviewer verifies** the cleanup happened, as a quality-pass item.

**Refactor — broad, behavior-preserving, manually invoked (Refactorer).**
A new sixth role, `refactorer`, performs structural improvement beyond any single feature task. It is *not* a stage in the linear lifecycle — it's an on-demand executor (peer to the Coder), triggered by **`/tcgflow-refactor`**. It:
1. surveys the target read-only and **proposes a two-file refactor task** (scope + behavior-preservation acceptance per subtask) — an approval gate before any edit;
2. **writes characterization/golden-master tests first** when the area is under-covered (narrowing scope and logging "needs tests first" where it can't);
3. executes the refactor, logging YAML entries like any Coder;
4. hands off to **Reviewer → Tester → Ingester** — it never self-approves.

Because the broad change is *explicitly requested*, it is never "silent scope expansion": for **refactor-typed tasks the Reviewer's scope-drift blocker is relaxed**, the acceptance oracle becomes **behavior-preservation** (tests green, public API unchanged unless stated), and the **Tester is the real gate**.

One skill, **`best-practice-refactor`**, holds the refactor heuristics; its narrow "leave-it-clean" subset is what the mandatory Coder cleanup pass reuses.

## Considered options

- **(A) Diff-scoped mandatory cleanup + separate manual Refactorer** — *chosen*. Satisfies "always tidy" without violating minimal-change, and quarantines broad refactors behind explicit invocation + the full review/test gates.
- **(B) Make every Coder do a broad best-practice refactor at end of task** — rejected: directly contradicts the global preference, makes every feature diff unreviewable for scope, and trips the Reviewer's blocker on every task.
- **(C) A skill on the Coder, no new role** — viable and lighter, but the user chose a dedicated role for clear ownership and guardrails; the cost is wiring the sixth role through CONTEXT.md, the lifecycle, `init.js`, and the three tool adapters.
- **(D) Free-running refactor utility that skips review/test** — rejected: a broad refactor is the operation *most* likely to introduce silent regressions; it must go through the gates.

## Consequences

- New role `refactorer` is registered in CONTEXT.md's roster, the lifecycle description, `init.js`, and all three tool adapters' role tables. It is documented as **non-linear** (re-enters at Reviewer).
- New command `/tcgflow-refactor` (workspace command count 16 → 17) and new skill `best-practice-refactor`; the `wiki-search` addition brings the starter skill set up accordingly.
- `coder.md` gains a cleanup-pass step before `IN_REVIEW` and a matching guardrail; `review-diff`/`reviewer.md` gain a cleanup verification item and a "scope-drift blocker is relaxed for refactor-typed tasks" rule; `tester.md`/`verify` gain the behavior-preservation oracle and characterization-tests-first expectation.
- Global `preferences.md` and the Copilot Prime Directives are edited to **distinguish** "clean up after your own change" (required) from "surrounding cleanup / refactors beyond the task" (still discouraged) — keeping the minimal-change ethos intact.
- CONTEXT.md gains the **Refactorer** term and the **Cleanup pass vs Refactor** distinction.
