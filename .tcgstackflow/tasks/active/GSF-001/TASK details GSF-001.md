# TASK details GSF-001 — Migrate INX to Creative GeekStack Flow

Status: PLANNED
Owner: biben
Author of plan: claude (planner role)
Planned date: 2026-05-31

## Overview

Migrate the INX workspace (`/Users/biben/Documents/INX/`) from its current ad-hoc AI infrastructure (`.taskRef/`, `ai-mem/{docsRef,claude,codex,github,continue,agents,idea,taskRef}/`, root `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/`) onto the canonical Creative GeekStack Flow V1 structure (`.tcgstackflow/`). This is the first real test of geekstack-flow V1 and the dogfood loop that pressures-tests V1's agent profiles, skills, and templates against a real codebase. Approach is a **clean cutover with `.bak` backups** (ADR 0001-style scope, ADR 0004-style canonical structure) — coexistence was rejected because INX's existing duplication (`.taskRef/` ↔ `ai-mem/taskRef/`) demonstrates exactly how coexistence drifts.

## Context

- INX has been the author's primary working environment for months; its conventions inform much of V1's design (two-file task rule, YAML log entries, sugar-coated Tempo descriptions, per-tool config folders). It is also where the *accidental* patterns live (the `ai-mem/taskRef/` duplicate, the misplaced JetBrains `ai-mem/idea/`, per-tool `skills/` duplication across claude/codex/github/continue/agents/, the unused `ai-mem/continue/` folder).
- ADRs touched by this task: [[../../../docs/adr/0001]] scope, [[../../../docs/adr/0004]] task layout, [[../../../docs/adr/0005]] skill/agent/adapter model, [[../../../docs/adr/0006]] ingest log format, [[../../../docs/adr/0008]] governance, [[../../../docs/adr/0009]] global memory, [[../../../docs/adr/0010]] timesheet, [[../../../docs/adr/0011]] V1 skill set, [[../../../docs/adr/0012]] Copilot adapter + skill-library boundary (authored in this same session as a V1 upgrade triggered by inventory findings).
- Decision capture: the migration plan is built from three resolved grill questions in the same session — (Q1) clean cutover with backups; (Q2) per-tool folder fate, six specific decisions confirmed (see ADR 0012); (Q3) handle one truly-active task (ES-6965) plus archive 19 stale active tasks.

## Stack/Technologies

Cross-cutting; the migration affects file paths and configuration, not application code in INX. The INX codebase itself (Vue 3 + Vuetify 3 SPAs, .NET 10 + Marten APIs, Pulumi IaC, Auth0) is read-only ground truth for the wiki ingestion phase.

## Key Files

Backup targets (live → `.bak`):
- `INX/.taskRef/` → `INX/.taskRef.bak/`
- `INX/ai-mem/` → `INX/ai-mem.bak/`
- `INX/CLAUDE.md` → `INX/CLAUDE.md.bak`
- `INX/AGENTS.md` → `INX/AGENTS.md.bak`
- `INX/.github/copilot-instructions.md` → `INX/.github/copilot-instructions.md.bak`
- `INX/.github/instructions/` → `INX/.github/instructions.bak/`

Destinations:
- `INX/.tcgstackflow/` (new canonical workspace)
- `~/.tcgstackflow/skills/` (global tech-skill library; receives 11 skills from `ai-mem.bak/agents/skills/`)

## Risk

- **MEDIUM** — Phases 1–3 perform file moves, config edits, and wiki ingestion. All reversible via the `.bak` artifacts.
- **CRITICAL** — Phase 4 (`GSF-001-DECOM-3`) deletes the `.bak` artifacts. Irreversible. Requires explicit recorded approval per `governance.md` and a rollback plan that depends on git history of the `.bak` deletion commit.
- **MEDIUM** — Wiki ingestion (Phase 3) may propose new wiki pages and renamings — governance new-page/deletion gate (ADR 0007) applies. Each new page requires approval.

## Subtasks

### Phase 1 — Init + adapter wiring

- **GSF-001-INIT-1** — Back up existing INX AI infrastructure — Todo — S
  - **Acceptance:** All six `.bak` paths above exist and are byte-identical to the originals (verify with `diff -r` on a sample). Originals removed only after `.bak` verified.
  - **Files:** `INX/.taskRef.bak`, `INX/ai-mem.bak`, `INX/CLAUDE.md.bak`, `INX/AGENTS.md.bak`, `INX/.github/copilot-instructions.md.bak`, `INX/.github/instructions.bak`

