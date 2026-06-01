# {{project-name}} — GitHub Copilot Instructions

> Audience: GitHub Copilot, all modes. Auto-loaded on every chat session.

This project uses **Creative GeekStack Flow** for AI workflow scaffolding. Everything authoritative lives under `.tcgstackflow/`. **Do not edit files in `.tcgstackflow/tools/`** — they are generated.

## Workspace Overview

_(Per-project description — what is this codebase, who uses it, the projects it contains and their stacks. Filled in during init or by the first ingest. Example shape from a multi-project workspace:)_

| Project | Stack | Purpose |
|---|---|---|
| _(name)_ | _(stack)_ | _(one-line purpose)_ |

## How to operate in this workspace

Before any non-trivial action, read in this order:

1. **`.tcgstackflow/wiki/index.md`** — the Map of Content. Pick the pages relevant to the topic; do not load the whole wiki.
2. **`.tcgstackflow/governance.md`** — the four-level risk taxonomy and the permission-request recipe. HIGH/CRITICAL actions require an inline permission request.
3. **`.tcgstackflow/agents/{role}.md`** — the role profile you are acting as.

Then read **`~/.tcgstackflow/memory/*.md`** for the user's cross-project preferences.

## Task Tracking Convention

Every task uses **exactly 2 files** in `.tcgstackflow/tasks/active/{ID}/`:

1. `TASK {ID}.md` — Implementation log (overview + chronological YAML entries)
2. `TASK details {ID}.md` — Subtasks, acceptance criteria, status

**When starting a task** (e.g. "Let's work on ES-1234"):

1. Check `.tcgstackflow/tasks/README.md` for the active task index.
2. Look for existing files in `.tcgstackflow/tasks/active/`, then `completed/`, then `archive/`.
3. For new tasks: create folder + the two files.
4. For existing tasks: **append** to the existing two files — never split into per-subtask files.
5. Feature specs and architecture docs live in `.tcgstackflow/wiki/`, **not** in task folders.

**Commit format:** `[{TASK_ID}] Short description of change`

See `.tcgstackflow/agents/coder.md` for the YAML log entry shape; `.tcgstackflow/agents/planner.md` for the planning convention.

## Roles you can adopt

Same four as Claude / Codex — defined in `.tcgstackflow/agents/`:

| Role | When invoked | Profile |
|---|---|---|
| `planner` | "plan ES-1234", "design …", "task for …" | `.tcgstackflow/agents/planner.md` |
| `coder` | "implement ES-1234", "start coding" | `.tcgstackflow/agents/coder.md` |
| `reviewer` | "review the diff", "is this ready?" | `.tcgstackflow/agents/reviewer.md` |
| `ingester` | "ingest ES-1234", "fold into wiki" | `.tcgstackflow/agents/ingester.md` |

## Per-Domain Instructions

Narrower per-area Copilot guidance lives at `.tcgstackflow/tools/github/instructions/*.instructions.md` and is auto-loaded by Copilot from the symlinked `.github/instructions/`. Add files here for things like:

| File pattern | Purpose |
|---|---|
| `task-management.instructions.md` | Detail on the two-file task workflow |
| `{frontend-area}.instructions.md` | Frontend-specific patterns (e.g. `spa-frontend.instructions.md`) |
| `{backend-area}.instructions.md` | Backend-specific patterns (e.g. `api-backend.instructions.md`) |
| `{testing-tool}.instructions.md` | Testing patterns (e.g. `cypress-testing.instructions.md`) |

These complement — they do not duplicate — the agent profiles in `.tcgstackflow/agents/` and the workflow skills in `.tcgstackflow/skills/`.

## Skills

Two locations:

- **Workflow skills** live at `.tcgstackflow/skills/` — project-versioned, conventions specific to this project. Thirteen ship in V1 (`grill-task`, `plan-task`, `update-task-log`, `review-diff`, `ingest`, `lint-wiki`, `audit-workspace`, `migrate-to-gsf`, `task-from-snyk`, `task-from-cypress`, `task-from-datadog`, `generate-timesheet`, `submit-timesheet`).
- **Tech skills** live at `~/.tcgstackflow/skills/` — global library, cross-project. Vue, Vuetify, Pinia, Cypress, .NET, Pulumi, Auth0, etc. Install with `cd ~/.tcgstackflow/skills && npx skills add <owner/repo@skill>`.

Both locations are readable to Copilot. Tech-skill content is referenced from project guidance but not duplicated into the project.

## Prime Directives

1. **Mirror existing patterns.** Imitate the structure, naming, and conventions already in the codebase.
2. **Minimal, purpose-driven changes.** Avoid bundling refactors with features.
3. **Delay abstraction** until the third repetition justifies shared code.
4. **Comments explain WHY**, not WHAT. Never put task IDs in code comments.
5. **Don't reformat untouched code** or reorder imports without necessity.
6. **Each PR/change has a single clear concern.**
7. **Append-only task logs.** Never delete prior YAML entries.

## Commands (invocation in Copilot)

The workspace ships fourteen workflow commands at `.tcgstackflow/commands/{name}/SKILL.md`. Each command file describes its trigger phrases. Copilot dispatches by natural language — type the trigger into Copilot Chat or describe the action; Copilot reads the matching command file and follows its procedure. Example triggers:

| Workflow | Trigger phrases |
|---|---|
| `tcgflow-plan` | "plan ES-1234", "design the new feature", "task for X" |
| `tcgflow-code` | "implement ES-1234", "start coding the planned task" |
| `tcgflow-review` | "review the diff", "is ES-1234 ready?" |
| `tcgflow-ingest` | "ingest ES-1234", "fold this into the wiki" |
| `tcgflow-lint` | "lint the wiki", "find stale pages" |
| `tcgflow-audit` | "audit the workspace", "are skills in sync?" |
| `tcgflow-task-from-snyk` | "create tasks from Snyk", "process vulnerabilities" |
| `tcgflow-task-from-cypress` | "create tasks from failing tests", "what's flaky?" |
| `tcgflow-task-from-datadog` | "create a task from the latest incident" |
| `tcgflow-timesheet-generate` | "generate this week's timesheet" |
| `tcgflow-timesheet-submit` | "submit the timesheet to Tempo" (HIGH risk) |
| `tcgflow-upgrade` | "upgrade this workspace" |
| `tcgflow-init` | "set up geekstackflow here" |
| `tcgflow-migrate` | "migrate this project to geekstackflow" |

The slash-command form (`/tcgflow-*`) is a Claude-Code-specific UX shortcut; the underlying workflows live as files in this workspace and are tool-portable. Same content; different invocation UI per tool.

## Strict Invariants

- **Two-file task rule.** Every task is exactly `TASK {ID}.md` + `TASK details {ID}.md`. Never `TASK {ID}-FE-1.md`, never `FIXES.md`.
- **Log-first ingestion.** No wiki page edit happens before the `wiki/log.md` entry is drafted. Locked prefix: `## [YYYY-MM-DD] {operation} | {title}`.
- **New pages and deletions are gated.** Existing-page updates flow; structural wiki changes always ask.
- **Raw is immutable.** Codebase, completed task files, MCP outputs — read-only.
- **Stable file paths.** Renames preserve backlinks via `aliases:` frontmatter.
- **HIGH/CRITICAL actions need recorded approval.** Permission-request recipe in `governance.md`; approval captured in the task log.

## Project-specific overrides

_(Edit below this line. The init script does not touch content beyond this point on subsequent runs.)_

---
