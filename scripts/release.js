#!/usr/bin/env node
/**
 * release.js — cut a release of the claude-code-internals skill.
 *
 *   node scripts/release.js --version <x.y.z|patch|minor|major> --changelog <file> [--message <file>] [--publish]
 *   node scripts/release.js --version ... --changelog <file> --dry-run
 *   node scripts/release.js --resume [--publish]
 *   node scripts/release.js --abandon
 *
 * Content changes (lessons, state layer, README counts) are committed on main
 * BEFORE a release. The release commit carries only the version bump, the
 * CHANGELOG entry and whatever build.js re-derives.
 *
 * HARD RULES. Stage by exact name only. No commit that the push publishes (the
 * release commit and every content commit between origin/main and it) carries a
 * `Co-Authored-By: …Claude…` or `Claude-Session:` trailer, or touches anything
 * under docs/internal/. One tag per push (`--no-follow-tags`, explicit refspec).
 * Nothing is ever reset or restored: on any unexpected state the script STOPS
 * and says what it saw.
 *
 * REMOTE. Every effective fetch and push URL of the remote (after insteadOf /
 * pushInsteadOf) must be one and the same URL; the journal records it, the
 * remote name and the GitHub repo, and a resume or abandon refuses to run when
 * any of them changed.
 *
 * STEPS
 *   1. Preconditions: the index and worktree are clean (no untracked files
 *      either), HEAD is on main, and main is not behind origin/main (ahead is
 *      allowed: the content commits that precede a release ride along with it,
 *      so they are held to the hard rules too). The tag must not exist, locally
 *      or on the remote. If a journal exists, the run resumes it instead (step 6).
 *   2. Candidate: a temporary `git worktree` at HEAD, outside the repository
 *      ($RELEASE_TMPDIR or the OS temp dir). In it: every skill-version pin
 *      (scripts/lib/version-pins.js, the table release-consistency.test.js
 *      checks) is bumped, the --changelog entry is inserted at the top of
 *      CHANGELOG.md, and build.js re-derives its fields. No model calls: a
 *      lesson without committed vocabulary proposals makes build.js --check
 *      fail in step 3; a lesson whose proposal is STALE (edited since the model
 *      saw it) only warns, and step 3 lists those lessons with the command that
 *      regenerates them (to make stale block instead, flip
 *      STALE_VOCAB_BLOCKS in scripts/prepare-lessons.js). Any changed file
 *      outside the expected set stops the run.
 *   3. Validate the candidate tree: scripts/check-clean.sh run inside the
 *      candidate (script tests incl. release-consistency, repository script
 *      tests, JSON format, validate-state.js, state.js --audit, build.js
 *      --check, the retrieval gate, site tests, site build + disclosure lint).
 *      The tree is `git add`ed by exact name and its hash recorded first; after
 *      validation the index and worktree must still be exactly that tree.
 *   4. Commit in the candidate with `git commit -F`; hooks run. Then verify:
 *      the commit's tree is the validated tree; its only parent is the HEAD the
 *      run started from; `--name-only` is exactly the add list, none under
 *      docs/internal/; the committed message (read back, so a commit-msg hook
 *      cannot slip one in) has neither forbidden trailer; the candidate worktree
 *      is clean. Any mismatch deletes the candidate and stops; the user's
 *      worktree was never touched.
 *   5. Integrate: main is fast-forwarded (`git merge --ff-only`, which also
 *      updates the user's checked-out files) only if main is still the HEAD the
 *      run started from and the worktree is still clean; otherwise stop.
 *   6. Publish, journaled in <git-common-dir>/release-journal.json (untracked,
 *      per clone; written before the fast-forward so a crash at any point can
 *      be reconciled):
 *        push   the outgoing commits (remote main..candidate) are re-checked
 *               against the hard rules, then `git push --no-follow-tags
 *               --force-with-lease=refs/heads/main:<the checked remote SHA>
 *               <remote> <candidate>:refs/heads/main` (a fast-forward that is
 *               rejected if the branch moved after the check). Rejected: do NOT tag; stop
 *               (re-integrate, re-validate: --abandon, then rerun).
 *        tag    lightweight tag at the candidate; push that one tag.
 *        run    poll `gh run list --workflow=release.yml` for the run whose head
 *               SHA is the candidate, until it concludes (success required).
 *               Each gh call is killed at the poll deadline (recorded pending).
 *               No run at all within the appear timeout is reported separately:
 *               GitHub creates no push event for a push of more than three tags.
 *        asset  download claude-code-internals.zip from the release and compare
 *               every file (path + sha256) with `git archive` of the candidate's
 *               skill directory.
 *      On resume the journal's schema is validated and its candidate re-verified
 *      (tree, sole parent, version, tag name, paths, trailers) before anything
 *      else; then each step is reconciled against the remote first (branch SHA,
 *      tag, run state), so a crash between an action and its journal record
 *      neither repeats nor skips it. A completed journal is renamed to
 *      release-journal.v<version>.done.json. The journal also names the temporary
 *      candidate worktree and asset directory while they exist; a resume (after
 *      integrating) or an abandon removes the ones a crash left behind, when they
 *      are provably this run's, and reports any other.
 *   7. --publish also: scripts/sync-repo-description.sh --repo <repo> --gh <gh>
 *      --push (then --check), <gh> being the exact executable step 6 uses;
 *      `claude plugin marketplace update` + `claude plugin update` (or
 *      `install` when not yet installed); then reads the installed skill's
 *      version.json back through installed_plugins.json.
 *   8. --dry-run runs steps 1-3 offline (no fetch, no remote queries, no
 *      journal) and then deletes the candidate.
 *
 * ENVIRONMENT (all optional)
 *   RELEASE_REMOTE (origin)  RELEASE_REPO (yaniv-golan/claude-code-internals)
 *   RELEASE_GH (gh)  RELEASE_CLAUDE (claude)  RELEASE_TMPDIR (os.tmpdir())
 *   RELEASE_POLL_INTERVAL_MS (15000)  RELEASE_POLL_TIMEOUT_MS (1800000)
 *   RELEASE_RUN_APPEAR_TIMEOUT_MS (300000)  CLAUDE_CONFIG_DIR (~/.claude)
 * TEST-ONLY, honoured only when every URL of the remote is a local path (so a
 * variable left set can never weaken a real release):
 *   RELEASE_VALIDATE_CMD   shell command replacing check-clean.sh in step 3
 *   RELEASE_CRASH_AT       <step>:<after-action|after-record|before-action>; SIGKILLs itself there
 *   RELEASE_TEST_HOOK_<BEFORE_COMMIT|BEFORE_INTEGRATE|BEFORE_PUSH|BEFORE_TAG>  shell command run at that point
 * Against a local remote a (non-dry) run also requires RELEASE_GH, and --publish
 * RELEASE_CLAUDE, so a test release never reaches the real GitHub repo or plugin.
 *
 * Requires git, node, unzip, and (to publish) an authenticated gh.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SKILL_VERSION_PINS, bumpText } = require('../skill-package/skills/claude-code-internals/scripts/lib/version-pins.js');

const SKILL_REL = 'skill-package/skills/claude-code-internals';
const ZIP_NAME = 'claude-code-internals.zip';
const WORKFLOW = 'release.yml';
const BRANCH = 'main';
const PLUGIN_ID = 'claude-code-internals@claude-code-internals-marketplace';
const MARKETPLACE = 'claude-code-internals-marketplace';
const CHANGELOG = 'CHANGELOG.md';
// The routing parts are listed up to index-3 (the index may grow a part), and
// the state pages as they are on disk: build.js writes their read_more: field.
const BUILD_OUTPUTS = [
  `${SKILL_REL}/version.json`,
  `${SKILL_REL}/references/topic-index.json`,
  `${SKILL_REL}/references/cross-references.json`,
  `${SKILL_REL}/references/troubleshooting.json`,
  `${SKILL_REL}/references/catalog.md`,
  ...[1, 2, 3].map((n) => `${SKILL_REL}/references/routing/index-${n}.md`),
  `${SKILL_REL}/references/routing/sections.md`,
  ...(() => {
    const dir = path.join(__dirname, '..', SKILL_REL, 'references', 'state');
    try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort().map((f) => `${SKILL_REL}/references/state/${f}`); } catch { return []; }
  })(),
];
const FORBIDDEN_TRAILERS = [
  { name: 'Co-Authored-By: Claude', re: /^[ \t]*co-authored-by:.*claude/im },
  { name: 'Claude-Session:', re: /^[ \t]*claude-session:/im },
];
const HEADER_RE = /^## v(\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2}) \(this fork\) — (\S.*)$/;
const PUBLISH_STEPS = ['push', 'tag', 'run', 'asset'];
const EXTRA_STEPS = ['description', 'install'];
const CRASH_SIGNAL = 'SIGKILL';

class Stop extends Error {}

// --- small utilities ------------------------------------------------------------

const log = (msg) => process.stderr.write(`release: ${msg}\n`);

/** The environment for child processes: no inherited GIT_DIR & co., no RELEASE_* test knobs. */
function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR']) delete env[k];
  return { ...env, ...extra };
}
function validationEnv() {
  const env = childEnv();
  for (const k of Object.keys(env)) if (k.startsWith('RELEASE_')) delete env[k];
  // Set by a parent `node --test`; a child `node --test` that inherits it
  // silently skips every file ("run() is being called recursively").
  delete env.NODE_TEST_CONTEXT;
  return env;
}

