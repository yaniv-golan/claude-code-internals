#!/usr/bin/env node
/**
 * troubleshoot.js — Match a problem description against the troubleshooting index.
 *
 * Usage:
 *   node troubleshoot.js "<query>"          Print matching hints and lesson IDs
 *   node troubleshoot.js "<query>" --json   Machine-readable output
 *   node troubleshoot.js --list             List all known symptom patterns
 *
 * Replaces the fragile inline `node -e` in SKILL.md Step 4. Shell-safe: the query
 * is passed as a proper argv argument, not string-interpolated into a script.
 *
 * Exit codes:
 *   0 — matches found (or --list)
 *   1 — no matches found
 *   2 — error (missing file, bad args)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..');
const TS_FILE = path.join(SKILL_DIR, 'references', 'troubleshooting.json');
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
  let symptoms = [];
  let titleMap = { ...CHAPTER9_TITLES };

  try {
    const raw = JSON.parse(fs.readFileSync(TS_FILE, 'utf8'));
    symptoms = raw.symptoms || [];
  } catch (e) {
    process.stderr.write(`Error: could not load troubleshooting.json: ${e.message}\n`);
    process.exit(2);
  }

  try {
    const idx = JSON.parse(fs.readFileSync(TOPIC_INDEX, 'utf8'));
    for (const l of (idx.lessons || [])) titleMap[l.id] = l.title;
  } catch (_) {}

  return { symptoms, titleMap };
}

function match(query, symptoms) {
  const q = query.toLowerCase();
  return symptoms.filter(s =>
    (s.pattern || []).some(p => q.includes(p.toLowerCase()))
  );
}

function parseArgs(args) {
  let query = null;
  let asList = false;
  let asJson = false;

  for (const arg of args) {
    if (arg === '--list') asList = true;
    else if (arg === '--json') asJson = true;
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: troubleshoot.js "<query>" [--json]',
        '       troubleshoot.js --list',
        '',
        'Match a problem description against the troubleshooting index.',
        '',
        'Options:',
        '  --json    Output matches as JSON array',
        '  --list    List all symptom patterns in the index',
        '',
        'Examples:',
        '  node troubleshoot.js "hook not firing"',
        '  node troubleshoot.js "compaction keeps running" --json',
        '  node troubleshoot.js "permission denied on bash"',
      ].join('\n'));
      process.exit(0);
    } else if (!arg.startsWith('--') && query === null) {
      query = arg;
    }
  }

  return { query, asList, asJson };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('Error: provide a query string or --list.\n');
  process.stderr.write('Usage: node troubleshoot.js "<query>"\n');
  process.exit(2);
}

const { query, asList, asJson } = parseArgs(args);
const { symptoms, titleMap } = loadData();

if (asList) {
  console.log(`\nTroubleshooting index (${symptoms.length} symptom groups):\n`);
  for (const s of symptoms) {
    console.log(`  Patterns: ${s.pattern.join(' | ')}`);
    const lessonNames = s.lessons.map(id => `L${id} ${titleMap[id] || ''}`).join(', ');
    console.log(`  Lessons:  ${lessonNames}`);
    console.log(`  Hint:     ${s.hint.substring(0, 80)}${s.hint.length > 80 ? '…' : ''}`);
    console.log();
  }
  process.exit(0);
}

if (!query) {
  process.stderr.write('Error: no query provided.\n');
  process.exit(2);
}

const matches = match(query, symptoms);

if (matches.length === 0) {
  if (asJson) {
    console.log('[]');
  } else {
    console.log(`No troubleshooting hints matched: "${query}"`);
    console.log('Try --list to see all symptom patterns.');
  }
  process.exit(1);
}

if (asJson) {
  const out = matches.map(m => ({
    hint: m.hint,
    lessons: m.lessons,
    lessonTitles: m.lessons.map(id => ({ id, title: titleMap[id] || `Lesson ${id}` })),
    matchedPatterns: m.pattern.filter(p => query.toLowerCase().includes(p.toLowerCase())),
  }));
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`\nTroubleshooting matches for: "${query}"\n`);
  for (const m of matches) {
    const lessonList = m.lessons.map(id => `L${id} (${titleMap[id] || '?'})`).join(', ');
    console.log(`  Hint:    ${m.hint}`);
    console.log(`  Lessons: ${lessonList}`);
    console.log();
  }
  console.log(`To fetch a lesson: node fetch-lesson.js <id>`);
}
