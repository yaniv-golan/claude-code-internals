#!/usr/bin/env node
/**
 * fetch-lesson.js — Fetch a lesson's content by ID, without offset math.
 *
 * Usage:
 *   node fetch-lesson.js <id>            Print lesson content to stdout
 *   node fetch-lesson.js <id> --meta     Print only metadata (title, file, lines)
 *   node fetch-lesson.js --list          List all known lessons
 *
 * The LLM should use this instead of manually tracking file paths and line
 * offsets from search results. One call returns exactly the right content.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..');
const TOPIC_INDEX = path.join(SKILL_DIR, 'references', 'topic-index.json');
const REF_DIR = path.join(SKILL_DIR, 'references');

// Fallback lessons for older topic-index.json snapshots that may not yet include
// the binary-verified chapters. Current topic-index.json should already contain
// these, so loadLessons() de-duplicates by ID after merging.
const FALLBACK_LESSONS = [
  {
    id: 51,
    title: '/effort Command & Reasoning Budget',
    file: '06-verified-new-v2.1.90.md',
    startLine: 29,
    endLine: 88,
    keywords: ['effort', 'reasoning', 'budget', 'thinking', 'effort-level', 'ultrathink'],
  },
  {
    id: 52,
    title: '/rewind & File Checkpointing',
    file: '06-verified-new-v2.1.90.md',
    startLine: 90,
    endLine: 150,
    keywords: ['rewind', 'checkpoint', 'file-history', 'rollback', 'undo'],
  },
  {
    id: 53,
    title: '/teleport: Session Transfer',
    file: '06-verified-new-v2.1.90.md',
    startLine: 152,
    endLine: 220,
    keywords: ['teleport', 'session-transfer', 'web-session', 'resume'],
  },
  {
    id: 54,
    title: '/branch: Conversation Forking',
    file: '06-verified-new-v2.1.90.md',
    startLine: 222,
    endLine: 278,
    keywords: ['branch', 'fork', 'conversation-fork', 'diverge'],
  },
  {
    id: 55,
    title: 'Session Resume & New env vars',
    file: '06-verified-new-v2.1.90.md',
    startLine: 280,
    endLine: 420,
    keywords: ['session-resume', 'env-vars', 'environment-variables', 'new-features', 'advisor-model'],
  },
  {
    id: 56,
    title: 'New Commands: /autocompact, /buddy, /powerup, /toggle-memory',
    file: '06-verified-new-v2.1.90.md',
    startLine: 422,
    endLine: 9999,
    keywords: ['autocompact', 'buddy', 'companion', 'powerup', 'toggle-memory', 'new-commands'],
  },
];

function loadLessons() {
  let lessons = [];
  try {
    const idx = JSON.parse(fs.readFileSync(TOPIC_INDEX, 'utf8'));
    lessons = idx.lessons || [];
  } catch (e) {
    process.stderr.write(`Warning: could not load topic-index.json: ${e.message}\n`);
  }
  const deduped = new Map();
  for (const lesson of [...lessons, ...FALLBACK_LESSONS]) {
    if (!deduped.has(lesson.id)) {
      deduped.set(lesson.id, lesson);
    }
  }
  return [...deduped.values()].sort((a, b) => a.id - b.id);
}

function findLesson(id, lessons) {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return null;
  return lessons.find(l => l.id === numId) || null;
}

function fetchContent(lesson) {
  const filePath = path.join(REF_DIR, lesson.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Reference file not found: ${lesson.file}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  // startLine/endLine are 1-based
  const start = Math.max(0, (lesson.startLine || 1) - 1);
  const end = Math.min(lines.length, lesson.endLine || lines.length);
  return lines.slice(start, end).join('\n');
}

function printList(lessons) {
  const byFile = {};
  for (const l of lessons) {
    if (!byFile[l.file]) byFile[l.file] = [];
    byFile[l.file].push(l);
  }
  for (const [file, group] of Object.entries(byFile)) {
    console.log(`\n  ${file}`);
    for (const l of group) {
      const lines = `L${l.startLine}–${l.endLine}`;
      console.log(`    [${String(l.id).padStart(2)}] ${l.title.padEnd(45)} ${lines}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log([
    'Usage:',
    '  fetch-lesson.js <id>         Print lesson content',
    '  fetch-lesson.js <id> --meta  Print metadata only (title, file, lines)',
    '  fetch-lesson.js --list       List all lessons with IDs and line ranges',
    '',
    'Examples:',
    '  node fetch-lesson.js 10           # Hooks System',
    '  node fetch-lesson.js 51           # /effort Command (Ch9)',
    '  node fetch-lesson.js 29 --meta    # Permissions metadata only',
    '  node fetch-lesson.js --list',
  ].join('\n'));
  process.exit(0);
}

const lessons = loadLessons();

if (args[0] === '--list') {
  console.log(`\nAll lessons (${lessons.length} total):`);
  printList(lessons);
  process.exit(0);
}

const lesson = findLesson(args[0], lessons);
if (!lesson) {
  process.stderr.write(`Error: no lesson with id=${args[0]}\n`);
  process.stderr.write(`Run with --list to see all lesson IDs.\n`);
  process.exit(1);
}

if (args.includes('--meta')) {
  console.log(JSON.stringify({
    id: lesson.id,
    title: lesson.title,
    file: lesson.file,
    startLine: lesson.startLine,
    endLine: lesson.endLine,
    lineCount: (lesson.endLine - lesson.startLine) + 1,
    keywords: lesson.keywords || [],
  }, null, 2));
  process.exit(0);
}

try {
  const content = fetchContent(lesson);
  // Header so the LLM knows which lesson it's reading
  console.log(`# Lesson ${lesson.id}: ${lesson.title}`);
  console.log(`# Source: ${lesson.file} L${lesson.startLine}–${lesson.endLine}\n`);
  console.log(content);
} catch (e) {
  process.stderr.write(`Error: ${e.message}\n`);
  process.exit(1);
}
