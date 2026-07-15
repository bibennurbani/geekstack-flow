'use strict';
// Deterministic wiki-structure checker (ADR 0039) — the MECHANICAL Karpathy/qmd conformance checks that
// `doctor` verifies, `lint-wiki` delegates, and `ingest` gates on. Pure functions only (parse + diagnose);
// checkWikiStructure's fs walk is exercised manually against the scaffold.
const { test } = require('node:test');
const assert = require('node:assert');
const gsf = require('../init.js');

const page = (name, text) => gsf.parseWikiPage(name, text);
const fm = (o) => '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${Array.isArray(v) ? '[' + v.join(', ') + ']' : v}`).join('\n') + '\n---\n';
const goodIndex = () => page('index.md', fm({ title: 'Index', summary: 'MoC', tags: ['meta'], status: 'current', updated: '2026-01-01' }) + '# Index\n\nMap of content.\n\n- [[domain]]\n- [[architecture]]\n');
const goodPage = (name, links = '') => page(name + '.md', fm({ title: name, summary: 'A ' + name + ' page.', tags: ['domain'], status: 'current', updated: '2026-01-01' }) + `# ${name}\n\nLead paragraph for ${name}.\n\n## Detail\n\nSome content.\n${links}`);

test('parseWikiFrontmatter: scalars, arrays, and empty', () => {
  const f = gsf.parseWikiFrontmatter('---\ntitle: Foo\ntags: [domain, api]\nstatus: current\n---\nbody');
  assert.strictEqual(f.title, 'Foo');
  assert.deepStrictEqual(f.tags, ['domain', 'api']);
  assert.deepStrictEqual(gsf.parseWikiFrontmatter('no frontmatter'), {});
});

test('parseWikiPage: lead paragraph, sections, H1, adr flag', () => {
  const p = page('x.md', fm({ title: 'X' }) + '# X\n\nLead here.\n\n## A\n\nbody a\n\n## B\n\nbody b');
  assert.strictEqual(p.leadPara, 'Lead here.');
  assert.strictEqual(p.hasH1, true);
  assert.ok(p.sections.some((s) => s.heading === 'A') && p.sections.some((s) => s.heading === 'B'));
  assert.strictEqual(page('adr/0001-x.md', '# x').isAdr, true);
});

test('parseWikiPage: wikilinks ignore inline-code and fenced blocks (illustrative links)', () => {
  const p = page('x.md', '# X\n\nreal [[domain]] link.\n\ninline `[[not-a-link]]` and:\n```\n[[also-not]]\n```\n');
  assert.deepStrictEqual(p.wikilinks, ['domain']); // only the un-coded one
});

test('parseWikiPage: [[target|alias]] and [[target#anchor]] resolve to target', () => {
  const p = page('x.md', '# X\n\n[[domain|the domain]] and [[architecture#layers]].');
  assert.deepStrictEqual(p.wikilinks, ['domain', 'architecture']);
});

test('diagnoseWiki: a well-formed wiki is clean', () => {
  const pages = [goodIndex(), goodPage('domain'), goodPage('architecture')];
  const f = gsf.diagnoseWiki(pages);
  assert.deepStrictEqual(f, [], 'no findings for a clean wiki: ' + JSON.stringify(f));
});

test('diagnoseWiki: missing index.md is the only FAIL', () => {
  const f = gsf.diagnoseWiki([goodPage('domain')]);
  assert.ok(f.some((x) => x.level === 'fail' && x.detector === 'moc'));
  // and nothing else is fail-level
  assert.strictEqual(f.filter((x) => x.level === 'fail').length, 1);
});

test('diagnoseWiki: broken wikilink → warn (not counted for external code-spanned)', () => {
  const idx = page('index.md', fm({ title: 'Index', summary: 'm', tags: ['meta'], status: 'current', updated: '2026-01-01' }) + '# Index\n\n- [[ghost-page]]\n- [[domain]]\n');
  const f = gsf.diagnoseWiki([idx, goodPage('domain')]);
  assert.ok(f.some((x) => x.detector === 'broken-link' && x.level === 'warn' && x.message.includes('ghost-page')));
});

