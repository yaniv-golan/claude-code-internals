'use strict';

/**
 * routing.test.js — the generated routing files (references/routing/, and the
 * state pages' read_more: field) are what the model reads instead of running
 * a search script, so they are checked against the files they point into, not
 * against build.js's own arithmetic:
 *   - SIZE: every index part, every lesson range or sub-range the index points
 *     at, and every state-page section sections.md lists fits one Read
 *     (READ_BUDGET, 48 KB);
 *   - INDEX: one line per lesson, starting on its LESSON heading, with its
 *     Lesson N and asks;
 *   - SECTIONS: every entry names a heading line with that text, and every
 *     heading is listed;
 *   - READ-MORE: every URL equals what fetch-lesson.js / state.js print today.
 * build.test.js's "--check passes on the committed tree" covers staleness.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SKILL_DIR = path.resolve(__dirname, '..', '..');
const REFS = path.join(SKILL_DIR, 'references');
const ROUTING = path.join(REFS, 'routing');
const { READ_BUDGET, MIN_ASKS, ASKS_PER_LESSON, scanLines, headingsIn } = require('../build.js');
const { loadSiteLinks, lessonFooter, LABEL } = require('../site-links.js');
const { siteFooter, lookup } = require('../state.js');
const { parseFrontmatter } = require('../validate-state.js');
const { proposalsPath } = require('../lib/vocab.js');

const topic = JSON.parse(fs.readFileSync(path.join(REFS, 'topic-index.json'), 'utf8'));
const byId = new Map(topic.lessons.map((l) => [l.id, l]));
const fileCache = new Map();
const linesOf = (rel) => {
  if (!fileCache.has(rel)) fileCache.set(rel, fs.readFileSync(path.join(REFS, rel), 'utf8').split('\n'));
  return fileCache.get(rel);
};
const bytes = (rel, start, end) => Buffer.byteLength(linesOf(rel).slice(start - 1, end).join('\n'), 'utf8');
const parts = fs.readdirSync(ROUTING).filter((f) => /^index-\d+\.md$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const statePages = fs.readdirSync(path.join(REFS, 'state')).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
const stripLabel = (lines) => lines.map((l) => l.slice(LABEL.length + 1));

/** The index, parsed: [{id, fields: {title, lessonN, file, start, end, description, asks, readMore}, subs: [{file,start,end,label}]}]. */
function parseIndex() {
  const out = [];
  for (const f of parts) {
    for (const line of fs.readFileSync(path.join(ROUTING, f), 'utf8').split('\n')) {
      const sub = line.match(/^ {4}↳ (\S+):(\d+)-(\d+) · (.+)$/);
      if (sub) { out[out.length - 1].subs.push({ file: sub[1], start: Number(sub[2]), end: Number(sub[3]), label: sub[4] }); continue; }
      if (!/^\d+ · /.test(line)) continue;
      const segs = line.split(' · ');
      const loc = segs[3].match(/^(\S+):(\d+)-(\d+)$/);
      const rest = segs.slice(4);
      const asks = rest.find((s) => s.startsWith('asks: '));
      const readMore = rest.find((s) => s.startsWith('read-more: '));
      const description = rest.find((s) => s !== asks && s !== readMore) || null;
      out.push({
        id: Number(segs[0]), part: f, line,
        fields: {
          title: segs[1], lessonN: segs[2], file: loc && loc[1], start: loc && Number(loc[2]), end: loc && Number(loc[3]),
          description, asks: asks ? asks.slice(6).split('; ') : [], readMore: readMore ? readMore.slice(11).split(', ') : [],
        },
        subs: [],
      });
    }
  }
  return out;
}
const index = parseIndex();

/** sections.md, parsed: [{key, file, line, text}]. */
const sections = fs.readFileSync(path.join(ROUTING, 'sections.md'), 'utf8').split('\n')
  .map((l) => l.match(/^(\d+|state:[a-z0-9-]+) · (\S+):(\d+) · (.+)$/)).filter(Boolean)
  .map((m) => ({ key: m[1], file: m[2], line: Number(m[3]), text: m[4] }));

// --- SIZE ---------------------------------------------------------------------------

test('every index part fits one Read', () => {
  assert.ok(parts.length >= 1);
  for (const f of parts) {
    const n = fs.statSync(path.join(ROUTING, f)).size;
    assert.ok(n <= READ_BUDGET, `${f} is ${n} bytes, over ${READ_BUDGET}`);
  }
});

