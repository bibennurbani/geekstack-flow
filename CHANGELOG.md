# Changelog

All notable changes to Creative GeekStack Flow are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-06-25

### Added — Per-tool runner adapter, wiki-reliability, governance depth, internal deepenings (schema 6)

- **Per-tool runner-adapter seam (ADR 0035)** — the Orchestrator's transport is no longer fused to Claude's CLI: a pure `RunnerAdapter` (argv / stream-parse / `--resume` idiom / governance-gate behind one small interface) makes the continuation loop tool-agnostic; `readRoleTool` becomes the selector. Claude ships as the reference adapter; the cost-spreading goal (Codex/Copilot) is reachable behind the seam rather than a `501`.
- **One budget computation** — `sessionReport.budgetFor()` consolidates the spend-vs-budget math that was duplicated in `run.cjs`/`index.cjs`; pricing is a parameter (follows the role's tool).
- **Cockpit: pure seams + pricing single source** — `api.js`/`pricing.js`/`format.js`/`projection.js`/`useRun.js` extracted from the 1,332-line `App.vue` (the SPA's first test surface; vitest added). New `GET /api/pricing` is the one list-price source, ending the 4× Opus-price drift (ADR 0034:21).
- **Wiki reliability** — deterministic `qmd embed` after a clean ingester run (**ADR 0036**; no more silently-stale index, outcome recorded on the run record); the git pull-digest hook is installed by `init`; startup auto-folds pending `VALIDATED` tasks + the `raw/` inbox (opt-in `auto_ingest_on_pull`); per-page staleness surfaced (`stale_pages` + the Home `stale_wiki` flag); optional `verified:` page-freshness field; dedup-before-mint + apply-resolved-contradiction-to-the-page + file→page coverage map + ADR retrieval parity + an explicit retrieval token-budget.
- **Richer pull digests** — the post-merge hook now writes change signals (commit/file counts, `+/-` lines, new/deleted files, a flag for contract / cross-cutting paths likely to ripple), the multi-project sibling list, and a truncated diff body, headed by a **mandatory three-part contract** for the Ingester: capture **(1) what changed** (into the page bodies), **(2) cross-project impact** in multi-project workspaces (name affected projects, or record "no cross-project impact — {why}"), and **(3) a plain-language summary** of what the change is about and why. The `RAW_INGEST_PROMPT`, the `ingest` skill (new *Pull-digest ingest* section), and the Ingester agent all enforce it; `upgrade` (5→6) refreshes the workspace-local hook so re-running `geekstackflow hooks .` wires the enriched version.
- **Governance gate depth** — the classifier closes the indirection blind spot (`make deploy`/`npm run deploy`/`psql DROP`/`docker push` no longer tunnel through as MEDIUM; routine `npm run test`/`make build`/`docker compose up` stay MEDIUM — no approval fatigue); the orchestrated approval card now carries a synthesized Files list + Rollback hint (ADR 0008/0027 fidelity).
- **Run-record contract (schema 6)** — `runs/{run}.md` frontmatter gains `tool`/`gate` (ADR 0035) and `embed` (ADR 0036); the format now lives in one `serialize/parse` module in `read.cjs` (round-trip tested). `upgrade` refreshes `runs/README.md` (the contract doc) in existing workspaces.
- **Internal deepenings + test seams** — one task-header reader (kills a byte-identical parse); characterization tests for the `init.js` project-detection cascade; the Cockpit server's request handler is extracted as a named `handleRequest`, so the full request→validation→dispatch map is exercised by in-memory request/response doubles (no socket) — including the ADR-0008 invariant that no client path can one-click-approve a CRITICAL action without acknowledging the rollback plan. Two suites now: `npm test` (node --test — server/CLI) and `npm --prefix ui test` (vitest — SPA).
- New ADRs: **0035** (runner-adapter seam + per-tool fidelity tiers), **0036** (orchestrator deterministically re-embeds qmd after ingest).

### Added — Auto-advance chains, knowledge freshness, and the git-pull ingest hook

- **Auto-advance chain ("run to completion")** — a chained Run launches the next lifecycle role on hand-off (coder → reviewer → tester → ingester) until `INGESTED`/`BLOCKED` or the `max_bounces` limit; per-launch toggle or `orchestrator.auto_advance: true`. Budget re-checked at every chained launch.
- **Global approval inbox** (`GET /api/approvals` + 🔔 nav item + browser notifications) — HIGH/CRITICAL pauses from any run, visible from anywhere; approve/deny inline.
- **Reattach** — opening a task with an in-flight run resumes its live stream; **▶ Run buttons** on all queue rows (Home, agent pages, project queue).
- **Knowledge freshness** (Wiki tab) — tasks awaiting ingest, pending `raw/` files, last-ingest date, wiki last-edit, and a "▶ Ingest raw now" action (`RAW-*` pseudo-task ingester runs).
- **Git-pull ingest hook** — `geekstackflow hooks [target]` installs `post-merge`/`post-rewrite`: every pull writes a **pull digest** into `raw/`; with `orchestrator.auto_ingest_on_pull: true` and the Cockpit up, the ingester run launches automatically. Pre-existing hooks are preserved (`*.pre-gsf`) and chained.
- New config keys (all optional, Settings-tab editable where applicable): `orchestrator.auto_advance`, `orchestrator.max_bounces`, `orchestrator.auto_ingest_on_pull`.

### Added — Cockpit becomes the Orchestrator; read-only retired (ADR 0032/0033/0034)

- **Live Runs** — the Run buttons launch real agents: the server spawns `claude -p … --output-format stream-json`, streams progress to the browser via SSE, and writes an immutable transcript to `.tcgstackflow/runs/{task-id}/{run-id}.md` with frontmatter recording `task`, `role`, `session_id`, Run tokens, terminal `state`, `ended_at`, and the `git_base` commit captured at Run start. No database — files plus ephemeral server memory, as ever (ADR 0024).
- **Continuation loop** — each Run resumes its session (`claude --resume`) until the agent sets the task to `IN_REVIEW` or a 6-iteration cap is hit; token usage accumulates across iterations into the single run record. D1 doctrine: the **agent owns task-file writes** (its own log entries, its own Status advance); the server adds only a **Status safety-net** entry when a clean Run ends un-advanced.
- **In-run governance, machine-enforced** — the agent's permission prompts are delegated via `--permission-prompt-tool` to a local stdio **governance MCP** plus an approvals registry; HIGH/CRITICAL actions pause the Run and surface a Cockpit approve/deny modal (CRITICAL requires an explicit acknowledgement). `governance.md` is now a runtime gate for orchestrated Runs (ADR 0027 realized).
- **Status override** — a dropdown in the task panel rewrites the canonical `Status:` line in `TASK {ID}.md` and auto-appends an auditable YAML log entry (`author: human`, `via: cockpit`, old→new).
- **Run tokens + Session report** — per-Run token capture into run-record frontmatter; the **Session report** parses the Run's Claude Code session JSONL into a per-turn trace with a **dollar-cost waterfall** at per-model list pricing (the scoped $ amendment to ADR 0033). Three surfaces: a live Cockpit page (optionally scoped to one Run via `&run=`), a server-rendered **standalone HTML export** (`…/report.html`), and a "Generate analysis" copy-prompt — plus the new 18th command **`/tcgflow-session-report`**.
- **Discuss + Stop** — **Discuss** resumes a finished Run's session read-only for follow-up questions; **Stop** aborts a live Run, and a startup reconcile appends durable "aborted at pause point" entries for orphaned runs.
- **Per-run diff** — the `git_base` captured at Run start powers a diff view in the task panel of exactly what the Run changed.
- **Settings write** — the Cockpit's third write path: a per-project Settings tab writes the role→tool map (`orchestrator.roles`) and an optional budget (`orchestrator.budget_usd`) into `config.yaml`; est.-spend-vs-budget badges appear on Home and the project header.
- **SPA redesign** — dark editorial theme with self-hosted JetBrains Mono + Space Grotesk, an agent-grouped Home with an est.-spend hero, a cross-workspace **Runs history** view, and per-project Tools/Settings tabs.

### Changed

- **`workspace_schema` bumped to 4** — the schema-3 → 4 migration adds the `runs/` area and the `orchestrator.roles` config block.
- Now 6 agent roles, 17 skills, **18 commands** (`tcgflow-session-report` added); the test suite is **62 `node --test` tests** (`npm test`).

### Added — qmd is the mandatory wiki-search layer (ADR 0030)

- **`wiki-search` skill** — one shared discovery skill every agent uses to find LLM-wiki and `docs/` content via [qmd](https://github.com/tobi/qmd) (local hybrid keyword + vector + LLM re-rank) before reading or editing the wiki. qmd is now **mandatory, not optional**: it surfaces *which* pages are relevant, then the agent opens them and follows `[[wikilinks]]` one hop. It **complements** `wiki/index.md` — the Map of Content stays the always-current fallback when the index is stale or qmd is unavailable. The **CLI is canonical** (`qmd query "…" -c wiki --json`, plus `search`/`vsearch`/`get`); the qmd MCP is an optional Claude convenience. The old "when wired"/optional framing is removed.
- **Auto-installed + indexed by `/tcgflow-init`** — `init.js` stays dependency-free and only scaffolds the `wiki_search` config block and prints the next step; the `/tcgflow-init` AI command performs the permission-gated install (`npm i -g @tobilu/qmd` + ~2 GB local models — a HIGH action), registers the `wiki` (and `docs`) collection with `qmd collection add <path> --name <name> --mask "*.md"` + a one-line `qmd context add` description, and runs the first `qmd embed`. The **Ingester re-embeds as its final step** so reads stay fresh. New prerequisites documented in `INSTALL.md`/`QUICKSTART.md`: **Node ≥ 22, ~2 GB disk for models, `brew install sqlite` on macOS**. Declining the install falls back to `index.md` navigation.
- **qmd-optimized wiki authoring convention** — the `ingest` skill now documents how to write pages that qmd retrieves well, since qmd chunks Markdown into ~900-token pieces at headings (H1/H2 highest) and code fences and does **not** guarantee frontmatter indexing. New **`summary` frontmatter field** (one sentence — what the page is and why), mirrored as a 1–2 sentence lead paragraph in the body's first chunk so both BM25 and the embedding get a strong signal; a **lightweight tag taxonomy** (one `kind` tag from `overview`/`architecture`/`domain`/`feature`/`integration`/`operations`/`decision`/`testing`/`meta` + optional area/sub-project tag, 2–4 lowercase kebab-case tags, consistency over coverage); **chunk-friendly heading rules** (focused `##`/`###` sections under ~900 tokens, synonyms surfaced in prose not just `aliases`, descriptive kebab-case filename = qmd docid, heavy `[[wikilinks]]`). The page template and frontmatter schema gain the `summary` field.
- **Collection descriptions wired into `config.yaml` + `/tcgflow-init`** — the `wiki_search` block and the init flow now register collections with an explicit `--mask "*.md"` and a `qmd context add` one-line description per collection, so qmd's re-rank and the Cockpit have a human-readable label for the `wiki` and `docs` collections.
- **`lint-wiki` now checks the convention** — flags pages missing the `summary` field, off-taxonomy/sprawling tags, and oversized sections in addition to its existing contradiction/stale/orphan/broken-wikilink checks.

### Added — Refactorer role + cleanup-pass doctrine (ADR 0031)

- **6th agent `refactorer` + `/tcgflow-refactor` command** — a manually-invoked peer to the Coder (not a linear lifecycle stage) for **broad, behaviour-preserving** refactors of a target area. It surveys read-only, **proposes a two-file refactor task** (behaviour-preservation acceptance per subtask — an approval gate), **writes characterization tests first** when the area is under-covered, executes logging YAML entries, and hands off into **Reviewer → Tester → Ingester** (it never self-approves). For refactor-typed tasks the Reviewer's **scope-drift blocker is relaxed**, the acceptance oracle is behaviour-preservation, and the **Tester is the real gate**.
- **`best-practice-refactor` skill** — holds the refactor heuristics in two scopes: the broad Refactor (Scope B) and the narrow **Coder cleanup pass** (Scope A) it reuses.
- **Diff-scoped Coder cleanup pass** — every Coder now leaves *its own* touched files clean before `IN_REVIEW`: removes imports and dead code *its change* orphaned, drops commented-out scratch, runs the formatter/linter autofix on touched files only. This is "clean up after your own change," explicitly **not** surrounding cleanup or refactoring beyond the task (that's `/tcgflow-refactor`), so it coexists with the global minimal-change preference. The **Reviewer verifies** it happened.

### Changed

- **Node engine raised to `>=22`** — the mandatory qmd wiki-search layer requires Node ≥ 22, so `package.json` `engines.node` is bumped to `>=22`, `init.js` prints an advisory when it detects an older runtime, and the prerequisite is documented across `INSTALL.md`/`QUICKSTART.md`/`USAGE.md`.
- **`workspace_schema` bumped to 3** — a schema-2 → 3 migration injects the `wiki_search` config block into existing workspaces; `upgrade` installs/registers/embeds qmd for them.
- Now **6 agent roles, 17 skills, 17 commands**.

### Added — `drift` report for targeted upgrades

- **`geekstackflow drift [project]`** + a drift report printed at the end of every `upgrade` — lists exactly which **existing skills** and **tool adapters** differ from the installed templates (the customization surfaces `upgrade` won't auto-merge per ADR 0021), so merging upstream changes is targeted instead of "diff the whole `templates/` tree and guess." Adapter comparison **normalises the `{{project-name}}` placeholder and ignores content below the override marker**, so it never reports false drift; new-but-not-yet-installed skills are flagged separately. Read-only — writes nothing. New `init.js` helpers `reportDriftFromTemplate` / `adapterDrifted` / `reportWorkspaceDrift` (exported for tests).

### Documentation

- Added a full **`docs/`** set: [`docs/README.md`](docs/README.md) (index), [`INSTALL.md`](docs/INSTALL.md) (prerequisites, npm/clone install, Cockpit build, optional integrations), [`QUICKSTART.md`](docs/QUICKSTART.md) (zero-to-working in ~5 min), and [`USAGE.md`](docs/USAGE.md) (the full daily workflow, Cockpit, wiki/memory, timesheets, Jira sync, signal→task, governance, multi-project, migration, upgrade, global memory, troubleshooting, reference tables). Top-level README rewritten and links to the guides.

### Added — Jira status sync (ADR 0029)

- **`sync-jira` skill + `/tcgflow-sync-jira` command** — the AI (Atlassian MCP) fetches each Jira-keyed task's status and writes a project-local snapshot `tasks/jira-cache.json`. The credential-free Cockpit server only *reads* this cache — it never calls Jira (preserves the zero-secret-server invariant, ADR 0020/0024).
- **Two statuses per task in the Cockpit** — workspace status (drives the action queue) + **Jira status** (badge linking to the ticket, "synced Xh ago", and a ⚠ **drift** flag when workspace and Jira disagree on done-ness). Read-only on Jira; transitioning tickets stays a separate explicit action.
- `init.js` offers `tasks/jira-cache.json` as a commented gitignore option (default committed — teammates see last-known Jira state).
- 15 skills, 16 commands.
- `copyDirSync` now skips OS/editor cruft (`.DS_Store`, `Thumbs.db`, `*.swp`, `node_modules`, `.git`) so it never ships into a user's workspace; repo-root `.gitignore` added.

### Added — Tester role (ADR 0028)

- **5th agent `tester` + `IN_TEST` status** — separates the dynamic gate (does it *work*?) from the reviewer's static gate (is the code *right*?). Lifecycle is now `IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED`. Reviewer approval routes to `IN_TEST`/Tester instead of straight to `VALIDATED`.
- **`verify` skill** — the Tester builds a test plan from acceptance criteria, documents it (task log + proposed `wiki/testing/{ID}.md`) or pushes it to **Jira** (HIGH, approval-gated), runs unit/E2E/app verification, and records a pass/fail verdict. Coder still writes unit tests inline; the Tester owns end-to-end verification + the test plan.
- **`/tcgflow-test` command** (14th command), agent `tester.md`, Cockpit cyan `IN_TEST` badge + `agent-tester` chip, status normalization (`In Test`/`Testing`/`QA` → `IN_TEST`).
- Tool adapters updated: 5 roles, 14 skills, `tcgflow-test`.

### Changed

- **`upgrade` now additively installs new skills** (absent → add, existing → never overwrite), in addition to refreshing tool-owned commands + agent profiles. So new/updated `tcgflow-*` commands, agent profiles, and skills (like the tester set) propagate to existing projects via `geekstackflow upgrade` — satisfying "add/update a skill or command → it ships through upgrade."

### Added — Cockpit (Phase 2)

- **`ui/` package** (ADR 0022) — the local Cockpit. Vue 3 + Vite SPA in `ui/src/`, served by a **zero-dependency Node `http` server** in `ui/server/` (a refinement of ADR 0022, which named Hono and allowed a substitute; built-in `http` is thinner and testable without an install). UI dependencies live in `ui/package.json` only — the root CLI (`init.js`) stays zero-dependency.
- **`geekstackflow ui [--port N]`** — launches the Cockpit at `http://127.0.0.1:4729` (default), opens a browser. Binds localhost only, no auth (ADR 0020).
- **Read-only API** — `GET /api/health`, `/api/projects` (registry + `update_available`), `/api/project?path=…` (config, version, action-queue, tasks, wiki summary). Pure projections over `.tcgstackflow/` files — no database (ADR 0024). *Initial surface — superseded within this release by ADR 0032; see "Cockpit becomes the Orchestrator" above.*
- **Action queue** (ADR 0023) — computed per project from task status via a status→next-agent map (`PLANNED→coder`, `IN_REVIEW→reviewer`, `VALIDATED→ingester`, …). The Home view aggregates queues across all registered projects.
- **Copy-prompt** (ADR 0023) — the mocked "Run" affordance: copies a ready-to-paste prompt for the next agent on a task. Clipboard only, no file writes. *Now the fallback — the live Run shipped within this release (see above); the same prompt feeds the Orchestrator's subprocess.*
- **Built-in fallback UI** — the server serves a vanilla-JS page with the same functionality until the Vue SPA is built, so the cockpit works with zero `npm install`.
- **Second-pass panels** (ADR 0023) — per-project **Governance** (project-specific rules), **Timesheet** (this week's draft + submitted/draft status), and **Tools & MCP** (enabled tool adapters + recommended/optional MCP) panels in the data layer and the Vue SPA.

### Changed

- **`upgrade` now refreshes tool-owned files** (ADR 0021 amendment) — the `tcgflow-*` slash commands (in `.tcgstackflow/commands/` and the installed copies under `~/.claude/skills/`) and the shipped agent profiles (`.tcgstackflow/agents/`) are now refreshed to the installed templates so behavioural fixes ship via `upgrade` instead of waiting on a manual diff-merge. Drifted files are backed up to `{name}.bak` before being overwritten. Customization surfaces — `governance.md`, `config.yaml`, the skill library, and tool adapters — stay additive-only and untouched. Installed-command refresh only runs for projects already using Claude commands (≥1 `tcgflow-*` present in `~/.claude/skills/`); it never creates that directory from scratch.

### Fixed

- **Planner no longer fabricates Jira ticket context** — `/tcgflow-plan` and the `planner` agent now treat a Jira-style ID as requiring the real ticket: attempt the Atlassian MCP fetch, and if it can't connect, try to make it available, then **stop and ask** the user to connect the MCP or paste the ticket. Previously, when the MCP was absent, the Planner silently substituted an unrelated task's context.
- **`upgrade` now auto-registers the project** in the Cockpit registry. Previously only `init`/`register` wrote to `~/.tcgstackflow/projects.yaml`, so a project set up before the registry existed (or migrated via `upgrade`) never appeared in the Cockpit's left-nav. `upgrade` now adds it (idempotent).
- **Governance panel** no longer surfaces the template's commented-out example rules — HTML-comment blocks are stripped before extracting project-specific rules, so a fresh project correctly shows none.
- **Cockpit UI redesign** — replaced the broken `color-scheme: light dark` (which rendered dark text on a dark canvas, unreadable) with an explicit, AA-contrast design system: dark sidebar + light content, semantic **color-coded status badges** (PLANNED/IN_PROGRESS/IN_REVIEW/VALIDATED/COMPLETED/BLOCKED/DRAFT), agent-colored chips, card hover states, and a "✓ Copied" feedback state on Copy-prompt. Fallback page given an explicit light background too. *This light-content design was itself superseded within the release by the dark editorial SPA redesign — see the Orchestrator section above.*
- **Status normalization** — task statuses are normalized to the canonical set before mapping to agents (`In Progress`/`WIP`/`Doing` → `IN_PROGRESS`, `Done`/`Closed`/`Shipped` → `COMPLETED`, `Review` → `IN_REVIEW`, etc.). Real-world projects (e.g. INX, which writes `Status: In Progress`) now populate the action queue correctly instead of showing unmapped raw statuses.

## [0.2.0] — 2026-06-01

Phase 2 foundation: workspace version stamping + a real migration runner, plus the no-dotfiles convention, MCP-derived task skills, and tool-portable commands.

### Added

- **Workspace version stamp** (ADR 0021) — every `config.yaml` now carries `tcgflow_version` (the tool semver that last touched it) and `workspace_schema` (an integer layout version). `init` stamps both; `upgrade` reads `workspace_schema` and migrates forward.
- **Migration runner** — `upgrade` is no longer a one-off layout-sniff. It reads the workspace's `workspace_schema`, applies every registered migration step from there up to the tool's `LATEST_SCHEMA` (each step idempotent), then stamps the new version. Schema 1 → 2 is the no-dotfiles migration. A workspace newer than the installed tool is detected and the user is told to update the tool. Foundation for the Cockpit's "Update available" badge.
- **Project registry** (CONTEXT "Project registry") — per-machine `~/.tcgstackflow/projects.yaml` feeding the Cockpit's left-nav. `init` auto-registers the project it scaffolds (dedup by resolved path). New **`geekstackflow register [target]`** subcommand adds an already-initialised project without re-running init (e.g. after cloning to a new machine). Registry is never committed — paths are machine-specific absolute paths.
- **`init.js --upgrade`** — non-destructive in-place upgrade of a pre-v0.2 workspace. Renames pre-v0.2 dotted subfolders (`.weekly/` → `weekly/`, `.archived/` → `archived/`, `.migration-notes/` → `migration-notes/`), moves `.tcgstackflow/.gitignore` content to the project-root `.gitignore` with a marker block, and creates the Obsidian symlink if missing. Leaves task content, wiki, agents, skills, and tool adapters untouched.
- **`/tcgflow-upgrade`** slash command — dispatches to `init.js --upgrade`. Brings command count to **14**.
- **ADR 0019** — workflows are tool-portable; slash commands are a Claude Code UX shortcut. The `templates/claude-commands/` folder is **removed**; commands now live canonically at `templates/workspace/.tcgstackflow/commands/` and propagate into every initialised project at `.tcgstackflow/commands/`. Codex, GitHub Copilot, Antigravity, and any other AI tool can read and dispatch them directly from the workspace; Claude Code additionally installs them to `~/.claude/skills/` for the `/slash` UX. Tool adapter files (`CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md`) gain a "Commands (invocation)" section explaining tool-specific invocation.
- **3 MCP-derived task skills** (ADR 0018): `task-from-snyk`, `task-from-cypress`, `task-from-datadog`. Each converts MCP output (security findings, test failures, incident telemetry) into a `PLANNED` task with the standard two-file shape — grouped by source-appropriate unit (package / spec / incident), with dedup against existing tasks and severity-aware risk escalation.
- **3 matching `/tcgflow-task-from-*` slash commands** in the global Claude Code skills set.
- **ADR 0017** — formalises the "no dotfiles inside `.tcgstackflow/`" convention; renames `tasks/.weekly/` → `tasks/weekly/`, `raw/.archived/` → `raw/archived/`, `.migration-notes/` → `migration-notes/`. Workspace `.gitignore` removed; `init.js` now writes a marked block into the project-root `.gitignore`.
- **`init.js` Obsidian-symlink prompt** — creates `tcgstackflow/ → .tcgstackflow/` so Obsidian's vault picker (which hides dotfiles) can select the workspace.

### Changed

- V1 starter skill set: 10 → **13** skills.
- V1 slash command set: 10 → **14** commands.

### Fixed

- **`geekstackflow init [args]` subcommand parsing.** When invoked via the `geekstackflow` or `tcgflow` bin entries, the leading `init` token was being treated as a positional target path, causing `geekstackflow init --upgrade .` to fail with *"No .tcgstackflow/ found at &lt;cwd&gt;/init"*. The parser now discards a leading `init` as a no-op subcommand and accepts `upgrade` as a subcommand alias for `--upgrade`. All invocation forms — `geekstackflow init`, `geekstackflow upgrade`, `geekstackflow --upgrade`, `node init.js --upgrade` — now work equivalently.

### Migration

For existing pre-v0.2 workspaces, run `geekstackflow init --upgrade .` from the project root. Slash commands installed in `~/.claude/skills/` before this release reference old paths (`.weekly/`, etc.) — refresh them with `cp -R templates/claude-commands/* ~/.claude/skills/` and restart Claude Code sessions to pick them up.

## [0.1.0] — 2026-05-31

First public-ready release. Personal-first scope; team and OSS gates are next.

### Added

- **`init.js`** — pure Node built-ins, no dependencies. Initialises `.tcgstackflow/` in the target project, optionally writes per-tool root adapters (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`), seeds `~/.tcgstackflow/` global memory and skill library on first run. Supports `--force`, `--migrate-from <path>`, and `--help`.
- **Multi-project detection** — when `init.js` finds 2+ top-level directories with project signal files (`package.json`, `*.csproj` at top or in `src/<project>/`, `Pulumi.yaml`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `pom.xml`, `composer.json`), it switches `workspace_kind` to `multi-project` and auto-populates `config.yaml`'s `projects:` array with inferred stack and commands.
- **Workspace template** (`templates/workspace/.tcgstackflow/`):
  - 4 agent profiles: `planner`, `coder`, `reviewer`, `ingester`.
  - 10 starter skills: `grill-task`, `plan-task`, `update-task-log`, `review-diff`, `ingest`, `lint-wiki`, `audit-workspace`, `migrate-to-gsf`, `generate-timesheet`, `submit-timesheet`.
  - 5 wiki starter pages: `index`, `log`, `project-overview`, `architecture`, `domain`, plus `adr/`.
  - 3 tool adapters: Claude Code (`CLAUDE.md`), Codex (`AGENTS.md`), GitHub Copilot (`copilot-instructions.md` + per-domain `instructions/`).
  - Two-file task tracking with strict invariant (`TASK {ID}.md` + `TASK details {ID}.md`, never split).
  - Governance (`governance.md`): four risk levels (LOW / MEDIUM / HIGH / CRITICAL) and the permission-request recipe.
  - Tempo timesheet flow as two skills (`generate-timesheet` LOW + `submit-timesheet` HIGH) with `submission_mode: approval | trust`.
- **Global template** (`templates/global/.tcgstackflow/`): `memory/` with `preferences`, `workflow-conventions`, `domain-knowledge`, `tools` Markdown files; `skills/` as the global tech-skill library home.
- **`/tcgflow-*` slash commands** — installed under `~/.claude/skills/` when the user opts in during init. See README.
- **15 Architecture Decision Records** capturing every substantive design call from scope through V1 implementation.
- `LICENSE` (MIT), `CONTRIBUTING.md`, this `CHANGELOG.md`, `package.json` with `geekstackflow` and `tcgflow` `bin` entries.

### Notes

- This release is suitable for personal use and small-team trials. OSS distribution is supported but not yet broadly tested in heterogeneous environments. See ADR 0001 for the personal-first → team-usable → OSS-ready ladder.
- The `migrate-to-gsf` skill packages the clean-cutover-with-backups pattern for moving an existing project off ad-hoc AI infrastructure onto `.tcgstackflow/`.
