// ui/server/config-fields.cjs — the parse/edit primitives config.yaml access is made of (Card 3 [0]).
//
// config.yaml was parsed by ad-hoc regex in four places (read.cjs readConfig, run.cjs readRoleTool +
// embedOnIngest), each re-deriving the SAME "scope to a top-level block, then read a field inside it"
// idiom. That idiom lives here once. Edits stay SURGICAL (replace/insert single lines) on purpose:
// the template's comments are load-bearing documentation, so we never parse-and-reserialize the file.
//
// Pure string functions — no fs (ADR 0024: callers own file I/O). Block names here are plain YAML
// keys (orchestrator, wiki_search, projects); they contain no regex metacharacters.

// Where a top-level `name:` block's header line ends and where its body ends (the next line starting
// in column 0, else EOF). null when the block is absent. Index-based on purpose: splitting on the
// header would silently DROP everything past a second occurrence of it.
function blockBounds(text, name) {
  const s = String(text == null ? '' : text);
  const m = s.match(new RegExp('^' + name + ':.*$', 'm'));
  if (!m) return null;
  const headEnd = m.index + m[0].length;
  const stop = s.slice(headEnd).search(/^\S/m);
  return { headEnd, bodyEnd: stop > 0 ? headEnd + stop : s.length };
}

// The body of a top-level `name:` block — everything after the header line up to the next top-level
// key (a line starting in column 0). '' when the block is absent. This is the scoping every reader
// needs so a key in one block can't be mistaken for the same key in another.
function block(text, name) {
  const b = blockBounds(text, name);
  return b ? String(text).slice(b.headEnd, b.bodyEnd) : '';
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

// A `key:` line inside a block, indent-anchored so `\s` can never swallow a newline and start the
// match on the line above.
const lineRe = (key) => new RegExp('^([ \\t]+' + key + '):[ \\t]*\\S*', 'm');

// Surgically set `key: value` inside a top-level block: replace the line if present, else insert it
// right after the block header (two-space indent). Everything else — comments included — is kept
// byte-for-byte. Throws `no-<name>-block` when the block is missing (callers map this to a 400).
function editBlockLine(text, name, key, value) {
  const s = String(text);
  const b = blockBounds(s, name);
  if (!b) throw new Error('no-' + name + '-block');
  const body = s.slice(b.headEnd, b.bodyEnd);
  // Function replacement, so a `$1`/`$&` inside `value` is written literally rather than expanded.
  const edited = lineRe(key).test(body)
    ? body.replace(lineRe(key), (_m, head) => head + ': ' + value)
    : '\n  ' + key + ': ' + value + body;
  return s.slice(0, b.headEnd) + edited + s.slice(b.bodyEnd);
}

// The counterpart to editBlockLine — drop `key:` from a top-level block. Clearing a key (or a block)
// that isn't there is a NO-OP returning the text byte-for-byte, deliberately NOT an error: the
// Cockpit's blank budget field means "no spend guard", and blanking an already-absent budget must
// not fail the save.
function removeBlockLine(text, name, key) {
  const s = String(text);
  const b = blockBounds(s, name);
  if (!b) return s;
  const body = s.slice(b.headEnd, b.bodyEnd);
  const dropRe = new RegExp('^[ \\t]+' + key + ':.*\\n?', 'm');
  if (!dropRe.test(body)) return s;
  return s.slice(0, b.headEnd) + body.replace(dropRe, '') + s.slice(b.bodyEnd);
}

module.exports = { block, blockScalar, blockHasTrue, editBlockLine, removeBlockLine };