- **GSF-001-INIT-2** — Run `init.js` on INX with claude+codex+github enabled — Todo — S
  - **Acceptance:** `INX/.tcgstackflow/` exists with full V1 structure. `INX/CLAUDE.md`, `INX/AGENTS.md`, `INX/.github/copilot-instructions.md`, `INX/.github/instructions/*.instructions.md` present at root (from the V1 templates). `config.yaml` flags `tools.claude: true, tools.codex: true, tools.github: true`. Project name = "INX Environmental Sampling Platform".
  - **Files:** `INX/.tcgstackflow/**`, `INX/CLAUDE.md`, `INX/AGENTS.md`, `INX/.github/copilot-instructions.md`, `INX/.github/instructions/`

- **GSF-001-INIT-3** — Migrate per-tool settings — Todo — S
  - **Acceptance:** Claude permissions and MCP entries from `ai-mem.bak/claude/settings.local.json` carried into `INX/.tcgstackflow/tools/claude/settings.local.json` (no Bash permissions dropped, `inx-postgres` MCP preserved). Codex MCP from `ai-mem.bak/codex/config.toml` copied to `INX/.tcgstackflow/tools/codex/config.toml`.
  - **Files:** `INX/.tcgstackflow/tools/claude/settings.local.json`, `INX/.tcgstackflow/tools/codex/config.toml`

- **GSF-001-INIT-4** — Populate Copilot adapter with INX-specific content — Todo — M
  - **Acceptance:** `INX/.tcgstackflow/tools/github/copilot-instructions.md` reflects INX's actual workspace overview (7-project table, prime directives) ported from `.github/copilot-instructions.md.bak`, **with all `.taskRef/` paths rewritten to `.tcgstackflow/tasks/` and all `.docsRef/` paths to `.tcgstackflow/wiki/`**. All 6 `.instructions.md` files (task-management, spa-frontend, cypress-testing, home-identity-spa, identity-api, api-backend) copied into `INX/.tcgstackflow/tools/github/instructions/` with the same path rewrites applied. Files at `INX/.github/` match (the live ones Copilot reads).
  - **Files:** `INX/.tcgstackflow/tools/github/copilot-instructions.md`, `INX/.tcgstackflow/tools/github/instructions/*.instructions.md`, `INX/.github/copilot-instructions.md`, `INX/.github/instructions/*.instructions.md`

### Phase 2 — Tasks migration

- **GSF-001-TASKS-1** — Move the one truly-active task (ES-6965) — Todo — S
  - **Acceptance:** `INX/.tcgstackflow/tasks/active/ES-6965/` contains `TASK ES-6965.md` and `TASK details ES-6965.md`, byte-identical to `.taskRef.bak/active/ES-6965/`.
  - **Files:** `INX/.tcgstackflow/tasks/active/ES-6965/`

- **GSF-001-TASKS-2** — Move 19 stale "active" folders to archive/stale — Todo — S
  - **Acceptance:** All folders in `.taskRef.bak/active/` *except* `ES-6965` (i.e. `AI_INSIGHT`, `CypressTestFix`, `ES-5884`, `ES-6776`, `ES-6777`, `ES-6900`, `ES-6901`, `ES-6912`, `ES-6921`, `ES-6927`, `ES-6928`, `ES-6947`, `ES-6951`, `ES-6952`, `ES-6962`, `ES-6968`, `ES-6969`, `ES-6970`) live under `INX/.tcgstackflow/tasks/archive/stale/`. Each task folder preserves its two-file contents unchanged.
  - **Files:** `INX/.tcgstackflow/tasks/archive/stale/`

- **GSF-001-TASKS-3** — Move recently completed tasks — Todo — S
  - **Acceptance:** `ES-6834` and `ES-6837` folders moved from `.taskRef.bak/completed/` to `INX/.tcgstackflow/tasks/completed/`.
  - **Files:** `INX/.tcgstackflow/tasks/completed/`

- **GSF-001-TASKS-4** — Move archive categories — Todo — S
  - **Acceptance:** `scheduler/`, `ag-grid/`, `misc/` subfolders moved from `.taskRef.bak/archive/` to `INX/.tcgstackflow/tasks/archive/`. The new `archive/stale/` from GSF-001-TASKS-2 coexists alongside them.
  - **Files:** `INX/.tcgstackflow/tasks/archive/{scheduler,ag-grid,misc}/`

