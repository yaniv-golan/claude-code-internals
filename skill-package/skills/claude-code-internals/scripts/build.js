#!/usr/bin/env node
/**
 * build.js — derives the fields that used to be hand-maintained, and validates
 * the indexes that point into the lesson files.
 *
 * DERIVED (written by default, compared by --check):
 *   references/topic-index.json   lessons[].startLine, lessons[].endLine, total_lessons
 *   version.json                  lessons_count, chapters_count
 * (The TF-IDF search index is not a file: search.js and semantic-search.js
 * derive it from topic-index.json at load time, see lib/tfidf-index.js.)
 * It also removes the `generated:` date stamps from topic-index.json,
 * cross-references.json and troubleshooting.json (nothing reads them, and a
 * stamp that changes on every edit only produces diff noise).
 *
 * BOUNDS. A lesson starts on its heading and runs to the line before the next
 * lesson heading in the same file (or to the end of the file), then is trimmed
 * back over trailing blank lines, one trailing thematic break `---`, and blank
 * lines again. Line numbers are 1-based over `text.split('\n')`, the convention
 * fetch-lesson.js slices with.
 *
 * HEADINGS. A lesson heading is a line matching /^#{1,4}\s*LESSON\s+0*\d+/i
 * OUTSIDE fenced code (``` or ~~~). A fence still open at EOF is a validation
 * error naming the file and the fence's line. Its lesson number is the leading
 * number, except in the legacy files 01-05, which number lessons within the
 * file and put the real number in a parenthesised "(Lesson N)" (only 03 does
 * today); outside those files a "(Lesson N)" is a cross-reference. A topic-index
 * lesson with a numeric lesson_number matches the heading carrying that number;
 * the ten legacy lessons with a word lesson_number ("KAIROS", ...) match by the
 * first distinctive token of their title. Lessons are matched by (file, heading)
 * and never by their stored startLine — the stored value is what this replaces.
 * The match must be one-to-one in both directions or the build fails.
 *
 * COVERAGE. Every non-blank, non-separator line from a file's first lesson
 * heading to EOF must belong to exactly one lesson. Lines before the first
 * lesson heading (title, TOC) are out of scope. The invariant is checked twice:
 * on the derived bounds (a guard on the bounds algorithm itself; they cover by
 * construction) and, in --check mode, on the STORED bounds in topic-index.json,
 * which are what fetch-lesson.js slices. The second is the check that fails
 * when stored bounds would silently drop content: it reports each uncovered or
 * doubly-covered line, beside the stale-field diff.
 *
 * WRITES. Every file read is hashed, and git HEAD is recorded before the first
 * read (skipped when the skill is not in a git work tree). Before writing,
 * build.js re-reads and re-hashes all of them (and re-lists the reference
 * files, and re-reads HEAD); if anything changed since the run started (a peer
 * session editing a lesson or committing) it aborts and writes nothing. Each
 * output is written to a temp file beside it and renamed into place. --check
 * never runs git.
 *
 * CHAPTERS. Distinct `# Chapter N` headings (outside fences) plus chapters 1-8,
 * which predate the one-chapter-per-file convention and live, unheaded, in the
 * legacy files 01-05.
 *
 * LESSON KEYWORDS (--check only; a write just prints a note). topic-index.json's
 * keyword fields are exactly what prepare-lessons.js derives: the frozen
 * references/hand-keywords.json projected onto the live lessons, then the
 * generated keys derived from the current lesson text, with the unreachable
 * count within its ceiling (see prepare-lessons.js --check). build.js never
 * writes keyword fields; prepare-lessons.js is the fix. A lesson whose
 * vocabulary proposal is stale (the lesson changed since the model saw it,
 * lib/vocab.js) is a WARNING naming the lesson, not a failure (one constant,
 * STALE_VOCAB_BLOCKS in prepare-lessons.js, turns it into a failure).
 *
 * JSON is rewritten through check-json-format.js's order-preserving parser and
 * emitter, so integer-like keys keep their order and only changed values move.
 * A derived key that is missing (a new lesson entry written without bounds) is
 * inserted where existing entries carry it: startLine/endLine after `file`,
 * total_lessons after `source`, lessons_count/chapters_count after
 * `captured_date` (version.json holds exactly skill_version, captured_version,
 * captured_date and the two counts; release-consistency.test.js pins that shape).
 *
 *   node scripts/build.js            write derived fields
 *   node scripts/build.js --check    compare only; exit 1 listing every stale field/file
 *   node scripts/build.js --root DIR operate on another skill directory (tests)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { parseOrdered, emit, PINNED } = require('./check-json-format.js');

const LESSON_HEADING = /^#{1,4}\s*LESSON\s+0*(\d+)/i;
const PAREN_NUMBER = /\(Lesson\s+0*(\d+)\)/i;
const CHAPTER_HEADING = /^#\s*Chapter\s+(\d+)/i;
const LEGACY_CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8];
const LEGACY_FILES = /^0[1-5]-/;
const REFERENCE_FILE = /^\d\d-.*\.md$/;

// --- scanning -----------------------------------------------------------------

/**
 * Split text into lines and record, per line, whether it is inside (or is) a fence.
 * `unclosedFence` is the 1-based line of a fence still open at EOF, else null.
 */
