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
// Skip only in the shipped skill package; in the repository a missing eval
// file fails (see repo-context.js), so leaving it out of a commit can't
// silently remove these checks.
const { IN_REPO, STANDALONE_SKIP } = require('./repo-context.js');
const PRESENT = IN_REPO;
const SKIP = STANDALONE_SKIP;

test('repository checkout has the eval files these tests need', (t) => {
  if (!IN_REPO) { t.skip(SKIP); return; }
  for (const f of ['run.js', 'gen-questions.js']) assert.ok(fs.existsSync(path.join(EVALS, f)), `evals/retrieval/${f} is missing`);
});

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
  assert.deepStrictEqual(cmp, { ok: true, failures: [], waived: [], reported: [] });
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

test('compareToBaseline: a baseline recorded under another lesson split cannot be compared', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  // One gated question relabelled (its lesson moved to dev): no hash on either side,
  // as in baseline-v1/baseline-v2, so the questions' own labels decide.
  const moved = clone(BASE_QS);
  moved[2] = q('id-0003', 'identifier', 'dev', 2);
  const cmp = R.compareToBaseline(report(1, moved), report(1, clone(BASE_QS)), R.DEFAULT_THRESHOLDS);
  assert.strictEqual(cmp.ok, false);
  assert.deepStrictEqual(cmp.failures.length, 1, cmp.failures.join('\n'));
  assert.match(cmp.failures[0], /lesson split mismatch: 1 gated question\(s\) changed split \(id-0003 holdout->dev\).*record a new baseline/);
  // With a split hash on both sides, a different hash fails even when no label differs.
  const a = report(1, clone(BASE_QS));
  const b = report(1, clone(BASE_QS));
  a.questions_source.split_sha256 = 'a'.repeat(64);
  b.questions_source.split_sha256 = 'b'.repeat(64);
  assert.match(R.compareToBaseline(a, b, R.DEFAULT_THRESHOLDS).failures.join('\n'), /lesson split mismatch \(split_sha256/);
  b.questions_source.split_sha256 = a.questions_source.split_sha256;
  assert.strictEqual(R.compareToBaseline(a, b, R.DEFAULT_THRESHOLDS).ok, true, 'control: same hash, same labels');
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

test('compareToBaseline: a waiver covers one question up to its recorded rank, and a stale waiver fails', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const loose = { ...R.DEFAULT_THRESHOLDS, mrr_ndcg_drop: 1 };
  const withWaiver = (rank) => {
    const b = report(1, clone(BASE_QS));
    b.waivers = [{ qid: 'id-0001', rank, reason: 'r', commit: 'c' }];
    return b;
  };
  const at = (rank) => { const qs = clone(BASE_QS); qs[0] = q('id-0001', 'identifier', 'dev', rank); return report(1, qs); };

  // Waived at rank 2: a drop to 2 passes but is still reported.
  const ok = R.compareToBaseline(at(2), withWaiver(2), loose);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.waived.length, 1);
  assert.match(ok.waived[0], /id-0001.*WAIVED/);
  // Getting worse than the waived rank fails.
  const worse = R.compareToBaseline(at(3), withWaiver(2), loose);
  assert.strictEqual(worse.ok, false);
  assert.match(worse.failures.join('\n'), /id-0001.*lost top-1/);
  // A waiver that matches nothing (the question recovered) is stale and fails.
  const stale = R.compareToBaseline(at(1), withWaiver(2), loose);
  assert.strictEqual(stale.ok, false);
  assert.match(stale.failures.join('\n'), /id-0001.*waiver is stale/);
  // A waiver for one question never covers another.
  const other = clone(BASE_QS); other[0] = q('id-0001', 'identifier', 'dev', 2);
  const b = report(1, clone(BASE_QS)); b.waivers = [{ qid: 'id-0003', rank: 5, reason: 'r', commit: 'c' }];
  assert.strictEqual(R.compareToBaseline(report(1, other), b, loose).ok, false);
});

test('compareToBaseline: rank-drop, top-10 and not-found rules use the given thresholds', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const loose = { ...R.DEFAULT_THRESHOLDS, mrr_ndcg_drop: 1 };
  const cur = clone(BASE_QS);
  cur[1] = q('pl-0002', 'plain', 'dev', 12);   // 4 -> 12: drop > 3 and out of the top 10
  cur[0] = q('id-0001', 'identifier', 'dev', null);
  const f = R.compareToBaseline(report(1, cur), report(1, clone(BASE_QS)), loose).failures;
  assert.ok(f.includes('[pl-0002] "plain" rank dropped 4 -> 12 (> 3 ranks)'), f.join('\n'));
  assert.ok(f.includes('[pl-0002] "plain" fell out of top 10 (4 -> 12)'), f.join('\n'));
  assert.ok(f.includes('[id-0001] "identifier" was found at rank 1, now not found in top 20'), f.join('\n'));
  const wide = R.compareToBaseline(report(1, cur), report(1, clone(BASE_QS)), { ...loose, rank_drop_k: 10, top_k_floor: 15, identifier_top1_loss: false }).failures;
  assert.deepStrictEqual(wide, ['[id-0001] "identifier" was found at rank 1, now not found in top 20']);
});

