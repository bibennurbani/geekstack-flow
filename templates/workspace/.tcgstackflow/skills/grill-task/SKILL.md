---
name: grill-task
description: Interview the user about an ambiguous task or idea until every subtask has clear acceptance criteria. Use whenever the Planner is about to write `TASK details {ID}.md` and any subtask's success condition is uncertain. Asks one question at a time, waits for the answer, and proposes a recommended answer with each question so the user can confirm-and-move-on instead of starting from scratch.
---

# Grill Task

## When to use this skill

Invoke this skill when:

- The Planner has a ticket or idea but the acceptance criteria for one or more subtasks are unclear.
- A teammate has handed off a half-baked plan and you need to fill in the gaps before coding starts.
- You're about to write a speculative subtask and you don't know how to verify it's done.

**Do not use this skill** for trivial tasks where the spec is already complete, or for review work — that's the Reviewer's job.

## Instructions

You are interviewing the user to resolve ambiguity before any code is written. Your goal is **shared understanding**, captured concretely in subtask acceptance criteria.

### Procedure

1. **Read the input.** Read the ticket/idea, the wiki pages it touches, and any related in-flight tasks under `tasks/active/`. Don't ask the user to repeat anything that's already in writing.
2. **List the gaps.** Privately, enumerate every ambiguous decision branch — UX choices, data shape, error handling, edge cases, downstream impact, success measurement.
3. **One topic per turn — but a topic may have several independent sub-decisions** that the user can accept or reject line by line. If you have one big design question (e.g. "what's the migration topology?"), ask it as a single question. If you have six small per-folder decisions (e.g. "what to do with `claude/`, `codex/`, `github/`, `continue/`, `agents/`, `idea/`"), bundle them under one topic with a numbered list and tell the user "say 'all yes' to confirm, or push back per line." Never mix unrelated topics in one turn.
4. **Propose your recommended answer with every question (or sub-decision).** A grill is faster when the user can confirm-and-move-on. Format for a single question:

   > **Question N — {one-line topic}**
   >
   > {the question, asked plainly}
   >
   > **My recommended answer:** {your best guess at what the user would say, and why}
   >
   > Push back if I'm wrong; otherwise just say "yes" or pick one of (a)/(b)/(c).

5. **Stop when every subtask has a clear acceptance criterion.** Not before, not long after. If the user gets impatient, summarise what's still open and offer to defer specific branches to follow-up tasks.

### Output

When grilling is complete, output:

- **Resolved questions** — a short list of decisions, one line each, that the Planner will encode into the details file's subtasks.
- **Deferred** — any branches the user explicitly punted to a follow-up task.
- **Acceptance criteria draft** — for each subtask, one sentence that states what would prove it's Done.

The Planner takes this output and uses the `plan-task` skill to write `TASK details {ID}.md`.

### Anti-patterns

- **Yes/no questions without recommendations.** Force the user to say "yes" — don't make them brainstorm.
- **Asking what the wiki already answers.** Read first.
- **Three questions in one bullet list.** One question at a time.
- **Speculative branches.** If a question is "what if X happens?" and X isn't likely, skip it. The Reviewer will catch real gaps; you're catching plan-time gaps.
- **Treating the user as the spec.** If the user is genuinely uncertain, surface that uncertainty in the details file's `Open Questions` section instead of inventing an answer.

## Example interaction

> **Question 1 — Edge case for empty schedule**
>
> When the user opens the Monitoring Program form and no Schedule has been selected, what should the Recommended Frequency dropdown show?
>
> **My recommended answer:** Show the dropdown as empty and editable — the user can pick a frequency manually. Auto-sync only kicks in when a Schedule is selected. This matches the existing behaviour for other auto-synced fields in the form.
>
> Push back if I'm wrong; otherwise say "yes" or describe the desired behaviour.

User: "yes"

→ Subtask `ES-6900-FE-4`'s acceptance criterion now reads: *"With no Schedule selected, the frequency dropdown is empty and user-editable. Selecting a Schedule auto-populates frequency; auto-population can be manually overridden."*

## Templates

_(Optional `examples/` and `templates/` folders can hold full example grilling sessions or domain-specific question banks. None ship in V1.)_
