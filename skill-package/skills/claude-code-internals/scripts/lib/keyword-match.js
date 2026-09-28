'use strict';
/**
 * keyword-match.js — the keyword layer's key-matching rule, shared by search.js
 * (ranking) and prepare-lessons.js (the collision rule), so the rule that
 * decides whether an appended key could move a ranking is the rule that ranks.
 *
 * A query token t hits a keyword_map key k when:
 *   - k is IDENTIFIER-SHAPED (no whitespace, contains . _ or -): t equals k
 *     lowercased, or k lowercased with [._-\s] runs removed (its joined form).
 *     Substring matching on these is what made the generic token 'path' hit
 *     every *_PATHS variable.
 *   - otherwise (natural-language keys, single words, bare numbers, /commands):
 *     k lowercased, or its joined form, CONTAINS t.
 * Query tokens come from lib/tfidf-index.js tokenizeQuery(): [a-z0-9]+ words
 * plus the joined form of every compound identifier.
 */

function compileKey(keyword) {
  const lower = keyword.toLowerCase();
  const joined = lower.replace(/[._\-\s]+/g, '');
  const isIdentifier = !/\s/.test(lower) && /[._-]/.test(lower);
  return { keyword, lower, joined, isIdentifier };
}

function keyHitsToken(ck, token) {
  return ck.isIdentifier
    ? (token === ck.lower || token === ck.joined)
    : (ck.lower.includes(token) || ck.joined.includes(token));
}

module.exports = { compileKey, keyHitsToken };
