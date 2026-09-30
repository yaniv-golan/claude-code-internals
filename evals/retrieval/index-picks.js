#!/usr/bin/env node
/**
 * index-picks.js — offline "index C" picks for the relevance pool.
 *
 * The offline router experiment's C arm (2026-09-30), unchanged in substance: the model sees the full routing index (one line per lesson) and a batch of
 * questions, and picks the 3 lesson ids most likely to hold each answer. It never sees the source
 * lesson, acceptable sets or search ranks. The picks only widen gen-relevance.js's judge pool
 * (--index-picks); they are not scored here.
 *
 * Usage:
 *   node index-picks.js --questions <file> --index <index.txt> --prompt <prompt.txt> --out <file>
 *                       [--strata plain,terse,...] [--model M] [--batch 10] [--concurrency 2]
 *                       [--limit-batches N] [--dry-run]
 *
 * Same as run-arm.js: questions grouped by stratum x split, sorted by qid, shuffled with
 * mulberry32 seed 1, batches of 10; the prompt template's `<index>` and `<questions>` slots
 * filled; a batch whose reply does not parse (or omits a qid) is retried once; picks are the
 * first 3 distinct ids that exist in the index. Differences: calls go through claude-call.js
 * (prompt on stdin from a file, empty temp cwd, cost ledger) with --setting-sources project
 * added, so the user's settings (e.g. an advisor model) cannot join the call; and the first
 * batch runs alone so the rest can read the index prefix from the prompt cache.
 *
 * Output (refuses to overwrite): {model, flags, index_sha256, prompt_sha256, questions_sha256,
 * batch, seed, picks: {qid: [ids]}, batches: [...raw picks, invalid ids, cost...]}. Progress is
 * checkpointed to <out>.partial (header-checked) so a rerun resumes.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CC = require('./claude-call.js');
const lib = require('./lib.js');
const G = require('./gen-questions.js');

const DEFAULT_MODEL = 'claude-sonnet-5';
const FLAGS = ['--safe-mode', '--setting-sources', 'project', '--tools', ''];
const SEED = 1;
const QUESTIONS_MARKER = '=== QUESTIONS ===';
const LAYOUT = 'system prompt file = template up to the QUESTIONS marker, index filled in (replaces the default system prompt); stdin = the marker and the batch questions';

function parseArgs(argv) {
  const o = { questions: null, index: null, prompt: null, out: null, strata: null, model: DEFAULT_MODEL, batch: 10, concurrency: 2, limitBatches: Infinity, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--questions') o.questions = path.resolve(argv[++i]);
    else if (a === '--index') o.index = path.resolve(argv[++i]);
    else if (a === '--prompt') o.prompt = path.resolve(argv[++i]);
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--strata') o.strata = argv[++i].split(',').filter(Boolean);
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--batch') o.batch = parseInt(argv[++i], 10);
    else if (a === '--concurrency') o.concurrency = parseInt(argv[++i], 10);
    else if (a === '--limit-batches') o.limitBatches = parseInt(argv[++i], 10);
    else if (a === '--dry-run') o.dryRun = true;
    else { process.stderr.write(`ERROR: unknown argument "${a}"\n`); process.exit(1); }
  }
  for (const k of ['questions', 'index', 'prompt', 'out']) if (!o[k]) { process.stderr.write(`ERROR: --${k} is required\n`); process.exit(1); }
  return o;
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const qText = (q) => q.text.replace(/\s+/g, ' ').trim();

/** Index lines are `id | title | ...`; the set of ids they carry. */
function indexIds(indexText) {
  const ids = new Set();
  for (const line of indexText.split('\n')) { const m = line.match(/^(\d+)\s*\|/); if (m) ids.add(Number(m[1])); }
  return ids;
}

/** run-arm.js parsePicks (arm C). Returns {picks: {qid: {raw, valid, invalid}}, missing} or null. */
function parsePicks(text, qids, validIds) {
  if (!text) return null;
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  let obj;
  try { obj = JSON.parse(text.slice(s, e + 1)); } catch { return null; }
  const picks = {};
  let missing = 0;
  const num = (x) => Number(String(x).replace(/[^0-9]/g, ''));
  for (const qid of qids) {
    const raw = obj[qid];
    if (!Array.isArray(raw)) { missing++; picks[qid] = { raw: raw === undefined ? null : raw, valid: [], invalid: [] }; continue; }
    const valid = [];
    for (const x of raw) { const n = num(x); if (validIds.has(n) && !valid.includes(n)) valid.push(n); }
    picks[qid] = { raw, valid: valid.slice(0, 3), invalid: raw.filter((x) => !validIds.has(num(x))) };
  }
  return { picks, missing };
}

