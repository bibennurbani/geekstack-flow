// ui/server/runners/claude.cjs — the reference RunnerAdapter (ADR 0035). PURE: no fs / spawn / crypto.
// Encapsulates everything Claude-CLI-specific so the executor's continuation loop stays tool-agnostic:
// the print-mode argv, the --resume idiom, the in-run governance gate flags, the chat read-only flags,
// and the stream-json → uniform-events parse. The loop owns spawning, the per-run governance token, and
// the gov temp-file write/unlink — this adapter only DESCRIBES the invocation and MAPS the stream.
'use strict';

const os = require('os');
const path = require('path');

const num = (x) => (Number.isFinite(+x) ? +x : 0);
const BASE = ['--output-format', 'stream-json', '--verbose', '--include-partial-messages'];

// Fidelity declaration (CONTEXT.md "Fidelity"): Claude is the full-parity reference adapter.
const capabilities = { gate: 'mcp-intercept', tokens: 'per-turn', stream: 'incremental', resume: true, topology: 'we-spawn' };

// Build the spawn descriptor for one invocation.
//   ctx = { prompt, iter, resumeId, mode:'run'|'chat', session_id?, governance? }
//   governance (run mode, when gating) = { mcpServerPath, controlUrl, allowedTools, runToken, workspaceDir }
// Returns { bin, args, env, govConfig: { path, content } | null } — the loop materializes govConfig.
function buildSpawn(run, ctx, bin = 'claude') {
  const { prompt, iter = 0, resumeId = null, mode = 'run', governance = null } = ctx || {};

  // Chat (Discuss) is read-only by design: always resumes, scoped tools, NO permission gate (a chat
  // must never mutate the project — for real changes, launch a Run).
  if (mode === 'chat') {
    return {
      bin,
      args: ['-p', prompt, '--resume', ctx.session_id, ...BASE, '--permission-mode', 'default', '--allowedTools', 'Read,Grep,Glob,LS'],
      env: process.env,
      govConfig: null,
    };
  }

  const args = ['-p', prompt, ...BASE];
  // Resume the LATEST session id on continuation iterations (resolved by the loop via resumeIdFrom).
  if (iter > 0 && resumeId) args.push('--resume', resumeId);

  const env = { ...process.env };
  let govConfig = null;
  if (governance && governance.mcpServerPath && governance.controlUrl && governance.runToken) {
    const cfgPath = path.join(os.tmpdir(), `gsf-gov-${run.run_id}-${iter}.json`);
    govConfig = {
      path: cfgPath,
      content: JSON.stringify({ mcpServers: { tcgflow_governance: { command: process.execPath, args: [governance.mcpServerPath] } } }),
    };
    args.push('--mcp-config', cfgPath, '--permission-prompt-tool', 'mcp__tcgflow_governance__approve', '--permission-mode', 'default', '--allowedTools', governance.allowedTools || 'Read,Grep,Glob,LS');
    env.GSF_WORKSPACE_DIR = governance.workspaceDir;
    env.GSF_CONTROL_URL = governance.controlUrl;
    env.GSF_RUN_ID = run.run_id;
    env.GSF_RUN_TOKEN = governance.runToken;
  }
  return { bin, args, env, govConfig };
}

// Map one stdout line to uniform events. `state` (owned by the loop) threads the text_delta dedupe flag.
//   Event ∈ { type:'session', id } | { type:'delta', text } | { type:'tokens', usage:{input,output,cache_read,cache_creation} }
function parseLine(line, state = {}) {
  const events = [];
  if (!line) return events;
  let o; try { o = JSON.parse(line); } catch { return events; } // ignore non-JSON lines
  if (o.session_id) events.push({ type: 'session', id: o.session_id });
  const ev = o.event || o; // stream_event wraps the inner event in .event
  if (ev && ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
    state.sawDelta = true;
    events.push({ type: 'delta', text: ev.delta.text || '' });
  }
  // The whole assistant message arrives too — use it only when NO partial deltas streamed for it
  // (e.g. runs without --include-partial-messages), otherwise we'd double-count the text.
  if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
    if (!state.sawDelta) for (const b of o.message.content) if (b.type === 'text' && b.text) events.push({ type: 'delta', text: b.text });
    state.sawDelta = false; // reset for the next turn
  }
  if (o.type === 'result' && o.usage) {
    events.push({
      type: 'tokens',
      usage: {
        input: num(o.usage.input_tokens),
        output: num(o.usage.output_tokens),
        cache_read: num(o.usage.cache_read_input_tokens),
        cache_creation: num(o.usage.cache_creation_input_tokens),
      },
    });
  }
  return events;
}

// Resume the LATEST id (a resumed print-mode session can fork a new id); fall back to the first seen.
function resumeIdFrom(state) { return (state && (state.latest_session_id || state.session_id)) || null; }

module.exports = { id: 'claude', capabilities, buildSpawn, parseLine, resumeIdFrom };
