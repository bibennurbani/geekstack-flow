# The mechanical wiki-structure checks are deterministic code; the semantic ones stay AI-run

Karpathy/qmd wiki conformance was specified in three prose places — the `ingest` authoring spec, the 13 `lint-wiki` detectors, and 2 `audit-workspace` detectors — but **9 of the 10 mechanical detectors had no code**; an LLM re-derived them from prose on every Lint, and the "single biggest lever on retrieval," ~900-token chunk sizing, was eyeballed at nit severity with no tokenizer. The one coded check (`stalePagesFor` in `read.cjs`) served the Cockpit badge and was silently re-computed in prose by Lint. Meanwhile `geekstackflow doctor` read no wiki markdown at all. The spec drifted unnoticed (the shipped scaffold itself carried an off-taxonomy tag and a dangling wikilink until this work). This is a **shallow, scattered** module: the check has no single implementation and no test surface.

## Design

Extract the mechanical checks into **one deep, pure module** in `init.js` — `checkWikiStructure(wikiDir) → findings[]`, with `parseWikiFrontmatter` / `parseWikiPage` / `diagnoseWiki` as its unit-tested pure core and a thin fs walker as its only impurity (the exact pattern `doctor`'s qmd parsers already use, ADR 0037). Zero dependencies (fits `init.js`'s invariant, ADR 0022); no tokenizer — chunk size is an honest `chars/4` **estimate**. It cannot import `read.cjs` (dependency direction is `read.cjs → init.js`, ADR 0022), so it carries its own ~15-line frontmatter parser.

Checks (from the `ingest` authoring spec, ADR 0003/0006/0030): frontmatter completeness + kind-tag taxonomy, `summary`/lead-paragraph presence, ~900-token section chunking, the wikilink graph → broken links + orphans + Map-of-Content reachability from `index.md`, kebab-case filename. Wikilinks inside inline-code or fenced blocks are ignored (illustrative, not real links).

**Severity is calibrated for "easy to use":** only a missing `index.md` (no Map-of-Content entry point) is a `fail`; every quality gap is a `warn`; style issues are `nit`. So `doctor` informs without hard-failing every real wiki. **ADRs are lenient** — prose, sequentially-numbered decision records reached via the `adr/` directory, not wikilinks — checked only for chunking + broken links (mirrors Lint's existing `adr/` exemptions).

**Three adapters justify the seam:**
- **`doctor`** runs it per project (always — pure fs, no qmd needed), so "does this wiki follow Karpathy?" is a deterministic, exit-coded check. `geekstackflow doctor --wiki` is the structure-only mode.
- **`lint-wiki`** delegates the mechanical detectors to `doctor --wiki` and spends the LLM only on the semantic ones — contradictions, concept-without-page, synonyms, and "is this actually informational?"
- **`ingest`** gates on it at the re-embed step: a page failing the structure check is fixed before it is embedded — structure enforced at write-time, not just at periodic Lint.

## Considered options

- **(A) One pure module, three adapters** — *chosen*. Concentrates the check (locality), gives it a test surface (the interface), and lets the LLM do judgment instead of arithmetic. The scaffold now passes its own checker (dogfooded to zero findings).
- **(B) Leave it as AI-run prose in lint-wiki** — rejected: no test surface, the spec drifts (proven), and the LLM burns budget re-deriving mechanical facts (and mis-eyeballs chunk size).
- **(C) Full semantic checking in code too** — rejected: contradictions, concept-worthiness, and "is this meaningful" are irreducibly LLM judgment. A deterministic checker guarantees retrievable **structure** and catches **proxies** of empty content; it does not judge meaning. Don't oversell "informational" as mechanizable.

## Consequences

- New pure module + `--wiki` flag in `init.js`; `doctor` gains a wiki-structure section per project. Unit-tested (`test/wiki-structure.test.cjs`).
- `lint-wiki` and `ingest` skills updated to delegate to / gate on the checker; the scaffold's own drift (tag + dangling link) fixed so it passes.
- `stalePagesFor` (ADR 0036 stale-claims, det 2) is **not yet** folded in — it stays in `read.cjs` for the Cockpit; unifying it into the checker (so Cockpit + lint + doctor share one implementation) is a fast-follow.
- Amends nothing; complements ADR 0006 (Lint is defined by *what* it detects, not *how* — computing the mechanical detectors deterministically is an implementation choice, and Lint still "never rewrites silently").
