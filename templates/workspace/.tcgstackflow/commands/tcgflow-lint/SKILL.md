---
name: tcgflow-lint
description: Run the lint-wiki skill — periodic health-check of the LLM-wiki. Detects contradictions across pages, stale claims, orphan pages, important concepts missing their own page, missing cross-references, and broken wikilinks. Produces a report appended to wiki/log.md; proposed fixes route through /tcgflow-ingest. Run on demand or weekly.
---

# `/tcgflow-lint` — health-check the wiki

## When to use

The user typed `/tcgflow-lint` or said *"lint the wiki"*, *"audit the wiki"*, *"find stale pages"*. Or it's the scheduled weekly check.

## What to do

Run the `lint-wiki` skill (see `.tcgstackflow/skills/lint-wiki/SKILL.md` for full procedure):

1. **Build the wikilink graph** by walking every page under `wiki/` (excluding `adr/`). Record for each: outbound `[[wikilinks]]`, `aliases`, `title`, `updated`, and a one-line topic summary.

2. **Run each detector:**
   - Contradictions between pages (same fact stated differently)
   - Stale claims (page `updated:` older than most recent ingest that should have touched it)
   - Orphan pages (no inbound links — excluding `index.md`, `log.md`, `adr/README.md`)
   - Concepts without their own page (capitalised multi-word phrases appearing in ≥2 pages)
   - Missing cross-references (page mentions another concept by name but doesn't link)
   - Data gaps (broken `[[wikilinks]]`, literal `TODO`/`TBD`/`FIXME` markers)

3. **Append the report** to `wiki/log.md` using the prefix `## [YYYY-MM-DD] lint | {scope}` and the structured shape (Context / Findings grouped by detector / Decision).

4. **Surface the top 5 findings inline** to the user, ordered by impact.

5. **Wait for direction.** Each fix the user picks routes through `/tcgflow-ingest` — that's where the approval gates for new pages and deletions kick in.

## Anti-patterns

- **Silently fixing findings.** Lint produces a report, not a diff. Fixes route through ingest.
- **Lint as a substitute for ingest.** Lint surveys; ingest folds in new Raw. They're different operations and the log distinguishes them by prefix.
- **False-positive contradictions.** If two pages disagree because they describe two different things with overlapping names, that's a domain ambiguity → log under `wiki/domain.md`'s Flagged Ambiguities, not a contradiction.

## Notes

- For multi-project workspaces, lint can be scoped: `/tcgflow-lint {project-name}` filters findings to pages where `frontmatter.project == {project-name}` (or pages with no project tag that link to project-tagged pages).
