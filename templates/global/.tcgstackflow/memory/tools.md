---
title: AI Tools Used
priority: P1
updated: 2026-05-30
status: current
---

# AI Tools Used

The AI tools the user works with, how they configure them, and which roles each is preferred for.

## Tools

### Claude Code (primary)

- **Used for:** planning, grilling, reviewing, ingesting, writing prompts for other tools.
- **Subscription:** Claude Team + Enterprise (200/month cap).
- **Memory:** Claude Code's per-project memory at `~/.claude/projects/.../memory/` is for session context. Cross-project preferences live here at `~/.tcgstackflow/memory/`.
- **Skills:** `~/.claude/skills/` symlinked to `~/.tcgstackflow/skills/`.

### Codex

- **Used for:** implementation handoff from Claude when cost-spreading. Manual handoff only in V1.
- **Config:** `~/.codex/config.toml`.
- **Reads:** `AGENTS.md` at project root.

### GitHub Copilot

- **Used for:** in-IDE autocomplete; occasional task-level work in tools that respect `.github/copilot-instructions.md`.
- **Reads:** `.github/copilot-instructions.md` if generated for a project.

### Antigravity

- **Used for:** experimental — IDE-bound, no CLI.
- **Currently:** free preview. Worth trying for cost-spreading once V1 stabilises.

## Cross-tool conventions

- `author:` field in task log YAML entries records which tool did the work — values: `claude`, `codex`, `copilot`, `antigravity`, `human`.
- Manual handoff prompts written to `.tcgstackflow/prompts/{task-id}/{target-tool}-{intent}.md`.
- The same agent profiles in `.tcgstackflow/agents/` are read by every tool — no per-tool agent variants.

## Known compatibility notes

- **Claude Code `Workflow` tool + `agentType: 'Explore'` + structured-output `schema` does NOT compose.** Subagents finish without calling StructuredOutput (observed in GSF-001 session, 2026-05-31 — six agents, 1108ms duration, zero StructuredOutput calls). Workaround: drop `agentType: 'Explore'` and use the default workflow subagent, or drop the `schema` and parse free-form text manually. Inline parallel reads via `Bash`/`Read` are the cheaper alternative for one-shot inventories.
