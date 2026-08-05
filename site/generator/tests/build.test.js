'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { build, SECTION } = require('../build.js');
const { lint, proseOf } = require('../lint-disclosure.js');

function buildOnce() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  const res = build(out);
  return { out, res };
}

test('build emits every page as both HTML and Markdown', () => {
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  for (const p of facts.pages) {
    const md = p.slug === 'index' ? `${SECTION}/index.md` : `${SECTION}/${p.slug}.md`;
    const html = p.slug === 'index' ? `${SECTION}/index.html` : `${SECTION}/${p.slug}/index.html`;
    assert.ok(fs.existsSync(path.join(out, md)), `missing ${md}`);
    assert.ok(fs.existsSync(path.join(out, html)), `missing ${html}`);
  }
});

test('the machine layer exists and parses', () => {
  const { out } = buildOnce();
  const f = JSON.parse(fs.readFileSync(path.join(out, SECTION, 'facts.json'), 'utf8'));
  assert.strictEqual(f.schema_version, 1);
  assert.ok(f.facts.length > 0);
  assert.ok(fs.existsSync(path.join(out, 'llms.txt')));
  // llms.txt must point at raw markdown, which is what agents can actually parse
  const llms = fs.readFileSync(path.join(out, 'llms.txt'), 'utf8');
  assert.match(llms, /\.md\)/, 'llms.txt should link .md files');
});

test('the published projection strips volatile facts and internal provenance', () => {
  const { out } = buildOnce();
  const pub = JSON.parse(fs.readFileSync(path.join(out, SECTION, 'facts.json'), 'utf8'));
  for (const f of pub.facts) {
    assert.ok(!('sources' in f), 'lesson provenance must not be published');
    assert.ok(!('durability' in f), 'durability is an internal field');
  }
  const src = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const volatileIds = src.facts.filter(f => f.durability === 'volatile').map(f => f.id);
  for (const id of volatileIds) {
    assert.ok(!pub.facts.some(f => f.id === id), `volatile fact ${id} must not be published`);
  }
});

test('the custom domain is emitted (Pages reverts it silently otherwise)', () => {
  const { out } = buildOnce();
  assert.strictEqual(fs.readFileSync(path.join(out, 'CNAME'), 'utf8').trim(), 'ccinternals.dev');
});

test('existing static URLs are preserved', () => {
  const { out } = buildOnce();
  assert.ok(fs.existsSync(path.join(out, 'static', 'install-claude-desktop.html')));
});

test('no page hardcodes a base path (must work with and without the domain)', () => {
  const { out } = buildOnce();
  for (const rel of fs.readdirSync(path.join(out, SECTION), { recursive: true })) {
    const p = path.join(out, SECTION, String(rel));
    if (!fs.statSync(p).isFile() || !p.endsWith('.html')) continue;
    const html = fs.readFileSync(p, 'utf8');
    assert.ok(!/href="\/claude-code-internals\//.test(html), `${rel} hardcodes the project base path`);
    assert.ok(!/href="\/cowork\//.test(html), `${rel} uses a root-absolute internal link`);
  }
});

test('built output passes the disclosure lint', () => {
  const { out } = buildOnce();
  const { failures } = lint(out);
  assert.deepStrictEqual(failures, [], failures.join('\n'));
});

test('the disclosure lint would catch a leak injected into built output', () => {
  const { out } = buildOnce();
  // Control: prove the lint over dist/ is capable of failing. Without this the
  // previous test is indistinguishable from a lint that never fires.
  fs.writeFileSync(path.join(out, SECTION, 'leak.md'), 'The hostLoopMode field decides this.');
  const { failures } = lint(out);
  assert.ok(failures.length > 0, 'lint over dist/ must be able to fail');
});

test('proseOf ignores template JS and JSON field names', () => {
  assert.ok(!proseOf('x.html', '<script>document.getElementById("a")</script><p>ok</p>').includes('getElementById'));
  assert.ok(!proseOf('x.json', '{"server_flag_dependent":true,"rule":"ok"}').includes('server_flag_dependent'));
  assert.ok(proseOf('x.json', '{"rule":"ok"}').includes('ok'));
});

test('every page front-loads a standalone summary', () => {
  const { out } = buildOnce();
  const src = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  for (const p of src.pages) {
    const sentences = p.summary.split(/(?<=\.)\s/).filter(Boolean).length;
    assert.ok(sentences >= 2, `${p.slug}: summary should stand alone (got ${sentences} sentence(s))`);
  }
});
