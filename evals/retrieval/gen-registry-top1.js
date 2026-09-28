#!/usr/bin/env node
/**
 * gen-registry-top1.js — deterministic top-1 retrieval baseline from the registry.
 *
 * For every state/registry.json entry whose `name` has exactly one provenance
 * lesson, runs search.js for that name and records whether the expected
 * lesson ranks first, and whether that lesson is a dev or holdout lesson of
 * the current question set's split (lib.CURRENT_QUESTIONS). Writes registry-top1.json (registry order
 * preserved). The gate over it (registry-gate.js, run by
 * tests/registry-top1.test.js) is net on dev-lesson cases with a named-loss
 * list (registry-top1-losses.json) and only reports holdout-lesson cases.
 * Regenerating moves the gate's reference point, so the file records what changed
 * against the one it replaces (`changes_vs_previous`: lost and gained cases per
 * split) and the split it classified them by (`split_sha256`).
 *
 * `provenance[].lesson` is the topic-index `id` field, NOT `lesson_number`
 * (topic-index has 49 lessons where id != lesson_number; registry.json, being
 * itself a JSON index, cites id — verified by cross-checking every provenance
 * value against both fields: all 100 distinct values found in topic-index ids,
 * 2 of them are not valid lesson_numbers at all).
 *
 * Guards against a concurrent writer (another session editing topic-index.json
 * or registry.json, the two inputs): hashes both files before and after the run and refuses to write a result built
 * from a torn read.
 *
 * Usage: node gen-registry-top1.js [--out <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const lib = require('./lib.js');

const SPLIT_SOURCE = lib.CURRENT_QUESTIONS; // the gated question set (lib.js)
const LOSSES_FILE = 'registry-top1-losses.json';

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
  // The lesson split the gate follows (registry-gate.js): holdout-lesson cases are reported, never gated.
  const { split } = JSON.parse(fs.readFileSync(path.join(lib.EVALS_DIR, SPLIT_SOURCE), 'utf8'));
  const holdout = new Set(split.holdout);

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
    const c = { name: entry.name, expected_id: expectedId, split: holdout.has(expectedId) ? 'holdout' : 'dev', passes_today: passesToday };
    if (reason) c.reason = reason;
    if (!passesToday) c.top_id = topId;
    cases.push(c);
  }

  const hashesAfter = lib.indexHashes();
  if (hashesBefore.topic_index !== hashesAfter.topic_index || hashesBefore.registry !== hashesAfter.registry) {
    process.stderr.write(
      'ABORT: topic-index.json or registry.json changed while this run was in progress\n' +
      '(a concurrent editor is active). Refusing to write a result built from a torn read.\n' +
      'Re-run once the other session finishes.\n'
    );
    process.exit(1);
  }

  if (errors > 0) {
    process.stderr.write(`ABORT: ${errors} search.js invocation(s) failed for reasons other than stop-words-only. Not writing output.\n`);
    process.exit(1);
  }

  // What changed against the file being replaced: a case it recorded passing that now
  // misses (lost), or recorded missing that now passes (gained), by the current split.
  // Regenerating resets the gate's reference point, so the losses are written down here.
  const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  let changes = null;
  if (previous && Array.isArray(previous.cases)) {
    const before = new Map(previous.cases.map((c) => [c.name, c]));
    const diff = { lost: [], gained: [] };
    for (const c of cases) {
      const b = before.get(c.name);
      if (!b || b.expected_id !== c.expected_id || b.passes_today === c.passes_today) continue;
      const row = { name: c.name, expected_id: c.expected_id, split: c.split };
      if (b.passes_today) diff.lost.push({ ...row, top_id: c.top_id });
      else diff.gained.push(row);
    }
    const bySplit = (xs, side) => xs.filter((x) => x.split === side);
    changes = {
      previous_commit: previous.generated_from_commit || null,
      previous_generated_at: previous.generated_at || null,
      dev: { lost: bySplit(diff.lost, 'dev'), gained: bySplit(diff.gained, 'dev') },
      holdout: { lost: bySplit(diff.lost, 'holdout'), gained: bySplit(diff.gained, 'holdout') },
      new_cases: cases.filter((c) => !before.has(c.name)).map((c) => c.name),
      removed_cases: previous.cases.filter((c) => !cases.some((x) => x.name === c.name)).map((c) => c.name),
    };
  }

  const output = {
    generated_from_commit: gitHead(),
    worktree_dirty: gitDirty(),
    index_hashes: hashesAfter,
    generated_at: new Date().toISOString(),
    split_source: SPLIT_SOURCE,
    split_sha256: lib.splitHash(split),
    ...(changes ? { changes_vs_previous: changes } : {}),
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
  if (changes) {
    const names = (xs) => xs.map((x) => `"${x.name}" (L${x.expected_id}${x.top_id !== undefined ? ` -> ${x.top_id === null ? 'none' : 'L' + x.top_id}` : ''})`).join(', ') || 'none';
    console.log(`changes vs the previous file (${changes.previous_commit || 'unknown commit'}):`);
    for (const side of ['dev', 'holdout']) {
      console.log(`  ${side}: lost ${changes[side].lost.length}: ${names(changes[side].lost)}`);
      console.log(`  ${side}: gained ${changes[side].gained.length}: ${names(changes[side].gained)}`);
    }
  }
  console.log(`wrote ${out}`);
  const lossesPath = path.join(lib.EVALS_DIR, LOSSES_FILE);
  const named = fs.existsSync(lossesPath) ? JSON.parse(fs.readFileSync(lossesPath, 'utf8')).losses : [];
  if (named.length) {
    console.log(`note: every case now records its current result, so the ${named.length} named loss(es) in ${LOSSES_FILE} ` +
      'are stale and fail the gate: empty its "losses" list in the same commit');
  }
}

main();
