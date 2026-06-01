# Workflows are tool-portable; slash commands are a Claude Code UX shortcut

Each `/tcgflow-*` command is a thin **dispatcher** — it tells the AI to adopt a role and invoke specific workspace skills. The actual behaviour lives in `.tcgstackflow/skills/` (workspace skills) and `.tcgstackflow/agents/` (role profiles), both of which are tool-agnostic. The dispatcher SKILL.md files originally lived only under `templates/claude-commands/` (and installed to `~/.claude/skills/` globally), making them invisible to Codex, GitHub Copilot, Antigravity, Continue, and other AI tools. V1 fixes this by moving the canonical command location into the workspace itself: `.tcgstackflow/commands/{name}/SKILL.md`. Every AI tool that reads the workspace can now find and dispatch the same commands. Claude Code additionally installs them to `~/.claude/skills/` for the `/slash` UX shortcut, but that's UX sugar — the underlying workflows are universal.

## Layout after this ADR

```
templates/workspace/.tcgstackflow/
  agents/              # role profiles — tool-agnostic
  skills/              # 13 workspace skills — tool-agnostic
  commands/            # 14 dispatcher commands — tool-agnostic, NEW canonical location
    tcgflow-init/SKILL.md
    tcgflow-plan/SKILL.md
    ...
  tools/
    claude/CLAUDE.md   # references .tcgstackflow/commands/ + adds slash-command UX
    codex/AGENTS.md    # references .tcgstackflow/commands/ + lists natural-language triggers
    github/copilot-instructions.md  # same — Copilot Chat dispatch via trigger phrases
```

`templates/claude-commands/` is removed. The single canonical location is `templates/workspace/.tcgstackflow/commands/` → propagates into every initialised project's `.tcgstackflow/commands/`.

## How invocation works per tool

| Tool | Invocation UX |
|---|---|
| **Claude Code** | Type `/tcgflow-init`, `/tcgflow-plan`, etc. — slash command dispatches from `~/.claude/skills/tcgflow-*/SKILL.md` (installed by init from `.tcgstackflow/commands/`). |
| **Codex** | Type a natural-language trigger phrase listed in the command's `description` — *"plan ES-1234"*, *"create tasks from Snyk"*. Codex reads `AGENTS.md` which references `.tcgstackflow/commands/`. |
| **GitHub Copilot** | Same as Codex — natural-language triggers, Copilot reads `.github/copilot-instructions.md` which references `.tcgstackflow/commands/`. |
| **Antigravity** | IDE-bound; same natural-language dispatch via the project's `AGENTS.md`. |
| **Continue** | (Future) Continue supports prompt files at `~/.continue/prompts/`. A `tools/continue/` adapter can ship per-tool prompt files generated from `.tcgstackflow/commands/`. Deferred until needed. |

## Why this matters

- **One source of truth.** Updates to a command's procedure happen in `.tcgstackflow/commands/{name}/SKILL.md`, and every tool sees the change. No drift between Claude's view and Codex's view.
- **Teammate discoverability.** A teammate cloning the project can `ls .tcgstackflow/commands/` and see exactly which workflows are available, without needing to install anything globally.
- **Cross-tool consistency.** The trigger phrases listed in each command's `description` are the same set every tool dispatches on; conventions don't fork between Claude users and Codex users.
- **Per-tool UX layer.** Claude Code gets the slash-command shortcut; other tools dispatch on natural-language phrases that are already encoded in the same files. UX differs; semantics don't.

## Consequences

- `templates/claude-commands/` folder is removed. `init.js`'s slash-command install step now reads from `<project>/.tcgstackflow/commands/` (the freshly-copied workspace) instead of `<repo>/templates/claude-commands/`. Single source.
- Tool adapter files (`CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md`) gain a "Commands (invocation)" section that points at `.tcgstackflow/commands/` and lists the natural-language triggers explicitly.
- Adding a new command is one folder + one `SKILL.md` under `templates/workspace/.tcgstackflow/commands/`. The command works in every tool the day it ships; no per-tool adapter changes required (only updates to the tables in the adapters, which are documentation).
- Future tool support (Continue, Cursor, etc.) means writing a thin adapter in `tools/{tool}/` that points at `.tcgstackflow/commands/` and any tool-specific install/symlink step in `init.js`. The commands themselves are untouched.
- The `audit-workspace` skill gains a future detector for command-file drift (a command referenced in a tool adapter but missing from `.tcgstackflow/commands/`, or vice versa). Out of scope for this ADR.