class Timeout extends Stop {}

function run(cmd, args, { cwd, allowFail = false, env = childEnv(), inherit = false, input, trim = true, timeout } = {}) {
  const r = spawnSync(cmd, args, {
    cwd, env, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
    ...(timeout !== undefined ? { timeout: Math.max(1, Math.floor(timeout)), killSignal: 'SIGKILL' } : {}),
  });
  // A timed-out child is never an ordinary failure, even with allowFail.
  if (r.error && r.error.code === 'ETIMEDOUT') throw new Timeout(`${cmd} ${args.join(' ')} did not return within ${Math.round(timeout)}ms`);
  if (r.error) {
    if (allowFail) return { code: -1, out: '', err: String(r.error.message) };
    throw new Stop(`could not run ${cmd}: ${r.error.message}`);
  }
  const stdout = r.stdout || '';
  const res = { code: r.status, out: trim ? stdout.trim() : stdout, err: (r.stderr || '').trim() };
  if (res.code !== 0 && !allowFail) {
    throw new Stop(`${cmd} ${args.join(' ')} failed (exit ${res.code})${res.err ? `:\n${res.err}` : ''}`);
  }
  return res;
}
const git = (cwd, args, opts = {}) => run('git', args, { cwd, ...opts });
const gitOut = (cwd, args) => git(cwd, args).out;
const revParse = (cwd, ref) => {
  const r = git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true });
  return r.code === 0 ? r.out : null;
};
const isAncestor = (cwd, a, b) => git(cwd, ['merge-base', '--is-ancestor', a, b], { allowFail: true }).code === 0;
const hasObject = (cwd, sha) => git(cwd, ['cat-file', '-e', `${sha}^{commit}`], { allowFail: true }).code === 0;

/**
 * Split git's `-z` output into paths. Without -z git C-quotes any path holding a
 * tab, newline, double quote, backslash or (core.quotePath) non-ASCII byte, so
 * `docs/internal/a<TAB>.md` would read as `"docs/internal/a\t.md"` and slip past a
 * prefix test. Every path a safety decision reads goes through -z and this.
 */
