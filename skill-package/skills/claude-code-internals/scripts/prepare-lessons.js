#!/usr/bin/env node
/**
 * prepare-lessons.js — derives the keyword_map keys for the identifiers each
 * lesson mentions. Nobody hand-edits keywords: when an outcome is wrong, the
 * fix is a change to a rule below, never a hand edit of the data.
 *
 * HAND KEYS ARE FROZEN; GENERATED KEYS ARE DERIVED (plan §4.7, "Adversarial
 * review of phase 3"). The hand keys live in their own frozen file,
 * references/hand-keywords.json, which no script writes (lib/keyword-provenance.js).
 * topic-index.json's keyword_map and lessons[].keywords / identifier_keys are
 * BUILD OUTPUT, a pure function of that file, the lesson list and the lesson
 * text:
 *   keyword_map         = the hand keys projected onto the live lessons (each
 *                         keeps its live lessons in order; a key with none
 *                         left drops out), in the snapshot's order, then the
 *                         generated keys in derivation order;
 *   lessons[].keywords  = the lesson's hand keywords, then its generated keys;
 *   identifier_keys     = the lesson's generated keys (absent when none).
 * Every run recomputes all of it and rewrites the fields; --check compares.
 * So a lesson edit, a new lesson or a deleted lesson needs no keyword edit and
 * no flag: the next run adds, re-homes, removes or projects away what changed.
 * Provenance is membership in hand-keywords.json, never inferred from what
 * topic-index.json holds, so nothing can re-classify a generated key as hand.
 *
 * WRITES follow build.js: every input is hashed when read (topic-index.json,
 * hand-keywords.json, each reference file, the other indexes build.js reads),
 * and git HEAD is recorded before anything is read (when the skill is inside
 * a git work tree); immediately before writing, all of them are re-read and
 * re-hashed (and the reference file list re-listed, and HEAD re-read), and if
 * anything changed since the run started (a peer session) the run aborts and
 * writes nothing. topic-index.json is written through check-json-format.js's
 * order-preserving writer to a temp file beside it and renamed into place. The
 * text about to be written is run through the --check comparison first.
 *
 * RECORDS. Each lesson lists, in `identifier_keys`, the generated keys mapped
 * to it. lib/tfidf-index.js leaves them out of the TF-IDF text, so generated
 * keys reach the KEYWORD layer only and every hand-built TF-IDF vector is
 * unchanged (a test asserts the index is identical with and without them).
 * Why: feeding them into TF-IDF shifted TF normalisation and vector norms and
 * flipped registry top-1 cases on exact RRF ties broken by lowest id, which no
 * collision rule can reach because it is not a key collision (plan §4.7,
 * "Prototype result"). lookup.sh ignores generated keys, and search.js,
 * semantic-search.js and fetch-lesson.js do not print them.
 *
 * MODES
 *   node scripts/prepare-lessons.js [identifiers]   derive and write the generated keys
 *   node scripts/prepare-lessons.js --check         offline, no git; exit 1 unless the stored state is the derived one
 *   --accept-unreachable  let the UNREACHABLE count (rule 3c) rise above its ceiling,
 *                         or set the ceiling when it is missing or malformed
 *   add --dry-run to report without writing; --root DIR to operate on another
 *   skill dir; --report FILE to save the plan and report as JSON (written only
 *   once the result has been validated)
 *
 * ---------------------------------------------------------------------------
 * RULE 1 — CANDIDATES. lib/identifiers.js keywordCandidates(): single
 * identifier tokens from the published extractor (code spans, CAPS_ENV_VARS,
 * 7-10 digit gate ids, /slash-commands, tengu_*, mcp__x__y), run on each
 * lesson's canonical text (startLine..endLine as build.js derives them). From
 * a code span: each compound identifier inside it, a dotted member-access chain
 * split into its identifier segments (store.getState is not searched for;
 * session_ingress_token is), file/host names and versions kept whole, hash-like
 * runs dropped, and a single camelCase or letter+digit token. Plain words and
 * multi-word spans are not identifiers. Hook event names are caught when
 * code-formatted (PascalCase span), which is how the lessons write them.
 * Context rejections there: /slash matches inside markup (`</summary>`), and
 * truncated mcp__ names (every occurrence continues with `-`, or ends in `_`).
 *
 * RULE 1b — KEY FORM AND SHAPE. A camelCase token is stored in lowercase
 * separator form (switchSession -> switch-session: identifier-shaped, so only
 * the token a user typing `switchSession` produces hits it). Never keys
 * (identifiers.js shapeReject): a joined form of <= 3 characters or an
 * all-digit one shorter than 7 (minified symbols, versions like 2.1.197),
 * hashes (UUIDs, hex blobs), regex character classes and size descriptors
 * (A-Za-z, 0-9a-f, 8-hex), Unix permission strings (drwxr-xr-x). And a key
 * must be SELF-REACHABLE: the query tokens of the identifier as written must
 * hit the key (so `/foo-bar`, whose key no [a-z0-9] token can equal, is not a
 * key).
 *
 * RULE 2 — HOME LESSONS (multi-lesson rule). An identifier found in several
 * lessons is mapped to the lesson(s) where it occurs MOST OFTEN; lessons tied
 * at the maximum all get it. Occurrence is not relevance: mapping to every
 * lesson that mentions a name would make each passing mention a keyword hit
 * (the existing hand-made keys agree: of 321 single-lesson identifier keys whose
 * identifier occurs in several lessons, 251 point at a max-count lesson). The
 * other lessons are reported as "mentioned elsewhere", not failed. A key whose
 * home set has MORE THAN 2 lessons is skipped (reported as "spread"): it names
 * no lesson in particular.
 *
 * RULE 3 — COLLISION RULE, stated in search.js's own matching semantics
 * (lib/keyword-match.js), judged against the (projected) HAND keys plus the keys this
 * derivation appended before it: a query token t hits an identifier-shaped key
 * (no whitespace, has . _ or -) only when t equals its joined form, and hits
 * any other key when the key CONTAINS t. A token is LIVE when a key already
 * hits it. Appending a key k -> [L] adds L to the hit set of every token k
 * hits; when that token is live, L now competes with the lessons that owned
 * it, and search.js breaks hit-count ties by LOWEST id — that is how
 * `when_to_use` flipped 88 -> 11 in an earlier prototype (a raw identifier
 * with the same joined form). So:
 *   3a. EXACT: a candidate (or its key form) that already is a hand key, or a
 *       hand keyword of one of its home lessons, is left alone (hand wins).
 *       So is a RETIRED hand key (in hand-keywords.json, but every lesson it
 *       named is gone): it stays hand, so it is never generated. Retired keys
 *       are reported, and not counted as unreachable, so deleting a lesson
 *       cannot raise the ceiling below.
 *   3b. NORMALIZED: a candidate whose normalized form (lowercase,
 *       non-alphanumeric runs -> one space), raw or key form, equals an
 *       existing key's is skipped.
 *   3c. APPENDS OPEN ONLY NEW TOKENS: skip the candidate if any token it would
 *       hit is live. For an identifier-shaped key that is its joined form;
 *       for any other key (bare numbers, /commands, letter+digit tokens) it is
 *       EVERY substring of length >= 2 of its alphanumeric form, because that
 *       is what search.js's substring match hits. Such a skipped identifier
 *       stays UNREACHABLE and is counted. The count has a ceiling
 *       (topic-index.json keyword_boundary.unreachable_max, a non-negative
 *       integer that must be present): --check fails if it is missing or
 *       malformed or the count exceeds it, a run refuses to raise or (re)set
 *       it without --accept-unreachable, and lowers it whenever it falls.
 *   Keys appended earlier in the same derivation count as existing for later
 *   ones; the derivation order is lesson order, then extraction order — never
 *   the stored key order — so the derived set is well defined.
 *
 * --check (offline, CI via build.js --check) fails when: hand-keywords.json is
 * not the frozen snapshot; the hand keys in topic-index.json are not its
 * projection; the stored generated set differs from the derived one (stale,
 * missing or re-homed keys); a lesson's keywords / identifier_keys are not its
 * derived ones; the ceiling is missing, malformed or exceeded; or, all that
 * being equal, the keyword fields are not byte-for-byte what a run would
 * write (order, stray fields). A failure names the fix.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseOrdered, emit, PINNED } = require('./check-json-format.js');
const { keywordCandidates, normalize, keyFormOf, shapeReject } = require('./lib/identifiers.js');
const { compileKey, keyHitsToken } = require('./lib/keyword-match.js');
const { tokenizeQuery } = require('./lib/tfidf-index.js');
const {
  BOUNDARY_FIELD, loadHandSource, handSourceErrors, projectHand, handTopic,
} = require('./lib/keyword-provenance.js');

const MAX_HOMES = 2;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function load(skillDir) {
  const topicPath = path.join(skillDir, 'references', 'topic-index.json');
  const raw = fs.readFileSync(topicPath, 'utf8');
  const topic = JSON.parse(raw);
  const fileCache = new Map();
  const lessonText = (l) => {
    if (!fileCache.has(l.file)) {
      fileCache.set(l.file, fs.readFileSync(path.join(skillDir, 'references', l.file), 'utf8').split('\n'));
    }
    return fileCache.get(l.file).slice(l.startLine - 1, l.endLine).join('\n');
  };
  return { topicPath, raw, hash: sha(raw), topic, lessonText };
}

// ---------------------------------------------------------------------------
// Key state (hand keys + appends made during this derivation)
// ---------------------------------------------------------------------------

class KeyState {
  constructor(keywordMap) {
    this.map = new Map(Object.entries(keywordMap).map(([k, v]) => [k, v.slice()]));
    this.compiled = [...this.map.keys()].map((k) => compileKey(k));
    this.byNorm = new Map();
    for (const k of this.map.keys()) {
      const n = normalize(k);
      if (n && !this.byNorm.has(n)) this.byNorm.set(n, k);
    }
    // isLive() index: identifier keys are hit by exactly their lower/joined forms;
    // substring keys by any token they contain.
    this.identTokens = new Set();
    this.substringKeys = [];
    for (const ck of this.compiled) this.index(ck);
    this.liveCache = new Map();
  }

  index(ck) {
    if (ck.isIdentifier) { this.identTokens.add(ck.lower); this.identTokens.add(ck.joined); }
    else this.substringKeys.push(ck);
  }

  /** Does any key hit query token `t` under search.js semantics? */
  isLive(t) {
    let v = this.liveCache.get(t);
    if (v === undefined) {
      v = this.identTokens.has(t) || this.substringKeys.some((ck) => ck.lower.includes(t) || ck.joined.includes(t));
      this.liveCache.set(t, v);
    }
    return v;
  }

  /** Keys (with their lessons) that hit query token `t` - for reports. */
  owners(t) {
    const m = new Map();
    for (const ck of this.compiled) if (keyHitsToken(ck, t)) m.set(ck.keyword, this.map.get(ck.keyword));
    return m;
  }

  add(key, lessons) {
    this.map.set(key, lessons.slice());
    const ck = compileKey(key);
    this.compiled.push(ck);
    this.index(ck);
    const n = normalize(key);
    if (n && !this.byNorm.has(n)) this.byNorm.set(n, key);
    for (const [t, v] of this.liveCache) if (!v && keyHitsToken(ck, t)) this.liveCache.set(t, true);
  }
}

