// Cockpit display formatters — pure, DOM-free (Card 2). Extracted from App.vue so they can be unit-
// tested without mounting the SPA. `relTime` takes an injectable `now` so its output is deterministic
// in tests (App passes one arg; the default Date.now() is used at runtime).

export const fmtTok = (n) => {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
};

export const fmtUsd = (n) => {
  n = Number(n) || 0;
  return n >= 100 ? '$' + Math.round(n) : '$' + n.toFixed(2);
};

export function relTime(iso, now = Date.now()) {
  if (!iso) return 'never synced';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'synced';
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return 'synced just now';
  if (mins < 60) return `synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `synced ${hrs}h ago`;
  return `synced ${Math.round(hrs / 24)}d ago`;
}
