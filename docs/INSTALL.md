# Installation

`geekstackflow` is a Node CLI (zero runtime dependencies) plus an optional local Cockpit UI (Vue 3, dependencies isolated under `ui/`).

## Prerequisites

- **Node.js ≥ 22** (the baseline since the mandatory qmd wiki-search layer needs it; the CLI itself uses only built-in `fetch`, `fs`, etc. — `node --version` to check).
- **git** (for the recommended install and for safe rollbacks during migration).
- An AI coding tool that reads project instructions — **Claude Code**, **Codex**, and/or **GitHub Copilot**.
- **[qmd](https://github.com/tobi/qmd)** — the mandatory wiki search layer (see [Wiki search (qmd)](#wiki-search-qmd) below). Needs **Node.js ≥ 22** and **~2 GB disk** for its local models; on macOS, `brew install sqlite`.
- *(Optional)* the **Atlassian MCP** if you want Jira/Tempo features.

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

## Wiki search (qmd)

[qmd](https://github.com/tobi/qmd) is the **mandatory** discovery layer over the LLM-wiki (and your project's own `docs/`) — a local hybrid index (keyword + vector + LLM re-rank). Every agent uses it as the entry point for finding which wiki pages are relevant before reading them; `wiki/index.md` stays the always-current fallback (ADR 0030).

**Requirements:** **Node.js ≥ 22**, **~2 GB disk** for the local models, and on macOS `brew install sqlite`.

**Installed and indexed by `/tcgflow-init`.** Because `init.js` is dependency-free by design, the script only scaffolds the `wiki_search` config and prints the next step — the `/tcgflow-init` AI command then performs the permission-gated install + first index (a HIGH action per `governance.md`).

To set it up by hand:

```bash
npm i -g @tobilu/qmd
qmd collection add .tcgstackflow/wiki --name wiki --mask "*.md"   # add a `docs` collection too if the project has docs/
qmd context add qmd://wiki "Project knowledge wiki — architecture, domain glossary, features, decisions, operations"
qmd embed                                            # build the index
qmd status                                           # confirm collections + chunk counts
```

The Ingester re-embeds after every ingest, so the index stays fresh. If you decline the install, the workspace falls back to `index.md` Map-of-Content navigation.

## Optional integrations

| Integration | Enables | Setup |
|---|---|---|
| **Atlassian MCP** | Jira status sync, Tempo timesheet submission, planner fetching tickets | Connect the Atlassian MCP in your AI tool; set `tempo.cloudId` + `admin_key` in the project's `config.yaml`. |
| **qmd MCP** *(optional)* | A Claude convenience for [wiki search](#wiki-search-qmd) — Claude calls the MCP tool instead of shelling out to the canonical CLI; same results | Wire the qmd MCP in Claude (`config.yaml` `mcp.recommended`). qmd itself is required regardless (see above); the MCP only changes how Claude invokes it. |
| **Snyk / Cypress / Datadog MCPs** | `task-from-*` commands that turn findings into tasks | Connect the respective MCP in your AI tool. |

## Next

→ **[QUICKSTART.md](QUICKSTART.md)** to initialise your first project.
