---
name: tcgflow-upgrade
description: Run `init.js --upgrade` to migrate an existing pre-v0.2 .tcgstackflow/ workspace to the current layout. Use when the user types `/tcgflow-upgrade` or asks "upgrade this workspace", "migrate to no-dotfiles convention", "rename .weekly to weekly". Non-destructive — runs layout + `wiki_search` migrations, refreshes tool-owned commands/agents (backing up drift to `.bak`), additively adds new skills, and prints a **drift report** of the existing skills + tool adapters that differ from the new templates (review/merge those, or re-check with `geekstackflow drift`). Never overwrites your tasks, wiki, governance.md, config.yaml, existing skills, or tool adapters.
---

# `/tcgflow-upgrade` — in-place upgrade of an existing workspace

## When to use

The user typed `/tcgflow-upgrade` or said *"upgrade this workspace"*, *"migrate to the no-dotfiles convention"*, *"rename .weekly to weekly"*, *"get this project on the current layout"*. The current directory has an existing `.tcgstackflow/` workspace from a previous version.

## What to do

1. **Verify the target.** Confirm the working directory is the right one and `.tcgstackflow/` exists there. If not, route to `/tcgflow-init` for new workspaces or `/tcgflow-migrate` for moving off ad-hoc AI infra.

2. **Detect what needs upgrading.** Look for any of:
   - `.tcgstackflow/tasks/.weekly/`
   - `.tcgstackflow/raw/.archived/`
   - `.tcgstackflow/.migration-notes/`
   - `.tcgstackflow/.gitignore`
   - Missing `tcgstackflow → .tcgstackflow` symlink at project root
   - Project-root `.gitignore` missing the `# === Creative GeekStack Flow ===` block

   If none of these are true, tell the user the workspace is already current and stop.

3. **Run `geekstackflow init --upgrade .`** (or `node /path/to/init.js --upgrade .` as fallback). The script:
   - Renames `.weekly/` → `weekly/`, `.archived/` → `archived/`, `.migration-notes/` → `migration-notes/`
   - Removes `.tcgstackflow/.gitignore`, appends the marker block to project-root `.gitignore`
   - Creates the Obsidian symlink if missing
   - Leaves all user content (tasks, wiki, agents, skills, tool adapter overrides) **untouched**

4. **Report the changes** the script made — including the **drift report** it prints at the end: the existing skills and `tools/{claude,codex,github}/` adapters that differ from the new templates and were *not* auto-merged (these are the files to review). New skills not yet installed are flagged too.

5. **Bootstrap qmd wiki-search with a PROJECT-LOCAL index (ADR 0030 + 0038).** The schema-2→3 migration injects the `wiki_search` config block (ADR 0030); `init.js` the script does **not** install or run qmd. Once it has run: if qmd is absent, install it — `qmd --version`, else `npm install -g @tobilu/qmd` (a **HIGH action** per `governance.md` — global npm install + ~2 GB models, Node ≥ 22, `brew install sqlite` on macOS — permission request first). Then **create the project-local index and re-register into it** (ADR 0038 — this is the migration that fixes the global-collection collision where multiple geekstackflow projects fought over one global `wiki`):
   ```bash
   qmd init                                                   # create .qmd/ (gitignored) if absent
   qmd collection add .tcgstackflow/wiki --name wiki --mask "*.md"
   qmd context add qmd://wiki "Project knowledge wiki — architecture, domain, features, decisions, operations"
   # + a docs / docs-<subproject> collection per docs/ dir (see /tcgflow-init)
   qmd embed                                                  # re-embed into the local index
   ```
   Run `geekstackflow doctor` afterwards to confirm each declared collection now resolves to **this** project's path (not another project's).

6. **Offer two follow-up steps** (don't auto-run unless the user asks):

   a. **Refresh global slash commands** — useful to pick up new commands and path corrections in older ones:
      ```bash
      cp -R /path/to/geekstack-flow/templates/claude-commands/* ~/.claude/skills/
      ```
      Then restart any other open Claude Code session so it sees the refreshed skills.

   b. **Merge drifted skills + tool adapters** — the drift report (from step 4, or re-run `geekstackflow drift .` anytime) lists exactly which existing skills and `.tcgstackflow/tools/{claude,codex,github}/` files differ from the new templates. Diff and merge those (the report prints a ready-to-use `diff` example). **NOT via `--force`** — that resets agents/skills templates the user may have customised. The drift check normalises the `{{project-name}}` placeholder and ignores below-marker overrides, so it only flags genuine upstream differences.

## Anti-patterns

- **Running on a directory with no `.tcgstackflow/`.** `--upgrade` is for existing workspaces; route to `/tcgflow-init` for new ones.
- **Suggesting `--force` for tool adapter refresh.** `--force` is destructive; it resets agents and skills too. Manual merge is safer.
- **Treating "no changes needed" as a failure.** A workspace already on the current layout is a successful no-op; just say so.
- **Modifying user content during upgrade.** The script is non-destructive by design; if it ever needs to touch task/wiki content, that's a breaking change and warrants a different command name.

## Notes

- The `.gitignore` block insertion is idempotent — the marker `# === Creative GeekStack Flow ===` is checked before appending, so re-running `/tcgflow-upgrade` on a partially-upgraded workspace doesn't duplicate it.
- For multi-project workspaces, the upgrade runs once at the workspace root — the `projects:` array in `config.yaml` and per-project tool adapters are not affected by the dotfile renames.
- If both old and new folders exist (e.g. `tasks/.weekly/` AND `tasks/weekly/`), the script leaves them alone and tells the user to reconcile manually — this protects against silently merging unrelated content.

## See also

- ADR 0017 — no dotfiles inside `.tcgstackflow/` convention.
- CHANGELOG `[Unreleased]` → Migration section.
