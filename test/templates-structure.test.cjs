'use strict';

// Structural contract for the shipped workspace templates. `init`/`upgrade` copy commands/ and
// skills/ wholesale, so a malformed SKILL.md (bad frontmatter, name ≠ directory) ships silently
// and only fails when a user's AI tool tries to load it. These checks are the cheap backstop.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { LATEST_SCHEMA } = require('../init.js');

const ROOT = path.join(__dirname, '..');
const WS = path.join(ROOT, 'templates', 'workspace', '.tcgstackflow');
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

// ── Documented counts ────────────────────────────────────────────────────────────────────────
// "18 skills", "nineteen workflow commands", "44 ADRs", "workspace schema 7" are claims about the
// shipped tree, restated across seven documents and patched by hand on every release — so they go
// stale one file at a time, and they did: the overview claimed `workspace schema 7` against a
// config.yaml that said 8, and README claimed 44 records with 45 on disk. Below, the truth is read
// off disk at runtime and every documented claim is checked against it.
//
// WHEN THIS FAILS, FIX THE DOCUMENT, NOT THE NUMBER — the shipped directories are the source of
// truth, and hand-patching the test is the exact habit this test exists to end.
//
// One deliberate limit: the patterns match the specific documented phrasings rather than scanning
// for loose two-digit numbers, so unrelated figures in these files (line counts, port numbers, ADR
// ids) never trip it.
//
// Schema is two claims on one ladder, not two ladders. `init.js` `LATEST_SCHEMA` is what a real
// workspace carries — `init`/`upgrade` stamp it into `config.yaml`, and MIGRATIONS walks the
// template's number up to it — so every document describing a workspace is checked against
// `LATEST_SCHEMA`. The template `config.yaml` literal is the lower rung the stamp overwrites; it is
// a `template_schema` claim, checked against that file, so the two can never be conflated. Only
// README's `workspace schema N` phrasing is claimed there; its other prose mentions of a schema
// number (the migration-ladder sentence, the `runs/` line in the layout tree) are outside these
// patterns.

const NUMBER_WORDS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, 'twenty-one': 21, 'twenty-two': 22,
  'twenty-three': 23, 'twenty-four': 24, 'twenty-five': 25, 'twenty-six': 26, 'twenty-seven': 27,
  'twenty-eight': 28, 'twenty-nine': 29, thirty: 30,
};

