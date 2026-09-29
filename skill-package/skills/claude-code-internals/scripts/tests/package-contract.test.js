'use strict';

/**
 * package-contract.test.js — cheap regression guards for the phase-5 fixes that
 * nothing else covers:
 *   - SKILL.md's search command uses the literal $ARGUMENTS placeholder (the
 *     harness substitution token) and never the lowercase $argument, which would
 *     be passed through verbatim and break the command.
 *   - bin/claude-code-internals resolves its own scripts and runs them.
 *   - search.js prints results in the "(id N" form the SKILL.md routing relies on.
 *
 * bin/ lives under skill-package/ and is NOT in the shipped skill zip, so that
 * guard skips in the standalone package (repo-context.js). SKILL.md and search.js
 * both ship, so their guards run everywhere.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { SKILL_DIR, IN_REPO, STANDALONE_SKIP } = require('./repo-context.js');
const PKG_DIR = path.resolve(SKILL_DIR, '..', '..');            // skill-package
const SCRIPTS = path.join(SKILL_DIR, 'scripts');

test('SKILL.md uses $ARGUMENTS and never the lowercase $argument', () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(skill, /\$ARGUMENTS/, 'SKILL.md no longer references $ARGUMENTS');
  assert.doesNotMatch(skill, /\$argument\b/, 'SKILL.md uses the lowercase $argument (harness would not substitute it)');
});

test('bin/claude-code-internals resolves its scripts and runs fetch-lesson', (t) => {
  if (!IN_REPO) { t.skip(STANDALONE_SKIP); return; }
  const launcher = path.join(PKG_DIR, 'bin', 'claude-code-internals');
  assert.ok(fs.existsSync(launcher), 'skill-package/bin/claude-code-internals is missing');
  // Invoke via an explicit `bash` so the guard does not depend on the exec bit
  // surviving the test copy; the launcher resolves the scripts relative to itself.
  const out = execFileSync('bash', [launcher, 'fetch-lesson', '32'], { encoding: 'utf8' });
  assert.match(out, /Hooks System/, 'launcher did not print lesson 32 (Hooks System)');
});

test('search.js prints results in the "(id N" form', () => {
  const out = execFileSync('node', [path.join(SCRIPTS, 'search.js'), 'hooks', '--top=5'], {
    encoding: 'utf8',
    env: { ...process.env, CCI_NO_INDEX_CACHE: '1' },
  });
  assert.match(out, /\(id 32/, 'search.js "hooks" output no longer prints the "(id 32" form');
});

test('troubleshoot.js exits 0 on a no-match (a no-match is not an error)', () => {
  // Consistency with state.js: an empty result exits 0, so a shell caller that
  // counts non-zero exits as tool errors is not tripped by "no hints matched".
  const r = spawnSync('node', [path.join(SCRIPTS, 'troubleshoot.js'), 'zzznomatchxyz'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'troubleshoot.js should exit 0 on a no-match');
  assert.match(r.stdout, /No troubleshooting hints matched/);
});
