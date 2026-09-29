'use strict';
/**
 * sandbox.js — an offline playground for scripts/release.js: a git repository
 * copied from this checkout's files (from disk, not from git, so it also works in
 * check-clean.sh's .git-less copy), a local bare repository as its `origin`, and
 * fake `gh` / `claude` executables (fixtures/). Not a test file (the suite runs
 * *.test.js); used by release.test.js and by hand:
 *
 *   node scripts/tests/sandbox.js <dir>     create a sandbox in <dir> (must not exist)
 *                                           and print the env to run release.js in it
 *
 * The fake gh is named `gh` unless makeSandbox(dir, { ghName }) says otherwise, and
 * a tripwire directory comes first on the release's PATH: its `gh` and `claude`
 * fail loudly and log to <base>/tripwire.log, so anything that resolves either by
 * name instead of through RELEASE_GH / RELEASE_CLAUDE is caught, and the user's
 * real, authenticated gh is never reachable from a test.
 *
 * Git runs with GIT_CONFIG_NOSYSTEM=1 and GIT_CONFIG_GLOBAL pointing at the
 * sandbox's own config, so the user's global hooksPath / signing settings do not
 * leak in, and inherited GIT_DIR & co. are dropped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SKILL_REL = 'skill-package/skills/claude-code-internals';
const FIXTURES = path.join(__dirname, 'fixtures');
// What release.js and its fast validation read. site/ and evals/ are not needed.
const COPY_MIN = ['skill-package', 'data', '.claude-plugin', '.github', 'scripts', 'README.md', 'CHANGELOG.md', '.gitignore', 'LICENSE'];
const SKIP = new Set(['.git', 'node_modules', '.DS_Store']);

// Fast stand-in for check-clean.sh: the pin/count consistency tests (they fail if
// the bump missed a pin) and build.js --check (derived fields, keywords, vocabulary).
const FAST_VALIDATE = [
  `"${process.execPath}" --test ${SKILL_REL}/scripts/tests/release-consistency.test.js`,
  `"${process.execPath}" ${SKILL_REL}/scripts/build.js --check`,
].join(' && ');

function baseEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(GIT_|RELEASE_|FAKE_GH_|FAKE_CLAUDE_)/.test(k) || k === 'CLAUDE_CONFIG_DIR' || k === 'NODE_TEST_CONTEXT') continue;
    env[k] = v;
  }
  return env;
}

function sh(cmd, args, { cwd, env, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!allowFail && r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} (in ${cwd}) failed: ${r.stderr || r.error}`);
  return (r.stdout || '').trim();
}

function writeGitConfig(file) {
  fs.writeFileSync(file, [
    '[user]', '\tname = Release Sandbox', '\temail = sandbox@example.invalid',
    '[commit]', '\tgpgsign = false', '[tag]', '\tgpgsign = false',
    '[init]', '\tdefaultBranch = main', '[advice]', '\tdetachedHead = false', '',
  ].join('\n'));
}

const templateDirs = {};
/**
 * One committed copy of this checkout per process and mode; sandboxes clone it.
 * With `full` (the CLI's --full) every top-level entry is copied (still filtered
 * by .gitignore on commit), so the real scripts/check-clean.sh can validate it.
 */
function template(full = false) {
  const mode = full ? 'full' : 'min';
  if (templateDirs[mode]) return templateDirs[mode];
  const COPY = full
    ? fs.readdirSync(REPO_ROOT).filter((e) => !SKIP.has(e) && !['.claude', 'docs', 'ruvector'].includes(e))
    : COPY_MIN;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-release-template-'));
  const cfg = path.join(dir, 'gitconfig');
  writeGitConfig(cfg);
  const env = { ...baseEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: cfg };
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  for (const p of COPY) {
    const src = path.join(REPO_ROOT, p);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(repo, p), { recursive: true, filter: (s) => !SKIP.has(path.basename(s)) });
  }
  sh('git', ['init', '-q', '-b', 'main'], { cwd: repo, env });
  sh('git', ['add', '-A'], { cwd: repo, env });
  sh('git', ['commit', '-q', '-m', 'sandbox base'], { cwd: repo, env });
  templateDirs[mode] = repo;
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return repo;
}

/**
 * Create a sandbox. Returns {base, work, origin, env, version, changelog, ...helpers}.
 * `version` is the next patch version; `changelog` a valid entry file for it.
 */
