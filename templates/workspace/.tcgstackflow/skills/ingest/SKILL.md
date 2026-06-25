---
name: ingest
description: Fold a Raw source (a `VALIDATED` task, files dropped into `raw/`, or an MCP-driven investigation) into the LLM-wiki. Log-first procedure — drafts the `wiki/log.md` entry before touching any page — with a gated approval step for new pages and deletions. A single ingest may touch 10–15 pages when the change is broad. Used by the Ingester agent.
---

# Ingest

## When to use this skill

Invoke this skill when:

- A task has reached status `VALIDATED` and needs to be folded into the wiki.
- The user has dropped one or more files into `.tcgstackflow/raw/` and asked to ingest them.
- An MCP-driven investigation has produced facts worth integrating (a Jira ticket digest, a Snyk report summary, a Datadog incident write-up).

**Do not use this skill** to do hand-edits on individual wiki pages. Wiki edits go through this skill so they end up in `log.md` and respect the approval gate.

## Instructions

You are folding a Raw source into the wiki. The procedure is **log-first** — the `log.md` entry is drafted before any page changes, and it doubles as the *plan* the user can adjust before changes are applied.

### Procedure

1. **Inventory the Raw source.**
   - **Task ingest** — read `tasks/active/{ID}/TASK details {ID}.md` and `TASK {ID}.md`. Summarise the diff (use `git log` / `git diff` against the merge-base, or the file lists from log entries).
   - **`raw/` ingest** — list files in `.tcgstackflow/raw/`, summarise each in one line. If the user gave a topic phrase, use it.
   - **MCP ingest** — capture the MCP output as the source-of-record.
2. **Plan.** Use the `wiki-search` skill (qmd) to surface the pages the Raw touches, and walk `wiki/index.md` to place them in the Map of Content. Identify:
   - **Affected existing pages** — pages whose topic overlaps the Raw. Walk the wikilink graph one hop from each to catch downstream impact.
   - **Candidate new pages** — topics not covered by any existing page. **Dedup before proposing one:** run `qmd vsearch "<topic>" -c wiki --json -n 5` and record the top 3 existing pages (with scores) in the log entry's Decision section. **Append-vs-mint rule of thumb:** *append* to an existing page when the topic is a facet of its concept (it would read as a new `##` section under that page's `# Title`) — this is the default. *Mint* a new page only when BOTH hold: (i) the topic is a distinct first-class concept (a noun an AI would search for by name, not a sub-aspect of an existing page), AND (ii) appending would push the host page past ~a few screens (authoring rule 2's *page*-split trigger — several ~900-token chunks, not a single section). If a top vsearch hit scores high and the topic is a facet of it, **append — never mint a near-duplicate** (that fragments a concept across pages, so retrieval returns partial answers and tokens bloat). Minting still goes through approval (step 5).
   - **Contradictions** — places where the Raw conflicts with current wiki claims. These surface in the log entry's Decision section; never silently overwrite.
   - **Coverage map (task ingest only).** Union the `files:` lists from the task's `### ENTRY START` log entries into the set of source files the task touched. For each touched file, name the wiki page(s) that document it (qmd per file path + the entry's `why` text, plus the one-hop wikilink walk). Before finalising, **every touched file must resolve to either a page in the log entry's Modified/Created list, or an explicit `no wiki impact: {file} — {reason}` line in the Decision section.** A touched file in neither bucket is an unverified gap — resolve it before applying. (This is how the wiki stops silently forgetting a change that was actually made.)
3. **Draft the `log.md` entry FIRST.** Use the locked prefix `## [YYYY-MM-DD] ingest | {short title}`. Include:
   - **Context** — what triggered this ingest, in 1–2 sentences.
   - **Created** — list of proposed new pages with one-line descriptions. (Will be created only after step 5.)
   - **Modified** — list of existing pages that will be touched, with a one-line "what changed" per page.
   - **Deleted** — list of pages or sections proposed for removal. (Will be removed only after step 5.)
   - **Decision** — key conclusions, especially contradictions resolved.
   - **Output the draft to the user** before applying anything. The user can edit the draft if the plan is wrong.
