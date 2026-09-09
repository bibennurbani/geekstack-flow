# New-feature discovery — `/tcgflow-new-feature`

Status: approved 2026-09-09 · ADR: [0045](../adr/0045-discovery-stage-and-intent-writes-to-the-wiki.md)

## Problem

Every `/tcgflow-*` command today starts from work that already exists: a Jira ticket, a Snyk
finding, a Cypress failure, a Datadog incident. Nothing covers the step *before* a ticket exists —
turning "we should let people bulk-export reports" into a task with a description someone can act
on and acceptance criteria someone can check. That framing happens in chat today and evaporates:
the reasoning is not in the task file, the terminology drifts from the project's own words, and the
decisions that were settled during the conversation get re-litigated during code review.

`/tcgflow-new-feature` is that missing first stage.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | The command writes a normal two-file task at **`PLANNED`** — discovery *and* decomposition in one invocation. `/tcgflow-plan` is not a required follow-up. | The user chose one command over a two-step DRAFT hand-off. Fewer steps to a workable task. |
| D2 | A new **`frame-feature`** workspace skill owns the pre-ticket questions; it hands to the existing `grill-task`, which hands to the existing `plan-task`. | Pre-ticket framing is different content from AC-drilling. Keeping it a skill (not prose in a dispatcher) keeps the dispatcher thin per ADR 0019 and keeps the behaviour tool-portable. |
| D3 | `frame-feature` **may write `wiki/`** — `domain.md`, `architecture.md`, and `wiki/adr/` — as decisions crystallise. | The user chose full grill-with-docs behaviour: capture the decision while the reasoning is fresh rather than reconstructing it from a diff weeks later. |
| D4 | Those writes are **per-page approval-gated, intent-marked, and logged** to `wiki/log.md`. The Ingester reconciles at `INGESTED`. No `lint-wiki` detector. | D3 breaks the single-writer invariant; the marker plus the log are what make it recoverable. Enforcement is deferred until there is evidence it is needed. |
| D5 | The **Jira issue is created at hand-off**, after the brief is settled and before any file is written; its key becomes the task ID. Declining, or an unreachable MCP, falls back to `FEAT-{slug}`. | Keeps discovery free of outward-facing writes until there is something worth tracking, without blocking discovery on MCP availability. |
| D6 | Default one task. Independently shippable slices are **proposed** and written as N sibling tasks only on approval, each carrying `Stacked on: {previous-ID}`. | Honours `plan-task`'s existing refuse-to-bundle rule without fragmenting ordinary multi-lane work. |
| D7 | **No new agent role.** The Planner performs discovery, with a bounded wiki exception. | A new role ripples into `ROLES` and `PIPELINE` in `ui/server/run.cjs`, the per-role tool map, chains, and the Cockpit's agent pages, for no behavioural gain. |

### Explicitly not decided here

PR stacking. `Stacked on:` is *recorded* by this work and *consumed* by a second spec:
the `stack-pr` skill, `pr.cjs` honouring the stack as the PR base, and restack-after-merge.
Nothing in this spec reads `Stacked on:`.

## File inventory

**New**

| Path | What |
|---|---|
| `templates/workspace/.tcgstackflow/commands/tcgflow-new-feature/SKILL.md` | Dispatcher |
| `templates/workspace/.tcgstackflow/skills/frame-feature/SKILL.md` | Discovery procedure |
| `docs/adr/0045-discovery-stage-and-intent-writes-to-the-wiki.md` | ADR |
| `docs/plans/new-feature-discovery.md` | This spec |

**Edited**

