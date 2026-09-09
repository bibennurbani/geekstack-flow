# 0045 — A discovery stage before the ticket, and the wiki records intent as well as fact

**Status:** accepted · **Date:** 2026-09-09

## Context

Every `/tcgflow-*` command starts from work that already exists. `/tcgflow-plan` starts from a Jira
ticket and refuses to proceed without its real contents. The `task-from-*` family (ADR 0018) starts
from an MCP finding. Nothing covers the step before a ticket exists — turning an idea into a
description someone can act on and acceptance criteria someone can check.

That framing happens today in chat, and evaporates. The reasoning never reaches the task file, the
wording drifts from the project's own vocabulary, and the decisions settled in conversation get
re-litigated at review time. The Planner's `grill-task` skill is the wrong instrument for it:
`grill-task` drills an existing ticket down to per-subtask acceptance criteria, and assumes the
problem, the audience and the scope boundary are already agreed.

## Decision

**A discovery stage ships as `/tcgflow-new-feature`, dispatching a new `frame-feature` skill.**
The pipeline is `frame-feature` → `grill-task` → `plan-task`, ending in the normal two files at
`PLANNED`. `/tcgflow-plan` is not a required follow-up; `plan-task` gains a refine-existing branch
so `/tcgflow-plan {ID}` remains usable on a task discovery already wrote.

**`frame-feature` covers what `grill-task` assumes.** Read the wiki via qmd before asking anything;
frame the problem, the audience and the timing; check the user's wording against `wiki/domain.md`
and prefer the project's existing terms; produce an explicit out-of-scope list; state one checkable
success measure. The out-of-scope list is a required output — a scope nobody drew a boundary around
was not examined.

**The wiki may record intent, not only shipped fact.** `frame-feature` may write `wiki/domain.md`,
`wiki/architecture.md`, and `wiki/adr/` during discovery, under four constraints: per-page
approval, an inline `<!-- intent: {ID} (not shipped) -->` marker around every inserted block, a
`wiki/log.md` entry per session, and reconciliation by the Ingester at `INGESTED` — drop the marker
where what shipped matches what was framed, correct the page where it does not, flip a `proposed`
ADR to `accepted`.

**The Jira issue is created at hand-off,** after the brief is settled and before any file is
written; its key becomes the task ID. Creating it is HIGH and uses the standard permission request.
Declining, or an unreachable MCP, falls back to a local `FEAT-{slug}` id.

**No new agent role.** The Planner performs discovery, and its absolute "no wiki edits" guardrail
becomes a bounded exception for interactive discovery only.

**Splits are proposed, never silent.** Independently shippable slices become sibling tasks on
approval, each carrying a `Stacked on: {previous-ID}` field line. Nothing reads that line yet.

## Why intent in the wiki is a real cost, and why it was accepted anyway

Until now exactly one writer touched `wiki/`: the Ingester, after a task reached `VALIDATED`. That
invariant is what let a reader treat every wiki page as observed reality. Discovery writes break
it. The wiki will now contain claims about features that were discussed and never built, and
`lint-wiki` has no detector for them.

The trade was made deliberately: an architectural decision is cheapest to record at the moment it
is made and most expensive to reconstruct from a diff weeks later. The marker, the log entry and
the Ingester's reconciliation step are what keep the cost recoverable — every speculative block is
attributable to a task id, and every discovery session is visible in the log.

**Enforcement is deferred, not forgotten.** A `lint-wiki` detector for intent markers whose task is
completed, archived, or gone is the obvious guard, and it is not being built yet: ship the
observability first, and add the guard when the log shows orphaned intent is actually happening.

## Considered options

- **A `DRAFT` two-file task handed to `/tcgflow-plan`** — rejected by the user in favour of one
  command that goes straight to `PLANNED`. `DRAFT` therefore still has no producer, and the
  Cockpit's `DRAFT → planner` mapping is unchanged.
- **A brief outside the task system** (`tasks/briefs/`) — rejected: invisible to the Cockpit,
  outside the two-file rule, and it needs a new input path in `plan-task`.
- **Reusing `grill-task` alone with extra opening questions** — rejected: that puts a real
  procedure inside a dispatcher, which ADR 0019 says stays thin.
- **Delegating to plugin skills** (`superpowers:brainstorming`, `grill-with-docs`) when installed —
  rejected: behaviour would differ per machine and could not be tested in CI. The workspace skill
  is self-contained and behaves the same in Codex and Copilot, per ADR 0019.
- **Wiki writes read-only, implications recorded in the task file** — rejected by the user; it
  preserves the single-writer invariant but reconstructs decisions from the diff later.
- **Adding an `analyst` role** — rejected per the reasoning above: `ROLES` and `PIPELINE` in
  `ui/server/run.cjs`, the per-role tool map, chains and the Cockpit agent pages would all grow a
  role that never runs headless.
- **Creating the Jira issue at the start of discovery** — rejected: an outward-facing write before
  there is anything worth tracking, and it blocks discovery when the MCP is down.

## Consequences

- Workspace counts: **19 skills** (adds `frame-feature`) and **20 commands** (adds
  `tcgflow-new-feature`). Every documented count in `README.md`, `CONTEXT.md`, `docs/USAGE.md`,
  `docs/geekstackflow-overview.md` and the three tool adapters moves with them, and a new test in
  `test/templates-structure.test.cjs` asserts they match the shipped directories rather than being
  patched by hand.
- `TASK details {ID}.md` gains three additive sections — `## Acceptance Criteria` (feature-level,
  distinct from the per-subtask `**Acceptance:**` lines), `## Out of scope`, and an optional
  `Stacked on:` field line under `Status:`. Existing task files without them stay valid.
- `skills/ingest/SKILL.md` gains the intent reconciliation step; `agents/planner.md` gains
  `frame-feature` and the bounded wiki exception.
- No `init.js`, `config.yaml` or `workspace_schema` change — `commands/` and `skills/` are copied
  wholesale by both `init` and `upgrade`, so the new folders install themselves.
- Discovery is **interactive only**, like the browser web test (ADR 0041). It is not an
  orchestrated role action and adds nothing to the Cockpit.
- A follow-up spec consumes `Stacked on:`: a `stack-pr` skill, `pr.cjs` using the slice below as the
  PR base (`openPr` already accepts one), and restack-after-merge. Deliberately out of scope here.
