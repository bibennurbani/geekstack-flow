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
  await new Promise((r) => setTimeout(r, 250));
  child.kill();
  assert.ok(responses.find((r) => r.id === 1 && r.result && r.result.serverInfo), 'got initialize result');
  const call = responses.find((r) => r.id === 2);
  assert.ok(call, 'got tools/call result');
  assert.strictEqual(JSON.parse(call.result.content[0].text).behavior, 'allow', 'LOW Read allowed over the pipe');
});
