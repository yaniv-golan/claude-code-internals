'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS = path.join(__dirname, '..');
const top = (query) => {
  const out = execFileSync('node', [path.join(SCRIPTS, 'search.js'), query], { encoding: 'utf8' });
  const m = out.match(/^ {2}1\. (.+?)\s+\(Lesson (\d+)\)/m);
  assert.ok(m, `no ranked result for ${query}`);
  return { title: m[1], lesson: Number(m[2]) };
};

// Identifiers with separators used to shatter into generic parts: CLAUDE_PLUGIN_ROOT
// became ['claude','plugin','root'] and matched most of the corpus; when_to_use became
// ['use']. These assert the joined-form tokens survive and reach the right lesson.
for (const [query, lesson] of [
  ['list_skills', 129],
  ['when_to_use', 88],
  ['tengu_saddle_lantern', 129],
  ['mcp__skills__list_skills', 129],
]) {
  test(`identifier query "${query}" ranks L${lesson} first`, () => {
    assert.strictEqual(top(query).lesson, lesson);
  });
}

// Guards the fix that made identifier-shaped keyword_map keys match exactly: with
// substring matching, the generic token 'path' hit every *_PATHS variable and dragged
// their lesson above the one actually about plugin bin/ on PATH.
test('natural-language queries are not displaced by identifier keys', () => {
  assert.strictEqual(top('plugin bin PATH').lesson, 173);
  assert.strictEqual(top('hooks not firing').lesson, 10);
  assert.strictEqual(top('compaction budget').lesson, 15);
});

// tokenize() is duplicated across three scripts and MUST stay identical -- the index and
// the query path have to agree or nothing matches. (STOP_WORDS deliberately differs:
// the query side additionally drops 'claude' and 'code'.)
test('the three tokenize() implementations remain byte-identical', () => {
  const grab = (f) => {
    const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
    const m = src.match(/function tokenize\(text\) \{[\s\S]*?\n\}/);
    assert.ok(m, `no tokenize() in ${f}`);
    return m[0];
  };
  const a = grab('build-rvf-index.js');
  assert.strictEqual(grab('search.js'), a);
  assert.strictEqual(grab('semantic-search.js'), a);
});
