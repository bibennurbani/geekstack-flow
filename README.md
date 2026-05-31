# Creative GeekStack Flow

A structured AI workflow for planning, coding, reviewing, testing, and shipping software — built personal-first, designed to grow into a team and (eventually) public tool without re-architecting.

> **V1 scope:** Personal use by the author and small-team trials. Not yet packaged for OSS. See [docs/adr/0001](docs/adr/0001-personal-first-team-usable-oss-ready.md).

## What this is

`geekstackflow` scaffolds a workspace at `.tcgstackflow/` inside any project. The workspace contains:

- A **flat Obsidian-style wiki** maintained by AI, following [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). qmd-compatible for retrieval.
- A **task tracking system** with a strict two-file rule (`TASK {ID}.md` + `TASK details {ID}.md`).
- **Four agent profiles** (`planner`, `coder`, `reviewer`, `ingester`) — tool-agnostic role specs.
- **Eight starter skills** in Claude Code `SKILL.md` format (drop-in compatible with mattpocock-style skills).
- **Governance** — risk levels, permission-request recipe, project rules.
- **Generated tool adapters** for Claude Code (`CLAUDE.md`), Codex (`AGENTS.md`), and others.
- A **weekly Tempo/Jira timesheet flow** as two skills (`generate-timesheet` LOW, `submit-timesheet` HIGH).

## Quick start (V1 — manual)

V1 ships no CLI yet. To initialise a project today:

```bash
# 1. From this repo
cp -R templates/workspace/.tcgstackflow /path/to/your/project/
cp templates/workspace/.tcgstackflow/tools/claude/CLAUDE.md /path/to/your/project/CLAUDE.md
cp templates/workspace/.tcgstackflow/tools/codex/AGENTS.md /path/to/your/project/AGENTS.md

# 2. Edit .tcgstackflow/config.yaml in the target — set project name, stack, Tempo config.
# 3. Open in Claude Code (or your AI tool of choice). It will read CLAUDE.md / AGENTS.md
#    and operate against the .tcgstackflow/ workspace.
```

A tiny Node init script (target: ~150 lines) is the next planned build step — see [docs/adr/0001](docs/adr/0001-personal-first-team-usable-oss-ready.md) and the V1 scope summary.

## Repository layout

```
geekstack-flow/                 # ← this repo
├── README.md                   # this file
├── CONTEXT.md                  # project glossary (terms the design uses)
├── docs/
│   └── adr/                    # architecture decisions (0001–0011)
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
