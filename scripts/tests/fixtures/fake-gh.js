#!/usr/bin/env node
/**
 * fake-gh.js — an offline stand-in for the `gh` calls release.js makes, backed by
 * a local bare repository playing GitHub. Used only by scripts/tests/release.test.js
 * and the scratchpad sandbox; never on a real release.
 *
 *   run list --workflow=release.yml -R <repo> --commit <sha> ... --json ...
 *       A tag pointing at <sha> in the bare origin means "the Release workflow ran":
 *       FAKE_GH_RUN=success (default) | failure | none | pending, and
 *       FAKE_GH_PENDING_POLLS=n answers in_progress for the first n polls.
 *       FAKE_GH_SLEEP_MS=n stalls n ms before answering (a hung gh).
 *   release download <tag> -R <repo> -p <name> -D <dir> --clobber
 *       Writes git archive --format=zip of <tag>'s skill dir, as release.yml would.
 *       FAKE_GH_ZIP=ok (default) | tampered (one file changed) | extra (one file added)
 *       | wrongtop (the skill under another top-level directory).
 *   api repos/<repo> --jq .description           prints FAKE_GH_DESCRIPTION_FILE's content
 *   api -X PATCH repos/<repo> -f description=... writes it
 *
 * Every invocation is appended to FAKE_GH_LOG as one JSON line.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const env = process.env;
if (env.FAKE_GH_LOG) fs.appendFileSync(env.FAKE_GH_LOG, `${JSON.stringify(args)}\n`);
const origin = env.FAKE_GH_ORIGIN;
const SKILL_REL = 'skill-package/skills/claude-code-internals';
const opt = (name) => {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return args[i].includes('=') ? args[i].split('=').slice(1).join('=') : args[i + 1];
};
const git = (...a) => execFileSync('git', ['-C', origin, ...a], { encoding: 'utf8' }).trim();
const tagsAt = (sha) => git('tag', '--points-at', sha).split('\n').filter(Boolean);

function state() {
  const p = env.FAKE_GH_STATE;
  const s = p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { polls: 0 };
  return { s, save: () => p && fs.writeFileSync(p, JSON.stringify(s)) };
}

if (args[0] === 'run' && args[1] === 'list') {
  if (env.FAKE_GH_SLEEP_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(env.FAKE_GH_SLEEP_MS));
  const sha = opt('--commit');
  const tags = sha ? tagsAt(sha) : [];
  const mode = env.FAKE_GH_RUN || 'success';
  if (!tags.length || mode === 'none') { process.stdout.write('[]\n'); process.exit(0); }
  const { s, save } = state();
  s.polls += 1; save();
  const pending = mode === 'pending' || s.polls <= Number(env.FAKE_GH_PENDING_POLLS || 0);
  const run = {
    databaseId: 4242, headSha: sha, headBranch: tags[0], event: 'push',
    status: pending ? 'in_progress' : 'completed',
    conclusion: pending ? '' : (mode === 'failure' ? 'failure' : 'success'),
    url: 'https://example.invalid/actions/runs/4242',
  };
  process.stdout.write(`${JSON.stringify([run])}\n`);
  process.exit(0);
}

if (args[0] === 'release' && args[1] === 'download') {
  const tag = args[2];
  const dir = opt('-D');
  const name = opt('-p');
  try { git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`); } catch {
    process.stderr.write(`release not found: ${tag}\n`); process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, name);
  const mode = env.FAKE_GH_ZIP || 'ok';
  if (mode === 'ok') {
    git('archive', '--format=zip', '--prefix=claude-code-internals/', '-o', out, `${tag}:${SKILL_REL}`);
  } else {
    // Build the archive from a modified copy: extract, change, re-zip.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-'));
    const tar = path.join(tmp, 'archive.tar');
    git('archive', '--format=tar', '--prefix=claude-code-internals/', '-o', tar, `${tag}:${SKILL_REL}`);
    execFileSync('tar', ['-xf', tar, '-C', tmp]);
    fs.rmSync(tar);
    if (mode === 'tampered') fs.appendFileSync(path.join(tmp, 'claude-code-internals', 'version.json'), ' ');
    if (mode === 'extra') fs.writeFileSync(path.join(tmp, 'claude-code-internals', 'stale.txt'), 'left over\n');
    let top = 'claude-code-internals';
    if (mode === 'wrongtop') { fs.renameSync(path.join(tmp, top), path.join(tmp, 'skill')); top = 'skill'; }
    if (fs.existsSync(out)) fs.rmSync(out);
    execFileSync('zip', ['-q', '-r', out, top], { cwd: tmp });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
}

if (args[0] === 'api') {
  const file = env.FAKE_GH_DESCRIPTION_FILE;
  if (args.includes('PATCH')) {
    const f = args[args.indexOf('-f') + 1];
    const value = f.slice('description='.length);
    fs.writeFileSync(file, value);
    process.stdout.write(`${value}\n`);
  } else {
    process.stdout.write(`${file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''}\n`);
  }
  process.exit(0);
}

process.stderr.write(`fake-gh: unsupported invocation: ${args.join(' ')}\n`);
process.exit(2);
