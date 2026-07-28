'use strict';

// Structural contract for the shipped workspace templates. `init`/`upgrade` copy commands/ and
// skills/ wholesale, so a malformed SKILL.md (bad frontmatter, name ≠ directory) ships silently
// and only fails when a user's AI tool tries to load it. These checks are the cheap backstop.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WS = path.join(__dirname, '..', 'templates', 'workspace', '.tcgstackflow');
const dirsIn = (p) => fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

// Minimal frontmatter reader — the same shape read.cjs/agents expect: `---` fenced, `key: value`.
function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

for (const bucket of ['commands', 'skills']) {
  test(`every ${bucket}/*/SKILL.md has frontmatter whose name matches its directory`, () => {
    const names = dirsIn(path.join(WS, bucket));
    assert.ok(names.length > 0, `no ${bucket} found`);
    for (const name of names) {
      const file = path.join(WS, bucket, name, 'SKILL.md');
      assert.ok(fs.existsSync(file), `${bucket}/${name} has no SKILL.md`);
      const fm = frontmatter(file);
      assert.ok(fm, `${bucket}/${name}/SKILL.md has no --- frontmatter block`);
      assert.strictEqual(fm.name, name, `${bucket}/${name}: frontmatter name is "${fm.name}"`);
      assert.ok(fm.description && fm.description.length > 40, `${bucket}/${name}: description too short to dispatch on`);
    }
  });
}

test('every command is prefixed tcgflow- (the slash-command + trigger contract)', () => {
  for (const name of dirsIn(path.join(WS, 'commands'))) {
    assert.ok(name.startsWith('tcgflow-'), `commands/${name} is not tcgflow-prefixed`);
  }
});

test('every skill an agent profile lists under "Skills used" exists', () => {
  const skills = new Set(dirsIn(path.join(WS, 'skills')));
  for (const file of fs.readdirSync(path.join(WS, 'agents')).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(WS, 'agents', file), 'utf8');
    const section = text.split(/^##\s+Skills used\s*$/m)[1];
    if (!section) continue;
    const listed = [...section.split(/^##\s/m)[0].matchAll(/^-\s+`([^`]+)`/gm)].map((m) => m[1]);
    for (const s of listed) assert.ok(skills.has(s), `agents/${file} references missing skill "${s}"`);
  }
});
