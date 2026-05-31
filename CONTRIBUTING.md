# Contributing to Creative GeekStack Flow

Thanks for considering a contribution. The tool is intentionally small — a single `init.js`, a templates folder, a set of ADRs, and concept-level docs.

## Local setup

```bash
git clone https://github.com/TheCreativeGeeks/geekstack-flow.git
cd geekstack-flow
# No dependencies to install — init.js uses Node built-ins only.
# Optionally link globally so `geekstackflow` and `tcgflow` are on your PATH:
npm link
```

After `npm link`:

```bash
cd /path/to/some/project
geekstackflow init .         # or: tcgflow init .
```

## Repo layout

| Path | Purpose |
|---|---|
| `init.js` | The installer — pure Node built-ins, single file. |
| `templates/workspace/.tcgstackflow/` | The workspace template copied into target projects. |
| `templates/global/.tcgstackflow/` | The global template copied to `~/.tcgstackflow/` on first run. |
| `templates/claude-commands/` | Claude Code slash-command skills (`/tcgflow-*`) installed to `~/.claude/skills/`. |
| `docs/adr/` | Architecture Decision Records — one per substantive design call. |
| `CONTEXT.md` | The project's domain glossary. |

## How design decisions are made

Substantive design calls are captured as **ADRs** in `docs/adr/{NNNN}-slug.md`. Each ADR is short (1–3 paragraphs is fine), grounded in real-world evidence where possible, and uses generic language — no specific project names from the contributor's own work creep into the tool.

See [docs/adr/0013-tool-repo-stays-clean.md](docs/adr/0013-tool-repo-stays-clean.md) for the principle: **the tool repo is the tool, never a live workspace**. There must not be a `.tcgstackflow/` inside this repo.

## Adding a skill

1. Create `templates/workspace/.tcgstackflow/skills/{name}/SKILL.md` (Claude Code skill format).
2. Add a row to the skill tables in `tools/claude/CLAUDE.md`, `tools/codex/AGENTS.md`, and `tools/github/copilot-instructions.md`.
3. Reference the skill from any agent profile in `agents/{role}.md` that should use it.
4. Add a CHANGELOG entry.

## Adding a slash command

1. Create `templates/claude-commands/tcgflow-{name}/SKILL.md`.
2. The skill's `name:` frontmatter MUST start with `tcgflow-`.
3. The skill's `description:` should explain when the user would type `/tcgflow-{name}`.
4. The body is the instruction Claude follows when invoked.

## Adding a tool adapter

If adding support for a new AI tool (Antigravity, Continue, etc.):

1. Create `templates/workspace/.tcgstackflow/tools/{tool}/` with the canonical adapter file.
2. Add an entry to `config.yaml`'s `tools:` section.
3. Update `init.js` to prompt for the new tool and copy/symlink its adapter to the project root.
4. Write an ADR documenting why the tool was added and what its boundaries are.

## Style

- Pure Node built-ins in `init.js`. No dependencies. If you find yourself reaching for `commander`/`zod`/`prompts`, write it by hand instead.
- ADRs are short. Most are 1–3 paragraphs. Only add Considered Options / Consequences sections when they add real value.
- Templates ship to users — no project-specific names, paths, or task IDs in template files.

## Versioning

Semantic Versioning. Bumps:

- **MAJOR** — incompatible changes to the workspace layout, the agent profiles' procedure schema, or the `init.js` CLI surface.
- **MINOR** — new skills, new tool adapters, new ADRs, new init prompts, new slash commands.
- **PATCH** — bug fixes in `init.js`, documentation fixes, template content polish.

## Sanity smoke test

```bash
node init.js --help
```

If it prints the help text, the script parses. For richer verification:

```bash
node -e "console.log(require('./init.js').detectProjects(process.argv[1]))" /path/to/multi-project-workspace
```

Should detect the sub-projects with appropriate stacks.

## Communication

- For bug reports: GitHub Issues.
- For design discussions: open an Issue with the `design` label before opening a PR.
- For ADR proposals: draft the ADR in the PR description, then commit it once merged.