- **GSF-001-TASKS-5** — Move `.weekly/` timesheets — Todo — S
  - **Acceptance:** All files in `.taskRef.bak/.weekly/` moved into `INX/.tcgstackflow/tasks/.weekly/` unchanged.
  - **Files:** `INX/.tcgstackflow/tasks/.weekly/`

- **GSF-001-TASKS-6** — Port `.taskRef/README.md` content — Todo — M
  - **Acceptance:** `INX/.tcgstackflow/tasks/README.md` Active table has one row for ES-6965 with its real description and a link to `active/ES-6965/`. Recently Completed table has rows for ES-6834 and ES-6837. Archive table has rows for `scheduler`, `ag-grid`, `misc`, and the new `stale` category. The 19 stale tasks appear in `archive/stale/`'s row, not in Active.
  - **Files:** `INX/.tcgstackflow/tasks/README.md`

- **GSF-001-TASKS-7** — Lift Tempo specifics into `config.yaml` — Todo — S
  - **Acceptance:** `INX/.tcgstackflow/config.yaml` `tempo:` section populated with `enabled: true`, `cloudId: "9e2bd083-d1ed-490d-9206-bebb7f899881"`, `admin_key: "ADMIN-86"`, `timezone: "+0800"`, `work_start: "07:00"`. INX's old `WEEKLY_TIMESHEET_INSTRUCTIONS.md` content archived to `.tcgstackflow/tasks/.weekly-OLD-INSTRUCTIONS.md.bak` (preserves reference data; not used by skills).
  - **Files:** `INX/.tcgstackflow/config.yaml`, `INX/.tcgstackflow/tasks/.weekly-OLD-INSTRUCTIONS.md.bak`

### Phase 3 — Wiki ingestion

- **GSF-001-WIKI-1** — Ingest `ai-mem.bak/docsRef/project/` into the wiki — Todo — M
  - **Acceptance:** Single `## [YYYY-MM-DD] ingest | INX project structure & codebase exploration` entry in `wiki/log.md`. `wiki/project-overview.md` populated from `ProjectStructure-EnvironmentSampling.md`. `wiki/architecture.md` populated from `codebase-exploration.md`. New pages proposed for any sub-area that doesn't fit (approval gate per ADR 0007).
  - **Files:** `INX/.tcgstackflow/wiki/log.md`, `INX/.tcgstackflow/wiki/project-overview.md`, `INX/.tcgstackflow/wiki/architecture.md`, possibly new pages

- **GSF-001-WIKI-2** — Ingest `ai-mem.bak/docsRef/architecture/` — Todo — M
  - **Acceptance:** Log entry; per-feature architecture pages created (e.g. `wiki/scheduler.md`) where the source justifies a dedicated page. Each new page approved per ADR 0007 gate.
  - **Files:** `INX/.tcgstackflow/wiki/log.md`, new `wiki/*.md` pages

- **GSF-001-WIKI-3** — Ingest `ai-mem.bak/docsRef/features/` — Todo — M
  - **Acceptance:** Log entry; per-feature wiki pages created (e.g. `wiki/exceedance-rca.md`, `wiki/ai-feature-suggestions.md`). Each new page approved.
  - **Files:** `INX/.tcgstackflow/wiki/log.md`, new `wiki/*.md` pages

- **GSF-001-WIKI-4** — Ingest `ai-mem.bak/docsRef/notes/` — Todo — S
  - **Acceptance:** Log entry; troubleshooting and exploration notes folded into the most-relevant existing pages, or new pages if a topic justifies it.
  - **Files:** `INX/.tcgstackflow/wiki/log.md`, updated wiki pages

- **GSF-001-WIKI-5** — Populate `wiki/domain.md` with INX domain terms — Todo — M
  - **Acceptance:** `wiki/domain.md` includes entries for the core INX domain language surfaced during the previous ingests: at minimum "Monitoring Program", "Schedule", "Exceedance", "Site", "Outlier", "Sample" — with one-sentence definitions and `_Avoid_:` aliases where the codebase or docs use inconsistent terminology.
  - **Files:** `INX/.tcgstackflow/wiki/domain.md`

