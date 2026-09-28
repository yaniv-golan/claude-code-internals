#!/usr/bin/env node
/**
 * gen-relevance.js — derive a question set with acceptable-answer sets
 * (questions-v<N>.json) from an existing one, without regenerating questions.
 *
 * Spec: docs/internal/maintainability-refactor-plan-2026-09-28.md §4.7b item 5.
 * Nothing here is hand-adjudicated: identifier questions get their sets from a
 * published deterministic rule, plain questions from a one-time model judgment
 * that is frozen into the output file.
 *
 * Usage:
 *   node gen-relevance.js --from questions-v1.json --version 2 --dry-run
 *   node gen-relevance.js --from questions-v1.json --version 2 [--judge-model M]
 *                         [--concurrency N] [--limit N]
 *
 * The output keeps the source's question texts, qids, strata, split and
 * dropped list unchanged. A derived version keeps its source's qids (it holds
 * the same questions; run.js keys every comparison by version + qid). Each
 * identifier and plain question gains `relevant: {lessonId: grade}`:
 * grade 2 = the source lesson (always, whatever the rule or the judge says),
 * grade 1 = another acceptable lesson. State and negative questions are
 * carried over unchanged (they stay report-only in run.js).
 *
 * IDENTIFIER RULE (IDENTIFIER_RULE_VERSION, deterministic, no model):
 *   1. The question's identifiers: extractIdentifiers(question text)
 *      (scripts/lib/identifiers.js), each reduced to its candidate tokens the
 *      way prepare-lessons.js does (a code span -> spanCandidates(); every
 *      other kind -> the match itself), tokens shorter than 3 characters
 *      dropped.
 *   2. Intersected with the source lesson's identifiers: a token is kept only
 *      if occurrencePositions(source lesson text) has it, i.e. the extraction
 *      produces that exact token somewhere in the source lesson. Its source
 *      count s = the number of places it occurs there.
 *   3. A lesson L (other than the source) is acceptable if, for at least one
 *      kept token t:
 *        (a) HOMED: a topic-index keyword_map key (hand or generated) whose
 *            normalize()d form equals normalize(t) or normalize(keyFormOf(t))
 *            maps to L; or
 *        (b) MENTIONED: occurrencePositions(L's text) has t at >= s places.
 *      occurrencePositions is the counting prepare-lessons.js uses to home a
 *      generated key (keywordCandidates' count), so (a) and (b) use one
 *      arithmetic.
 *   A question with no kept token gets the source lesson alone.
 *
 * PLAIN-QUESTION JUDGMENT (JUDGE_PROMPT_VERSION, one-time, frozen):
 *   Candidate pool per question = union of
 *     - the keyword layer's top 10 (search.js keyword_rank <= 10),
 *     - the TF-IDF layer's top 10: semantic-search.js's top 10, plus
 *       search.js's own tfidf_rank <= 10 (the two TF-IDF paths do not always
 *       agree; both are included),
 *     - the fused top 10 (search.js rank <= 10),
 *     - the source lesson.
 *   Every candidate records which layer(s) put it in the pool. One model call
 *   per question judges every candidate (title + description + the first
 *   EXCERPT_CHARS characters of its text), in lesson-id order, labelled
 *   C1..Cn; the judge is not told which one is the source. Each verdict is
 *   yes/no with a one-line reason; all are stored, including the verdict on
 *   the source lesson (a calibration signal: the source is grade 2 regardless).
 *   The judge runs `claude -p --model <judge> --safe-mode --tools ""` with
 *   stdin ignored and a fresh temp cwd: no tools (the excerpt is all it sees),
 *   no CLAUDE.md, skills, plugins, hooks or MCP servers.
 *
 * The pools are computed once, before any call, and stored in the checkpoint
 * (questions-v<N>.json.partial, atomic writes) with the judgments made so far;
 * only a fully parsed judgment marks a question done, so a rerun retries only
 * failures. The checkpoint refuses to resume under a different header
 * (source sha256, version, judge model, prompt version, excerpt size). The
 * final file is written only when every plain question is judged; it refuses
 * to overwrite an existing questions-v<N>.json.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const lib = require('./lib.js');
const G = require('./gen-questions.js');
const I = require(path.join(lib.SCRIPTS_DIR, 'lib', 'identifiers.js'));

const IDENTIFIER_RULE_VERSION = 'identifier-rule-v1';
const JUDGE_PROMPT_VERSION = 'judge-relevance-v1';
const DEFAULT_JUDGE_MODEL = 'claude-fable-5-1';
const JUDGE_FLAGS = ['--safe-mode', '--tools', ''];
const EXCERPT_CHARS = 1800;
const POOL_TOP = 10;
const SEARCH_DEPTH = 200; // search.js --top, deep enough to see every keyword/tfidf rank <= 10
const DEFAULT_CONCURRENCY = 4;
const MIN_TOKEN_LEN = 3;
const SEMANTIC_JS = path.join(lib.SCRIPTS_DIR, 'semantic-search.js');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { from: null, version: null, judgeModel: DEFAULT_JUDGE_MODEL, concurrency: DEFAULT_CONCURRENCY, dryRun: false, limit: Infinity, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') opts.from = argv[++i];
    else if (a === '--version') opts.version = parseInt(argv[++i], 10);
    else if (a === '--judge-model') opts.judgeModel = argv[++i];
    else if (a === '--concurrency') opts.concurrency = parseInt(argv[++i], 10);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10);
    else if (a === '--out-dir') opts.outDir = path.resolve(argv[++i]); // testing only
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { process.stderr.write(`ERROR: unknown argument "${a}"\n`); printUsage(); process.exit(1); }
  }
  return opts;
}

function printUsage() {
  process.stderr.write(
    'Usage: gen-relevance.js --from questions-v1.json --version 2 [--dry-run]\n' +
    '                        [--judge-model M] [--concurrency N] [--limit N]\n'
  );
}

// ---------------------------------------------------------------------------
// Identifier rule (pure)
// ---------------------------------------------------------------------------

/** keyword_map -> Map(normalized key -> Set(lesson ids)), unioning keys that normalize alike. */
function buildKeyIndex(keywordMap) {
  const idx = new Map();
  for (const [k, ids] of Object.entries(keywordMap || {})) {
    const n = I.normalize(k);
    if (!n) continue;
    if (!idx.has(n)) idx.set(n, new Set());
    for (const id of ids) idx.get(n).add(id);
  }
  return idx;
}

