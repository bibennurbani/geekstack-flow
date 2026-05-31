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

6. **Suggest the next move:** invoke `/tcgflow-plan` for a first task (commonly a scan-and-populate task to fill `wiki/project-overview.md` and `wiki/architecture.md` from the codebase).

## Notes

- Single-project workspaces stay as `workspace_kind: single`; multi-project is detected automatically.
- The user's global `~/.tcgstackflow/` is initialised on first run only; subsequent runs don't touch it.
- After init, the agents and skills are ready; the wiki starter pages are stubs to be filled by the first ingest.
