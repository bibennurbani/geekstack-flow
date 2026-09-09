'use strict';

// Card 3 [0] — the config.yaml parse/edit primitives (ui/server/config-fields.cjs). These back the
// readers in read.cjs/run.cjs and the setAutoAdvance writer. The point of the seam is exactly this:
// block scoping, scalar reads, boolean toggles, and surgical edits are now unit-testable in isolation
// (no fs, no workspace), including the comment-preservation guarantee the edit path must keep.

const { test } = require('node:test');
const assert = require('node:assert');
const cf = require('../ui/server/config-fields.cjs');

const SAMPLE = [
  'tcgflow_version: "0.3.0"',
  'workspace_schema: 6',
  '',
  'orchestrator:',
  '  roles:',
  '    planner: claude',
  '    coder: codex',
  '  budget_usd: 50              # spend guard',
  '  auto_advance: true',
  '',
  'wiki_search:',
  '  engine: qmd',
  '  embed_on_ingest: false      # disabled here',
  '',
  'governance:',
  '  mode: strict',
  '',
].join('\n');

test('block(): scopes to a top-level block body and stops at the next top-level key', () => {
  const w = cf.block(SAMPLE, 'wiki_search');
  assert.match(w, /engine: qmd/);
  assert.match(w, /embed_on_ingest: false/);
  assert.doesNotMatch(w, /mode: strict/, 'must not bleed into the governance block');
  assert.doesNotMatch(w, /auto_advance/, 'must not bleed back into orchestrator');
});

test('block(): absent block → empty string; null text is safe', () => {
  assert.strictEqual(cf.block(SAMPLE, 'nope'), '');
  assert.strictEqual(cf.block(null, 'orchestrator'), '');
});

test('blockScalar(): reads a field inside the right block, with a fallback', () => {
  assert.strictEqual(cf.blockScalar(SAMPLE, 'orchestrator', 'coder', 'claude'), 'codex');
  assert.strictEqual(cf.blockScalar(SAMPLE, 'orchestrator', 'planner', 'claude'), 'claude');
  assert.strictEqual(cf.blockScalar(SAMPLE, 'orchestrator', 'reviewer', 'claude'), 'claude', 'absent → fallback');
  assert.strictEqual(cf.blockScalar(SAMPLE, 'wiki_search', 'embed_on_ingest', 'true'), 'false');
});

test('blockScalar(): a same-named key in another block does not leak', () => {
  const t = 'a:\n  mode: loud\nb:\n  mode: quiet\n';
  assert.strictEqual(cf.blockScalar(t, 'a', 'mode'), 'loud');
  assert.strictEqual(cf.blockScalar(t, 'b', 'mode'), 'quiet');
});

test('blockHasTrue(): true only when the block sets key: true', () => {
  assert.strictEqual(cf.blockHasTrue(SAMPLE, 'orchestrator', 'auto_advance'), true);
  assert.strictEqual(cf.blockHasTrue(SAMPLE, 'orchestrator', 'auto_ingest_on_pull'), false, 'absent → false');
});

