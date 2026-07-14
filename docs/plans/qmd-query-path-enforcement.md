# QPE — enforce the qmd query-path (tiered fidelity) + record the discovery path

> **Where this lives:** tool repo, no `.tcgstackflow/` workspace (ADR 0013) → a plan doc under `docs/plans/`, same shape as `cockpit-seams.md`. Status in §0.
>
> **Status:** IN_REVIEW · **Planner/Coder:** claude · **Source:** grill-with-docs session (2026-07-14) → ADR 0037. **Decides:** ADR 0037 (amends 0030). **Scope revised to OBSERVE-FIRST** after an honest re-appraisal: the enforcement gate defends an unobserved bypass and adds complexity to the safety-critical governance path, so it is *designed but deferred* (preserved on branch `feat/qmd-query-path-enforcement-full`) until the run-record data shows it's needed.

## 0. Build progress

| Subtask | Size | State | Notes |
|---|---|---|---|
| QPE-0 ADR 0037 + CONTEXT.md "mandatory" disambiguation | S | ✅ | ADR rewritten (observe-first, gate-deferred); CONTEXT.md Wiki-search term split into install-time vs query-time. |
| QPE-1 query-path **enforcement gate** (soft-deny pre-qmd wiki body-grep) | M | ⏸️ **DEFERRED** | Fully built + unit-tested on `feat/qmd-query-path-enforcement-full`. Held: guards an unobserved bypass; per-iteration + Claude-only + grep-only; adds a methodology concern to the risk gate. Enable when QPE-2's record shows real bypassing. |
| QPE-1b **observe** the discovery path (no blocking) | S | ✅ | `isQmdInvocation` in `governance-classify.cjs`; `decide()` flips `qmdSeen` + reports telemetry (async qmd boot-check for index-fallback) — **never changes allow/deny**. `Grep` stays pre-allowed. **Unit-tested.** |
| QPE-2 run-record `wiki_discovery` block (serialize/parse, +tests) | S | ✅ | `read.cjs` serialize/parse (path/reason/queries/redirects), sibling of `embed`; `/api/run/wiki-discovery` loopback intake + `noteDiscovery` accumulator. **Round-trip tests.** |
| QPE-3 Cockpit badge | S | ◐ | `read.cjs` projection (runs list + detail) + `App.vue` badge + `wikiDiscoveryTitle`. **Build clean; badge populate needs a live-Cockpit smoke** (no headless browser here). |
| QPE-4 `wiki-search` skill: tighten thin/stale + reword anti-pattern | S | ✅ | prose: refine-before-retreat; raw grep never the fallback; log.md carve-out noted. |
| QPE-5 skill bodies (grill-task/plan-task/review-diff) + refactorer fallback + ADR 0006 header | S | ✅ | prose/consistency all applied. |
| QPE-6 post-merge hook incremental re-embed on wiki/docs-touching merges | S | ✅ | backgrounded, guarded by `command -v qmd`; only on wiki/docs-touching merges. |
| QPE-7 drift detector (audit-workspace) | M | ✅ | new Detector #9 "qmd-first discovery drift"; multi-project renumbered to #10. |

**Verified:** `node --test` **175/175** (167 + 8 observe/serialize tests); `npm --prefix ui run build` clean. `ui/dist` is not git-tracked (built on install).

**Deferred, on purpose:** (1) the **enforcement gate** (QPE-1) — designed + tested on `feat/qmd-query-path-enforcement-full`, enable only if the data warrants; (2) the **badge populate** (QPE-3) needs a live-Cockpit smoke — the discovery telemetry (`qmd query` seen → `qmdSeen` → `/api/run/wiki-discovery` → badge) can't be exercised without a live gated-`claude` run (per working-style, UI/runtime isn't headless-smokable). The record round-trip and the observe logic *are* unit-tested.

---

## 1. Overview

Per the audit (grill session → ADR 0037): qmd is mandatory-to-**install** and write-side-**fresh** (both enforced), but the **read/query path is prose-only** — nothing stops an agent grepping `wiki/**` to discover pages, and `governance-classify.cjs` rates `grep`/`Read` LOW → auto-allowed. This plan makes the query-path **enforced on Claude + observed on every tier**, keeping the `index.md` fallback ADR 0030 deliberately preserved.

