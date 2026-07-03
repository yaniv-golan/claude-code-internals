'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { lookup, audit } = require('../state.js');

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-cli-fixture-'));
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

test('audit reports entries and pages behind the registry baseline', () => {
  const r = audit(makeFixture());
  assert.strictEqual(r.baseline, '2.1.198');
  const staleIds = r.stale.map(s => s.id || s.file);
  assert.ok(staleIds.includes('cmd.toggle-memory'));
  assert.ok(staleIds.includes('cowork-permissions.md'));
  assert.ok(!staleIds.includes('env.CLAUDE_CODE_ENABLE_TASKS'));
});
