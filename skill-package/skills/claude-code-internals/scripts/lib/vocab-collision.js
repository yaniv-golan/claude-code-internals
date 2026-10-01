'use strict';
/**
 * vocab-collision.js — the generation-time collision check for model-written
 * vocabulary (prepare-lessons.js --generate only; never CI, build.js or a
 * derivation).
 *
 * A NEW term (one not among the lesson's previous terms, compared in normalized
 * form) is WITHHELD when adding it as a key makes its lesson rank first, in the
 * keyword layer search.js ranks by, on a gated DEV question that belongs to
 * another lesson: the question's own lesson is not this one and this lesson is
 * not in its acceptable-answer set, and this lesson was not already first
 * without its new terms. The ranking is the committed index with the lesson's
 * current vocabulary keys replaced by its kept terms, plus the new terms
 * TOGETHER: their weights add up, so several terms can take a question that no
 * one of them takes alone (measured: two of four fresh draws for lesson 108 put
 * it above lesson 61 on id-0127, and no single term did). For each such
 * question, in qid order, the term whose removal lowers the lesson's score most
 * is withheld (ties: the later term), until the lesson is no longer first.
 *
 * Only dev questions are consulted: holdout questions must never steer what
 * the index contains (evals/retrieval/README.md, Rules). The questions come
 * from the repository's current gated set (evals/retrieval/lib.js
 * CURRENT_QUESTIONS); outside the repository the check cannot run, and the
 * proposal records that it was skipped.
 *
 * The outcome is frozen in the proposal (`withheld`, `collision_check`), and
 * planVocab() drops withheld terms on every derivation, so a derivation stays a
 * pure function of the proposals file.
 */

const fs = require('fs');
const path = require('path');
const keywordMatch = require('./keyword-match.js');
const { tokenizeQuery } = require('./tfidf-index.js');
const { lessonGenerated } = require('./keyword-provenance.js');

/**
 * The gated dev questions of the repository holding `skillDir`, or {questions: null, reason}.
 * @returns {{questions: {qid, text, lesson_id, relevant}[] | null, source?: string, reason?: string}}
 */
function loadDevQuestions(skillDir) {
  const evals = path.resolve(skillDir, '..', '..', '..', 'evals', 'retrieval');
  const libPath = path.join(evals, 'lib.js');
  if (!fs.existsSync(libPath)) return { questions: null, reason: 'no evals/retrieval next to the skill package' };
  const { CURRENT_QUESTIONS } = require(libPath);
  const file = path.join(evals, CURRENT_QUESTIONS);
  if (!fs.existsSync(file)) return { questions: null, reason: `${CURRENT_QUESTIONS} is missing` };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const questions = data.questions
    .filter((q) => (q.stratum === 'identifier' || q.stratum === 'plain') && q.split === 'dev')
    .map((q) => ({ qid: q.qid, text: q.text, lesson_id: q.lesson_id, relevant: q.relevant || { [q.lesson_id]: 1 } }));
  return { questions, source: `${CURRENT_QUESTIONS} dev` };
}

/**
 * Which of `terms` (cleaned, as planVocab() would key them) to withhold for lesson `lessonId`.
 * @param topic      the committed topic-index object (keyword_map, lessons)
 * @param candidates [{term, key}] — key: the cleaned term planVocab() would use; null when it drops it anyway
 * @param keptKeys   cleaned keys of the terms kept from the previous proposal
 * @returns {{term, qid}[]} one entry per withheld term (the question it was withheld for)
 */
function findCollisions({ topic, lessonId, candidates, keptKeys, questions }) {
  const N = topic.lessons.length;
  const exactOnly = new Set(topic.lessons.flatMap((l) => [...lessonGenerated(l)]));
  const own = new Set((topic.lessons.find((l) => l.id === lessonId) || {}).vocab_keys || []);
  const base = {};
  for (const [k, ids] of Object.entries(topic.keyword_map)) {
    const rest = own.has(k) ? ids.filter((id) => id !== lessonId) : ids;
    if (rest.length) base[k] = rest;
  }
  const addKey = (map, key) => { map[key] = [...new Set([...(map[key] || []), lessonId])].sort((a, b) => a - b); };
  for (const k of keptKeys) { addKey(base, k); exactOnly.add(k); }
  const relevantQs = questions
    .filter((q) => q.lesson_id !== lessonId && !((q.relevant[lessonId] || 0) > 0))
    .map((q) => ({ ...q, tokens: tokenizeQuery(q.text) }))
    .sort((a, b) => (a.qid < b.qid ? -1 : a.qid > b.qid ? 1 : 0));
  const rank = (keys, q) => {
    if (!keys.length) return keywordMatch.rankLessons(q.tokens, base, N, exactOnly, q.text); // compiled once, cached
    const map = { ...base };
    const ex = new Set(exactOnly);
    for (const k of keys) { addKey(map, k); ex.add(k); }
    return keywordMatch.rankLessons(q.tokens, map, N, ex, q.text);
  };
  const isFirst = (r) => r.length > 0 && r[0].id === lessonId;
  const scoreIn = (r) => (r.find((e) => e.id === lessonId) || { score: 0 }).score;
  // Each new key against the questions it can hit (the same hit test rankLessons uses).
  const live = candidates.filter((c) => c.key).map((c) => {
    const ck = keywordMatch.compileKey(c.key, { exactOnly: true });
    return { ...c, hits: new Set(relevantQs.filter((q) => q.tokens.some((t) => keywordMatch.hitKind(ck, t) !== null)).map((q) => q.qid)) };
  });
  const withheld = [];
  for (const q of relevantQs) {
    const touching = live.filter((c) => c.hits.has(q.qid));
    if (!touching.length || isFirst(rank([], q))) continue;
    // All new terms together: their effect adds up, so a set of terms can take a question none takes alone.
    let active = touching.filter((c) => !withheld.some((w) => w.term === c.term));
    while (active.length && isFirst(rank(active.map((c) => c.key), q))) {
      // Withhold the term whose removal lowers the lesson's score most (ties: the later term).
      let worst = null;
      let worstScore = Infinity;
      for (const c of active) {
        const sc = scoreIn(rank(active.filter((x) => x !== c).map((x) => x.key), q));
        if (sc <= worstScore) { worst = c; worstScore = sc; }
      }
      withheld.push({ term: worst.term, qid: q.qid });
      active = active.filter((c) => c !== worst);
    }
  }
  return withheld;
}

module.exports = { loadDevQuestions, findCollisions };
