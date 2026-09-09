# EVAL — capture automatically, score manually, feed findings back through the Ingester

> **Where this lives:** tool repo, no `.tcgstackflow/` workspace (ADR 0013) → a plan doc under `docs/plans/`, same shape as `qmd-query-path-enforcement.md`. Status in §0.
>
> **Status:** PLANNED · **Planner:** claude · **Source:** brainstorming session (2026-09-09). **Decides:** ADR 0046 (amends 0037). **Shape:** the split that makes this cheap — **capture is automatic and free, scoring is manual and paid.** No server-side judge, no per-run API spend.

## 0. Build progress

| Subtask | Size | State | Notes |
|---|---|---|---|
| EVAL-0 ADR 0046 | S | ✅ | Written 2026-09-09, status **proposed**. The decision: manual skill, not a post-step; scores live outside `runs/`. |
| EVAL-1 per-query capture in the gate | S | ⬜ | Loosen the `!st.qmdSeen` guard so every qmd search reports; carry the query string. Observation only — never changes allow/deny. |
| EVAL-2 `eval/queries.jsonl` intake | S | ⬜ | Extend `/api/run/wiki-discovery` to append `{run_id, task, query, opened, at}`. Run-record frontmatter unchanged. |
| EVAL-3 post-query page attribution | M | ⬜ | Attribute `Read` of `wiki/*` to the most recent qmd query in the run. **Heuristic, documented as such.** |
| EVAL-4 `eval` skill — judge mode | M | ⬜ | `/tcgflow-eval {TASK-ID}`: acceptance criteria + run diff → rubric score → `eval/{task-id}/{run-id}.md`. |
| EVAL-5 `eval` skill — finding mode | S | ⬜ | Low score → propose a `raw/` finding (pull-digest shape) for the Ingester, under the ADR 0007 gate. |
| EVAL-6 `eval` skill — trend mode | S | ⬜ | Bare `/tcgflow-eval`: what has been scored, what is unjudged, the trend. |
| EVAL-7 `/tcgflow-eval` command adapter | S | ⬜ | `templates/claude-commands/`, per ADR 0019 (workflows portable, slash UX is Claude's). |
| EVAL-8 **investigate `qmd bench` fixture schema** | S | ⬜ | **BLOCKING for EVAL-9.** Unverified — `qmd bench --help` reprints global help. Inspect the package before specifying. |
| EVAL-9 `eval` skill — retrieval mode | M | ⬜ | Blocked on EVAL-8. `eval/queries.jsonl` → bench fixture → score → `eval/retrieval-scores.jsonl`. |
| EVAL-10 Cockpit score badge | S | ⬜ | Join `eval/{task-id}/{run-id}.md` on run-id; fourth badge beside fidelity / embed / discovery. |
| EVAL-11 `workspace_schema` bump + `eval:` config block | S | ⬜ | ADR 0021. Block is small: `harvest_queries`, plus whatever bench needs. |

**No code written.** EVAL-0 (the ADR) is the only completed subtask.

---

## 1. Why

The context loop this tool is built around — ingest writes the wiki, qmd retrieves it, the next agent
starts smarter — is currently **blind**. We can say the wiki grew. We cannot say it got more useful.
Evals are the missing feedback signal that turns "we ingested 40 pages" into "retrieval improved" or
"the Coder keeps re-deriving what ADR 0012 already settled."

**Evals do not make the model learn.** The weights are frozen. What improves is the *context* — wiki,
skills, agent profiles — and that only happens if a bad score changes one of those. So the loop is:

> score → diagnose → fix the context → re-measure

The scoring half is new. The fixing half already exists and is not rebuilt here: findings go into
`raw/`, the Ingester folds them into the wiki, the ADR 0007 approval gate applies unchanged.

## 2. Scope

**In:** per-query capture; a manual `/tcgflow-eval` skill that scores agent output against the task's
own acceptance criteria; harvested retrieval cases; low scores routed to `raw/`.

**Out:** replaying archived tasks, golden diffs, judge-the-judge calibration, and **any automated edit
to skills, agent profiles or governance**. A finding is input to a human-gated ingest, never an edit.

**Explicitly rejected: the automatic post-run judge.** An earlier draft put a `judgeIfScorable` step in
`run.cjs` beside `reembedIfIngest`, following the ADR 0036 post-step pattern. It was dropped: it bills a
model call on every coder/reviewer/tester run, forever, in a tool whose pitch is local-first and
dependency-light. A skill runs inside a session the user already opened, so the marginal cost is zero
and the spend decision stays with the user. See ADR 0046.

## 3. Capture — automatic, free, always on

One change, feeding both halves of the eval.

`governance-classify.cjs` already exports `isQmdInvocation`; `governance-mcp.cjs` `decide()` already
reports to `/api/run/wiki-discovery` (ADR 0037); `run.cjs` `noteDiscovery()` already folds that into the
live record. Two adjustments:

- **`governance-mcp.cjs:36` reports only the first qmd call per run** (`if (!st.qmdSeen)`), which is why
  `queries` is effectively always `1` today. Loosen the guard so every qmd search reports, and carry the
  **query string** in the payload. `qmdSeen` keeps its current role for the path decision.
- **Cases do not go in the run record.** `read.cjs` documents that the frontmatter parser is two levels
  deep — a nested list of query strings would round-trip wrong, the same trap the `write_attempts.tools`
  flat scalar already works around. So `/api/run/wiki-discovery` appends to **`eval/queries.jsonl`**
  instead, and the run record's `wiki_discovery` block is untouched. Existing `runs/` files stay
  byte-identical.

Attribution of "which pages did the agent open after this query" comes from ordering: a `Read` of
`wiki/*` is attributed to the most recent qmd query in the same run. **This is a heuristic** — the page
the agent chose is a proxy for the right page, not proof of it — and the skill must present retrieval
scores with that caveat attached.

The capture stays purely observational. It changes no allow/deny outcome, and a throwing capture path
must not affect the gate — the existing `try {} catch {}` discipline in `decide()` applies unchanged.

## 4. Score — manual, on demand

One new skill, `templates/workspace/.tcgstackflow/skills/eval/SKILL.md`, with a `/tcgflow-eval` adapter.

| Invocation | Does |
|---|---|
| `/tcgflow-eval {TASK-ID}` | Reads acceptance criteria from `TASK details {ID}.md` and each run's diff against its `git_base`; scores against a fixed rubric; writes `eval/{task-id}/{run-id}.md` |
| `/tcgflow-eval retrieval` | Builds the bench fixture from `eval/queries.jsonl`, runs `qmd bench`, appends to `eval/retrieval-scores.jsonl` (blocked on EVAL-8) |
| `/tcgflow-eval` | Reports the trend so far and lists unjudged runs |

**Judge independence.** The skill must score from the run record and the diff on disk, never from the
current conversation. Otherwise running `/tcgflow-eval` straight after doing the work grades the agent
on its own recollection of what it meant to do.

**Scores live outside `runs/`.** `runs/` is server-written and immutable-except-server-amendment; having
an agent edit it breaks that invariant. Scores go to `eval/{task-id}/{run-id}.md`, and the Cockpit joins
on run-id to draw the badge.

## 5. Feed back

A score below the rubric's threshold makes the skill **propose** a finding into `.tcgstackflow/raw/`, in
the same shape as the git pull digest: which criteria failed, what the agent appeared not to know, and a
suggested wiki or skill target. The Ingester folds it in on its next run under ADR 0007.

Expect early scores to be noisy, before the rubric is calibrated against real runs. Ship with the
threshold conservative so `raw/` stays quiet until a dozen scores have been read and trusted.

## 6. Testing

No API cost in the suite. Capture is unit-tested the way ADR 0037's observe half already is: assert that
every qmd invocation reports (not just the first), that the query string reaches the intake, that the
`Read` attribution picks the right query, that a throwing capture path leaves the gate outcome unchanged,
and that `runs/` records round-trip byte-identically. The skill itself is prose; its detectors are
covered by `audit-workspace`.

## 7. Open questions

- **`qmd bench` fixture schema is unverified** (EVAL-8). `qmd bench --help` reprints global help; the
  package has not been inspected. Retrieval mode is an outline, not a spec, until this is answered.
- **Rubric content** is unspecified here on purpose — it should be drafted against real archived runs
  rather than invented up front, or it will measure what we imagined instead of what happens.
