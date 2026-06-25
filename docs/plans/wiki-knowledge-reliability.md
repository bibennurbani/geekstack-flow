# WIKI-reliability — make the LLM-wiki a trustworthy, always-fresh, auto-captured AI memory

> Tool repo, no `.tcgstackflow/` workspace (ADR 0013) → plan doc under `docs/plans/`, same shape as `runner-adapter.md`.
>
> **Status:** PLANNED · **Planner:** claude · **Source:** the wiki-knowledge-model assessment (30-agent workflow, 24 file-grounded gaps verified adversarially, benchmarked against AI-retrieval best practice).

## 1. The verdict

The wiki's **structure and retrieval discipline are already excellent** — **11 of 16** best-practice criteria fully met: atomic heading-chunked pages, semantic frontmatter with a qmd-aware `summary`-in-first-chunk, dense wikilinks + a real Map-of-Content, hybrid retrieval with top-N, search-first → open-only-what-you-need → one-hop traversal, single-writer re-embed ownership, ADRs co-located, coarse-grained ingest, and a grep-stable append-only log. **This is not a rescue job.**

The gaps cluster in **exactly the two things you flagged**, and nowhere else:

- **Automatic capture ("AI doesn't forget")** — the mechanisms exist but are *not wired on*: the git pull-hook isn't installed by `init`, nothing ingests a `VALIDATED` task that isn't run-to-completion, and the capture triggers ship OFF.
- **Freshness / trust ("don't serve stale")** — there's no deterministic re-embed (the index can silently lag the pages), no per-page staleness surfaced (only a workspace-level timestamp), and no `verified` ("confirmed-against-code on X") signal — the **one** best-practice criterion fully *missing*.

Token-efficiency itself is in good shape (hybrid + top-N + search-first); the one gap is that the `-n` budget is convention, not enforced.

### Benchmark scorecard (16 practices)
- **✓ have (11):** atomic pages · heading-chunked sections · semantic frontmatter · wikilinks + MoC · hybrid+top-N retrieval · search-first discipline · single-writer re-embed · write-for-retrieval · ADRs co-located · coarse-grained ingest · append-only log
- **◐ partial (4):** contradiction detection (logged, not applied to the page) · automatic capture (built, not wired on) · freshness made visible (workspace-level only) · self-contained pages
- **✗ missing (1):** a `last-verified` date distinct from `last-edited`

---

## 2. Prioritized fixes

Severity from the assessment; **R** = needs server/CLI code, **D** = skill/template/doc only (low-risk, cheap).

### Tier 1 — Reliability core (the 3 HIGH gaps: never serve stale, never silently forget)

**WK-1 · R · ✅ DONE · Deterministic re-embed** — *the retrieval-core fix.* (Shipped: `run.cjs` `embedOnIngest`+`defaultEmbed`+`reembedIfIngest`; injectable `embed`; `embed:` run-record field; 5 tests; ADR 0036.) Today `qmd embed` is only an *instruction* to the ingester agent (ingester.md:79, ingest/SKILL.md:56, RAW_INGEST_PROMPT). If the agent forgets/errors/aborts after writing pages but before embedding, **every subsequent reader silently retrieves the OLD page content.** Make it a deterministic server post-step in `run.cjs` `runLoop`, on the `code===0` + `role==='ingester'` branch, gated on `wiki_search.embed_on_ingest`: `qmd --version` presence-check (skip silently if absent — qmd is optional, ADR 0030), then `cp.execFile('qmd',['embed'],{cwd})` **after** `writeRunRecord(...,'done')` so a slow/failed embed never blocks hand-off; record `embed:{ran,exit,at}` on the run record so a failure is *visible*. Keep the agent instruction as the fallback for non-orchestrated tools. Test alongside `chain-and-hooks.test.cjs` (fake qmd invoked once on a clean ingester run; skipped when `--version` absent). New ADR 0036 amends 0030. *~20 lines + config parse + test.*

