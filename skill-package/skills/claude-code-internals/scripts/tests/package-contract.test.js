'use strict';

/**
 * package-contract.test.js — cheap regression guards for the phase-5 fixes that
 * nothing else covers:
 *   - SKILL.md's search command uses the literal $ARGUMENTS placeholder (the
 *     harness substitution token) and never the lowercase $argument, which would
 *     be passed through verbatim and break the command.
 *   - the plugin root carries no top-level bin/: claude.ai organization distribution rejects such a
 *     plugin outright ("Plugin contains a top-level bin/ directory"), and `claude plugin validate`
 *     does not warn. SKILL.md runs the scripts by path instead.
 *   - search.js prints results in the "(id N" form the SKILL.md routing relies on.
 *
 * The plugin root (skill-package/) is NOT in the shipped skill zip, so that guard
 * skips in the standalone package (repo-context.js). SKILL.md and search.js both
 * ship, so their guards run everywhere.
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

test('the plugin root ships no top-level bin/ (org distribution rejects it)', (t) => {
  if (!IN_REPO) { t.skip(STANDALONE_SKIP); return; }
  assert.ok(fs.existsSync(path.join(PKG_DIR, '.claude-plugin', 'plugin.json')), 'skill-package is no longer the plugin root');
  const bin = path.join(PKG_DIR, 'bin');
  const entries = fs.existsSync(bin) ? fs.readdirSync(bin) : [];
  assert.deepStrictEqual(entries, [], 'skill-package/bin/ is back; a plugin with a top-level bin/ cannot be distributed through a claude.ai organization');
});

test('SKILL.md runs the scripts by path, not through a PATH launcher', () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(skill, /\$\{CLAUDE_SKILL_DIR\}\/scripts/, 'SKILL.md no longer names ${CLAUDE_SKILL_DIR}/scripts');
  assert.doesNotMatch(skill, /`claude-code-internals (search|state|xref|troubleshoot|fetch-lesson)\b/, 'SKILL.md calls the removed launcher');
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
