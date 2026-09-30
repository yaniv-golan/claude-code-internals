#!/usr/bin/env node
/**
 * lib.js — shared helpers for the retrieval eval suite (phase 0b).
 *
 * search.js is spawned as a subprocess (`--json --top=N`) and its stdout
 * parsed, so the gate exercises the real CLI end to end, index cache included.
 * (search.js also exports `search()` behind a `require.main` guard, for
 * in-process experiments; the gate does not use it.) state.js exports
 * `{ lookup, audit, cmpVersion, siteFooter }` and is required directly where
 * this suite needs it (run.js).
 *
 * No external dependencies. CommonJS.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EVALS_DIR = __dirname; // W/evals/retrieval
const REPO_ROOT = path.join(EVALS_DIR, '..', '..'); // W
const SKILL_DIR = path.join(REPO_ROOT, 'skill-package', 'skills', 'claude-code-internals'); // K
const SCRIPTS_DIR = path.join(SKILL_DIR, 'scripts');
const REFS_DIR = path.join(SKILL_DIR, 'references');
const SEARCH_JS = path.join(SCRIPTS_DIR, 'search.js');
const STATE_JS = path.join(SCRIPTS_DIR, 'state.js');
const TOPIC_INDEX_PATH = path.join(REFS_DIR, 'topic-index.json');
const REGISTRY_PATH = path.join(REFS_DIR, 'state', 'registry.json');

// The gated question set and the baseline it is scored against (file names in
// EVALS_DIR). The one place they are named: CI (validate.yml), check-clean.sh,
// the registry gate (gen-registry-top1.js, registry-top1.test.js) and the split
// guard (tests/repo-context.js) all follow these; retrieval-gate.test.js asserts
// validate.yml and check-clean.sh name exactly these files.
const CURRENT_QUESTIONS = 'questions-v2.json';
const CURRENT_BASELINE = 'baseline-v4.json';

// ---------------------------------------------------------------------------
// Index loading
// ---------------------------------------------------------------------------

function loadTopicIndex() {
  return JSON.parse(fs.readFileSync(TOPIC_INDEX_PATH, 'utf8'));
}

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

/** sha256 of a file's bytes, or null if it does not exist. Used to detect a
 * concurrent writer (another session editing topic-index.json or registry.json) mid-run so a torn read never gets recorded as a result. */
function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function indexHashes() {
  return {
    topic_index: fileHash(TOPIC_INDEX_PATH),
    registry: fileHash(REGISTRY_PATH),
  };
}

// ---------------------------------------------------------------------------
// Lesson text — sliced identically to fetch-lesson.js's fetchContent()
// ---------------------------------------------------------------------------

/**
 * Read a lesson's canonical text by startLine/endLine (1-based, inclusive),
 * the same slicing fetch-lesson.js uses, so the extractor sees exactly what a
 * fetch would return.
 *
 * @param {{file: string, startLine: number, endLine: number}} lesson
 * @returns {string}
 */
function getLessonText(lesson) {
  const filePath = path.join(REFS_DIR, lesson.file);
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const start = Math.max(0, (lesson.startLine || 1) - 1);
  const end = Math.min(lines.length, lesson.endLine || lines.length);
  return lines.slice(start, end).join('\n');
}

// ---------------------------------------------------------------------------
// search.js — spawned, --json
// ---------------------------------------------------------------------------

/**
 * Run search.js for a query and return its parsed --json results (already
 * ranked; index 0 is rank 1). On a hard failure (bad exit, unparseable JSON)
 * throws SearchSpawnError. The one non-hard failure is search.js's own
 * "only stop words" rejection (exit 1, known message) — callers that need to
 * distinguish it should catch and inspect `err.stopWordsOnly`.
 *
 * @param {string} query
 * @param {{top?: number}} [opts]
 * @returns {Array<object>} parsed JSON results (possibly empty array)
 */
