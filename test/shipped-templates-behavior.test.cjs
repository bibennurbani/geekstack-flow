'use strict';

// Behaviour of the SHIPPED artifacts, not of hand-written fixtures.
//
// Every other governance test builds its governance.md inline as a string, so all of them passed while
// the real shipped template was inert: its HTML-commented "uncomment and adapt" examples parsed as LIVE
// trusted prefixes (including `->`, from the comment terminator `-->`), and its Project-Specific Rules
// section parsed to nothing for every rule form the docs taught. Result: `Edit prisma/migrations/001.sql`
// classified MEDIUM and auto-proceeded with no approval card and no log entry, while governance.md's own
// Risk Levels table and eight other shipped documents said migrations were HIGH.
//
// The rule these tests encode: feed the real file to the real parser and assert on the OUTPUT. A template
// is a behavioural artifact — reading its source text proves nothing about what the gate will do with it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const gov = require('../ui/server/governance-classify.cjs');

const WS = path.join(__dirname, '..', 'templates', 'workspace', '.tcgstackflow');
const GOV_PATH = path.join(WS, 'governance.md');
const shipped = () => fs.readFileSync(GOV_PATH, 'utf8');

test('shipped governance.md yields NO live trusted-command prefixes', () => {
  const trusted = gov.parseTrustedCommands(shipped());
  assert.deepStrictEqual(trusted, [], `template ships trusted prefixes nobody opted into: ${JSON.stringify(trusted)}`);
});

test('shipped governance.md never parses a comment terminator as a trusted prefix', () => {
  // Regression: `-->` matched the bullet regex as `- ` + `->`.
  for (const p of gov.parseTrustedCommands(shipped())) {
    assert.doesNotMatch(p, /^-+>?$/, `parsed punctuation as a trusted prefix: ${JSON.stringify(p)}`);
  }
});

test('shipped governance.md yields NO live project rules (defaults ship commented)', () => {
  const rules = gov.parseProjectRules(shipped());
  assert.deepStrictEqual(rules, [], `template ships live escalation rules: ${JSON.stringify(rules)}`);
});

test('the escalation rules the template suggests actually parse once uncommented', () => {
  // The template's value depends on its commented defaults being *correct*, not merely inert. Uncomment
  // them the way a user would and assert the parser accepts every one.
  const text = shipped().replace(/<!--([\s\S]*?)-->/g, '$1');
  const rules = gov.parseProjectRules(text);
  const globs = rules.map((r) => r.glob);
  for (const expected of ['prisma/migrations/**', 'src/auth/**', '.github/workflows/**']) {
    assert.ok(globs.includes(expected), `suggested rule "${expected}" does not parse; got ${JSON.stringify(globs)}`);
  }
  for (const r of rules) assert.match(r.level, /^(LOW|MEDIUM|HIGH|CRITICAL)$/, `bad level on ${r.glob}: ${r.level}`);
  // And the prose "Notes (prose, not parsed)" bullets must NOT become rules when uncommented.
  assert.ok(!globs.some((g) => /HIPAA|Pushes to|Snyk/.test(g)), `prose note parsed as a rule: ${JSON.stringify(globs)}`);
});

test('uncommented defaults escalate the paths the Risk Levels table calls HIGH/CRITICAL', () => {
  const rules = gov.parseProjectRules(shipped().replace(/<!--([\s\S]*?)-->/g, '$1'));
  const cases = [
    ['Edit', { file_path: 'prisma/migrations/001_init.sql' }, 'CRITICAL'],
    ['Edit', { file_path: 'src/auth/login.ts' }, 'HIGH'],
    ['Edit', { file_path: '.github/workflows/ci.yml' }, 'CRITICAL'],
  ];
  for (const [tool, input, expected] of cases) {
    assert.strictEqual(gov.classify(tool, input, rules), expected,
      `${tool} ${input.file_path} classified ${gov.classify(tool, input, rules)}, expected ${expected}`);
  }
});

test('a sensitive Edit is MEDIUM with no rules — the gap the rules exist to close', () => {
  // Documents WHY the rules matter: without them the tool taxonomy alone lets an Edit through, and
  // governance-mcp decide() auto-allows MEDIUM. If this ever changes, the template prose needs updating.
  assert.strictEqual(gov.classify('Edit', { file_path: 'prisma/migrations/001_init.sql' }, []), 'MEDIUM');
});

test('fenced and commented examples anywhere in the template stay illustrative', () => {
  // Guards the whole class: a future editor adding an example bullet in a ``` block or an <!-- --> block
  // must not arm the gate. Both regions are stripped before parsing.
  const text = [
    '## Trusted Commands', '', '```', '- `npx vitest`', '```', '',
    '<!--', '- `pnpm test`', '-->', '',
    '## Project-Specific Rules', '', '```', '- src/**/* -> CRITICAL', '```',
    '<!--', '- infra/** -> CRITICAL', '-->', '',
  ].join('\n');
  assert.deepStrictEqual(gov.parseTrustedCommands(text), []);
  assert.deepStrictEqual(gov.parseProjectRules(text), []);
});

test('an unterminated comment or fence disables the rest of the file, it does not arm it', () => {
  const unterminatedComment = '## Trusted Commands\n\n<!--\n- `npx vitest`\n';
  assert.deepStrictEqual(gov.parseTrustedCommands(unterminatedComment), []);
  const unterminatedFence = '## Project-Specific Rules\n\n```\n- src/** -> CRITICAL\n';
  assert.deepStrictEqual(gov.parseProjectRules(unterminatedFence), []);
});

test('real bullets outside comments and fences still parse (the stripper is not too greedy)', () => {
  const text = [
    '## Trusted Commands', '', '```', '- `npx example`', '```', '', '- `npx vitest`', '- pnpm test', '',
    '## Project-Specific Rules', '', '<!-- - commented/** -> HIGH -->', '', '- prisma/migrations/** -> CRITICAL', '',
  ].join('\n');
  assert.deepStrictEqual(gov.parseTrustedCommands(text), ['npx vitest', 'pnpm test']);
  assert.deepStrictEqual(gov.parseProjectRules(text), [{ glob: 'prisma/migrations/**', level: 'CRITICAL' }]);
});

test('shipped governance.md distinguishes the interactive and orchestrated regimes', () => {
  // The file used to claim flatly that nothing was enforced by a runtime gate, which is false for
  // orchestrated runs and is why nobody knew the parseable sections existed.
  const text = shipped();
  assert.match(text, /Orchestrated/i, 'governance.md does not name the orchestrated regime');
  assert.match(text, /Interactive/i, 'governance.md does not name the interactive regime');
  assert.doesNotMatch(text, /not enforced by a runtime gate/,
    'governance.md still claims no runtime gate exists');
});

test('shipped governance.md documents the parseable rule form users must actually type', () => {
  // The form `- <glob> -> LEVEL` previously existed only in a code comment and a test fixture, while
  // docs/USAGE.md taught prose that parsed to nothing.
  assert.match(shipped(), /-\s*<glob>\s*->\s*LEVEL/, 'the parseable rule form is not documented in the template');
});
