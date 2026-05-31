# Add GitHub Copilot tool adapter, per-domain instructions, and global vs project-local skill boundary

The first real migration target (INX) surfaced three V1 gaps that we patch in the same session as the migration task:

1. **GitHub Copilot tool adapter is needed in V1.** INX's `ai-mem/github/` contains a substantial `copilot-instructions.md` + six per-domain `*.instructions.md` files that have no V1 home today.
2. **Per-domain instructions are a real Copilot pattern** (`.github/instructions/*.instructions.md`) that the Copilot adapter must support — narrow per-area guidance complementing the top-level instructions file.
3. **Tech skills live globally, workflow skills live per-project.** INX's `ai-mem/agents/skills/` contains 11 cross-project tech skills (vue, pinia, cypress-author, dotnet-best-practices, etc.) from public sources (antfu/skills, github/awesome-copilot, pulumi/agent-skills). They belong in `~/.tcgstackflow/skills/`, not duplicated into every project's `.tcgstackflow/skills/`.

## Decisions

### Copilot adapter (V1 addition)

- New folder `templates/workspace/.tcgstackflow/tools/github/`
  - `copilot-instructions.md` — generic template, parallel to `tools/claude/CLAUDE.md` and `tools/codex/AGENTS.md`
  - `instructions/README.md` — explains the per-domain instructions pattern
- `init.js` writes `.github/copilot-instructions.md` at project root from the canonical template when `tools.github: true`.
- `init.js` also creates `.github/instructions/` and copies (or symlinks) each `.instructions.md` from `tools/github/instructions/` into it.
- `config.yaml` gains `tools.github: false` (default off; opt in per project).

### Skill library boundary

- **Workflow skills** (`grill-task`, `plan-task`, `ingest`, `lint-wiki`, etc.) live at `.tcgstackflow/skills/{name}/SKILL.md` per project. They are versioned with the project because their conventions are project-specific.
- **Tech skills** (vue, pinia, vuetify, cypress-author, dotnet-best-practices, etc.) live at `~/.tcgstackflow/skills/{name}/SKILL.md` globally. They are versioned per-user because the conventions span projects.
- A project may *reference* global tech skills from its CLAUDE.md / AGENTS.md / copilot-instructions.md; V1 does not copy or symlink them into the project. Each AI tool reads both locations.
- Skill installation: project-local via direct file authoring; global via `cd ~/.tcgstackflow/skills && npx skills add <owner/repo@skill>` (works because `npx skills` resolves CWD-relative).

### Per-tool config carry-forward

- `templates/workspace/.tcgstackflow/tools/claude/` may include a `settings.local.json.example` (commented placeholder for the project's Claude Code permission allow-list and enabled MCP servers).
- `templates/workspace/.tcgstackflow/tools/codex/` may include a `config.toml.example` (commented placeholder for Codex MCP server entries).
- These examples ship empty/commented; init does not propagate them to the live locations — they exist as a discoverable hint that this is where per-project tool config lives if needed.

## Consequences

- V1 templates grow from two tool adapters (Claude, Codex) to three (Claude, Codex, GitHub). Antigravity remains deferred per ADR 0001.
- Init script grows by ~20 lines to handle the GitHub case.
- `config.yaml` gains one boolean.
- A future "skill install" skill could automate `npx skills add` invocations, but is out of scope for V1 — this ADR just locks where skills land.
- The skill-boundary rule explicitly answers a question ADR 0005 left implicit ("where do skills live") — global vs project-local routing is now decision policy, not user judgement.
