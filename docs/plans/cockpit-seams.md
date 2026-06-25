# COCKPIT-seams — give the Cockpit SPA its first internal seams + test surface (Card 2)

> **Where this lives:** tool repo, no `.tcgstackflow/` workspace (ADR 0013) → a plan doc under `docs/plans/`, same shape as `runner-adapter.md`. Status tracked in §0.
>
> **Status:** PLANNED · **Planner:** claude · **Source:** architecture review Card 2 (clusters: API non-module, three SSE lifecycles, pricing×4 drift, ad-hoc view-state, zero frontend tests).

## 0. Build progress

| Subtask | Size | State | Notes |
|---|---|---|---|
| CK-0 frontend test runner (vitest) | S | ⏭️ **deferred** | Dep-free path chosen: pure modules tested under existing `node --test` (.mjs). vitest needed only for CK-3 (the Vue composable) — approval-gated then. |
| CK-1 API client module (+ tests) | M | ◐ mostly | `ui/src/api.js` (url/decode/named getters + primitives) extracted + tested; App.vue imports the primitives + uses it for the pricing fetch. **Follow-up:** migrate the ~9 inline `encodeURIComponent` GET sites to `url()`/named getters (mechanical polish). |
| CK-2 pure helpers + server-sourced pricing | M | ✅ | `pricing.js`/`format.js`/`projection.js` extracted, **8 unit tests**; `GET /api/pricing` + endpoint test; App.vue consumes the server table (default = bundled mirror) → **the 4× pricing-drift bug class is gone**. |
| CK-3 `useRun` run-streaming module (+ tests) | L | ☐ | needs vitest (HIGH/gated) — the Vue composable |
| CK-4 `currentView` + modal-stack (view-state machine) | M | ☐ | highest-risk; optional/last |

