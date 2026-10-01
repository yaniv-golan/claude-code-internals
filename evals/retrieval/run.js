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
 *     nDCG machinery as the lesson strata, with the caveat that historical
 *     provenance lessons are never labeled relevant --
 *     provenance CAN include a corrected/superseded lesson (see registry.json
 *     comments), so a state-question "hit" here is looser than a lesson
 *     stratum hit and is reported as its own stratum, never merged with them.
 *   - "state.js exact-match availability": reported SEPARATELY as whether
 *     `lookup(refsDir, entry.name)` (the entry's OWN name, not the generated
 *     question) finds that entry -- i.e. whether the state layer's own
 *     lookup path is reachable for this record at all, independent of
 *     whether a generated natural-language question could ever reach it.
 *
 * Negatives: search.js has no similarity threshold, so a negative question
 * almost always gets results. This script records, per negative question:
 * whether search.js returned anything at all, the best raw TF-IDF cosine among
 * its results (`tfidf_score` in --json; 0 when only the keyword layer hit), the
 * top result's confidence label and which layer(s) hit, and reports the
 * DISTRIBUTION of those — not a pass/fail.
 *
 * Acceptable-answer sets (questions-v2+, made by gen-relevance.js): a question
 * that carries `relevant: {lessonId: grade}` (2 = source lesson, 1 = other
 * acceptable lesson) is scored by the FIRST acceptable lesson: its rank drives
 * MRR and every per-question rule below, so the identifier top-1 rule reads
 * "an acceptable lesson is first". nDCG@5 is graded with linear gain (gain =
 * grade; with the source alone it equals the binary value). Such a report also
 * records per question `rank_source`, `n_acceptable` and `top1` (source /
 * other_acceptable / none), a per stratum x split `top1_breakdown`, a
 * `relevance` marker and an (empty) `waivers` list. A question WITHOUT
 * `relevant` (questions-v1) is scored exactly as before, and a v1 report has
 * none of those keys. Every report records its questions file's lesson split as
 * `questions_source.split_sha256` (lib.splitHash), v1 included.
 *
 * Usage:
 *   node run.js [--questions <file>] [--top 20]
 *   node run.js --save <report.json>
 *   node run.js --baseline <report.json> [--mrr-threshold F] [--rank-drop-k N] [--top-k-floor N]
 *
 * Gate thresholds live IN the baseline file (`thresholds`), so the numbers a
 * baseline was accepted under travel with it. A CLI flag overrides one for a
 * single run, and every run prints each value's source. `--save` embeds the
 * thresholds that were in effect.
 *
 * Per-question rules (rank drop, top-k floor, found -> not found, identifier
 * top-1) gate DEV questions only; on a holdout question they are printed as
 * reported, never failed. The per stratum x split aggregates gate both splits.
 *
 * The gate never passes vacuously: it fails when the questions file is
 * missing or has no gated questions, when the report's question-set version
 * or lesson split differs from the baseline's, when a gated stratum x split or a gated
 * question in the baseline is missing from the report, and on any
 * identifier question that was top-1 and no longer is.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib.js');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

/** Used only when neither the baseline nor the command line sets a threshold. */
const DEFAULT_THRESHOLDS = Object.freeze({
  mrr_ndcg_drop: 0.02,          // max per-stratum x split drop in MRR or nDCG@5
  rank_drop_k: 3,               // max ranks a single gated question may lose
  top_k_floor: 10,              // a question in the top N must stay in it
  identifier_top1_loss: true,   // an identifier question at rank 1 must stay at rank 1
});

