# Delegation Stage 0 — Per-Model Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a run's token, model and dollar cost per-model-accurate and delegate-visible, so that every later claim about delegation efficiency is falsifiable — with no behaviour change to how runs execute.

**Architecture:** Everything needed already arrives on the `claude` CLI's stream and is discarded. The `result` record carries `modelUsage` (per-model buckets, delegates included), `total_cost_usd` and `num_turns`; the `system` record carries `model`, `agents[]`, `tools[]` and `permissionMode`. The runner adapter (pure) learns to emit them as new uniform events, the executor loop folds them with *latest-wins-within-iteration, summed-across-iterations* semantics, the run record gains four flat frontmatter fields, and the Session Report learns to read the `subagents/` transcript tree it is currently blind to. Pricing moves from one model per task to per-model buckets.

**Tech Stack:** Node.js (zero runtime dependencies, CommonJS `.cjs` on the server), `node --test` with `node:assert`, Vue 3 SFC for the Cockpit client.

**Spec:** `docs/plans/delegation.md` (stage 0, subtasks DEL-1..DEL-7) and `docs/adr/0047-delegation-is-measured-before-it-is-granted.md`.

## Global Constraints

- **Zero npm dependencies.** Server code is dependency-free; do not add a package for globbing, YAML or pricing.
- **The runner adapter is PURE.** `ui/server/runners/*.cjs` must never `require('fs')`, `require('child_process')` or `require('crypto')` (ADR 0035). The adapter *describes* an invocation and *maps* a stream; the loop owns I/O.
- **Files as truth, no new store.** No database, no new state directory. Run state stays `runs/*.md` + ephemeral server memory (ADR 0024).
- **Run-record frontmatter is exactly two levels deep.** A third level round-trips wrong — the hazard is already documented at `ui/server/read.cjs:493-494`. Nested data is serialized as a **flat scalar string** on a second-level key, following the existing `write_attempts.tools` idiom (`Edit=2 Write=1`).
- **Existing records stay byte-identical.** Every new frontmatter field is omitted when absent, the way `isolation` is (`read.cjs`). A record written without the new data must serialize to exactly the bytes it does today.
- **No behaviour change in this stage.** No new CLI flag is passed, no delegate can spawn, no governance level changes. This stage only parses, records and prices.
- **Test command:** `npm test` runs `node --test` over `test/*.test.{cjs,mjs}`. A single file: `node --test test/<file>`. Baseline before starting: **346 passing, 1 skipped** (347 total).
- **Commit style:** conventional-commit subject, imperative mood, body explaining *why*. End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Do not push.** Commit locally only; pushing to `main` requires the owner's explicit approval.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `ui/server/runners/claude.cjs` | Claude-specific stream → uniform events. Gains the `usage` and `session-init` mappings. Stays pure. | Modify |
| `ui/server/runners/index.cjs` | Adapter interface documentation (the duck-typed contract every adapter and every fake in tests implements). | Modify (comment only) |
| `ui/server/run.cjs` | The executor loop. Owns accumulation semantics across iterations and hands the structured record to the serializer. | Modify |
| `ui/server/read.cjs` | The single executable spec for the run-record format (`serializeRunRecord` / `parseRunRecord`). | Modify |
| `ui/server/session-report.cjs` | Session-log discovery, per-turn parsing, pricing, the budget computation. | Modify |
| `ui/src/pricing.js` | The client's mirror of the server pricing table. | Modify |
| `ui/src/App.vue` | Cockpit cost rendering. | Modify (one function) |
| `docs/adr/0034-session-report-from-session-jsonl-with-dollar-cost.md` | Amend the "one role per session" assumption. | Modify |
| `test/run-executor.test.cjs` | Adapter mapping + loop accumulation tests. | Modify |
| `test/read-cjs.test.cjs` | Run-record round-trip and byte-identity tests. | Modify |
| `test/session-report.test.cjs` | Per-model pricing, delegate discovery, budget tests. | Modify |

No new source files. Stage 0 is entirely additive edits to existing modules — the new module (`ui/server/delegation/roster.cjs`) belongs to stage 1.

---

### Task 1: Adapter emits per-model usage from the result record

**Files:**
- Modify: `ui/server/runners/claude.cjs:74-84`
- Modify: `ui/server/runners/index.cjs:14` (interface comment)
- Test: `test/run-executor.test.cjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a new uniform event consumed by Task 2 —
  `{type: 'usage', by_model: {[modelId]: {input, output, cache_read, cache_creation, cost_usd}}, cost_usd: number, turns: number}`.
  The existing `{type:'tokens', usage:{input,output,cache_read,cache_creation}}` event is **unchanged**.

**Context you need:** the CLI's `result` record carries both `usage` (main agent loop **only** — this is the field GSF sums today) and `modelUsage` (every model call in the query pipeline, including Agent-tool delegates). The captured fixture at `ui/server/fixtures/claude-stream.ndjson` contains a real one, with camelCase keys:

```json
{"claude-opus-4-8[1m]": {"inputTokens": 6073, "outputTokens": 4,
  "cacheReadInputTokens": 16291, "cacheCreationInputTokens": 1885, "costUSD": 0.0503917}}
```

- [ ] **Step 1: Write the failing test**

Append to `test/run-executor.test.cjs`:

```js
// DEL-1 (ADR 0047) — `usage` (main-loop only) is not the whole story once a run can delegate.
// `modelUsage` is per-model and includes Agent-tool delegates; `total_cost_usd` is the CLI's own
// figure. Both are mapped here so the loop never has to know a Claude-specific field name.
test('DEL-1 adapter: a result record yields per-model buckets, cost and turns', () => {
  const claude = require('../ui/server/runners/claude.cjs');
  const line = JSON.stringify({
    type: 'result', num_turns: 3, total_cost_usd: 0.5,
    usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 },
    modelUsage: {
      'claude-opus-4-8[1m]': { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 5, cacheCreationInputTokens: 1, costUSD: 0.4 },
      'claude-haiku-4-5': { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 50, cacheCreationInputTokens: 10, costUSD: 0.1 },
    },
  });
  const evs = claude.parseLine(line, {});
  const usage = evs.find((e) => e.type === 'usage');
  assert.ok(usage, 'a usage event is emitted for a result record');
  assert.strictEqual(usage.turns, 3);
  assert.strictEqual(usage.cost_usd, 0.5);
  assert.deepStrictEqual(usage.by_model['claude-haiku-4-5'],
    { input: 100, output: 20, cache_read: 50, cache_creation: 10, cost_usd: 0.1 });
  assert.deepStrictEqual(usage.by_model['claude-opus-4-8[1m]'],
    { input: 10, output: 2, cache_read: 5, cache_creation: 1, cost_usd: 0.4 });
  // the existing 4-class event is untouched — it stays the durable main-loop total
  const tok = evs.find((e) => e.type === 'tokens');
  assert.deepStrictEqual(tok.usage, { input: 10, output: 2, cache_read: 5, cache_creation: 1 });
});

