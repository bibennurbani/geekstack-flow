# Wiki structure grown from real examples, not from the master-prompt template

The master prompt specified 21 pre-created wiki pages and a `raw/` + `llm-wiki/` split. Inspecting two real working wikis the author already uses (`SaeDigital/run-by-strength/docs/` and `INX/ai-mem/docsRef/`) shows that neither matches that template: both are flat Obsidian-style directories, neither has a `raw/` folder (Raw comes from codebase + task files + MCP outputs), and most of the 21 pre-named pages do not exist in real use. V1 therefore ships with a small starter set of pages plus a domain-driven growth model — new pages are born during ingestion as the project demands them, not pre-created as empty stubs.

## Considered options

- **Pre-create the master-prompt's 21-page template** — rejected: most of those pages never get populated in real working wikis, and pre-created stubs accumulate stale frontmatter that misleads the AI about what's actually known.
- **Pre-create a minimal 5-page starter, grow on demand** — *chosen*. The starter set is the union of pages that appeared in both real examples: `index.md`, `log.md`, `project-overview.md`, `architecture.md`, `domain.md`, plus an `adr/` subfolder.
- **Empty wiki, create pages only during first ingest** — rejected: a few starter pages give the AI an anchor for early sessions and let `index.md` start as a working Map of Content rather than an empty file.

## Consequences

- V1 wiki is `.tcgstackflow/wiki/` (flat, no `raw/` subfolder), with `index.md`, `log.md`, `project-overview.md`, `architecture.md`, `domain.md`, and `adr/`.
- The ingest skill is responsible for *creating new wiki pages* when the topic doesn't fit an existing page — not just appending to existing ones.
- Frontmatter follows the Obsidian-style schema (`title`, `tags`, `aliases`, `priority`, `created`, `updated`, `status`) from the real examples. The master prompt's `confidence` / `source_count` / `related_sources` fields are dropped — they are aspirational and not used in either real wiki.
- `log.md` is format-locked to the run-by-strength append-only pattern (`## YYYY-MM-DD — title`, then `**Context:**`, `**Created/Modified/Deleted:**`, `**Decision:**`) and is the wiki's authoritative history-of-itself.
