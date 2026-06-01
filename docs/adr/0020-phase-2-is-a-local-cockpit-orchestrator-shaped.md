# Phase 2 is a local, browser-accessed Cockpit — shaped for the Orchestrator it will become

Phase 2 adds a UI over the workflow. It ships in two maturity levels: a **Cockpit** (read-only viewer) first, growing into an **Orchestrator** (actually launches agents) — the stated end goal. The Cockpit is built so the Orchestrator slots in behind the same UI without a redesign: "Run" affordances are visually present from day one but mocked (deep-link or "coming soon") until the Orchestrator fills them in.

The UI runs as a **local process** that serves a browser SPA at `localhost:{port}`. It reads each project's `.tcgstackflow/` files directly — the files remain the single source of truth; the UI is a projection, never a second store. Each teammate runs their own local cockpit against their own clones. **No hosted backend, no deployed service, no database** in Phase 2.

## Considered options

- **Cockpit-first, local, orchestrator-shaped** — *chosen*.
- **Runner/orchestrator immediately** — rejected: re-introduces every risk deferred in ADR 0002 (subprocess orchestration, secrets, per-tool CLI fragility, worktree conflicts) before the cockpit has shown which run-actions are worth building. Earn it with real use.
- **Hosted backend** — rejected on a decisive technical ground: the Orchestrator must launch local CLI tools (`codex exec`, Claude Code) with the developer's own credentials and working tree. A cloud server physically cannot do this, so a hosted cockpit would hit a rewrite wall the moment the Orchestrator is added. Local from day one means cockpit and orchestrator are the same process at different maturity. Secondary: hosting client project contents raises privacy/compliance issues that local sidesteps entirely.

## Consequences

- The UI is launched by a CLI command (working name `geekstackflow ui`) that starts a localhost server and opens a browser tab. Nothing to deploy or secure.
- The files-as-source-of-truth invariant (the same one behind ADR 0004 and the de-duplication work) holds: the Cockpit never writes a parallel copy of task/wiki state into a DB.
- The vector-DB question is moot for the Cockpit: wiki search is already on-device via qmd (ADR 0006). pgvector/Postgres would duplicate qmd and require a running server — explicitly not adopted in Phase 2.
- A future hosted *team* dashboard (everyone sees one shared board) is a separate product/SaaS decision, not a phase of this tool. Deferred until the local Orchestrator has proven the workflow.
- The Orchestrator, when built, runs locally too — it launches agents on the developer's machine. The Cockpit's mocked Run affordances define the seam.
