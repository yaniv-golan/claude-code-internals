'use strict';
/**
 * repo-context.js — where these tests run: in the repository (a git checkout, or
 * scripts/check-clean.sh's copy of the tracked files, which has no .git), or in the
 * shipped skill package (a zip of skill-package/skills/claude-code-internals, with
 * no evals/ and no data/ beside it). Not a test file (the suite runs *.test.js).
 *
 * A test that needs repository files skips ONLY in the shipped package. In the
 * repository a missing file is a failure, never a skip: a file left out of a
 * commit must not silently remove the check that reads it.
 *
 * The package is recognised by the absence of every repository marker; the
 * markers are independent, so one lost file cannot flip the answer:
 *   - the skill directory sits at <root>/skill-package/skills/<name> (the zip has
 *     no skill-package/ level);
 *   - <root>/.git exists (a checkout or worktree);
 *   - <root>/evals exists.
 */
const fs = require('node:fs');
const path = require('node:path');

const SKILL_DIR = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(SKILL_DIR, '..', '..', '..');

function isRepoCheckout(skillDir = SKILL_DIR) {
  const root = path.resolve(skillDir, '..', '..', '..');
  return path.basename(path.resolve(skillDir, '..', '..')) === 'skill-package'
    || fs.existsSync(path.join(root, '.git'))
    || fs.existsSync(path.join(root, 'evals'));
}

const IN_REPO = isRepoCheckout();
const STANDALONE_SKIP = 'shipped skill package (no skill-package/, .git or evals/ above the skill directory): repository files are not part of it';

/**
 * The gated question set and its baseline, as absolute paths:
 * evals/retrieval/lib.js's CURRENT_QUESTIONS / CURRENT_BASELINE, the one place
 * they are named. Read lazily (only when called), so this module still loads in
 * the shipped package, where evals/ is absent; call it only in the repository.
 */
function currentEvalFiles(root = REPO_ROOT) {
  const evals = path.join(root, 'evals', 'retrieval');
  const { CURRENT_QUESTIONS, CURRENT_BASELINE } = require(path.join(evals, 'lib.js'));
  return { questions: path.join(evals, CURRENT_QUESTIONS), baseline: path.join(evals, CURRENT_BASELINE) };
}

/** The lesson split of the gated question set (currentEvalFiles().questions): {dev, holdout} as Sets. */
function loadSplit(root = REPO_ROOT) {
  const file = currentEvalFiles(root).questions;
  const { split } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!split || !Array.isArray(split.dev) || !Array.isArray(split.holdout)) throw new Error(`${path.basename(file)} must carry the lesson split {dev, holdout}`);
  return { dev: new Set(split.dev), holdout: new Set(split.holdout), raw: split };
}

module.exports = { SKILL_DIR, REPO_ROOT, IN_REPO, STANDALONE_SKIP, isRepoCheckout, currentEvalFiles, loadSplit };