/**
 * Every query token a candidate key would be hit by (search.js semantics; query
 * tokens are [a-z0-9]{2,}): an identifier-shaped key only by its joined form; any
 * other key by every substring of length >= 2 of its alphanumeric form, shortest
 * first (a short substring is the likeliest to be live, so rejection is quick).
 */
function* surfaceTokens(key) {
  const ck = compileKey(key);
  if (ck.isIdentifier) { yield ck.joined; return; }
  const seen = new Set();
  for (const form of [ck.lower.replace(/[^a-z0-9]/g, ''), ck.joined]) {
    if (!/^[a-z0-9]+$/.test(form)) continue;
    for (let len = 2; len <= form.length; len++) {
      for (let i = 0; i + len <= form.length; i++) {
        const t = form.slice(i, i + len);
        if (!seen.has(t)) { seen.add(t); yield t; }
      }
    }
  }
}

/** The single query token a user typing the identifier produces for it. */
function wholeToken(key) {
  const ck = compileKey(key);
  return ck.isIdentifier ? ck.joined : ck.lower.replace(/[^a-z0-9]/g, '');
}

/** Rule 1b: do the query tokens of the identifier as written hit its key? */
function selfReachable(raw, key) {
  const ck = compileKey(key);
  return tokenizeQuery(raw).some((t) => keyHitsToken(ck, t));
}

