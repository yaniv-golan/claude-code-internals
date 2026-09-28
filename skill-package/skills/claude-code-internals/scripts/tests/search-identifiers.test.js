'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS = path.join(__dirname, '..');
const top = (query) => {
  // CCI_NO_INDEX_CACHE: build the index in memory; tests never write the user's cache.
  const out = execFileSync('node', [path.join(SCRIPTS, 'search.js'), query],
    { encoding: 'utf8', env: { ...process.env, CCI_NO_INDEX_CACHE: '1' } });
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

// One tokenizer, in lib/tfidf-index.js, serves the index and both query paths -- the
// index and the query side have to agree or nothing matches. It used to be three
// byte-identical copies guarded by a text comparison. STOP_WORDS deliberately differ:
// the query side additionally drops 'claude' and 'code', while the index keeps them
// (query expansion reverse-prefix-matches against the vocabulary, so they must be in it).
test('search.js and semantic-search.js use the shared tokenizer; stop sets differ only by claude/code', () => {
  const lib = require('../lib/tfidf-index.js');
  for (const f of ['search.js', 'semantic-search.js']) {
    const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
    assert.match(src, /require\('\.\/lib\/tfidf-index\.js'\)/, `${f} does not load lib/tfidf-index.js`);
    assert.doesNotMatch(src, /function tokenize\(/, `${f} carries its own tokenize() again`);
  }
  const extra = [...lib.QUERY_STOP_WORDS].filter((w) => !lib.INDEX_STOP_WORDS.has(w)).sort();
  assert.deepStrictEqual(extra, ['claude', 'code']);
  assert.ok([...lib.INDEX_STOP_WORDS].every((w) => lib.QUERY_STOP_WORDS.has(w)));
  assert.deepStrictEqual(lib.tokenizeQuery('CLAUDE_PLUGIN_ROOT code path'), ['claudepluginroot', 'plugin', 'root', 'path']);
  assert.ok(lib.buildIndex(JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'references', 'topic-index.json'), 'utf8'))).vocabulary.includes('code'));
});
