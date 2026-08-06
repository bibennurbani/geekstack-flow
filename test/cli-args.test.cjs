// CLI argument parsing — the flag surface users hit first.
//
// Regression origin: `geekstackflow --version` was not a recognised flag, and the parser
// treated any unrecognised token as the *target directory*. So `--version` resolved to a
// path and init began scaffolding a workspace into a folder literally named `--version`.
// The same trap caught every typo (`--upgade`, `--forse`, …). Unknown dash-flags must be
// a hard error, never a path.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { parseArgs, TOOL_VERSION } = require('../init.js');

// parseArgs reads process.argv-shaped input: [node, script, ...rest]
const argv = (...rest) => ['node', 'init.js', ...rest];

test('--version and -v set the version flag and do not become a target path', () => {
  for (const flag of ['--version', '-v']) {
    const args = parseArgs(argv(flag));
    assert.strictEqual(args.version, true, `${flag} should set version`);
    assert.strictEqual(
      args.target,
      process.cwd(),
      `${flag} must leave target as cwd, not resolve to a directory named "${flag}"`,
    );
  }
});

test('TOOL_VERSION is a resolvable version string, so --version prints something real', () => {
  assert.match(String(TOOL_VERSION), /^\d+\.\d+\.\d+/);
});

test('--help and -h still work and are distinct from --version', () => {
  for (const flag of ['--help', '-h']) {
    const args = parseArgs(argv(flag));
    assert.strictEqual(args.help, true);
    assert.strictEqual(args.version, false);
  }
});

test('an unknown long flag is rejected instead of being read as the target directory', () => {
  assert.throws(
    () => parseArgs(argv('--upgade')), // deliberate typo for `--upgrade`
    /unknown option '--upgade'/,
    'a mistyped flag must fail loudly, not scaffold into ./--upgade',
  );
});

test('an unknown short flag is rejected too', () => {
  assert.throws(() => parseArgs(argv('-x')), /unknown option '-x'/);
});

test('the rejection message points at --help', () => {
  assert.throws(() => parseArgs(argv('--nope')), /geekstackflow --help/);
});

test('a bare -- ends flag parsing so a target path may start with a dash', () => {
  const args = parseArgs(argv('--', '-weird-dir'));
  assert.strictEqual(args.target, path.resolve('-weird-dir'));
  assert.strictEqual(args.version, false);
  assert.strictEqual(args.help, false);
});

test('known flags are unaffected by the unknown-flag guard', () => {
  const args = parseArgs(argv('upgrade', '--force', '--yes', '/tmp/somewhere'));
  assert.strictEqual(args.upgrade, true);
  assert.strictEqual(args.force, true);
  assert.strictEqual(args.yes, true);
  assert.strictEqual(args.target, path.resolve('/tmp/somewhere'));
});

test('--port still consumes its value rather than tripping the guard', () => {
  const args = parseArgs(argv('ui', '--port', '5000'));
  assert.strictEqual(args.ui, true);
  assert.strictEqual(args.port, 5000);
});

test('--migrate-from still consumes its path argument', () => {
  const args = parseArgs(argv('--migrate-from', '/tmp/old-infra', '/tmp/target'));
  assert.strictEqual(args.migrateFrom, path.resolve('/tmp/old-infra'));
  assert.strictEqual(args.target, path.resolve('/tmp/target'));
});

test('a positional target is still resolved normally', () => {
  const args = parseArgs(argv('/tmp/proj'));
  assert.strictEqual(args.target, path.resolve('/tmp/proj'));
});

test('`pr` takes the positional as the TASK-ID, not as a target dir', () => {
  const args = parseArgs(argv('pr', 'ES-1234', '--yes'));
  assert.strictEqual(args.pr, true);
  assert.strictEqual(args.prTask, 'ES-1234');
  assert.strictEqual(args.yes, true);
});
