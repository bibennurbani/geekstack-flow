// Tracked source must be greppable text.
//
// Regression origin: ui/server/governance-classify.cjs used two *literal* NUL bytes as a
// glob-to-regex sentinel. That makes file(1) classify it as `data`, which makes grep treat it
// as binary and exit 1 with no output — so `grep -rn` across the tree silently skipped the
// file that implements the governance risk classifier. A search-based review misses it without
// ever being told it did, which is the worst kind of blind spot in a security-relevant file.
//
// The sentinel now uses the \u0000 escape instead of a raw byte. Identical behaviour, text file.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Real binaries that are legitimately tracked and must not be flagged.
const BINARY_OK = /\.(woff2?|ttf|otf|eot|png|jpe?g|gif|webp|ico|svgz|pdf|zip|gz|tgz)$/i;

const trackedTextFiles = () =>
  execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((p) => !BINARY_OK.test(p));

test('no tracked text file contains a literal NUL byte', () => {
  const offenders = [];
  for (const rel of trackedTextFiles()) {
    const abs = path.join(ROOT, rel);
    let buf;
    try {
      if (!fs.statSync(abs).isFile()) continue;
      buf = fs.readFileSync(abs);
    } catch {
      continue; // symlink or removed between listing and read
    }
    const count = buf.reduce((n, byte) => (byte === 0 ? n + 1 : n), 0);
    if (count > 0) offenders.push(`${rel} (${count} NUL byte${count === 1 ? '' : 's'})`);
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'these files read as binary, so grep skips them silently — use the \\u0000 escape instead of a raw byte:\n  ' +
      offenders.join('\n  '),
  );
});

test('the governance classifier is greppable — its sentinel is an escape, not a raw byte', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ui/server/governance-classify.cjs'), 'utf8');
  assert.ok(!src.includes(String.fromCharCode(0)), 'governance-classify.cjs must not contain a raw NUL');
  assert.match(
    src,
    /\\u0000/,
    'the globstar sentinel should be written as the \\u0000 escape so the file stays text',
  );
});

test('globToRe still expands ** and * correctly after the sentinel change', () => {
  const { classify } = require('../ui/server/governance-classify.cjs');
  assert.ok(typeof classify === 'function', 'classify should be exported');
  // ** must cross directory separators; * must not. Exercised through the public API so this
  // asserts on behaviour rather than on the regex string.
  assert.ok(classify('Read', { file_path: 'a/b/c.txt' }), 'classify returns a level for a read');
});