| Path | What changes |
|---|---|
| `templates/workspace/.tcgstackflow/skills/plan-task/SKILL.md` | New output sections; refine-existing branch |
| `templates/workspace/.tcgstackflow/skills/ingest/SKILL.md` | Intent-marker reconciliation step |
| `templates/workspace/.tcgstackflow/agents/planner.md` | `frame-feature` in Skills used; bounded wiki exception; details template |
| `templates/workspace/.tcgstackflow/tools/claude/CLAUDE.md` | Skill list + count; command list |
| `templates/workspace/.tcgstackflow/tools/codex/AGENTS.md` | Trigger list + count |
| `templates/workspace/.tcgstackflow/tools/github/copilot-instructions.md` | Skill list + count; trigger list + count |
| `README.md` | Counts; commands table row; skills table row |
| `CONTEXT.md` | Count; term entry for the discovery stage |
| `docs/USAGE.md` | Counts; a discovery section before Plan |
| `docs/QUICKSTART.md` | The first-feature path |
| `docs/geekstackflow-overview.md` | Counts (and the stale `workspace schema` numeral) |
| `test/templates-structure.test.cjs` | Count-consistency test |
| `CHANGELOG.md` | Entry |

**Untouched by design:** `init.js` (both `commands/` and `skills/` are copied wholesale —
`init.js:754` for the workspace copy, `init.js:785` for the `~/.claude/skills/` install, so a new
folder installs itself on both `init` and `upgrade`); `config.yaml` and `workspace_schema` (no new
field); `ui/` (discovery is interactive-only and is not an orchestrated role action); both decks in
`docs/` (they carry no skill/command counts, and the v0.3.0 deck is frozen).

## `frame-feature` skill contract

Frontmatter `name: frame-feature`. The `description` must name the trigger phrases other tools
dispatch on ("new feature", "start a new feature", "frame this idea", "what should we build") and
must exceed 40 characters — `test/templates-structure.test.cjs` asserts both the name/directory
match and the description length.

### Procedure

1. **Read before asking.** Query qmd via the `wiki-search` skill for the topic, read the hits, and
   follow `[[wikilinks]]` one hop (`wiki/index.md` is the fallback when qmd is unavailable). Read
   `governance.md`. Scan `tasks/active/` for overlapping work and surface any overlap before
   continuing. Never ask the user for something already in writing.
2. **Frame the problem.** What problem, for whom, why now. One topic per turn.
3. **Terminology check.** Compare the user's wording against `wiki/domain.md`. Where the project
   already has a word for the thing, propose it and say which page it comes from. Where the feature
   introduces a genuinely new term, flag it as a candidate `domain.md` addition (see the write
   protocol below).
4. **Scope.** Produce an explicit IN list and an explicit OUT list. **The OUT list is a required
   output** — "we are not doing X in this task" is the single most useful line in the file.
5. **Success measure.** One statement that could actually be checked after shipping.
6. **Decisions ledger.** Collect the architectural decisions the framing settled. Offer the wiki
   writes per the protocol below.
7. **Hand to `grill-task`** for per-criterion detail, then to the Jira hand-off gate, then to
   `plan-task`.

Questions follow `grill-task`'s existing format — one topic per turn, a recommended answer attached
to every question so the user can confirm-and-move-on, and a bundled numbered list where a topic
has several independent sub-decisions.

### Output handed to `grill-task`

- **Summary** — one paragraph; the last sentence is the success measure.
- **Acceptance criteria** — numbered, each a checkable condition.
- **Out of scope** — bulleted.
- **Decisions** — one line each, with the wiki page or ADR each one implies.
- **Open questions** — anything deliberately deferred.

### Anti-patterns

- Asking what the wiki already answers.
- Inventing a term the project already has a word for.
- An empty out-of-scope list — if nothing was excluded, the scope was not examined.
- Writing a wiki page without per-page approval.
- Proceeding to `plan-task` with an acceptance criterion that is a restatement ("it works").

## Command dispatcher contract

`commands/tcgflow-new-feature/SKILL.md`, frontmatter `name: tcgflow-new-feature`. Thin per ADR
0019: it says which role to adopt (Planner, `agents/planner.md`) and which skills to invoke in
order — `frame-feature` → `grill-task` → `plan-task` — plus the Jira gate and the guardrails. It
carries no procedure of its own.

The `description` must list the natural-language triggers other tools dispatch on:
*"new feature"*, *"start a new feature"*, *"I want to build X"*, *"frame this idea"*.

**Interactive only.** The command requires a human to answer questions. State this in the skill, in
the same terms `web-test` uses (ADR 0041). It is not exposed as an orchestrated role action, and
the Cockpit's `DRAFT → planner` mapping is unchanged (`DRAFT` still has no producer).

