---
name: migrate-to-gsf
description: Migrate an existing project from ad-hoc AI infrastructure (`.taskRef/`, `ai-mem/`, hand-written `CLAUDE.md`/`AGENTS.md`, scattered Copilot instructions) onto the canonical Creative GeekStack Flow `.tcgstackflow/` layout. Clean cutover with `.bak` backups. Four phases — Init+adapters / Tasks migration / Wiki ingestion / Decommission — plus a cross-cutting move of tech skills from project-local to global. The CRITICAL deletion step requires explicit recorded approval. Pattern extracted from the GSF-001 INX migration.
---

# Migrate to Creative GeekStack Flow

## When to use this skill

Invoke this skill when:

- A project has ad-hoc AI infrastructure (any of `.taskRef/`, `ai-mem/`, hand-written `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/`, or similar) that overlaps with what `.tcgstackflow/` would provide.
- The user wants a clean cutover rather than long coexistence (coexistence becomes permanent duplication, per ADR 0004).
- You have ≥2 hours to commit to the full lifecycle including the post-migration validation sessions before decommission.

**Do not use this skill** for greenfield projects — those just run `node init.js .` once. Migration is only relevant when there's prior AI infrastructure to *replace*.

## Instructions

You are operating as **Planner** first (drafting the migration task), then **Coder** (executing it), then **Reviewer** (validating each phase), then **Ingester** (Phase 3 wiki work). Use the right profile at each stage; don't shortcut role discipline because the work is "infrastructural."

### High-level shape

```
Phase 1 — Init + adapters
  ↓
Phase 2 — Tasks migration
  ↓
Phase 3 — Wiki ingestion (log-first, gated new pages)
  ↓
Cross-cutting — Global tech-skill migration
  ↓
Phase 4 — Decommission (CRITICAL: requires recorded approval)
```

### Procedure

#### Pre-flight (Planner role)

