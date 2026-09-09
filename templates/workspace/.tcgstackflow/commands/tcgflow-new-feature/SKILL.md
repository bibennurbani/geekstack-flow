---
name: tcgflow-new-feature
description: Adopt the Planner role and turn an idea with no ticket behind it into a PLANNED task — framing, then decomposition, in one invocation. Use when the user types `/tcgflow-new-feature {feature description}` or says "new feature", "start a new feature", "I want to build X", "frame this idea". Dispatches `frame-feature` → `grill-task` → `plan-task`, with a HIGH Jira hand-off gate before the first file is written. Interactive only.
---

# `/tcgflow-new-feature` — frame a feature before the ticket exists

## When to use

The user typed `/tcgflow-new-feature {feature description}` or said *"new feature"*, *"start a new feature"*, *"I want to build X"*, *"frame this idea"*.

Use it when nothing has been written down yet. Every other planning entry point starts from work that already exists — `/tcgflow-plan` from a Jira ticket it refuses to guess at, the `/tcgflow-task-from-*` family from an MCP finding. This is the stage before those. If the ticket already exists, use `/tcgflow-plan {ID}`.

## What to do

You are now in the **Planner role** — read `.tcgstackflow/agents/planner.md` for the role's reads, writes and guardrails. This command carries no procedure of its own (ADR 0019). It dispatches three skills, in this order, with one gate between the second and the third:

1. **`frame-feature` — the pre-ticket questions.** Run `.tcgstackflow/skills/frame-feature/SKILL.md`. It reads the wiki via `wiki-search` and scans `tasks/active/` for overlap *before* asking anything, frames the problem and who it is for and why now, checks the user's wording against `wiki/domain.md`, produces an explicit in-scope and out-of-scope list, states one success measure that can actually be checked after shipping, and collects the decisions the framing settled — drafting the bounded wiki writes as they crystallise, to be applied at 3a once the gate has settled the ID. It hands on a brief: summary, numbered acceptance criteria, out of scope, decisions, open questions.

2. **`grill-task` — per-criterion detail.** Run `.tcgstackflow/skills/grill-task/SKILL.md` over that brief. `frame-feature` settles *what* the feature is and where its boundary sits; `grill-task` drills each criterion until it is checkable and each lane's work is understood. The question format is the same on both sides of the hand-off — one topic per turn, a recommended answer attached so the user can confirm-and-move-on.

3. **Jira hand-off gate — HIGH.** It sits here, between `grill-task` and `plan-task`, because it settles the task ID and **nothing is written to disk before it**. Creating an issue is an outward-facing write and `governance.md` rates *"update a Jira ticket"* HIGH. The procedure belongs to `frame-feature` — run its *Jira hand-off gate* section from `.tcgstackflow/skills/frame-feature/SKILL.md`; this file keeps no second copy of it.

   **3a. The drafted wiki writes, applied.** The page edits `frame-feature` drafted in stage 1 land here and nowhere earlier: the `<!-- intent: {ID} (not shipped) -->` marker each inserted block carries is keyed on the ID the gate has just settled. Apply the approved ones, then the single `wiki/log.md` entry for the session, per the same skill's *wiki intent-write protocol*.

4. **`plan-task` — the two files.** Run `.tcgstackflow/skills/plan-task/SKILL.md` under the agreed ID: `tasks/active/{ID}/TASK details {ID}.md` and `tasks/active/{ID}/TASK {ID}.md`. The brief's summary becomes `## Overview`, its criteria become the feature-level `## Acceptance Criteria`, its OUT list becomes `## Out of scope`. Set status `PLANNED` and append a row to the Active Tasks table in `tasks/README.md`. `TASK {ID}.md` now exists, so record the gate's approval in it via `update-task-log` — `governance.md` wants an explicit approval recorded in the relevant `TASK {ID}.md`, and until this step there was no file to record it in.

## What comes out

The normal two files at `PLANNED` — the same shape `/tcgflow-plan` produces, so `/tcgflow-code {ID}` is the next step.

**`/tcgflow-plan {ID}` is not a required follow-up.** Discovery and decomposition both happen here; there is no draft hand-off to complete. It stays available as a refinement pass — run against an ID that already exists, `plan-task` offers to refine the details file in place rather than creating a second task.

## Guardrails (per agents/planner.md)

- **No code.** Discovery writes `tasks/` and — under the exception below — three wiki paths. Never source files.
- **The wiki exception is bounded.** `frame-feature` may write `wiki/domain.md`, `wiki/architecture.md`, and new files under `wiki/adr/`; nothing else under `wiki/`. Every edit is approved page by page, wrapped in `<!-- intent: {ID} (not shipped) -->` markers, and recorded in one `wiki/log.md` entry for the session, so the Ingester can reconcile it at `INGESTED`. An orchestrated Planner run never writes the wiki. (ADR 0045.)
- **Two-file rule strict.** `TASK details {ID}.md` and `TASK {ID}.md`. Never a file per subtask, never a brief parked somewhere else.
- **No silent splits.** The default is one task with lanes as usual. If discovery turns up independently shippable slices, stop and propose the split with a suggested order and the dependency between slices; write sibling tasks only on approval, each after the first carrying `Stacked on: {previous-ID}`. Ordinary multi-lane work that ships as one unit is not a split.

## Notes

- **Interactive only.** Not because a headless run couldn't write the files, but because there is nobody in it to answer the questions — the whole value of this stage is the grilling, and an unattended run would invent the answers it is supposed to elicit. It is not exposed as an orchestrated role action and adds nothing to the Cockpit; `DRAFT` still has no producer. Same reasoning as `/tcgflow-web-test` (ADR 0041).
- Migration work — replacing prior AI infrastructure — routes to `/tcgflow-migrate`, which is the specialised command for that pattern. Work that starts from an MCP finding rather than an idea routes to the `/tcgflow-task-from-*` family (`-snyk`, `-cypress`, `-datadog`): those sources already carry the framing this command exists to elicit, so running discovery over them just re-asks what the finding says.
