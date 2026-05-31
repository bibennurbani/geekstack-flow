# OSS-ready packaging plus `/tcgflow-*` Claude Code slash commands

V1's "personal-first → team-usable → OSS-ready" ladder (ADR 0001) reaches the OSS-ready rung. The tool now ships as a real npm package: `LICENSE` (MIT), `CONTRIBUTING.md`, `CHANGELOG.md`, and `package.json` with two `bin` entries (`geekstackflow` and `tcgflow`) so the installer is on PATH after `npm install -g geekstackflow`. The `.tcgstackflow/` workspace folder is also positioned as the project's **Obsidian vault** — vault config in `.gitignore` excludes volatile state files while keeping shared plugin/hotkey/theme config trackable. Finally, a set of ten **Claude Code slash commands** prefixed `/tcgflow-*` ships under `templates/claude-commands/`, installable globally to `~/.claude/skills/` via an opt-in init prompt.

## What's in the OSS package

| File | Purpose |
|---|---|
| `LICENSE` | MIT — matches the README's stated intent, makes redistribution unambiguous |
| `package.json` | `name: geekstackflow`, `bin: { geekstackflow, tcgflow }`, `files: [init.js, templates/, docs/, ...]`, Node 18+ engine, MIT license |
| `CONTRIBUTING.md` | Local setup, ADR conventions, how to add skills / slash commands / tool adapters, style guide |
| `CHANGELOG.md` | Keep-a-Changelog format, semver, initial `0.1.0` entry |

## Slash commands

Ten commands ship in `templates/claude-commands/`:

| Command | Role / Skill it dispatches |
|---|---|
| `/tcgflow-init` | Run the installer (`geekstackflow init .`) |
| `/tcgflow-migrate` | Migrate an existing project's ad-hoc AI infra onto canonical layout (uses `migrate-to-gsf` skill) |
| `/tcgflow-plan` | Adopt Planner role; grill + write `TASK details` |
| `/tcgflow-code` | Adopt Coder role; execute a PLANNED task |
| `/tcgflow-review` | Adopt Reviewer role; walk diff against acceptance + governance |
| `/tcgflow-ingest` | Adopt Ingester role; fold a Raw source into the wiki, log-first |
| `/tcgflow-lint` | Run `lint-wiki` skill |
| `/tcgflow-audit` | Run `audit-workspace` skill |
| `/tcgflow-timesheet-generate` | Weekly Tempo draft (LOW) |
| `/tcgflow-timesheet-submit` | Submit worklogs via Atlassian MCP (HIGH) |

Install path: each command is `~/.claude/skills/tcgflow-{name}/SKILL.md` — Claude Code's standard global-skills location. Install happens during `init.js` when the user accepts the new prompt *"Install /tcgflow-* slash commands into ~/.claude/skills/?"* (default Y when Claude Code is enabled, suppressed when Claude is not).

The commands are **action skills** (do something — dispatch a role or skill), distinct from **tech skills** (`vue`, `pinia`, etc., apply expertise). Both formats are `SKILL.md` and both live under `~/.claude/skills/`; only their purpose differs.

## Obsidian vault

The entire `.tcgstackflow/` folder is the Obsidian vault by default. Includes:

- Wiki pages with `[[wikilinks]]` (the meat of the graph view)
- Agent profiles and skill `SKILL.md` files (readable, browsable)
- `tasks/` two-file pairs (readable; the YAML log entries render cleanly)
- `governance.md`, `wiki/log.md`, `config.yaml`

`.gitignore` shipped at workspace root excludes Obsidian's volatile state (`workspace.json`, `graph.json`, etc.) while keeping shared config (plugins, hotkeys, themes) trackable across teammates. A narrower scope (`.tcgstackflow/wiki/` only) is documented as an alternative for users who want a wiki-only graph.

## Consequences

- `npm install -g geekstackflow` makes `geekstackflow init .` and `tcgflow init .` available on PATH; bare `node init.js .` continues to work from a clone.
- `init.js` grows a new opt-in prompt for slash commands and the supporting copy logic; default ON when Claude Code is enabled.
- Slash commands are added/removed as a versioned set in `templates/claude-commands/`; CHANGELOG entries record the cadence.
- New tools, skills, or workflows that warrant a slash command can be added in any minor release.
- Versioning: this is `0.1.0`. Public OSS publish (`npm publish`) is the next step but not part of this ADR — that's an operational milestone, not a design decision.
