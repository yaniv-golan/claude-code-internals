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
// Skip only in the shipped skill package; in the repository a missing eval
// file fails (see repo-context.js), so leaving it out of a commit can't
// silently remove these checks.
const { IN_REPO, STANDALONE_SKIP } = require('./repo-context.js');
const PRESENT = IN_REPO;
const SKIP = STANDALONE_SKIP;

test('repository checkout has the eval files these tests need', (t) => {
  if (!IN_REPO) { t.skip(SKIP); return; }
  for (const f of ['gen-relevance.js', 'run.js']) assert.ok(fs.existsSync(path.join(EVALS, f)), `evals/retrieval/${f} is missing`);
});

const SCRATCH = [];
test.after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });
function scratch() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-relevance-'));
  SCRATCH.push(d);
  return d;
}
const R = (ids) => ids.map((id) => ({ id }));
/** Every committed evals/retrieval/questions-v*.json whose split records the split rule. */
function ruleSets() {
  return fs.readdirSync(EVALS).filter((n) => /^questions-v\d+\.json$/.test(n)).map((n) => path.join(EVALS, n))
    .filter((f) => { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return !!(d.split && d.split.rule); });
}

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
  const ranked = [
    { id: 10, keyword_rank: 1, tfidf_rank: null },
    { id: 11, keyword_rank: null, tfidf_rank: 1 },
    ...Array.from({ length: 12 }, (_, i) => ({ id: 20 + i, keyword_rank: null, tfidf_rank: null })),
    { id: 40, keyword_rank: 3, tfidf_rank: 30 }, // search.js rank 15, keyword top 10
  ];
  const pool = G.poolFrom(ranked, [{ id: 50 }], 99, 10);
  const byId = Object.fromEntries(pool.map((p) => [p.id, p.layers]));
  assert.deepStrictEqual(byId[10], ['keyword', 'search']);
  assert.deepStrictEqual(byId[11], ['search', 'tfidf-search']);
  assert.deepStrictEqual(byId[40], ['keyword']);
  assert.deepStrictEqual(byId[50], ['tfidf-semantic']);
  assert.deepStrictEqual(byId[99], ['source']);
  assert.ok(!(30 in byId) && !(31 in byId), 'search.js ranks 11+ are out');
  assert.deepStrictEqual(pool.map((p) => p.id), [...pool.map((p) => p.id)].sort((a, b) => a - b));
});

// --- gen-relevance: judge path on a stub --------------------------------------------

test('gen-relevance: stub judge, resumable checkpoint, source always grade 2, never overwrites', async (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_REL);
  const lib = require(path.join(EVALS, 'lib.js'));
  const ids = lib.loadTopicIndex().lessons.map((l) => l.id);
  const [a, b, c] = ids;
  const entry = lib.loadRegistry().entries.find((e) => e.provenance && e.provenance.length);
  const dir = scratch();
  const from = path.join(dir, 'questions-v1.json');
  fs.writeFileSync(from, JSON.stringify({
    version: 1, seed: 1, model: 'gen', prompt_version: 'p', generated_at: 'g', split: { dev: [a, b, c], holdout: [] }, dropped: [],
    questions: [
      { qid: 'id-0001', stratum: 'identifier', lesson_id: a, registry_id: null, split: 'dev', text: 'What is `nothingSharedHere`?' },
      { qid: 'pl-0002', stratum: 'plain', lesson_id: a, registry_id: null, split: 'dev', text: 'plain one' },
      { qid: 'pl-0003', stratum: 'plain', lesson_id: b, registry_id: null, split: 'dev', text: 'plain two' },
      { qid: 'st-0004', stratum: 'state', lesson_id: null, registry_id: entry.id, split: 'dev', text: 'state q' },
      { qid: 'st-0005', stratum: 'state', lesson_id: null, registry_id: 'gone.entry', split_lesson_id: a, split: 'dev', text: 'state r' },
    ],
  }));
  const pools = (text, src) => [{ id: a, layers: ['search'] }, { id: b, layers: ['keyword'] }, { id: c, layers: ['tfidf-semantic'] }]
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
    ['pl-0003', 'plain two', 'dev'], ['st-0004', 'state q', 'dev'], ['st-0005', 'state r', 'dev'],
  ]);
  const byQid = Object.fromEntries(out.questions.map((q) => [q.qid, q]));
  // a source state question without split_lesson_id gets it once, from its entry's first
  // provenance lesson; one that has it keeps it (its registry entry is not looked up)
  assert.strictEqual(byQid['st-0004'].split_lesson_id, entry.provenance[0].lesson);
  assert.strictEqual(byQid['st-0005'].split_lesson_id, a);
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

