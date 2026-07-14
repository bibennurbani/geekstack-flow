---
name: wiki-search
description: Find relevant LLM-wiki and docs/ content via qmd (local hybrid keyword+vector+rerank search) before reading or editing the wiki. The canonical discovery layer every agent uses — qmd surfaces which pages are relevant, then you open them and follow [[wikilinks]] one hop. Use when searching notes, finding related content, or retrieving documents from the indexed wiki/docs collections. Falls back to index.md Map-of-Content navigation when qmd is unavailable.
---

# Wiki Search (qmd)

## When to use this skill

Invoke this skill **whenever an agent needs to find content in the LLM-wiki or the project's `docs/`** — before reading wiki pages for context (Planner/Coder/Reviewer/Tester), before deciding which pages an ingest touches (Ingester), or whenever the user asks a question answered *from* the wiki (a Query).

This is the **discovery layer**, not a replacement for the wiki's structure: qmd finds *which* pages are relevant; you then open those pages and follow their `[[wikilinks]]` one hop. `wiki/index.md` remains the Map of Content and the always-current fallback.

**Do not** use this skill to edit the wiki (that's `ingest`) or to search source code (use the normal code-search tools — qmd indexes Markdown knowledge, not the codebase).

## Instructions

### How qmd indexes (why structure matters)

qmd chunks each Markdown file into ~900-token pieces, breaking at headings (H1/H2 score highest) and code fences; frontmatter indexing is *not* guaranteed. So retrieval quality is driven by structure: clear `##`/`###` sections (each a clean, self-contained chunk under ~900 tokens) and a lead summary sentence in the body's first chunk both retrieve far better than walls of prose. This applies to anything you index, not just the wiki — well-sectioned docs and ad-hoc collections search well, monolithic ones don't. For the full page convention (frontmatter `summary`, tag taxonomy, authoring rules), see the [ingest skill](../ingest/SKILL.md) — its **"Wiki page authoring (qmd-optimized)"** section is the source of truth.

### 1. Ensure qmd is ready (cheap precondition check)

The workspace is set up by `init`/`upgrade` so qmd is normally already installed and the collections embedded. Verify, in order:

1. **Binary present?** `qmd --version`. If the command is missing, qmd is not installed. Installing it (`npm install -g @tobilu/qmd`, ~2 GB of local models) is a **HIGH action** per `governance.md` — issue a permission request before running it. If the user declines or install fails, **fall back to `index.md` navigation** (read `wiki/index.md`, follow `[[wikilinks]]`) and tell the user "qmd unavailable — using the Map-of-Content fallback." Do not fabricate search results.
2. **Collections registered?** `qmd collection list`. The workspace expects a `wiki` collection (`.tcgstackflow/wiki/`) and, when the project has a `docs/` directory, a `docs` collection. Register any missing one with `qmd collection add <path> --name <name> --mask "*.md"` (the `--mask` keeps qmd indexing Markdown only, not stray files). `init` also runs `qmd context add qmd://<name> "<desc>"` for the wiki/docs collections — a one-line collection description that improves retrieval; set one if a collection is missing it.
3. **Index fresh?** The Ingester re-embeds after every ingest, so reads are normally current. If you have reason to believe the index is stale (you just edited pages, or a search returns obviously missing content), run an incremental `qmd embed`.

### 2. Search (CLI is canonical)

The CLI works identically across Claude, Codex, and Copilot, so it is the canonical interface:

```bash
qmd query "<your question>" -c wiki --json -n 8      # hybrid: BM25 + vector + rerank (default choice)
qmd search "<exact phrase>"  -c wiki --json          # keyword/BM25 only — for known terms/identifiers
qmd vsearch "<concept>"      -c wiki --json          # pure semantic — for fuzzy "something about X"
```

- Scope with `-c wiki` (or `-c docs`) to the right collection; omit `-c` to search all collections.
- `--json` for machine-readable hits; `--files` for `docid, score, filepath` lines; `--full` to inline page content.
- Default to `query` (hybrid). Reach for `search` when you know the exact term, `vsearch` for vague conceptual lookups.

**Claude convenience (optional):** when the qmd MCP is wired (`config.yaml` `mcp.recommended`), Claude may call the MCP tool instead of shelling out — same results. Nothing depends on the MCP; the CLI is the portable baseline.

### 3. Open and drill in

1. Open the top-ranked pages qmd returned (`qmd get "<filepath>"` or read the file directly).
2. Follow their `[[wikilinks]]` **one hop** to catch directly-related pages.
3. If results look thin, **refine before you retreat**: switch `query`↔`search`↔`vsearch` or sharpen the query (per the retrieval-budget rule below) — a mediocre first result set is not grounds to abandon qmd. Only if a refined search still comes up short (or the index is genuinely stale) do you fall back to `wiki/index.md` and navigate the Map of Content by hand — it is always current.

**Retrieval budget (the token-efficiency contract).** Default to `-n 8` hits and **open only the pages you'll actually use** — a hit's score + `summary` tells you if it's relevant before you read the body. Traverse `[[wikilinks]]` **one hop**, not transitively. The entire point of qmd is to avoid loading the wiki into context, so **never read every page "to be safe."** If the top hits don't cover the question, *refine the query* (or switch `query`↔`search`↔`vsearch`) before widening `-n`.

### Index anything (ad-hoc)

qmd is not limited to the wiki/docs collections — point it at any folder of Markdown to make it searchable. The recipe:

```bash
qmd collection add <path> --name <name> --mask "*.md"   # register the folder (Markdown only)
qmd context add qmd://<name> "<one-line description>"   # optional — a collection description that improves retrieval
qmd embed                                                # build/refresh the embeddings
qmd query "<your question>" -c <name> --json             # search the new collection
```

Health and maintenance:

- `qmd status` — collection health (counts, embed freshness); run it when results look off.
- `qmd update` — re-index a collection after its files change (or `qmd embed` for an incremental embed).

### Output

The relevant page set for the task at hand — not narration. Use the content to do the real work (plan, code, review, test, ingest).

## Anti-patterns

- **Grepping the wiki by hand to discover pages.** A raw full-text `grep`/`rg` over wiki page *bodies* misses semantically-relevant pages no wikilink path reaches, and it is **never** the fallback — the **only** sanctioned non-qmd discovery is structured `index.md` + `[[wikilink]]` navigation. The discovery path each run takes is recorded in the run record (ADR 0037), so this is auditable; a query-time gate that would soft-deny a pre-qmd wiki body-grep is designed but deferred until that record shows it's needed. (The `grep "^## \[" log.md` timeline read is a *structural log* operation, not discovery — it stays fine.)
- **Treating qmd as the only way in.** It is the discovery layer; `index.md` + `[[wikilinks]]` remain the structure and the *sanctioned* fallback when qmd is declined, missing, or stale.
- **Silently installing qmd.** The global install + 2 GB model download is HIGH — request permission first.
- **Trusting a stale index.** Right after an ingest the index should be fresh (the Ingester re-embeds); if you suspect drift, `qmd embed` before searching.
- **Fabricating a fallback.** If qmd is unavailable and you can't navigate `index.md` either, say so — never invent page content.
