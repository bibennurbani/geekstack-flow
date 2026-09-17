# DELEGATION — measure first, then let a role hand work to a cheaper delegate

> **Where this lives:** tool repo, no `.tcgstackflow/` workspace (ADR 0013) → a plan doc under `docs/plans/`, same shape as `eval-feedback-loop.md`. Status in §0.
>
> **Status:** PLANNED · **Planner:** claude · **Source:** brainstorming session (2026-09-17), nine-agent evidence probe + three adversarial critiques. **Decides:** ADR 0047 (amends 0034, discharges 0035:39, stages within 0026/0037/0042). **Shape:** the split that makes this safe — **accounting is free and lands first; capability is granted one class at a time, against the numbers the accounting produces.**

## 0. Build progress

| Subtask | Size | State | Notes |
|---|---|---|---|
| DEL-0 ADR 0047 | S | ✅ | Written 2026-09-17, status **proposed**. |
| **Stage 0 — measurement (no delegation, no behaviour change)** | | | |
| DEL-1 parse `modelUsage` / `total_cost_usd` / `num_turns` | S | ⬜ | `claude.cjs:74-84` emits a `usage` event beside today's `tokens`. Cumulative per query → **latest-wins within an iteration, summed across**. Porting `run.cjs:271-274`'s `+=` double-counts every continuation. |
| DEL-2 parse the `system` / init record | S | ⬜ | New `session-init` event carrying `model`, `agents[]`, `tools[]`, `permissionMode`. Free — already in the captured fixture. |
| DEL-3 run-record fields | M | ⬜ | `read.cjs:459-501` gains flat `model`, `turns`, `cost_usd` + a `by_model:` block of flat scalars — the `write_attempts.tools` idiom at `:495-497`. Parser is **two levels** (`:441-445`, hazard documented at `:493-494`). Omit-when-absent: existing records stay byte-identical. |
| DEL-4 Session Report sees delegates | M | ⬜ | `findSessionLog` → `findSessionLogs` returning `{main, delegates[]}`, globbing `<session_id>/subagents/**/agent-*.jsonl`. Today it opens only `<session_id>.jsonl` — delegates are structurally invisible. |
| DEL-5 per-model pricing | M | ⬜ | Accumulator keyed by `m.model`; `budgetFor:119` stops hard-coding `opts.model \|\| 'claude-opus'`; **explicit zero row for local models** — `priceFor:24` currently returns opus for any unknown model, so a free ollama delegate would bill at $15/$75 per M. |
| DEL-6 Cockpit mixed-model cost | S | ⬜ | `pricing.js` gains `costOfMixed(by_model)`; `App.vue:755` swaps — one line feeding the Home spend hero (`:1299-1302`), the agent token tab (`:1257`) and `projectSpend`. |
| DEL-7 ADR 0034 amendment | S | ⬜ | Line 23's "one role per session" assumption is what delegation invalidates. Record the ADR 0035:39 debt as paid. |
| **Stage 1 — read-only in-session delegation (Claude transport)** | | | |
| DEL-8 `agents/delegates/scout.md` | S | ⬜ | Canonical delegate profile, convention-locked sections (ADR 0005). Read-only + the qmd surface. **One** type to start. |
| DEL-9 `ui/server/delegation/roster.cjs` | M | ⬜ | PURE, zero-dep. `buildRoster()` → the `--agents` JSON string; verified key set is `{description, prompt, tools, model}` — unknown keys are **silently stripped**, so a typo'd `whenToUse` surfaces as "description missing". `validateRoster()` mirrors the CLI's zod. Must **not** live in `claude.cjs` (ADR 0035 forbids fs there). |
| DEL-10 roster generation into the adapter | S | ⬜ | Generated from the profile at init/upgrade into `tools/claude/`; read by `run.cjs`. Canonical content + generated shim = ADR 0005. |
| DEL-11 thread `model` + `agents` through the seam | M | ⬜ | `run.cjs:296` is the one ctx both run and chat funnel through. Flags **re-sent every iteration**: `--agents` validation is skipped under `--resume`. |
| DEL-12 fail-open detection | M | ⬜ | Assert `system.agents[]` contains the roster names every iteration; absence **fails the run** with a recorded reason. Unguarded, safe mode resolves a spawn to a built-in with `tools:["*"], maxTurns:500` — measured at **~$596 from one call** vs an intended $1.33. |
| DEL-13 classify `Agent` (and `Task`) | S | ⬜ | Anchored branch in `classifyTool` beside the qmd line. `:73`'s fail-safe HIGH stays. **`allowedTools` untouched** — `index.cjs:36` is an auto-*approval* list; adding the spawn tool there deletes the gate. |
| DEL-14 agent-CLI family → HIGH in Bash | S | ⬜ | `claude\|codex\|gemini\|copilot\|aider\|cursor-agent\|ollama\|llama-cli` in `classifyBashSegment`. Today they classify MEDIUM and auto-allow: a Bash-holding delegate is a gate-free recursive spawn. |
| DEL-15 `--strict-mcp-config` + chat hardening | S | ⬜ | Deterministic tool surface. `chat()` gets `--tools` (the real restriction) and **never** a roster. `run-executor.test.cjs:483` deep-equals the chat argv — same change. |
| DEL-16 approval card shows the delegate | S | ⬜ | `describeAction` branch: delegate type + objective. Two concurrent cards both reading "Agent" are unanswerable. |
| DEL-17 pause ceiling | S | ⬜ | `run.cjs:323` re-arms the inactivity timer forever while paused — under autopilot one delegation holds a project slot indefinitely, with the Cockpit closed, with no failure. |
| DEL-18 doctrine into the six profiles + adapter head | M | ⬜ | Portable half (what to split off, the brief, reviewing the return, log attribution) separated from the Claude-only transport; a Codex/Copilot run has no roster and does the work itself — an explicit no-op. Profiles refresh on upgrade; skills do not (`init.js:874`). |
| DEL-19 argv assertions → membership | S | ⬜ | `run-executor.test.cjs:414`, `:465-468` pin **positional indices** and break on any added flag. |
| **Stage 2 — write-capable delegates** (earned by stage-0/1 data) | | ⬜ | Actor-attributed write attempts; worktree requirement; the refuse-to-advance branch that makes "the parent reviews the diff" real; further delegate types; fan-out > 2; the config ceiling if it earns itself. |
| **Stage 3 — foreign + local delegates** | | ⬜ | Codex runner adapter through the ADR 0035 seam **first**, then the delegation MCP, then local completion models as a capability-declared adapter. Gated on ADR 0002's unmet cost arithmetic. |

