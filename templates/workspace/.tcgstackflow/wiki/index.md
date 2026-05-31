---
title: Wiki Index — Map of Content
tags: [meta, navigation]
aliases: [MOC, map-of-content, wiki-index]
priority: P0
created: 2026-05-30
updated: 2026-05-30
status: current
---

# {{project-name}} — Knowledge Wiki

> Project knowledge maintained by AI, organised for token-efficient retrieval. New pages are created by the Ingester during folding of Raw sources — they are not pre-stubbed.

## Core

- [[project-overview]] — What this project is, tech stack, who uses it
- [[architecture]] — High-level system design
- [[domain]] — Ubiquitous language + glossary

## Decisions

- [[adr/0001-{slug}]] — _(first ADR will replace this stub)_

## Meta

- [[log]] — Append-only wiki operations log (Ingest / Query / Lint)

## Domain pages

_(Created by the Ingester as the project grows. Examples from real projects: `[[strava-integration]]`, `[[coach-conversation]]`, `[[payment-workflow]]`, `[[ai-pipeline]]`.)_

## Operations

_(Created when relevant: `[[deployment]]`, `[[db-backup]]`, `[[development]]`.)_

---

**Conventions**

- Pages use Obsidian-style `[[wikilinks]]` (without `.md`).
- Frontmatter: `title`, `tags`, `aliases`, `priority` (`P0`/`P1`/`P2`), `created`, `updated`, `status`.
- **For multi-project workspaces:** wiki pages that belong to a specific sub-project carry an optional `project: {name}` frontmatter field matching a `projects[].name` from `config.yaml`. Top-level pages (this index, `log.md`, `domain.md`) leave `project` unset because they span the whole workspace.
- New pages and deletions go through the Ingester's approval gate (see [governance.md](../governance.md) + ADR 0007 in `adr/`).
- The Ingester updates this index whenever pages are added, renamed, or removed.
