'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validate, parseFrontmatter } = require('../validate-state.js');

/** Build a minimal valid refs fixture dir and return its path. */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-fixture-'));
  fs.mkdirSync(path.join(dir, 'state'));
  fs.writeFileSync(path.join(dir, 'topic-index.json'), JSON.stringify({
    lessons: [
      { id: 107, title: 'Cowork control protocol', file: '21-cowork-control-protocol.md', startLine: 1, endLine: 10, keywords: [] },
      { id: 110, title: 'Model landscape', file: '24-verified-new-v2.1.198.md', startLine: 1, endLine: 10, keywords: [] },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'state', 'registry.json'), JSON.stringify({
    schema_version: 1,
    as_of: { cli: '2.1.198', desktop_asar: '1.17377.2', in_vm_elf: '2.1.197', fcache_capture: '2026-07-02' },
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

test('state page citing an unknown lesson is an error', () => {
  const dir = makeFixture();
  fs.writeFileSync(path.join(dir, 'state', 'bad-source.md'), [
    '---', 'domain: bad-source', 'title: t', 'as_of_cli: 2.1.198',
    'sources: [42]', 'updated: 2026-07-03', '---', '', '# t',
  ].join('\n'));
  const errors = validate(dir);
  assert.ok(errors.some(e => e.includes('42')), errors.join('; '));
});
