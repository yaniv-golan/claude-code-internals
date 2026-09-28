'use strict';

/**
 * build.test.js — build.js derives lesson bounds and counts, and validates the
 * indexes. The integration cases run against a scratch COPY of the skill
 * directory: node --test runs test files in parallel processes, and other
 * tests read the real indexes while these run.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..');
const SKILL_DIR = path.join(SCRIPTS, '..');
const BUILD = path.join(SCRIPTS, 'build.js');
const B = require('../build.js');

function run(args) {
  try {
    return { code: 0, out: execFileSync('node', [BUILD, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const SCRATCH = [];
test.after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-build-'));
  SCRATCH.push(dir);
  const refs = path.join(dir, 'references');
  fs.mkdirSync(refs);
  const src = path.join(SKILL_DIR, 'references');
  for (const f of fs.readdirSync(src)) {
    if (/^\d\d-.*\.md$/.test(f) || /^(topic-index|cross-references|troubleshooting|semantic-index)\.json$/.test(f)) {
      fs.copyFileSync(path.join(src, f), path.join(refs, f));
    }
  }
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

// --- integration on a scratch copy ------------------------------------------------

test('an inserted line makes --check fail, and a write makes it pass again', () => {
  const dir = fixture();
  const file = path.join(dir, 'references', '21-cowork-control-protocol.md');
  editLines(file, (l) => [l[0], 'an inserted preamble line', ...l.slice(1)]);

  const stale = run(['--check', '--root', dir]);
  assert.strictEqual(stale.code, 1, `expected --check to fail:\n${stale.out}`);
  assert.match(stale.out, /lesson 107 startLine \d+, expected \d+/);
  assert.match(stale.out, /semantic-index\.json entry 107/);

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

test('a reference to a missing lesson id fails validation', () => {
  const dir = fixture();
  const ts = path.join(dir, 'references', 'troubleshooting.json');
  const raw = fs.readFileSync(ts, 'utf8');
  fs.writeFileSync(ts, raw.replace(/"lessons": \[\n(\s*)/, '"lessons": [\n$19999,\n$1'));
  const r = run(['--check', '--root', dir]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /troubleshooting\.json symptoms\[0\] references missing lesson 9999/);
});

// --- unit: scanner, trim rule, coverage -------------------------------------------

const scan = (text) => B.scanLines(text);

test('headings inside ``` and ~~~ fences are not lesson headings', () => {
  const s = scan(['# LESSON 1: real', '```md', '# LESSON 2: fake', '```', '~~~~', '# LESSON 3: fake', '~~~', 'still fenced', '~~~~', '## Lesson 4: real'].join('\n'));
  const h = B.findHeadings(s.lines, s.inFence).headings;
  assert.deepStrictEqual(h.map((x) => [x.line, x.number]), [[1, 1], [10, 4]]);
});

test('a parenthesised "(Lesson N)" is the heading\'s lesson number', () => {
  const s = scan('# LESSON 5: Permissions System (Lesson 06)');
  assert.strictEqual(B.findHeadings(s.lines, s.inFence).headings[0].number, 6);
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
