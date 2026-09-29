'use strict';

/**
 * build.test.js — build.js derives lesson bounds and counts, and validates the
 * indexes. The integration cases run against a scratch COPY of the skill
 * directory: node --test runs test files in parallel processes, and other
 * tests read the real indexes while these run.
 */

const nodeTest = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..');
const SKILL_DIR = path.join(SCRIPTS, '..');
const BUILD = path.join(SCRIPTS, 'build.js');
const B = require('../build.js');
const { parseOrdered, emit } = require('../check-json-format.js');
const { proposalsPath } = require('../lib/vocab.js');

// The vocabulary proposals (data/ at the repository root) are a build input, not part of the
// shipped skill zip; there build.js --check cannot re-derive the vocabulary keys, so every case skips.
const test = fs.existsSync(proposalsPath(SKILL_DIR)) ? nodeTest
  : Object.assign((name, fn) => nodeTest(name, { skip: 'data/vocab-proposals.json not present (the shipped skill package zip)' }, fn), { after: nodeTest.after });

function run(args) {
  try {
    return { code: 0, out: execFileSync('node', [BUILD, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const SCRATCH = [];
test.after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });
/** A scratch repository layout: <root>/skill-package/skills/claude-code-internals (returned) and <root>/data. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-build-'));
  SCRATCH.push(root);
  const dir = path.join(root, 'skill-package', 'skills', 'claude-code-internals');
  const refs = path.join(dir, 'references');
  fs.mkdirSync(refs, { recursive: true });
  const src = path.join(SKILL_DIR, 'references');
  for (const f of fs.readdirSync(src)) {
    // catalog.md is a derived output, but copy it so a fixture that changes
    // nothing catalog depends on still sees a clean --check (it is regenerated
    // by any write, and reported stale by any edit that does touch it).
    if (/^\d\d-.*\.md$/.test(f) || f === 'catalog.md' || /^(topic-index|hand-keywords|cross-references|troubleshooting)\.json$/.test(f)) {
      fs.copyFileSync(path.join(src, f), path.join(refs, f));
    }
  }
  // prepare-lessons.js --check (run by build.js --check) derives vocabulary keys from the proposals.
  fs.mkdirSync(path.dirname(proposalsPath(dir)));
  fs.copyFileSync(proposalsPath(SKILL_DIR), proposalsPath(dir));
  fs.copyFileSync(path.join(SKILL_DIR, 'version.json'), path.join(dir, 'version.json'));
  return dir;
}
const editLines = (file, fn) => {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  fs.writeFileSync(file, fn(lines).join('\n'));
};
const topicOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'references', 'topic-index.json'), 'utf8'));

// --- the committed tree ---------------------------------------------------------

test('--check passes on the committed tree', () => {
  const r = run(['--check']);
  assert.strictEqual(r.code, 0, `build.js --check failed:\n${r.out}`);
  assert.match(r.out, /derived fields OK/);
});

test('the committed version.json counts are the derived ones', () => {
  const d = B.build(SKILL_DIR);
  assert.deepStrictEqual(d.errors, []);
  const v = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'version.json'), 'utf8'));
  assert.strictEqual(v.lessons_count, d.lessonsCount);
  assert.strictEqual(v.chapters_count, d.chaptersCount);
});

test('references/catalog.md is the committed derived routing table', () => {
  const catalog = fs.readFileSync(path.join(SKILL_DIR, 'references', 'catalog.md'), 'utf8');
  const topic = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'references', 'topic-index.json'), 'utf8'));
  // No line may be a "# Chapter N" heading: release-consistency scans every .md
  // in references/ for those to count chapters.
  assert.doesNotMatch(catalog, /^#\s*Chapter\s+\d+/m, 'catalog.md carries a "# Chapter N" heading');
  // A row per reference file that owns at least one lesson, with its id range.
  const files = [...new Set(topic.lessons.map((l) => l.file))];
  for (const f of files) {
    const ids = topic.lessons.filter((l) => l.file === f).map((l) => l.id);
    const range = Math.min(...ids) === Math.max(...ids) ? String(ids[0]) : `${Math.min(...ids)}–${Math.max(...ids)}`;
    assert.ok(catalog.includes(`\`${f}\``), `catalog.md has no row for ${f}`);
    assert.ok(catalog.includes(`| ${range} |`), `catalog.md is missing the id range ${range} for ${f}`);
  }
});

test('an edited lesson title makes catalog.md stale, and a write fixes it', () => {
  const dir = fixture();
  const ti = path.join(dir, 'references', 'topic-index.json');
  const raw = fs.readFileSync(ti, 'utf8');
  fs.writeFileSync(ti, raw.replace('"Hooks System"', '"Hooks System (renamed)"'));
  const stale = run(['--check', '--root', dir]);
  assert.strictEqual(stale.code, 1, stale.out);
  assert.match(stale.out, /catalog\.md: routing table is stale/);
  assert.strictEqual(run(['--root', dir]).code, 0);
  assert.strictEqual(run(['--check', '--root', dir]).code, 0);
});

// --- integration on a scratch copy ------------------------------------------------

test('an inserted line makes --check fail, and a write makes it pass again', () => {
  const dir = fixture();
  const file = path.join(dir, 'references', '21-cowork-control-protocol.md');
  editLines(file, (l) => [l[0], 'an inserted preamble line', ...l.slice(1)]);

  const stale = run(['--check', '--root', dir]);
  assert.strictEqual(stale.code, 1, `expected --check to fail:\n${stale.out}`);
  assert.match(stale.out, /lesson 107 startLine \d+, expected \d+/);
  assert.match(stale.out, /lesson 107 endLine \d+, expected \d+/);

  const before = topicOf(dir).lessons.find((l) => l.id === 107);
  const w = run(['--root', dir]);
  assert.strictEqual(w.code, 0, w.out);
  const after = topicOf(dir).lessons.find((l) => l.id === 107);
  assert.strictEqual(after.startLine, before.startLine + 1);
  assert.strictEqual(after.endLine, before.endLine + 1);

  const again = run(['--check', '--root', dir]);
  assert.strictEqual(again.code, 0, `--check after write:\n${again.out}`);
});

test('a fenced fake "# LESSON" heading is ignored by the build', () => {
  const dir = fixture();
  const file = path.join(dir, 'references', '21-cowork-control-protocol.md');
  const start = topicOf(dir).lessons.find((l) => l.id === 107).startLine;
  editLines(file, (l) => [...l.slice(0, start), '```', '# LESSON 999: not a lesson', '```', ...l.slice(start)]);
  const d = B.build(dir);
  assert.deepStrictEqual(d.errors, []);
  assert.strictEqual(d.bounds.get(107).startLine, start);
});

test('an unindexed lesson heading fails validation', () => {
  const dir = fixture();
  const file = path.join(dir, 'references', '21-cowork-control-protocol.md');
  editLines(file, (l) => [...l, '', '# LESSON 999: a heading nobody indexed', 'body']);
  const r = run(['--check', '--root', dir]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /LESSON 999.*claimed by 0 lessons/);
});

test('a non-string lesson description fails validation', () => {
  const dir = fixture();
  const ti = path.join(dir, 'references', 'topic-index.json');
  const raw = fs.readFileSync(ti, 'utf8');
  fs.writeFileSync(ti, raw.replace(/("description": )"[^"]*"/, '$142'));
  const r = run(['--check', '--root', dir]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /lesson 1 description must be a string/);
});

test('a reference to a missing lesson id fails validation', () => {
  const dir = fixture();
  const ts = path.join(dir, 'references', 'troubleshooting.json');
  const raw = fs.readFileSync(ts, 'utf8');
  fs.writeFileSync(ts, raw.replace(/"lessons": \[\n(\s*)/, '"lessons": [\n$19999,\n$1'));
  const r = run(['--check', '--root', dir]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /troubleshooting\.json symptoms\[0\] references missing lesson 9999/);
});

const LAST_FILE = '21-cowork-control-protocol.md';

test('a fence left open at EOF fails validation, naming the file and line', () => {
  const dir = fixture();
  const file = path.join(dir, 'references', LAST_FILE);
  const n = fs.readFileSync(file, 'utf8').split('\n').length;
  fs.appendFileSync(file, '\n```js\nconst x = 1;\n\n---\n');
  const r = run(['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`${LAST_FILE.replace(/\./g, '\\.')}:${n + 1} opens a code fence that is never closed`));
});

test('a "(Lesson N)" cross-reference in a modern heading does not renumber it', () => {
  const dir = fixture();
  const file = path.join(dir, 'references', LAST_FILE);
  const start = topicOf(dir).lessons.find((l) => l.id === 107).startLine;
  editLines(file, (l) => { l[start - 1] += ' (Lesson 5)'; return l; });
  const r = run(['--check', '--root', dir]);
  assert.strictEqual(r.code, 0, r.out);
});

test('a new lesson entry without startLine/endLine gets them at the canonical position', () => {
  const dir = fixture();
  const ti = path.join(dir, 'references', 'topic-index.json');
  const file = path.join(dir, 'references', LAST_FILE);
  const topic = topicOf(dir);
  const newId = Math.max(...topic.lessons.map((l) => l.id)) + 1;
  const newNum = Math.max(...topic.lessons.map((l) => Number(l.lesson_number) || 0)) + 1;
  fs.appendFileSync(file, `\n---\n\n# LESSON ${newNum} — A brand new lesson\n\nbody text\n`);
  const headingLine = fs.readFileSync(file, 'utf8').split('\n').indexOf(`# LESSON ${newNum} — A brand new lesson`) + 1;
  // Append through the order-preserving parser: keyword_map has integer-like
  // keys that a JSON.parse/stringify round trip would reorder.
  const tree = parseOrdered(fs.readFileSync(ti, 'utf8'));
  const lessons = tree.entries.find(([k]) => k === '"lessons"')[1];
  lessons.items.push(parseOrdered(JSON.stringify({ id: newId, title: 'A brand new lesson', lesson_number: newNum, file: LAST_FILE, keywords: [] })));
  fs.writeFileSync(ti, emit(tree, 2) + '\n');

  const stale = run(['--check', '--root', dir]);
  assert.strictEqual(stale.code, 1, stale.out);
  assert.match(stale.out, new RegExp(`lesson ${newId} startLine undefined, expected ${headingLine}`));

  const w = run(['--root', dir]);
  assert.strictEqual(w.code, 0, w.out);
  const raw = fs.readFileSync(ti, 'utf8');
  assert.strictEqual(raw, emit(parseOrdered(raw), 2) + '\n', 'topic-index.json is not in canonical form after the write');
  const after = JSON.parse(raw).lessons;
  const added = after.find((l) => l.id === newId);
  assert.deepStrictEqual(Object.keys(added), ['id', 'title', 'lesson_number', 'file', 'startLine', 'endLine', 'keywords']);
  // identifier_keys, vocab_keys and vocab are prepare-lessons.js's records, appended after the hand-written fields.
  assert.deepStrictEqual(Object.keys(added), Object.keys(after.find((l) => l.id === 107)).filter((k) => !['identifier_keys', 'vocab_keys', 'vocab'].includes(k)));
  assert.strictEqual(added.startLine, headingLine);
  assert.strictEqual(added.endLine, headingLine + 2);
  assert.strictEqual(JSON.parse(raw).total_lessons, topic.lessons.length + 1);
  // The bounds now check; what is left is the new lesson's vocabulary, which needs a model call.
  const check = run(['--check', '--root', dir]);
  assert.strictEqual(check.code, 1, check.out);
  assert.ok(check.out.includes(`1 lesson(s) have no vocabulary proposals in data/vocab-proposals.json (${newId})`), check.out);
  assert.match(check.out, /prepare-lessons\.js --generate/);
  assert.doesNotMatch(check.out, /startLine|endLine|total_lessons/);
});

test('version.json missing lessons_count/chapters_count gets them after captured_date', () => {
  const dir = fixture();
  const vp = path.join(dir, 'version.json');
  const tree = parseOrdered(fs.readFileSync(vp, 'utf8'));
  const keys0 = tree.entries.map(([k]) => k);
  tree.entries = tree.entries.filter(([k]) => k !== '"lessons_count"' && k !== '"chapters_count"');
  fs.writeFileSync(vp, emit(tree, 2) + '\n');
  const w = run(['--root', dir]);
  assert.strictEqual(w.code, 0, w.out);
  assert.deepStrictEqual(parseOrdered(fs.readFileSync(vp, 'utf8')).entries.map(([k]) => k), keys0);
  assert.strictEqual(run(['--check', '--root', dir]).code, 0);
});

test('stored bounds that leave content uncovered fail --check with a coverage message', () => {
  const dir = fixture();
  const ti = path.join(dir, 'references', 'topic-index.json');
  const raw = fs.readFileSync(ti, 'utf8');
  const l107 = topicOf(dir).lessons.find((l) => l.id === 107);
  // Cut lesson 107 short by ten lines: those lines now belong to no lesson.
  const re = new RegExp(`("startLine": ${l107.startLine},\\s*"endLine": )${l107.endLine}`);
  assert.match(raw, re);
  fs.writeFileSync(ti, raw.replace(re, `$1${l107.endLine - 10}`));
  const r = run(['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /line\(s\) not covered exactly once by the stored bounds/);
  assert.match(r.out, new RegExp(`stored bounds: ${LAST_FILE.replace(/\./g, '\\.')}:\\d+ belongs to no lesson`));
});

test('an input edited while the build runs aborts the write, and nothing is written', () => {
  const dir = fixture();
  const file = path.join(dir, 'references', LAST_FILE);
  editLines(file, (l) => [l[0], 'an inserted preamble line', ...l.slice(1)]); // make outputs stale
  const ti = path.join(dir, 'references', 'topic-index.json');
  const tiBefore = fs.readFileSync(ti, 'utf8');
  const d = B.build(dir);
  assert.deepStrictEqual(d.errors, []);
  assert.ok(d.outputs.some((o) => o.text !== o.before), 'fixture should need a write');
  fs.appendFileSync(file, '\nedited by a peer mid-run\n');
  assert.throws(() => B.writeOutputs(d), (e) => e.code === 'EINPUTCHANGED' && e.message.includes(LAST_FILE));
  assert.strictEqual(fs.readFileSync(ti, 'utf8'), tiBefore, 'topic-index.json was written despite the abort');

  // A reference file appearing mid-run is a change too.
  const d2 = B.build(fixture());
  fs.writeFileSync(path.join(d2.refsDir, '99-new.md'), '# new\n');
  assert.deepStrictEqual(B.changedInputs(d2).length, 1);
});

test('writes are atomic: no temp files are left beside the outputs', () => {
  const dir = fixture();
  editLines(path.join(dir, 'references', LAST_FILE), (l) => [l[0], 'x', ...l.slice(1)]);
  assert.strictEqual(run(['--root', dir]).code, 0);
  for (const d of [dir, path.join(dir, 'references')]) {
    assert.deepStrictEqual(fs.readdirSync(d).filter((f) => f.endsWith('.tmp')), [], d);
  }
});

// --- unit: scanner, trim rule, coverage -------------------------------------------

const scan = (text) => B.scanLines(text);

test('headings inside ``` and ~~~ fences are not lesson headings', () => {
  const s = scan(['# LESSON 1: real', '```md', '# LESSON 2: fake', '```', '~~~~', '# LESSON 3: fake', '~~~', 'still fenced', '~~~~', '## Lesson 4: real'].join('\n'));
  const h = B.findHeadings(s.lines, s.inFence).headings;
  assert.deepStrictEqual(h.map((x) => [x.line, x.number]), [[1, 1], [10, 4]]);
});

test('in a legacy file a parenthesised "(Lesson N)" is the heading\'s lesson number', () => {
  const s = scan('# LESSON 5: Permissions System (Lesson 06)');
  assert.strictEqual(B.findHeadings(s.lines, s.inFence, { legacy: true }).headings[0].number, 6);
});

test('outside the legacy files a "(Lesson N)" in a heading is a cross-reference, not its number', () => {
  const s = scan('# LESSON 150 — follows on from hooks (Lesson 5)');
  assert.strictEqual(B.findHeadings(s.lines, s.inFence).headings[0].number, 150);
});

test('the scanner reports a fence left open at EOF, with its line', () => {
  assert.strictEqual(scan(['# LESSON 1', '```js', 'x', '```', 'y'].join('\n')).unclosedFence, null);
  assert.strictEqual(scan(['# LESSON 1', 'a', '```js', 'x', '', '---'].join('\n')).unclosedFence, 3);
  assert.strictEqual(scan(['~~~~', 'x', '~~~'].join('\n')).unclosedFence, 1); // a shorter fence does not close it
});

test('trim removes trailing blanks, one thematic break, and blanks again', () => {
  const cases = [
    [['# L', 'body', '', ''], 2],
    [['# L', 'body', '', '---', ''], 2],
    [['# L', 'body', '', '---'], 2],
    [['# L', 'body', '', '---', '', '---', ''], 4],          // only one break is trimmed
    [['# L', 'Setext title', '---', ''], 3],                 // setext underline is content
    [['# L', '| a |', '|---|', '---', ''], 4],               // no blank before: not a break
    [['# L', '```', 'x', '', '---', ''], 5],                 // unclosed fence: inside code
  ];
  for (const [lines, want] of cases) {
    const s = scan(lines.join('\n'));
    assert.strictEqual(B.trimEnd(s.lines, s.inFence, 1, s.lines.length), want, JSON.stringify(lines));
  }
});

test('the coverage invariant catches an uncovered content line and an overlap', () => {
  const s = scan(['preamble', '# LESSON 1', 'a', '', '---', '', '# LESSON 2', 'b', 'stray'].join('\n'));
  const ok = [{ id: 1, startLine: 2, endLine: 3 }, { id: 2, startLine: 7, endLine: 9 }];
  assert.deepStrictEqual(B.checkCoverage(s.lines, s.inFence, ok, 'f.md'), []);
  const gap = [{ id: 1, startLine: 2, endLine: 3 }, { id: 2, startLine: 7, endLine: 8 }];
  const p = B.checkCoverage(s.lines, s.inFence, gap, 'f.md');
  assert.strictEqual(p.length, 1);
  assert.match(p[0], /f\.md:9 belongs to no lesson: "stray"/);
  const overlap = [{ id: 1, startLine: 2, endLine: 7 }, { id: 2, startLine: 7, endLine: 9 }];
  assert.match(B.checkCoverage(s.lines, s.inFence, overlap, 'f.md')[0], /f\.md:7 is inside both lesson 1 and lesson 2/);
});
