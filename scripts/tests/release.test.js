'use strict';
/**
 * release.test.js — scripts/release.js against offline sandboxes (sandbox.js):
 * a local bare repository as origin, fake gh / claude, and a fast validation
 * command (RELEASE_VALIDATE_CMD is honoured only because the remote is a local
 * path). Covers the happy path, the dry run, and the failure injections the
 * plan's phase-4 checkpoint names: a hook that edits a file during the commit,
 * a rejected branch push, a resume from the journal after a crash at every
 * step, main moving during the run, and a dirty worktree. Plus the review
 * findings: the hard rules over every outgoing commit, one effective remote URL,
 * --no-follow-tags, resume bound to the journal's destination and re-verifying
 * its candidate, the publish repo and stand-ins, a hung gh, and one case per
 * guard no other case reaches. The last test (RELEASE_SLOW_TESTS=1) runs the
 * real check-clean.sh in a full-copy sandbox.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeSandbox, SKILL_REL } = require('./sandbox.js');
const rel = require('../release.js');
const { SKILL_VERSION_PINS, bumpText } = require(`../../${SKILL_REL}/scripts/lib/version-pins.js`);

const sandboxes = [];
function sandbox() { const s = makeSandbox(); sandboxes.push(s); return s; }
test.after(() => { for (const s of sandboxes) s.cleanup(); });

const EXPECTED_FILES = [
  'CHANGELOG.md', 'README.md', 'skill-package/.claude-plugin/plugin.json', `${SKILL_REL}/version.json`,
].sort();

/** The state every successful release must leave behind. */
function assertReleased(s, { baseHead }) {
  const head = s.git(['rev-parse', 'HEAD']);
  assert.strictEqual(s.git(['rev-parse', 'HEAD^']), baseHead, 'exactly one release commit on top of the starting HEAD');
  assert.strictEqual(s.git(['log', '-1', '--format=%s']), `v${s.version}: a sandbox release`);
  const body = s.git(['log', '-1', '--format=%B']);
  assert.deepStrictEqual(rel.forbiddenTrailers(body), []);
  assert.deepStrictEqual(s.git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').sort(), EXPECTED_FILES);
  assert.strictEqual(s.git(['status', '--porcelain']), '', 'the user worktree is clean');
  assert.strictEqual(s.gitOrigin(['rev-parse', 'refs/heads/main']), head, 'origin main is the release commit');
  assert.strictEqual(s.gitOrigin(['rev-parse', `refs/tags/v${s.version}^{commit}`]), head, 'origin tag at the release commit');
  assert.strictEqual(s.gitOrigin(['tag', '--list']).split('\n').filter(Boolean).length, 1, 'exactly one tag pushed');
  for (const pin of SKILL_VERSION_PINS) {
    const text = s.git(['show', `HEAD:${pin.file}`]);
    assert.ok(text.length > 0);
    assert.doesNotThrow(() => bumpText(text, pin.re, s.version, s.version), `${pin.file} ${pin.describe} is at ${s.version}`);
  }
  assert.match(s.git(['show', 'HEAD:CHANGELOG.md']), new RegExp(`^# Changelog\\n\\n## v${s.version.replace(/\./g, '\\.')} — `));
  assert.ok(!fs.existsSync(s.journal), 'the journal is closed');
  assert.ok(fs.existsSync(path.join(s.work, '.git', `release-journal.v${s.version}.done.json`)));
  assert.deepStrictEqual(fs.readdirSync(s.tmp).filter((f) => f.startsWith('cci-')), [], 'no temp dirs left');
  assert.strictEqual(s.git(['worktree', 'list']).split('\n').length, 1, 'no candidate worktree left');
  assert.deepStrictEqual(s.tripwireCalls(), [], 'nothing ran gh or claude by name from PATH');
}

/** Nothing happened: HEAD, worktree, origin and journal as before. */
function assertUntouched(s, { baseHead, originHead = baseHead }) {
  assert.strictEqual(s.git(['rev-parse', 'HEAD']), baseHead, 'HEAD unchanged');
  assert.strictEqual(s.git(['status', '--porcelain']), '', 'the user worktree is clean');
  assert.strictEqual(s.gitOrigin(['rev-parse', 'refs/heads/main']), originHead, 'origin main unchanged');
  assert.strictEqual(s.gitOrigin(['tag', '--list']), '', 'no tag on origin');
  assert.strictEqual(s.git(['tag', '--list']), '', 'no local tag');
  assert.ok(!fs.existsSync(s.journal), 'no journal');
  assert.strictEqual(s.git(['worktree', 'list']).split('\n').length, 1, 'the candidate worktree is gone');
  assert.deepStrictEqual(fs.readdirSync(s.tmp).filter((f) => f.startsWith('cci-')), [], 'no temp dirs left');
}

/** The run died at its RELEASE_CRASH_AT point (release.js SIGKILLs itself there). */
function assertCrashed(r) {
  assert.strictEqual(r.signal, 'SIGKILL', r.out);
  assert.match(r.out, /simulated crash at /);
  assert.doesNotMatch(r.out, /TIMED OUT/);
}

const releaseArgs = (s, extra = []) => ['--version', s.version, '--changelog', s.changelog, ...extra];

// File names git C-quotes in its line-oriented output (core.quotePath covers the last).
const ODD_NAMES = ['private\t.md', 'two\nlines.md', 'say "hi".md', 'résumé.md'];

// --- pure helpers -----------------------------------------------------------------

test('bumpText replaces only the captured version, even when it equals a prefix of the match', () => {
  const re = /v2\.2\.0.v(\d+\.\d+\.\d+),/dg;
  assert.strictEqual(bumpText('adds (v2.2.0–v2.2.0, by', re, '2.2.0', '2.2.1'), 'adds (v2.2.0–v2.2.1, by');
  assert.throws(() => bumpText('nothing here', re, '2.2.0', '2.2.1'), /no pin matches/);
  assert.throws(() => bumpText('(v2.2.0–v2.3.0,', re, '2.2.0', '2.2.1'), /expected 2\.2\.0/);
});

test('test-only knobs are honoured only for a local-path remote', () => {
  for (const url of ['/tmp/origin.git', './origin.git', '../x.git', 'file:///tmp/o.git']) assert.ok(rel.isLocalRemote(url), url);
  for (const url of ['git@github.com:yaniv-golan/claude-code-internals.git', 'https://github.com/yaniv-golan/claude-code-internals', 'ssh://git@github.com/x/y', '']) {
    assert.ok(!rel.isLocalRemote(url), url);
  }
});

test('isLocalRemote follows git: bare relative paths and Windows drive paths are local, scp-like and schemes are not', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const url of ['local.git', 'repos/origin.git', '/abs/o.git', './o', '../o', 'file:///x/o.git', 'FILE:///x', 'dir/with:colon-after-slash']) {
      assert.ok(rel.isLocalRemote(url, platform), `${platform} ${url}`);
    }
    for (const url of ['host:path', 'git@github.com:x/y.git', 'github.com:x', 'https://h/x', 'ssh://h/x', 'git://h/x', 'ext::ssh h', 'http://C:/x', '']) {
      assert.ok(!rel.isLocalRemote(url, platform), `${platform} ${url}`);
    }
  }
  for (const url of ['C:/repos/origin.git', 'C:\\repos\\origin.git', 'd:\\o', '\\\\server\\share\\o.git', 'repos\\origin.git']) {
    assert.ok(rel.isLocalRemote(url, 'win32'), `win32 ${url}`);
  }
  // On POSIX git reads C:/x as host "C", path "/x".
  for (const url of ['C:/repos/origin.git', 'C:\\repos\\origin.git']) assert.ok(!rel.isLocalRemote(url, 'linux'), `linux ${url}`);
});

