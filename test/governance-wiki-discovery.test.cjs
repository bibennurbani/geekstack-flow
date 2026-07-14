// ADR 0037 — the qmd query-path gate: classify a raw pre-qmd wiki body-grep as a 'redirect', recognize
// qmd invocations, and prove decide() soft-denies then unlocks once qmd has run. Plus the run-record
// wiki_discovery round-trip. Pure logic only (no live claude/gate process) — the end-to-end routing of
// the native Grep tool through the permission tool is a runtime seam smoked against a live Cockpit.
const { test } = require('node:test');
const assert = require('node:assert');
const gc = require('../ui/server/governance-classify.cjs');
const gm = require('../ui/server/governance-mcp.cjs');
const read = require('../ui/server/read.cjs');

const WIKI = '.tcgstackflow/wiki';

test('classifyWikiDiscovery: native Grep over wiki bodies pre-qmd → redirect', () => {
  assert.strictEqual(gc.classifyWikiDiscovery('Grep', { pattern: 'auth', path: WIKI }, {}), 'redirect');
});

test('classifyWikiDiscovery: Grep of index.md is sanctioned MoC nav → null', () => {
  assert.strictEqual(gc.classifyWikiDiscovery('Grep', { pattern: 'auth', path: WIKI + '/index.md' }, {}), null);
});

test('classifyWikiDiscovery: unlocked once qmd has run this run → null', () => {
  assert.strictEqual(gc.classifyWikiDiscovery('Grep', { pattern: 'auth', path: WIKI }, { qmdSeen: true }), null);
});

test('classifyWikiDiscovery: qmd absent → fallback legal, gate stands down → null', () => {
  assert.strictEqual(gc.classifyWikiDiscovery('Grep', { pattern: 'auth', path: WIKI }, { qmdAbsent: true }), null);
});

test('classifyWikiDiscovery: Bash grep -r over wiki pre-qmd → redirect', () => {
  assert.strictEqual(gc.classifyWikiDiscovery('Bash', { command: `grep -r "session" ${WIKI}` }, {}), 'redirect');
  assert.strictEqual(gc.classifyWikiDiscovery('Bash', { command: `rg "session" ${WIKI}/` }, {}), 'redirect');
});

test('classifyWikiDiscovery: the locked log.md timeline grep is a carve-out → null', () => {
  assert.strictEqual(gc.classifyWikiDiscovery('Bash', { command: `grep "^## \\[" ${WIKI}/log.md | tail -5` }, {}), null);
});

test('classifyWikiDiscovery: Read / non-grep Bash / non-wiki grep → null', () => {
  assert.strictEqual(gc.classifyWikiDiscovery('Read', { file_path: WIKI + '/auth.md' }, {}), null);
  assert.strictEqual(gc.classifyWikiDiscovery('Bash', { command: `cat ${WIKI}/auth.md` }, {}), null);
  assert.strictEqual(gc.classifyWikiDiscovery('Bash', { command: 'grep -r "session" src/' }, {}), null);
});

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

// decide() integration — the gate as the run sees it.
function ctxWithState() {
  return {
    classify: gc.classify, recipeFor: gc.recipeFor, rules: [], trusted: [],
    isQmdInvocation: gc.isQmdInvocation, classifyWikiDiscovery: gc.classifyWikiDiscovery,
    state: { qmdSeen: false, qmdAbsent: false },
    reportDiscovery: () => {},
    postIntake: async () => ({ decision: 'approved' }),
  };
}
const callParams = (tool_name, input) => ({ name: 'approve', arguments: { tool_name, input } });

test('decide: pre-qmd wiki grep is soft-denied with the redirect guidance', async () => {
  const ctx = ctxWithState();
  const d = await gm.decide(callParams('Grep', { pattern: 'auth', path: WIKI }), ctx);
  assert.strictEqual(d.behavior, 'deny');
  assert.strictEqual(d.message, gm.REDIRECT_MSG);
});

test('decide: a qmd query flips qmdSeen, then the wiki grep is allowed', async () => {
  const ctx = ctxWithState();
  const q = await gm.decide(callParams('Bash', { command: 'qmd query "auth" -c wiki --json' }), ctx);
  assert.strictEqual(q.behavior, 'allow');          // qmd search is LOW → allowed
  assert.strictEqual(ctx.state.qmdSeen, true);       // …and recorded
  const g = await gm.decide(callParams('Grep', { pattern: 'auth', path: WIKI }), ctx);
  assert.strictEqual(g.behavior, 'allow');           // now opening surfaced pages is fine
});

test('decide: the HIGH/CRITICAL risk gate is untouched by the discovery layer', async () => {
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
