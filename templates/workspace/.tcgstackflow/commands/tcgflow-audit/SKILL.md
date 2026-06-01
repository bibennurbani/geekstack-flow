---
name: tcgflow-audit
description: Run the audit-workspace skill — cross-check agents ↔ skills ↔ codebase drift in `.tcgstackflow/`. Detects broken agent→skill references, skills in the wrong library (project-local vs global per ADR 0012), skill content stale vs codebase tech versions, tech in codebase without a skill, SKILL.md frontmatter issues, tool adapter mismatches, and (for multi-project workspaces) sub-projects missing from config.yaml. Produces a report; fixes route through normal channels.
---

# `/tcgflow-audit` — health-check the workspace integrity

## When to use

The user typed `/tcgflow-audit` or said *"audit the workspace"*, *"are agents and skills in sync?"*, *"check workflow integrity"*. Or it's a scheduled weekly check (commonly run alongside `/tcgflow-lint`).

## What to do

Run the `audit-workspace` skill (see `.tcgstackflow/skills/audit-workspace/SKILL.md` for full procedure):

1. **Inventory agents.** For each `.tcgstackflow/agents/*.md`, parse the `Skills used:` section. Build a set.
2. **Inventory project-local skills** (`.tcgstackflow/skills/`) and **global skills** (`~/.tcgstackflow/skills/`). Parse frontmatter.
3. **Inventory codebase tech-stack signals** — `package.json` deps, `*.csproj` references, `Pulumi.yaml`, `Cargo.toml`, `pyproject.toml`, `go.mod`, etc.
4. **Run detectors:**
   - **Broken agent → skill references** (`blocker`) — agent names a skill that doesn't exist.
   - **Skill in wrong library** (`major`) — tech skill in project-local, or workflow skill in global. Heuristic: classify by description.
   - **Skill stale vs codebase** (`major`) — skill describes a different major version than `package.json` says.
   - **Tech in codebase without a skill** (`nit`) — propose `npx skills add ...`.
   - **Skill in library without codebase use** (`nit`) — informational; skills can serve other projects.
   - **SKILL.md frontmatter invalid** (`blocker`) — missing `name`/`description`, malformed YAML.
   - **Agent profile references non-existent path** (`nit`) — wiki page in `Reads:` doesn't exist.
   - **Tool adapter declared but not generated** (`major`) — `config.yaml` says `tools.X: true` but the root file is stale or missing.
   - **Multi-project drift** (`major`) — for `workspace_kind: multi-project`: top-level dir has project signals but isn't in `projects:`; `projects[].path` references a missing dir; task/wiki references a project not in config.

5. **Append the report** to `wiki/log.md` using the prefix `## [YYYY-MM-DD] audit | workspace`.

6. **Surface the top findings inline** to the user, ordered by impact.

7. **Wait for direction.** Fixes route through:
   - `/tcgflow-ingest` for wiki/governance changes
   - Manual file moves (the user does these)
   - `npx skills add` for skill installs
   - `geekstackflow init --force` for tool adapter regeneration

## Anti-patterns

- **Silently fixing findings.** Audit produces a report, not a diff.
- **Treating "unused tech skill in global library" as a removal candidate.** Global skills serve multiple projects.
- **Running during `/tcgflow-migrate`.** A half-migrated workspace will produce noise; wait until migration is complete (post-DECOM-3) before auditing.

## Notes

- Audit and lint are complementary. Audit handles workspace integrity (agents/skills/codebase); lint handles wiki content integrity. Run both for full health.
