'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { lookup, audit } = require('../state.js');

const FIXTURE_DIRS = [];
test.after(() => {
  for (const d of FIXTURE_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-cli-fixture-'));
  FIXTURE_DIRS.push(dir);
  fs.mkdirSync(path.join(dir, 'state'));
  fs.writeFileSync(path.join(dir, 'topic-index.json'), JSON.stringify({ lessons: [
    { id: 107, title: 'x', file: 'f.md', startLine: 1, endLine: 2, keywords: [] },
  ] }));
  fs.writeFileSync(path.join(dir, 'state', 'registry.json'), JSON.stringify({
    schema_version: 1,
    as_of: { cli: '2.1.198' },
    entries: [
      { id: 'env.CLAUDE_CODE_ENABLE_TASKS', kind: 'env-var', name: 'CLAUDE_CODE_ENABLE_TASKS',
        status: 'dark-launched', as_of: '2.1.198', summary: 's', provenance: [{ lesson: 107, note: 'n' }] },
      { id: 'cmd.toggle-memory', kind: 'slash-command', name: '/toggle-memory',
        status: 'renamed', renamed_to: '/pause-memory', as_of: '2.1.170', summary: 's', provenance: [{ lesson: 107, note: 'n' }] },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'state', 'cowork-permissions.md'), [
    '---', 'domain: cowork-permissions', 'title: Cowork permission stack',
    'as_of_cli: 2.1.170', 'sources: [107]', 'updated: 2026-07-03', '---', '', '# body',
  ].join('\n'));
  return dir;
}

test('lookup matches registry names case-insensitively', () => {
  const r = lookup(makeFixture(), 'enable_tasks');
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.entries[0].id, 'env.CLAUDE_CODE_ENABLE_TASKS');
});

test('lookup matches page domain and title', () => {
  const r = lookup(makeFixture(), 'permission');
  assert.strictEqual(r.pages.length, 1);
  assert.strictEqual(r.pages[0].domain, 'cowork-permissions');
});

test('lookup with no match returns empty sets', () => {
  const r = lookup(makeFixture(), 'zzzz');
  assert.deepStrictEqual(r, { entries: [], pages: [] });
});

test('lookup matches renamed_to so the new name finds the old entry', () => {
  const r = lookup(makeFixture(), 'pause-memory');
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.entries[0].id, 'cmd.toggle-memory');
});

test('malformed registry (missing as_of.cli) throws a clean error', () => {
  const dir = makeFixture();
  fs.writeFileSync(path.join(dir, 'state', 'registry.json'),
    JSON.stringify({ schema_version: 1, entries: [] }));
  assert.throws(() => audit(dir), /as_of\.cli missing/);
  assert.throws(() => lookup(dir, 'x'), /as_of\.cli missing/);
});

test('audit reports entries and pages behind the registry baseline', () => {
  const r = audit(makeFixture());
  assert.strictEqual(r.baseline, '2.1.198');
  const staleIds = r.stale.map(s => s.id || s.file);
  assert.ok(staleIds.includes('cmd.toggle-memory'));
  assert.ok(staleIds.includes('cowork-permissions.md'));
  assert.ok(!staleIds.includes('env.CLAUDE_CODE_ENABLE_TASKS'));
});

// --- baseline comparison: AHEAD is not BEHIND ------------------------------
//
// The audit used to test as_of with string inequality, so a record verified
// against a NEWER artifact than the baseline printed as "behind baseline".
// The only way to keep the gate green was to restamp a newer verification as
// older than it was, which is the opposite of what the stamp is for.

const { cmpVersion: _cmpVersion, audit: _audit } = require('../state.js');

test('cmpVersion orders dotted versions numerically, not lexically', () => {
  assert.ok(_cmpVersion('2.1.231', '2.1.250') < 0);
  assert.ok(_cmpVersion('2.1.250', '2.1.231') > 0);
  assert.strictEqual(_cmpVersion('2.1.231', '2.1.231'), 0);
  // the lexical trap this replaces: "2.1.99" > "2.1.231" as strings
  assert.ok(_cmpVersion('2.1.99', '2.1.231') < 0);
  assert.ok(_cmpVersion('2.1.9', '2.1.10') < 0);
});

test('a malformed version sorts as behind, so a typo fails the gate', () => {
  assert.ok(_cmpVersion('2.1.x', '2.1.231') < 0);
  assert.ok(_cmpVersion('', '2.1.231') < 0);
});

test('audit separates ahead from behind and the repo has no behind records', () => {
  const r = _audit(path.join(__dirname, '..', '..', 'references'));
  assert.ok(Array.isArray(r.stale) && Array.isArray(r.ahead));
  assert.strictEqual(r.stale.length, 0, `behind baseline: ${JSON.stringify(r.stale)}`);
});
