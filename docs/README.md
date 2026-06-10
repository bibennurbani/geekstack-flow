# Creative GeekStack Flow — Documentation

Start here.

## Guides

| Guide | Read it when |
|---|---|
| **[INSTALL.md](INSTALL.md)** | Setting up `geekstackflow` on your machine (CLI + Cockpit). |
| **[QUICKSTART.md](QUICKSTART.md)** | You want a working workspace + Cockpit in ~5 minutes. |
| **[USAGE.md](USAGE.md)** | Day-to-day: the full plan→code→review→test→ingest workflow, every command, the Cockpit, timesheets, Jira sync, multi-project, troubleshooting. |

## Reference

- **[../README.md](../README.md)** — project overview, command & skill tables.
- **[../CONTEXT.md](../CONTEXT.md)** — the project's domain glossary (Wiki, Raw, Ingest, Agent, Skill, Command, Cockpit, Orchestrator, …).
- **[../CHANGELOG.md](../CHANGELOG.md)** — what changed, by version.
- **[adr/](adr/)** — 34 Architecture Decision Records (the *why* behind every design choice).

## One-paragraph mental model

`geekstackflow` puts a `.tcgstackflow/` folder in your project. That folder is the **shared brain** your AI tools read from: an AI-maintained **wiki** (project memory), a strict two-file **task** system, six **agent** roles — five in a clear lifecycle (`planner → coder → reviewer → tester → ingester`) plus an on-demand **refactorer** — **governance** with risk levels, and per-tool **adapters** (`CLAUDE.md`, `AGENTS.md`, Copilot). You drive work with `/tcgflow-*` **commands** (or natural language in any tool), and run it all from a local **Cockpit Orchestrator** (`geekstackflow ui`) that launches the next agent directly or hands you a copy-paste prompt. Everything is plain files — no database; the files are the source of truth.
