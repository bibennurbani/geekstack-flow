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

test('LATEST_SCHEMA is 4', () => {
  assert.strictEqual(gsf.LATEST_SCHEMA, 4);
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
