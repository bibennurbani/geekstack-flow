# The Cockpit becomes the Orchestrator now; the read-only invariant is retired

ADR 0020 framed Phase 2 as a **read-only Cockpit first**, earning the **Orchestrator** (agent-launching) through real use, with mocked "Run" affordances (Copy-prompt, ADR 0023) and a deliberately credential-free, file-projection server (ADR 0029). We are collapsing that two-step: the Cockpit **becomes the Orchestrator now**. The UI launches agents and writes canonical task files. ADRs 0024–0027 (run-state in files, execution model, concurrency, in-run governance) move from *deferred design* to *active build*.

## What changes

- **"Read-only" is retired.** The Cockpit now performs two kinds of write:
  1. **Status override** — a dropdown rewrites the canonical `Status:` line in `TASK {ID}.md`, free-form (any status, not just valid transitions — it exists for `BLOCKED`, corrections, and advancing without a Run), and **auto-appends** a YAML `### ENTRY START` entry (`author: human`, `via: cockpit`, old→new) so the change stays auditable.
  2. **Live Runs** — the server spawns the agent subprocess against a task, streams progress to the browser, and on completion writes a transcript to `runs/`. *(Amended per build decision D1:)* the agent itself appends the distilled log entry — it runs the coder procedure and self-logs; the server's only task-file write after a run is a **Status safety-net** that fires when a clean run left Status un-advanced. The server never distills a summary from the transcript.
- **Copy-prompt is demoted to a fallback** (ADR 0023's mocked Run is gone): a live Run is the default; Copy-prompt remains for driving an already-open AI session by hand.
- **The server gains a process-launching capability and a narrow write path.** It is still local-only (`127.0.0.1`), still no database, still no second store.

## The invariant that survives

The load-bearing rule was never "read-only" per se — it was **files are the single source of truth; no second store** (ADR 0004/0020). That holds unchanged: every write targets the canonical task files or the new `runs/` area, never a parallel DB. "Read-only" was a *consequence* the author adopted while writes weren't needed yet; writing the canonical file directly does not create a second store.

## Considered options

- **(A) Cockpit→Orchestrator now** — *chosen*. The user explicitly opted into the larger build. One UI, one process, no later "add the runner" migration.
- **(B) Keep ADR 0020's staging** (read-only Cockpit, Orchestrator later) — rejected by the user, accepting the deferred risks ADR 0020 catalogued (subprocess orchestration, per-tool CLI fragility, in-run governance, file locking) up front.
- **(C) File-writes only, runs stay manual** — rejected: it would give Status override but leave **Run tokens** without a real data source (only a live Run the server owns can capture usage). See ADR 0033.

## Consequences

- **Supersedes** the read-only / mocked-Run clauses of ADR 0020 and ADR 0023. ADR 0029's *Jira* path stays credential-free and read-only (the new write capability is for local task files and local subprocesses, not external systems) — Jira transitions remain out of scope.
- **Activates** ADRs 0024 (run-state in files), 0025 (execution model + per-role tool map), 0026 (sequential-within-project concurrency), 0027 (in-run pause-and-approve governance). The governance gate is implemented via Claude Code's `--permission-prompt-tool` delegating approval to a local MCP tool the Cockpit drives.
- **`runs/` is added** under `.tcgstackflow/` → a `workspace_schema` bump (ADR 0021); `upgrade` scaffolds it.
- **Tool scope:** Claude (`claude -p`) is the first and default runner per ADR 0025's tool map; Codex (`codex exec`) is the opt-in secondary, deferred behind Claude.
- A future hosted *team* product remains a different product (ADR 0020) — this reversal is about the **local** Cockpit only; a cloud server still physically cannot launch the developer's CLIs.

## Post-build amendments

- **Continuation loop.** A Run is no longer a single invocation: the executor drives up to **6** `claude` invocations per Run — iteration 0 sends the role prompt; subsequent iterations `claude --resume <session_id>` with a continue nudge until the agent advances Status to `IN_REVIEW` (or beyond). Tokens are **accumulated across iterations** into the run record's frontmatter, and a `continuing` SSE status is emitted between iterations. This amends the one-invocation execution model implied here and in ADR 0025; note the cost consequence — a stubborn run can spend up to ~6x a single invocation, traded against actually completing multi-step tasks (the gap surfaced by the first real orchestrated run).
- **Discuss chat.** `POST /api/run/message` resumes a finished run's session **read-only** (`claude --resume` with `--allowedTools Read,Grep,Glob,LS`, no governance MCP gate attached). It is a deliberate second agent-launch door beside `POST /api/run` (softening build decision D2), made safe by the read-only tool ceiling: the chat can inspect, never write.
