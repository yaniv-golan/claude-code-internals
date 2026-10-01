'use strict';
/**
 * keyword-match.js — the keyword layer: how a query token hits a keyword_map
 * key, and how hits rank lessons. Shared by search.js (ranking) and
 * prepare-lessons.js (the collision rule), so the rule that decides whether an
 * appended key could move a ranking is the rule that ranks.
 *
 * MATCHING. Query tokens come from lib/tfidf-index.js tokenizeQuery(): [a-z0-9]+
 * words plus the joined form of every compound identifier run (a-b_c.d ->
 * abcd), stop words removed. A key's JOINED form is the key lowercased with
 * every character outside [a-z0-9] removed (`/skill-doctor` -> skilldoctor).
 * A key is IDENTIFIER-SHAPED when it has no whitespace and contains . _ or -.
 * A HAND KEBAB key is an identifier-shaped key written entirely as lowercase
 * words joined by single hyphens (`projects-uuid-mount`) that is NOT a generated
 * key (prepare-lessons.js records those per lesson in identifier_keys / vocab_keys;
 * the caller passes them as `exactOnly`): the hand keywords use that style for
 * descriptive phrases, while generated identifier keys are identifiers by
 * construction. A token t hits key k as one of three kinds:
 *   WHOLE    k is identifier-shaped and t is its lowercase form, its joined
 *            form, or the joined form of one of its compound runs (what a user
 *            typing the identifier, or its separator-delimited part, produces:
 *            `ui/download-file` is hit by downloadfile and uidownloadfile). Or k
 *            is any other key and t equals its joined form (`hooks`, `/rewind`,
 *            `2307090146`).
 *   WORD     k has several words and t equals one of them, where k is not
 *            identifier-shaped, or is a hand kebab key. Other identifier-shaped
 *            keys (CAPS_ENV_VARS, snake_case, dotted names, generated keys) are
 *            hit only as WHOLE: part-matching those is what made the generic
 *            token 'path' hit every *_PATHS variable. (A 1-character kebab part,
 *            the x of x-ray, is never hit: the tokenizer drops 1-character tokens.)
 *   PARTIAL  k is not identifier-shaped, t is at least MIN_SUBSTRING (3)
 *            characters, and k's lowercase or joined form contains t. A shorter
 *            token hits only as WHOLE or WORD, never inside a word ('re' no
 *            longer hits retry, before, prefer, ...). A key-side minimum needs no
 *            rule of its own: a partial hit is always "the key contains t".
 *
 * GENERATED PHRASES. A vocabulary key (a generated key that is not
 * identifier-shaped: model-written user wording, lib/vocab.js) is matched by
 * its words only. A WORD hit counts only when t is one of its CONTENT words
 * (stop words, 1-character words and contraction fragments excluded), and t is
 * not a contraction fragment of the query; a PARTIAL hit never counts. A hit
 * that does not count is no hit at all (it does not add to df_t either).
 * Rationale: in a sentence of 2-12 words, substrings and the stems of n't
 * contractions are incidental (`name` inside "names hidden in metrics", `doesn`
 * of "why doesn't the reminder fire"); substring credit exists for hand keys
 * that name one concept. CONTRACTION FRAGMENTS of a text are the word right
 * before 't (doesn't -> doesn, can't -> can) and the word right after an
 * apostrophe that follows a letter or digit (you're -> re, it'll -> ll).
 * `hitKind` itself is unchanged, so prepare-lessons.js's collision rule stays a
 * superset of what can count.
 *
 * COMPOUND PARTS. A query word that occurs only inside compound identifier runs
 * of the query (CLAUDE_SECURESTORAGE_CONFIG_DIR -> securestorage, config, dir;
 * the tokenizer also emits the joined run) is a PART: its hits are weighted by
 * the WORD factor (0.5), as a word of the identifier the user typed, so a part
 * can never tie the joined token's own whole-key hit (`securestorage` hitting
 * the `secure-storage` key of another lesson). A word also typed on its own
 * elsewhere in the query is not a part. Needs the query text: rankLessons()'s
 * `query` argument (without it, no token is a part and no query fragment is known).
 *
 * RANKING. With N = lessons in the index:
 *   spec(k)  = ln(1 + N / n_k)       n_k  = lessons key k maps to (key specificity)
 *   spec(t)  = ln(1 + N / df_t)      df_t = lessons token t reaches through any key
 *   w(t, k)  = min(spec(k), spec(t)) * kind(t, k) * cov(k) * part(t)
 *   kind     = 1 WHOLE, 0.5 WORD, 0.25 PARTIAL
 *   cov(k)   = for a WORD hit on a hand kebab key, the share of its content words
 *              (stop words and 1-character words excluded) that are query
 *              tokens; 1 otherwise
 *   part(t)  = 0.5 for a compound part, 1 otherwise
 *   score(L) = sum over the query's DISTINCT tokens t of max_{k hit by t, L in k} w(t, k)
 * So a hit on a whole key outweighs a hit on a part of one; no hit is worth
 * more than both the key and the token are specific (a one-lesson key hit by a
 * word that reaches forty lessons is still a common word: `cost` does not tie
 * with `get_session_cost`); a kebab phrase counts in proportion to how much of
 * it the query covers; and a lesson's credit for one token is its single best
 * hit, so many keys sharing one word cannot outvote one precise key. A token
 * repeated in the query counts once.
 * Order: score desc, then the best single hit weight desc (the most specific key
 * matched), then the number of tokens that hit, then the number of the lesson's
 * keys the query hit (counted per token; a lesson with many keys about the query
 * is more about it: `hooks` hits nine of Hooks System's keys and three of the
 * capstone's, which share the bare `hooks` key and tie on everything above), then
 * lowest id. Scores are rounded to 1e-9 before comparing, so float summation order
 * cannot break a tie.
 */

