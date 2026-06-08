---
title: Wiki Operations Log
summary: An append-only chronological record of every wiki maintenance operation (ingest, lint, query, restructure) — the wiki's history-of-itself.
tags: [meta, audit]
aliases: [operations-log, wiki-log]
priority: P2
created: 2026-05-30
updated: 2026-05-30
status: current
---

# Wiki Operations Log

Append-only chronological record of wiki maintenance operations.

**Entry prefix is locked** to `## [YYYY-MM-DD] {operation} | {title}` so simple tools work:

```bash
grep "^## \[" log.md | tail -5
```

Where `{operation}` is one of: `ingest` · `lint` · `query` · `restructure`.

Each entry has Context / Created / Modified / Deleted / Decision sections. See [ingester.md](../agents/ingester.md) for the procedure.

---

## [2026-05-30] init | Workspace initialised

**Context:** `.tcgstackflow/` workspace created via the Creative GeekStack Flow init script. Project is `{{project-name}}`.

**Created:** Workspace skeleton — wiki stubs, four agent profiles, eight starter skills, governance, config.

**Modified:** _(none)_

**Deleted:** _(none)_

**Decision:** First real ingest (task or `raw/` import) will replace these stubs with project-specific content. Do not pre-populate wiki pages by hand — let them grow from Raw via the Ingester.