test('diagnoseWiki: orphan + not-reachable-from-MoC are warns', () => {
  // island is well-formed but nothing links to it and index doesn't reach it
  const f = gsf.diagnoseWiki([goodIndex(), goodPage('domain'), goodPage('architecture'), goodPage('island')]);
  assert.ok(f.some((x) => x.page === 'island.md' && x.detector === 'orphan'));
});

test('diagnoseWiki: missing summary is a WARN, not a fail (easy-to-use calibration)', () => {
  const bare = page('bare.md', '# Bare\n\nLead.\n\n## S\n\nbody');
  const f = gsf.diagnoseWiki([goodIndex(), goodPage('domain'), goodPage('architecture'), bare]);
  const summ = f.find((x) => x.page === 'bare.md' && x.detector === 'summary');
  assert.ok(summ && summ.level === 'warn');
  assert.strictEqual(f.filter((x) => x.level === 'fail').length, 0);
});

test('diagnoseWiki: oversized section without sub-heading → chunking warn', () => {
  const big = page('big.md', fm({ title: 'Big', summary: 's', tags: ['domain'], status: 'current', updated: '2026-01-01' }) + '# Big\n\nlead\n\n## Huge\n\n' + 'x'.repeat(4000));
  const f = gsf.diagnoseWiki([goodIndex(), goodPage('domain'), goodPage('architecture'), big]);
  assert.ok(f.some((x) => x.page === 'big.md' && x.detector === 'chunking'));
});

test('diagnoseWiki: ADR pages are lenient — no summary/taxonomy/lead warnings', () => {
  const adr = page('adr/0001-choice.md', '# 0001 — A choice\n\nWe chose X because Y.'); // no frontmatter at all
  const f = gsf.diagnoseWiki([goodIndex(), goodPage('domain'), goodPage('architecture'), adr]);
  assert.strictEqual(f.filter((x) => x.page === 'adr/0001-choice.md').length, 0, 'ADR should produce no frontmatter/lead findings');
});

test('diagnoseWiki: >4 tags is a nit, off-taxonomy is a warn', () => {
  const sprawl = page('sprawl.md', fm({ title: 'S', summary: 's', tags: ['domain', 'a', 'b', 'c', 'd'], status: 'current', updated: '2026-01-01' }) + '# S\n\nlead\n\n## X\n\nbody');
  const linked = page('index.md', fm({ title: 'Index', summary: 'm', tags: ['meta'], status: 'current', updated: '2026-01-01' }) + '# Index\n\n- [[sprawl]]\n');
  const f = gsf.diagnoseWiki([linked, sprawl]);
  assert.ok(f.some((x) => x.page === 'sprawl.md' && x.detector === 'taxonomy' && x.level === 'nit'));
});

test('checkWikiStructure: the shipped scaffold wiki is clean (dogfood)', () => {
  const f = gsf.checkWikiStructure('templates/workspace/.tcgstackflow/wiki');
  assert.deepStrictEqual(f, [], 'scaffold must pass its own checker: ' + JSON.stringify(f));
});

// --- regression: the 11 defects the adversarial review confirmed (ADR 0039 review, 2026-07-15) ---

test('regression: CRLF frontmatter parses correctly (not to {})', () => {
  const f = gsf.parseWikiFrontmatter('---\r\ntitle: Payments\r\nsummary: How billing works.\r\ntags: [domain]\r\nstatus: current\r\nupdated: 2026-01-01\r\n---\r\n');
  assert.strictEqual(f.title, 'Payments');
  assert.deepStrictEqual(f.tags, ['domain']);
});

test('regression: frontmatter keeps inner apostrophes/quotes (only wrapping quotes stripped)', () => {
  assert.strictEqual(gsf.parseWikiFrontmatter("---\ntitle: Wendy's Diner\n---").title, "Wendy's Diner");
  assert.strictEqual(gsf.parseWikiFrontmatter('---\ntitle: "Quoted Title"\n---').title, 'Quoted Title');
});

test('regression: an H1 inside a fence does not set hasH1', () => {
  assert.strictEqual(gsf.parseWikiPage('x.md', 'no real heading\n\n```md\n# Not real\n```\n').hasH1, false);
  assert.strictEqual(gsf.parseWikiPage('x.md', 'no heading\n\n```sh\n# a shell comment\n```\n').hasH1, false);
});