test('every lesson range the index points at fits one Read, or its sub-ranges do and tile it', () => {
  for (const e of index) {
    const { file, start, end } = e.fields;
    if (!e.subs.length) {
      assert.ok(bytes(file, start, end) <= READ_BUDGET, `lesson ${e.id} ${file}:${start}-${end} is ${bytes(file, start, end)} bytes and has no sub-ranges`);
      continue;
    }
    assert.ok(bytes(file, start, end) > READ_BUDGET, `lesson ${e.id} fits one Read but lists sub-ranges`);
    assert.strictEqual(e.subs[0].start, start, `lesson ${e.id}: first sub-range starts at the lesson`);
    assert.strictEqual(e.subs[e.subs.length - 1].end, end, `lesson ${e.id}: last sub-range ends at the lesson`);
    e.subs.forEach((s, i) => {
      assert.strictEqual(s.file, file);
      if (i) assert.strictEqual(s.start, e.subs[i - 1].end + 1, `lesson ${e.id}: sub-ranges are contiguous`);
      assert.ok(bytes(file, s.start, s.end) <= READ_BUDGET, `lesson ${e.id} sub-range ${s.start}-${s.end} is ${bytes(file, s.start, s.end)} bytes`);
    });
  }
});

test('every state-page section listed in sections.md fits one Read', () => {
  for (const f of statePages) {
    const rel = `state/${f}`;
    const lines = linesOf(rel);
    const { inFence } = scanLines(lines.join('\n'));
    const heads = headingsIn(lines, inFence, 1, lines.length);
    for (const s of sections.filter((x) => x.file === rel)) {
      const i = heads.findIndex((h) => h.line === s.line);
      const next = heads.slice(i + 1).find((h) => h.level <= heads[i].level);
      const end = next ? next.line - 1 : lines.length;
      assert.ok(bytes(rel, s.line, end) <= READ_BUDGET, `${rel}:${s.line}-${end} "${s.text}" is ${bytes(rel, s.line, end)} bytes`);
    }
  }
});

// --- INDEX --------------------------------------------------------------------------