test('gen-relevance: a lesson the source moved to dev and the rule no longer moves returns its questions to holdout', async (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_REL);
  const lib = require(path.join(EVALS, 'lib.js'));
  const hard = lib.loadHardTestLessons();
  const [a, b] = lib.loadTopicIndex().lessons.map((l) => l.id).filter((id) => !hard[id]);
  const dir = scratch();
  const from = path.join(dir, 'questions-v1.json');
  // The source moved lesson b to dev under a hard test that no longer exists.
  fs.writeFileSync(from, JSON.stringify({
    version: 1, seed: 1, model: 'gen', prompt_version: 'p', generated_at: 'g', dropped: [],
    split: { holdout: [], dev: [a, b], rule: lib.SPLIT_RULE, moved_to_dev: [{ lesson_id: b, reason: 'r', queries: ['gone'] }] },
    questions: [
      { qid: 'id-0001', stratum: 'identifier', lesson_id: b, registry_id: null, split: 'dev', text: 'What is `nothingSharedHere`?' },
      { qid: 'st-0002', stratum: 'state', lesson_id: null, registry_id: 'e', split_lesson_id: b, split: 'dev', text: 'state q' },
      { qid: 'id-0003', stratum: 'identifier', lesson_id: a, registry_id: null, split: 'dev', text: 'What is `alsoNothing`?' },
    ],
  }));
  const opts = G.parseArgs(['--from', from, '--version', '2', '--out-dir', dir, '--concurrency', '1']);
  const r = await G.generate(opts, { callJudge: async () => { throw new Error('no plain questions'); }, pools: () => [] });
  assert.strictEqual(r.complete, true);
  assert.deepStrictEqual([r.output.split.holdout, r.output.split.moved_to_dev], [[b], []]);
  assert.deepStrictEqual(r.output.questions.map((q) => [q.qid, q.split]), [['id-0001', 'holdout'], ['st-0002', 'holdout'], ['id-0003', 'dev']]);
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
  const cands = [{ id: 1, label: 'C1', excerpt: 'Title: A', layers: ['source', 'search'] }, { id: 2, label: 'C2', excerpt: 'Title: B', layers: ['keyword'] }];
  const p = G.buildJudgePrompt('q?', cands);
  assert.doesNotMatch(p, /source|layer/i); // layer names ('search', 'keyword') are ordinary words; the line below proves they don't leak
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

test('baseline-v3.json uses v2\'s thresholds, has no waivers, records the accepted drops and scores the current split', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const lib = require(path.join(EVALS, 'lib.js'));
  // baseline-v3 (kept for trend since baseline-v4), and the baseline it was accepted against
  const v3 = JSON.parse(fs.readFileSync(path.join(EVALS, 'baseline-v3.json'), 'utf8'));
  const v2 = JSON.parse(fs.readFileSync(path.join(EVALS, v3.accepted_vs_previous.vs), 'utf8'));
  const qs = JSON.parse(fs.readFileSync(path.join(EVALS, lib.CURRENT_QUESTIONS), 'utf8'));
  assert.deepStrictEqual(v3.thresholds, v2.thresholds);
  assert.deepStrictEqual(v3.waivers, []);
  assert.strictEqual(v3.questions_source.version, 2);
  assert.strictEqual(v3.questions_source.split_sha256, lib.splitHash(qs.split), 'baseline-v3 was cut under another split');
  assert.ok(v3.relevance && v3.top1_breakdown);
  const a = v3.accepted_vs_previous;
  assert.strictEqual(a.vs, 'baseline-v2.json');
  assert.strictEqual(a.accepted_by, 'maintainer');
  assert.match(a.deferred, /fusion/);
  const byQid = new Map(qs.questions.map((q) => [q.qid, q]));
  assert.ok(a.drops.length > 0);
  for (const d of a.drops) {
    assert.strictEqual(byQid.get(d.qid).split, d.split_v3, `${d.qid}: split_v3 is its current label`);
    assert.ok(d.rules.length > 0, d.qid);
  }
  // The same questions, with the labels the resplit changed (and only those).
  const labelsV2 = new Map(v2.queries.lesson.map((q) => [q.qid, q.split]));
  const changed = v3.queries.lesson.filter((q) => labelsV2.get(q.qid) !== q.split).map((q) => q.qid);
  assert.deepStrictEqual(v3.queries.lesson.map((q) => q.qid), v2.queries.lesson.map((q) => q.qid));
  const moved = new Set(qs.split.moved_to_dev.map((m) => m.lesson_id));
  assert.deepStrictEqual(changed, v3.queries.lesson.filter((q) => moved.has(q.lesson_id)).map((q) => q.qid));
});

