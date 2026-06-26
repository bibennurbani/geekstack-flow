// ui/server/config-fields.cjs — the parse/edit primitives config.yaml access is made of (Card 3 [0]).
//
// config.yaml was parsed by ad-hoc regex in four places (read.cjs readConfig, run.cjs readRoleTool +
// embedOnIngest), each re-deriving the SAME "scope to a top-level block, then read a field inside it"
// idiom. That idiom lives here once. Edits stay SURGICAL (replace/insert single lines) on purpose:
// the template's comments are load-bearing documentation, so we never parse-and-reserialize the file.
//
// Pure string functions — no fs (ADR 0024: callers own file I/O). Block names here are plain YAML
// keys (orchestrator, wiki_search, projects); they contain no regex metacharacters.

// The body of a top-level `name:` block — everything after the header line up to the next top-level
// key (a line starting in column 0). '' when the block is absent. This is the scoping every reader
// needs so a key in one block can't be mistaken for the same key in another.
function block(text, name) {
  const after = String(text == null ? '' : text).split(new RegExp('^' + name + ':', 'm'))[1] || '';
  const stop = after.search(/^\S/m);
  return stop > 0 ? after.slice(0, stop) : after;
}

// A scalar field (`key: value`, value taken up to whitespace) inside a block, or `fallback`.
function blockScalar(text, name, key, fallback = null) {
  const m = block(text, name).match(new RegExp('^\\s+' + key + ':\\s*(\\S+)', 'm'));
  return m ? m[1].trim() : fallback;
}

// Whether a block contains `key: true` — the idiom for the orchestrator's boolean toggles.
function blockHasTrue(text, name, key) {
  return new RegExp('^\\s+' + key + ':\\s*true', 'm').test(block(text, name));
}

// Surgically set `key: value` inside a top-level block: replace the line if present, else insert it
// right after the block header (two-space indent). Everything else — comments included — is kept
// byte-for-byte. Throws `no-<name>-block` when the block is missing (callers map this to a 400).
function editBlockLine(text, name, key, value) {
  const headerRe = new RegExp('^(' + name + ':.*)$', 'm');
  if (!headerRe.test(text)) throw new Error('no-' + name + '-block');
  const parts = String(text).split(headerRe); // [before, header, rest]
  const stop = parts[2].search(/^\S/m);
  let body = stop > 0 ? parts[2].slice(0, stop) : parts[2];
  const tail = stop > 0 ? parts[2].slice(stop) : '';
  const keyRe = new RegExp('^(\\s+' + key + ':\\s*)\\S+', 'm');
  if (keyRe.test(body)) body = body.replace(keyRe, '$1' + value);
  else body = '\n  ' + key + ': ' + value + body;
  return parts[0] + parts[1] + body + tail;
}

module.exports = { block, blockScalar, blockHasTrue, editBlockLine };
