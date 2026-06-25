'use strict';

// Tests for the schema-3 → 4 migration (runs/ area + orchestrator.roles tool map).
// Exercises MIGRATIONS.apply() directly against a temp workspace so there are NO global
// side effects (no ~/.tcgstackflow/projects.yaml writes, no symlinks) — unlike driving the CLI.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gsf = require('../init.js');

function makeWorkspace() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-mig-'));
  const ws = path.join(target, '.tcgstackflow');
  fs.mkdirSync(ws, { recursive: true });
  // A schema-3-style config: has governance: and tools:, lacks orchestrator: and runs/.
  fs.writeFileSync(
    path.join(ws, 'config.yaml'),
    [
      'tcgflow_version: "0.1.0"',
      'workspace_schema: 3',
      '',
      'project:',
      '  name: "demo"',
      '',
      'governance:',
      '  mode: strict',
      '',
      'tools:',
      '  claude: true',
      '',
    ].join('\n')
  );
  return { target, ws };
}

const mig34 = gsf.MIGRATIONS.find((m) => m.from === 3 && m.to === 4);

test('LATEST_SCHEMA is 6', () => {
  assert.strictEqual(gsf.LATEST_SCHEMA, 6);
});

const mig56 = gsf.MIGRATIONS.find((m) => m.from === 5 && m.to === 6);

test('5→6 refreshes runs/README to the current run-record contract (tool/gate/embed); idempotent', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-mig6-'));
  const ws = path.join(target, '.tcgstackflow');
  fs.mkdirSync(path.join(ws, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'runs', 'README.md'), 'stale contract doc — no tool/gate/embed\n');
  try {
    assert.ok(mig56, 'a 5→6 migration entry exists');
    assert.strictEqual(mig56.apply(target, ws), 1, 'refreshed the contract doc');
    const readme = fs.readFileSync(path.join(ws, 'runs', 'README.md'), 'utf8');
    assert.match(readme, /tool:/);
    assert.match(readme, /embed:/, 'documents the new run-record fields');
    assert.strictEqual(mig56.apply(target, ws), 0, 're-run is a no-op (idempotent)');
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

const mig45 = gsf.MIGRATIONS.find((m) => m.from === 4 && m.to === 5);

test('4→5 adds hooks/post-merge + Trusted Commands; idempotent; preserves user rules', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-mig5-'));
  const ws = path.join(target, '.tcgstackflow');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'config.yaml'), 'workspace_schema: 4\n');
  fs.writeFileSync(path.join(ws, 'governance.md'), '# Governance\n\n## Risk Levels\n…\n\n## Project-Specific Rules\n\n- auth/** -> HIGH\n');
  try {
    assert.ok(mig45, 'a 4→5 migration entry exists');
    const n = mig45.apply(target, ws);
    assert.strictEqual(n, 2, 'hook + governance section');
    assert.ok(fs.existsSync(path.join(ws, 'hooks', 'post-merge')), 'hook script added');
    const gov = fs.readFileSync(path.join(ws, 'governance.md'), 'utf8');
    assert.match(gov, /^## Trusted Commands/m, 'section inserted');
    assert.ok(gov.indexOf('## Trusted Commands') < gov.indexOf('## Project-Specific Rules'), 'inserted before the rules');
    assert.match(gov, /- auth\/\*\* -> HIGH/, 'user rules preserved');
    // idempotent
    const before = gov;
    assert.strictEqual(mig45.apply(target, ws), 0, 're-run is a no-op');
    assert.strictEqual(fs.readFileSync(path.join(ws, 'governance.md'), 'utf8'), before, 'governance unchanged on re-run');
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test('a 3→4 migration entry exists', () => {
  assert.ok(mig34, 'expected a MIGRATIONS entry with from:3 to:4');
  assert.strictEqual(typeof mig34.apply, 'function');
});

test('3→4 creates runs/ + README and inserts orchestrator.roles (default all-claude)', () => {
  const { target, ws } = makeWorkspace();
  try {
    const n = mig34.apply(target, ws);
    assert.strictEqual(n, 2, 'should report 2 changes: runs/ + orchestrator block');

    // runs/README.md created, sourced from the template (non-empty).
    const readme = path.join(ws, 'runs', 'README.md');
    assert.ok(fs.existsSync(readme), 'runs/README.md should exist');
    assert.ok(fs.readFileSync(readme, 'utf8').length > 0, 'runs/README.md should be non-empty');

    // orchestrator.roles block inserted with all six roles -> claude.
    const cfg = fs.readFileSync(path.join(ws, 'config.yaml'), 'utf8');
    assert.match(cfg, /^orchestrator:/m, 'config should gain an orchestrator: block');
    for (const role of ['planner', 'coder', 'reviewer', 'tester', 'ingester', 'refactorer']) {
      assert.match(cfg, new RegExp(`^\\s{4}${role}:\\s*claude`, 'm'), `role ${role} should default to claude`);
    }
    // Inserted before governance:, not after, so it reads cleanly.
    assert.ok(cfg.indexOf('orchestrator:') < cfg.indexOf('governance:'), 'orchestrator: before governance:');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('3→4 is idempotent and never clobbers existing runs content', () => {
  const { target, ws } = makeWorkspace();
  try {
    mig34.apply(target, ws); // first run

    // Seed a user-created run record, then re-run the migration.
    const runFile = path.join(ws, 'runs', 'ES-1', 'abc.md');
    fs.mkdirSync(path.dirname(runFile), { recursive: true });
    const runBytes = '---\ntask: ES-1\nrole: coder\n---\nuser run record\n';
    fs.writeFileSync(runFile, runBytes);

    const cfgBefore = fs.readFileSync(path.join(ws, 'config.yaml'), 'utf8');

    const n2 = mig34.apply(target, ws); // second run
    assert.strictEqual(n2, 0, 'a second run should report 0 changes (idempotent)');

    // The user's run record is byte-identical.
    assert.strictEqual(fs.readFileSync(runFile, 'utf8'), runBytes, 'existing run file must be untouched');

    // Config is unchanged — exactly one orchestrator block, no duplication.
    const cfgAfter = fs.readFileSync(path.join(ws, 'config.yaml'), 'utf8');
    assert.strictEqual(cfgAfter, cfgBefore, 'config must be unchanged on re-run');
    assert.strictEqual((cfgAfter.match(/^orchestrator:/gm) || []).length, 1, 'exactly one orchestrator block');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('3→4 tolerates a config with no governance: (falls back to before tools:)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gsf-mig-'));
  const ws = path.join(target, '.tcgstackflow');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'config.yaml'), 'workspace_schema: 3\n\ntools:\n  claude: true\n');
  try {
    const n = mig34.apply(target, ws);
    assert.strictEqual(n, 2);
    const cfg = fs.readFileSync(path.join(ws, 'config.yaml'), 'utf8');
    assert.match(cfg, /^orchestrator:/m);
    assert.ok(cfg.indexOf('orchestrator:') < cfg.indexOf('tools:'), 'orchestrator: before tools: when no governance:');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