4. **Apply existing-page updates** (mechanical or semantic):
   - **Mechanical** — a moved file, a renamed dependency, a version bump. Apply directly. Bump frontmatter `updated:`.
   - **Semantic** — changed conclusions, new framing, rewritten sections. Show the diff first; apply on confirmation.
   - **Resolved contradictions** — once the user resolves a contradiction flagged in the Decision section, **apply the resolved fact to the contradicted page body** (via the Semantic path), bump its `updated:`, and list it in **Modified**. A contradiction whose resolution lives only in `log.md` is an *incomplete* ingest — the page qmd surfaces still carries the stale claim. **Name the contradicted page(s) by wiki path in the Decision section** (and list them in Modified): the Decision records *that* it was resolved, the page body carries the resolved *fact*, and lint detector 12 cross-checks exactly that pairing.
   - **Always:** preserve `[[wikilinks]]`. If a page is renamed, add an `aliases:` frontmatter entry so backlinks resolve.
5. **Ask before structural changes.**
   - For each candidate new page: present title, frontmatter, one-line description, why it should exist. Wait for explicit OK.
   - For each proposed deletion: present what's being deleted and where references will be updated. Wait for explicit OK.
   - Skipped or rejected proposals stay in the log entry's Decision section as "user rejected: {reason}".
6. **For task ingest:** physically move the task folder.
   - `mv tasks/active/{ID} tasks/completed/{ID}`
   - Update `tasks/README.md` — remove from Active table, add to Recently Completed table.
   - Set task status to `INGESTED` in `tasks/completed/{ID}/TASK details {ID}.md` and `TASK {ID}.md`.
7. **For `raw/` ingest:** move processed files.
   - `mv raw/* raw/archived/{YYYY-MM-DD}-{topic-slug}/`
   - Never delete. Re-ingest with new context must remain possible.
8. **Finalise the `log.md` entry.** Replace the proposed file lists with the actual file lists after changes are applied. Bump the touched pages' frontmatter and `wiki/index.md` if pages were added/removed/renamed.
9. **Schema doc co-evolution.** If this ingest introduced a new convention (a renamed page, a new agent role, a new skill, a new project-specific governance rule), update `tools/claude/CLAUDE.md` and `tools/codex/AGENTS.md` *in the same ingest*. Don't leave the schema docs out of sync.
10. **Re-embed the wiki search index.** Run an incremental `qmd embed` so qmd reflects the new/changed pages (the Ingester is the only wiki writer; readers rely on a fresh index). Refreshes the `docs/` collection too. If qmd is unavailable, note it — `index.md` stays the fallback.

### Output

The user sees three things, in order:

1. **The draft `log.md` entry** (step 3) — before any changes. User can edit.
2. **Approval requests** (step 5) — one per structural change. User OKs or rejects.
3. **A summary on completion** — final file list, link to the new `log.md` entry, link to any new pages.

### Anti-patterns

- **Skipping the log entry.** Page edits without a `log.md` entry are forbidden. The log is how the wiki keeps its history-of-itself.
- **Silent new pages.** "I'll just create this page since it's obvious" — no. Ask. The Ingester earns trust on routine updates by being careful on structural ones.
- **Silent overwrites of contradictions.** A new Raw source disagreeing with the wiki is a *conversation*, not an automatic rewrite.
- **Renaming without aliases.** qmd uses paths as IDs. Broken paths break search. Always add an alias entry on rename.
- **Editing Raw.** Codebase, task files, MCP outputs — immutable. The Ingester reads them but never modifies them.
- **Minimising edits artificially.** A broad change *should* touch 10–15 pages. Don't pretend the impact is smaller than it is.

## `log.md` entry shape