function splitNul(out) { return out.split('\0').filter(Boolean); }
/** `git <args> -z`, untrimmed (a path may begin or end in whitespace), as a path list. */
const gitPaths = (cwd, [sub, ...rest]) => splitNul(git(cwd, [sub, '-z', ...rest], { trim: false }).out);
const INTERNAL = 'docs/internal/';
const internalPaths = (paths) => [...new Set(paths)].filter((p) => p.startsWith(INTERNAL)).sort();

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeFileAtomic(p, text) {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

function cmpSemver(a, b) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
function nextVersion(current, spec) {
  const [ma, mi, pa] = current.split('.').map(Number);
  if (spec === 'patch') return `${ma}.${mi}.${pa + 1}`;
  if (spec === 'minor') return `${ma}.${mi + 1}.0`;
  if (spec === 'major') return `${ma + 1}.0.0`;
  if (!/^\d+\.\d+\.\d+$/.test(spec || '')) throw new Stop(`--version must be x.y.z, patch, minor or major (got ${spec})`);
  if (cmpSemver(spec, current) <= 0) throw new Stop(`--version ${spec} is not above the current ${current}`);
  return spec;
}

/**
 * A remote URL that git treats as a local filesystem path: the only case in which
 * test-only knobs are honoured. Follows git's own classification (connect.c /
 * transport.c): a `<scheme>://` URL is local only as file://; `<transport>::…`
 * and scp-like `host:path` (a colon before the first slash) are remote; anything
 * else — absolute, `./`, `../` or bare relative like `origin.git` — is a path.
 * On Windows a drive prefix (`C:/…`, `C:\…`) and a UNC path are paths; on POSIX
 * git reads `C:/x` as host "C", so it stays remote there. Existence on disk is
 * deliberately not consulted (racy, and relative to an ambiguous base).
 */
function isLocalRemote(url, platform = process.platform) {
  if (!url) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) return /^file:\/\//i.test(url);
  if (platform === 'win32' && (/^[A-Za-z]:[\\/]/.test(url) || /^\\\\/.test(url))) return true;
  const firstSep = url.search(platform === 'win32' ? /[\\/]/ : /\//);
  const colon = url.indexOf(':');
  if (colon >= 0 && (firstSep < 0 || colon < firstSep)) return false;   // scp-like host:path, or transport::address
  return true;
}

/** Returns the forbidden trailers found in a commit message. */
function forbiddenTrailers(message) {
  return FORBIDDEN_TRAILERS.filter((t) => t.re.test(message)).map((t) => t.name);
}

/** The files a release commit must change (required) and may change (allowed). */
function releaseFiles() {
  const required = new Set([...new Set(SKILL_VERSION_PINS.map((p) => p.file)), CHANGELOG]);
  return { required, allowed: new Set([...required, ...BUILD_OUTPUTS]) };
}

/**
 * The hard rules over every commit a push of `tip` publishes (`base`..`tip`; the
 * whole history when the remote branch does not exist yet). Paths are collected
 * per commit (`-m`: merges too), so a docs/internal/ file added and deleted again
 * inside the range, whose objects would still be pushed, is caught.
 */
function outgoingProblems(cwd, base, tip) {
  const range = base ? [`${base}..${tip}`] : [tip];
  const problems = [];
  const shas = gitOut(cwd, ['rev-list', ...range]).split('\n').filter(Boolean);
  for (const sha of shas) {
    const found = forbiddenTrailers(gitOut(cwd, ['log', '-1', '--format=%B', sha]));
    if (found.length) problems.push(`commit ${sha.slice(0, 12)} carries ${found.join(' and ')}`);
  }
  // -z (NUL-separated, never quoted): see splitNul. `--` ends the options.
  const paths = gitPaths(cwd, ['log', '--format=', '--name-only', '--no-renames', '-m', ...range, '--']);
  if (base) paths.push(...gitPaths(cwd, ['diff', '--name-only', '--no-renames', base, tip, '--']));
  const internal = internalPaths(paths);
  if (internal.length) problems.push(`the outgoing commits touch docs/internal/: ${internal.map((p) => JSON.stringify(p)).join(', ')}`);
  return problems;
}
function assertOutgoing(ctx, base, tip, when) {
  const problems = outgoingProblems(ctx.root, base, tip);
  if (problems.length) {
    throw new Stop(`${when}: the push would publish commits that break the hard rules:\n  - ${problems.join('\n  - ')}\n` +
      'Rewrite those unpublished commits (they are yours, not yet on the remote), then release again.');
  }
}

/**
 * Parse a --changelog file: its first non-blank line is the entry header
 * `## v<version> — <YYYY-MM-DD> (this fork) — <title>`, followed by a body.
 */
function parseChangelogEntry(text, version) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  const m = (lines[0] || '').match(HEADER_RE);
  if (!m) throw new Stop(`the changelog entry must start with "## v${version} — YYYY-MM-DD (this fork) — <title>" (got "${(lines[0] || '').slice(0, 80)}")`);
  if (m[1] !== version) throw new Stop(`the changelog entry is for v${m[1]}, but this release is v${version}`);
  if (Number.isNaN(Date.parse(m[2]))) throw new Stop(`the changelog entry date ${m[2]} is not a date`);
  const body = lines.slice(1).join('\n').trim();
  if (!body) throw new Stop('the changelog entry has no body');
  if (/^## /m.test(body)) throw new Stop('the changelog entry holds more than one "## " heading');
  return { header: lines[0], title: m[3].trim(), body, entry: `${lines[0]}\n\n${body}\n` };
}

function insertChangelog(text, entry, version) {
  if (!text.startsWith('# Changelog\n')) throw new Stop(`${CHANGELOG} does not start with "# Changelog"`);
  if (new RegExp(`^## v${version.replace(/\./g, '\\.')} `, 'm').test(text)) throw new Stop(`${CHANGELOG} already has an entry for v${version}`);
  const at = text.search(/^## /m);
  if (at < 0) return `${text.trimEnd()}\n\n${entry}`;
  return `${text.slice(0, at)}${entry}\n${text.slice(at)}`;
}

/** Every file (not directory) under dir, as relative path -> sha256; symlinks hash their target string. */
function hashTree(dir) {
  const out = new Map();
  const walk = (rel) => {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      const abs = path.join(dir, r);
      if (ent.isDirectory()) walk(r);
      else if (ent.isSymbolicLink()) out.set(r, `link:${fs.readlinkSync(abs)}`);
      else out.set(r, require('crypto').createHash('sha256').update(fs.readFileSync(abs)).digest('hex'));
    }
  };
  walk('');
  return out;
}
function diffTrees(a, b) {
  const lines = [];
  for (const [k, h] of a) if (!b.has(k)) lines.push(`only in the release asset: ${k}`); else if (b.get(k) !== h) lines.push(`differs: ${k}`);
  for (const k of b.keys()) if (!a.has(k)) lines.push(`missing from the release asset: ${k}`);
  return lines;
}

// --- context ----------------------------------------------------------------------

/**
 * The one URL the remote fetches from and pushes to. `git remote get-url` applies
 * insteadOf, and `--push` pushurl / pushInsteadOf, so these are the destinations
 * git really uses. More than one distinct URL (a pushurl or pushInsteadOf that
 * differs from the fetch URL, or several URLs) is refused: the remote queries
 * (ls-remote, fetch) would then describe a different place than the push writes,
 * and a local fetch URL could enable the test-only knobs on a real push.
 */
function effectiveRemoteUrl(root, remote) {
  const fetchUrls = git(root, ['remote', 'get-url', '--all', remote], { allowFail: true });
  if (fetchUrls.code !== 0) throw new Stop(`no remote named ${remote}`);
  const pushUrls = git(root, ['remote', 'get-url', '--push', '--all', remote], { allowFail: true });
  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const f = lines(fetchUrls.out); const p = lines(pushUrls.out);
  const all = [...new Set([...f, ...p])];
  if (!f.length || !p.length || all.length !== 1 || f.length !== 1 || p.length !== 1) {
    throw new Stop(`the remote ${remote} does not fetch from and push to one single URL (fetch: ${f.join(', ') || 'none'}; push: ${p.join(', ') || 'none'}, ` +
      'after insteadOf/pushInsteadOf); a release needs its queries and its push to reach the same place. Remove the pushurl / pushInsteadOf, or use a remote without one (RELEASE_REMOTE).');
  }
  return all[0];
}

function makeContext() {
  const cwdTop = run('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), allowFail: true });
  if (cwdTop.code !== 0) throw new Stop('run this from inside the repository');
  const root = fs.realpathSync(cwdTop.out);
  if (fs.realpathSync(path.resolve(__dirname, '..')) !== root) {
    throw new Stop(`this release.js belongs to ${path.resolve(__dirname, '..')}, but the current repository is ${root}`);
  }
  const remote = process.env.RELEASE_REMOTE || 'origin';
  const remoteUrl = effectiveRemoteUrl(root, remote);
  const local = isLocalRemote(remoteUrl);
  const commonDir = path.resolve(root, gitOut(root, ['rev-parse', '--git-common-dir']));
  const tmpBase = fs.realpathSync(process.env.RELEASE_TMPDIR || os.tmpdir());
  const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
  // A stand-in given as a path is made absolute here, against the directory the
  // user ran from, so every consumer (gh(), sync-repo-description.sh) runs that
  // one file whatever its cwd. A bare name (the default `gh`) stays a PATH lookup.
  const exe = (v, d) => (!v ? d : /[\\/]/.test(v) ? path.resolve(v) : v);
  return {
    root, remote, remoteUrl, local,
    repo: process.env.RELEASE_REPO || 'yaniv-golan/claude-code-internals',
    gh: exe(process.env.RELEASE_GH, 'gh'),
    claude: exe(process.env.RELEASE_CLAUDE, 'claude'),
    tmpBase,
    journalPath: path.join(commonDir, 'release-journal.json'),
    commonDir,
    pollInterval: num('RELEASE_POLL_INTERVAL_MS', 15000),
    pollTimeout: num('RELEASE_POLL_TIMEOUT_MS', 30 * 60 * 1000),
    appearTimeout: num('RELEASE_RUN_APPEAR_TIMEOUT_MS', 5 * 60 * 1000),
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  };
}

/** A test-only knob: its value, or undefined unless the remote is a local path. */
function testOnly(ctx, name) {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  if (!ctx.local) { log(`ignoring ${name}: test-only, and the remote ${ctx.remoteUrl} is not a local path`); return undefined; }
  return v;
}
function crashPoint(ctx, point) {
  if (testOnly(ctx, 'RELEASE_CRASH_AT') === point) {
    // A real crash: SIGKILL runs no finally blocks and no runtime shutdown.
    // (process.exit() was seen to deadlock in Node 25's platform shutdown,
    // joining a worker thread, hanging a test for good.) The log line is
    // written synchronously so it is not lost with the process.
    fs.writeSync(2, `release: simulated crash at ${point}\n`);
    process.kill(process.pid, CRASH_SIGNAL);
  }
}
function testHook(ctx, name) {
  const cmd = testOnly(ctx, `RELEASE_TEST_HOOK_${name}`);
  if (cmd) run('sh', ['-c', cmd], { cwd: ctx.root });
}

// --- journal ----------------------------------------------------------------------

function readJournal(ctx) {
  if (!fs.existsSync(ctx.journalPath)) return null;
  try { return readJson(ctx.journalPath); } catch (e) { throw new Stop(`${ctx.journalPath} is not valid JSON (${e.message}); inspect it by hand`); }
}
function saveJournal(ctx, j) {
  j.updated = new Date().toISOString();
  writeFileAtomic(ctx.journalPath, `${JSON.stringify(j, null, 2)}\n`);
}
function record(ctx, j, step, state, extra = {}) {
  j.steps[step] = { state, at: new Date().toISOString(), ...extra };
  saveJournal(ctx, j);
}

/**
 * Temporary paths a run creates, journaled as `temp.<kind>` while they exist so a
 * crash (SIGKILL runs no finally block) leaves a record. Resume and abandon remove
 * one only when it is provably ours: the exact journaled path, directly in the
 * temp root with the name mkdtemp gave it, and for the candidate a worktree git
 * still has registered; anything else is reported and left alone.
 */
const TEMP_KINDS = {
  candidate_worktree: /^cci-release-[A-Za-z0-9]{6}$/,
  asset_dir: /^cci-asset-[A-Za-z0-9]{6}$/,
};
function rememberTemp(ctx, j, kind, dir) {
  j.temp = { ...(j.temp || {}), [kind]: dir };
  saveJournal(ctx, j);
}
function forgetTemp(ctx, j, kind) {
  if (!j.temp || !(kind in j.temp)) return;
  delete j.temp[kind];
  if (!Object.keys(j.temp).length) delete j.temp;
  // Never re-create a journal that fresh() dropped or publish() closed.
  if (fs.existsSync(ctx.journalPath)) saveJournal(ctx, j);
}
function registeredWorktrees(ctx) {
  return splitNul(git(ctx.root, ['worktree', 'list', '--porcelain', '-z'], { trim: false }).out)
    .filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
}
/** Why a journaled temp path is not provably ours (null when it is). */
function tempNotOwned(ctx, kind, dir) {
  if (!TEMP_KINDS[kind]) return `unknown kind ${kind}`;
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return 'not an absolute path';
  if (path.dirname(dir) !== ctx.tmpBase) return `not directly in the temp root ${ctx.tmpBase}`;
  if (!TEMP_KINDS[kind].test(path.basename(dir))) return 'not a name this script creates';
  return null;
}
/** Remove the crash leftovers the journal records (see TEMP_KINDS), then prune worktrees. */
function reconcileTemps(ctx, j) {
  for (const [kind, dir] of Object.entries(j.temp || {})) {
    const left = (why) => log(`  left in place: ${JSON.stringify(dir)} (journaled ${kind}; ${why}); remove it by hand if it is yours`);
    const why = tempNotOwned(ctx, kind, dir);
    let st = null;
    try { st = fs.lstatSync(dir); } catch { /* gone */ }
    if (why) { if (st) left(why); }
    else if (kind === 'candidate_worktree') {
      if (registeredWorktrees(ctx).includes(dir)) {
        git(ctx.root, ['worktree', 'remove', '--force', dir], { allowFail: true });
        if (fs.existsSync(dir)) left('git worktree remove did not delete it');
        else log(`  removed the crashed run's candidate worktree ${dir}`);
      } else if (st) left('not a registered worktree of this repository');
    } else if (st) {
      if (!st.isDirectory() || st.isSymbolicLink()) left('not a plain directory');
      else { fs.rmSync(dir, { recursive: true, force: true }); log(`  removed the crashed run's temp directory ${dir}`); }
    }
    forgetTemp(ctx, j, kind);
  }
  git(ctx.root, ['worktree', 'prune'], { allowFail: true });
}

const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const STEP_STATES = new Set(['pending', 'done', 'rejected', 'failed', 'no-run', 'mismatch']);

/** Schema problems of a parsed journal (empty when it has the shape fresh() writes). */
function journalSchemaProblems(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return ['not a JSON object'];
  const p = [];
  const str = (k) => { if (typeof j[k] !== 'string' || !j[k]) p.push(`${k} is not a non-empty string`); };
  if (j.schema !== 1) p.push(`schema is ${JSON.stringify(j.schema)}, expected 1`);
  for (const k of ['version', 'tag', 'branch', 'remote', 'remote_url', 'repo', 'parent', 'candidate', 'tree']) str(k);
  if (typeof j.version === 'string' && !/^\d+\.\d+\.\d+$/.test(j.version)) p.push(`version ${j.version} is not x.y.z`);
  if (typeof j.tag === 'string' && j.tag !== `v${j.version}`) p.push(`tag ${j.tag} does not match version ${j.version}`);
  if (typeof j.branch === 'string' && j.branch !== BRANCH) p.push(`branch is ${j.branch}, not ${BRANCH}`);
  for (const k of ['parent', 'candidate', 'tree']) if (typeof j[k] === 'string' && !SHA_RE.test(j[k])) p.push(`${k} is not an object id`);
  if (!Array.isArray(j.files) || !j.files.length || !j.files.every((f) => typeof f === 'string')) p.push('files is not a non-empty list of paths');
  if (typeof j.publish !== 'boolean') p.push('publish is not a boolean');
  if (j.temp !== undefined) {
    if (!j.temp || typeof j.temp !== 'object' || Array.isArray(j.temp)) p.push('temp is not an object');
    else for (const [k, v] of Object.entries(j.temp)) if (!TEMP_KINDS[k] || typeof v !== 'string') p.push(`temp.${k} is not a known temp path`);
  }
  if (!j.steps || typeof j.steps !== 'object' || Array.isArray(j.steps)) p.push('steps is not an object');
  else {
    for (const [k, v] of Object.entries(j.steps)) {
      if (!['integrate', ...PUBLISH_STEPS, ...EXTRA_STEPS].includes(k)) p.push(`unknown step ${k}`);
      else if (!v || typeof v !== 'object' || !STEP_STATES.has(v.state)) p.push(`step ${k} has no known state`);
    }
  }
  return p;
}

/**
 * Re-verify the journal's candidate against the repository: it is the commit a
 * fresh run would have produced from the journal's own record (tree, sole
 * parent, version, paths, trailers). A hand-edited or corrupted journal that is
 * still valid JSON must not steer a tag to another commit.
 */
function candidateProblems(ctx, j) {
  const c = j.candidate;
  if (!hasObject(ctx.root, c)) return [`the candidate ${c} is not a commit in this repository`];
  const p = [];
  const tree = gitOut(ctx.root, ['rev-parse', `${c}^{tree}`]);
  if (tree !== j.tree) p.push(`the candidate's tree is ${tree}, the journal recorded ${j.tree}`);
  const parents = gitOut(ctx.root, ['rev-list', '--parents', '-n', '1', c]).split(' ').slice(1);
  if (parents.length !== 1 || parents[0] !== j.parent) p.push(`the candidate's parents are ${parents.join(' ') || 'none'}, the journal recorded ${j.parent}`);
  const vj = git(ctx.root, ['show', `${c}:${SKILL_REL}/version.json`], { allowFail: true });
  let v = null;
  try { v = JSON.parse(vj.out).skill_version; } catch { /* reported below */ }
  if (v !== j.version) p.push(`the candidate's version.json says ${v}, the journal says ${j.version}`);
  const names = gitPaths(ctx.root, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', c]).sort();
  const files = [...j.files].sort();
  const internal = internalPaths(names);
  if (internal.length) p.push(`the candidate includes docs/internal/ paths: ${internal.map((n) => JSON.stringify(n)).join(', ')}`);
  if (JSON.stringify(names) !== JSON.stringify(files)) p.push(`the candidate touches ${names.join(', ') || 'nothing'}; the journal recorded ${files.join(', ')}`);
  const { required, allowed } = releaseFiles();
  const outside = names.filter((n) => !allowed.has(n));
  if (outside.length) p.push(`the candidate touches files a release commit may not: ${outside.join(', ')}`);
  const missing = [...required].filter((f) => !names.includes(f));
  if (missing.length) p.push(`the candidate does not change ${missing.join(', ')}`);
  const trailers = forbiddenTrailers(gitOut(ctx.root, ['log', '-1', '--format=%B', c]));
  if (trailers.length) p.push(`the candidate's message carries ${trailers.join(' and ')}`);
  return p;
}

/**
 * Resume and abandon act only on the release the journal describes, against the
 * destination it recorded: same remote name, same effective URL, same GitHub repo.
 */
function checkJournal(ctx, j, { verifyCandidate = true } = {}) {
  const schema = journalSchemaProblems(j);
  if (schema.length) throw new Stop(`${ctx.journalPath} is not a valid release journal:\n  - ${schema.join('\n  - ')}\nInspect it by hand.`);
  const moved = [];
  if (j.remote !== ctx.remote) moved.push(`remote name ${j.remote} -> ${ctx.remote}`);
  if (j.remote_url !== ctx.remoteUrl) moved.push(`remote URL ${j.remote_url} -> ${ctx.remoteUrl}`);
  if (j.repo !== ctx.repo) moved.push(`GitHub repo ${j.repo} -> ${ctx.repo}`);
  if (moved.length) {
    throw new Stop(`the release of v${j.version} was started against another destination (${moved.join('; ')}). ` +
      'Restore the original remote / RELEASE_REMOTE / RELEASE_REPO to continue it; nothing was done.');
  }
  if (!verifyCandidate) return;
  const cand = candidateProblems(ctx, j);
  if (cand.length) throw new Stop(`the journal's candidate ${j.candidate} failed re-verification:\n  - ${cand.join('\n  - ')}\nInspect ${ctx.journalPath} by hand.`);
}

// --- steps 1-4 --------------------------------------------------------------------

function porcelain(cwd) {
  // Untrimmed: the first entry's status column may start with a space.
  return git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { trim: false }).out
    .split('\0').filter(Boolean);
}

function preconditions(ctx, { version, offline }) {
  const dirty = porcelain(ctx.root);
  if (dirty.length) throw new Stop(`the index or worktree is not clean (${dirty.length} entr${dirty.length === 1 ? 'y' : 'ies'}, e.g. "${dirty[0]}"); commit or remove them first`);
  const branch = git(ctx.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).out;
  if (branch !== BRANCH) throw new Stop(`HEAD is on "${branch || '(detached)'}", not ${BRANCH}`);
  // --no-tags: auto-following would copy the remote's tags in, as a side effect.
  if (!offline) git(ctx.root, ['fetch', '--quiet', '--no-tags', ctx.remote, `+refs/heads/${BRANCH}:refs/remotes/${ctx.remote}/${BRANCH}`]);
  const head = revParse(ctx.root, 'HEAD');
  const upstream = revParse(ctx.root, `refs/remotes/${ctx.remote}/${BRANCH}`);
  if (!upstream) throw new Stop(`no refs/remotes/${ctx.remote}/${BRANCH}; fetch it first`);
  if (head !== upstream && !isAncestor(ctx.root, upstream, head)) {
    throw new Stop(`${BRANCH} is behind or has diverged from ${ctx.remote}/${BRANCH}${offline ? ' (as last fetched)' : ''}; integrate first`);
  }
  const ahead = Number(gitOut(ctx.root, ['rev-list', '--count', `${upstream}..${head}`]));
  // The content commits ahead of the remote ride along with the release: the
  // hard rules hold for them too (checked again right before the push).
  assertOutgoing(ctx, upstream, head, 'preconditions');
  // The identity the release commit will carry, shown before anything is committed.
  // A shell that sourced the sandbox env (scripts/tests/sandbox.js) would commit as
  // the sandbox user; refuse that against a real remote.
  const ident = gitOut(ctx.root, ['var', 'GIT_AUTHOR_IDENT']).replace(/ \d+ [+-]\d{4}$/, '');
  log(`  committing as ${ident}`);
  if (!ctx.local && (/example\.invalid/.test(ident) || process.env.GIT_CONFIG_NOSYSTEM)) {
    throw new Stop(`the git identity/config looks like a sandbox's (${ident}${process.env.GIT_CONFIG_NOSYSTEM ? ', GIT_CONFIG_NOSYSTEM set' : ''}) but the remote ${ctx.remoteUrl} is real; use a fresh shell`);
  }
  fcacheCheck(ctx);
  const tag = `v${version}`;
  if (revParse(ctx.root, `refs/tags/${tag}`)) throw new Stop(`tag ${tag} already exists locally`);
  if (!offline && lsRemote(ctx, `refs/tags/${tag}`)) throw new Stop(`tag ${tag} already exists on ${ctx.remote}`);
  return { head, upstream, ahead };
}

/**
 * A pinned Desktop gate whose live value moved since the last restamp means a published
 * claim may be stale (the 2026-10-07 sweep interval). On the machine that has the Desktop's
 * fcache, refuse to release until scripts/fcache-restamp.js has accepted the move. Real
 * remotes only: a sandbox release must not depend on this Mac's live cache.
 * CCI_FCACHE_PATH overrides the cache location (the sandbox points it at a missing file).
 */
function fcacheCheck(ctx) {
  if (ctx.local) return;
  const restamp = require('./fcache-restamp.js');
  const fcache = process.env.CCI_FCACHE_PATH || path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'fcache');
  if (!fs.existsSync(fcache) || !fs.existsSync(path.join(ctx.root, restamp.RECORD_REL))) {
    log('  fcache check skipped (no Desktop fcache or no committed record here)');
    return;
  }
  let code;
  try { code = restamp.run(['--root', ctx.root, '--fcache', fcache, '--check'], (l) => log(`  ${l}`)); } catch (e) {
    if (e instanceof restamp.Fail) throw new Stop(`fcache check failed: ${e.message}`);
    throw e;
  }
  if (code !== 0) throw new Stop('a pinned Desktop gate moved since the last restamp; run node scripts/fcache-restamp.js, update the affected claims, accept, and commit first');
}

function createCandidate(ctx, head) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(ctx.tmpBase, 'cci-release-')));
  const rel = path.relative(ctx.root, dir);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Stop(`the candidate ${dir} would be inside the repository; set RELEASE_TMPDIR`);
  git(ctx.root, ['worktree', 'add', '--quiet', '--detach', dir, head]);
  return dir;
}
function removeCandidate(ctx, dir) {
  if (!dir) return;
  git(ctx.root, ['worktree', 'remove', '--force', dir], { allowFail: true });
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  git(ctx.root, ['worktree', 'prune'], { allowFail: true });
}

