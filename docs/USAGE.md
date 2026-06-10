# Usage Guide

How to actually work with Creative GeekStack Flow day to day. Assumes you've installed it ([INSTALL.md](INSTALL.md)) and initialised a project ([QUICKSTART.md](QUICKSTART.md)).

## Contents

- [The workspace, at a glance](#the-workspace-at-a-glance)
- [The daily workflow](#the-daily-workflow)
- [Driving it from different AI tools](#driving-it-from-different-ai-tools)
- [The Cockpit (Orchestrator)](#the-cockpit-orchestrator)
- [Memory: wiki, ingest, query, lint](#memory-wiki-ingest-query-lint)
- [Timesheets (Tempo)](#timesheets-tempo)
- [Jira status sync](#jira-status-sync)
- [Turning signals into tasks](#turning-signals-into-tasks)
- [Governance](#governance)
- [Multi-project workspaces](#multi-project-workspaces)
- [Migrating an existing project](#migrating-an-existing-project)
- [Upgrading a workspace](#upgrading-a-workspace)
- [Global memory & the tech-skill library](#global-memory--the-tech-skill-library)
- [Troubleshooting](#troubleshooting)
- [Reference](#reference)

---

## The workspace, at a glance

```
your-project/
├── CLAUDE.md / AGENTS.md / .github/copilot-instructions.md   # per-tool entry points → point at .tcgstackflow/
├── tcgstackflow/        → symlink to .tcgstackflow/ (so Obsidian's picker can open it)
└── .tcgstackflow/
    ├── config.yaml      # project config: stack, sub-projects, Tempo, tools, version stamp
    ├── governance.md    # risk levels + permission recipe + your project rules
    ├── agents/          # planner, coder, reviewer, tester, ingester, refactorer (role profiles)
    ├── skills/          # 17 workflow skills (SKILL.md each)
    ├── commands/        # 18 tcgflow-* command dispatchers
    ├── wiki/            # the LLM wiki (index.md, log.md, project-overview.md, …) + adr/
    ├── tasks/           # README + active/ completed/ archive/ weekly/  (+ jira-cache.json)
    ├── runs/            # per-task run transcripts written by the Cockpit Orchestrator ({task-id}/{run-id}.md)
    ├── raw/             # drop external docs here to ingest; archived/ after
    ├── prompts/         # cross-tool handoff prompts
    └── tools/           # the canonical adapter content (claude/ codex/ github/)
```

**Everything is plain files. There is no database.** The Cockpit and your AI tools both read these files — and the Cockpit Orchestrator writes them (task status, run transcripts) — the files are the single source of truth; there is no second store.

---

## The daily workflow

Work flows through five linear roles, tracked by task status (a sixth role, the **Refactorer**, runs on demand and re-enters at Review — see [Refactor](#refactor-on-demand--tcgflow-refactor-target)):

```
DRAFT → PLANNED → IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED      (BLOCKED = side state)
        planner    coder         reviewer    tester    ingester
```

Each task is **exactly two files** in `tasks/active/{ID}/`:
- `TASK {ID}.md` — the implementation **log** (append-only YAML entries: what changed, by whom, why, validation).
- `TASK details {ID}.md` — the **plan** (overview, subtasks, acceptance criteria, status).

> **The two-file rule is strict.** Never split into `TASK {ID}-FE-1.md` etc. Append to the two files. This keeps task history machine-readable.

### Plan — `/tcgflow-plan ES-1234`

The **Planner**:
1. If `ES-1234` is a Jira key, fetches the ticket via the Atlassian MCP. **It will not invent a ticket** — if it can't fetch, it stops and asks you to connect the MCP or paste the details.
2. Grills you on anything ambiguous (one topic at a time, with a recommended answer).
3. Writes the two files with flat subtasks + per-subtask acceptance criteria, sets status `PLANNED`, adds a row to `tasks/README.md`.

It does **not** write code. A task isn't ready for the Coder until every subtask has a checkable acceptance criterion.

### Code — `/tcgflow-code ES-1234`

The **Coder**:
- Verifies the task is `PLANNED` (won't code otherwise).
- Works **one subtask at a time**: makes the change, writes/updates **unit tests**, runs the right test/lint command (the sub-project's, in multi-project workspaces), appends a YAML log entry (`author: claude|codex|…`, summary, files, why, validation).
- Surfaces **HIGH/CRITICAL** actions (push, migration, dependency install, auth changes) as a permission request first, per `governance.md`, and records your approval in the log.
- Runs a **cleanup pass** before handing off — a mandatory, **diff-scoped** tidy of *only the files this task touched*: removes imports and dead code *its own change* orphaned, drops commented-out scratch, and runs the formatter/linter autofix on those files. This is "clean up after your own change" — explicitly **not** surrounding cleanup or refactoring beyond the task (that's `/tcgflow-refactor`). The Reviewer verifies it happened.
- When all subtasks are done → status `IN_REVIEW`.

### Review — `/tcgflow-review ES-1234` (static gate)

The **Reviewer** reads the diff against the acceptance criteria, governance, and code quality. It **never edits code** — it proposes fixes back to the Coder.
- Approves → status `IN_TEST`.
- Needs work → status `IN_PROGRESS` with ordered findings (blocker → major → nit).

### Test — `/tcgflow-test ES-1234` (dynamic gate)

The **Tester** confirms it *works*:
- Builds a **test plan** from the acceptance criteria (one check per criterion).
- Documents the plan (task log + an optional `wiki/testing/` page) or pushes it to Jira (HIGH — approval-gated).
- **Runs** the unit + E2E suites (Cypress) and the app, records pass/fail with evidence.
- Pass → status `VALIDATED`. Fail → `IN_PROGRESS` (back to Coder).

Reviewer checks the code is *right*; Tester checks it *works*. The Coder still writes unit tests inline; the Tester owns end-to-end verification.

### Ingest — `/tcgflow-ingest ES-1234`

The **Ingester** folds the finished task into the wiki:
- **Log-first**: drafts the `wiki/log.md` entry (Context / Created / Modified / Deleted / Decision) and shows it to you *before* changing pages.
- Updates affected pages; **asks before creating new pages or deleting** anything.
- Moves the task `active/ → completed/`, sets status `INGESTED`.

This is how the project's memory compounds: every shipped task makes the wiki smarter for the next one.

### Refactor (on demand) — `/tcgflow-refactor <target>`

The **Refactorer** is a sixth role and a **peer to the Coder**, not a stage in the linear lifecycle. Invoke it manually when you want a **broad, behaviour-preserving** restructure of an area (a file, module, or directory) that isn't tied to a single feature task. It:

1. surveys the target **read-only** (with `wiki-search` for architecture/domain context) and **proposes a two-file refactor task** with a behaviour-preservation acceptance per subtask — an approval gate before any edit;
2. **writes characterization (golden-master) tests first** when the area is under-covered (or narrows scope and logs "needs tests first" where it can't);
3. executes the refactor, logging YAML entries like any Coder;
4. hands off into the normal **Reviewer → Tester → Ingester** gates — it never self-approves.

Because the broad change is *explicitly requested*, for refactor-typed tasks the **Reviewer's scope-drift blocker is relaxed**, the acceptance oracle becomes **behaviour-preservation** (tests green, public API unchanged unless stated), and the **Tester is the real gate**. Don't confuse this with the Coder's diff-scoped cleanup pass — that's the narrow tidy of your own change; a Refactor is the surrounding work the cleanup pass deliberately excludes.

---

## Driving it from different AI tools

The commands live **inside the workspace** (`.tcgstackflow/commands/`), so they're tool-portable. Invocation differs:

- **Claude Code** — type the slash command: `/tcgflow-plan ES-1234`. (Installed to `~/.claude/skills/` at init.)
- **Codex / Copilot / others** — describe the action; the tool matches the trigger phrase from each command's description: *"plan ES-1234"*, *"review the diff"*, *"sync Jira"*. Codex reads `AGENTS.md`; Copilot reads `.github/copilot-instructions.md`; both reference `.tcgstackflow/commands/`.

Same workflow everywhere — the slash form is just a Claude Code convenience.

The `author:` field in each task-log entry records **which** tool did the work, so a task can legitimately be planned by Claude and coded by Codex.

---

## The Cockpit (Orchestrator)

```bash
geekstackflow ui [--port 4729]
```

A local **Orchestrator** dashboard over every registered project. Vue 3 SPA + a zero-dependency Node server, bound to `127.0.0.1` (no network exposure, no login, no DB). It reads `.tcgstackflow/` files live — and (ADR 0032) it also **launches agent runs** and writes the canonical task files: a Status override and run transcripts under `runs/`. Files stay the single source of truth; there is still no second store.

- **Home** — the **action queue** aggregated across all projects, grouped by next agent, with a hero showing **estimated spend** (run token totals priced at list prices) against your monthly budget. Plus "update available" badges for projects behind the installed tool.
- **Run** — launch the next agent on any queue item; watch the live transcript, Stop it, and answer in-run permission requests in a governance modal.
- **Runs** — a cross-project run history; each task's detail panel lists its runs with per-run report, diff, and transcript views, plus per-role token totals.
- **Discuss** — a read-only chat resume against a finished run's session.
- **Per project** — Overview / Tasks / Wiki / Governance / Timesheet / Tools / Settings tabs: action queue, filterable task board (color-coded status badges), wiki recent activity, sub-projects, governance rules, timesheet status, tools & MCP.
- **Session Report** — a $-costed report per run session (export as standalone HTML).
- **Jira** — each Jira-keyed task shows its Jira status (links to the ticket), "synced Xh ago", and a ⚠ **drift** flag when the workspace and Jira disagree on done-ness. Refresh with `/tcgflow-sync-jira`.
- **Copy prompt** — the fallback: each queue item copies a ready-to-paste prompt for the next agent, if you'd rather drive an open AI session by hand.

Projects appear in the Cockpit because `init` (and `upgrade`, and `register`) add them to `~/.tcgstackflow/projects.yaml`. To add a clone manually: `geekstackflow register /path/to/project`.

> The Cockpit **is** the Orchestrator (ADR 0032). Press **Run** on a queue item to launch the agent directly — live progress stream, Stop button, and in-run approval prompts per `governance.md`. The runner per role is set in `config.yaml` under `orchestrator.roles` (Claude is the default and currently only runner). "Copy prompt" remains as a fallback for driving an already-open AI session by hand.

### Live runs

Press **Run** and the Cockpit spawns your local `claude` CLI with the right role prompt for that task:

- **Live stream** — the transcript streams into the task's detail panel as the agent works.
- **Stop** — abort a running agent at any point; the transcript so far is kept.
- **Continuation loop** — if an iteration ends without the agent advancing the task status, the Cockpit resumes the same session (`claude --resume`) until the agent sets the next status (e.g. `IN_REVIEW`) or **6 iterations** are reached. Tokens accumulate across iterations into one run total.
- **The agent owns the files** — during a run the agent writes the task log and status itself, exactly as in a hand-driven session. The executor only applies a **safety-net status** if the run finished without the agent self-advancing.
- **`git_base`** — the commit at run start is recorded, so each run's **diff** view shows exactly what that run changed.

### In-run governance approvals

Governance is enforced live during Cockpit runs: the runner delegates permission prompts to a local approve tool, a HIGH/CRITICAL request pauses the run, and you approve or deny it in the Cockpit's governance modal — the decision is recorded with the run (ADR 0027/0032).

### Run records & tokens

Every run is written to `runs/{task-id}/{run-id}.md` in the workspace: frontmatter (`task`, `role`, `session_id`, `tokens` with input/output/cache counts, `state`, `ended_at`, `git_base`) plus the transcript. The task detail panel shows per-role token totals and a runs list with **report**, **diff**, and **terminal transcript** actions; the sidebar **Runs** view lists run history across all projects.

### Session Report

`/tcgflow-session-report` (or the Session Report page on a run) turns a session's transcript into a **$-costed report** — tokens per model, priced at list prices (ADR 0034; raw tokens stay the canonical record, dollars are scoped to the report). Export it as a standalone HTML file, or use the AI-editorial copy prompt to have your AI tool polish the narrative.

### Discuss

Open **Discuss** on a task to chat against a finished run's session — a read-only resume: ask the agent questions about what it did, without it being able to edit anything.

### Settings (roles & budget)

The per-project **Settings** tab writes two things to `config.yaml`:

- `orchestrator.roles` — which runner drives each of the six roles (`claude` is the default and currently the only runner).
- `orchestrator.budget_usd` — an optional monthly budget; Home's estimated-spend hero is shown against it.

### Status override

Each task has a status dropdown that rewrites the canonical `Status:` line (free-form values allowed) and auto-appends an auditable YAML entry to the task log (`author: human`, `via: cockpit`) — manual overrides stay on the record.

---

## Memory: wiki, ingest, query, lint

The **wiki** (`.tcgstackflow/wiki/`) is the AI's primary context — flat Markdown with `[[wikilinks]]`, an `index.md` map-of-content, and an append-only `log.md`. Three operations:

- **Ingest** (`/tcgflow-ingest`) — fold a *Raw* source into the wiki. Raw = a completed task, files you drop into `raw/`, or MCP output (a Jira digest, Snyk report, Datadog write-up). Log-first; new pages/deletions are approval-gated.
- **Query** — just ask your AI a question; it finds the relevant pages with **wiki search (qmd)**, then drills in. If the answer is wiki-worthy, it can be filed back as a page.
- **Lint** (`/tcgflow-lint`) — periodic health-check: contradictions, stale claims, orphan pages, missing cross-references, broken links. Produces a report; fixes route back through ingest.

**Wiki search (qmd).** Every agent finds wiki (and `docs/`) content through the shared `wiki-search` skill, backed by [qmd](https://github.com/tobi/qmd) — a local hybrid index (keyword + vector + LLM re-rank). It is the **mandatory** discovery layer (ADR 0030): qmd surfaces *which* pages are relevant, then the agent opens them and follows `[[wikilinks]]` one hop. It **complements** `index.md` — the Map of Content stays the always-current fallback when the index is stale or qmd is unavailable. The CLI is canonical (`qmd query "…" -c wiki --json`); the qmd MCP is an optional Claude convenience. The Ingester re-embeds after each ingest so reads stay fresh. Set it up via [INSTALL.md → Wiki search (qmd)](INSTALL.md#wiki-search-qmd).

Open the wiki in **Obsidian**: "Open folder as vault" → select the non-hidden `tcgstackflow/` symlink (Obsidian hides dotfiles, so don't pick `.tcgstackflow/` directly).

---

## Timesheets (Tempo)

Two skills, split by risk:

```
/tcgflow-timesheet-generate     # LOW — drafts the week's timesheet from your task logs
/tcgflow-timesheet-submit       # HIGH — pushes worklogs to Tempo via Atlassian MCP
```

- **Generate** reads `tasks/active|completed/` YAML entries for the week, applies **sugar-coating** (polished, impact-oriented descriptions — generic ones like "Bug fixes - 2h" are rejected), and you paste admin meetings inline. Writes `tasks/weekly/Weekly_Timesheet_{date}.md`. Never calls Tempo.
- **Submit** reads that draft and posts each worklog sequentially via `addWorklogToJiraIssue`, then appends a confirmation table. Honors `config.yaml` `tempo.submission_mode`: `approval` (default — asks first) or `trust` (posts directly).

Config lives in `config.yaml` under `tempo:` (cloudId, admin_key, timezone, work_start, daily/weekly hours, submission_mode).

---

## Jira status sync

```
/tcgflow-sync-jira
```

Fetches each Jira-keyed task's status via the Atlassian MCP and writes a project-local snapshot `tasks/jira-cache.json`. The Cockpit reads it to show **two statuses per task**:

- **Workspace status** — where the task is in *our* lifecycle (drives the action queue).
- **Jira status** — where the ticket is in the *client's* Jira workflow (the business state).

When they disagree on done-ness, the Cockpit flags **drift** (e.g. workspace `VALIDATED` but Jira still "In Progress" → go move the ticket). The Cockpit server never calls Jira itself — this AI-run command is the only thing that does (it has no Jira credentials by design). Run it at session start, after moving tickets, or on a schedule.

Only tasks whose IDs are Jira keys (`ES-1234`) get a Jira badge; local IDs (`BUG-flaky`) don't.

---

## Turning signals into tasks

When an external tool surfaces work, convert it to a tracked task:

```
/tcgflow-task-from-snyk        # vulnerabilities → one task per vulnerable package
/tcgflow-task-from-cypress     # failing/flaky specs → one task per spec (classified)
/tcgflow-task-from-datadog     # an incident/alert → one task (investigate/mitigate/fix/postmortem)
```

Each dedups against existing tasks, groups at the source's natural unit, and sets risk by severity. Requires the relevant MCP (Snyk / Cypress / Datadog) connected in your AI tool — otherwise paste the report and it proceeds from that.

---

## Governance

`governance.md` defines four risk levels and a permission recipe:

| Level | Examples | Behavior |
|---|---|---|
| LOW | read, search, draft, update a wiki page | just do it |
| MEDIUM | edit source, run tests, local commit | do it, log it |
| HIGH | install deps, push, open PR, edit auth code, update a ticket | **ask first** |
| CRITICAL | prod deploy, destructive DB op, force push, rotate secrets | **ask first + rollback plan** |

Agents read this on every session. The **Reviewer** is the backstop — a HIGH/CRITICAL action taken without a recorded approval is a blocking issue. Add your own constraints under the **Project-Specific Rules** section (e.g. "never touch `prisma/migrations/` without approval", "Client X data is HIPAA — no PII to external services").

**During Cockpit Runs**, governance is enforced live: the runner delegates permission prompts to a local approve tool, the request pauses the run, and you approve or deny it in the Cockpit's governance modal — the decision is recorded with the run (ADR 0027/0032).

---

## Multi-project workspaces

If your repo holds several codebases at the top level, `init` detects them and fills `config.yaml`'s `projects:` array with each one's `path`, `stack`, and `test`/`lint` commands. Then:
- the **Coder/Tester** use the *right* sub-project's commands,
- the **Planner** can tag each subtask with a `Project:`,
- the **Cockpit** shows sub-projects and can scope the queue.

If you add a sub-project later, `geekstackflow upgrade .` re-detects, or edit `projects:` by hand.

---

## Migrating an existing project

For a project that already has ad-hoc AI scaffolding (`.taskRef/`, `ai-mem/`, hand-written `CLAUDE.md`, scattered Copilot instructions) — do a clean cutover with backups, not a plain `init`:

```bash
cd /path/to/existing-project
git add -u && git commit -m "WIP snapshot before geekstack-flow migration"

mv .taskRef .taskRef.bak
mv ai-mem ai-mem.bak
mv CLAUDE.md CLAUDE.md.bak
mv AGENTS.md AGENTS.md.bak
mv .github/copilot-instructions.md .github/copilot-instructions.md.bak
mv .github/instructions .github/instructions.bak

geekstackflow init --migrate-from . .     # collects old content into .tcgstackflow/migration-notes/
```

Then in your AI tool: *"Plan a task using the migrate-to-gsf skill for this codebase."* It walks the four phases — init+adapters → tasks → wiki ingestion → decommission — classifying old content (migrate / fold-into-agent / unique-skill / archive / discard), distinguishing active from stale tasks, and routing tech skills to the global library. The CRITICAL "delete the `.bak`" step is gated until you've validated the new setup.

---

## Upgrading a workspace

After updating the tool, propagate changes into a project:

```bash
geekstackflow upgrade /path/to/project     # or /tcgflow-upgrade in the AI tool
```

- runs **layout migrations** keyed off `workspace_schema` (schema **4** adds the `runs/` area and the `config.yaml` `orchestrator:` block the Cockpit Orchestrator uses),
- **refreshes tool-owned files** — `tcgflow-*` commands (workspace + `~/.claude/skills/`) and agent profiles are updated to the latest templates; any drifted file is backed up to `{name}.bak` first,
- **additively adds new skills** (absent → added; existing → never overwritten),
- **prints a drift report** — the existing skills + tool adapters that differ from the new templates (the files it won't auto-merge),
- re-registers the project and stamps the version.

**Your customizations are never clobbered** — `governance.md`, `config.yaml`, existing skills, and tool-adapter content are left for you to merge. The drift report tells you which of those drifted; re-run it anytime with `geekstackflow drift /path/to/project` (read-only — it normalises the `{{project-name}}` placeholder and ignores your below-the-marker overrides, so it won't cry wolf). Restart Claude Code afterward to pick up refreshed slash commands. (Then `cd ui && npm run build` if the tool's UI changed.)

---

## Global memory & the tech-skill library

`~/.tcgstackflow/` is shared across all your projects:

- **`memory/`** — your cross-project preferences: `preferences.md` (package manager, code style, test framework), `workflow-conventions.md`, `domain-knowledge.md`, `tools.md`. AI tools read these via a one-line reference in their global config. **Local project wiki always wins** on conflict.
- **`skills/`** — the global **tech-skill** library (Vue, Pinia, .NET, Cypress, Pulumi, Auth0, …), shared across projects. Install with `cd ~/.tcgstackflow/skills && npx skills add <owner/repo@skill>`. (Project-specific *workflow* skills live in the project instead.)
- **`projects.yaml`** — the Cockpit's project registry.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/tcgflow-*` commands don't appear in Claude Code | Not installed, or session started before install. Run `geekstackflow upgrade <project>` (or `cp -R .tcgstackflow/commands/* ~/.claude/skills/`), then **restart** the Claude Code session. |
| Cockpit shows no projects | The project isn't registered. Run `geekstackflow register /path/to/project` (or `init`/`upgrade`), then refresh the browser. Check `~/.tcgstackflow/projects.yaml`. |
| Cockpit UI looks unstyled / plain | The Vue SPA isn't built — you're seeing the fallback page. `cd ui && npm install && npm run build`, then restart `geekstackflow ui`. |
| Tasks show but the action queue is empty | Their statuses don't map to an agent — check the `Status:` line in each `TASK {ID}.md`. Free-form statuses are normalized (`In Progress` → IN_PROGRESS, `Done` → COMPLETED, etc.), but a truly unknown status won't route. |
| No Jira status on tasks | Run `/tcgflow-sync-jira` (needs the Atlassian MCP). Only Jira-keyed IDs get a badge. Check `tasks/jira-cache.json`. |
| Planner "can't fetch the ticket" | The Atlassian MCP isn't connected. Connect it, or paste the ticket's title/description/acceptance criteria — the planner won't invent ticket contents. |
| `upgrade` says "newer than this tool" | The workspace was touched by a newer geekstackflow. Update the tool (`npm update -g geekstackflow` or `git pull`). |
| A refreshed command/agent lost my edits | `upgrade` backed it up to `{name}.bak` before overwriting tool-owned files — your version is recoverable there. (Customizations to `governance.md`/`config.yaml`/skills are never overwritten.) |
| Not sure what to merge after an upgrade | Run `geekstackflow drift /path/to/project` — it lists exactly which existing skills + tool adapters differ from the installed templates (and flags new skills not yet installed). Read-only. |

---

## Reference

### Statuses → next agent

| Status | Next agent |
|---|---|
| DRAFT | planner |
| PLANNED / IN_PROGRESS | coder |
| BLOCKED | (human) |
| IN_REVIEW | reviewer |
| IN_TEST | tester |
| VALIDATED | ingester |
| INGESTED / COMPLETED | — |

### Commands (18)

`init` · `upgrade` · `migrate` · `plan` · `code` · `review` · `test` · `ingest` · `refactor` · `sync-jira` · `lint` · `audit` · `task-from-snyk` · `task-from-cypress` · `task-from-datadog` · `timesheet-generate` · `timesheet-submit` · `session-report` — all prefixed `/tcgflow-`. Full table in [../README.md](../README.md#commands-reference).

### Skills (17)

`grill-task` · `plan-task` · `update-task-log` · `review-diff` · `verify` · `ingest` · `lint-wiki` · `audit-workspace` · `migrate-to-gsf` · `task-from-snyk` · `task-from-cypress` · `task-from-datadog` · `sync-jira` · `generate-timesheet` · `submit-timesheet` · `wiki-search` · `best-practice-refactor`. Full table in [../README.md](../README.md#skills-reference).

### CLI flags

```
geekstackflow init [target]                  initialise a workspace
geekstackflow upgrade [target]               migrate layout + refresh tool-owned files
geekstackflow register [target]              add an existing workspace to the Cockpit registry
geekstackflow drift [target]                 report skills/adapters that differ from the templates (read-only)
geekstackflow ui [--port N]                  launch the Cockpit
geekstackflow init --migrate-from <old> .    collect old AI infra for migration review
geekstackflow init --force [target]          overwrite an existing .tcgstackflow/
geekstackflow --help
```

### Design rationale

Every decision is recorded in [adr/](adr/) (34 ADRs). The glossary is [../CONTEXT.md](../CONTEXT.md).
