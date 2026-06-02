# Installation

`geekstackflow` is a Node CLI (zero runtime dependencies) plus an optional local Cockpit UI (Vue 3, dependencies isolated under `ui/`).

## Prerequisites

- **Node.js ≥ 18** (uses built-in `fetch`, `fs`, etc. — `node --version` to check).
- **git** (for the recommended install and for safe rollbacks during migration).
- An AI coding tool that reads project instructions — **Claude Code**, **Codex**, and/or **GitHub Copilot**.
- *(Optional)* the **Atlassian MCP** if you want Jira/Tempo features, and **[qmd](https://github.com/tobi/qmd)** if you want local wiki search.

## Option A — global install from npm (once published)

```bash
npm install -g geekstackflow
```

This puts two identical binaries on your PATH: **`geekstackflow`** and the short alias **`tcgflow`**.

## Option B — from a local clone (today)

```bash
git clone https://github.com/TheCreativeGeeks/geekstack-flow.git
cd geekstack-flow
npm link            # symlinks `geekstackflow` + `tcgflow` onto your PATH
```

`npm link` points the global binaries at your clone, so any edit to the tool is live immediately (useful while it's evolving).

> If you prefer not to link, you can always invoke it directly: `node /path/to/geekstack-flow/init.js <args>`. Everywhere this documentation says `geekstackflow`, that long form works too.

## Build the Cockpit UI (one-time)

The CLI works without this, but the full Cockpit (the Vue SPA) needs a one-time build:

```bash
cd geekstack-flow/ui
npm install
npm run build       # produces ui/dist/, which `geekstackflow ui` serves
```

If you skip this, `geekstackflow ui` still runs and serves a **built-in fallback page** with the same data — just less polished. Rebuild whenever you pull tool updates that touch `ui/`.

## Verify

```bash
geekstackflow --help          # prints usage
geekstackflow ui              # starts the Cockpit at http://127.0.0.1:4729
```

`Ctrl-C` to stop the Cockpit.

## What gets created where

- **Per project:** `.tcgstackflow/` (the workspace) + root adapter files (`CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md`) you opt into during `init`.
- **Per machine (once):** `~/.tcgstackflow/` — global cross-project memory (`memory/`), a shared tech-skill library (`skills/`), and the Cockpit's project registry (`projects.yaml`).
- **Claude Code (opt-in):** the `/tcgflow-*` slash commands installed to `~/.claude/skills/`.

Nothing is sent anywhere — it's all local files. The Cockpit binds to `127.0.0.1` only.

## Optional integrations

| Integration | Enables | Setup |
|---|---|---|
| **Atlassian MCP** | Jira status sync, Tempo timesheet submission, planner fetching tickets | Connect the Atlassian MCP in your AI tool; set `tempo.cloudId` + `admin_key` in the project's `config.yaml`. |
| **qmd** | Local semantic search over the wiki | Install qmd; the wiki is plain Markdown so it indexes as a collection. |
| **Snyk / Cypress / Datadog MCPs** | `task-from-*` commands that turn findings into tasks | Connect the respective MCP in your AI tool. |

## Next

→ **[QUICKSTART.md](QUICKSTART.md)** to initialise your first project.