/** Step 2 in the candidate. Returns the sorted exact add list. */
function applyChanges(cand, { from, to, entry }) {
  const byFile = new Map();
  for (const pin of SKILL_VERSION_PINS) {
    if (!byFile.has(pin.file)) byFile.set(pin.file, []);
    byFile.get(pin.file).push(pin);
  }
  for (const [file, pins] of byFile) {
    const abs = path.join(cand, file);
    let text = fs.readFileSync(abs, 'utf8');
    for (const pin of pins) {
      try { text = bumpText(text, pin.re, from, to, `${file} ${pin.describe}`); } catch (e) { throw new Stop(e.message); }
    }
    fs.writeFileSync(abs, text);
  }
  const clAbs = path.join(cand, CHANGELOG);
  fs.writeFileSync(clAbs, insertChangelog(fs.readFileSync(clAbs, 'utf8'), entry, to));
  run(process.execPath, [path.join(SKILL_REL, 'scripts', 'build.js')], { cwd: cand });

  const { required, allowed } = releaseFiles();
  const changed = [];
  for (const e of porcelain(cand)) {
    const status = e.slice(0, 2); const file = e.slice(3);
    if (status !== ' M' || !allowed.has(file)) throw new Stop(`unexpected change in the candidate: "${e}" (expected only modifications of ${[...allowed].join(', ')})`);
    changed.push(file);
  }
  const missing = [...required].filter((f) => !changed.includes(f));
  if (missing.length) throw new Stop(`the bump did not change ${missing.join(', ')}`);
  return changed.sort();
}

