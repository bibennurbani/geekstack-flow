# Creative GeekStack Flow

A workflow scaffolding system that gives AI coding tools project-specific memory, task tracking, and governance. Built personal-first for the author, with team-usable as the next gate before any OSS release.

## Language

**LLM-wiki** (or **Wiki**):
The AI-maintained, token-efficient knowledge base for a project. A single flat directory of Obsidian-flavored Markdown pages with frontmatter, heavy wikilinks, and a Map-of-Content `index.md` at the root. Lives under `.tcgstackflow/wiki/`. There is **no separate `raw/` subfolder** — see Raw. The entire `.tcgstackflow/` folder is designed to be opened as an Obsidian vault; volatile state files are gitignored, shared config (plugins, hotkeys, themes) stays tracked. _Avoid_: docs, knowledge base, notes.

**Raw**:
The source material a Wiki page can be ingested from. Raw exists in two modes:
- **Implicit Raw** — artifacts that always exist in any project and don't need a folder: the **codebase**, the **active task files**, **archived task folders**, and **MCP outputs** (Jira tickets, Cypress results, Snyk findings, GitHub PRs, Datadog traces).
- **Explicit Raw** — one-off external material the user drops into the project for ingestion (PDFs, copy-pasted specs, screenshots, exported docs). Lives in `.tcgstackflow/raw/`. After ingestion, files move to `raw/.archived/` rather than being deleted, so re-ingest with new context is possible.
_Avoid_: drafts, sources folder, notes.

**Ingestion** (one of three Wiki **Operations** — see also Query, Lint):
The act of folding a Raw source (a completed task, a code-scan result, an external doc, an MCP fetch) into the Wiki — updating relevant pages (a single ingest may touch 10–15 pages), proposing new pages for approval, flagging contradictions, recording when pages were last verified. Currently triggered manually; auto-ingestion is a future goal. Each ingest produces one entry in `wiki/log.md` using the locked log-entry prefix `## [YYYY-MM-DD] ingest | {title}`. _Avoid_: import, sync.

**Query** (Wiki Operation):
A user-driven question answered *from* the Wiki rather than from raw retrieval. The AI reads `index.md` first to find relevant pages, then drills in. A query may itself produce a wiki-worthy artifact (a comparison, an analysis, a synthesis) — if so, that result is filed back into the Wiki as a new page during the same session.

**Lint** (Wiki Operation):
A periodic health-check of the Wiki itself. Detects contradictions between pages, stale claims newer Raw has superseded, orphan pages with no inbound links, important concepts missing their own page, and missing cross-references. Triggered on demand or as a ritual (e.g. weekly). Lint never silently rewrites — it produces a report and proposes fixes, gated by the same new-page / deletion approval rule as Ingestion. Produces a `## [YYYY-MM-DD] lint | {scope}` entry in `log.md`.

**Audit** (Workspace Operation):
A health-check of `.tcgstackflow/` *outside* the wiki — agents, skills, tools, and codebase alignment. Detects broken agent→skill references, skills placed in the wrong library (project-local vs global per ADR 0012), skill content stale vs codebase tech versions, missing skills for present tech, and SKILL.md frontmatter problems. Run alongside `Lint` for full workspace coverage. Produces a `## [YYYY-MM-DD] audit | workspace` entry in `log.md`. Like Lint, never silently rewrites — surfaces a report; fixes route through `ingest` (for wiki/governance), shell (for file moves), or `npx skills add` (for skill installs). Lives in the `audit-workspace` skill.

