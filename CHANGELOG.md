# Changelog

All notable changes to Creative GeekStack Flow are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