function scanLines(text) {
  const lines = text.split('\n');
  const inFence = new Array(lines.length).fill(false);
  let fence = null; // the opening marker, e.g. '```' or '~~~~'
  let fenceLine = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence) {
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) { fence = m[1]; fenceLine = i + 1; inFence[i] = true; }
      continue;
    }
    inFence[i] = true;
    if (m && m[1][0] === fence[0] && m[1].length >= fence.length && m[2].trim() === '') { fence = null; fenceLine = null; }
  }
  return { lines, inFence, unclosedFence: fence ? fenceLine : null };
}

const isBlank = (s) => s.trim() === '';

/**
 * A real thematic break: `---` outside a fence whose preceding line is blank
 * (so it is not a setext underline or part of a table). `i` is 0-based.
 */
function isThematicBreak(lines, inFence, i) {
  return lines[i].trim() === '---' && !inFence[i] && i > 0 && isBlank(lines[i - 1]);
}

/** Blank lines and thematic breaks: the lines a lesson may leave uncovered. `i` is 0-based. */
function isSeparator(lines, inFence, i) {
  return isBlank(lines[i]) || isThematicBreak(lines, inFence, i);
}

/**
 * Trim a 1-based inclusive range [start, stop] back over trailing blank lines,
 * one trailing thematic break, then blank lines again. Returns the new end.
 */
function trimEnd(lines, inFence, start, stop) {
  let e = stop;
  while (e > start && isBlank(lines[e - 1])) e--;
  if (e > start && isThematicBreak(lines, inFence, e - 1)) e--;
  while (e > start && isBlank(lines[e - 1])) e--;
  return e;
}

/**
 * Lesson headings and chapter numbers outside fences. Lines are 1-based.
 * `legacy` (files 01-05) enables the parenthesised "(Lesson N)" numbering rule;
 * elsewhere a "(Lesson N)" in a heading is a cross-reference, not its number.
 */
function findHeadings(lines, inFence, { legacy = false } = {}) {
  const headings = [];
  const chapters = [];
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = lines[i].match(LESSON_HEADING);
    if (m) {
      const p = legacy ? lines[i].match(PAREN_NUMBER) : null;
      headings.push({ line: i + 1, text: lines[i], number: Number(p ? p[1] : m[1]) });
    }
    const c = lines[i].match(CHAPTER_HEADING);
    if (c) chapters.push(Number(c[1]));
  }
  return { headings, chapters };
}

