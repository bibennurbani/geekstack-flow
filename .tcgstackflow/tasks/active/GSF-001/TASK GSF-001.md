# TASK GSF-001 — Migrate INX to Creative GeekStack Flow

Last updated: 2026-05-31
Status: PLANNED

## Overview

First real-use migration of an existing project (INX) onto the Creative GeekStack Flow V1 workspace structure. Clean cutover with `.bak` backups; phased across init/adapter-wiring → task migration → wiki ingestion → decommission; plus a cross-cutting move of 11 tech skills from project-local to `~/.tcgstackflow/skills/` global.

## Key Requirements

- Backup all six existing AI-infrastructure artifacts in INX before any rename or write
- Run `init.js` to populate `INX/.tcgstackflow/` and the three root-level tool adapter files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` + `.github/instructions/`)
- Migrate per-tool settings (Claude permissions/MCP, Codex MCP)
- Populate the new GitHub Copilot adapter with INX-specific workspace overview and prime directives, with all path references updated from `.taskRef/`/`.docsRef/` to `.tcgstackflow/tasks/`/`.tcgstackflow/wiki/`
- Move 1 active task (ES-6965) to the new `tasks/active/`
- Archive 19 stale "active" tasks under `tasks/archive/stale/`
- Migrate completed and pre-existing archived tasks unchanged
- Lift Tempo configuration from INX's `WEEKLY_TIMESHEET_INSTRUCTIONS.md` into `config.yaml`
- Ingest `ai-mem.bak/docsRef/` into the new flat wiki, log-first, with the new-page approval gate
- Populate `wiki/domain.md` with INX domain terms
- Move 11 tech skills (vue, pinia, cypress-author, etc.) to `~/.tcgstackflow/skills/` per ADR 0012
- Use the new workspace for 2+ real coding sessions before deleting backups
- Delete backups only after explicit user approval (CRITICAL action, recorded in this log)

## Stack/Technologies

Cross-cutting. INX itself spans .NET 10 + Marten event sourcing + PostgreSQL + Vue 3 + Vuetify 3 + Pulumi + Auth0; this task does not touch application code, only the AI-workflow scaffolding.

## Key Files

Backup targets (live → `.bak`):
- `INX/.taskRef/` → `INX/.taskRef.bak/`
- `INX/ai-mem/` → `INX/ai-mem.bak/`
- `INX/CLAUDE.md` → `INX/CLAUDE.md.bak`
- `INX/AGENTS.md` → `INX/AGENTS.md.bak`
- `INX/.github/copilot-instructions.md` → `INX/.github/copilot-instructions.md.bak`
- `INX/.github/instructions/` → `INX/.github/instructions.bak/`

Migration destinations:
- `INX/.tcgstackflow/` (workspace)
- `~/.tcgstackflow/skills/` (global tech-skill library)

## Implementation Log

_(Append YAML entries here via the `update-task-log` skill as the Coder works through the subtasks.)_