**Wiki operations log** (or **`log.md`**):
An append-only chronological record of every Operation (Ingest, Query result filed back, Lint, Restructure) done to the Wiki. Each entry uses the **locked prefix** `## [YYYY-MM-DD] {operation} | {title}` so that `grep "^## \[" log.md | tail -N` returns the last N operations as a clean timeline (per Karpathy's recipe). Each entry names the Context, the Created/Modified/Deleted file lists, and the Decision. The log is the Wiki's history-of-itself and is treated as a first-class page, not a side file.

**Schema doc**:
The configuration file that tells an AI tool how this Wiki is structured and how to operate on it (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex and similar). Schema docs are **living artifacts** that co-evolve with the project — when conventions change, the Ingester (or the user) updates them. Not lock-in. Generated from the canonical agents and wiki structure, never hand-edited beyond project-specific overrides.

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

**Governance** (or **`governance.md`**):
One Markdown file at `.tcgstackflow/governance.md` that defines (1) the four-level risk taxonomy (LOW / MEDIUM / HIGH / CRITICAL), (2) the permission-request recipe agents follow for HIGH and CRITICAL actions, and (3) project-specific rules edited per project. Read by every agent on session start; enforced informally — by the AI following the doc, not by a separate runtime gate.

**Risk levels** (from governance.md):
- **LOW** — read/search/draft. Proceed without approval.
- **MEDIUM** — edit source, run tests, draft commit. Proceed and log.
- **HIGH** — install deps, push, open PR, edit auth-sensitive code, update external tickets. Request permission first.
- **CRITICAL** — production deploy, destructive DB op, force push, rotate secrets, modify CI/CD. Request permission AND propose a rollback plan.

**Permission request** (recipe, not a form):
The conversational shape an agent uses when proposing a HIGH or CRITICAL action: *Action / Risk / Why / Files affected / Rollback / Approve?* Inline in the chat, not a structured artifact — the user replies with "approved" / "no" / a tweak.

**Timesheet** (and its two skills):
The weekly Tempo/Jira worklog draft generated from task data, plus inline admin-meeting input from the user. Lives at `.tcgstackflow/tasks/.weekly/Weekly_Timesheet_{YYYY-MM-DD}.md`. Two skills operate on it:
- `generate-timesheet` (LOW) — reads tasks, applies sugar-coating (always on — polished, impact-oriented dev descriptions; admin verbatim), produces the file. Does not submit.
- `submit-timesheet` (HIGH) — submits worklogs via the configured provider (default Atlassian MCP). Honors `submission_mode: approval | trust` from config — `approval` requires explicit OK per `governance.md`; `trust` is the personal-use convenience mode that matches the author's established calibrated workflow.

**Single-project workspace** vs **Multi-project workspace**:
A workspace's `config.yaml` declares `workspace_kind: single | multi-project`. **Single** workspaces have one stack and one set of package-manager / test / lint commands — the defaults at `project.primary_stack` and `project.package_manager` apply throughout. **Multi-project** workspaces contain multiple distinct codebases as top-level directories (e.g. a backend API + a frontend SPA + a mobile app + an IaC project all in one workspace folder); each sub-project is declared in the top-level `projects:` array with its own `path`, `stack`, `package_manager`, `test`, and `lint`. The `init.js` script auto-detects by scanning top-level directories for project signal files (`package.json`, `*.csproj` at top or under `src/<project>/`, `Pulumi.yaml`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `pom.xml`, `composer.json`) and populates `projects:` automatically when 2+ are found. The `coder` agent picks per-project commands based on which `projects[].path` the working files fall under; the `planner` agent adds an optional `**Project:**` field per subtask; wiki pages and task log YAML entries gain an optional `project:` field. See ADR 0015.

**Local memory** vs **Global memory**:
- **Local memory** is the project-specific Wiki at `.tcgstackflow/wiki/` — facts about *this* project.
- **Global memory** is cross-project, cross-tool preferences and knowledge at `~/.tcgstackflow/memory/` — `preferences.md` (package manager, code style, test framework), `workflow-conventions.md` (how the user likes to work), `domain-knowledge.md` (reusable cross-client domain notes), `tools.md` (which AI tools and how).
Each tool adapter references the global memory from the tool's own config location (e.g. `~/.claude/CLAUDE.md` says "Read `~/.tcgstackflow/memory/*.md`"). One canonical home; many references. Local memory always takes priority over global when they conflict.

## Flagged ambiguities
- **"Karpathy method"** is referenced as the ingestion technique. In this project it means: flat directory of atomic Markdown pages, Obsidian frontmatter (title, tags, aliases, priority, created, updated, status), heavy `[[wikilinks]]`, and a Map-of-Content `index.md` as the entry point. Confirmed against an existing working example (`SaeDigital/run-by-strength/docs/`).
