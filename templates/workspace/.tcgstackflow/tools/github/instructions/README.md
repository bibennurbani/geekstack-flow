---
title: Per-Domain Copilot Instructions
priority: P1
updated: 2026-05-30
status: current
---

# Per-Domain Copilot Instructions

This folder holds narrow, per-area Copilot guidance — files that complement (not duplicate) the top-level `copilot-instructions.md` and the workflow skills in `.tcgstackflow/skills/`.

## How it works

- Each file is named `{domain}.instructions.md` — Copilot's auto-loading convention.
- The init script copies (or symlinks) each `*.instructions.md` file from here into `.github/instructions/` at the project root, where GitHub Copilot picks them up automatically.
- Per-domain instructions are project-specific — they encode the conventions of *this* codebase, not generic best practices. Generic tech guidance lives as a global skill at `~/.tcgstackflow/skills/`.

## Common domains (examples)

| File | Used for |
|---|---|
| `task-management.instructions.md` | Detailed task workflow conventions (often a fuller version of the top-level `copilot-instructions.md` Task Tracking section) |
| `spa-frontend.instructions.md` | Frontend project patterns — component structure, state management, styling conventions |
| `api-backend.instructions.md` | Backend service patterns — domain modelling, controllers, persistence |
| `cypress-testing.instructions.md` | Testing conventions specific to this project's E2E and component tests |
| `identity-api.instructions.md` | Auth/identity boundary conventions |

These are illustrative — populate the folder with files for whatever domains *your* codebase actually needs.

## Authoring guidelines

- One concern per file. If `spa-frontend.instructions.md` is over 300 lines, consider splitting (`spa-state.instructions.md`, `spa-routing.instructions.md`).
- Reference, don't duplicate. If a convention is already captured in a workflow skill or in `wiki/architecture.md`, link there rather than restating.
- Keep wikilinks updated if you move/rename pages (qmd indexing relies on stable paths).
- Each file should end with one explicit `Prime Directive` for the domain — the single most important rule a coder should remember when working in this area.

## Maintenance

When `wiki/architecture.md` or `wiki/domain.md` shifts in a way that affects what Copilot should know, the **ingester** agent updates the relevant `*.instructions.md` files in the same ingest. Per-domain instructions are downstream of the wiki — keep the dependency direction explicit.
