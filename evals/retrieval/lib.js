#!/usr/bin/env node
/**
 * lib.js — shared helpers for the retrieval eval suite (phase 0b).
 *
 * search.js has no `module.exports` and calls its own `main()` unconditionally
 * at load time (no `require.main === module` guard), so requiring it directly
 * would run its CLI immediately. It DOES support `--json` and `--top=N`
 * (see scripts/search.js printUsage()), so every consumer here spawns it as a
 * subprocess and parses stdout. state.js, by contrast, DOES export
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
// Identifier extraction — published rules (spec §4.7). The implementation lives
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
  reciprocalRank,
  ndcgAt5,
};
