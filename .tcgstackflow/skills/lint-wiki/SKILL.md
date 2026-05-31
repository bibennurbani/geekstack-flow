---
name: lint-wiki
description: Periodic health-check of the LLM-wiki. Detects contradictions across pages, stale claims newer Raw has superseded, orphan pages with no inbound links, important concepts mentioned without their own page, missing cross-references, and data gaps. Produces a report appended to `wiki/log.md` and proposes fixes — never silently rewrites. Run on demand or weekly. Used by the Ingester agent.
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

**Decision:** Surfaced to user. User to choose which to route through `ingest`.
```
