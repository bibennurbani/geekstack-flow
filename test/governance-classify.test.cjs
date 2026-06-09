'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const g = require('../ui/server/governance-classify.cjs');

test('built-in taxonomy: one example per level', () => {
  assert.strictEqual(g.classify('Read', { file_path: 'a.js' }), 'LOW');
  assert.strictEqual(g.classify('Bash', { command: 'git status' }), 'LOW');
  assert.strictEqual(g.classify('Edit', { file_path: 'a.js' }), 'MEDIUM');
  assert.strictEqual(g.classify('Bash', { command: 'pnpm test' }), 'MEDIUM');
  assert.strictEqual(g.classify('Bash', { command: 'git commit -m x' }), 'MEDIUM');
  assert.strictEqual(g.classify('Bash', { command: 'git push origin main' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'pnpm install vee-validate' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'git push --force' }), 'CRITICAL');
  assert.strictEqual(g.classify('Bash', { command: 'rm -rf build' }), 'CRITICAL');
  assert.strictEqual(g.classify('Bash', { command: 'rm -fr node_modules' }), 'CRITICAL');
});

test('unknown tool fails safe to HIGH; mcp__ tools too', () => {
  assert.strictEqual(g.classify('SomethingNew', {}), 'HIGH');
  assert.strictEqual(g.classify('mcp__filesystem__write', {}), 'HIGH');
});

test('compound commands take the MAX segment level', () => {
  assert.strictEqual(g.classify('Bash', { command: 'pnpm test && git push' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'git status; rm -rf dist' }), 'CRITICAL');
  assert.strictEqual(g.classify('Bash', { command: 'git status && git diff' }), 'LOW');
});

test('CI/CD and infra edits are CRITICAL', () => {
  assert.strictEqual(g.classify('Bash', { command: 'echo x >> .github/workflows/ci.yml' }), 'CRITICAL');
  assert.strictEqual(g.classify('Bash', { command: 'terraform apply -auto-approve' }), 'CRITICAL');
});

test('project rules RAISE but never lower', () => {
  const rules = g.parseProjectRules([
    '## Project-Specific Rules',
    '- auth/** -> HIGH',
    '- `src/payments/**`: CRITICAL',
  ].join('\n'));
  assert.deepStrictEqual(rules, [{ glob: 'auth/**', level: 'HIGH' }, { glob: 'src/payments/**', level: 'CRITICAL' }]);

  // Edit on auth/** is normally MEDIUM -> raised to HIGH
  assert.strictEqual(g.classify('Edit', { file_path: 'auth/login.ts' }, rules), 'HIGH');
  // Edit elsewhere stays MEDIUM
  assert.strictEqual(g.classify('Edit', { file_path: 'ui/App.vue' }, rules), 'MEDIUM');
  // A rule never LOWERS: a CRITICAL action with a HIGH rule stays CRITICAL
  assert.strictEqual(g.classify('Bash', { command: 'rm -rf auth/' }, rules), 'CRITICAL');
});

test('classify never throws on weird input', () => {
  assert.strictEqual(g.classify(null, null, null), 'HIGH');
  assert.strictEqual(g.classify('Bash', {}), 'MEDIUM');
});
