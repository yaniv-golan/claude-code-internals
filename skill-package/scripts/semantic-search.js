#!/usr/bin/env node
/**
 * semantic-search.js
 *
 * TF-IDF cosine-similarity search over the Claude Code internals semantic index.
 *
 * Usage: node semantic-search.js "your query here"
 *        node semantic-search.js "your query" --top=5
 *        node semantic-search.js "your query" --json
 *
 * Reads semantic-index.json (built by build-rvf-index.js) and returns
 * the top matching lessons with scores, file paths, and line ranges.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Paths ---
const REFS_DIR = path.join(__dirname, '..', 'references');
const SEMANTIC_INDEX = path.join(REFS_DIR, 'semantic-index.json');

// --- Stop words (must match build script) ---
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
  'while', 'down', 'off', 'further', 'get', 'got'
]);

/**
 * Tokenize text into lowercase terms.
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Cosine similarity between two sparse TF-IDF vectors (objects).
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
 * Build a TF-IDF vector for a query given the index's IDF scores.
 */
function queryToTFIDF(queryTokens, idf) {
  // Term frequency (augmented)
  const tf = {};
  for (const t of queryTokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  const maxFreq = Math.max(...Object.values(tf), 1);

  const tfidf = {};
  for (const t in tf) {
    const normalizedTF = 0.5 + 0.5 * (tf[t] / maxFreq);
    // Use the corpus IDF if available; for unknown terms, use a high IDF
    // (rare term = potentially distinctive)
    const termIDF = idf[t] !== undefined ? idf[t] : Math.log(50);
    tfidf[t] = normalizedTF * termIDF;
  }
  return tfidf;
}

/**
 * Fuzzy match: for query tokens not in the vocabulary, find close matches.
 * Uses prefix and substring matching with minimum-length guards to avoid
 * short-token false positives (e.g., "dec" from "decide" matching "dec-mode").
 */
function expandQueryTokens(tokens, vocabulary) {
  const expanded = [...tokens];
  const vocabSet = new Set(vocabulary);

  for (const token of tokens) {
    if (vocabSet.has(token)) continue;

    // Only expand tokens that are at least 4 chars to avoid noisy short matches
    if (token.length < 4) continue;

    // Try prefix match: vocab word starts with query token (e.g., "tool" -> "tools")
    // Require the query token to be at least 70% of the vocab word length
    // to avoid "dec" matching "decision-pipeline"
    for (const v of vocabulary) {
      if (v.startsWith(token) && token.length >= v.length * 0.6) {
        expanded.push(v);
      }
    }

    // Try reverse prefix: query token starts with vocab word (e.g., "permissions" -> "permission")
    // Only if the vocab word is substantial (>= 4 chars)
    for (const v of vocabulary) {
      if (token.startsWith(v) && v.length >= 4) {
        expanded.push(v);
      }
    }

    // Try substring match for compound terms (e.g., "permission" in "permission-dialog")
    // Require the token to be at least 5 chars to avoid short-token pollution
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

// --- Main ---
function main() {
  // Parse args
  const args = process.argv.slice(2);
  let query = '';
  let topN = 3;
  let jsonOutput = false;

  for (const arg of args) {
    if (arg.startsWith('--top=')) {
      topN = parseInt(arg.split('=')[1], 10) || 3;
    } else if (arg === '--json') {
      jsonOutput = true;
    } else {
      query = arg;
    }
  }

  if (!query) {
    console.error('Usage: semantic-search.js "your query" [--top=N] [--json]');
    process.exit(1);
  }

  // Load index
  if (!fs.existsSync(SEMANTIC_INDEX)) {
    console.error(`ERROR: semantic-index.json not found at ${SEMANTIC_INDEX}`);
    console.error('Run build-rvf-index.js first to generate it.');
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(SEMANTIC_INDEX, 'utf8'));

  // Tokenize and expand query
  let queryTokens = tokenize(query);
  queryTokens = expandQueryTokens(queryTokens, index.vocabulary);

  // Build query TF-IDF vector
  const queryVec = queryToTFIDF(queryTokens, index.idf);

  // Score each entry
  const scored = index.entries.map(entry => {
    const score = cosineSimilarity(queryVec, entry.tfidf);
    return { ...entry, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Take top N
  const results = scored.slice(0, topN);

  if (jsonOutput) {
    const output = results.map(r => ({
      id: r.id,
      title: r.title,
      score: +r.score.toFixed(4),
      file: r.file,
      startLine: r.startLine,
      endLine: r.endLine,
      keywords: r.keywords,
    }));
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`\nQuery: "${query}"`);
    console.log(`Tokens: [${queryTokens.join(', ')}]`);
    console.log(`${'='.repeat(60)}\n`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const scoreBar = '#'.repeat(Math.round(r.score * 40));
      console.log(`  ${i + 1}. ${r.title} (Lesson ${r.id})`);
      console.log(`     Score: ${r.score.toFixed(4)}  ${scoreBar}`);
      console.log(`     File:  ${r.file}:${r.startLine}-${r.endLine}`);
      console.log(`     Keywords: ${r.keywords.join(', ')}`);
      console.log();
    }

    if (results.length === 0 || results[0].score === 0) {
      console.log('  No matching results. Try different search terms.');
    }
  }
}

main();