function shapeOf(raw) {
  if (/^\d+$/.test(raw)) return 'digits';
  if (raw.startsWith('/')) return 'slash';
  if (compileKey(raw).isIdentifier) return 'identifier';
  if (/[a-z][A-Z]/.test(raw)) return 'camelCase';
  return 'other';
}

// ---------------------------------------------------------------------------
// Rules 1-3: derive the generated keys
// ---------------------------------------------------------------------------

/**
 * Derive the generated key set from the HAND-ONLY index (lib/keyword-provenance.js
 * handTopic(): the projected hand keys and keywords, nothing generated) and the
 * lesson text. Pure; nothing written. `retired`: hand-source keys no longer
 * projected, which are never generated (rule 3a).
 * @returns {{derived: [{key, raw, lessons, kind}], report}} derived in derivation order
 */
function planIdentifiers(hand, lessonText, { retired = new Set() } = {}) {
  const state = new KeyState(hand.keyword_map || {});
  const handKw = new Map(hand.lessons.map((l) => [l.id, new Set(l.keywords || [])]));

  // Collect occurrences in topic-index lesson order, then extraction order.
  const byRaw = new Map();
  const rejected = [];
  for (const l of hand.lessons) {
    const sink = [];
    for (const c of keywordCandidates(lessonText(l), sink)) {
      if (!byRaw.has(c.raw)) byRaw.set(c.raw, { ...c, occ: [] });
      byRaw.get(c.raw).occ.push({ id: l.id, count: c.count });
    }
    for (const r of sink) rejected.push({ ...r, lesson: l.id });
  }

  const derived = [];
  const report = {
    candidates: byRaw.size, occurrences: 0, rejected: [], alreadyKey: [], retired: [], handKeyword: [], normalized: [],
    spread: [], claimed: [], fragment: [], elsewhere: [], derived: 0,
  };
  // A context rejection counts only when the identifier survives nowhere else.
  const seenRejected = new Set();
  for (const r of rejected) {
    if (byRaw.has(r.raw) || seenRejected.has(r.raw)) continue;
    seenRejected.add(r.raw);
    report.rejected.push({ raw: r.raw, reason: r.reason });
  }

  for (const [raw, c] of byRaw) {
    report.occurrences += c.occ.length;
    const key = keyFormOf(raw);
    const why = shapeReject(raw, key) || (selfReachable(raw, key) ? null : 'not-self-reachable');
    if (why) { report.rejected.push({ raw, reason: why }); continue; }

    const max = Math.max(...c.occ.map((o) => o.count));
    const home = c.occ.filter((o) => o.count === max).map((o) => o.id);
    const others = c.occ.filter((o) => o.count !== max).map((o) => o.id);

    const exact = [raw, key].find((k) => state.map.has(k));
    if (exact !== undefined) {
      const mapped = state.map.get(exact);
      const missing = c.occ.map((o) => o.id).filter((id) => !mapped.includes(id));
      report.alreadyKey.push({ raw, key: exact, mapped, missing });
      continue;
    }
    const gone = [raw, key].find((k) => retired.has(k));
    if (gone !== undefined) {
      report.retired.push({ raw, key: gone, home });
      continue;
    }
    if (home.some((id) => handKw.get(id).has(key) || handKw.get(id).has(raw))) {
      report.handKeyword.push({ raw, key, home });
      continue;
    }
    const clash = [c.normalized, normalize(key)].map((n) => state.byNorm.get(n)).find((k) => k !== undefined);
    if (clash !== undefined) {
      report.normalized.push({ raw, key: clash, mapped: state.map.get(clash), home });
      continue;
    }
    if (home.length > MAX_HOMES) {
      report.spread.push({ raw, key, home });
      continue;
    }
    let liveToken = null;
    for (const t of surfaceTokens(key)) if (state.isLive(t)) { liveToken = t; break; }
    if (liveToken !== null) {
      // CLAIMED: the identifier's own query token already hits a key (reachable, maybe
      // via another lesson). FRAGMENT: only a substring of it is live, so the identifier
      // itself stays unreachable - a deliberate sacrifice of rule 3c.
      const whole = wholeToken(key);
      if (state.isLive(whole)) {
        const owners = [...new Set([...state.owners(whole).values()].flat())];
        report.claimed.push({ raw, key, home, owners, reachable: home.some((id) => owners.includes(id)) });
      } else {
        report.fragment.push({ raw, key, home, shape: shapeOf(raw), token: liveToken, keys: [...state.owners(liveToken).keys()].slice(0, 3) });
      }
      continue;
    }
    derived.push({ key, raw, lessons: home, kind: c.kind });
    state.add(key, home);
    if (others.length) report.elsewhere.push({ raw, key, home, others });
  }
  report.derived = derived.length;
  report.unreachable = report.fragment.length;
  return { derived, report };
}