function parseArgs(argv) {
  // Threshold flags stay undefined unless given, so the baseline's own values apply.
  const opts = { top: 20, questions: null, save: null, baseline: null, mrrThreshold: undefined, rankDropK: undefined, topKFloor: undefined };
  const num = (flag, v, parse) => {
    const n = parse(v);
    if (!Number.isFinite(n)) { process.stderr.write(`ERROR: ${flag} needs a number, got "${v}"\n`); process.exit(1); }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--questions') opts.questions = argv[++i];
    else if (a === '--top') opts.top = parseInt(argv[++i], 10);
    else if (a === '--save') opts.save = argv[++i];
    else if (a === '--baseline') opts.baseline = argv[++i];
    else if (a === '--mrr-threshold') opts.mrrThreshold = num(a, argv[++i], parseFloat);
    else if (a === '--rank-drop-k') opts.rankDropK = num(a, argv[++i], (v) => parseInt(v, 10));
    else if (a === '--top-k-floor') opts.topKFloor = num(a, argv[++i], (v) => parseInt(v, 10));
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { process.stderr.write(`ERROR: unknown argument "${a}"\n`); printUsage(); process.exit(1); }
  }
  return opts;
}

function printUsage() {
  process.stderr.write(
    'Usage: run.js [--questions <file>] [--top N] [--save <report.json>]\n' +
    '              [--baseline <report.json>] [--mrr-threshold F] [--rank-drop-k N] [--top-k-floor N]\n'
  );
}

/**
 * Resolve the gate thresholds: CLI flag, else the baseline's `thresholds`,
 * else DEFAULT_THRESHOLDS. Returns { thresholds, sources } (source per key:
 * "cli", "baseline" or "default").
 */
function resolveThresholds(opts, baseline) {
  const fromBaseline = (baseline && baseline.thresholds) || {};
  const cli = { mrr_ndcg_drop: opts.mrrThreshold, rank_drop_k: opts.rankDropK, top_k_floor: opts.topKFloor };
  const thresholds = {};
  const sources = {};
  for (const k of Object.keys(DEFAULT_THRESHOLDS)) {
    if (cli[k] !== undefined) { thresholds[k] = cli[k]; sources[k] = 'cli'; }
    else if (fromBaseline[k] !== undefined) { thresholds[k] = fromBaseline[k]; sources[k] = 'baseline'; }
    else { thresholds[k] = DEFAULT_THRESHOLDS[k]; sources[k] = 'default'; }
  }
  return { thresholds, sources };
}

const GATED_STRATA = new Set(['identifier', 'plain']);
const countGated = (questionsData) => (questionsData.questions || []).filter((q) => GATED_STRATA.has(q.stratum)).length;

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
  if (q.relevant) return scoreWithRelevant(q, results, error);
  const rank = lib.rankOf(q.lesson_id, results);
  return {
    qid: q.qid, stratum: q.stratum, split: q.split, lesson_id: q.lesson_id,
    rank, rr: lib.reciprocalRank(rank), ndcg5: lib.ndcgAt5(rank),
    error,
  };
}

/**
 * Acceptable-answer scoring (questions-v2+, a question carrying `relevant`):
 * `rank` = rank of the FIRST acceptable lesson (so MRR and every rank rule in
 * compareToBaseline, including "an identifier question at rank 1 stays at
 * rank 1", read "an acceptable lesson is first"); nDCG@5 is graded
 * (lib.gradedNdcgAt5, linear gain = grade). `rank_source` keeps the source
 * lesson's own rank, and `top1` says whether the first result is the source
 * lesson, another acceptable one, or neither.
 */
function scoreWithRelevant(q, results, error) {
  const rank = lib.firstAcceptableRank(results, q.relevant);
  const first = results[0];
  let top1 = 'none';
  if (first && first.id === q.lesson_id) top1 = 'source';
  else if (first && (q.relevant[first.id] || 0) > 0) top1 = 'other_acceptable';
  return {
    qid: q.qid, stratum: q.stratum, split: q.split, lesson_id: q.lesson_id,
    rank, rr: lib.reciprocalRank(rank), ndcg5: lib.gradedNdcgAt5(results, q.relevant),
    rank_source: lib.rankOf(q.lesson_id, results),
    n_acceptable: Object.keys(q.relevant).length,
    top1,
    margin1: rank === 1 ? rankOneMargin(results, q.relevant) : null,
    error,
  };
}