/** Map(lesson id -> text) -> Map(lesson id -> occurrencePositions(text)). */
function buildPositions(lessonTexts) {
  const out = new Map();
  for (const [id, text] of lessonTexts) out.set(id, I.occurrencePositions(text));
  return out;
}

/** The candidate tokens of the question's identifiers (rule step 1), deduped, in order. */
function questionTokens(questionText) {
  const out = [];
  const seen = new Set();
  for (const id of I.extractIdentifiers(questionText)) {
    const forms = id.kind === 'code-span' ? I.spanCandidates(id.raw).map((c) => c.raw) : [id.raw];
    for (const f of forms) {
      if (f.length < MIN_TOKEN_LEN || seen.has(f)) continue;
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

/**
 * The identifier rule (see header). Pure.
 * @param {string} questionText
 * @param {number} sourceId
 * @param {Map<number, Map<string, Set<string>>>} positions  buildPositions() output
 * @param {Map<string, Set<number>>} keyIndex  buildKeyIndex() output
 * @returns {{relevant: Object<string, number>, basis: {tokens: Array, extra: Object}}}
 */
function identifierRelevance(questionText, sourceId, positions, keyIndex) {
  const srcPos = positions.get(sourceId) || new Map();
  const tokens = [];
  const extra = new Map(); // lesson id -> [why...]
  const why = (id, s) => { if (!extra.has(id)) extra.set(id, []); extra.get(id).push(s); };
  for (const t of questionTokens(questionText)) {
    const s = srcPos.has(t) ? srcPos.get(t).size : 0;
    if (!s) continue; // not one of the source lesson's identifiers
    const homed = new Set();
    for (const n of new Set([I.normalize(t), I.normalize(I.keyFormOf(t))])) {
      for (const id of keyIndex.get(n) || []) homed.add(id);
    }
    tokens.push({ token: t, source_count: s, homed: [...homed].sort((a, b) => a - b) });
    for (const id of homed) if (id !== sourceId) why(id, `homed:${t}`);
    for (const [id, pos] of positions) {
      if (id === sourceId) continue;
      const c = pos.has(t) ? pos.get(t).size : 0;
      if (c >= s) why(id, `mentions:${t}:${c}>=${s}`);
    }
  }
  const relevant = { [sourceId]: 2 };
  for (const id of extra.keys()) relevant[id] = 1;
  const extraObj = {};
  for (const id of [...extra.keys()].sort((a, b) => a - b)) extraObj[id] = extra.get(id);
  return { relevant, basis: { tokens, extra: extraObj } };
}

// ---------------------------------------------------------------------------
// Candidate pool (spawns the search scripts)
// ---------------------------------------------------------------------------

function runJSON(script, query, top) {
  try {
    return JSON.parse(execFileSync('node', [script, query, '--json', `--top=${top}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr) : '';
    if (/only stop words/i.test(stderr)) return [];
    throw new Error(`${path.basename(script)} failed for ${JSON.stringify(query)}: ${err.message}\n${stderr}`);
  }
}

/**
 * Pool from already-fetched result lists (pure): fused = search.js --json
 * output (ranked, with keyword_rank / tfidf_rank), semantic = semantic-search.js
 * --json output (ranked). Returns [{id, layers: [...]}] in lesson-id order.
 */
function poolFrom(fused, semantic, sourceId, top = POOL_TOP) {
  const layers = new Map();
  const add = (id, layer) => { if (!layers.has(id)) layers.set(id, new Set()); layers.get(id).add(layer); };
  fused.forEach((r, i) => {
    if (i < top) add(r.id, 'fused');
    if (r.keyword_rank !== null && r.keyword_rank <= top) add(r.id, 'keyword');
    if (r.tfidf_rank !== null && r.tfidf_rank <= top) add(r.id, 'tfidf-search');
  });
  semantic.slice(0, top).forEach((r) => add(r.id, 'tfidf-semantic'));
  add(sourceId, 'source');
  return [...layers.entries()].sort((a, b) => a[0] - b[0]).map(([id, s]) => ({ id, layers: [...s].sort() }));
}

function candidatePool(questionText, sourceId) {
  const fused = runJSON(lib.SEARCH_JS, questionText, SEARCH_DEPTH);
  const semantic = runJSON(SEMANTIC_JS, questionText, POOL_TOP);
  return poolFrom(fused, semantic, sourceId);
}

// ---------------------------------------------------------------------------
// Judge (model; injectable)
// ---------------------------------------------------------------------------

function excerptOf(lesson, text) {
  const body = text.length > EXCERPT_CHARS ? text.slice(0, EXCERPT_CHARS) + ' [...]' : text;
  return `Title: ${lesson.title}\nSummary: ${lesson.description || ''}\nExcerpt:\n${body}`;
}

function buildJudgePrompt(question, candidates) {
  const lines = [
    'You are judging relevance for a documentation search evaluation.',
    'A user asked this question:',
    '"""',
    question,
    '"""',
    '',
    `Below are ${candidates.length} candidate lessons, each shown as its title, a one-line summary and`,
    'the beginning of its text (truncated). For EACH candidate decide whether that lesson',
    'substantively answers the question: a user who opened it would find the answer, or the',
    'main part of it, there. Sharing a topic or a keyword is not enough.',
    '',
  ];
  for (const c of candidates) {
    lines.push(`=== ${c.label} ===`, c.excerpt, '');
  }
  lines.push(
    'Return ONLY a JSON object, no prose, no markdown fence, with one entry per candidate, in order:',
    '{"verdicts": [{"c": "C1", "answers": true, "reason": "one short line"}, ...]}'
  );
  return lines.join('\n');
}

/** Validate a parsed judge payload against the labels; throws on any gap. */
function parseVerdicts(parsed, labels) {
  const arr = parsed && Array.isArray(parsed.verdicts) ? parsed.verdicts : null;
  if (!arr) throw new Error('judge response has no "verdicts" array');
  const byLabel = new Map();
  for (const v of arr) {
    if (!v || typeof v.c !== 'string' || typeof v.answers !== 'boolean') throw new Error(`malformed verdict ${JSON.stringify(v)}`);
    if (!labels.includes(v.c)) throw new Error(`verdict for unknown candidate ${v.c}`);
    if (byLabel.has(v.c)) throw new Error(`duplicate verdict for ${v.c}`);
    byLabel.set(v.c, { answers: v.answers, reason: String(v.reason || '').slice(0, 300) });
  }
  const missing = labels.filter((l) => !byLabel.has(l));
  if (missing.length) throw new Error(`no verdict for ${missing.join(', ')}`);
  return byLabel;
}

function callJudgeDefault(prompt, opts) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-relevance-cwd-'));
    execFile(
      'claude',
      ['-p', '--model', opts.judgeModel, ...JUDGE_FLAGS, '--output-format', 'json', prompt],
      { cwd: tmpDir, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (err) reject(new Error(`claude -p failed: ${err.message}\n${stderr}`));
        else resolve(stdout);
      }
    );
  });
}

/**
 * Judge one question's pool. Returns [{id, layers, answers, reason}] in pool order.
 */
async function judgeQuestion(question, pool, lessonById, lessonTexts, callJudge, opts) {
  const candidates = pool.map((p, i) => ({
    ...p, label: `C${i + 1}`, excerpt: excerptOf(lessonById.get(p.id), lessonTexts.get(p.id)),
  }));
  const prompt = buildJudgePrompt(question, candidates);
  const parsed = await G.callModelJSON(callJudge, prompt, opts);
  const verdicts = parseVerdicts(parsed, candidates.map((c) => c.label));
  return candidates.map((c) => ({ id: c.id, layers: c.layers, answers: verdicts.get(c.label).answers, reason: verdicts.get(c.label).reason }));
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function gitHead() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: lib.REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return null; }
}

function loadCorpus() {
  const topicIndex = lib.loadTopicIndex();
  const lessonById = new Map(topicIndex.lessons.map((l) => [l.id, l]));
  const lessonTexts = new Map(topicIndex.lessons.map((l) => [l.id, lib.getLessonText(l)]));
  return { topicIndex, lessonById, lessonTexts };
}

/**
 * @param {object} opts  parseArgs() output
 * @param {{callJudge?: function, pools?: function}} deps  injectable judge + pool source (tests)
 */
async function generate(opts, deps = {}) {
  const callJudge = deps.callJudge || callJudgeDefault;
  const poolFor = deps.pools || candidatePool;
  if (!opts.from || !Number.isInteger(opts.version)) throw new Error('--from <questions file> and --version N are required');
  const fromPath = path.resolve(opts.from);
  const fromRaw = fs.readFileSync(fromPath);
  const source = JSON.parse(fromRaw);
  if (opts.version <= source.version) throw new Error(`--version ${opts.version} must be greater than the source's version ${source.version}`);
  const outPath = path.join(opts.outDir || lib.EVALS_DIR, `questions-v${opts.version}.json`);
  if (fs.existsSync(outPath)) {
    throw new Error(`${outPath} already exists — versions are immutable once written.`);
  }

  const { topicIndex, lessonById, lessonTexts } = loadCorpus();
  const positions = buildPositions(lessonTexts);
  const keyIndex = buildKeyIndex(topicIndex.keyword_map);

  const header = {
    from_sha256: sha256(fromRaw), version: opts.version, judge_model: opts.judgeModel,
    judge_prompt_version: JUDGE_PROMPT_VERSION, excerpt_chars: EXCERPT_CHARS, identifier_rule: IDENTIFIER_RULE_VERSION,
  };
  let state;
  const pPath = G.partialPath(outPath);
  if (fs.existsSync(pPath)) {
    state = JSON.parse(fs.readFileSync(pPath, 'utf8'));
    const mismatch = Object.keys(header).filter((k) => (state.header || {})[k] !== header[k]);
    if (mismatch.length) throw new Error(`refusing to resume ${pPath}: header mismatch on [${mismatch.join(', ')}]. Delete it to start over.`);
  } else {
    state = { header, search_head: gitHead(), pools: {}, judged: {} };
  }

  const plain = source.questions.filter((q) => q.stratum === 'plain');
  // Pools first, once, before any call; stored so a resume judges the same pool.
  let newPools = 0;
  for (const q of plain) {
    if (state.pools[q.qid]) continue;
    state.pools[q.qid] = poolFor(q.text, q.lesson_id);
    newPools++;
  }
  if (newPools) G.writePartial(outPath, state);

  const todo = plain.filter((q) => !state.judged[q.qid]);
  const poolSizes = plain.map((q) => state.pools[q.qid].length);
  const estimate = {
    plain_questions: plain.length, already_judged: plain.length - todo.length, calls_needed: todo.length,
    mean_pool: poolSizes.reduce((a, b) => a + b, 0) / (poolSizes.length || 1), max_pool: Math.max(0, ...poolSizes),
  };
  process.stderr.write(`judge estimate: ${JSON.stringify(estimate)}\n`);
  if (opts.dryRun) {
    const q = todo[0] || plain[0];
    if (q) {
      const cands = state.pools[q.qid].map((p, i) => ({ ...p, label: `C${i + 1}`, excerpt: excerptOf(lessonById.get(p.id), lessonTexts.get(p.id)) }));
      console.log(buildJudgePrompt(q.text, cands));
    }
    return { dryRun: true, estimate };
  }

  const batch = todo.slice(0, Number.isFinite(opts.limit) ? opts.limit : todo.length);
  let failures = 0;
  await G.mapPool(batch, opts.concurrency, async (q) => {
    try {
      state.judged[q.qid] = await judgeQuestion(q.text, state.pools[q.qid], lessonById, lessonTexts, callJudge, opts);
    } catch (err) {
      failures++;
      process.stderr.write(`${q.qid}: judge failed: ${err.message.split('\n')[0]}\n`);
    }
    G.writePartial(outPath, state);
  });

  const remaining = plain.filter((q) => !state.judged[q.qid]).length;
  if (remaining) {
    process.stderr.write(`${remaining} plain question(s) not judged yet (${failures} failed this run); rerun to resume from ${pPath}\n`);
    return { complete: false, failures, remaining };
  }

  const questions = source.questions.map((q) => {
    if (q.stratum === 'identifier') {
      const { relevant, basis } = identifierRelevance(q.text, q.lesson_id, positions, keyIndex);
      return { ...q, relevant, relevance_basis: { rule: IDENTIFIER_RULE_VERSION, ...basis } };
    }
    if (q.stratum === 'plain') {
      const verdicts = state.judged[q.qid];
      const relevant = { [q.lesson_id]: 2 };
      for (const v of verdicts) if (v.answers && v.id !== q.lesson_id) relevant[v.id] = 1;
      return { ...q, relevant, relevance_basis: { judge: JUDGE_PROMPT_VERSION, verdicts } };
    }
    return q;
  });

  const output = {
    version: opts.version,
    seed: source.seed,
    model: source.model,
    prompt_version: source.prompt_version,
    generated_at: source.generated_at,
    derived_from: { version: source.version, file: path.basename(fromPath), sha256: header.from_sha256 },
    relevance: {
      generated_at: new Date().toISOString(),
      search_head: state.search_head,
      grades: { 2: 'source lesson (always)', 1: 'other acceptable lesson' },
      identifier_rule: IDENTIFIER_RULE_VERSION,
      judge: {
        model: opts.judgeModel, prompt_version: JUDGE_PROMPT_VERSION, date: new Date().toISOString().slice(0, 10),
        flags: JUDGE_FLAGS.map((f) => (f === '' ? '""' : f)).join(' '), excerpt_chars: EXCERPT_CHARS,
        pool: `union of keyword top ${POOL_TOP}, TF-IDF top ${POOL_TOP} (semantic-search.js and search.js tfidf_rank), fused top ${POOL_TOP}, source lesson`,
      },
      rules: 'see evals/retrieval/gen-relevance.js header',
    },
    split: source.split,
    questions,
    dropped: source.dropped,
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  fs.rmSync(pPath, { force: true });
  return { complete: true, output };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const r = await generate(opts);
  if (r.dryRun) return;
  if (!r.complete) { process.exitCode = 1; return; }
  console.log(`wrote questions-v${opts.version}.json: ${r.output.questions.length} questions`);
}

module.exports = {
  IDENTIFIER_RULE_VERSION, JUDGE_PROMPT_VERSION, DEFAULT_JUDGE_MODEL, EXCERPT_CHARS, POOL_TOP,
  parseArgs, buildKeyIndex, buildPositions, questionTokens, identifierRelevance,
  poolFrom, candidatePool, excerptOf, buildJudgePrompt, parseVerdicts, judgeQuestion, generate,
};

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`ERROR: ${err.message}\n`); process.exit(1); });
}