// ---------------------------------------------------------------------------
// Stored state vs derived state
// ---------------------------------------------------------------------------

const entryOf = (obj, key) => obj.entries.find(([k]) => k === JSON.stringify(key));
const rawStr = (s) => ({ t: 'raw', text: JSON.stringify(s) });
const idArr = (ids) => ({ t: 'arr', items: ids.map((id) => ({ t: 'raw', text: String(id) })) });

/** keyword_map as stored, in SOURCE order: [[key, ids]] (JSON.parse hoists integer-like keys). */
function storedKeyList(raw) {
  const e = entryOf(parseOrdered(raw), 'keyword_map');
  if (!e || e[1].t !== 'obj') return [];
  return e[1].entries.map(([kq, v]) => [JSON.parse(kq), v.t === 'arr' ? v.items.map((n) => JSON.parse(n.text)) : v.text]);
}

/** The stored generated keys (keyword_map keys that are not in the hand source): key -> lessons. */
function storedGenerated(raw, hand) {
  return new Map(storedKeyList(raw).filter(([k]) => !hand.keySet.has(k)));
}

/** Keys added, removed and re-homed going from the stored state to `derived`. */
function diffGenerated(stored, derived) {
  const want = new Map(derived.map((d) => [d.key, d.lessons]));
  const added = derived.filter((d) => !stored.has(d.key)).map((d) => d.key);
  const removed = [...stored.keys()].filter((k) => !want.has(k));
  const rehomed = derived.filter((d) => stored.has(d.key) && JSON.stringify(stored.get(d.key)) !== JSON.stringify(d.lessons)).map((d) => d.key);
  return { added, removed, rehomed };
}

