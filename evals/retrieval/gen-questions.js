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
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const lib = require('./lib.js');

const PROMPT_VERSION = 'gen-questions-v1';
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
    else if (a === '--out-dir') opts.outDir = path.resolve(argv[++i]); // testing only; not documented in --help
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { process.stderr.write(`ERROR: unknown argument "${a}"\n`); printUsage(); process.exit(1); }
  }
  return opts;
}

function printUsage() {
  process.stderr.write(
    'Usage: gen-questions.js --dry-run [--limit N]\n' +
    '       gen-questions.js [--seed N] [--model M] [--version N] [--limit N]\n' +
    '                        [--concurrency N] [--state-sample N] [--negative-count N]\n'
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
 * Default model caller: `claude -p --model <model> --output-format json <prompt>`,
 * stdin ignored (not inherited), cwd a fresh mkdtemp'd directory so the
 * repo's CLAUDE.md can never be picked up by cwd-scoped project settings.
 *
 * @returns {Promise<string>} raw stdout
 */
function callModelDefault(prompt, opts) {
  const model = (opts && opts.model) || DEFAULT_MODEL;
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-questions-cwd-'));
    execFile(
      'claude',
      ['-p', '--model', model, '--output-format', 'json', prompt],
      { cwd: tmpDir, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (err) reject(new Error(`claude -p failed: ${err.message}\n${stderr}`));
        else resolve(stdout);
      }
    );
  });
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
  const mismatch = ['seed', 'model', 'prompt_version', 'version'].filter(k => h[k] !== expectedHeader[k]);
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
 * @param {object} opts - parsed CLI options
 * @param {{callModel: function}} deps - injectable model caller (async (prompt, opts) => rawString)
 */
async function generate(opts, deps) {
  const callModel = (deps && deps.callModel) || callModelDefault;
  const topicIndex = lib.loadTopicIndex();
  const registry = lib.loadRegistry();

  const header = { seed: opts.seed, model: opts.model, prompt_version: PROMPT_VERSION, version: opts.version };

  const outPath = path.join(opts.outDir || lib.EVALS_DIR, `questions-v${opts.version}.json`);
  if (fs.existsSync(outPath)) {
    throw new Error(`${outPath} already exists — versions are immutable once written. Use --version N for a new generation.`);
  }

  let state = readPartial(outPath, header) || {
    header,
    // The split rule: a seeded random split, then every lesson a hard ranking test
    // (skill-package/.../scripts/tests/ranking-cases.json) asserts is moved to dev.
    split: lib.applyHardTestRule(lib.splitLessons(topicIndex.lessons.map(l => l.id), opts.seed), lib.loadHardTestLessons()),
    questions: [],
    done: { lessons: [], state_entries: [], negatives: false },
    dropped: [], // leaked questions that never resolved, for audit
  };
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

  const lessonsToDo = topicIndex.lessons
    .filter(l => !state.done.lessons.includes(l.id))
    .slice(0, Math.max(0, opts.limit - state.done.lessons.length));

  await mapPool(lessonsToDo, opts.concurrency, async (lesson) => {
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

    if (!accepted && !modelFailed && lastIdentifierQ) {
      // Only the plain question failed: keep the identifier one, drop the plain one.
      state.questions.push({
        qid: nextQid('id'), stratum: 'identifier', lesson_id: lesson.id, registry_id: null,
        split: lessonSplit, text: lastIdentifierQ, leak_retries: leakRetries,
      });
      state.dropped.push({ lesson_id: lesson.id, stratum: 'plain', reason: 'plain_question leaked an identifier after max retries (identifier question kept)', leak_retries: leakRetries });
      process.stderr.write(`lesson ${lesson.id}: plain question dropped after ${leakRetries} leak retries; identifier question kept\n`);
    } else if (!accepted) {
      const reason = modelFailed ? 'model call failed' : 'plain_question leaked an identifier after max retries';
      if (!modelFailed) state.dropped.push({ lesson_id: lesson.id, reason, leak_retries: leakRetries });
      process.stderr.write(`lesson ${lesson.id}: dropped (${reason}) after ${leakRetries} leak retries\n`);
    } else {
      state.questions.push({
        qid: nextQid('id'), stratum: 'identifier', lesson_id: lesson.id, registry_id: null,
        split: lessonSplit, text: accepted.identifierQ, leak_retries: leakRetries,
      });
      state.questions.push({
        qid: nextQid('pl'), stratum: 'plain', lesson_id: lesson.id, registry_id: null,
        split: lessonSplit, text: accepted.plain, leak_retries: leakRetries,
      });
    }

    // A model failure is retried on resume; a leak-exhausted drop is final.
    if (!modelFailed) state.done.lessons.push(lesson.id);
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

  const stateTodo = sampleIds.filter(id => !state.done.state_entries.includes(id));
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
  if (!state.done.negatives) {
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
  PROMPT_VERSION, DEFAULT_MODEL,
  buildLessonPrompt, buildStatePrompt, buildNegativePrompt,
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
