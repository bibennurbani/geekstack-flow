---
title: Architecture Decision Records
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
# {Short title of the decision}

{1–3 sentences: what's the context, what did we decide, and why.}
```

That's the minimum. Optional sections (Considered Options, Consequences, Status frontmatter) only when they add genuine value. Most ADRs are a single paragraph.

## When to write one

All three must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any of the three is missing, skip the ADR.

## Linked from

- [[../index]]
- [[../../governance.md]] for risk-level taxonomy
