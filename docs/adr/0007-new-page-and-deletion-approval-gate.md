# New-page and deletion approval gate, but routine updates flow

The Ingester (and Lint) operate without per-change approval for **updates to existing pages** — changing a section, bumping the `updated:` frontmatter, adding a cross-reference. This keeps the lightweight one-liner workflow ("Ingest the new RAW files…") that already works for the author. **New page creation and page/section deletion** always require explicit user OK before being applied. Contradictions flagged during Ingest or Lint surface as proposals, not silent rewrites.

## Rationale

The author currently trusts the AI fully on routine updates and only catches problems retroactively via `log.md`. The friction of approving every routine update would kill that workflow. But silent structural changes (a new page that the AI invented, a deletion that loses information) are the changes most likely to be wrong and hardest to notice after the fact — so those *are* worth gating.

## Consequences

- Ingester profile encodes this as an explicit guardrail.
- Lint output is always a *report* of proposed structural changes, never an applied set.
- `log.md` is the read-after-the-fact audit trail for routine updates; the user can spot-check it weekly and use `grep "^## \[" log.md | tail -10` to skim recent activity.
- A future "strict mode" config flag could escalate to approve-everything for risk-averse projects or shared team wikis — not built in V1.
