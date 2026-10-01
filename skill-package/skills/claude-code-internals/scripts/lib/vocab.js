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
 * its previous terms plus its current text, keeping every term still true,
 * copied exactly, and replacing only the ones the text no longer supports. A
 * fresh draw replaces 12-15 of 15 terms even when nothing they say became false,
 * and keyword hits are exact tokens, so a reworded term ("save" for "saving")
 * silently stops matching the questions the old one carried. Such an entry
 * also records `prior_terms_sha256` (termsSha256() of the previous terms) and
 * `replaced`, the previous terms it no longer carries (normalized comparison),
 * so every update's churn is auditable in the file.
 *
 * NEW TOPICS. The prompt shows the lesson text BEFORE the edit next to the text
 * now (lib/vocab-history.js finds it in git by input_sha256; `previous_text`
 * records the commit, or "not found"). When the edit added a topic no term
 * reaches and the list is full, the model may swap up to NEW_TOPIC_SWAPS terms
 * for it, near-duplicates first, then the least specific; a topic that was
 * already in the lesson is not new, however uncovered. With no previous text
 * the prompt allows no such swap. Terms the text no longer supports are
 * replaced regardless (the bound is the prompt's; `replaced` is the record).
 * One rule is enforced in code (keepTitleTerm()): an update never leaves the
 * lesson without a term asking about its title's subject when it had one; the
 * first dropped such term is put back (`title_term_restored`).
 * The fresh prompt is used for a lesson without terms, for --regen, and for
 * every stale lesson under --fresh.
 *
 * WITHHELD TERMS. At generation, lib/vocab-collision.js withholds a new term
 * that would make its lesson first on a gated dev question of another lesson.
 * The entry keeps the model's `terms` unfiltered and records `withheld`
 * ([{term, qid}]) and `collision_check` (what it ran against, or why it was
 * skipped); planVocab() drops withheld terms on every derivation (rule 4,
 * reason "withheld at generation"). (The 218 first-pass entries
 * carry the hash of the current lessons: the prototype's prompt builder and
 * lesson text, at commit 55c5dca, are byte-identical to today's.)
 *
 * RULE 4 — VOCABULARY KEYS. For each lesson in topic-index order, its first
 * MAX_TERMS proposed terms, in proposal order, are cleaned (curly quotes
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
const PROPOSALS_SHA256 = 'e789710f73f99e13de1e96b83efc41afb72462454f72d19b443d7da7d588c52f';
const DEFAULT_MODEL = 'claude-opus-5-5'; // evals/retrieval/gen-questions.js used claude-sonnet-5
const PROMPT_VERSION = 'vocab-v1';
const UPDATE_PROMPT_VERSION = 'vocab-v3-update'; // buildUpdatePrompt(): prior terms + previous and current text (v3: up to NEW_TOPIC_SWAPS for a topic the edit added)
const NEW_TOPIC_SWAPS = 3;
const MAX_TERMS = 15;
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
    for (const rawTerm of p.terms.slice(0, MAX_TERMS)) {
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
function buildUpdatePrompt(lesson, text, priorTerms, previousText = null) {
  const clip = (t) => (t.length > LESSON_TEXT_LIMIT ? t.slice(0, LESSON_TEXT_LIMIT) + '\n[...truncated]' : t);
  const newTopic = previousText === null
    ? [
      '- Do NOT replace a term that is still true, not even to make room for something the lesson',
      '  covers that no term reaches. Only an untrue term may go.',
    ]
    : [
      `- NEW TOPIC: compare the lesson BEFORE the edit (given below) with the lesson NOW. If the edit`,
      '  ADDED a topic that none of the terms above reaches, add terms for it. A topic that was already',
      '  in the lesson before the edit is NOT new, even if no term covers it: leave it alone.',
      `  With fewer than ${MAX_TERMS} terms, add. With ${MAX_TERMS}, you may replace up to ${NEW_TOPIC_SWAPS} terms for the new topic,`,
      '  choosing first a term that nearly duplicates another term in the list, then the least specific',
      '  term (the one most likely to fit other lessons too). Never replace the last term that asks',
      '  about the subject of the lesson title. Never replace a term to reword, tidy or "improve" it.',
    ];
  return [
    'You are helping index a technical reference so people can find the right lesson with the',
    'words they would actually type. Below is one lesson from a reference about how Claude Code',
    '(Anthropic\'s CLI coding agent) and Claude Cowork work internally.',
    '',
    'The lesson was edited. Before the edit, these search terms were written for it:',
    ...priorTerms.map((t) => `- ${t}`),
    '',
    'Update that list for the lesson as it reads NOW:',
    '- KEEP every term that is still true of the lesson and still a fair way to ask for it. Copy a',
    '  kept term EXACTLY, character for character: same words, same word forms, same order. Do not',
    '  shorten, reword, re-tense or tidy it. Small wording changes are not improvements here: people',
    '  type the old wording and the search matches words exactly.',
    '- REPLACE a term that the edited lesson no longer supports (it now states something different,',
    '  or no longer covers that topic) with a new term for what the lesson now says.',
    ...newTopic,
    `- At most ${MAX_TERMS} terms in total.`,
    '- New terms follow the original rules: plain words a user who has NOT read the lesson would',
    '  type, short phrases (2-6 words) or short questions (at most 12 words); no identifiers of any',
    '  kind (no environment variable names, code, function or tool names, file names, numeric ids,',
    '  version numbers, slash commands or backticks); not the lesson title or its headings; specific',
    '  to this lesson, not true of the whole product.',
    '- Output ONLY a JSON object: {"terms": ["...", "..."]}, kept terms first in their old order.',
    '',
    `LESSON TITLE: ${lesson.title}`,
    lesson.description ? `SUMMARY: ${lesson.description}` : '',
    '',
    ...(previousText === null ? [] : ['LESSON TEXT BEFORE THE EDIT:', clip(previousText), '', 'LESSON TEXT NOW:']),
    ...(previousText === null ? ['LESSON TEXT:'] : []),
    clip(text),
  ].join('\n');
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
 * term (or append it under MAX_TERMS). Returns {terms, restored: string | null}. Pure.
 */
function keepTitleTerm(lesson, priorTerms, terms) {
  const words = titleWords(lesson.title);
  if (!words.size || terms.some((t) => coversTitle(t, words))) return { terms, restored: null };
  const back = priorTerms.find((t) => coversTitle(t, words));
  if (!back) return { terms, restored: null };
  const before = new Set(priorTerms.map((t) => normalize(cleanTerm(t))));
  const out = terms.slice(0, MAX_TERMS);
  let i = -1;
  for (let k = out.length - 1; k >= 0; k--) if (!before.has(normalize(cleanTerm(out[k])))) { i = k; break; }
  if (i >= 0) out[i] = back;
  else if (out.length < MAX_TERMS) out.push(back);
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
async function generateProposals(lessons, lessonText, { model = DEFAULT_MODEL, concurrency = 4, callModel = callModelDefault, date, log = () => {}, prior = new Map(), previous = new Map() } = {}) {
  const added = new Map();
  const failed = [];
  const today = date || new Date().toISOString().slice(0, 10);
  let done = 0;
  await mapPool(lessons, concurrency, async (l) => {
    try {
      const text = lessonText(l);
      const old = prior.get(l.id);
      const prev = old ? previous.get(l.id) || null : null; // {text, commit} or null
      const prompt = old ? buildUpdatePrompt(l, text, old, prev && prev.text) : buildPrompt(l, text);
      let terms = parseTerms(await callModel(prompt, { model }));
      let restored = null;
      if (old) ({ terms, restored } = keepTitleTerm(l, old, terms));
      if (restored) log(`vocab: lesson ${l.id}: the update dropped every title-topic term; restored "${restored}"`);
      const now = new Set(terms.map((t) => normalize(cleanTerm(t))));
      added.set(l.id, old
        ? { model, prompt_version: UPDATE_PROMPT_VERSION, date: today, input_sha256: inputSha256(l, text), prior_terms_sha256: termsSha256(old),
          previous_text: prev ? prev.commit : 'not found', replaced: old.filter((t) => !now.has(normalize(cleanTerm(t)))),
          ...(restored ? { title_term_restored: restored } : {}), terms }
        : { model, prompt_version: PROMPT_VERSION, date: today, input_sha256: sha256(prompt), terms });
    } catch (e) {
      failed.push({ id: l.id, error: e.message });
    }
    done++;
    if (done % 10 === 0) log(`vocab: ${done}/${lessons.length} model calls finished`);
  });
  return { added, failed };
}

module.exports = {
  PROPOSALS_FILE, PROPOSALS_SHA256, DEFAULT_MODEL, PROMPT_VERSION, NEW_TOPIC_SWAPS, MAX_TERMS, MAX_TERM_CHARS, MAX_TERM_WORDS, MAX_HOMES, MODEL_FLAGS,
  cleanTerm, proposalErrors, proposalsPath, loadProposals, integrityErrors, termsSha256, inputSha256, staleProposals, renderProposals, planVocab, buildPrompt, buildUpdatePrompt, UPDATE_PROMPT_VERSION, keepTitleTerm, titleWords,
  callModelDefault, parseTerms, generateProposals,
};
