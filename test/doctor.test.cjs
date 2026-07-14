'use strict';
// `geekstackflow doctor` — verifies the qmd wiki-search layer is REALIZED per project (ADR 0037 follow-up).
// Pure-parser + diagnosis coverage; the impure runDoctor (spawns qmd, prints) is exercised manually.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const gsf = require('../init.js');

test('parseQmdCollectionShow: extracts name + resolved path; null when incomplete', () => {
  const txt = 'Collection: wiki\n  Path:     /Users/x/proj/.tcgstackflow/wiki\n  Pattern:  **/*.md\n';
  assert.deepStrictEqual(gsf.parseQmdCollectionShow(txt), { name: 'wiki', path: '/Users/x/proj/.tcgstackflow/wiki' });
  assert.strictEqual(gsf.parseQmdCollectionShow('Collection not found: wiki'), null);
  assert.strictEqual(gsf.parseQmdCollectionShow(''), null);
});

test('parseQmdStatus: reads vectors + files, defaults to 0', () => {
  const s = gsf.parseQmdStatus('Documents\n  Total:    83 files indexed\n  Vectors:  348 embedded\n');
  assert.deepStrictEqual(s, { vectors: 348, files: 83 });
  assert.deepStrictEqual(gsf.parseQmdStatus('garbage'), { vectors: 0, files: 0 });
});

test('parseDeclaredCollections: reads the wiki_search collection names, ignores comments + other blocks', () => {
  const cfg = [
    'name: proj', 'workspace_schema: 6',
    'wiki_search:', '  engine: qmd', '  collections:',
    '    - name: wiki', '    # - name: docs   (commented example)',
    'skills:', '  - name: plan-task',   // a different block must NOT be picked up
  ].join('\n');
  assert.deepStrictEqual(gsf.parseDeclaredCollections(cfg), ['wiki']);
  assert.deepStrictEqual(gsf.parseDeclaredCollections('name: x\nskills: []\n'), []); // no wiki_search
});

test('expectedCollectionPath: derives wiki + root docs, null for docs-<subproject>', () => {
  assert.strictEqual(gsf.expectedCollectionPath('wiki', '/w'), path.join('/w', '.tcgstackflow', 'wiki'));
  assert.strictEqual(gsf.expectedCollectionPath('docs', '/w'), path.join('/w', 'docs'));
  assert.strictEqual(gsf.expectedCollectionPath('docs-api', '/w'), null);
});

test('diagnoseCollection: not-registered → fail', () => {
  const d = gsf.diagnoseCollection('wiki', '/w/.tcgstackflow/wiki', null, { vectors: 10 });
  assert.strictEqual(d.level, 'fail');
  assert.match(d.message, /NOT registered/);
});

test('diagnoseCollection: registered but wrong path (the global-name collision) → fail', () => {
  const shown = { name: 'wiki', path: '/other/.tcgstackflow/wiki' };
  const d = gsf.diagnoseCollection('wiki', '/w/.tcgstackflow/wiki', shown, { vectors: 10 });
  assert.strictEqual(d.level, 'fail');
  assert.match(d.message, /GLOBAL namespace/);
});

test('diagnoseCollection: right path but 0 embeddings → warn', () => {
  const shown = { name: 'wiki', path: '/w/.tcgstackflow/wiki' };
  const d = gsf.diagnoseCollection('wiki', '/w/.tcgstackflow/wiki', shown, { vectors: 0 });
  assert.strictEqual(d.level, 'warn');
  assert.match(d.message, /0 embeddings|qmd embed/);
});

test('diagnoseCollection: registered, right path, embedded → ok', () => {
  const shown = { name: 'wiki', path: '/w/.tcgstackflow/wiki' };
  const d = gsf.diagnoseCollection('wiki', '/w/.tcgstackflow/wiki', shown, { vectors: 348 });
  assert.strictEqual(d.level, 'ok');
});

test('diagnoseCollection: path-agnostic collection (docs-<proj>) present → ok, no false collision', () => {
  const shown = { name: 'docs-api', path: '/anything/docs' };
  const d = gsf.diagnoseCollection('docs-api', null, shown, { vectors: 5 });
  assert.strictEqual(d.level, 'ok');
});
