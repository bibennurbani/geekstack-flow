# Three-bucket model: Skills + Agents + Tool adapters

The master prompt and INX both blur the line between *capability* (how to do X), *role* (who is doing it), and *tool integration* (how each AI tool sees them) — INX nests skills under agents and duplicates content across `claude/`, `codex/`, `github/`, `continue/`. V1 separates these into three peer buckets with one canonical source for each:

- **Skills** at `.tcgstackflow/skills/{name}/SKILL.md` — atomic capabilities, tool-agnostic content, Claude-Code-compatible format.
- **Agents** at `.tcgstackflow/agents/{role}.md` — role profiles that curate skills and add guardrails. Markdown today, executable-later by parsing the same sections.
- **Tool adapters** at `.tcgstackflow/tools/{tool}/` — *generated* shims so each AI tool (Claude Code, Codex, GitHub Copilot, Continue, Antigravity) finds the canonical skills and agents in the shape it expects.

## Considered options

- **Nested model (skills inside agents, as INX has it)** — rejected: forces duplication when two roles use the same skill, and conflates capabilities with role.
- **Per-tool duplication (one full skill set per tool)** — rejected: INX shows this drift (`ai-mem/claude/skills/`, `ai-mem/codex/`, etc.) and the duplicates inevitably get out of sync.
- **Three-bucket peer model** — *chosen*. One canonical home for each concern, adapters are generated, agents reference skills by name.

## Consequences

- Initial V1 agents are 4: `planner`, `coder`, `reviewer`, `ingester`. Sized to merge to 3 (`reviewer` absorbing `ingester`) if `ingester` stays thin in practice.
- Agent profile sections are convention-locked (`Role`, `Reads`, `Writes`, `Skills used`, `Guardrails`, `Hand-off`) so a future runner can parse them without rewriting the files.
- A tool-adapter generator must exist by V1.0 (even if minimal — e.g. just symlinking `.claude/skills/` to `.tcgstackflow/skills/` and generating an `AGENTS.md`). The point is that the *pattern* of canonical-content + generated-shims is in place from day one.
- mattpocock-style skill folders drop in unchanged because the canonical skill format *is* Claude Code's `SKILL.md` format.
