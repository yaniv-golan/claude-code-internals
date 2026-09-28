#!/usr/bin/env node
/**
 * gen-registry-top1.js — deterministic top-1 retrieval baseline from the registry.
 *
 * For every state/registry.json entry whose `name` has exactly one provenance
 * lesson, runs search.js for that name and records whether the expected
 * lesson ranks first. Writes registry-top1.json (registry order preserved).
 *
 * `provenance[].lesson` is the topic-index `id` field, NOT `lesson_number`
 * (topic-index has 49 lessons where id != lesson_number; registry.json, being
 * itself a JSON index, cites id — verified by cross-checking every provenance
 * value against both fields: all 100 distinct values found in topic-index ids,
 * 2 of them are not valid lesson_numbers at all).
 *
 * Guards against a concurrent writer (another session is actively editing
 * topic-index.json/semantic-index.json per this task's brief): hashes both
 * index files before and after the run and refuses to write a result built
 * from a torn read.
 *
 * Usage: node gen-registry-top1.js [--out <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const lib = require('./lib.js');

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: lib.REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    return null;
  }
}

function gitDirty() {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: lib.REPO_ROOT, encoding: 'utf8' });
    return out.trim().length > 0;
  } catch (e) {
    return null; // unknown
  }
}

function parseArgs(argv) {
  let out = path.join(lib.EVALS_DIR, 'registry-top1.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = path.resolve(argv[++i]);
  }
  return { out };
}

function main() {
  const { out } = parseArgs(process.argv.slice(2));

  const hashesBefore = lib.indexHashes();
  const registry = lib.loadRegistry();

  const singleProvenance = registry.entries.filter(e => Array.isArray(e.provenance) && e.provenance.length === 1);

  const cases = [];
  let errors = 0;
  for (const entry of singleProvenance) {
    const expectedId = entry.provenance[0].lesson;
    let passesToday = false;
    let reason = null;
    let topId = null;
    try {
      const results = lib.runSearch(entry.name, { top: 1 });
      topId = results[0] ? results[0].id : null;
      passesToday = topId === expectedId;
    } catch (err) {
      if (err.stopWordsOnly) {
        passesToday = false;
        reason = 'query is only stop words';
      } else {
        errors++;
        process.stderr.write(`ERROR searching for "${entry.name}": ${err.message}\n`);
        reason = 'search.js failed';
      }
    }
    const c = { name: entry.name, expected_id: expectedId, passes_today: passesToday };
    if (reason) c.reason = reason;
    if (!passesToday) c.top_id = topId;
    cases.push(c);
  }

  const hashesAfter = lib.indexHashes();
  if (hashesBefore.topic_index !== hashesAfter.topic_index || hashesBefore.semantic_index !== hashesAfter.semantic_index) {
    process.stderr.write(
      'ABORT: topic-index.json or semantic-index.json changed while this run was in progress\n' +
      '(a concurrent editor is active). Refusing to write a result built from a torn read.\n' +
      'Re-run once the other session finishes.\n'
    );
    process.exit(1);
  }

  if (errors > 0) {
    process.stderr.write(`ABORT: ${errors} search.js invocation(s) failed for reasons other than stop-words-only. Not writing output.\n`);
    process.exit(1);
  }

  const output = {
    generated_from_commit: gitHead(),
    worktree_dirty: gitDirty(),
    index_hashes: hashesAfter,
    generated_at: new Date().toISOString(),
    cases,
  };

  fs.writeFileSync(out, JSON.stringify(output, null, 2) + '\n');

  const total = cases.length;
  const passing = cases.filter(c => c.passes_today).length;
  const misses = cases.filter(c => !c.passes_today);

  console.log(`registry-top1: ${total} single-provenance entries out of ${registry.entries.length} total`);
  console.log(`  passing today: ${passing}`);
  console.log(`  known misses:  ${misses.length}`);
  if (misses.length) {
    console.log('  example misses (up to 5):');
    for (const m of misses.slice(0, 5)) {
      console.log(`    "${m.name}" — expected L${m.expected_id}, got ${m.top_id === null ? 'no result' : 'L' + m.top_id}${m.reason ? ` (${m.reason})` : ''}`);
    }
  }
  console.log(`wrote ${out}`);
}

main();
