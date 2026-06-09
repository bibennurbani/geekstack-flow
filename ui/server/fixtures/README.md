# Test fixtures

## `claude-stream.ndjson` — real `claude -p` stream-json capture (API-0)

A **genuine** capture (not hand-written) from `claude` **2.1.169 (Claude Code)**, invoked as:

```
claude -p "Reply with exactly the two characters: ok" --output-format stream-json --verbose
```

It pins the on-the-wire shapes the Orchestrator's token parser (API-4 / ADR 0033) depends on, against reality rather than docs. **Sanitized:** the `system` event's environment inventory (`tools`, `mcp_servers`, `slash_commands`, `skills`, `agents`, `plugins`, `memory_paths`) and the working-dir/home path were stripped/redacted; everything load-bearing for the parser is preserved verbatim.

### What it confirms

- **Event sequence (this flag set):** `system` → `assistant` → `rate_limit_event` → `result`. Four whole-message events.
- **`session_id`** first appears on the **`system`** (init) event and is repeated on every later event. → capture it from the first event that carries it.
- **`usage`** lives on the **`result`** event, with the exact ADR-0033 field names:
  `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
  (plus extras like `cache_creation{}`, `iterations[]`, `server_tool_use` — ignore them).
- `total_cost_usd` **is** present on `result` — we deliberately ignore it (ADR 0033 rejects $-cost).

### ⚠ Finding that shapes API-3

With `--output-format stream-json --verbose` **and no `--include-partial-messages`**, the assistant reply arrives as **one whole `assistant` event** — there are **no `content_block_delta` / `text_delta` events**. So:

- **Token capture alone** needs only the final `result` event → these flags suffice.
- **Live token-by-token streaming** (UI-5's delta pane) requires adding **`--include-partial-messages`** to the spawn (API-3), which adds `stream_event` / `content_block_delta` events. A second fixture *with* that flag should be captured before wiring UI-5's delta rendering.
