---
name: frame-feature
description: Interview the user about a feature that has no ticket behind it — read the wiki via qmd before asking anything, settle the problem and who has it and why now, check the user's wording against `wiki/domain.md`, produce a mandatory out-of-scope list and one checkable success measure, and record the decisions the framing settled (optionally as approved, intent-marked writes to `wiki/domain.md`, `wiki/architecture.md` and `wiki/adr/`) — until there is a brief whose acceptance criteria `grill-task` can drill into. Use when the user says "new feature", "start a new feature", "frame this idea", "I want to build X", "what should we build". Interactive sessions only — every step is a question a human has to answer.
---

# Frame Feature

The first stage of `/tcgflow-new-feature`, which dispatches `frame-feature` → `grill-task` →
`plan-task`. This skill covers what `grill-task` assumes: `grill-task` drills an agreed problem down
to per-subtask acceptance criteria and takes the problem, the audience and the scope boundary as
already settled. Everything before that line belongs here.

## When to use this skill

Invoke this skill when:

- There is an idea and no ticket — *"we should let people bulk-export reports"* — and nothing
  downstream can act on it yet.
- A conversation has produced something worth building and nobody has written down what it is, who
  it is for, or where it stops.
- An existing task is about to be widened into what is really a new feature.

**Do not use this skill** when a Jira ticket already exists — that is `/tcgflow-plan`, and the
ticket is the source of truth. Not for a tool finding either: the `task-from-*` family already
starts from Snyk, Cypress and Datadog, and those sources carry the framing this skill exists to
elicit. To re-scope a task that is already written, use `plan-task`'s refine-existing branch, which
edits it in place.

## Interactive only

**A human must answer the questions.** This skill runs in an interactive session only — the same
rule the browser web test follows (ADR 0041), for the same kind of reason. In a headless
orchestrated run there is nobody to answer, and a brief assembled from answers the AI supplied
itself is worse than no brief: it reaches `PLANNED` looking agreed. Discovery is not an orchestrated
role action, and the Cockpit's `DRAFT → planner` mapping is unchanged — `DRAFT` still has no
producer.

If a run reaches this skill with no human on the other end, stop and say so. Never invent the user's
answers, and never write the task files "for the user to correct later".

## Instructions

You are interviewing the user to turn an idea into a brief. What you are after is a **problem
someone else can recognise**, a **boundary someone else can respect**, and a **success measure
someone can check after shipping** — not a design.

