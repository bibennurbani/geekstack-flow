---
name: lint-wiki
description: Periodic health-check of the LLM-wiki. Detects contradictions across pages, stale claims newer Raw has superseded, orphan pages with no inbound links, important concepts mentioned without their own page, missing cross-references, and data gaps — plus qmd-friendliness best-practice checks (missing summary, incomplete or off-taxonomy frontmatter, poor chunking structure, missing aliases) against the ingest skill's authoring standard. Produces a report appended to `wiki/log.md` and proposes fixes — never silently rewrites. Run on demand or weekly. Used by the Ingester agent.
---

# Lint Wiki

## When to use this skill

Invoke this skill when:

- The user asks for a wiki health-check ("lint the wiki", "audit the wiki", "find stale pages").
- A scheduled ritual fires (e.g. weekly Friday afternoon — a hook or a cron the user has set up).
- After a large ingest where you suspect downstream pages drifted.

**Do not use this skill** as part of a routine ingest — that's the `ingest` skill's job. Lint is a separate operation that surveys the wiki as a whole.

## Instructions

You are surveying the entire wiki and producing a report. Lint never edits pages without explicit user approval — it produces a `lint` entry in `wiki/log.md` plus a findings list, and the user decides which fixes to apply (each fix going through the `ingest` skill's approval gate).

### Procedure

1. **Build the wikilink graph.** Walk every `.md` file under `wiki/` (excluding `adr/` — ADRs are mostly self-contained and don't need lint cross-checks). For each page, record:
   - Outbound `[[wikilinks]]`
   - `aliases` and `title` from frontmatter
   - `updated` date
   - One-line topic summary (first non-frontmatter line or H1)
2. **Run each detector** (below). Collect findings.
3. **Append the report.** One `## [YYYY-MM-DD] lint | {scope}` entry to `wiki/log.md` (scope = `full-wiki` or a narrower descriptor like `architecture-and-data-model`). List every finding, grouped by detector, with a one-sentence proposed fix per finding.
4. **Surface the top 5 findings inline** to the user, ordered by impact. The full report stays in the log entry.
5. **Wait for direction.** The user picks which findings to fix. Each fix routes through the `ingest` skill — that's where the approval gates for new pages and deletions kick in.
6. **Re-embed the wiki search index.** After producing the report, run an incremental `qmd embed` to refresh the wiki search index — Lint is the backstop for `docs/` changed outside a task flow. If qmd is unavailable, note it — `index.md` stays the fallback.

### Detectors

#### 1. Contradictions

Two or more pages state the same fact differently (e.g. one page says "Strava uses OAuth 2.0", another says "Strava uses OAuth 1.0a"). Detected by:

- Comparing frontmatter `tags` and `aliases` across pages to find topic-overlapping pairs.
- For each pair, looking for sentences that share named entities but differ on numbers, dates, or technology names.

**Severity:** `blocker` if the contradiction is about a current fact; `nit` if it's a stale-vs-current mismatch (use the stale-claims detector instead).

#### 2. Stale claims

A page's `updated` frontmatter is older than the most recent `log.md` ingest entry that should have updated it. Detected by:

- For each page, find the most recent `log.md` entry that lists the page in its `Modified` or `Created` section. Compare to page's `updated`.
- For each page, find `log.md` entries since `updated` that touched the page's topic but didn't list the page. Surface these as potentially-missed updates.

**Severity:** `major` if the page was demonstrably skipped by a recent ingest; `nit` if just old without evidence of skipped updates.

#### 3. Orphan pages

A page with **no inbound `[[wikilinks]]`** from any other wiki page (excluding `log.md`, which doesn't count as a navigation source). Detected by:

- Counting inbound links per page in the graph.
- Excluding the canonical entry pages (`index.md`, `log.md`) and ADR README from orphan detection.

**Severity:** `major` — orphans are unreachable from the index and likely dead.

#### 4. Concept-without-page

A term mentioned in two or more pages but lacking a page of its own (e.g. "RaceProfile" appears in `architecture.md` and `data-model.md` but has no `race-profile.md`). Detected by:

- Identifying capitalised multi-word phrases (likely domain concepts) appearing in ≥2 pages.
- Cross-checking against `aliases` to avoid false positives for terms that are already represented under a different name.

**Severity:** `nit` — proposes a new page; the Ingester's approval gate decides.

#### 5. Missing cross-references

Page A mentions concept B by name but doesn't link to B's page. Detected by:

- For each page, scanning prose for terms that match another page's `title` or `aliases`. If found and no `[[wikilink]]` is present, flag it.

**Severity:** `nit` — proposes adding the wikilink at the specific location.

#### 6. Data gaps

A page mentions "see [[deployment]]" or "TODO: document the X flow" but the referenced page doesn't exist or the TODO is unresolved. Detected by:

- Broken `[[wikilinks]]` (links pointing at non-existent pages or aliases).
- Literal `TODO:`, `TBD`, `FIXME` markers in page prose.

**Severity:** `major` for broken wikilinks (qmd uses paths as IDs); `nit` for TODO markers.

The detectors below check pages against the authoring standard in the `ingest` skill's [Wiki page authoring (qmd-optimized)](../ingest/SKILL.md#wiki-page-authoring-qmd-optimized) section — the frontmatter schema, the tag taxonomy, and the qmd-chunking authoring rules. They are best-practice / search-quality checks, not factual-drift checks. They are **report-only** like every other detector: Lint flags them, the user decides, and the fix routes through `ingest`.

#### 7. Missing or empty summary

A page lacks the `summary:` frontmatter field, or has it empty/placeholder. Per the authoring standard every page needs a one-sentence `summary` because qmd's frontmatter indexing is not guaranteed — the summary sentence lands in the body's first chunk and gives BM25 and the embedding a strong, accurate signal (and doubles as the human-readable preview). Detected by:

- Checking each page's frontmatter for a non-empty `summary:` value.
- Cross-checking that the lead paragraph under the `# Title` restates the summary in prose (the strongest-embedding first chunk). A page with the field but no lead paragraph is a partial finding.

**Severity:** `major` — a missing summary measurably degrades retrieval for that page.

#### 8. Incomplete or off-taxonomy frontmatter

A page's frontmatter is missing a required field, or its `tags` drift from the recommended taxonomy. Detected by:

- **Missing required fields** — check each page for `title`, `tags`, `status`, and `updated`. (`summary` is covered by detector 7.)
- **Off-taxonomy tags** — flag pages whose `tags` contain no recognised **kind** tag (`overview` · `architecture` · `domain` · `feature` · `integration` · `operations` · `decision` · `testing` · `meta`), or carry more than ~4 tags (tag sprawl).
- **Near-duplicate tags** — compare tags across the whole wiki for near-duplicates that should be consolidated (e.g. `frontend` vs `front-end` vs `ui`, singular vs plural). Consistency beats coverage.

**Severity:** `major` for a missing required field; `nit` for off-taxonomy or near-duplicate tags (proposes consolidation).

#### 9. Poor chunking structure

A page won't chunk cleanly for qmd, which breaks Markdown into ~900-token pieces at headings and code fences. Detected by:

- **Wall of prose** — a section (or a whole page) with a long run of body text and no `##`/`###` subheadings to break it into coherent chunks. Flag sections that run well past ~900 tokens (roughly a few screens) without a subheading.
- **Missing lead summary paragraph** — no 1–2 sentence prose paragraph directly under the `# Title` (the page's strongest-embedding first chunk). Overlaps with detector 7's lead-paragraph check; report under whichever is the primary gap.
- **Oversized code block** — a single fenced code block large enough to dominate a chunk and crowd out prose.

**Severity:** `nit` — proposes adding `##`/`###` subheadings to split the section, or splitting a sprawling page into linked sub-pages.

#### 10. Missing aliases for synonyms

A page whose `title` has common synonyms or alternate names carries no `aliases:` frontmatter (and doesn't surface those synonyms in the body prose). Per the authoring standard, synonyms belong both in `aliases` and in the body so keyword search resolves them. Detected by:

- For each page, checking whether other pages, `log.md` entries, or the page's own prose refer to its concept by an alternate name not listed in `aliases`.
- Flagging acronym/expansion pairs (e.g. a page titled "Monitoring Program" referenced elsewhere as "MP") that appear nowhere in `aliases` or body prose.

**Severity:** `nit` — proposes adding the alternate names to `aliases` and surfacing them in prose.

### Output

Short user-facing summary:

> **Lint complete** — found N findings across M pages.
>
> **Top 5 by impact:**
>
> 1. {Detector} — {one-line description} — proposed fix: {one line}
> 2. ...
>
> Full report appended to `wiki/log.md`. Tell me which to fix and I'll route each through `ingest`.

### Anti-patterns

- **Silently fixing findings.** Lint produces a report, not a diff. Fixes route through `ingest` so they end up in `log.md` and respect approval gates.
- **Lint as a routine ingest substitute.** Lint surveys; ingest folds in new Raw. They're different operations and the log distinguishes them by prefix.
- **False-positive contradictions.** If two pages disagree because they describe two different things with overlapping names, that's a domain ambiguity to log under `wiki/domain.md`'s Flagged Ambiguities, not a contradiction.
- **Treating old as stale.** A page from a year ago that describes still-true facts is fine. Stale means *known-superseded*, not *not-recently-touched*.

## `log.md` entry shape

```markdown
## [2026-05-30] lint | full-wiki

**Context:** Weekly health-check, 24 pages surveyed.

**Created:** _(report only — no pages created by lint)_

**Modified:** _(report only — no pages modified by lint)_

**Deleted:** _(report only)_

**Findings:**

### Contradictions
- _(none)_

### Stale claims
- `strava-integration.md` — `updated: 2026-04-12` but ingest on 2026-05-14 touched the OAuth scopes and didn't update this page. Proposed fix: re-ingest, target `strava-integration.md` for the OAuth scope update.

### Orphan pages
- `meta-pixel.md` — no inbound links. Proposed fix: link from `architecture.md` Component Map and from `index.md` Features.

### Concept-without-page
- "RaceProfile" appears in `architecture.md` and `data-model.md` with no dedicated page. Proposed fix: candidate new page `race-profile.md` — user approval needed.

### Missing cross-references
- `coach-conversation.md` mentions "Strava" but does not link to `[[strava-integration]]`. Proposed fix: add wikilink at `coach-conversation.md:34`.

### Data gaps
- `architecture.md` contains `TODO: document the AI fallback flow`. Proposed fix: re-ingest from `ai-fallback.md` to fill the gap.

### Missing or empty summary
- `meta-pixel.md` — no `summary:` frontmatter and no lead paragraph under the H1. Proposed fix: re-ingest, add a one-sentence summary + matching lead paragraph.

### Incomplete or off-taxonomy frontmatter
- `data-model.md` — missing `updated:` field. Proposed fix: re-ingest, add `updated:`.
- `strava-integration.md` — tags `[strava, oauth, fitness, sync, api]` have no recognised kind tag and sprawl past 4. Proposed fix: consolidate to `[integration, api]`.

### Poor chunking structure
- `architecture.md` — the "Background" section runs ~1,400 tokens of unbroken prose with no `##`/`###` subheadings. Proposed fix: re-ingest, split into focused subsections.

### Missing aliases for synonyms
- `monitoring-program.md` — referenced as "MP" in `architecture.md` but `aliases` is empty. Proposed fix: add `MP` to `aliases` and surface it in prose.

**Decision:** Surfaced to user. User to choose which to route through `ingest`.
```
