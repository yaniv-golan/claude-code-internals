'use strict';
/**
 * desktop-changelog-scan.test.js — scripts/desktop-changelog-scan.js on synthetic release-note
 * pages in a scratch repo: parsing, per-item hashing, the diff (new entry, reworded item,
 * dropped entry), the lesson cross-reference, and the write gate (nothing is written without
 * --accept). The committed snapshot is checked for shape only: it must hold hashes, never text.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../desktop-changelog-scan.js');

const ROOT = path.resolve(__dirname, '..', '..');

const PAGE = (extra = '') => `# Changelog

<Update label="v2.2.0" description="2026-10-13">
  Bundled Claude Code version: 2.1.295.

  **General**

  * Added "Open in new window" for chats.
  * Added \`developerModeEnabled\`.${extra}

  **Cowork**

  * Fixed a thing.
</Update>

<Update label="Known issue: something" description="2026-10-10">
  A note with no section.
</Update>

<Update label="v2.1.0" description="2026-10-01">
  **Code**

  * Fixed \`move_to_cloud\` refusing.
</Update>
`;

const CONFIG = `<Update label="v2.2.0" description="2026-10-13">
  <div className="cfg-keys">
    | MDM key | Type | Description |
    | - | - | - |
    | [\`developerModeEnabled\`](/docs/x#developermodeenabled) | \`boolean\` | Allow Developer Mode |
  </div>

  **JSON (e.g. for non-MDM users or Bootstrap):**

  \`\`\`json
  { "workspace": { "developerModeEnabled": "<boolean>" } }
  \`\`\`
</Update>
`;

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-'));
  const refs = path.join(dir, 'skill-package/skills/claude-code-internals/references');
  fs.mkdirSync(refs, { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(refs, 'x.md'), 'title\n# LESSON 7\n`move_to_cloud` refuses.\n');
  fs.writeFileSync(path.join(refs, 'topic-index.json'), JSON.stringify({ lessons: [{ id: 7, file: 'x.md', startLine: 2, endLine: 3 }] }));
  const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
  return { dir, write };
}

async function run(dir, argv) {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { return { code: await S.main(['--root', dir, '--archive-dir', path.join(dir, 'archive'), '--date', '2026-10-14', ...argv]), out: lines.join('\n') }; }
  finally { console.log = log; }
}

test('parse: entries, sections, bundled version, table rows, fenced JSON skipped', () => {
  const e = S.parse(PAGE());
  assert.deepStrictEqual(e.map((x) => x.label), ['v2.2.0', 'Known issue: something', 'v2.1.0']);
  assert.strictEqual(e[0].bundled, '2.1.295');
  assert.deepStrictEqual(e[0].items.map((i) => i.section), ['General', 'General', 'Cowork']);
  assert.strictEqual(e[1].items[0].section, '');
  const c = S.parse(CONFIG);
  assert.strictEqual(c[0].items.length, 1, 'header/separator rows and the JSON block are not items');
  assert.match(c[0].items[0].text, /developerModeEnabled/);
});

// The page format since 2026-10: a bold label line opens each block, no <Update>, no dates.
const PLAIN = `# Changelog

**v2.2.0**

Bundled Claude Code version: 2.1.295.

**General**

* Added "Open in new window" for chats.
* Added \`developerModeEnabled\`.

**Cowork**

* Fixed a thing.

**Known issue: something**

A note with no section.

**v2.1.0**

**Code**

* Fixed \`move_to_cloud\` refusing.

**Baseline**

| MDM key | Type | Description |
| - | - | - |
| \`isLocalDevMcpEnabled\` | \`boolean\` | Allow user-added MCP servers |
`;

test('parse: the plain format gives the same labels and item hashes, with no dates', () => {
  const plain = S.parse(PLAIN);
  assert.deepStrictEqual(plain.map((x) => x.label), ['v2.2.0', 'Known issue: something', 'v2.1.0', 'Baseline']);
  assert.ok(plain.every((x) => x.date === null));
  const old = S.parse(PAGE());
  for (let i = 0; i < old.length; i++) {
    assert.deepStrictEqual(plain[i].items.map((x) => x.hash), old[i].items.map((x) => x.hash), old[i].label);
  }
  assert.strictEqual(plain[3].items.length, 1, 'Baseline keeps its table row, not the header');
});

test('a date line under the version line is the entry date, not an item', () => {
  const dated = S.parse(PLAIN.replace('**v2.2.0**\n', '**v2.2.0**\n\n2026-10-22\n'));
  assert.strictEqual(dated[0].date, '2026-10-22');
  assert.deepStrictEqual(dated[0].items.map((x) => x.hash), S.parse(PLAIN)[0].items.map((x) => x.hash));
  assert.strictEqual(dated[2].date, null);
});

test('item hash depends on section and text, not on whitespace', () => {
  const a = S.parse(PAGE())[0].items[0].hash;
  const b = S.parse(PAGE().replace('Added "Open in new window" for chats.', 'Added   "Open in new window"  for chats.'))[0].items[0].hash;
  assert.strictEqual(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('terms: backticked identifiers and quoted UI strings, generic tokens dropped', () => {
  assert.deepStrictEqual(S.terms('Set `foo.bar` to `true`, see "Open in new window".').sort(), ['Open in new window', 'foo.bar']);
});

test('first run lists every item, marks the ones a lesson names, writes nothing without --accept', async () => {
  const { dir, write } = scratch();
  const r = await run(dir, ['--changelog', write('c.md', PAGE()), '--config', write('k.md', CONFIG)]);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /No snapshot yet/);
  assert.match(r.out, /developerModeEnabled → no lesson/);
  assert.match(r.out, /move_to_cloud → L7/, 'an item a lesson names is listed by default');
  assert.match(r.out, /check the lesson agrees/);
  assert.ok(!fs.existsSync(path.join(dir, 'data/desktop-changelog.json')));
  const leads = await run(dir, ['--leads-only', '--changelog', path.join(dir, 'c.md'), '--config', path.join(dir, 'k.md')]);
  assert.doesNotMatch(leads.out, /move_to_cloud/);
  assert.match(leads.out, /developerModeEnabled → no lesson/);
});

test('--accept writes hashes only and archives the pages; a rerun is clean; --check agrees', async () => {
  const { dir, write } = scratch();
  const files = ['--changelog', write('c.md', PAGE()), '--config', write('k.md', CONFIG)];
  assert.strictEqual((await run(dir, [...files, '--accept'])).code, 0);
  const rec = fs.readFileSync(path.join(dir, 'data/desktop-changelog.json'), 'utf8');
  assert.doesNotMatch(rec, /Open in new window|developerModeEnabled/, 'no release-note text in the record');
  assert.strictEqual(fs.readdirSync(path.join(dir, 'archive')).length, 2);
  const again = await run(dir, files);
  assert.match(again.out, /^0 entries changed/m);
  assert.strictEqual((await run(dir, [...files, '--check'])).code, 0);
});

test('a reworded item, a new entry and a dropped entry are all reported; --check exits 1', async () => {
  const { dir, write } = scratch();
  await run(dir, ['--changelog', write('c.md', PAGE()), '--config', write('k.md', CONFIG), '--accept']);
  const next = PAGE().replace('Fixed a thing.', 'Fixed a thing, reworded.')
    .replace('<Update label="v2.1.0"', '<Update label="v2.3.0" description="2026-10-20">\n  **General**\n\n  * Added `newKey`.\n</Update>\n\n<Update label="v2.1.0"')
    .replace(/<Update label="Known issue[\s\S]*?<\/Update>/, '');
  const files = ['--changelog', write('c2.md', next), '--config', path.join(dir, 'k.md')];
  const r = await run(dir, files);
  assert.match(r.out, /v2\.2\.0 \(2026-10-13\) — 1 item\(s\) added or reworded, 1 gone/);
  assert.match(r.out, /v2\.3\.0 \(2026-10-20\) — new entry/);
  assert.match(r.out, /Known issue: something \(2026-10-10\) — entry removed/);
  assert.strictEqual((await run(dir, [...files, '--check'])).code, 1);
});

test('--since keeps entries dated on or after the label; --find is case-aware', async () => {
  const { dir, write } = scratch();
  const files = ['--changelog', write('c.md', PAGE()), '--config', write('k.md', CONFIG)];
  const r = await run(dir, [...files, '--since', 'v2.2.0']);
  assert.doesNotMatch(r.out, /v2\.1\.0|Known issue/);
  assert.strictEqual((await run(dir, [...files, '--since', 'v9.9.9'])).code, 2);
  assert.match((await run(dir, [...files, '--find', 'OPEN IN'])).out, /^0 item|No release-note item/m);
  assert.match((await run(dir, [...files, '--find', 'open in'])).out, /1 item\(s\) mention/);
});

test('the committed snapshot, when present, holds hashes and dates only', () => {
  const f = path.join(ROOT, 'data/desktop-changelog.json');
  if (!fs.existsSync(f)) return;
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const entries of Object.values(rec.pages)) {
    for (const e of Object.values(entries)) {
      assert.deepStrictEqual(Object.keys(e).sort(), ['bundled', 'date', 'items']);
      for (const h of e.items) assert.match(h, /^[0-9a-f]{16}$/);
    }
  }
});

test('main: an undated entry keeps the date first recorded, a new one gets the scan date', async () => {
  const { dir, write } = scratch();
  const cfg = write('k.md', CONFIG);
  assert.strictEqual((await run(dir, ['--accept', '--changelog', write('c.md', PAGE()), '--config', cfg])).code, 0);
  const plain = write('p.md', PLAIN.replace('# Changelog\n', '# Changelog\n\n**v2.3.0**\n\n* Added a newer thing.\n'));
  assert.strictEqual((await run(dir, ['--accept', '--date', '2026-10-21', '--changelog', plain, '--config', cfg])).code, 0);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'desktop-changelog.json'), 'utf8')).pages.changelog;
  assert.strictEqual(rec['v2.2.0'].date, '2026-10-13');
  assert.strictEqual(rec['v2.1.0'].date, '2026-10-01');
  assert.strictEqual(rec['v2.3.0'].date, '2026-10-21');
});
