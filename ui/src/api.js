// Cockpit API client — the one place the SPA knows the backend's URL shapes and error discriminators
// (Card 2 / review finding "the API call is a non-module"). Pure (uses the global fetch); unit-testable
// by stubbing fetch. App.vue imports these instead of hand-building URLs + encodeURIComponent at ~9
// call sites and re-deriving the `{error:'…'}` discriminator in scattered ladders.

// Build a query-string URL, encoding every param. Skips null/undefined/'' so optional params
// (e.g. an absent `run`) drop out cleanly — replaces the inline `?path=`+encodeURIComponent(...) triples.
export function url(path, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}

// GET → parsed JSON (every /api/* endpoint returns JSON).
export const api = (path) => fetch(path).then((r) => r.json());

// POST JSON → the raw Response (callers branch on res.ok then read res.json()).
export const postJSON = (path, body) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Normalize a POST Response into a typed result so callers can switch on `code` instead of re-deriving
// the `j.error` discriminator. Adopt incrementally — postJSON stays for the existing call sites.
export async function decode(res) {
  let data = null;
  try { data = await res.json(); } catch { /* empty / non-JSON body */ }
  if (res.ok) return { ok: true, status: res.status, data };
  return { ok: false, status: res.status, code: (data && data.error) || `http-${res.status}`, data };
}

// Named GET helpers — the endpoint URL shapes live here, not at the call site.
export const getProjects = () => api('/api/projects');
export const getAgents = () => api('/api/agents');
export const getProject = (path) => api(url('/api/project', { path }));
export const getTask = (path, id) => api(url('/api/project/task', { path, id }));
export const getReport = (path, id, run) => api(url('/api/project/task/report', { path, id, run }));
export const getRunView = (path, id, run) => api(url('/api/project/task/run', { path, id, run }));
export const getDiff = (path, id, run) => api(url('/api/project/task/run/diff', { path, id, run }));
export const getRunsHistory = () => api('/api/runs/history');
export const getApprovals = () => api('/api/approvals');
export const getPricing = () => api('/api/pricing');
export const reportHtmlUrl = (path, id, run) => url('/api/project/task/report.html', { path, id, run });
