// ADR 0037 (observe half) — the governance gate recognizes a qmd search and reports the run's discovery
// path WITHOUT changing the allow/deny outcome, and the run record round-trips a wiki_discovery block.
// (A query-time enforcement gate is designed but DEFERRED — we observe first, per ADR 0037 — so there are
// deliberately no soft-deny tests here yet.)
const { test } = require('node:test');
const assert = require('node:assert');
const gc = require('../ui/server/governance-classify.cjs');
const gm = require('../ui/server/governance-mcp.cjs');
const read = require('../ui/server/read.cjs');

test('isQmdInvocation: recognizes the CLI search verbs and the qmd MCP tool', () => {
  assert.ok(gc.isQmdInvocation('Bash', { command: 'qmd query "how does auth work" -c wiki --json' }));
  assert.ok(gc.isQmdInvocation('Bash', { command: 'qmd search "AuthToken" -c wiki' }));
  assert.ok(gc.isQmdInvocation('mcp__qmd__vsearch', {}));
  assert.strictEqual(gc.isQmdInvocation('Bash', { command: 'qmd embed' }), false); // maintenance, not a search
  assert.strictEqual(gc.isQmdInvocation('Read', {}), false);
});

test('classifyTool: the qmd MCP tool is LOW (not fail-safe HIGH)', () => {
  assert.strictEqual(gc.classifyTool('mcp__qmd__query', {}), 'LOW');
  assert.strictEqual(gc.classifyTool('mcp__unknown__thing', {}), 'HIGH'); // other mcp tools stay HIGH
});

// decide() — the observe half records the path but must NOT change the allow/deny outcome.
function ctxWithState() {
  const reported = [];
  return {
    reported,
    classify: gc.classify, recipeFor: gc.recipeFor, rules: [], trusted: [],
    isQmdInvocation: gc.isQmdInvocation,
    state: { qmdSeen: false, qmdAbsent: false },
    reportDiscovery: (p) => reported.push(p),
    postIntake: async () => ({ decision: 'approved' }),
  };
}
const callParams = (tool_name, input) => ({ name: 'approve', arguments: { tool_name, input } });

test('decide: a qmd search is allowed (LOW) and flips qmdSeen + reports path=qmd', async () => {
  const ctx = ctxWithState();
  const d = await gm.decide(callParams('Bash', { command: 'qmd query "auth" -c wiki --json' }), ctx);
  assert.strictEqual(d.behavior, 'allow');
  assert.strictEqual(ctx.state.qmdSeen, true);
  assert.deepStrictEqual(ctx.reported, [{ path: 'qmd' }]);
});

test('decide: a plain wiki grep is still ALLOWED (enforcement is deferred, observe-only)', async () => {
  const ctx = ctxWithState();
  const d = await gm.decide(callParams('Bash', { command: 'grep -r "session" .tcgstackflow/wiki' }), ctx);
  assert.strictEqual(d.behavior, 'allow'); // grep is LOW; no gate blocks it yet
  assert.deepStrictEqual(ctx.reported, []); // and it is not a qmd search
});

test('decide: the HIGH/CRITICAL risk gate is untouched by the observe layer', async () => {
  const ctx = ctxWithState();
  ctx.postIntake = async () => ({ decision: 'deny' });
  const d = await gm.decide(callParams('Bash', { command: 'git push --force origin main' }), ctx);
  assert.strictEqual(d.behavior, 'deny'); // CRITICAL → routed to approval → denied here
});

test('run record: wiki_discovery block round-trips through serialize/parse', () => {
  const rec = {
    task: 'ES-1', role: 'planner', state: 'done', tokens: { input: 1, output: 2, cache_read: 3, cache_creation: 4 },
    wiki_discovery: { path: 'qmd', queries: 3, redirects: 1 }, transcript: 'body',
  };
  const parsed = read.parseRunRecord(read.serializeRunRecord(rec));
  assert.deepStrictEqual(parsed.wiki_discovery, { path: 'qmd', queries: 3, redirects: 1 });
});

test('run record: absent wiki_discovery stays null (older runs unaffected)', () => {
  const parsed = read.parseRunRecord(read.serializeRunRecord({ task: 'ES-2', role: 'coder', state: 'done' }));
  assert.strictEqual(parsed.wiki_discovery, null);
});

test('run record: index-fallback with a reason round-trips', () => {
  const parsed = read.parseRunRecord(read.serializeRunRecord({
    task: 'ES-3', role: 'coder', state: 'done', wiki_discovery: { path: 'index-fallback', reason: 'missing' },
  }));
  assert.strictEqual(parsed.wiki_discovery.path, 'index-fallback');
  assert.strictEqual(parsed.wiki_discovery.reason, 'missing');
});