**Verified:** `node --test` 108/108 (99 + 8 pure-module + 1 endpoint); `npm --prefix ui run build` clean (App.vue wiring compiles). **Remaining gate:** a manual browser smoke (can't run a browser in this environment) — the extraction is faithful (identical logic, preserved names) so runtime risk is low.

---

## 1. Overview

`ui/src/App.vue` is a **1,332-line single component** with **zero tests** — not an oversight but the direct consequence of *no behaviour sitting behind an interface* (review Card 2). Three symptoms, one cause: the backend API is hand-assembled at ~9 call sites with scattered `j.error===` ladders; three hand-rolled `EventSource` lifecycles (run / chat / inbox-poll) weld SSE logic into view code; the Opus pricing constant is duplicated **4× repo-wide**; the run-state machine lives as scattered `runState.value=` assignments.

The deepening: pull the framework-free behaviour into **importable, DOM-free modules** so the first frontend test surface exists at all — *that extraction is what creates the test surface*, and it kills the pricing-drift bug class on the way.

**Doctrine fit:** ADR 0022 fixes the stack (Vue 3 + Vite SPA, thin server = "the API seam") but is silent on how the *client* organises calls — these modules are additive. ADR 0034:21 **pre-authorises** folding the SPA pricing onto a single server-exposed table ("a known cleanup"). No DB, files-as-truth untouched (frontend-only).

### Hard ordering constraints
1. **CK-0 (vitest) lands first** — there is no frontend test runner today; nothing below is verifiable without it. *This is the one HIGH action (dep install) and is gated on approval.*
2. **Pure modules before the stateful one:** CK-1 (API client) and CK-2 (pricing/format/projection) are low-risk pure extractions; **CK-3 (SSE) is higher-risk** (leak-guard + chain-follow must survive); **CK-4 (view-state) is highest-risk** and optional.
3. No characterization net exists (unlike RA-0). Mitigation: extract **pure** modules first (immediately unit-testable), wire App.vue to them per slice, and **manually smoke the live Cockpit** after CK-3 (the SSE lifecycle can't be fully proven by unit tests alone).

### Canonical owners (after this plan)
| Concern | Single owner | Reused by |
|---|---|---|
| Backend calls (URL build + encode + `{error}` discriminator) | `ui/src/api.js` (client module) | every view; the SSE module's control calls |
| List pricing (the single source) | server `GET /api/pricing` ← `session-report.cjs PRICING` | Home est-spend, budget badge, settings table |
| Run event stream (deltas/tokens/state/approval) | `ui/src/useRun.js` (composable) | live-run panel, Discuss chat (2nd adapter), inbox (stretch) |
| "Where am I" view-state + overlay teardown | a single `currentView` ref + modal-stack | the template `v-if` ladder |

---

## 2. Resolved decisions

| # | Question | **Decision** | Rationale |
|---|---|---|---|
| CK-D1 | Frontend test runner? | **vitest** in `ui/devDependencies` (+ `"test": "vitest run"` in `ui/package.json`). | It's the native Vite test runner (ADR 0022 stack); jsdom-free for pure modules. **HIGH action — gated on approval.** |
| CK-D2 | How does the SPA stop duplicating pricing? | Add a tiny **`GET /api/pricing`** returning `session-report.cjs PRICING`; the SPA fetches it once and drops its 3 inline copies. | ADR 0034:21 names exactly this ("fold the SPA copies onto a single server-exposed table"). One source, server-owned. |
| CK-D3 | API client shape | ~12 named methods returning a **typed `{ok:true,data} \| {ok:false,code}`**; callers switch on `code`, never on a raw `j.error` string or a hand-built URL. | The load-bearing win is the error-discriminator contract (most drift-prone), not URL-DRY. |
| CK-D4 | SSE module shape | `useRun(runId)` exposes the **stream as reactive data** (text, tokens, run-state, pendingApproval); chain-follow re-subscribe + leak-guarded close are **internals**; teardown keys off **run identity** (`runId===id`), never view entry. | Preserves the hard-won leak fixes; chat becomes a 2nd adapter at the same seam, not a copy. |
| CK-D5 | Scope of the view-state machine (CK-4) | **Optional / last.** A single `currentView` ref drives the template ladder + a modal-stack for overlays; the `useRun` lifecycle stays its own module the view machine *calls into*, not absorbs. | Highest regression risk (chain-follow must survive same-view transitions); ship the wins (CK-1..3) first. |
| CK-D6 | Inbox: subscribe vs poll | **Keep the 5s poll for now** (stretch goal to subscribe). | ADR 0027 note: approvals can fire on runs whose panel isn't open; a per-run-id subscription still needs a discovery path. Don't block CK-3 on it. |

---

## 3. Build phases & subtasks

### CK-0 · S · ⛔ HIGH (approval-gated) — frontend test runner
*Files:* `ui/package.json`.
- Add `vitest` (and `@vitest/ui` optional) to `devDependencies`; `"test": "vitest run"`, `"test:watch": "vitest"`.
- A trivial `ui/src/__tests__/smoke.test.js` (`expect(1+1).toBe(2)`) runs green via `npm --prefix ui test`.
- Root note: `npm test` (node --test, server/CLI) and `npm --prefix ui test` (vitest, SPA) are the two suites; CI runs both.

### CK-1 · M — API client module
*Files:* `ui/src/api.js` (new), `ui/src/App.vue`, `ui/src/__tests__/api.test.js` (new).
- `api.js` exports ~12 named methods (`getProjects, getProject, getAgents, getTask, getReport, getRunView, getDiff, runsHistory, listApprovals, startRun, abortRun, decideApproval, sendMessage, saveSettings, setStatus`) — each takes plain args, builds+encodes the URL internally, and returns `{ok:true,data} | {ok:false,code,status}` by normalising the server's `{error}` discriminator.
- App.vue imports `api` and **contains no `/api/...` string or `encodeURIComponent` after this slice**; the 4 `j.error===` ladders collapse to `switch(res.code)`.
- Tests (DOM-free, stub `globalThis.fetch`): assert URL+params for a GET and a POST; assert `over-budget`/`task-already-running`/`critical-ack-required` map to `{ok:false,code}`; assert the duplicated `report.html` builder is one method with an optional `run`.

### CK-2 · M — pure helpers + server-sourced pricing
*Files:* `ui/server/index.cjs` (+`GET /api/pricing`), `ui/src/pricing.js`/`format.js`/`projection.js` (new), `ui/src/App.vue`, tests (new).
- Server: `GET /api/pricing` → `sessionReport.PRICING` (already exported). One-line handler + a `read-cjs`/index test.
- `pricing.js`: `costOf(tokens, table)` consuming the fetched table; App.vue's 3 inline copies (`PRICE`, `PRICING_TABLE`, the prompt string) removed → **pricing-drift bug class gone** (ADR 0034:21).
- `format.js` (`fmtTok`/`fmtUsd`/`relTime`) and `projection.js` (`filteredTasks`/`bucketCounts`/sort) extracted from App.vue.
- Tests: pricing math vs known opus numbers; formatters; task projection over a fixture list — all DOM-free.

### CK-3 · L — `useRun` run-streaming module
*Files:* `ui/src/useRun.js` (new), `ui/src/App.vue`, tests (new).
- One `EventSource` per run-id; exposes reactive `{ text, tokens, state, pendingApproval }`. Internals own: the 7 event listeners, `chain.state==='next'` self-resubscribe ("the hop must never be dropped"), the **2s leak-guarded deferred close** keyed on `runId===id`, and the `error→state` mapping.
- App.vue's `subscribeRun` (113-150) and the chat stream (251-260) both become consumers; chat is a **second adapter** (same lifecycle, per-message payload sink), not a duplicate.
- Tests: drive **synthetic events** into the module (no live socket) and assert the run-state transitions (`running→paused→running→done`), token accumulation, and that a `chain:next` re-subscribes — the state machine becomes the test surface.
- **Manual smoke (required):** a real orchestrated Run still streams deltas, the approval modal still pauses/resumes, a chain hop still follows — identical to pre-refactor.

### CK-4 · M · optional/last — view-state machine
*Files:* `ui/src/App.vue`.
- Replace the `selected/showRuns/selectedAgent/selectedTask` flag-constellation with one `currentView` ref driving the `v-if` ladder; a small modal-stack for the 5 overlays (report/runView/diff/inbox/approval) with one close path.
- **Constraint:** teardown must key off run identity so a chain hop (same view, in-flight `useRun`) is never torn down. Leave `useRun`'s lifecycle to CK-3's module.

---

## 4. Verification strategy
- **New suite:** `npm --prefix ui test` (vitest) green — the first frontend tests in the repo (API client, pricing/format/projection, `useRun` state machine).
- **Existing suite:** root `node --test` stays **99/99** (server `GET /api/pricing` gets a server test; no server regression).
- **Manual smoke after CK-3:** live Cockpit — run stream, approval modal, Discuss chat, chain-follow all behave identically.
- `npm --prefix ui run build` still succeeds (no broken imports).

## 5. Top risks
1. **No characterization net for the SPA** (unlike RA-0) — App.vue behaviour isn't pinned before extraction. *Mitigation:* pure modules first (CK-1/2 are mechanical + immediately tested); gate CK-3/CK-4 on the manual smoke; keep slices small and independently revertible.
2. **The SSE leak-guard + chain-follow** are subtle and load-bearing (scar-tissue comments: "the hop must never be dropped", "a failed refresh can't leak the connection"). *Mitigation:* move them wholesale into `useRun`; assert the re-subscribe + identity-keyed close in tests; manual smoke.
3. **Pricing endpoint coupling** — the SPA now depends on `GET /api/pricing` at load; if it fails, the est-spend/badge must degrade gracefully (show "—", not crash). *Mitigation:* the client method returns `{ok:false}` and the UI falls back to hiding $ rather than throwing.

## 6. ADR & doc status
- No new ADR needed: ADR 0022 (stack) + ADR 0034:21 (pricing cleanup, pre-authorised) cover this. A one-line CONTEXT note may be added if `useRun`/the API client get named domain terms (likely not — they're implementation, not domain).

## 7. Defaults chosen without asking (all reversible)
- Module layout `ui/src/{api,pricing,format,projection,useRun}.js`; tests under `ui/src/__tests__/`.
- vitest (not jest) as the runner — matches the Vite stack.
- Inbox stays polling (CK-D6); view-state machine (CK-4) is optional/last.
