# 0046 — Eval is a manual skill; only the capture is automatic

**Status:** proposed · **Date:** 2026-09-09

## Context

The workspace's whole premise is a context loop: the Ingester writes the wiki, qmd retrieves it
(ADR 0030), the next agent starts smarter. ADR 0037 made the *discovery path* auditable — we can now
tell whether an agent led with qmd. Nothing tells us whether what it found was **any good**, or whether
the Coder's output actually met the acceptance criteria it was given.

So the loop is blind in its most important direction. We can report that the wiki grew. We cannot report
that it got more useful, and we cannot tell a wiki that is compounding from one that is rotting.

The framing this ADR rejects up front: **an eval does not make the AI learn.** The weights are frozen.
What improves is the context — wiki pages, skills, agent profiles — and only if something acts on the
score. The eval is the feedback signal that makes fixing the context *directed* instead of guesswork.

## Decision

**Split the eval along cost. Capture is automatic and free; scoring is manual and paid.**

- **Capture (automatic).** The ADR 0037 gate telemetry is extended to report **every** qmd search rather
  than only the first, carrying the query string, and to attribute subsequently-read `wiki/` pages to the
  query that preceded them. Cases append to `eval/queries.jsonl`. This runs whether or not anyone ever
  evals, so the corpus accumulates from real work at zero cost.
- **Scoring (manual).** One skill, `eval`, invoked as `/tcgflow-eval`, with three modes: judge a task's
  runs against their acceptance criteria, run the retrieval benchmark, or report the trend.
- **Feedback (human-gated).** A low score makes the skill *propose* a finding into `raw/`, in the pull-digest
  shape. The Ingester folds it into the wiki on its next run under the ADR 0007 approval gate. Nothing
  edits a skill, agent profile, or governance file automatically.

Two placement rules fall out of existing invariants rather than preference:

- **Harvested cases do not go in the run record.** `read.cjs` documents that the frontmatter parser is two
  levels deep — a nested list of query strings round-trips wrong, the trap the `write_attempts.tools`
  flat scalar already works around. A separate JSONL keeps existing `runs/` files byte-identical.
- **Scores do not go in the run record either.** `runs/` is server-written and immutable except for
  server amendment (`embed:`, `ended_at`). An agent editing it breaks that. Scores live at
  `eval/{task-id}/{run-id}.md`; the Cockpit joins on run-id for the badge.

## Considered options

- **(A) Manual skill + automatic capture** — *chosen*. The accumulation property everyone actually wants
  comes from the capture, not from when the score is computed, so making scoring manual costs nothing in
  signal and removes all standalone spend. A skill also runs inside a session the user already opened,
  making the marginal cost of a judge call effectively zero.
- **(B) Automatic post-run judge**, as a `judgeIfScorable` step in `run.cjs` beside `reembedIfIngest`,
  following the ADR 0036 post-step pattern — rejected. It was the first draft and it fits the codebase
  well, which is what made it tempting: same trigger shape, same non-blocking contract, same amend path,
  same badge. But it bills a model call on every coder/reviewer/tester run, forever, in a tool whose
  stated pitch is local-first, dependency-light, no database. A per-run recurring charge is a different
  *kind* of cost from ~2 GB of local qmd models, and the user should choose it explicitly rather than
  inherit it. Available as a later step if the manual skill proves the rubric is worth automating.
- **(C) Replay archived tasks against the shipped diff** — rejected as ground truth. Attractive because
  `tasks/archive/` and each run record's `git_base` make it mechanically possible at no authoring cost.
  But the shipped diff is not reliably the *right* answer, and replaying costs a full agent run per case.
  Grading against the task's own acceptance criteria measures intent, which is what the criteria are for.
- **(D) Automated repair — the judge patches the failing skill or profile** — rejected. It is the fastest
  loop and genuinely self-improving, and that is exactly the problem: it lets an ungated model rewrite the
  instruction layer that governance depends on, defeating both ADR 0007 and separation of duties.
- **(E) Record scores, act manually, build no feedback path** — rejected. Maximally faithful to
  observe-before-enforce, but it produces a dashboard, and dashboards get ignored. The `raw/` channel
  already exists and already has a human gate, so routing findings through it adds no new machinery and
  no new risk.

## Consequences

- `governance-mcp.cjs` reports every qmd invocation instead of the first. This is still **purely
  observational** — it changes no allow/deny outcome, `Grep` stays pre-allowed, and a throwing capture
  path must not affect the gate. No blast-radius change to the safety-critical path.
- A new `eval/` workspace area (`queries.jsonl`, `{task-id}/{run-id}.md`, `retrieval-scores.jsonl`) and a
  small `eval:` config block, behind a `workspace_schema` bump (ADR 0021).
- A new `eval` skill and a `/tcgflow-eval` command adapter (ADR 0019: the workflow is portable, the slash
  UX is Claude's).
- `runs/` records and the `wiki_discovery` block are **unchanged**; existing files stay byte-identical.
- **Amends ADR 0037**: its `queries` counter becomes a real per-query count rather than an effective
  constant `1`, and the observed discovery path gains an outcome measure — did the retrieval help.
- **Blocking unknown:** `qmd bench`'s fixture schema is unverified (`qmd bench --help` reprints global
  help). Retrieval mode is specified only in outline until the package is inspected.
- **Follow-up trigger:** revisit option (B), the automatic post-run judge, once the manual skill has
  produced enough scores to show the rubric is stable and the signal is worth a standing per-run charge.
