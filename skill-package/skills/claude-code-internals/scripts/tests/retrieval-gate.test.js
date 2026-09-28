'use strict';
/**
 * retrieval-gate.test.js — the retrieval eval gate (evals/retrieval/run.js)
 * and the question generator (evals/retrieval/gen-questions.js) must never
 * pass vacuously or produce questions that cannot be compared.
 *
 * evals/ lives at the repo root and is not part of the shipped skill package,
 * so every case SKIPS when evals/retrieval/ is absent (as registry-top1.test.js
 * does). No case calls a model or runs the full question set: the gate is
 * exercised on synthetic reports, and the generator on a stub model.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// scripts/tests -> scripts -> claude-code-internals -> skills -> skill-package -> repo root
const REPO = path.join(__dirname, '..', '..', '..', '..', '..');
const EVALS = path.join(REPO, 'evals', 'retrieval');
const RUN_JS = path.join(EVALS, 'run.js');
const GEN_JS = path.join(EVALS, 'gen-questions.js');
const PRESENT = fs.existsSync(RUN_JS) && fs.existsSync(GEN_JS);
const SKIP = 'evals/retrieval/ not present (expected in the shipped skill package zip)';

const SCRATCH = [];
test.after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });
function scratch(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  SCRATCH.push(d);
  return d;
}

// --- synthetic reports -------------------------------------------------------------

function q(qid, stratum, split, rank) {
  return { qid, stratum, split, lesson_id: 1, rank, rr: rank ? 1 / rank : 0, ndcg5: 0, error: null };
}
function report(version, lessonQueries) {
  const by = {};
  for (const x of lessonQueries) {
    const k = `${x.stratum}|${x.split}`;
    by[k] = by[k] || { n: 0, mrr: 0, ndcg5: 0 };
    by[k].n++;
  }
  for (const k of Object.keys(by)) {
    const items = lessonQueries.filter((x) => `${x.stratum}|${x.split}` === k);
    by[k].mrr = items.reduce((a, x) => a + x.rr, 0) / items.length;
    by[k].ndcg5 = 0;
  }
  return {
    questions_source: version === null ? null : { version, seed: 1, model: 'm' },
    top: 20,
    by_stratum_split: by,
    queries: { lesson: lessonQueries, state: [], negative: [] },
  };
}
const BASE_QS = [
  q('id-0001', 'identifier', 'dev', 1), q('pl-0002', 'plain', 'dev', 4),
  q('id-0003', 'identifier', 'holdout', 2), q('pl-0004', 'plain', 'holdout', 7),
];
const clone = (x) => JSON.parse(JSON.stringify(x));

test('compareToBaseline: an identical report passes', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const cmp = R.compareToBaseline(report(1, clone(BASE_QS)), report(1, clone(BASE_QS)), R.DEFAULT_THRESHOLDS);
  assert.deepStrictEqual(cmp, { ok: true, failures: [] });
});

test('compareToBaseline: a different or missing question-set version fails', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const base = report(1, clone(BASE_QS));
  for (const v of [2, null]) {
    const cmp = R.compareToBaseline(report(v, clone(BASE_QS)), base, R.DEFAULT_THRESHOLDS);
    assert.strictEqual(cmp.ok, false, `version ${v}`);
    assert.match(cmp.failures[0], /question-set version mismatch/);
  }
});

test('compareToBaseline: an empty report (no questions) fails instead of passing vacuously', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const cmp = R.compareToBaseline(report(1, []), report(1, clone(BASE_QS)), R.DEFAULT_THRESHOLDS);
  assert.strictEqual(cmp.ok, false);
  assert.ok(cmp.failures.some((f) => /\[identifier\|dev\] gated stratum x split is in the baseline but missing/.test(f)), cmp.failures.join('\n'));
  assert.ok(cmp.failures.some((f) => /\[pl-0004\] gated "plain" question is in the baseline but missing/.test(f)), cmp.failures.join('\n'));
});

test('compareToBaseline: a gated baseline question missing from the report fails', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  // Same strata present, same aggregate — only one question gone.
  const cur = report(1, clone(BASE_QS).filter((x) => x.qid !== 'id-0003').concat([q('id-0099', 'identifier', 'holdout', 2)]));
  const cmp = R.compareToBaseline(cur, report(1, clone(BASE_QS)), R.DEFAULT_THRESHOLDS);
  assert.strictEqual(cmp.ok, false);
  assert.deepStrictEqual(cmp.failures, ['[id-0003] gated "identifier" question is in the baseline but missing from the report']);
});

test('compareToBaseline: an identifier question losing top-1 fails, even by one rank', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const qs = clone(BASE_QS);
  qs[0] = q('id-0001', 'identifier', 'dev', 2);
  const loose = { ...R.DEFAULT_THRESHOLDS, mrr_ndcg_drop: 1 }; // isolate the top-1 rule from the MRR drop
  const cmp = R.compareToBaseline(report(1, qs), report(1, clone(BASE_QS)), loose);
  assert.deepStrictEqual(cmp.failures, ['[id-0001] "identifier" lost top-1 (1 -> 2)']);
  // A plain question moving 1 -> 2 is not a top-1 loss.
  const b2 = clone(BASE_QS); b2[1] = q('pl-0002', 'plain', 'dev', 1);
  const c2 = clone(BASE_QS); c2[1] = q('pl-0002', 'plain', 'dev', 2);
  assert.strictEqual(R.compareToBaseline(report(1, c2), report(1, b2), loose).ok, true);
});

test('compareToBaseline: rank-drop, top-10 and not-found rules use the given thresholds', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const loose = { ...R.DEFAULT_THRESHOLDS, mrr_ndcg_drop: 1 };
  const cur = clone(BASE_QS);
  cur[1] = q('pl-0002', 'plain', 'dev', 12);   // 4 -> 12: drop > 3 and out of the top 10
  cur[3] = q('pl-0004', 'plain', 'holdout', null);
  const f = R.compareToBaseline(report(1, cur), report(1, clone(BASE_QS)), loose).failures;
  assert.ok(f.includes('[pl-0002] "plain" rank dropped 4 -> 12 (> 3 ranks)'), f.join('\n'));
  assert.ok(f.includes('[pl-0002] "plain" fell out of top 10 (4 -> 12)'), f.join('\n'));
  assert.ok(f.includes('[pl-0004] "plain" was found at rank 7, now not found in top 20'), f.join('\n'));
  const wide = R.compareToBaseline(report(1, cur), report(1, clone(BASE_QS)), { ...loose, rank_drop_k: 10, top_k_floor: 15 }).failures;
  assert.deepStrictEqual(wide, ['[pl-0004] "plain" was found at rank 7, now not found in top 20']);
});

test('thresholds resolve CLI over baseline over default, and the v1 baseline records them', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const base = JSON.parse(fs.readFileSync(path.join(EVALS, 'baseline-v1.json'), 'utf8'));
  assert.deepStrictEqual(base.thresholds, { mrr_ndcg_drop: 0.02, rank_drop_k: 3, top_k_floor: 10, identifier_top1_loss: true });

  const fromBase = R.resolveThresholds(R.parseArgs([]), { thresholds: { mrr_ndcg_drop: 0.05, rank_drop_k: 7 } });
  assert.deepStrictEqual(fromBase.thresholds, { mrr_ndcg_drop: 0.05, rank_drop_k: 7, top_k_floor: 10, identifier_top1_loss: true });
  assert.deepStrictEqual(fromBase.sources, { mrr_ndcg_drop: 'baseline', rank_drop_k: 'baseline', top_k_floor: 'default', identifier_top1_loss: 'default' });

  const cli = R.resolveThresholds(R.parseArgs(['--mrr-threshold', '0.1', '--top-k-floor', '5']), { thresholds: { mrr_ndcg_drop: 0.05 } });
  assert.strictEqual(cli.thresholds.mrr_ndcg_drop, 0.1);
  assert.strictEqual(cli.sources.mrr_ndcg_drop, 'cli');
  assert.strictEqual(cli.thresholds.top_k_floor, 5);
});

test('run.js exits non-zero on a questions file with no gated questions, or none at all', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const dir = scratch('cci-retrieval-');
  const empty = path.join(dir, 'questions-v2.json');
  fs.writeFileSync(empty, JSON.stringify({ version: 2, seed: 2, model: 'x', questions: [] }));
  const onlyNeg = path.join(dir, 'questions-v3.json');
  fs.writeFileSync(onlyNeg, JSON.stringify({ version: 3, seed: 2, model: 'x', questions: [{ qid: 'ng-1', stratum: 'negative', split: 'dev', text: 'x' }] }));
  for (const file of [empty, onlyNeg]) {
    const r = spawnSync('node', [RUN_JS, '--questions', file, '--baseline', path.join(EVALS, 'baseline-v1.json')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /no gated \(identifier\/plain\) questions/);
    assert.doesNotMatch(r.stdout, /OK — no regressions/);
  }
  const missing = spawnSync('node', [RUN_JS, '--questions', path.join(dir, 'nope.json')], { encoding: 'utf8' });
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /no questions-vN\.json found/);
});

test('CI and check-clean.sh score the v1 question set explicitly', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const want = /run\.js --baseline evals\/retrieval\/baseline-v1\.json --questions evals\/retrieval\/questions-v1\.json/;
  for (const rel of ['.github/workflows/validate.yml', 'scripts/check-clean.sh']) {
    const p = path.join(REPO, rel);
    if (!fs.existsSync(p)) continue;
    assert.match(fs.readFileSync(p, 'utf8'), want, rel);
  }
});

// --- gen-questions.js on a stub model ------------------------------------------------

const wrap = (obj) => JSON.stringify({ result: JSON.stringify(obj) });
function stubModel({ leakTitle = null } = {}) {
  return async (prompt) => {
    if (prompt.includes('Here is a current-state record')) return wrap({ question: 'Is some feature live right now?' });
    if (prompt.includes('NOT answered anywhere')) return wrap(['What is the weather MCP server?']);
    const title = (prompt.match(/Lesson title: (.+)/) || [])[1];
    if (title === leakTitle) {
      // The plain question always names a code span from the lesson.
      const span = (prompt.match(/`([A-Za-z]+_[A-Za-z0-9_]+)`/) || [])[1]; // underscore: always identifier-shaped
      return wrap({ identifier_question: `What does ${span} do?`, plain_question: `What does ${span} do?` });
    }
    return wrap({ identifier_question: `Identifier question about ${title}`, plain_question: `Plain question about ${title}` });
  };
}
const genArgs = (dir, version, extra = []) => ['--seed', '1', '--version', String(version), '--out-dir', dir,
  '--state-sample', '1', '--negative-count', '1', '--concurrency', '1', ...extra];

test('gen-questions: a plain question that exhausts leak retries still keeps the identifier question', async (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_JS);
  const lib = require(path.join(EVALS, 'lib.js'));
  const lesson = lib.loadTopicIndex().lessons.find((l) => /`[A-Za-z]+_[A-Za-z0-9_]+`/.test(lib.getLessonText(l)));
  const order = lib.loadTopicIndex().lessons.map((l) => l.id);
  const dir = scratch('cci-gen-');
  const out = await G.generate(G.parseArgs(genArgs(dir, 2, ['--limit', String(order.indexOf(lesson.id) + 1)])),
    { callModel: stubModel({ leakTitle: lesson.title }) });
  const mine = out.questions.filter((x) => x.lesson_id === lesson.id);
  assert.deepStrictEqual(mine.map((x) => x.stratum), ['identifier'], JSON.stringify(mine));
  assert.ok(out.dropped.some((d) => d.lesson_id === lesson.id && d.stratum === 'plain'), JSON.stringify(out.dropped));
});

test('gen-questions: qids carry the version from v2 on, and v1 keeps bare qids', async (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_JS);
  assert.strictEqual(G.qidFor(1, 'id', 1), 'id-0001');
  assert.strictEqual(G.qidFor(2, 'pl', 12), 'v2-pl-0012');
  const out = await G.generate(G.parseArgs(genArgs(scratch('cci-gen-'), 3, ['--limit', '2'])), { callModel: stubModel() });
  assert.ok(out.questions.length >= 4);
  for (const x of out.questions) assert.match(x.qid, /^v3-(id|pl|st|ng)-\d{4}$/);
  assert.strictEqual(new Set(out.questions.map((x) => x.qid)).size, out.questions.length);
  // The committed v1 set is frozen with bare qids.
  const v1 = JSON.parse(fs.readFileSync(path.join(EVALS, 'questions-v1.json'), 'utf8'));
  assert.ok(v1.questions.every((x) => /^(id|pl|st|ng)-\d{4}$/.test(x.qid)));
});

test('gen-questions: a resumed run uses the split stored in the partial, never a recomputed one', async (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const G = require(GEN_JS);
  const lib = require(path.join(EVALS, 'lib.js'));
  const ids = lib.loadTopicIndex().lessons.map((l) => l.id);
  const recomputed = lib.splitLessons(ids, 1);
  // A stored split that disagrees with the recomputed one: everything flipped.
  const stored = { holdout: recomputed.dev, dev: recomputed.holdout };
  const dir = scratch('cci-gen-');
  const opts = G.parseArgs(genArgs(dir, 4, ['--limit', '6']));
  G.writePartial(path.join(dir, 'questions-v4.json'), {
    header: { seed: 1, model: G.DEFAULT_MODEL, prompt_version: G.PROMPT_VERSION, version: 4 },
    split: stored,
    questions: [],
    done: { lessons: [], state_entries: [], negatives: false },
    dropped: [],
  });
  const out = await G.generate(opts, { callModel: stubModel() });
  assert.deepStrictEqual(out.split, stored);
  const holdout = new Set(stored.holdout);
  const lessonQs = out.questions.filter((x) => x.stratum === 'identifier' || x.stratum === 'plain');
  assert.ok(lessonQs.length > 0);
  for (const x of lessonQs) assert.strictEqual(x.split, holdout.has(x.lesson_id) ? 'holdout' : 'dev', `lesson ${x.lesson_id}`);
});