const { QUERY_STOP_WORDS } = require('./tfidf-index.js');

const MIN_SUBSTRING = 3;
const KIND = Object.freeze({ WHOLE: 'whole', WORD: 'word', PARTIAL: 'partial' });
const KIND_WEIGHT = Object.freeze({ whole: 1, word: 0.5, partial: 0.25 });

const joinedOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Compile one key. `exactOnly`: the key is a generated key, so it is never a
 * hand kebab key (see the header).
 */
function compileKey(keyword, { exactOnly = false } = {}) {
  const lower = keyword.toLowerCase();
  const joined = joinedOf(lower);
  const isIdentifier = !/\s/.test(lower) && /[._-]/.test(lower);
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const content = [...new Set(words.filter((w) => w.length > 1 && !QUERY_STOP_WORDS.has(w)))];
  const forms = new Set();
  if (isIdentifier) {
    forms.add(lower);
    forms.add(joined);
    for (const m of lower.matchAll(/[a-z0-9]+(?:[._-]+[a-z0-9]+)+/g)) forms.add(m[0].replace(/[._-]+/g, ''));
  }
  const kebab = !exactOnly && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(keyword);
  // A generated phrase (a vocabulary key): its content words leave out stop words and contraction fragments.
  const phrase = exactOnly && !isIdentifier;
  if (phrase) {
    const frag = contractionFragments(lower);
    for (let i = content.length - 1; i >= 0; i--) if (frag.has(content[i])) content.splice(i, 1);
  }
  return { keyword, lower, joined, isIdentifier, words, content, forms, kebab, phrase };
}

/**
 * Contraction fragments of a text: the word right before 't (doesn't -> doesn,
 * can't -> can, won't -> won) and the word right after an apostrophe that
 * follows a letter or digit (you're -> re, we've -> ve, it'll -> ll). They are
 * pieces of a function word, not content.
 */