/** Does this topic-index lesson name this heading? */
function lessonMatchesHeading(lesson, heading) {
  const raw = String(lesson.lesson_number ?? lesson.id).trim();
  if (/^\d+$/.test(raw)) return heading.number === Number(raw);
  const token = (String(lesson.title).match(/[A-Za-z][A-Za-z0-9-]{3,}/) || [''])[0].toUpperCase();
  return token !== '' && heading.text.toUpperCase().includes(token);
}

/**
 * Coverage check over 1-based inclusive bounds [{id, startLine, endLine}] for
 * one file. Returns problems: lines outside every lesson that are not
 * separators, and lines inside more than one lesson.
 */
function checkCoverage(lines, inFence, bounds, file = '') {
  const problems = [];
  if (!bounds.length) return problems;
  const owner = new Array(lines.length + 1).fill(null);
  for (const b of bounds) {
    for (let n = b.startLine; n <= b.endLine; n++) {
      if (owner[n] !== null) problems.push(`${file}:${n} is inside both lesson ${owner[n]} and lesson ${b.id}`);
      else owner[n] = b.id;
    }
  }
  const first = Math.min(...bounds.map((b) => b.startLine));
  for (let n = first; n <= lines.length; n++) {
    if (owner[n] === null && !isSeparator(lines, inFence, n - 1)) {
      problems.push(`${file}:${n} belongs to no lesson: "${lines[n - 1].slice(0, 70)}"`);
    }
  }
  return problems;
}

// --- ordered-JSON helpers -------------------------------------------------------

const entryIndex = (obj, key) => obj.entries.findIndex(([k]) => k === JSON.stringify(key));
const getNode = (obj, key) => { const i = entryIndex(obj, key); return i < 0 ? null : obj.entries[i][1]; };
/**
 * Set a key's raw value. A missing key is inserted at its canonical position:
 * right after the last of `after` (its predecessors, nearest first) that is
 * present, else at the end — so a new lesson entry written without bounds
 * gets them in the same place every other entry carries them.
 */
function setRaw(obj, key, value, after = []) {
  const node = getNode(obj, key);
  if (node) { node.text = JSON.stringify(value); return; }
  const entry = [JSON.stringify(key), { t: 'raw', text: JSON.stringify(value) }];
  for (const prev of after) {
    const i = entryIndex(obj, prev);
    if (i >= 0) { obj.entries.splice(i + 1, 0, entry); return; }
  }
  obj.entries.push(entry);
}
function dropKey(obj, key) {
  const i = entryIndex(obj, key);
  if (i >= 0) obj.entries.splice(i, 1);
}
function serialize(tree, rel, fallback) {
  const fmt = PINNED[rel] || fallback;
  return emit(tree, fmt.indent) + (fmt.trailingNewline ? '\n' : '');
}

// --- the build ----------------------------------------------------------------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const listReferenceFiles = (refs) => fs.readdirSync(refs).filter((f) => REFERENCE_FILE.test(f)).sort();

/**
 * Compute everything in memory. Returns
 *   { errors, coverage, outputs: [{rel, abs, before, text}],
 *     bounds: Map(id -> {startLine,endLine}), lessonsCount, chaptersCount, topic,
 *     inputs: Map(abs -> sha256), refsDir, referenceFiles }
 * `coverage` lists the coverage problems of the STORED bounds (see COVERAGE);
 * main() reports them in --check mode.
 */
