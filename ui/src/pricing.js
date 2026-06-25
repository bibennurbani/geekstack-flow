// Cockpit list-pricing — the SINGLE client-side source (Card 2 / ADR 0034:21).
// Mirrors the server's canonical table (session-report.cjs PRICING); the Cockpit fetches the live
// table from GET /api/pricing at load and falls back to this constant if that call fails. Replaces
// the three drifting copies previously inlined in App.vue (PRICE, PRICING_TABLE, the analysis prompt).

export const PRICING = {
  opus:   { input: 15,  output: 75, cache_write: 18.75, cache_read: 1.5 },
  sonnet: { input: 3,   output: 15, cache_write: 3.75,  cache_read: 0.3 },
  haiku:  { input: 0.8, output: 4,  cache_write: 1,     cache_read: 0.08 },
};

// $ for a 4-class token bucket at a model's per-M list price (default opus). `price` is one row of PRICING.
export function costOf(tokens, price = PRICING.opus) {
  if (!tokens || !price) return 0;
  return (tokens.input || 0) / 1e6 * price.input
    + (tokens.output || 0) / 1e6 * price.output
    + (tokens.cache_creation || 0) / 1e6 * price.cache_write
    + (tokens.cache_read || 0) / 1e6 * price.cache_read;
}

// Display rows for the Settings pricing table — DERIVED from PRICING (no separate copy to drift).
export function pricingRows(table = PRICING) {
  const title = (k) => k.charAt(0).toUpperCase() + k.slice(1);
  return Object.entries(table).map(([k, p]) => ({ m: title(k), i: p.input, o: p.output, cw: p.cache_write, cr: p.cache_read }));
}

// The opus per-M prices, phrased for the "Generate analysis" copy-prompt — derived, not a 4th literal.
export function opusPromptPrices(table = PRICING) {
  const o = table.opus;
  return `input $${o.input} / output $${o.output} / cache-write $${o.cache_write} / cache-read $${o.cache_read.toFixed(2)}`;
}
