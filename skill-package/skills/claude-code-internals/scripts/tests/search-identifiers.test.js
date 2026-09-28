'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS = path.join(__dirname, '..');
// The identifier and natural-language ranking cases that lived here (list_skills,
// when_to_use, tengu_saddle_lantern, mcp__skills__list_skills, plugin bin PATH, ...) are in
// ranking-cases.json, run by corpus-ranking.test.js with the one holdout guard.

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
