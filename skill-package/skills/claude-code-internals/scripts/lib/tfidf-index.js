'use strict';
/**
 * tfidf-index.js — the TF-IDF index behind search.js and semantic-search.js,
 * built in memory from references/topic-index.json.
 *
 * There is no committed index file. The index is a pure function of
 * topic-index.json (lesson title + keywords + description + every keyword_map
 * key that points at the lesson), so it is derived on load and cached, keyed by
 * a hash of the topic-index bytes and BUILDER_VERSION.
 *
 * RANKINGS ARE A CONTRACT. The arithmetic below reproduces the retired
 * build-rvf-index.js exactly, down to float summation order:
 *   - the INDEX side tokenizes with INDEX_STOP_WORDS, which keeps "claude" and
 *     "code" (the query side drops them, but the vocabulary must still contain
 *     them: query expansion reverse-prefix-matches against the vocabulary);
 *   - augmented TF 0.5 + 0.5 * tf/maxTf; IDF ln(N / df);
 *   - entry weights use the RAW idf, then round to 4 decimals;
 *   - the exported `idf` table (used to weight query terms) is the ROUNDED idf;
 *   - `vocabulary` is Object.keys(idf).sort() — its order drives the order query
 *     terms are expanded, hence the order floats are summed;
 *   - entries are in topic-index lesson order (score ties keep that order).
 * Change any of that knowing results will move (the cache key follows the source).
 *
 * CACHE. One JSON file per (topic-index bytes, this file's source) in the first
 * writable directory of: $CCI_INDEX_CACHE_DIR (tests), else
 * $XDG_CACHE_HOME/claude-code-internals, ~/.cache/claude-code-internals,
 * <os.tmpdir()>/claude-code-internals. Never inside the skill directory, which
 * can be a read-only plugin mount. Any cache failure (unwritable, unreadable,
 * corrupt, wrong key) silently falls back to building in memory.
 * CCI_NO_INDEX_CACHE=1 disables the cache entirely. The key hashes this
 * module's own source as well as BUILDER_VERSION, so any edit to the arithmetic
 * invalidates old entries without anyone remembering to bump the constant. The
 * newest CACHE_KEEP entries are kept, so two checkouts sharing a home directory
 * (an installed plugin and a repo clone) do not evict each other on every run.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const BUILDER_VERSION = 1;
const CACHE_PREFIX = 'tfidf-index-';
const CACHE_KEEP = 4;

// --- Stop words -----------------------------------------------------------------
// Common English words that add noise to TF-IDF. The index is built with this set.
const INDEX_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are',
  'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we',
  'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
  'its', 'our', 'their', 'what', 'which', 'who', 'whom', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'about', 'above', 'after', 'again', 'also', 'any', 'because',
  'before', 'between', 'during', 'here', 'if', 'into', 'once',
  'out', 'over', 'then', 'there', 'through', 'under', 'until', 'up',
  'while', 'down', 'off', 'further', 'get', 'got',
]);

// Queries additionally drop the domain words that appear in every lesson.
const QUERY_STOP_WORDS = new Set([...INDEX_STOP_WORDS, 'claude', 'code']);

/**
 * Tokenize text into lowercase terms, splitting on non-alphanumeric chars,
 * filtering stop words and single-character tokens.
 */
function tokenize(text, stopWords) {
  const lower = String(text).toLowerCase();
  const tokens = [];

  // Compound identifiers first. CLAUDE_PLUGIN_ROOT, list_skills, when_to_use and
  // disable-model-invocation would otherwise shatter into generic parts and lose all
  // discriminative power -- CLAUDE_PLUGIN_ROOT became ['claude','plugin','root'], which
  // matches most of the corpus, and when_to_use became ['use']. Emitting the joined form
  // as well gives each identifier one rare, high-IDF term. Additive: every token the old
  // tokenizer produced is still produced below.
  for (const m of lower.matchAll(/[a-z0-9]+(?:[._-]+[a-z0-9]+)+/g)) {
    const joined = m[0].replace(/[._-]+/g, '');
    if (joined.length > 1 && !stopWords.has(joined)) tokens.push(joined);
  }

  for (const t of lower.replace(/[^a-z0-9]+/g, ' ').split(/\s+/)) {
    if (t.length > 1 && !stopWords.has(t)) tokens.push(t);
  }

  return tokens;
}

const tokenizeQuery = (text) => tokenize(text, QUERY_STOP_WORDS);

// --- Index construction -----------------------------------------------------------

/** Augmented term frequency: 0.5 + 0.5 * (count / maxCount). */
function termFrequency(tokens) {
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  const maxFreq = Math.max(...Object.values(tf), 1);
  for (const t in tf) {
    tf[t] = 0.5 + 0.5 * (tf[t] / maxFreq);
  }
  return tf;
}

/** idf(t) = ln(N / df(t)), df = number of documents containing t. */
function computeIDF(docTokenSets) {
  const N = docTokenSets.length;
  const df = {};
  for (const tokenSet of docTokenSets) {
    for (const t of tokenSet) {
      df[t] = (df[t] || 0) + 1;
    }
  }
  const idf = {};
  for (const t in df) {
    idf[t] = Math.log(N / df[t]);
  }
  return idf;
}

