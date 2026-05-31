---
name: tcgflow-ingest
description: Adopt the Ingester role and fold a Raw source into the LLM-wiki. Use when the user types `/tcgflow-ingest [TASK-ID or raw or "MCP-source description"]` or says "ingest ES-1234", "fold this into the wiki", "ingest the files in raw/". Log-first procedure — drafts wiki/log.md entry before any page changes — with approval gates for new pages and deletions. A single ingest may touch 10–15 pages.
---

# `/tcgflow-ingest` — fold a Raw source into the wiki

## When to use

The user typed `/tcgflow-ingest {scope}` or said *"ingest ES-1234"*, *"fold these notes into the wiki"*, *"ingest the raw/ folder"*. Trigger types:

- **Task ingest** — a VALIDATED task is ready to be folded in (most common).
- **`raw/` ingest** — the user has dropped files into `.tcgstackflow/raw/` and wants them ingested.
- **MCP ingest** — facts from a Jira ticket, Snyk report, Datadog incident, etc. that should become wiki content.

## What to do

You are now in the **Ingester role**. Read `.tcgstackflow/agents/ingester.md` for the full procedure; the high-level shape is:

1. **Inventory the Raw source.** Summarise what's there.

2. **Plan.** Walk `wiki/index.md` first. Identify:
   - **Affected existing pages** (one wikilink hop from each).
   - **Candidate new pages** (topics with no current home — these need approval per ADR 0007).
   - **Contradictions** with current wiki content.

3. **Draft the `log.md` entry FIRST** using the locked prefix `## [YYYY-MM-DD] ingest | {title}` and the structured shape (Context / Created / Modified / Deleted / Decision). **Output the draft to the user before applying anything** — the draft IS the plan.

4. **Apply existing-page updates.** Mechanical updates flow; semantic rewrites show a proposed diff first. Always bump `updated:` frontmatter and preserve `[[wikilinks]]`.

5. **Ask before structural changes.** Each new page or proposed deletion gets a one-paragraph proposal; wait for explicit OK.

6. **Handle contradictions.** Surface in the log entry's Decision section. Never silently overwrite.

7. **For task ingest:** move `tasks/active/{ID}/` → `tasks/completed/{ID}/`. Update `tasks/README.md`. Set task status to `INGESTED`.

8. **For `raw/` ingest:** move processed files to `raw/archived/{YYYY-MM-DD}-{topic-slug}/`. Never delete.

9. **Finalise the log entry** with actual file lists.

10. **Propose governance rule additions** when Raw surfaces a project-specific constraint (per the Ingester profile step 10).

11. **Schema-doc co-evolution.** If the ingest introduced a new convention, update `tools/claude/CLAUDE.md`, `tools/codex/AGENTS.md`, and `tools/github/copilot-instructions.md` in the same ingest.

## Guardrails (per agents/ingester.md)

- **Log-first, always.** No page edit before the log entry is drafted.
- **New pages and deletions are gated** — always ask. (ADR 0007.)
- **Raw is immutable.** Read but never edit.
- **Stable file paths.** Renames preserve backlinks via `aliases:` frontmatter (qmd uses paths as IDs).
- **Frontmatter discipline.** Every touched page bumps `updated:`.

## Notes

- For multi-project workspaces, wiki pages may carry `project: {name}` frontmatter scoping them to a single sub-project. New pages should set this when the content is project-specific.
- A single ingest *may* touch 10–15 pages when the change is broad — don't artificially minimise.
