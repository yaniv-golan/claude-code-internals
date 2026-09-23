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
  // The GitHub "About" text. It lives here rather than only on github.com because
  // the checks below can only reach artifacts inside the repository -- and the one
  // stated-count surface that lived outside it is the one that drifted, sitting at
  // "169 lessons across 46 chapters" through two releases while every file in the
  // tree said 174/48. scripts/sync-repo-description.sh publishes this file.
  'repo-description.txt': path.join(REPO_DIR, '.github', 'repo-description.txt'),
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

// Require the claim to exist (a regex that stops matching must fail loudly,
// not be silently skipped) and check every occurrence, not just the first —
// `.match()` without /g only inspects the first hit in the whole file, so a
// SECOND, stale restatement of the same claim elsewhere in the doc would
// never be checked. Every regex passed in here must carry the /g flag.
const requireEveryMatch = (label, re, expected, describe) => {
  assert.ok(re.global, `${label}: regex ${re} is missing the /g flag needed to check every occurrence`);
  const matches = [...readText(DOCS[label]).matchAll(re)];
  assert.ok(matches.length > 0, `${label}: no "${describe}" stamp found matching ${re} — reworded or removed?`);
  for (const m of matches) {
    assert.strictEqual(
      m[1], expected,
      `${label} ${describe} ${m[1]} but expected ${expected}`,
    );
  }
};

test('docs that pin a "captured from" CLI version pin the current one', () => {
  // Only the explicit capture claims — not the many historical "verified against
  // v2.1.x" mentions, which are legitimately about older binaries.
  const captured = version.captured_version;
  const claims = [
    ['README.md', /\*\*Captured from:\*\*\s*Claude Code v(2\.1\.\d+)/g],
    ['README.md', /currently v(2\.1\.\d+)\)/g],
    ['SKILL.md', /differs from v(2\.1\.\d+)\./g],
  ];
  for (const [label, re] of claims) {
    requireEveryMatch(label, re, captured, 'pins CLI v');
  }
});

test('docs that pin the skill version pin the current one', () => {
  // Same shape as the "captured from" CLI-version test above, but for the
  // skill_version stamps — the pinning the plugin.json test (above) already
  // checks against version.json, but only the README copies drift silently.
  // At v2.49.8 the root README's four stamps (the banner line, the file-tree
  // comment, the version.json example block, and the "what this fork adds"
  // changelog line) sat stale at 2.46.12. Only the specific pinned forms below
  // count; README legitimately mentions other version numbers (CLI 2.1.x,
  // asar/Mach-O 1.x/2.1.x, historical skill versions in prose like
  // "Chapter 9 ... v2.1.90"), so this does NOT do a broad x.y.z scan.
  //
  // skill-package/README.md is NOT in this list: it used to pin its own stale
  // "Skill Version: 2.0.0" banner, untouched since the very first release, and
  // rather than keep a second stamp in sync forever, that file now points at
  // version.json instead of restating the number — see the dedicated negative
  // test below, which guards that a pin doesn't creep back in unchecked.
  const expected = version.skill_version;
  const claims = [
    ['README.md', /\*\*Skill Version:\*\*\s*(\d+\.\d+\.\d+)/g],
    ['README.md', /Version tracking \(v(\d+\.\d+\.\d+)/g],
    ['README.md', /"skill_version":\s*"(\d+\.\d+\.\d+)"/g],
    ['README.md', /v2\.2\.0.v(\d+\.\d+\.\d+),/g],
  ];
  for (const [label, re] of claims) {
    requireEveryMatch(label, re, expected, 'pins skill version');
  }
});

test('the README version.json example\'s captured_date matches version.json', () => {
  // The root README's "Version Tracking" section shows a literal json example
  // of version.json's shape. Its captured_date drifted to 2026-08-05 while
  // version.json's real captured_date moved to 2026-08-14 — nothing checked
  // that the illustrative example still matched the real file.
  requireEveryMatch('README.md', /"captured_date":\s*"(\d{4}-\d{2}-\d{2})"/g, version.captured_date, 'shows example captured_date');
});

test('skill-package/README.md does not restate a skill-version or captured-from pin', () => {
  // It used to carry its own "Skill Version: 2.0.0 | Captured from: Claude
  // Code v2.1.88 | Date: 2026-03-31" banner that nothing ever updated after
  // the very first release, plus several more v2.1.88 mentions in prose, a
  // directory diagram, and a JSON example. All of those now point readers at
  // version.json instead of restating a number that will go stale again.
  // This is a negative check, not a "pins the current one" check, so that a
  // pinned version can't creep back in unchecked.
  const text = readText(DOCS['skill-package/README.md']);
  assert.ok(!/\*\*Skill Version:\*\*/.test(text), 'skill-package/README.md restates a **Skill Version:** pin — point it at version.json instead');
  assert.ok(!/Captured from:/.test(text), 'skill-package/README.md restates a Captured from: pin — point it at version.json instead');
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

// The general lesson-count rule tolerates only "N lessons" / "N detailed lessons",
// and widening it is not safe: README legitimately says "50 original lessons" about
// chapters 1-8, which is history, not a current claim. So the About text -- one line
// containing only current claims, where a tolerant pattern IS safe -- gets its own
// assertion rather than a loosened shared one.
test('the GitHub About text states the current lesson and chapter counts', () => {
  const text = readText(DOCS['repo-description.txt']);
  const lessons = text.match(/(\d{2,4})\s+(?:[a-z][a-z-]*\s+)*lessons\b/);
  const chapters = text.match(/(\d{1,3})\s+chapters\b/);
  assert.ok(lessons, 'About text states no lesson count');
  assert.ok(chapters, 'About text states no chapter count');
  assert.strictEqual(lessons[1], String(version.lessons_count),
    `About text says ${lessons[1]} lessons but version.json says ${version.lessons_count}`);
  assert.strictEqual(chapters[1], String(version.chapters_count),
    `About text says ${chapters[1]} chapters but version.json says ${version.chapters_count}`);
});

test('the GitHub About text is a single line within GitHub\'s 350-char limit', () => {
  const text = readText(DOCS['repo-description.txt']);
  assert.ok(!text.trimEnd().includes('\n'), 'repo-description.txt must be a single line');
  assert.ok(
    text.trim().length <= 350,
    `repo description is ${text.trim().length} chars; GitHub truncates above 350`,
  );
});