```markdown
## [2026-05-30] ingest | ES-6900 — Recommended Frequency field on Monitoring Program Form

**Context:** Completed task ES-6900 added a Recommended Frequency dropdown and simplified Schedule to single-select with auto-sync. Diff touches `MonitoringProgramForm.vue` and `en.json`.

**Created:** _(none)_

**Modified:**
- `wiki/architecture.md` — Monitoring Program form section updated with the new field and auto-sync behaviour
- `wiki/domain.md` — added "Recommended Frequency" to Monitoring Program entry
- `wiki/index.md` — bumped `updated:` on touched pages

**Deleted:** _(none)_

**Decision:** Recommended Frequency is now a first-class form field; old "computed from schedule" behaviour is preserved as auto-sync but the user can override. Removed the chip-based template since 1 MP → 1 Schedule is the canonical relationship.
```

## Wiki page authoring (qmd-optimized)

Every page you create or update is indexed by **qmd**, which chunks Markdown into ~900-token pieces, breaking at headings (H1/H2 score highest) and code fences. Well-sectioned pages retrieve far better than walls of prose — writing each section as a clean, self-contained chunk is the single biggest lever on search quality. (See [wiki-search](../wiki-search/SKILL.md) for how the index is searched.)

### Frontmatter schema (every page)

```yaml
---
title: {Specific, descriptive page title}      # qmd extracts this; it shows in results — be specific
summary: {One sentence — what this page is and why it exists}   # prose signal in the first chunk + human/result preview
tags: [{kind}, {area?}]                          # controlled vocabulary (see below); lowercase, kebab-case, 2–4 tags
aliases: [{synonyms / alternate names}]          # also surface these in the body prose
priority: P0|P1|P2                               # P0 core · P1 important · P2 reference
status: current|stub|archived
created: YYYY-MM-DD
updated: YYYY-MM-DD
# project: {name}                                # optional — multi-project workspaces only; match a projects[].name
---
```

`summary` is new and important: qmd's frontmatter indexing is not guaranteed, but the `summary` sentence sits in the body's first chunk, so it gives both BM25 and the embedding a strong, accurate signal — and it doubles as the page's one-line preview for humans.

### Tag taxonomy (lightweight, recommended — not enforced)

- One **kind** tag: `overview` · `architecture` · `domain` · `feature` · `integration` · `operations` · `decision` · `testing` · `meta`
- Optional **area / sub-project** tag (e.g. `frontend`, `api`, or a `projects[].name`).
- Keep tags lowercase, kebab-case, and few (2–4). **Consistency beats coverage** — reuse existing tags before inventing new ones (Lint surfaces tag sprawl).

### Authoring rules (because qmd chunks at headings)

1. **Lead with a 1–2 sentence summary paragraph** right under the `# Title`, restating the page concept in prose (mirror the `summary` field). This is the page's strongest-embedding first chunk.
2. **Structure with `##`/`###` headings; keep each section focused and under ~900 tokens** so it becomes one coherent chunk. Split a page that grows past a few screens into linked sub-pages rather than one giant page.
3. **Surface synonyms / alternate terms in the body**, not only in `aliases` — keyword search matches body text reliably.
4. **Keep code blocks reasonably sized** — qmd keeps them intact when it can, but an oversized block can dominate a chunk.
5. **Descriptive kebab-case filename = the qmd docid.** Stable; on rename, add an `aliases:` entry so backlinks and retrieval resolve.
6. **Link generously with `[[wikilinks]]`** so the qmd-first → one-hop reading pattern works.

### Page template

```markdown
---
title: {Specific Page Title}
summary: {One sentence — what this page is and why it exists}
tags: [{kind}, {area?}]
aliases: [{synonym}, {alt-name}]
priority: P1
status: current
created: {YYYY-MM-DD}
updated: {YYYY-MM-DD}
---

# {Specific Page Title}

{1–2 sentence summary paragraph — the page concept in prose. This is the first chunk qmd embeds.}

## {Focused section heading}

{Self-contained content, ideally under ~900 tokens. Use synonyms in prose.}

## Related pages

- [[some-related-page]]
- [[another-page]]
```
