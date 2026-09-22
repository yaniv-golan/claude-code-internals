'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CHECKER = path.join(__dirname, '..', 'check-json-format.js');
const REFS = path.join(__dirname, '..', '..', 'references');
const { parseOrdered, emit, PINNED } = require('../check-json-format.js');

function run(refsDir) {
  const env = refsDir ? { ...process.env, CHECK_JSON_FORMAT_REFS: refsDir } : process.env;
  try {
    return { code: 0, out: execFileSync('node', [CHECKER], { encoding: 'utf8', env }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// The mutation tests work on a COPY of references/. Mutating the real files raced
// with search-identifiers.test.js reading topic-index.json in a parallel process
// ('Unexpected end of JSON input' in CI, green locally by timing).
const SCRATCH = [];
test.after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });
function scratchRefs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-format-refs-'));
  SCRATCH.push(dir);
  fs.mkdirSync(path.join(dir, 'state'));
  for (const rel of Object.keys(PINNED)) fs.copyFileSync(path.join(REFS, rel), path.join(dir, rel));
  return dir;
}

// The checker must PASS on the repo as committed. If this fails, a file drifted.
test('every pinned index is canonical on disk', () => {
  const r = run();
  assert.strictEqual(r.code, 0, `checker failed:\n${r.out}`);
  assert.match(r.out, /json format OK/);
});

// CONTROLS. A checker that cannot fail is decoration, so each failure mode it
// exists for gets a case that must trip it.

test('order-preserving parser keeps integer-like keys in source order', () => {
  // This is the bug the checker exists for: JS hoists numeric keys to the
  // front. The ordered parser must not.
  const src = '{\n "129": 1,\n "aa": 2,\n "31999": 3\n}';
  const tree = parseOrdered(src);
  assert.deepStrictEqual(tree.entries.map(([k]) => k), ['"129"', '"aa"', '"31999"']);
  assert.strictEqual(emit(tree, 1), src);
  // and the naive round-trip the checker refuses to use would reorder them
  assert.notStrictEqual(JSON.stringify(JSON.parse(src), null, 1), src);
});

test('re-indenting a pinned file is caught', () => {
  const dir = scratchRefs();
  const abs = path.join(dir, 'topic-index.json');       // pinned indent=2
  const tree = parseOrdered(fs.readFileSync(abs, 'utf8'));
  fs.writeFileSync(abs, emit(tree, 1) + '\n', 'utf8');   // wrong indent, order intact
  const r = run(dir);
  assert.strictEqual(r.code, 1, 'checker did not fail on a re-indented file');
  assert.match(r.out, /topic-index\.json: not canonical/);
  assert.match(r.out, /indent=1/);
});

test('dropping the trailing newline is caught', () => {
  const dir = scratchRefs();
  const abs = path.join(dir, 'state', 'registry.json'); // pinned trailingNewline=true
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/\n$/, ''), 'utf8');
  const r = run(dir);
  assert.strictEqual(r.code, 1, 'checker did not fail on a missing trailing newline');
  assert.match(r.out, /registry\.json: not canonical/);
});

test('an unpinned json under references/ is an error', () => {
  const dir = scratchRefs();
  fs.writeFileSync(path.join(dir, '__format_probe.json'), '{}\n', 'utf8');
  const r = run(dir);
  assert.strictEqual(r.code, 1, 'checker did not fail on an unpinned file');
  assert.match(r.out, /__format_probe\.json: not pinned/);
});

test('a scratch copy of the real indexes passes, so the copy is faithful', () => {
  const r = run(scratchRefs());
  assert.strictEqual(r.code, 0, r.out);
});

test('every pinned entry names a file that exists', () => {
  for (const rel of Object.keys(PINNED)) {
    assert.ok(fs.existsSync(path.join(REFS, rel)), `${rel} pinned but missing`);
  }
});
