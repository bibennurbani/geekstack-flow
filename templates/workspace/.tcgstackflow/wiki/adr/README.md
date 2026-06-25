---
title: Architecture Decision Records
summary: How ADRs work in this wiki, and the minimal frontmatter every ADR carries so qmd retrieves decisions on "why did we …" queries.
tags: [meta, decisions]
priority: P1
created: 2026-05-30
updated: 2026-05-30
status: current
---

# Architecture Decision Records

ADRs live here as sequentially numbered Markdown files: `0001-slug.md`, `0002-slug.md`, …

## Format

```markdown
---
title: {Short, specific decision title}
summary: {One sentence — the decision + why; lands in qmd's first chunk so "why did we choose X" retrieves it}
tags: [decision, {area?}]
status: current
---

# {Short title of the decision}

{Lead paragraph — 1–3 sentences: the context, what we decided, and why. This is the first chunk qmd embeds.}
```

The minimal frontmatter (`title`, `summary`, `tags: [decision, …]`, `status`) gives ADRs the same first-chunk `summary` signal and `decision` kind-tag that every other wiki page gets — so a search for "why did we choose X" recalls an ADR as well as a regular page. `priority`/`created`/`updated` are optional for ADRs (they're append-only and dated by their sequence number). Beyond that, optional sections (Considered Options, Consequences) only when they add genuine value — most ADRs are a lead paragraph plus those four frontmatter lines.

## When to write one

All three must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any of the three is missing, skip the ADR.

## Linked from

- [[../index]]
- [[../../governance.md]] for risk-level taxonomy
