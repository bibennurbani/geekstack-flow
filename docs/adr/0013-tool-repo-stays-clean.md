# Tool repo stays clean; real use happens in target projects

The geekstack-flow repository contains the tool itself — `init.js`, `templates/`, `CONTEXT.md`, `docs/adr/`, `README.md` — and nothing else. **There is no `.tcgstackflow/` workspace inside this repo.** Real use of the tool happens in target projects' own `.tcgstackflow/` workspaces. When real use surfaces V1 gaps, the user patches geekstack-flow's templates and ADRs in the same session — different working directories, no special "dogfood" workflow required, no exception to any agent's `Writes:` list (because the patches happen outside any agent role).

## Why this matters

It would be natural to want to "dogfood" geekstack-flow by initialising a `.tcgstackflow/` workspace inside the tool repo and tracking tool development as tasks there. **That mixes two concerns** that should never share a repo:

| What belongs here (tool repo) | What does NOT belong |
|---|---|
| The tool (`init.js`) | A live `.tcgstackflow/` workspace inside this repo |
| Templates (`templates/`) | Tasks tracking work on downstream projects |
| Tool design docs (`CONTEXT.md`, `docs/adr/`, `README.md`) | Project-specific content from real-use sessions |
| Concept-level ADRs about how the flow works | Specific task IDs, project names, or migration plans |

ruflo, which inspired this project, keeps its repo clean for the same reason — it's a tool, not a project workspace.

## How real-use cycles work

1. The user `cd`s into the target project (e.g. an existing codebase needing geekstack-flow).
2. Runs `node /path/to/geekstack-flow/init.js .` to create `.tcgstackflow/` in that project.
3. Uses the agents and skills against that project's tasks and wiki.
4. If V1 templates are insufficient (a missing tool adapter, a missing skill, a missing config field), the user opens the geekstack-flow repo in the same session (Claude Code can address multiple working directories) and patches:
   - `templates/workspace/.tcgstackflow/` for workspace template changes
   - `templates/global/.tcgstackflow/` for global-memory or global-skill changes
   - `docs/adr/` for any decision worth recording
   - `init.js` for installer changes
5. Patches stay generic — no references to the specific target project's name, paths, or task IDs.
6. The target project's own `.tcgstackflow/tasks/active/` records the work that was done; the tool repo only carries the lessons learned in abstract form.

## Consequences

- The geekstack-flow repo never has tasks, wiki pages, raw sources, or per-project configs. If something has those, it's a downstream consumer, not the tool.
- Concept-level ADRs in this repo are written in generic language — "an existing project's structure showed X" rather than naming the specific project.
- Templates in `templates/workspace/` ship to all projects equally — no hardcoded project-specific examples.
- The `migrate-to-gsf` skill exists precisely so that *the migration pattern* lives in the tool, while *the migration's execution* lives in the target project. Same separation principle.
