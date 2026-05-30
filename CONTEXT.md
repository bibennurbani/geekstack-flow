# Creative GeekStack Flow

A workflow scaffolding system that gives AI coding tools project-specific memory, task tracking, and governance. Built personal-first for the author, with team-usable as the next gate before any OSS release.

## Language

**LLM-wiki** (or **Wiki**):
The AI-maintained, token-efficient knowledge base for a project. A single flat directory of Obsidian-flavored Markdown pages with frontmatter, heavy wikilinks, and a Map-of-Content `index.md` at the root. Lives under `.tcgstackflow/wiki/`. There is **no separate `raw/` subfolder** — see Raw. _Avoid_: docs, knowledge base, notes.

**Raw**:
The source material a Wiki page can be ingested from. Raw is **not a folder of pre-written notes** — it is whatever already produces facts about the project. Concretely, Raw sources include:
- the **codebase itself** (read-only ground truth);
- the **active task files** (work-in-progress notes generated while completing a task) and **archived task folders** (re-ingestable history);
- **MCP outputs** — Jira tickets/comments, Cypress test results, Snyk findings, GitHub PRs, Datadog traces, etc.
When a task completes (or an MCP-driven investigation finishes), its artifacts become Raw from which the Wiki is updated.
_Avoid_: drafts, sources folder, notes.

**Ingestion**:
The act of folding a Raw source (a completed task, a code-scan result, an external doc) into the Wiki — updating relevant pages, flagging contradictions, recording when pages were last verified. Currently triggered manually by the author; auto-ingestion is a future goal. Each ingest is recorded as an entry in `wiki/log.md`. _Avoid_: import, sync.

**Wiki operations log** (or **`log.md`**):
An append-only chronological record of every ingest or restructure done to the Wiki. Each entry names the context, what was created/modified/deleted, and the decision. This is the Wiki's history of itself and is treated as a first-class page, not a side file.

**Task details**:
The planning document for a unit of work. One per task, lives at `tasks/active/{ID}/TASK details {ID}.md`. Contains overview, subtasks (flat list with ID — status — size), acceptance criteria per subtask, files touched. Created before code is written.

**Task log** (or **Implementation log**):
The runtime record of work done on a task. One per task, lives at `tasks/active/{ID}/TASK {ID}.md`. Updated continuously while the task is in progress via append-only YAML entries (`timestamp`, `author`, `summary`, `files`, `why`, `validation`, `tags`). The `author` field records which AI tool did the work (e.g. `claude`, `copilot`, `codex`). _Avoid_: journal, history.

**Two-file rule** (strict invariant):
Each task is **exactly two Markdown files** — `TASK {ID}.md` and `TASK details {ID}.md`. Never split into per-subtask files (`TASK {ID}-BE-1.md`, `TASK {ID}-FIXES.md`, etc.) — append to the existing two files instead. This rule is non-negotiable; it keeps task history machine-readable and prevents sprawl.

**Planner** vs **Executor** (cost-spreading roles):
**Planner** is the role of writing tight, battle-tested prompts and plans — assumed by Claude (premium reasoning). **Executor** is the role of carrying out the plan against the codebase — can be assumed by Claude, Codex, or Antigravity depending on the cost/quality trade-off for that task. _Avoid_: agent, model (both are too vague).

**Manual handoff** vs **Automated handoff**:
**Manual handoff** — the Planner writes a prompt file under `.tcgstackflow/prompts/{task-id}/`; the user opens the Executor tool separately and pastes the prompt. V1 default.
**Automated handoff** — the Planner shells out to the Executor's CLI (e.g. `codex exec`) and watches the result. Deferred until manual flow is proven on real work.

**Configuration portability**:
Generating per-tool config files (`CLAUDE.md`, `AGENTS.md`) from one source of truth in the LLM-wiki, so multiple AI tools can read the same project context. **Distinct from cross-tool orchestration**, which would mean one tool driving another's CLI at runtime.

**Skill**:
An atomic capability — "how to do X" — written once and consumed by any AI tool. Each skill is one folder under `.tcgstackflow/skills/{name}/` with a `SKILL.md` (Claude Code skill format, so mattpocock-style skills drop in unchanged) plus optional `examples/` and `templates/`. The content is tool-agnostic; the format happens to be Claude's because it is the only AI tool with a real skill system. _Avoid_: capability, helper, instruction.

**Agent**:
A role profile — "who I am and which skills I use." One Markdown file per role under `.tcgstackflow/agents/{role}.md`. Names the role's skills, the files it reads and writes, its guardrails, and its hand-off condition. V1 agents are Markdown-only (a human or AI reads the file to assume the role); a future runner can parse the same sections as structured fields, so executable-later requires no schema change. Initial roles: `planner`, `coder`, `reviewer`, `ingester`. _Avoid_: runner, sub-agent (those are execution concerns).

**Tool adapter**:
A thin per-tool shim under `.tcgstackflow/tools/{tool}/` that points the AI tool at the canonical skills and agents, plus any tool-specific glue (e.g. `.claude/skills/` symlink for Claude Code, `AGENTS.md` for Codex, `.github/copilot-instructions.md` for GitHub Copilot). Tool adapters are **generated**, never hand-written, so the canonical content lives in exactly one place.

## Flagged ambiguities
- **"Karpathy method"** is referenced as the ingestion technique. In this project it means: flat directory of atomic Markdown pages, Obsidian frontmatter (title, tags, aliases, priority, created, updated, status), heavy `[[wikilinks]]`, and a Map-of-Content `index.md` as the entry point. Confirmed against an existing working example (`SaeDigital/run-by-strength/docs/`).