## Output contract

Three additive sections in `TASK details {ID}.md`, plus one optional field line. Additive means
existing task files that lack them stay valid; only newly written files get them.

```markdown
# TASK details ES-7132

Status: PLANNED
Stacked on: ES-7131

## Overview

{One paragraph: the summarized description. Last sentence is the success measure.}

## Acceptance Criteria

1. {checkable condition}
2. {checkable condition}

## Out of scope

- {what we decided not to build, and why in half a line}

## Context
## Stack/Technologies
## Key Files
## Risk
## Subtasks
## Open Questions
```

- **`Stacked on: {ID}`** is a field line directly under `Status:`, present only for a split slice.
  A sibling line to `Status:` keeps it as cheap to parse as `Status` already is in
  `ui/server/read.cjs`. Nothing reads it in this spec.
- **Feature-level `## Acceptance Criteria`** is distinct from the per-subtask `**Acceptance:**`
  lines, which stay exactly as they are. Feature-level says what the feature must do; per-subtask
  says what that subtask must satisfy.
- The log file's existing `## Key Requirements` section mirrors the feature-level list.

### `plan-task` refine-existing branch

`plan-task` step 1 currently treats an existing ID as a conflict to surface. It gains a third
option: surface it, then offer to **refine in place** — update the existing details file's sections
rather than creating a folder or picking a new ID. This is what keeps `/tcgflow-plan {ID}` usable
on a task `/tcgflow-new-feature` already wrote. Reopening a `completed/` or `archive/` task stays a
conflict, not a refine.

## Wiki intent-write protocol

`frame-feature` may write `wiki/domain.md`, `wiki/architecture.md`, and new files under `wiki/adr/`.
It may not write any other path under `wiki/`, and it may not write source code.

1. **Per-page approval.** Propose each page edit with its diff and write only on an explicit yes.
   `governance.md` rates a wiki edit LOW; this is deliberately stricter, because the content is
   speculative rather than observed.
2. **Intent marker.** Wrap every inserted block:

   ```markdown
   <!-- intent: ES-7132 (not shipped) -->
   Exports are queued through the job runner rather than served inline.
   <!-- /intent: ES-7132 -->
   ```

   An ADR written during discovery carries `Status: proposed` in its body plus the same marker.
3. **Log it.** One `wiki/log.md` entry per discovery session, in the same shape an ingest writes:
   the date, `frame-feature {ID}`, and one line per page touched saying what was added.
4. **Ingester reconciles.** `skills/ingest/SKILL.md` gains a step: when ingesting task `{ID}`, find
   every `<!-- intent: {ID} -->` block, and either drop the markers (what shipped matches what was
   framed) or correct the page to what actually shipped. An ADR marked `proposed` becomes
   `accepted`. Report what was reconciled in the ingest's `wiki/log.md` entry.
5. **No new detector.** `lint-wiki` is untouched.

## Jira hand-off protocol

After discovery, before any file is written:

1. Show the issue that would be created — project key, summary, description, the acceptance
   criteria list.
2. Creating a Jira issue is an outward-facing write and classifies **HIGH** (`governance.md`:
   "update a Jira ticket"). Use the standard permission-request format from `governance.md`.
3. On approval, create it via the Atlassian MCP and use the returned key as the task ID.
4. On decline, or if the MCP is unreachable, fall back to `FEAT-{slug}` — a short kebab slug of the
   feature name — and note in the details file's Context that no Jira key is attached.
5. **Project key** is inferred from the most common prefix already present in `tasks/` and confirmed
   in the prompt. No `config.yaml` field, no `workspace_schema` bump.

The refuse-don't-fabricate rule from `/tcgflow-plan` applies unchanged in the other direction: never
invent a Jira key, and never claim an issue was created when the MCP call did not succeed.

## Splitting protocol

Default: one task, lanes as usual. When discovery reveals independently shippable slices, stop and
propose the split with a suggested order and the dependency between slices. Write N sibling task
folders only on approval; each slice after the first carries `Stacked on: {previous-ID}` and links
the slice below it in `## Context`. Never split silently, and never split ordinary multi-lane work
that ships as one unit.

