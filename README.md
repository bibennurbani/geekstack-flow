# Creative GeekStack Flow

**A structured AI workflow for planning, coding, reviewing, testing, and shipping software — with project memory, task tracking, governance, and a local cockpit that runs your agents.**

`geekstackflow` scaffolds a `.tcgstackflow/` workspace inside any project that gives your AI coding tools (Claude Code, Codex, GitHub Copilot) a shared brain: a Karpathy-style LLM wiki for memory (searched via mandatory [qmd](https://github.com/tobi/qmd) hybrid search), a strict two-file task system, six agent roles with a clear lifecycle, governance with risk levels, and a local web **Cockpit** that is also the **Orchestrator** — launch agents on tasks from the browser, watch the run stream live, approve HIGH/CRITICAL actions, and track token spend.

> **Scope:** personal-first → team-usable → OSS-ready. Built for one author, designed so a teammate can adopt it on day one, and structured so it can become a public tool without re-architecting. See [docs/adr/0001](docs/adr/0001-personal-first-team-usable-oss-ready.md).

📚 **Full docs:** [Install](docs/INSTALL.md) · [Quick Start](docs/QUICKSTART.md) · [Usage Guide](docs/USAGE.md) · [docs index](docs/README.md)

---

## Table of contents

- [What you get](#what-you-get)
- [Install](#install)
- [Quick start](#quick-start)
- [How to use it](#how-to-use-it) — the daily workflow
- [The task lifecycle](#the-task-lifecycle)
- [The Cockpit (Orchestrator)](#the-cockpit-orchestrator)
- [CLI reference](#cli-reference) — the `geekstackflow` commands
- [Commands reference](#commands-reference) — the `/tcgflow-*` slash commands
- [Skills reference](#skills-reference)
- [Multi-project workspaces](#multi-project-workspaces)
- [Migrating an existing project](#migrating-an-existing-project)
- [Upgrading a workspace](#upgrading-a-workspace)
- [Repository layout](#repository-layout)
- [Design & decisions](#design--decisions)

---

## What you get

After `geekstackflow init`, your project has a `.tcgstackflow/` folder containing:

- **LLM wiki** (`wiki/`) — flat, Obsidian-flavoured Markdown maintained by AI, following [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Searched via the mandatory **wiki-search (qmd)** layer — a **project-local** hybrid keyword + vector + re-rank index (`qmd init` → `.qmd/`, so projects never collide on collection names — ADR 0038) that complements the `index.md` Map of Content (ADR 0030). `geekstackflow doctor` verifies the index is real per project *and* checks the wiki's Karpathy/qmd structure (ADR 0039). This is the project's memory.
- **Tasks** (`tasks/`) — every task is exactly two files (`TASK {ID}.md` log + `TASK details {ID}.md` plan), moving through `active/ → completed/ → archive/`.
- **6 agent roles** (`agents/`) — the linear `planner → coder → reviewer → tester → ingester`, plus the manually-invoked **`refactorer`** (a peer to the Coder, re-entering at Review), each a tool-agnostic Markdown profile.
- **17 skills** (`skills/`) — atomic capabilities in Claude Code `SKILL.md` format (mattpocock-compatible).
- **18 commands** (`commands/`) — `tcgflow-*` workflow dispatchers, usable as Claude Code slash commands *or* natural-language triggers in any tool.
- **Governance** (`governance.md`) — four risk levels (LOW/MEDIUM/HIGH/CRITICAL) + a permission-request recipe + your project-specific rules. Enforced live during orchestrated runs (approve/deny in the browser).
- **Tool adapters** (`tools/`) — generated `CLAUDE.md`, `AGENTS.md` (Codex), and `.github/copilot-instructions.md` (Copilot), all pointing back at `.tcgstackflow/` as the single source of truth.
- **Run records** (`runs/`) — every orchestrated run is stored at `runs/{task-id}/{run-id}.md` with its transcript, tokens, session id, the runner `tool`/`gate`, the qmd re-embed outcome, and (for branch-isolated runs) the `isolation`/`branch` it used (workspace schema 7).
- **A local Cockpit / Orchestrator** — `geekstackflow ui` opens a browser dashboard over all your projects that also *runs* the workflow: launch any agent on a task, watch the live stream, approve HIGH/CRITICAL actions, browse run history and per-run reports/diffs, chat with a finished run, and track token spend against a budget — plus task board, wiki activity, Jira status, governance, timesheet.

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

Two binaries are installed, identical: **`geekstackflow`** and the short alias **`tcgflow`**. The CLI itself has **zero runtime dependencies** (pure Node ≥22 — the baseline since the mandatory qmd wiki-search layer needs it); only the Cockpit UI has dependencies, isolated under `ui/`. Contributors: `npm test` runs the suite (Node's built-in `node --test`).

---

## Quick start

Pick your starting point:

- **New project** — a codebase with no prior AI scaffolding → run `init`. See [New project](#new-project) below.
- **Update an existing workspace** — you already have `.tcgstackflow/` and pulled a newer version of the tool → run `upgrade`. See [Update an existing workspace](#update-an-existing-workspace) below.
- **A project with ad-hoc AI infra** (`.taskRef/`, `ai-mem/`, a hand-written `CLAUDE.md`) → use the migration flow, not plain `init`. See [Migrating an existing project](#migrating-an-existing-project).

> Want the guided 5-minute walkthrough with example prompt answers? See [docs/QUICKSTART.md](docs/QUICKSTART.md).

### New project

Scaffold the workspace from scratch:

```bash
cd /path/to/your/project
geekstackflow init .
```

You'll be prompted for:

| Prompt | Notes |
|---|---|
| Project name | defaults to the folder name |
| Primary stack | e.g. "Next.js 16 + Prisma" (multi-project workspaces auto-detect each sub-project's stack) |
| Package manager | pnpm / npm / yarn / bun |
| Tempo integration? | if yes: Atlassian cloudId, quarterly admin key, timezone, submission mode |
| Claude Code? | writes `CLAUDE.md` (default yes) |
| Codex? | writes `AGENTS.md` |
| GitHub Copilot? | writes `.github/copilot-instructions.md` + per-domain instructions |
| Install `/tcgflow-*` slash commands? | to `~/.claude/skills/` (default yes when Claude is enabled) |
| Obsidian symlink? | non-hidden `tcgstackflow/ → .tcgstackflow/` so Obsidian's picker can open it |

`init` also auto-detects sub-projects (multi-project), registers the project in your Cockpit (`~/.tcgstackflow/projects.yaml`), seeds `~/.tcgstackflow/` on first run, and — if the folder is a git repo — offers to install the **git pull-digest hook** so every `git pull` feeds upstream changes to the Ingester (skip it now, wire it later with `geekstackflow hooks .`).

Then three short steps to a working setup:

**1. Turn on wiki search.** In your AI tool, run `/tcgflow-init` — it installs and indexes [qmd](https://github.com/tobi/qmd), the mandatory wiki-search layer (a HIGH action: it asks first, then `npm i -g @tobilu/qmd` + ~2 GB of local models; needs **Node ≥ 22**, plus `brew install sqlite` on macOS). Decline and the workspace falls back to `index.md` navigation.

**2. Seed the wiki from your real code.** The wiki ships as stubs — fill it from the actual codebase:

```
/tcgflow-plan  "scan this codebase and populate wiki/project-overview.md and wiki/architecture.md"
```

…or just say *"plan a task to document this codebase's architecture."*

**3. Launch the Cockpit.**

```bash
geekstackflow ui          # → http://127.0.0.1:4729 (opens your browser)
```

Open a task and press **Run** — the Orchestrator launches the right agent, streams it live, and pauses for your approval on HIGH/CRITICAL actions. See [The Cockpit (Orchestrator)](#the-cockpit-orchestrator).

### Update an existing workspace

When you pull a newer version of the tool, propagate it into a project so it picks up the new commands, agent profiles, schema migrations, and the enriched pull-digest hook:

```bash
geekstackflow upgrade /path/to/project    # or: /tcgflow-upgrade in your AI tool
geekstackflow hooks   /path/to/project    # (re)wire the git pull-digest hook into .git/hooks
```

`upgrade` is **non-destructive**: it runs the schema migrations (now up to **schema 7**), refreshes the tool-owned commands + agent profiles (backing up any drift to `.bak`), additively adds new skills, and prints a **drift report**. It never overwrites your work — tasks, wiki, existing skills, and tool adapters are left untouched, and `config.yaml`/`governance.md` are only *additively extended* by migrations (new blocks/sections appended), never clobbered. Restart Claude Code afterward to pick up the refreshed slash commands. Full details: [Upgrading a workspace](#upgrading-a-workspace).

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

The Cockpit's **action queue** is computed from these statuses: it shows, per task, which agent is ready to act next — and can **Run** that agent directly from the browser (or copy its prompt for an already-open tool).

The **Refactorer** sits outside this linear flow — invoked on demand via `/tcgflow-refactor`, it produces a refactor task and re-enters at `IN_REVIEW` (Reviewer → Tester → Ingester). For refactor-typed tasks the Reviewer's scope-drift blocker is relaxed and behaviour-preservation is the acceptance oracle (ADR 0031).

---

## The Cockpit (Orchestrator)

```bash
geekstackflow ui [--port 4729]
```

A **local** web cockpit *and orchestrator* (Vue 3 + a zero-dependency Node server). Binds to `127.0.0.1` only — no network exposure, no login, no database. Files stay the source of truth: it reads `.tcgstackflow/` directly and writes only what you do through it — run records under `runs/`, task status, and settings (ADRs 0024, 0032). Launching a **Run** spawns your local `claude` CLI, so have it on your PATH and authenticated.

### Browse

- **Home** — agents grouped with their cross-project queues, a hero with estimated spend, and per-project "update available" badges. A **Runs** view lists every recorded run across the workspace.
- **Per-project tabs** — Overview (action queue + agent cards) · Tasks (filterable, sortable table — defaults to the Active bucket) · Wiki · Governance · Timesheet · Tools · **Settings**.
- **Task detail** — the plan, the implementation-log timeline, per-role token totals, the task's runs, and a **Status override** dropdown (rewrites the canonical `Status:` line and auto-logs the change, `author: human / via: cockpit`).
- **Jira status** — each Jira-keyed task shows its Jira status (links to the ticket), "synced Xh ago", and a ⚠ **drift** flag when your workspace and Jira disagree on done-ness. (Refresh with `/tcgflow-sync-jira`.)

### Run an agent

Open a task and press **Run {agent}** (e.g. *Run coder* on a `PLANNED` task):

1. The executor spawns `claude` headlessly in the project directory and **streams the output live** into the panel, with a ticking token counter and a **■ Stop** button.
2. The run **continues across iterations** (`claude --resume`, up to 6) until the agent hands off — sets the task to `IN_REVIEW` — so multi-step tasks actually finish.
3. **Governance is enforced live**: a HIGH/CRITICAL action (push, dependency install, a path your `governance.md` rules escalate) pauses the run and pops an **approval modal** — Action / Risk / Why / Approve / Deny. Deny is non-fatal ("deferred to human"); either decision is recorded in the task log.
4. On completion the run is recorded at `runs/{task-id}/{run-id}.md` (transcript + tokens + session id), and the agent's own log entries land in the task files as usual.
5. **⛓ Chain ("run to completion")** — tick the chain toggle (or set `orchestrator.auto_advance: true`): when a role hands off, the next one launches automatically — coder → reviewer → tester → **ingester** — until the task is `INGESTED`, `BLOCKED`, or it bounces backward more than `max_bounces` times. The **Approvals inbox** (🔔 in the nav, with browser notifications) catches any HIGH/CRITICAL pause from *any* run, so unattended chains never wait unnoticed. Reopening a task **reattaches** to its in-flight run; ▶ buttons on every queue row launch agents without opening the task.
6. **git isolation (ADR 0040)** — a `git:` select next to the chain toggle picks how the run touches git: `in-place` (the current branch, default) or `branch` (create/continue `tcgflow/<TASK-ID>` in the same working tree). It is keyed on the task, so a chain's reviewer/tester/ingester **continue on the branch the coder created**. There's **no auto-merge** — you review the diff and integrate the branch yourself. Set the per-project default in **Settings**. (`worktree` mode is designed but deferred — see ADR 0040.)

### Keep the AI's knowledge fresh

The wiki is the AI's memory — it's only as good as its last ingest. Two mechanisms keep it current:

- **Wiki tab → Knowledge freshness** — tasks awaiting ingest, pending `raw/` files, last-ingest date, wiki last-edit, plus a **▶ Ingest raw now** button.
- **The git-pull hook** — `geekstackflow hooks .` installs a `post-merge`/`post-rewrite` hook: every `git pull` writes a **pull digest** into `.tcgstackflow/raw/` for the Ingester. The digest captures **what changed**, the **cross-project impact** (which sibling projects a shared-dependency / API / schema change ripples to, in a multi-project workspace), and a **plain-language summary** of what the change is about — so the wiki gains the *meaning* of upstream work, not just a file list. With `orchestrator.auto_ingest_on_pull: true` and the Cockpit running, the hook **launches the ingester run automatically** — upstream changes flow into the wiki (and the qmd index, via `embed_on_ingest`) without a click.

### Inspect, report, discuss

- **Session report** — per task (or per run): token classes, a $-cost waterfall (list-price estimate, ADR 0034), tool-calls-by-type, and a per-turn cache-read trace, parsed from the actual Claude session logs. **Open report ↗** exports it as standalone HTML; `/tcgflow-session-report` authors the AI editorial version (narrative + optimization recommendations).
- **Per run** — read the **transcript** (it shows the run's **full session id** with **copy id** and **⌥ resume cmd** buttons), view the **diff** since the run started (`git_base` is captured at launch), or copy the resume command to continue that exact session in your own CLI (`cd "<project>" && claude --resume <session_id>`).
- **Discuss** — a chat box on the task that resumes the latest run's session **read-only** and streams the agent's answer ("what did you do and why?").
- **Settings** — per-role runner tool map (`orchestrator.roles`, ADR 0025 — all-`claude` today, `codex` deferred), the default **git isolation** mode (`orchestrator.isolation`, ADR 0040 — `in-place` | `branch`), and an optional **spend budget** that flags the project when estimated spend exceeds it. Persisted to `config.yaml`.

Before the SPA is built, the server serves a built-in fallback page (read-only browse + copy-prompt) — so `geekstackflow ui` works even without `npm run build`.

> The Orchestrator is no longer a roadmap item: read-only is retired (ADR 0032). "Copy prompt" became "Run" exactly as designed (ADRs 0020–0027), with per-run token capture (0033) and $-cost session reports (0034). Copy-prompt remains as the manual alternative for an already-open tool.

---

## CLI reference

The `geekstackflow` binary (alias **`tcgflow`**; `node init.js …` works the same) — this is the terminal command line, distinct from the in-tool `/tcgflow-*` slash commands below. Zero runtime dependencies. `dir` defaults to the current directory in every form.

| Command | Does |
|---|---|
| `geekstackflow init [dir]` *(or just `geekstackflow [dir]`)* | Scaffold `.tcgstackflow/` in `dir` — the interactive setup (prompts, adapters, registry, optional git hook) |
| `geekstackflow upgrade [dir]` | In-place upgrade: schema migrations, refresh tool-owned files, additive new skills, drift report |
| `geekstackflow ui [--port N]` | Launch the Cockpit / Orchestrator over all registered projects at `http://127.0.0.1:4729` |
| `geekstackflow doctor [dir]` | Health-check every registered project (+ cwd): the **qmd wiki-search layer** (each collection registered, pointed at *this* project's path, embedded — ADR 0038) **and** the wiki's **Karpathy/qmd structure** (frontmatter, chunking, orphans, Map-of-Content reachability — ADR 0039). Read-only; non-zero exit on any problem |
| `geekstackflow doctor --wiki [dir]` | Just the deterministic **wiki-structure** check for the current workspace (what `/tcgflow-lint` and `/tcgflow-ingest` call). Read-only |
| `geekstackflow hooks [dir]` | Install the git `post-merge`/`post-rewrite` **pull-digest hook** into `.git/hooks` (preserves any existing hook as `*.pre-gsf`) |
| `geekstackflow register [dir]` | Add an already-initialised project to the Cockpit registry without re-running init (e.g. after cloning to a new machine) |
| `geekstackflow drift [dir]` | Read-only report of which existing skills / tool adapters differ from the current templates (the files `upgrade` won't auto-merge) |
| `geekstackflow --migrate-from <old> [dir]` | During init, collect old AI infra from `<old>` into `migration-notes/` for manual review (collects, never auto-merges) |
| `geekstackflow --force [dir]` | Overwrite an existing `.tcgstackflow/` (and root adapters) during init |
| `geekstackflow --help` *(`-h`)* | Show usage |

Both binaries are identical. `upgrade` also exists as the `--upgrade` flag; `register`, `drift`, `doctor`, `ui`, and `hooks` are subcommands only.

---

## Commands reference

18 commands. In Claude Code, type `/tcgflow-<name>`. In other tools, use the trigger phrase.

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
| `/tcgflow-session-report [ID]` | Author a session post-mortem from a task's orchestrated runs (token/$ narrative + optimization recommendations) |
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
geekstackflow hooks   /path/to/project     # (re)wire the enriched git pull-digest hook (if the project is a git repo)
```

This:
- runs any **layout migrations** keyed off `workspace_schema` (e.g. the pre-v0.2 dotfile rename; the 5→6 step refreshes the tool-owned `runs/README.md` contract doc **and** the workspace's `hooks/post-merge` so the enriched pull digest — cross-project impact + summary — is picked up),
- **refreshes tool-owned files** — `tcgflow-*` commands (in the workspace *and* `~/.claude/skills/`) and agent profiles are updated to the latest templates, backing up any drifted file to `{name}.bak`,
- **additively adds new skills** (absent → added; existing → never overwritten),
- **prints a drift report** — exactly which existing skills and tool adapters differ from the new templates (the files it won't auto-merge), so you know precisely what to review,
- registers the project in the Cockpit and stamps the version.

`upgrade` does **not** itself touch `.git/hooks` — run `geekstackflow hooks .` to (re)wire the pull-digest hook (it prefers the workspace's freshly-refreshed `hooks/post-merge`).

**Your customizations are never clobbered** — `governance.md`, `config.yaml`, existing skills, and tool-adapter content are left for manual merge. The drift report (re-runnable anytime with `geekstackflow drift /path/to/project`) tells you which of those drifted from the new templates, so the merge is targeted, not guesswork. Restart Claude Code afterward to pick up refreshed slash commands. (ADR 0021.)

---

## Repository layout

```
geekstack-flow/
├── init.js                 # the CLI (init / upgrade / register / drift / ui / hooks) — zero dependencies
├── package.json            # bin: { geekstackflow, tcgflow }, v0.3.0
├── README.md  CONTEXT.md  CONTRIBUTING.md  CHANGELOG.md  LICENSE (MIT)
├── docs/adr/               # 40 Architecture Decision Records
├── test/                   # node --test suite (run with `npm test`)
├── ui/                     # the Cockpit/Orchestrator (Vue 3 + Vite SPA + zero-dep Node server)
│   ├── server/             #   read.cjs (data) · index.cjs (http) · run.cjs (agent executor)
│   │                       #   run-manager · approvals · governance-mcp · governance-classify · session-report
│   │                       #   config-fields.cjs (config.yaml parse/edit) · git.cjs (git seam)
│   │   └── runners/        #   per-tool runner-adapter seam — claude.cjs + index.cjs (ADR 0035)
│   ├── src/                #   App.vue + styles
│   └── public/fonts/       #   self-hosted UI fonts
└── templates/
    ├── workspace/.tcgstackflow/   # copied into each project
    │   ├── config.yaml  governance.md  README.md
    │   ├── agents/        # 6 role profiles
    │   ├── skills/        # 17 skills
    │   ├── commands/      # 18 tcgflow-* commands
    │   ├── hooks/         # post-merge pull-digest hook (wired by `geekstackflow hooks`)
    │   ├── wiki/          # starter pages + adr/
    │   ├── tasks/         # README + weekly/ + active/completed/archive/
    │   ├── runs/          # orchestrated run records, {task-id}/{run-id}.md (schema 7)
    │   ├── raw/  prompts/
    │   └── tools/         # claude/ codex/ github/ adapters
    └── global/.tcgstackflow/      # copied to ~/.tcgstackflow/ (memory/ + skills/)
```

---

## Design & decisions

- **[CONTEXT.md](CONTEXT.md)** — the project's domain language (Wiki, Raw, Ingest/Query/Lint, Agent, Skill, Command, Cockpit, Orchestrator, Workspace vs Jira status, …).
- **[docs/adr/](docs/adr/)** — 40 Architecture Decision Records. Highlights: scope ladder (0001), manual cross-tool handoff (0002), wiki structure (0003), two-file tasks (0004), skill/agent/adapter model (0005), governance (0008), the Cockpit & Orchestrator design (0020–0027), tester role (0028), Jira-via-cache (0029), qmd-mandatory wiki search (0030), refactorer role + cleanup-pass doctrine (0031), **Cockpit becomes the Orchestrator — read-only retired (0032)**, per-run token capture (0033), $-cost session reports (0034), per-tool runner-adapter seam + fidelity tiers (0035), deterministic qmd re-embed after ingest (0036), qmd discovery-path recording + project-local index + deterministic wiki-structure check (0037–0039), per-run git isolation — branch now, worktree deferred (0040).

## Inspirations

- [Karpathy — LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the memory pattern.
- [qmd by Tobi Lütke](https://github.com/tobi/qmd) — the mandatory local wiki-search layer (CLI canonical; MCP an optional Claude convenience).
- [mattpocock/skills](https://github.com/mattpocock/skills) — the `SKILL.md` format adopted as canonical.
- [ruvnet/ruflo](https://github.com/ruvnet/ruflo) — the workspace-initialisation idea that seeded the brief.

## License

[MIT](LICENSE) © The Creative Geeks / Biben Nurbani Hasan.
