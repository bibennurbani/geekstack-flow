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

test('fail-open escapes closed: interpreters, ./exec, redirection, find -delete', () => {
  assert.strictEqual(g.classify('Bash', { command: 'node -e "require(\'fs\').rmSync(\'/x\')"' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'python3 evil.py' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'bash -c "anything"' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'npx some-package' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: './deploy.sh' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'find . -name "*.tmp" -delete' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'cat secrets > /tmp/out' }), 'MEDIUM', 'redirection disqualifies LOW');
  // regressions: legit reads + the qmd knowledge layer stay frictionless, tests stay MEDIUM
  assert.strictEqual(g.classify('Bash', { command: 'qmd search "auth flow"' }), 'LOW');
  assert.strictEqual(g.classify('Bash', { command: 'node --version' }), 'LOW');
  assert.strictEqual(g.classify('Bash', { command: 'pnpm test' }), 'MEDIUM');
  assert.strictEqual(g.classify('Bash', { command: 'git diff' }), 'LOW');
});

test('reviewer escape catalogue is closed', () => {
  assert.strictEqual(g.classify('Bash', { command: 'find . -fprintf /etc/passwd x' }), 'HIGH', 'find write predicates');
  assert.strictEqual(g.classify('Bash', { command: 'find . -execdir evil {} ;' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'node --eval "evil()"' }), 'HIGH', 'long eval flag');
  assert.strictEqual(g.classify('Bash', { command: 'python -m anymodule' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'ruby -rnet/http -e x' }), 'HIGH', 'intervening flags');
  assert.strictEqual(g.classify('Bash', { command: 'cat evil.py | python3' }), 'HIGH', 'bare interpreter fed by pipe (max of segments)');
  assert.strictEqual(g.classify('Bash', { command: 'find . -name "*.js"' }), 'LOW', 'read-only find stays LOW');
});

test('Trusted Commands cap HIGH at MEDIUM, never CRITICAL, never compound-evil', () => {
  const trusted = g.parseTrustedCommands([
    '## Trusted Commands', 'prose here', '- `npx vitest`', '- ./gradlew test', '', '## Project-Specific Rules', '- auth/** -> HIGH',
  ].join('\n'));
  assert.deepStrictEqual(trusted, ['npx vitest', './gradlew test']);
  assert.strictEqual(g.classify('Bash', { command: 'npx vitest run' }, [], trusted), 'MEDIUM', 'trusted prefix lowers HIGH');
  assert.strictEqual(g.classify('Bash', { command: './gradlew test' }, [], trusted), 'MEDIUM');
  assert.strictEqual(g.classify('Bash', { command: 'npx vitest && rm -rf dist' }, [], trusted), 'CRITICAL', 'compound still maxes');
  assert.strictEqual(g.classify('Bash', { command: 'npx vitest && git push' }, [], trusted), 'HIGH', 'untrusted HIGH segment wins');
  assert.strictEqual(g.classify('Bash', { command: 'npx playwright install' }, [], trusted), 'HIGH', 'different npx command not covered');
  assert.strictEqual(g.classify('Bash', { command: 'git push --force' }, [], trusted), 'CRITICAL', 'CRITICAL untouchable');
});

test('Card 6 — indirection tier: dispatchers/DB clients no longer tunnel CRITICAL through MEDIUM', () => {
  // these were MEDIUM before — exactly the governance.md CRITICAL/HIGH actions wearing a coding-task costume
  assert.strictEqual(g.classify('Bash', { command: 'make deploy' }), 'CRITICAL');
  assert.strictEqual(g.classify('Bash', { command: 'npm run deploy' }), 'CRITICAL');
  assert.strictEqual(g.classify('Bash', { command: 'pnpm run release' }), 'CRITICAL');
  assert.strictEqual(g.classify('Bash', { command: 'psql -c "DROP TABLE users"' }), 'CRITICAL');
  assert.strictEqual(g.classify('Bash', { command: 'mysql -e "TRUNCATE sessions"' }), 'CRITICAL');
  assert.strictEqual(g.classify('Bash', { command: 'docker push myimg:latest' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'mysql < drop.sql' }), 'HIGH', 'file-fed DB client is opaque');
  assert.strictEqual(g.classify('Bash', { command: 'npm run migrate' }), 'HIGH');
  assert.strictEqual(g.classify('Bash', { command: 'just migrate:up' }), 'HIGH');
  // NO over-capture — routine scripts/builds/dev/local-docker stay MEDIUM (no approval fatigue)
  assert.strictEqual(g.classify('Bash', { command: 'npm run test' }), 'MEDIUM');
  assert.strictEqual(g.classify('Bash', { command: 'npm run build' }), 'MEDIUM');
  assert.strictEqual(g.classify('Bash', { command: 'make build' }), 'MEDIUM');
  assert.strictEqual(g.classify('Bash', { command: 'docker compose up -d' }), 'MEDIUM');
  assert.strictEqual(g.classify('Bash', { command: 'docker build .' }), 'MEDIUM');
  // compound still maxes
  assert.strictEqual(g.classify('Bash', { command: 'npm run build && make deploy' }), 'CRITICAL');
});

test('Card 6 — recipeFor synthesizes files + a rollback hint for the approval card', () => {
  assert.deepStrictEqual(g.recipeFor('Edit', { file_path: 'src/auth/login.ts' }).files, ['src/auth/login.ts']);
  assert.match(g.recipeFor('Bash', { command: 'git push --force' }).rollback, /force-push/i);
  assert.match(g.recipeFor('Bash', { command: 'psql -c "DROP TABLE users"' }).rollback, /destructive db|snapshot|backup/i);
  assert.match(g.recipeFor('Bash', { command: 'make deploy' }).rollback, /production|rollback|redeploy/i);
  const r = g.recipeFor('Bash', { command: 'rm -rf build/cache.json' });
  assert.ok(r.files.includes('build/cache.json'), 'file target extracted from the command');
  assert.match(r.rollback, /deletion|irreversible|backup/i);
  assert.deepStrictEqual(g.recipeFor('Bash', { command: 'git status' }), { files: [], rollback: '' }, 'benign action → empty recipe');
});