test('DEL-1 adapter: a result record with no modelUsage yields empty buckets, not a crash', () => {
  const claude = require('../ui/server/runners/claude.cjs');
  const evs = claude.parseLine(JSON.stringify({ type: 'result', usage: { input_tokens: 1 } }), {});
  const usage = evs.find((e) => e.type === 'usage');
  assert.deepStrictEqual(usage.by_model, {});
  assert.strictEqual(usage.cost_usd, 0);
  assert.strictEqual(usage.turns, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/run-executor.test.cjs`
Expected: FAIL — `assert.ok(usage, 'a usage event is emitted for a result record')` fails because `usage` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `ui/server/runners/claude.cjs`, immediately after the existing `if (o.type === 'result' && o.usage) { ... }` block and before `return events;`:

```js
  // ADR 0047 — `o.usage` above is the MAIN AGENT LOOP only. `modelUsage` is per-model and includes
  // Agent-tool delegates, and `total_cost_usd` is the CLI's own cost figure; both are cumulative for
  // the query, so the LOOP (not this adapter) owns latest-wins-within / summed-across accumulation.
  if (o.type === 'result') {
    const by_model = {};
    for (const [model, u] of Object.entries(o.modelUsage || {})) {
      by_model[model] = {
        input: num(u.inputTokens),
        output: num(u.outputTokens),
        cache_read: num(u.cacheReadInputTokens),
        cache_creation: num(u.cacheCreationInputTokens),
        cost_usd: num(u.costUSD),
      };
    }
    events.push({ type: 'usage', by_model, cost_usd: num(o.total_cost_usd), turns: num(o.num_turns) });
  }
```

Then extend the interface comment in `ui/server/runners/index.cjs` (the `Event = ...` line) so every adapter and every test fake implements the same contract:

```js
//   parseLine(line, state) -> Event[]
//        Event = {type:'session',id} | {type:'delta',text} | {type:'tokens',usage:{input,output,cache_read,cache_creation}}
//              | {type:'usage',by_model:{[model]:{input,output,cache_read,cache_creation,cost_usd}},cost_usd,turns}
//              | {type:'session-init',model,agents,tools,permissionMode}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/run-executor.test.cjs`
Expected: PASS, and every pre-existing test in the file still passes (the new event is additive).

- [ ] **Step 5: Commit**

```bash
git add ui/server/runners/claude.cjs ui/server/runners/index.cjs test/run-executor.test.cjs
git commit -m "$(cat <<'EOF'
feat(runner): map modelUsage/total_cost_usd/num_turns to a usage event

result.usage is the main agent loop only, so the moment a run can
delegate, the field GSF sums stops being the whole cost. modelUsage
carries per-model buckets including Agent-tool delegates, and the CLI
reports its own total_cost_usd. Both already arrive on the stream and
were being discarded.

The adapter only maps them; accumulation semantics belong to the loop,
because these fields are cumulative per query rather than per turn.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Loop folds usage — latest-wins within an iteration, summed across

**Files:**
- Modify: `ui/server/run.cjs:226` (the `live.set(...)` state initializer)
- Modify: `ui/server/run.cjs:263-272` (`handleLine`)
- Modify: `ui/server/run.cjs:334` (the `child.on('close', ...)` handler in `spawnOnce`)
- Test: `test/run-executor.test.cjs`

**Interfaces:**
- Consumes: the `{type:'usage', by_model, cost_usd, turns}` event from Task 1.
- Produces: three new fields on the live state `L`, read by Task 4 —
  `L.by_model: {[modelId]: {input, output, cache_read, cache_creation, cost_usd}}`, `L.cost_usd: number`, `L.turns: number`.

**Context you need — this is the one place a naive implementation is wrong.** The existing `tokens` accumulation uses `+=` (`run.cjs:266-270`) and that is correct, because each iteration's `result.usage` reports only that invocation. `modelUsage` and `total_cost_usd` are **cumulative for the query**, and a single invocation can emit more than one `result` record. So `+=` on them double-counts. The correct shape is: hold the newest `usage` event of the current invocation, and fold it into the run totals exactly once when the child closes.

- [ ] **Step 1: Write the failing test**

Append to `test/run-executor.test.cjs`:

```js
// DEL-1/DEL-2 (ADR 0047) — modelUsage and total_cost_usd are CUMULATIVE PER QUERY, so `+=` (correct
// for result.usage) double-counts them. Two result records in ONE invocation must fold as the LATEST,
// and two invocations must SUM. This test fails loudly if someone ports the += idiom.
test('DEL-2 loop: usage is latest-wins within an iteration and summed across iterations', async () => {
  const { proj, ws } = makeWs();
  try {
    const mk = (turns, usd, input) => JSON.stringify({
      type: 'result', num_turns: turns, total_cost_usd: usd,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      modelUsage: { 'claude-haiku-4-5': { inputTokens: input, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: usd } },
    });
    // one invocation emits a partial result then the cumulative one: 1 turn/$0.10 then 3 turns/$0.50
    const lines = [JSON.stringify({ type: 'system', session_id: 's-1' }), mk(1, 0.1, 100), mk(3, 0.5, 400)];
    const rm = fakeRunManager();
    // maxIters 2 → the same two-result invocation replays twice: totals must be 6 turns / $1.00 / 800 in
    const exec = runMod.createExecutor({ runManager: rm, spawn: fakeSpawn(lines, 0), claudeBin: 'fake', maxIters: 2 });
    exec.launch({ run_id: 'r-fold', task_id: 'T-1', role: 'coder', project_path: proj });
    await tick(120);

    const fm = read.parseFrontmatter(fs.readFileSync(path.join(ws, 'runs', 'T-1', 'r-fold.md'), 'utf8'));
    assert.strictEqual(Number(fm.turns), 6, 'turns: latest per iteration (3), summed across two (6) — not 8');
    assert.strictEqual(Number(fm.cost_usd), 1, 'cost: 0.5 + 0.5, not 0.1 + 0.5 + 0.1 + 0.5');
    assert.match(fm.by_model['claude-haiku-4-5'], /\bin=800\b/, 'per-model input: 400 + 400, not 1000');
  } finally { cleanup(proj); }
});
```

> Note: this test asserts through the written run record, so it stays red until Task 4 lands the
> serializer fields. That is intentional — Task 2 and Task 4 are one deliverable split for review, and
> Step 4 below runs it again at the end of Task 4. To see Task 2 alone go green, temporarily assert on
> the executor's in-memory state instead; do not commit that variant.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/run-executor.test.cjs --test-name-pattern='latest-wins'`
Expected: FAIL — `fm.turns` is `undefined`, so `Number(fm.turns)` is `NaN`.

- [ ] **Step 3: Write minimal implementation**

In `ui/server/run.cjs`, extend the live-state initializer at line 226:

```js
    if (!live.has(run.run_id)) live.set(run.run_id, {
      events: [], subs: new Set(), transcript: '', tokens: ZERO(), session_id: null,
      // ADR 0047 — per-model accounting. `cur` holds the NEWEST usage event of the invocation in
      // flight; it is folded into the run totals once, when the child closes.
      by_model: {}, cost_usd: 0, turns: 0, cur: null,
    });
```

In `handleLine`, add a branch beside the existing `tokens` branch:

```js
      } else if (e.type === 'usage') {
        L.cur = e; // cumulative per query — keep only the newest; folded on child close
      }
```

Add the fold helper next to `handleLine`:

```js
  // Fold the invocation's final cumulative usage into the run totals. Called exactly once per
  // spawnOnce, on child close — NOT per event, because modelUsage/total_cost_usd restate the whole
  // query each time they are emitted.
  function foldUsage(L) {
    if (!L.cur) return;
    for (const [model, b] of Object.entries(L.cur.by_model || {})) {
      const t = L.by_model[model] || (L.by_model[model] = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cost_usd: 0 });
      t.input += b.input || 0; t.output += b.output || 0;
      t.cache_read += b.cache_read || 0; t.cache_creation += b.cache_creation || 0;
      t.cost_usd += b.cost_usd || 0;
    }
    L.cost_usd += L.cur.cost_usd || 0;
    L.turns += L.cur.turns || 0;
    L.cur = null;
  }
```

In the `child.on('close', ...)` handler in `spawnOnce`, call it after the final partial-line flush and before `resolve`:

```js
      child.on('close', (code) => { if (timer) clearTimeout(timer); L.rearm = null; if (buf.trim()) handleLine(L, run, buf.trim()); foldUsage(L); run._child = null; if (govCfgPath) { try { fs.unlinkSync(govCfgPath); } catch { /* ignore */ } } resolve(timedOut ? -2 : code); });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/run-executor.test.cjs`
Expected: the new test still FAILS on the record fields (they land in Task 4); every other test PASSES. Confirm the failure message now names `fm.turns` being `undefined` rather than a crash in `foldUsage`.

- [ ] **Step 5: Commit**

```bash
git add ui/server/run.cjs test/run-executor.test.cjs
git commit -m "$(cat <<'EOF'
feat(executor): fold per-model usage latest-wins within, summed across

result.usage is per invocation, so += is right for it. modelUsage and
total_cost_usd restate the whole query every time they are emitted, and
one invocation can emit more than one result record — so the same idiom
would count an iteration's cost twice over.

The newest usage event of the invocation in flight is held on L.cur and
folded into the run totals exactly once, when the child closes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Record what the session actually started with

**Files:**
- Modify: `ui/server/runners/claude.cjs` (`parseLine`)
- Modify: `ui/server/run.cjs` (`handleLine`)
- Test: `test/run-executor.test.cjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `{type:'session-init', model, agents, tools, permissionMode}`, and `L.model: string|null` read by Task 4. `L.agents` and `L.permission_mode` are captured now and consumed by stage 1's fail-open assertion; stage 0 only records the model.

**Context you need:** the `system` record is the first line of the stream. In the captured fixture it reads `model: "claude-opus-4-8[1m]"`, `agents: []`, `permissionMode: "default"`. Today none of it is parsed, which is why a run record cannot say which model priced it.

- [ ] **Step 1: Write the failing test**

Append to `test/run-executor.test.cjs`:

```js
// DEL-2 (ADR 0047) — the run record cannot currently say which model it used, which is why every
// price in the Cockpit is an assumption. The system/init record has carried it all along.
test('DEL-2 adapter: the system record yields a session-init event', () => {
  const claude = require('../ui/server/runners/claude.cjs');
  const line = JSON.stringify({
    type: 'system', subtype: 'init', session_id: 's-9', model: 'claude-opus-4-8[1m]',
    agents: ['scout'], tools: ['Read', 'Grep'], permissionMode: 'default',
  });
  const evs = claude.parseLine(line, {});
  const init = evs.find((e) => e.type === 'session-init');
  assert.ok(init, 'a session-init event is emitted');
  assert.strictEqual(init.model, 'claude-opus-4-8[1m]');
  assert.deepStrictEqual(init.agents, ['scout']);
  assert.deepStrictEqual(init.tools, ['Read', 'Grep']);
  assert.strictEqual(init.permissionMode, 'default');
  // the session id is still emitted by the existing branch — this event is additive
  assert.ok(evs.find((e) => e.type === 'session' && e.id === 's-9'), 'session event unchanged');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/run-executor.test.cjs --test-name-pattern='session-init'`
Expected: FAIL — `assert.ok(init, 'a session-init event is emitted')`.

- [ ] **Step 3: Write minimal implementation**

In `ui/server/runners/claude.cjs`, add after the existing `if (o.session_id) ...` line in `parseLine`:

```js
  // ADR 0047 — the init record states what the session ACTUALLY got: model, agent roster, tool set,
  // permission mode. Stage 0 records the model (so a run record can be priced honestly); stage 1's
  // fail-open assertion reads `agents`.
  if (o.type === 'system') {
    events.push({
      type: 'session-init',
      model: o.model || null,
      agents: Array.isArray(o.agents) ? o.agents : [],
      tools: Array.isArray(o.tools) ? o.tools : [],
      permissionMode: o.permissionMode || null,
    });
  }
```

In `ui/server/run.cjs` `handleLine`, add a branch:

```js
      } else if (e.type === 'session-init') {
        if (e.model) L.model = e.model;              // the model the run was actually served
        L.agents = e.agents; L.permission_mode = e.permissionMode; // stage 1 asserts on these
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/run-executor.test.cjs`
Expected: PASS for the new test; all pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add ui/server/runners/claude.cjs ui/server/run.cjs test/run-executor.test.cjs
git commit -m "$(cat <<'EOF'
feat(runner): parse the system/init record for model, agents and mode

A run record could not say which model produced it, so every figure the
Cockpit renders is priced at an assumed opus. The init record is the
first line of every stream and has always carried the answer.

Stage 0 uses the model. agents/permissionMode are captured now because
stage 1's fail-open assertion reads them, and parsing them later would
mean touching this branch twice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Run record gains `model`, `turns`, `cost_usd` and `by_model`

**Files:**
- Modify: `ui/server/read.cjs:459-501` (`serializeRunRecord`) and `:504-528` (`parseRunRecord`)
- Modify: `ui/server/run.cjs:106-124` (`writeRunRecord` — pass the new fields through)
- Test: `test/read-cjs.test.cjs`, and the Task 2 test in `test/run-executor.test.cjs` goes green here

**Interfaces:**
- Consumes: `L.by_model`, `L.cost_usd`, `L.turns` (Task 2) and `L.model` (Task 3).
- Produces: `parseRunRecord()` returns `model: string|null`, `turns: number`, `cost_usd: number`, `by_model: {[modelId]: {input, output, cache_read, cache_creation, cost_usd}}` — consumed by Task 7.

**Context you need — two traps.**

1. **Depth.** `parseFrontmatter` is two levels. `by_model:` is level one, a model id is level two, and its value must therefore be a **flat scalar string**, exactly like `write_attempts.tools` (`Edit=2 Write=1`). Format: `in=<n> out=<n> cr=<n> cc=<n> usd=<n>`.
2. **Colons in model ids.** The parser splits a line on its first `:`. Claude ids are safe (`claude-opus-4-8[1m]`), but a local model id is not (`qwen2.5-coder:7b` would parse as key `qwen2.5-coder`, value `7b: in=…`) and would corrupt the record *silently*. Encode `:` as `%3A` on write and decode on read. Two lines, and it is the difference between a correct record and a quietly wrong one when stage 3 lands.

- [ ] **Step 1: Write the failing test**

Append to `test/read-cjs.test.cjs`:

```js
// DEL-3 (ADR 0047) — per-model buckets on the record. Flat scalars on a second-level key, because
// the frontmatter parser is two levels deep (the hazard is documented at read.cjs:493-494).
test('DEL-3 run-record: model/turns/cost_usd/by_model round-trip', () => {
  const rec = {
    task: 'ES-2', role: 'coder', state: 'done', tokens: {}, transcript: 'x',
    ended_at: '2026-09-17T10:00:00.000Z',
    model: 'claude-opus-4-8[1m]', turns: 6, cost_usd: 1.25,
    by_model: {
      'claude-opus-4-8[1m]': { input: 10, output: 2, cache_read: 5, cache_creation: 1, cost_usd: 1.2 },
      'claude-haiku-4-5': { input: 400, output: 8, cache_read: 0, cache_creation: 30, cost_usd: 0.05 },
    },
  };
  const text = read.serializeRunRecord(rec);
  assert.match(text, /^model: claude-opus-4-8\[1m\]$/m);
  assert.match(text, /^turns: 6$/m);
  assert.match(text, /^  claude-haiku-4-5: in=400 out=8 cr=0 cc=30 usd=0\.05$/m);

  const back = read.parseRunRecord(text);
  assert.strictEqual(back.model, 'claude-opus-4-8[1m]');
  assert.strictEqual(back.turns, 6);
  assert.strictEqual(back.cost_usd, 1.25);
  assert.deepStrictEqual(back.by_model['claude-haiku-4-5'],
    { input: 400, output: 8, cache_read: 0, cache_creation: 30, cost_usd: 0.05 });
});

test('DEL-3 run-record: a record without per-model data is byte-identical to today', () => {
  const base = { task: 'ES-2', role: 'coder', state: 'done', tokens: {}, transcript: 'x', ended_at: '2026-09-17T10:00:00.000Z' };
  const text = read.serializeRunRecord(base);
  assert.ok(!/^model:/m.test(text), 'no model line when absent');
  assert.ok(!/^by_model:/m.test(text), 'no by_model block when absent');
  assert.ok(!/^turns:/m.test(text), 'no turns line when absent');
  assert.strictEqual(text, read.serializeRunRecord({ ...base, by_model: {}, turns: 0, cost_usd: 0 }),
    'empty per-model data serializes identically to no per-model data');
  assert.strictEqual(read.parseRunRecord(text).turns, 0, 'absent turns parses back as 0');
  assert.deepStrictEqual(read.parseRunRecord(text).by_model, {}, 'absent by_model parses back as {}');
});

// A local model id contains a colon, and the frontmatter parser splits on the first one — so an
// un-encoded id would corrupt the record silently the day a local delegate runs.
test('DEL-3 run-record: a model id containing a colon survives the round-trip', () => {
  const rec = {
    task: 'ES-2', role: 'coder', state: 'done', tokens: {}, transcript: 'x', ended_at: '2026-09-17T10:00:00.000Z',
    by_model: { 'ollama/qwen2.5-coder:7b': { input: 5, output: 1, cache_read: 0, cache_creation: 0, cost_usd: 0 } },
  };
  const back = read.parseRunRecord(read.serializeRunRecord(rec));
  assert.deepStrictEqual(back.by_model['ollama/qwen2.5-coder:7b'],
    { input: 5, output: 1, cache_read: 0, cache_creation: 0, cost_usd: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/read-cjs.test.cjs --test-name-pattern='DEL-3'`
Expected: FAIL — `assert.match(text, /^model: .../m)` fails; the field is not serialized.

- [ ] **Step 3: Write minimal implementation**

In `ui/server/read.cjs`, add above `serializeRunRecord`:

```js
// ADR 0047 — a model id may contain ':' (local runtimes: `qwen2.5-coder:7b`) and the frontmatter
// parser splits a line on its first colon, so the id is encoded as a frontmatter KEY and decoded back.
const encModel = (m) => String(m).replace(/:/g, '%3A');
const decModel = (m) => String(m).replace(/%3A/g, ':');
// Per-model buckets are flat scalars on a second-level key — same shape rule as write_attempts.tools.
const BM_KEYS = [['in', 'input'], ['out', 'output'], ['cr', 'cache_read'], ['cc', 'cache_creation'], ['usd', 'cost_usd']];
```

Inside `serializeRunRecord`, add `const bm = rec.by_model;` beside the other destructures, and insert these entries immediately **before** the closing `'---',`:

```js
    // ADR 0047 — what this run actually cost, per model. Omitted when absent so every pre-0047
    // record stays byte-identical.
    ...(rec.model ? [`model: ${rec.model}`] : []),
    ...(rec.turns ? [`turns: ${rec.turns}`] : []),
    ...(rec.cost_usd ? [`cost_usd: ${rec.cost_usd}`] : []),
    ...(bm && Object.keys(bm).length ? ['by_model:',
      ...Object.keys(bm).sort().map((m) => {
        const b = bm[m] || {};
        return `  ${encModel(m)}: ` + BM_KEYS.map(([k, f]) => `${k}=${b[f] || 0}`).join(' ');
      })] : []),
```

Add the bucket parser above `parseRunRecord`:

```js
function parseByModel(fm) {
  const out = {};
  if (!fm || typeof fm !== 'object') return out;
  for (const [k, v] of Object.entries(fm)) {
    const b = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cost_usd: 0 };
    for (const part of String(v || '').trim().split(/\s+/)) {
      const [key, val] = part.split('=');
      const f = (BM_KEYS.find(([s]) => s === key) || [])[1];
      if (f) b[f] = Number.isFinite(+val) ? +val : 0;
    }
    out[decModel(k)] = b;
  }
  return out;
}
```

And in `parseRunRecord`'s returned object, beside `tokens`:

```js
    model: str(fm.model),
    turns: Number.isFinite(+fm.turns) ? +fm.turns : 0,
    cost_usd: Number.isFinite(+fm.cost_usd) ? +fm.cost_usd : 0,
    by_model: parseByModel(fm.by_model),
```

Finally, in `ui/server/run.cjs` `writeRunRecord`, pass them through — add to the `read.serializeRunRecord({...})` argument, after the `tokens:` line:

```js
      model: live.model, turns: live.turns, cost_usd: live.cost_usd, by_model: live.by_model, // ADR 0047
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/read-cjs.test.cjs && node --test test/run-executor.test.cjs`
Expected: PASS, including the Task 2 latest-wins test, which asserts through the record and goes green here.

- [ ] **Step 5: Commit**

```bash
git add ui/server/read.cjs ui/server/run.cjs test/read-cjs.test.cjs
git commit -m "$(cat <<'EOF'
record: add model, turns, cost_usd and per-model buckets to runs/

A run record stored four token classes and no model, so the Cockpit and
the Session Report priced every run at an assumed opus — a 5x error for
sonnet work and 18.75x for haiku, in the expensive direction.

Buckets are flat scalars on a second-level key because the frontmatter
parser is two levels deep, and model ids are colon-encoded: a local id
like qwen2.5-coder:7b would otherwise split at the colon and corrupt the
record silently. Every field is omitted when absent, so existing records
serialize byte-identically.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `parseSessionLog` splits tokens per model

**Files:**
- Modify: `ui/server/session-report.cjs:69-98` (`parseSessionLog`)
- Test: `test/session-report.test.cjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `parseSessionLog()` gains `by_model: {[modelId]: {input, output, cache_read, cache_creation}}` alongside the existing flat `tokens`. Consumed by Tasks 6 and 7.

**Context you need:** each assistant turn in a session JSONL carries `message.model` and `message.usage`. The parser already reads both but throws the model away into a `Set` and adds every turn's tokens to one flat bucket. Note these buckets carry **no** `cost_usd` — a session JSONL has no cost field; cost is derived by pricing (Task 7).

- [ ] **Step 1: Write the failing test**

Append to `test/session-report.test.cjs`:

```js
// DEL-5 (ADR 0047) — a session can contain more than one model once a run delegates, and pricing
// the whole session at models[0] is wrong in both directions.
test('DEL-5 parseSessionLog splits tokens per model', () => {
  const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-home-'));
  try {
    const dir = path.join(claudeHome, 'projects', '-enc');
    fs.mkdirSync(dir, { recursive: true });
    const rec = (model, usage) => JSON.stringify({
      type: 'assistant', timestamp: '2026-09-17T10:00:00Z',
      message: { model, usage, content: [{ type: 'text', text: 'x' }] },
    });
    fs.writeFileSync(path.join(dir, 'S-2.jsonl'), [
      rec('claude-opus-4-8', { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }),
      rec('claude-haiku-4-5', { input_tokens: 40, output_tokens: 8, cache_read_input_tokens: 0, cache_creation_input_tokens: 20 }),
      rec('claude-haiku-4-5', { input_tokens: 60, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ].join('\n') + '\n');

    const s = sr.parseSessionLog(path.join(dir, 'S-2.jsonl'));
    assert.strictEqual(s.turns, 3);
    // the flat total is unchanged — existing callers keep working
    assert.deepStrictEqual(s.tokens, { input: 110, output: 12, cache_read: 100, cache_creation: 25 });
    assert.deepStrictEqual(s.by_model['claude-haiku-4-5'],
      { input: 100, output: 10, cache_read: 0, cache_creation: 20 });
    assert.deepStrictEqual(s.by_model['claude-opus-4-8'],
      { input: 10, output: 2, cache_read: 100, cache_creation: 5 });
  } finally { fs.rmSync(claudeHome, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/session-report.test.cjs --test-name-pattern='splits tokens per model'`
Expected: FAIL — `s.by_model` is `undefined`, so reading `['claude-haiku-4-5']` throws a TypeError.

- [ ] **Step 3: Write minimal implementation**

In `ui/server/session-report.cjs`, inside `parseSessionLog`, add `const by_model = {};` beside `const tokens = ZERO();`, then in the `if (o.type === 'assistant' && m.usage)` block, after the existing four `tokens.* +=` lines:

```js
      // ADR 0047 — per-model split. The flat `tokens` total above is unchanged for existing callers.
      const bm = by_model[m.model || 'unknown'] || (by_model[m.model || 'unknown'] = ZERO());
      bm.input += inp; bm.output += out; bm.cache_read += cr; bm.cache_creation += cc;
```

and add `by_model` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/session-report.test.cjs`
Expected: PASS, including the pre-existing `parseSessionLog aggregates per-turn usage + tools` test, whose flat `tokens` assertions are untouched.

- [ ] **Step 5: Commit**

```bash
git add ui/server/session-report.cjs test/session-report.test.cjs
git commit -m "$(cat <<'EOF'
feat(report): split session tokens per model

The parser already read message.model and dropped it into a Set that
only ever gets indexed at [0]. Once a session contains more than one
model, a single price for the whole session is wrong in both directions.

The flat token total is unchanged, so every existing caller keeps its
behaviour.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The Session Report can see delegate transcripts

**Files:**
- Modify: `ui/server/session-report.cjs:53-64` (add `findSessionLogs` beside `findSessionLog`), `:145-150` (`buildTaskReport`'s per-run read), `:266` (exports)
- Test: `test/session-report.test.cjs`

**Interfaces:**
- Consumes: `parseSessionLog().by_model` (Task 5).
- Produces: `findSessionLogs(sessionId, claudeHome) -> {main: string|null, delegates: string[]}`, exported. `findSessionLog` keeps its current signature and behaviour — other callers and tests depend on it.

**Context you need:** a main session log lives at `<claudeHome>/projects/<encoded-cwd>/<sessionId>.jsonl`. Delegate transcripts live under a sibling **directory** of the same name: `<encoded-cwd>/<sessionId>/subagents/**/agent-*.jsonl`. `findSessionLog` only ever looks for the file, so today every delegate turn, tool call and token is invisible to the report.

- [ ] **Step 1: Write the failing test**

Append to `test/session-report.test.cjs`:

```js
// DEL-4 (ADR 0047) — delegate transcripts live in a sibling directory of the main session log, so
// the report is structurally blind to them until it walks that tree.
test('DEL-4 findSessionLogs also returns delegate transcripts', () => {
  const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-home-'));
  try {
    const dir = path.join(claudeHome, 'projects', '-enc');
    const sub = path.join(dir, 'S-3', 'subagents', 'workflows', 'wf-1');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(dir, 'S-3.jsonl'), '{}\n');
    fs.writeFileSync(path.join(sub, 'agent-aaa.jsonl'), '{}\n');
    fs.writeFileSync(path.join(sub, 'agent-bbb.jsonl'), '{}\n');
    fs.writeFileSync(path.join(sub, 'notes.txt'), 'ignore me\n');

    const found = sr.findSessionLogs('S-3', claudeHome);
    assert.ok(found.main && found.main.endsWith('S-3.jsonl'), 'main session log still found');
    assert.strictEqual(found.delegates.length, 2, 'both delegate transcripts found, nested dirs walked');
    assert.ok(found.delegates.every((f) => /agent-.*\.jsonl$/.test(f)), 'only agent-*.jsonl files');
    // the original single-file helper is unchanged for existing callers
    assert.strictEqual(sr.findSessionLog('S-3', claudeHome), found.main);
  } finally { fs.rmSync(claudeHome, { recursive: true, force: true }); }
});

test('DEL-4 a task report counts delegate turns and tokens', () => {
  const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-rep2-'));
  try {
    const dir = path.join(claudeHome, 'projects', '-enc');
    const sub = path.join(dir, 'S-4', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    const rec = (model, usage) => JSON.stringify({
      type: 'assistant', timestamp: '2026-09-17T10:00:00Z',
      message: { model, usage, content: [{ type: 'text', text: 'x' }] },
    });
    fs.writeFileSync(path.join(dir, 'S-4.jsonl'),
      rec('claude-opus-4-8', { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) + '\n');
    fs.writeFileSync(path.join(sub, 'agent-zzz.jsonl'),
      rec('claude-haiku-4-5', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) + '\n');

    const runsDir = path.join(proj, '.tcgstackflow', 'runs', 'T-2');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'r1.md'),
      '---\ntask: T-2\nrole: coder\nsession_id: S-4\ntokens:\n  input: 0\n  output: 0\n  cache_read: 0\n  cache_creation: 0\nstate: done\n---\nx\n');

    const rep = sr.buildTaskReport(path.join(proj, '.tcgstackflow'), 'T-2', { claudeHome });
    assert.strictEqual(rep.totals.turns, 2, 'parent turn + delegate turn');
    assert.strictEqual(rep.totals.tokens.input, 110, 'delegate tokens counted');
    assert.deepStrictEqual(rep.totals.by_model['claude-haiku-4-5'],
      { input: 100, output: 20, cache_read: 0, cache_creation: 0 });
  } finally { fs.rmSync(claudeHome, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/session-report.test.cjs --test-name-pattern='DEL-4'`
Expected: FAIL — `sr.findSessionLogs is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `ui/server/session-report.cjs`, add after `findSessionLog`:

```js
// ADR 0047 — a delegate's transcript is NOT in the main session JSONL. It is written to a sibling
// directory of the same name: <encoded-cwd>/<session_id>/subagents/**/agent-*.jsonl. Walking that
// tree is the difference between a report that sees delegated work and one that silently omits it.
function findSessionLogs(sessionId, claudeHome) {
  const main = findSessionLog(sessionId, claudeHome);
  const delegates = [];
  if (main) {
    const walk = (d) => {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && /^agent-.*\.jsonl$/.test(e.name)) delegates.push(p);
      }
    };
    walk(path.join(path.dirname(main), sessionId, 'subagents'));
  }
  return { main, delegates: delegates.sort() };
}
```

In `buildTaskReport`, replace the single-log read:

```js
    const { main: logFile, delegates } = findSessionLogs(session_id, opts.claudeHome);
    const parts = [logFile, ...delegates].filter(Boolean).map(parseSessionLog).filter(Boolean);
    const parsed = parts.length ? mergeSessions(parts) : null;
```

Add the merge helper above `buildTaskReport`:

```js
// One session + its delegates present as a single session entry: the delegate IS this run's work.
function mergeSessions(parts) {
  const out = { ...parts[0], tokens: ZERO(), by_model: {}, tools: {}, models: [], timeline: [], turns: 0, records: 0, mcp_calls: 0, wiki_access: { qmd: 0, direct: 0 }, start: null, end: null };
  const models = new Set();
  for (const p of parts) {
    for (const k of Object.keys(out.tokens)) out.tokens[k] += p.tokens[k];
    for (const [m, b] of Object.entries(p.by_model || {})) {
      const t = out.by_model[m] || (out.by_model[m] = ZERO());
      for (const k of Object.keys(t)) t[k] += b[k] || 0;
    }
    for (const [n, c] of Object.entries(p.tools)) out.tools[n] = (out.tools[n] || 0) + c;
    p.models.forEach((m) => models.add(m));
    out.timeline = out.timeline.concat(p.timeline);
    out.turns += p.turns; out.records += p.records; out.mcp_calls += p.mcp_calls;
    if (p.wiki_access) { out.wiki_access.qmd += p.wiki_access.qmd || 0; out.wiki_access.direct += p.wiki_access.direct || 0; }
    if (p.start !== null && (out.start === null || p.start < out.start)) out.start = p.start;
    if (p.end !== null && (out.end === null || p.end > out.end)) out.end = p.end;
  }
  out.models = [...models];
  out.model = out.models[0] || '';
  return out;
}
```

In `buildTaskReport`, accumulate the per-model totals — add `const by_model = {};` beside `const totalTokens = ZERO();`, then inside `if (parsed) { ... }`:

```js
      for (const [m, b] of Object.entries(parsed.by_model || {})) {
        const t = by_model[m] || (by_model[m] = ZERO());
        for (const k of Object.keys(t)) t[k] += b[k] || 0;
      }
```

and in the `else` branch (no session log on this machine), fall back to the record's own buckets:

```js
      for (const [m, b] of Object.entries(rr.by_model || {})) {
        const t = by_model[m] || (by_model[m] = ZERO());
        for (const k of Object.keys(t)) t[k] += b[k] || 0;
      }
```

Add `by_model,` to the returned `totals` object, and add `findSessionLogs` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/session-report.test.cjs`
Expected: PASS, including the pre-existing report tests.

- [ ] **Step 5: Commit**

```bash
git add ui/server/session-report.cjs test/session-report.test.cjs
git commit -m "$(cat <<'EOF'
fix(report): read delegate transcripts, not just the main session log

findSessionLog opened <session_id>.jsonl and nothing else, while a
delegate writes to <session_id>/subagents/**/agent-*.jsonl. Every
delegated turn, tool call and token was therefore invisible to the
Session Report — not under-counted, structurally absent.

A run and its delegates merge into one session entry, because the
delegated work IS that run's work.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Price per model, and stop billing unknown models as opus

**Files:**
- Modify: `ui/server/session-report.cjs:14-25` (`PRICING`, `priceFor`), add `costOfMixed`, `:113-129` (`budgetFor`), `:188` (report `cost`), `:266` (exports)
- Test: `test/session-report.test.cjs`

**Interfaces:**
- Consumes: `totals.by_model` (Task 6) and `parseRunRecord().by_model` (Task 4).
- Produces: `costOfMixed(byModel) -> {by_class: {input, output, cache_write, cache_read}, total: number}`, exported. `costOf(tokens, model)` keeps its signature.

**Context you need:** `priceFor` returns opus for any unknown model, described in the code as "conservative". That was true when one model ran per session; with a free local delegate it inverts — a $0 model bills at $15/$75 per M and eats the project's budget. Stage 0 adds an explicit zero row keyed on an unambiguous prefix (`local/`, `ollama/`); it stays inert until stage 3 emits such an id. Unknown-but-unprefixed still falls back to opus.

- [ ] **Step 1: Write the failing test**

Append to `test/session-report.test.cjs`:

```js
// DEL-5 (ADR 0047) — pricing per model bucket. One price for a mixed-model run is a 5x error for
// sonnet and 18.75x for haiku, always in the expensive direction.
test('DEL-5 costOfMixed prices each model bucket separately', () => {
  const mixed = sr.costOfMixed({
    'claude-opus-4-8': { input: 1e6, output: 0, cache_read: 0, cache_creation: 0 },
    'claude-haiku-4-5': { input: 1e6, output: 0, cache_read: 0, cache_creation: 0 },
  });
  assert.strictEqual(mixed.total, 15 + 0.8, 'opus 1M input + haiku 1M input');
  // the single-model figure this replaces would have billed both at opus
  assert.notStrictEqual(mixed.total, sr.costOf({ input: 2e6, output: 0, cache_read: 0, cache_creation: 0 }, 'claude-opus-4-8').total);
});

test('DEL-5 an explicitly local model is priced at zero, unknown still falls back to opus', () => {
  assert.strictEqual(sr.priceFor('ollama/qwen2.5-coder:7b').input, 0, 'local prefix → zero');
  assert.strictEqual(sr.priceFor('local/whatever').output, 0, 'local prefix → zero');
  assert.strictEqual(sr.priceFor('some-future-model').input, 15, 'unprefixed unknown stays conservative');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/session-report.test.cjs --test-name-pattern='DEL-5'`
Expected: FAIL — `sr.costOfMixed is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `ui/server/session-report.cjs`, add the zero row to `PRICING`:

```js
  // ADR 0047 — a locally-hosted model costs no API dollars. Keyed on an explicit prefix, never
  // guessed from the id: "unknown → opus" below must stay the default for anything ambiguous.
  local: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
```

and the branch at the top of `priceFor`, before the `includes` checks:

```js
  if (/^(local|ollama)\//i.test(String(model || ''))) return PRICING.local;
```

Add after `costOf`:

```js
// ADR 0047 — the whole point of delegation is that one run spans several models. Summing four token
// classes and pricing them at models[0] is wrong in both directions; each bucket carries its own id.
function costOfMixed(byModel) {
  const out = { by_class: { input: 0, output: 0, cache_write: 0, cache_read: 0 }, total: 0 };
  for (const [model, t] of Object.entries(byModel || {})) {
    const c = costOf(t, model);
    for (const k of Object.keys(out.by_class)) out.by_class[k] += c.by_class[k];
    out.total += c.total;
  }
  return out;
}
```

In `budgetFor`, replace the single-model spend computation:

```js
    const tk = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
    const bm = {};
    for (const t of detail.tasks || []) {
      for (const k in tk) tk[k] += (t.tokens_total && t.tokens_total[k]) || 0;
      for (const [m, b] of Object.entries(t.by_model_total || {})) {
        const acc = bm[m] || (bm[m] = { input: 0, output: 0, cache_read: 0, cache_creation: 0 });
        for (const k in acc) acc[k] += b[k] || 0;
      }
    }
    // Per-model where the records carry it; the flat total at the opts model otherwise (pre-0047 records).
    const spend = Object.keys(bm).length ? costOfMixed(bm).total : costOf(tk, model).total;
```

In `buildTaskReport`'s returned `totals`, price per model when available:

```js
      cost: Object.keys(by_model).length ? costOfMixed(by_model) : costOf(totalTokens, model),
```

Add `costOfMixed` to `module.exports`.

> **`t.by_model_total` does not exist yet — add it in this task.** The per-task totals come from
> `readRunsForTask` (`ui/server/read.cjs:530-543`), which accumulates `total` at `:537` and is
> assigned to `t.tokens_total` at `:358`. Mirror it: add `const by_model = {};` at `:532`, accumulate
> each record's buckets in the loop beside `:537`, return `by_model` from the function at `:542`, and
> assign `t.by_model_total = rr.by_model;` beside `:358`.
>
> ```js
>     for (const [m, b] of Object.entries(rr.by_model || {})) {
>       const t = by_model[m] || (by_model[m] = ZERO_TOKENS());
>       for (const k of RUN_TOKEN_KEYS) t[k] += b[k] || 0;
>     }
> ```
>
> If it were absent the expression above degrades to today's behaviour, so the fallback stays correct
> either way — but the budget guard would keep pricing everything at opus, which is the bug being fixed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/session-report.test.cjs && npm test`
Expected: PASS. The pre-existing `costOf uses opus list pricing` test is untouched — `costOf` keeps its signature.

- [ ] **Step 5: Commit**

```bash
git add ui/server/session-report.cjs ui/server/read.cjs test/session-report.test.cjs
git commit -m "$(cat <<'EOF'
fix(pricing): price per model bucket instead of the session's first model

buildTaskReport and budgetFor both priced every token at models[0], or
at a hard-coded 'claude-opus' literal — the debt ADR 0035:39 recorded
and never paid. For a mixed run that is a 5x error for sonnet work and
18.75x for haiku, and the budget guard inherits it.

priceFor also gains an explicit zero row for local models. "Unknown ->
opus" is conservative only while every model is billed; a free local
delegate priced at $15/$75 per M would eat a project budget it never
spent. The row is keyed on an explicit prefix, never guessed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Cockpit renders mixed-model cost

**Files:**
- Modify: `ui/src/pricing.js`
- Modify: `ui/src/App.vue:755`
- Test: `test/cockpit-pure.test.mjs`

**Interfaces:**
- Consumes: the server's `by_model` shape (Tasks 4, 6, 7).
- Produces: `costOfMixed(byModel, table)` exported from `ui/src/pricing.js`, mirroring the server's function.

**Context you need:** `ui/src/pricing.js` is the client's single mirror of the server table, and `App.vue:755` — `const costOfTokens = (t) => costOf(t, pricing.value.opus)` — is the one line feeding the Home spend hero (`:1299-1302`), the agent token tab (`:1257`) and `projectSpend`. The Cockpit UI cannot be smoke-tested headlessly, so the assertion lives on the pure module.

- [ ] **Step 1: Write the failing test**

Append to `test/cockpit-pure.test.mjs`:

Extend the existing `import` from `../ui/src/pricing.js` at the top of the file to include
`costOfMixed` and `priceRowFor` (the file uses static ESM imports only — do not introduce a dynamic
import or `createRequire` here), then append:

```js
// DEL-6 (ADR 0047) — a run spans several models once it delegates, so one price row cannot describe
// it. These are the same arithmetic the server's costOfMixed performs (Card 2 / ADR 0034:21).
test('DEL-6 costOfMixed prices each model bucket at its own row', () => {
  const zero = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  const total = costOfMixed({
    'claude-opus-4-8': { ...zero, input: 1e6 },
    'claude-haiku-4-5': { ...zero, input: 1e6 },
  });
  assert.strictEqual(total, 15 + 0.8, 'opus 1M input + haiku 1M input');
  // what it replaces: both buckets billed at opus
  assert.strictEqual(costOf({ ...zero, input: 2e6 }, PRICING.opus), 30);
});

test('DEL-6 priceRowFor mirrors the server: local is zero, unknown is opus', () => {
  assert.strictEqual(priceRowFor('ollama/qwen2.5-coder:7b').input, 0);
  assert.strictEqual(priceRowFor('claude-haiku-4-5').input, PRICING.haiku.input);
  assert.strictEqual(priceRowFor('some-future-model').input, PRICING.opus.input);
});
```

> The client/server agreement is asserted by both sides testing the same arithmetic against the same
> shipped table, not by importing CJS into this ESM file. `pricing.js`'s header already states the
> rule: the client mirrors `session-report.cjs`, and the Cockpit fetches the live table from
> `GET /api/pricing` at load, falling back to this constant.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cockpit-pure.test.mjs`
Expected: FAIL — `costOfMixed is not a function` (the client module does not export it).

- [ ] **Step 3: Write minimal implementation**

In `ui/src/pricing.js`, add:

```js
// $ for a per-model bucket map — the client mirror of session-report.cjs costOfMixed (ADR 0047).
// A run spans several models once it delegates, so a single price row cannot describe it.
export function priceRowFor(model, table = PRICING) {
  const m = String(model || '').toLowerCase();
  if (/^(local|ollama)\//.test(m)) return { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  if (m.includes('sonnet')) return table.sonnet;
  if (m.includes('haiku')) return table.haiku;
  return table.opus; // unknown → opus, matching the server
}

export function costOfMixed(byModel, table = PRICING) {
  let total = 0;
  for (const [model, t] of Object.entries(byModel || {})) total += costOf(t, priceRowFor(model, table));
  return total;
}
```

In `ui/src/App.vue`, replace line 755:

```js
// Per-model where the record carries buckets; the flat total at opus otherwise (pre-0047 records).
const costOfTokens = (t, by_model) => (by_model && Object.keys(by_model).length
  ? costOfMixed(by_model, pricing.value)
  : costOf(t, pricing.value.opus));
```

Update the import at the top of `App.vue` to include `costOfMixed`, and pass a run's `by_model` at the three call sites (`:1257`, `:1299-1302`, `projectSpend` at `:951-957`). Where a caller has no `by_model` to hand, call it with one argument — the fallback is today's behaviour exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cockpit-pure.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/pricing.js ui/src/App.vue test/cockpit-pure.test.mjs
git commit -m "$(cat <<'EOF'
feat(cockpit): render mixed-model cost from per-model buckets

costOfTokens priced every bucket at opus, so a Cockpit figure would
disagree with the Session Report the moment a run spanned two models.
The client mirror gains costOfMixed and a test pins it to the server's
result, which is the guarantee ADR 0034:21 asks for.

Callers with no buckets keep today's behaviour exactly.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Record the decision trail

**Files:**
- Modify: `docs/adr/0034-session-report-from-session-jsonl-with-dollar-cost.md:21,23`
- Modify: `docs/adr/0047-delegation-is-measured-before-it-is-granted.md` (status line)
- Modify: `docs/plans/delegation.md` (DEL-1..DEL-7 state column)
- Test: `node --test test/templates-structure.test.cjs`

**Interfaces:**
- Consumes: nothing. This is the closing documentation task.
- Produces: nothing code-facing.

- [ ] **Step 1: Amend ADR 0034**

Line 23 asserts "the multi-agent waves timeline collapses to a single agent's per-turn trace, since the Orchestrator runs one role per session". Append to that ADR, under a new `## Amendment (2026-09-17, ADR 0047)` heading:

```markdown
## Amendment (2026-09-17, ADR 0047)

Line 23's premise — one role per session, therefore one model per session — no longer holds once a
run can delegate: a delegate's turns are written to `<session_id>/subagents/**/agent-*.jsonl` and run
on their own model. The report now reads that tree and prices per model bucket, so the "Pricing drift"
consequence at line 21 is narrower than it was: the drift that remains is list-price versus effective
rate, not this tool attributing one model's price to another model's tokens.
```

- [ ] **Step 2: Mark the plan's stage-0 rows done**

In `docs/plans/delegation.md`, change the `State` cell of DEL-1 … DEL-7 from `⬜` to `✅`, and update the closing line of §0 from "**No code written.** DEL-0 (the ADR) is the only completed subtask." to name stage 0 as delivered with the date.

- [ ] **Step 3: Verify the count assertions still hold**

Run: `node --test test/templates-structure.test.cjs`
Expected: PASS — no skill, command or ADR was added in this stage, so no `COUNT_CLAIMS` value moves.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, with a pass count **above** the 346 baseline by the number of tests added here (11 new tests across Tasks 1–8), and `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/0034-session-report-from-session-jsonl-with-dollar-cost.md docs/adr/0047-delegation-is-measured-before-it-is-granted.md docs/plans/delegation.md
git commit -m "$(cat <<'EOF'
docs: amend ADR 0034 and mark delegation stage 0 delivered

ADR 0034 assumed one role per session and therefore one model per
session. Delegation breaks that premise, and the report now reads the
subagents/ tree and prices per bucket, so the amendment records what
the pricing-drift consequence still covers and what it no longer does.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** — every stage-0 subtask maps to a task: DEL-1 → Tasks 1, 2; DEL-2 → Task 3; DEL-3 → Task 4; DEL-4 → Task 6; DEL-5 → Tasks 5, 7; DEL-6 → Task 8; DEL-7 → Task 9. The spec's two invariants are stage-1 concerns and correctly absent here. The spec's "report parent turns avoided, not bytes returned" is enabled by the `turns` field (Task 4) and is only *reportable* once delegation exists — no stage-0 task claims to ship the metric.

**Type consistency** — `by_model` is the same shape everywhere it crosses a boundary: `{[modelId]: {input, output, cache_read, cache_creation, cost_usd}}` on the adapter event, the live state and the run record; the session-log variant carries the same four token keys **without** `cost_usd`, because a session JSONL has no cost field and cost is derived by `costOfMixed`. That asymmetry is deliberate and is the one thing an implementer could get wrong by pattern-matching.

**Known-red step** — Task 2's test asserts through the run record and stays red until Task 4. It is called out at the test and again in Task 2's Step 4, so an implementer does not mistake it for a broken implementation.
