'use strict';

// Integration: the REAL governance-mcp.cjs child ↔ a harness that plays the Cockpit's loopback
// intake/decision endpoints backed by the REAL approvals registry. Proves the full pause-and-approve
// loop (GOV-3 classify → POST intake → GOV-2 register/hold → resolve → mirror back to the agent)
// over real stdio + HTTP, for both approve and deny.

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createApprovals } = require('../ui/server/approvals.cjs');

const MCP = path.join(__dirname, '..', 'ui', 'server', 'governance-mcp.cjs');

function runGate({ command, decide }) {
  return new Promise((resolve, reject) => {
    const recorded = [];
    const approvals = createApprovals({
      emit: (run_id, type, data) => { if (type === 'approval_request') setImmediate(() => approvals.resolve(data.approval_id, decide)); },
      record: (rec, d) => recorded.push([rec.action, d]),
    });
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => (b += c));
      req.on('end', async () => {
        const body = b ? JSON.parse(b) : {};
        if (req.url === '/api/run/approval-request') {
          const decision = await approvals.register({ run_id: body.run_id, task_id: 'T-1', project_path: '/tmp/x', action: body.action, risk: body.risk });
          res.end(JSON.stringify({ decision }));
        } else { res.end('{}'); }
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = `http://127.0.0.1:${srv.address().port}`;
      const child = spawn(process.execPath, [MCP], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, GSF_CONTROL_URL: addr, GSF_RUN_ID: 'r1', GSF_RUN_TOKEN: 'tok', GSF_WORKSPACE_DIR: os.tmpdir() } });
      const responses = []; let buf = '';
      child.stdout.on('data', (c) => { buf += c.toString('utf8'); let nl; while ((nl = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (l) responses.push(JSON.parse(l)); } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command } } } }) + '\n');
      const poll = setInterval(() => {
        const r = responses.find((x) => x.id === 2);
        if (r) { clearInterval(poll); clearTimeout(killer); child.kill(); srv.close(); resolve({ decision: JSON.parse(r.result.content[0].text), recorded }); }
      }, 20);
      const killer = setTimeout(() => { clearInterval(poll); child.kill(); srv.close(); reject(new Error('timeout')); }, 5000);
    });
  });
}

test('HIGH action APPROVED end-to-end: agent gets allow, decision recorded', async () => {
  const { decision, recorded } = await runGate({ command: 'git push origin main', decide: 'approve' });
  assert.strictEqual(decision.behavior, 'allow');
  assert.deepStrictEqual(decision.updatedInput, { command: 'git push origin main' });
  assert.deepStrictEqual(recorded, [['Bash: git push origin main', 'approved']]);
});

test('HIGH action DENIED end-to-end: agent gets deny "deferred to human", decision recorded', async () => {
  const { decision, recorded } = await runGate({ command: 'git push origin main', decide: 'deny' });
  assert.strictEqual(decision.behavior, 'deny');
  assert.match(decision.message, /deferred to human/);
  assert.deepStrictEqual(recorded, [['Bash: git push origin main', 'denied']]);
});