## `agents/planner.md` changes

1. Add to **Skills used**: ``- `frame-feature` — frame a new feature before a ticket exists``.
   (`test/templates-structure.test.cjs` already asserts every skill an agent lists exists.)
2. Replace the **No wiki edits** guardrail with the bounded exception:

   > **No wiki edits — one exception.** Wiki updates are the Ingester's job. The single exception is
   > discovery via `frame-feature`: `wiki/domain.md`, `wiki/architecture.md`, and `wiki/adr/` may be
   > written during an interactive discovery session, per-page approved, intent-marked, and logged
   > to `wiki/log.md`. An orchestrated Planner run never writes the wiki.
3. Add the three new sections to the `TASK details {ID}.md` template in that file, matching the
   Output contract above exactly.

## Docs updates

Counts move from **18 skills → 19** and **19 commands → 20** everywhere they are claimed:
`README.md` (the "what you get" bullets, the commands-reference intro, the repository-layout tree),
`CONTEXT.md`, `docs/USAGE.md`, `docs/geekstackflow-overview.md`, `tools/claude/CLAUDE.md`,
`tools/codex/AGENTS.md`, `tools/github/copilot-instructions.md`. The word-form claims
("Eighteen starter skills", "nineteen workflow commands") change with them.

`docs/geekstackflow-overview.md`'s summary row also claims `workspace schema 7`; `config.yaml` says
`8`. Correct it in the same edit. `README.md`'s ADR line claims 44 records and must become 45, with
ADR 0045 added to its highlights list.

Beyond the counts: a commands-table row and a skills-table row in `README.md`; a `frame-feature`
entry in the CLAUDE.md and copilot-instructions.md skill lists; a trigger line in AGENTS.md and
copilot-instructions.md; a short discovery section in `docs/USAGE.md` placed *before* the Plan
section; the `docs/QUICKSTART.md` first-feature path starting at `/tcgflow-new-feature`; a
`CONTEXT.md` term entry for the discovery stage.

## Tests

One new test in `test/templates-structure.test.cjs`: **documented counts match what ships.** It
reads the real directory counts for `commands/`, `skills/` and `docs/adr/`, reads
`workspace_schema` from `config.yaml`, and asserts that every numeral and word-form claim in
`README.md`, `CONTEXT.md`, `docs/USAGE.md`, `docs/geekstackflow-overview.md`, and the three tool
adapters agrees with them. These counts drift by hand today — `docs/geekstackflow-overview.md`
currently claims `workspace schema 7` against a `config.yaml` that says `8`, and `README.md` claims
44 ADRs — so the fix is to assert them, not to patch them again.

The test must be written so a new skill, command or ADR fails it loudly with a message naming the
file and the stale numeral. Word-forms in scope: the numerals `18`/`19`/`44`/`7` in those files
where they denote these counts, and the word-forms "Eighteen starter skills" and "nineteen workflow
commands".

The existing structural tests cover the rest for free: frontmatter shape, `name` matching the
directory, description length, the `tcgflow-` prefix, and every skill an agent profile references
existing.

## Acceptance criteria

1. `/tcgflow-new-feature` exists as a command folder whose `SKILL.md` passes every existing
   `templates-structure` assertion, and dispatches `frame-feature` → `grill-task` → `plan-task`.
2. `skills/frame-feature/SKILL.md` exists, passes the same assertions, and its procedure covers all
   seven steps in the skill contract above, including the mandatory out-of-scope list.
3. `agents/planner.md` lists `frame-feature` under Skills used and carries the bounded wiki
   exception in place of the absolute one.
4. `plan-task` emits `## Acceptance Criteria`, `## Out of scope`, and the optional `Stacked on:`
   field line, and documents the refine-existing branch.
5. `ingest` documents the intent-marker reconciliation step.
6. Every documented skill, command and ADR count in the seven files above equals what is really on
   disk, and the new count-consistency test fails if any of them drifts.
7. `node --test test/` passes.
