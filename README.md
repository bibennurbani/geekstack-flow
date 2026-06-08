# Creative GeekStack Flow

**A structured AI workflow for planning, coding, reviewing, testing, and shipping software — with project memory, task tracking, governance, and a local cockpit.**

`geekstackflow` scaffolds a `.tcgstackflow/` workspace inside any project that gives your AI coding tools (Claude Code, Codex, GitHub Copilot) a shared brain: a Karpathy-style LLM wiki for memory (searched via mandatory [qmd](https://github.com/tobi/qmd) hybrid search), a strict two-file task system, six agent roles with a clear lifecycle, governance with risk levels, and a local web **Cockpit** to see it all.

> **Scope:** personal-first → team-usable → OSS-ready. Built for one author, designed so a teammate can adopt it on day one, and structured so it can become a public tool without re-architecting. See [docs/adr/0001](docs/adr/0001-personal-first-team-usable-oss-ready.md).

📚 **Full docs:** [Install](docs/INSTALL.md) · [Quick Start](docs/QUICKSTART.md) · [Usage Guide](docs/USAGE.md) · [docs index](docs/README.md)

---

## Table of contents

- [What you get](#what-you-get)
- [Install](#install)
- [Quick start](#quick-start)
- [How to use it](#how-to-use-it) — the daily workflow
- [The task lifecycle](#the-task-lifecycle)
- [The Cockpit](#the-cockpit)
- [Commands reference](#commands-reference)
- [Skills reference](#skills-reference)
- [Multi-project workspaces](#multi-project-workspaces)
- [Migrating an existing project](#migrating-an-existing-project)
- [Upgrading a workspace](#upgrading-a-workspace)
- [Repository layout](#repository-layout)
- [Design & decisions](#design--decisions)

---

## What you get

After `geekstackflow init`, your project has a `.tcgstackflow/` folder containing:

- **LLM wiki** (`wiki/`) — flat, Obsidian-flavoured Markdown maintained by AI, following [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Searched via the mandatory **wiki-search (qmd)** layer — a local hybrid keyword + vector + re-rank index that complements the `index.md` Map of Content (ADR 0030). This is the project's memory.
- **Tasks** (`tasks/`) — every task is exactly two files (`TASK {ID}.md` log + `TASK details {ID}.md` plan), moving through `active/ → completed/ → archive/`.
- **6 agent roles** (`agents/`) — the linear `planner → coder → reviewer → tester → ingester`, plus the manually-invoked **`refactorer`** (a peer to the Coder, re-entering at Review), each a tool-agnostic Markdown profile.
- **17 skills** (`skills/`) — atomic capabilities in Claude Code `SKILL.md` format (mattpocock-compatible).
- **17 commands** (`commands/`) — `tcgflow-*` workflow dispatchers, usable as Claude Code slash commands *or* natural-language triggers in any tool.
- **Governance** (`governance.md`) — four risk levels (LOW/MEDIUM/HIGH/CRITICAL) + a permission-request recipe + your project-specific rules.
- **Tool adapters** (`tools/`) — generated `CLAUDE.md`, `AGENTS.md` (Codex), and `.github/copilot-instructions.md` (Copilot), all pointing back at `.tcgstackflow/` as the single source of truth.
- **A local Cockpit** — `geekstackflow ui` opens a browser dashboard over all your projects: action queue, task board, wiki activity, Jira status, governance, timesheet.

Plus a **global** home at `~/.tcgstackflow/` for cross-project memory (`memory/`) and a shared tech-skill library (`skills/`).

---

## Install

```bash
# Global install (once published to npm):
npm install -g geekstackflow

# From a local clone (today):
git clone https://github.com/TheCreativeGeeks/geekstack-flow.git
cd geekstack-flow
npm link                 # puts `geekstackflow` + `tcgflow` on your PATH
cd ui && npm install && npm run build   # build the Cockpit SPA (one-time)
```

Two binaries are installed, identical: **`geekstackflow`** and the short alias **`tcgflow`**. The CLI itself has **zero runtime dependencies** (pure Node ≥18); only the Cockpit UI has dependencies, isolated under `ui/`.

---

## Quick start

### A new or existing codebase (no prior AI scaffolding)

```bash
cd /path/to/your/project
geekstackflow init .
```

You'll be prompted for:

| Prompt | Notes |
|---|---|
| Project name | defaults to the folder name |
| Primary stack | e.g. "Next.js 16 + Prisma" (skipped for multi-project workspaces — auto-detected) |
| Package manager | pnpm / npm / yarn / bun |
| Tempo integration? | if yes: Atlassian cloudId, quarterly admin key, timezone, submission mode |
| Claude Code? | writes `CLAUDE.md` (default yes) |
| Codex? | writes `AGENTS.md` |
| GitHub Copilot? | writes `.github/copilot-instructions.md` + per-domain instructions |
| Install `/tcgflow-*` slash commands? | to `~/.claude/skills/` (default yes when Claude is enabled) |
| Obsidian symlink? | non-hidden `tcgstackflow/ → .tcgstackflow/` so Obsidian's picker can open it |

Init also: auto-detects sub-projects (multi-project), registers the project in your Cockpit (`~/.tcgstackflow/projects.yaml`), and seeds `~/.tcgstackflow/` on first run.

**Then open the project in your AI tool** (it reads `CLAUDE.md`/`AGENTS.md`) and seed the wiki from your real code:

```
/tcgflow-plan  "scan this codebase and populate wiki/project-overview.md and architecture.md"
```

…or just talk to it: *"plan a task to document this codebase's architecture."*

### Launch the Cockpit

```bash
geekstackflow ui          # → http://127.0.0.1:4729 (opens your browser)
```

---

## How to use it

The core loop is **plan → code → review → test → ingest**, each driven by a command (Claude Code) or a natural-language phrase (any tool). Every step writes to the two task files, so the work is always documented.

### 1. Plan a task

```
/tcgflow-plan ES-1234
```

The **Planner** fetches the Jira ticket (via the Atlassian MCP — it won't invent the ticket; if it can't fetch, it stops and asks), grills you on anything ambiguous, and writes `tasks/active/ES-1234/TASK details ES-1234.md` with subtasks + acceptance criteria. Status → `PLANNED`. No code is written yet.

### 2. Implement

```
/tcgflow-code ES-1234
```

The **Coder** works subtask by subtask, writing code **and unit tests**, appending a YAML entry to `TASK ES-1234.md` after each meaningful change (with `author:` = which tool did it). HIGH/CRITICAL actions (push, migration, dependency install) pause for your approval per `governance.md`. Status → `IN_PROGRESS` → `IN_REVIEW` when done.

### 3. Review (static — is the code *right*?)

```
/tcgflow-review ES-1234
```

The **Reviewer** walks the diff against the acceptance criteria, governance, and code quality. Approves → `IN_TEST`; needs work → back to `IN_PROGRESS` with findings. The Reviewer never edits code — it proposes fixes back to the Coder.

### 4. Test (dynamic — does it *work*?)

```
/tcgflow-test ES-1234
```

The **Tester** builds a test plan from the acceptance criteria, **runs** the unit + E2E suites and the app, and records a pass/fail verdict. It can document the test plan or push it to Jira (HIGH, approval-gated). Pass → `VALIDATED`; fail → back to `IN_PROGRESS`.

### 5. Ingest into the wiki

```
/tcgflow-ingest ES-1234
```

The **Ingester** folds the finished task into the LLM wiki — log-first (drafts the `wiki/log.md` entry, then updates pages), asking before creating new pages or deleting. Moves the task to `completed/`. Status → `INGESTED`. This is how the project's memory grows.

### Refactor on demand

```
/tcgflow-refactor <target>
```

For a **broad, behaviour-preserving** restructure that isn't tied to one feature, the **Refactorer** (a peer to the Coder, not a linear stage) surveys the target read-only, proposes a refactor task with behaviour-preservation acceptance, writes characterization tests first where coverage is thin, then executes and hands off into the same Review → Test → Ingest gates (ADR 0031). Distinct from the Coder's diff-scoped **cleanup pass** — the mandatory tidy of *your own change* (orphaned imports/dead code/scratch in touched files only) that runs before every handoff.

### Recurring rituals

- **Weekly timesheet** — `/tcgflow-timesheet-generate` (drafts a sugar-coated Tempo timesheet from your task logs + inline admin meetings) then `/tcgflow-timesheet-submit` (pushes to Tempo via Atlassian MCP, approval-gated).
- **Sync Jira status** — `/tcgflow-sync-jira` pulls each task's Jira status into `tasks/jira-cache.json` so the Cockpit shows it (and flags drift). Run it at session start or on a schedule.
- **Wiki health** — `/tcgflow-lint` finds stale pages, contradictions, orphans. **Workspace health** — `/tcgflow-audit` checks agents ↔ skills ↔ codebase are in sync.

### Turn external signals into tasks

```
/tcgflow-task-from-snyk        # vulnerabilities → tasks (grouped by package)
/tcgflow-task-from-cypress     # failing/flaky specs → tasks (grouped by spec)
/tcgflow-task-from-datadog     # an incident/alert → a task (investigate/mitigate/fix/postmortem)
```

### Using it from Codex / Copilot

The commands live **inside the workspace** (`.tcgstackflow/commands/`), so any tool can use them — you just describe the action instead of typing a slash command. *"plan ES-1234"*, *"review the diff"*, *"sync Jira"* all dispatch the same workflows. The slash-command form is a Claude Code convenience; the workflow is identical everywhere (ADR 0019).

---

## The task lifecycle

```
DRAFT → PLANNED → IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED      (BLOCKED = side state)
        planner    coder         reviewer    tester    ingester
```

| Status | Meaning | Next agent |
|---|---|---|
| `DRAFT` | Plan being written | planner |
| `PLANNED` | Acceptance criteria set; ready to build | coder |
| `IN_PROGRESS` | Coder actively working | coder |
| `BLOCKED` | Waiting on an external dependency/decision | (human) |
| `IN_REVIEW` | Code complete; static review (is it *right*?) | reviewer |
| `IN_TEST` | Review passed; dynamic verification (does it *work*?) | tester |
| `VALIDATED` | Tests pass; ready to fold into memory | ingester |
| `INGESTED` | Folded into the wiki; done | — |

The Cockpit's **action queue** is computed from these statuses: it shows, per task, which agent is ready to act next.

The **Refactorer** sits outside this linear flow — invoked on demand via `/tcgflow-refactor`, it produces a refactor task and re-enters at `IN_REVIEW` (Reviewer → Tester → Ingester). For refactor-typed tasks the Reviewer's scope-drift blocker is relaxed and behaviour-preservation is the acceptance oracle (ADR 0031).

---

## The Cockpit

```bash
geekstackflow ui [--port 4729]
```

A **local, read-only** web dashboard (Vue 3 + a zero-dependency Node server) over all your registered projects. Binds to `127.0.0.1` only — no network exposure, no login, no database. It reads your `.tcgstackflow/` files directly (the files are the source of truth; the Cockpit is a live projection).

- **Home** — the action queue across *all* projects ("what should I touch next, everywhere"), plus per-project "update available" badges.
- **Per-project** — action queue, full task board (color-coded statuses), wiki recent activity, sub-projects, governance rules, timesheet status, tools & MCP.
- **Jira status** — each Jira-keyed task shows its Jira status (links to the ticket), "synced Xh ago", and a ⚠ **drift** flag when your workspace and Jira disagree on done-ness. (Refresh with `/tcgflow-sync-jira`.)
- **Copy prompt** — every action-queue item has a button that copies a ready-to-paste prompt for the next agent. (The future Orchestrator will *run* it directly; today you paste it into your AI tool.)

Before the SPA is built, the server serves a built-in fallback page with the same data — so `geekstackflow ui` works even without `npm run build`.

> Roadmap: the Cockpit is the read-only first stage of an **Orchestrator** that will run agents directly from the UI (ADRs 0020–0027). Designed so the "Copy prompt" buttons become "Run" without a redesign.

---

## Commands reference

17 commands. In Claude Code, type `/tcgflow-<name>`. In other tools, use the trigger phrase.

| Command | Does |
|---|---|
| `/tcgflow-init` | Initialise `.tcgstackflow/` in the current project (and install + index qmd) |
| `/tcgflow-upgrade` | Upgrade an existing workspace to the current layout + refresh tool-owned files |
| `/tcgflow-migrate` | Migrate a project off ad-hoc AI infra (`.taskRef/`, `ai-mem/`, …) — 4-phase clean cutover |
| `/tcgflow-plan [ID]` | Planner: grill + write the two-file task |
| `/tcgflow-code [ID]` | Coder: implement the planned task |
| `/tcgflow-review [ID]` | Reviewer: static review of the diff |
| `/tcgflow-test [ID]` | Tester: build test plan, run verification |
| `/tcgflow-ingest [scope]` | Ingester: fold a task / `raw/` / MCP output into the wiki |
| `/tcgflow-refactor [target]` | Refactorer: broad, behaviour-preserving refactor of a target area (re-enters at Review) |
| `/tcgflow-sync-jira` | Pull Jira statuses into `tasks/jira-cache.json` |
| `/tcgflow-lint` | Wiki health-check |
| `/tcgflow-audit` | Workspace integrity check (agents ↔ skills ↔ codebase) |
| `/tcgflow-task-from-snyk` | Vulnerabilities → tasks |
| `/tcgflow-task-from-cypress` | Failing/flaky specs → tasks |
| `/tcgflow-task-from-datadog` | Incident/alert → task |
| `/tcgflow-timesheet-generate` | Weekly Tempo draft (LOW) |
| `/tcgflow-timesheet-submit` | Submit worklogs to Tempo (HIGH) |

---

## Skills reference

17 atomic skills under `.tcgstackflow/skills/`. Commands dispatch these; agents compose them.

| Skill | Role | Purpose |
|---|---|---|
| `grill-task` | planner | Interview on ambiguous areas before planning |
| `plan-task` | planner | Write the two-file task structure + acceptance criteria |
| `update-task-log` | coder | Append a YAML entry to the task log |
| `review-diff` | reviewer | Walk the diff vs acceptance + governance |
| `verify` | tester | Build a test plan, run tests/E2E/app, record a verdict |
| `wiki-search` | any | Find wiki/`docs/` content via qmd before reading — the mandatory discovery layer |
| `best-practice-refactor` | coder / refactorer | Diff-scoped cleanup pass (Coder) + broad behaviour-preserving refactor (Refactorer) |
| `ingest` | ingester | Fold a Raw source into the wiki (log-first, gated) |
| `lint-wiki` | ingester / standalone | Wiki health-check |
| `audit-workspace` | ingester / standalone | Agents ↔ skills ↔ codebase drift check |
| `migrate-to-gsf` | planner / coder | Migrate a project onto the canonical layout |
| `task-from-snyk` | planner / standalone | Snyk findings → tasks |
| `task-from-cypress` | planner / standalone | Cypress failures → tasks |
| `task-from-datadog` | planner / standalone | Datadog signal → task |
| `sync-jira` | any (LOW) | Fetch Jira statuses → `tasks/jira-cache.json` |
| `generate-timesheet` | user (LOW) | Weekly Tempo draft |
| `submit-timesheet` | user (HIGH) | Submit worklogs via Atlassian MCP |

**Tech skills** (Vue, Pinia, .NET, Cypress, etc.) live globally at `~/.tcgstackflow/skills/` and are shared across projects. **Workflow skills** (the above) live per-project. See ADR 0012.

---

## Multi-project workspaces

When `init` finds 2+ codebases at the top level (detected via `package.json`, `*.csproj` at top or under `src/<project>/`, `Pulumi.yaml`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `pom.xml`, `composer.json`), it sets `workspace_kind: multi-project` and fills `config.yaml`'s `projects:` array with each sub-project's path, stack, and per-project `test`/`lint` commands. Agents then use the *right* sub-project's commands, and tasks/wiki pages can be scoped per sub-project. (ADR 0015.)

---

## Migrating an existing project

If a project already has ad-hoc AI scaffolding (`.taskRef/`, `ai-mem/`, hand-written `CLAUDE.md`, scattered Copilot instructions), use the migration flow — a clean cutover with `.bak` backups:

```bash
cd /path/to/existing-project
git add -u && git commit -m "WIP snapshot before geekstack-flow migration"   # rollback point

# back up old AI infra (adjust to what the project actually has)
mv .taskRef .taskRef.bak
mv ai-mem ai-mem.bak
mv CLAUDE.md CLAUDE.md.bak
mv AGENTS.md AGENTS.md.bak
mv .github/copilot-instructions.md .github/copilot-instructions.md.bak
mv .github/instructions .github/instructions.bak

geekstackflow init --migrate-from . .    # collects old content into .tcgstackflow/migration-notes/
```

Then, in your AI tool: *"Plan a task using the migrate-to-gsf skill for this codebase."* The 4-phase pattern (init+adapters → tasks → wiki ingestion → decommission) is in the `migrate-to-gsf` skill. (ADRs 0013, 0014.)

---

## Upgrading a workspace

When you update the tool, propagate changes into a project:

```bash
geekstackflow upgrade /path/to/project     # or: /tcgflow-upgrade
```

This:
- runs any **layout migrations** keyed off `workspace_schema` (e.g. the pre-v0.2 dotfile rename),
- **refreshes tool-owned files** — `tcgflow-*` commands (in the workspace *and* `~/.claude/skills/`) and agent profiles are updated to the latest templates, backing up any drifted file to `{name}.bak`,
- **additively adds new skills** (absent → added; existing → never overwritten),
- registers the project in the Cockpit and stamps the version.

**Your customizations are never clobbered** — `governance.md`, `config.yaml`, existing skills, and tool-adapter content are left for manual merge. Restart Claude Code afterward to pick up refreshed slash commands. (ADR 0021.)

---

## Repository layout

```
geekstack-flow/
├── init.js                 # the CLI (init / upgrade / register / ui) — zero dependencies
├── package.json            # bin: { geekstackflow, tcgflow }, v0.2.0
├── README.md  CONTEXT.md  CONTRIBUTING.md  CHANGELOG.md  LICENSE (MIT)
├── docs/adr/               # 31 Architecture Decision Records
├── ui/                     # the Cockpit (Vue 3 + Vite SPA + zero-dep Node server)
│   ├── server/             #   read.cjs (data layer) + index.cjs (http server)
│   └── src/                #   App.vue + styles
└── templates/
    ├── workspace/.tcgstackflow/   # copied into each project
    │   ├── config.yaml  governance.md  README.md
    │   ├── agents/        # 6 role profiles
    │   ├── skills/        # 17 skills
    │   ├── commands/      # 17 tcgflow-* commands
    │   ├── wiki/          # starter pages + adr/
    │   ├── tasks/         # README + weekly/ + active/completed/archive/
    │   ├── raw/  prompts/
    │   └── tools/         # claude/ codex/ github/ adapters
    └── global/.tcgstackflow/      # copied to ~/.tcgstackflow/ (memory/ + skills/)
```

---

## Design & decisions

- **[CONTEXT.md](CONTEXT.md)** — the project's domain language (Wiki, Raw, Ingest/Query/Lint, Agent, Skill, Command, Cockpit, Orchestrator, Workspace vs Jira status, …).
- **[docs/adr/](docs/adr/)** — 31 Architecture Decision Records. Highlights: scope ladder (0001), manual cross-tool handoff (0002), wiki structure (0003), two-file tasks (0004), skill/agent/adapter model (0005), governance (0008), the Cockpit & Orchestrator design (0020–0027), tester role (0028), Jira-via-cache (0029), qmd-mandatory wiki search (0030), refactorer role + cleanup-pass doctrine (0031).

## Inspirations

- [Karpathy — LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the memory pattern.
- [qmd by Tobi Lütke](https://github.com/tobi/qmd) — the mandatory local wiki-search layer (CLI canonical; MCP an optional Claude convenience).
- [mattpocock/skills](https://github.com/mattpocock/skills) — the `SKILL.md` format adopted as canonical.
- [ruvnet/ruflo](https://github.com/ruvnet/ruflo) — the workspace-initialisation idea that seeded the brief.

## License

[MIT](LICENSE) © The Creative Geeks / Biben Nurbani Hasan.