/**
 * How far an acceptable lesson at rank 1 leads: its keyword score minus the
 * keyword score of the best-ranked lesson that is NOT acceptable (only a
 * non-acceptable lesson overtaking it changes the question's rank). null when
 * either has no keyword score (a TF-IDF-tail result) or nothing else ranks.
 * Reported only (driftReport's "fragile" list); never gated.
 */
function rankOneMargin(results, relevant) {
  const lead = results[0];
  const rival = results.find((r) => !((relevant[r.id] || 0) > 0));
  if (!lead || !rival || typeof lead.keyword_score !== 'number' || typeof rival.keyword_score !== 'number') return null;
  if (!(rival.keyword_score > 0)) return null;
  return Math.round((lead.keyword_score - rival.keyword_score) * 1e4) / 1e4;
}

/** Per stratum x split: how often the top-1 is the source vs another acceptable lesson. */
function top1Breakdown(scored) {
  const out = {};
  for (const s of scored) {
    const key = `${s.stratum}|${s.split}`;
    out[key] = out[key] || { n: 0, source: 0, other_acceptable: 0, none: 0, mean_acceptable: 0 };
    out[key].n++;
    out[key][s.top1]++;
    out[key].mean_acceptable += s.n_acceptable;
  }
  for (const k of Object.keys(out)) out[k].mean_acceptable /= out[k].n;
  return out;
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
    top_tfidf_score: results.length ? Math.max(...results.map((r) => r.tfidf_score || 0)) : null,
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
  const scores = scored.filter(s => s.top_tfidf_score !== null).map(s => s.top_tfidf_score);
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

  // Keys that exist only for acceptable-answer sets, so a v1 report has none of them.
  const graded = lessonScored.some((s) => s.top1 !== undefined);
  const gradedKeys = graded
    ? { relevance: 'acceptable-answer sets (rank = first acceptable lesson; graded nDCG@5, linear gain)', waivers: [] }
    : {};
  return {
    generated_at: new Date().toISOString(),
    questions_source: questionsData.version !== undefined ? {
      version: questionsData.version, seed: questionsData.seed, model: questionsData.model,
      ...(questionsData.split ? { split_sha256: lib.splitHash(questionsData.split) } : {}),
    } : null,
    top: opts.top,
    thresholds: opts.thresholds || { ...DEFAULT_THRESHOLDS },
    ...gradedKeys,
    by_stratum_split: byStratumSplit,
    ...(graded ? { top1_breakdown: top1Breakdown(lessonScored.filter((s) => s.top1 !== undefined)) } : {}),
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
 * Why a report and a baseline were scored under different lesson splits, or null.
 * The split hash (questions_source.split_sha256) is compared when both carry one; a
 * baseline recorded before the hash existed (baseline-v1, baseline-v2) is judged by
 * its questions' own labels: any gated question present in both with a different
 * `split` means the splits differ.
 */
function splitMismatch(report, baseline) {
  const hr = report.questions_source && report.questions_source.split_sha256;
  const hb = baseline.questions_source && baseline.questions_source.split_sha256;
  const advice = 'the baseline was recorded under a different lesson split and cannot be compared — record a new baseline (run.js --save) for the current split';
  if (hr && hb && hr !== hb) return `lesson split mismatch (split_sha256 ${hr.slice(0, 12)} vs baseline ${hb.slice(0, 12)}): ${advice}`;
  const cur = new Map(report.queries.lesson.map((q) => [q.qid, q.split]));
  const moved = baseline.queries.lesson.filter((b) => GATED_STRATA.has(b.stratum) && cur.has(b.qid) && cur.get(b.qid) !== b.split);
  if (moved.length) {
    const list = moved.slice(0, 6).map((b) => `${b.qid} ${b.split}->${cur.get(b.qid)}`).join(', ');
    return `lesson split mismatch: ${moved.length} gated question(s) changed split (${list}${moved.length > 6 ? ', ...' : ''}): ${advice}`;
  }
  return null;
}

/**
 * Compare a fresh report against a saved baseline report. Returns
 * {ok, failures: string[], waived: string[], reported: string[]}. `thresholds` is resolveThresholds()'s output
 * (the legacy {mrrThreshold, rankDropK} opts shape is also accepted).
 *
 * Fails on:
 *   - a question-set version that differs from the baseline's (or is missing),
 *     since qids are only comparable within one version;
 *   - a lesson split that differs from the baseline's (splitMismatch), since the
 *     per stratum x split aggregates are then over different questions;
 *   - a gated stratum x split in the baseline that the report lacks;
 *   - a gated baseline question (keyed by version + qid) the report lacks;
 *   - any per-stratum x split MRR or nDCG@5 drop beyond `mrr_ndcg_drop`;
 *   - a DEV identifier question at rank 1 in the baseline that is not at rank 1 now;
 *   - any single DEV gated question whose rank worsens by more than `rank_drop_k`,
 *     falls out of the top `top_k_floor`, or was found and now is not.
 * The same per-question rules on a HOLDOUT question go to `reported`, not
 * `failures` (holdout must never drive tuning); a waiver naming a holdout
 * question is therefore never used, and fails as stale.
 * A stratum x split or question only in the report is new, not a regression.
 * Only the GATED_STRATA are compared. State questions are reported, not gated:
 * state.js cannot resolve a free-text question, and scoring them against
 * provenance lessons would count historical lessons as correct answers.
 * Negatives are reported, never gated (see file header).
 */
function compareToBaseline(report, baseline, thresholdsIn) {
  const t = thresholdsIn && thresholdsIn.mrrThreshold !== undefined
    ? { ...DEFAULT_THRESHOLDS, mrr_ndcg_drop: thresholdsIn.mrrThreshold, rank_drop_k: thresholdsIn.rankDropK }
    : { ...DEFAULT_THRESHOLDS, ...(thresholdsIn || {}) };
  const failures = [];

  const versionOf = (r) => (r && r.questions_source && r.questions_source.version !== undefined ? r.questions_source.version : null);
  const repV = versionOf(report);
  const baseV = versionOf(baseline);
  if (repV === null || baseV === null || repV !== baseV) {
    failures.push(`question-set version mismatch: report is v${repV}, baseline is v${baseV} — score the baseline's question set (--questions questions-v${baseV}.json) or record a new baseline`);
    return { ok: false, failures };
  }
  if (!!report.relevance !== !!baseline.relevance) {
    failures.push(`scoring mode mismatch: report ${report.relevance ? 'uses' : 'lacks'} acceptable-answer sets, baseline ${baseline.relevance ? 'uses' : 'lacks'} them`);
    return { ok: false, failures };
  }

  // Aggregates per stratum x split only compare under one lesson split. A baseline
  // recorded before the question set was resplit (resplit.js) labels some questions
  // differently: it cannot be compared at all, and the fix is a new baseline.
  const splitFailure = splitMismatch(report, baseline);
  if (splitFailure) {
    failures.push(splitFailure);
    return { ok: false, failures };
  }

  const isGatedKey = (key) => GATED_STRATA.has(key.split('|')[0]);
  for (const key of Object.keys(baseline.by_stratum_split)) {
    if (isGatedKey(key) && !report.by_stratum_split[key]) {
      failures.push(`[${key}] gated stratum x split is in the baseline but missing from the report`);
    }
  }
  for (const key of Object.keys(report.by_stratum_split)) {
    const cur = report.by_stratum_split[key];
    const base = baseline.by_stratum_split[key];
    if (!base || !isGatedKey(key)) continue; // new in the report, or not gated
    if (base.mrr - cur.mrr > t.mrr_ndcg_drop) {
      failures.push(`[${key}] MRR dropped ${base.mrr.toFixed(4)} -> ${cur.mrr.toFixed(4)} (> ${t.mrr_ndcg_drop})`);
    }
    if (base.ndcg5 - cur.ndcg5 > t.mrr_ndcg_drop) {
      failures.push(`[${key}] nDCG@5 dropped ${base.ndcg5.toFixed(4)} -> ${cur.ndcg5.toFixed(4)} (> ${t.mrr_ndcg_drop})`);
    }
  }

  // qids are unique only within a version, so every comparison is keyed by both.
  const qkey = (v, qid) => `v${v}:${qid}`;
  // Waivers: known, explained regressions recorded in the baseline. A waiver
  // covers one question up to its recorded rank, so the same question getting
  // worse still fails. Waived failures are always printed, never hidden.
  const waivers = new Map();
  for (const w of baseline.waivers || []) waivers.set(qkey(baseV, w.qid), w);
  const waived = [];
  const usedWaivers = new Set();
  // Holdout questions are never gated one by one: a per-question failure on a
  // holdout question is reported, not failed. Holdout exists to measure the
  // ranking without anyone tuning toward it, and a single-question rule that
  // fails the build is exactly what invites that tuning. Holdout still counts in
  // the per stratum x split aggregates above, which stay gated.
  const reported = [];
  const qFail = (b, newRank, msg) => {
    if (b.split === 'holdout') { reported.push(msg); return; }
    const w = waivers.get(qkey(baseV, b.qid));
    if (w && newRank !== null && newRank <= w.rank) {
      waived.push(`${msg} — WAIVED: ${w.reason} (${w.commit})`);
      usedWaivers.add(qkey(baseV, b.qid));
    } else {
      failures.push(msg);
    }
  };
  const reportById = new Map();
  for (const q of report.queries.lesson) reportById.set(qkey(repV, q.qid), q);
  for (const b of baseline.queries.lesson) {
    if (!GATED_STRATA.has(b.stratum)) continue;
    const q = reportById.get(qkey(baseV, b.qid));
    if (!q) {
      failures.push(`[${b.qid}] gated "${b.stratum}" question is in the baseline but missing from the report`);
      continue;
    }
    const oldRank = b.rank;
    const newRank = q.rank;
    if (t.identifier_top1_loss && b.stratum === 'identifier' && oldRank === 1 && newRank !== 1) {
      qFail(b, newRank, `[${b.qid}] "identifier" lost top-1 (1 -> ${newRank === null ? `not in top ${report.top}` : newRank})`);
    }
    if (oldRank === null) continue;
    if (newRank === null) {
      qFail(b, newRank, `[${b.qid}] "${b.stratum}" was found at rank ${oldRank}, now not found in top ${report.top}`);
      continue;
    }
    const drop = newRank - oldRank;
    if (drop > t.rank_drop_k) {
      qFail(b, newRank, `[${b.qid}] "${b.stratum}" rank dropped ${oldRank} -> ${newRank} (> ${t.rank_drop_k} ranks)`);
    }
    if (oldRank <= t.top_k_floor && newRank > t.top_k_floor) {
      qFail(b, newRank, `[${b.qid}] "${b.stratum}" fell out of top ${t.top_k_floor} (${oldRank} -> ${newRank})`);
    }
  }

  // A waiver that matched nothing is stale: the question recovered, or the
  // waiver names a question that doesn't exist. Stale waivers fail, so the
  // list can only shrink deliberately.
  for (const [k, w] of waivers) {
    if (!usedWaivers.has(k)) failures.push(`[${w.qid}] waiver is stale (no longer needed or no such question) — remove it from the baseline`);
  }

  return { ok: failures.length === 0, failures, waived, reported };
}

// ---------------------------------------------------------------------------
// Drift report (never gated)
// ---------------------------------------------------------------------------

/**
 * A rank-1 question whose acceptable lesson leads the best non-acceptable one
 * by less than this many keyword-score points is "fragile". Picked from the data
 * (questions-v2 under baseline-v5's corpus): it is about the 10th percentile of
 * rank-1 margins (0.99), and three of the four plain dev top-1 losses that the
 * Desktop 2.16120.0 chapter caused through corpus growth alone (no edit to their
 * lessons) had leads of 0.02, 0.22 and 0.31 (the fourth, 1.04). Report only.
 */
const FRAGILE_MARGIN = 1.0;

/**
 * What has moved since the gated baseline, below the gate. Pure; never fails.
 *  - aggregates: per gated stratum x split, the MRR and nDCG@5 delta and the
 *    budget left before `mrr_ndcg_drop` trips (the smaller of the two);
 *  - top1: questions that left or reached rank 1, gated or not;
 *  - fragile: rank-1 questions leading by less than FRAGILE_MARGIN. Dev ones are
 *    named; holdout ones are only counted, so the list cannot become a to-do list
 *    of holdout items.
 */
function driftReport(report, baseline, thresholdsIn, fragileMargin = FRAGILE_MARGIN) {
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholdsIn || {}) };
  const aggregates = [];
  for (const key of Object.keys(report.by_stratum_split).sort()) {
    const cur = report.by_stratum_split[key];
    const base = baseline.by_stratum_split[key];
    if (!base || !GATED_STRATA.has(key.split('|')[0])) continue;
    const dMrr = cur.mrr - base.mrr;
    const dNdcg = cur.ndcg5 - base.ndcg5;
    aggregates.push({ key, mrr: cur.mrr, d_mrr: dMrr, ndcg5: cur.ndcg5, d_ndcg5: dNdcg, budget_left: t.mrr_ndcg_drop + Math.min(dMrr, dNdcg) });
  }
  const baseById = new Map(baseline.queries.lesson.map((q) => [q.qid, q]));
  const top1 = { lost: [], gained: [] };
  const fragile = { dev: [], holdout_count: 0 };
  for (const q of report.queries.lesson) {
    if (!GATED_STRATA.has(q.stratum)) continue;
    const b = baseById.get(q.qid);
    if (b && b.rank === 1 && q.rank !== 1) top1.lost.push({ qid: q.qid, key: `${q.stratum}|${q.split}`, lesson_id: q.lesson_id, from: 1, to: q.rank });
    if (b && b.rank !== 1 && q.rank === 1) top1.gained.push({ qid: q.qid, key: `${q.stratum}|${q.split}`, lesson_id: q.lesson_id, from: b.rank, to: 1 });
    if (q.rank === 1 && typeof q.margin1 === 'number' && q.margin1 < fragileMargin) {
      if (q.split === 'holdout') fragile.holdout_count++;
      else fragile.dev.push({ qid: q.qid, key: `${q.stratum}|${q.split}`, lesson_id: q.lesson_id, margin1: q.margin1 });
    }
  }
  fragile.dev.sort((a, b) => a.margin1 - b.margin1);
  return { aggregates, top1, fragile, fragile_margin: fragileMargin };
}

