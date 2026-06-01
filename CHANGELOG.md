# Changelog

All notable changes to Creative GeekStack Flow are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`init.js --upgrade`** — non-destructive in-place upgrade of a pre-v0.2 workspace. Renames pre-v0.2 dotted subfolders (`.weekly/` → `weekly/`, `.archived/` → `archived/`, `.migration-notes/` → `migration-notes/`), moves `.tcgstackflow/.gitignore` content to the project-root `.gitignore` with a marker block, and creates the Obsidian symlink if missing. Leaves task content, wiki, agents, skills, and tool adapters untouched.
- **`/tcgflow-upgrade`** slash command — dispatches to `init.js --upgrade`. Brings command count to **14**.
- **ADR 0019** — workflows are tool-portable; slash commands are a Claude Code UX shortcut. The `templates/claude-commands/` folder is **removed**; commands now live canonically at `templates/workspace/.tcgstackflow/commands/` and propagate into every initialised project at `.tcgstackflow/commands/`. Codex, GitHub Copilot, Antigravity, and any other AI tool can read and dispatch them directly from the workspace; Claude Code additionally installs them to `~/.claude/skills/` for the `/slash` UX. Tool adapter files (`CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md`) gain a "Commands (invocation)" section explaining tool-specific invocation.
- **3 MCP-derived task skills** (ADR 0018): `task-from-snyk`, `task-from-cypress`, `task-from-datadog`. Each converts MCP output (security findings, test failures, incident telemetry) into a `PLANNED` task with the standard two-file shape — grouped by source-appropriate unit (package / spec / incident), with dedup against existing tasks and severity-aware risk escalation.
- **3 matching `/tcgflow-task-from-*` slash commands** in the global Claude Code skills set.
- **ADR 0017** — formalises the "no dotfiles inside `.tcgstackflow/`" convention; renames `tasks/.weekly/` → `tasks/weekly/`, `raw/.archived/` → `raw/archived/`, `.migration-notes/` → `migration-notes/`. Workspace `.gitignore` removed; `init.js` now writes a marked block into the project-root `.gitignore`.
- **`init.js` Obsidian-symlink prompt** — creates `tcgstackflow/ → .tcgstackflow/` so Obsidian's vault picker (which hides dotfiles) can select the workspace.

### Changed

- V1 starter skill set: 10 → **13** skills.
- V1 slash command set: 10 → **14** commands.

### Fixed

- **`geekstackflow init [args]` subcommand parsing.** When invoked via the `geekstackflow` or `tcgflow` bin entries, the leading `init` token was being treated as a positional target path, causing `geekstackflow init --upgrade .` to fail with *"No .tcgstackflow/ found at &lt;cwd&gt;/init"*. The parser now discards a leading `init` as a no-op subcommand and accepts `upgrade` as a subcommand alias for `--upgrade`. All invocation forms — `geekstackflow init`, `geekstackflow upgrade`, `geekstackflow --upgrade`, `node init.js --upgrade` — now work equivalently.

### Migration

For existing pre-v0.2 workspaces, run `geekstackflow init --upgrade .` from the project root. Slash commands installed in `~/.claude/skills/` before this release reference old paths (`.weekly/`, etc.) — refresh them with `cp -R templates/claude-commands/* ~/.claude/skills/` and restart Claude Code sessions to pick them up.

## [0.1.0] — 2026-05-31

First public-ready release. Personal-first scope; team and OSS gates are next.

### Added

- **`init.js`** — pure Node built-ins, no dependencies. Initialises `.tcgstackflow/` in the target project, optionally writes per-tool root adapters (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`), seeds `~/.tcgstackflow/` global memory and skill library on first run. Supports `--force`, `--migrate-from <path>`, and `--help`.
- **Multi-project detection** — when `init.js` finds 2+ top-level directories with project signal files (`package.json`, `*.csproj` at top or in `src/<project>/`, `Pulumi.yaml`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `pom.xml`, `composer.json`), it switches `workspace_kind` to `multi-project` and auto-populates `config.yaml`'s `projects:` array with inferred stack and commands.
- **Workspace template** (`templates/workspace/.tcgstackflow/`):
  - 4 agent profiles: `planner`, `coder`, `reviewer`, `ingester`.
  - 10 starter skills: `grill-task`, `plan-task`, `update-task-log`, `review-diff`, `ingest`, `lint-wiki`, `audit-workspace`, `migrate-to-gsf`, `generate-timesheet`, `submit-timesheet`.
  - 5 wiki starter pages: `index`, `log`, `project-overview`, `architecture`, `domain`, plus `adr/`.
  - 3 tool adapters: Claude Code (`CLAUDE.md`), Codex (`AGENTS.md`), GitHub Copilot (`copilot-instructions.md` + per-domain `instructions/`).
  - Two-file task tracking with strict invariant (`TASK {ID}.md` + `TASK details {ID}.md`, never split).
  - Governance (`governance.md`): four risk levels (LOW / MEDIUM / HIGH / CRITICAL) and the permission-request recipe.
  - Tempo timesheet flow as two skills (`generate-timesheet` LOW + `submit-timesheet` HIGH) with `submission_mode: approval | trust`.
- **Global template** (`templates/global/.tcgstackflow/`): `memory/` with `preferences`, `workflow-conventions`, `domain-knowledge`, `tools` Markdown files; `skills/` as the global tech-skill library home.
- **`/tcgflow-*` slash commands** — installed under `~/.claude/skills/` when the user opts in during init. See README.
- **15 Architecture Decision Records** capturing every substantive design call from scope through V1 implementation.
- `LICENSE` (MIT), `CONTRIBUTING.md`, this `CHANGELOG.md`, `package.json` with `geekstackflow` and `tcgflow` `bin` entries.

### Notes

- This release is suitable for personal use and small-team trials. OSS distribution is supported but not yet broadly tested in heterogeneous environments. See ADR 0001 for the personal-first → team-usable → OSS-ready ladder.
- The `migrate-to-gsf` skill packages the clean-cutover-with-backups pattern for moving an existing project off ad-hoc AI infrastructure onto `.tcgstackflow/`.
