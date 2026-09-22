'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validate, parseFrontmatter } = require('../validate-state.js');

const FIXTURE_DIRS = [];
test.after(() => {
  for (const d of FIXTURE_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

/** Build a minimal valid refs fixture dir and return its path. */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-fixture-'));
  FIXTURE_DIRS.push(dir);
  fs.mkdirSync(path.join(dir, 'state'));
  fs.writeFileSync(path.join(dir, 'topic-index.json'), JSON.stringify({
    lessons: [
      { id: 107, title: 'Cowork control protocol', file: '21-cowork-control-protocol.md', startLine: 1, endLine: 10, keywords: [] },
      { id: 110, title: 'Model landscape', file: '24-verified-new-v2.1.198.md', startLine: 1, endLine: 10, keywords: [] },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'state', 'registry.json'), JSON.stringify({
    schema_version: 1,
    as_of: {
      cli: '2.1.198', desktop_asar: '1.17377.2', in_vm_elf: '2.1.197',
      // fcache_capture identifies a SNAPSHOT, not a date: membership churns between
      // refetches, so a date cannot distinguish two payloads. content16 is sha256 over
      // the canonicalised features object.
      fcache_capture: {
        content16: '0123456789abcdef', embedded_timestamp: 1785910109684,
        feature_count: 241, observed_at: '2026-07-02',
      },
    },
    entries: [
      {
        id: 'env.CLAUDE_CODE_ENABLE_TASKS',
        kind: 'env-var',
        name: 'CLAUDE_CODE_ENABLE_TASKS',
        status: 'dark-launched',
        first_seen: '2.1.197',
        removed_in: null,
        as_of: '2.1.198',
        summary: 'Gates the Tasks tool family (TaskCreate/TaskList/TaskGet/TaskUpdate/TaskStop/TaskOutput).',
        provenance: [{ lesson: 107, note: 'binary-verified' }],
      },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'state', 'cowork-permissions.md'), [
    '---',
    'domain: cowork-permissions',
    'title: Cowork permission stack',
    'as_of_cli: 2.1.198',
    'as_of_desktop: 1.17377.2',
    'sources: [107, 110]',
    'updated: 2026-07-03',
    '---',
    '',
    '# Cowork permission stack',
  ].join('\n'));
  return dir;
}

test('valid fixture produces no errors', () => {
  assert.deepStrictEqual(validate(makeFixture()), []);
});

test('parseFrontmatter reads flat keys and JSON arrays', () => {
  const fm = parseFrontmatter('---\ndomain: x\nsources: [1, 2]\n---\nbody');
  assert.strictEqual(fm.domain, 'x');
  assert.deepStrictEqual(fm.sources, [1, 2]);
});

test('unknown kind is an error', () => {
  const dir = makeFixture();
  const regPath = path.join(dir, 'state', 'registry.json');
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  reg.entries[0].kind = 'banana';
  fs.writeFileSync(regPath, JSON.stringify(reg));
  const errors = validate(dir);
  assert.ok(errors.some(e => e.includes('banana')), errors.join('; '));
});

test('provenance pointing at a nonexistent lesson is an error', () => {
  const dir = makeFixture();
  const regPath = path.join(dir, 'state', 'registry.json');
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  reg.entries[0].provenance = [{ lesson: 999, note: 'nope' }];
  fs.writeFileSync(regPath, JSON.stringify(reg));
  const errors = validate(dir);
  assert.ok(errors.some(e => e.includes('999')), errors.join('; '));
});

test('duplicate ids are an error', () => {
  const dir = makeFixture();
  const regPath = path.join(dir, 'state', 'registry.json');
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  reg.entries.push({ ...reg.entries[0] });
  fs.writeFileSync(regPath, JSON.stringify(reg));
  const errors = validate(dir);
  assert.ok(errors.some(e => e.includes('duplicate')), errors.join('; '));
});

test('state page domain must match filename', () => {
  const dir = makeFixture();
  fs.writeFileSync(path.join(dir, 'state', 'mismatched.md'), [
    '---', 'domain: something-else', 'title: t', 'as_of_cli: 2.1.198',
    'sources: [107]', 'updated: 2026-07-03', '---', '', '# t',
  ].join('\n'));
  const errors = validate(dir);
  assert.ok(errors.some(e => e.includes('mismatched.md')), errors.join('; '));
});

test('non-array entries is a clean error, not a throw', () => {
  const dir = makeFixture();
  const regPath = path.join(dir, 'state', 'registry.json');
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  reg.entries = 'oops';
  fs.writeFileSync(regPath, JSON.stringify(reg));
  const errors = validate(dir);
  assert.ok(errors.some(e => e.includes('entries must be an array')), errors.join('; '));
});

test('state page citing an unknown lesson is an error', () => {
  const dir = makeFixture();
  fs.writeFileSync(path.join(dir, 'state', 'bad-source.md'), [
    '---', 'domain: bad-source', 'title: t', 'as_of_cli: 2.1.198',
    'sources: [42]', 'updated: 2026-07-03', '---', '', '# t',
  ].join('\n'));
  const errors = validate(dir);
  assert.ok(errors.some(e => e.includes('42')), errors.join('; '));
});

// --- container agent version axis ------------------------------------------
// registry.as_of.container_cc_version_observed governs remote-lane version
// claims. For three weeks (v2.45.x–v2.49.2) L174's registry entries asserted a
// cloud agent build of 2.1.42 against an axis reading 2.1.204–2.1.216 and
// nothing compared them. These are the controls for the comparison.

const CC_AXIS = { newest: '2.1.216', range: ['2.1.204', '2.1.216'], note: 'seen in session API traffic' };

function fixtureWithSummary(summary, axis = CC_AXIS) {
  const dir = makeFixture();
  const regPath = path.join(dir, 'state', 'registry.json');
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  if (axis) reg.as_of.container_cc_version_observed = axis;
  reg.entries[0].summary = summary;
  fs.writeFileSync(regPath, JSON.stringify(reg));
  return dir;
}

test('a registry summary asserting a cloud agent build below the observed axis is an error', () => {
  // Verbatim shape of the v2.49.2 env.CLAUDE_CODE_VERSION summary.
  const errs = validate(fixtureWithSummary(
    'Agent version as seen by its own environment. Observed 2.1.42 in a live cloud session against 2.1.250 installed locally -- a concrete figure for state.container-agent-range and the reason a current-CLI claim does not automatically describe the cloud lane.'));
  assert.ok(errs.some(e => /asserts a cloud\/remote agent build 2\.1\.42/.test(e)), errs.join('\n'));
});

test('bare "not" does not exempt the sentence (the v2.49.2 orphan-var shape)', () => {
  const errs = validate(fixtureWithSummary(
    'The cloud lane reports CLAUDE_CODE_VERSION=2.1.42, so these are plausibly names a much older agent reads -- but whether they are consumed is NOT determinable without a 2.1.42-era binary.'));
  assert.ok(errs.some(e => /agent build 2\.1\.42/.test(e)), errs.join('\n'));
});

test('a retraction sentence about the same number passes', () => {
  const errs = validate(fixtureWithSummary(
    'CORRECTION: the cloud lane reports CLAUDE_CODE_VERSION=2.1.42 but that variable is runner-set and never read by the agent; the cloud agent is >=2.1.248 by payload dating.'));
  assert.deepStrictEqual(errs.filter(e => /agent build/.test(e)), []);
});

test('an "as of" stamp next to the word agent is not an agent-version claim', () => {
  const errs = validate(fixtureWithSummary(
    'Recognized values as of 2.1.198: cli, sdk-cli, local-agent, remote_cowork -- the cloud lane uses remote_cowork.'));
  assert.deepStrictEqual(errs.filter(e => /agent build/.test(e)), []);
});

test('a version at or above the axis minimum passes', () => {
  const errs = validate(fixtureWithSummary('The cloud lane ran agent 2.1.204 in the August census; a remote agent build of 2.1.260 was seen later.'));
  assert.deepStrictEqual(errs.filter(e => /agent build/.test(e)), []);
});

test('without the axis the check is skipped, not failed', () => {
  const errs = validate(fixtureWithSummary('Observed 2.1.42 in a live cloud session; the cloud agent build.', null));
  assert.deepStrictEqual(errs.filter(e => /agent build/.test(e)), []);
});

test('a malformed floor on the axis is an error; a typed one passes', () => {
  const bad = validate(fixtureWithSummary('x', { ...CC_AXIS, floor: '2.1.248' }));
  assert.ok(bad.some(e => /container_cc_version_observed\.floor must be/.test(e)), bad.join('\n'));
  const good = validate(fixtureWithSummary('x', { ...CC_AXIS, floor: { version: '2.1.248', observed_at: '2026-09-21', method: 'payload-field dating' } }));
  assert.deepStrictEqual(good.filter(e => /floor/.test(e)), []);
});
