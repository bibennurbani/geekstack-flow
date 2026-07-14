# Creative GeekStack Flow — Presentation Companion

> **A shared brain and a control panel for your AI coding tools.**
>
> *"A structured AI workflow for planning, coding, reviewing, testing, and shipping software — with project memory, task tracking, governance, and a local cockpit that runs your agents."*

This document is the written companion to the slide deck. It's pitched for a **mixed audience** — engineers plus management/stakeholders — so it leads with the value story and then goes into technical depth. Every number below was verified against the codebase on **2026-07-14** (see [Verified facts & sources](#appendix-a--verified-facts--sources)).

---

## At a glance

| | |
|---|---|
| **What it is** | A zero-dependency Node CLI (`geekstackflow` / `tcgflow`) that scaffolds and *orchestrates* a file-based AI-development workflow |
| **Version** | v0.3.0 — the "Orchestrator" release |
| **Runtime** | Pure Node ≥ 22, **0 runtime CLI dependencies** (qmd search adds ~2 GB of local models) |
| **Works with** | Claude Code, Codex, GitHub Copilot — one workflow, any tool |
| **The workspace** | `6` agent roles · `17` skills · `18` `tcgflow-*` commands · `4` risk levels · workspace schema `6` |
| **The Cockpit** | Local browser dashboard at `127.0.0.1:4729` — zero-dependency Node `http` server (~2,590 lines) + a single Vue 3 SPA (`App.vue`, 1,331 lines) |
| **Maturity** | 3 releases in under a month (0.1.0 → 0.3.0), **36 ADRs**, **167** passing tests |
| **Architecture** | No database — plain files are the single source of truth; nothing leaves your machine |

---

## Section 1 — The value story

### The two chronic problems with AI-assisted development

AI pair-programmers are fast, but two problems undermine them at team scale:

1. **Amnesia.** The AI starts every session from a blank slate. There's no durable project memory, so context is re-explained again and again.
2. **Ungoverned, inconsistent work.** Its output is ad-hoc, untracked, and unauditable — and it differs from one tool to the next and one developer to the next, with no shared lifecycle.

The result is **speed without a paper trail**: hard to trust, hard to audit, hard to scale to a team or a client engagement.

### The solution: one `init`, a shared brain + a cockpit

`geekstackflow init` scaffolds a `.tcgstackflow/` workspace into any repository. In one command a bare repo gains:

- an **AI-maintained memory wiki**,
- a strict **two-file task system**,
- **six agent roles** with a clear lifecycle,
- **risk-based governance**, and
- a local browser **Cockpit that also runs the agents**.

Everything is **plain files** — the workspace is the single source of truth that every tool and every teammate reads from. There's no SaaS to buy and no database to run.

### Who it's for

- Developers using **Claude Code, Codex, and/or GitHub Copilot**.
- Teams that want **consistent, auditable** AI-assisted delivery.
- Scope ladder (ADR 0001): **personal-first → team-usable → OSS-ready** — built for one author, designed so a teammate can adopt it on day one, and structured to become a public tool without re-architecting.

### Why adopt — five reasons

| # | Reason | Why a stakeholder cares |
|---|--------|--------------------------|
| 1 | **Memory compounds** — every shipped task makes the wiki smarter for the next one | ROI that grows over time |
| 2 | **The Cockpit actually runs agents** — press ▶ Run and it spawns your local `claude` CLI and streams live | It's a tool, not slideware |
| 3 | **Nothing leaves your machine** — binds `127.0.0.1` only, no login, no database | Security & compliance |
| 4 | **One workflow across tools** — Claude Code, Codex, Copilot dispatch the identical workflow | No lock-in, no per-tool retraining |
| 5 | **Governance is live, not advisory** — HIGH/CRITICAL actions pause for a browser approval and are recorded to the task log | Auditable safety |

---

## Section 2 — Architecture & memory

### The one load-bearing invariant: files are the single source of truth

Every architectural decision bends to one rule: **plain files are the only store — no parallel database, ever** (ADR 0004 / 0020 / 0024). Both the AI tools and the Cockpit read and write the same `.tcgstackflow/` files. The folder even doubles as an **Obsidian vault** — browsable, graph-viewable Markdown.

A subtle but important point: the rule was never "read-only," it was "no second store." That's precisely why the Cockpit could safely evolve from a viewer into a read-write orchestrator (ADR 0032) without violating anything.