**No code written.** DEL-0 (the ADR) is the only completed subtask.

---

## 1. Why

The ask was "let our agents spawn agents, with the right context and the cheapest adequate model." The
measurement says that is worth doing: against the six real `runs/` records on disk, a 40-file discovery
sweep costs **$20.02** inline on an opus parent versus **$2.71** delegated to haiku — **86%**.

The same measurement says the feature cannot currently prove it. `result.usage` is main-loop-only, so
delegate tokens never reach the run record or the budget guard; and the Session Report opens
`<session_id>.jsonl` while delegates write to `<session_id>/subagents/**`. Shipped as originally scoped,
delegation would be a large new surface whose entire justification is invisible to the system.

That is the same trap ADR 0025 walked into and named: cost-spreading shipped **off** by default in 2025
because "the savings are still theoretical — unmeasured", and eighteen months on the measurement was never
built. Stage 0 builds it, costs almost nothing, and is worth shipping even if delegation never follows.

## 2. Scope

**In:** per-model token/cost accounting end to end; delegate-visible session reports; one read-only
delegate type driven by the native `Agent` tool with a generated roster; explicit classification of the
spawn tool; fail-open detection; delegation doctrine in the six role profiles and the adapter head.

**Out (staged, not dropped):** write-capable delegates; foreign (Codex/Copilot) and local (ollama /
llama.cpp) delegates and the delegation MCP that would drive them; orchestrator-queued runs; Workflow-tool
fan-out; the `config.yaml` model-ceiling block; a `delegate-work` skill and a `/tcgflow-delegate` command.

## 3. The two invariants

1. **The parent is the working tree's only writer.** A write-capable delegate at fan-out N is the
   same-project parallelism ADR 0026 deferred, and the run lock cannot see it — it holds one *run* per
   project path, not one writer. It also breaks the premise ADR 0037's write tripwire rests on, by
   recording a delegate's write under the parent's role.
2. **Fidelity is asserted, never assumed.** `--agents` adds types without removing built-ins and is
   ignored outright under safe mode. The roster's presence is checked against the `system` record every
   iteration, and its absence fails the run — ADR 0035's rule applied to a new axis.

## 4. What we measured (so the next reader does not re-derive it)

| Question | Answer | Source |
|---|---|---|
| Is the saving real? | 86% on a 40-file sweep ($20.02 → $2.71) | six real `runs/` records, shipped price table |
| What buys it? | delegating at all = 52.7%; dropping the delegate to haiku = 47.3% | same |
| Where does the 47.3% come from? | a `model` string in the generated roster — **not** a config block | — |
| Is the parent's context the dominant cost? | No. `cache_read` is 91.2% of tokens but 38% of dollars; **parent turns** dominate at ~$0.30/turn on a 200k context | six records |
| What does a delegate's own cost look like? | boot (cache-write) is **67%** of a haiku delegate's total — fan-out multiplies it | 155 subagent transcripts |
| Worst case if the roster fails open? | ~**$596** from one call (built-in type, `maxTurns:500`) vs an intended $1.33 | binary 2.1.274 + measured per-turn rate |
| What is the spawn tool called? | **`Agent`** in 2.1.274; `session-report.cjs:29` already buckets it | binary; verified against the classifier |

## 5. Verification

`npm test` green at every subtask boundary. Baseline before starting: **346 passing, 1 skipped** (347 total).

New tests, following the principle the superpowers audit extracted — *run the real code against the real
shipped artifact, assert on outputs, never on source text*:

- mixed-model fixture (opus parent + haiku delegate): per-bucket cost, and the total is **not** the
  single-model figure;
- run-record round-trip for `model` / `turns` / `cost_usd` / `by_model`, plus byte-identity for a record
  without them;
- latest-wins regression proving `+=` on cumulative `modelUsage` double-counts across iterations;
- fake-adapter run whose `system` record omits the roster → the run fails, explicitly;
- `Agent` and `Task` classify identically; `claude -p` and `ollama run` classify HIGH;
- argv **membership** (not index) for `--model`, `--agents`, `--strict-mcp-config`, and the chat argv.

End-to-end via the fake-`claude` shim on `PATH` with real git — no API cost — for the roster path and the
fail-open branch.

**Counts:** adding ADR 0047 moves the `adrs` claim 46 → 47 in `README.md`, `docs/README.md`,
`docs/USAGE.md` and `docs/geekstackflow-overview.md` (`COUNT_CLAIMS`, `templates-structure.test.cjs:94`).
No skill or command is added, so the skill/command claims are untouched.

**Two shipped narrative claims go stale at DEL-11** and should be brought under `COUNT_CLAIMS` rather than
hand-patched: `docs/geekstackflow-internals-script.md:445` ("No `--model`. No system prompt. No skill
list.") and the matching deck line.
