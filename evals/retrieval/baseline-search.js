#!/usr/bin/env node
/**
 * baseline-search.js — keyword-only and full search.js scores on a judged question set, computed
 * with the search stack, as the comparison point for the agentic eval (agentic-run.js --baseline).
 *
 * Usage:
 *   node baseline-search.js --questions questions-v4.json --out baseline-v3-search.json
 *   node baseline-search.js --questions <real-invocation judged file> --out <scratch file>
 *
 * Deterministic, no model calls. For every question with a lesson answer set (identifier, plain,
 * terse, state, real) it spawns search.js --json --top=200 (lib.runSearch) and records:
 *   - keyword: results ordered by keyword_rank (the keyword layer alone), top 10;
 *   - search:  search.js's own order (keyword results, then TF-IDF-only ones), top 10;
 *   and for each, the first acceptable rank and hit@1/3/5 (any lesson with relevant[id] >= 1),
 *   plus src@3 (the source lesson in the top 3). "Only stop words" queries score as misses.
 * A question without `relevant` (a stratum or split left unjudged) falls back to its source
 * lesson alone ({lesson_id: 2}, relevance "source-only"), and each row counts those.
 * Rows: stratum x split, with Wilson 95% intervals. The file records the question set's sha256,
 * the git HEAD, topic-index/registry hashes (checked unchanged across the run) and search.js's
 * sha256; agentic-run.js --baseline pairs its results with these per question. Baselines written
 * before search.js lost its --fused option carry a `fused` arm (RRF order) in place of `search`.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const lib = require('./lib.js');
const { wilson, relevanceOf } = require('./agentic-run.js');

const DEPTH = 200;
const TOP = 10;
const STRATA = ['identifier', 'plain', 'terse', 'state', 'real'];

function parseArgs(argv) {
  const o = { questions: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--questions') o.questions = path.resolve(argv[++i]);
    else if (argv[i] === '--out') o.out = path.resolve(argv[++i]);
    else { process.stderr.write(`ERROR: unknown argument "${argv[i]}"\n`); process.exit(1); }
  }
  if (!o.questions || !o.out) { process.stderr.write('Usage: baseline-search.js --questions <file> --out <file>\n'); process.exit(1); }
  return o;
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Scores of one ranked id list against a relevance map (pure). */
function scoreList(ids, rel, src) {
  const i = ids.findIndex((id) => (rel[id] || 0) >= 1);
  const first = i === -1 ? null : i + 1;
  return { top10: ids.slice(0, TOP), first_acceptable_rank: first, hit1: first === 1, hit3: first !== null && first <= 3, hit5: first !== null && first <= 5, src3: src !== null && src !== undefined ? ids.slice(0, 3).includes(src) : null };
}

function rankedLists(text) {
  let res;
  try { res = lib.runSearch(text, { top: DEPTH }); } catch (err) {
    if (err.stopWordsOnly) return { search: [], keyword: [], stop_words_only: true };
    throw err;
  }
  const search = res.map((r) => r.id);
  const keyword = res.filter((r) => r.keyword_rank !== null && r.keyword_rank !== undefined).sort((a, b) => a.keyword_rank - b.keyword_rank).map((r) => r.id);
  return { search, keyword, stop_words_only: false };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (fs.existsSync(o.out)) throw new Error(`${o.out} already exists; baselines are immutable once written`);
  const raw = fs.readFileSync(o.questions);
  const doc = JSON.parse(raw);
  const before = lib.indexHashes();
  const qs = doc.questions.filter((q) => STRATA.includes(q.stratum));
  const out = [];
  for (const q of qs) {
    const { rel, basis } = relevanceOf(q);
    if (!rel) continue;
    const lists = rankedLists(q.text);
    out.push({
      qid: q.qid, stratum: q.stratum, split: q.split, relevance: basis, n_acceptable: Object.values(rel).filter((g) => g >= 1).length,
      stop_words_only: lists.stop_words_only,
      keyword: scoreList(lists.keyword, rel, q.lesson_id), search: scoreList(lists.search, rel, q.lesson_id),
    });
  }
  const after = lib.indexHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('topic-index.json or registry.json changed during the run; rerun');
  const groups = new Map();
  for (const r of out) { const k = `${r.stratum}|${r.split}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const rows = [...groups.entries()].sort().map(([k, rs]) => {
    const [stratum, split] = k.split('|');
    const n = rs.length;
    const cnt = (arm, f) => rs.filter((r) => r[arm][f]).length;
    const arm = (a) => ({ any1: { k: cnt(a, 'hit1'), ...wilson(cnt(a, 'hit1'), n) }, any3: { k: cnt(a, 'hit3'), ...wilson(cnt(a, 'hit3'), n) }, any5: { k: cnt(a, 'hit5'), ...wilson(cnt(a, 'hit5'), n) }, src3: rs[0].keyword.src3 === null ? null : { k: cnt(a, 'src3'), ...wilson(cnt(a, 'src3'), n) } });
    return { stratum, split, n, source_only_relevance: rs.filter((r) => r.relevance === 'source-only').length, stop_words_only: rs.filter((r) => r.stop_words_only).length, mean_acceptable: rs.reduce((t, r) => t + r.n_acceptable, 0) / n, keyword: arm('keyword'), search: arm('search') };
  });
  let head = null;
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: lib.REPO_ROOT, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const doc2 = {
    generated_at: new Date().toISOString(), questions_file: path.basename(o.questions), questions_sha256: sha256(raw), questions_version: doc.version,
    judge: doc.relevance && doc.relevance.judge ? { model: doc.relevance.judge.model, prompt_version: doc.relevance.judge.prompt_version, strata: doc.relevance.judge.strata || null } : null,
    search_head: head, index_hashes: before, search_js_sha256: sha256(fs.readFileSync(lib.SEARCH_JS)), depth: DEPTH,
    scoring: 'any@k = an acceptable lesson (relevant[id] >= 1) in the top k; keyword = the keyword layer alone (keyword_rank order); search = search.js order (keyword results, then TF-IDF-only); unjudged questions use the source lesson alone',
    rows, questions: out,
  };
  fs.writeFileSync(o.out, JSON.stringify(doc2, null, 1) + '\n');
  const pct = (x) => (x == null ? '  -  ' : (100 * x).toFixed(1).padStart(5));
  console.log('stratum     split     n   kw any@3 [95% CI]        search any@3 [95% CI]    srcOnly');
  for (const r of rows) console.log(`${r.stratum.padEnd(11)} ${r.split.padEnd(8)} ${String(r.n).padStart(3)}  ${pct(r.keyword.any3.p)} [${pct(r.keyword.any3.lo)},${pct(r.keyword.any3.hi)}]   ${pct(r.search.any3.p)} [${pct(r.search.any3.lo)},${pct(r.search.any3.hi)}]   ${r.source_only_relevance}`);
  console.log(`wrote ${o.out}`);
}

module.exports = { scoreList };

if (require.main === module) {
  try { main(); } catch (err) { process.stderr.write(`ERROR: ${err.message}\n`); process.exit(1); }
}