### Anatomy of a workspace

```
your-project/
├─ .tcgstackflow/            ← per-project workspace (an Obsidian vault)
│  ├─ agents/                6 role profiles (Markdown)
│  ├─ skills/                17 atomic capabilities (SKILL.md)
│  ├─ commands/              18 tcgflow-* workflow dispatchers
│  ├─ tasks/                 active/ → completed/ → archive/
│  ├─ wiki/                  the LLM-wiki (memory) + log.md + index.md
│  ├─ runs/                  runs/{task-id}/{run-id}.md  (per-run audit)
│  ├─ governance.md          4 risk levels + project rules
│  └─ config.yaml            workspace_schema: 6
└─ tools/ → CLAUDE.md · AGENTS.md · .github/copilot-instructions.md
                              (generated adapters, all → .tcgstackflow/)

~/.tcgstackflow/             ← global cross-project home
├─ memory/                   4 cross-project memory files
├─ skills/                   shared tech-skill library
└─ projects.yaml             the machine's project registry (feeds the Cockpit)
```

**Multi-project is automatic:** `init` scans the top-level directories for signal files across **9 stacks** (JS/TS, .NET, Python, Go, Rust, Ruby, Java, PHP, Pulumi). The moment it finds 2+ codebases, it flips the workspace to multi-project and wires each sub-project's own test/lint commands — zero manual config.

### Memory that compounds — the LLM-wiki + qmd

