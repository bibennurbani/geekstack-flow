# ORCH-runner-adapter — per-tool runner-adapter seam (ADR 0035) + budget-module consolidation

> **Where this lives & why.** The geekstack-flow *tool repo* has no `.tcgstackflow/` workspace (ADR 0013 — tool repo stays clean), so there is no `tasks/active/` to hold a canonical two-file task. The tool repo plans its own work as a **plan doc under `docs/plans/`** — this file mirrors the shape of `docs/plans/orchestrator-ui.md`, the plan that built the Orchestrator. Status here is tracked in §0, not a workspace `Status:` line.
>
> **Status:** PLANNED · **Planner:** claude · **Source:** ADR 0035 + the June-2026 architecture review (Card 1 runner adapter, Card 7 budget module) + the verified capability matrix.

## 0. Build progress

| Subtask | Size | State | Notes |
|---|---|---|---|
| RA-0 characterization tests (pre-refactor) | S | ✅ | +10 transport-contract tests; adversarially hardened (forked-session, gov config content, token reuse, parse robustness) |
| RA-1 `RunnerAdapter` interface + registry | M | ✅ | `ui/server/runners/{index,claude}.cjs` — pure, no `child_process` |
| RA-2 extract Claude reference adapter | L | ✅ | `run.cjs` delegates argv/parse/resume/gate to the adapter; **96/96 green = behaviour preserved**; dead `os`/`num` removed |
| RA-3 `readRoleTool` → selector; `chat()` via adapter | M | ✅ | launch door 501s any unregistered tool via the registry; `chat()` builds via the adapter (3rd Claude-flag copy gone) |
| RA-4 loop unit-testable with a FAKE adapter | S | ✅ | toy-protocol adapter drives the loop end-to-end — loop proven tool-agnostic |
| RA-5 one budget module (Card 7) | M | ✅ | `sessionReport.budgetFor()` → `{spend,budget,over}`; both server guards route through it; pricing parameterised; 3 direct unit tests (no HTTP) |
| RA-6 record `gate`+`tool` on the run record | S | ✅ | additive frontmatter (`tool`/`gate`) stamped from the adapter; README documents it; badge UI deferred to the first non-Claude adapter |

**Status: ✅ COMPLETE — all 7 subtasks. 99/99 tests green, smoke OK. Completes Card 1 (runner adapter) + Card 7 (budget module).**

---

## 1. Overview

Turn the Orchestrator's **Claude-fused transport** into a **per-tool runner-adapter seam** (ADR 0035), shipping **Claude as the reference adapter** via a *behaviour-preserving* refactor, and fold in the **Card 7 budget-module consolidation** because per-tool pricing is what makes the seam's tool selection matter. The continuation loop, **Run-token** accumulation, **Status safety-net**, **Auto-advance chain**, inactivity timeout and `chat()` all become tool-agnostic *above* the seam; `readRoleTool` becomes the **selector** instead of a dead reader whose only effect is a `501`.

The invariant that survives (ADR 0024): **files are the single source of truth — no second store.** The adapter is a **pure module** (no I/O, no `child_process`); the executor still owns spawning, so the loop is unit-testable with a fake adapter.

