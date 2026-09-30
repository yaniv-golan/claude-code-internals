#!/usr/bin/env node
/**
 * gen-questions.js — generate the versioned retrieval eval question set.
 *
 * Human-triggered only. Never run in CI, never run by build.js/release.js.
 * Calls a model via `claude -p --model <model> --output-format json` with
 * stdin redirected away from the terminal/pipe (spawned with stdio 'ignore'
 * on stdin, matching "< /dev/null") and cwd set to a fresh temp directory, so
 * neither this repo's CLAUDE.md nor any ambient stdin can steer the model
 * (see feedback_claude_p_stdin_and_cwd_contamination memory). This does NOT
 * defeat the user's own `~/.claude/CLAUDE.md` (global, not repo-scoped) —
 * that is an accepted, documented limitation, not a bug to fix here.
 *
 * Usage:
 *   node gen-questions.js --dry-run [--limit N]
 *   node gen-questions.js [--seed N] [--model M] [--version N]
 *                         [--limit N] [--concurrency N]
 *                         [--state-sample N] [--negative-count N]
 *                         [--split-from <questions file>] [--strata a,b,...]
 *                         [--holdout-per-lesson N]
 *
 * --split-from <file> copies the lesson split from an existing questions file (its
 * dev/holdout lists and moved_to_dev) instead of deriving it from --seed, then applies
 * the split rule to it (a no-op unless a hard ranking test was added since); the output's
 * output records `split_source` (file, sha256, split hash, whether the rule changed anything)
 * beside `split`, which keeps exactly the shape resplit.js --check expects.
 * --strata picks what to generate (default identifier,plain,state,negative); `terse` adds
 * the terse stratum (see buildTersePrompt: a <= 12-word question written from the lesson
 * title and description only, never the lesson text; TERSE_PROMPT_VERSION, its template
 * and sha256 are recorded in the output). --holdout-per-lesson N generates N questions
 * per stratum for each holdout lesson (default 1): N independent calls of the same prompt,
 * so holdout questions come from the same distribution as dev ones.
 *
 * Model calls go through claude-call.js: prompt on stdin from a file, cwd an empty temp
 * dir, flags MODEL_FLAGS (--safe-mode, --setting-sources project, --tools ""), cost in the
 * CCI_EVAL_LEDGER ledger when one is set. v1 and v2 were generated before this, with the
 * prompt as an argument and no flags.
 *
 * Output: questions-v<version>.json (default version 1). Refuses to
 * overwrite an existing versioned file — versions are immutable once
 * written; bump --version for a new generation. Progress is checkpointed to
 * questions-v<version>.json.partial (atomic tmp+rename writes) and resumed
 * automatically if present and its header (seed/model/prompt_version/version)
 * matches the current invocation; a header mismatch refuses to resume. A
 * resumed run keeps the partial's lesson split (never recomputes it), so a
 * topic-index change between runs cannot move a lesson across dev/holdout.
 *
 * The split rule: a seeded random split (lib.splitLessons), then every lesson a
 * hard ranking test asserts (the skill package's scripts/tests/ranking-cases.json)
 * is moved to dev (lib.applyHardTestRule). The file's `split` records the rule
 * and the moved lessons (`moved_to_dev`), so the random split is recoverable.
 * When a later hard test names a holdout lesson of a committed set, resplit.js
 * applies the rule to that file (and a new baseline is cut).
 *
 * qids: v1 used bare `id-0001`, `pl-0002`, ... (frozen). From v2 on they carry
 * the version (`v2-id-0001`) so they are unique across versions; run.js also
 * keys every comparison by version + qid.
 *
 * A plain question that still leaks after MAX_LEAK_RETRIES is dropped (and
 * recorded in `dropped`), but that lesson's identifier question is kept.
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const lib = require('./lib.js');
const CC = require('./claude-call.js');

const PROMPT_VERSION = 'gen-questions-v1';
const TERSE_PROMPT_VERSION = 'gen-terse-v1';
const TERSE_MAX_WORDS = 12;
const DEFAULT_STRATA = ['identifier', 'plain', 'state', 'negative'];
const KNOWN_STRATA = ['identifier', 'plain', 'terse', 'state', 'negative'];
// --setting-sources project: in the empty cwd this loads no settings at all, so the user's
// ~/.claude/settings.json (advisorModel, hooks, env) cannot change the call.
const MODEL_FLAGS = ['--safe-mode', '--setting-sources', 'project', '--tools', ''];
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_SEED = 1;
const DEFAULT_STATE_SAMPLE = 60;
const DEFAULT_NEGATIVE_COUNT = 20;
const MAX_LEAK_RETRIES = 3;
const DEFAULT_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    seed: DEFAULT_SEED,
    model: DEFAULT_MODEL,
    version: 1,
    dryRun: false,
    limit: Infinity,
    concurrency: DEFAULT_CONCURRENCY,
    stateSample: DEFAULT_STATE_SAMPLE,
    negativeCount: DEFAULT_NEGATIVE_COUNT,
    splitFrom: null,
    strata: DEFAULT_STRATA,
    holdoutPerLesson: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') opts.seed = parseInt(argv[++i], 10);
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--version') opts.version = parseInt(argv[++i], 10);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10);
    else if (a === '--concurrency') opts.concurrency = parseInt(argv[++i], 10);
    else if (a === '--state-sample') opts.stateSample = parseInt(argv[++i], 10);
    else if (a === '--negative-count') opts.negativeCount = parseInt(argv[++i], 10);
    else if (a === '--split-from') opts.splitFrom = path.resolve(argv[++i]);
    else if (a === '--strata') opts.strata = argv[++i].split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--holdout-per-lesson') opts.holdoutPerLesson = parseInt(argv[++i], 10);
    else if (a === '--out-dir') opts.outDir = path.resolve(argv[++i]); // testing only; not documented in --help
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { process.stderr.write(`ERROR: unknown argument "${a}"\n`); printUsage(); process.exit(1); }
  }
  const bad = opts.strata.filter((x) => !KNOWN_STRATA.includes(x));
  if (bad.length) { process.stderr.write(`ERROR: unknown stratum ${bad.join(', ')} (known: ${KNOWN_STRATA.join(', ')})\n`); process.exit(1); }
  if (!(opts.holdoutPerLesson >= 1)) { process.stderr.write('ERROR: --holdout-per-lesson must be >= 1\n'); process.exit(1); }
  return opts;
}

function printUsage() {
  process.stderr.write(
    'Usage: gen-questions.js --dry-run [--limit N]\n' +
    '       gen-questions.js [--seed N] [--model M] [--version N] [--limit N]\n' +
    '                        [--concurrency N] [--state-sample N] [--negative-count N]\n' +
    '                        [--split-from <questions file>] [--strata identifier,plain,terse,state,negative]\n' +
    '                        [--holdout-per-lesson N]\n'
  );
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildLessonPrompt(lesson, lessonText, feedback) {
  return [
    'You are generating retrieval-evaluation questions for a documentation search system.',
    `Lesson title: ${lesson.title}`,
    'Lesson text:',
    '"""',
    lessonText,
    '"""',
    '',
    'Produce exactly two questions about this lesson.',
    '- identifier_question: a question that MAY name specific identifiers, symbols,',
    '  env var names, gate ids, slash commands or tool names from the lesson text.',
    '- plain_question: a question phrased the way an ordinary user would type it, in',
    '  plain language. It must NOT name any code identifier, env var, gate id, slash',
    '  command or tool name from the lesson -- describe the underlying behavior or',
    '  problem instead.',
    '',
    'Return ONLY a JSON object, no prose, no markdown fence:',
    '{"identifier_question": "...", "plain_question": "..."}',
    feedback ? `\nThe previous plain_question leaked an identifier ("${feedback}"). Rewrite it without naming that identifier, its normal-English expansion, or any equivalent one.` : '',
  ].filter(Boolean).join('\n');
}

// The terse prompt (TERSE_PROMPT_VERSION). Frozen before any terse output was seen; the
// output file records this template and its sha256 (terseTemplateRecord). It sees the
// lesson's title and, when topic-index has one, its description -- never the lesson text.
const TERSE_TEMPLATE = [
  'You are generating a retrieval-evaluation question for a documentation search system about Claude Code internals.',
  'You are shown only the title of one lesson{{SUMMARY_NOTE}}. You have not read the lesson.',
  '',
  'Lesson title: {{TITLE}}',
  '{{SUMMARY_LINE}}',
  'Write ONE short, vague question (at most 12 words) the way a user types it when they',
  'half-remember the topic: they noticed something or want to know something, but they do',
  'not know the right terms. Casual wording is fine. Do not reuse the title\'s exact phrasing,',
  'and do not name any code identifier, env var, gate id, slash command or tool name.',
  '',
  'Return ONLY a JSON object, no prose, no markdown fence: {"question": "..."}',
  '{{FEEDBACK}}',
].join('\n');
const TERSE_FEEDBACK = {
  leak: 'The previous question named an identifier ("{{X}}"). Rewrite it without naming that identifier, its normal-English expansion, or any equivalent one.',
  length: 'The previous question had {{N}} words. Rewrite it in at most 12 words.',
};

function terseTemplateRecord() {
  const text = TERSE_TEMPLATE + '\n--- feedback.leak ---\n' + TERSE_FEEDBACK.leak + '\n--- feedback.length ---\n' + TERSE_FEEDBACK.length;
  return {
    version: TERSE_PROMPT_VERSION, max_words: TERSE_MAX_WORDS, template: TERSE_TEMPLATE, feedback: TERSE_FEEDBACK,
    sha256: require('crypto').createHash('sha256').update(text).digest('hex'),
    inputs: 'lesson title + topic-index description when present; never the lesson text',
  };
}

/** feedback: null | {kind: 'leak', raw} | {kind: 'length', words} */
function buildTersePrompt(lesson, feedback) {
  const desc = lesson.description ? String(lesson.description).replace(/\s+/g, ' ').trim() : '';
  let fb = '';
  if (feedback && feedback.kind === 'leak') fb = '\n' + TERSE_FEEDBACK.leak.replace('{{X}}', feedback.raw);
  if (feedback && feedback.kind === 'length') fb = '\n' + TERSE_FEEDBACK.length.replace('{{N}}', String(feedback.words));
  return TERSE_TEMPLATE
    .replace('{{SUMMARY_NOTE}}', desc ? ' and its one-line summary' : '')
    .replace('{{TITLE}}', lesson.title)
    .replace('{{SUMMARY_LINE}}', desc ? `Lesson summary: ${desc}\n` : '')
    .replace('{{FEEDBACK}}', fb)
    .replace(/\n+$/, '');
}

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function buildStatePrompt(entry) {
  return [
    'You are generating a retrieval-evaluation question for a documentation search system.',
    'Here is a current-state record from this project\'s state registry:',
    JSON.stringify({ name: entry.name, kind: entry.kind, status: entry.status, summary: entry.summary }, null, 2),
    '',
    'Write ONE plain-language question a user might ask whose answer is this record\'s',
    'current status or summary. Describe it precisely enough that the answer is',
    'unambiguous, but prefer natural phrasing over quoting the record verbatim.',
    '',
    'Return ONLY a JSON object, no prose, no markdown fence: {"question": "..."}',
  ].join('\n');
}

