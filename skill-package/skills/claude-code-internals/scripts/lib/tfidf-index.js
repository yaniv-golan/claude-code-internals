'use strict';
/**
 * tfidf-index.js — the TF-IDF index behind search.js and semantic-search.js,
 * built in memory from references/topic-index.json.
 *
 * There is no committed index file. The index is a pure function of
 * topic-index.json (lesson title + keywords + description + every keyword_map
 * key that points at the lesson, minus the keys prepare-lessons.js appended —
 * see generatedKeys()), so it is derived on load and cached, keyed by
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
 * CACHE. One JSON file per (topic-index bytes, this file's source) in ONE
 * directory: the first of $CCI_INDEX_CACHE_DIR (tests), else
 * $XDG_CACHE_HOME/claude-code-internals (only if absolute, per the XDG spec),
 * ~/.cache/claude-code-internals, <os.tmpdir()>/claude-code-internals that
 * exists or can be created, is owned by this user, is not group- or
 * world-writable, and is writable. The cache is read only from that directory,
 * never from a lower-priority one (a planted file in a shared tmpdir is never
 * consulted). Never inside the skill directory, which can be a read-only plugin
 * mount. An entry is used only after a deep shape check against the lessons
 * (see validCacheEntry). Any cache failure (no usable directory, unreadable,
 * corrupt, wrong key or shape) silently falls back to building in memory.
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

/**
 * Keys scripts/prepare-lessons.js appended, as recorded per lesson in
 * `identifier_keys` and `vocab_keys`. They reach the KEYWORD layer only: the TF-IDF text leaves
 * them out, so every pre-existing lesson vector, idf value and vocabulary entry
 * is exactly what it was before any append. Feeding them in shifted TF
 * normalisation and vector norms across hundreds of lessons and flipped
 * registry top-1 cases on exact ties (measured in the prototype, under the
 * Reciprocal Rank Fusion order search.js used then).
 * Vocabulary keys (phase 3b) are left out too: measured on the dev split,
 * feeding them in raised plain MRR much further (0.51 -> 0.77, the most circular
 * part of the gain: vocabulary and eval questions are both model-written from
 * the lesson text) but broke the hand-written `hooks not firing` top-1 test.
 */
function generatedKeys(lesson) {
  return new Set([...(lesson.identifier_keys || []), ...(lesson.vocab_keys || [])]);
}

/**
 * The text a lesson is indexed under. A generated key only ever maps to the
 * lessons that recorded it, so excluding a lesson's OWN records is exact.
 */
function lessonText(lesson, keywordMap, generated = generatedKeys(lesson)) {
  const keywords = (lesson.keywords || []).filter((kw) => !generated.has(kw));
  const relatedTopics = new Set();
  if (keywordMap) {
    for (const [kw, ids] of Object.entries(keywordMap)) {
      if (ids.includes(lesson.id) && !generated.has(kw)) relatedTopics.add(kw);
    }
  }
  for (const kw of keywords) relatedTopics.add(kw);
  return [
    lesson.title,
    keywords.join(' '),
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

/** Candidate cache directories, most preferred first. */
function cacheDirs(env = process.env) {
  if (env.CCI_INDEX_CACHE_DIR) return [env.CCI_INDEX_CACHE_DIR];
  const dirs = [];
  // The XDG spec says a relative $XDG_CACHE_HOME is invalid and must be ignored.
  if (env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME)) {
    dirs.push(path.join(env.XDG_CACHE_HOME, 'claude-code-internals'));
  }
  try { dirs.push(path.join(os.homedir(), '.cache', 'claude-code-internals')); } catch { /* no home */ }
  dirs.push(path.join(os.tmpdir(), 'claude-code-internals'));
  return dirs;
}

/**
 * Is `dir` safe to trust as our cache? It must be a directory owned by this
 * user and not group- or world-writable -- otherwise another local user could
 * have planted an index there (a shared /tmp) that would steer every search.
 * A symlinked leaf must itself be ours. Skipped where there are no uids (Windows).
 */
function isTrustedDir(dir) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const link = fs.lstatSync(dir);
  const st = link.isSymbolicLink() ? fs.statSync(dir) : link;
  if (!st.isDirectory()) return false;
  if (uid === null) return true;
  if (link.uid !== uid || st.uid !== uid) return false;
  return (st.mode & 0o022) === 0;
}