/**
 * The ceiling on the UNREACHABLE count (rule 3c): {value} when
 * keyword_boundary.unreachable_max is a present non-negative integer, else {error}.
 */
function ceilingOf(topic) {
  const b = topic[BOUNDARY_FIELD];
  const fix = 'set it explicitly: node scripts/prepare-lessons.js --accept-unreachable';
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: `topic-index.json has no ${BOUNDARY_FIELD} record, so the UNREACHABLE ceiling is unknown — ${fix}` };
  if (!('unreachable_max' in b)) return { error: `${BOUNDARY_FIELD}.unreachable_max is missing — ${fix}` };
  const v = b.unreachable_max;
  if (!Number.isInteger(v) || v < 0) return { error: `${BOUNDARY_FIELD}.unreachable_max must be a non-negative integer, found ${JSON.stringify(v)} — ${fix}` };
  return { value: v };
}

function listed(keys, n = 10) {
  return keys.slice(0, n).join(', ') + (keys.length > n ? `, ... (${keys.length} in all)` : '');
}

// ---------------------------------------------------------------------------
// Rendering: the keyword fields of topic-index.json as build output
// ---------------------------------------------------------------------------

/**
 * topic-index.json text with its keyword fields replaced by the derived ones:
 * keyword_map = projected hand keys (snapshot order, snapshot bytes) then the
 * generated keys (derivation order); each lesson's keywords = its hand keywords
 * then its generated keys; identifier_keys = its generated keys (dropped when
 * empty); keyword_boundary = `boundary`. Nothing else is touched.
 */
function renderTopic(raw, hand, derived, boundary) {
  const tree = parseOrdered(raw);
  const ids = entryOf(tree, 'lessons')[1].items.map((item) => Number(entryOf(item, 'id')[1].text));
  const proj = projectHand(hand, ids);

  const kmapNode = {
    t: 'obj',
    entries: [
      ...proj.keys.map((k) => [k.keyText, { t: 'arr', items: k.items.map((it) => it.node) }]),
      ...derived.map((d) => [JSON.stringify(d.key), idArr(d.lessons)]),
    ],
  };
  const kmapEntry = entryOf(tree, 'keyword_map');
  if (kmapEntry) kmapEntry[1] = kmapNode;
  else tree.entries.push(['"keyword_map"', kmapNode]);

  const byLesson = new Map();
  for (const d of derived) for (const id of d.lessons) {
    if (!byLesson.has(id)) byLesson.set(id, []);
    byLesson.get(id).push(d.key);
  }
  for (const item of entryOf(tree, 'lessons')[1].items) {
    const id = Number(entryOf(item, 'id')[1].text);
    const gen = byLesson.get(id) || [];
    const kwNode = { t: 'arr', items: [...proj.lessonKeywords(id).map((x) => x.node), ...gen.map(rawStr)] };
    const kwEntry = entryOf(item, 'keywords');
    if (kwEntry) kwEntry[1] = kwNode;
    else {
      // A new lesson written without keywords: where every other entry carries them.
      const after = ['endLine', 'startLine', 'file'].map((k) => item.entries.findIndex(([q]) => q === JSON.stringify(k))).find((i) => i >= 0);
      item.entries.splice(after === undefined ? item.entries.length : after + 1, 0, ['"keywords"', kwNode]);
    }
    const ikEntry = entryOf(item, 'identifier_keys');
    if (!gen.length) item.entries = item.entries.filter(([k]) => k !== '"identifier_keys"');
    else if (ikEntry) ikEntry[1] = { t: 'arr', items: gen.map(rawStr) };
    else item.entries.push(['"identifier_keys"', { t: 'arr', items: gen.map(rawStr) }]);
  }

  const bNode = parseOrdered(JSON.stringify(boundary));
  const bEntry = entryOf(tree, BOUNDARY_FIELD);
  if (bEntry) bEntry[1] = bNode;
  else tree.entries.push([JSON.stringify(BOUNDARY_FIELD), bNode]);

  const fmt = PINNED['topic-index.json'];
  return emit(tree, fmt.indent) + (fmt.trailingNewline ? '\n' : '');
}

