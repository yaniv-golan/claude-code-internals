#!/usr/bin/env node
/**
 * gen-relevance.js — derive a question set with acceptable-answer sets
 * (questions-v<N>.json) from an existing one, without regenerating questions.
 *
 * Nothing here is hand-adjudicated: identifier questions get their sets from a
 * published deterministic rule, plain questions from a one-time model judgment
 * that is frozen into the output file.
 *
 * Usage:
 *   node gen-relevance.js --from questions-v1.json --version 2 --dry-run
 *   node gen-relevance.js --from questions-v1.json --version 2 [--judge-model M]
 *                         [--concurrency N] [--limit N]
 *
 * The output keeps the source's question texts, qids, strata and dropped list
 * unchanged. Its split is the source's random split with the split rule applied
 * (lib.applyHardTestRule: every lesson a hard ranking test asserts is moved to
 * dev, and those lessons' questions relabelled dev). A derived version keeps its source's qids (it holds
 * the same questions; run.js keys every comparison by version + qid). Each
 * identifier and plain question gains `relevant: {lessonId: grade}`:
 * grade 2 = the source lesson (always, whatever the rule or the judge says),
 * grade 1 = another acceptable lesson. State and negative questions are
 * carried over unchanged (they stay report-only in run.js), except that a state
 * question from a source written before `split_lesson_id` existed (questions-v1)
 * gets it here, once: its registry entry's first provenance lesson
 * (lib.stateSplitLessonId), the rule gen-questions.js placed it by. From then on
 * relabelling reads the recorded field, never the registry.
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
 *        (a) HOMED: a topic-index keyword_map key (hand or generated identifier
 *            key; phase-3b vocabulary keys are phrases, never identifier homes, so
 *            they are left out, which keeps the rule what it was when v1 was cut) whose
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
 *   The judge runs `claude -p --model <judge> --safe-mode --setting-sources project
 *   --tools ""` with the prompt on stdin from a file and a fresh empty temp cwd
 *   (claude-call.js): no tools (the excerpt is all it sees), no CLAUDE.md, skills,
 *   plugins, hooks, MCP servers or user settings. (questions-v2 was judged before
 *   --setting-sources project was added, with the prompt as an argument.)
 *
 * The pools are computed once, before any call, and stored in the checkpoint
 * (questions-v<N>.json.partial, atomic writes) with the judgments made so far;
 * only a fully parsed judgment marks a question done, so a rerun retries only
 * failures. The checkpoint refuses to resume under a different header
 * (source sha256, version, judge model, prompt version, excerpt size). The
 * final file is written only when every question of the judged strata is judged; it refuses
 * to overwrite an existing questions-v<N>.json.
 *
 * ALL-STRATA POOL (POOL_V3, from questions-v4 on; search-removal plan §4.2):
 *   --strata identifier,plain,terse,state,real   judge these strata (default: plain); an entry
 *                                                 may name one split: terse:holdout
 *   --index-picks <file>                          index-picks.js output; switches the pool to POOL_V3:
 *   Candidate pool per question = union of
 *     - the source lesson (questions with a lesson_id),
 *     - for a state question, its registry entry's provenance lessons (as the registry now stands),
 *     - the keyword layer's top 10 (search.js keyword_rank <= 10),
 *     - the fused top 10 (search.js rank <= 10),
 *     - the index picks: 3 ids a model chose for the question from the full routing index,
 *       blind to everything else (the router experiment's C arm; index-picks.js).
 *   No TF-IDF layer: the pool is what keyword-only, fused and an index-reading model can reach.
 *   Same judge prompt (judge-relevance-v1: it is not stratum-specific), same excerpt.
 *   Grades: identifier -> the identifier rule's set, plus every lesson the judge accepts (grade 1);
 *   plain, terse -> source 2, judge-accepted 1; state -> provenance lessons 2, judge-accepted 1;
 *   real (a real-invocation sample, no source) -> judge-accepted 1 (possibly none).
 *   Strata are judged in the order given, so a budget stop (claude-call.js) hits the last ones;
 *   the checkpoint resumes under a different --strata (judgments are per question), and the final
 *   file is written once every question of the requested strata is judged.
 *
 * APPEND-ONLY JUDGING (--append-judged <file>, search-removal plan §4.2 "after the holdout run"):
 *   node gen-relevance.js --from questions-v4.json --version 5 --append-judged seen.json [--append-tag T]
 *   seen.json: {"<qid>": [lesson ids], ...} -- lessons an agentic run relied on (read or cited).
 *   For each qid, the ids its verdicts do not already cover are judged (one call per question,
 *   the same judge prompt, model and excerpt as the source's relevance header -- refused if the
 *   judge model or prompt version differs), blind, in lesson-id order. Nothing already recorded
 *   changes: `relevant` stays the strict set (graded before the run); each touched question gains
 *   `relevance_basis.appended` (verdicts with their round) and `relevant_pooled` = strict (or the
 *   previous pooled set) plus every appended yes at grade 1. Report both scores.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const lib = require('./lib.js');
const G = require('./gen-questions.js');
const CC = require('./claude-call.js');
const I = require(path.join(lib.SCRIPTS_DIR, 'lib', 'identifiers.js'));

const IDENTIFIER_RULE_VERSION = 'identifier-rule-v1';
const JUDGE_PROMPT_VERSION = 'judge-relevance-v1';
const DEFAULT_JUDGE_MODEL = 'claude-fable-5-1';
// --setting-sources project: the empty cwd has no project settings, so this loads none; the
// user's settings (an advisor model, hooks) cannot join the judge call.
const JUDGE_FLAGS = ['--safe-mode', '--setting-sources', 'project', '--tools', ''];
const EXCERPT_CHARS = 1800;
const POOL_TOP = 10;
const SEARCH_DEPTH = 200; // search.js --top, deep enough to see every keyword/tfidf rank <= 10
const DEFAULT_CONCURRENCY = 4;
const MIN_TOKEN_LEN = 3;
const SEMANTIC_JS = path.join(lib.SCRIPTS_DIR, 'semantic-search.js');
const POOL_V2 = 'pool-v2';
const POOL_V3 = 'pool-v3';
const JUDGEABLE = ['identifier', 'plain', 'terse', 'state', 'real'];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    from: null, version: null, judgeModel: DEFAULT_JUDGE_MODEL, concurrency: DEFAULT_CONCURRENCY, dryRun: false, limit: Infinity, outDir: null,
    strata: ['plain'], indexPicks: null, appendJudged: null, appendTag: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') opts.from = argv[++i];
    else if (a === '--version') opts.version = parseInt(argv[++i], 10);
    else if (a === '--judge-model') opts.judgeModel = argv[++i];
    else if (a === '--concurrency') opts.concurrency = parseInt(argv[++i], 10);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10);
    else if (a === '--out-dir') opts.outDir = path.resolve(argv[++i]); // testing only
    else if (a === '--strata') opts.strata = argv[++i].split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--index-picks') opts.indexPicks = path.resolve(argv[++i]);
    else if (a === '--append-judged') opts.appendJudged = path.resolve(argv[++i]);
    else if (a === '--append-tag') opts.appendTag = argv[++i];
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { process.stderr.write(`ERROR: unknown argument "${a}"\n`); printUsage(); process.exit(1); }
  }
  const bad = opts.strata.map((s) => s.split(':')[0]).filter((s) => !JUDGEABLE.includes(s));
  if (bad.length) { process.stderr.write(`ERROR: cannot judge stratum ${bad.join(', ')} (judgeable: ${JUDGEABLE.join(', ')})\n`); process.exit(1); }
  return opts;
}

function printUsage() {
  process.stderr.write(
    'Usage: gen-relevance.js --from questions-v1.json --version 2 [--dry-run]\n' +
    '                        [--judge-model M] [--concurrency N] [--limit N]\n' +
    '                        [--strata identifier,plain,terse,state,real] [--index-picks <file>]\n' +
    '       gen-relevance.js --from questions-v4.json --version 5 --append-judged <qid->ids json>\n' +
    '                        [--append-tag T] [--concurrency N] [--dry-run]\n'
  );
}

// ---------------------------------------------------------------------------
// Identifier rule (pure)
// ---------------------------------------------------------------------------

/**
 * keyword_map -> Map(normalized key -> Set(lesson ids)), unioning keys that normalize alike.
 * `exclude`: keys to leave out (the vocabulary keys, see rule 3a).
 */
