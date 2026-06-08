---
name: tcgflow-refactor
description: Adopt the Refactorer role and perform a broad, behavior-preserving refactor of a target area. Use when the user types `/tcgflow-refactor [path or area]` or says "refactor the monitoring-program module", "clean up the auth service", "do a best-practice refactor of X". Surveys the target read-only, proposes a refactor task for approval, writes characterization tests where coverage is thin, then executes behavior-preservingly and hands to the Reviewer → Tester → Ingester. Does NOT change behavior or add features.
---

# `/tcgflow-refactor` — broad behavior-preserving refactor with the Refactorer role

## When to use

The user typed `/tcgflow-refactor {path-or-area}` or said *"refactor X"*, *"do a best-practice refactor of the payment module"*, *"clean up this service's structure"*.

This is the **manual, broad refactor** — distinct from the Coder's automatic per-task **cleanup pass** (which tidies only the diff a feature task touched). Reach for this when you want surrounding structural improvement of an area, on its own, gated by review and tests.

## What to do

You are now in the **Refactorer role**. Read `.tcgstackflow/agents/refactorer.md` for the full procedure; the high-level shape is:

1. **Survey read-only.** Use the `wiki-search` skill (qmd) to pull architecture/domain context for the target, then read the code. Enumerate concrete opportunities (duplication past rule-of-three, dead code, unused exports, cohesion/naming). **No edits yet.**

2. **Check the safety net.** Does the target have tests covering its current behavior?
   - Covered → proceed.
   - Under-covered → plan **characterization (golden-master) tests first**; where infeasible, **narrow scope** to covered parts and log the rest as "needs tests before refactor."

3. **Propose the refactor task (approval gate).** Write the two-file task (`TASK details {ID}.md` + `TASK {ID}.md`) with scope, opportunities as a flat subtask list, and a **behavior-preservation acceptance** per subtask. Set `PLANNED`, add the `tasks/README.md` row, and **wait for explicit OK before editing any source.**

4. **Execute** (status `IN_PROGRESS`) one subtask at a time via the `best-practice-refactor` skill (Scope B): characterization tests where needed, then the structural change, keeping the suite green at each step. Append a YAML log entry per step (`tags: [refactor]`).

5. **Surface HIGH/CRITICAL actions** as permission requests per `governance.md` before taking them.

6. **When all subtasks are Done**, set status `IN_REVIEW`, flag it as a **refactor-typed task**, and hand off — suggest `/tcgflow-review {ID}`.

## Guardrails (per agents/refactorer.md)

- **Behavior-preservation is the contract.** Tests stay green; public API unchanged unless the approved scope says so. Behavior changes belong in a feature task, not here.
- **No refactor without a safety net.** Under-covered code → characterization tests first, or narrow scope.
- **Approval before editing.** Read-only survey + proposed task first; no edits until the user OKs.
- **Stay in the approved scope.** Mid-refactor discoveries are logged for a follow-up, not silently added.
- **No self-approval.** Hand to the Reviewer; the Tester confirms behavior is preserved before `VALIDATED`.
- **Two-file rule strict.** Append, never split.

## Notes

- If the user doesn't pass a target, ask which file/module/area to refactor before surveying. Don't refactor the whole repo by default.
- For refactor-typed tasks the **Reviewer relaxes its scope-drift blocker** (broad change is the point) and judges against behavior-preservation; the **Tester is the real gate**.
- A refactor flows through the same lifecycle as code work (`IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED`) — the Refactorer just replaces the Coder as the executor.