**WK-2 · R · Install the pull-hook in `init`** — *the highest-leverage "doesn't forget" mechanism, currently unwired.* `init.js main()` never calls `installHooks()`; wiring needs a separate, undocumented `geekstackflow hooks .`. So fresh workspaces **silently never capture upstream pulls.** Add an `askYesNo('Install the git pull-digest hook?', true)` → `installHooks(target)` in `main()` (guarded on `.git` existing; advise the command when not yet a git repo); reminder in `upgradeWorkspace` when `.git/hooks/post-merge` lacks the marker; add a step to `tcgflow-init/SKILL.md` (the AI follows the skill, not the README). *~10 lines, reuses a hardened function.*

**WK-3 · R · Reconcile pending ingest on startup** — *closes the loop for human-validated tasks.* `awaiting_ingest` is a passive badge; nothing enqueues an ingester when a task hits `VALIDATED` (no watcher/scheduler in `ui/server`). Add `reconcilePendingIngest(ws)` called from `reconcileAllProjects` (index.cjs:432), gated on `auto_ingest_on_pull`: for each `VALIDATED` task with no in-flight ingester run → `runManager.enqueue(...,'ingester',{chain:false})`; for a non-empty `raw/` inbox → one `RAW-INGEST` run; idempotent against `runManager.list()`. **Startup-reconcile only — no timer** (each enqueue is a billable run; the pull-hook + one-click buttons cover the steady state).

**WK-4 · D · Make the orchestrated ingester non-interactive** — *or auto-capture is structurally incomplete.* The ingest skill has human approval gates (new pages, deletions, contradiction resolution) that an unattended `RAW-*`/auto-ingest run can't satisfy. Resolve the collision: in an orchestrated/unattended ingest, **auto-apply routine updates + the safe new-page case, but DEFER structural/contradiction decisions to the approval inbox** (the governance pause-and-approve path already exists) rather than blocking or silently skipping. Document the unattended-mode behavior in ingest/SKILL.md + ingester.md.

**WK-5 · D · Ship the capture triggers discoverable** — `auto_advance` and `auto_ingest_on_pull` are commented-out examples in the template `config.yaml`. Keep them opt-in (safe default) but make them **visible + one-line documented** (and surfaced in the Cockpit Settings tab) so a user can turn capture on without reading source.

### Tier 2 — Freshness made visible (the "don't trust stale" signal)

**WK-6 · R · Per-page staleness in the Cockpit** — port lint detector 2's logic into the always-on `read.cjs` `readWiki()` (it already `statSync`s every page): parse each page's `updated:`, flag a page `stale` when its `updated` predates the newest `log.md` ingest that named it; return `stale_pages[]` and surface a freshness card + "▶ Ingest now" in App.vue. Continuous visibility instead of only the weekly lint. Drive the warning off a **count** of aging `current` pages, not a single old date (a stable page is old, not stale).

**WK-7 · D→R · Optional `verified:` field** — the one missing best-practice. Add an **optional** `verified: YYYY-MM-DD` to the ingest frontmatter schema, stamped by the **Ingester only** (preserve the single-writer model — do *not* spread wiki writes to Coder/Reviewer). Where present, `read.cjs` prefers `verified` over `updated` for staleness and shows "facts confirmed-against-code on X". Pages without it fall back to WK-6's `updated` signal — never gate ingest on it.

**WK-8 · R · Cross-project stale-wiki alert** — CONTEXT.md:128 claims the Home view flags per-project stale-wiki; it doesn't exist in code. Either implement it (off WK-6's `stale_pages`) or correct CONTEXT.md. (Doc-vs-code drift — pick one.)

### Tier 3 — Write quality, anti-fragmentation, retrieval integrity (mostly D — cheap, high-leverage)

