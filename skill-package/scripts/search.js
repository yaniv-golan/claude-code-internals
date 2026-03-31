#!/usr/bin/env node
/**
 * search.js — Unified search with Reciprocal Rank Fusion (RRF)
 *
 * Combines keyword lookup (topic-index.json) and TF-IDF cosine similarity
 * (semantic-index.json) into a single ranked result set using RRF scoring.
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
const SEMANTIC_INDEX_PATH = path.join(REFS_DIR, 'semantic-index.json');

// ---------------------------------------------------------------------------
// RRF constant (standard value from Cormack, Clarke & Buettcher 2009)
// ---------------------------------------------------------------------------
const RRF_K = 60;

// ---------------------------------------------------------------------------
// Stop words — matches semantic-search.js plus "claude" and "code" which
// appear in every lesson and therefore carry no discriminative signal.
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are',
  'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we',
  'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
  'its', 'our', 'their', 'what', 'which', 'who', 'whom', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'about', 'above', 'after', 'again', 'also', 'any', 'because',
  'before', 'between', 'during', 'here', 'if', 'into', 'once',
  'out', 'over', 'then', 'there', 'through', 'under', 'until', 'up',
  'while', 'down', 'off', 'further', 'get', 'got',
  // Domain stop words — ubiquitous across all 50 lessons
  'claude', 'code',
]);

// ---------------------------------------------------------------------------
// Tokenizer (shared between both search layers)
// ---------------------------------------------------------------------------

/**
 * Tokenize a string into lowercase alphanumeric terms, removing stop words
 * and single-character tokens.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

// ---------------------------------------------------------------------------
// Layer 1: Keyword search (mirrors lookup.sh logic)
// ---------------------------------------------------------------------------

/**
 * Search topic-index.json keyword_map for partial, case-insensitive matches.
 * Returns lesson IDs ranked by how many query tokens matched.
 *
 * @param {string[]} tokens - Query tokens
 * @param {object} topicIndex - Parsed topic-index.json
 * @returns {{ id: number, hits: number }[]} - Ranked results
 */
function keywordSearch(tokens, topicIndex) {
  const keywordMap = topicIndex.keyword_map;
  if (!keywordMap || typeof keywordMap !== 'object') {
    return [];
  }

  // For each token, find all keyword_map keys that contain it (partial match)
  // and collect the associated lesson IDs.
  const hitCounts = new Map(); // lesson ID -> number of token matches

  for (const token of tokens) {
    const matchedIds = new Set();
    for (const [keyword, lessonIds] of Object.entries(keywordMap)) {
      if (keyword.toLowerCase().includes(token)) {
        for (const id of lessonIds) {
          matchedIds.add(id);
        }
      }
    }
    for (const id of matchedIds) {
      hitCounts.set(id, (hitCounts.get(id) || 0) + 1);
    }
  }

  // Sort by hit count descending, then by ID ascending for stable ordering
  const results = Array.from(hitCounts.entries())
    .map(([id, hits]) => ({ id, hits }))
    .sort((a, b) => b.hits - a.hits || a.id - b.id);

  return results;
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
 * @param {object} idf - Term -> IDF weight from the semantic index
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
 * Run TF-IDF cosine similarity search over the semantic index.
 * Returns entries scored and sorted descending, filtered by minimum threshold.
 *
 * @param {string[]} tokens - Raw query tokens
 * @param {object} semanticIndex - Parsed semantic-index.json
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
 * @returns {Map<number, { rrfScore: number, keywordRank: number|null, tfidfRank: number|null }>}
 */
function reciprocalRankFusion(keywordResults, tfidfResults, k) {
  const fused = new Map(); // id -> { rrfScore, keywordRank, tfidfRank }

  // Process keyword ranks (1-indexed)
  for (let i = 0; i < keywordResults.length; i++) {
    const id = keywordResults[i].id;
    const rank = i + 1;
    const contribution = 1 / (k + rank);
    if (!fused.has(id)) {
      fused.set(id, { rrfScore: 0, keywordRank: null, tfidfRank: null });
    }
    const entry = fused.get(id);
    entry.rrfScore += contribution;
    entry.keywordRank = rank;
  }

  // Process TF-IDF ranks (1-indexed)
  for (let i = 0; i < tfidfResults.length; i++) {
    const id = tfidfResults[i].id;
    const rank = i + 1;
    const contribution = 1 / (k + rank);
    if (!fused.has(id)) {
      fused.set(id, { rrfScore: 0, keywordRank: null, tfidfRank: null });
    }
    const entry = fused.get(id);
    entry.rrfScore += contribution;
    entry.tfidfRank = rank;
  }

  return fused;
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
 * Load and validate a JSON file, exiting with a descriptive error on failure.
 *
 * @param {string} filePath
 * @param {string} label - Human-readable name for error messages
 * @returns {object}
 */
function loadJSON(filePath, label) {
  if (!fs.existsSync(filePath)) {
    process.stderr.write(
      `ERROR: ${label} not found at ${filePath}\n` +
      'Ensure the references directory contains the required index files.\n'
    );
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
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

function main() {
  const { query, topN, jsonOutput } = parseArgs(process.argv.slice(2));

  // Load both indexes
  const topicIndex = loadJSON(TOPIC_INDEX_PATH, 'topic-index.json');
  const semanticIndex = loadJSON(SEMANTIC_INDEX_PATH, 'semantic-index.json');

  // Build a lookup table: lesson ID -> lesson metadata
  const lessonById = new Map();
  for (const lesson of topicIndex.lessons) {
    lessonById.set(lesson.id, lesson);
  }

  // Tokenize query
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    process.stderr.write(
      'ERROR: Query contains only stop words. Try more specific terms.\n'
    );
    process.exit(1);
  }

  // Run both search layers
  const keywordResults = keywordSearch(tokens, topicIndex);
  const tfidfResults = tfidfSearch(tokens, semanticIndex);

  // Fuse with RRF
  const fused = reciprocalRankFusion(keywordResults, tfidfResults, RRF_K);

  // Sort by RRF score descending, then by lesson ID for stability
  const ranked = Array.from(fused.entries())
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.rrfScore - a.rrfScore || a.id - b.id);

  // Take top N
  const results = ranked.slice(0, topN);

  // Enrich with lesson metadata
  const enriched = results.map(r => {
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
      keywords: lesson.keywords,
    };
  }).filter(Boolean);

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

main();