// ---------------------------------------------------------------------------
// The check (also run over every text before it is written)
// ---------------------------------------------------------------------------

/** What differs between the stored hand keys (`got`: [[key, ids]] in source order) and the projection, in words. */
function handProjectionErrors(got, proj) {
  const want = proj.keys.map((k) => [k.key, k.items.map((it) => it.id)]);
  const errs = [];
  const wantMap = new Map(want);
  const gotMap = new Map(got);
  const missing = want.filter(([k]) => !gotMap.has(k)).map(([k]) => k);
  const retiredKept = got.filter(([k]) => !wantMap.has(k)).map(([k]) => k);
  const changed = want.filter(([k, v]) => gotMap.has(k) && JSON.stringify(gotMap.get(k)) !== JSON.stringify(v)).map(([k]) => k);
  if (missing.length) errs.push(`${missing.length} hand key(s) missing: ${listed(missing)}`);
  if (retiredKept.length) errs.push(`${retiredKept.length} retired hand key(s) (every lesson they named is gone) still stored: ${listed(retiredKept)}`);
  if (changed.length) errs.push(`${changed.length} hand key(s) map to other lessons than their projection: ${listed(changed)}`);
  if (!errs.length && JSON.stringify(got.map(([k]) => k)) !== JSON.stringify(want.map(([k]) => k))) errs.push('hand keys are out of their hand-keywords.json order');
  return errs;
}

/**
 * Offline check of topic-index.json's keyword fields against the derivation.
 * ctx: { raw: topic-index.json text (bounds as build.js derives them),
 *        lessonText: (lesson) => text, hand: lib/keyword-provenance.js hand source }
 * @returns {{errors: string[], notes: string[], report, derived}}
 */
function checkLessons({ raw, lessonText, hand }) {
  const fix = ' — run node scripts/prepare-lessons.js';
  const topic = JSON.parse(raw);
  const errors = [...handSourceErrors(hand)];
  const ceiling = ceilingOf(topic);
  if (ceiling.error) errors.push(ceiling.error);

  const { topic: ht, retired } = handTopic(topic, hand);
  const { derived, report } = planIdentifiers(ht, lessonText, { retired });
  const proj = projectHand(hand, topic.lessons.map((l) => l.id));
  const stored = storedKeyList(raw);

  const hErr = handProjectionErrors(stored.filter(([k]) => hand.keySet.has(k)), proj);
  if (hErr.length) errors.push(`the hand keys in topic-index.json are not the projection of hand-keywords.json: ${hErr.join('; ')}${fix}`);

  const d = diffGenerated(new Map(stored.filter(([k]) => !hand.keySet.has(k))), derived);
  const lessonsOf = new Map(derived.map((x) => [x.key, x.lessons]));
  if (d.added.length) errors.push(`${d.added.length} identifier(s) are not reachable by any key: ${listed(d.added.map((k) => `${k} (lesson ${lessonsOf.get(k).join(',')})`))}${fix}`);
  if (d.removed.length) errors.push(`${d.removed.length} stored generated key(s) are no longer derived from the lesson text: ${listed(d.removed)}${fix}`);
  if (d.rehomed.length) errors.push(`${d.rehomed.length} generated key(s) now belong to other lessons: ${listed(d.rehomed)}${fix}`);

  const byLesson = new Map();
  for (const x of derived) for (const id of x.lessons) {
    if (!byLesson.has(id)) byLesson.set(id, []);
    byLesson.get(id).push(x.key);
  }
  const badIk = [];
  const badKw = [];
  for (const l of topic.lessons) {
    const gen = byLesson.get(l.id) || [];
    const ik = l.identifier_keys;
    if (JSON.stringify(ik === undefined ? [] : ik) !== JSON.stringify(gen) || (ik !== undefined && !gen.length)) badIk.push(l.id);
    const kw = [...proj.lessonKeywords(l.id).map((x) => x.value), ...gen];
    if (JSON.stringify(l.keywords) !== JSON.stringify(kw)) badKw.push(l.id);
  }
  if (badIk.length) errors.push(`${badIk.length} lesson(s) record other identifier_keys than derived: ${listed(badIk.map(String))}${fix}`);
  if (badKw.length) errors.push(`${badKw.length} lesson(s) carry other keywords than their hand keywords + generated keys: ${listed(badKw.map(String))}${fix}`);

  if (!ceiling.error && report.unreachable > ceiling.value) {
    errors.push(`UNREACHABLE identifiers rose from ${ceiling.value} to ${report.unreachable} (rule 3c) — fix the rule, or accept it: node scripts/prepare-lessons.js --accept-unreachable`);
  }
  // Catch-all: with every comparison above equal, the file must be exactly what a run writes.
  if (!errors.length && renderTopic(raw, hand, derived, { unreachable_max: ceiling.value }) !== raw) {
    errors.push(`topic-index.json keyword fields are not in derived form (key order, stray fields or ${BOUNDARY_FIELD} layout)${fix}`);
  }
  const notes = [`identifiers: ${summarize(report)}; unreachable ceiling ${ceiling.error ? 'invalid' : ceiling.value}`];
  return { errors, notes, report, derived };
}

