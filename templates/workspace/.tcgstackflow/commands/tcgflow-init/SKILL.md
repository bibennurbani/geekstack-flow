---
name: tcgflow-init
description: Initialize Creative GeekStack Flow workspace in the current directory. Use when the user types `/tcgflow-init` or asks to set up geekstackflow, .tcgstackflow, or the AI workflow in this project. Runs the init.js installer with auto-detection of sub-projects (multi-project support is automatic when 2+ codebases are found at top level).
---

# `/tcgflow-init` — bootstrap the workspace

## When to use

The user typed `/tcgflow-init` or said something equivalent: *"set up geekstackflow here"*, *"initialise the AI workflow"*, *"create the .tcgstackflow"*. The current working directory is the target.

## What to do

1. **Check for prior AI infrastructure** that would conflict. Look for any of: `.tcgstackflow/`, `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.taskRef/`, `ai-mem/`, `.docsRef/`. If found, **do not run init** — route the user to `/tcgflow-migrate` instead, because the right path is a clean cutover with backups, not init alongside an existing setup.

2. **Confirm the target directory.** Verify the current working directory is where the user wants the workspace. If ambiguous, ask.

3. **Walk the user through the prompts in chat first** (don't trust interactive `readline` to compose with tool-use). Collect:
   - Project name (default: directory basename)
   - Primary stack (e.g. "Next.js 16 + Prisma") — leave blank for multi-project workspaces; auto-detection populates `projects[]`
   - Package manager (pnpm/npm/yarn/bun)
   - Enable Tempo? If yes, capture Atlassian `cloudId`, quarterly admin key, timezone offset, submission mode (default `approval`)
   - Enable Claude Code adapter? (default Y)
   - Enable Codex adapter? (default N)
   - Enable GitHub Copilot adapter? (default N)

4. **Run `geekstackflow init .`** (or `tcgflow init .`, same binary) in the target directory. If `geekstackflow` is not on PATH, fall back to `node <repo-path>/init.js .`. If the user installed via npm:
   ```bash
   geekstackflow init .
   ```

5. **Report what was created** — `.tcgstackflow/`, the root adapter files, and (for multi-project) the auto-detected `projects:` array.

6. **Bootstrap qmd wiki-search** (realizes the `wiki_search` config block `init.js` scaffolds — ADR 0030; `init.js` the *script* stays dependency-free and does **not** install qmd):
   - **Ensure qmd is installed.** Run `qmd --version`. If missing, install it — `npm install -g @tobilu/qmd`. This is a **HIGH action** per `governance.md` (global npm install + ~2 GB of local models): issue a permission request first. Needs Node ≥ 22, ~2 GB disk for models, and `brew install sqlite` on macOS.
   - **Register collections + set a retrieval context per collection** (the `--mask` and `context` values come from config.yaml's `wiki_search` block). The `wiki` collection is mandatory:
     ```bash
     qmd collection add .tcgstackflow/wiki --name wiki --mask "*.md"
     qmd context add qmd://wiki "Project knowledge wiki — architecture, domain glossary, features, decisions (ADRs), operations"
     ```
     Add the `docs` collection + context too when a `docs/` directory exists — per sub-project `docs/` in a multi-project workspace:
     ```bash
     qmd collection add docs --name docs --mask "*.md"
     qmd context add qmd://docs "In-repo developer docs (READMEs, guides, /docs)"
     ```
   - **Run the first embed and confirm.** `qmd embed` so the collections are indexed and the `wiki-search` skill works on first use, then `qmd status` to confirm the collections registered and embedded.

7. **Suggest the next move:** invoke `/tcgflow-plan` for a first task (commonly a scan-and-populate task to fill `wiki/project-overview.md` and `wiki/architecture.md` from the codebase).

## Notes

- Single-project workspaces stay as `workspace_kind: single`; multi-project is detected automatically.
- The user's global `~/.tcgstackflow/` is initialised on first run only; subsequent runs don't touch it.
- After init, the agents and skills are ready; the wiki starter pages are stubs to be filled by the first ingest.
