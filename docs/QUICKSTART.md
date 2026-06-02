# Quick Start

From zero to a working workspace + Cockpit in ~5 minutes. Assumes you've done [INSTALL.md](INSTALL.md).

> Migrating a project that **already** has AI scaffolding (`.taskRef/`, `ai-mem/`, a hand-written `CLAUDE.md`)? Skip to [USAGE.md → Migrating an existing project](USAGE.md#migrating-an-existing-project) instead — running plain `init` there would collide with what's already present.

## 1. Initialise a project

```bash
cd /path/to/your/project
geekstackflow init .
```

Answer the prompts (Enter accepts the default):

```
Project name:                         [my-project]
Primary stack (e.g. "Next.js 16"):    Next.js 16 + Prisma
Package manager (pnpm/npm/yarn/bun):  pnpm
Enable Tempo/Jira timesheet?          n
Enable Claude Code (CLAUDE.md)?       Y
Enable Codex (AGENTS.md)?             n
Enable GitHub Copilot?                n
Install /tcgflow-* slash commands?    Y
Create Obsidian symlink?              Y
```

You'll see it create `.tcgstackflow/`, write `CLAUDE.md`, register the project, and (first run) seed `~/.tcgstackflow/`. If your repo has multiple sub-projects at the top level, it auto-detects them and fills `config.yaml`'s `projects:` array.

## 2. Open the project in your AI tool

Claude Code (or Codex/Copilot) reads the root adapter file (`CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md`), which points at `.tcgstackflow/`. It now knows the workflow.

## 3. Seed the wiki from your real code

The wiki ships as stubs. Fill it from the actual codebase:

```
/tcgflow-plan  "scan this codebase and populate wiki/project-overview.md and wiki/architecture.md"
```

(Or just say: *"plan a task to document this codebase's architecture."*) Then run the task through the loop (next step).

## 4. Run your first real task

```
/tcgflow-plan ES-1234      # Planner grills you, writes the two task files (status PLANNED)
/tcgflow-code ES-1234      # Coder implements + writes tests, logs each change
/tcgflow-review ES-1234    # Reviewer checks the diff (→ IN_TEST)
/tcgflow-test ES-1234      # Tester runs verification (→ VALIDATED)
/tcgflow-ingest ES-1234    # Ingester folds it into the wiki (→ INGESTED, moves to completed/)
```

Not on Claude Code? Use natural language — *"plan ES-1234"*, *"implement it"*, *"review the diff"*, *"test it"*, *"ingest it"* — every tool reads the same workflow from the workspace.

## 5. Launch the Cockpit

```bash
geekstackflow ui          # → http://127.0.0.1:4729
```

- **Home** — what's ready to act on across *all* your registered projects.
- Click a project → its action queue, task board, wiki activity, governance, timesheet.
- **Copy prompt** on any queue item → paste into your AI tool to start that agent.

## 6. (Optional) wire up Jira & Tempo

If you enabled Tempo at init (or set `tempo.cloudId` + `admin_key` in `config.yaml` later) and connected the Atlassian MCP:

```
/tcgflow-sync-jira                 # pull each task's Jira status into the Cockpit
/tcgflow-timesheet-generate        # draft this week's Tempo timesheet from your task logs
/tcgflow-timesheet-submit          # push worklogs to Tempo (asks for approval)
```

## You're set

That's the whole loop. For the detailed mechanics of each step, every command, the Cockpit, multi-project, and troubleshooting → **[USAGE.md](USAGE.md)**.