// A claim is a file, which count it asserts, and a global regex whose first group is the claimed
// value — a numeral ("19") or a number word ("nineteen"). Every match found is checked.
const COUNT_CLAIMS = [
  ['README.md', 'skills', /\*\*(\d+) skills\*\*/g],
  ['README.md', 'skills', /#\s*(\d+) skills$/gm],
  ['README.md', 'skills', /^(\d+) atomic skills under/gm],
  ['README.md', 'commands', /\*\*(\d+) commands\*\*/g],
  ['README.md', 'commands', /#\s*(\d+) tcgflow-\* commands/g],
  ['README.md', 'commands', /^(\d+) commands\. In Claude Code/gm],
  ['README.md', 'adrs', /(\d+) Architecture Decision Records/g],
  ['README.md', 'schema', /workspace schema (\d+)/g],

  ['package.json', 'skills', /([A-Za-z-]+) starter skills/g],

  ['docs/README.md', 'adrs', /(\d+) Architecture Decision Records/g],

  ['CONTEXT.md', 'commands', /([A-Za-z-]+) ship in V1/g],

  ['docs/USAGE.md', 'skills', /#\s*(\d+) workflow skills/g],
  ['docs/USAGE.md', 'skills', /^###\s+Skills\s+\((\d+)\)/gm],
  ['docs/USAGE.md', 'commands', /#\s*(\d+) tcgflow-\* command dispatchers/g],
  ['docs/USAGE.md', 'commands', /^###\s+Commands\s+\((\d+)\)/gm],
  ['docs/USAGE.md', 'adrs', /\((\d+) ADRs\)/g],

  ['docs/geekstackflow-overview.md', 'skills', /`(\d+)` skills/g],
  ['docs/geekstackflow-overview.md', 'skills', /(\d+) atomic capabilities/g],
  ['docs/geekstackflow-overview.md', 'skills', /^\|\s*Skills\s*\|\s*(\d+)\s*\|/gm],
  ['docs/geekstackflow-overview.md', 'commands', /`(\d+)` `tcgflow-\*` commands/g],
  ['docs/geekstackflow-overview.md', 'commands', /(\d+) tcgflow-\* workflow dispatchers/g],
  ['docs/geekstackflow-overview.md', 'commands', /^\|\s*Commands\s*\|\s*(\d+)\s*\|/gm],
  ['docs/geekstackflow-overview.md', 'adrs', /\*\*(\d+) ADRs\*\*/g],
  ['docs/geekstackflow-overview.md', 'adrs', /Architecture Decision Record\s+[—-]\s+(\d+) of them/g],
  ['docs/geekstackflow-overview.md', 'adrs', /^\|\s*ADRs\s*\|\s*(\d+)\s*\|/gm],
  ['docs/geekstackflow-overview.md', 'schema', /workspace schema `(\d+)`/g],
  ['docs/geekstackflow-overview.md', 'schema', /workspace_schema: (\d+)/g],
  ['docs/geekstackflow-overview.md', 'schema', /^\|\s*Workspace schema\s*\|\s*(\d+)\s*\|/gm],
  ['docs/geekstackflow-overview.md', 'template_schema', /^\|\s*Template config\.yaml schema\s*\|\s*(\d+)\s*\|/gm],

  ['templates/workspace/.tcgstackflow/README.md', 'commands', /\| ([A-Za-z-]+) tool-portable `tcgflow-\*` workflow commands/g],

  ['templates/workspace/.tcgstackflow/tools/claude/CLAUDE.md', 'skills', /([A-Za-z-]+) starter skills ship with V1/g],

  ['templates/workspace/.tcgstackflow/tools/codex/AGENTS.md', 'skills', /Same ([A-Za-z-]+) starter skills as Claude/g],
  ['templates/workspace/.tcgstackflow/tools/codex/AGENTS.md', 'commands', /ships ([A-Za-z-]+) workflow commands/g],

  ['templates/workspace/.tcgstackflow/tools/github/copilot-instructions.md', 'skills', /([A-Za-z-]+) ship in V1/g],
  ['templates/workspace/.tcgstackflow/tools/github/copilot-instructions.md', 'commands', /ships ([A-Za-z-]+) workflow commands/g],
];

test('every documented skill / command / ADR / schema count matches what ships', () => {
  const config = fs.readFileSync(path.join(WS, 'config.yaml'), 'utf8');
  const templateSchema = config.match(/^workspace_schema:\s*(\d+)/m);
  assert.ok(templateSchema, 'config.yaml has no workspace_schema line to compare the docs against');

  const truth = {
    skills: { value: dirsIn(path.join(WS, 'skills')).length, source: 'templates/workspace/.tcgstackflow/skills/' },
    commands: { value: dirsIn(path.join(WS, 'commands')).length, source: 'templates/workspace/.tcgstackflow/commands/' },
    adrs: { value: fs.readdirSync(path.join(ROOT, 'docs', 'adr')).filter((f) => f.endsWith('.md')).length, source: 'docs/adr/*.md' },
    schema: { value: LATEST_SCHEMA, source: 'init.js LATEST_SCHEMA — the value init/upgrade stamps into a workspace config.yaml' },
    template_schema: { value: Number(templateSchema[1]), source: 'templates/workspace/.tcgstackflow/config.yaml workspace_schema' },
  };

  const checkedPerFile = new Map();
  for (const [file, kind, re] of COUNT_CLAIMS) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of text.matchAll(re)) {
      const claimed = m[1].toLowerCase();
      const value = claimed in NUMBER_WORDS ? NUMBER_WORDS[claimed] : Number(claimed);
      checkedPerFile.set(file, (checkedPerFile.get(file) || 0) + 1);
      assert.strictEqual(
        value,
        truth[kind].value,
        `${file}: "${m[0].trim()}" documents ${kind} = ${m[1]}; the real value is ${truth[kind].value} (${truth[kind].source}). Update the document, not this test.`
      );
    }
  }

  // A reworded document that no longer matches any pattern is silently unchecked, which is how
  // counts drifted in the first place — so every file must still contribute at least one claim.
  for (const file of new Set(COUNT_CLAIMS.map(([f]) => f))) {
    assert.ok(checkedPerFile.get(file), `${file}: no documented count matched — a claim was reworded past its pattern, or removed`);
  }
});
