# Run tokens are captured from the agent subprocess and stored per-Run in `runs/` frontmatter

The Cockpit must show how many tokens a task consumed, broken down by role (planning vs coding vs review …) and totalled per task, with a live counter while a Run is in flight. This is only possible now that the Cockpit launches Runs itself (ADR 0032) — a copy-prompt run happens in a session the Cockpit doesn't own and never reports back. This ADR records *how* tokens are captured and *where* they live.

## Capture

A live Run invokes Claude Code headlessly:

```
claude -p "<prompt>" --output-format stream-json --verbose [--include-partial-messages]
```

- **Progress** — the server forwards `content_block_delta` / `text_delta` events to the browser (SSE) for live output.
- **Tokens** — the final `result` event carries `usage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. These are the authoritative counts. (`--output-format json` additionally yields `total_cost_usd`, which we do **not** consume — see below.)
- **Identity** — every event carries `session_id`; it names the Run's transcript and is recorded with the tokens.

Codex (`codex exec`) emits usage in its own shape; parsing it is deferred behind Claude (ADR 0025's tool map default is Claude).

## Storage

Tokens are recorded **once per Run** in the run record's frontmatter at `runs/{task-id}/{run-id}.md`, alongside `role` and `session_id`:

```yaml
---
task: ES-6965
role: coder            # planner | coder | reviewer | tester | ingester | refactorer
session_id: 550e8400-...
tokens:
  input: 1234
  output: 567
  cache_read: 8901
  cache_creation: 100
---
```

The Cockpit reads `runs/` to derive the two views: **per-role breakdown** (group Runs by `role`) and **per-task total** (sum Runs). The **live counter** ticks from the server's in-memory state during the Run, then flushes to the frontmatter on completion (ADR 0024's raw→durable flush).

## Considered options

- **(A) Per-Run record in `runs/` frontmatter** — *chosen*. Tokens are intrinsically per-Run; the run record is where run-state already lives (ADR 0024). Leaves the two-file rule (ADR 0004) and the `### ENTRY START` log schema untouched.
- **(B) `role` + `tokens` fields on each YAML log entry** — rejected. A single Run appends *several* `### ENTRY START` entries, so per-entry tokens would **double-count**; it also burdens a schema humans hand-write with a field only the Orchestrator can fill.
- **(C) Convert to dollars** — rejected/deferred. $-cost needs a per-model pricing table kept current and differs across claude/codex; raw tokens answer the user's question ("how many tokens for planning, coding") without that maintenance burden. The `total_cost_usd` field is available if this is reversed later.
- **(D) Cross-project token aggregate on the Home view** — deferred. It is a pure reporting layer over the same per-Run data; addable later without changing the store.

## Consequences

- Per-role attribution requires the Run to know its `role` — it does, because the Orchestrator launches a specific role (ADR 0025). The role is not derivable from the existing `author` field (which is the *tool*: claude/codex/human), which is why it is recorded explicitly on the Run.
- The transcript at `runs/{task-id}/{run-id}.md` is a **Raw source** (ADR 0024) the Ingester may later fold into the wiki; the token frontmatter rides along with it and is git-diffable (or git-ignored per project if transcripts are large).
- Manual (Copy-prompt) runs and hand-coding produce **no** Run record, so they contribute no tokens — the breakdown reflects orchestrated Runs only. This is acceptable: tokens are a property of Runs the Cockpit owns.