/** Batches as run-arm.js builds them: per stratum x split, qid-sorted, seeded shuffle, fixed size. */
function makeBatches(questions, batchSize) {
  const groups = new Map();
  for (const q of questions) {
    const k = `${q.stratum}|${q.split || '-'}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(q);
  }
  const batches = [];
  for (const k of [...groups.keys()].sort()) {
    const sorted = groups.get(k).sort((a, b) => a.qid.localeCompare(b.qid));
    const shuffled = lib.seededShuffle(sorted, lib.mulberry32(SEED));
    for (let i = 0; i < shuffled.length; i += batchSize) batches.push({ group: k, qids: shuffled.slice(i, i + batchSize).map((q) => q.qid) });
  }
  return batches;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (fs.existsSync(o.out)) throw new Error(`${o.out} already exists; picks files are immutable once written`);
  const qRaw = fs.readFileSync(o.questions);
  const qs = JSON.parse(qRaw).questions.filter((q) => (!o.strata || o.strata.includes(q.stratum)) && q.stratum !== 'negative');
  const byQid = new Map(qs.map((q) => [q.qid, q]));
  const indexText = fs.readFileSync(o.index, 'utf8');
  const template = fs.readFileSync(o.prompt, 'utf8');
  const validIds = indexIds(indexText);
  const header = { model: o.model, flags: FLAGS.map((f) => (f === '' ? '""' : f)).join(' '), index_sha256: sha256(indexText), prompt_sha256: sha256(template), questions_sha256: sha256(qRaw), batch: o.batch, seed: SEED, strata: o.strata, layout: LAYOUT };
  const batches = makeBatches(qs, o.batch).slice(0, o.limitBatches);
  // Layout: the template up to its QUESTIONS marker (instructions + index) is the system prompt
  // (--system-prompt-file, replacing Claude Code's default), so every batch after the first reads
  // it from the prompt cache; the marker and the batch's questions are the user message (stdin).
  const cut = template.indexOf(QUESTIONS_MARKER);
  if (cut < 0) throw new Error(`prompt template has no "${QUESTIONS_MARKER}" marker`);
  const system = template.slice(0, cut).replace('<index>', indexText).trimEnd() + '\n';
  const build = (b) => template.slice(cut).replace('<questions>', b.qids.map((id) => `${id}: ${qText(byQid.get(id))}`).join('\n'));
  if (o.dryRun) {
    console.log(`${qs.length} questions, ${batches.length} batches, index ${validIds.size} ids`);
    if (batches[0]) console.log(system.slice(0, 700) + '\n[...]\n' + system.slice(-300) + '\n---- stdin ----\n' + build(batches[0]));
    return;
  }
  const pPath = o.out + '.partial';
  let state = { header, done: {} };
  if (fs.existsSync(pPath)) {
    state = JSON.parse(fs.readFileSync(pPath, 'utf8'));
    const mm = Object.keys(header).filter((k) => JSON.stringify(state.header[k]) !== JSON.stringify(header[k]));
    if (mm.length) throw new Error(`refusing to resume ${pPath}: header mismatch on [${mm.join(', ')}]`);
  }
  const key = (b) => `${b.group}|${b.qids[0]}`;
  const todo = batches.filter((b) => !state.done[key(b)]);
  let budgetHit = false;
  async function runBatch(b) {
    const calls = [];
    let parsed = null;
    for (let attempt = 0; attempt < 2 && !budgetHit; attempt++) {
      let raw;
      try { raw = await CC.callJSON(build(b), { model: o.model, flags: FLAGS, tag: 'index-picks', systemPrompt: system }); } catch (err) {
        if (err instanceof CC.BudgetExceededError) { budgetHit = true; process.stderr.write(`${err.message}\n`); return; }
        calls.push({ attempt, error: err.message.slice(0, 200) });
        continue;
      }
      const env = JSON.parse(raw);
      calls.push({ attempt, cost: env.total_cost_usd || 0, ...CC.usageOf(env) });
      parsed = parsePicks(env.result, b.qids, validIds);
      if (parsed && parsed.missing === 0) break;
    }
    if (!parsed) { process.stderr.write(`batch ${key(b)}: no parse after retries\n`); return; }
    state.done[key(b)] = { ...b, picks: parsed.picks, missing: parsed.missing, calls };
    G.writePartial(o.out, state);
  }
  if (todo.length) await runBatch(todo[0]); // alone first: warms the prompt cache for the index prefix
  await G.mapPool(todo.slice(1), o.concurrency, runBatch);
  const left = batches.filter((b) => !state.done[key(b)]);
  if (left.length) { process.stderr.write(`${left.length} batch(es) not done; rerun to resume from ${pPath}\n`); process.exitCode = 1; return; }
  const picks = {};
  for (const d of Object.values(state.done)) for (const [qid, p] of Object.entries(d.picks)) picks[qid] = p.valid;
  const cost = Object.values(state.done).flatMap((d) => d.calls).reduce((t, c) => t + (c.cost || 0), 0);
  const out = { ...header, generated_at: new Date().toISOString(), questions_file: path.basename(o.questions), index_file: path.basename(o.index), prompt_file: path.basename(o.prompt), inputs_note: 'the index and prompt of the 2026-09-30 router experiment (C arm), identified by sha256', n_questions: Object.keys(picks).length, cost_usd: cost, picks, batches: Object.values(state.done) };
  fs.writeFileSync(o.out, JSON.stringify(out, null, 1) + '\n');
  fs.rmSync(pPath, { force: true });
  console.log(`wrote ${o.out}: ${out.n_questions} questions, $${cost.toFixed(2)}`);
}

module.exports = { parsePicks, makeBatches, indexIds };

if (require.main === module) main().catch((e) => { process.stderr.write(`ERROR: ${e.message}\n`); process.exit(1); });
