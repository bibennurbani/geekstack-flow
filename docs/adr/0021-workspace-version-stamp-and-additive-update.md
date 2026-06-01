# Workspace version stamp + additive, never-clobber update

The Cockpit's "detect version and update" feature needs a primitive the system lacks: a version stamp inside each workspace. Until now, `upgrade` *sniffed* layout (saw `.weekly/`, inferred "pre-v0.2"). That doesn't scale. Phase 2 adds an explicit stamp and a customization-safe update model.

## Version scheme (two numbers, two purposes)

Each workspace's `config.yaml` carries:
- **`tcgflow_version`** — the tool semver that last touched this workspace (e.g. `"0.1.0"`). Informational; shown in the Cockpit.
- **`workspace_schema`** — an integer that bumps **only when the workspace layout changes**. The dotfile rename (`.weekly/` → `weekly/` etc., ADR 0017) is schema 1 → 2. `upgrade` runs migrations keyed off this integer, applying each step from the project's current schema up to the installed tool's latest. Decoupled from tool semver because most releases don't change layout.

## Three version layers (and what we act on)

1. **Installed tool version** — the geekstackflow package on the machine (its `templates/` define "latest").
2. **Workspace version** — what a project's `.tcgstackflow/` was last upgraded to (`workspace_schema` + `tcgflow_version`).
3. **Latest published tool version** — newer geekstackflow on npm.

Phase 2 acts on **1 ↔ 2**: the Cockpit compares each project's workspace version against the *installed* tool and offers per-project update. **Layer 3 (tool self-update — the Cockpit running `npm update -g geekstackflow`) is deferred** — updating the tool itself stays a manual step; it crosses a bigger trust boundary (global package install) than a per-project workspace migration.

## Update semantics: additive, never-clobber

"Update" touches three classes of unit, and **never overwrites a file the project already has**:

- **Layout** — schema migrations (folder renames, gitignore block, symlink). Safe, structural.
- **Skills, commands** — add any shipped skill/command **absent** from the project (e.g. pulls in the `task-from-*` skills and `tcgflow-*` commands a pre-existing project lacks). Files that already exist are **never** overwritten.
- **MCP config** — add newly-recommended MCP entries to `config.yaml`'s `mcp.recommended`/`optional` lists that aren't already present.

For shipped files that **exist but have drifted** from the installed tool's template, the Cockpit shows a **read-only diff** and lets the human merge manually. Auto-merge is never attempted — customization (project-specific `governance.md` rules, edited agent profiles, custom skills) is sacred.

Rejected: **full-sync** (overwrite-to-latest with three-way merge) — too easy to clobber a customization; the additive model delivers new capability without that risk.

### Amendment (2026-06): tool-owned files are refreshed, not just reported

Experience showed the pure never-clobber rule has a sharp edge: a **bug fix to a shipped `tcgflow-*` command** (e.g. tightening the Planner's Jira-fetch rule so it stops fabricating ticket context) never reached existing projects — `upgrade` only reported the drift as a diff and waited for a manual merge that rarely happened. So `upgrade` now **refreshes tool-owned product surface to the installed template**, distinguishing two classes of shipped file:

- **Tool-owned (refresh, with backup):** the `tcgflow-*` slash commands (in `.tcgstackflow/commands/` and the installed copies under `~/.claude/skills/`) and the shipped **agent profiles** (`.tcgstackflow/agents/`). These are product surface, not customization targets. On drift, `upgrade` writes the old file to `{name}.bak` and overwrites — so fixes ship and any local edits stay recoverable. Installation to `~/.claude/skills/` only happens for projects already using Claude commands (≥1 `tcgflow-*` present); it never creates that directory from scratch.
- **Customization surfaces (additive + diff-report, unchanged):** `governance.md`, `config.yaml`, the skill library (`.tcgstackflow/skills/`), and tool adapters (`.tcgstackflow/tools/`). Absent shipped units are added; drifted ones are left for manual merge. These remain sacred.

This narrows — does not abandon — never-clobber: it still never silently overwrites a customization surface, and the `.bak` backup makes even the tool-owned overwrite reversible.

## Upgrade is the Cockpit's one sanctioned write

The Cockpit is read-only for project content and agent runs, with **one deliberate exception**: it *performs* the update by running `geekstackflow upgrade <path>` as a local subprocess and streaming the result. Justified because the operation is safe, idempotent, git-reversible, and never touches project source or task/wiki content — and because it is the ideal **tracer bullet for the Orchestrator's write-path** (subprocess invocation, progress streaming, confirmation UI, error handling), proven on a low-risk maintenance op before the Orchestrator runs real agents.

## Consequences

- `init.js` stamps `tcgflow_version` + `workspace_schema` into `config.yaml` on init, and `upgrade` becomes a real migration runner keyed off `workspace_schema` (replacing the layout-sniffing heuristic; the sniff stays as the schema-1→2 migration's detection).
- `upgrade` gains additive skill/command/MCP installation (never-clobber) plus drift detection that reports — but does not auto-resolve — files that differ from the installed templates.
- The Cockpit reads `workspace_schema`/`tcgflow_version` per registered project, badges "Update available," and runs `upgrade` on demand.
- `audit-workspace` can later flag a project whose `workspace_schema` is behind the installed tool.
- A migrations manifest (schema N → N+1 steps) lives in the tool so both CLI `upgrade` and the Cockpit share one migration path.