function build(skillDir) {
  const refs = path.join(skillDir, 'references');
  const errors = [];
  const inputs = new Map(); // every file read -> sha256 of the content read
  const read = (p) => {
    const text = fs.readFileSync(p, 'utf8');
    inputs.set(p, sha256(text));
    return text;
  };

  const topicRel = 'topic-index.json';
  const topicAbs = path.join(refs, topicRel);
  const topicRaw = read(topicAbs);
  const topic = JSON.parse(topicRaw);
  const topicTree = parseOrdered(topicRaw);

  // duplicate ids
  const ids = new Set();
  for (const l of topic.lessons) {
    if (ids.has(l.id)) errors.push(`duplicate lesson id ${l.id} in topic-index.json`);
    ids.add(l.id);
    // Optional hand-written summary; lib/tfidf-index.js indexes it with the title and keywords.
    if ('description' in l && typeof l.description !== 'string') errors.push(`lesson ${l.id} description must be a string`);
  }

  // scan every reference file
  const files = listReferenceFiles(refs);
  const scanned = new Map();
  const explicitChapters = new Set();
  for (const f of files) {
    const s = scanLines(read(path.join(refs, f)));
    if (s.unclosedFence !== null) {
      errors.push(`${f}:${s.unclosedFence} opens a code fence that is never closed (everything after it is treated as code)`);
    }
    const h = findHeadings(s.lines, s.inFence, { legacy: LEGACY_FILES.test(f) });
    scanned.set(f, { ...s, ...h });
    for (const c of h.chapters) explicitChapters.add(c);
    if (LEGACY_FILES.test(f) && h.chapters.length) {
      errors.push(`${f}: legacy file carries a "# Chapter" heading; the implicit chapters 1-8 rule needs revisiting`);
    }
  }
  for (const c of LEGACY_CHAPTERS) {
    if (explicitChapters.has(c)) errors.push(`"# Chapter ${c}" heading found, but chapters 1-8 are counted as implicit`);
  }
  const chaptersCount = new Set([...LEGACY_CHAPTERS, ...explicitChapters]).size;

  // map lessons <-> headings, one-to-one
  const bounds = new Map();
  const headingOwner = new Map(); // `${file}:${line}` -> lesson ids
  for (const l of topic.lessons) {
    const s = scanned.get(l.file);
    if (!s) { errors.push(`lesson ${l.id} points at ${l.file}, which is not a reference file`); continue; }
    const hits = s.headings.filter((h) => lessonMatchesHeading(l, h));
    if (hits.length !== 1) {
      errors.push(`lesson ${l.id} (lesson_number ${l.lesson_number}) matches ${hits.length} headings in ${l.file}` +
        (hits.length ? `: ${hits.map((h) => `${h.line} "${h.text.slice(0, 50)}"`).join(', ')}` : ''));
      continue;
    }
    const key = `${l.file}:${hits[0].line}`;
    if (!headingOwner.has(key)) headingOwner.set(key, []);
    headingOwner.get(key).push(l.id);
  }
  for (const [f, s] of scanned) {
    for (const h of s.headings) {
      const owners = headingOwner.get(`${f}:${h.line}`) || [];
      if (owners.length !== 1) {
        errors.push(`${f}:${h.line} "${h.text.slice(0, 50)}" is claimed by ${owners.length} lessons` +
          (owners.length ? ` (${owners.join(', ')})` : ' — add it to topic-index.json'));
      }
    }
  }

  // bounds + coverage, per file
  const coverage = [];
  for (const [f, s] of scanned) {
    // The STORED bounds, as fetch-lesson.js will slice them. Derived bounds
    // cover by construction; these are what can silently drop content.
    const stored = topic.lessons
      .filter((l) => l.file === f && Number.isInteger(l.startLine) && Number.isInteger(l.endLine)
        && l.startLine >= 1 && l.endLine >= l.startLine) // garbage bounds fail on the diff instead
      .map((l) => ({ id: l.id, startLine: l.startLine, endLine: l.endLine }));
    coverage.push(...checkCoverage(s.lines, s.inFence, stored, f).map((p) => `stored bounds: ${p}`));

    const heads = s.headings
      .map((h) => ({ ...h, owners: headingOwner.get(`${f}:${h.line}`) || [] }))
      .filter((h) => h.owners.length === 1);
    if (!heads.length) continue;
    const fileBounds = [];
    heads.forEach((h, i) => {
      const stop = i + 1 < heads.length ? heads[i + 1].line - 1 : s.lines.length;
      const endLine = trimEnd(s.lines, s.inFence, h.line, stop);
      const b = { id: h.owners[0], startLine: h.line, endLine };
      bounds.set(b.id, b);
      fileBounds.push(b);
    });
    // Only meaningful when every heading in the file resolved.
    if (heads.length === s.headings.length) errors.push(...checkCoverage(s.lines, s.inFence, fileBounds, f));
  }

  // references from other indexes
  // keyword_map is not checked here: it is build output (lib/keyword-provenance.js).
  // Its hand part is hand-keywords.json projected onto the live lessons and its
  // generated part is derived from them, so after a lesson is deleted it can point
  // at the missing lesson only until prepare-lessons.js next runs, and
  // build.js --check fails until it has (the LESSON KEYWORDS check). Refusing to
  // build would stop prepare-lessons.js from running at all.
  const xrefRel = 'cross-references.json';
  const xrefRaw = read(path.join(refs, xrefRel));
  const xref = JSON.parse(xrefRaw);
  for (const [from, list] of Object.entries(xref.references || {})) {
    // Keys are lesson ids or concept slugs ("dynamic-workflows"); only a numeric key names a lesson.
    if (/^\d+$/.test(from) && !ids.has(Number(from))) errors.push(`cross-references.json key ${from} is not a lesson id`);
    for (const r of list) if (!ids.has(r.id)) errors.push(`cross-references.json[${from}] references missing lesson ${r.id}`);
  }
  const tsRel = 'troubleshooting.json';
  const tsRaw = read(path.join(refs, tsRel));
  const ts = JSON.parse(tsRaw);
  (ts.symptoms || []).forEach((s, i) => {
    for (const id of s.lessons || []) if (!ids.has(id)) errors.push(`troubleshooting.json symptoms[${i}] references missing lesson ${id}`);
  });

  const vAbs = path.join(skillDir, 'version.json');
  const vRaw = read(vAbs);

  const outputs = [];
  const lessonsCount = topic.lessons.length;
  if (!errors.length) {
    // topic-index
    dropKey(topicTree, 'generated');
    setRaw(topicTree, 'total_lessons', lessonsCount, ['source']);
    for (const item of getNode(topicTree, 'lessons').items) {
      const id = Number(getNode(item, 'id').text);
      const b = bounds.get(id);
      setRaw(item, 'startLine', b.startLine, ['file', 'lesson_number', 'description', 'title']);
      setRaw(item, 'endLine', b.endLine, ['startLine']);
    }
    outputs.push({ rel: `references/${topicRel}`, abs: topicAbs, before: topicRaw, text: serialize(topicTree, topicRel) });

    for (const [rel, raw] of [[xrefRel, xrefRaw], [tsRel, tsRaw]]) {
      const tree = parseOrdered(raw);
      dropKey(tree, 'generated');
      outputs.push({ rel: `references/${rel}`, abs: path.join(refs, rel), before: raw, text: serialize(tree, rel) });
    }

    // version.json (not pinned by check-json-format; its canonical form is indent 2 + newline)
    const vTree = parseOrdered(vRaw);
    setRaw(vTree, 'lessons_count', lessonsCount, ['captured_date']);
    setRaw(vTree, 'chapters_count', chaptersCount, ['lessons_count']);
    outputs.push({ rel: 'version.json', abs: vAbs, before: vRaw, text: serialize(vTree, null, { indent: 2, trailingNewline: true }) });
  }

  return { errors, coverage, outputs, bounds, lessonsCount, chaptersCount, topic, inputs, refsDir: refs, referenceFiles: files };
}

