'use strict';
/**
 * vocab.js — generated user vocabulary: the model's
 * proposals, frozen in a file, and the script rules that turn them into
 * keyword_map keys. prepare-lessons.js derives the keys; nothing here is
 * hand-edited.
 *
 * THE PROPOSALS FILE, data/vocab-proposals.json at the repository root, is
 * frozen model output: per lesson id, {model, prompt_version, date,
 * input_sha256, terms}. It
 * lives outside skill-package/ because it is an input to the build, not part
 * of the shipped skill (the derived keys ship in topic-index.json); CI reads it
 * from the repository. Only `prepare-lessons.js --generate` writes it: to ADD
 * lessons that have no entry, to regenerate the entries of lessons that changed
 * (below), to replace one deliberately (--regen <id>), or to drop entries of
 * lessons no longer in the index. Its sha256 is pinned in PROPOSALS_SHA256
 * below and `build.js --check` fails on any other content, so a hand edit is
 * caught; after --generate the new hash is printed and the constant is updated
 * in the same commit. --generate itself refuses to start unless the file on
 * disk is the pinned one (so an unpinned edit is never carried into a newly
 * pinned file); `--bootstrap` lifts that for the first-ever file, or for an
 * intentional re-pin after the diff has been inspected. The terms are what the
 * model said, unfiltered; every filter below runs on each derivation, so a rule
 * change re-derives the keys without a model call. The 218 entries of the first
 * pass come from the phase-3 prototype run (model claude-opus-5-5, prompt
 * vocab-v1, 2026-09-28).
 *
 * STALENESS. `input_sha256` is the sha256 of the lesson's FRESH prompt
 * (buildPrompt(): the template, the lesson title and summary, and the lesson
 * text as truncated at LESSON_TEXT_LIMIT), whichever prompt was sent: it
 * identifies the lesson text the terms describe. When the lesson's current
 * fresh prompt hashes differently, its proposal is STALE: `build.js --check` and
 * `prepare-lessons.js --check` warn, naming the lesson (a warning, not a
 * failure: a prose edit must not fail CI), and `--generate` regenerates it. An
 * entry without the field has UNKNOWN inputs: warned about the same way, but
 * regenerated only on request (--regen <id>). --generate re-reads the lessons
 * from disk after the model calls and aborts, writing nothing, if any
 * lesson's prompt changed while the model ran. The hash covers buildPrompt()'s
 * template text too, so editing that template marks EVERY lesson stale (each
 * then costs one update call, which keeps its still-true terms); the
 * prompt_version strings and buildUpdatePrompt() are not hashed, so changing
 * them marks nothing stale.
 *
 * UPDATE, NOT REDRAW. A stale lesson that has terms is regenerated with the
 * update prompt (buildUpdatePrompt(), prompt_version UPDATE_PROMPT_VERSION):
 * its previous terms plus its current text. A fresh draw replaces 12-15 of 15
 * terms even when nothing they say became false, and keyword hits are exact
 * tokens, so a reworded term ("save" for "saving") silently stops matching the
 * questions the old one carried.
 *
 * THE UPDATE RULES. The model answers {keep, drop, add}, and resolveUpdate()
 * enforces the rules in code rather than trusting the prompt:
 *   - a kept term is the previous term verbatim;
 *   - a drop stands only as "inaccurate" (the text no longer supports it; it
 *     may come with a replacement) or as "duplicate" naming a term that is
 *     kept. Any other drop, and any previous term the reply leaves out, is kept
 *     (`kept_by_rule`). A true, distinct term is never removed, not to make
 *     room and not for a new topic;
 *   - a topic the EDIT added gets ADDED terms, up to MAX_TERMS_CAP (18) in all;
 *     added terms are cut first, then replacements, never a kept term. To tell
 *     an added topic from an old gap the prompt shows the text BEFORE the edit
 *     (lib/vocab-history.js finds it in git by input_sha256; `previous_text`
 *     records the commit, or "not found", in which case nothing is added);
 *   - keepTitleTerm(): an update never leaves the lesson without a term on its
 *     title's subject when it had one (`title_term_restored`).
 * The entry records `prior_terms_sha256`, `replaced` (previous terms no longer
 * carried), `dropped` ([{term, why, duplicate_of?, replacement?}]) and
 * `kept_by_rule`, so every update's churn is auditable in the file. Each model
 * call's cost (the reply envelope's total_cost_usd) is logged.
 *
 * FILLING GAPS. `--fill-gaps <ids>` runs the same rules on named lessons,
 * stale or not, adding terms (up to the cap) for any topic already in the
 * lesson that no term reaches (prompt_version FILL_GAPS_PROMPT_VERSION). It is
 * the deliberate way to cover an old gap, which a stale-lesson update never
 * does.
 * The fresh prompt is used for a lesson without terms, for --regen, and for
 * every stale lesson under --fresh.
 *
 * WITHHELD TERMS. At generation, lib/vocab-collision.js withholds a new term
 * that would make its lesson first on a gated dev question of another lesson.
 * The entry keeps the model's `terms` unfiltered and records `withheld`
 * ([{term, qid}]) and `collision_check` (what it ran against, or why it was
 * skipped); planVocab() drops withheld terms on every derivation (rule 4,
 * reason "withheld at generation"). When a withheld term replaced a previous
 * term, that previous term is restored to `terms` (`kept_by_rule`, reason
 * "replacement withheld"): a withheld replacement must not cost the lesson
 * the term it was meant to replace. (The 218 first-pass entries
 * carry the hash of the current lessons: the prototype's prompt builder and
 * lesson text, at commit 55c5dca, are byte-identical to today's.)
 *
 * RULE 4 — VOCABULARY KEYS. For each lesson in topic-index order, its first
 * MAX_TERMS_CAP proposed terms, in proposal order, are cleaned (curly quotes
 * straightened, surrounding quotes and trailing ?.!,;: removed, whitespace
 * collapsed, lowercased) and dropped when:
 *   4a. empty, longer than MAX_TERM_CHARS characters or MAX_TERM_WORDS words,
 *       or not printable ASCII;
 *   4b. it contains an identifier (lib/identifiers.js extractIdentifiers finds
 *       anything but a plain code span, or it has a backtick): vocabulary adds
 *       words people type, never identifiers, whose keys the identifier pass
 *       owns;
 *   4c. it already is a key (hand or generated identifier), exactly or in
 *       normalized form (lowercase, non-alphanumeric runs -> one space), or a
 *       hand keyword of one of its lessons: keys are only ever appended;
 *   4d. several lessons propose it (same normalized form) and they are more than
 *       MAX_HOMES (it names no lesson in particular); with at most MAX_HOMES the
 *       key maps to all of them, in lesson order, spelled as the first lesson
 *       wrote it.
 *   4e. the proposal lists it as withheld at generation (WITHHELD TERMS above).
 * Survivors are appended after the identifier keys, in order of first
 * proposal. Each lesson records its keys in `vocab_keys` and the proposal's
 * {model, prompt_version, date, terms_sha256} in `vocab` (terms_sha256 = sha256
 * of JSON.stringify(terms), the full unfiltered list), stamped on every lesson
 * that has a proposal, whether or not a term survived.
 * There is no ranking guard (the prototype's strict rule 3e): under the
 * specificity-weighted keyword layer a vocabulary key competes by its own
 * weight, and the retrieval gate judges the result.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { extractIdentifiers, normalize } = require('./identifiers.js');

const PROPOSALS_FILE = 'data/vocab-proposals.json'; // relative to the repository root
/** sha256 of data/vocab-proposals.json. Changed only together with a --generate run (see the header). */
const PROPOSALS_SHA256 = '0d61f8af97da9b0315006470c24b1e338728bb208637e62d5dbd080162523c83';
const DEFAULT_MODEL = 'claude-opus-5-5'; // evals/retrieval/gen-questions.js used claude-sonnet-5
const PROMPT_VERSION = 'vocab-v1';
const UPDATE_PROMPT_VERSION = 'vocab-v4-update'; // buildUpdatePrompt(): keep/drop/add over prior terms, previous + current text
const FILL_GAPS_PROMPT_VERSION = 'vocab-v4-fill-gaps'; // buildUpdatePrompt(..., {fillGaps: true}): --fill-gaps <ids>
const MAX_TERMS = 15; // a fresh draw asks for this many
const MAX_TERMS_CAP = 18; // hard cap on a stored proposal: an update may ADD terms for a new topic up to here
const MAX_TERM_CHARS = 80;
const MAX_TERM_WORDS = 12;
const MAX_HOMES = 2;
const LESSON_TEXT_LIMIT = 60000; // characters of lesson text sent to the model
// --setting-sources project: --safe-mode alone still loads ~/.claude/settings.json keys such as advisorModel.
const MODEL_FLAGS = ['--safe-mode', '--setting-sources', 'project', '--tools', ''];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function cleanTerm(t) {
  return String(t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[?.!,;:]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// The proposals file
// ---------------------------------------------------------------------------

/** Shape errors of a parsed proposals object. */
function proposalErrors(data) {
  const errs = [];
  if (!data || typeof data !== 'object' || !data.lessons || typeof data.lessons !== 'object') return ['has no "lessons" object'];
  for (const [id, p] of Object.entries(data.lessons)) {
    if (!/^\d+$/.test(id)) errs.push(`lesson key "${id}" is not a lesson id`);
    else if (!p || typeof p.model !== 'string' || typeof p.prompt_version !== 'string' || typeof p.date !== 'string'
      || !Array.isArray(p.terms) || !p.terms.every((t) => typeof t === 'string')) errs.push(`lesson ${id}: needs {model, prompt_version, date, terms: string[]}`);
    else if (p.input_sha256 !== undefined && !/^[0-9a-f]{64}$/.test(p.input_sha256)) errs.push(`lesson ${id}: input_sha256 must be a sha256 hex digest`);
    else if (p.prior_terms_sha256 !== undefined && !/^[0-9a-f]{64}$/.test(p.prior_terms_sha256)) errs.push(`lesson ${id}: prior_terms_sha256 must be a sha256 hex digest`);
    else if (p.collision_check !== undefined && typeof p.collision_check !== 'string') errs.push(`lesson ${id}: collision_check must be a string`);
    else if (p.replaced !== undefined && !(Array.isArray(p.replaced) && p.replaced.every((t) => typeof t === 'string'))) errs.push(`lesson ${id}: replaced must be string[]`);
    else if (p.previous_text !== undefined && typeof p.previous_text !== 'string') errs.push(`lesson ${id}: previous_text must be a string`);
    else if (p.title_term_restored !== undefined && typeof p.title_term_restored !== 'string') errs.push(`lesson ${id}: title_term_restored must be a string`);
    else if (p.dropped !== undefined && !(Array.isArray(p.dropped) && p.dropped.every((d) => d && typeof d.term === 'string' && (d.why === 'inaccurate' || d.why === 'duplicate')))) errs.push(`lesson ${id}: dropped must be [{term, why: inaccurate|duplicate}]`);
    else if (p.kept_by_rule !== undefined && !(Array.isArray(p.kept_by_rule) && p.kept_by_rule.every((k) => k && typeof k.term === 'string' && typeof k.reason === 'string'))) errs.push(`lesson ${id}: kept_by_rule must be [{term, reason}]`);
    else if (p.terms.length > MAX_TERMS_CAP) errs.push(`lesson ${id}: ${p.terms.length} terms, more than ${MAX_TERMS_CAP}`);
    else if (p.withheld !== undefined && !(Array.isArray(p.withheld) && p.withheld.every((w) => w && typeof w.term === 'string' && typeof w.qid === 'string'))) {
      errs.push(`lesson ${id}: withheld must be [{term, qid}]`);
    }
  }
  return errs;
}

/** The proposals file of the skill directory `skillDir` (skill-package/skills/<name> in the repository). */
function proposalsPath(skillDir) {
  return path.resolve(skillDir, '..', '..', '..', PROPOSALS_FILE);
}

/**
 * Read the proposals file (default: proposalsPath(skillDir)).
 * @returns {{abs, raw, sha256, byId: Map<number, {model, prompt_version, date, terms}>, errors: string[]}}
 * A missing file is not thrown: every lesson then lacks proposals, which the
 * check reports with the fix (integrityErrors() reports the file itself).
 */
function loadProposals(skillDir, abs = proposalsPath(skillDir)) {
  let raw = null;
  try { raw = fs.readFileSync(abs, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { abs, raw: null, sha256: null, byId: new Map(), errors: [] };
  }
  let data;
  try { data = JSON.parse(raw); } catch (e) { return { abs, raw, sha256: sha256(raw), byId: new Map(), errors: [`${PROPOSALS_FILE} is not valid JSON: ${e.message}`] }; }
  const errors = proposalErrors(data).map((e) => `${PROPOSALS_FILE}: ${e}`);
  const byId = new Map();
  if (!errors.length) for (const [id, p] of Object.entries(data.lessons)) byId.set(Number(id), p);
  return { abs, raw, sha256: sha256(raw), byId, errors };
}

/**
 * Integrity errors of loaded proposals against the index: the file must be the
 * pinned one (PROPOSALS_SHA256, or `pinned` in tests), and every entry must name a
 * lesson in `lessonIds`.
 */
function integrityErrors(proposals, lessonIds, pinned = PROPOSALS_SHA256) {
  const errs = [];
  if (proposals.raw === null) {
    errs.push(`${PROPOSALS_FILE} is missing (${proposals.abs}): it is frozen model output that no offline script can regenerate; restore it from git`);
  } else if (proposals.sha256 !== pinned) {
    errs.push(`${PROPOSALS_FILE} is not the pinned proposals file (sha256 ${proposals.sha256}, pinned ${pinned}). ` +
      'Only prepare-lessons.js --generate/--regen writes it: after such a run set PROPOSALS_SHA256 in scripts/lib/vocab.js ' +
      'to the new hash; otherwise restore the file (git checkout)');
  }
  const live = new Set(lessonIds);
  const stale = [...proposals.byId.keys()].filter((id) => !live.has(id)).sort((a, b) => a - b);
  if (stale.length) {
    errs.push(`${PROPOSALS_FILE} has proposals for ${stale.length} lesson id(s) not in the index (${stale.join(', ')}) — ` +
      'run node scripts/prepare-lessons.js --generate (drops them; calls the model only for lessons without proposals), then update PROPOSALS_SHA256');
  }
  return errs;
}

/** sha256 of a proposal's full term list, recorded in the lesson's vocab stamp. */
const termsSha256 = (terms) => sha256(JSON.stringify(terms));

/** sha256 of the exact prompt a lesson's generation sends (recorded as input_sha256). */
const inputSha256 = (lesson, text) => sha256(buildPrompt(lesson, text));

/**
 * Which lessons' proposals no longer match their lesson. Pure.
 * @returns {{stale: number[], unknown: number[]}} stale: input_sha256 differs from the
 *   current prompt's; unknown: the entry records no input_sha256. Lessons without a
 *   proposal are neither (planVocab() reports them as missing).
 */
function staleProposals(lessons, lessonText, byId) {
  const stale = [];
  const unknown = [];
  for (const l of lessons) {
    const p = byId.get(l.id);
    if (!p) continue;
    if (p.input_sha256 === undefined) unknown.push(l.id);
    else if (p.input_sha256 !== inputSha256(l, lessonText(l))) stale.push(l.id);
  }
  return { stale, unknown };
}

/** The proposals file text for `byId` (lesson ids ascending, indent 2, trailing newline). */
function renderProposals(byId) {
  const lessons = {};
  for (const id of [...byId.keys()].sort((a, b) => a - b)) {
    const p = byId.get(id);
    const e = { model: p.model, prompt_version: p.prompt_version, date: p.date };
    if (p.input_sha256 !== undefined) e.input_sha256 = p.input_sha256;
    if (p.prior_terms_sha256 !== undefined) e.prior_terms_sha256 = p.prior_terms_sha256;
    if (p.collision_check !== undefined) e.collision_check = p.collision_check;
    if (p.previous_text !== undefined) e.previous_text = p.previous_text;
    if (p.replaced !== undefined) e.replaced = p.replaced.slice();
    if (p.dropped !== undefined) e.dropped = p.dropped.map((d) => ({ ...d }));
    if (p.kept_by_rule !== undefined) e.kept_by_rule = p.kept_by_rule.map((k) => ({ term: k.term, reason: k.reason }));
    if (p.title_term_restored !== undefined) e.title_term_restored = p.title_term_restored;
    e.terms = p.terms.slice();
    if (p.withheld !== undefined) e.withheld = p.withheld.map((w) => ({ term: w.term, qid: w.qid }));
    lessons[String(id)] = e;
  }
  return JSON.stringify({ format: 1, lessons }, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Rule 4: proposals -> keys
// ---------------------------------------------------------------------------

/**
 * Derive the vocabulary keys. Pure.
 * @param lessons  topic-index lessons in index order ({id})
 * @param state    KeyState holding the hand keys plus the derived identifier keys
 *                 ({map: Map(key -> ids), byNorm: Map(normalized -> key)})
 * @param handKw   Map(id -> Set of the lesson's hand keywords)
 * @param byId     proposals (loadProposals().byId)
 * @returns {{derived: [{key, raw, lessons, kind: 'vocab'}], stamps: Map(id -> {model, prompt_version, date, terms_sha256}),
 *            missing: number[], report: {proposed, accepted, dropped: {reason: count}}}}
 */
function planVocab(lessons, state, handKw, byId) {
  const stamps = new Map();
  const missing = [];
  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
  const handKwNorm = new Map([...handKw].map(([id, set]) => [id, new Set([...set].map(normalize))]));
  let proposed = 0;
  const byNorm = new Map(); // normalized term -> {key, lessons}
  for (const l of lessons) {
    const p = byId.get(l.id);
    if (!p) { missing.push(l.id); continue; }
    stamps.set(l.id, { model: p.model, prompt_version: p.prompt_version, date: p.date, terms_sha256: termsSha256(p.terms) });
    const seen = new Set();
    const withheld = new Set((p.withheld || []).map((w) => normalize(cleanTerm(w.term))));
    for (const rawTerm of p.terms.slice(0, MAX_TERMS_CAP)) {
      proposed++;
      const term = cleanTerm(rawTerm);
      const n = normalize(term);
      const why =
        !n ? 'empty'
          : term.length > MAX_TERM_CHARS || n.split(' ').length > MAX_TERM_WORDS ? 'too long'
            : /[^\x20-\x7e]/.test(term) ? 'non-ascii'
              : /`/.test(rawTerm) || extractIdentifiers(rawTerm).some((i) => i.kind !== 'code-span') ? 'contains an identifier'
                : state.map.has(term) || state.byNorm.has(n) ? 'already a key'
                  : seen.has(n) ? 'repeated in the lesson'
                    : withheld.has(n) ? 'withheld at generation (collision)'
                      : null;
      if (why) { drop(why); continue; }
      seen.add(n);
      if (!byNorm.has(n)) byNorm.set(n, { key: term, lessons: [] });
      byNorm.get(n).lessons.push(l.id);
    }
  }
  const derived = [];
  for (const [, v] of byNorm) {
    if (v.lessons.some((id) => (handKwNorm.get(id) || new Set()).has(normalize(v.key)))) { drop('a hand keyword of its lesson'); continue; }
    if (v.lessons.length > MAX_HOMES) { drop(`proposed for more than ${MAX_HOMES} lessons`); continue; }
    derived.push({ key: v.key, raw: v.key, lessons: v.lessons, kind: 'vocab' });
  }
  return { derived, stamps, missing, report: { proposed, accepted: derived.length, dropped } };
}

// ---------------------------------------------------------------------------
// --generate: the model call (never run by CI, build.js or release.js)
// ---------------------------------------------------------------------------

function buildPrompt(lesson, text) {
  return [
    'You are helping index a technical reference so people can find the right lesson with the',
    'words they would actually type. Below is one lesson from a reference about how Claude Code',
    '(Anthropic\'s CLI coding agent) and Claude Cowork work internally.',
    '',
    `Propose up to ${MAX_TERMS} search terms a user might type when THIS lesson is the answer, written`,
    'the way someone who has NOT read it would phrase them: plain words for the symptom, goal or',
    'question. Mix short search phrases (2-6 words) with a few short questions (at most 12 words).',
    'Rules:',
    '- No identifiers of any kind: no environment variable names, code, function or tool names,',
    '  file names, numeric ids, version numbers, slash commands, or backticks.',
    '- Do not copy the lesson title or its headings; say it the way a user would.',
    '- Each term must be specific to this lesson, not true of the whole product.',
    '- Output ONLY a JSON object: {"terms": ["...", "..."]}',
    '',
    `LESSON TITLE: ${lesson.title}`,
    lesson.description ? `SUMMARY: ${lesson.description}` : '',
    '',
    'LESSON TEXT:',
    text.length > LESSON_TEXT_LIMIT ? text.slice(0, LESSON_TEXT_LIMIT) + '\n[...truncated]' : text,
  ].join('\n');
}

/**
 * The UPDATE prompt (UPDATE_PROMPT_VERSION): a stale lesson's previous terms plus
 * its current text. The model keeps every term the text still supports, copied
 * exactly, and replaces only the ones it no longer supports, so a prose edit
 * moves the vocabulary by what changed, not by a fresh draw of 15 phrasings.
 * The lesson part (title, summary, text) is the same as buildPrompt()'s.
 */
function buildUpdatePrompt(lesson, text, priorTerms, previousText = null, { fillGaps = false } = {}) {
  const clip = (t) => (t.length > LESSON_TEXT_LIMIT ? t.slice(0, LESSON_TEXT_LIMIT) + '\n[...truncated]' : t);
  const addRule = fillGaps
    ? [
      '- ADD: if the lesson covers a topic that none of the terms reaches, put new terms for it in "add".',
      '  If every topic is reached, "add" is empty.',
    ]
    : previousText === null
      ? ['- ADD nothing: "add" is empty. (The text before the edit is not available, so nothing counts as new.)']
      : [
        '- ADD: compare the lesson BEFORE the edit (given below) with the lesson NOW. If the edit ADDED a',
        '  topic that none of the terms reaches, put new terms for it in "add". A topic that was already in',
        '  the lesson before the edit is NOT new, even if no term covers it: add nothing for it.',
      ];
  return [
    'You are helping index a technical reference so people can find the right lesson with the',
    'words they would actually type. Below is one lesson from a reference about how Claude Code',
    '(Anthropic\'s CLI coding agent) and Claude Cowork work internally.',
    '',
    fillGaps ? 'These search terms were written for it:' : 'The lesson was edited. Before the edit, these search terms were written for it:',
    ...priorTerms.map((t) => `- ${t}`),
    '',
    fillGaps ? 'Review that list for the lesson as it reads now. Every term above goes into "keep" or "drop":' : 'Update that list for the lesson as it reads NOW. Every term above goes into "keep" or "drop":',
    '- KEEP every term that is still true of the lesson and still a fair way to ask for it, copied',
    '  EXACTLY, character for character. People type the old wording and the search matches words exactly.',
    '- DROP a term only for one of two reasons:',
    '  "inaccurate": the lesson no longer supports it (it now states something different, or no longer',
    '    covers that topic). Give a "replacement" saying what the lesson says now, or null.',
    '  "duplicate": it nearly repeats another term that you KEEP; name that term in "duplicate_of",',
    '    copied exactly.',
    '  Never drop a term that is true and distinct: not to make room, not to reword or tidy it.',
    ...addRule,
    `- In total (kept + replacements + added) at most ${MAX_TERMS_CAP} terms.`,
    '- New terms (replacements and added) follow the original rules: plain words a user who has NOT read',
    '  the lesson would type, short phrases (2-6 words) or short questions (at most 12 words); no',
    '  identifiers of any kind (no environment variable names, code, function or tool names, file names,',
    '  numeric ids, version numbers, slash commands or backticks); not the lesson title or its headings;',
    '  specific to this lesson, not true of the whole product.',
    '- Output ONLY a JSON object:',
    '  {"keep": ["..."], "drop": [{"term": "...", "why": "inaccurate" | "duplicate", "duplicate_of": "..." | null, "replacement": "..." | null}], "add": ["..."]}',
    '',
    `LESSON TITLE: ${lesson.title}`,
    lesson.description ? `SUMMARY: ${lesson.description}` : '',
    '',
    ...(previousText === null || fillGaps ? ['LESSON TEXT:'] : ['LESSON TEXT BEFORE THE EDIT:', clip(previousText), '', 'LESSON TEXT NOW:']),
    clip(text),
  ].join('\n');
}

/** The {keep, drop, add} object of an update reply (a bare {"terms"} reply reads as keep/add, nothing dropped). */
function parseUpdate(raw) {
  const envelope = JSON.parse(raw);
  if (envelope && envelope.is_error) throw new Error(`model error: ${String(envelope.result).slice(0, 200)}`);
  let text = envelope && envelope.result !== undefined ? envelope.result : envelope;
  if (typeof text !== 'string') text = JSON.stringify(text);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const obj = JSON.parse(start > 0 ? body.slice(start, body.lastIndexOf('}') + 1) : body);
  const strs = (a) => (Array.isArray(a) ? a.filter((t) => typeof t === 'string') : []);
  if (obj && Array.isArray(obj.terms) && !obj.keep) return { keep: strs(obj.terms), drop: [], add: [] };
  if (!obj || !Array.isArray(obj.keep)) throw new Error('no "keep" array');
  const drop = (Array.isArray(obj.drop) ? obj.drop : []).filter((d) => d && typeof d.term === 'string')
    .map((d) => ({ term: d.term, why: d.why, duplicate_of: typeof d.duplicate_of === 'string' ? d.duplicate_of : null,
      replacement: typeof d.replacement === 'string' && d.replacement.trim() ? d.replacement : null }));
  return { keep: strs(obj.keep), drop, add: strs(obj.add) };
}

/**
 * The rules of an update, enforced on the model's {keep, drop, add} (pure):
 *  - a kept term is the PREVIOUS term verbatim (matched normalized);
 *  - a drop stands only as "inaccurate", or as "duplicate" naming a term that is kept;
 *    any other drop, and any previous term the reply does not mention, is KEPT
 *    (`kept_by_rule`, with the reason);
 *  - terms = kept (previous order), then replacements, then added, deduplicated, at most
 *    MAX_TERMS_CAP; added terms are cut first, then replacements, never a kept term.
 * Returns {terms, dropped: [{term, why, duplicate_of?, replacement?}], keptByRule: [{term, reason}],
 *          swaps: Map(normalized replacement -> the previous term it replaced)}.
 */
function resolveUpdate(prior, reply) {
  const n = (t) => normalize(cleanTerm(t));
  const priorBy = new Map(prior.map((t) => [n(t), t]));
  const kept = new Set();
  const extra = [];
  for (const t of reply.keep) { if (priorBy.has(n(t))) kept.add(n(t)); else extra.push(t); }
  const dropped = [];
  const keptByRule = [];
  const swaps = new Map();
  const replacements = [];
  for (const d of reply.drop) {
    const k = n(d.term);
    if (!priorBy.has(k) || kept.has(k) || dropped.some((x) => n(x.term) === k)) continue;
    const ok = d.why === 'inaccurate' || (d.why === 'duplicate' && d.duplicate_of !== null && kept.has(n(d.duplicate_of)) && n(d.duplicate_of) !== k);
    if (!ok) { kept.add(k); keptByRule.push({ term: priorBy.get(k), reason: d.why === 'duplicate' ? 'duplicate_of names no kept term' : 'drop reason is neither inaccurate nor duplicate' }); continue; }
    const e = { term: priorBy.get(k), why: d.why };
    if (d.why === 'duplicate') e.duplicate_of = priorBy.get(n(d.duplicate_of));
    if (d.why === 'inaccurate' && d.replacement) { e.replacement = d.replacement; replacements.push(d.replacement); swaps.set(n(d.replacement), priorBy.get(k)); }
    dropped.push(e);
  }
  for (const [k, t] of priorBy) {
    if (!kept.has(k) && !dropped.some((x) => n(x.term) === k)) { kept.add(k); keptByRule.push({ term: t, reason: 'not listed in keep or drop' }); }
  }
  const out = [];
  const seen = new Set();
  const push = (t) => { const k = n(t); if (k && !seen.has(k)) { seen.add(k); out.push(t); } };
  for (const t of prior) if (kept.has(n(t))) push(t);
  const keptCount = out.length;
  const rest = [];
  for (const t of [...replacements, ...extra, ...reply.add]) { const k = n(t); if (k && !seen.has(k) && !rest.some((r) => n(r) === k)) rest.push(t); }
  for (const t of rest.slice(0, Math.max(0, MAX_TERMS_CAP - keptCount))) push(t);
  return { terms: out, dropped, keptByRule, swaps };
}

/**
 * Words of a lesson title that say what it is about (query tokens: lowercase, stop words out),
 * and whether a term asks about it. Used to keep at least one title-topic term through an update.
 */
function titleWords(title) {
  const { tokenizeQuery } = require('./tfidf-index.js');
  return new Set(tokenizeQuery(String(title).replace(/\([^)]*\)/g, ' ')).filter((w) => w.length >= 4));
}
function coversTitle(term, words) {
  const { tokenizeQuery } = require('./tfidf-index.js');
  return tokenizeQuery(term).some((w) => words.has(w));
}

/**
 * The title guard: if the previous terms had one asking about the lesson title's subject and
 * the update dropped every such term, put the first dropped one back in place of the last new
 * term (or append it under MAX_TERMS_CAP). Returns {terms, restored: string | null}. Pure.
 */
function keepTitleTerm(lesson, priorTerms, terms) {
  const words = titleWords(lesson.title);
  if (!words.size || terms.some((t) => coversTitle(t, words))) return { terms, restored: null };
  const back = priorTerms.find((t) => coversTitle(t, words));
  if (!back) return { terms, restored: null };
  const before = new Set(priorTerms.map((t) => normalize(cleanTerm(t))));
  const out = terms.slice(0, MAX_TERMS_CAP);
  let i = -1;
  for (let k = out.length - 1; k >= 0; k--) if (!before.has(normalize(cleanTerm(out[k])))) { i = k; break; }
  if (i >= 0) out[i] = back;
  else if (out.length < MAX_TERMS_CAP) out.push(back);
  else return { terms, restored: null };
  return { terms: out, restored: back };
}

/**
 * One model call: `claude -p --model <model> --safe-mode --setting-sources project --tools "" --output-format json`,
 * stdin ignored, in a fresh temp cwd (so no repository CLAUDE.md steers it).
 */
function callModelDefault(prompt, { model }) {
  return new Promise((resolve, reject) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-lessons-cwd-'));
    execFile('claude', ['-p', '--model', model, ...MODEL_FLAGS, '--output-format', 'json', prompt],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => {
        fs.rmSync(cwd, { recursive: true, force: true });
        if (err) reject(new Error(`claude -p failed: ${err.message}\n${String(stderr).slice(0, 500)}`));
        else resolve(stdout);
      });
  });
}

/** The terms array from a `claude -p --output-format json` envelope. */
function parseTerms(raw) {
  const envelope = JSON.parse(raw);
  if (envelope && envelope.is_error) throw new Error(`model error: ${String(envelope.result).slice(0, 200)}`);
  let text = envelope && envelope.result !== undefined ? envelope.result : envelope;
  if (typeof text !== 'string') text = JSON.stringify(text);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const obj = JSON.parse(start > 0 ? body.slice(start, body.lastIndexOf('}') + 1) : body);
  if (!obj || !Array.isArray(obj.terms) || !obj.terms.every((t) => typeof t === 'string')) throw new Error('no "terms" string array');
  return obj.terms;
}

async function mapPool(items, concurrency, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
}

/**
 * Ask the model for proposals for `lessons`. Returns {added: Map(id -> proposal),
 * failed: [{id, error}]}; failures are left for the next run. A lesson in
 * `prior` (id -> its previous terms) gets the UPDATE prompt and records
 * prior_terms_sha256; the others get the fresh prompt. Each proposal records
 * input_sha256 = inputSha256() of the lesson as sent, which for a fresh prompt is
 * the hash of the prompt itself (the caller re-verifies it against the lessons on
 * disk before accepting the output). `callModel` is injectable for tests.
 */
async function generateProposals(lessons, lessonText, { model = DEFAULT_MODEL, concurrency = 4, callModel = callModelDefault, date, log = () => {}, prior = new Map(), previous = new Map(), fillGaps = new Set() } = {}) {
  const added = new Map();
  const failed = [];
  const today = date || new Date().toISOString().slice(0, 10);
  let done = 0;
  let cost = 0;
  await mapPool(lessons, concurrency, async (l) => {
    try {
      const text = lessonText(l);
      const old = prior.get(l.id);
      const gaps = old && fillGaps.has(l.id);
      const prev = old && !gaps ? previous.get(l.id) || null : null; // {text, commit} or null
      const prompt = old ? buildUpdatePrompt(l, text, old, prev && prev.text, { fillGaps: gaps }) : buildPrompt(l, text);
      const raw = await callModel(prompt, { model });
      try { const c = JSON.parse(raw).total_cost_usd; if (typeof c === 'number') { cost += c; log(`vocab: lesson ${l.id}: model call $${c.toFixed(4)}`); } } catch { /* parse errors surface below */ }
      if (!old) {
        added.set(l.id, { model, prompt_version: PROMPT_VERSION, date: today, input_sha256: sha256(prompt), terms: parseTerms(raw) });
      } else {
        const r = resolveUpdate(old, parseUpdate(raw));
        const { terms, restored } = keepTitleTerm(l, old, r.terms);
        if (restored) log(`vocab: lesson ${l.id}: the update dropped every title-topic term; restored "${restored}"`);
        for (const k of r.keptByRule) log(`vocab: lesson ${l.id}: kept "${k.term}" (${k.reason})`);
        const now = new Set(terms.map((t) => normalize(cleanTerm(t))));
        const p = {
          model, prompt_version: gaps ? FILL_GAPS_PROMPT_VERSION : UPDATE_PROMPT_VERSION, date: today, input_sha256: inputSha256(l, text), prior_terms_sha256: termsSha256(old),
          ...(gaps ? {} : { previous_text: prev ? prev.commit : 'not found' }),
          replaced: old.filter((t) => !now.has(normalize(cleanTerm(t)))),
          ...(r.dropped.length ? { dropped: r.dropped } : {}),
          ...(r.keptByRule.length ? { kept_by_rule: r.keptByRule } : {}),
          ...(restored ? { title_term_restored: restored } : {}), terms,
        };
        Object.defineProperty(p, 'swaps', { value: r.swaps, enumerable: false }); // for the collision check; never written
        added.set(l.id, p);
      }
    } catch (e) {
      failed.push({ id: l.id, error: e.message });
    }
    done++;
    if (done % 10 === 0) log(`vocab: ${done}/${lessons.length} model calls finished`);
  });
  if (cost > 0) log(`vocab: model calls cost $${cost.toFixed(4)} in total`);
  return { added, failed, cost };
}

module.exports = {
  PROPOSALS_FILE, PROPOSALS_SHA256, DEFAULT_MODEL, PROMPT_VERSION, MAX_TERMS, MAX_TERMS_CAP, MAX_TERM_CHARS, MAX_TERM_WORDS, MAX_HOMES, MODEL_FLAGS,
  cleanTerm, proposalErrors, proposalsPath, loadProposals, integrityErrors, termsSha256, inputSha256, staleProposals, renderProposals, planVocab, buildPrompt, buildUpdatePrompt, UPDATE_PROMPT_VERSION, FILL_GAPS_PROMPT_VERSION, parseUpdate, resolveUpdate, keepTitleTerm, titleWords,
  callModelDefault, parseTerms, generateProposals,
};
