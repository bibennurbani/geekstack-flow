# qmd is the mandatory wiki/docs search layer, complementing (not replacing) the Map-of-Content

Until now [qmd](https://github.com/tobi/qmd) was an *optional* convenience — listed under `mcp.recommended` in `config.yaml` and described in the tool adapters as search "when wired as an MCP." Agents otherwise navigated the wiki by hand: open `index.md`, follow `[[wikilinks]]`. As wikis grow, hand-navigation misses relevant pages that the Map of Content doesn't surface and that no single wikilink path reaches. This ADR promotes qmd to a **required** capability and makes it the canonical discovery layer over the LLM-wiki and the project's own `docs/`.

## Design

- **Mandatory, auto-installed by the init *flow* (not the script).** `init.js` the script stays dependency-free by design — it cannot install deps (a stated invariant). So the script only scaffolds the `wiki_search` config block (shipped in the template; a schema-2→3 migration injects it into existing workspaces) and prints the setup next-step. The **`/tcgflow-init` AI command** then performs the permission-gated install + indexing — a HIGH action (`npm i -g @tobilu/qmd` + ~2 GB local models per `governance.md`) — followed by `qmd collection add` for `.tcgstackflow/wiki/` and the project's `docs/` when present (each sub-project's `docs/` in a multi-project workspace), then a first `qmd embed`. The `wiki-search` skill is the runtime safety net if either is still missing.
- **One shared `wiki-search` skill.** A single skill encapsulates "ensure-ready → query" so the logic isn't duplicated across the six agent profiles. The **CLI is canonical** (`qmd query --json …`, plus `vsearch`/`search`/`get`) so the capability is tool-portable to Codex and Copilot via shell; the qmd **MCP is optional** for Claude (ADR 0019: workflows are tool-portable, the MCP/slash UX is per-tool). All agents reference this one skill.
- **Complement, not replace.** qmd is the *entry point* — it finds *which* pages are relevant; the agent then opens those pages and follows `[[wikilinks]]` one hop. `index.md` remains the curated Map of Content and the **always-current fallback** when the index is stale or qmd is unavailable. The carefully-grown wiki structure and wikilink graph (ADR 0003) are preserved.
- **Index freshness = the writer re-indexes.** An incremental `qmd embed` of all collections runs at `init`/`upgrade` and as the **Ingester's final step** (the Ingester is the only wiki writer; it touches 10–15 pages per ingest). `docs/` edits made by the Coder during a task are picked up at the next ingest; the periodic Lint is the backstop for `docs/` changed outside any task flow.

## Considered options

- **(A) Mandatory + complement + auto-install** — *chosen*. Honors the user's "always use qmd" intent without throwing away the Map-of-Content design, and avoids a hard stop when qmd is merely not-yet-installed (init makes it present).
- **(B) Keep it optional ("when wired")** — rejected: the status quo; leaves retrieval quality to whether each workspace bothered to wire the MCP, and recall degrades as wikis grow.
- **(C) qmd *replaces* `index.md` navigation entirely** — rejected: discards the curated MoC + wikilink graph the Ingester maintains, and trusts a sometimes-stale index as the only way in.
- **(D) Hard requirement, stop-and-ask if absent** (the Atlassian-MCP pattern) — rejected as the *default*: too brittle for a capability we can simply install. The stop-and-ask fallback only applies if auto-install is declined or fails.

## Consequences

- New required dependency: **Node ≥ 22, ~2 GB disk for models, `brew install sqlite` on macOS.** Documented in `INSTALL.md`/`QUICKSTART.md`. Workspaces that decline the install fall back to `index.md` navigation (not fabrication — it's the original method), and the `wiki-search` skill surfaces a one-line "qmd unavailable, using Map-of-Content fallback."
- `config.yaml` keeps `qmd` under `mcp.recommended` (the optional Claude MCP) and gains a small `wiki_search` block (collections + embed-on-ingest). A `workspace_schema` bump (ADR 0021) covers the new setup so `upgrade` installs/registers/embeds for existing workspaces.
- All six agent profiles list `wiki-search` under "Skills used" and replace their hand-navigation wording with "qmd-first, then read + one wikilink hop, `index.md` fallback." The Ingester gains the re-embed step.
- The tool adapters (`CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md`) drop the "when wired"/optional framing for a "qmd is how you search the wiki" instruction.
- CONTEXT.md gains the **Wiki search (qmd)** term and updates the **Query** operation to route through it.
