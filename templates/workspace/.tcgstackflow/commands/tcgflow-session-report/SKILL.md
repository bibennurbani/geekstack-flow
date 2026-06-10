---
name: tcgflow-session-report
description: Author a rich session-telemetry post-mortem (HTML) for a task from its orchestrated runs' Claude Code session logs. Use when the user types `/tcgflow-session-report [TASK-ID]` or says "write a session report for ES-1234", "where did the tokens go on X", "post-mortem the run". Reads the session JSONL(s), not just the run-record totals.
---

# `/tcgflow-session-report` — author a session post-mortem

The Cockpit's **Session report** page renders the *charts* deterministically (token classes, cost waterfall, tool-calls-by-type, per-turn trace) and its "Open report ↗" exports them as standalone HTML. This command produces the **editorial layer the charts can't**: a narrative headline, a "what happened" summary, and **ranked optimization recommendations with $ savings** — the prose that needs a model, not a server.

## Inputs

A task ID (e.g. `ES-6965`). Its orchestrated **Runs** live at `.tcgstackflow/runs/{TASK-ID}/{run-id}.md`; each run-record's frontmatter carries the `session_id`. The rich source is the **Claude Code session JSONL** at `~/.claude/projects/*/{session_id}.jsonl` (per-turn `usage`, `tool_use` events, timestamps, model).

## Procedure

1. **Locate the runs.** Read `.tcgstackflow/runs/{TASK-ID}/*.md`; collect each run's `session_id` and `role`. If there are none, stop and tell the user the task has no orchestrated runs to report on.
2. **Find + parse each session JSONL.** `find ~/.claude/projects -name "{session_id}.jsonl"`. Per file, aggregate across `assistant` records: token classes (`input`, `output`, `cache_read_input_tokens`, `cache_creation_input_tokens`), `tool_use` counts by name, timestamps (wall-clock), the model. **If a JSONL is missing on this machine, say so — do not fabricate per-turn data** (fall back to the run-record frontmatter totals and note the trace is unavailable). [[no-fabricate-on-unreachable-source]]
3. **Cost.** Price token classes at the model's list rate (Opus: input \$15 / output \$75 / cache-write \$18.75 / cache-read \$1.50 per M; Sonnet/Haiku scaled). Always label figures **list-price estimates**.
4. **Write the report.** A self-contained dark-editorial HTML file (no external assets, no CDN — match the Cockpit's `/api/project/task/report.html` style) to `$TMPDIR/session-report-{TASK-ID}-{stamp}.html`, then open it (`open` on macOS / `xdg-open` Linux / `start` Windows) and print the absolute path. Sections: **hero** (task, model, est. cost), **what happened** (narrative from the tool/turn pattern), **where the tokens went** (cards + waterfall), **tool & MCP activity**, and **where to optimize** — 3–5 ranked, specific recommendations each with a rough \$ saving (e.g. "stop re-reading the full transcript each turn", "batch tool calls", "summarize large dumps at the source").
5. **No workspace writes.** This is a read-only analysis that emits an HTML artifact to the OS temp dir — it does not touch `tasks/`, `wiki/`, or `runs/`.

## Notes

- The deterministic charts already exist in the Cockpit; this command's value is the **analysis and recommendations**. Don't just restate the numbers — explain *why* the spend landed where it did and *what to change*.
- One report per task by default (aggregating its runs). For a single run, scope to that `session_id`.