test('editBlockLine(): replaces an existing line and PRESERVES comments elsewhere', () => {
  const out = cf.editBlockLine(SAMPLE, 'orchestrator', 'auto_advance', 'false');
  assert.match(out, /^\s+auto_advance: false$/m);
  assert.match(out, /budget_usd: 50\s+# spend guard/, 'sibling line + comment untouched');
  assert.match(out, /embed_on_ingest: false      # disabled here/, 'other blocks untouched');
});

test('editBlockLine(): inserts the line after the header when absent', () => {
  const out = cf.editBlockLine(SAMPLE, 'orchestrator', 'max_bounces', '2');
  assert.match(out, /^orchestrator:\n  max_bounces: 2\n/m);
  // the rest of the orchestrator block is still there
  assert.match(out, /roles:/);
  assert.match(out, /auto_advance: true/);
});

test('editBlockLine(): throws no-<name>-block when the block is missing', () => {
  assert.throws(() => cf.editBlockLine('foo: 1\n', 'orchestrator', 'auto_advance', 'true'), /no-orchestrator-block/);
});

test('editBlockLine(): a re-edit is stable (idempotent value set)', () => {
  const once = cf.editBlockLine(SAMPLE, 'orchestrator', 'auto_advance', 'false');
  const twice = cf.editBlockLine(once, 'orchestrator', 'auto_advance', 'false');
  assert.strictEqual(once, twice);
});

// --- removeBlockLine: the CLEAR counterpart to editBlockLine ------------------------------------
// Its no-op-when-absent contract is load-bearing: the Cockpit's blank budget field means "no spend
// guard", so blanking an already-absent budget must not fail the save (that gap surfaced to the user
// as "Save failed: no-orchestrator-block" on a config that HAS an orchestrator block).

test('removeBlockLine(): drops the key and leaves the rest byte-for-byte', () => {
  const out = cf.removeBlockLine(SAMPLE, 'orchestrator', 'budget_usd');
  assert.doesNotMatch(out, /budget_usd/);
  assert.match(out, /auto_advance: true/, 'sibling key kept');
  assert.match(out, /embed_on_ingest: false      # disabled here/, 'other blocks + comments kept');
  assert.strictEqual(out, SAMPLE.replace('  budget_usd: 50              # spend guard\n', ''));
});

test('removeBlockLine(): an absent key OR an absent block is a byte-identical no-op, not a throw', () => {
  assert.strictEqual(cf.removeBlockLine(SAMPLE, 'orchestrator', 'budget_usd').includes('budget_usd'), false);
  assert.strictEqual(cf.removeBlockLine(SAMPLE, 'orchestrator', 'max_bounces'), SAMPLE, 'absent key → unchanged');
  assert.strictEqual(cf.removeBlockLine(SAMPLE, 'nope', 'budget_usd'), SAMPLE, 'absent block → unchanged');
  assert.strictEqual(cf.removeBlockLine('foo: 1\n', 'orchestrator', 'budget_usd'), 'foo: 1\n', 'no orchestrator block → unchanged');
});

test('removeBlockLine(): a same-named key in another block is not touched', () => {
  const t = 'orchestrator:\n  budget_usd: 5\ntempo:\n  budget_usd: 9\n';
  assert.strictEqual(cf.removeBlockLine(t, 'tempo', 'budget_usd'), 'orchestrator:\n  budget_usd: 5\ntempo:\n');
  assert.strictEqual(cf.removeBlockLine(t, 'orchestrator', 'budget_usd'), 'orchestrator:\ntempo:\n  budget_usd: 9\n');
});

test('removeBlockLine(): remove-then-edit round-trips back to the original value', () => {
  const cleared = cf.removeBlockLine(SAMPLE, 'orchestrator', 'budget_usd');
  const back = cf.editBlockLine(cleared, 'orchestrator', 'budget_usd', '50');
  assert.match(back, /^\s+budget_usd: 50$/m, 're-set lands inside the orchestrator block');
  assert.strictEqual((back.match(/budget_usd/g) || []).length, 1, 'exactly one budget_usd key');
});

// --- editBlockLine hardening (found while fixing the save path) ---------------------------------

test('editBlockLine(): a key with an EMPTY value is replaced, not duplicated', () => {
  const t = 'orchestrator:\n  budget_usd:\n  auto_advance: true\n';
  const out = cf.editBlockLine(t, 'orchestrator', 'budget_usd', '25');
  assert.match(out, /^  budget_usd: 25$/m, 'gets a value (with the space)');
  assert.strictEqual((out.match(/budget_usd/g) || []).length, 1, 'not duplicated by a failed match');
});

test('editBlockLine(): a $ in the value is written literally (not a replacement pattern)', () => {
  const out = cf.editBlockLine(SAMPLE, 'orchestrator', 'auto_advance', "'$1$&'");
  assert.match(out, /^\s+auto_advance: '\$1\$&'$/m);
});

test('editBlockLine(): a duplicated block header does not truncate the file', () => {
  const t = 'orchestrator:\n  auto_advance: true\nwiki_search:\n  engine: qmd\norchestrator:\n  autopilot: false\n';
  const out = cf.editBlockLine(t, 'orchestrator', 'auto_advance', 'false');
  assert.match(out, /engine: qmd/, 'the block after the first header survives');
  assert.match(out, /autopilot: false/, 'the second header + its body survive');
});
