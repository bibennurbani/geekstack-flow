# Record the qmd discovery path per run; defer query-path enforcement until earned

ADR 0030 made qmd the **mandatory** wiki/docs search layer, but "mandatory" only ever bit at *install* time and (after ADR 0036) at *write* time (the deterministic post-ingest re-embed). The **read/query path was prose-only**: the six agent profiles say "qmd-first," but nothing prevents an agent from `grep`-ing the wiki to discover pages, and `governance-classify.cjs` rates `grep`/`Read` as **LOW → auto-allowed**. A 2026-07-14 audit confirmed the gap — *and* confirmed that **no agent profile actually instructs grepping the wiki**. So the open question was narrow: is a query-time **gate** worth adding to the most safety-critical module in the workspace, for a bypass that has not been observed to happen?

## Design

**Observe first; do not gate yet.** We make the discovery path *visible and auditable* before deciding whether to *enforce* it — you cannot right-size enforcement for a problem you cannot measure.

- **Record the discovery path per run.** The run record gains an optional `wiki_discovery` block — `{ path: qmd | index-fallback | none, reason?, queries, redirects }` — written by the `read.cjs` serializer beside the ADR 0036 `embed` block. The governance MCP *observes* (never blocks): it flips a per-run `qmdSeen` flag when it sees a `qmd query|search|vsearch|get` invocation, does an async boot-time `qmd --version` check to detect the index.md-fallback case, and reports both to a token-authenticated loopback endpoint (`/api/run/wiki-discovery`) that the executor folds into the run record. The Cockpit shows a per-run **badge** beside the fidelity/embed badges (`🔍 qmd` / `index-fallback`).
- **Harden the discovery discipline in prose.** `wiki-search/SKILL.md`: raw grep over wiki page *bodies* is **never** the fallback (only structured `index.md` + `[[wikilink]]` navigation is), and the "results look thin/stale" escape hatch now requires a `query`↔`search`↔`vsearch` refinement *before* retreating to `index.md`. The `grill-task`/`plan-task`/`review-diff` skill bodies gain the explicit "discover via `wiki-search` (qmd), not by hand" step (they previously relied on the agent profile); the `refactorer` profile gains the `index.md`-fallback clause the other five carry.
- **Close the non-orchestrated staleness gap.** The `post-merge` hook runs a backgrounded incremental `qmd embed` (guarded by `command -v qmd`) when a merge touched `wiki/` or `docs/`, so a manual edit or a PR that lands wiki changes outside the ingest flow doesn't leave a stale index — the failure mode ADR 0036 left open for non-orchestrated edits.
- **Make the convention a checkable invariant.** `audit-workspace` gains a detector that flags any wiki-recalling skill whose body lacks a `wiki-search`/qmd step, and any agent missing the `index.md` fallback clause.
- **The enforcement gate is designed, built, and deferred — not discarded.** A grep-focused, fail-open gate (soft-deny a pre-qmd raw wiki body-grep, redirect to qmd) is fully implemented and unit-tested on branch `feat/qmd-query-path-enforcement-full`. It is **not** merged: it is a one-small-step addition to enable *if and when* the `wiki_discovery` record shows hand-grepping is a real, recurring problem.

## Considered options

- **(A) Observe first; defer the gate** — *chosen*. Makes "mandatory-at-query-time" visible and auditable, ships the unambiguous wins (prose, freshness, detector) now, and honors the project's "earn the complexity" doctrine (ADR 0001) by not adding speculative logic to the safety-critical governance path for an unobserved failure mode.
- **(B) Ship the enforcement gate now** — rejected *for now*. It adds a second concern (methodology, not risk) to the risk-approval gate; it is inherently partial (per-iteration, Claude-only, grep-only — an agent could still `Read`-scan to discover); it forces every `Grep` through the gate (blast radius) for a narrow benefit; and it defends a bypass no agent is instructed to perform. Kept ready on the `-full` branch.
- **(C) Hard-fail if qmd is absent** — rejected, as ADR 0030 already rejected it: brittle; discards the Map-of-Content safety net.
- **(D) Do nothing** — rejected: leaves "mandatory" purely aspirational *and invisible*, with no way to tell whether the discipline holds.

## Consequences

- Run records gain an optional `wiki_discovery` block (older runs unaffected → no badge). The governance MCP observes qmd invocations and reports telemetry but **never changes an allow/deny outcome**; `Grep` stays pre-allowed (no blast-radius change). `/api/run/wiki-discovery` is a new loopback intake.
- Prose updated: `wiki-search/SKILL.md`, `grill-task`/`plan-task`/`review-diff` skill bodies, `refactorer.md`, `CONTEXT.md` ("mandatory" split into install-time vs query-time), and an amendment header on ADR 0006. The `post-merge` hook and `audit-workspace` detector are added.
- **Amends ADR 0030**: adds query-time *observability* (not enforcement) and pins that `index.md` + `[[wikilink]]` navigation is the sole sanctioned non-qmd discovery path.
- **Follow-up trigger:** revisit the deferred gate (`feat/qmd-query-path-enforcement-full`) once the `wiki_discovery` record across real runs shows a non-trivial rate of `index-fallback`/redirect-worthy grepping that isn't explained by qmd genuinely being absent.