function buildKeyIndex(keywordMap, exclude = new Set()) {
  const idx = new Map();
  for (const [k, ids] of Object.entries(keywordMap || {})) {
    if (exclude.has(k)) continue;
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
    return JSON.parse(execFileSync('node', [script, query, '--json', `--top=${top}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
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

/**
 * The POOL_V3 pool from already-fetched inputs (pure): fused = search.js --json output,
 * extra = [{id, layer}] (source, provenance, index picks). Only ids in `known` (the corpus's
 * lesson ids) enter. Returns [{id, layers}] in lesson-id order.
 */
function poolV3From(fused, extra, known, top = POOL_TOP) {
  const layers = new Map();
  const add = (id, layer) => { if (!known.has(id)) return; if (!layers.has(id)) layers.set(id, new Set()); layers.get(id).add(layer); };
  fused.forEach((r, i) => {
    if (i < top) add(r.id, 'fused');
    if (r.keyword_rank !== null && r.keyword_rank !== undefined && r.keyword_rank <= top) add(r.id, 'keyword');
  });
  for (const e of extra) add(e.id, e.layer);
  return [...layers.entries()].sort((a, b) => a[0] - b[0]).map(([id, s]) => ({ id, layers: [...s].sort() }));
}

/** A --strata entry ("terse" or "terse:holdout") matches a question of that stratum (and split). */
function specMatches(spec, q) {
  const [stratum, split] = spec.split(':');
  return q.stratum === stratum && (!split || q.split === split);
}

/** Provenance lesson ids of a state question's registry entry (as the registry now stands). */
function provenanceOf(q, registryById) {
  const e = registryById.get(q.registry_id);
  return e && e.provenance ? [...new Set(e.provenance.map((p) => p.lesson))] : [];
}

function candidatePoolV3(q, ctx) {
  const fused = runJSON(lib.SEARCH_JS, q.text, SEARCH_DEPTH);
  const extra = [];
  if (q.lesson_id !== null && q.lesson_id !== undefined) extra.push({ id: q.lesson_id, layer: 'source' });
  if (q.stratum === 'state') for (const id of provenanceOf(q, ctx.registryById)) extra.push({ id, layer: 'provenance' });
  const picks = ctx.picks[q.qid];
  if (!picks) throw new Error(`${q.qid}: no index picks in ${ctx.picksFile}`);
  for (const id of picks) extra.push({ id, layer: 'index' });
  return poolV3From(fused, extra, ctx.known);
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

/** `claude -p --model <judge> JUDGE_FLAGS`, prompt on stdin from a file, empty cwd (claude-call.js). */
function callJudgeDefault(prompt, opts) {
  return CC.callJSON(prompt, { model: opts.judgeModel, flags: JUDGE_FLAGS, tag: 'gen-relevance-judge' });
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

/** Judge `todo` questions into state.judged with a pool of workers; a budget stop ends the run. */
async function judgeAll(todo, state, outPath, ctx) {
  let failures = 0;
  let budgetStop = null;
  await G.mapPool(todo, ctx.opts.concurrency, async (q) => {
    if (budgetStop) return;
    try {
      state.judged[q.qid] = await judgeQuestion(q.text, ctx.poolOf(q), ctx.lessonById, ctx.lessonTexts, ctx.callJudge, ctx.opts);
    } catch (err) {
      if (err instanceof CC.BudgetExceededError) { budgetStop = err.message; return; }
      failures++;
      process.stderr.write(`${q.qid}: judge failed: ${err.message.split('\n')[0]}\n`);
    }
    G.writePartial(outPath, state);
  });
  if (budgetStop) process.stderr.write(`stopped: ${budgetStop}\n`);
  return { failures, budgetStop };
}

/**
 * @param {object} opts  parseArgs() output
 * @param {{callJudge?: function, pools?: function}} deps  injectable judge + pool source (tests);
 *   pools(text, sourceId, question) -> [{id, layers}]
 */
async function generate(opts, deps = {}) {
  if (opts.appendJudged) return appendJudged(opts, deps);
  const callJudge = deps.callJudge || callJudgeDefault;
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
  const keyIndex = buildKeyIndex(topicIndex.keyword_map, new Set(topicIndex.lessons.flatMap((l) => l.vocab_keys || [])));
  const registryById = new Map(lib.loadRegistry().entries.map((e) => [e.id, e]));

  const strata = opts.strata || ['plain'];
  const poolMode = opts.indexPicks ? POOL_V3 : POOL_V2;
  let picksDoc = null;
  if (poolMode === POOL_V3) {
    const raw = fs.readFileSync(opts.indexPicks);
    picksDoc = { raw, data: JSON.parse(raw), file: path.basename(opts.indexPicks) };
  }
  const header = {
    from_sha256: sha256(fromRaw), version: opts.version, judge_model: opts.judgeModel,
    judge_prompt_version: JUDGE_PROMPT_VERSION, excerpt_chars: EXCERPT_CHARS, identifier_rule: IDENTIFIER_RULE_VERSION,
    ...(poolMode === POOL_V3 ? { pool: POOL_V3, index_picks_sha256: sha256(picksDoc.raw) } : {}),
  };
  let state;
  const pPath = G.partialPath(outPath);
  if (fs.existsSync(pPath)) {
    state = JSON.parse(fs.readFileSync(pPath, 'utf8'));
    const mismatch = Object.keys(header).filter((k) => (state.header || {})[k] !== header[k]);
    if (mismatch.length) throw new Error(`refusing to resume ${pPath}: header mismatch on [${mismatch.join(', ')}]. Delete it to start over.`);
  } else {
    state = { header, search_head: gitHead(), index_hashes: lib.indexHashes(), pools: {}, judged: {} };
  }

  // Questions to judge, in the order of --strata (a budget stop hits the last strata).
  const judgeSet = strata.flatMap((spec) => source.questions.filter((q) => specMatches(spec, q)));
  const ctxPool = {
    picks: picksDoc ? picksDoc.data.picks : {}, picksFile: picksDoc && picksDoc.file,
    known: new Set(lessonById.keys()), registryById,
  };
  const poolFor = deps.pools
    ? (q) => deps.pools(q.text, q.lesson_id, q)
    : (q) => (poolMode === POOL_V3 ? candidatePoolV3(q, ctxPool) : candidatePool(q.text, q.lesson_id));
  // Pools first, once, before any call; stored so a resume judges the same pool.
  let newPools = 0;
  for (const q of judgeSet) {
    if (state.pools[q.qid]) continue;
    state.pools[q.qid] = poolFor(q);
    newPools++;
  }
  if (newPools) {
    const now = lib.indexHashes();
    if (JSON.stringify(now) !== JSON.stringify(state.index_hashes || now)) {
      throw new Error(`topic-index.json or registry.json changed while pools were being built (${JSON.stringify(state.index_hashes)} -> ${JSON.stringify(now)}); delete ${pPath} and rerun`);
    }
    G.writePartial(outPath, state);
  }

  const todo = judgeSet.filter((q) => !state.judged[q.qid]);
  const poolSizes = judgeSet.map((q) => state.pools[q.qid].length);
  const estimate = {
    strata, pool: poolMode, questions: judgeSet.length, already_judged: judgeSet.length - todo.length, calls_needed: todo.length,
    mean_pool: poolSizes.reduce((a, b) => a + b, 0) / (poolSizes.length || 1), max_pool: Math.max(0, ...poolSizes),
  };
  process.stderr.write(`judge estimate: ${JSON.stringify(estimate)}\n`);
  if (opts.dryRun) {
    const q = todo[0] || judgeSet[0];
    if (q) {
      const cands = state.pools[q.qid].map((p, i) => ({ ...p, label: `C${i + 1}`, excerpt: excerptOf(lessonById.get(p.id), lessonTexts.get(p.id)) }));
      console.log(buildJudgePrompt(q.text, cands));
    }
    return { dryRun: true, estimate };
  }

  const batch = todo.slice(0, Number.isFinite(opts.limit) ? opts.limit : todo.length);
  const { failures, budgetStop } = await judgeAll(batch, state, outPath, {
    opts, callJudge, lessonById, lessonTexts, poolOf: (q) => state.pools[q.qid],
  });

  const remaining = judgeSet.filter((q) => !state.judged[q.qid]).length;
  if (remaining) {
    process.stderr.write(`${remaining} question(s) not judged yet (${failures} failed this run${budgetStop ? ', budget stop' : ''}); rerun to resume from ${pPath}\n`);
    return { complete: false, failures, remaining, budgetStop };
  }

  const inSpec = (q) => strata.some((spec) => specMatches(spec, q));
  const yesOf = (qid, exclude) => (state.judged[qid] || []).filter((v) => v.answers && !exclude.has(v.id)).map((v) => v.id);
  const questions = source.questions.map((q) => {
    if (q.stratum === 'identifier') {
      const { relevant, basis } = identifierRelevance(q.text, q.lesson_id, positions, keyIndex);
      if (!inSpec(q)) return { ...q, relevant, relevance_basis: { rule: IDENTIFIER_RULE_VERSION, ...basis } };
      const merged = { ...relevant };
      for (const id of yesOf(q.qid, new Set(Object.keys(relevant).map(Number)))) merged[id] = 1;
      return { ...q, relevant: merged, relevance_basis: { rule: IDENTIFIER_RULE_VERSION, ...basis, rule_relevant: relevant, judge: JUDGE_PROMPT_VERSION, verdicts: state.judged[q.qid] } };
    }
    if ((q.stratum === 'plain' || q.stratum === 'terse') && inSpec(q)) {
      const relevant = { [q.lesson_id]: 2 };
      for (const id of yesOf(q.qid, new Set([q.lesson_id]))) relevant[id] = 1;
      return { ...q, relevant, relevance_basis: { judge: JUDGE_PROMPT_VERSION, verdicts: state.judged[q.qid] } };
    }
    let out = q;
    if (q.stratum === 'state' && !('split_lesson_id' in q)) {
      const entry = registryById.get(q.registry_id);
      if (!entry) throw new Error(`${q.qid}: registry entry ${q.registry_id} not found; cannot record its split lesson`);
      out = { ...q, split_lesson_id: lib.stateSplitLessonId(entry) };
    }
    if (q.stratum === 'state' && inSpec(q)) {
      const prov = (state.pools[q.qid] || []).filter((p) => p.layers.includes('provenance')).map((p) => p.id);
      const relevant = {};
      for (const id of prov) relevant[id] = 2;
      for (const id of yesOf(q.qid, new Set(prov))) relevant[id] = 1;
      out = { ...out, relevant, relevance_basis: { judge: JUDGE_PROMPT_VERSION, provenance: prov, verdicts: state.judged[q.qid] } };
    }
    if (q.stratum === 'real' && inSpec(q)) {
      const relevant = {};
      for (const id of yesOf(q.qid, new Set())) relevant[id] = 1;
      out = { ...out, relevant, relevance_basis: { judge: JUDGE_PROMPT_VERSION, verdicts: state.judged[q.qid] } };
    }
    return out;
  });

  // The split rule (lib.applyHardTestRule): the source's random split, then every
  // lesson a hard ranking test asserts is moved to dev, and its questions relabelled.
  // A source without a split (a real-invocation sample) stays without one.
  const split = source.split ? lib.applyHardTestRule(source.split, lib.loadHardTestLessons()) : null;
  const splitSource = source.split_source ? { split_source: source.split_source } : {};
  const poolText = poolMode === POOL_V3
    ? `union of source lesson, state provenance lessons, keyword top ${POOL_TOP}, fused top ${POOL_TOP}, index picks (${picksDoc.file})`
    : `union of keyword top ${POOL_TOP}, TF-IDF top ${POOL_TOP} (semantic-search.js and search.js tfidf_rank), fused top ${POOL_TOP}, source lesson`;
  const output = {
    version: opts.version,
    seed: source.seed,
    model: source.model,
    prompt_version: source.prompt_version,
    generated_at: source.generated_at,
    ...(source.generation ? { generation: source.generation } : {}),
    derived_from: { version: source.version, file: path.basename(fromPath), sha256: header.from_sha256 },
    ...splitSource,
    relevance: {
      generated_at: new Date().toISOString(),
      search_head: state.search_head,
      ...(state.index_hashes ? { index_hashes: state.index_hashes } : {}),
      grades: { 2: 'source lesson (always)', 1: 'other acceptable lesson' },
      identifier_rule: IDENTIFIER_RULE_VERSION,
      judge: {
        model: opts.judgeModel, prompt_version: JUDGE_PROMPT_VERSION, date: new Date().toISOString().slice(0, 10),
        flags: JUDGE_FLAGS.map((f) => (f === '' ? '""' : f)).join(' '), excerpt_chars: EXCERPT_CHARS,
        pool: poolText,
        ...(poolMode === POOL_V3 ? {
          pool_version: POOL_V3, strata,
          index_picks: { file: picksDoc.file, sha256: header.index_picks_sha256, model: picksDoc.data.model, index_sha256: picksDoc.data.index_sha256, prompt_sha256: picksDoc.data.prompt_sha256 },
          grading: 'identifier: rule set + judge-accepted (1); plain/terse: source 2 + judge-accepted 1; state: provenance 2 + judge-accepted 1; real: judge-accepted 1',
        } : {}),
      },
      rules: 'see evals/retrieval/gen-relevance.js header',
    },
    split,
    // previous = the source's split, so a lesson the source had moved to dev and the
    // rule no longer moves (its hard test removed) sends its questions back to holdout.
    questions: split ? lib.relabelQuestions(questions, split, source.split) : questions,
    dropped: source.dropped || [],
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  fs.rmSync(pPath, { force: true });
  return { complete: true, output };
}

// ---------------------------------------------------------------------------
// Append-only judging (implemented; run only after an agentic run, never before)
// ---------------------------------------------------------------------------

/** Load --append-judged: {qid: [ids]} or {lessons: {qid: [ids]}}. */
function loadSeen(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const m = d && d.lessons && typeof d.lessons === 'object' ? d.lessons : d;
  const out = {};
  for (const [qid, ids] of Object.entries(m)) if (Array.isArray(ids)) out[qid] = [...new Set(ids.map(Number).filter(Number.isInteger))];
  return out;
}

/** Candidates a question still needs judged: ids in `seen` its recorded verdicts don't cover. */
function unjudgedFor(q, seenIds, known) {
  const b = q.relevance_basis || {};
  const covered = new Set([...(b.verdicts || []), ...(b.appended || [])].map((v) => v.id));
  if (q.relevant) for (const id of Object.keys(q.relevant)) covered.add(Number(id)); // rule / source grades count as graded
  return seenIds.filter((id) => known.has(id) && !covered.has(id)).sort((a, b) => a - b);
}

async function appendJudged(opts, deps = {}) {
  const callJudge = deps.callJudge || callJudgeDefault;
  if (!opts.from || !Number.isInteger(opts.version)) throw new Error('--from <judged questions file> and --version N are required');
  const fromPath = path.resolve(opts.from);
  const fromRaw = fs.readFileSync(fromPath);
  const source = JSON.parse(fromRaw);
  if (opts.version <= source.version) throw new Error(`--version ${opts.version} must be greater than the source's version ${source.version}`);
  const j = source.relevance && source.relevance.judge;
  if (!j) throw new Error(`${path.basename(fromPath)} has no relevance.judge header; append-only judging needs a judged set`);
  if (j.prompt_version !== JUDGE_PROMPT_VERSION) throw new Error(`judge prompt ${JUDGE_PROMPT_VERSION} differs from the source's ${j.prompt_version}`);
  if (opts.judgeModel !== j.model) {
    if (opts.judgeModel !== DEFAULT_JUDGE_MODEL) throw new Error(`--judge-model ${opts.judgeModel} differs from the source's judge ${j.model}; append-only judging uses the same judge`);
    opts = { ...opts, judgeModel: j.model }; // default: follow the source
  }
  if (j.excerpt_chars !== EXCERPT_CHARS) throw new Error(`excerpt size ${EXCERPT_CHARS} differs from the source's ${j.excerpt_chars}`);
  const outPath = path.join(opts.outDir || lib.EVALS_DIR, `questions-v${opts.version}.json`);
  if (fs.existsSync(outPath)) throw new Error(`${outPath} already exists — versions are immutable once written.`);

  const seenRaw = fs.readFileSync(opts.appendJudged);
  const seen = loadSeen(opts.appendJudged);
  const tag = opts.appendTag || path.basename(opts.appendJudged).replace(/\.json$/, '');
  const { lessonById, lessonTexts } = loadCorpus();
  const known = new Set(lessonById.keys());
  const byQid = new Map(source.questions.map((q) => [q.qid, q]));
  const unknownQids = Object.keys(seen).filter((qid) => !byQid.has(qid));
  if (unknownQids.length) throw new Error(`--append-judged names qids not in the source: ${unknownQids.slice(0, 5).join(', ')}${unknownQids.length > 5 ? ', ...' : ''}`);

  const header = { from_sha256: sha256(fromRaw), version: opts.version, judge_model: opts.judgeModel, judge_prompt_version: JUDGE_PROMPT_VERSION, excerpt_chars: EXCERPT_CHARS, seen_sha256: sha256(seenRaw), round: tag };
  const pPath = G.partialPath(outPath);
  let state;
  if (fs.existsSync(pPath)) {
    state = JSON.parse(fs.readFileSync(pPath, 'utf8'));
    const mismatch = Object.keys(header).filter((k) => (state.header || {})[k] !== header[k]);
    if (mismatch.length) throw new Error(`refusing to resume ${pPath}: header mismatch on [${mismatch.join(', ')}]. Delete it to start over.`);
  } else {
    state = { header, pools: {}, judged: {} };
    for (const [qid, ids] of Object.entries(seen)) {
      const cands = unjudgedFor(byQid.get(qid), ids, known);
      if (cands.length) state.pools[qid] = cands.map((id) => ({ id, layers: [`appended:${tag}`] }));
    }
    G.writePartial(outPath, state);
  }
  const todo = Object.keys(state.pools).filter((qid) => !state.judged[qid]).map((qid) => byQid.get(qid));
  const nCands = Object.values(state.pools).reduce((t, p) => t + p.length, 0);
  process.stderr.write(`append estimate: ${JSON.stringify({ round: tag, questions: Object.keys(state.pools).length, candidates: nCands, calls_needed: todo.length })}\n`);
  if (opts.dryRun) {
    const q = todo[0];
    if (q) console.log(buildJudgePrompt(q.text, state.pools[q.qid].map((p, i) => ({ ...p, label: `C${i + 1}`, excerpt: excerptOf(lessonById.get(p.id), lessonTexts.get(p.id)) }))));
    return { dryRun: true };
  }
  const { failures, budgetStop } = await judgeAll(todo, state, outPath, { opts, callJudge, lessonById, lessonTexts, poolOf: (q) => state.pools[q.qid] });
  const remaining = Object.keys(state.pools).filter((qid) => !state.judged[qid]).length;
  if (remaining) {
    process.stderr.write(`${remaining} question(s) not judged yet (${failures} failed${budgetStop ? ', budget stop' : ''}); rerun to resume from ${pPath}\n`);
    return { complete: false, failures, remaining, budgetStop };
  }
  const questions = source.questions.map((q) => {
    const v = state.judged[q.qid];
    if (!v) return q;
    const b = q.relevance_basis || {};
    const appended = [...(b.appended || []), ...v.map((x) => ({ ...x, round: tag }))];
    const pooled = { ...(q.relevant_pooled || q.relevant || {}) };
    for (const x of v) if (x.answers && !(x.id in pooled)) pooled[x.id] = 1;
    return { ...q, relevant_pooled: pooled, relevance_basis: { ...b, appended } };
  });
  const rounds = [...((source.relevance && source.relevance.appended) || []), {
    round: tag, date: new Date().toISOString().slice(0, 10), judge_model: opts.judgeModel, prompt_version: JUDGE_PROMPT_VERSION,
    seen_file: path.basename(opts.appendJudged), seen_sha256: header.seen_sha256, questions: Object.keys(state.pools).length, candidates: nCands,
    accepted: Object.values(state.judged).flat().filter((x) => x.answers).length,
  }];
  const output = {
    ...source,
    version: opts.version,
    derived_from: { version: source.version, file: path.basename(fromPath), sha256: header.from_sha256 },
    relevance: { ...source.relevance, appended: rounds, strict_vs_pooled: '`relevant` = graded before any agentic run (strict); `relevant_pooled` = strict plus append-only verdicts' },
    questions,
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
  IDENTIFIER_RULE_VERSION, JUDGE_PROMPT_VERSION, DEFAULT_JUDGE_MODEL, JUDGE_FLAGS, EXCERPT_CHARS, POOL_TOP, POOL_V2, POOL_V3,
  parseArgs, buildKeyIndex, buildPositions, questionTokens, identifierRelevance,
  poolFrom, poolV3From, candidatePool, candidatePoolV3, provenanceOf, specMatches, excerptOf, buildJudgePrompt, parseVerdicts, judgeQuestion, generate,
  appendJudged, loadSeen, unjudgedFor,
};

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`ERROR: ${err.message}\n`); process.exit(1); });
}
