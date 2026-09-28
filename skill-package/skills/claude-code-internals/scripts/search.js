#!/usr/bin/env node
/**
 * search.js — Unified search with Reciprocal Rank Fusion (RRF)
 *
 * Combines keyword lookup (topic-index.json) and TF-IDF cosine similarity
 * (an in-memory index derived from topic-index.json by lib/tfidf-index.js)
 * into a single ranked result set using RRF scoring.
 *
 * Usage:
 *   node search.js "hook events"
 *   node search.js "permission system" --top=10
 *   node search.js "streaming retry" --json
 *   node search.js "state management" --top=3 --json
 *
 * No external dependencies required.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const REFS_DIR = path.join(__dirname, '..', 'references');
const TOPIC_INDEX_PATH = path.join(REFS_DIR, 'topic-index.json');

// ---------------------------------------------------------------------------
// RRF constant (standard value from Cormack, Clarke & Buettcher 2009)
// ---------------------------------------------------------------------------
const RRF_K = 60;

// ---------------------------------------------------------------------------
// Tokenizer and TF-IDF index (shared with semantic-search.js). The query side
// drops the stop words plus "claude" and "code", which appear in every lesson.
// ---------------------------------------------------------------------------
const { tokenizeQuery: tokenize, loadIndex } = require('./lib/tfidf-index.js');
const keywordMatch = require('./lib/keyword-match.js');
// Output shows hand keywords only: generated identifier keys (prepare-lessons.js)
// still rank, but printing them doubled some lessons' output. Ranking is unchanged.
const { handKeywords, lessonGenerated } = require('./lib/keyword-provenance.js');

// ---------------------------------------------------------------------------
// Layer 1: Keyword search over topic-index.json keyword_map
// ---------------------------------------------------------------------------

/**
 * Rank lessons by specificity-weighted keyword hits. The matching rule and the
 * formula live in lib/keyword-match.js (shared with prepare-lessons.js's
 * collision rule); in short, with N lessons:
 *   spec(k)  = ln(1 + N / n_k)     n_k  = lessons key k maps to
 *   spec(t)  = ln(1 + N / df_t)    df_t = lessons token t reaches through any key
 *   w(t, k)  = min(spec(k), spec(t)) * (1 for a hit on the whole key, 0.5 for a
 *              word of a multi-word key -- times the query's coverage of a hand
 *              kebab key -- and 0.25 for a substring)
 *   score(L) = sum over distinct query tokens t of max w(t, k) over keys k -> L
 * ordered by score, then the best single hit, then tokens hit, then lowest id.
 * A token shorter than 3 characters never matches inside a word. A vocabulary
 * key is hit by its content words only; a word the query has only inside a
 * compound identifier counts half (see keyword-match.js).
 *
 * @param {string[]} tokens - Query tokens
 * @param {object} topicIndex - Parsed topic-index.json
 * @param {string} [query] - The query text the tokens came from
 * @returns {{ id: number, score: number, best: number, hits: number }[]} - Ranked results
 */
const generatedSets = new WeakMap();
function keywordSearch(tokens, topicIndex, query = null) {
  // Generated keys are identifiers by construction: never hand kebab phrases.
  let exactOnly = generatedSets.get(topicIndex);
  if (!exactOnly) {
    exactOnly = new Set((topicIndex.lessons || []).flatMap((l) => [...lessonGenerated(l)]));
    generatedSets.set(topicIndex, exactOnly);
  }
  return keywordMatch.rankLessons(tokens, topicIndex.keyword_map, (topicIndex.lessons || []).length, exactOnly, query);
}

