# Contributing to Creative GeekStack Flow

Thanks for considering a contribution. The tool is intentionally small — a single `init.js`, a templates folder, a set of ADRs, and concept-level docs.

## Local setup

```bash
git clone https://github.com/bibennurbani/geekstack-flow.git
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

Requires **Node ≥ 22** (`engines` in `package.json` — the mandatory qmd wiki-search layer needs it).

## Running the tests

Run these before opening a PR. There is nothing to install first, and the whole suite takes a few seconds.

```bash
npm test          # the full suite — node --test over test/*.test.{cjs,mjs}
npm run smoke     # node init.js --help — proves the single-file installer still parses
```

One file at a time while you iterate:

```bash
node --test test/pr.test.cjs
```

Conventions worth knowing before you add a test:

- Tests live in `test/` as `*.test.cjs` (a couple are `.mjs`) and use Node's built-in runner and `node:assert` — no framework, no dependencies.
- `init.js` exports its internals (`parseArgs`, `detectProjects`, `computeInitPlan`, `checkWikiStructure`, …) specifically so they can be unit-tested without running the installer. Prefer that over shelling out.
- **Assert on behaviour, not on source text.** Build the artifact the shipped code builds and assert on its output. A whole class of governance tests once passed while the shipped template was inert, because each test hand-wrote its own `governance.md` string instead of using the real one (see the ADR 0044 entry in `CHANGELOG.md`). `test/shipped-templates-behavior.test.cjs` is the pattern to copy.
- Anything that writes files must work inside a temp directory (`os.tmpdir()`) and clean up after itself. Per [ADR 0013](docs/adr/0013-tool-repo-stays-clean.md) there must never be a `.tcgstackflow/` in this repo, so don't run `init` against the checkout.

CI runs the same two commands on Linux and macOS across Node 22 and 24, plus a Cockpit build (`.github/workflows/ci.yml`).

## Opening a pull request

- Keep the diff focused; one concern per PR.
- `npm test` and `npm run smoke` pass locally.
- If you changed behaviour, a test covers it. If you fixed a bug, the test names the bug.
- If the change embodies a design decision, say which ADR it follows — or note that a new one is needed and sketch it in the PR description (see [How design decisions are made](#how-design-decisions-are-made)).
- Update `CHANGELOG.md` under `## [Unreleased]` for anything user-visible.

There is no CLA and no DCO sign-off requirement. By opening a PR you agree your contribution ships under the repository's [MIT licence](LICENSE).

## Repo layout

| Path | Purpose |
|---|---|
| `init.js` | The installer — pure Node built-ins, single file. |
| `templates/workspace/.tcgstackflow/` | The workspace template copied into target projects. |
| `templates/global/.tcgstackflow/` | The global template copied to `~/.tcgstackflow/` on first run. |
| `templates/workspace/.tcgstackflow/commands/` | The `tcgflow-*` workflow commands — canonical for every tool; `init.js` also installs them to `~/.claude/skills/` as Claude Code slash commands. |
| `docs/adr/` | Architecture Decision Records — one per substantive design call. |
| `CONTEXT.md` | The project's domain glossary. |

## How design decisions are made

Substantive design calls are captured as **ADRs** in `docs/adr/{NNNN}-slug.md`. Each ADR is short (1–3 paragraphs is fine), grounded in real-world evidence where possible, and uses generic language — no specific project names from the contributor's own work creep into the tool.

See [docs/adr/0013-tool-repo-stays-clean.md](docs/adr/0013-tool-repo-stays-clean.md) for the principle: **the tool repo is the tool, never a live workspace**. There must not be a `.tcgstackflow/` inside this repo.

## Adding a skill

1. Create `templates/workspace/.tcgstackflow/skills/{name}/SKILL.md` (Claude Code skill format).
2. Add a row to the skill tables in `tools/claude/CLAUDE.md`, `tools/codex/AGENTS.md`, and `tools/github/copilot-instructions.md` (and bump the "N starter skills" counts there).
3. Reference the skill from any agent profile in `agents/{role}.md` that should use it.
4. Add a CHANGELOG entry.

## Adding a command (`/tcgflow-*`)

1. Create `templates/workspace/.tcgstackflow/commands/tcgflow-{name}/SKILL.md` — the one canonical location. `init`/`upgrade` copy the whole folder into each project *and* into `~/.claude/skills/`, so no `init.js` change is needed to register it.
2. The `name:` frontmatter MUST equal the directory name and start with `tcgflow-`. `test/templates-structure.test.cjs` enforces this.
3. The `description:` carries both invocations: when the user would type `/tcgflow-{name}` **and** the natural-language trigger phrases other tools dispatch on (ADR 0019).
4. Keep the body a **thin dispatcher** — which role to adopt and which skill holds the procedure. Behaviour belongs in `skills/`, not in the command.
5. Update the command tables in the three tool adapters (above the "Edit below this line" marker — that region is tool-owned and `upgrade` propagates it to existing projects, ADR 0042), the counts in `README.md` / `docs/USAGE.md` / `CONTEXT.md` / `templates/workspace/.tcgstackflow/README.md`, and the CHANGELOG.

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