/** The text a lesson is indexed under. */
function lessonText(lesson, keywordMap) {
  const relatedTopics = new Set();
  if (keywordMap) {
    for (const [kw, ids] of Object.entries(keywordMap)) {
      if (ids.includes(lesson.id)) relatedTopics.add(kw);
    }
  }
  for (const kw of (lesson.keywords || [])) relatedTopics.add(kw);
  return [
    lesson.title,
    (lesson.keywords || []).join(' '),
    lesson.description || '',
    [...relatedTopics].join(' '),
  ].join(' ');
}

/**
 * Build the index from a parsed topic-index.
 * Returns { entries: [{id, tfidf}], vocabulary: string[], idf: {term: rounded idf} }.
 */
function buildIndex(topicIndex) {
  const texts = topicIndex.lessons.map((l) => lessonText(l, topicIndex.keyword_map));
  const idf = computeIDF(texts.map((t) => new Set(tokenize(t, INDEX_STOP_WORDS))));
  const entries = topicIndex.lessons.map((lesson, i) => {
    const tf = termFrequency(tokenize(texts[i], INDEX_STOP_WORDS));
    const tfidf = {};
    for (const t in tf) {
      if (idf[t] !== undefined) tfidf[t] = +(tf[t] * idf[t]).toFixed(4);
    }
    return { id: lesson.id, tfidf };
  });
  return {
    entries,
    vocabulary: Object.keys(idf).sort(),
    idf: Object.fromEntries(Object.entries(idf).map(([k, v]) => [k, +v.toFixed(4)])),
  };
}

// --- Cache ------------------------------------------------------------------------

function cacheDirs(env = process.env) {
  if (env.CCI_INDEX_CACHE_DIR) return [env.CCI_INDEX_CACHE_DIR];
  const dirs = [];
  if (env.XDG_CACHE_HOME) dirs.push(path.join(env.XDG_CACHE_HOME, 'claude-code-internals'));
  try { dirs.push(path.join(os.homedir(), '.cache', 'claude-code-internals')); } catch { /* no home */ }
  dirs.push(path.join(os.tmpdir(), 'claude-code-internals'));
  return dirs;
}

let builderSource = null;
function cacheKey(topicBytes) {
  if (builderSource === null) builderSource = fs.readFileSync(__filename);
  return crypto.createHash('sha256')
    .update(`tfidf-index v${BUILDER_VERSION}\n`).update(builderSource).update('\n')
    .update(topicBytes).digest('hex');
}

function readCache(dirs, key) {
  for (const dir of dirs) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, `${CACHE_PREFIX}${key}.json`), 'utf8'));
      if (data && data.key === key && Array.isArray(data.entries) && Array.isArray(data.vocabulary) && data.idf) {
        return { entries: data.entries, vocabulary: data.vocabulary, idf: data.idf };
      }
    } catch { /* missing or unreadable: try the next one */ }
  }
  return null;
}

function writeCache(dirs, key, index) {
  const body = JSON.stringify({ key, builder: BUILDER_VERSION, ...index });
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${CACHE_PREFIX}${key}.json`);
      const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, file);
      // Best effort: keep only the newest CACHE_KEEP entries (never another
      // process's in-flight .tmp file).
      const old = fs.readdirSync(dir)
        .filter((f) => f.startsWith(CACHE_PREFIX) && f.endsWith('.json') && f !== path.basename(file))
        .map((f) => { try { return [f, fs.statSync(path.join(dir, f)).mtimeMs]; } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => b[1] - a[1])
        .slice(CACHE_KEEP - 1);
      for (const [f] of old) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* another process may own it */ }
      }
      return dir;
    } catch { /* unwritable: try the next one */ }
  }
  return null;
}

/**
 * Load the index for a topic-index.json. `topicBytes` (Buffer/string) and
 * `topicIndex` (parsed) may be passed when the caller already has them.
 * Never throws for cache problems; throws only if topic-index itself is unusable.
 */
function loadIndex({ topicIndexPath, topicBytes, topicIndex, env = process.env } = {}) {
  if (topicBytes === undefined) topicBytes = fs.readFileSync(topicIndexPath);
  if (env.CCI_NO_INDEX_CACHE === '1') {
    return buildIndex(topicIndex || JSON.parse(String(topicBytes)));
  }
  const dirs = cacheDirs(env);
  const key = cacheKey(topicBytes);
  const cached = readCache(dirs, key);
  if (cached) return cached;
  const index = buildIndex(topicIndex || JSON.parse(String(topicBytes)));
  writeCache(dirs, key, index);
  return index;
}

module.exports = {
  BUILDER_VERSION, INDEX_STOP_WORDS, QUERY_STOP_WORDS,
  tokenize, tokenizeQuery, termFrequency, computeIDF, lessonText, buildIndex,
  cacheDirs, cacheKey, loadIndex,
};
