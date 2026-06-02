# {{project-name}} — Claude Code workspace

This project uses **Creative GeekStack Flow** for AI workflow scaffolding. Everything authoritative lives under `.tcgstackflow/`. **Do not edit files in `.tcgstackflow/tools/`** — they are generated.

## How to operate in this workspace

Before any non-trivial action, read in this order:

1. **`.tcgstackflow/wiki/index.md`** — the Map of Content. Pick the pages relevant to the topic, do not load the whole wiki.
2. **`.tcgstackflow/governance.md`** — the four-level risk taxonomy and the permission-request recipe. HIGH/CRITICAL actions require an inline permission request.
3. **`.tcgstackflow/agents/{role}.md`** — the role profile you are acting as. Profiles are tool-agnostic; this file is your project-specific operating manual.

Then read **`~/.tcgstackflow/memory/*.md`** for the user's cross-project preferences (package manager, code style, test framework, workflow conventions).

## Roles you can adopt

| Role | When the user invokes it | Profile |
|---|---|---|
| `planner` | "plan ES-1234", "let's design …", "we need a task for …" | [agents/planner.md](../../agents/planner.md) |
| `coder` | "implement ES-1234", "work on the planned task", "start coding" | [agents/coder.md](../../agents/coder.md) |
| `reviewer` | "review the diff", "is this ready?", "check ES-1234" | [agents/reviewer.md](../../agents/reviewer.md) |
| `tester` | "test ES-1234", "verify this works", "run the E2E", "write a test plan" | [agents/tester.md](../../agents/tester.md) |
| `ingester` | "ingest ES-1234", "fold this into the wiki", "ingest raw/" | [agents/ingester.md](../../agents/ingester.md) |

Lifecycle: `planner → coder → reviewer → tester → ingester` (`IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED`). Reviewer checks the code is *right* (static); Tester checks it *works* (dynamic).

Each profile lists which files it reads, which it writes, which skills it uses, and what its hand-off condition is. Stay inside the profile's `Writes:` list — that is the strongest invariant of role discipline.

## Skills available

Under `.tcgstackflow/skills/`. Fifteen starter skills ship with V1:

| Skill | Role | Purpose |
|---|---|---|
| [`grill-task`](../../skills/grill-task/SKILL.md) | planner | Interview the user before writing the plan |
| [`plan-task`](../../skills/plan-task/SKILL.md) | planner | Write the two-file task structure |
| [`update-task-log`](../../skills/update-task-log/SKILL.md) | coder | Append YAML entry to `TASK {ID}.md` |
| [`review-diff`](../../skills/review-diff/SKILL.md) | reviewer | Walk diff against acceptance + governance |
| [`verify`](../../skills/verify/SKILL.md) | tester | Build a test plan, run tests/E2E/app, record a pass/fail verdict |
| [`ingest`](../../skills/ingest/SKILL.md) | ingester | Fold a Raw source into the wiki, log-first |
| [`lint-wiki`](../../skills/lint-wiki/SKILL.md) | ingester | Periodic health-check of the wiki |
| [`audit-workspace`](../../skills/audit-workspace/SKILL.md) | ingester / standalone | Cross-check agents ↔ skills ↔ codebase drift |
| [`migrate-to-gsf`](../../skills/migrate-to-gsf/SKILL.md) | planner / coder | Migrate an existing project's ad-hoc AI infra onto canonical `.tcgstackflow/` |
| [`task-from-snyk`](../../skills/task-from-snyk/SKILL.md) | planner / standalone | Create a PLANNED task from Snyk findings, grouped by package |
| [`task-from-cypress`](../../skills/task-from-cypress/SKILL.md) | planner / standalone | Create a PLANNED task from Cypress failures, classified by failure type |
| [`task-from-datadog`](../../skills/task-from-datadog/SKILL.md) | planner / standalone | Create a task from a Datadog incident/alert — investigate / mitigate / fix / postmortem |
| [`sync-jira`](../../skills/sync-jira/SKILL.md) | any (LOW) | Fetch Jira status of tasks via Atlassian MCP → `tasks/jira-cache.json` (Cockpit reads it) |
| [`generate-timesheet`](../../skills/generate-timesheet/SKILL.md) | user (LOW) | Weekly Tempo draft from task data |
| [`submit-timesheet`](../../skills/submit-timesheet/SKILL.md) | user (HIGH) | Submit worklogs via Atlassian MCP |

Skills are atomic — one capability per skill. Compose them via agent profiles.

## Commands (invocation shortcuts)

Same workflows, shipped in two forms — both live at `.tcgstackflow/commands/{name}/SKILL.md`:

- **Claude Code** (this tool) reads them as global slash commands from `~/.claude/skills/` (installed by `init.js`). Type `/tcgflow-init`, `/tcgflow-plan`, etc.
- **Other AI tools** (Codex, GitHub Copilot, Antigravity, Continue, etc.) read the SAME files at the workspace location `.tcgstackflow/commands/`. They are dispatched via natural-language phrases listed in each command's `description` — e.g. *"plan ES-1234"* invokes the same workflow `/tcgflow-plan` does for Claude.

A command is a thin dispatcher: each `commands/{name}/SKILL.md` describes when to invoke and which workspace skill or agent role to use. The actual behaviour lives in `.tcgstackflow/skills/` and `.tcgstackflow/agents/`. Result: workflows are **tool-portable**; the slash-command UX is **Claude-specific**.

## Strict invariants

- **Two-file task rule.** Every task is exactly `TASK {ID}.md` + `TASK details {ID}.md`. Never `TASK {ID}-FE-1.md`, never `FIXES.md`. Append to the existing two files.
- **Log-first ingestion.** No wiki page edit happens before the `wiki/log.md` entry is drafted. Locked entry prefix: `## [YYYY-MM-DD] {operation} | {title}`.
- **New pages and deletions are gated.** Existing-page updates flow; structural wiki changes always ask for explicit approval.
- **Raw is immutable.** Codebase, completed task files, MCP outputs — read-only. Never edit Raw.
- **Stable file paths.** Wiki pages are addressed by path; renames must add `aliases:` frontmatter so backlinks resolve.
- **HIGH/CRITICAL actions need recorded approval.** Inline permission request format in `governance.md`; approval string captured in the task log's `governance:` field.

## Wiki reading guide

The wiki is flat, Obsidian-flavoured Markdown with `[[wikilinks]]`. Pattern is [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Search and re-rank is via [qmd](https://github.com/tobi/qmd) when wired as an MCP.

- Start at `wiki/index.md`.
- Follow `[[wikilinks]]` only to pages relevant to the current topic.
- Bump `updated:` frontmatter whenever you touch a page during ingestion.
- Frontmatter schema: `title`, `tags`, `aliases`, `priority` (P0/P1/P2), `created`, `updated`, `status` (`current` | `stub` | `archived`).

## Cross-tool handoff

When the user asks for cross-tool execution ("Claude plans, Codex codes"), the workflow is **manual handoff**:

1. The Planner agent writes a prompt file at `.tcgstackflow/prompts/{task-id}/{target-tool}-{intent}.md`.
2. The user pastes the file's contents into the target tool (Codex, Antigravity).
3. The target tool executes against the same `tasks/active/{ID}/` files.
4. On return, Claude re-reads the updated task log and proceeds (review, ingest).

Automated handoff (Claude shelling out to `codex exec`) is **not** part of V1.

## Global memory

User-level cross-project preferences live at `~/.tcgstackflow/memory/`. Read these files at session start; local wiki always wins on conflict.

## Project-specific overrides

_(Edit below this line. The init script does not touch content beyond this point on subsequent runs.)_

---