test('compareToBaseline: on a holdout question every per-question rule reports and never fails', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const loose = { ...R.DEFAULT_THRESHOLDS, mrr_ndcg_drop: 1 }; // isolate the per-question rules
  const base = clone(BASE_QS);
  base[2] = q('id-0003', 'identifier', 'holdout', 1);
  const cur = clone(base);
  cur[2] = q('id-0003', 'identifier', 'holdout', 12);  // top-1 loss, drop > 3, out of the top 10
  cur[3] = q('pl-0004', 'plain', 'holdout', null);     // found -> not found
  const cmp = R.compareToBaseline(report(1, cur), report(1, base), loose);
  assert.strictEqual(cmp.ok, true, cmp.failures.join('\n'));
  assert.deepStrictEqual(cmp.reported.slice().sort(), [
    '[id-0003] "identifier" fell out of top 10 (1 -> 12)',
    '[id-0003] "identifier" lost top-1 (1 -> 12)',
    '[id-0003] "identifier" rank dropped 1 -> 12 (> 3 ranks)',
    '[pl-0004] "plain" was found at rank 7, now not found in top 20',
  ]);
  // The same changes on dev questions fail.
  const devBase = base.map((x) => ({ ...x, split: 'dev' }));
  const devCur = cur.map((x) => ({ ...x, split: 'dev' }));
  const dev = R.compareToBaseline(report(1, devCur), report(1, devBase), loose);
  assert.strictEqual(dev.ok, false);
  assert.strictEqual(dev.failures.length, 4, dev.failures.join('\n'));
  assert.deepStrictEqual(dev.reported, []);
  // A waiver naming a holdout question is never used, so it is stale and fails.
  const waived = report(1, base);
  waived.waivers = [{ qid: 'pl-0004', rank: 20, reason: 'r', commit: 'c' }];
  assert.match(R.compareToBaseline(report(1, cur), waived, loose).failures.join('\n'), /pl-0004.*waiver is stale/);
});

test('compareToBaseline: a holdout stratum x split aggregate drop still fails', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const R = require(RUN_JS);
  const cur = clone(BASE_QS);
  cur[3] = q('pl-0004', 'plain', 'holdout', 9);        // 7 -> 9: under every per-question rule
  const cmp = R.compareToBaseline(report(1, cur), report(1, clone(BASE_QS)), R.DEFAULT_THRESHOLDS);
  assert.deepStrictEqual(cmp.reported, []);
  assert.deepStrictEqual(cmp.failures, ['[plain|holdout] MRR dropped 0.1429 -> 0.1111 (> 0.02)']);
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

test('CI and check-clean.sh score exactly the current question set against the current baseline (lib.js CURRENT_*)', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const { CURRENT_QUESTIONS, CURRENT_BASELINE } = require(path.join(EVALS, 'lib.js'));
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const want = new RegExp(`run\\.js --baseline evals/retrieval/${esc(CURRENT_BASELINE)} --questions evals/retrieval/${esc(CURRENT_QUESTIONS)}`);
  for (const rel of ['.github/workflows/validate.yml', 'scripts/check-clean.sh']) {
    const p = path.join(REPO, rel);
    assert.ok(fs.existsSync(p), `${rel} is missing`);
    const text = fs.readFileSync(p, 'utf8');
    assert.match(text, want, rel);
    // No other question set or baseline is named outside comments (history in
    // comments is fine; a second file on a command line would be a second gate).
    const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const named = new Set(code.match(/evals\/retrieval\/(?:questions|baseline)-v\d+\.json/g) || []);
    assert.deepStrictEqual([...named].sort(), [`evals/retrieval/${CURRENT_BASELINE}`, `evals/retrieval/${CURRENT_QUESTIONS}`].sort(), rel);
  }
});

test('lib.js CURRENT_QUESTIONS / CURRENT_BASELINE exist, and repo-context.js resolves the same files', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const lib = require(path.join(EVALS, 'lib.js'));
  const { currentEvalFiles } = require('./repo-context.js');
  const files = currentEvalFiles();
  assert.strictEqual(files.questions, path.join(lib.EVALS_DIR, lib.CURRENT_QUESTIONS));
  assert.strictEqual(files.baseline, path.join(lib.EVALS_DIR, lib.CURRENT_BASELINE));
  for (const f of Object.values(files)) assert.ok(fs.existsSync(f), `${path.basename(f)} is missing`);
  // The baseline scores the question set's version.
  const qs = JSON.parse(fs.readFileSync(files.questions, 'utf8'));
  const base = JSON.parse(fs.readFileSync(files.baseline, 'utf8'));
  assert.strictEqual(base.questions_source.version, qs.version);
});

test('check-clean.sh fails, never skips, when the retrieval baseline is missing', (t) => {
  if (!PRESENT) { t.skip(SKIP); return; }
  const text = fs.readFileSync(path.join(REPO, 'scripts', 'check-clean.sh'), 'utf8');
  assert.doesNotMatch(text, /if \[\[ -f evals\/retrieval\/baseline/, 'the retrieval step is conditional on the baseline existing');
  assert.match(text, /\[\[ ! -f "\$f" \]\][\s\S]*?exit 1/, 'a missing gate file must exit 1');
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
  // A new state question records its split lesson (the entry's first provenance lesson),
  // and its label is that lesson's side, so relabelling never needs the registry.
  const lib = require(path.join(EVALS, 'lib.js'));
  const entries = new Map(lib.loadRegistry().entries.map((e) => [e.id, e]));
  const holdout = new Set(out.split.holdout);
  const st = out.questions.filter((x) => x.stratum === 'state');
  assert.ok(st.length >= 1);
  for (const x of st) {
    assert.strictEqual(x.split_lesson_id, lib.stateSplitLessonId(entries.get(x.registry_id)), x.qid);
    assert.strictEqual(x.split, x.split_lesson_id !== null && holdout.has(x.split_lesson_id) ? 'holdout' : 'dev', x.qid);
  }
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
