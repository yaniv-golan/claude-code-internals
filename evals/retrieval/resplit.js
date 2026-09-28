#!/usr/bin/env node
/**
 * resplit.js — apply the split rule to a committed question set.
 *
 * The rule (lib.applyHardTestRule): a seeded random split, then every lesson a hard
 * ranking test asserts (skill-package/.../scripts/tests/ranking-cases.json) is moved
 * to dev. gen-questions.js and gen-relevance.js apply it when they write a set; this
 * applies it to a set already written, for when a hard test is added that names one of
 * its holdout lessons (corpus-ranking.test.js's guard fails until then).
 *
 * The file's random split is recovered first (holdout plus any lessons it already
 * moved), so the result depends only on (random split, ranking-cases.json) and
 * re-running is a no-op. `split` gains `rule`, `hard_tests` and `moved_to_dev`
 * (lesson, reason, the queries that assert it); the moved lessons' questions are
 * relabelled dev (a state question by its recorded `split_lesson_id`; the live
 * registry is not read, so a registry edit never moves a question).
 * A hard test removed since the last run sends its lesson, and its questions, back
 * to the side the random split gave them.
 * Question texts, qids, relevance sets and `version` are unchanged — but a baseline
 * recorded under the old split can no longer be compared (run.js refuses), so a new
 * baseline is cut in the same commit.
 *
 * Usage:
 *   node resplit.js <questions-vN.json>           rewrite the file in place
 *   node resplit.js <questions-vN.json> --check   exit 1 if the file is not up to date
 */

'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib.js');

/** The file's data with the rule applied: {data, moved, relabelled} (pure apart from reading the hard tests). */
function resplit(data, hard = lib.loadHardTestLessons()) {
  const split = lib.applyHardTestRule(data.split, hard);
  const questions = lib.relabelQuestions(data.questions, split, data.split);
  const relabelled = questions.filter((q, i) => q.split !== data.questions[i].split).map((q) => q.qid);
  return { data: { ...data, split, questions }, moved: split.moved_to_dev.map((m) => m.lesson_id), relabelled };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { process.stderr.write('Usage: resplit.js <questions-vN.json> [--check]\n'); process.exit(1); }
  const p = path.resolve(file);
  const before = fs.readFileSync(p, 'utf8');
  const r = resplit(JSON.parse(before));
  const after = JSON.stringify(r.data, null, 2) + '\n';
  console.log(`${path.basename(p)}: moved to dev: ${r.moved.join(', ') || 'none'}; questions relabelled by this run: ${r.relabelled.join(', ') || 'none'}`);
  if (check) {
    if (after !== before) { console.log('NOT up to date: run node evals/retrieval/resplit.js ' + file); process.exit(1); }
    console.log('up to date');
    return;
  }
  if (after !== before) fs.writeFileSync(p, after);
  console.log(after === before ? 'unchanged' : `wrote ${p}`);
}

module.exports = { resplit };

if (require.main === module) main();