function validate(ctx, cand) {
  const override = testOnly(ctx, 'RELEASE_VALIDATE_CMD');
  if (override) {
    log(`validating with RELEASE_VALIDATE_CMD (test-only): ${override}`);
    run('sh', ['-c', override], { cwd: cand, env: validationEnv(), inherit: true });
  } else {
    log('validating the candidate tree with scripts/check-clean.sh (a few minutes)');
    run('bash', ['scripts/check-clean.sh'], { cwd: cand, env: validationEnv(), inherit: true });
  }
}

/**
 * Lessons whose vocabulary proposal is stale (edited since the model saw it), read
 * with the candidate's own prepare-lessons.js / lib/vocab.js. Stale proposals warn
 * rather than fail (STALE_VOCAB_BLOCKS in prepare-lessons.js flips that), so a
 * release lists them loudly instead of letting them scroll past in check-clean.
 */
function reportStaleVocab(cand) {
  const script = `
    const path = require('path');
    const dir = path.resolve(${JSON.stringify(SKILL_REL)});
    const P = require(path.join(dir, 'scripts', 'prepare-lessons.js'));
    const V = require(path.join(dir, 'scripts', 'lib', 'vocab.js'));
    const loaded = P.load(dir);
    const res = V.staleProposals(loaded.topic.lessons, loaded.lessonText, V.loadProposals(dir).byId);
    process.stdout.write(JSON.stringify({ ...res, blocks: P.STALE_VOCAB_BLOCKS === true }));`;
  const r = run(process.execPath, ['-e', script], { cwd: cand, env: validationEnv(), allowFail: true });
  let res = null;
  try { res = JSON.parse(r.out); } catch { /* reported below */ }
  if (r.code !== 0 || !res) { log(`  WARNING: could not list stale vocabulary proposals (${(r.err || r.out).split('\n')[0]})`); return; }
  if (!res.stale.length) { log('  vocabulary proposals: none stale'); return; }
  const bar = '='.repeat(72);
  log(bar);
  log(`STALE VOCABULARY: ${res.stale.length} lesson(s) changed since their vocabulary proposal was generated:`);
  log(`  ${res.stale.join(', ')}`);
  log(`  Their generated keywords describe the old text. ${res.blocks ? 'Blocking' : 'Not blocking'} (STALE_VOCAB_BLOCKS in prepare-lessons.js is ${res.blocks ? 'on' : 'off'}). Regenerate`);
  log(`  (calls a model) with: node ${SKILL_REL}/scripts/prepare-lessons.js --generate`);
  log('  then update PROPOSALS_SHA256 in lib/vocab.js, commit, and release again.');
  log(bar);
}