test('the gated baseline (lib.js CURRENT_BASELINE) keeps its predecessor\'s thresholds and questions, has no waivers, and scores the current split', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const lib = require(path.join(EVALS, 'lib.js'));
  const cur = JSON.parse(fs.readFileSync(path.join(EVALS, lib.CURRENT_BASELINE), 'utf8'));
  const a = cur.accepted_vs_previous;
  assert.ok(a && a.vs && a.vs !== lib.CURRENT_BASELINE, 'the gated baseline names the baseline it was accepted against');
  const prev = JSON.parse(fs.readFileSync(path.join(EVALS, a.vs), 'utf8'));
  const qs = JSON.parse(fs.readFileSync(path.join(EVALS, lib.CURRENT_QUESTIONS), 'utf8'));
  assert.deepStrictEqual(cur.thresholds, prev.thresholds);
  assert.deepStrictEqual(cur.waivers, []);
  assert.strictEqual(cur.questions_source.version, qs.version);
  assert.strictEqual(cur.questions_source.split_sha256, lib.splitHash(qs.split), `${lib.CURRENT_BASELINE} was cut under another split`);
  assert.ok(cur.relevance && cur.top1_breakdown);
  assert.strictEqual(a.accepted_by, 'maintainer');
  assert.ok(a.reason, 'the accepted change is named');
  assert.deepStrictEqual(cur.queries.lesson.map((q) => q.qid), prev.queries.lesson.map((q) => q.qid));
});

// accepted_vs_previous names exactly the questions that fail a baseline vs the one it replaced
// (split labels equalised, so a resplit compares per question instead of being refused).
for (const name of ['baseline-v3.json', 'CURRENT_BASELINE']) {
  test(`${name} accepted_vs_previous names exactly the questions that fail it vs its predecessor`, (t) => {
    if (!PRESENT) { t.skip(SKIP); return; }
    const { compareToBaseline } = require(path.join(EVALS, 'run.js'));
    const lib = require(path.join(EVALS, 'lib.js'));
    const cur = JSON.parse(fs.readFileSync(path.join(EVALS, name === 'CURRENT_BASELINE' ? lib.CURRENT_BASELINE : name), 'utf8'));
    const prev = JSON.parse(fs.readFileSync(path.join(EVALS, cur.accepted_vs_previous.vs), 'utf8'));
    const label = new Map(cur.queries.lesson.map((q) => [q.qid, q.split]));
    const prevEq = { ...prev, queries: { ...prev.queries, lesson: prev.queries.lesson.map((q) => ({ ...q, split: label.get(q.qid) || q.split })) } };
    // Holdout drops are reported, not failed, since baseline-v5; an accepted drop
    // is recorded either way, so both lists are matched.
    const { failures, reported } = compareToBaseline(cur, prevEq, prev.thresholds);
    const perQ = new Map();
    for (const f of [...failures, ...reported]) {
      const m = f.match(/^\[([a-z]{2}-\d+)\] (.*)$/);
      if (m) (perQ.get(m[1]) || perQ.set(m[1], []).get(m[1])).push(m[2]);
    }
    assert.ok(!failures.some((f) => /version mismatch|split mismatch|scoring mode/.test(f)), failures.join('\n'));
    const accepted = cur.accepted_vs_previous.drops;
    assert.deepStrictEqual([...perQ.keys()].sort(), accepted.map((d) => d.qid).sort(), 'accepted drops differ from the failing questions');
    for (const d of accepted) assert.deepStrictEqual(perQ.get(d.qid).slice().sort(), d.rules.slice().sort(), `${d.qid}: rules`);
  });
}

