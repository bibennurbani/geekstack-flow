// ui/server/runners/index.cjs — RunnerAdapter registry + selector (ADR 0035).
//
// A RunnerAdapter teaches the Orchestrator how to drive ONE headless AI tool as a Run. It is a PURE
// module — no child_process, no fs, no crypto: the executor (run.cjs) owns spawning, the gov temp-file
// lifecycle, and per-run token generation. The adapter only DESCRIBES the invocation and MAPS the
// tool's stream to uniform events. See CONTEXT.md "Runner adapter" / "Fidelity" and ADR 0035.
//
// Interface (duck-typed; see claude.cjs for the reference implementation):
//   id: string
//   capabilities: { gate, tokens, stream, resume, topology }
//   buildSpawn(run, ctx, bin) -> { bin, args, env, govConfig: {path,content}|null }
//        ctx = { prompt, iter, resumeId, mode:'run'|'chat', session_id?, governance? }
//   parseLine(line, state) -> Event[]
//        Event = {type:'session',id} | {type:'delta',text} | {type:'tokens',usage:{input,output,cache_read,cache_creation}}
//   resumeIdFrom(state) -> string|null
//
// Today only `claude` is registered (full parity). codex / copilot are follow-on plans; antigravity
// stays a Copy-prompt target. `get(tool)` returns null for an unregistered tool — the launch door
// (index.cjs) maps that to the existing 501, so the role->tool map can't launch a tool we can't drive.

'use strict';

const claude = require('./claude.cjs');

const REGISTRY = new Map([['claude', claude]]);

const get = (tool) => REGISTRY.get(String(tool || 'claude')) || null;
const has = (tool) => REGISTRY.has(String(tool || 'claude'));
const register = (id, adapter) => { REGISTRY.set(id, adapter); };

module.exports = { get, has, register, REGISTRY };
