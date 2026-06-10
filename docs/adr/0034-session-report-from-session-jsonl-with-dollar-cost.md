# Session Report parses the Claude Code session JSONL and adds dollar cost (amends ADR 0033)

The user wants a rich, `session_report.html`-style "where the tokens went" view per task. The per-Run `runs/` frontmatter (ADR 0033) holds only final token totals — too thin for per-turn traces, tool-call breakdowns, or model attribution. The rich source already exists: the **Claude Code session JSONL** at `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl` that `claude -p` writes, which carries per-turn `usage`, `tool_use` events, timestamps, and the model. We capture the `session_id` on every Run, so we can locate and parse it.

## Decision

- **Session Report = a per-task aggregation** of the task's Runs' session JSONLs. Located by `session_id` (searched under `~/.claude/projects/*/`, robust to cwd path-encoding), parsed for: token classes (cache read/write, output, fresh input), tool-calls-by-type (categorized orchestration / coordination / io / mcp / other), per-turn cache-read trace, turns, MCP calls, wall-clock, model.
- **Dollar cost is shown** — a per-model **list-price table** (Opus: input $15 / output $75 / cache-write $18.75 / cache-read $1.50 per M; Sonnet/Haiku scaled) computes a cost waterfall by token class. This **amends ADR 0033**, which deliberately rejected $-cost (its option C). The reversal is *scoped to the Session Report*: the inline per-task token panel (ADR 0033) stays **raw tokens**; only the report surfaces $, always labelled a list-price estimate.
- **Two surfaces** (`both`): (1) a **live Cockpit page** renders the charts deterministically from the JSONL on demand (`GET /api/project/task/report`); (2) a **"Generate analysis"** action copies a prompt to author the full editorial HTML — narrative headline, "what happened", and ranked optimization recommendations with $ savings — in the user's AI tool (the editorial prose needs an AI step; the live page cannot write it).

## Considered options

- **Parse the session JSONL + show $** — *chosen*. Rich, faithful to the reference, reuses data we already point at via `session_id`.
- **Render only from `runs/` frontmatter** — rejected: no per-turn trace, no tool breakdown, no model — can't approach the reference.
- **Keep raw-tokens-only (ADR 0033 unchanged)** — rejected: the reference is cost-centric ($141, cost waterfall); a token-only report loses the headline insight the user asked for.

## Consequences

- Reports populate **only from orchestrated Runs** (sessions the Orchestrator launched leave a `runs/` record with a `session_id`). Manual/copy-prompt sessions aren't linked to a task, so they don't appear. A task with no Runs yields an empty report.
- **Cross-machine:** the session JSONL lives under the developer's `~/.claude`; on another clone it's absent. The report then **falls back to the Run's frontmatter totals** (no per-turn trace) so the task still counts — it never fabricates trace data (consistent with the no-fabricate-on-unreachable-source rule).
- **Pricing drift:** list prices are estimates kept in one table (`session-report.cjs` `PRICING`); effective rates differ. The report always says so.
- The server stays zero-dependency and read-only for this surface (it only *reads* `~/.claude` JSONL + the workspace `runs/`).
- The multi-agent "waves" timeline of the reference collapses to a single agent's per-turn trace, since the Orchestrator runs one role per session (ADR 0025/0026).
