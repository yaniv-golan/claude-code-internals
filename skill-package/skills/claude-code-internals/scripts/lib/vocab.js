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
 * STALENESS. `input_sha256` is the sha256 of the exact prompt the model was
 * sent (buildPrompt(): the template, the lesson title and summary, and the
 * lesson text as truncated at LESSON_TEXT_LIMIT). When the lesson's current
 * prompt hashes differently, its proposal is STALE: `build.js --check` and
 * `prepare-lessons.js --check` warn, naming the lesson (a warning, not a
 * failure: a prose edit must not fail CI), and `--generate` regenerates it. An
 * entry without the field has UNKNOWN inputs: warned about the same way, but
 * regenerated only on request (--regen <id>). --generate re-reads the lessons
 * from disk after the model calls and aborts, writing nothing, if any
 * lesson's prompt changed while the model ran. (The 218 first-pass entries
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
const PROPOSALS_SHA256 = '5cb28967528b1a1eeadaac0bcadf935a9ea5790104768d523ba47eba960a8828';
const DEFAULT_MODEL = 'claude-opus-5-5'; // evals/retrieval/gen-questions.js used claude-sonnet-5
const PROMPT_VERSION = 'vocab-v1';
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
    e.terms = p.terms.slice();
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
 * failed: [{id, error}]}; failures are left for the next run. Each proposal
 * records input_sha256, the hash of the prompt actually sent (the caller
 * re-verifies it against the lessons on disk before accepting the output).
 * `callModel` is injectable for tests.
 */
async function generateProposals(lessons, lessonText, { model = DEFAULT_MODEL, concurrency = 4, callModel = callModelDefault, date, log = () => {} } = {}) {
  const added = new Map();
  const failed = [];
  const today = date || new Date().toISOString().slice(0, 10);
  let done = 0;
  await mapPool(lessons, concurrency, async (l) => {
    try {
      const prompt = buildPrompt(l, lessonText(l));
      const terms = parseTerms(await callModel(prompt, { model }));
      added.set(l.id, { model, prompt_version: PROMPT_VERSION, date: today, input_sha256: sha256(prompt), terms });
    } catch (e) {
      failed.push({ id: l.id, error: e.message });
    }
    done++;
    if (done % 10 === 0) log(`vocab: ${done}/${lessons.length} model calls finished`);
  });
  return { added, failed };
}

module.exports = {
  PROPOSALS_FILE, PROPOSALS_SHA256, DEFAULT_MODEL, PROMPT_VERSION, MAX_TERMS, MAX_TERM_CHARS, MAX_TERM_WORDS, MAX_HOMES, MODEL_FLAGS,
  cleanTerm, proposalErrors, proposalsPath, loadProposals, integrityErrors, termsSha256, inputSha256, staleProposals, renderProposals, planVocab, buildPrompt,
  callModelDefault, parseTerms, generateProposals,
};
