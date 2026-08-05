'use strict';

// init.js pre-fills governance.md's Trusted Commands from the detected stack. It decides which commands
// are worth listing with its OWN local predicate (commandNeedsTrust) rather than importing
// ui/server/governance-classify.cjs, because ADR 0022 keeps init.js dependency-free on the init path.
//
// That mirror can drift. These tests are the seam: every command init would list must actually classify
// HIGH in the real classifier (otherwise the entry is noise), and every command it would NOT list must
// already be MEDIUM or lower (otherwise a run pauses for approval on a routine test command). If the
// classifier's rules change, this fails instead of shipping a silently-wrong pre-fill.

const { test } = require('node:test');
const assert = require('node:assert');

const gsf = require('../init.js');
const gov = require('../ui/server/governance-classify.cjs');

// Every test/lint command shape detectProject() can emit, across all supported stacks.
const DETECTED_COMMANDS = [
  'pnpm test:unit', 'pnpm test', 'npm test', 'yarn test', 'bun test', 'pnpm lint',
  'dotnet test', 'dotnet format --verify-no-changes',
  'cargo test', 'cargo clippy -- -D warnings',
  'pytest', 'poetry run pytest',
  'go test ./...', 'go vet ./...',
  'mvn test', 'gradle test', './gradlew test',
  'npx vitest', 'npx cypress run --spec x.cy.ts', 'npx tsc --noEmit',
];

test('init.js commandNeedsTrust agrees with the real classifier on every detectable command', () => {
  for (const cmd of DETECTED_COMMANDS) {
    const needsTrust = gsf.commandNeedsTrust(cmd);
    const isHigh = gov.classifyBash(cmd) === 'HIGH';
    assert.strictEqual(needsTrust, isHigh,
      `init.js says needsTrust=${needsTrust} but the classifier rates "${cmd}" ${gov.classifyBash(cmd)} — the mirror in init.js has drifted from ui/server/governance-classify.cjs`);
  }
});

test('a trusted prefix init writes actually lowers the command it was written for', () => {
  // The whole point of the pre-fill: without the entry the command pauses the run; with it, it proceeds.
  for (const cmd of DETECTED_COMMANDS.filter((c) => gsf.commandNeedsTrust(c))) {
    const trusted = gsf.trustedPrefixesFor([{ test: cmd }]);
    assert.deepStrictEqual(trusted, [cmd]);
    assert.strictEqual(gov.classify('Bash', { command: cmd }, [], []), 'HIGH', `${cmd} should be HIGH untrusted`);
    assert.strictEqual(gov.classify('Bash', { command: cmd }, [], trusted), 'MEDIUM', `${cmd} should be MEDIUM once trusted`);
  }
});

test('trustedPrefixesFor derives from detected sub-projects, deduped, in order', () => {
  const detected = [
    { name: 'api', test: 'go test ./...', lint: 'go vet ./...' },
    { name: 'web', test: 'pnpm test', lint: 'pnpm lint' },     // already MEDIUM → contributes nothing
    { name: 'dup', test: 'go test ./...', lint: '' },           // duplicate → collapsed
  ];
  assert.deepStrictEqual(gsf.trustedPrefixesFor(detected), ['go test ./...', 'go vet ./...']);
});

test('trustedPrefixesFor returns an empty list for an all-MEDIUM stack — the correct answer, not a failure', () => {
  assert.deepStrictEqual(gsf.trustedPrefixesFor([{ test: 'pnpm test', lint: 'pnpm lint' }]), []);
  assert.deepStrictEqual(gsf.trustedPrefixesFor([{ test: 'dotnet test' }]), []);
  assert.deepStrictEqual(gsf.trustedPrefixesFor([]), []);
  assert.deepStrictEqual(gsf.trustedPrefixesFor(), []);
  assert.deepStrictEqual(gsf.trustedPrefixesFor([{}, null, { test: '' }]), []);
});

test('renderGovernanceMd inserts bullets the real parser then reads back', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const template = fs.readFileSync(
    path.join(__dirname, '..', 'templates', 'workspace', '.tcgstackflow', 'governance.md'), 'utf8');

  // no prefixes → untouched, and still parses to nothing
  assert.strictEqual(gsf.renderGovernanceMd(template, []), template);
  assert.deepStrictEqual(gov.parseTrustedCommands(gsf.renderGovernanceMd(template, [])), []);

  // with prefixes → the real parser reads back exactly what init wrote
  const rendered = gsf.renderGovernanceMd(template, ['go test ./...', 'npx vitest']);
  assert.deepStrictEqual(gov.parseTrustedCommands(rendered), ['go test ./...', 'npx vitest']);
  // and it did not arm any escalation rule as a side effect
  assert.deepStrictEqual(gov.parseProjectRules(rendered), []);
});

test('renderGovernanceMd leaves a template without the marker alone', () => {
  const noMarker = '# Governance\n\n## Trusted Commands\n\nprose only\n';
  assert.strictEqual(gsf.renderGovernanceMd(noMarker, ['npx vitest']), noMarker);
});