### Scope (this plan) — and what is deliberately NOT in it
**In scope:** the `RunnerAdapter` interface + registry, the **Claude** reference adapter (behaviour-preserving), `readRoleTool`→selector, the fake-adapter loop test, and the Card 7 budget module (two **server** copies).
**Out of scope — separate follow-on plans** (no-bundle rule): `ORCH-runner-copilot`, `ORCH-runner-codex`. **Antigravity** stays a Copy-prompt target (no task). The **App.vue** budget/pricing copy is the ADR-0034-acknowledged SPA cleanup (the browser can't `require` the `.cjs`) — separate.

### Hard ordering constraints
1. **RA-0 characterization tests land first** — behaviour-preservation is the acceptance oracle (Refactorer doctrine, ADR 0031); we cannot prove "no functional change" without them.
2. **RA-1 interface before RA-2 extraction** before **RA-3 selector** — the loop must consume a defined seam before transport moves behind it.
3. **RA-5 budget module is independent** and may land in parallel; it only *composes* with the seam (per-tool pricing later).

### Canonical owners (no duplicate writers/logic)
| Concern | Single owner (after this plan) | Reused by |
|---|---|---|
| Per-tool transport (argv / stream-parse / resume / gate) | `ui/server/runners/{tool}.cjs` adapter | the executor's continuation loop + `chat()` |
| Adapter selection (role → tool → adapter) | `readRoleTool` selector + `runners/index.cjs` registry | `index.cjs` launch door, executor |
| Uniform run events (`delta`/`tokens`/`session`/`result`) | adapter `parseLine` | `emit()` / SSE fan-out (unchanged) |
| Spend-vs-budget math | `budgetFor()` (new, in the projection layer) | `index.cjs` enqueue guard + `run.cjs` launch re-check |

---

## 2. Resolved decisions

| # | Question | **Decision** | Rationale |
|---|---|---|---|
| RA-D1 | Scope — one task or split? | **Split.** This plan = seam + Claude adapter + budget module. Codex/Copilot = separate plans; Antigravity = Copy-prompt. | No-bundle rule; each non-Claude adapter carries distinct unknowns (Copilot incremental-stream smoke test, Codex sandbox/app-server path) that must not ride a behaviour-preserving refactor. |
| RA-D2 | Acceptance oracle for the Claude adapter | **Behaviour-preservation** (ADR 0031). Characterization tests (RA-0) green before *and* after; no functional change; no `workspace_schema` bump. | The Claude adapter is today's executor refactored behind an interface — the safe first slice that de-risks the seam. |
| RA-D3 | Where the adapter lives / its shape | New `ui/server/runners/index.cjs` (registry+selector) + `ui/server/runners/claude.cjs`. **Pure** modules: `buildSpawn(run,ctx)→{bin,args,env}`, `parseLine(line,state)→Event[]`, `resumeIdFrom(state)→string\|null`, `capabilities{gate,tokens,stream,resume,topology}`. No `child_process`. | Matches the existing injection pattern (`createExecutor` already takes `spawn`/`claudeBin`); keeps the loop testable with a fake. |
| RA-D4 | Unknown / unregistered tool | Selector returns `null`; `index.cjs` maps that to the **existing `501`** at the launch door (don't enqueue a doomed run). | Preserves today's guard location + behaviour; purely relocates the branch behind the selector. |
| RA-D5 | Surface the `gate` fidelity now? | **Record `gate` + `tool` on the `runs/` frontmatter** (additive, like the D4 `state` field — no schema bump). **Defer the Cockpit badge UI** to the first non-Claude adapter (everything is `mcp-intercept` until then). | Makes the data ready without UI churn while fidelity is uniform. |
| RA-D6 | Budget-module scope | Consolidate the **two server copies** (`run.cjs overBudget` + `index.cjs` enqueue guard) into `budgetFor(projectPath,{model})→{spend,budget,over}`; pricing a **parameter** (default `claude-opus`). **Lift the math, not the policy** — `force` handling + the 409-vs-error response stay per-site. | Verify-stage finding; the SPA copy is a separate ADR-0034 cleanup; don't balloon. |
| RA-D7 | cwd on resume | The executor already spawns `cwd: run.project_path`; the **adapter must not re-derive cwd**. A characterization test asserts resume iterations reuse iteration-0's cwd. | Claude `--resume` lookup is **dir+worktree-scoped** (research); the multi-repo pull-hook walks *up* to the workspace root, so cwd must be pinned per-run. |
| RA-D8 | Schema / config change? | **None.** `orchestrator.roles` already exists (schema 4); the seam is code-internal; the `gate`/`tool` fields are additive frontmatter. | Behaviour-preserving + additive only. |

---

## 3. Build phases & subtasks

Sizes: **S** ≈ <½ day, **M** ≈ ½–1 day, **L** ≈ 1–2 days. ACs are condensed to the checkable essentials.

### Phase 0 — Lock current behaviour (de-risk)

**RA-0 · S** — Characterization tests of the *current* executor. *Files:* `test/run-executor.test.cjs` (extend), `ui/server/fixtures/claude-stream.ndjson` (reuse).
- With the existing fixture fed through an injected fake `spawn`, pin TODAY's behaviour: (a) `delta`/`tokens`/`session` events emitted in order; (b) token accumulation across ≥2 continuation iterations sums the four classes; (c) `_sawDelta` double-count avoidance (whole-`assistant` text used only when no partial deltas streamed); (d) the **Status safety-net** fires only on a clean run that left status un-advanced; (e) abort → `aborted` record, no advance; (f) resume iterations spawn with iteration-0's `cwd`.
- All green against `npm test` **before** any code moves. These tests must stay byte-for-byte green through RA-2/RA-3.

### Phase 1 — The seam + Claude reference adapter

**RA-1 · M** — `RunnerAdapter` interface + registry. *Files:* `ui/server/runners/index.cjs` (new).
- Define (JSDoc, zero deps) the pure interface: `buildSpawn(run, ctx)→{bin,args,env}` where `ctx={prompt,iter,resumeId,governance,mode:'run'|'chat'}`; `parseLine(line, state)→Event[]` with `Event ∈ {type:'delta',text}|{type:'tokens',usage}|{type:'session',id}|{type:'result',code}`; `resumeIdFrom(state)→string|null`; `capabilities{gate,tokens,stream,resume,topology}`.
- `select(tool)→adapter|null` registry; `claude` registered; unknown → `null`. Unit test: `select('claude')` non-null, `select('codex')`/`select('bogus')` → `null`.

**RA-2 · L** (dep RA-0, RA-1) — Extract the Claude reference adapter. *Files:* `ui/server/runners/claude.cjs` (new), `ui/server/run.cjs`.
- Move into `claude.cjs`, **unchanged in behaviour**: the argv build (`-p … --output-format stream-json --verbose --include-partial-messages`, the `--resume <resumeId>` idiom, the governance flags `--mcp-config/--permission-prompt-tool/--permission-mode/--allowedTools` + the per-run token env), and the `handleLine` stream-json parse → uniform events (preserving `_sawDelta` exactly).
- `capabilities = {gate:'mcp-intercept', tokens:'per-turn', stream:'incremental', resume:true, topology:'we-spawn'}`.
- `run.cjs`'s `spawnOnce` becomes: `const {bin,args,env}=adapter.buildSpawn(run,ctx)`, spawn (still in `run.cjs`), feed each line to `adapter.parseLine`, route the returned events through the existing `emit()`. **RA-0 stays green.**

**RA-3 · M** (dep RA-2) — `readRoleTool` → selector; `chat()` via the adapter. *Files:* `ui/server/run.cjs`, `ui/server/index.cjs`.
- `readRoleTool` still reads `orchestrator.roles`, but the executor now resolves `select(tool)`; `null` → the launch door returns the **existing `501`** (RA-D4) before enqueue.
- `chat()` calls `adapter.buildSpawn(run, {...,mode:'chat'})` (read-only `--allowedTools Read,Grep,Glob,LS`, no gate) instead of its own duplicated Claude flag string. The third inlined copy is gone.

**RA-4 · S** (dep RA-1, RA-2) — Loop unit-testable with a FAKE adapter. *Files:* `test/run-executor.test.cjs`.
- A `fakeAdapter` whose `parseLine` emits scripted events drives the continuation loop with **no real subprocess** (still injecting `spawn` for process lifecycle, but transport semantics come from the adapter). Assert: continue-until-advance, 6-iter cap, "produced nothing new → stop", abort, token accumulation — **tool-independently**. This is the headline win: the loop is now provable without faking a CLI.

### Phase 2 — Budget module (Card 7)

**RA-5 · M** — One spend/budget module. *Files:* `ui/server/read.cjs` (add `budgetFor`), `ui/server/run.cjs`, `ui/server/index.cjs`.
- `budgetFor(projectPath, {model='claude-opus'})→{spend,budget,over}` owns: read `orchestrator.budget_usd`, sum `tokens_total` across tasks, price via `sessionReport.costOf(tk, model)`, compare.
- `index.cjs` enqueue guard and `run.cjs` launch re-check both call it; **`force` handling + the 409-vs-error-event response stay at each call site** (lift the math, not the policy). The `'claude-opus'` literal disappears into the one default.
- Unit test the math directly (over/under/at-budget; unreadable config → not over) — no HTTP 409 round-trip needed.

### Phase 3 — Fidelity data (minimal)

**RA-6 · S** (dep RA-2) — Record `gate` + `tool` on the run record. *Files:* `ui/server/run.cjs` (`writeRunRecord`), `templates/workspace/.tcgstackflow/runs/README.md` (document the additive fields).
- The terminal `runs/{task}/{run}.md` frontmatter gains `tool: claude` and `gate: mcp-intercept` (additive; mirrors the D4 `state` field — no schema bump). README documents them.
- **Cockpit badge rendering is deferred** to the first non-Claude adapter (all runs are `mcp-intercept` until then), but the data is ready.

---

## 4. Verification strategy
- **Behaviour-preservation:** RA-0 characterization suite green **before and after** RA-2/RA-3 (the oracle for "no functional change").
- **New coverage:** the fake-adapter loop test (RA-4) and the budget-math unit test (RA-5) — both reachable without a real subprocess or an HTTP socket.
- **Gates:** `npm test` + `npm run smoke` pass.
- **Manual smoke:** a real `claude` orchestrated Run still streams deltas, accumulates tokens, advances to `IN_REVIEW`, and the governance approval card still pauses/resumes — identical to pre-refactor.

## 5. Top risks (residual)
1. **Stream-parse extraction** — `handleLine`'s `_sawDelta` double-count avoidance is subtle; RA-0(c) is the guard. *Mitigation:* move the function wholesale, don't rewrite.
2. **Governance flag wiring is security-load-bearing** — the per-iteration `--mcp-config` temp file, the per-run token, and the `GSF_*` env must be reproduced exactly in `buildSpawn`. *Mitigation:* characterization assertion on the exact argv + env for a governed run.
3. **`chat()` read-only contract** — must keep `--allowedTools Read,Grep,Glob,LS` and **no** permission-prompt-tool (a chat must never mutate). *Mitigation:* assert chat-mode argv carries no gate.

## 6. ADR & doc status
- **ADR 0035** (this plan implements it) — already written. **CONTEXT.md** "Runner adapter" + "Fidelity" terms — already added.
- A tiny ADR amendment may be warranted once Codex/Copilot land and the `capabilities` flags are realised against real tools (the table in 0035 is provisional by design).

## 7. Follow-on plans (not this task)
- **`ORCH-runner-copilot`** — `copilot -p --output-format json` adapter; governance via the **fail-closed `preToolUse`** hook (never `permissionRequest`); `tokens:'session-total'`; ship behind an empirical incremental-stream smoke test; first to need the Cockpit `gate` badge UI.
- **`ORCH-runner-codex`** — `codex exec --json` + `codex exec resume` adapter; `gate:'sandbox-preset'` (badge, no card); revisit the experimental app-server JSON-RPC (`topology:'we-host-jsonrpc'`) only after hang-bug #11816 stabilises.
- **Antigravity** — Copy-prompt only until `agy -p` emits a captured stream + headless session-id (bugs #76/#7). No task.

## 8. Defaults chosen without asking (all reversible)
- File layout `ui/server/runners/{index,claude}.cjs`.
- Unknown-tool guard stays the existing `501` at the launch door (RA-D4).
- `gate`/`tool` recorded on the run record now; badge UI deferred (RA-D5).
- Budget module returns `{spend,budget,over}`; SPA copy left for the separate ADR-0034 cleanup.
