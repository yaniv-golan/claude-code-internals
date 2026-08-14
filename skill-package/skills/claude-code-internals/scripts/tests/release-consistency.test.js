'use strict';

/**
 * release-consistency.test.js — cross-file release-fact drift detector.
 *
 * Every file below repeats facts that live authoritatively in version.json:
 * how many lessons there are, how many chapters, which binary they were
 * captured from, what the skill version is. Nothing enforced that agreement,
 * so they drifted independently — at v2.39.0 the root README still claimed
 * 142 lessons / 39 chapters / v2.1.217 (four releases stale), marketplace.json
 * claimed 118 lessons / v2.1.198, and SKILL.md's own opening line — the one
 * the model reads when the skill loads — claimed 124.
 *
 * The counts are also checked against reality (topic-index / semantic-index /
 * the chapter files), not just against each other, so that a release which
 * updates every doc to the same WRONG number still fails.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..', '..');            // skills/claude-code-internals
const PKG_DIR = path.resolve(SKILL_DIR, '..', '..');              // skill-package
const REPO_DIR = path.resolve(PKG_DIR, '..');                     // repo root

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readText = (p) => fs.readFileSync(p, 'utf8');

const version = readJson(path.join(SKILL_DIR, 'version.json'));
const topicIndex = readJson(path.join(SKILL_DIR, 'references', 'topic-index.json'));

// Files that restate release facts, and the labels used in failure messages.
const DOCS = {
  'README.md': path.join(REPO_DIR, 'README.md'),
  'marketplace.json': path.join(REPO_DIR, '.claude-plugin', 'marketplace.json'),
  'plugin.json': path.join(PKG_DIR, '.claude-plugin', 'plugin.json'),
  'skill-package/README.md': path.join(PKG_DIR, 'README.md'),
  'SKILL.md': path.join(SKILL_DIR, 'SKILL.md'),
};

const allNumbers = (text, re) => [...new Set([...text.matchAll(re)].map((m) => m[1]))];

// --- the counts must match reality, not merely each other -------------------

test('version.json lessons_count matches the actual lesson inventory', () => {
  assert.strictEqual(
    topicIndex.lessons.length, version.lessons_count,
    `topic-index has ${topicIndex.lessons.length} lessons but version.json says ${version.lessons_count}`,
  );
  assert.strictEqual(
    topicIndex.total_lessons, version.lessons_count,
    `topic-index.total_lessons (${topicIndex.total_lessons}) disagrees with version.json (${version.lessons_count})`,
  );
});

test('semantic index covers every lesson in the topic index', () => {
  const semantic = readJson(path.join(SKILL_DIR, 'references', 'semantic-index.json'));
  const entries = semantic.lessons || semantic.entries || semantic.vectors || [];
  assert.strictEqual(
    entries.length, topicIndex.lessons.length,
    `semantic-index has ${entries.length} entries for ${topicIndex.lessons.length} lessons — rebuild it with build-rvf-index.js`,
  );
  const indexed = new Set(entries.map((e) => String(e.id ?? e.lesson_id)));
  const missing = topicIndex.lessons.map((l) => String(l.id)).filter((id) => !indexed.has(id));
  assert.deepStrictEqual(missing, [], `lessons missing from the semantic index: ${missing.join(', ')}`);
});

test('every lesson body referenced by the topic index exists, and startLine lands on its heading', () => {
  // Lesson bodies are headed by `lesson_number`, NOT `id` — for lessons 1-50
  // those disagree (id is an array position; the Hooks System is id 32 /
  // lesson_number 10). The legacy chapters also use THREE heading conventions:
  //   `# LESSON 01 — BOOT SEQUENCE`                        (real number, zero-padded)
  //   `## LESSON 03: THE SKILLS SYSTEM`                    (real number, h2)
  //   `# LESSON 1: Vim Mode Implementation (Lesson 31)`    (within-file index, real number in parens)
  // So accept the real number in either position, and only require that the
  // line is a LESSON heading naming THIS lesson.
  for (const lesson of topicIndex.lessons) {
    const file = path.join(SKILL_DIR, 'references', lesson.file);
    assert.ok(fs.existsSync(file), `lesson ${lesson.id} points at a missing file: ${lesson.file}`);
    const lines = readText(file).split('\n');
    const heading = lines[lesson.startLine - 1] || '';           // startLine is 1-indexed
    const m = heading.match(/^#{1,4}\s*LESSON\s+0*(\d+)/i);
    assert.ok(
      m,
      `lesson ${lesson.id} startLine ${lesson.startLine} lands on "${heading.slice(0, 60)}" in ${lesson.file}, ` +
      `which is not a LESSON heading — bounds go stale whenever lines are inserted above a lesson`,
    );
    // Ten legacy lessons (ids 41-50) carry a WORD lesson_number ("Ultraplan",
    // "KAIROS", ...) rather than a digit, so for those the identity check is a
    // distinctive token from the title instead of a number.
    const raw = String(lesson.lesson_number ?? lesson.id).trim();
    if (/^\d+$/.test(raw)) {
      const expected = Number(raw);
      const parenthesised = heading.match(/\(Lesson\s+0*(\d+)\)/i);
      assert.ok(
        Number(m[1]) === expected || (parenthesised && Number(parenthesised[1]) === expected),
        `lesson ${lesson.id} startLine ${lesson.startLine} lands on "${heading.slice(0, 60)}" in ${lesson.file}, ` +
        `which does not name lesson ${expected}`,
      );
    } else {
      const token = (lesson.title.match(/[A-Za-z][A-Za-z0-9-]{3,}/) || [''])[0].toUpperCase();
      assert.ok(
        token && heading.toUpperCase().includes(token),
        `lesson ${lesson.id} startLine ${lesson.startLine} lands on "${heading.slice(0, 60)}" in ${lesson.file}, ` +
        `which does not mention "${token}" from its title`,
      );
    }
  }
});

test('endLine bounds do not overrun the file or the next lesson', () => {
  const byFile = new Map();
  for (const l of topicIndex.lessons) {
    if (!byFile.has(l.file)) byFile.set(l.file, []);
    byFile.get(l.file).push(l);
  }
  for (const [file, lessons] of byFile) {
    const total = readText(path.join(SKILL_DIR, 'references', file)).split('\n').length;
    lessons.sort((a, b) => a.startLine - b.startLine);
    lessons.forEach((l, i) => {
      assert.ok(l.endLine >= l.startLine, `lesson ${l.id}: endLine ${l.endLine} < startLine ${l.startLine}`);
      assert.ok(l.endLine <= total, `lesson ${l.id}: endLine ${l.endLine} overruns ${file} (${total} lines)`);
      const next = lessons[i + 1];
      if (next) {
        assert.ok(
          l.endLine < next.startLine,
          `lesson ${l.id} (ends ${l.endLine}) overlaps lesson ${next.id} (starts ${next.startLine}) in ${file}`,
        );
      }
    });
  }
});

test('chapters_count matches the number of distinct chapters in the reference files', () => {
  const refs = path.join(SKILL_DIR, 'references');
  const chapters = new Set();
  for (const f of fs.readdirSync(refs).filter((f) => f.endsWith('.md'))) {
    for (const m of readText(path.join(refs, f)).matchAll(/^#\s*Chapter\s+(\d+)/gim)) {
      chapters.add(Number(m[1]));
    }
  }
  // Chapters 1-8 predate the one-chapter-per-file convention and carry no
  // "# Chapter N" heading, so assert the highest chapter number instead of the count.
  const highest = Math.max(...chapters);
  assert.strictEqual(
    highest, version.chapters_count,
    `highest "# Chapter N" heading is ${highest} but version.json says ${version.chapters_count} chapters`,
  );
});

// --- the docs must restate those facts consistently -------------------------

test('every doc that states a lesson count states the current one', () => {
  const expected = String(version.lessons_count);
  for (const [label, file] of Object.entries(DOCS)) {
    const found = allNumbers(readText(file), /(\d{2,4})\s+(?:detailed\s+)?lessons\b/g);
    if (found.length === 0) continue;                 // a doc need not state it
    assert.deepStrictEqual(
      found, [expected],
      `${label} states lesson count(s) ${found.join(', ')} — expected only ${expected}`,
    );
  }
});

test('every doc that states a chapter count states the current one', () => {
  const expected = String(version.chapters_count);
  for (const [label, file] of Object.entries(DOCS)) {
    const found = allNumbers(readText(file), /(\d{1,3})\s+chapters\b/g);
    if (found.length === 0) continue;
    assert.deepStrictEqual(
      found, [expected],
      `${label} states chapter count(s) ${found.join(', ')} — expected only ${expected}`,
    );
  }
});

test('the plugin manifest version matches version.json', () => {
  const plugin = readJson(DOCS['plugin.json']);
  assert.strictEqual(
    plugin.version, version.skill_version,
    `plugin.json version ${plugin.version} != version.json skill_version ${version.skill_version}`,
  );
});

test('docs that pin a "captured from" CLI version pin the current one', () => {
  // Only the explicit capture claims — not the many historical "verified against
  // v2.1.x" mentions, which are legitimately about older binaries.
  const captured = version.captured_version;
  const claims = [
    ['README.md', /\*\*Captured from:\*\*\s*Claude Code v(2\.1\.\d+)/],
    ['README.md', /currently v(2\.1\.\d+)\)/],
    ['SKILL.md', /differs from v(2\.1\.\d+)\./],
  ];
  for (const [label, re] of claims) {
    const m = readText(DOCS[label]).match(re);
    if (!m) continue;
    assert.strictEqual(
      m[1], captured,
      `${label} pins CLI v${m[1]} but version.json captured_version is ${captured}`,
    );
  }
});

test('the hook-event count is stated consistently across docs', () => {
  // Guards the specific drift that v2.39.0 had to correct in four places at once.
  const counts = new Set();
  for (const file of Object.values(DOCS)) {
    for (const m of readText(file).matchAll(/\b(?:all\s+)?(\d{2})\s+(?:hook\s+)?event types\b/g)) {
      counts.add(m[1]);
    }
  }
  assert.ok(counts.size <= 1, `docs disagree on the hook-event count: ${[...counts].join(' vs ')}`);
});