- Flat, Obsidian-flavoured Markdown with heavy `[[wikilinks]]` and a Map-of-Content `index.md`, following **Karpathy's LLM-wiki pattern**.
- Operations vocabulary: **Ingest / Query / Lint**, plus a workspace **Audit**.
- **qmd** (Tobi Lütke's tool) is the *mandatory* hybrid search layer: keyword + vector + LLM re-rank (~2 GB local models). Every agent uses it to find the right pages; it complements `index.md`, never replaces it (ADR 0030).
- **Only the Ingester writes to the wiki** — one ingest may touch 10–15 pages.
- A **git pull-digest hook** auto-feeds upstream changes to the Ingester on every `git pull`, capturing *what changed*, *cross-project impact*, and a *plain-language summary* — so the wiki gains the meaning of work, not just a file list.

### The two-file task system

Every task is **exactly two files** — non-negotiable, never per-subtask files:

- **`TASK details {ID}.md`** — the plan: subtasks + sizes + acceptance criteria.
- **`TASK {ID}.md`** — an append-only YAML implementation log: `timestamp`, `author`, `summary`, `files`, `why`, `validation`, `tags`.

The load-bearing detail is the **`author:` field** — because one task can be *planned by Claude and coded by Codex*, the log records exactly which tool did each piece. That's how portability and auditability coexist. Tasks move `active/ → completed/ → archive/`.

---

## Section 3 — Agents & lifecycle

### Six agent roles, one assembly line

```
   planner → coder → reviewer → tester → ingester        (the linear pipeline)
                └──── refactorer ────┘                    (on-demand peer to the coder,
                                                            re-enters at Review)
```

**Task lifecycle:** `DRAFT → PLANNED → IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED` (with `BLOCKED` as a side state). The status of the task file decides **which agent acts next** — that's what powers the Cockpit's action queue.

The roles grew by evidence, not by plan: `4 → 5 → 6` across releases (Tester added in ADR 0028, Refactorer in ADR 0031).

### Two gates most workflows collapse into one

- **Reviewer = the STATIC gate:** reads the diff and asks *"is the code right?"*
- **Tester = the DYNAMIC gate:** runs the suites + the app and asks *"does it work?"*

`IN_REVIEW → IN_TEST → VALIDATED` are distinct activities at distinct stages. Nothing reaches the wiki as "done" until it has both passed review **and** been proven to run. (For refactor-typed tasks, the Reviewer's scope-drift blocker relaxes and the Tester becomes the real gate — prove behavior is unchanged.)

### Truly tool-agnostic — one workflow, any tool

One canonical source of skills/agents/wiki generates per-tool config: `CLAUDE.md`, `AGENTS.md` (Codex), and `.github/copilot-instructions.md` (Copilot) all point back at `.tcgstackflow/`. Commands live *inside* the workspace, so the workflow is portable — the `/tcgflow-*` slash commands are just Claude Code sugar (ADR 0019); other tools trigger the same workflow via natural language.

This decouples the process from any one vendor and sets up the **economic axis**: Claude plans and reviews (premium reasoning) while a cheaper tool can execute against a tight plan.

---

## Section 4 — Cockpit, orchestration & governance

### The Cockpit IS the Orchestrator

`geekstackflow ui` opens a local browser dashboard at `127.0.0.1:4729` (local-only, no auth). Read-only browsing was **retired** (ADR 0032) — you now launch agents from the browser. It has **7 per-project tabs**: Overview / Tasks / Wiki / Governance / Timesheet / Tools / Settings. "Copy prompt" is now just the manual fallback.

Engineering restraint worth noting: the whole server is a **zero-dependency, built-in Node `http`** server (~2,590 lines) bound to localhost, and the UI is a **single Vue 3 file** (`App.vue`, 1,331 lines). *(ADR 0022 originally named Hono; the shipped code substitutes built-in `http` — zero-dependency and testable without an install.)*

### Launch, watch, and run to completion

- Press **▶ Run** → spawns headless `claude` and streams output token-by-token over SSE. **Closing the tab does not kill the run.**
- **Continuation loop:** iteration 0 sends the role prompt; later iterations `claude --resume` the same session until the task advances or a **6-iteration cap** is hit. Tokens accumulate into one run record.
- **Chain mode** (⛓ "run to completion"): auto-advances `coder → reviewer → tester → ingester` until `INGESTED`, with a backward-bounce limit that defuses the classic coder↔reviewer infinite loop. An Approvals inbox + browser notifications mean unattended chains never wait unnoticed.
- **Concurrency:** 1 active run per project (the in-memory slot *is* the lock — no lockfile), unbounded across projects.
- **Crash-resilient:** orphaned runs are reconciled to "aborted at pause point" on next boot; a killed run never silently advances a task.

### Live governance — four risk levels, one modal

| Level | Meaning |
|-------|---------|
| **LOW** | Just do it |
| **MEDIUM** | Do it, log it |
| **HIGH** | Ask first |
| **CRITICAL** | Ask first **+ rollback plan** |

- HIGH/CRITICAL **pause the running agent** and long-poll (no timeout) for a browser **Approve/Deny**. The modal shows *Action / Risk / Why / Files / Rollback*; each decision is recorded to the task log.
- **Fails closed:** if the gate can't reach the Cockpit it denies; unknown/`mcp__*` tools default to **HIGH**; a compound command takes the **max** segment's level (a trusted prefix followed by `&& rm -rf` still maxes at CRITICAL); rules can only *raise*.
- **CRITICAL can't be one-clicked** — the server returns HTTP **428** without a rollback acknowledgement.
- **Degrades explicitly** per tool — the enforcement level is always shown as a badge: `mcp-intercept` (Claude) / `hook-command` (Copilot) / `sandbox-preset` (Codex) / `none`. Reduced governance is never silent.

Governance went from an informally-followed doc (ADR 0008) to **machine-enforced at runtime** (ADR 0027). "Deny" is non-fatal — recorded as *deferred to human*, and the run continues with what it can.

### Follow the money — session reports & spend

- Per-run token capture (input / output / cache-read / cache-write) recorded once per run.
- The **session report** parses the *real* Claude Code session JSONL into a per-turn trace, a "where the tokens went" view, and a **$-cost waterfall** (Opus list pricing: input $15 / output $75 / cache-write $18.75 / cache-read $1.50 per M tokens). Dollar cost appears in exactly one place, by design (ADR 0034).
- An optional **monthly budget** the Home hero flags against; the budget is re-checked at launch (closes a TOCTOU hole).
- **Never fabricates** — falls back to run totals when the trace isn't on the machine; exportable as standalone HTML.

### Grounded in reality — Jira drift & signal-driven tasks

- **Two statuses per task:** workspace status (our lifecycle) vs Jira status (the client's business truth). The Cockpit **flags drift** rather than hiding it.
- **Credential-free by design:** `sync-jira` (via the Atlassian MCP) writes a local `jira-cache.json`; the server only reads it — it never holds a credential.
- The Planner **never fabricates** — if it can't fetch a Jira ticket, it stops and asks.
- **External signals become tracked tasks:** `/tcgflow-task-from-snyk` (vulnerabilities), `-cypress` (failing/flaky specs), `-datadog` (incidents) each dedup and group at the source's natural unit.
- **Built-in rituals:** weekly Tempo timesheet (generate/submit), Jira sync, wiki lint (health-check), workspace audit.

---

## Section 5 — Maturity & the close

### Maturity — three releases, disciplined decisions

- **3 releases in under a month:** 0.1.0 (2026-05-31) → 0.2.0 (2026-06-01) → 0.3.0 (2026-06-25, the Orchestrator pivot) — with active development since.
- **36 ADRs** — every substantive call recorded; a living log that openly amends and reverses itself.
- **Evidence-first:** the wiki structure, task layout, and three-bucket model were reverse-engineered from real working AI workspaces, not theory.
- **Complexity deferred until earned:** manual handoff before automated, sequential before parallel, read-only before Orchestrator.
- **Non-destructive upgrades:** `.bak` backups, a drift report, and a CRITICAL gate before deleting old scaffolding.

### Test rigor — the safety story is tested

- **167** `node --test` tests (167 pass, 0 fail) across the server/CLI · **18** test files · **2,902** test lines.
- Two runners: `node --test` (server/CLI) + **vitest** (the Vue SPA).
- **Governance is the most-tested area** — 4 dedicated files (approvals, classify, integration, MCP).
- The largest test file exercises the highest-risk path: `run-executor.test.cjs` (~42 KB — the continuation loop).
- The invariant "no client can one-click a CRITICAL action" is asserted directly in tests.

### Where it's going — cost-spreading & new tools

- **Runner-adapter seam** (ADR 0035): a pure interface — adding Codex/Copilot is a parse+argv adapter, not a rewrite. Only Claude is registered today; an unknown tool is safely refused with HTTP 501.
- **Ship order by fidelity:** Claude (full parity) → Copilot (best governance, degraded stream) → Codex (sandbox-governed) → Antigravity (Copy-prompt only).
- **Cost-spreading thesis:** a per-role tool map lets Claude plan/review while a cheaper model codes — shipped **defaulted OFF** until real savings are measured.
- **Next rung:** team-usable → OSS-ready (MIT, npm `geekstackflow`), earning each complexity before adding it.

### Try it — ~5 minutes to a working workspace

```bash
geekstackflow init      # scaffold .tcgstackflow/ into any repo
geekstackflow ui        # open the Cockpit at 127.0.0.1:4729, then press ▶ Run
```

**The ask:** pick one real project this week, run one task end-to-end through plan → code → review → test → ingest, and watch the memory start compounding. Then adopt it as a team — it's day-one ready by design.

---

## Glossary

| Term | Definition |
|------|------------|
| **geekstackflow / tcgflow** | Creative GeekStack Flow — a zero-dependency Node CLI (v0.3.0, two bin names) that scaffolds and orchestrates a file-based AI-development workflow. |
| **`.tcgstackflow/`** | The per-project workspace folder `init` scaffolds (agents, skills, commands, tasks, wiki, runs, governance.md, config.yaml) — doubling as an Obsidian vault. |
| **LLM-wiki** | The AI-maintained, token-efficient project memory: flat Obsidian-flavoured Markdown with `[[wikilinks]]` and a Map-of-Content `index.md`, following Karpathy's pattern. Only the Ingester writes to it. |
| **qmd** | The mandatory hybrid wiki-search layer (keyword + vector + LLM re-rank, ~2 GB local models) every agent uses to find pages; complements `index.md`. |
| **Two-file task system** | Every task is exactly two files — a plan (`TASK details {ID}.md`) and an append-only YAML log (`TASK {ID}.md`); never split per-subtask. |
| **Six agent roles** | planner → coder → reviewer → tester → ingester (linear) plus an on-demand Refactorer peer to the Coder that re-enters at Review. |
| **Reviewer vs Tester** | Two distinct gates: the Reviewer is static ("is the code right?"); the Tester is dynamic ("does it work?"). |
| **Task lifecycle** | DRAFT → PLANNED → IN_PROGRESS → IN_REVIEW → IN_TEST → VALIDATED → INGESTED, with BLOCKED as a side state; status drives which agent acts next. |
| **Cockpit / Orchestrator** | The local browser dashboard (`geekstackflow ui`, `127.0.0.1:4729`) that also launches agents, streams runs live, gates risky actions, and tracks spend — no longer read-only (ADR 0032). |
| **Continuation loop** | How a Run is driven: iteration 0 sends the role prompt, later iterations `claude --resume` until the task advances or a 6-iteration cap; tokens accumulate into one run record. |
| **Auto-advance chain** | "Run to completion" — a chained Run that launches the next lifecycle role on handoff until INGESTED/BLOCKED or it bounces backward past the limit. |
| **Governance risk levels** | Four levels — LOW / MEDIUM / HIGH / CRITICAL — machine-enforced live via a browser approve/deny modal. |
| **Fidelity / gate model** | Per-tool governance parity that degrades explicitly, shown as a Cockpit badge: `mcp-intercept` / `hook-command` / `sandbox-preset` / `none`. |
| **Run record** | An immutable per-run transcript at `runs/{task-id}/{run-id}.md` with frontmatter (role, session_id, tokens, terminal state, git_base). |
| **Runner adapter** | A pure per-tool module (buildSpawn / parseLine / resumeIdFrom) that teaches the Orchestrator to drive a headless tool; only Claude is registered today (unknown tool → HTTP 501). |
| **Session report** | A per-task post-mortem parsing the real Claude Code session JSONL into a token trace and a dollar-cost waterfall — the one place $ cost is shown; never fabricated. |
| **Workspace status vs Jira status** | Two statuses per task — our lifecycle vs the client's Jira business state — with the Cockpit flagging drift; Jira arrives via a credential-free local cache. |
| **Pull digest** | A Raw file the git hook writes after every `git pull` so the Ingester keeps the wiki current automatically. |
| **ADR** | Architecture Decision Record — 36 of them trace the tool's evidence-first evolution; later ADRs openly amend earlier ones. |

---

## Appendix A — Verified facts & sources

All figures verified against the working tree on 2026-07-14:

| Claim | Value | Source |
|-------|-------|--------|
| Version | 0.3.0 | `package.json` |
| Runtime | Node ≥ 22.0.0 | `package.json` engines |
| Agent roles | 6 | `templates/workspace/.tcgstackflow/agents/` |
| Skills | 17 | `templates/workspace/.tcgstackflow/skills/` |
| Commands | 18 | `templates/workspace/.tcgstackflow/commands/` |
| Workspace schema | 6 | `init.js` `LATEST_SCHEMA = 6` |
| ADRs | 36 | `docs/adr/*.md` (up to 0036) |
| Tests | 167 pass, 0 fail | `node --test` (the CHANGELOG's "62" is **stale**) |
| Test files / lines | 18 files / 2,902 lines | `test/` |
| Cockpit server | zero-dependency built-in Node `http`, ~2,590 lines, 12 `.cjs` files | `ui/server/` (**not** Hono, despite ADR 0022) |
| Cockpit SPA | Vue 3 + Vite, `App.vue` = 1,331 lines | `ui/src/App.vue`, `ui/package.json` |
| Cockpit port | `127.0.0.1:4729` | `ui/server/index.cjs` `DEFAULT_PORT`; binds localhost only |
| Cockpit tabs | 7 (Overview/Tasks/Wiki/Governance/Timesheet/Tools/Settings) | `ui/src/App.vue` |
| Multi-project stacks | 9 (JS/TS, .NET, Python, Go, Rust, Ruby, Java, PHP, Pulumi) | `init.js` `analyseProject()` |
| Release dates | 0.1.0 2026-05-31 · 0.2.0 2026-06-01 · 0.3.0 2026-06-25 | `CHANGELOG.md` |

## Appendix B — Bonus: where the Cockpit reads the "list of applications"

The machine-wide list of applications shown in the Cockpit Home / left-nav is the **project registry**, not anything committed to a repo:

- **Source:** `~/.tcgstackflow/projects.yaml` — a per-machine `projects:` list of `{ name, path, last_opened }`.
- **Read:** `readProjectRegistry()` (`init.js:155`).
- **Project into UI shape:** `buildProjectsList()` (`ui/server/read.cjs:302`) — adds `exists`, `workspace_schema`, `update_available`, `stale_wiki`.
- **Serve:** `GET /api/projects` (`ui/server/index.cjs:141`).
- **Render:** `loadHome()` paints them into `#projlist` (`ui/server/index.cjs:385`).
- **Write:** `registerProject()` (`init.js:193`) — `geekstackflow init` adds/updates an entry (dedup by resolved path).

> Do **not** confuse it with the `projects:` block *inside* a single workspace's `.tcgstackflow/config.yaml` (parsed at `read.cjs:76–82`) — that is the **sub-projects of one multi-project workspace**, a different list.