test('regression: a fenced ## does not create a section boundary; the real oversized section is still flagged', () => {
  const big = 'x.md';
  const p = gsf.parseWikiPage(big, '# X\n\n## Runbook\n\n' + 'word '.repeat(400) + '\n```\n## fake heading in fence\n```\n' + 'word '.repeat(400));
  assert.deepStrictEqual(p.sections.map((s) => s.heading), [null, 'Runbook']); // fenced ## ignored
  const idx = gsf.parseWikiPage('index.md', '---\ntitle: I\nsummary: m\ntags: [meta]\nstatus: current\nupdated: 2026-01-01\n---\n# I\n\n- [[x]]\n');
  assert.ok(gsf.diagnoseWiki([idx, p]).some((f) => f.detector === 'chunking' && f.message.includes('Runbook')));
});

test('regression: ~~~ tilde fences and 4-backtick fences do not leak wikilinks', () => {
  assert.deepStrictEqual(gsf.parseWikiPage('x.md', '# X\n\n[[domain]]\n\n~~~\n[[nope]]\n~~~\n').wikilinks, ['domain']);
  assert.deepStrictEqual(gsf.parseWikiPage('x.md', '# X\n\n[[domain]]\n\n````\n```\n[[nope]]\n```\n````\n').wikilinks, ['domain']);
});

test('regression: image/list/quote lead is not accepted as the summary paragraph', () => {
  assert.strictEqual(gsf.parseWikiPage('x.md', '# X\n\n![diagram](a.png)\n\n## S\n\nb').leadPara, '');
  assert.strictEqual(gsf.parseWikiPage('x.md', '# X\n\n- a list item\n\n## S\n\nb').leadPara, '');
  assert.strictEqual(gsf.parseWikiPage('x.md', '# X\n\nReal prose lead.\n\n## S\n\nb').leadPara, 'Real prose lead.');
});

test('regression: oversized region before the first heading is flagged (not skipped)', () => {
  const idx = gsf.parseWikiPage('index.md', '---\ntitle: I\nsummary: m\ntags: [meta]\nstatus: current\nupdated: 2026-01-01\n---\n# I\n\n- [[pre]]\n');
  const pre = gsf.parseWikiPage('pre.md', '---\ntitle: Pre\nsummary: s\ntags: [domain]\nstatus: current\nupdated: 2026-01-01\n---\n# Pre\n\n' + 'word '.repeat(1000) + '\n\n## Refs\n\nshort');
  assert.ok(gsf.diagnoseWiki([idx, pre]).some((f) => f.detector === 'chunking' && f.page === 'pre.md' && f.message.includes('before the first heading')));
});

test('regression: slug collision surfaces as ambiguous-link, not a false orphan', () => {
  const idx = gsf.parseWikiPage('index.md', '---\ntitle: I\nsummary: m\ntags: [meta]\nstatus: current\nupdated: 2026-01-01\n---\n# I\n\n- [[auth]]\n');
  const a = gsf.parseWikiPage('guides/auth.md', '---\ntitle: Guide Auth\nsummary: s\ntags: [domain]\nstatus: current\nupdated: 2026-01-01\n---\n# A\n\nlead\n\n## S\n\nb');
  const b = gsf.parseWikiPage('security/auth.md', '---\ntitle: Security Auth\nsummary: s\ntags: [domain]\nstatus: current\nupdated: 2026-01-01\n---\n# B\n\nlead\n\n## S\n\nb');
  const f = gsf.diagnoseWiki([idx, a, b]);
  assert.ok(f.some((x) => x.detector === 'ambiguous-link'));
  assert.ok(!f.some((x) => x.detector === 'broken-link' && x.message.includes('[[auth]]')));
});

test('regression: only a ROOT index.md satisfies the MoC — a nested index.md does not', () => {
  const nested = gsf.parseWikiPage('sub/index.md', '# Sub\n\nlead');
  const other = gsf.parseWikiPage('domain.md', '---\ntitle: D\nsummary: s\ntags: [domain]\nstatus: current\nupdated: 2026-01-01\n---\n# D\n\nlead\n\n## S\n\nb');
  assert.ok(gsf.diagnoseWiki([nested, other]).some((f) => f.level === 'fail' && f.detector === 'moc'));
});
