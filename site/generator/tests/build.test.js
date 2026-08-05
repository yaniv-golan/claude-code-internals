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

// ---------------------------------------------------------------------------
// Reader-experience guarantees (revision 2 of the reader-experience plan).
// Each of these guards a defect that actually shipped, or that an earlier draft
// of the test list would have let through.
// ---------------------------------------------------------------------------

const stripScripts = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ');

/**
 * Generated content pages only. Excludes:
 *  - static/  — passthrough artifacts that predate this generator and carry no
 *               chrome by design (their URLs must keep working untouched)
 *  - 404.html — an error page has no claims to date-stamp or attribute
 */
function htmlFiles(out) {
  const acc = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'static') walk(p); }
      else if (e.name.endsWith('.html') && e.name !== '404.html') acc.push(p);
    }
  })(out);
  return acc;
}

test('the verification date survives with scripts stripped', () => {
  // The defect this exists for: the badge used to be an empty span filled by
  // JS, so with scripting off no page showed a date at all — on a site whose
  // entire credibility rests on "verified against build X on date Y".
  const { out } = buildOnce();
  for (const f of htmlFiles(out)) {
    const visible = stripScripts(fs.readFileSync(f, 'utf8')).replace(/<[^>]+>/g, ' ');
    assert.match(visible, /Verified \d{4}-\d{2}-\d{2}/, `${path.relative(out, f)} has no server-rendered date`);
  }
});

test('the root shows a date per section, not one site-wide badge', () => {
  const { out } = buildOnce();
  const root = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const badges = [...root.matchAll(/class="fresh" data-verified="(\d{4}-\d{2}-\d{2})"/g)];
  assert.ok(badges.length >= 1, 'root must carry at least one section date');
  const links = [...root.matchAll(/href="([a-z0-9-]+)\/"/g)].map(m => m[1]);
  assert.strictEqual(badges.length, new Set(links).size, 'one date per linked section');
});

test('the root can raise the expired banner too', () => {
  // Otherwise the first page a visitor sees is the only page that never says
  // "expired" — the loudest signal, missing from the most-seen surface.
  const { out } = buildOnce();
  const root = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(root, /class="expired-banner" data-verified="\d{4}-\d{2}-\d{2}"/);
});

test('each page carries exactly one freshness badge, before the footer', () => {
  // "appears before <footer>" alone would pass if the old footer badge were
  // left behind: two elements, duplicate state, one rendering as an empty pill.
  const { out } = buildOnce();
  for (const f of htmlFiles(out)) {
    const html = fs.readFileSync(f, 'utf8');
    const rel = path.relative(out, f);
    const n = (html.match(/class="fresh" data-verified=/g) || []).length;
    if (rel === 'index.html') { assert.ok(n >= 1); continue; }
    assert.strictEqual(n, 1, `${rel} should have exactly one badge, has ${n}`);
    assert.ok(html.indexOf('class="fresh"') < html.indexOf('<footer>'), `${rel}: badge is not above the footer`);
  }
});

test('every fragment link resolves to an id in its target document', () => {
  const { out } = buildOnce();
  const ids = f => new Set([...fs.readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const f of htmlFiles(out)) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/href="([^"]*#[^"]+)"/g)) {
      const href = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const [rawPath, frag] = href.split('#');
      let target = f;
      if (rawPath) {
        target = path.join(path.dirname(f), rawPath);
        if (rawPath.endsWith('/') || !path.extname(rawPath)) target = path.join(target, 'index.html');
      }
      assert.ok(fs.existsSync(target), `${path.relative(out, f)} -> ${href}: no target`);
      assert.ok(ids(target).has(frag), `${path.relative(out, f)} -> ${href}: no id="${frag}"`);
    }
  }
});

test('pages that render badges link them to the legend', () => {
  const { out } = buildOnce();
  for (const f of htmlFiles(out)) {
    const html = fs.readFileSync(f, 'utf8');
    if (!/class="tier tier-/.test(html)) continue;   // index and current-state render none
    assert.match(html, /href="#tiers"/, `${path.relative(out, f)} has badges but no legend link`);
    assert.match(html, /id="tiers"/, `${path.relative(out, f)} links a legend it does not contain`);
  }
});

test('caveats are labelled identically in Markdown and HTML', () => {
  // The two renderers diverged here once. Content parity is guaranteed by
  // rendering from the same objects; chrome parity is not, so it is asserted.
  const { out } = buildOnce();
  const md = fs.readFileSync(path.join(out, SECTION, 'deleting-files.md'), 'utf8');
  const html = fs.readFileSync(path.join(out, SECTION, 'deleting-files', 'index.html'), 'utf8');
  const mdCount = (md.match(/^> Caveat: /gm) || []).length;
  const htmlCount = (html.match(/<strong>Caveat:<\/strong>/g) || []).length;
  assert.ok(mdCount > 0, 'fixture page should have caveats');
  assert.strictEqual(htmlCount, mdCount, 'HTML and Markdown disagree on caveat count/label');
});

test('every page offers a way to report an error', () => {
  const { out } = buildOnce();
  for (const f of htmlFiles(out)) {
    const html = fs.readFileSync(f, 'utf8');
    assert.match(html, /claude-code-internals\/issues/, `${path.relative(out, f)} has no issues link`);
    assert.match(html, /github\.com\/yaniv-golan"/, `${path.relative(out, f)} has no author attribution`);
  }
});

test('a 404 page exists and routes back into the site', () => {
  const { out } = buildOnce();
  const p = path.join(out, '404.html');
  assert.ok(fs.existsSync(p), 'no 404.html');
  assert.match(fs.readFileSync(p, 'utf8'), new RegExp(`href="/${SECTION}/"`));
});
