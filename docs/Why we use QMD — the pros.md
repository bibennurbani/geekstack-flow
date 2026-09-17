Why we use QMD — the pros

- Recall that survives wiki growth. Hand-navigation (open index.md, follow wikilinks) misses relevant pages the Map of Content doesn't surface and no single link path reaches. That's the whole reason it got promoted from optional to mandatory.
- Semantic, not full-text. Keyword + embeddings + re-rank finds a page about the same concept under different wording — plain grep can't. CONTEXT.md explicitly bans raw grep over wiki bodies as a discovery method.
- Local and free at runtime. Models live in ~/.cache/qmd, the index in SQLite. No API calls, no cloud service, no database dependency — ADR 0024's "run state in files, no database" stays intact.
- Tool-portable. The CLI is canonical (qmd query --json, search, vsearch, get), so the exact same wiki-search skill works for Claude Code, Codex, and Copilot. The qmd MCP is just an optional Claude convenience, not the contract.
- One shared skill, not six copies. wiki-search/SKILL.md encapsulates ensure-ready → query, so all six agent profiles reference one place instead of duplicating
  retrieval logic.
- Project-local isolation (ADR 0038). qmd init creates a gitignored .qmd/ at the workspace root, so -c wiki means this project's wiki. This fixed a real, silent
  correctness bug — collection names are a machine-wide global namespac that 3 of 5 registered projects were searching another project's wiki.Names stay stable; the fix lives in setup, not usage.
- Freshness is deterministic, not hoped-for (ADR 0036). The orchestratover post-step after a clean ingester run — non-blocking, recorded in the run record as embed: { ran, exit, skipped }. It doesn't depend on the agent remembering. The post-merge hook covers wiki edits that land outside any orchestrated run.
- Auditable discipline (ADR 0037). Each run records wiki_discovery (qmd vs index-fallback), surfaced as a Cockpit badge — so "agents actually lead with qmd" is
  measurable, not aspirational.