**WK-9 · D · New-page-vs-append rule + dedup-before-mint** — ingest has no criterion for append-vs-mint and no duplicate check, so knowledge fragments across overlapping pages (token bloat + partial-answer retrieval). Add to ingest/SKILL.md step 2: run `qmd vsearch "<topic>" -c wiki -n 5` and record top hits in the log Decision *before* proposing a new page; explicit rule — **append** when the topic is a facet (a new `##` under a host H1, the default); **mint** only when it's a distinct first-class concept AND appending would exceed ~a few screens. Add a near-duplicate-page lint detector.

**WK-10 · D · Apply contradiction resolutions to the page body** — today a resolved contradiction lives only in the append-only log (which qmd treats as undifferentiated history); the contradicted page keeps the stale claim. Add a procedure step: once resolved, rewrite the page via the semantic-update path, bump `updated:`, list it in **Modified**. Add a lint check: a page named in a Decision-resolved contradiction that isn't in that entry's Modified list → `major`.

**WK-11 · D · File→page coverage map (task ingest)** — ingest doesn't exploit the task log's structured `files:` lists, so page-scoping is ad-hoc and misses pages. Add a step: union the task's `### ENTRY START` `files:`, and require each touched file to resolve to a Modified/Created page *or* an explicit "no wiki impact: {file} — {reason}" line. Makes "did we forget a page?" checkable.

**WK-12 · D · Fix `index.md` placeholder rot** — the MoC has a broken `[[adr/0001-{slug}]]` stub link (the qmd-down cold-read fallback shows a broken map). Point it at the real `[[adr/README]]` + explicit empty-states; ingest step 8 replaces the empty-state line when the first ADR/domain/ops page lands.

**WK-13 · D · ADR retrieval parity** — ADRs are excluded from lint's integrity graph and lack the `summary`-in-first-chunk + `tags:[decision]` every other page gets, so "why did we choose X" recall is degraded. Give ADRs a minimal frontmatter (`title`, `summary`, `tags:[decision,...]`, `status`) + lead summary; narrow lint's `adr/` exclusion so broken-wikilink + orphan detectors still walk ADRs (keep contradiction/cross-ref off — superseded ADRs legitimately disagree).

**WK-14 · D · Make the retrieval token-budget explicit** — the `-n 8` cap appears once. State a retrieval budget convention in wiki-search/SKILL.md (default top-N, open only the pages you'll use) so token-efficiency is doctrine, not discretion.

**WK-15 · D · Lint determinism + cadence + docs/ embed** — lint is a non-deterministic free-form LLM survey with an unenforced "weekly" cadence and no fixtures; the concept-without-page detector is heuristic-only; `docs/` has an unbounded staleness window. Lower-priority hardening: add a few deterministic detectors/fixtures, a real cadence hook, and fold `docs/` into WK-1's re-embed.

---

## 3. Verification strategy
- **WK-1 / WK-3** get `node --test` coverage alongside `chain-and-hooks.test.cjs` / `run-guards.test.cjs` (fake `qmd`, fake run-manager) — the same injection seams the orchestrator already exposes.
- **WK-6 / WK-8** get `read-cjs.test.cjs` coverage (a temp workspace with a stale page → `stale_pages` populated).
- **Tier 3 (D)** changes are skill/template/doc — verified by review + the existing lint/audit skills exercising the new rules; no code risk.
- Root `npm test` stays green; smoke OK.

## 4. Top recommendation — where to start
**WK-1 (deterministic re-embed) first.** It's the cheapest Tier-1 fix (~20 lines + a test), it closes the *only silent-staleness hole in the retrieval core*, and it directly serves the goal: an AI that retrieves **accurate** knowledge cheaply. Then **WK-2 + WK-3** (wire the capture loop on) — together those three make "the AI doesn't forget, and never trusts a stale index" *true by construction* rather than by agent diligence. Tier 2 (freshness visibility) and the Tier-3 doc fixes follow as a batch (they're cheap and independently shippable).

Net: a few days of mostly-small, mostly-doctrine-aligned changes turn an already-excellent *structure* into a *reliable* memory.
