# Creative GeekStack Flow

A structured AI workflow for planning, coding, reviewing, testing, and shipping software — built personal-first, designed to grow into a team and (eventually) public tool without re-architecting.

> **V1 scope:** Personal use by the author and small-team trials. Not yet packaged for OSS. See [docs/adr/0001](docs/adr/0001-personal-first-team-usable-oss-ready.md).

## What this is

`geekstackflow` scaffolds a workspace at `.tcgstackflow/` inside any project. The workspace contains:

- A **flat Obsidian-style wiki** maintained by AI, following [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). qmd-compatible for retrieval.
- A **task tracking system** with a strict two-file rule (`TASK {ID}.md` + `TASK details {ID}.md`).
- **Four agent profiles** (`planner`, `coder`, `reviewer`, `ingester`) — tool-agnostic role specs.
- **Ten starter skills** in Claude Code `SKILL.md` format (drop-in compatible with mattpocock-style skills).
- **Governance** — risk levels, permission-request recipe, project rules.
- **Generated tool adapters** for Claude Code (`CLAUDE.md`), Codex (`AGENTS.md`), and GitHub Copilot (`.github/copilot-instructions.md` plus per-domain `.instructions.md` files).
- **Ten `/tcgflow-*` slash commands** for Claude Code (`/tcgflow-init`, `/tcgflow-plan`, `/tcgflow-code`, `/tcgflow-review`, `/tcgflow-ingest`, `/tcgflow-lint`, `/tcgflow-audit`, `/tcgflow-migrate`, `/tcgflow-timesheet-generate`, `/tcgflow-timesheet-submit`) — installed to `~/.claude/skills/` during init.
- **Multi-project workspace** auto-detection — when init finds 2+ codebases at top level (package.json, *.csproj at top or `src/<proj>/`, Pulumi.yaml, etc.), it populates `config.yaml`'s `projects:` array with per-project stack and test/lint commands.
- The `.tcgstackflow/` folder is designed as an **Obsidian vault** — open it directly in Obsidian for graph navigation across the wiki, tasks, agents, and skills.
- A **weekly Tempo/Jira timesheet flow** as two skills (`generate-timesheet` LOW, `submit-timesheet` HIGH).

## Install

```bash
# Global install — recommended once published to npm.
npm install -g geekstackflow

# Or from a local clone (until then):
git clone https://github.com/TheCreativeGeeks/geekstack-flow.git
cd geekstack-flow && npm link
```

After install, two binaries are available: `geekstackflow` and `tcgflow` (same script).

## Quick start

V1 ships a small Node script (no dependencies, no npm install) that scaffolds the workspace and writes per-tool adapters.

### Greenfield project (no prior AI infra)

```bash
cd /path/to/your/project
geekstackflow init .         # or: tcgflow init .
# (or `node /path/to/geekstack-flow/init.js .` if not globally installed)
```

You'll be prompted for: project name, stack, package manager, Tempo (optional), and which tool adapters to write (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`). The script writes `.tcgstackflow/` plus whichever root files you enabled, and initialises `~/.tcgstackflow/` (global memory and skill library home) on first run.

Open the project in your AI tool of choice. It reads the root adapter file (`CLAUDE.md` / `AGENTS.md`) which points at `.tcgstackflow/`. First task: invoke the planner — *"plan a task to scan this codebase and populate wiki/project-overview.md"*.

### Existing project with prior AI infra (`.taskRef/`, `ai-mem/`, hand-written CLAUDE.md, etc.)

Use the migration flow. Quick form:

```bash
cd /path/to/existing-project

# 1. Commit any pending git work — gives you a clean rollback point.
git add -u && git commit -m "WIP snapshot before geekstack-flow migration"

# 2. Back up the old AI infrastructure (rename to .bak siblings).
mv .taskRef .taskRef.bak
mv ai-mem ai-mem.bak
mv CLAUDE.md CLAUDE.md.bak
mv AGENTS.md AGENTS.md.bak
mv .github/copilot-instructions.md .github/copilot-instructions.md.bak
mv .github/instructions .github/instructions.bak

# 3. Init with --migrate-from to collect the old content for review.
geekstackflow init --migrate-from . .

# 4. Open in your AI tool, invoke the planner with the migrate-to-gsf skill:
#    "Plan a task using the migrate-to-gsf skill for this codebase."
#    The planner reads .tcgstackflow/.migration-notes/ for the old content,
#    grills you on classification (workflow vs tech skills, active vs stale
#    tasks, etc.), and writes TASK details into tasks/active/.
```

The four-phase migration pattern (init+adapters / tasks / wiki / decommission) is documented in the `migrate-to-gsf` skill that ships in V1.

## Repository layout

```
geekstack-flow/                 # ← this repo
├── README.md                   # this file
├── LICENSE                     # MIT
├── CONTRIBUTING.md             # how to extend the tool
├── CHANGELOG.md                # release notes
├── package.json                # bin: { geekstackflow, tcgflow }
├── CONTEXT.md                  # project glossary (terms the design uses)
├── docs/
│   └── adr/                    # architecture decisions (0001–0016)
├── templates/
│   └── workspace/
│       └── .tcgstackflow/      # the workspace that gets copied into target projects
│           ├── README.md       # in-workspace orientation
│           ├── config.yaml
│           ├── governance.md
│           ├── agents/         # 4 role profiles
│           ├── wiki/           # 5 starter pages + adr/
│           ├── tasks/          # README + WEEKLY_TIMESHEET + active/completed/archive/
│           ├── raw/            # explicit-Raw staging
│           ├── prompts/        # cross-tool manual handoff
│           ├── skills/         # 8 SKILL.md files
│           └── tools/
│               ├── claude/CLAUDE.md
│               └── codex/AGENTS.md
└── (init.js — to be written)
```

## Design

The design is captured in:

- [CONTEXT.md](CONTEXT.md) — the project's domain language (skills, agents, tool adapters, Raw, Wiki, Ingest, Lint, Query, governance, etc.).
- [docs/adr/](docs/adr/) — eleven Architecture Decision Records covering scope, cross-tool strategy, wiki structure, task layout, the three-bucket skill/agent/adapter model, ingestion procedure, approval gates, governance shape, global memory, timesheet split, and the V1 skill set.

## What's intentionally not in V1

- npm package / public CLI invocation (`npx geekstackflow init .`) — deferred until reuse proves the CLI worth building.
- Automated cross-tool orchestration (Claude shelling out to `codex exec`) — manual handoff only.
- Runtime enforcement of governance — informal enforcement via the reviewer agent.
- More than two tool adapters out of the box — Claude Code + Codex (`AGENTS.md`). Antigravity / Copilot adapters added when actually used.
- A `doctor`/`scan` CLI command — health-check is the `lint-wiki` skill operating on the wiki itself.

## Inspirations

- [Karpathy — LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — the wiki pattern this project implements.
- [qmd by Tobi Lütke](https://github.com/tobi/qmd) — local search engine for the wiki; wired as MCP.
- [mattpocock/skills](https://github.com/mattpocock/skills) — Claude Code skill format the project adopts as canonical.
- [ruvnet/ruflo](https://github.com/ruvnet/ruflo) — workspace-initialisation pattern that informed the original brief, though the focus diverged considerably.

## License

TBD. (Personal use today; will pick a permissive license — likely MIT — when this graduates to team/OSS use.)
