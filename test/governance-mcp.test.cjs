'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const mcp = require('../ui/server/governance-mcp.cjs');
const { classify } = require('../ui/server/governance-classify.cjs');

const parseDecision = (resp) => JSON.parse(resp.result.content[0].text);

test('initialize + tools/list advertise the approve tool', async () => {
  const init = await mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }, {});
  assert.strictEqual(init.result.protocolVersion, mcp.PROTOCOL_VERSION);
  assert.strictEqual(init.result.serverInfo.name, 'tcgflow_governance');
  const list = await mcp.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, {});
  assert.strictEqual(list.result.tools[0].name, 'approve');
});

test('LOW/MEDIUM actions allow immediately (no intake)', async () => {
  let intakeCalls = 0;
  const ctx = { classify, rules: [], postIntake: async () => { intakeCalls++; return { decision: 'approved' }; } };
  const low = await mcp.handleMessage({ id: 3, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Read', input: { file_path: 'a.js' } } } }, ctx);
  assert.strictEqual(parseDecision(low).behavior, 'allow');
  const med = await mcp.handleMessage({ id: 4, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Edit', input: { file_path: 'a.js' } } } }, ctx);
  assert.strictEqual(parseDecision(med).behavior, 'allow');
  assert.strictEqual(intakeCalls, 0, 'LOW/MEDIUM must not hit the intake');
});

test('HIGH action blocks on intake then mirrors the decision', async () => {
  const approveCtx = { classify, rules: [], postIntake: async (p) => { assert.strictEqual(p.risk, 'HIGH'); return { decision: 'approved' }; } };
  const ok = await mcp.handleMessage({ id: 5, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'git push origin main' } } } }, approveCtx);
  const okd = parseDecision(ok);
  assert.strictEqual(okd.behavior, 'allow');
  assert.deepStrictEqual(okd.updatedInput, { command: 'git push origin main' });

  const denyCtx = { classify, rules: [], postIntake: async () => ({ decision: 'denied' }) };
  const no = await mcp.handleMessage({ id: 6, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'git push origin main' } } } }, denyCtx);
  const nod = parseDecision(no);
  assert.strictEqual(nod.behavior, 'deny');
  assert.match(nod.message, /deferred to human/);
});

test('fail CLOSED when the intake is unreachable', async () => {
  const ctx = { classify, rules: [], postIntake: async () => { throw new Error('ECONNREFUSED'); } };
  const r = await mcp.handleMessage({ id: 7, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'rm -rf /' } } } }, ctx);
  assert.strictEqual(parseDecision(r).behavior, 'deny', 'unreachable Cockpit must NOT auto-allow');
});

// Integration: drive the actual script over stdio pipes (proves the line framing).
test('stdio framing: script answers initialize + a LOW tools/call over a pipe', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'ui', 'server', 'governance-mcp.cjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const responses = [];
  let buf = '';
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8');
    let nl; while ((nl = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (l) responses.push(JSON.parse(l)); }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Read', input: {} } } }) + '\n');
  // Wait for both replies rather than sleeping a fixed 250ms and killing the child: on a loaded
  // machine (this suite spawns real CLI subprocesses) node startup alone can exceed that, and the
  // test would fail having proven nothing about framing. Returns as soon as both arrive.
  const deadline = Date.now() + 10_000;
  while (!(responses.some((r) => r.id === 1) && responses.some((r) => r.id === 2))) {
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  child.kill();
  assert.ok(responses.find((r) => r.id === 1 && r.result && r.result.serverInfo), 'got initialize result');
  const call = responses.find((r) => r.id === 2);
  assert.ok(call, 'got tools/call result');
  assert.strictEqual(JSON.parse(call.result.content[0].text).behavior, 'allow', 'LOW Read allowed over the pipe');
});

// --- ADR 0037 second signal: write attempts by role (observe only) ---------------------------------
// The gate is action-scoped, never actor-scoped: Edit/Write classify MEDIUM and decide() auto-allows
// MEDIUM for EVERY role, so a Reviewer can rewrite the code it is reviewing with no card and no log
// entry. Separation of duties is the organizing idea of the workspace and the one invariant the
// enforcement layer never checks. These tests pin the counter — and pin that it changes NOTHING.

test('decide() reports Edit/Write/MultiEdit/NotebookEdit attempts and still allows them', async () => {
  const seen = [];
  const ctx = {
    classify: () => 'MEDIUM',
    postIntake: async () => { throw new Error('must not be called for MEDIUM'); },
    reportWriteAttempt: (p) => seen.push(p.tool),
  };
  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
    const d = await mcp.decide({ arguments: { tool_name: tool, input: { file_path: 'src/a.ts' } } }, ctx);
    assert.strictEqual(d.behavior, 'allow', `${tool} must still be allowed — the counter never gates`);
  }
  assert.deepStrictEqual(seen, ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
});

test('decide() does not report non-write tools', async () => {
  const seen = [];
  const ctx = { classify: () => 'LOW', postIntake: async () => ({ decision: 'approved' }), reportWriteAttempt: (p) => seen.push(p.tool) };
  for (const tool of ['Read', 'Grep', 'Glob', 'Bash']) {
    await mcp.decide({ arguments: { tool_name: tool, input: {} } }, ctx);
  }
  assert.deepStrictEqual(seen, [], 'only Edit/Write/MultiEdit/NotebookEdit count as write attempts');
});

test('a throwing reportWriteAttempt never affects the gate outcome', async () => {
  const ctx = {
    classify: () => 'CRITICAL',
    postIntake: async () => ({ decision: 'approved' }),
    reportWriteAttempt: () => { throw new Error('telemetry exploded'); },
  };
  const d = await mcp.decide({ arguments: { tool_name: 'Write', input: { file_path: 'x' } } }, ctx);
  assert.strictEqual(d.behavior, 'allow', 'observation must never change the decision');
});

test('the counter is optional — a ctx without reportWriteAttempt still works', async () => {
  const d = await mcp.decide({ arguments: { tool_name: 'Edit', input: { file_path: 'x' } } }, { classify: () => 'MEDIUM' });
  assert.strictEqual(d.behavior, 'allow');
});
