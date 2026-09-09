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
  const m = block(text, name).match(new RegExp('^[ \\t]+' + key + ':[ \\t]*(?!#)(\\S+)', 'm'));
  return m ? m[1].trim() : fallback;
}

// Whether a block contains `key: true` — the idiom for the orchestrator's boolean toggles.
function blockHasTrue(text, name, key) {
  return new RegExp('^[ \\t]+' + key + ':[ \\t]*true', 'm').test(block(text, name));
}

// A `key:` line inside a block, captured as head (indent + key) / value-region / trailing comment.
// Indent-anchored (`[ \t]`, never `\s`) so the match can't start on the line above by swallowing a
// newline, and COMMENT-AWARE: the config's trailing comments are aligned with runs of spaces, so a
// value pattern allowed to reach the `#` would eat the comment marker on a line whose value is
// blank and splice the comment text into the value.
const lineRe = (key) => new RegExp('^([ \\t]+' + key + '):([^#\\r\\n]*)(#[^\\r\\n]*)?(\\r?)$', 'm');

// The indentation a block's body actually uses, so an inserted line matches its neighbours instead
// of hard-coding two spaces (mixed indentation inside one mapping is not valid YAML).
function bodyIndent(body) {
  const m = body.match(/^([ \t]+)\S/m);
  return m ? m[1] : '  ';
}

// Surgically set `key: value` inside a top-level block: replace the line if present, else insert it
// right after the block header. Everything else — comments included — is kept byte-for-byte, and a
// trailing comment keeps the whitespace that aligns it. Throws `no-<name>-block` when the block is
// missing (callers map this to a 400).
function editBlockLine(text, name, key, value) {
  const s = String(text);
  const b = blockBounds(s, name);
  if (!b) throw new Error('no-' + name + '-block');
  const body = s.slice(b.headEnd, b.bodyEnd);
  let edited;
  if (lineRe(key).test(body)) {
    // A function replacement, so a `$1`/`$&` inside `value` is written literally, not expanded.
    edited = body.replace(lineRe(key), (_m, head, mid, comment, cr) => {
      // `mid` is the old value plus the run of spaces that aligns any trailing comment; keep that
      // run byte-for-byte so the comment stays where the author put it.
      const pad = comment ? (mid.match(/[ \t]*$/) || [''])[0] : '';
      return head + ': ' + value + pad + (comment || '') + cr;
    });
  } else {
    const nl = /\r\n/.test(s) ? '\r\n' : '\n'; // never mix line endings into a CRLF file
    edited = nl + bodyIndent(body) + key + ': ' + value + body;
  }
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
  const dropRe = new RegExp('^[ \\t]+' + key + ':[^\\r\\n]*\\r?\\n?', 'm');
  if (!dropRe.test(body)) return s;
  return s.slice(0, b.headEnd) + body.replace(dropRe, '') + s.slice(b.bodyEnd);
}

// The `roles:` sub-block inside `orchestrator:` — where its entries start and end, and the indent
// they use. The role map is the one setting nested two levels deep, so it can't use editBlockLine
// (which writes at the block's own indent); this gives its writer the same scoped, indent-derived
// footing. null when there is no `roles:` sub-block to write into.
function orchestratorRolesBounds(text) {
  const s = String(text);
  const b = blockBounds(s, 'orchestrator');
  if (!b) return null;
  const body = s.slice(b.headEnd, b.bodyEnd);
  const header = body.match(/^([ \t]+)roles:[ \t]*(?:#[^\r\n]*)?\r?$/m);
  if (!header) return null;
  const start = b.headEnd + header.index + header[0].length + 1; // just past the `roles:` line
  const after = s.slice(start, b.bodyEnd);
  // The entries are the lines indented DEEPER than `roles:` itself; a shallower line is a sibling
  // key (`pr:`, `isolation:`) and ends the sub-block.
  const stop = after.search(new RegExp('^(?![ \\t]{' + (header[1].length + 1) + ',})', 'm'));
  const entries = stop >= 0 ? after.slice(0, stop) : after;
  const firstEntry = entries.match(/^([ \t]+)\S/m);
  return {
    start,
    end: stop >= 0 ? start + stop : b.bodyEnd,
    indent: firstEntry ? firstEntry[1] : header[1] + '  ',
  };
}

module.exports = { block, blockScalar, blockHasTrue, editBlockLine, removeBlockLine, orchestratorRolesBounds };
