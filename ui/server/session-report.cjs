// Session report data layer — parse Claude Code session JSONL(s) for a task and aggregate token /
// tool / cost telemetry (the live "Session report" page + the basis for the AI editorial report).
// The rich source is the session JSONL at ~/.claude/projects/<encoded-cwd>/<session_id>.jsonl, which
// `claude -p` writes; we locate it by session_id (captured per Run) rather than guessing the path
// encoding. Cost uses a per-model list-price table (ADR 0034 — amends ADR 0033's raw-tokens-only).
// Zero-dependency; best-effort (never throws on missing/malformed — a missing log → an empty report).

const fs = require('fs');
const path = require('path');
const os = require('os');
const read = require('./read.cjs'); // parseFrontmatter (one-way dep; read.cjs never imports this)

// USD per MILLION tokens. List-price estimates; effective rate differs (note surfaced in the report).
const PRICING = {
  opus: { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  sonnet: { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  haiku: { input: 0.8, output: 4, cache_write: 1.0, cache_read: 0.08 },
};
function priceFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return PRICING.opus;
  if (m.includes('sonnet')) return PRICING.sonnet;
  if (m.includes('haiku')) return PRICING.haiku;
  return PRICING.opus; // unknown → opus (highest; conservative cost estimate)
}

// Tool categorization for the "tool calls by type" bars (mirrors the reference report).
function toolCategory(name) {
  if (/^(Agent|Team|Task$)/.test(name) || /^Team(Create|Delete)$/.test(name)) return 'orchestration';
  if (/^(SendMessage|TaskCreate|TaskList|TaskUpdate|TaskGet|TaskStop|TaskOutput)$/.test(name)) return 'coordination';
  if (/^(Read|Write|Edit|MultiEdit|NotebookEdit|NotebookRead|Bash|Glob|Grep|LS)$/.test(name)) return 'io';
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

// ADR 0037 — classify a tool call as WIKI ACCESS so a run's interaction with the LLM-wiki is visible:
// 'qmd' (the discovery layer) vs 'direct' (a raw Read/Grep/LS/Bash over wiki|docs bodies). This is
// call-count visibility only — the session JSONL carries no per-tool token cost, so it shows HOW the
// wiki was reached (qmd-mediated vs by hand), not its token price. It is the minimum instrumentation
// needed before any "qmd is more token-efficient" claim can be checked (docs/plans/qmd-query-path-enforcement.md).
function wikiAccessKind(name, input = {}) {
  const n = String(name || '');
  const cmd = String(input.command || '');
  if (/^mcp__qmd__/i.test(n)) return 'qmd';
  if (/^Bash$/i.test(n) && /\bqmd\s+(query|search|vsearch|get)\b/.test(cmd)) return 'qmd';
  const hay = [input.file_path, input.path, input.glob, input.pattern, cmd].filter(Boolean).join(' ');
  if (!/(\.tcgstackflow\/wiki|(^|[\s"'./])docs\/)/.test(hay)) return null;
  if (/^(Read|Grep|Glob|LS|Bash)$/i.test(n)) return 'direct';
  return null;
}

// Locate a session JSONL by id anywhere under <claudeHome>/projects (robust to cwd path encoding).
function findSessionLog(sessionId, claudeHome) {
  if (!sessionId) return null;
  const base = path.join(claudeHome || path.join(os.homedir(), '.claude'), 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(base, { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const f = path.join(base, d.name, sessionId + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

const ZERO = () => ({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });

// Parse one session JSONL into per-session telemetry.
function parseSessionLog(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const lines = text.split('\n').filter(Boolean);
  const tokens = ZERO();
  const tools = {};
  const timeline = [];
  const models = new Set();
  const wiki_access = { qmd: 0, direct: 0 }; // ADR 0037 — how this run reached the wiki
  let turns = 0, mcp_calls = 0, start = null, end = null;
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.timestamp) { const t = Date.parse(o.timestamp); if (!Number.isNaN(t)) { if (start === null || t < start) start = t; if (end === null || t > end) end = t; } }
    const m = o.message || {};
    if (o.type === 'assistant' && m.usage) {
      turns++;
      if (m.model) models.add(m.model);
      const u = m.usage;
      const cr = +u.cache_read_input_tokens || 0, cc = +u.cache_creation_input_tokens || 0;
      const inp = +u.input_tokens || 0, out = +u.output_tokens || 0;
      tokens.input += inp; tokens.output += out; tokens.cache_read += cr; tokens.cache_creation += cc;
      timeline.push({ t: o.timestamp ? Date.parse(o.timestamp) : null, cache_read: cr, total: inp + out + cr + cc });
    }
    if (Array.isArray(m.content)) for (const b of m.content) if (b && b.type === 'tool_use') {
      const n = b.name || '?'; tools[n] = (tools[n] || 0) + 1; if (n.startsWith('mcp__')) mcp_calls++;
      const wk = wikiAccessKind(n, b.input || {}); if (wk) wiki_access[wk]++;
    }
  }
  return { file, turns, records: lines.length, models: [...models], model: [...models][0] || '', tokens, tools, mcp_calls, wiki_access, timeline, start, end };
}

function costOf(tokens, model) {
  const p = priceFor(model);
  const by_class = {
    input: tokens.input / 1e6 * p.input,
    output: tokens.output / 1e6 * p.output,
    cache_write: tokens.cache_creation / 1e6 * p.cache_write,
    cache_read: tokens.cache_read / 1e6 * p.cache_read,
  };
  const total = by_class.input + by_class.output + by_class.cache_write + by_class.cache_read;
  return { by_class, total };
}

// One spend-vs-budget computation (Card 7 / ADR 0035) — replaces the math previously duplicated in
// the enqueue guard (index.cjs) and the launch re-check (run.cjs overBudget). Sums the project's
// durable Run-token total, prices it (default opus list pricing; `model` is a PARAMETER so it can
// follow the role's tool once non-Claude runners land), and compares to orchestrator.budget_usd.
// Best-effort: unreadable config → not over. Returns { spend, budget, over } — the guard shows
// spend+budget in its 409, the launch re-check reads only .over. `opts.detail` lets a caller that
// already read buildProjectDetail (index.cjs reuses it for the chain decision) avoid a second read.
function budgetFor(projectPath, opts = {}) {
  const model = opts.model || 'claude-opus';
  try {
    const detail = opts.detail || read.buildProjectDetail(projectPath);
    const budget = detail.config && detail.config.orchestrator ? detail.config.orchestrator.budget_usd : null;
    const tk = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
    for (const t of detail.tasks || []) for (const k in tk) tk[k] += (t.tokens_total && t.tokens_total[k]) || 0;
    const spend = costOf(tk, model).total;
    return { spend, budget, over: budget != null && spend >= budget };
  } catch { return { spend: 0, budget: null, over: false }; }
}

// Aggregate every run (session) of a task into one report.
function buildTaskReport(workspaceDir, taskId, opts = {}) {
  const runsDir = path.join(workspaceDir, 'runs', taskId);
  let files = [];
  try { files = fs.readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')); } catch { files = []; }
  if (opts.onlyRun) files = files.filter((e) => e.name.replace(/\.md$/, '') === opts.onlyRun); // per-run scope

  const sessions = [];
  const totalTokens = ZERO();
  const tools = {};
  const wiki_access = { qmd: 0, direct: 0 }; // ADR 0037 — wiki access across all runs of the task
  let timeline = [];
  const models = new Set();
  let turns = 0, records = 0, mcp_calls = 0, start = null, end = null, found = 0;

  for (const f of files) {
    const rr = read.parseRunRecord(fs.readFileSync(path.join(runsDir, f.name), 'utf8'));
    const session_id = rr.session_id || '';
    const logFile = findSessionLog(session_id, opts.claudeHome);
    const parsed = logFile ? parseSessionLog(logFile) : null;
    const entry = { run_id: f.name.replace(/\.md$/, ''), session_id, role: rr.role || 'unknown', found: !!parsed };
    if (parsed) {
      found++;
      for (const k of Object.keys(totalTokens)) totalTokens[k] += parsed.tokens[k];
      for (const [n, c] of Object.entries(parsed.tools)) tools[n] = (tools[n] || 0) + c;
      if (parsed.wiki_access) { wiki_access.qmd += parsed.wiki_access.qmd || 0; wiki_access.direct += parsed.wiki_access.direct || 0; }
      timeline = timeline.concat(parsed.timeline.map((p) => ({ ...p, session: entry.run_id })));
      parsed.models.forEach((m) => models.add(m));
      turns += parsed.turns; records += parsed.records; mcp_calls += parsed.mcp_calls;
      if (parsed.start !== null && (start === null || parsed.start < start)) start = parsed.start;
      if (parsed.end !== null && (end === null || parsed.end > end)) end = parsed.end;
      entry.turns = parsed.turns; entry.tokens = parsed.tokens; entry.model = parsed.model;
    } else {
      // Run record exists but the session JSONL isn't on this machine — fall back to the run's own
      // frontmatter totals so the report still counts it (no per-turn trace for it).
      const ftk = rr.tokens; // typed 4-key tokens from parseRunRecord (one coercion, not re-derived here)
      for (const k of Object.keys(totalTokens)) totalTokens[k] += ftk[k];
      entry.turns = 0; entry.tokens = ftk; entry.model = '';
    }
    sessions.push(entry);
  }

  timeline.sort((a, b) => (a.t || 0) - (b.t || 0));
  const model = [...models][0] || '';
  const tool_calls = Object.values(tools).reduce((n, c) => n + c, 0);
  const tools_by_type = Object.entries(tools)
    .map(([name, count]) => ({ name, count, category: toolCategory(name) }))
    .sort((a, b) => b.count - a.count);

  return {
    task: taskId,
    sessions,
    sessions_found: found,
    model,
    models: [...models],
    totals: {
      tokens: totalTokens,
      tokens_processed: totalTokens.input + totalTokens.output + totalTokens.cache_read + totalTokens.cache_creation,
      cost: costOf(totalTokens, model),
      turns, records, tool_calls, mcp_calls,
      wiki_access, // ADR 0037 — { qmd, direct }: how the run reached the wiki (call counts, not tokens)
      wall_clock_ms: start !== null && end !== null ? end - start : 0,
    },
    tools_by_type,
    timeline,
    pricing: { model_family: priceFor(model), note: 'List-price estimate; effective rate may differ (ADR 0033/0034).' },
  };
}

// Render a report object as a self-contained dark-editorial HTML document (one-click export — no
// external assets, no AI step). The AI-authored narrative/recommendations are a separate skill.
function renderReportHtml(report, opts = {}) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtTok = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n); };
  const fmtUsd = (n) => { n = Number(n) || 0; return n >= 100 ? '$' + Math.round(n) : '$' + n.toFixed(2); };
  const t = report.totals.tokens, c = report.totals.cost;
  const wall = report.totals.wall_clock_ms ? (report.totals.wall_clock_ms >= 60000 ? Math.round(report.totals.wall_clock_ms / 60000) + 'm' : Math.round(report.totals.wall_clock_ms / 1000) + 's') : '—';
  const rows = [
    { n: 'Cache reads', tok: t.cache_read, usd: c.by_class.cache_read, hot: true },
    { n: 'Output', tok: t.output, usd: c.by_class.output },
    { n: 'Cache writes', tok: t.cache_creation, usd: c.by_class.cache_write },
    { n: 'Fresh input', tok: t.input, usd: c.by_class.input },
  ].sort((a, b) => b.usd - a.usd);
  const maxUsd = Math.max(...rows.map((r) => r.usd), 1e-9);
  const wf = rows.map((r) => `<div class="wf-row"><div class="wf-head"><span>${r.n}${r.hot ? ' <span class="flag">cost driver</span>' : ''}</span><span class="wf-val">${fmtUsd(r.usd)} <span class="wf-pct">${Math.round(r.usd / (c.total || 1e-9) * 100)}%</span></span></div><div class="bar"><span style="width:${Math.max(0.8, r.usd / maxUsd * 100)}%;background:${r.hot ? 'linear-gradient(90deg,#f5b031,#f25c54)' : '#34416a'}"></span></div><div class="wf-sub">${(Number(r.tok) || 0).toLocaleString()} tokens</div></div>`).join('');
  const toolMax = report.tools_by_type[0] ? report.tools_by_type[0].count : 1;
  const COLOR = { orchestration: '#9d8cf0', coordination: '#46c6e0', io: '#5ee0c2', mcp: '#f5b031', other: '#8794b4' };
  const tools = report.tools_by_type.map((x) => `<div class="tool-row"><span class="tool-name">${esc(x.name)}</span><span class="tool-bar"><i style="width:${x.count / toolMax * 100}%;background:${COLOR[x.category] || COLOR.other}"></i></span><span class="tool-count">${x.count}</span></div>`).join('') || '<div class="muted">No tool calls recorded.</div>';
  let trace = '<div class="muted">No per-turn trace — session logs not found on this machine.</div>';
  if (report.timeline.length) {
    const mx = Math.max(...report.timeline.map((p) => p.cache_read), 1), n = report.timeline.length;
    const pts = report.timeline.map((p, i) => `${(n === 1 ? 1000 : i / (n - 1) * 1000).toFixed(1)},${(150 - p.cache_read / mx * 138).toFixed(1)}`);
    trace = `<svg viewBox="0 0 1000 150" preserveAspectRatio="none" style="width:100%;height:130px"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f25c54" stop-opacity=".5"/><stop offset="1" stop-color="#f25c54" stop-opacity="0"/></linearGradient></defs><path d="M0,150 L${pts.join(' L')} L1000,150 Z" fill="url(#g)"/><path d="M${pts.join(' L')}" fill="none" stroke="#f25c54" stroke-width="1.5"/></svg>`;
  }
  const metric = (v, k) => `<div><div class="mv">${v}</div><div class="mk">${k}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session report · ${esc(opts.task || report.task)}</title><style>
:root{--bg:#0a0f1e;--panel:#10182f;--p2:#16203c;--line:#23304f;--txt:#e8eefb;--muted:#8794b4;--m2:#5e6c8e;--amber:#f5b031;--coral:#f25c54}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1000px 460px at 80% -8%,#16224230 0,transparent 60%),var(--bg);color:var(--txt);font:14px/1.55 system-ui,-apple-system,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:40px 26px 80px}.mono{font-family:ui-monospace,Menlo,monospace}
.eyebrow{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--m2)}
h1{font-size:34px;margin:8px 0 0;font-weight:700;letter-spacing:-.01em}h2{font-size:18px;margin:34px 0 14px;font-weight:600}
.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:28px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:20px}
.big{text-align:right}.big .n{font-size:54px;font-weight:700;line-height:1;background:linear-gradient(180deg,#fff,var(--amber));-webkit-background-clip:text;background-clip:text;color:transparent}
.big .l{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--m2)}.big small{color:var(--muted);font-size:12px}
.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-top:20px}
.metrics>div{background:var(--bg);padding:16px}.mv{font-family:ui-monospace,monospace;font-size:22px;font-weight:600}.mk{font-size:11px;color:var(--muted);margin-top:4px}
.tgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.tcard{border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--panel)}.tcard.hot{border-color:#f5b03155}
.tcard .v{font-family:ui-monospace,monospace;font-size:26px;font-weight:600}.tcard.hot .v{background:linear-gradient(120deg,var(--amber),var(--coral));-webkit-background-clip:text;background-clip:text;color:transparent}
.tcard .n{font-weight:600;margin-top:6px;font-size:13.5px}.tcard .s{color:var(--muted);font-size:11.5px;margin-top:3px}
.wf{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:6px 20px;margin-top:14px}.wf-row{padding:14px 0;border-bottom:1px solid var(--line)}.wf-row:last-child{border-bottom:0}
.wf-head{display:flex;justify-content:space-between;align-items:baseline}.wf-val{font-family:ui-monospace,monospace;font-weight:600}.wf-pct{color:var(--muted);font-size:12px;margin-left:6px}
.flag{font-family:ui-monospace,monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--coral);border:1px solid #f25c5455;border-radius:5px;padding:1px 6px;margin-left:6px}
.bar{height:8px;border-radius:5px;background:#0b1226;margin:8px 0 4px;overflow:hidden}.bar span{display:block;height:100%;border-radius:5px}.wf-sub{font-family:ui-monospace,monospace;font-size:11px;color:var(--m2)}
.panel{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:16px 20px}
.tool-row{display:grid;grid-template-columns:170px 1fr 36px;align-items:center;gap:10px;padding:4px 0}.tool-name{font-family:ui-monospace,monospace;font-size:12px}.tool-bar{height:7px;background:#0b1226;border-radius:4px;overflow:hidden}.tool-bar i{display:block;height:100%;border-radius:4px}.tool-count{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);text-align:right}
.muted{color:var(--muted)}footer{margin-top:34px;color:var(--m2);font-size:11.5px;font-family:ui-monospace,monospace}
@media(max-width:720px){.metrics{grid-template-columns:repeat(2,1fr)}.tgrid{grid-template-columns:repeat(2,1fr)}.big{text-align:left}}
</style></head><body><div class="wrap">
<div class="hero"><div><div class="eyebrow">session report · ${esc(opts.project || '')}</div><h1>${esc(opts.task || report.task)}</h1>
<div class="muted" style="margin-top:6px">model ${esc(report.model || '—')} · ${report.totals.turns} turns · ${report.sessions_found}/${report.sessions.length} session(s)</div></div>
<div class="big"><div class="l">est. cost</div><div class="n">${fmtUsd(c.total)}</div><small>${fmtTok(report.totals.tokens_processed)} tokens · list pricing</small></div></div>
<div class="metrics">${metric(wall, 'wall-clock')}${metric(report.sessions.length, 'runs')}${metric(report.totals.tool_calls, 'tool calls')}${metric(fmtTok(report.totals.tokens_processed), 'tokens')}${metric(report.totals.mcp_calls, 'MCP calls')}${metric(((report.totals.wiki_access || {}).qmd || 0) + ' / ' + ((report.totals.wiki_access || {}).direct || 0), 'wiki qmd / direct')}</div>
<h2>Where the tokens went</h2><div class="tgrid">
<div class="tcard hot"><div class="v">${fmtTok(t.cache_read)}</div><div class="n">Cache reads</div><div class="s">Context re-read each turn</div></div>
<div class="tcard"><div class="v">${fmtTok(t.cache_creation)}</div><div class="n">Cache writes</div><div class="s">New context committed</div></div>
<div class="tcard"><div class="v">${fmtTok(t.output)}</div><div class="n">Output</div><div class="s">Tokens generated</div></div>
<div class="tcard"><div class="v">${fmtTok(t.input)}</div><div class="n">Fresh input</div><div class="s">Uncached prompt</div></div></div>
<div class="wf">${wf}</div>
<h2>Cache-read per turn</h2><div class="panel">${trace}</div>
<h2>Tool calls by type</h2><div class="panel">${tools}</div>
<footer>${report.pricing.note} · generated by the GeekStack Flow Cockpit.</footer>
</div></body></html>`;
}

module.exports = { buildTaskReport, renderReportHtml, parseSessionLog, findSessionLog, costOf, budgetFor, priceFor, toolCategory, wikiAccessKind, PRICING };