// ---------------------------------------------------------------------------
// Layer 2: TF-IDF cosine similarity (mirrors semantic-search.js logic)
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two sparse TF-IDF vectors represented
 * as plain objects mapping term -> weight.
 *
 * @param {object} vecA
 * @param {object} vecB
 * @returns {number}
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const t in vecA) {
    normA += vecA[t] * vecA[t];
    if (vecB[t] !== undefined) {
      dotProduct += vecA[t] * vecB[t];
    }
  }
  for (const t in vecB) {
    normB += vecB[t] * vecB[t];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Build a TF-IDF vector for a query using the corpus IDF table.
 * Uses augmented term frequency: 0.5 + 0.5 * (tf / max_tf).
 *
 * @param {string[]} queryTokens
 * @param {object} idf - Term -> IDF weight from the TF-IDF index
 * @returns {object} - Sparse TF-IDF vector
 */
function queryToTFIDF(queryTokens, idf) {
  const tf = {};
  for (const t of queryTokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  const maxFreq = Math.max(...Object.values(tf), 1);

  const tfidf = {};
  for (const t in tf) {
    const normalizedTF = 0.5 + 0.5 * (tf[t] / maxFreq);
    // Unknown terms get a high IDF (rare = potentially distinctive)
    const termIDF = idf[t] !== undefined ? idf[t] : Math.log(50);
    tfidf[t] = normalizedTF * termIDF;
  }
  return tfidf;
}

/**
 * Expand query tokens with fuzzy matches from the corpus vocabulary.
 * Uses prefix, reverse-prefix, and substring matching with length guards
 * to avoid noisy short-token false positives.
 *
 * @param {string[]} tokens
 * @param {string[]} vocabulary
 * @returns {string[]}
 */
function expandQueryTokens(tokens, vocabulary) {
  const expanded = [...tokens];
  const vocabSet = new Set(vocabulary);

  for (const token of tokens) {
    if (vocabSet.has(token)) continue;
    if (token.length < 4) continue;

    for (const v of vocabulary) {
      // Prefix match: vocab word starts with query token
      if (v.startsWith(token) && token.length >= v.length * 0.6) {
        expanded.push(v);
      }
      // Reverse prefix: query token starts with vocab word
      if (token.startsWith(v) && v.length >= 4) {
        expanded.push(v);
      }
    }

    // Substring match for compound terms (require >= 5 chars)
    if (token.length >= 5) {
      for (const v of vocabulary) {
        if (v.includes(token) && !expanded.includes(v)) {
          expanded.push(v);
        }
      }
    }
  }

  return [...new Set(expanded)];
}

/**
 * Run TF-IDF cosine similarity search over the TF-IDF index.
 * Returns entries scored and sorted descending, filtered by minimum threshold.
 *
 * @param {string[]} tokens - Raw query tokens
 * @param {object} semanticIndex - Index from lib/tfidf-index.js loadIndex()
 * @returns {{ id: number, score: number }[]}
 */
function tfidfSearch(tokens, semanticIndex) {
  const expandedTokens = expandQueryTokens(tokens, semanticIndex.vocabulary);
  const queryVec = queryToTFIDF(expandedTokens, semanticIndex.idf);

  const MIN_SCORE = 0.03;

  const scored = semanticIndex.entries
    .map(entry => ({
      id: entry.id,
      score: cosineSimilarity(queryVec, entry.tfidf),
    }))
    .filter(r => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  return scored;
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

/**
 * Fuse two ranked lists using Reciprocal Rank Fusion.
 *
 * For each result appearing in either list, the RRF score is:
 *   score = sum( 1 / (k + rank_i) ) for each ranker i where the result appears
 *
 * @param {{ id: number }[]} keywordResults - Ranked keyword results (position = rank)
 * @param {{ id: number, score: number }[]} tfidfResults - Ranked TF-IDF results
 * @param {number} k - RRF constant (default 60)
 * @returns {Map<number, { rrfScore: number, rrfNum: number, rrfDen: number, keywordRank: number|null, tfidfRank: number|null }>}
 *   rrfNum/rrfDen: the same score as an exact reduced fraction (fusedOrder compares these)
 */
function reciprocalRankFusion(keywordResults, tfidfResults, k) {
  const fused = new Map(); // id -> { rrfScore, rrfNum, rrfDen, keywordRank, tfidfRank, ... }
  const entryOf = (id) => {
    if (!fused.has(id)) {
      fused.set(id, { rrfScore: 0, rrfNum: 0, rrfDen: 1, keywordRank: null, tfidfRank: null, keywordScore: 0, tfidfScore: 0 });
    }
    return fused.get(id);
  };
  // The exact score, as the fraction rrfNum/rrfDen: p/q + 1/(k+rank) = (p(k+rank) + q) / (q(k+rank)),
  // reduced. With integer k and ranks the terms stay far below 2^53.
  const addExact = (entry, rank) => {
    const d = k + rank;
    const num = entry.rrfNum * d + entry.rrfDen;
    const den = entry.rrfDen * d;
    const g = gcd(num, den);
    entry.rrfNum = num / g;
    entry.rrfDen = den / g;
  };

  // Process keyword ranks (1-indexed)
  for (let i = 0; i < keywordResults.length; i++) {
    const id = keywordResults[i].id;
    const rank = i + 1;
    const contribution = 1 / (k + rank);
    const entry = entryOf(id);
    entry.rrfScore += contribution;
    addExact(entry, rank);
    entry.keywordRank = rank;
    entry.keywordScore = keywordResults[i].score || 0;
  }

  // Process TF-IDF ranks (1-indexed)
  for (let i = 0; i < tfidfResults.length; i++) {
    const id = tfidfResults[i].id;
    const rank = i + 1;
    const contribution = 1 / (k + rank);
    const entry = entryOf(id);
    entry.rrfScore += contribution;
    addExact(entry, rank);
    entry.tfidfRank = rank;
    entry.tfidfScore = tfidfResults[i].score || 0;
  }

  return fused;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Order of fused results: RRF score descending, compared EXACTLY as the
 * fractions rrfNum/rrfDen by integer cross-multiplication (the float rrfScore
 * is for display: 1/90 + 1/78 and 1/117 + 1/65 are both 14/585, but their
 * float sums differ in the last bit). An exact tie (ranks 1+2 vs 2+1, or 30+18
 * vs 57+5 at k = 60) goes to the higher keyword-layer score (the more specific
 * key match), then to the higher TF-IDF score, then to the lowest id. The
 * TF-IDF step matters when two lessons tie in the keyword layer too: their
 * keyword ranks were then set by id alone, so the id must not decide the fused
 * order as well when the other layer tells them apart.
 * Entries come from reciprocalRankFusion(), which always sets rrfNum/rrfDen.
 */
function fusedOrder(a, b) {
  return b.rrfNum * a.rrfDen - a.rrfNum * b.rrfDen || b.keywordScore - a.keywordScore || b.tfidfScore - a.tfidfScore || a.id - b.id;
}

// ---------------------------------------------------------------------------
// Confidence labeling
// ---------------------------------------------------------------------------

/**
 * Determine confidence label based on which layers matched and at what rank.
 *
 * HIGH:   Both layers agree in top 3
 * MEDIUM: At least one layer has it in top 3
 * LOW:    Present but only at lower ranks
 *
 * @param {number|null} keywordRank
 * @param {number|null} tfidfRank
 * @returns {string}
 */
function confidenceLabel(keywordRank, tfidfRank) {
  const kwTop3 = keywordRank !== null && keywordRank <= 3;
  const tfTop3 = tfidfRank !== null && tfidfRank <= 3;

  if (kwTop3 && tfTop3) return 'HIGH';
  if (kwTop3 || tfTop3) return 'MEDIUM';
  return 'LOW';
}

/**
 * Describe which layers matched for display.
 *
 * @param {number|null} keywordRank
 * @param {number|null} tfidfRank
 * @returns {string}
 */
function layerDescription(keywordRank, tfidfRank) {
  if (keywordRank !== null && tfidfRank !== null) return 'both layers';
  if (keywordRank !== null) return 'keyword only';
  return 'tfidf only';
}

// ---------------------------------------------------------------------------
// File loading with validation
// ---------------------------------------------------------------------------

/**
 * Read a file's text, exiting with a descriptive error if it is missing.
 *
 * @param {string} filePath
 * @param {string} label - Human-readable name for error messages
 * @returns {string}
 */
function loadRaw(filePath, label) {
  if (!fs.existsSync(filePath)) {
    process.stderr.write(
      `ERROR: ${label} not found at ${filePath}\n` +
      'Ensure the references directory contains the required index files.\n'
    );
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Parse JSON text, exiting with a descriptive error on failure.
 *
 * @param {string} raw
 * @param {string} filePath
 * @param {string} label - Human-readable name for error messages
 * @returns {object}
 */
function parseJSON(raw, filePath, label) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `ERROR: Failed to parse ${label} at ${filePath}\n` +
      `  ${err.message}\n`
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments into a structured options object.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ query: string, topN: number, jsonOutput: boolean }}
 */
function parseArgs(argv) {
  let query = '';
  let topN = 5;
  let jsonOutput = false;

  for (const arg of argv) {
    if (arg.startsWith('--top=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        process.stderr.write('ERROR: --top must be a positive integer.\n');
        process.exit(1);
      }
      topN = parsed;
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      process.stderr.write(`ERROR: Unknown flag "${arg}"\n`);
      printUsage();
      process.exit(1);
    } else {
      query = arg;
    }
  }

  if (!query) {
    process.stderr.write('ERROR: No query provided.\n\n');
    printUsage();
    process.exit(1);
  }

  return { query, topN, jsonOutput };
}

function printUsage() {
  process.stderr.write(
    'Usage: search.js "your query" [--top=N] [--json]\n\n' +
    'Unified search combining keyword lookup and TF-IDF cosine similarity\n' +
    'using Reciprocal Rank Fusion (RRF).\n\n' +
    'Options:\n' +
    '  --top=N   Number of results to return (default: 5)\n' +
    '  --json    Output results as JSON\n' +
    '  --help    Show this help message\n'
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Rank `query` against the loaded indexes. Returns the enriched top-N results
 * (the --json shape) or throws {stopWordsOnly: true} when the query tokenizes to
 * nothing. Pure given its inputs; main() is the CLI around it.
 */
function search(query, { topicIndex, semanticIndex, topN = 5 }) {
  const lessonById = new Map();
  for (const lesson of topicIndex.lessons) {
    lessonById.set(lesson.id, lesson);
  }

  const tokens = tokenize(query);
  if (tokens.length === 0) {
    const e = new Error('Query contains only stop words.');
    e.stopWordsOnly = true;
    throw e;
  }

  // Run both search layers
  const keywordResults = keywordSearch(tokens, topicIndex, query);
  const tfidfResults = tfidfSearch(tokens, semanticIndex);

  // Fuse with RRF
  const fused = reciprocalRankFusion(keywordResults, tfidfResults, RRF_K);

  const ranked = Array.from(fused.entries())
    .map(([id, data]) => ({ id, ...data }))
    .sort(fusedOrder);

  return ranked.slice(0, topN).map(r => {
    const lesson = lessonById.get(r.id);
    if (!lesson) {
      return null; // Defensive: skip if lesson metadata is missing
    }
    return {
      id: r.id,
      title: lesson.title,
      lessonNumber: lesson.lesson_number,
      rrfScore: r.rrfScore,
      confidence: confidenceLabel(r.keywordRank, r.tfidfRank),
      layers: layerDescription(r.keywordRank, r.tfidfRank),
      keywordRank: r.keywordRank,
      tfidfRank: r.tfidfRank,
      file: lesson.file,
      startLine: lesson.startLine,
      endLine: lesson.endLine,
      keywords: handKeywords(lesson),
    };
  }).filter(Boolean);
}

function main() {
  const { query, topN, jsonOutput } = parseArgs(process.argv.slice(2));

  // Load both indexes
  const topicRaw = loadRaw(TOPIC_INDEX_PATH, 'topic-index.json');
  const topicIndex = parseJSON(topicRaw, TOPIC_INDEX_PATH, 'topic-index.json');
  const semanticIndex = loadIndex({ topicBytes: topicRaw, topicIndex });

  let enriched;
  try {
    enriched = search(query, { topicIndex, semanticIndex, topN });
  } catch (err) {
    if (!err.stopWordsOnly) throw err;
    process.stderr.write(
      'ERROR: Query contains only stop words. Try more specific terms.\n'
    );
    process.exit(1);
  }

  // Output
  if (jsonOutput) {
    const output = enriched.map(r => ({
      id: r.id,
      title: r.title,
      lesson_number: r.lessonNumber,
      rrf_score: +r.rrfScore.toFixed(4),
      confidence: r.confidence,
      layers: r.layers,
      keyword_rank: r.keywordRank,
      tfidf_rank: r.tfidfRank,
      file: r.file,
      startLine: r.startLine,
      endLine: r.endLine,
      keywords: r.keywords,
    }));
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    process.stdout.write(`\nQuery: "${query}"\n`);
    process.stdout.write('Strategy: Reciprocal Rank Fusion (keyword + TF-IDF)\n');
    process.stdout.write('='.repeat(60) + '\n\n');

    if (enriched.length === 0) {
      process.stdout.write(
        '  No matches found across either search layer.\n' +
        '  Try different search terms or check available keywords in topic-index.json.\n'
      );
    } else {
      for (let i = 0; i < enriched.length; i++) {
        const r = enriched[i];
        const conf = r.confidence;
        const layers = r.layers;
        process.stdout.write(
          `  ${i + 1}. ${r.title} (Lesson ${/^\d+$/.test(r.lessonNumber) ? r.lessonNumber : r.id}) [${conf} - ${layers}]\n`
        );
        process.stdout.write(
          `     RRF Score: ${r.rrfScore.toFixed(4)}\n`
        );
        process.stdout.write(
          `     File: ${r.file}:${r.startLine}-${r.endLine}\n`
        );
        process.stdout.write(
          `     Keywords: ${r.keywords.join(', ')}\n`
        );
        process.stdout.write('\n');
      }
    }
  }
}

module.exports = { search, keywordSearch, tfidfSearch, reciprocalRankFusion, fusedOrder };

if (require.main === module) main();