function buildNegativePrompt(titles, count) {
  return [
    `You are generating ${count} plausible-sounding questions about Claude Code that are`,
    'NOT answered anywhere in this documentation set. Here are ALL the covered lesson',
    'titles -- avoid asking about any of these topics or close synonyms of them:',
    ...titles.map(t => `- ${t}`),
    '',
    `Return ONLY a JSON array of exactly ${count} strings, no prose, no markdown fence,`,
    'each a plausible question about some OTHER real or invented Claude Code behavior,',
    'feature, or internals topic not covered by the list above.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Model call (injectable for testing) + response parsing
// ---------------------------------------------------------------------------

/**
 * Default model caller: `claude -p --model <model> <MODEL_FLAGS> --output-format json`,
 * the prompt on stdin from a file, cwd a fresh empty temp directory so the repo's
 * CLAUDE.md can never be picked up (claude-call.js). Cost goes to the ledger, if set.
 *
 * @returns {Promise<string>} raw stdout
 */
function callModelDefault(prompt, opts) {
  const model = (opts && opts.model) || DEFAULT_MODEL;
  return CC.callJSON(prompt, { model, flags: MODEL_FLAGS, tag: 'gen-questions' });
}

/** Unwrap the `claude -p --output-format json` envelope's `result` field. */
function unwrapEnvelope(raw) {
  const envelope = JSON.parse(raw);
  const result = envelope && envelope.result !== undefined ? envelope.result : envelope;
  return typeof result === 'string' ? result : JSON.stringify(result);
}

/** Parse a JSON payload out of model text, stripping a ```json fence if present. */
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  return JSON.parse(body);
}

async function callModelJSON(callModel, prompt, opts) {
  const raw = await callModel(prompt, opts);
  const unwrapped = unwrapEnvelope(raw);
  return extractJSON(unwrapped);
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// qids
// ---------------------------------------------------------------------------

/**
 * v1 qids are bare (`id-0001`) and frozen as committed. From v2 on they are
 * prefixed with the version (`v2-id-0001`) so no qid is reused across versions.
 */
function qidFor(version, stratum, n) {
  const base = `${stratum}-${String(n).padStart(4, '0')}`;
  return version >= 2 ? `v${version}-${base}` : base;
}

// ---------------------------------------------------------------------------
// Partial-progress checkpointing (atomic tmp+rename)
// ---------------------------------------------------------------------------

function partialPath(outPath) {
  return outPath + '.partial';
}

function writePartial(outPath, state) {
  const p = partialPath(outPath);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

function readPartial(outPath, expectedHeader) {
  const p = partialPath(outPath);
  if (!fs.existsSync(p)) return null;
  const state = JSON.parse(fs.readFileSync(p, 'utf8'));
  const h = state.header || {};
  // The optional keys (split_from, strata, holdout_per_lesson, terse_prompt_sha256) are in
  // the header only when their option is used, so a default run compares exactly as before.
  const keys = ['seed', 'model', 'prompt_version', 'version',
    ...['split_from', 'strata', 'holdout_per_lesson', 'terse_prompt_sha256'].filter(k => k in expectedHeader || k in h)];
  const mismatch = keys.filter(k => JSON.stringify(h[k]) !== JSON.stringify(expectedHeader[k]));
  if (mismatch.length) {
    throw new Error(
      `refusing to resume ${p}: header mismatch on [${mismatch.join(', ')}] ` +
      `(partial has ${JSON.stringify(h)}, this invocation has ${JSON.stringify(expectedHeader)}). ` +
      'Delete the .partial file to start over, or match its seed/model/version.'
    );
  }
  return state;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * --split-from: the source file's split (dev/holdout, and its moved_to_dev), with the split
 * rule re-applied (lib.applyHardTestRule recovers the random split first, so this is a no-op
 * unless a hard ranking test was added or removed since). Records where it came from and
 * whether the rule changed the assignment (splitHash differs from the source's).
 */
function copiedSplit(src) {
  const s = src.data && src.data.split;
  if (!s || !Array.isArray(s.dev) || !Array.isArray(s.holdout)) throw new Error(`--split-from ${src.file}: no split with dev/holdout lists`);
  const ruled = lib.applyHardTestRule({ holdout: s.holdout, dev: s.dev, moved_to_dev: s.moved_to_dev || [] }, lib.loadHardTestLessons());
  const same = lib.splitHash(ruled) === lib.splitHash(s);
  if (!same) process.stderr.write(`WARNING: the split rule moved lessons relative to ${src.file}'s split (a hard ranking test changed since)\n`);
  return { split: ruled, source: { file: src.file, sha256: src.sha256, split_sha256: lib.splitHash(s), identical_after_rule: same } };
}

/**
 * @param {object} opts - parsed CLI options
 * @param {{callModel: function}} deps - injectable model caller (async (prompt, opts) => rawString)
 */
async function generate(opts, deps) {
  const callModel = (deps && deps.callModel) || callModelDefault;
  const topicIndex = lib.loadTopicIndex();
  const registry = lib.loadRegistry();
  const strata = opts.strata || DEFAULT_STRATA;
  const perHoldout = opts.holdoutPerLesson || 1;

  const header = { seed: opts.seed, model: opts.model, prompt_version: PROMPT_VERSION, version: opts.version };
  // Optional keys only when used, so a default run's header (and resume check) is unchanged.
  let splitSource = null;
  if (opts.splitFrom) {
    const raw = fs.readFileSync(opts.splitFrom);
    splitSource = { file: path.basename(opts.splitFrom), sha256: crypto.createHash('sha256').update(raw).digest('hex'), data: JSON.parse(raw) };
    header.split_from = splitSource.sha256;
  }
  if (JSON.stringify(strata) !== JSON.stringify(DEFAULT_STRATA)) header.strata = strata;
  if (perHoldout !== 1) header.holdout_per_lesson = perHoldout;
  if (strata.includes('terse')) header.terse_prompt_sha256 = terseTemplateRecord().sha256;

  const outPath = path.join(opts.outDir || lib.EVALS_DIR, `questions-v${opts.version}.json`);
  if (fs.existsSync(outPath)) {
    throw new Error(`${outPath} already exists — versions are immutable once written. Use --version N for a new generation.`);
  }

  let state = readPartial(outPath, header) || {
    header,
    // The split rule: a seeded random split (or, with --split-from, the given file's split),
    // then every lesson a hard ranking test (skill-package/.../scripts/tests/ranking-cases.json)
    // asserts is moved to dev.
    split: splitSource ? copiedSplit(splitSource).split : lib.applyHardTestRule(lib.splitLessons(topicIndex.lessons.map(l => l.id), opts.seed), lib.loadHardTestLessons()),
    ...(splitSource ? { split_source: copiedSplit(splitSource).source } : {}),
    questions: [],
    done: { lessons: [], terse: [], state_entries: [], negatives: false },
    dropped: [], // leaked questions that never resolved, for audit
  };
  if (!state.done.terse) state.done.terse = [];
  // Always the split recorded in the state: on resume that is the partial's,
  // never one recomputed from a topic-index that may have changed since.
  const split = state.split;
  const splitOf = new Map();
  for (const id of split.holdout) splitOf.set(id, 'holdout');
  for (const id of split.dev) splitOf.set(id, 'dev');

  let qidCounter = state.questions.length
    ? Math.max(...state.questions.map(q => parseInt(q.qid.split('-').pop(), 10) || 0)) + 1
    : 1;
  const nextQid = (stratum) => qidFor(opts.version, stratum, qidCounter++);

  // Work units: one per (lesson, repetition); a holdout lesson gets perHoldout repetitions.
  // Done keys: the lesson id for repetition 0 (as before), `<id>#<rep>` after that, so a
  // resumed run redoes only the repetitions that failed.
  const doneKey = (id, rep) => (rep === 0 ? id : `${id}#${rep}`);
  const repsOf = (id) => ((splitOf.get(id) || 'dev') === 'holdout' ? perHoldout : 1);
  const repField = (rep) => (perHoldout > 1 ? { rep } : {});
  const unitsFor = (doneList) => {
    const started = (l) => doneList.includes(l.id);
    const fresh = topicIndex.lessons.filter(l => !started(l));
    // --limit counts lessons (as before): the first (limit - lessons already started) new ones,
    // plus any unfinished repetitions of lessons already started.
    const allowed = new Set(fresh.slice(0, Math.max(0, opts.limit - (topicIndex.lessons.length - fresh.length))).map(l => l.id));
    const units = [];
    for (const l of topicIndex.lessons) {
      if (!allowed.has(l.id) && !started(l)) continue;
      for (let rep = 0; rep < repsOf(l.id); rep++) if (!doneList.includes(doneKey(l.id, rep))) units.push({ lesson: l, rep });
    }
    return units;
  };

  const wantLessonQs = strata.includes('identifier') || strata.includes('plain');
  await mapPool(wantLessonQs ? unitsFor(state.done.lessons) : [], opts.concurrency, async ({ lesson, rep }) => {
    const lessonText = lib.getLessonText(lesson);
    const identifiers = lib.extractIdentifiers(lessonText);
    const lessonSplit = splitOf.get(lesson.id) || 'dev';

    let feedback = null;
    let leakRetries = 0;
    let accepted = null;
    let modelFailed = false;
    let lastIdentifierQ = ''; // kept even if the plain question never stops leaking

    for (let attempt = 0; attempt <= MAX_LEAK_RETRIES; attempt++) {
      const prompt = buildLessonPrompt(lesson, lessonText, feedback);
      let parsed;
      try {
        parsed = await callModelJSON(callModel, prompt, opts);
      } catch (err) {
        if (err instanceof CC.BudgetExceededError) throw err;
        process.stderr.write(`lesson ${lesson.id}: model call failed (attempt ${attempt}): ${err.message}\n`);
        modelFailed = true;
        break;
      }
      const plain = String(parsed.plain_question || '');
      const identifierQ = String(parsed.identifier_question || '');
      if (identifierQ.trim()) lastIdentifierQ = identifierQ;
      const leaks = lib.findLeaks(plain, identifiers);
      if (leaks.length === 0) {
        accepted = { identifierQ, plain };
        leakRetries = attempt;
        break;
      }
      feedback = leaks[0].raw;
      leakRetries = attempt + 1;
    }

    const keepId = strata.includes('identifier');
    const keepPlain = strata.includes('plain');
    if (!accepted && !modelFailed && lastIdentifierQ) {
      // Only the plain question failed: keep the identifier one, drop the plain one.
      if (keepId) {
        state.questions.push({
          qid: nextQid('id'), stratum: 'identifier', lesson_id: lesson.id, registry_id: null,
          split: lessonSplit, text: lastIdentifierQ, leak_retries: leakRetries, ...repField(rep),
        });
      }
      if (keepPlain) state.dropped.push({ lesson_id: lesson.id, stratum: 'plain', reason: 'plain_question leaked an identifier after max retries (identifier question kept)', leak_retries: leakRetries, ...repField(rep) });
      process.stderr.write(`lesson ${lesson.id}: plain question dropped after ${leakRetries} leak retries; identifier question kept\n`);
    } else if (!accepted) {
      const reason = modelFailed ? 'model call failed' : 'plain_question leaked an identifier after max retries';
      if (!modelFailed) state.dropped.push({ lesson_id: lesson.id, reason, leak_retries: leakRetries, ...repField(rep) });
      process.stderr.write(`lesson ${lesson.id}: dropped (${reason}) after ${leakRetries} leak retries\n`);
    } else {
      if (keepId) {
        state.questions.push({
          qid: nextQid('id'), stratum: 'identifier', lesson_id: lesson.id, registry_id: null,
          split: lessonSplit, text: accepted.identifierQ, leak_retries: leakRetries, ...repField(rep),
        });
      }
      if (keepPlain) {
        state.questions.push({
          qid: nextQid('pl'), stratum: 'plain', lesson_id: lesson.id, registry_id: null,
          split: lessonSplit, text: accepted.plain, leak_retries: leakRetries, ...repField(rep),
        });
      }
    }

    // A model failure is retried on resume; a leak-exhausted drop is final.
    if (!modelFailed) state.done.lessons.push(doneKey(lesson.id, rep));
    writePartial(outPath, state);
  });

  // Terse questions: from the title (+ description) only. The lesson text is read here
  // solely to leak-mask against its identifiers; it is never shown to the model.
  await mapPool(strata.includes('terse') ? unitsFor(state.done.terse) : [], opts.concurrency, async ({ lesson, rep }) => {
    const identifiers = lib.extractIdentifiers(lib.getLessonText(lesson));
    const lessonSplit = splitOf.get(lesson.id) || 'dev';
    let feedback = null;
    let retries = 0;
    let accepted = null;
    let modelFailed = false;
    let lastReason = '';
    for (let attempt = 0; attempt <= MAX_LEAK_RETRIES; attempt++) {
      let parsed;
      try {
        parsed = await callModelJSON(callModel, buildTersePrompt(lesson, feedback), opts);
      } catch (err) {
        if (err instanceof CC.BudgetExceededError) throw err;
        process.stderr.write(`lesson ${lesson.id} terse: model call failed (attempt ${attempt}): ${err.message}\n`);
        modelFailed = true;
        break;
      }
      const text = String(parsed.question || '').trim();
      const leaks = lib.findLeaks(text, identifiers);
      const words = wordCount(text);
      if (text && leaks.length === 0 && words <= TERSE_MAX_WORDS) { accepted = text; retries = attempt; break; }
      if (leaks.length) { feedback = { kind: 'leak', raw: leaks[0].raw }; lastReason = 'leaked an identifier'; }
      else { feedback = { kind: 'length', words }; lastReason = `over ${TERSE_MAX_WORDS} words`; }
      retries = attempt + 1;
    }
    if (accepted) {
      state.questions.push({
        qid: nextQid('te'), stratum: 'terse', lesson_id: lesson.id, registry_id: null,
        split: lessonSplit, text: accepted, retries, ...repField(rep),
      });
    } else if (!modelFailed) {
      state.dropped.push({ lesson_id: lesson.id, stratum: 'terse', reason: `terse question ${lastReason} after max retries`, retries, ...repField(rep) });
    }
    if (!modelFailed) state.done.terse.push(doneKey(lesson.id, rep));
    writePartial(outPath, state);
  });

  // Current-state questions. Sampled deterministically from the FULL registry
  // (not just single-provenance entries) via the same seeded shuffle as the
  // lesson split, keyed by entry.id (stable, unique, insertion-order independent).
  const allEntryIds = registry.entries.map(e => e.id).sort();
  const rng = lib.mulberry32(opts.seed ^ 0x5EED0002);
  const shuffledEntryIds = lib.seededShuffle(allEntryIds, rng);
  const sampleIds = shuffledEntryIds.slice(0, Math.min(opts.stateSample, shuffledEntryIds.length));
  const entryById = new Map(registry.entries.map(e => [e.id, e]));

  const stateTodo = strata.includes('state') ? sampleIds.filter(id => !state.done.state_entries.includes(id)) : [];
  await mapPool(stateTodo, opts.concurrency, async (entryId) => {
    const entry = entryById.get(entryId);
    const prompt = buildStatePrompt(entry);
    try {
      const parsed = await callModelJSON(callModel, prompt, opts);
      // open decision: state questions inherit the FIRST provenance lesson's split.
      // The lesson is recorded (split_lesson_id) so relabelling never re-reads the registry.
      const splitLessonId = lib.stateSplitLessonId(entry);
      const questionSplit = splitLessonId === null ? 'dev' : (splitOf.get(splitLessonId) || 'dev');
      state.questions.push({
        qid: nextQid('st'), stratum: 'state', lesson_id: null, registry_id: entry.id,
        split_lesson_id: splitLessonId, split: questionSplit, text: String(parsed.question || ''),
      });
      // Only a success counts as done, so a resumed run retries failures.
      state.done.state_entries.push(entryId);
    } catch (err) {
      process.stderr.write(`state entry ${entryId}: model call failed: ${err.message}\n`);
    }
    writePartial(outPath, state);
  });

  // Negatives.
  if (strata.includes('negative') && !state.done.negatives) {
    const titles = topicIndex.lessons.map(l => l.title);
    const prompt = buildNegativePrompt(titles, opts.negativeCount);
    try {
      const parsed = await callModelJSON(callModel, prompt, opts);
      const arr = Array.isArray(parsed) ? parsed : (parsed.questions || []);
      // open decision: negatives have no natural lesson to split by; assign
      // via the same seeded shuffle so the split is still reproducible.
      const negRng = lib.mulberry32(opts.seed ^ 0x5EED0003);
      for (const text of arr) {
        const negSplit = negRng() < 1 / 3 ? 'holdout' : 'dev';
        state.questions.push({
          qid: nextQid('ng'), stratum: 'negative', lesson_id: null, registry_id: null,
          split: negSplit, text: String(text),
        });
      }
      state.done.negatives = true;
    } catch (err) {
      process.stderr.write(`negatives: model call failed: ${err.message}\n`);
    }
    writePartial(outPath, state);
  }

  const output = {
    version: opts.version,
    seed: opts.seed,
    model: opts.model,
    prompt_version: PROMPT_VERSION,
    generated_at: new Date().toISOString(),
    ...(opts.splitFrom || strata.includes('terse') || perHoldout !== 1 || callModel === callModelDefault ? {
      generation: {
        strata,
        holdout_per_lesson: perHoldout,
        model_flags: callModel === callModelDefault ? MODEL_FLAGS.map((f) => (f === '' ? '""' : f)).join(' ') : 'injected caller',
        caller: 'evals/retrieval/claude-call.js (prompt on stdin from a file, empty temp cwd)',
        ...(strata.includes('terse') ? { terse_prompt: terseTemplateRecord() } : {}),
      },
    } : {}),
    ...(state.split_source ? { split_source: state.split_source } : {}),
    split,
    questions: state.questions,
    dropped: state.dropped,
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  fs.rmSync(partialPath(outPath), { force: true });
  return output;
}

// ---------------------------------------------------------------------------
// --dry-run: print prompts for a couple of lessons without calling anything
// ---------------------------------------------------------------------------

function dryRun(opts) {
  const topicIndex = lib.loadTopicIndex();
  const n = Number.isFinite(opts.limit) ? Math.min(opts.limit, 2) : 2;
  const lessons = topicIndex.lessons.slice(0, n);
  for (const lesson of lessons) {
    const lessonText = lib.getLessonText(lesson);
    console.log('='.repeat(78));
    console.log(`LESSON ${lesson.id}: ${lesson.title}`);
    console.log('='.repeat(78));
    console.log(buildLessonPrompt(lesson, lessonText, null));
    console.log();
  }
  console.log('='.repeat(78));
  console.log('STATE QUESTION PROMPT (example, first registry entry)');
  console.log('='.repeat(78));
  const registry = lib.loadRegistry();
  console.log(buildStatePrompt(registry.entries[0]));
  console.log();
  console.log('='.repeat(78));
  console.log('NEGATIVE QUESTIONS PROMPT (example)');
  console.log('='.repeat(78));
  console.log(buildNegativePrompt(topicIndex.lessons.slice(0, 5).map(l => l.title), 3));
  if ((opts.strata || []).includes('terse')) {
    const rec = terseTemplateRecord();
    console.log();
    console.log('='.repeat(78));
    console.log(`TERSE PROMPT (${rec.version}, template sha256 ${rec.sha256}), first lesson without and with a description`);
    console.log('='.repeat(78));
    const withDesc = topicIndex.lessons.find(l => l.description);
    const noDesc = topicIndex.lessons.find(l => !l.description);
    for (const l of [noDesc, withDesc].filter(Boolean)) { console.log(buildTersePrompt(l, null)); console.log('-'.repeat(78)); }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.dryRun) {
    dryRun(opts);
    return;
  }
  const output = await generate(opts, {});
  console.log(`wrote questions-v${opts.version}.json: ${output.questions.length} questions, ${output.dropped.length} dropped`);
}

module.exports = {
  PROMPT_VERSION, DEFAULT_MODEL, TERSE_PROMPT_VERSION, TERSE_MAX_WORDS, MODEL_FLAGS, DEFAULT_STRATA,
  buildLessonPrompt, buildStatePrompt, buildNegativePrompt, buildTersePrompt, terseTemplateRecord, wordCount, copiedSplit,
  unwrapEnvelope, extractJSON, callModelJSON, callModelDefault,
  mapPool, writePartial, readPartial, partialPath, qidFor,
  generate, parseArgs,
};

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(1);
  });
}
