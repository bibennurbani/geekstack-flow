---
title: Creative GeekStack Flow — Workspace
priority: P0
status: current
---

# `.tcgstackflow/` — The AI workflow workspace for this project

This folder is the project's AI workflow workspace. Any AI coding tool (Claude Code, Codex, GitHub Copilot, Antigravity) that has been adapted to this project reads from here. **Do not edit files under `tools/`** — those are generated.

## Quick orientation

| Folder | What lives here | Who writes it |
|---|---|---|
| `wiki/` | The LLM-wiki — distilled project knowledge in flat Obsidian-style Markdown. The AI's primary context source. | AI maintains; user reviews. |
| `tasks/` | Task tracking. Each task is exactly two files: `TASK {ID}.md` (log) + `TASK details {ID}.md` (plan). Lifecycle is `active/ → completed/ → archive/`. | AI maintains during work; user starts tasks. |
| `raw/` | Staging for external files dropped in for ingestion (PDFs, exported docs, screenshots). Files move to `raw/archived/` after ingest. | User drops in; AI moves to archive. |
| `prompts/{task-id}/` | Cross-tool handoff prompts. Claude writes a prompt; user pastes it into another AI tool. | AI writes; user moves to other tools. |
| `agents/` | Six role profiles: `planner`, `coder`, `reviewer`, `tester`, `ingester`, `refactorer`. Tool-agnostic Markdown. | Co-evolved with the project. |
| `skills/` | Atomic capabilities in Claude Code `SKILL.md` format. Drop-in compatible with mattpocock-style skills. | Templates updated; project may add custom. |
| `commands/` | Eighteen tool-portable `tcgflow-*` workflow commands (thin dispatchers onto skills/agents). | Generated/refreshed by init; do not hand-edit. |
| `runs/` | Immutable Orchestrator run records — one `runs/{task-id}/{run-id}.md` per orchestrated run, with token/session frontmatter (schema 4). | The Cockpit Orchestrator writes; never edited. |
| `tools/` | **Generated** per-tool adapters. Do not edit. | The init/sync script generates. |
| `governance.md` | Risk levels, permission-request recipe, and project-specific rules. | User edits the project-specific section. |
| `config.yaml` | Project config — stack, Tempo settings, submission mode, tool flags. | User edits during init and as the project evolves. |

## How a session typically flows

1. **Start a task** — invoke the `planner` agent with a ticket ID or idea. It grills you on gaps, then writes `tasks/active/{ID}/TASK details {ID}.md`. Status is `PLANNED`.
2. **Code** — invoke the `coder` agent. It works from the details file, appending YAML entries to `TASK {ID}.md` after each meaningful change.
3. **Review** — invoke the `reviewer` agent. It walks the diff against `governance.md` and acceptance criteria. Flags HIGH/CRITICAL actions.
4. **Test** — invoke the `tester` agent. It builds a test plan from the acceptance criteria, runs unit/E2E/app verification, and records a pass/fail verdict (`IN_TEST → VALIDATED`; fail returns to the Coder).
5. **Ingest** — when the task is done, invoke the `ingester` agent. It folds the task into the wiki: updates relevant pages, appends to `wiki/log.md`, moves the task folder to `completed/`.
6. **Weekly** — invoke `generate-timesheet` and (after review) `submit-timesheet` for Tempo.

## The Cockpit (local UI)

Run `geekstackflow ui` to launch the **Cockpit/Orchestrator** at `http://127.0.0.1:4729` — a local UI over all registered workspaces. It reads this folder, launches agent runs against tasks (writing immutable records to `runs/`), shows a Runs history, streams live output, gates HIGH/CRITICAL actions through approval cards, and renders a per-task **Session Report** with $-cost estimates (ADR 0034). Its Settings tab writes `orchestrator.roles` and an optional `budget_usd` into `config.yaml`.

## Global memory

Cross-project preferences live at `~/.tcgstackflow/memory/` and are referenced from each AI tool's global config. Local wiki always wins on conflict.

## Obsidian vault

This whole `.tcgstackflow/` folder is designed as an **Obsidian vault**. Open it in Obsidian to get:

- Graph view of the LLM-wiki (pages + `[[wikilinks]]`)
- Readable agent profiles, governance, skills documentation
- Browsable task folders with their two-file pairs
- The append-only `wiki/log.md` as a timeline

A `# === Creative GeekStack Flow ===` block in the **project-root `.gitignore`** (added by `init.js`) excludes Obsidian's volatile state files (`workspace.json`, `graph.json`, etc.) while keeping shared config (plugins, hotkeys, themes) trackable. The `.tcgstackflow/` folder itself ships no dotfiles — see ADR 0017.

**Important — Obsidian doesn't show dotfiles in its vault picker.** Use one of these:

- **Open the symlink** at the project root: `tcgstackflow/` (created by `init.js` by default — points at `.tcgstackflow/`). Visible in any file picker. *Recommended.*
- **Manually create the symlink** if init didn't (or you said no to the prompt):
  ```bash
  cd <project-root>
  ln -s .tcgstackflow tcgstackflow
  # Windows: mklink /D tcgstackflow .tcgstackflow   (from elevated cmd)
  ```
- **Show hidden in the picker.** On macOS, in the Obsidian "Open folder as vault" dialog, press `Cmd+Shift+.` to toggle hidden-folder visibility, then select `.tcgstackflow/`.

After opening, the first-run prompt asks to trust authors — say yes.

If you prefer a tighter scope (wiki only, no tasks/agents/skills in the graph), open `.tcgstackflow/wiki/` (or `tcgstackflow/wiki/` via the symlink) instead — but you lose the ability to navigate to task files and agent profiles from inside Obsidian.

## Reference

The wiki pattern is based on Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Search and re-rank is provided by [qmd](https://github.com/tobi/qmd), wired as an MCP if you've enabled it.