function printDrift(d, baselineName) {
  const f4 = (x) => (x >= 0 ? '+' : '') + x.toFixed(4);
  console.log(`\nDrift since ${baselineName} (reported, never gated):`);
  console.log('  stratum|split        MRR      dMRR     nDCG@5   dnDCG    budget left');
  for (const a of d.aggregates) {
    console.log(`  ${a.key.padEnd(18)} ${a.mrr.toFixed(4)}  ${f4(a.d_mrr)}  ${a.ndcg5.toFixed(4)}  ${f4(a.d_ndcg5)}  ${a.budget_left.toFixed(4)}`);
  }
  const row = (x) => `${x.qid} (${x.key}, L${x.lesson_id}) ${x.from} -> ${x.to === null ? 'not found' : x.to}`;
  console.log(`  top-1 lost: ${d.top1.lost.length}${d.top1.lost.length ? '' : ' (none)'}`);
  for (const x of d.top1.lost) console.log(`    ${row(x)}`);
  console.log(`  top-1 gained: ${d.top1.gained.length}${d.top1.gained.length ? '' : ' (none)'}`);
  for (const x of d.top1.gained) console.log(`    ${row(x)}`);
  console.log(`  fragile rank-1 (lead < ${d.fragile_margin} keyword points): ${d.fragile.dev.length} dev, ${d.fragile.holdout_count} holdout (holdout counted, not named)`);
  for (const x of d.fragile.dev) console.log(`    ${x.qid} (${x.key}, L${x.lesson_id}) lead ${x.margin1.toFixed(4)}`);
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
  if (report.top1_breakdown) {
    console.log('\nTop-1 with acceptable-answer sets (source = the question\'s own lesson):');
    console.log('  stratum        split     n   source  other-acceptable  none   mean set size');
    for (const [key, b] of Object.entries(report.top1_breakdown)) {
      const [stratum, split] = key.split('|');
      console.log(`  ${stratum.padEnd(14)} ${split.padEnd(9)} ${String(b.n).padStart(3)}   ${String(b.source).padStart(4)}    ${String(b.other_acceptable).padStart(8)}        ${String(b.none).padStart(4)}   ${b.mean_acceptable.toFixed(2)}`);
    }
  }
  console.log('\nState-layer lookup() reachability by entry name (informational, not gated):');
  console.log(`  ${report.state_reachability.n_reachable_by_name}/${report.state_reachability.n} sampled registry entries are found by state.js lookup() on their own name`);
  console.log('\nNegatives (reported, not gated — see run.js header comment):');
  const n = report.negatives;
  console.log(`  n=${n.n}, with a hit: ${n.n_with_hit}`);
  console.log(`  best TF-IDF cosine: min=${n.score_min} p50=${n.score_p50} p90=${n.score_p90} max=${n.score_max} mean=${n.score_mean.toFixed(4)}`);
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
  const gated = countGated(questionsData);
  if (!gated) {
    process.stderr.write(`ERROR: ${questionsPath} has no gated (identifier/plain) questions — nothing to score.\n`);
    process.exit(1);
  }
  const baseline = opts.baseline ? JSON.parse(fs.readFileSync(path.resolve(opts.baseline), 'utf8')) : null;
  const { thresholds, sources } = resolveThresholds(opts, baseline);

  const report = buildReport(questionsData, { ...opts, thresholds });
  report.top = opts.top; // ensure present even if buildReport's local shadow changes
  console.log(`questions file: ${path.relative(process.cwd(), questionsPath) || questionsPath} (${gated} gated questions)`);
  printHumanTable(report);

  if (opts.save) {
    fs.writeFileSync(path.resolve(opts.save), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nSaved report to ${opts.save}`);
  }

  if (baseline) {
    const cmp = compareToBaseline(report, baseline, thresholds);
    console.log('\nBaseline comparison:');
    console.log(`  thresholds: ${Object.keys(thresholds).map((k) => `${k}=${thresholds[k]} (${sources[k]})`).join(', ')}`);
    for (const w of cmp.waived || []) console.log(`  ${w}`);
    if ((cmp.reported || []).length) {
      console.log(`  ${cmp.reported.length} holdout per-question change(s), reported, not gated:`);
      for (const r of cmp.reported) console.log(`    ${r}`);
    }
    if (cmp.ok) {
      console.log('  OK — no regressions beyond threshold.');
    } else {
      console.log(`  ${cmp.failures.length} regression(s):`);
      for (const f of cmp.failures) console.log(`    ${f}`);
      process.exitCode = 1;
    }
    if (report.queries.lesson.some((q) => q.margin1 !== undefined)) {
      printDrift(driftReport(report, baseline, thresholds), path.basename(opts.baseline));
    }
  }
}

module.exports = {
  DEFAULT_THRESHOLDS, GATED_STRATA, resolveThresholds, countGated,
  parseArgs, findLatestQuestions, scoreLessonQuestion, scoreWithRelevant, top1Breakdown, scoreStateQuestion, scoreNegativeQuestion,
  aggregateByStratumSplit, summarizeNegatives, buildReport, splitMismatch, compareToBaseline,
  FRAGILE_MARGIN, rankOneMargin, driftReport,
};

if (require.main === module) main();
