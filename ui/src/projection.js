// Cockpit task-table projection — pure, DOM-free (Card 2). The filter + bucket-count + sort logic
// extracted from App.vue's computeds so it can be unit-tested over a plain task list. App.vue's
// `filteredTasks`/`bucketCounts` computeds call these with the current reactive filter state.

// Count active/completed/archive tasks for the bucket tabs.
export function bucketCounts(tasks) {
  const c = { active: 0, completed: 0, archive: 0 };
  for (const t of tasks || []) if (c[t.bucket] != null) c[t.bucket]++;
  return c;
}

// Filter by bucket/status/next-agent/search, then sort by a column. Pure: returns a new array.
export function filterTasks(tasks, opts = {}) {
  const { bucket = 'all', status = 'all', agent = 'all', search = '', sort = { col: 'id', dir: 1 } } = opts;
  let ts = (tasks || []).slice();
  if (bucket !== 'all') ts = ts.filter((t) => t.bucket === bucket);
  if (status !== 'all') ts = ts.filter((t) => t.status === status);
  if (agent !== 'all') ts = ts.filter((t) => t.next_agent === agent);
  const q = String(search).trim().toLowerCase();
  if (q) ts = ts.filter((t) => (t.id + ' ' + t.title).toLowerCase().includes(q));
  const { col, dir } = sort;
  return ts.sort((a, b) => String(a[col] || '').localeCompare(String(b[col] || '')) * dir);
}