function runSearch(query, opts = {}) {
  const top = opts.top || 5;
  const args = [SEARCH_JS, query, '--json', `--top=${top}`];
  if (opts.fused) args.push('--fused');
  try {
    const out = execFileSync('node', args, { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (err) {
    const stderr = (err && err.stderr) ? String(err.stderr) : '';
    if (/only stop words/i.test(stderr)) {
      const e = new Error(`search.js: query is only stop words: ${JSON.stringify(query)}`);
      e.stopWordsOnly = true;
      throw e;
    }
    const e = new Error(`search.js failed for query ${JSON.stringify(query)}: ${err.message}\n${stderr}`);
    e.cause = err;
    throw e;
  }
}

/** Rank (1-based) of `id` within `results` (search.js --json output), or null. */
function rankOf(id, results) {
  const i = results.findIndex(r => r.id === id);
  return i === -1 ? null : i + 1;
}

// ---------------------------------------------------------------------------
// Identifier extraction — published rules. The implementation lives
// in the skill package (scripts/lib/identifiers.js) because the package ships
// without evals/ and prepare-lessons.js needs the same extractor. Behaviour is
// unchanged from the copy that generated questions-v1.json.
// ---------------------------------------------------------------------------

const {
  normalize, stripFencedCode, isIdentifierShaped, extractIdentifiers, findLeaks,
} = require(path.join(SCRIPTS_DIR, 'lib', 'identifiers.js'));

// ---------------------------------------------------------------------------
// Seeded RNG — Node has no seeded RNG builtin
// ---------------------------------------------------------------------------

/** mulberry32: small, fast, deterministic PRNG. Returns a function () => [0,1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle using a seeded RNG function. Does not mutate input. */
function seededShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deterministic lesson holdout/dev split, keyed only by (seed, sorted id set)
 * — never by array/file order, so it is stable across topic-index.json
 * reformatting.
 *
 * @param {number[]} lessonIds
 * @param {number} seed
 * @param {number} [holdoutFraction=1/3]
 * @returns {{holdout: number[], dev: number[]}}
 */
function splitLessons(lessonIds, seed, holdoutFraction = 1 / 3) {
  const sorted = [...lessonIds].sort((a, b) => a - b);
  const rng = mulberry32(seed);
  const shuffled = seededShuffle(sorted, rng);
  const holdoutCount = Math.round(shuffled.length * holdoutFraction);
  const holdout = shuffled.slice(0, holdoutCount).sort((a, b) => a - b);
  const dev = shuffled.slice(holdoutCount).sort((a, b) => a - b);
  return { holdout, dev };
}

// ---------------------------------------------------------------------------
// The split rule: random split, then every lesson a hard ranking test depends on
// is moved to dev.
// ---------------------------------------------------------------------------

/** The hard ranking tests' case table, shared with the skill package's test suite. */
const HARD_TESTS_PATH = path.join(SCRIPTS_DIR, 'tests', 'ranking-cases.json');
const SPLIT_RULE = 'random split, then every lesson a hard ranking test depends on is moved to dev';

/** {lessonId: [queries]} for every lesson a case in ranking-cases.json asserts. */
function loadHardTestLessons(file = HARD_TESTS_PATH) {
  const { cases } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(cases) || !cases.length) throw new Error(`${file} has no cases`);
  const byLesson = {};
  for (const c of cases) (byLesson[c.lesson] = byLesson[c.lesson] || []).push(c.query);
  return byLesson;
}

/**
 * Apply the split rule to a random split. `split` may already carry the rule
 * (`moved_to_dev`); its random split is then recovered first (holdout plus the
 * lessons it moved), so the result depends only on (random split, hard tests) and
 * re-applying is idempotent. A hard-test lesson in neither list (added after the
 * split) is left alone: it is not holdout, so it is already treated as dev.
 *
 * @param {{holdout:number[], dev:number[], moved_to_dev?:Array}} split
 * @param {Object<string,string[]>} hard  loadHardTestLessons() output
 * @returns {{holdout:number[], dev:number[], rule:string, hard_tests:string, moved_to_dev:Array<{lesson_id, reason, queries}>}}
 */
function applyHardTestRule(split, hard) {
  const random = randomSplitOf(split);
  const moved = random.holdout.filter((id) => hard[id]);
  const movedSet = new Set(moved);
  return {
    holdout: random.holdout.filter((id) => !movedSet.has(id)),
    dev: [...random.dev, ...moved].sort((a, b) => a - b),
    rule: SPLIT_RULE,
    hard_tests: 'skill-package/skills/claude-code-internals/scripts/tests/ranking-cases.json',
    moved_to_dev: moved.map((id) => ({ lesson_id: id, reason: 'a hard ranking test asserts this lesson', queries: hard[id] })),
  };
}

/** The random split a rule-applied split was drawn from ({holdout, dev}). */
function randomSplitOf(split) {
  const moved = (split.moved_to_dev || []).map((m) => m.lesson_id);
  return {
    holdout: [...split.holdout, ...moved].sort((a, b) => a - b),
    dev: split.dev.filter((id) => !moved.includes(id)),
  };
}

/** sha256 of a split's lesson assignment (sorted dev and holdout ids only). */
function splitHash(split) {
  const canon = JSON.stringify({ dev: [...split.dev].sort((a, b) => a - b), holdout: [...split.holdout].sort((a, b) => a - b) });
  return crypto.createHash('sha256').update(canon).digest('hex');
}

/**
 * The lesson a state question's split follows: its registry entry's first provenance
 * lesson, or null (no provenance: the question is dev and never relabelled). The
 * generator (gen-questions.js) calls this once and records the result on the
 * question as `split_lesson_id`; nothing reads the registry for this afterwards.
 */
function stateSplitLessonId(entry) {
  return entry && entry.provenance && entry.provenance.length ? entry.provenance[0].lesson : null;
}

/**
 * Relabel the questions of every lesson the split rule moves or moved: the lessons in
 * `split.moved_to_dev` and in `previous.moved_to_dev` (the split being replaced, so a
 * hard test removed since sends its lesson's questions back to holdout). Such a
 * question takes its lesson's side in `split` — a lesson question by its lesson, a
 * state question by its recorded `split_lesson_id` (stateSplitLessonId(), written
 * when the question was generated). The live registry is never read, so editing,
 * renaming or deleting a registry entry cannot move a question. A state question
 * without the field throws. Every other question, and every negative, keeps its
 * label, so this depends on nothing but the moved lessons. Returns new question
 * objects; texts, qids and relevance sets are untouched.
 */
function relabelQuestions(questions, split, previous = null) {
  const ids = (s) => ((s && s.moved_to_dev) || []).map((m) => m.lesson_id);
  const affected = new Set([...ids(split), ...ids(previous)]);
  // Checked before the early return, so a set missing the field fails on every call.
  for (const q of questions) {
    if (q.stratum === 'state' && !('split_lesson_id' in q)) {
      throw new Error(`${q.qid}: state question has no split_lesson_id; cannot place it in the split (record it: the registry entry's first provenance lesson when the question was generated)`);
    }
  }
  if (!affected.size) return questions;
  const holdout = new Set(split.holdout);
  return questions.map((q) => {
    let lessonId = null;
    if (q.stratum === 'identifier' || q.stratum === 'plain') lessonId = q.lesson_id;
    else if (q.stratum === 'state') lessonId = q.split_lesson_id;
    if (lessonId === null || !affected.has(lessonId)) return q;
    const side = holdout.has(lessonId) ? 'holdout' : 'dev';
    return side === q.split ? q : { ...q, split: side };
  });
}

// ---------------------------------------------------------------------------
// Ranking metrics
// ---------------------------------------------------------------------------

/** Reciprocal rank for a single query: 1/rank if found (rank is 1-based), else 0. */
function reciprocalRank(rank) {
  return rank ? 1 / rank : 0;
}

/** Binary-relevance nDCG@5 with exactly one relevant document: 1/log2(rank+1)
 * if rank<=5, else 0 (ideal DCG@5 for one relevant doc is 1/log2(2)=1, so this
 * IS the normalized value, not a raw DCG). */
function ndcgAt5(rank) {
  if (!rank || rank > 5) return 0;
  return 1 / Math.log2(rank + 1);
}

/**
 * Graded nDCG@5 for an acceptable-answer set (questions-v2+). Linear gain:
 * gain(lesson) = its grade (2 = source, 1 = other acceptable, 0 otherwise);
 * DCG@5 = sum over result positions i=1..5 of gain / log2(i+1); normalized by
 * the ideal DCG@5 (the set's grades sorted descending). With the source alone
 * ({source: 2}) this equals ndcgAt5(rank of the source) exactly.
 *
 * @param {Array<{id:number}>} results  ranked search results
 * @param {Object<string, number>} relevant  lessonId -> grade
 */
function gradedNdcgAt5(results, relevant) {
  const gainOf = (id) => relevant[id] || 0;
  let dcg = 0;
  results.slice(0, 5).forEach((r, i) => { dcg += gainOf(r.id) / Math.log2(i + 2); });
  const ideal = Object.values(relevant).filter((g) => g > 0).sort((a, b) => b - a).slice(0, 5);
  let idcg = 0;
  ideal.forEach((g, i) => { idcg += g / Math.log2(i + 2); });
  return idcg ? dcg / idcg : 0;
}

/** Rank (1-based) of the first result that is in `relevant`, or null. */
function firstAcceptableRank(results, relevant) {
  const i = results.findIndex((r) => (relevant[r.id] || 0) > 0);
  return i === -1 ? null : i + 1;
}

module.exports = {
  EVALS_DIR,
  REPO_ROOT,
  SKILL_DIR,
  SCRIPTS_DIR,
  REFS_DIR,
  SEARCH_JS,
  STATE_JS,
  TOPIC_INDEX_PATH,
  REGISTRY_PATH,
  loadTopicIndex,
  loadRegistry,
  fileHash,
  indexHashes,
  getLessonText,
  runSearch,
  rankOf,
  normalize,
  stripFencedCode,
  isIdentifierShaped,
  extractIdentifiers,
  findLeaks,
  mulberry32,
  seededShuffle,
  splitLessons,
  HARD_TESTS_PATH,
  SPLIT_RULE,
  loadHardTestLessons,
  applyHardTestRule,
  randomSplitOf,
  splitHash,
  stateSplitLessonId,
  relabelQuestions,
  CURRENT_QUESTIONS,
  CURRENT_BASELINE,
  reciprocalRank,
  ndcgAt5,
  gradedNdcgAt5,
  firstAcceptableRank,
};
