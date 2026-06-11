#!/usr/bin/env node
// GOV-3 — zero-dependency stdio MCP permission server exposing one tool: `approve`.
// Claude Code calls it via --permission-prompt-tool for any action not pre-allowed. It classifies
// the action (GOV-1); LOW/MEDIUM proceed immediately; HIGH/CRITICAL POST to the Cockpit's loopback
// intake (GOV-2) and BLOCK until the human decides. Fails CLOSED on any error (a gate that can't
// reach the Cockpit must never auto-allow). Implements only the 3 JSON-RPC methods the flow needs
// (initialize / tools/list / tools/call), line-delimited over stdin/stdout (MCP stdio transport).

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PROTOCOL_VERSION = '2024-11-05';
const TOOL_NAME = 'approve';

const allow = (input) => ({ behavior: 'allow', updatedInput: input || {} });
const deny = (action) => ({ behavior: 'deny', message: `${action} deferred to human` });

function describeAction(tool, input = {}) {
  if (/^Bash$/i.test(tool) && input.command) return `Bash: ${input.command}`;
  if (input.file_path) return `${tool}: ${input.file_path}`;
  if (input.path) return `${tool}: ${input.path}`;
  return String(tool || 'action');
}

// ctx: { classify(tool,input,rules), rules, postIntake(payload)->Promise<{decision}> }
async function decide(params, ctx) {
  const args = (params && params.arguments) || {};
  const toolName = args.tool_name || args.tool || 'unknown';
  const input = args.input || {};
  let level;
  try { level = ctx.classify(toolName, input, ctx.rules || [], ctx.trusted || []); } catch { level = 'HIGH'; }
  if (level === 'LOW' || level === 'MEDIUM') return allow(input);
  const action = describeAction(toolName, input);
  try {
    const res = await ctx.postIntake({ tool_name: toolName, input, risk: level, action });
    return res && (res.decision === 'approved' || res.decision === 'approve') ? allow(input) : deny(action);
  } catch {
    return deny(action); // FAIL CLOSED
  }
}

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }

async function handleMessage(msg, ctx) {
  if (!msg || typeof msg !== 'object') return null;
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return rpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'tcgflow_governance', version: '1.0.0' } });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return null; // notification
  if (method === 'tools/list') {
    return rpcResult(id, { tools: [{
      name: TOOL_NAME,
      description: 'Governance gate — classifies an action and pauses for human approval on HIGH/CRITICAL.',
      inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' } }, required: ['tool_name'] },
    }] });
  }
  if (method === 'tools/call') {
    const decision = await decide(params, ctx);
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(decision) }] });
  }
  if (id !== undefined) return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } };
  return null;
}

// Blocking POST to the Cockpit's loopback intake; no idle timeout (survive "user at lunch", ADR 0027).
function postIntake(payload) {
  return new Promise((resolve, reject) => {
    const base = process.env.GSF_CONTROL_URL;
    if (!base) return reject(new Error('no-control-url'));
    let url; try { url = new URL('/api/run/approval-request', base); } catch (e) { return reject(e); }
    const body = Buffer.from(JSON.stringify({ run_id: process.env.GSF_RUN_ID, token: process.env.GSF_RUN_TOKEN, ...payload }));
    const lib = url.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('bad-intake-response')); } }); }
    );
    req.setTimeout(0);
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function runStdio() {
  const { classify, parseProjectRules, parseTrustedCommands } = require('./governance-classify.cjs');
  let rules = [], trusted = [];
  try { const gtext = fs.readFileSync(path.join(process.env.GSF_WORKSPACE_DIR || '.', 'governance.md'), 'utf8'); rules = parseProjectRules(gtext); trusted = parseTrustedCommands(gtext); } catch { rules = []; trusted = []; }
  const ctx = { classify, rules, trusted, postIntake };
  let buf = '';
  process.stdin.on('data', async (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      let resp; try { resp = await handleMessage(msg, ctx); } catch { resp = null; }
      if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
    }
  });
}

if (require.main === module) runStdio();

module.exports = { handleMessage, decide, describeAction, allow, deny, postIntake, TOOL_NAME, PROTOCOL_VERSION };