**Doctrine fit:** reuses the governance interception (the only live gate) and the run-record outcome-field pattern (ADR 0036's `embed` block). No DB; files-as-truth untouched. Enforcement is *tiered fidelity* (ADR 0019/0035) — Claude gated, others observed — surfaced honestly by a badge.

### Hard ordering constraints
1. **QPE-1 (gate) and QPE-2 (record field) are independent** — do QPE-2 first (tiny, unlocks QPE-3) then QPE-1.
2. **QPE-3 depends on QPE-2** (needs the field in the projection).
3. Prose subtasks (QPE-4/5) and the hook (QPE-6) and detector (QPE-7) are independent of the code ones.
4. The new **discovery gate is fail-OPEN** (a missed grep is a quality lapse, not a safety breach) — do NOT touch the risk gate's fail-CLOSED behavior for HIGH/CRITICAL.

### Canonical owners (after this plan)
| Concern | Single owner |
|---|---|
| "Is this action a pre-qmd wiki body-grep?" classification | `governance-classify.cjs` (`classifyWikiDiscovery` helper) |
| Per-run `qmdSeen`/`qmdAbsent` state + soft-deny redirect | `governance-mcp.cjs` (`decide`) |
| `wiki_discovery` block read/write | `read.cjs` run-record serializer |
| Discovery-path self-report | `wiki-search/SKILL.md` precondition step |
| qmd-first convention as an invariant | `audit-workspace` detector |

---

## 2. Subtask detail + acceptance criteria

### QPE-1 — the gate (Claude tier)
- Add `classifyWikiDiscovery(tool, input, {qmdSeen, qmdAbsent})` (pure) → returns `'redirect'` when the action is a raw full-text `grep`/`rg`/`find`-content over `.tcgstackflow/wiki/**` page **bodies** AND `!qmdSeen` AND `!qmdAbsent`; else `null`. **Carve-outs → null:** target is `index.md`; the `grep "^## \[" … log.md` timeline read; any `Read`; any non-wiki path.
- `governance-mcp.cjs`: hold per-process (= per-run) `qmdSeen` (set when a Bash `qmd query|search|vsearch` is seen) and `qmdAbsent` (set when a `qmd --version` fails, observed via the classifier or a cheap check). On a `'redirect'`, return `deny("discover via wiki-search (qmd) first — or navigate wiki/index.md; raw grep over wiki bodies is not the fallback")`. Everything else unchanged (LOW/MEDIUM allow; HIGH/CRITICAL risk path untouched).
- **Fail-open:** any uncertainty → allow.
- **AC:** unit tests — (a) pre-qmd `grep -r foo .tcgstackflow/wiki` → redirect; (b) same after a qmd query seen → allow; (c) `grep "^## \[" wiki/log.md` → allow always; (d) `Read wiki/architecture.md` → allow always; (e) qmd absent → allow (fallback); (f) HIGH/CRITICAL classification unchanged.

### QPE-2 — run-record `wiki_discovery` block
- In `read.cjs` serializer (beside `embed`, ~L445-490): emit/parse `wiki_discovery:` with `path` (`qmd|index-fallback|none`), optional `reason`, `queries` (int). Absent → `null`, no emission (older runs unaffected).
- **AC:** round-trip test (serialize→parse) preserves the block; absent block → `null`.

### QPE-3 — Cockpit badge
- `read.cjs` run projection: include `wiki_discovery`.
- `App.vue`: render a small badge beside the fidelity/embed badges — `discovery: qmd` (accent) / `index-fallback: {reason}` (muted/warn) / none. No badge when absent.
- **AC:** projection includes the field; `npm --prefix ui run build` clean.

### QPE-4 — `wiki-search/SKILL.md`
- Precondition step: record the discovery path taken (for the run record). Tighten the "thin/stale → index.md" hatch to require a `query↔search↔vsearch`/refine attempt first. Reword the anti-pattern so raw grep is **never** the fallback (only structured `index.md` nav is).
- **AC:** no conditional wording that licenses grep when qmd is unavailable; the thin/stale path names the refinement precondition.

### QPE-5 — skill bodies + consistency
- Add "discover via wiki-search (qmd); never Grep/Read wiki files to *discover*" to `grill-task`, `plan-task`, `review-diff` bodies; broaden `review-diff` from the two hard-coded pages to qmd-surfaced feature pages. Give `refactorer.md` the `index.md`-fallback clause the other 5 carry. Add a supersession header to ADR 0006 → 0030/0036/0037.
- **AC:** all three skill bodies reference wiki-search; refactorer has the fallback clause; 0006 points forward.

### QPE-6 — post-merge freshness backstop
- In `hooks/post-merge`, when the merge touched `wiki/` or `docs/` and `qmd --version` succeeds, run an incremental `qmd embed` (non-blocking, never fails the hook).
- **AC:** hook still exits 0 when qmd absent; embed only fires on wiki/docs-touching merges.

### QPE-7 — drift detector
- In `audit-workspace` (and/or `lint-wiki`): flag any skill whose body recalls the wiki but lacks a `wiki-search`/qmd reference, and any agent profile missing the `index.md`-fallback clause.
- **AC:** detector documented in the skill; catches the pre-fix Refactorer state as a positive control.