The Planner runs this skill, with one bounded exception to its no-wiki-edits guardrail — see the
[wiki intent-write protocol](#wiki-intent-write-protocol).

### Procedure

1. **Read before asking.** Query qmd for the topic via the `wiki-search` skill, read the hits, and
   follow their `[[wikilinks]]` one hop — never hand-grep the wiki (`wiki/index.md` is the fallback
   when qmd is unavailable). Read `governance.md`, so the brief can flag HIGH/CRITICAL work while it
   is still cheap to reconsider. Scan `tasks/active/` for overlapping work and **surface any overlap
   before continuing** — an in-flight task that already covers half of this changes the
   conversation. Never ask the user for something that is already in writing.
2. **Frame the problem.** What problem, for whom, why now. One topic per turn. "Why now" is not
   filler — a feature nobody is blocked on today usually has a cheaper version worth naming.
3. **Terminology check.** Compare the user's wording against `wiki/domain.md`. Where the project
   already has a word for the thing, propose that word and **say which page it comes from**. Where
   the feature genuinely introduces a new term, flag it as a candidate `domain.md` addition and
   carry it to step 6. A feature that ships under a second name for an existing concept forks the
   concept.
4. **Scope.** Produce an explicit **IN** list and an explicit **OUT** list. The OUT list is a
   **required output** — "we are not doing X in this task" is the single most useful line in the
   file, because it is the line review and the Coder both come back to. An empty OUT list is not a
   small scope, it is a scope nobody examined: go back and draw the boundary.
5. **Success measure.** One statement that could actually be checked after shipping. "Users are
   happier" is not one. "A 500-report bundle exports without the request timing out" is.
6. **Decisions ledger.** Collect the architectural decisions the framing settled, one line each,
   with the wiki page or ADR each one implies. Draft the wiki writes now, while the reasoning is
   fresh; apply them in step 7, because the intent marker is keyed on a task ID that does not exist
   yet.
7. **Hand off, in this order:**
   1. `grill-task` — per-criterion detail on the brief below. The acceptance criteria you hand over
      are **derived** from the step-4 scope and the step-5 success measure, never invented: present
      the numbered list for confirmation as `grill-task`'s first turn, before drilling any of them.
      A criterion the user has not seen is not a criterion to sharpen.
   2. The [Jira hand-off gate](#jira-hand-off-gate) — this settles the ID. Nothing is written to
      disk before it.
   3. The approved wiki writes from step 6, plus the `wiki/log.md` entry, per the
      [wiki intent-write protocol](#wiki-intent-write-protocol).
   4. `plan-task` — the two files at `PLANNED`. If discovery revealed independently shippable
      slices, run the [splitting protocol](#splitting-protocol) first.

### The question format

Questions follow `grill-task`'s existing format, with one addition: the recommended answer is
grounded in what you read in step 1, and it names the source.

> **Question N — {one-line topic}**
>
> {the question, asked plainly}
>
> **My recommended answer:** {your best guess at what the user would say, and why — cite the wiki
> page, the neighbouring feature, or the in-flight task it comes from}
>
> Push back if I'm wrong; otherwise just say "yes" or pick one of (a)/(b)/(c).

One topic per turn. A topic with several independent sub-decisions — four candidate exclusions,
three formats, five surfaces — is bundled under one question as a numbered list, with "say 'all out'
to confirm, or pull one back in". Never mix unrelated topics in one turn.

### When to stop asking

Stop when all six are settled, and not one question later:

| Settled | Looks like |
|---|---|
| Problem and audience | One paragraph naming who is blocked today and what they do instead |
| Terminology | Every noun in that paragraph is either already in `wiki/domain.md` or flagged as a new term |
| Scope | An IN list, and an OUT list with something on it |
| Success measure | One sentence someone could check a month after shipping |
| Decisions | Each architectural choice the framing settled, with the page or ADR it implies |
| Acceptance criteria | A numbered list the user has seen — derived from the scope and the success measure, put in front of them, not written past them |

Two failure modes, both common. Stopping early leaves an empty out-of-scope list. Running long turns
discovery into design: once you are asking which component owns the state, you are doing
`plan-task`'s job in a conversation that does not produce files.

If the user gets impatient, do what `grill-task` does — summarise what is still open, park it under
**Open questions**, and move to the hand-off. A parked question in writing beats an answer extracted
under protest.

## Output

The brief handed to `grill-task`. Five sections, all of them:

| Section | What goes in it |
|---|---|
| **Summary** | One paragraph. The last sentence is the success measure from step 5. |
| **Acceptance criteria** | Numbered. Each one a checkable condition, not a restatement. |
| **Out of scope** | Bulleted, each with the half-line reason it was excluded. Never empty — see step 4. |
| **Decisions** | One line each, with the wiki page or ADR it implies. |
| **Open questions** | Anything deliberately deferred. |

Whether each write was approved, declined or deferred is **not** in the brief — the brief is written
at step 7.1 and the writes are proposed at 7.3, so that outcome does not exist yet. It is recorded in
the step-7.3 `wiki/log.md` entry.

`grill-task` drills the criteria, the Jira gate assigns the ID, and `plan-task` writes it:
**Summary** → `## Overview`, **Acceptance criteria** → the feature-level `## Acceptance Criteria`,
**Out of scope** → `## Out of scope`, **Open questions** → `## Open Questions`.

## Wiki intent-write protocol

This skill may write **`wiki/domain.md`, `wiki/architecture.md`, and new files under `wiki/adr/`**,
plus the append-only `wiki/log.md` entry step 3 requires. It may not write any other path under
`wiki/`, and it may not write source code. Until now the
Ingester was the wiki's only writer, and that is what let a reader treat every page as observed
reality; these five steps are what keep the exception recoverable (ADR 0045).

1. **Per-page approval.** Propose each page edit with its diff and write only on an explicit yes.
   `governance.md` rates a wiki edit LOW; this is deliberately stricter, because the content is
   speculative rather than observed.
2. **Intent marker.** Wrap every inserted block:

   ```markdown
   <!-- intent: ES-7132 (not shipped) -->
   Exports are queued through the job runner rather than served inline.
   <!-- /intent: ES-7132 -->
   ```

   **Never place a block first.** Put it inside the section it belongs to, never as the page's
   first block after the H1: the structure check reads that block as the page's summary and an HTML
   comment does not trip its reject list (`init.js:1608`), so a leading intent block silently
   becomes the lead paragraph qmd embeds as the page's first chunk.

   An ADR written during discovery carries `status: stub` in its frontmatter plus the same marker.
   The workspace ADR format (`wiki/adr/README.md`) puts status in frontmatter alongside `title`,
   `summary` and `tags: [decision, …]`, and the taxonomy is `current | stub | archived` — there is no
   `proposed`. `stub` is the honest value: the decision is written down but not yet observed reality.
3. **Log it.** One `wiki/log.md` entry per discovery session. `wiki/log.md` **locks** the entry
   prefix to `## [YYYY-MM-DD] {operation} | {title}` so simple tools can `grep "^## \["` it, and
   locks the five sections to Context / Created / Modified / Deleted / Decision. Your `{operation}`
   is `frame-feature`. Honour both — this entry is what the Ingester reads:

   ```markdown
   ## [2026-09-09] frame-feature | ES-7132 Report Bundle export

   **Context:** Discovery session for on-demand CSV export of a Report Bundle. Nothing is shipped.

   **Created:**
   - `wiki/adr/0012-exports-go-through-the-job-runner.md` — `status: stub`, intent-marked

   **Modified:**
   - `wiki/domain.md` — Report Bundle entry gains "a bundle of one report is legal" (intent-marked)
   - `wiki/architecture.md` — export path queued through the job runner, not served inline (intent-marked)

   **Deleted:** _(none)_

   **Decision:** Exports queue through the job runner rather than serving inline.
   **Reconciliation owed:** at `INGESTED` the Ingester drops or corrects every intent block for
   ES-7132 listed above, and flips the ADR to `status: current` or deletes it (ADR 0045).
   ```

   The **Reconciliation** line is not decoration — spell the obligation out in the entry itself, every
   time. `upgrade` adds new skills additively and never overwrites an existing one, so a workspace can
   receive `frame-feature` while keeping an older `ingest` with no reconciliation step; the log entry
   is then the only thing that tells whoever ingests the task that these blocks are owed a pass.

4. **Leave the index fresh.** Bump the `updated:` frontmatter on `domain.md` and `architecture.md` as
   you write them — both carry one, and `ingest` bumps it on every page it touches for the same
   reason (a new ADR's `updated:` is optional per `wiki/adr/README.md`). Then, after the log entry,
   run an incremental `qmd embed` so qmd reflects the changed pages. ADR 0030's invariant is that the
   writer re-indexes; a second writer that skips it leaves the mandatory `wiki-search` layer serving
   the pre-discovery text for exactly the pages discovery just changed. If qmd is unavailable, note
   it — `index.md` stays the fallback.

5. **The Ingester reconciles.** At `INGESTED`, `ingest` finds every intent block for the task —
   `grep -rn "intent: {ID}" wiki/`, unanchored so it matches the opener's `(not shipped)` suffix as
   well as the closer — and either drops the markers (what shipped matches what was framed) or corrects the page
   to what actually shipped; a `stub` ADR becomes `current`, or is deleted if what shipped went
   another way. That is the only thing that turns these blocks back into fact, and nothing else
   catches a block you left unmarked — `lint-wiki` has no detector for intent, deliberately
   (ADR 0045). Which is why the marker and the log entry are not optional.

## Jira hand-off gate

After discovery, **before any file is written**:

1. **Preview the issue.** Show what would be created — project key, summary, description, the
   acceptance criteria list. The user reads what would be created, not a description of it.
2. **Ask.** Creating a Jira issue is an outward-facing write and classifies **HIGH**
   (`governance.md`: "update a Jira ticket"). Use the standard permission-request format:

   > **Action:** Create Jira issue in `{PROJECT}` — {summary}
   > **Risk:** HIGH
   > **Why:** the brief is settled and the returned key becomes this task's ID
   > **Files/systems affected:** one new issue in Jira project `{PROJECT}`; nothing on disk yet
   > **Rollback:** delete or close the issue in Jira; the local task folder is written after this
   > step, not before
   >
   > Approve?

3. **On approval,** create it via the Atlassian MCP and use the **returned key** as the task ID.
4. **On decline, or an unreachable MCP,** fall back to `FEAT-{slug}` — a short kebab slug of the
   feature name, e.g. `FEAT-bulk-report-export` — and note in the details file's `## Context` that no
   Jira key is attached. Discovery does not block on MCP availability.
5. **Project key** is inferred from the most common prefix already present in `tasks/` and confirmed
   in the prompt. There is no `config.yaml` field for it.
6. **Backfill the approval.** `governance.md` requires the approval to be recorded in the relevant
   `TASK {ID}.md`, and this gate fires before that file exists. So it is backfilled: once `plan-task`
   has written `TASK {ID}.md`, append an entry via the `update-task-log` skill whose `governance:`
   field carries the user's verbatim approval and the created issue key — or, on a decline, the
   decline and the `FEAT-{slug}` fallback that replaced it. The gate is not closed until that entry
   is on disk; a HIGH action with no entry is a HIGH action with no audit trail.

**Never fabricate.** The refuse-don't-fabricate rule from `/tcgflow-plan` applies unchanged in the
other direction: never invent a Jira key, and never claim an issue was created when the MCP call did
not succeed. Say the call failed and use the fallback ID.

## Splitting protocol

Default: **one task**, lanes as usual. Ordinary multi-lane work — an FE slice, a BE slice, a
migration — ships as one unit and stays one task.

When discovery reveals genuinely independently shippable slices, stop and propose the split: the
slices, a suggested order, and the dependency between them. Write N sibling task folders **only on
approval**. Each slice after the first carries `Stacked on: {previous-ID}` as a field line directly
under `Status:`, and links the slice below it in `## Context`. Nothing reads `Stacked on:` yet — it
is recorded now so PR stacking can consume it later.

Never split silently. A split the user did not agree to fragments one feature across folders that
each look half-planned.

## Anti-patterns

- **Asking what the wiki already answers.** Step 1 exists so the user never has to repeat something
  already in writing. A question qmd would have answered costs the patience the real questions need.
- **A question with no recommended answer.** Make the user confirm, not brainstorm. A recommendation
  you got wrong is more useful than an open prompt — it tells the user exactly what to correct.
- **Inventing a term the project already has a word for.** Check `wiki/domain.md` and name the page
  the word comes from.
- **An empty out-of-scope list.** If nothing was excluded, the scope was not examined. That is a
  failed discovery, not a small feature.
- **A wiki write without per-page approval, without the intent marker, or without the log entry.**
  All three, every time, or the Ingester has nothing to reconcile and a speculative block is
  indistinguishable from observed fact. Writing anywhere under `wiki/` other than `domain.md`,
  `architecture.md` and `adr/` is out regardless, and source code is the Coder's.
- **Handing `plan-task` an acceptance criterion that is a restatement.** "It works", "the export is
  fast" — a criterion nobody can check is a criterion nobody will check.
- **Writing files before the Jira gate.** The gate settles the ID; a file written first is a file
  written under the wrong name. And a Jira issue created before the brief is settled is an
  outward-facing write with nothing behind it yet.
- **Designing the implementation.** Which component owns the state is `plan-task`'s question.
  Framing that keeps going becomes a design nobody wrote down.

## Example interaction

The user opened with *"let people bulk-export reports"*. Before the first question, qmd surfaced
`wiki/domain.md` (which defines **Report Bundle**) and `wiki/architecture.md` (which has a job-runner
section), and `tasks/active/` showed no overlap.

> **Question 2 — What we call this**
>
> You said "bulk export". `wiki/domain.md` already defines **Report Bundle** — a set of reports
> selected together and rendered as one artifact. Is a bulk export a Report Bundle delivered as a
> file, or a genuinely different thing?
>
> **My recommended answer:** the same thing. Use **Report Bundle** throughout and call the feature
> "Report Bundle export" — the selection rules and permission checks already documented on that page
> apply unchanged, and a second name would fork them.
>
> Push back if I'm wrong; otherwise just say "yes".

User: "yes, same thing — but the export can be a bundle of one."

→ Recorded as a decision, and drafted as a one-line `wiki/domain.md` addition to be offered under
the write protocol once the ID exists.

> **Question 4 — The scope boundary**
>
> These are the four things I'd keep out. Say "all out" to confirm, or pull one back in.
>
> 1. Scheduled or recurring exports — on demand only.
> 2. Formats beyond CSV and PDF.
> 3. Emailing the finished file — the user downloads it from the notification.
> 4. Exports spanning more than one workspace.
>
> **My recommended answer:** all four out. Each is independently shippable, and 1 and 3 both depend
> on notification work that doesn't exist yet.

User: "all out — and PDF is out too, CSV only for v1."

→ **Out of scope** gains five bullets, and acceptance criterion 2 reads: *"Exporting a Report Bundle
of any size produces exactly one CSV file; no other format is offered in the UI or accepted by the
API."*

The success measure that closed the interview: *"A 500-report bundle exports without the request
timing out — the request returns in under two seconds and the file arrives via notification within
ten minutes."* That sentence became the last line of the Summary, and the reason
`wiki/architecture.md` got the intent-marked line about queueing exports through the job runner.
