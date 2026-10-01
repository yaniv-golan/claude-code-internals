'use strict';
/**
 * corpus-ranking.test.js — every assertion about how the REAL corpus ranks, run from
 * one table (ranking-cases.json), with one guard over all of it.
 *
 * The retrieval eval (evals/retrieval/) splits lessons into dev and holdout, and holdout
 * is never tuned against. A hard test that pins a lesson's rank is tuning, so the split
 * rule is: draw the random split, then move every lesson a case in ranking-cases.json
 * depends on to dev (evals/retrieval/lib.js applyHardTestRule). The guard below checks
 * the committed split (the gated question set, evals/retrieval/lib.js CURRENT_QUESTIONS) against the table: no case may name a holdout
 * lesson, and there is no exception list. Mechanics are tested on synthetic maps
 * elsewhere (keyword-match.test.js); a real-corpus ranking assertion belongs here.
 *
 * The cases themselves run in the shipped package too; only the guard needs evals/.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { IN_REPO, STANDALONE_SKIP, loadSplit } = require('./repo-context.js');
const { cases: CASES } = require('./ranking-cases.json');

const searchTop = (query, top = 1) => JSON.parse(execFileSync('node', [path.join(__dirname, '..', 'search.js'), query, '--json', `--top=${top}`],
  // CCI_NO_INDEX_CACHE: build the index in memory; tests never write the user's cache.
  { encoding: 'utf8', env: { ...process.env, CCI_NO_INDEX_CACHE: '1' } }));

test('ranking-cases.json is well formed', () => {
  assert.ok(Array.isArray(CASES) && CASES.length > 0);
  const seen = new Set();
  for (const c of CASES) {
    assert.strictEqual(typeof c.query, 'string', JSON.stringify(c));
    assert.ok(Number.isInteger(c.lesson), JSON.stringify(c));
    assert.ok(c.why, `"${c.query}" says why it exists`);
    assert.strictEqual(c.fused, undefined, `"${c.query}": search.js has one order; fused is gone`);
    assert.ok(c.within === undefined || (Number.isInteger(c.within) && c.within > 1), `"${c.query}": within is an integer > 1 or absent`);
    assert.ok(!seen.has(c.query), `"${c.query}" is listed twice`);
    seen.add(c.query);
  }
});

test('guard: no corpus ranking case names a holdout lesson', (t) => {
  if (!IN_REPO) { t.skip(STANDALONE_SKIP); return; }
  const { holdout } = loadSplit();
  const bad = CASES.filter((c) => holdout.has(c.lesson));
  assert.deepStrictEqual(bad.map((c) => `"${c.query}" -> L${c.lesson}`), [],
    'these cases assert holdout lessons: holdout lessons are reported, never asserted — move the lesson to dev with evals/retrieval/resplit.js (and cut a new baseline)');
});

for (const c of CASES) {
  test(`search.js ranks lesson id ${c.lesson} ${c.within ? `in the top ${c.within}` : 'first'} for "${c.query}"`, () => {
    if (c.key) {
      const topic = require('../../references/topic-index.json');
      assert.deepStrictEqual(topic.keyword_map[c.key], [c.lesson], `the key ${c.key} names lesson ${c.lesson}`);
    }
    const r = searchTop(c.query, c.within || 1);
    assert.ok(r.length, `no result for "${c.query}"`);
    if (c.within) assert.ok(r.some((x) => x.id === c.lesson), `L${c.lesson} not in the top ${c.within}: ${r.map((x) => x.id)}`);
    else assert.strictEqual(r[0].id, c.lesson);
  });
}
