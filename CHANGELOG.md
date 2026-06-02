# Changelog

All notable changes to Creative GeekStack Flow are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Jira status sync (ADR 0029)

- **`sync-jira` skill + `/tcgflow-sync-jira` command** — the AI (Atlassian MCP) fetches each Jira-keyed task's status and writes a project-local snapshot `tasks/jira-cache.json`. The credential-free Cockpit server only *reads* this cache — it never calls Jira (preserves the zero-secret-server invariant, ADR 0020/0024).
- **Two statuses per task in the Cockpit** — workspace status (drives the action queue) + **Jira status** (badge linking to the ticket, "synced Xh ago", and a ⚠ **drift** flag when workspace and Jira disagree on done-ness). Read-only on Jira; transitioning tickets stays a separate explicit action.
- `init.js` offers `tasks/jira-cache.json` as a commented gitignore option (default committed — teammates see last-known Jira state).
- 15 skills, 16 commands.
- `copyDirSync` now skips OS/editor cruft (`.DS_Store`, `Thumbs.db`, `*.swp`, `node_modules`, `.git`) so it never ships into a user's workspace; repo-root `.gitignore` added.

### Added — Tester role (ADR 0028)

- **5th agent `tester` + `IN_TEST` status** — separates the dynamic gate (does it *work*?) from the reviewer's static gate (is the code *right*?). Lifecycle is now `IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED`. Reviewer approval routes to `IN_TEST`/Tester instead of straight to `VALIDATED`.
- **`verify` skill** — the Tester builds a test plan from acceptance criteria, documents it (task log + proposed `wiki/testing/{ID}.md`) or pushes it to **Jira** (HIGH, approval-gated), runs unit/E2E/app verification, and records a pass/fail verdict. Coder still writes unit tests inline; the Tester owns end-to-end verification + the test plan.
- **`/tcgflow-test` command** (14th command), agent `tester.md`, Cockpit cyan `IN_TEST` badge + `agent-tester` chip, status normalization (`In Test`/`Testing`/`QA` → `IN_TEST`).
- Tool adapters updated: 5 roles, 14 skills, `tcgflow-test`.

### Changed

- **`upgrade` now additively installs new skills** (absent → add, existing → never overwrite), in addition to refreshing tool-owned commands + agent profiles. So new/updated `tcgflow-*` commands, agent profiles, and skills (like the tester set) propagate to existing projects via `geekstackflow upgrade` — satisfying "add/update a skill or command → it ships through upgrade."

### Added — Cockpit (Phase 2, in progress)