/**
 * The ONE directory this process reads the cache from and writes it to: the
 * first candidate that exists (or can be created, mode 0700), is trusted, and
 * is writable. Null when none qualifies (the index is then built in memory).
 * Reading only from the directory we would write to means an entry planted in
 * a lower-priority directory is never consulted.
 */
function selectCacheDir(dirs) {
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (!isTrustedDir(dir)) continue;
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
      return dir;
    } catch { /* unusable: try the next one */ }
  }
  return null;
}

let builderSource = null;
function cacheKey(topicBytes) {
  if (builderSource === null) builderSource = fs.readFileSync(__filename);
  return crypto.createHash('sha256')
    .update(`tfidf-index v${BUILDER_VERSION}\n`).update(builderSource).update('\n')
    .update(topicBytes).digest('hex');
}

const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)
  && Object.getPrototypeOf(o) === Object.prototype;
const allFinite = (o) => Object.values(o).every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * A cache entry is used only if it has exactly the shape buildIndex() returns
 * for these lessons: one entry per lesson, same ids in the same order, tfidf
 * and idf plain objects of finite numbers, vocabulary the sorted idf terms.
 * Anything else is treated as a miss and rebuilt.
 */
function validCacheEntry(data, key, lessons) {
  if (!isPlainObject(data) || data.key !== key) return false;
  const { entries, vocabulary, idf } = data;
  if (!Array.isArray(entries) || entries.length !== lessons.length) return false;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!isPlainObject(e) || e.id !== lessons[i].id || !isPlainObject(e.tfidf) || !allFinite(e.tfidf)) return false;
  }
  if (!isPlainObject(idf) || !allFinite(idf)) return false;
  if (!Array.isArray(vocabulary) || !vocabulary.every((t) => typeof t === 'string')) return false;
  const terms = Object.keys(idf).sort();
  if (terms.length !== vocabulary.length || terms.some((t, i) => t !== vocabulary[i])) return false;
  return true;
}

function readCache(dir, key, lessons) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, `${CACHE_PREFIX}${key}.json`), 'utf8'));
    if (validCacheEntry(data, key, lessons)) {
      return { entries: data.entries, vocabulary: data.vocabulary, idf: data.idf };
    }
  } catch { /* missing, unreadable or corrupt: a miss */ }
  return null;
}

function writeCache(dir, key, index) {
  const body = JSON.stringify({ key, builder: BUILDER_VERSION, ...index });
  const file = path.join(dir, `${CACHE_PREFIX}${key}.json`);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let renamed = false;
  try {
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file);
    renamed = true;
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
    return true;
  } catch {
    return false; // unwritable or full: the in-memory index is still returned
  } finally {
    if (!renamed) { try { fs.unlinkSync(tmp); } catch { /* never created */ } }
  }
}

/**
 * Load the index for a topic-index.json. `topicBytes` (Buffer/string) and
 * `topicIndex` (parsed) may be passed when the caller already has them.
 * Never throws for cache problems; throws only if topic-index itself is unusable.
 */
function loadIndex({ topicIndexPath, topicBytes, topicIndex, env = process.env } = {}) {
  if (topicBytes === undefined) topicBytes = fs.readFileSync(topicIndexPath);
  if (!topicIndex) topicIndex = JSON.parse(String(topicBytes));
  if (env.CCI_NO_INDEX_CACHE === '1') return buildIndex(topicIndex);
  const dir = selectCacheDir(cacheDirs(env));
  const key = cacheKey(topicBytes);
  if (dir) {
    const cached = readCache(dir, key, topicIndex.lessons);
    if (cached) return cached;
  }
  const index = buildIndex(topicIndex);
  if (dir) writeCache(dir, key, index);
  return index;
}

module.exports = {
  BUILDER_VERSION, INDEX_STOP_WORDS, QUERY_STOP_WORDS,
  tokenize, tokenizeQuery, termFrequency, computeIDF, generatedKeys, lessonText, buildIndex,
  cacheDirs, selectCacheDir, isTrustedDir, validCacheEntry, cacheKey, loadIndex,
};
