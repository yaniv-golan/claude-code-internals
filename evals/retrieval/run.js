#!/usr/bin/env node
/**
 * run.js — score questions-vN.json against the live search.js / state.js.
 *
 * Loads a versioned question set (latest questions-v*.json by default) and
 * the registry-top1.json baseline, runs each question through search.js
 * (spawned, --top=20 so "falls out of top 10" and "drops more than k ranks"
 * are both decidable from one call), and reports MRR + nDCG@5 per stratum x
 * split, plus a negatives score distribution and a state-question report.
 *
 * State-question scoring (a documented choice, not a limitation worked
 * around silently): state.js's own `lookup()` is a case-insensitive
 * SUBSTRING match against an entry's name/id/renamed_to (see scripts/state.js
 * `lookup()`). A generated plain-language question is a sentence, not a
 * name or id, so calling `lookup(refsDir, questionText)` directly almost
 * never matches anything -- it would silently report near-zero "exact match"
 * coverage that reflects the API's input shape, not retrieval quality. So:
 *   - "search coverage": does search.js's top-5 for the question include ANY
 *     of the registry entry's provenance lessons? This is the same rank/MRR/
 *     nDCG machinery as the lesson strata, with the caveat flagged in
 *     §4.6a("historical provenance lessons are never labeled relevant") --
 *     provenance CAN include a corrected/superseded lesson (see registry.json
 *     comments), so a state-question "hit" here is looser than a lesson
 *     stratum hit and is reported as its own stratum, never merged with them.
 *   - "state.js exact-match availability": reported SEPARATELY as whether
 *     `lookup(refsDir, entry.name)` (the entry's OWN name, not the generated
 *     question) finds that entry -- i.e. whether the state layer's own
 *     lookup path is reachable for this record at all, independent of
 *     whether a generated natural-language question could ever reach it.
 *
 * Negatives: search.js's rrf_score is RANK-derived (1/(60+rank) per layer,
 * summed), not a similarity/confidence score -- any single-layer hit lands
 * near 0.0164 (1/61) and any double-layer top-1 hit lands near 0.0328
 * regardless of how relevant the match actually is. So there is no
 * "similarity threshold" in this number worth gating on; a discriminating
 * negative-rejection score would need the raw TF-IDF cosine, which
 * `search.js --json` does not expose (see semantic-search.js internals) --
 * extending search.js is out of scope here (open decision, see README).
 * This script instead records, per negative question: whether search.js
 * returned anything at all, its top rrf_score, confidence label and which
 * layer(s) hit, and reports the DISTRIBUTION of those — not a pass/fail.
 *
 * Usage:
 *   node run.js [--questions <file>] [--top 20]
 *   node run.js --save <report.json>
 *   node run.js --baseline <report.json> [--mrr-threshold 0.02] [--rank-drop-k 3]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib.js');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { top: 20, questions: null, save: null, baseline: null, mrrThreshold: 0.02, rankDropK: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--questions') opts.questions = argv[++i];
    else if (a === '--top') opts.top = parseInt(argv[++i], 10);
    else if (a === '--save') opts.save = argv[++i];
    else if (a === '--baseline') opts.baseline = argv[++i];
    else if (a === '--mrr-threshold') opts.mrrThreshold = parseFloat(argv[++i]);
    else if (a === '--rank-drop-k') opts.rankDropK = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { process.stderr.write(`ERROR: unknown argument "${a}"\n`); printUsage(); process.exit(1); }
  }
  return opts;
}

function printUsage() {
  process.stderr.write(
    'Usage: run.js [--questions <file>] [--top N] [--save <report.json>]\n' +
    '              [--baseline <report.json>] [--mrr-threshold F] [--rank-drop-k N]\n'
  );
}

/** Latest questions-v<N>.json in evals/retrieval/ by numeric N, or null. */
function findLatestQuestions() {
  const files = fs.readdirSync(lib.EVALS_DIR).filter(f => /^questions-v(\d+)\.json$/.test(f));
  if (!files.length) return null;
  files.sort((a, b) => {
    const na = parseInt(a.match(/^questions-v(\d+)\.json$/)[1], 10);
    const nb = parseInt(b.match(/^questions-v(\d+)\.json$/)[1], 10);
    return nb - na;
  });
  return path.join(lib.EVALS_DIR, files[0]);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score one lesson-stratum question (identifier or plain): rank of the
 * expected lesson id within search.js's top-`top` results.
 */
function scoreLessonQuestion(q, top) {
  let results = [];
  let error = null;
  try {
    results = lib.runSearch(q.text, { top });
  } catch (err) {
    error = err.stopWordsOnly ? 'stop-words-only' : err.message;
  }
  const rank = lib.rankOf(q.lesson_id, results);
  return {
    qid: q.qid, stratum: q.stratum, split: q.split, lesson_id: q.lesson_id,
    rank, rr: lib.reciprocalRank(rank), ndcg5: lib.ndcgAt5(rank),
    error,
  };
}

/**
 * Score a state question two ways (see file header comment): search-coverage
 * against ANY provenance lesson of the registry entry, and a separate,
 * unrelated report of whether state.js's lookup() can find the entry BY ITS
 * OWN NAME (reachability of the state layer's own lookup path).
 */
function scoreStateQuestion(q, top, registry, stateLookup) {
  const entry = registry.entries.find(e => e.id === q.registry_id);
  let results = [];
  let error = null;
  try {
    results = lib.runSearch(q.text, { top });
  } catch (err) {
    error = err.stopWordsOnly ? 'stop-words-only' : err.message;
  }
  const provenanceLessons = entry ? entry.provenance.map(p => p.lesson) : [];
  let bestRank = null;
  for (const lessonId of provenanceLessons) {
    const r = lib.rankOf(lessonId, results);
    if (r !== null && (bestRank === null || r < bestRank)) bestRank = r;
  }
  let exactMatchByName = false;
  if (entry) {
    try {
      const r = stateLookup(lib.REFS_DIR, entry.name);
      exactMatchByName = r.entries.some(e => e.id === entry.id);
    } catch (err) { /* leave false */ }
  }
  return {
    qid: q.qid, stratum: q.stratum, split: q.split, registry_id: q.registry_id,
    rank: bestRank, rr: lib.reciprocalRank(bestRank), ndcg5: lib.ndcgAt5(bestRank),
    state_exact_match_by_name: exactMatchByName,
    error,
  };
}

/** Negatives: no expected id. Record whether anything hit and the top result's
 * score/confidence/layers, for distribution reporting (not pass/fail). */
function scoreNegativeQuestion(q, top) {
  let results = [];
  let error = null;
  try {
    results = lib.runSearch(q.text, { top });
  } catch (err) {
    error = err.stopWordsOnly ? 'stop-words-only' : err.message;
  }
  const topHit = results[0] || null;
  return {
    qid: q.qid, stratum: q.stratum, split: q.split,
    has_hit: !!topHit,
    top_rrf_score: topHit ? topHit.rrf_score : null,
    top_confidence: topHit ? topHit.confidence : null,
    top_layers: topHit ? topHit.layers : null,
    error,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

/** Aggregate MRR/nDCG@5 per (stratum, split) for the lesson-shaped strata
 * (identifier, plain, state — all have a `rr`/`ndcg5` field). */
function aggregateByStratumSplit(scored) {
  const groups = new Map(); // "stratum|split" -> scored[]
  for (const s of scored) {
    const key = `${s.stratum}|${s.split}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const out = {};
  for (const [key, items] of groups) {
    out[key] = {
      n: items.length,
      mrr: mean(items.map(i => i.rr)),
      ndcg5: mean(items.map(i => i.ndcg5)),
    };
  }
  return out;
}

function summarizeNegatives(scored) {
  const scores = scored.filter(s => s.top_rrf_score !== null).map(s => s.top_rrf_score);
  const sorted = [...scores].sort((a, b) => a - b);
  const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
  const confCounts = {};
  for (const s of scored) {
    const c = s.top_confidence || 'NONE';
    confCounts[c] = (confCounts[c] || 0) + 1;
  }
  return {
    n: scored.length,
    n_with_hit: scored.filter(s => s.has_hit).length,
    score_min: sorted.length ? sorted[0] : null,
    score_max: sorted.length ? sorted[sorted.length - 1] : null,
    score_mean: mean(scores),
    score_p50: pct(0.5),
    score_p90: pct(0.9),
    confidence_distribution: confCounts,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function buildReport(questionsData, opts) {
  const registry = lib.loadRegistry();
  const { lookup } = require(lib.STATE_JS);

  const lessonQs = questionsData.questions.filter(q => q.stratum === 'identifier' || q.stratum === 'plain');
  const stateQs = questionsData.questions.filter(q => q.stratum === 'state');
  const negQs = questionsData.questions.filter(q => q.stratum === 'negative');

  const lessonScored = lessonQs.map(q => scoreLessonQuestion(q, opts.top));
  const stateScored = stateQs.map(q => scoreStateQuestion(q, opts.top, registry, lookup));
  const negScored = negQs.map(q => scoreNegativeQuestion(q, opts.top));

  const byStratumSplit = aggregateByStratumSplit([...lessonScored, ...stateScored]);
  const negatives = summarizeNegatives(negScored);
  const stateReachability = {
    n: stateScored.length,
    n_reachable_by_name: stateScored.filter(s => s.state_exact_match_by_name).length,
  };

  return {
    generated_at: new Date().toISOString(),
    questions_source: questionsData.version !== undefined ? { version: questionsData.version, seed: questionsData.seed, model: questionsData.model } : null,
    top: opts.top,
    by_stratum_split: byStratumSplit,
    negatives,
    state_reachability: stateReachability,
    queries: {
      lesson: lessonScored,
      state: stateScored,
      negative: negScored,
    },
  };
}

// ---------------------------------------------------------------------------
// Baseline comparison
// ---------------------------------------------------------------------------

/**
 * Compare a fresh report against a saved baseline report. Returns
 * {ok, failures: string[]}. Fails on: any per-stratum×split MRR or nDCG@5
 * drop beyond `mrrThreshold`; any single lesson/state query whose rank
 * worsens by more than `rankDropK` ranks, or that falls out of the top 10
 * when it was previously in it (or was found and is now not found at all).
 * Only the GATED_STRATA are compared. State questions are reported, not gated:
 * state.js cannot resolve a free-text question, and scoring them against
 * provenance lessons would count historical lessons as correct answers.
 * Negatives are reported, never gated (see file header).
 */
const GATED_STRATA = new Set(['identifier', 'plain']);
function compareToBaseline(report, baseline, opts) {
  const failures = [];

  for (const key of new Set([...Object.keys(report.by_stratum_split), ...Object.keys(baseline.by_stratum_split)])) {
    const cur = report.by_stratum_split[key];
    const base = baseline.by_stratum_split[key];
    if (!cur || !base) continue; // stratum/split only in one report — not a regression to score here
    if (!GATED_STRATA.has(key.split('|')[0])) continue;
    if (base.mrr - cur.mrr > opts.mrrThreshold) {
      failures.push(`[${key}] MRR dropped ${base.mrr.toFixed(4)} -> ${cur.mrr.toFixed(4)} (> ${opts.mrrThreshold})`);
    }
    if (base.ndcg5 - cur.ndcg5 > opts.mrrThreshold) {
      failures.push(`[${key}] nDCG@5 dropped ${base.ndcg5.toFixed(4)} -> ${cur.ndcg5.toFixed(4)} (> ${opts.mrrThreshold})`);
    }
  }

  const baseById = new Map();
  for (const q of baseline.queries.lesson) baseById.set(q.qid, q);
  for (const q of report.queries.lesson) {
    if (!GATED_STRATA.has(q.stratum)) continue;
    const b = baseById.get(q.qid);
    if (!b) continue; // new query, no baseline to compare
    const oldRank = b.rank;
    const newRank = q.rank;
    if (oldRank === null && newRank === null) continue;
    if (oldRank !== null && newRank === null) {
      failures.push(`[${q.qid}] "${q.stratum}" was found at rank ${oldRank}, now not found in top ${report.top}`);
      continue;
    }
    if (oldRank !== null && newRank !== null) {
      const drop = newRank - oldRank;
      if (drop > opts.rankDropK) {
        failures.push(`[${q.qid}] "${q.stratum}" rank dropped ${oldRank} -> ${newRank} (> ${opts.rankDropK} ranks)`);
      }
      if (oldRank <= 10 && newRank > 10) {
        failures.push(`[${q.qid}] "${q.stratum}" fell out of top 10 (${oldRank} -> ${newRank})`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Human table
// ---------------------------------------------------------------------------

function printHumanTable(report) {
  console.log('\nRetrieval report');
  console.log('='.repeat(60));
  console.log(`generated_at: ${report.generated_at}`);
  if (report.questions_source) {
    console.log(`questions: v${report.questions_source.version} (seed ${report.questions_source.seed}, model ${report.questions_source.model})`);
  }
  console.log('\nBy stratum x split:');
  console.log('  stratum        split     n     MRR      nDCG@5');
  for (const [key, agg] of Object.entries(report.by_stratum_split)) {
    const [stratum, split] = key.split('|');
    console.log(`  ${stratum.padEnd(14)} ${split.padEnd(9)} ${String(agg.n).padStart(3)}   ${agg.mrr.toFixed(4)}   ${agg.ndcg5.toFixed(4)}`);
  }
  console.log('\nState-layer lookup() reachability by entry name (informational, not gated):');
  console.log(`  ${report.state_reachability.n_reachable_by_name}/${report.state_reachability.n} sampled registry entries are found by state.js lookup() on their own name`);
  console.log('\nNegatives (reported, not gated — see run.js header comment on rrf_score):');
  const n = report.negatives;
  console.log(`  n=${n.n}, with a hit: ${n.n_with_hit}`);
  console.log(`  top rrf_score: min=${n.score_min} p50=${n.score_p50} p90=${n.score_p90} max=${n.score_max} mean=${n.score_mean.toFixed(4)}`);
  console.log(`  confidence distribution: ${JSON.stringify(n.confidence_distribution)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const questionsPath = opts.questions ? path.resolve(opts.questions) : findLatestQuestions();
  if (!questionsPath || !fs.existsSync(questionsPath)) {
    process.stderr.write('ERROR: no questions-vN.json found (pass --questions <file>, or run gen-questions.js first).\n');
    process.exit(1);
  }
  const questionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

  const report = buildReport(questionsData, opts);
  report.top = opts.top; // ensure present even if buildReport's local shadow changes
  printHumanTable(report);

  if (opts.save) {
    fs.writeFileSync(path.resolve(opts.save), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nSaved report to ${opts.save}`);
  }

  if (opts.baseline) {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(opts.baseline), 'utf8'));
    const cmp = compareToBaseline(report, baseline, opts);
    console.log('\nBaseline comparison:');
    if (cmp.ok) {
      console.log('  OK — no regressions beyond threshold.');
    } else {
      console.log(`  ${cmp.failures.length} regression(s):`);
      for (const f of cmp.failures) console.log(`    ${f}`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  parseArgs, findLatestQuestions, scoreLessonQuestion, scoreStateQuestion, scoreNegativeQuestion,
  aggregateByStratumSplit, summarizeNegatives, buildReport, compareToBaseline,
};

if (require.main === module) main();