test('journal schema: the shape fresh() writes passes; missing or inconsistent fields are named', () => {
  const sha = 'a'.repeat(40);
  const good = {
    schema: 1, version: '1.2.3', tag: 'v1.2.3', branch: 'main', remote: 'origin', remote_url: '/o.git', repo: 'o/r',
    parent: sha, candidate: 'b'.repeat(40), tree: 'c'.repeat(40), files: ['CHANGELOG.md'], publish: false,
    steps: { integrate: { state: 'pending' }, push: { state: 'rejected' } },
  };
  assert.deepStrictEqual(rel.journalSchemaProblems(good), []);
  const bad = (patch) => rel.journalSchemaProblems({ ...good, ...patch }).join('; ');
  assert.match(bad({ tree: undefined }), /tree is not/);
  assert.match(bad({ tag: 'v9.9.9' }), /does not match version/);
  assert.match(bad({ candidate: 'HEAD~1' }), /candidate is not an object id/);
  assert.match(bad({ steps: undefined }), /steps is not an object/);
  assert.match(bad({ steps: { push: { state: 'weird' } } }), /step push has no known state/);
  assert.match(bad({ schema: 2 }), /schema/);
  assert.deepStrictEqual(rel.journalSchemaProblems({ ...good, temp: { candidate_worktree: '/t/cci-release-abcdef' } }), []);
  assert.match(bad({ temp: { elsewhere: '/x' } }), /temp\.elsewhere is not a known temp path/);
  assert.match(bad({ temp: ['/x'] }), /temp is not an object/);
  assert.deepStrictEqual(rel.journalSchemaProblems([]), ['not a JSON object']);
});

test('path lists are read NUL-separated: names git would quote keep their docs/internal/ prefix', () => {
  const names = [...ODD_NAMES.map((n) => `docs/internal/${n}`), ' lead.md', 'docs/public.md'];
  // What `git ... -z --name-only` prints: each path raw, NUL-terminated, never quoted.
  const raw = `${names.join('\0')}\0\0`;
  assert.deepStrictEqual(rel.splitNul(raw), names);
  assert.deepStrictEqual(rel.internalPaths(rel.splitNul(raw)), names.slice(0, ODD_NAMES.length).sort());
  // Negative control: the quoted, line-oriented form the old parser read hides every one.
  const quoted = ['"docs/internal/private\\t.md"', '"docs/internal/two\\nlines.md"', '"docs/internal/say \\"hi\\".md"',
    '"docs/internal/r\\303\\251sum\\303\\251.md"'].join('\n');
  assert.deepStrictEqual(rel.internalPaths(quoted.split('\n')), []);
});

test('forbidden trailers are detected wherever a hook might put them', () => {
  assert.deepStrictEqual(rel.forbiddenTrailers('v1: x\n\nbody\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'), ['Co-Authored-By: Claude']);
  assert.deepStrictEqual(rel.forbiddenTrailers('v1: x\n\nclaude-session: https://claude.ai/x\n'), ['Claude-Session:']);
  assert.deepStrictEqual(rel.forbiddenTrailers('v1: x\n\nCo-Authored-By: A Person <a@b.c>\n'), []);
});

test('the changelog entry must be for this version and well formed', () => {
  assert.throws(() => rel.parseChangelogEntry('## v1.2.3 — 2026-09-29 (this fork) — t\n\nbody\n', '1.2.4'), /for v1\.2\.3/);
  assert.throws(() => rel.parseChangelogEntry('# v1.2.4 title\n\nbody\n', '1.2.4'), /must start with/);
  assert.throws(() => rel.parseChangelogEntry('## v1.2.4 — 2026-09-29 (this fork) — t\n', '1.2.4'), /no body/);
  const e = rel.parseChangelogEntry('\n## v1.2.4 — 2026-09-29 (this fork) — the title\n\nbody\n', '1.2.4');
  assert.strictEqual(e.title, 'the title');
  assert.strictEqual(rel.insertChangelog('# Changelog\n\n## v1.2.3 — old\n', e.entry, '1.2.4'),
    '# Changelog\n\n## v1.2.4 — 2026-09-29 (this fork) — the title\n\nbody\n\n## v1.2.3 — old\n');
  assert.throws(() => rel.insertChangelog('# Changelog\n\n## v1.2.4 — dup\n', e.entry, '1.2.4'), /already has an entry/);
});

test('nextVersion accepts patch/minor/major and refuses a non-increase', () => {
  assert.strictEqual(rel.nextVersion('2.58.5', 'patch'), '2.58.6');
  assert.strictEqual(rel.nextVersion('2.58.5', 'minor'), '2.59.0');
  assert.strictEqual(rel.nextVersion('2.58.5', 'major'), '3.0.0');
  assert.throws(() => rel.nextVersion('2.58.5', '2.58.5'), /not above/);
  assert.throws(() => rel.nextVersion('2.58.5', 'v2.58.6'), /must be x\.y\.z/);
});

// --- sandbox runs -----------------------------------------------------------------

