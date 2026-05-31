# No dotfiles inside `.tcgstackflow/`

`.tcgstackflow/` itself is dot-prefixed (it's tool-managed config, like `.github/`, `.vscode/`, `.claude/`). The leading dot makes the workspace folder hidden in Finder, Obsidian's vault picker, and many other UIs — that's intentional for the *outer* folder, and a non-hidden symlink (`tcgstackflow/`) exists for tools that need a visible path. **Inside** the workspace, however, dot-prefixed entries make the wiki/tasks/agents harder to browse in Obsidian and other graphical tools. V1 ships no dotfiles inside `.tcgstackflow/`.

## What this means concretely

- **`tasks/.weekly/` → `tasks/weekly/`** — generated weekly timesheets.
- **`raw/.archived/` → `raw/archived/`** — processed external Raw, kept for re-ingest.
- **`.migration-notes/` → `migration-notes/`** — temp output of `init --migrate-from`.
- **`.gitignore` is NOT inside `.tcgstackflow/`.** Instead, `init.js` writes a marked block (`# === Creative GeekStack Flow ===`) into the *project-root* `.gitignore`, appending if a root gitignore already exists. The block is idempotent (skipped on repeat init runs) and excludes Obsidian's volatile state inside the vault, the regeneratable `migration-notes/` folder, and (optionally) the non-hidden symlink.

## Why this matters

- **Obsidian's vault file tree hides dotfiles by default.** A `weekly/` folder is browsable; a `.weekly/` folder is invisible until the user enables "show attachments" or similar — easy to forget, costing trust in the navigation.
- **Macros, scripts, and globs over `.tcgstackflow/`** become awkward when some children are hidden and some aren't. Consistent visibility = simpler tooling.
- **The "tool-managed config" signal is carried by the outer folder, not by every leaf.** A teammate exploring the wiki shouldn't have to learn that `.weekly/` is internal but `weekly/` isn't — there's no such distinction in V1.

## Exception: Obsidian's own `.obsidian/`

Obsidian creates `.obsidian/` inside any opened vault for its own config (plugins, hotkeys, themes, workspace layout). This is **outside our control** — Obsidian's config folder name is fixed by the application. V1 accepts this single exception:

- The project-root `.gitignore` block targets the volatile subset (`workspace.json`, `workspace-mobile.json`, `cache`, `graph.json`).
- Everything else under `.obsidian/` (plugin configs, hotkeys, themes) stays trackable so teammates open the same vault with the same plugins enabled.

## Consequences

- All template paths updated: skill SKILL.md files, agent profiles (`ingester.md`), workspace docs (`tasks/README.md`, `tasks/WEEKLY_TIMESHEET_INSTRUCTIONS.md`, top-level workspace README), ADRs (0004, 0006), top-level README, CONTEXT.md.
- `init.js` writes/appends to project-root `.gitignore` with a marker block; the workspace itself ships no `.gitignore`.
- `init.js` skips `weekly/` (no dot) when auto-detecting sub-projects — a `weekly/` at workspace root is geekstack-flow's, not a code project.
- `.migration-notes/` references in the `--migrate-from` flow are now `migration-notes/` everywhere.
- Future templates and skills MUST NOT introduce new dot-prefixed entries inside `.tcgstackflow/`. The `audit-workspace` skill is updated (next minor release) to flag any that appear.