test('every lesson has exactly one index line, in id order, starting on its LESSON heading', () => {
  assert.deepStrictEqual(index.map((e) => e.id), [...byId.keys()].sort((a, b) => a - b));
  for (const e of index) {
    const l = byId.get(e.id);
    const { file, start, end, title, lessonN } = e.fields;
    assert.strictEqual(file, l.file, `lesson ${e.id} file`);
    assert.strictEqual(start, l.startLine, `lesson ${e.id} start`);
    assert.strictEqual(end, l.endLine, `lesson ${e.id} end`);
    assert.match(linesOf(file)[start - 1], /^#{1,4}\s*LESSON\s+\d+/i, `lesson ${e.id}: ${file}:${start} is not a LESSON heading`);
    assert.strictEqual(title, l.title.replace(/\s+/g, ' ').trim());
    assert.strictEqual(lessonN, `Lesson ${l.lesson_number}`, `lesson ${e.id}: Lesson N`);
    // ...and a numeric N is the one the heading carries ("LESSON N", or a legacy "(Lesson N)").
    // A word N (legacy lessons numbered within their file) has no number to compare.
    const n = lessonN.slice('Lesson '.length);
    const heading = linesOf(file)[start - 1];
    if (/^\d+$/.test(n)) {
      assert.match(heading, new RegExp(`LESSON\\s+0*${Number(n)}\\b|\\(Lesson\\s+0*${Number(n)}\\)`, 'i'),
        `lesson ${e.id}: heading does not carry ${lessonN}`);
    }
    assert.strictEqual(e.fields.description, l.description ? l.description.replace(/\s+/g, ' ').trim() : null);
  }
});

test(`every lesson line carries at least ${MIN_ASKS} asks, the first ${ASKS_PER_LESSON} frozen vocabulary terms`, (t) => {
  const pAbs = proposalsPath(SKILL_DIR);
  const proposals = fs.existsSync(pAbs) ? JSON.parse(fs.readFileSync(pAbs, 'utf8')).lessons : null;
  for (const e of index) {
    assert.ok(e.fields.asks.length >= MIN_ASKS, `lesson ${e.id} has ${e.fields.asks.length} asks`);
    if (proposals) {
      const want = proposals[e.id].terms.slice(0, ASKS_PER_LESSON).map((s) => s.replace(/\s+/g, ' ').trim().replace(/\|/g, '/'));
      assert.deepStrictEqual(e.fields.asks, want, `lesson ${e.id} asks`);
    }
  }
  if (!proposals) t.diagnostic('data/vocab-proposals.json not present: asks checked for count only');
});

// --- SECTIONS -----------------------------------------------------------------------

test('every sections.md entry names a heading line with that text, inside its lesson or state page', () => {
  assert.ok(sections.length > 0);
  for (const s of sections) {
    const line = linesOf(s.file)[s.line - 1];
    assert.match(line, /^#{2,4}\s/, `${s.file}:${s.line} is not a ##-#### heading`);
    assert.strictEqual(line.replace(/^#+\s+/, '').trimEnd(), s.text, `${s.file}:${s.line}`);
    if (s.key.startsWith('state:')) {
      assert.strictEqual(s.file, `state/${s.key.slice(6)}.md`);
    } else {
      const l = byId.get(Number(s.key));
      assert.ok(l && l.file === s.file && s.line >= l.startLine && s.line <= l.endLine, `${s.key} · ${s.file}:${s.line} is outside lesson ${s.key}`);
    }
  }
});

test('sections.md lists every ##-#### heading of every lesson and state page', () => {
  const want = [];
  for (const l of [...topic.lessons].sort((a, b) => a.id - b.id)) {
    const lines = linesOf(l.file);
    const { inFence } = scanLines(lines.join('\n'));
    for (const h of headingsIn(lines, inFence, l.startLine, l.endLine)) if (h.level >= 2 && h.level <= 4) want.push(`${l.id} ${l.file}:${h.line}`);
  }
  for (const f of statePages) {
    const lines = linesOf(`state/${f}`);
    const { inFence } = scanLines(lines.join('\n'));
    for (const h of headingsIn(lines, inFence, 1, lines.length)) if (h.level >= 2 && h.level <= 4) want.push(`state:${f.slice(0, -3)} state/${f}:${h.line}`);
  }
  assert.deepStrictEqual(sections.map((s) => `${s.key} ${s.file}:${s.line}`), want);
});

// --- READ-MORE ----------------------------------------------------------------------

const links = loadSiteLinks(REFS);

test('every lesson\'s read-more equals the footer fetch-lesson.js prints for it (site-links.js lessonFooter)', () => {
  assert.ok(links, 'site-links.json loads');
  let linked = 0;
  for (const e of index) {
    const r = lessonFooter(links, byId.get(e.id));
    assert.strictEqual(r.error, null, `lesson ${e.id}: ${r.error}`);
    assert.deepStrictEqual(e.fields.readMore, stripLabel(r.lines), `lesson ${e.id}`);
    if (r.lines.length) linked++;
  }
  assert.ok(linked > 0, 'no lesson carries a read-more link');
});

test('the read-more URLs are the literal fetch-lesson.js footer output (every linked lesson, and two unlinked)', () => {
  const linked = index.filter((e) => e.fields.readMore.length);
  const unlinked = index.filter((e) => !e.fields.readMore.length).slice(0, 2);
  for (const e of [...linked, ...unlinked]) {
    const out = execFileSync('node', [path.join(SKILL_DIR, 'scripts', 'fetch-lesson.js'), String(e.id)], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const footer = out.split('\n').filter((l) => l.startsWith(`${LABEL} `));
    assert.deepStrictEqual(e.fields.readMore, stripLabel(footer), `lesson ${e.id}`);
  }
});

test('every state page\'s read_more: equals the footer state.js prints for that page', () => {
  let linked = 0;
  for (const f of statePages) {
    const fm = parseFrontmatter(fs.readFileSync(path.join(REFS, 'state', f), 'utf8'));
    const want = stripLabel(siteFooter(REFS, { pages: [{ domain: fm.domain }] }));
    assert.deepStrictEqual(fm.read_more || [], want, f);
    if (want.length) { linked++; assert.ok(Array.isArray(fm.read_more), `${f}: read_more parses as a list`); }
    // Where a query for the domain finds this page alone, the CLI's literal output agrees too.
    if (lookup(REFS, fm.domain).pages.length === 1) {
      const out = execFileSync('node', [path.join(SKILL_DIR, 'scripts', 'state.js'), fm.domain], { encoding: 'utf8', maxBuffer: 64 << 20 });
      assert.deepStrictEqual(stripLabel(out.split('\n').filter((l) => l.startsWith(`${LABEL} `))), want, `state.js ${fm.domain}`);
    }
  }
  assert.ok(linked > 0, 'no state page carries read_more');
});
