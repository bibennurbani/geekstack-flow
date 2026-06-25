---
title: Wiki Index — Map of Content
summary: The map of content for the project wiki — the entry point that links out to every core, decision, domain, and operations page, plus the authoring conventions.
tags: [meta, navigation]
aliases: [MOC, map-of-content, wiki-index]
priority: P0
created: 2026-05-30
updated: 2026-05-30
status: current
---

# {{project-name}} — Knowledge Wiki

This is the map of content (MOC) for the project wiki: the single page that links out to every other page and records the authoring conventions. Start here, then follow the `[[wikilinks]]` one hop to whatever you need.

> Project knowledge maintained by AI, organised for token-efficient retrieval. New pages are created by the Ingester during folding of Raw sources — they are not pre-stubbed.

## Core

- [[project-overview]] — What this project is, tech stack, who uses it
- [[architecture]] — High-level system design
- [[domain]] — Ubiquitous language + glossary

## Decisions

- [[adr/README]] — how ADRs work + when to write one (the index of decisions)
- _No ADRs yet — the first decision creates `adr/0001-{slug}.md` and is linked here by the Ingester._

## Meta

- [[log]] — Append-only wiki operations log (Ingest / Query / Lint)

## Domain pages

_(Created by the Ingester as the project grows. Examples from real projects: `[[strava-integration]]`, `[[coach-conversation]]`, `[[payment-workflow]]`, `[[ai-pipeline]]`.)_

## Operations

_(Created when relevant: `[[deployment]]`, `[[db-backup]]`, `[[development]]`.)_

---

**Conventions**

- Pages use Obsidian-style `[[wikilinks]]` (without `.md`).
- Frontmatter: `title` (specific), `summary` (one sentence — what the page is + why), `tags`, `aliases`, `priority` (`P0`/`P1`/`P2`), `status` (`current`/`stub`/`archived`), `created`, `updated`.
- **Tag taxonomy:** one *kind* tag from `overview` · `architecture` · `domain` · `feature` · `integration` · `operations` · `decision` · `testing` · `meta`, plus an optional area / sub-project tag; lowercase kebab-case, 2–4 tags, consistency over coverage.
- **qmd-optimized authoring:** qmd chunks pages at headings (H1/H2 highest), so structure with clear `##`/`###` sections (each a self-contained chunk under ~900 tokens) and open the body with a 1–2 sentence lead summary that mirrors the `summary` field. See the ingest skill's "Wiki page authoring (qmd-optimized)" section for the full rules and page template.
- **For multi-project workspaces:** wiki pages that belong to a specific sub-project carry an optional `project: {name}` frontmatter field matching a `projects[].name` from `config.yaml`. Top-level pages (this index, `log.md`, `domain.md`) leave `project` unset because they span the whole workspace.
- New pages and deletions go through the Ingester's approval gate (see [governance.md](../governance.md) + ADR 0007 in `adr/`).
- The Ingester updates this index whenever pages are added, renamed, or removed.