1. **Inventory the existing AI infrastructure.** List every file/folder that overlaps with the canonical layout:
   - Tasks (likely `.taskRef/`, `.tasks/`, or similar)
   - Wiki/docs (likely `ai-mem/docsRef/`, `docs/`, or similar)
   - Per-tool adapters (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/`)
   - Per-tool config (`ai-mem/claude/settings.local.json`, `ai-mem/codex/config.toml`, etc.)
   - Skill libraries (likely `ai-mem/agents/skills/`, `.github/skills/`, etc.)
   - Timesheet/Tempo instructions (likely `WEEKLY_TIMESHEET_INSTRUCTIONS.md`)
2. **Classify each item:** migrate / fold-into-agent-profile / unique-skill / archive-to-bak / discard. Use the same retention vocabulary as `audit-workspace`.
3. **Classify tasks** under any existing tasks folder. Distinguish *actually-active* (currently being worked on) from *stale carry-overs* (status says active but not touched in months).
4. **Classify skills** as workflow (project-local) or tech (global) per ADR 0012.
5. **Grill** the user on the items where classification is ambiguous. Use `grill-task`. Common ambiguities: typos in skill names, custom non-Jira task IDs, plaintext secrets in per-tool configs.
6. **Draft `TASK details {ID}.md`** for the migration with one subtask per inventoried item, organised by phase. Use `plan-task`.

#### Phase 1 — Init + adapter wiring

For each artifact that overlaps with canonical V1 paths:

```
INX/.taskRef/         → INX/.taskRef.bak/
INX/ai-mem/           → INX/ai-mem.bak/
INX/CLAUDE.md         → INX/CLAUDE.md.bak
INX/AGENTS.md         → INX/AGENTS.md.bak
INX/.github/copilot-instructions.md → INX/.github/copilot-instructions.md.bak
INX/.github/instructions/ → INX/.github/instructions.bak/
```

Then:

7. **`mv` each live artifact to its `.bak` sibling.** Verify with `diff -r` on a sample that backups are byte-identical to originals.
8. **Run `node init.js {target} --force`** with all needed tool adapters enabled (`claude`, `codex`, `github`). Use the new `--migrate-from {target}` flag if it's been built; otherwise the manual content migration in step 9 covers it.
9. **Manually migrate per-tool settings:**
   - `ai-mem.bak/claude/settings.local.json` → merge into `.tcgstackflow/tools/claude/settings.local.json` (preserve permission allow-lists and `enabledMcpjsonServers` entries).
   - `ai-mem.bak/codex/config.toml` → copy to `.tcgstackflow/tools/codex/config.toml`.
   - For GitHub: populate `.tcgstackflow/tools/github/copilot-instructions.md` with the project-specific workspace overview from `.github/copilot-instructions.md.bak`. **Critical: rewrite every path reference** — `.taskRef/` → `.tcgstackflow/tasks/`, `ai-mem/docsRef/` → `.tcgstackflow/wiki/`, `.docsRef/` → `.tcgstackflow/wiki/`. Copy each `.instructions.md` file (per-domain Copilot guidance) into `.tcgstackflow/tools/github/instructions/` with the same path rewrites. Then re-run init or manually copy from `tools/github/` to `.github/`.

#### Phase 2 — Tasks migration

10. **Identify the *truly* active task(s)** with the user. Don't assume the old `active/` folder reflects reality.
11. **`mv` actually-active task folders** to `.tcgstackflow/tasks/active/`. Unchanged content.
12. **`mv` stale "active" folders to `.tcgstackflow/tasks/archive/stale/`.** They were never finished; keep the two files intact for posterity.
13. **`mv` completed and pre-existing archived tasks** unchanged (`completed/{ID}/` and `archive/{category}/{ID}/`).
14. **`mv` `.weekly/` contents unchanged.**
15. **Port the old `README.md`'s Active/Completed/Archive tables** into `.tcgstackflow/tasks/README.md`, updating paths.
16. **Lift Tempo specifics** (cloudId, admin_key, timezone, work_start, daily_hours) from any `WEEKLY_TIMESHEET_INSTRUCTIONS.md.bak` into `.tcgstackflow/config.yaml` under `tempo:`. Set `tempo.enabled: true`. Archive the old detailed instructions file as `.tcgstackflow/tasks/.weekly-OLD-INSTRUCTIONS.md.bak` for reference.

#### Phase 3 — Wiki ingestion (Ingester role)

17. **For each subfolder of the old wiki/docs source** (e.g. `ai-mem.bak/docsRef/project/`, `architecture/`, `features/`, `notes/`), run `ingest` with that subfolder as the Raw input. One ingest per subfolder = one log entry. Follow log-first procedure (`wiki/log.md` entry drafted first; new pages and deletions gated).
18. **After all subfolder ingests, populate `wiki/domain.md`** with the project's ubiquitous language surfaced during ingests. Aliases (`_Avoid_:`) capture rejected synonyms.
19. **Run `lint-wiki`** to surface contradictions, orphan pages, missing cross-references that the ingests may have left behind. Resolve `blocker` findings before Phase 4.

#### Cross-cutting — Global tech-skill migration

20. **Identify tech skills** in the project-local skill library (any `*-best-practices`, `vue`, `pinia`, framework-specific skills, etc.). Move them to `~/.tcgstackflow/skills/`. Per ADR 0012, tech skills live globally; project-local is for workflow skills only.
21. **Verify and normalize odd skill names** before migration (typos like `vuetify0` or `vee-validate-skilld` should be renamed to canonical).

#### Phase 4 — Decommission

22. **Run `audit-workspace`** to check agent ↔ skill ↔ codebase coherence in the new structure. Resolve blocker findings.
23. **Run `lint-wiki`** again as a final wiki health check.
24. **Use the new workspace for ≥2 real coding sessions.** Each session works against `.tcgstackflow/` paths; the `.bak` artifacts should not be referenced. Any rough edges get logged in the migration task's `TASK {ID}.md` and either fixed in V1 templates (with a new ADR if architectural) or fixed in the project's `.tcgstackflow/` content.
25. **Delete `.bak` artifacts (CRITICAL).** Issue the permission request per `governance.md` — risk: CRITICAL, rollback: git revert of the deletion commit (assumes deletion is committed separately). User must explicitly approve. Approval string captured in the migration task's log via `governance:` field of the YAML entry.

### Output

Throughout: per-phase progress in the task log (YAML entries via `update-task-log`). Final summary in the task log when DECOM-3 completes. The migration task's status moves `PLANNED → IN_PROGRESS → IN_REVIEW → VALIDATED → INGESTED` along the standard lifecycle; the *meta*-ingest of the migration task itself into `wiki/log.md` happens after DECOM-3 succeeds.

### Anti-patterns

- **Skipping the `.bak` step.** Backups are how rollback works. No backups → no migration.
- **Coexistence.** Don't leave both old and new structures live in parallel. ADR 0004 explicitly rejected this — it becomes permanent.
- **Silent overwrites of per-tool configs.** The Copilot adapter migration in step 9 rewrites paths; show the user the diff for the project-specific section, not just "done."
- **Treating Phase 3 as a single ingest.** Each subfolder of the old wiki gets its own log entry. A single mega-ingest is unreadable in retrospect.
- **Skipping the 2-session validation in Phase 4.** Decommission too early and you discover gaps with no backup left.
- **Migrating skills wholesale into project-local.** Tech skills go global. Workflow skills stay project-local. ADR 0012.
- **Treating stale tasks as active.** Always ask the user which tasks they're actually working on. The folder's location lies.

## When this skill should propose a V1 patch

Per ADR 0013, migration is a frequent dogfood trigger. If during execution the canonical templates are insufficient (missing tool adapter, missing skill, missing config field), the Planner role of the migrating user is authorised to patch V1 inline — ADR 0013 is the canonical exception. Each V1 patch produced this way ships as a new ADR + template change in the geekstack-flow source repo.