test('the split rule: a random split, then every lesson a hard ranking test asserts is moved to dev', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const lib = require(path.join(EVALS, 'lib.js'));
  const hard = { 3: ['q3'], 9: ['q9'], 4: ['q4a', 'q4b'] };
  const r = lib.applyHardTestRule({ holdout: [1, 3, 4], dev: [2, 5] }, hard);
  assert.deepStrictEqual([r.holdout, r.dev], [[1], [2, 3, 4, 5]]);
  assert.deepStrictEqual(r.moved_to_dev.map((m) => [m.lesson_id, m.queries]), [[3, ['q3']], [4, ['q4a', 'q4b']]]);
  assert.strictEqual(r.rule, lib.SPLIT_RULE);
  assert.deepStrictEqual(lib.randomSplitOf(r), { holdout: [1, 3, 4], dev: [2, 5] }, 'the random split is recoverable');
  assert.deepStrictEqual(lib.applyHardTestRule(r, hard), r, 'idempotent');
  // a hard test dropped later: its lesson goes back to where the random split put it
  assert.deepStrictEqual(lib.applyHardTestRule(r, { 3: ['q3'] }).holdout, [1, 4]);
  // lesson 9 (a hard test's lesson in neither list, added after the split) is left alone
  assert.ok(!r.dev.includes(9) && !r.holdout.includes(9));
  // relabelling touches only the moved lessons' holdout questions; a state question
  // follows its recorded split_lesson_id (null: no lesson, never relabelled)
  const qs = [
    { qid: 'a', stratum: 'identifier', lesson_id: 3, split: 'holdout' }, { qid: 'b', stratum: 'plain', lesson_id: 1, split: 'holdout' },
    { qid: 'c', stratum: 'state', registry_id: 'e3', split_lesson_id: 3, split: 'holdout' }, { qid: 'd', stratum: 'state', registry_id: 'e1', split_lesson_id: 1, split: 'holdout' },
    { qid: 'e', stratum: 'negative', split: 'holdout' }, { qid: 'f', stratum: 'plain', lesson_id: 2, split: 'dev' },
    { qid: 'g', stratum: 'state', registry_id: 'e0', split_lesson_id: null, split: 'dev' },
  ];
  const moved = lib.relabelQuestions(qs, r);
  assert.deepStrictEqual(moved.map((q) => q.split), ['dev', 'holdout', 'dev', 'holdout', 'holdout', 'dev', 'dev']);
  // round trip: the hard test for lesson 3 is removed; its questions go back to holdout
  const back = lib.applyHardTestRule(r, {});
  assert.deepStrictEqual([back.holdout, back.dev], [[1, 3, 4], [2, 5]]);
  assert.deepStrictEqual(lib.relabelQuestions(moved, back, r).map((q) => q.split), qs.map((q) => q.split));
});

test('relabelQuestions: a state question without split_lesson_id fails loudly; the registry is never read', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const lib = require(path.join(EVALS, 'lib.js'));
  const r = lib.applyHardTestRule({ holdout: [1, 3], dev: [2] }, { 3: ['q3'] });
  const bare = [{ qid: 'st-1', stratum: 'state', registry_id: 'e3', split: 'holdout' }];
  assert.throws(() => lib.relabelQuestions(bare, r), /st-1: state question has no split_lesson_id/);
  // even when nothing moves: a set missing the field fails on every call
  assert.throws(() => lib.relabelQuestions(bare, { holdout: [1], dev: [2] }), /no split_lesson_id/);
  // the recorded lesson decides, whatever registry entry the question names (one
  // since deleted, renamed or re-provenanced): the function takes no registry at all
  assert.strictEqual(lib.relabelQuestions.length, 2, 'relabelQuestions(questions, split, previous = null)');
  const q = [{ qid: 'st-2', stratum: 'state', registry_id: 'deleted.entry', split_lesson_id: 3, split: 'holdout' }];
  assert.strictEqual(lib.relabelQuestions(q, r)[0].split, 'dev');
  assert.strictEqual(lib.stateSplitLessonId({ provenance: [{ lesson: 7 }, { lesson: 3 }] }), 7);
  assert.strictEqual(lib.stateSplitLessonId({ provenance: [] }), null);
});

test('the committed rule-applied question sets record every state question\'s split lesson', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  for (const f of ruleSets()) {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const missing = data.questions.filter((q) => q.stratum === 'state' && !('split_lesson_id' in q)).map((q) => q.qid);
    assert.deepStrictEqual(missing, [], `${path.basename(f)}: state questions without split_lesson_id`);
  }
  const src = (n) => fs.readFileSync(path.join(EVALS, n), 'utf8');
  const relabelBody = src('lib.js').match(/function relabelQuestions[\s\S]*?\n}\n/)[0];
  assert.doesNotMatch(relabelBody, /loadRegistry|entries/);
  assert.doesNotMatch(src('resplit.js'), /loadRegistry/);
});

test('resplit.js: removing a hard test sends its lesson and questions back to holdout', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const { resplit } = require(path.join(EVALS, 'resplit.js'));
  const file = {
    version: 9, split: { holdout: [1, 3], dev: [2] },
    questions: [{ qid: 'a', stratum: 'plain', lesson_id: 3, split: 'holdout' }, { qid: 's', stratum: 'state', registry_id: 'e3', split_lesson_id: 3, split: 'holdout' },
      { qid: 'b', stratum: 'plain', lesson_id: 1, split: 'holdout' }],
  };
  const there = resplit(file, { 3: ['q'] });
  assert.deepStrictEqual([there.moved, there.relabelled], [[3], ['a', 's']]);
  assert.deepStrictEqual(resplit(there.data, { 3: ['q'] }).data, there.data, 're-running is a no-op');
  const back = resplit(there.data, {});
  assert.deepStrictEqual([back.data.split.holdout, back.data.split.dev, back.relabelled], [[1, 3], [2], ['a', 's']]);
  assert.deepStrictEqual(back.data.questions, file.questions);
});

