---
name: tcgflow-migrate
description: Migrate an existing project's ad-hoc AI infrastructure (`.taskRef/`, `ai-mem/`, hand-written `CLAUDE.md`/`AGENTS.md`, scattered Copilot instructions) onto canonical Creative GeekStack Flow `.tcgstackflow/` layout. Use when the user types `/tcgflow-migrate` or wants a clean cutover from prior AI workflow scaffolding. Executes the four-phase migration pattern (init+adapters → tasks → wiki → decommission) with `.bak` backups and a CRITICAL deletion gate at the end.
---

# `/tcgflow-migrate` — migrate existing AI infrastructure

## When to use

The user typed `/tcgflow-migrate` or said *"migrate this project to geekstackflow"*, *"move from .taskRef to .tcgstackflow"*, *"cutover the AI infra"*. The current directory has prior AI scaffolding that needs to be replaced.

## What to do

You are operating the `migrate-to-gsf` skill against the current directory. Follow its full procedure; the high-level pattern is:

1. **Pre-flight (Planner role).** Inventory existing AI infrastructure. Classify each item: migrate / fold-into-agent-profile / unique-skill / archive-to-bak / discard. Distinguish actually-active tasks from stale carry-overs. Detect workspace kind (single vs multi-project).

2. **Commit pending git work** as a pre-migration snapshot if the user agrees — gives clean rollback.

3. **Backup the old AI infra to `.bak` siblings** (Phase 1):
   ```bash
   mv .taskRef .taskRef.bak
   mv ai-mem ai-mem.bak
   mv CLAUDE.md CLAUDE.md.bak
   mv AGENTS.md AGENTS.md.bak
   mv .github/copilot-instructions.md .github/copilot-instructions.md.bak
   mv .github/instructions .github/instructions.bak
   ```
   Adjust paths to match what the project actually has (.taskRef/ vs .tasks/, docs/ vs ai-mem/, etc.).

4. **Run `geekstackflow init --migrate-from . .`** — installs the workspace AND collects the old artifacts into `.tcgstackflow/.migration-notes/` for manual review.

5. **Adopt Planner role** (`agents/planner.md`) and use `plan-task` to write a `TASK details` file for the migration: subtasks for tasks migration, wiki ingestion, schema-doc rewriting (paths from `.taskRef/` → `.tcgstackflow/tasks/`, etc.), global tech-skill move to `~/.tcgstackflow/skills/`, and the CRITICAL decommission step.

6. **Switch to Coder role** to execute phase by phase. Use `update-task-log` after each meaningful change.

7. **Switch to Ingester role** for Phase 3 (wiki ingestion from the `.migration-notes/` and the `.bak` content). One ingest per source subfolder = one `log.md` entry. Approval gate applies to new pages and deletions.

8. **Run `audit-workspace` and `lint-wiki`** after Phase 3 to surface drift before decommission.

9. **Validate with ≥2 real coding sessions** using the new structure (Phase 4 step 2).

10. **Delete `.bak` artifacts (CRITICAL)** only after explicit recorded approval per `governance.md`. Rollback = `git revert` of the deletion commit.

## Notes

- Use `--migrate-from` to collect old content into `.tcgstackflow/.migration-notes/` — that's the source for content-level migration (rewriting `.taskRef/` → `.tcgstackflow/tasks/` paths in Copilot adapters, lifting Tempo config into `config.yaml`, etc.).
- Stale "active" tasks (status says active but not actually being worked on) go to `archive/stale/`, not back into `active/`.
- Tech skills (Vue, Pinia, .NET best-practices, etc.) move to `~/.tcgstackflow/skills/` globally; workflow skills stay project-local. ADR 0012.
- Per-project test/lint commands populate from the multi-project auto-detection during init.