- **`ui/` package** (ADR 0022) — the local Cockpit. Vue 3 + Vite SPA in `ui/src/`, served by a **zero-dependency Node `http` server** in `ui/server/` (a refinement of ADR 0022, which named Hono and allowed a substitute; built-in `http` is thinner and testable without an install). UI dependencies live in `ui/package.json` only — the root CLI (`init.js`) stays zero-dependency.
- **`geekstackflow ui [--port N]`** — launches the Cockpit at `http://127.0.0.1:4729` (default), opens a browser. Binds localhost only, no auth (ADR 0020).
- **Read-only API** — `GET /api/health`, `/api/projects` (registry + `update_available`), `/api/project?path=…` (config, version, action-queue, tasks, wiki summary). Pure projections over `.tcgstackflow/` files — no database (ADR 0024).
- **Action queue** (ADR 0023) — computed per project from task status via a status→next-agent map (`PLANNED→coder`, `IN_REVIEW→reviewer`, `VALIDATED→ingester`, …). The Home view aggregates queues across all registered projects.
- **Copy-prompt** (ADR 0023) — the mocked "Run" affordance: copies a ready-to-paste prompt for the next agent on a task. Clipboard only, no file writes. Becomes the Orchestrator's subprocess input later.
- **Built-in fallback UI** — the server serves a vanilla-JS page with the same functionality until the Vue SPA is built, so the cockpit works with zero `npm install`.
- **Second-pass panels** (ADR 0023) — per-project **Governance** (project-specific rules), **Timesheet** (this week's draft + submitted/draft status), and **Tools & MCP** (enabled tool adapters + recommended/optional MCP) panels in the data layer and the Vue SPA.

### Changed

- **`upgrade` now refreshes tool-owned files** (ADR 0021 amendment) — the `tcgflow-*` slash commands (in `.tcgstackflow/commands/` and the installed copies under `~/.claude/skills/`) and the shipped agent profiles (`.tcgstackflow/agents/`) are now refreshed to the installed templates so behavioural fixes ship via `upgrade` instead of waiting on a manual diff-merge. Drifted files are backed up to `{name}.bak` before being overwritten. Customization surfaces — `governance.md`, `config.yaml`, the skill library, and tool adapters — stay additive-only and untouched. Installed-command refresh only runs for projects already using Claude commands (≥1 `tcgflow-*` present in `~/.claude/skills/`); it never creates that directory from scratch.

### Fixed

- **Planner no longer fabricates Jira ticket context** — `/tcgflow-plan` and the `planner` agent now treat a Jira-style ID as requiring the real ticket: attempt the Atlassian MCP fetch, and if it can't connect, try to make it available, then **stop and ask** the user to connect the MCP or paste the ticket. Previously, when the MCP was absent, the Planner silently substituted an unrelated task's context.
- **`upgrade` now auto-registers the project** in the Cockpit registry. Previously only `init`/`register` wrote to `~/.tcgstackflow/projects.yaml`, so a project set up before the registry existed (or migrated via `upgrade`) never appeared in the Cockpit's left-nav. `upgrade` now adds it (idempotent).
- **Governance panel** no longer surfaces the template's commented-out example rules — HTML-comment blocks are stripped before extracting project-specific rules, so a fresh project correctly shows none.
- **Cockpit UI redesign** — replaced the broken `color-scheme: light dark` (which rendered dark text on a dark canvas, unreadable) with an explicit, AA-contrast design system: dark sidebar + light content, semantic **color-coded status badges** (PLANNED/IN_PROGRESS/IN_REVIEW/VALIDATED/COMPLETED/BLOCKED/DRAFT), agent-colored chips, card hover states, and a "✓ Copied" feedback state on Copy-prompt. Fallback page given an explicit light background too.
- **Status normalization** — task statuses are normalized to the canonical set before mapping to agents (`In Progress`/`WIP`/`Doing` → `IN_PROGRESS`, `Done`/`Closed`/`Shipped` → `COMPLETED`, `Review` → `IN_REVIEW`, etc.). Real-world projects (e.g. INX, which writes `Status: In Progress`) now populate the action queue correctly instead of showing unmapped raw statuses.

## [0.2.0] — 2026-06-01

Phase 2 foundation: workspace version stamping + a real migration runner, plus the no-dotfiles convention, MCP-derived task skills, and tool-portable commands.

### Added

- **Workspace version stamp** (ADR 0021) — every `config.yaml` now carries `tcgflow_version` (the tool semver that last touched it) and `workspace_schema` (an integer layout version). `init` stamps both; `upgrade` reads `workspace_schema` and migrates forward.
- **Migration runner** — `upgrade` is no longer a one-off layout-sniff. It reads the workspace's `workspace_schema`, applies every registered migration step from there up to the tool's `LATEST_SCHEMA` (each step idempotent), then stamps the new version. Schema 1 → 2 is the no-dotfiles migration. A workspace newer than the installed tool is detected and the user is told to update the tool. Foundation for the Cockpit's "Update available" badge.
- **Project registry** (CONTEXT "Project registry") — per-machine `~/.tcgstackflow/projects.yaml` feeding the Cockpit's left-nav. `init` auto-registers the project it scaffolds (dedup by resolved path). New **`geekstackflow register [target]`** subcommand adds an already-initialised project without re-running init (e.g. after cloning to a new machine). Registry is never committed — paths are machine-specific absolute paths.
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