/**
 * The git HEAD commit of the work tree containing `dir`, or null when there is
 * none (a standalone package or zip, no git installed, no commit yet). Only the
 * write paths call this; --check never needs git.
 */
function gitHead(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^[0-9a-f]{40,64}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * Inputs that changed on disk since build() read them: a different hash, a
 * vanished file, or a reference file added/removed; and git HEAD when the
 * caller recorded it (derived.head, from gitHead(derived.headDir) before
 * reading). Empty when nothing moved.
 */
function changedInputs(derived) {
  const changed = [];
  for (const [abs, hash] of derived.inputs) {
    let now = null;
    try { now = sha256(fs.readFileSync(abs, 'utf8')); } catch { /* vanished */ }
    if (now !== hash) changed.push(abs);
  }
  const listed = listReferenceFiles(derived.refsDir);
  if (listed.join('\n') !== derived.referenceFiles.join('\n')) changed.push(`${derived.refsDir} (reference files added or removed)`);
  if (typeof derived.head === 'string') {
    const now = gitHead(derived.headDir);
    if (now !== derived.head) changed.push(`git HEAD moved from ${derived.head.slice(0, 12)} to ${now ? now.slice(0, 12) : '(none)'} (a commit, checkout or reset by another session?)`);
  }
  return changed;
}

/** Write via a temp file in the same directory, then rename over the target. */
function writeAtomic(abs, text) {
  const tmp = `${abs}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, abs);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* renamed away, or never created */ }
  }
}

/**
 * Write the changed outputs, but only if no input changed since build() read
 * it (a peer session editing a lesson mid-run): otherwise throw and write
 * nothing, since the derived fields describe content that is no longer there.
 * Returns the outputs written.
 */
function writeOutputs(derived) {
  const changed = derived.outputs.filter((o) => o.text !== o.before);
  if (!changed.length) return changed;
  const moved = changedInputs(derived);
  if (moved.length) {
    const err = new Error(`inputs changed while build.js was running; nothing written. Re-run build.js.\n  ${moved.join('\n  ')}`);
    err.code = 'EINPUTCHANGED';
    throw err;
  }
  for (const o of changed) writeAtomic(o.abs, o.text);
  return changed;
}

/** Human-readable list of what differs between two versions of an output file. */
function describeDiff(out, derived) {
  const lines = [];
  if (out.rel.endsWith('topic-index.json')) {
    const before = JSON.parse(out.before);
    if ('generated' in before) lines.push(`${out.rel}: "generated" stamp should be removed`);
    if (before.total_lessons !== derived.lessonsCount) lines.push(`${out.rel}: total_lessons ${before.total_lessons}, expected ${derived.lessonsCount}`);
    for (const l of before.lessons) {
      const b = derived.bounds.get(l.id);
      if (b && l.startLine !== b.startLine) lines.push(`${out.rel}: lesson ${l.id} startLine ${l.startLine}, expected ${b.startLine}`);
      if (b && l.endLine !== b.endLine) lines.push(`${out.rel}: lesson ${l.id} endLine ${l.endLine}, expected ${b.endLine}`);
    }
  } else if (out.rel === 'version.json') {
    const before = JSON.parse(out.before);
    if (before.lessons_count !== derived.lessonsCount) lines.push(`version.json: lessons_count ${before.lessons_count}, expected ${derived.lessonsCount}`);
    if (before.chapters_count !== derived.chaptersCount) lines.push(`version.json: chapters_count ${before.chapters_count}, expected ${derived.chaptersCount}`);
  } else if ('generated' in JSON.parse(out.before)) {
    lines.push(`${out.rel}: "generated" stamp should be removed`);
  }
  if (!lines.length) lines.push(`${out.rel}: not in canonical form`);
  return lines;
}

function main(argv) {
  const check = argv.includes('--check');
  const rootIdx = argv.indexOf('--root');
  if (rootIdx >= 0 && !argv[rootIdx + 1]) { console.error('build.js: --root needs a skill directory'); return 2; }
  const skillDir = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : path.resolve(__dirname, '..');

  // A write aborts if HEAD moves while it runs (recorded before anything is read).
  const head = check ? null : gitHead(skillDir);
  const derived = build(skillDir);
  derived.head = head;
  derived.headDir = skillDir;
  if (derived.errors.length) {
    console.error(`build.js: ${derived.errors.length} validation error(s):`);
    for (const e of derived.errors) console.error(`  ${e}`);
    return 1;
  }

  const changed = derived.outputs.filter((o) => o.text !== o.before);
  const lessons = lessonChecks(skillDir, derived);

  if (check) {
    const stale = [];
    for (const o of changed) stale.push(...describeDiff(o, derived));
    if (stale.length) {
      console.error(`build.js --check: ${stale.length} stale derived field(s) — run node scripts/build.js`);
      for (const s of stale) console.error(`  ${s}`);
    }
    if (derived.coverage.length) {
      const shown = derived.coverage.slice(0, 20);
      console.error(`build.js --check: ${derived.coverage.length} line(s) not covered exactly once by the stored bounds — run node scripts/build.js`);
      for (const s of shown) console.error(`  ${s}`);
      if (derived.coverage.length > shown.length) console.error(`  ... and ${derived.coverage.length - shown.length} more`);
    }
    if (lessons.errors.length) {
      console.error('build.js --check: lesson keywords incomplete — the fix is a script run, never a hand edit:');
      for (const e of lessons.errors) console.error(`  ${e}`);
    }
    // Stale vocabulary proposals (a lesson changed since the model saw it) are
    // reported by id, never failed: a lesson prose edit must not fail CI.
    for (const w of lessons.warnings || []) console.warn(`build.js --check: WARNING: ${w}`);
    if (stale.length || derived.coverage.length || lessons.errors.length) return 1;
    console.log(`derived fields OK (${derived.lessonsCount} lessons, ${derived.chaptersCount} chapters)`);
    console.log(`lesson keywords OK (${lessons.notes.join('; ')})`);
    return 0;
  }

  let written;
  try {
    written = writeOutputs(derived);
  } catch (e) {
    if (e.code !== 'EINPUTCHANGED') throw e;
    console.error(`build.js: ${e.message}`);
    return 1;
  }
  for (const o of written) console.log(`wrote ${o.rel}`);
  if (!written.length) console.log('derived fields already up to date');
  // Bounds are written regardless: prepare-lessons.js needs them before it can run.
  for (const e of lessons.errors) console.log(`note: ${e}`);
  for (const w of lessons.warnings || []) console.log(`note: ${w}`);
  return 0;
}

/**
 * The lesson-keyword check (plan §4.7: every extracted identifier is
 * reachable), run over the DERIVED bounds, so it reads the same text
 * prepare-lessons.js will. Kept out of build().errors so that a write still
 * writes bounds. prepare-lessons.js requires this file, so it is required
 * lazily here.
 */
function lessonChecks(skillDir, derived) {
  const { checkLessons } = require('./prepare-lessons.js');
  const { loadHandSource } = require('./lib/keyword-provenance.js');
  let hand;
  try { hand = loadHandSource(skillDir); } catch (e) { return { errors: [e.message], notes: [] }; }
  // The topic-index text with the derived bounds (the one this run writes).
  const raw = derived.outputs.find((o) => o.rel === 'references/topic-index.json').text;
  const cache = new Map();
  const lessonText = (l) => {
    if (!cache.has(l.file)) cache.set(l.file, fs.readFileSync(path.join(skillDir, 'references', l.file), 'utf8').split('\n'));
    return cache.get(l.file).slice(l.startLine - 1, l.endLine).join('\n');
  };
  const { loadProposals } = require('./lib/vocab.js');
  let proposals;
  try { proposals = loadProposals(skillDir); } catch (e) { return { errors: [e.message], notes: [] }; }
  return checkLessons({ raw, lessonText, hand, proposals });
}

module.exports = {
  scanLines, isThematicBreak, isSeparator, trimEnd, findHeadings,
  lessonMatchesHeading, checkCoverage, build, gitHead, changedInputs, writeAtomic, writeOutputs,
};
if (require.main === module) process.exitCode = main(process.argv.slice(2));