function makeSandbox(base, { full = false, ghName = 'gh' } = {}) {
  if (!base) base = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-release-test-'));
  else fs.mkdirSync(base, { recursive: true });
  const work = path.join(base, 'work');
  const origin = path.join(base, 'origin.git');
  const bin = path.join(base, 'bin');
  const tmp = path.join(base, 'tmp');
  const tripwire = path.join(base, 'tripwire');
  const tripwireLog = path.join(base, 'tripwire.log');
  for (const d of [bin, tmp, tripwire, path.join(base, 'claude-config')]) fs.mkdirSync(d, { recursive: true });
  const cfg = path.join(base, 'gitconfig');
  writeGitConfig(cfg);
  for (const [name, file] of [[ghName, 'fake-gh.js'], ['claude', 'fake-claude.js']]) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${path.join(FIXTURES, file)}" "$@"\n`, { mode: 0o755 });
  }
  for (const name of ['gh', 'claude']) {
    fs.writeFileSync(path.join(tripwire, name),
      `#!/bin/sh\necho "TRIPWIRE: ${name} was run by name from PATH, not through its RELEASE_ stand-in: $*" >&2\n` +
      `printf '%s\\n' "${name} $*" >> "${tripwireLog}"\nexit 97\n`, { mode: 0o755 });
  }
  const gitEnv = { ...baseEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: cfg };
  const tpl = template(full);
  sh('git', ['clone', '-q', tpl, work], { env: gitEnv });
  sh('git', ['clone', '-q', '--bare', tpl, origin], { env: gitEnv });
  sh('git', ['remote', 'set-url', 'origin', origin], { cwd: work, env: gitEnv });
  sh('git', ['fetch', '-q', 'origin'], { cwd: work, env: gitEnv });
  sh('git', ['branch', '-q', '-u', 'origin/main', 'main'], { cwd: work, env: gitEnv });
  const descFile = path.join(base, 'live-description.txt');
  fs.writeFileSync(descFile, 'an old About text');
  const env = {
    ...gitEnv,
    PATH: `${tripwire}${path.delimiter}${gitEnv.PATH || ''}`,
    RELEASE_GH: path.join(bin, ghName),
    RELEASE_CLAUDE: path.join(bin, 'claude'),
    RELEASE_TMPDIR: tmp,
    RELEASE_POLL_INTERVAL_MS: '5',
    RELEASE_POLL_TIMEOUT_MS: '3000',
    RELEASE_RUN_APPEAR_TIMEOUT_MS: '300',
    RELEASE_VALIDATE_CMD: FAST_VALIDATE,
    FAKE_GH_ORIGIN: origin,
    FAKE_GH_LOG: path.join(base, 'gh.log'),
    FAKE_GH_STATE: path.join(base, 'gh-state.json'),
    FAKE_GH_DESCRIPTION_FILE: descFile,
    FAKE_CLAUDE_LOG: path.join(base, 'claude.log'),
    CLAUDE_CONFIG_DIR: path.join(base, 'claude-config'),
  };
  const current = JSON.parse(fs.readFileSync(path.join(work, SKILL_REL, 'version.json'), 'utf8')).skill_version;
  const [ma, mi, pa] = current.split('.').map(Number);
  const version = `${ma}.${mi}.${pa + 1}`;
  const changelog = path.join(base, 'entry.md');
  fs.writeFileSync(changelog, `## v${version} — 2026-09-29 (this fork) — a sandbox release\n\nNo new lessons; counts unchanged.\n\n- A test entry.\n`);

  const git = (args, opts = {}) => sh('git', args, { cwd: work, env: gitEnv, ...opts });
  const gitOrigin = (args, opts = {}) => sh('git', ['--git-dir', origin, ...args], { env: gitEnv, ...opts });
  const script = path.join(work, 'scripts', 'release.js');
  /**
   * Run release.js asynchronously; resolves {code, signal, out}. A run that
   * outlives `timeoutMs` is killed and reported (code null, out ends with a
   * TIMED OUT line), so a hang fails its test instead of stalling the suite.
   */
  const release = (args, extraEnv = {}, { timeoutMs = 180000 } = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: work, env: { ...env, ...extraEnv } });
    let out = '';
    const timer = setTimeout(() => { out += `\nsandbox: TIMED OUT after ${timeoutMs}ms, killed\n`; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out }); });
  });
  const tripwireCalls = () => (fs.existsSync(tripwireLog) ? fs.readFileSync(tripwireLog, 'utf8').split('\n').filter(Boolean) : []);
  const ghCalls = () => (fs.existsSync(env.FAKE_GH_LOG) ? fs.readFileSync(env.FAKE_GH_LOG, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
  const journal = path.join(work, '.git', 'release-journal.json');
  const hook = (name, body) => fs.writeFileSync(path.join(work, '.git', 'hooks', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const cleanup = () => fs.rmSync(base, { recursive: true, force: true });
  return { base, work, origin, bin, tmp, tripwireCalls, env, gitEnv, current, version, changelog, git, gitOrigin, release, ghCalls, journal, hook, cleanup, script };
}

module.exports = { makeSandbox, FAST_VALIDATE, SKILL_REL, REPO_ROOT };

if (require.main === module) {
  const copyAll = process.argv.includes('--full');
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!dir || fs.existsSync(dir)) { process.stderr.write('usage: node scripts/tests/sandbox.js [--full] <new-dir>\n'); process.exit(2); }
  const s = makeSandbox(path.resolve(dir), { full: copyAll });
  // --full: validate with the real scripts/check-clean.sh, not the fast stand-in.
  const lines = Object.entries(s.env)
    .filter(([k]) => /^(GIT_CONFIG|RELEASE_|FAKE_|CLAUDE_CONFIG_DIR)/.test(k) && !(copyAll && k === 'RELEASE_VALIDATE_CMD'))
    .map(([k, v]) => `export ${k}='${v}'`);
  // Save this as env.sh and source it only in a SUBSHELL: it points git at the
  // sandbox identity and config, which must never leak into a real release.
  process.stdout.write(`${lines.join('\n')}\n# usage (subshell, so the sandbox git identity cannot leak):\n` +
    `#   ( source env.sh && cd ${s.work} && node scripts/release.js --version ${s.version} --changelog ${s.changelog} )\n`);
}