// ---------------------------------------------------------------------------
// Writing (order-preserving, atomic, aborts if an input or HEAD moved)
// ---------------------------------------------------------------------------

/**
 * Write `text` over topic-index.json, but only if no input changed since the
 * run read it: the same re-hash build.js does before its own writes, over the
 * inputs build() recorded (which include topic-index.json and every reference
 * file the lesson text came from) plus hand-keywords.json and git HEAD.
 * Otherwise throw EINPUTCHANGED, write nothing.
 */
function writeTopic(loaded, derivedBuild, text) {
  const { changedInputs, writeAtomic } = require('./build.js');
  const moved = changedInputs(derivedBuild);
  if (moved.length) {
    const err = new Error(`inputs changed while prepare-lessons.js was running; nothing written. Re-run it.\n  ${moved.join('\n  ')}`);
    err.code = 'EINPUTCHANGED';
    throw err;
  }
  writeAtomic(loaded.topicPath, text);
}

// ---------------------------------------------------------------------------
// Bounds guard: identifiers must be read from build.js's bounds
// ---------------------------------------------------------------------------

/**
 * Run build.js's derivation and compare its bounds with the stored ones.
 * Returns { derived, problems }. `derived.inputs` hashes every file build()
 * read; the topic-index hash must equal the one load() read, so the plan and
 * the re-hash before writing both describe the same bytes.
 */