### Cross-cutting — Global tech-skill migration

- **GSF-001-GLOBAL-1** — Move 11 tech skills to `~/.tcgstackflow/skills/` — Todo — S
  - **Acceptance:** All folders under `ai-mem.bak/agents/skills/` (`auth0-vue/`, `vee-validate-skilld/`, `dotnet-best-practices/`, `vue/`, `pulumi-best-practices/`, `pinia/`, `vue-router-best-practices/`, `auth0-aspnetcore-api/`, `cypress-author/`, `vuetify0/`) exist under `~/.tcgstackflow/skills/` with their `SKILL.md` + `references/` + any subskill files intact. Per ADR 0012, they are global, not project-local.
  - **Files:** `~/.tcgstackflow/skills/{name}/`

- **GSF-001-GLOBAL-2** — Confirm/normalize odd skill names — Todo — S
  - **Acceptance:** User confirms whether `vuetify0` (likely typo of `vuetify`) and `vee-validate-skilld` (likely typo of `vee-validate`) are intentional. If typos, renamed to canonical names and any internal `name:` frontmatter updated to match.
  - **Files:** `~/.tcgstackflow/skills/{vuetify,vee-validate}/SKILL.md`

### Phase 4 — Decommission

- **GSF-001-DECOM-1** — Run `lint-wiki` on the new INX wiki — Todo — S
  - **Acceptance:** Lint runs cleanly, producing a `## [YYYY-MM-DD] lint | full-wiki` entry in `wiki/log.md`. Any blocker findings (broken wikilinks, orphan pages, contradictions) addressed with follow-up ingests *before* moving to DECOM-3.
  - **Files:** `INX/.tcgstackflow/wiki/log.md`

- **GSF-001-DECOM-2** — Use INX with the new structure for 2+ real coding sessions — Todo — L
  - **Acceptance:** At least two separate sessions performed (work on ES-6965 or a new task) where the new `.tcgstackflow/` was the operating surface, not the `.bak` paths. Any rough edges encountered are logged in this task's TASK file as YAML entries and either (a) fixed in V1 templates (with a new ADR if architectural) or (b) fixed in INX's `.tcgstackflow/` project-specific content.
  - **Files:** `INX/.tcgstackflow/tasks/active/ES-6965/TASK ES-6965.md` (or other), `templates/workspace/` patches as needed

- **GSF-001-DECOM-3** — Delete `.bak` artifacts (CRITICAL) — Todo — S
  - **Acceptance:** All six `.bak` artifacts removed from INX. **Permission request recorded in this task's log** before deletion, with rollback plan ("rollback = `git revert` of the deletion commit, assuming we commit before deleting"). User explicitly approved.
  - **Files:** removal of `INX/.taskRef.bak`, `INX/ai-mem.bak`, `INX/CLAUDE.md.bak`, `INX/AGENTS.md.bak`, `INX/.github/copilot-instructions.md.bak`, `INX/.github/instructions.bak`

## Open Questions

1. **`vuetify0` / `vee-validate-skilld` — typos or intentional?** Both look like off-by-one or trailing-character mistakes. Resolved via `GSF-001-GLOBAL-2`; needs a quick user check before that subtask completes.
2. **INX-specific Copilot per-domain file naming:** keep INX's existing names (`spa-frontend.instructions.md`, `api-backend.instructions.md`, `home-identity-spa.instructions.md`, `identity-api.instructions.md`, `cypress-testing.instructions.md`, `task-management.instructions.md`) verbatim, or normalise? *Default: keep verbatim — they're already specific and meaningful.* User can override during GSF-001-INIT-4.
3. **MCP `inx-postgres` connection string contains a plaintext password** (`Password12!`). That's a HIGH-risk artifact today. Migrating it forward as-is preserves the workflow but propagates the secret. *Default: migrate as-is; surface as a Project-Specific Rule in `governance.md` post-migration.* User to decide if a separate secret-rotation task should be opened.

## Hand-off

Hand to the **Coder** when:

- [ ] User confirms this details file matches intent
- [ ] Open questions 1 and 2 acknowledged (item 1 can resolve mid-task at GSF-001-GLOBAL-2; item 3 captured for post-migration follow-up)
- [ ] Status set to `PLANNED` (already set above)
- [ ] Row added to `.tcgstackflow/tasks/README.md` (will be done after user approves this plan)
