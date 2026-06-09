# runs/ — Orchestrator run records

`runs/` is a **top-level workspace area**, sibling to `tasks/`, `wiki/`, and `raw/`. It holds the immutable record of each **Run** — one execution of an agent against a task by the Orchestrator (the Cockpit's agent runner). Added at **workspace schema 4** (ADR 0024 / 0032 / 0033).

Each run is one file:

```
runs/{task-id}/{run-id}.md
```

- **`{run-id}`** is a server-generated id assigned when the run starts (before any model output). **The `run-id` names the file.**
- The **`session_id`** Claude reports for that run is recorded in the frontmatter, *not* in the filename. (This refines ADR 0033's "session_id names the transcript": the server needs an id up front, before the first stream event carries a `session_id`.)

## Run-record frontmatter

```yaml
---
task: ES-6965
role: coder            # planner | coder | reviewer | tester | ingester | refactorer
session_id: 550e8400-e29b-41d4-a716-446655440000
tokens:
  input: 1234
  output: 567
  cache_read: 8901
  cache_creation: 100
state: done            # running | done | failed | aborted   (Orchestrator-written; see note)
ended_at: 2026-06-09T14:32:00Z
---
<the raw agent transcript follows the frontmatter>
```

- `task`, `role`, `session_id`, `tokens.{input,output,cache_read,cache_creation}` are the keys fixed by **ADR 0033**. Token counts come straight from the agent subprocess's final `result` event (`usage.input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`). **Raw counts only — no dollar conversion.**
- `state` + `ended_at` are **Orchestrator-written** fields beyond ADR 0033's human-visible keys. They let the crash-reconcile scan tell a clean terminal record (`state: done|failed|aborted` present) from a half-written one (no terminal marker → the server died mid-run). This is a documented refinement of ADR 0033's frontmatter shape.

## How the Cockpit uses these

The Cockpit reads `runs/{task-id}/*.md` to build a task's **per-role token breakdown** (group runs by `role`) and **per-task total** (sum runs). A live counter ticks from the server's in-memory state during a run, then flushes here on completion.

## Notes

- The transcript body is a **Raw source** (ADR 0024) — the Ingester may later fold lessons from it into the wiki. It is written once and never mutated.
- `runs/` is **git-tracked by default** (diffable, portable like the rest of `.tcgstackflow/`). If transcripts get large, a project may add `runs/` to `.gitignore` — qmd can still index the working copy locally; the distilled summary in each task's log remains the durable committed record. This README is the only file that ships in the template; run records are created on demand.