function deriveBounds(skillDir, loaded) {
  const { build } = require('./build.js');
  const derived = build(skillDir);
  if (derived.errors.length) return { derived, problems: derived.errors.slice(0, 5) };
  const problems = [];
  if (derived.inputs.get(loaded.topicPath) !== loaded.hash) problems.push('topic-index.json changed while this ran (another session?)');
  for (const l of loaded.topic.lessons) {
    const b = derived.bounds.get(l.id);
    if (!b || b.startLine !== l.startLine || b.endLine !== l.endLine) problems.push(`lesson ${l.id} bounds are stale`);
  }
  return { derived, problems };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function summarize(report) {
  const shapes = {};
  for (const f of report.fragment) shapes[f.shape] = (shapes[f.shape] || 0) + 1;
  const reasons = {};
  for (const r of report.rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const claimedElsewhere = report.claimed.filter((c) => !c.reachable).length;
  return `${report.candidates} identifiers (${report.occurrences} lesson occurrences): ` +
    `${report.rejected.length} rejected (${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), ` +
    `${report.alreadyKey.length} already hand keys, ${report.retired.length} retired hand keys, ${report.handKeyword.length} hand keywords, ` +
    `${report.normalized.length} normalized-collision, ${report.spread.length} spread over > ${MAX_HOMES} lessons, ` +
    `${report.claimed.length} token already hit by a key (${claimedElsewhere} of them only via other lessons), ` +
    `${report.fragment.length} UNREACHABLE, skipped by rule 3c (${Object.entries(shapes).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), ` +
    `${report.derived} generated keys (${report.elsewhere.length} of them also mentioned in non-home lessons)`;
}

/**
 * The identifier pass. opts: { dryRun, reportFile, beforeWrite, acceptUnreachable }
 * — beforeWrite is a test hook called between planning and the pre-write re-hash.
 */
function runIdentifiers(skillDir, opts = {}, log = console.log) {
  const { gitHead } = require('./build.js');
  const head = gitHead(skillDir); // before anything is read
  const loaded = load(skillDir);
  const hand = loadHandSource(skillDir);
  const hErr = handSourceErrors(hand);
  if (hErr.length) throw new Error(hErr.join('\n'));
  const { derived: derivedBuild, problems } = deriveBounds(skillDir, loaded);
  if (problems.length) throw new Error(`run node scripts/build.js first:\n  ${problems.join('\n  ')}`);
  derivedBuild.inputs.set(hand.abs, hand.sha256);
  derivedBuild.head = head;
  derivedBuild.headDir = skillDir;

  const ceiling = ceilingOf(loaded.topic);
  if (ceiling.error && !opts.acceptUnreachable) throw new Error(ceiling.error);
  const { topic: ht, retired } = handTopic(loaded.topic, hand);
  const { derived, report } = planIdentifiers(ht, loaded.lessonText, { retired });
  log(`identifiers: ${summarize(report)}`);
  if (!ceiling.error && report.unreachable > ceiling.value && !opts.acceptUnreachable) {
    throw new Error(`UNREACHABLE identifiers rose from ${ceiling.value} to ${report.unreachable} (rule 3c). ` +
      'Fix the rule, or accept the rise explicitly: node scripts/prepare-lessons.js --accept-unreachable');
  }
  const text = renderTopic(loaded.raw, hand, derived, { unreachable_max: report.unreachable });
  const verify = checkLessons({ raw: text, lessonText: loaded.lessonText, hand });
  if (verify.errors.length) throw new Error(`internal: the text to write does not check clean:\n  ${verify.errors.join('\n  ')}`);

  const diff = diffGenerated(storedGenerated(loaded.raw, hand), derived);
  const result = { derived, report, diff, wrote: false };
  const saveReport = () => { if (opts.reportFile) fs.writeFileSync(opts.reportFile, JSON.stringify({ derived, diff, report }, null, 2)); };
  if (text === loaded.raw) {
    log('generated keys already up to date');
    saveReport();
    return result;
  }
  const change = `+${diff.added.length} -${diff.removed.length} re-homed ${diff.rehomed.length} generated keys`;
  if (opts.dryRun) { log(`dry run: would write ${change}`); saveReport(); return result; }
  if (opts.beforeWrite) opts.beforeWrite();
  writeTopic(loaded, derivedBuild, text);
  log(`wrote references/topic-index.json (${change}; unreachable ceiling ${report.unreachable})`);
  saveReport();
  result.wrote = true;
  return result;
}

function parseArgs(argv) {
  const opts = { check: false, dryRun: false, root: null, reportFile: null, acceptUnreachable: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'identifiers') continue; // the only mode (phase 3b adds vocabulary)
    else if (a === '--check') opts.check = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--accept-unreachable') opts.acceptUnreachable = true;
    else if (a === '--root') { if (!argv[i + 1]) throw new Error('--root needs a skill directory'); opts.root = path.resolve(argv[++i]); }
    else if (a === '--report') { if (!argv[i + 1]) throw new Error('--report needs a file'); opts.reportFile = path.resolve(argv[++i]); }
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown argument "${a}"`);
  }
  return opts;
}

function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error(`prepare-lessons.js: ${e.message}`); return 2; }
  if (opts.help) {
    const src = fs.readFileSync(__filename, 'utf8').split('\n');
    console.log(src.slice(2, src.findIndex((l) => l.startsWith(' * ----'))).join('\n'));
    return 0;
  }
  const skillDir = opts.root || path.resolve(__dirname, '..');
  try {
    if (opts.check) {
      const loaded = load(skillDir);
      const hand = loadHandSource(skillDir);
      const { problems } = deriveBounds(skillDir, loaded);
      if (problems.length) {
        console.error(`prepare-lessons.js --check: run node scripts/build.js first:\n  ${problems.join('\n  ')}`);
        return 1;
      }
      const { errors, notes } = checkLessons({ raw: loaded.raw, lessonText: loaded.lessonText, hand });
      for (const n of notes) console.log(n);
      if (errors.length) { for (const e of errors) console.error(e); return 1; }
      console.log('prepare-lessons check OK');
      return 0;
    }
    runIdentifiers(skillDir, opts);
    return 0;
  } catch (e) {
    console.error(`prepare-lessons.js: ${e.message}`);
    return 1;
  }
}

module.exports = {
  KeyState, surfaceTokens, selfReachable, planIdentifiers, storedKeyList, storedGenerated, diffGenerated,
  ceilingOf, renderTopic, checkLessons, runIdentifiers, parseArgs, load, MAX_HOMES,
};
if (require.main === module) process.exitCode = main(process.argv.slice(2));
