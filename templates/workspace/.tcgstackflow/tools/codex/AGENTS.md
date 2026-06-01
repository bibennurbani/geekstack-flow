# {{project-name}} — Codex / agentic-tool workspace

This project uses **Creative GeekStack Flow** for AI workflow scaffolding. Everything authoritative lives under `.tcgstackflow/`. This file is read by Codex (and other tools that respect `AGENTS.md`) as the project's operating manual. **Do not edit files in `.tcgstackflow/tools/`** — they are generated.

## How to operate in this workspace

Before any non-trivial action, read in this order:

1. **`.tcgstackflow/wiki/index.md`** — the Map of Content. Pick the pages relevant to the topic; do not load the whole wiki.
2. **`.tcgstackflow/governance.md`** — the four-level risk taxonomy and the permission-request recipe. HIGH/CRITICAL actions require an inline permission request.
3. **`.tcgstackflow/agents/{role}.md`** — the role profile you are acting as. These profiles are tool-agnostic; this file is your project-specific operating manual.

Then read **`~/.tcgstackflow/memory/*.md`** for the user's cross-project preferences.

## Roles you can adopt

| Role | When the user invokes it | Profile |
|---|---|---|
| `planner` | "plan ES-1234", "design …", "task for …" | [agents/planner.md](.tcgstackflow/agents/planner.md) |
| `coder` | "implement ES-1234", "start coding" | [agents/coder.md](.tcgstackflow/agents/coder.md) |
| `reviewer` | "review the diff", "is this ready?" | [agents/reviewer.md](.tcgstackflow/agents/reviewer.md) |
| `ingester` | "ingest ES-1234", "fold into wiki" | [agents/ingester.md](.tcgstackflow/agents/ingester.md) |

## Cross-tool handoff context

You may be invoked because **Claude wrote the plan** and **you are executing it**. In that case:

- Read the prompt file at `.tcgstackflow/prompts/{task-id}/{your-tool}-{intent}.md` if one was provided.
- Read the corresponding `tasks/active/{task-id}/TASK details {task-id}.md` for the canonical plan.
- Operate as the **coder** role unless told otherwise.
- Use `update-task-log` after each meaningful change, setting `author: 'codex'` (or your tool's identity) in YAML entries.
- HIGH/CRITICAL actions require an inline permission request *to the user* — even when handed off from Claude.

## Skills

Under `.tcgstackflow/skills/`. Same eight starter skills as Claude — the format is portable (`SKILL.md` with frontmatter `name` and `description`). Read them as if they were specifications written for you.

| Skill | Used by | One-line purpose |
|---|---|---|
| `grill-task` | planner | Interview the user on ambiguous areas |
| `plan-task` | planner | Write the two-file task structure |
| `update-task-log` | coder | Append YAML entry to `TASK {ID}.md` |
| `review-diff` | reviewer | Walk diff against acceptance + governance |
| `ingest` | ingester | Fold a Raw source into the wiki |
| `lint-wiki` | ingester | Periodic health-check of the wiki |
| `audit-workspace` | ingester | Cross-check agents ↔ skills ↔ codebase drift |
| `migrate-to-gsf` | planner / coder | Migrate existing project onto canonical layout |
| `task-from-snyk` | planner / standalone | Generate a task from Snyk findings, grouped by package |
| `task-from-cypress` | planner / standalone | Generate a task from Cypress failures, classified by failure type |
| `task-from-datadog` | planner / standalone | Generate a task from a Datadog signal — investigate / mitigate / fix / postmortem |
| `generate-timesheet` | user (LOW) | Weekly Tempo draft |
| `submit-timesheet` | user (HIGH) | Submit worklogs via Atlassian MCP |

## Commands (invocation in this tool)

The workspace ships fourteen workflow commands at `.tcgstackflow/commands/{name}/SKILL.md`. Each command file describes its trigger phrases — Codex (and any other AI tool reading this AGENTS.md) **dispatches by natural language**, not by slash command. Example triggers:

- *"plan ES-1234"*, *"design the new payment flow"* → invoke the `tcgflow-plan` workflow → adopt planner role + use `grill-task` and `plan-task` skills
- *"implement ES-1234"*, *"start coding"* → `tcgflow-code` workflow → coder role + `update-task-log`
- *"review the diff"*, *"is ES-1234 ready?"* → `tcgflow-review` workflow → reviewer role + `review-diff`
- *"ingest ES-1234"*, *"fold this into the wiki"* → `tcgflow-ingest` workflow → ingester role + `ingest`
- *"lint the wiki"* → `tcgflow-lint` workflow → `lint-wiki` skill
- *"audit the workspace"* → `tcgflow-audit` workflow → `audit-workspace` skill
- *"create tasks from Snyk"*, *"process the latest vulnerabilities"* → `tcgflow-task-from-snyk` workflow
- *"create tasks from failing tests"*, *"what's flaky?"* → `tcgflow-task-from-cypress` workflow
- *"create a task from the latest incident"* → `tcgflow-task-from-datadog` workflow
- *"generate this week's timesheet"* → `tcgflow-timesheet-generate` workflow
- *"submit the timesheet to Tempo"* → `tcgflow-timesheet-submit` workflow (HIGH risk)
- *"upgrade this workspace"* → `tcgflow-upgrade` workflow
- *"set up geekstackflow here"* → `tcgflow-init` workflow
- *"migrate this project to geekstackflow"* → `tcgflow-migrate` workflow

When you (Codex) receive any of these phrases, read the relevant `.tcgstackflow/commands/{name}/SKILL.md` for the full procedure and follow it. The slash-command form (`/tcgflow-*`) is a Claude-Code-specific UX shortcut; the underlying workflows are identical across tools.

## Strict invariants

- **Two-file task rule.** Every task is exactly `TASK {ID}.md` + `TASK details {ID}.md`. Never split.
- **Log-first ingestion.** No wiki page edit happens before the `wiki/log.md` entry is drafted.
- **New pages and deletions are gated.** Existing-page updates flow; structural wiki changes always ask.
- **Raw is immutable.** Codebase, completed task files, MCP outputs — read-only.
- **Stable file paths.** Renames require `aliases:` frontmatter so backlinks resolve.
- **HIGH/CRITICAL actions need recorded approval.** Permission-request recipe in `governance.md`; approval captured in the task log.

## Wiki conventions

- Flat directory of Markdown with `[[wikilinks]]`.
- Frontmatter: `title`, `tags`, `aliases`, `priority`, `created`, `updated`, `status`.
- Pattern: [Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).
- Search via [qmd](https://github.com/tobi/qmd) when wired.

## Sandbox and approvals

When invoked headlessly via `codex exec`:

- Default to `--sandbox workspace-write` and `--ask-for-approval on-request`.
- The agent profile's `Writes:` list is the contract — do not modify files outside it.
- Production credentials, deploy keys, and CI/CD config are CRITICAL — never modify without a recorded approval.

## Project-specific overrides

_(Edit below this line. The init script does not touch content beyond this point on subsequent runs.)_

---
