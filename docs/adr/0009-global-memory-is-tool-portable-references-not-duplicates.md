# Global memory at ~/.tcgstackflow/memory/ — tool-portable via per-tool references, not duplicates

The author works across multiple projects and (in time) with teammates using different AI tools. Cross-project preferences (package manager, code style, test framework, workflow conventions) need a single canonical home so they don't drift between Claude Code's `~/.claude/CLAUDE.md`, Codex's `~/.codex/`, and GitHub Copilot's `~/.github/`. V1 puts the canonical global memory at `~/.tcgstackflow/memory/` as plain Markdown, and each per-tool adapter contains a one-line *reference* to that location — never a duplicated copy.

## Layout

```
~/.tcgstackflow/
  memory/
    preferences.md          # package manager, code style, test framework
    workflow-conventions.md # how the user likes to work
    domain-knowledge.md     # reusable cross-client domain notes
    tools.md                # which AI tools and how the user uses them
  skills/                   # global skill library; symlinked into projects on demand
    {skill-name}/SKILL.md
```

## Tool integration

Each tool's native config gains a one-line reference to the canonical memory:

- `~/.claude/CLAUDE.md` — appends *"Read `~/.tcgstackflow/memory/*.md` before answering."*
- `~/.codex/AGENTS.md` — same line.
- `~/.github/copilot-instructions.md` (if used) — same line.

The init script writes these one-liners when the user opts in per tool; it never copies content.

## Priority

When local Wiki content conflicts with global memory, **local wins** — projects are allowed to deviate from personal defaults. Conflicts are flagged in the relevant project's `wiki/log.md` so the user can resolve them.

## Consequences

- Personal preferences live in exactly one place; teammates with their own setup have their own `~/.tcgstackflow/memory/`.
- A `global-memory` skill exists to add/update entries from the chat (e.g. "save my preference for pnpm to global memory").
- The Claude Code in-session memory system (at `~/.claude/projects/.../memory/`) stays for what it's good at: session-local context. It does not replace `~/.tcgstackflow/memory/`.
- Global skills under `~/.tcgstackflow/skills/` are symlinked into a project's `.tcgstackflow/skills/` on demand — the project lists which global skills it uses; the init or skill-install operation creates the symlinks.
