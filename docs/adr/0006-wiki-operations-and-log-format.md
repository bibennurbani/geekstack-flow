# Wiki Operations are Ingest / Query / Lint, with a locked log-entry prefix

> **Amended by ADR 0030 / 0036 / 0037.** The **Query** operation described here now routes through the mandatory **qmd** discovery layer (0030), whose index the orchestrator keeps fresh deterministically (0036) and whose discovery path is recorded per run — with a query-time gate designed but deferred (0037). The locked `## [` log prefix and the `grep "^## \[" log.md` timeline read below are unchanged and remain a *structural log* operation (explicitly not "grep-the-wiki" discovery — see 0037).

Karpathy's LLM-Wiki gist defines three operations on a wiki: **Ingest** (fold a Raw source into wiki pages), **Query** (answer a question from the wiki, optionally filing the answer back), and **Lint** (periodic health-check for contradictions, stale claims, orphan pages, missing cross-references). V1 adopts all three as named operations, each producing a `log.md` entry using the prefix `## [YYYY-MM-DD] {operation} | {title}`. This prefix is **locked** — it lets simple grep tools (`grep "^## \[" log.md | tail -5`) return the wiki's recent history without parsing markdown.

## Operation specs

### Ingest
- **Trigger:** completed task, files dropped into `raw/`, MCP-driven investigation, or explicit user request.
- **Procedure:** inventory → plan → draft log entry first → apply existing-page updates → ASK before creating new pages or deleting → archive Raw to `raw/archived/`.
- **Approval gate:** updates to existing pages flow without approval; new pages and deletions require explicit user OK. (See ADR 0007.)
- **Scope:** a single ingest may touch 10–15 wiki pages — the ingester does not artificially minimise edits.

### Query
- **Trigger:** user asks a question.
- **Procedure:** read `index.md`, find relevant pages, synthesise an answer with citations.
- **Filing back:** if the answer is wiki-worthy (a comparison, an analysis, a synthesis), propose it as a new page using the same approval gate as Ingest.

### Lint
- **Trigger:** explicit user request, or scheduled (e.g. weekly).
- **Detects:** contradictions across pages; stale claims newer Raw has superseded; orphan pages (no inbound links); important concepts mentioned across multiple pages but lacking their own; missing cross-references; data gaps that suggest new Raw to seek.
- **Output:** a `## [YYYY-MM-DD] lint | {scope}` log entry plus a report of proposed fixes. Lint never rewrites silently.

## qmd compatibility

qmd (Tobi Lütke's local search engine) indexes arbitrary markdown without imposing structural constraints. To wire it in, V1's init command generates:
- A `qmd.yml` collection config pointing at `.tcgstackflow/wiki/` (and optionally `tasks/archive/` for completed-task search).
- A `qmd` MCP entry in the per-tool adapter for Claude Code and any other tool with MCP support, so the AI can call `query` natively instead of shelling out.

## Consequences

- The Ingester agent profile includes the locked log-entry prefix and the three-step procedure (inventory → plan → log-first → apply).
- A new skill `lint-wiki` is added to the V1 starter set.
- Stable file paths matter (qmd uses paths as IDs). Page renames require alias frontmatter to preserve backlinks.
- The Karpathy gist itself is referenced from CLAUDE.md / AGENTS.md as the canonical statement of intent.