test('sandbox runs', { concurrency: 6 }, async (t) => {
  const cases = [];
  const add = (name, fn) => cases.push(t.test(name, fn));

  add('happy path: commit, fast-forward, push, one tag, run polled, asset verified', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s), { FAKE_GH_PENDING_POLLS: '2' });
    assert.strictEqual(r.code, 0, r.out);
    assertReleased(s, { baseHead });
    const calls = s.ghCalls().map((a) => `${a[0]} ${a[1]}`);
    assert.ok(calls.filter((c) => c === 'run list').length >= 3, 'polled until the run concluded');
    assert.ok(calls.includes('release download'));
    assert.ok(!fs.existsSync(path.join(s.base, 'claude.log')), 'no claude calls without --publish');
    const done = JSON.parse(fs.readFileSync(path.join(s.work, '.git', `release-journal.v${s.version}.done.json`), 'utf8'));
    assert.deepStrictEqual(Object.keys(done.steps), ['integrate', 'push', 'tag', 'run', 'asset']);
    assert.strictEqual(done.parent, baseHead);
  });

  add('--dry-run validates the candidate offline and leaves nothing behind', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    // An unreachable remote proves the dry run never talks to it.
    s.git(['remote', 'set-url', 'origin', path.join(s.base, 'does-not-exist.git')]);
    const r = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /dry run OK/);
    s.git(['remote', 'set-url', 'origin', s.origin]);
    assertUntouched(s, { baseHead });
    assert.deepStrictEqual(s.ghCalls(), []);
  });

  add('--dry-run fails when validation fails, and still cleans up', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s, ['--dry-run']), { RELEASE_VALIDATE_CMD: 'echo validation broke >&2; exit 3' });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /STOPPED/);
    assertUntouched(s, { baseHead });
  });

  add('positive control: the sandbox validation really runs the consistency tests', async () => {
    const s = sandbox();
    const mp = path.join(s.work, '.claude-plugin', 'marketplace.json');
    fs.writeFileSync(mp, fs.readFileSync(mp, 'utf8').replace(/(\d+) lessons across/, (m, n) => `${Number(n) + 1} lessons across`));
    s.git(['commit', '-q', '-am', 'a stale count']);
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s));                      // main is one commit ahead: allowed
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /marketplace\.json states lesson count/);
    assertUntouched(s, { baseHead, originHead: s.gitOrigin(['rev-parse', 'refs/heads/main']) });
  });

  add('a pin that states another version stops the bump', async () => {
    const s = sandbox();
    const readme = path.join(s.work, 'README.md');
    fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/Version tracking \(v\d+\.\d+\.\d+/, 'Version tracking (v1.0.0'));
    s.git(['commit', '-q', '-am', 'a stale pin']);
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /pin states 1\.0\.0, expected/);
    assertUntouched(s, { baseHead, originHead: s.gitOrigin(['rev-parse', 'refs/heads/main']) });
  });

  add('dirty worktree: stops before creating a candidate', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(s.work, 'stray.txt'), 'untracked\n');
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /not clean/);
    fs.rmSync(path.join(s.work, 'stray.txt'));
    assertUntouched(s, { baseHead });
    // A staged-only change is refused the same way.
    fs.appendFileSync(path.join(s.work, 'README.md'), '\n');
    s.git(['add', 'README.md']);
    const r2 = await s.release(releaseArgs(s));
    assert.strictEqual(r2.code, 1, r2.out);
    assert.match(r2.out, /not clean/);
    assert.strictEqual(s.git(['worktree', 'list']).split('\n').length, 1);
  });

  add('not on main, and behind origin/main: both stop', async () => {
    const s = sandbox();
    s.git(['checkout', '-q', '-b', 'feature']);
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /not main/);
    s.git(['checkout', '-q', 'main']);
    // A peer pushes to origin: main is now behind.
    const peer = path.join(s.base, 'peer');
    s.git(['clone', '-q', s.origin, peer], { cwd: s.base });
    s.git(['commit', '-q', '--allow-empty', '-m', 'peer'], { cwd: peer });
    s.git(['push', '-q', 'origin', 'main'], { cwd: peer });
    const r2 = await s.release(releaseArgs(s));
    assert.strictEqual(r2.code, 1, r2.out);
    assert.match(r2.out, /behind or has diverged/);
    assert.strictEqual(s.gitOrigin(['tag', '--list']), '');
  });

  add('a pre-commit hook that edits and stages a file: stops on the tree hash, user worktree untouched', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    s.hook('pre-commit', 'echo "hook was here" >> CHANGELOG.md && git add CHANGELOG.md');
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /is not the validated tree/);
    assertUntouched(s, { baseHead });
  });

  add('a pre-commit hook that edits without staging: stops on the dirty candidate', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    s.hook('pre-commit', 'echo "hook was here" >> README.md');
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /not clean after the commit/);
    assertUntouched(s, { baseHead });
  });

  add('a commit-msg hook that adds a Claude co-author trailer: stops', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    s.hook('commit-msg', 'printf "\\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\\n" >> "$1"');
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /committed message carries Co-Authored-By: Claude/);
    assertUntouched(s, { baseHead });
  });

  add('a pre-commit hook that stages an extra file: stops on the path list', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    s.hook('pre-commit', 'mkdir -p docs/internal && echo x > docs/internal/leak.md && git add -f docs/internal/leak.md');
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /docs\/internal\/ paths/);
    assertUntouched(s, { baseHead });
  });

  add('main moved during the run: stops, nothing integrated or published', async () => {
    const s = sandbox();
    s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s), { RELEASE_TEST_HOOK_BEFORE_INTEGRATE: 'git commit -q --allow-empty -m "a peer session"' });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /moved to .* while the release ran/);
    assert.strictEqual(s.git(['log', '-1', '--format=%s']), 'a peer session', 'main is the peer commit, not the release');
    assert.strictEqual(s.gitOrigin(['tag', '--list']), '');
    assert.ok(!fs.existsSync(s.journal), 'no journal');
    assert.deepStrictEqual(s.ghCalls(), []);
    assert.strictEqual(s.git(['worktree', 'list']).split('\n').length, 1);
  });

  add('a rejected branch push: no tag, journal says rejected, resume still refuses, --abandon closes it', async () => {
    const s = sandbox();
    const peer = path.join(s.base, 'peer');
    s.git(['clone', '-q', s.origin, peer], { cwd: s.base });
    const hookCmd = `git -C "${peer}" commit -q --allow-empty -m peer && git -C "${peer}" push -q origin main`;
    const r = await s.release(releaseArgs(s), { RELEASE_TEST_HOOK_BEFORE_PUSH: hookCmd });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /rejected/);
    assert.match(r.out, /Do NOT tag/);
    assert.strictEqual(s.gitOrigin(['tag', '--list']), '', 'no tag on origin');
    assert.strictEqual(s.git(['tag', '--list']), '', 'no local tag');
    assert.strictEqual(s.gitOrigin(['log', '-1', '--format=%s', 'main']), 'peer');
    const j = JSON.parse(fs.readFileSync(s.journal, 'utf8'));
    assert.strictEqual(j.steps.push.state, 'rejected');
    assert.deepStrictEqual(s.ghCalls(), []);
    const again = await s.release(['--resume']);
    assert.strictEqual(again.code, 1, again.out);
    assert.match(again.out, /does not lead to the release commit/);
    assert.strictEqual(s.gitOrigin(['tag', '--list']), '');
    const dry = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(dry.code, 1);
    assert.match(dry.out, /in progress/);
    const ab = await s.release(['--abandon']);
    assert.strictEqual(ab.code, 0, ab.out);
    assert.ok(!fs.existsSync(s.journal));
  });

  add('the Release run fails: stops after the tag, and --abandon is refused', async () => {
    const s = sandbox();
    const r = await s.release(releaseArgs(s), { FAKE_GH_RUN: 'failure' });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /concluded "failure"/);
    assert.strictEqual(JSON.parse(fs.readFileSync(s.journal, 'utf8')).steps.run.state, 'failed');
    const ab = await s.release(['--abandon']);
    assert.strictEqual(ab.code, 1);
    assert.match(ab.out, /cannot be abandoned/);
    const ok = await s.release(['--resume']);                     // the workflow was re-run and passed
    assert.strictEqual(ok.code, 0, ok.out);
  });

  add('no Release run appears (the dropped tag-push event): says so and how to re-push the one tag', async () => {
    const s = sandbox();
    const r = await s.release(releaseArgs(s), { FAKE_GH_RUN: 'none' });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /no release\.yml run appeared/);
    assert.match(r.out, /more than three tags/);
    assert.strictEqual(JSON.parse(fs.readFileSync(s.journal, 'utf8')).steps.run.state, 'no-run');
  });

  add('the release asset differs from git archive of the tag: stops, and resume re-checks it', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    for (const mode of ['tampered', 'extra']) {
      const r = await s.release(fs.existsSync(s.journal) ? ['--resume'] : releaseArgs(s), { FAKE_GH_ZIP: mode });
      assert.strictEqual(r.code, 1, r.out);
      assert.match(r.out, mode === 'tampered' ? /differs: version\.json/ : /only in the release asset: stale\.txt/);
      assert.strictEqual(JSON.parse(fs.readFileSync(s.journal, 'utf8')).steps.asset.state, 'mismatch');
    }
    const ok = await s.release(['--resume']);
    assert.strictEqual(ok.code, 0, ok.out);
    assertReleased(s, { baseHead });
  });

  add('--publish: About text pushed, plugin updated, installed version read back', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s, ['--publish']));
    assert.strictEqual(r.code, 0, r.out);
    assertReleased(s, { baseHead });
    const want = fs.readFileSync(path.join(s.work, '.github', 'repo-description.txt'), 'utf8').replace(/\n/g, '');
    assert.strictEqual(fs.readFileSync(s.env.FAKE_GH_DESCRIPTION_FILE, 'utf8'), want);
    const claudeCalls = fs.readFileSync(path.join(s.base, 'claude.log'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    assert.deepStrictEqual(claudeCalls.map((a) => a.slice(0, 2).join(' ')), ['plugin marketplace', 'plugin install']);
  });

  // --- hard rules over every outgoing commit, not just the release commit -------

  add('an ahead content commit with a forbidden trailer, or touching docs/internal/: refused before anything is created', async () => {
    const s = sandbox();
    const originHead = s.gitOrigin(['rev-parse', 'refs/heads/main']);
    const state = path.join(s.work, SKILL_REL, 'references', 'state', 'model-landscape.md');
    fs.appendFileSync(state, '\ncontent edit\n');
    s.git(['commit', '-q', '-am', 'content\n\nClaude-Session: https://claude.ai/code/session_x']);
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /preconditions: the push would publish commits that break the hard rules/);
    assert.match(r.out, /carries Claude-Session:/);
    assertUntouched(s, { baseHead: s.git(['rev-parse', 'HEAD']), originHead });

    // docs/internal/ added and removed again inside the range: the range diff is
    // empty, but the objects would be pushed; per-commit paths catch it.
    const s2 = sandbox();
    const o2 = s2.gitOrigin(['rev-parse', 'refs/heads/main']);
    fs.mkdirSync(path.join(s2.work, 'docs', 'internal'), { recursive: true });
    fs.writeFileSync(path.join(s2.work, 'docs', 'internal', 'plan.md'), 'private\n');
    s2.git(['add', '-f', 'docs/internal/plan.md']);
    s2.git(['commit', '-q', '-m', 'oops']);
    s2.git(['rm', '-q', 'docs/internal/plan.md']);
    s2.git(['commit', '-q', '-m', 'remove it again']);
    const r2 = await s2.release(releaseArgs(s2, ['--dry-run']));
    assert.strictEqual(r2.code, 1, r2.out);
    assert.match(r2.out, /touch docs\/internal\/: "docs\/internal\/plan\.md"/);
    assertUntouched(s2, { baseHead: s2.git(['rev-parse', 'HEAD']), originHead: o2 });
  });

  add('docs/internal/ files whose names git would C-quote (tab, newline, double quote, non-ASCII): each is refused', async () => {
    const s = sandbox();
    const originHead = s.gitOrigin(['rev-parse', 'refs/heads/main']);
    const names = ODD_NAMES.map((n) => `docs/internal/${n}`);
    fs.mkdirSync(path.join(s.work, 'docs', 'internal'), { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(s.work, n), 'private\n');
    s.git(['add', '-f', '--', ...names]);
    s.git(['commit', '-q', '-m', 'odd names']);
    // Two deleted again inside the range (only the per-commit listing sees them),
    // two still present at the tip (the range diff sees them too).
    s.git(['rm', '-q', '--', names[0], names[2]]);
    s.git(['commit', '-q', '-m', 'remove two again']);
    const r = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /preconditions: the push would publish commits that break the hard rules/);
    for (const n of names) assert.ok(r.out.includes(JSON.stringify(n)), `${JSON.stringify(n)} is named:\n${r.out}`);
    assertUntouched(s, { baseHead: s.git(['rev-parse', 'HEAD']), originHead });
  });

  add('the pre-push re-check: a resume after the remote was rewound refuses to re-publish an offending commit', async () => {
    const s = sandbox();
    // A content commit with a trailer that is already on origin: not outgoing, so step 1 passes.
    fs.appendFileSync(path.join(s.work, 'README.md'), '\n');
    fs.mkdirSync(path.join(s.work, 'docs', 'internal'), { recursive: true });
    fs.writeFileSync(path.join(s.work, 'docs', 'internal', 'x.md'), 'x\n');
    s.git(['add', '-f', 'README.md', 'docs/internal/x.md']);
    s.git(['commit', '-q', '-m', 'published earlier\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>']);
    const base = s.git(['rev-parse', 'HEAD~1']);
    s.git(['push', '-q', 'origin', 'main']);
    const r = await s.release(releaseArgs(s), { RELEASE_CRASH_AT: 'push:before-action' });
    assertCrashed(r);
    // Someone rewinds origin main past that commit: pushing the candidate now publishes it again.
    s.gitOrigin(['update-ref', 'refs/heads/main', base]);
    const again = await s.release(['--resume']);
    assert.strictEqual(again.code, 1, again.out);
    assert.match(again.out, /before the push: the push would publish commits that break the hard rules/);
    assert.match(again.out, /carries Co-Authored-By: Claude/);
    assert.match(again.out, /touch docs\/internal\/: "docs\/internal\/x\.md"/);
    assert.strictEqual(s.gitOrigin(['rev-parse', 'refs/heads/main']), base, 'nothing pushed');
    assert.strictEqual(s.gitOrigin(['tag', '--list']), '');
  });

  add('the remote rewound between the pre-push check and the push: the lease rejects the push', async () => {
    const s = sandbox();
    fs.appendFileSync(path.join(s.work, 'README.md'), '\n');
    s.git(['commit', '-q', '-am', 'published earlier\n\nClaude-Session: https://claude.ai/code/session_y']);
    const base = s.git(['rev-parse', 'HEAD~1']);
    s.git(['push', '-q', 'origin', 'main']);
    // Runs after the remote SHA was read and before the outgoing check and push.
    const r = await s.release(releaseArgs(s), { RELEASE_TEST_HOOK_BEFORE_PUSH: `git --git-dir "${s.origin}" update-ref refs/heads/main ${base}` });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /the push of main was rejected/);
    assert.strictEqual(s.gitOrigin(['rev-parse', 'refs/heads/main']), base, 'the offending commit was not re-published');
    assert.strictEqual(s.gitOrigin(['tag', '--list']), '');
  });

  add('a --message file carrying a forbidden trailer: refused before anything is created', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const m = path.join(s.base, 'msg.txt');
    fs.writeFileSync(m, 'body\n\nClaude-Session: https://claude.ai/x\n');
    const r = await s.release(releaseArgs(s, ['--message', m]));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /would carry Claude-Session:/);
    assertUntouched(s, { baseHead });
  });

  // --- remote destination ---------------------------------------------------------

  add('a local fetch URL with a non-local pushurl or pushInsteadOf: refused before anything (offline)', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    s.git(['config', 'remote.origin.pushurl', 'ssh://git@example.invalid/release.git']);
    const r = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /does not fetch from and push to one single URL .*push: ssh:\/\/git@example\.invalid\/release\.git/);
    assert.doesNotMatch(r.out, /step 1/, 'stopped before the preconditions');
    s.git(['config', '--unset', 'remote.origin.pushurl']);
    s.git(['config', `url.ssh://git@example.invalid/.pushInsteadOf`, path.dirname(s.origin) + '/']);
    const r2 = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(r2.code, 1, r2.out);
    assert.match(r2.out, /one single URL .*push: ssh:\/\/git@example\.invalid\//);
    s.git(['config', '--unset', `url.ssh://git@example.invalid/.pushInsteadOf`]);
    // Two push URLs, both local, still two destinations.
    s.git(['config', 'remote.origin.pushurl', s.origin]);
    s.git(['config', '--add', 'remote.origin.pushurl', path.join(s.base, 'mirror.git')]);
    const r3 = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(r3.code, 1, r3.out);
    assert.match(r3.out, /one single URL/);
    s.git(['config', '--unset-all', 'remote.origin.pushurl']);
    assertUntouched(s, { baseHead });
  });

  add('push.followTags=true with an unpublished annotated tag and a stray lightweight tag: exactly one tag reaches origin', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    s.git(['config', 'push.followTags', 'true']);
    s.git(['tag', '-a', '-m', 'an unpublished annotated tag', 'wip-annotated', 'HEAD']);
    s.git(['tag', 'wip-light', 'HEAD']);
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 0, r.out);
    assertReleased(s, { baseHead });                              // asserts exactly one tag on origin
    assert.deepStrictEqual(s.gitOrigin(['tag', '--list']).split('\n'), [`v${s.version}`]);
  });

  add('resume and abandon refuse when the remote URL, remote name or GitHub repo changed since the journal', async () => {
    const s = sandbox();
    const originHead = s.gitOrigin(['rev-parse', 'refs/heads/main']);
    const r = await s.release(releaseArgs(s), { RELEASE_CRASH_AT: 'push:before-action' });
    assertCrashed(r);
    const other = path.join(s.base, 'other.git');
    s.git(['clone', '-q', '--bare', s.origin, other], { cwd: s.base });
    s.git(['remote', 'set-url', 'origin', other]);
    for (const args of [['--resume'], ['--abandon']]) {
      const x = await s.release(args);
      assert.strictEqual(x.code, 1, x.out);
      assert.match(x.out, /started against another destination \(remote URL .* -> .*other\.git\)/);
    }
    s.git(['remote', 'set-url', 'origin', s.origin]);
    s.git(['remote', 'add', 'upstream2', s.origin]);
    const y = await s.release(['--resume'], { RELEASE_REMOTE: 'upstream2' });
    assert.strictEqual(y.code, 1, y.out);
    assert.match(y.out, /remote name origin -> upstream2/);
    const z = await s.release(['--resume'], { RELEASE_REPO: 'someone/else' });
    assert.strictEqual(z.code, 1, z.out);
    assert.match(z.out, /GitHub repo yaniv-golan\/claude-code-internals -> someone\/else/);
    assert.strictEqual(s.gitOrigin(['rev-parse', 'refs/heads/main']), originHead, 'origin untouched');
    assert.strictEqual(s.git(['--git-dir', other, 'rev-parse', 'refs/heads/main']), originHead, 'the other remote untouched');
    assert.deepStrictEqual(s.ghCalls(), []);
    const ok = await s.release(['--resume']);                      // the original destination: completes
    assert.strictEqual(ok.code, 0, ok.out);
  });

  // --- journal integrity ------------------------------------------------------------

  add('a valid-JSON journal whose candidate was swapped to its parent: resume refuses before tagging', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s), { RELEASE_CRASH_AT: 'tag:before-action' });
    assertCrashed(r);
    s.git(['tag', '-d', `v${s.version}`]);                          // the crash left the local tag; start the tag step afresh
    const j = JSON.parse(fs.readFileSync(s.journal, 'utf8'));
    fs.writeFileSync(s.journal, JSON.stringify({ ...j, candidate: j.parent }, null, 2));
    const again = await s.release(['--resume']);
    assert.strictEqual(again.code, 1, again.out);
    assert.match(again.out, /failed re-verification/);
    assert.match(again.out, /tree is .*the journal recorded/);
    assert.match(again.out, /version\.json says/);
    assert.strictEqual(s.gitOrigin(['tag', '--list']), '', 'no tag anywhere');
    assert.strictEqual(s.git(['tag', '--list']), '');
    assert.strictEqual(s.gitOrigin(['rev-parse', 'refs/heads/main']), j.candidate, 'origin main is still the real release commit');
    // A structurally broken journal is refused the same way.
    const { tree, ...noTree } = j;
    assert.ok(tree);
    fs.writeFileSync(s.journal, JSON.stringify(noTree, null, 2));
    const broken = await s.release(['--resume']);
    assert.strictEqual(broken.code, 1, broken.out);
    assert.match(broken.out, /not a valid release journal:\n.*tree is not/);
    fs.writeFileSync(s.journal, JSON.stringify(j, null, 2));
    const ok = await s.release(['--resume']);
    assert.strictEqual(ok.code, 0, ok.out);
    assertReleased(s, { baseHead });
  });

  // --- publish: the validated repo, and stand-ins against a local remote ---------------

  add('--publish syncs the About text of RELEASE_REPO, not the script default', async () => {
    const s = sandbox();
    const r = await s.release(releaseArgs(s, ['--publish']), { RELEASE_REPO: 'sandbox-owner/sandbox-repo' });
    assert.strictEqual(r.code, 0, r.out);
    const api = s.ghCalls().filter((a) => a[0] === 'api');
    assert.ok(api.length >= 2, 'check + push');
    for (const a of api) assert.ok(a.includes('repos/sandbox-owner/sandbox-repo'), JSON.stringify(a));
    assert.ok(!s.ghCalls().some((a) => a.join(' ').includes('yaniv-golan/claude-code-internals')), 'the real repo is never named');
  });

  add('--publish with a gh stand-in not named gh: it is the only gh the description sync runs', async () => {
    const s = makeSandbox(undefined, { ghName: 'fake-gh' });
    sandboxes.push(s);
    const baseHead = s.git(['rev-parse', 'HEAD']);
    assert.ok(!fs.existsSync(path.join(s.bin, 'gh')) && fs.existsSync(path.join(s.bin, 'fake-gh')));
    const r = await s.release(releaseArgs(s, ['--publish']));
    assert.strictEqual(r.code, 0, r.out);
    assert.deepStrictEqual(s.tripwireCalls(), [], 'the PATH gh (a tripwire standing in for the real one) never ran');
    assert.doesNotMatch(r.out, /TRIPWIRE/);
    const api = s.ghCalls().filter((a) => a[0] === 'api');
    assert.ok(api.some((a) => a.includes('PATCH')) && api.length >= 2, 'the stand-in served check + push + check');
    const want = fs.readFileSync(path.join(s.work, '.github', 'repo-description.txt'), 'utf8').replace(/\n/g, '');
    assert.strictEqual(fs.readFileSync(s.env.FAKE_GH_DESCRIPTION_FILE, 'utf8'), want);
    assertReleased(s, { baseHead });
  });

  add('a local (test) remote without RELEASE_GH / RELEASE_CLAUDE stand-ins: refused before anything', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s, ['--publish']), { RELEASE_CLAUDE: '' });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /RELEASE_CLAUDE is not set/);
    const r2 = await s.release(releaseArgs(s), { RELEASE_GH: '' });
    assert.strictEqual(r2.code, 1, r2.out);
    assert.match(r2.out, /RELEASE_GH is not set/);
    assertUntouched(s, { baseHead });
    // A dry run needs neither (it is offline).
    const dry = await s.release(releaseArgs(s, ['--dry-run']), { RELEASE_GH: '', RELEASE_CLAUDE: '' });
    assert.strictEqual(dry.code, 0, dry.out);
  });

  // --- polling --------------------------------------------------------------------------

  add('a gh run list that hangs is killed at the poll deadline and recorded pending; resume finishes', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const t0 = Date.now();
    const r = await s.release(releaseArgs(s), { FAKE_GH_SLEEP_MS: '60000', RELEASE_POLL_TIMEOUT_MS: '1500' });
    const took = Date.now() - t0;
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /did not answer before the 2s poll deadline \(killed\)/);
    assert.ok(took < 30000, `bounded by the deadline, not by gh (took ${took}ms)`);
    const j = JSON.parse(fs.readFileSync(s.journal, 'utf8'));
    assert.strictEqual(j.steps.run.state, 'pending');
    assert.strictEqual(j.steps.run.reason, 'gh-timeout');
    const ok = await s.release(['--resume']);
    assert.strictEqual(ok.code, 0, ok.out);
    assertReleased(s, { baseHead });
  });

  // --- guards that no other case reaches --------------------------------------------------

  add('test-only knobs are ignored for a non-local remote (offline dry run, the real check-clean path runs)', async () => {
    const s = sandbox();
    fs.writeFileSync(path.join(s.work, 'scripts', 'check-clean.sh'), '#!/usr/bin/env bash\necho REAL-CHECK-CLEAN-STUB\n');
    s.git(['commit', '-q', '-am', 'stub check-clean for this sandbox']);
    s.git(['remote', 'set-url', 'origin', 'https://example.invalid/claude-code-internals.git']);
    const r = await s.release(releaseArgs(s, ['--dry-run']), {
      RELEASE_VALIDATE_CMD: 'echo OVERRIDE-RAN',
      // Not the sandbox identity, so the identity refusal does not fire first.
      GIT_CONFIG_NOSYSTEM: '', GIT_AUTHOR_NAME: 'Someone', GIT_AUTHOR_EMAIL: 'someone@test.local',
    });
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /ignoring RELEASE_VALIDATE_CMD: test-only, and the remote https:\/\/example\.invalid\/claude-code-internals\.git is not a local path/);
    assert.match(r.out, /REAL-CHECK-CLEAN-STUB/);
    assert.doesNotMatch(r.out, /OVERRIDE-RAN/);
  });

  add('the sandbox git identity against a non-local remote: refused (offline dry run)', async () => {
    const s = sandbox();
    s.git(['remote', 'set-url', 'origin', 'https://example.invalid/claude-code-internals.git']);
    const r = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /looks like a sandbox's .* but the remote https:\/\/example\.invalid\/claude-code-internals\.git is real/);
    assert.strictEqual(s.git(['worktree', 'list']).split('\n').length, 1);
  });

  add('build.js writing an extra file: "unexpected change in the candidate"', async () => {
    const s = sandbox();
    const baseHead0 = s.git(['rev-parse', 'HEAD']);
    const build = path.join(s.work, SKILL_REL, 'scripts', 'build.js');
    fs.appendFileSync(build, "\nif (!process.argv.includes('--check')) require('fs').writeFileSync(require('path').join(__dirname, 'EXTRA.txt'), 'x\\n');\n");
    s.git(['commit', '-q', '-am', 'a build that writes a stray file']);
    const baseHead = s.git(['rev-parse', 'HEAD']);
    assert.notStrictEqual(baseHead, baseHead0);
    const r = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /unexpected change in the candidate: "\?\? .*EXTRA\.txt"/);
    assertUntouched(s, { baseHead, originHead: baseHead0 });
  });

  add('the tag already exists, locally or on the remote: refused in step 1', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    s.git(['tag', `v${s.version}`]);
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`tag v${s.version.replace(/\./g, '\\.')} already exists locally`));
    s.git(['tag', '-d', `v${s.version}`]);
    s.gitOrigin(['tag', `v${s.version}`, 'refs/heads/main']);
    const r2 = await s.release(releaseArgs(s));
    assert.strictEqual(r2.code, 1, r2.out);
    assert.match(r2.out, /already exists on origin/);
    assert.strictEqual(s.git(['rev-parse', 'HEAD']), baseHead);
    assert.ok(!fs.existsSync(s.journal));
  });

  add('a post-commit hook that re-parents the commit (same tree, paths, message): stops on the parent', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    s.hook('post-commit', [
      'b=$(git commit-tree "HEAD~1^{tree}" -p HEAD~1 -m twin)',
      'n=$(git log -1 --format=%B HEAD | git commit-tree "HEAD^{tree}" -p "$b" -F -)',
      'git update-ref HEAD "$n"',
    ].join('\n'));
    const r = await s.release(releaseArgs(s));
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /the commit's parents are [0-9a-f]+, expected/);
    assert.doesNotMatch(r.out, /is not the validated tree|expected exactly|carries/);
    assertUntouched(s, { baseHead });
  });

  add('validation that changes the candidate: the dry run fails the after-validation tree check', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s, ['--dry-run']), { RELEASE_VALIDATE_CMD: 'echo x >> CHANGELOG.md && git add CHANGELOG.md' });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /after validation: the candidate's index is tree/);
    const r2 = await s.release(releaseArgs(s, ['--dry-run']), { RELEASE_VALIDATE_CMD: 'touch UNTRACKED.txt' });
    assert.strictEqual(r2.code, 1, r2.out);
    assert.match(r2.out, /after validation: .*untracked: UNTRACKED\.txt/);
    assertUntouched(s, { baseHead });
  });

  add('validation runs without RELEASE_* knobs or NODE_TEST_CONTEXT', async () => {
    const s = sandbox();
    const probe = 'if env | grep -E "^(RELEASE_|NODE_TEST_CONTEXT=)"; then echo LEAK""ED; exit 9; fi';
    const r = await s.release(releaseArgs(s, ['--dry-run']), { RELEASE_VALIDATE_CMD: probe, NODE_TEST_CONTEXT: 'child-v8' });
    assert.strictEqual(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /LEAKED/);
  });

  add('the worktree turns dirty before the fast-forward: stops, nothing integrated or published', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s), { RELEASE_TEST_HOOK_BEFORE_INTEGRATE: 'echo x > stray.txt' });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /no longer clean/);
    assert.strictEqual(s.git(['rev-parse', 'HEAD']), baseHead);
    assert.strictEqual(s.gitOrigin(['rev-parse', 'refs/heads/main']), baseHead);
    assert.ok(!fs.existsSync(s.journal));
    assert.deepStrictEqual(s.ghCalls(), []);
  });

  for (const [what, hookCmd, re] of [
    ['origin main was rewound after the push', 'git push -q -f origin HEAD~1:refs/heads/main', /does not contain the release commit; refusing to tag/],
    ['a peer pushed the tag elsewhere', 'git push -q origin HEAD~1:refs/tags/v__V__', /tag v\S+ on origin points at [0-9a-f]+, not the release commit/],
    ['a local tag appeared elsewhere', 'git tag v__V__ HEAD~1', /local tag v\S+ points at [0-9a-f]+, not/],
  ]) {
    add(`the tag step refuses when ${what}`, async () => {
      const s = sandbox();
      const r = await s.release(releaseArgs(s), { RELEASE_TEST_HOOK_BEFORE_TAG: hookCmd.replace('__V__', s.version) });
      assert.strictEqual(r.code, 1, r.out);
      assert.match(r.out, re);
      const originTags = s.gitOrigin(['tag', '--list']).split('\n').filter(Boolean);
      for (const t of originTags) assert.notStrictEqual(s.gitOrigin(['rev-parse', `${t}^{commit}`]), s.git(['rev-parse', 'HEAD']), 'no tag at the candidate');
      assert.deepStrictEqual(s.ghCalls(), []);
    });
  }

  add('a lesson with a stale vocabulary proposal: warns (does not block) and step 3 lists it with the regenerate command', async () => {
    const s = sandbox();
    const skill = path.join(s.work, SKILL_REL);
    // The release validates the pinned proposals file, so the sandbox keeps the committed one and this
    // asserts on the delta: whatever the committed tree already has stale (warn-only), plus 89.
    const P = require(path.join(skill, 'scripts', 'prepare-lessons.js'));
    const V = require(path.join(skill, 'scripts', 'lib', 'vocab.js'));
    const staleNow = () => { const ld = P.load(skill); return V.staleProposals(ld.topic.lessons, ld.lessonText, V.loadProposals(skill).byId).stale; };
    const baseline = staleNow();
    assert.ok(!baseline.includes(89), 'lesson 89 starts current');
    const l = JSON.parse(fs.readFileSync(path.join(skill, 'references', 'topic-index.json'), 'utf8')).lessons.find((x) => x.id === 89);
    const file = path.join(skill, 'references', l.file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const i = lines.findIndex((x, n) => n >= l.startLine && n < l.endLine && x.includes(' the '));
    assert.ok(i >= 0);
    lines[i] = lines[i].replace(' the ', ' the quite ');
    fs.writeFileSync(file, lines.join('\n'));
    s.git(['commit', '-q', '-am', 'a prose edit to lesson 89']);
    const expected = JSON.parse(fs.readFileSync(path.join(skill, 'references', 'topic-index.json'), 'utf8')).lessons
      .map((x) => x.id).filter((id) => id === 89 || baseline.includes(id));
    assert.deepStrictEqual(staleNow(), expected, 'the edit made 89 stale, and nothing else');
    const r = await s.release(releaseArgs(s, ['--dry-run']));
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`STALE VOCABULARY: ${expected.length} lesson\\(s\\) changed since their vocabulary proposal was generated:\\nrelease: {3}${expected.join(', ')}\\n`));
    assert.match(r.out, /Not blocking \(STALE_VOCAB_BLOCKS in prepare-lessons\.js is off\)/);
    assert.match(r.out, /prepare-lessons\.js --generate/);
  });

  add('a release asset under another top-level directory: stops', async () => {
    const s = sandbox();
    const r = await s.release(releaseArgs(s), { FAKE_GH_ZIP: 'wrongtop' });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /the release asset's top level is skill, expected claude-code-internals\//);
  });

  add('--publish: an install that does not take effect fails the read-back', async () => {
    const s = sandbox();
    const r = await s.release(releaseArgs(s, ['--publish']), { FAKE_CLAUDE_INSTALL: 'noop' });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /the installed skill reports version undefined \(not installed\), expected/);
    assert.ok(fs.existsSync(s.journal), 'resumable');
  });

  // Crash after each action / record, then resume: the release completes exactly
  // once (one release commit, one tag, origin at the candidate).
  for (const point of [
    'integrate:before-action', 'integrate:after-action', 'integrate:after-record',
    'push:before-action', 'push:after-action', 'push:after-record',
    'tag:before-action', 'tag:after-action', 'tag:after-record',
    'run:after-record', 'asset:after-action',
  ]) {
    add(`crash at ${point}, then --resume completes the release exactly once`, async () => {
      const s = sandbox();
      const baseHead = s.git(['rev-parse', 'HEAD']);
      const r = await s.release(releaseArgs(s), { RELEASE_CRASH_AT: point });
      assertCrashed(r);
      assert.ok(fs.existsSync(s.journal), 'the journal survives the crash');
      const candidate = JSON.parse(fs.readFileSync(s.journal, 'utf8')).candidate;
      const again = await s.release(['--resume']);
      assert.strictEqual(again.code, 0, again.out);
      assert.strictEqual(s.git(['rev-parse', 'HEAD']), candidate, 'resume integrated the journaled candidate, not a new one');
      // No harness cleanup: the resume itself must have removed what the crash
      // left (the candidate worktree at integrate:*, the asset dir at asset:*).
      assertReleased(s, { baseHead });
    });
  }

  add('a crash leaves the candidate worktree: --abandon removes it (journaled, in the temp root, registered)', async () => {
    const s = sandbox();
    const r = await s.release(releaseArgs(s), { RELEASE_CRASH_AT: 'integrate:before-action' });
    assertCrashed(r);
    const dir = JSON.parse(fs.readFileSync(s.journal, 'utf8')).temp.candidate_worktree;
    assert.ok(fs.existsSync(dir), 'the crash left the candidate behind');
    assert.strictEqual(s.git(['worktree', 'list']).split('\n').length, 2);
    const ab = await s.release(['--abandon']);
    assert.strictEqual(ab.code, 0, ab.out);
    assert.ok(!fs.existsSync(dir), ab.out);
    assert.strictEqual(s.git(['worktree', 'list']).split('\n').length, 1);
    assert.deepStrictEqual(fs.readdirSync(s.tmp).filter((f) => f.startsWith('cci-')), []);
  });

  add('a journaled temp path that is not provably ours is reported and left alone', async () => {
    const s = sandbox();
    const baseHead = s.git(['rev-parse', 'HEAD']);
    const r = await s.release(releaseArgs(s), { RELEASE_CRASH_AT: 'integrate:after-record' });
    assertCrashed(r);
    const j = JSON.parse(fs.readFileSync(s.journal, 'utf8'));
    s.git(['worktree', 'remove', '--force', j.temp.candidate_worktree]);   // the real one, so the release can finish clean
    // A well-named directory outside the temp root, and one in the temp root that
    // git does not have registered as a worktree: neither is provably ours.
    const outside = path.join(s.base, 'cci-asset-AAAAAA');
    const unregistered = path.join(fs.realpathSync(s.tmp), 'cci-release-ZZZZZZ');
    for (const d of [outside, unregistered]) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'keep.txt'), 'x\n'); }
    fs.writeFileSync(s.journal, JSON.stringify({ ...j, temp: { candidate_worktree: unregistered, asset_dir: outside } }, null, 2));
    const again = await s.release(['--resume']);
    assert.strictEqual(again.code, 0, again.out);
    assert.match(again.out, /left in place: ".*cci-release-ZZZZZZ" \(journaled candidate_worktree; not a registered worktree/);
    assert.match(again.out, /left in place: ".*cci-asset-AAAAAA" \(journaled asset_dir; not directly in the temp root/);
    for (const d of [outside, unregistered]) assert.ok(fs.existsSync(path.join(d, 'keep.txt')), `${d} not removed`);
    fs.rmSync(unregistered, { recursive: true });                    // planted by this test
    assertReleased(s, { baseHead });
  });

  await Promise.all(cases);
});

// The real validation path, end to end: a sandbox holding a full copy of this
// checkout, released with RELEASE_VALIDATE_CMD unset, so step 3 runs the real
// scripts/check-clean.sh in the candidate (which runs this file again, without
// RELEASE_SLOW_TESTS: validationEnv strips RELEASE_*). Minutes, so opt-in.
test('slow: a full-copy sandbox release validated by the real check-clean.sh', {
  skip: process.env.RELEASE_SLOW_TESTS === '1' ? false : 'set RELEASE_SLOW_TESTS=1 to run',
  timeout: 45 * 60 * 1000,
}, async () => {
  const s = makeSandbox(undefined, { full: true });
  sandboxes.push(s);
  const baseHead = s.git(['rev-parse', 'HEAD']);
  const r = await s.release(releaseArgs(s), { RELEASE_VALIDATE_CMD: '' }, { timeoutMs: 40 * 60 * 1000 });
  assert.strictEqual(r.code, 0, r.out.slice(-6000));
  assert.match(r.out, /validating the candidate tree with scripts\/check-clean\.sh/);
  assert.match(r.out, /clean-checkout checks passed/);
  assertReleased(s, { baseHead });
});