/** The candidate's index and worktree are exactly `tree`, nothing unstaged or untracked. */
function assertCandidateIs(cand, tree, when) {
  const now = gitOut(cand, ['write-tree']);
  if (now !== tree) throw new Stop(`${when}: the candidate's index is tree ${now}, not the validated ${tree}`);
  const unstaged = git(cand, ['diff', '--quiet'], { allowFail: true }).code;
  const untracked = gitPaths(cand, ['ls-files', '--others', '--exclude-standard']);
  if (unstaged !== 0 || untracked.length) throw new Stop(`${when}: the candidate worktree has changes beyond the validated tree (${untracked.length ? `untracked: ${untracked[0]}` : 'unstaged edits'})`);
}

function commitCandidate(ctx, cand, { head, list, tree, message }) {
  const found = forbiddenTrailers(message);
  if (found.length) throw new Stop(`the commit message carries ${found.join(' and ')}`);
  const msgFile = path.join(fs.mkdtempSync(path.join(ctx.tmpBase, 'cci-msg-')), 'COMMIT_MSG');
  fs.writeFileSync(msgFile, message);
  try {
    testHook(ctx, 'BEFORE_COMMIT');
    git(cand, ['commit', '--quiet', '-F', msgFile]);
  } finally {
    fs.rmSync(path.dirname(msgFile), { recursive: true, force: true });
  }
  const sha = revParse(cand, 'HEAD');
  const problems = [];
  const commitTree = gitOut(cand, ['rev-parse', `${sha}^{tree}`]);
  if (commitTree !== tree) problems.push(`the commit's tree ${commitTree} is not the validated tree ${tree} (a hook changed it)`);
  const parents = gitOut(cand, ['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1);
  if (parents.length !== 1 || parents[0] !== head) problems.push(`the commit's parents are ${parents.join(' ') || 'none'}, expected ${head}`);
  const names = gitPaths(cand, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', sha]).sort();
  if (JSON.stringify(names) !== JSON.stringify(list)) problems.push(`the commit touches ${names.join(', ')}; expected exactly ${list.join(', ')}`);
  const internal = internalPaths(names);
  if (internal.length) problems.push(`the commit includes docs/internal/ paths: ${internal.map((n) => JSON.stringify(n)).join(', ')}`);
  const committed = gitOut(cand, ['log', '-1', '--format=%B', sha]);
  const trailers = forbiddenTrailers(committed);
  if (trailers.length) problems.push(`the committed message carries ${trailers.join(' and ')} (added by a hook?)`);
  const left = porcelain(cand);
  if (left.length) problems.push(`the candidate worktree is not clean after the commit (e.g. "${left[0]}"; a hook edited a file)`);
  if (problems.length) throw new Stop(`the candidate commit failed verification:\n  - ${problems.join('\n  - ')}`);
  return sha;
}

// --- step 5 -----------------------------------------------------------------------

function integrate(ctx, j) {
  const main = revParse(ctx.root, `refs/heads/${BRANCH}`);
  if (main === j.candidate || (main && isAncestor(ctx.root, j.candidate, main))) {
    if (j.steps.integrate?.state !== 'done') record(ctx, j, 'integrate', 'done', { reconciled: true });
    return;
  }
  if (main !== j.parent) {
    throw new Stop(`${BRANCH} moved to ${main} while the release ran (expected ${j.parent}); another session committed. Nothing was published.`);
  }
  const branch = git(ctx.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).out;
  if (branch !== BRANCH) throw new Stop(`HEAD is no longer on ${BRANCH}; cannot fast-forward it`);
  const dirty = porcelain(ctx.root);
  if (dirty.length) throw new Stop(`the worktree is no longer clean (e.g. "${dirty[0]}"); cannot fast-forward ${BRANCH}`);
  if (!hasObject(ctx.root, j.candidate)) throw new Stop(`the candidate commit ${j.candidate} is not in this repository`);
  crashPoint(ctx, 'integrate:before-action');
  const r = git(ctx.root, ['merge', '--quiet', '--ff-only', j.candidate], { allowFail: true });
  if (r.code !== 0 || revParse(ctx.root, `refs/heads/${BRANCH}`) !== j.candidate) {
    throw new Stop(`could not fast-forward ${BRANCH} to ${j.candidate}${r.err ? `: ${r.err}` : ''}`);
  }
  crashPoint(ctx, 'integrate:after-action');
  record(ctx, j, 'integrate', 'done');
  crashPoint(ctx, 'integrate:after-record');
}

// --- step 6: publish --------------------------------------------------------------

function lsRemote(ctx, ref) {
  const out = gitOut(ctx.root, ['ls-remote', ctx.remote, ref, `${ref}^{}`]);
  let sha = null;
  for (const line of out.split('\n').filter(Boolean)) {
    const [s, name] = line.split('\t');
    if (name === `${ref}^{}`) return s;          // an annotated tag, peeled
    if (name === ref) sha = s;
  }
  return sha;
}

function remoteMainState(ctx, j) {
  const sha = lsRemote(ctx, `refs/heads/${BRANCH}`);
  if (sha === j.candidate) return { state: 'at-candidate', sha };
  if (sha && !hasObject(ctx.root, sha)) git(ctx.root, ['fetch', '--quiet', '--no-tags', ctx.remote, `refs/heads/${BRANCH}`], { allowFail: true });
  if (sha && hasObject(ctx.root, sha) && isAncestor(ctx.root, j.candidate, sha)) return { state: 'contains-candidate', sha };
  if (!sha || (hasObject(ctx.root, sha) && isAncestor(ctx.root, sha, j.candidate))) return { state: 'behind-candidate', sha };
  return { state: 'moved', sha };
}

const REINTEGRATE = 'Do NOT tag. Integrate the remote change, then re-validate: run `node scripts/release.js --abandon`, bring main up to date (the release commit must be redone on top), and start the release again.';

function stepPush(ctx, j) {
  const s = remoteMainState(ctx, j);
  if (s.state === 'at-candidate' || s.state === 'contains-candidate') {
    if (j.steps.push?.state !== 'done') record(ctx, j, 'push', 'done', { reconciled: true, remote_sha: s.sha });
    return;
  }
  if (s.state === 'moved') {
    record(ctx, j, 'push', 'rejected', { remote_sha: s.sha });
    throw new Stop(`${ctx.remote}/${BRANCH} is at ${s.sha}, which does not lead to the release commit. ${REINTEGRATE}`);
  }
  testHook(ctx, 'BEFORE_PUSH');
  // Immediately before the push (and on every resume, which skips step 1): what
  // this push publishes is remote main..candidate, and all of it obeys the hard rules.
  assertOutgoing(ctx, s.sha, j.candidate, 'before the push');
  crashPoint(ctx, 'push:before-action');
  // --no-follow-tags: push.followTags=true would otherwise also publish every
  // annotated tag reachable from the candidate. The lease pins the remote branch
  // to the exact SHA whose outgoing range was just checked (absent when there
  // was none); as the candidate descends from it, the push is still a plain
  // fast-forward, and if anyone moved the branch in between it is rejected.
  const lease = `--force-with-lease=refs/heads/${BRANCH}:${s.sha || ''}`;
  const r = git(ctx.root, ['push', '--quiet', '--no-follow-tags', lease, ctx.remote, `${j.candidate}:refs/heads/${BRANCH}`], { allowFail: true });
  if (r.code !== 0) {
    record(ctx, j, 'push', 'rejected', { stderr: r.err.slice(0, 2000) });
    throw new Stop(`the push of ${BRANCH} was rejected:\n${r.err}\n${REINTEGRATE}`);
  }
  crashPoint(ctx, 'push:after-action');
  record(ctx, j, 'push', 'done');
  crashPoint(ctx, 'push:after-record');
}

function stepTag(ctx, j) {
  testHook(ctx, 'BEFORE_TAG');
  const main = remoteMainState(ctx, j);
  if (main.state !== 'at-candidate' && main.state !== 'contains-candidate') {
    throw new Stop(`${ctx.remote}/${BRANCH} (${main.sha}) does not contain the release commit; refusing to tag. ${REINTEGRATE}`);
  }
  const remoteTag = lsRemote(ctx, `refs/tags/${j.tag}`);
  if (remoteTag === j.candidate) {
    if (j.steps.tag?.state !== 'done') record(ctx, j, 'tag', 'done', { reconciled: true });
    return;
  }
  if (remoteTag) throw new Stop(`tag ${j.tag} on ${ctx.remote} points at ${remoteTag}, not the release commit ${j.candidate}`);
  const localTag = revParse(ctx.root, `refs/tags/${j.tag}`);
  if (localTag && localTag !== j.candidate) throw new Stop(`local tag ${j.tag} points at ${localTag}, not ${j.candidate}`);
  if (!localTag) git(ctx.root, ['tag', j.tag, j.candidate]);
  crashPoint(ctx, 'tag:before-action');
  const r = git(ctx.root, ['push', '--quiet', '--no-follow-tags', ctx.remote, `refs/tags/${j.tag}:refs/tags/${j.tag}`], { allowFail: true });
  if (r.code !== 0) {
    record(ctx, j, 'tag', 'failed', { stderr: r.err.slice(0, 2000) });
    throw new Stop(`the push of tag ${j.tag} failed:\n${r.err}`);
  }
  crashPoint(ctx, 'tag:after-action');
  record(ctx, j, 'tag', 'done');
  crashPoint(ctx, 'tag:after-record');
}

function gh(ctx, args, opts = {}) {
  return run(ctx.gh, args, { cwd: ctx.root, ...opts });
}

function findRun(ctx, j, timeout) {
  const r = gh(ctx, ['run', 'list', `--workflow=${WORKFLOW}`, '-R', ctx.repo, '--commit', j.candidate, '--limit', '20',
    '--json', 'databaseId,headSha,headBranch,event,status,conclusion,url'], { timeout });
  let runs;
  try { runs = JSON.parse(r.out || '[]'); } catch { throw new Stop(`gh run list returned non-JSON: ${r.out.slice(0, 200)}`); }
  const mine = runs.filter((x) => x.headSha === j.candidate);
  return mine.find((x) => x.headBranch === j.tag) || mine[0] || null;
}

function stepRun(ctx, j) {
  const start = Date.now();
  const deadline = start + ctx.pollTimeout;
  let seen = null;
  for (;;) {
    let found;
    try {
      // A stalled gh is killed at the poll deadline, never allowed to outlive it.
      found = findRun(ctx, j, Math.max(1, deadline - Date.now()));
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      record(ctx, j, 'run', 'pending', { reason: 'gh-timeout', run_id: seen && seen.databaseId, status: seen && seen.status });
      throw new Stop(`gh run list did not answer before the ${Math.round(ctx.pollTimeout / 1000)}s poll deadline (killed); the run state is unknown. --resume later`);
    }
    if (found) {
      seen = found;
      if (found.status === 'completed') {
        if (found.conclusion === 'success') {
          record(ctx, j, 'run', 'done', { run_id: found.databaseId, url: found.url });
          crashPoint(ctx, 'run:after-record');
          return;
        }
        record(ctx, j, 'run', 'failed', { run_id: found.databaseId, url: found.url, conclusion: found.conclusion });
        throw new Stop(`the Release run for ${j.candidate} concluded "${found.conclusion}": ${found.url || found.databaseId}. Fix it, re-run the workflow for the tag, then --resume.`);
      }
    }
    const waited = Date.now() - start;
    if (!seen && waited >= ctx.appearTimeout) {
      record(ctx, j, 'run', 'no-run');
      throw new Stop(`no ${WORKFLOW} run appeared for ${j.candidate} within ${Math.round(ctx.appearTimeout / 1000)}s. ` +
        `GitHub creates no push event when more than three tags are pushed at once; if that happened, delete and re-push the single tag ` +
        `(git push ${ctx.remote} :refs/tags/${j.tag} && git push ${ctx.remote} refs/tags/${j.tag}), then --resume.`);
    }
    if (waited >= ctx.pollTimeout) {
      record(ctx, j, 'run', 'pending', { run_id: seen && seen.databaseId, status: seen && seen.status });
      throw new Stop(`the Release run for ${j.candidate} is still ${seen ? seen.status : 'absent'} after ${Math.round(ctx.pollTimeout / 1000)}s; --resume later`);
    }
    sleep(Math.max(0, Math.min(ctx.pollInterval, deadline - Date.now())));
  }
}

function stepAsset(ctx, j) {
  const dir = fs.mkdtempSync(path.join(ctx.tmpBase, 'cci-asset-'));
  try {
    rememberTemp(ctx, j, 'asset_dir', dir);
    const dl = path.join(dir, 'download');
    fs.mkdirSync(dl);
    gh(ctx, ['release', 'download', j.tag, '-R', ctx.repo, '-p', ZIP_NAME, '-D', dl, '--clobber']);
    const zip = path.join(dl, ZIP_NAME);
    if (!fs.existsSync(zip)) throw new Stop(`gh release download produced no ${ZIP_NAME}`);
    const refZip = path.join(dir, 'reference.zip');
    git(ctx.root, ['archive', '--format=zip', '--prefix=claude-code-internals/', '-o', refZip, `${j.candidate}:${SKILL_REL}`]);
    const a = path.join(dir, 'asset'); const b = path.join(dir, 'reference');
    run('unzip', ['-q', zip, '-d', a]);
    run('unzip', ['-q', refZip, '-d', b]);
    const top = fs.readdirSync(a);
    if (top.length !== 1 || top[0] !== 'claude-code-internals') throw new Stop(`the release asset's top level is ${top.join(', ')}, expected claude-code-internals/`);
    const diff = diffTrees(hashTree(path.join(a, 'claude-code-internals')), hashTree(path.join(b, 'claude-code-internals')));
    if (diff.length) {
      record(ctx, j, 'asset', 'mismatch', { differences: diff.slice(0, 50) });
      throw new Stop(`the release asset differs from git archive of ${j.tag}'s ${SKILL_REL}:\n  - ${diff.slice(0, 20).join('\n  - ')}${diff.length > 20 ? `\n  (+${diff.length - 20} more)` : ''}`);
    }
    crashPoint(ctx, 'asset:after-action');
    record(ctx, j, 'asset', 'done');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    forgetTemp(ctx, j, 'asset_dir');
  }
}

function stepDescription(ctx, j) {
  const script = path.join(ctx.root, 'scripts', 'sync-repo-description.sh');
  const env = childEnv();
  // The validated repo, explicitly: the script's own default is the real one.
  // The exact gh executable too: the script would otherwise run whatever `gh`
  // comes first on PATH, which for a stand-in not named `gh` is the real one.
  const repo = ['--repo', ctx.repo, '--gh', ctx.gh];
  if (run('bash', [script, ...repo, '--check'], { cwd: ctx.root, env, allowFail: true }).code !== 0) {
    run('bash', [script, ...repo, '--push'], { cwd: ctx.root, env });
    run('bash', [script, ...repo, '--check'], { cwd: ctx.root, env });
  }
  record(ctx, j, 'description', 'done');
}

function installedSkillVersion(ctx) {
  const p = path.join(ctx.claudeConfigDir, 'plugins', 'installed_plugins.json');
  if (!fs.existsSync(p)) return { installed: false };
  const data = readJson(p);
  const entries = (data.plugins || data)[PLUGIN_ID];
  const entry = Array.isArray(entries) ? (entries.find((e) => e.scope === 'user') || entries[0]) : entries;
  if (!entry || !entry.installPath) return { installed: false };
  const vp = path.join(entry.installPath, 'skills', 'claude-code-internals', 'version.json');
  return { installed: true, version: fs.existsSync(vp) ? readJson(vp).skill_version : null, path: vp };
}

function stepInstall(ctx, j) {
  const before = installedSkillVersion(ctx);
  if (before.version !== j.version) {
    run(ctx.claude, ['plugin', 'marketplace', 'update', MARKETPLACE], { cwd: ctx.root });
    run(ctx.claude, ['plugin', before.installed ? 'update' : 'install', PLUGIN_ID], { cwd: ctx.root });
  }
  const after = installedSkillVersion(ctx);
  if (after.version !== j.version) throw new Stop(`the installed skill reports version ${after.version} (${after.path || 'not installed'}), expected ${j.version}`);
  record(ctx, j, 'install', 'done', { version_json: after.path });
}

const STEP_FNS = { push: stepPush, tag: stepTag, run: stepRun, asset: stepAsset, description: stepDescription, install: stepInstall };

function publish(ctx, j) {
  const steps = [...PUBLISH_STEPS, ...(j.publish ? EXTRA_STEPS : [])];
  for (const step of steps) {
    const st = j.steps[step]?.state;
    // push and tag are re-reconciled even when done (cheap remote queries);
    // a concluded run and a verified asset cannot change.
    if (st === 'done' && !['push', 'tag'].includes(step)) continue;
    log(`${step}${st && st !== 'done' ? ` (resuming from "${st}")` : ''}`);
    STEP_FNS[step](ctx, j);
  }
  j.completed = new Date().toISOString();
  saveJournal(ctx, j);
  const done = path.join(ctx.commonDir, `release-journal.v${j.version}.done.json`);
  fs.renameSync(ctx.journalPath, done);
  log(`released v${j.version} at ${j.candidate} (journal: ${done})`);
}

// --- entry points -----------------------------------------------------------------

function parseArgs(argv) {
  const o = { dryRun: false, publish: false, resume: false, abandon: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Stop(`${a} needs a value`); return argv[++i]; };
    if (a === '--version') o.version = val();
    else if (a === '--changelog') o.changelog = val();
    else if (a === '--message') o.message = val();
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--publish') o.publish = true;
    else if (a === '--resume') o.resume = true;
    else if (a === '--abandon') o.abandon = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Stop(`unknown argument ${a}`);
  }
  return o;
}

/**
 * Against a local (test) remote, every GitHub and plugin action must go to a
 * stand-in: without RELEASE_GH the run would poll and download from the real
 * repo, and --publish would PATCH its About text and update the real plugin.
 */
function requireStandIns(ctx, { publish, dryRun }) {
  if (!ctx.local || dryRun) return;
  const missing = ['RELEASE_GH', ...(publish ? ['RELEASE_CLAUDE'] : [])].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Stop(`the remote ${ctx.remoteUrl} is a local path (a test release), but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set: ` +
      `the ${publish ? 'publish steps' : 'run/asset steps'} would reach the real GitHub repo${publish ? ' and plugin' : ''}. Point them at stand-ins (scripts/tests/fixtures/).`);
  }
}

function abandon(ctx, j) {
  checkJournal(ctx, j, { verifyCandidate: false });
  const remoteTag = lsRemote(ctx, `refs/tags/${j.tag}`);
  if (remoteTag || j.steps.tag?.state === 'done') {
    throw new Stop(`tag ${j.tag} is already on ${ctx.remote}; a published release cannot be abandoned. Finish it with --resume.`);
  }
  reconcileTemps(ctx, j);
  const localTag = revParse(ctx.root, `refs/tags/${j.tag}`);
  const kept = path.join(ctx.commonDir, `release-journal.v${j.version}.abandoned.json`);
  fs.renameSync(ctx.journalPath, kept);
  const pushed = j.steps.push?.state === 'done';
  log(`abandoned v${j.version} (journal kept as ${kept}).${localTag ? ` The local tag ${j.tag} was left in place; delete it with: git tag -d ${j.tag}` : ''}` +
    ` The release commit ${j.candidate} is on local ${BRANCH} if it was integrated${pushed ? ` and on ${ctx.remote}/${BRANCH} (pushed, untagged)` : ''}; nothing was undone.`);
}

function resume(ctx, j, opts) {
  if (opts.version && opts.version !== j.version && opts.version !== 'patch' && opts.version !== 'minor' && opts.version !== 'major') {
    throw new Stop(`a release of v${j.version} is in progress; finish it (--resume) or --abandon it before releasing ${opts.version}`);
  }
  // Before any integration or external action: the journal is well formed, its
  // destination is the current one, and its candidate is the commit it claims.
  checkJournal(ctx, j);
  requireStandIns(ctx, { publish: opts.publish || j.publish, dryRun: false });
  if (opts.publish && !j.publish) { j.publish = true; saveJournal(ctx, j); }
  log(`resuming v${j.version} (candidate ${j.candidate})`);
  integrate(ctx, j);
  // After integrating: until main holds the candidate, its worktree is what keeps
  // the commit reachable.
  reconcileTemps(ctx, j);
  publish(ctx, j);
}

function fresh(ctx, opts) {
  if (!opts.version) throw new Stop('--version is required');
  if (!opts.changelog) throw new Stop('--changelog <file> is required');
  const current = readJson(path.join(ctx.root, SKILL_REL, 'version.json')).skill_version;
  const version = nextVersion(current, opts.version);
  const tag = `v${version}`;
  const clText = fs.readFileSync(path.resolve(opts.changelog), 'utf8');
  const cl = parseChangelogEntry(clText, version);
  const body = opts.message ? fs.readFileSync(path.resolve(opts.message), 'utf8').trim() : cl.body;
  const message = `v${version}: ${cl.title}\n\n${body}\n`;
  if (forbiddenTrailers(message).length) throw new Stop(`the commit message would carry ${forbiddenTrailers(message).join(' and ')}`);
  requireStandIns(ctx, { publish: opts.publish, dryRun: opts.dryRun });

  log(`step 1: preconditions${opts.dryRun ? ' (offline)' : ''}`);
  const pre = preconditions(ctx, { version, offline: opts.dryRun });
  log(`  ${BRANCH} at ${pre.head.slice(0, 12)}, ${pre.ahead} commit(s) ahead of ${ctx.remote}/${BRANCH}; releasing ${current} -> ${version}`);

  let cand = null;
  let j = null;
  try {
    log('step 2: candidate worktree');
    cand = createCandidate(ctx, pre.head);
    const list = applyChanges(cand, { from: current, to: version, entry: cl.entry });
    git(cand, ['add', '--', ...list]);
    const tree = gitOut(cand, ['write-tree']);
    log(`  ${cand}: ${list.join(', ')} (tree ${tree.slice(0, 12)})`);

    log('step 3: validate the candidate tree');
    validate(ctx, cand);
    assertCandidateIs(cand, tree, 'after validation');
    reportStaleVocab(cand);
    assertCandidateIs(cand, tree, 'after the vocabulary report');
    if (opts.dryRun) {
      log(`dry run OK: v${version} validated in ${cand}; nothing committed, nothing published`);
      return;
    }

    log('step 4: commit in the candidate');
    const sha = commitCandidate(ctx, cand, { head: pre.head, list, tree, message });
    log(`  ${sha} verified (tree, parent, paths, trailers)`);

    log('step 5: integrate');
    testHook(ctx, 'BEFORE_INTEGRATE');
    const main = revParse(ctx.root, `refs/heads/${BRANCH}`);
    if (main !== pre.head) throw new Stop(`${BRANCH} moved to ${main} while the release ran (expected ${pre.head}); another session committed. Nothing was published.`);
    j = {
      schema: 1, version, tag, branch: BRANCH, remote: ctx.remote, remote_url: ctx.remoteUrl, repo: ctx.repo,
      parent: pre.head, candidate: sha, tree, files: list, publish: opts.publish,
      created: new Date().toISOString(), steps: { integrate: { state: 'pending', at: new Date().toISOString() } },
      temp: { candidate_worktree: cand },          // a crash from here on leaves it behind: see reconcileTemps
    };
    saveJournal(ctx, j);
    try {
      integrate(ctx, j);
    } catch (e) {
      // Nothing was integrated or published: drop the journal so a rerun starts fresh.
      if (revParse(ctx.root, `refs/heads/${BRANCH}`) !== sha && fs.existsSync(ctx.journalPath)) fs.rmSync(ctx.journalPath);
      throw e;
    }
  } finally {
    removeCandidate(ctx, cand);
    if (j) forgetTemp(ctx, j, 'candidate_worktree');
  }
  log('step 6: publish');
  publish(ctx, j);
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    const doc = fs.readFileSync(__filename, 'utf8').split('/**\n')[1].split('\n */')[0];
    process.stdout.write(`${doc.replace(/^ \* ?/gm, '')}\n`);
    return 0;
  }
  const ctx = makeContext();
  const j = readJournal(ctx);
  if (opts.abandon) {
    if (!j) throw new Stop('no release in progress');
    abandon(ctx, j);
    return 0;
  }
  if (j) {
    if (opts.dryRun) throw new Stop(`a release of v${j.version} is in progress (${ctx.journalPath}); finish it with --resume or --abandon it`);
    resume(ctx, j, opts);
    return 0;
  }
  if (opts.resume) throw new Stop('no release in progress (no journal)');
  fresh(ctx, opts);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof Stop) {
      log(`STOPPED: ${e.message}`);
      process.exitCode = 1;
    } else {
      throw e;
    }
  }
}

module.exports = {
  isLocalRemote, forbiddenTrailers, parseChangelogEntry, insertChangelog, nextVersion, cmpSemver, hashTree, diffTrees, Stop,
  journalSchemaProblems, outgoingProblems, releaseFiles, splitNul, internalPaths,
};