function contractionFragments(text) {
  const t = String(text).toLowerCase().replace(/[‘’]/g, "'");
  const out = new Set();
  for (const m of t.matchAll(/([a-z0-9]+)'t\b/g)) out.add(m[1]);
  for (const m of t.matchAll(/[a-z0-9]'([a-z0-9]+)/g)) out.add(m[1]);
  return out;
}

const RUN_RE = /[a-z0-9]+(?:[._-]+[a-z0-9]+)+/g; // lib/tfidf-index.js tokenize(): a compound identifier run

/**
 * What the query's text says about its tokens beyond the tokens themselves:
 *   parts      the words that occur in the query ONLY inside compound runs
 *              (CLAUDE_SECURESTORAGE_CONFIG_DIR -> securestorage, config, dir);
 *   fragments  the query's contraction fragments (contractionFragments()).
 */
function queryStructure(text) {
  const lower = String(text || '').toLowerCase();
  const parts = new Set();
  for (const m of lower.matchAll(RUN_RE)) for (const w of m[0].split(/[._-]+/)) parts.add(w);
  for (const w of lower.replace(RUN_RE, ' ').split(/[^a-z0-9]+/)) parts.delete(w);
  return { parts, fragments: contractionFragments(lower) };
}

/** The kind of hit token `token` makes on compiled key `ck`, or null. */
function hitKind(ck, token) {
  if (ck.isIdentifier) {
    if (ck.forms.has(token)) return KIND.WHOLE;
    return ck.kebab && ck.words.includes(token) ? KIND.WORD : null;
  }
  if (token === ck.joined) return KIND.WHOLE;
  if (ck.words.length > 1 && ck.words.includes(token)) return KIND.WORD;
  if (token.length >= MIN_SUBSTRING && (ck.lower.includes(token) || ck.joined.includes(token))) return KIND.PARTIAL;
  return null;
}

function keyHitsToken(ck, token) {
  return hitKind(ck, token) !== null;
}

/**
 * Every query token that hits compiled key `ck`, as far as it can be listed:
 * WHOLE forms and WORD words exactly, PARTIAL as every [a-z0-9] substring of at
 * least MIN_SUBSTRING characters of the key's lowercase and joined forms, except
 * for a generated all-digit key, which lists only its whole number (the only
 * token whose hit counts). Used by prepare-lessons.js's collision rule; a test
 * holds it to "a superset of the tokens whose hits count, for every generated
 * key, and exactly those for an all-digit one". Tokens are [a-z0-9]+, so a form with
 * other characters is left out (nothing can equal it).
 */
function* surfaceTokens(ck) {
  const seen = new Set();
  const emit = function* (t) { if (/^[a-z0-9]{2,}$/.test(t) && !seen.has(t)) { seen.add(t); yield t; } };
  if (ck.isIdentifier) {
    for (const f of ck.forms) yield* emit(f);
    if (ck.kebab) for (const w of ck.words) yield* emit(w);
    return;
  }
  yield* emit(ck.joined);
  // A generated all-digit key (a gate id) is a phrase: hitCounts() never counts a PARTIAL hit on
  // it and it has no words, so its whole number is the only token that can count. Listing its
  // substrings too would only make the collision rule refuse it for no ranking reason.
  if (ck.phrase && /^[0-9]+$/.test(ck.joined)) return;
  if (ck.words.length > 1) for (const w of ck.words) yield* emit(w);
  for (const form of [ck.lower, ck.joined]) {
    for (const run of form.split(/[^a-z0-9]+/)) {
      for (let len = MIN_SUBSTRING; len <= run.length; len++) {
        for (let i = 0; i + len <= run.length; i++) yield* emit(run.slice(i, i + len));
      }
    }
  }
}

const specificity = (nLessons, nKeyLessons) => Math.log(1 + nLessons / Math.max(1, nKeyLessons));

/** Share of a hand kebab key's content words that are query tokens (1 for any other key). */
function coverage(ck, qset) {
  if (!ck.kebab || !ck.content.length) return 1;
  let n = 0;
  for (const w of ck.content) if (qset.has(w)) n++;
  return n / ck.content.length;
}

// Compiled keyword maps, per keyword_map object (search.js loads one per run;
// the eval harness reuses one across hundreds of queries).
const compiledCache = new WeakMap();
function compileMap(keywordMap, exactOnly) {
  let c = compiledCache.get(keywordMap);
  if (!c || c.exactOnly !== exactOnly) {
    c = { exactOnly, keys: Object.entries(keywordMap).map(([k, ids]) => ({ ck: compileKey(k, { exactOnly: exactOnly.has(k) }), ids })) };
    compiledCache.set(keywordMap, c);
  }
  return c.keys;
}

const round9 = (x) => Math.round(x * 1e9) / 1e9;
const EMPTY = new Set();

/** Whether a hit of kind `kind` by `token` on compiled key `ck` counts (GENERATED PHRASES in the header). */
function hitCounts(ck, token, kind, fragments) {
  if (!ck.phrase || kind === KIND.WHOLE) return true;
  if (kind === KIND.PARTIAL || fragments.has(token)) return false;
  return ck.content.includes(token);
}

/**
 * Rank lessons for query `tokens` against `keywordMap`. `nLessons` is N;
 * `exactOnly` is the set of generated keys (never hand kebab keys); `query` is
 * the query text the tokens came from (compound parts and contraction
 * fragments; optional). Returns [{id, score, best, hits, keys}] in rank order (see
 * the header).
 */
function rankLessons(tokens, keywordMap, nLessons, exactOnly = EMPTY, query = null) {
  if (!keywordMap || typeof keywordMap !== 'object') return [];
  const compiled = compileMap(keywordMap, exactOnly);
  const byLesson = new Map(); // id -> {id, score, best, hits, keys}
  const qset = new Set(tokens);
  const { parts, fragments } = query === null ? { parts: EMPTY, fragments: EMPTY } : queryStructure(query);
  for (const token of qset) {
    const hits = []; // [kind, spec(k), ids, ck]
    const reached = new Set(); // every lesson the token reaches, by any counted hit: df(t)
    for (const { ck, ids } of compiled) {
      const kind = hitKind(ck, token);
      if (kind === null || !hitCounts(ck, token, kind, fragments)) continue;
      hits.push([kind, specificity(nLessons, ids.length), ids, ck]);
      for (const id of ids) reached.add(id);
    }
    const tokenSpec = specificity(nLessons, reached.size);
    const part = parts.has(token) ? KIND_WEIGHT.word : 1;
    const bestHere = new Map(); // id -> best weight for this token
    const keysHere = new Map(); // id -> keys of that lesson this token hits
    for (const [kind, spec, ids, ck] of hits) {
      const w = Math.min(spec, tokenSpec) * KIND_WEIGHT[kind] * (kind === KIND.WORD ? coverage(ck, qset) : 1) * part;
      for (const id of ids) {
        if (!(bestHere.get(id) >= w)) bestHere.set(id, w);
        keysHere.set(id, (keysHere.get(id) || 0) + 1);
      }
    }
    for (const [id, w] of bestHere) {
      const e = byLesson.get(id) || { id, score: 0, best: 0, hits: 0, keys: 0 };
      e.score += w;
      e.best = Math.max(e.best, w);
      e.hits += 1;
      e.keys += keysHere.get(id);
      byLesson.set(id, e);
    }
  }
  return [...byLesson.values()]
    .map((e) => ({ ...e, score: round9(e.score), best: round9(e.best) }))
    .sort((a, b) => b.score - a.score || b.best - a.best || b.hits - a.hits || b.keys - a.keys || a.id - b.id);
}

module.exports = {
  MIN_SUBSTRING, KIND, KIND_WEIGHT, joinedOf, compileKey, hitKind, hitCounts, keyHitsToken, surfaceTokens, specificity, coverage,
  contractionFragments, queryStructure, rankLessons,
};
