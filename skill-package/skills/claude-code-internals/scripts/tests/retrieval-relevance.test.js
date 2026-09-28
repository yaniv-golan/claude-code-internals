'use strict';
/**
 * retrieval-relevance.test.js — acceptable-answer sets (questions-v2+):
 * evals/retrieval/gen-relevance.js (identifier rule, judge path) and the
 * run.js / lib.js scoring that reads them.
 *
 * evals/ is not part of the shipped skill package, so every case SKIPS when
 * evals/retrieval/ is absent. No case calls a model: the judge is a stub.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..', '..', '..', '..');
const EVALS = path.join(REPO, 'evals', 'retrieval');
const GEN_REL = path.join(EVALS, 'gen-relevance.js');
const PRESENT = fs.existsSync(GEN_REL) && fs.existsSync(path.join(EVALS, 'run.js'));
const SKIP = 'evals/retrieval/ not present (expected in the shipped skill package zip)';

const SCRATCH = [];
test.after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });
function scratch() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-relevance-'));
  SCRATCH.push(d);
  return d;
}
const R = (ids) => ids.map((id) => ({ id }));

// --- metrics -----------------------------------------------------------------------

test('graded nDCG@5: the source alone reproduces the binary v1 value at every rank', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const lib = require(path.join(EVALS, 'lib.js'));
  for (let rank = 1; rank <= 7; rank++) {
    const ids = [90, 91, 92, 93, 94, 95, 96];
    ids[rank - 1] = 7;
    assert.strictEqual(lib.gradedNdcgAt5(R(ids), { 7: 2 }), lib.ndcgAt5(rank), `rank ${rank}`);
  }
});

test('graded nDCG@5: linear gains over the ideal ordering', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const lib = require(path.join(EVALS, 'lib.js'));
  const rel = { 1: 2, 2: 1 };
  assert.strictEqual(lib.gradedNdcgAt5(R([1, 2, 3]), rel), 1);
  // Partial first, source second: (1/1 + 2/log2 3) / (2/1 + 1/log2 3).
  const want = (1 + 2 / Math.log2(3)) / (2 + 1 / Math.log2(3));
  assert.ok(Math.abs(lib.gradedNdcgAt5(R([2, 1, 3]), rel) - want) < 1e-12);
  assert.strictEqual(lib.gradedNdcgAt5(R([3, 4, 5, 6, 8, 1]), rel), 0);
});

test('scoreWithRelevant: rank is the first acceptable lesson; top1 names source vs other', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const run = require(path.join(EVALS, 'run.js'));
  const q = { qid: 'id-1', stratum: 'identifier', split: 'dev', lesson_id: 5, relevant: { 5: 2, 9: 1 } };
  const other = run.scoreWithRelevant(q, R([3, 9, 5]), null);
  assert.deepStrictEqual([other.rank, other.rank_source, other.top1, other.n_acceptable], [2, 3, 'none', 2]);
  assert.strictEqual(other.rr, 1 / 2);
  const partialFirst = run.scoreWithRelevant(q, R([9, 5]), null);
  assert.deepStrictEqual([partialFirst.rank, partialFirst.rank_source, partialFirst.top1], [1, 2, 'other_acceptable']);
  const src = run.scoreWithRelevant(q, R([5, 9]), null);
  assert.deepStrictEqual([src.rank, src.top1], [1, 'source']);
  const miss = run.scoreWithRelevant(q, R([1, 2]), null);
  assert.deepStrictEqual([miss.rank, miss.rr, miss.ndcg5, miss.rank_source], [null, 0, 0, null]);
  const b = run.top1Breakdown([other, partialFirst, src]);
  assert.deepStrictEqual(b['identifier|dev'], { n: 3, source: 1, other_acceptable: 1, none: 1, mean_acceptable: 2 });
});

// --- baseline comparison -------------------------------------------------------------

function gradedReport(rank, relevance = true) {
  const q = { qid: 'id-1', stratum: 'identifier', split: 'dev', lesson_id: 5, rank, rr: rank ? 1 / rank : 0, ndcg5: 1, error: null };
  return {
    questions_source: { version: 2, seed: 1, model: 'm' }, top: 20,
    ...(relevance ? { relevance: 'x', waivers: [] } : {}),
    by_stratum_split: { 'identifier|dev': { n: 1, mrr: q.rr, ndcg5: 1 } },
    queries: { lesson: [q], state: [], negative: [] },
  };
}

test('compareToBaseline: the top-1 rule is "an acceptable lesson is first"', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const run = require(path.join(EVALS, 'run.js'));
  const loose = { ...run.DEFAULT_THRESHOLDS, mrr_ndcg_drop: 1 };
  // rank = first-acceptable rank, so another acceptable lesson at 1 keeps top-1.
  assert.strictEqual(run.compareToBaseline(gradedReport(1), gradedReport(1), loose).ok, true);
  const lost = run.compareToBaseline(gradedReport(2), gradedReport(1), loose);
  assert.deepStrictEqual(lost.failures, ['[id-1] "identifier" lost top-1 (1 -> 2)']);
  // A report and a baseline that disagree on the scoring mode never compare.
  const mixed = run.compareToBaseline(gradedReport(1, false), gradedReport(1), loose);
  assert.strictEqual(mixed.ok, false);
  assert.match(mixed.failures[0], /scoring mode mismatch/);
});

test('v1 questions (no relevant) keep the v1 record and report shape', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const run = require(path.join(EVALS, 'run.js'));
  const v1 = JSON.parse(fs.readFileSync(path.join(EVALS, 'questions-v1.json'), 'utf8'));
  const q = v1.questions.find((x) => x.stratum === 'identifier');
  const rec = run.scoreLessonQuestion(q, 20);
  assert.deepStrictEqual(Object.keys(rec), ['qid', 'stratum', 'split', 'lesson_id', 'rank', 'rr', 'ndcg5', 'error']);
  const report = run.buildReport({ version: 1, seed: 1, model: 'm', questions: [q] }, { top: 20 });
  for (const k of ['relevance', 'waivers', 'top1_breakdown']) assert.ok(!(k in report), k);
  // The same question with only its source as acceptable scores identically.
  const graded = run.scoreLessonQuestion({ ...q, relevant: { [q.lesson_id]: 2 } }, 20);
  assert.deepStrictEqual([graded.rank, graded.rr, graded.ndcg5], [rec.rank, rec.rr, rec.ndcg5]);
});

// --- gen-relevance: identifier rule ---------------------------------------------------

test('identifier rule: homed keys and mention counts >= the source lesson', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_REL);
  const texts = new Map([
    [1, 'The `.consolidate-lock` file. Also `.consolidate-lock` again and `FOO_BAR_BAZ`.'], // source: 2 mentions
    [2, 'Mentions `.consolidate-lock` three times: `.consolidate-lock`, `.consolidate-lock`.'],
    [3, 'Mentions `.consolidate-lock` once.'],
    [4, 'Nothing relevant here.'],
    [5, 'Homed only by key.'],
    [6, 'Uses FOO_BAR_BAZ once.'],
  ]);
  const positions = G.buildPositions(texts);
  const keyIndex = G.buildKeyIndex({ 'consolidate-lock': [5], unrelated: [4] });
  const r = G.identifierRelevance('How does the `.consolidate-lock` file work, and `notInSource`?', 1, positions, keyIndex);
  assert.deepStrictEqual(r.relevant, { 1: 2, 2: 1, 5: 1 });
  assert.deepStrictEqual(r.basis.tokens, [{ token: 'consolidate-lock', source_count: 2, homed: [5] }]);
  assert.deepStrictEqual(r.basis.extra, { 2: ['mentions:consolidate-lock:3>=2'], 5: ['homed:consolidate-lock'] });
  // A CAPS identifier: L6 mentions it as often as the source (1 >= 1).
  assert.deepStrictEqual(G.identifierRelevance('What is FOO_BAR_BAZ?', 1, positions, keyIndex).relevant, { 1: 2, 6: 1 });
  // No identifier shared with the source: the source alone.
  assert.deepStrictEqual(G.identifierRelevance('What does `notInSource` do?', 1, positions, keyIndex).relevant, { 1: 2 });
  // A camelCase token is looked up under its separator key form too.
  const camel = G.identifierRelevance('What is `switchSession`?', 7, G.buildPositions(new Map([[7, 'Calls `switchSession`.']])), G.buildKeyIndex({ 'switch-session': [8] }));
  assert.deepStrictEqual(camel.relevant, { 7: 2, 8: 1 });
});

test('candidate pool: union of the layers top 10 plus the source, with provenance', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_REL);
  const fused = [
    { id: 10, keyword_rank: 1, tfidf_rank: null },
    { id: 11, keyword_rank: null, tfidf_rank: 1 },
    ...Array.from({ length: 12 }, (_, i) => ({ id: 20 + i, keyword_rank: null, tfidf_rank: null })),
    { id: 40, keyword_rank: 3, tfidf_rank: 30 }, // fused rank 15, keyword top 10
  ];
  const pool = G.poolFrom(fused, [{ id: 50 }], 99, 10);
  const byId = Object.fromEntries(pool.map((p) => [p.id, p.layers]));
  assert.deepStrictEqual(byId[10], ['fused', 'keyword']);
  assert.deepStrictEqual(byId[11], ['fused', 'tfidf-search']);
  assert.deepStrictEqual(byId[40], ['keyword']);
  assert.deepStrictEqual(byId[50], ['tfidf-semantic']);
  assert.deepStrictEqual(byId[99], ['source']);
  assert.ok(!(30 in byId) && !(31 in byId), 'fused ranks 11+ are out');
  assert.deepStrictEqual(pool.map((p) => p.id), [...pool.map((p) => p.id)].sort((a, b) => a - b));
});

// --- gen-relevance: judge path on a stub --------------------------------------------

test('gen-relevance: stub judge, resumable checkpoint, source always grade 2, never overwrites', async (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_REL);
  const lib = require(path.join(EVALS, 'lib.js'));
  const ids = lib.loadTopicIndex().lessons.map((l) => l.id);
  const [a, b, c] = ids;
  const dir = scratch();
  const from = path.join(dir, 'questions-v1.json');
  fs.writeFileSync(from, JSON.stringify({
    version: 1, seed: 1, model: 'gen', prompt_version: 'p', generated_at: 'g', split: { dev: [a, b, c], holdout: [] }, dropped: [],
    questions: [
      { qid: 'id-0001', stratum: 'identifier', lesson_id: a, registry_id: null, split: 'dev', text: 'What is `nothingSharedHere`?' },
      { qid: 'pl-0002', stratum: 'plain', lesson_id: a, registry_id: null, split: 'dev', text: 'plain one' },
      { qid: 'pl-0003', stratum: 'plain', lesson_id: b, registry_id: null, split: 'dev', text: 'plain two' },
      { qid: 'st-0004', stratum: 'state', lesson_id: null, registry_id: 'x', split: 'dev', text: 'state q' },
    ],
  }));
  const pools = (text, src) => [{ id: a, layers: ['fused'] }, { id: b, layers: ['keyword'] }, { id: c, layers: ['tfidf-semantic'] }]
    .map((p) => (p.id === src ? { ...p, layers: [...p.layers, 'source'] } : p));
  const calls = [];
  // The judge says "no" to every source lesson and "yes" to lesson c; "plain two" fails once.
  let failTwo = true;
  const callJudge = async (prompt) => {
    const question = prompt.split('"""')[1].trim();
    calls.push(question);
    if (question === 'plain two' && failTwo) { failTwo = false; return JSON.stringify({ result: 'not json' }); }
    const labels = [...prompt.matchAll(/^=== (C\d+) ===$/gm)].map((m) => m[1]);
    const verdicts = labels.map((l, i) => ({ c: l, answers: i === 2, reason: `r${l}` }));
    return JSON.stringify({ result: JSON.stringify({ verdicts }) });
  };
  const opts = G.parseArgs(['--from', from, '--version', '2', '--out-dir', dir, '--concurrency', '1']);

  const first = await G.generate(opts, { callJudge, pools });
  assert.deepStrictEqual([first.complete, first.failures, first.remaining], [false, 1, 1]);
  assert.ok(fs.existsSync(path.join(dir, 'questions-v2.json.partial')));
  assert.ok(!fs.existsSync(path.join(dir, 'questions-v2.json')));

  const second = await G.generate(opts, { callJudge, pools });
  assert.strictEqual(second.complete, true);
  assert.deepStrictEqual(calls, ['plain one', 'plain two', 'plain two'], 'a resume retries only the failure');
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'questions-v2.json'), 'utf8'));
  assert.ok(!fs.existsSync(path.join(dir, 'questions-v2.json.partial')));
  assert.strictEqual(out.version, 2);
  assert.deepStrictEqual(out.questions.map((q) => [q.qid, q.text, q.split]), [
    ['id-0001', 'What is `nothingSharedHere`?', 'dev'], ['pl-0002', 'plain one', 'dev'],
    ['pl-0003', 'plain two', 'dev'], ['st-0004', 'state q', 'dev'],
  ]);
  const byQid = Object.fromEntries(out.questions.map((q) => [q.qid, q]));
  assert.deepStrictEqual(byQid['id-0001'].relevant, { [a]: 2 });
  assert.deepStrictEqual(byQid['pl-0002'].relevant, { [a]: 2, [c]: 1 });
  assert.deepStrictEqual(byQid['pl-0003'].relevant, { [b]: 2, [c]: 1 });
  assert.strictEqual(byQid['pl-0002'].relevance_basis.verdicts.find((v) => v.id === a).answers, false, 'the source verdict is recorded as given');
  assert.ok(!('relevant' in byQid['st-0004']));
  assert.strictEqual(out.relevance.judge.model, G.DEFAULT_JUDGE_MODEL);
  assert.strictEqual(out.relevance.judge.prompt_version, G.JUDGE_PROMPT_VERSION);
  assert.match(out.relevance.judge.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepStrictEqual(out.derived_from.version, 1);

  await assert.rejects(G.generate(opts, { callJudge, pools }), /already exists/);
});

test('gen-relevance: parseVerdicts rejects a missing, duplicate or unknown candidate', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_REL);
  const L = ['C1', 'C2'];
  assert.throws(() => G.parseVerdicts({ verdicts: [{ c: 'C1', answers: true }] }, L), /no verdict for C2/);
  assert.throws(() => G.parseVerdicts({ verdicts: [{ c: 'C1', answers: true }, { c: 'C1', answers: false }] }, L), /duplicate/);
  assert.throws(() => G.parseVerdicts({ verdicts: [{ c: 'C3', answers: true }] }, L), /unknown/);
  assert.throws(() => G.parseVerdicts({ verdicts: [{ c: 'C1', answers: 'yes' }] }, L), /malformed/);
  assert.strictEqual(G.parseVerdicts({ verdicts: [{ c: 'C2', answers: false }, { c: 'C1', answers: true }] }, L).get('C1').answers, true);
});

test('gen-relevance: the judge prompt does not reveal which candidate is the source', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_REL);
  const cands = [{ id: 1, label: 'C1', excerpt: 'Title: A', layers: ['source', 'fused'] }, { id: 2, label: 'C2', excerpt: 'Title: B', layers: ['keyword'] }];
  const p = G.buildJudgePrompt('q?', cands);
  assert.doesNotMatch(p, /source|fused|layer/i);
  assert.strictEqual(p, G.buildJudgePrompt('q?', cands.map((c) => ({ ...c, layers: [] }))));
});

test('baseline-v2.json uses v1\'s thresholds, has an empty waiver list and scores acceptable-answer sets', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const p2 = path.join(EVALS, 'baseline-v2.json');
  if (!fs.existsSync(p2)) { t.skip('baseline-v2.json not recorded'); return; }
  const v1 = JSON.parse(fs.readFileSync(path.join(EVALS, 'baseline-v1.json'), 'utf8'));
  const v2 = JSON.parse(fs.readFileSync(p2, 'utf8'));
  assert.deepStrictEqual(v2.thresholds, v1.thresholds);
  assert.deepStrictEqual(v2.waivers, []);
  assert.strictEqual(v2.questions_source.version, 2);
  assert.ok(v2.relevance && v2.top1_breakdown);
  assert.ok(v2.queries.lesson.every((q) => q.top1 !== undefined));
});

test('questions-v2.json keeps v1 texts, qids, strata and split, and every gated question has its source at grade 2', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const p2 = path.join(EVALS, 'questions-v2.json');
  if (!fs.existsSync(p2)) { t.skip('questions-v2.json not generated'); return; }
  const v1 = JSON.parse(fs.readFileSync(path.join(EVALS, 'questions-v1.json'), 'utf8'));
  const v2 = JSON.parse(fs.readFileSync(p2, 'utf8'));
  assert.deepStrictEqual(v2.split, v1.split);
  const strip = (q) => ({ qid: q.qid, stratum: q.stratum, lesson_id: q.lesson_id, registry_id: q.registry_id, split: q.split, text: q.text });
  assert.deepStrictEqual(v2.questions.map(strip), v1.questions.map(strip));
  for (const q of v2.questions) {
    if (q.stratum === 'identifier' || q.stratum === 'plain') {
      assert.strictEqual(q.relevant[q.lesson_id], 2, q.qid);
      assert.ok(Object.entries(q.relevant).every(([id, g]) => Number(id) === q.lesson_id || g === 1), q.qid);
    } else {
      assert.ok(!('relevant' in q), q.qid);
    }
  }
});
