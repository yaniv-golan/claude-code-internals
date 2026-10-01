'use strict';
/**
 * keyword-match.test.js — the keyword layer's matching rule and its
 * specificity-weighted ranking (lib/keyword-match.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const K = require('../lib/keyword-match.js');
const { tokenizeQuery } = require('../lib/tfidf-index.js');

const kind = (key, token, opts) => K.hitKind(K.compileKey(key, opts), token);

// Mechanics only, on synthetic maps. Assertions about how the real corpus ranks live in
// ranking-cases.json (run by corpus-ranking.test.js, which guards them against holdout).

test('hit kinds: whole key, word of a multi-word key, substring of at least 3 characters', () => {
  assert.strictEqual(kind('hooks', 'hooks'), 'whole');
  assert.strictEqual(kind('hook events not firing', 'firing'), 'word');
  assert.strictEqual(kind('hook events not firing', 'fir'), 'partial');
  assert.strictEqual(kind('retry budget', 're'), null, 'a 2-character token never matches inside a word');
  assert.strictEqual(kind('re attach', 're'), 'word', 'but still hits as a whole word');
  assert.strictEqual(kind('vm', 'vm'), 'whole');
});

test('identifier-shaped keys: exact forms only, except hand kebab phrases, which are word-hit', () => {
  assert.strictEqual(kind('CLAUDE_CODE_WORKSPACE_HOST_PATHS', 'path'), null);
  assert.strictEqual(kind('CLAUDE_CODE_WORKSPACE_HOST_PATHS', 'paths'), null, 'CAPS/snake identifiers are never word-hit');
  assert.strictEqual(kind('CLAUDE_CODE_WORKSPACE_HOST_PATHS', 'claudecodeworkspacehostpaths'), 'whole');
  assert.strictEqual(kind('projects-uuid-mount', 'mount'), 'word', 'a hand kebab phrase');
  assert.strictEqual(kind('projects-uuid-mount', 'mou'), null, 'never a substring');
  assert.strictEqual(kind('switch-session', 'session', { exactOnly: true }), null, 'a generated key is never a kebab phrase');
  assert.strictEqual(kind('Skill-PreToolUse-hook', 'hook'), null, 'mixed case is an identifier, not a phrase');
});

test('a key\'s joined form drops every non-alphanumeric character, so slash and path keys are reachable', () => {
  for (const [key, query] of [['/skill-doctor', '/skill-doctor'], ['/skill-doctor', 'skill-doctor'], ['ui/download-file', 'ui/download-file'],
    ['ui/download-file', 'download-file'], ['anthropic:attach-files', 'anthropic:attach-files'], ['claude-code-releases/rc', 'claude-code-releases/rc']]) {
    const ck = K.compileKey(key);
    assert.ok(tokenizeQuery(query).some((t) => K.hitKind(ck, t) === 'whole'), `${query} hits ${key}`);
  }
});

test('ranking: specificity, hit kind, token cap, one best hit per token, tie-breaks', () => {
  const N = 100;
  const rank = (map, q) => K.rankLessons(tokenizeQuery(q), map, N).map((r) => r.id);
  // a key naming one lesson outweighs a key naming five
  assert.deepStrictEqual(rank({ widget: [1, 2, 3, 4, 5], 'widget frame': [6] }, 'widget frame')[0], 6);
  // a whole-key hit outweighs a word hit outweighs a substring hit (same key specificity)
  assert.deepStrictEqual(rank({ gizmo: [3], 'gizmo tray': [2], gizmotron: [1] }, 'gizmo'), [3, 2, 1]);
  // no hit is worth more than the token is specific: a one-lesson key hit by a word that reaches many lessons
  const map = { cost: [9], get_session_cost: [10] };
  for (let i = 20; i < 40; i++) map[`cost of thing ${i}`] = [i];
  assert.deepStrictEqual(rank(map, 'get_session_cost')[0], 10);
  // many keys sharing one word do not outvote one precise key
  const many = { 'alpha one': [1], 'alpha two': [1], 'alpha three': [1], alphabeta: [2] };
  const r = K.rankLessons(['alpha'], many, N);
  assert.strictEqual(r.find((x) => x.id === 1).hits, 1);
  // exact score ties: best single hit, then tokens hit, then lowest id
  assert.deepStrictEqual(rank({ zed: [7, 5] }, 'zed'), [5, 7]);
  // a repeated query token counts once
  assert.deepStrictEqual(K.rankLessons(['zed', 'zed'], { zed: [1] }, N)[0].hits, 1);
});

// --- exact arithmetic (kills ln(N/n) for ln(1+N/n), and a missing 1e-9 rounding) ---------

test('specificity is ln(1 + N/n), scores are rounded to 1e-9', () => {
  const round9 = (x) => Math.round(x * 1e9) / 1e9;
  const N = 4;
  const [one] = K.rankLessons(['alpha'], { alpha: [1] }, N);
  assert.strictEqual(one.score, round9(Math.log(5)), 'a one-lesson key hit whole: ln(1 + 4/1)');
  assert.notStrictEqual(one.score, Math.log(5), 'the raw float is not returned');
  // a key naming every lesson still carries weight ln 2 (ln(N/n) would make it 0)
  const all = K.rankLessons(['beta'], { beta: [1, 2, 3, 4] }, N);
  assert.deepStrictEqual(all.map((r) => r.score), Array(4).fill(round9(Math.log(2))));
});

// --- ordering: score, then best single hit, then tokens hit, then lowest id -----------------

test('an exact score tie goes to the better single hit, not to more hits or the lower id', () => {
  // t1 'ppp': whole key of lesson 2, a word of lesson 1's key; t2 'rrr': a word of lesson 1's key
  // (and of lesson 3's, so both tokens reach 2 lessons). Lesson 1: 0.5a + 0.5a; lesson 2: a.
  const map = { ppp: [2], 'ppp qqq': [1], 'rrr sss': [1], 'rrr ttt': [3] };
  const r = K.rankLessons(['ppp', 'rrr'], map, 100);
  const [a, b] = [r.find((x) => x.id === 1), r.find((x) => x.id === 2)];
  assert.strictEqual(a.score, b.score, 'equal scores');
  assert.ok(b.best > a.best && a.hits > b.hits);
  assert.deepStrictEqual(r.slice(0, 2).map((x) => x.id), [2, 1]);
});

test('with equal score and best hit, more tokens hit wins over the lower id', () => {
  // Lesson 1: whole + whole (2a, best a, 2 hits); lesson 2: whole + word + word (2a, best a, 3 hits).
  const map = { aaa: [1, 2], bbb: [1], 'bbb zzz': [2], 'ccc yyy': [2], 'ccc xxx': [3] };
  const r = K.rankLessons(['aaa', 'bbb', 'ccc'], map, 100);
  const [a, b] = [r.find((x) => x.id === 1), r.find((x) => x.id === 2)];
  assert.strictEqual(a.score, b.score);
  assert.strictEqual(a.best, b.best);
  assert.deepStrictEqual([a.hits, b.hits], [2, 3]);
  assert.deepStrictEqual(r.slice(0, 2).map((x) => x.id), [2, 1]);
});

test('a tie on score, best hit and tokens goes to the lesson with more keys hit, then the lower id', () => {
  // `hooks` names both lessons; lesson 2 also has two weaker keys the token hits, which cannot raise its
  // score (one best hit per token) but say it is more about hooks than lesson 1 is.
  const map = { hooks: [1, 2], 'session hooks': [2], 'http hooks': [2] };
  const r = K.rankLessons(['hooks'], map, 100);
  assert.deepStrictEqual(r.map((x) => [x.id, x.keys]), [[2, 3], [1, 1]]);
  assert.strictEqual(r[0].score, r[1].score);
  // equal key counts fall through to the lower id
  assert.deepStrictEqual(K.rankLessons(['hooks'], { hooks: [1, 2] }, 100).map((x) => x.id), [1, 2]);
});

test('a hand kebab key counts in proportion to the query words it covers', () => {
  // same key and token specificity; 'alpha' covers 1 of 3 content words of the kebab key
  const r = K.rankLessons(['alpha'], { 'alpha-beta-gamma': [1], 'alpha delta': [2] }, 100);
  assert.deepStrictEqual(r.map((x) => x.id), [2, 1]);
  assert.ok(Math.abs(r[1].score * 3 - r[0].score) < 1e-8);
});

// --- generated phrases (vocabulary keys): content words only --------------------------

test('contraction fragments: the stem before \'t and the word after an apostrophe', () => {
  assert.deepStrictEqual([...K.contractionFragments("why doesn't it fire, you're sure it won't? can’t tell")].sort(),
    ['can', 'doesn', 're', 't', 'won']);
  assert.deepStrictEqual([...K.contractionFragments("the 'hooks' setting")], [], 'a quoted word is not a fragment');
});

test('a vocabulary phrase is hit by its content words only: no contraction stems, no substrings', () => {
  const phrase = "why doesn't the reminder fire";
  const exact = new Set([phrase, 'why are tool names hidden']);
  const map = { [phrase]: [1], 'why are tool names hidden': [2], 'hook exit code': [3] };
  const rank = (q) => K.rankLessons(tokenizeQuery(q), map, 100, exact, q).map((r) => r.id);
  assert.deepStrictEqual(rank("hook doesn't work"), [3], 'doesn is a contraction stem, not content');
  assert.deepStrictEqual(rank('doesn'), [], 'not even typed on its own: the key side drops it too');
  assert.deepStrictEqual(rank('reminder'), [1]);
  assert.deepStrictEqual(rank('name'), [], 'no substring credit on a generated phrase');
  // the same keys written by hand keep their word and substring hits
  const hand = (q) => K.rankLessons(tokenizeQuery(q), map, 100, new Set(), q).map((r) => r.id);
  assert.deepStrictEqual(hand('doesn'), [1]);
  assert.deepStrictEqual(hand('name'), [2]);
  // hitKind is unchanged (prepare-lessons.js's collision rule relies on it)
  assert.strictEqual(K.hitKind(K.compileKey(phrase, { exactOnly: true }), 'doesn'), 'word');
});

// --- compound parts -----------------------------------------------------------------

test('a word typed only inside a compound identifier never ties the identifier itself', () => {
  const q = 'CLAUDE_SECURESTORAGE_CONFIG_DIR';
  assert.deepStrictEqual([...K.queryStructure(q).parts].sort(), ['claude', 'config', 'dir', 'securestorage']);
  assert.deepStrictEqual([...K.queryStructure('config for CLAUDE_CONFIG_DIR').parts].sort(), ['claude', 'dir'], 'config is also typed alone');
  // the part 'securestorage' hits another lesson's key whole; lowest id no longer decides
  const map = { claude_securestorage_config_dir: [2], 'secure-storage': [1] };
  const r = K.rankLessons(tokenizeQuery(q), map, 100, new Set(), q);
  assert.deepStrictEqual(r.map((x) => x.id), [2, 1]);
  assert.ok(Math.abs(r[1].score * 2 - r[0].score) < 1e-8);
  // without the query text there are no parts (the old behaviour: an exact tie)
  assert.strictEqual(K.rankLessons(tokenizeQuery(q), map, 100)[0].id, 1);
});

// --- fused order (search.js) ------------------------------------------------------

test('fused order: RRF score, then keyword score, then TF-IDF score, then lowest id', () => {
  const S = require('../search.js');
  // Entries are built by reciprocalRankFusion(), as search() builds them: fusedOrder
  // compares its exact rrfNum/rrfDen, never the display float.
  const order = (kw, tf) => {
    const fused = S.reciprocalRankFusion(kw, tf, 60);
    return [...fused].map(([id, e]) => ({ id, ...e })).sort(S.fusedOrder).map((x) => x.id);
  };
  // ranks 1+2 vs 2+1 are an exact RRF tie
  const fused = S.reciprocalRankFusion([{ id: 1, score: 3 }, { id: 2, score: 3 }], [{ id: 2, score: 0.4 }, { id: 1, score: 0.2 }], 60);
  const e = (id) => ({ id, ...fused.get(id) });
  assert.strictEqual(e(1).rrfScore, e(2).rrfScore);
  assert.deepStrictEqual([e(1).rrfNum, e(1).rrfDen], [e(2).rrfNum, e(2).rrfDen]);
  assert.deepStrictEqual([e(1), e(2)].sort(S.fusedOrder).map((x) => x.id), [2, 1], 'equal keyword scores: TF-IDF decides');
  // keyword score first (ranks 1+2 vs 2+1 again, keyword scores differ)
  assert.deepStrictEqual(order([{ id: 1, score: 1 }, { id: 2, score: 2 }], [{ id: 2, score: 0.1 }, { id: 1, score: 0.9 }]), [2, 1], 'keyword score first');
  // then lowest id: id 2 at keyword rank 1 and id 1 at TF-IDF rank 1, both scores 0
  assert.deepStrictEqual(order([{ id: 2, score: 0 }], [{ id: 1, score: 0 }]), [1, 2], 'then lowest id');
  assert.deepStrictEqual(order([{ id: 1, score: 0 }], [{ id: 2, score: 0 }]), [1, 2]);
  // RRF score first: keyword rank 1 beats keyword rank 2 whatever the keyword scores
  assert.deepStrictEqual(order([{ id: 2, score: 0 }, { id: 1, score: 9 }], []), [2, 1], 'RRF score first');
});

test('keyword-first order (the default): keyword results by keyword rank, then TF-IDF-only by TF-IDF rank', () => {
  const S = require('../search.js');
  const order = (kw, tf) => {
    const fused = S.reciprocalRankFusion(kw, tf, 60);
    return [...fused].map(([id, e]) => ({ id, ...e })).sort(S.keywordFirstOrder).map((x) => x.id);
  };
  // lesson 3 is TF-IDF #1 and keyword #2: keyword rank decides; it would win under RRF
  const kw = [{ id: 1, score: 2 }, { id: 3, score: 2 }];
  const tf = [{ id: 3, score: 0.9 }, { id: 5, score: 0.8 }, { id: 1, score: 0.1 }, { id: 4, score: 0.05 }];
  assert.deepStrictEqual(order(kw, tf), [1, 3, 5, 4], 'keyword order, then TF-IDF-only lessons in TF-IDF order');
  const fused = S.reciprocalRankFusion(kw, tf, 60);
  assert.deepStrictEqual([...fused].map(([id, e]) => ({ id, ...e })).sort(S.fusedOrder).map((x) => x.id)[0], 3, 'RRF puts lesson 3 first');
  // a TF-IDF-only lesson never outranks a keyword result, however high its TF-IDF rank
  assert.deepStrictEqual(order([{ id: 9, score: 0.1 }], [{ id: 2, score: 1 }]), [9, 2]);
  assert.deepStrictEqual(order([], [{ id: 2, score: 1 }, { id: 1, score: 0.5 }]), [2, 1], 'no keyword results: TF-IDF order');
});

test('fused order: an exact RRF tie of non-swapped ranks is a tie, whatever the float sums say', () => {
  const S = require('../search.js');
  // 1/(60+30) + 1/(60+18) = 168/7020 = 14/585 and 1/(60+57) + 1/(60+5) = 182/7605 = 14/585,
  // but as floats 1/90 + 1/78 < 1/117 + 1/65 in the last bit.
  assert.strictEqual(1 / 90 + 1 / 78 < 1 / 117 + 1 / 65, true, 'the float sums differ (else this fixture tests nothing)');
  const filler = (n, from) => Array.from({ length: n }, (_, i) => ({ id: from + i, score: 0.5 }));
  // lesson 1: keyword rank 30, TF-IDF rank 18, keyword score 2; lesson 2: keyword rank 57, TF-IDF rank 5, keyword score 1
  const kw = [...filler(29, 100), { id: 1, score: 2 }, ...filler(26, 200), { id: 2, score: 1 }];
  const tf = [...filler(4, 300), { id: 2, score: 0.3 }, ...filler(12, 400), { id: 1, score: 0.3 }];
  const fused = S.reciprocalRankFusion(kw, tf, 60);
  const [a, b] = [{ id: 1, ...fused.get(1) }, { id: 2, ...fused.get(2) }];
  assert.deepStrictEqual([a.keywordRank, a.tfidfRank, b.keywordRank, b.tfidfRank], [30, 18, 57, 5]);
  assert.deepStrictEqual([a.rrfNum, a.rrfDen], [14, 585]);
  assert.deepStrictEqual([b.rrfNum, b.rrfDen], [14, 585]);
  assert.ok(a.rrfScore < b.rrfScore, 'the display floats disagree');
  assert.deepStrictEqual([b, a].sort(S.fusedOrder).map((x) => x.id), [1, 2], 'the tie goes to the higher keyword score');
});
