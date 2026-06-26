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