test('every questions-v*.json whose split has a rule carries it applied to ranking-cases.json (resplit.js --check)', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const { resplit } = require(path.join(EVALS, 'resplit.js'));
  const lib = require(path.join(EVALS, 'lib.js'));
  const sets = ruleSets();
  assert.ok(sets.some((f) => path.basename(f) === lib.CURRENT_QUESTIONS), `${lib.CURRENT_QUESTIONS} (the gated set) has no split rule`);
  const hard = lib.loadHardTestLessons();
  for (const f of sets) {
    const name = path.basename(f);
    const raw = fs.readFileSync(f, 'utf8');
    const r = resplit(JSON.parse(raw));
    assert.strictEqual(JSON.stringify(r.data, null, 2) + '\n', raw, `${name} is not up to date with the split rule: run node evals/retrieval/resplit.js evals/retrieval/${name}`);
    for (const id of Object.keys(hard)) assert.ok(!r.data.split.holdout.includes(Number(id)), `${name}: hard-test lesson ${id} is holdout`);
  }
});

test('questions-v2.json keeps v1 texts, qids and strata, v1\'s random split with the split rule applied, and every gated question has its source at grade 2', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const lib = require(path.join(EVALS, 'lib.js'));
  // the gated set (lib.js CURRENT_QUESTIONS) and the set it was derived from
  const v2 = JSON.parse(fs.readFileSync(path.join(EVALS, lib.CURRENT_QUESTIONS), 'utf8'));
  assert.ok(v2.derived_from && v2.derived_from.file, `${lib.CURRENT_QUESTIONS} records no derived_from source: this test assumes a gen-relevance.js derivation`);
  const v1 = JSON.parse(fs.readFileSync(path.join(EVALS, v2.derived_from.file), 'utf8'));
  assert.deepStrictEqual(lib.randomSplitOf(v2.split), v1.split, 'v2\'s random split is v1\'s');
  assert.deepStrictEqual(v2.split, lib.applyHardTestRule(v1.split, lib.loadHardTestLessons()));
  const strip = (q) => ({ qid: q.qid, stratum: q.stratum, lesson_id: q.lesson_id, registry_id: q.registry_id, text: q.text });
  // besides relevance, the one field v2 adds to a v1 question: split_lesson_id, on state questions only
  for (const q of v2.questions) assert.strictEqual('split_lesson_id' in q, q.stratum === 'state', q.qid);
  assert.deepStrictEqual(v2.questions.map(strip), v1.questions.map(strip));
  // split_lesson_id (recorded once, never read from the live registry) reproduces
  // v1's generation-time labels under v1's random split: its lesson's side, or dev for none.
  const v1Holdout = new Set(v1.split.holdout);
  const v1ById = new Map(v1.questions.map((q) => [q.qid, q]));
  for (const q of v2.questions.filter((x) => x.stratum === 'state')) {
    const want = q.split_lesson_id !== null && v1Holdout.has(q.split_lesson_id) ? 'holdout' : 'dev';
    assert.strictEqual(v1ById.get(q.qid).split, want, `${q.qid}: split_lesson_id ${q.split_lesson_id} does not reproduce v1's label`);
  }
  // labels: v1's, except the moved lessons' questions, which are dev
  const lessonOf = new Map(v2.questions.filter((q) => q.stratum === 'state').map((q) => [q.qid, q.split_lesson_id]));
  const v1WithLesson = v1.questions.map((q) => (q.stratum === 'state' ? { ...q, split_lesson_id: lessonOf.get(q.qid) } : q));
  const relabelled = lib.relabelQuestions(v1WithLesson, v2.split);
  assert.deepStrictEqual(v2.questions.map((q) => q.split), relabelled.map((q) => q.split));
  for (const q of v2.questions) {
    if (q.stratum === 'identifier' || q.stratum === 'plain') {
      assert.strictEqual(q.relevant[q.lesson_id], 2, q.qid);
      assert.ok(Object.entries(q.relevant).every(([id, g]) => Number(id) === q.lesson_id || g === 1), q.qid);
    } else {
      assert.ok(!('relevant' in q), q.qid);
    }
  }
});
