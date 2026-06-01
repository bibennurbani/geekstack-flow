# Agent run-state lives in files; no database, ever

The Orchestrator (Phase 2 target) runs agents, producing state that static workflow files don't have: run records, transcripts, and live progress. This is the obvious place to reach for a database — and the place the author's original "Postgres + pgvector if needed" instinct would cash in. We deliberately reject a database. Run-state lives in files, structured to fit the raw/distilled hierarchy the whole system already uses.

## Where each kind of run-state lives

| State | Location | Rationale |
|---|---|---|
| **Live / in-flight progress** | Ephemeral, in the local server's memory (it owns the subprocess); streamed to the browser via SSE/websocket | Live state needs no durability; flushed to files on completion |
| **Raw transcript** (verbose, immutable) | `.tcgstackflow/runs/{task-id}/{run-id}.md` — a **new top-level `runs/` area**, sibling to `tasks/`, `wiki/`, `raw/` | The transcript is a **Raw source** (immutable, verbose) — same category as code-scan output or MCP dumps; the Ingester can later fold lessons from it into the wiki |
| **Distilled summary** (outcome, files changed) | A YAML `### ENTRY START` entry appended to the task's existing `TASK {ID}.md` log | This is exactly the pattern the coder already follows (`author: 'codex'`, `summary`, `files`, `validation`) — an orchestrated run is an automated coder writing the same entry |

## Why files, not a database

- **Respects the two-file rule.** Transcripts must NOT go in the task folder (exactly two files, forever — ADR 0004). `runs/` is a separate sibling area; the task folder stays clean while its log gets a summary entry.
- **Reuses the raw/distilled spine.** Transcript = Raw (immutable, verbose); task-log summary = distilled; wiki = further distilled. Orchestrator output slots into the same hierarchy as everything else — no new mental model.
- **Keeps pgvector unjustified.** Transcripts are append-only text; qmd indexes them on-device for search (ADR 0006). Postgres + pgvector would duplicate qmd and add a daemon for zero gain. The only thing a DB adds is cross-project SQL aggregation, which the Home view's in-memory cache already covers at personal/team scale.
- **Git-native.** `runs/` is versioned, diffable, and portable like the rest of `.tcgstackflow/` (transcripts may be `.gitignore`d if large; that's a per-project choice).

## Consequences

- `runs/` is added under `.tcgstackflow/` when the Orchestrator lands — a `workspace_schema` bump at that point (ADR 0021).
- The Cockpit's task-detail panel is designed *now* to link to `runs/{task-id}/` transcripts and to show a `running` badge fed by the server's in-memory live state — so the Orchestrator slots in with no cockpit rework (forward-compat).
- The status→next-role action queue gains transient `running` / `failed` states from the server's live memory, layered over the durable file-derived statuses.
- No database is introduced at any phase of this tool. A future hosted *team* product (explicitly out of scope, ADR 0020) could add one, but that is a different product, not a phase of geekstackflow.
- Large transcripts: `runs/` can be git-ignored per project; qmd can still index the working copy locally. The summary entry in `TASK {ID}.md` (committed) remains the durable record.
