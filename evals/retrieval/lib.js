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
// Identifier extraction — published rules (spec §4.7 / this task's §1)
// ---------------------------------------------------------------------------
//
// Rules, applied to a lesson's canonical text:
//   - inline code spans:            `...`
//   - CAPS env-var-shaped names:    CLAUDE_CODE_*, or any ALLCAPS_WITH_UNDERSCORES
//   - numeric GrowthBook gate ids:  7-10 digit runs
//   - slash commands:               /foo-bar
//   - tengu_* identifiers
//   - mcp__x__y tool names
//
// Normalization: lowercase, runs of non-alphanumeric characters collapsed to
// a single space, trimmed. Fenced code blocks (``` ... ```) are stripped
// before the inline-code-span pass only — a fence's own backtick delimiters
// and its contents would otherwise be mismatched as spans; the other five
// patterns run over the FULL original text (fences don't confuse them).

const CODE_SPAN_RE = /`([^`\n]+)`/g;
const CAPS_ENV_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const GATE_ID_RE = /\b\d{7,10}\b/g;
// Negative lookbehind excludes URL paths (preceded by a word char or another slash).
const SLASH_CMD_RE = /(?<![\w/])\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\b/g;
const TENGU_RE = /\btengu_[a-z0-9_]+\b/gi;
const MCP_TOOL_RE = /\bmcp__[A-Za-z0-9_]+\b/g;

function normalize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Strip fenced code blocks (```...```), replacing fence lines and their
 * contents with blank lines so line numbers/positions are otherwise stable. */
function stripFencedCode(text) {
  const lines = text.split('\n');
  let inFence = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    out.push(inFence ? '' : line);
  }
  return out.join('\n');
}

/**
 * True if a raw identifier candidate is "identifier-shaped" rather than a
 * plain English word/phrase that happened to sit in backticks (e.g. `hooks`,
 * `fork`, `outputs`). Used to decide leak-masking triggers for gen-questions.js
 * (open decision, see README): a lowercase single English word inside a code
 * span should not block a plain-language question from using that word in
 * ordinary prose, but CLAUDE_CODE_ENABLE_TASKS, tengu_saddle_lantern,
 * mcp__skills__list_skills, a 9-digit gate id, or `list_skills` all should.
 */
function isIdentifierShaped(raw) {
  if (/_/.test(raw)) return true;
  if (/\d/.test(raw)) return true;
  if (/[a-z][A-Z]/.test(raw)) return true; // camelCase boundary
  const norm = normalize(raw);
  const tokenCount = norm ? norm.split(' ').filter(Boolean).length : 0;
  return tokenCount >= 2;
}

/**
 * Extract identifiers from lesson (or any) text using the published rules.
 *
 * @param {string} text
 * @returns {Array<{raw: string, normalized: string, kind: string, leakTrigger: boolean}>}
 *   Deduped by (kind, normalized) pair — the same normalized form found via
 *   two different rules is kept once per kind since `kind` changes how a
 *   leak check applies (slash commands are checked as a literal substring,
 *   not a normalized-phrase containment; see findLeaks()).
 */
function extractIdentifiers(text) {
  const stripped = stripFencedCode(text);
  const out = [];
  const seen = new Set();

  const push = (raw, kind, leakTrigger) => {
    const normalized = normalize(raw);
    if (!normalized) return;
    const key = kind + '\u0000' + normalized;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ raw, normalized, kind, leakTrigger });
  };

  for (const m of stripped.matchAll(CODE_SPAN_RE)) {
    const raw = m[1].trim();
    if (raw.length < 2) continue;
    push(raw, 'code-span', isIdentifierShaped(raw));
  }
  for (const m of text.matchAll(CAPS_ENV_RE)) {
    push(m[0], 'caps-env', true);
  }
  for (const m of text.matchAll(GATE_ID_RE)) {
    push(m[0], 'gate-id', true);
  }
  for (const m of text.matchAll(SLASH_CMD_RE)) {
    // leakTrigger is meaningless for slash commands (checked literally, see
    // findLeaks()); recorded true for consistency/inventory purposes.
    push(m[0], 'slash', true);
  }
  for (const m of text.matchAll(TENGU_RE)) {
    push(m[0], 'tengu', true);
  }
  for (const m of text.matchAll(MCP_TOOL_RE)) {
    push(m[0], 'mcp', true);
  }

  return out;
}

/**
 * Find identifiers from `identifiers` (as returned by extractIdentifiers)
 * that leak into `questionText`.
 *
 * - 'slash' kind: literal substring match against the RAW question text
 *   (normalizing "/config" loses the slash and collides with the ordinary
 *   English word "config").
 * - all other kinds: only identifiers with leakTrigger===true are checked,
 *   as a normalized, space-padded phrase containment against the normalized
 *   question text (so "fork" from a code span doesn't block "how do I fork a
 *   conversation" unless "fork" was judged identifier-shaped, which a bare
 *   single common word is not).
 *
 * @param {string} questionText
 * @param {Array<object>} identifiers
 * @returns {Array<object>} the leaking identifiers (subset of `identifiers`)
 */
function findLeaks(questionText, identifiers) {
  const normQ = ' ' + normalize(questionText) + ' ';
  const leaks = [];
  for (const ident of identifiers) {
    if (ident.kind === 'slash') {
      if (questionText.includes(ident.raw)) leaks.push(ident);
      continue;
    }
    if (!ident.leakTrigger || !ident.normalized) continue;
    if (normQ.includes(' ' + ident.normalized + ' ')) leaks.push(ident);
  }
  return leaks;
}

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
