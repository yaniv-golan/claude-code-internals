#!/usr/bin/env node
/**
 * xref.js — Cross-reference lookup: given lesson IDs, find strongly related lessons.
 *
 * Usage:
 *   node xref.js <id1> [id2] [id3] ...     Print related lessons (relevance >= 0.78)
 *   node xref.js <id1> --threshold=0.7     Lower relevance threshold
 *   node xref.js <id1> --all               Show all related lessons regardless of threshold
 *   node xref.js <id1> --json              Machine-readable output
 *
 * Replaces the fragile inline `node -e` in SKILL.md Step 3. Shell-safe: handles
 * queries with quotes and special characters because arguments are passed as argv,
 * not interpolated into a string.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..');
const XREF_FILE = path.join(SKILL_DIR, 'references', 'cross-references.json');
const TOPIC_INDEX = path.join(SKILL_DIR, 'references', 'topic-index.json');

const CHAPTER9_TITLES = {
  51: '/effort Command & Reasoning Budget',
  52: '/rewind & File Checkpointing',
  53: '/teleport: Session Transfer',
  54: '/branch: Conversation Forking',
  55: 'Session Resume & New env vars',
  56: 'New Commands: /autocompact, /buddy, /powerup, /toggle-memory',
};

function loadData() {
  let xref = {};
  let titleMap = { ...CHAPTER9_TITLES };

  try {
    const raw = JSON.parse(fs.readFileSync(XREF_FILE, 'utf8'));
    xref = raw.references || raw;
  } catch (e) {
    process.stderr.write(`Warning: could not load cross-references.json: ${e.message}\n`);
  }

  try {
    const idx = JSON.parse(fs.readFileSync(TOPIC_INDEX, 'utf8'));
    for (const l of (idx.lessons || [])) {
      titleMap[l.id] = l.title;
    }
  } catch (_) {}

  return { xref, titleMap };
}

function parseArgs(args) {
  const ids = [];
  let threshold = 0.78;
  let showAll = false;
  let asJson = false;

  for (const arg of args) {
    if (arg.startsWith('--threshold=')) {
      threshold = parseFloat(arg.split('=')[1]);
    } else if (arg === '--all') {
      showAll = true;
      threshold = 0;
    } else if (arg === '--json') {
      asJson = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: xref.js <id1> [id2] ... [--threshold=0.78] [--all] [--json]',
        '',
        'Finds lessons strongly related to the given lesson IDs.',
        '',
        'Options:',
        '  --threshold=N   Minimum relevance score (default: 0.78)',
        '  --all           Show all related lessons (threshold = 0)',
        '  --json          Output as JSON array',
        '',
        'Examples:',
        '  node xref.js 10 29            # hooks + permissions cross-refs',
        '  node xref.js 6 --threshold=0.8',
        '  node xref.js 15 16 --all --json',
      ].join('\n'));
      process.exit(0);
    } else {
      const n = parseInt(arg, 10);
      if (!isNaN(n)) ids.push(n);
    }
  }

  return { ids, threshold, showAll, asJson };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('Error: provide at least one lesson ID.\n');
  process.stderr.write('Usage: node xref.js <id1> [id2] ... [--threshold=0.78]\n');
  process.exit(1);
}

const { ids, threshold, asJson } = parseArgs(args);

if (ids.length === 0) {
  process.stderr.write('Error: no valid lesson IDs found in arguments.\n');
  process.exit(1);
}

const { xref, titleMap } = loadData();

const seen = new Set(ids);
const results = [];

for (const id of ids) {
  const related = xref[String(id)] || [];
  for (const r of related) {
    if (r.relevance >= threshold && !seen.has(r.id)) {
      seen.add(r.id);
      results.push({
        id: r.id,
        title: titleMap[r.id] || `Lesson ${r.id}`,
        relevance: r.relevance,
        reason: r.reason,
        via: id,
      });
    }
  }
}

results.sort((a, b) => b.relevance - a.relevance);

if (results.length === 0) {
  if (asJson) {
    console.log('[]');
  } else {
    console.log(`No related lessons found for ID(s) [${ids.join(', ')}] at threshold ${threshold}.`);
  }
  process.exit(0);
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`\nRelated lessons for [${ids.join(', ')}] (threshold: ${threshold}):\n`);
  for (const r of results) {
    const pct = (r.relevance * 100).toFixed(0);
    console.log(`  [${String(r.id).padStart(2)}] ${r.title.padEnd(45)} ${pct}%  via L${r.via}`);
    console.log(`       ${r.reason}`);
  }
  console.log(`\nTo fetch any of these: node fetch-lesson.js <id>`);
}
