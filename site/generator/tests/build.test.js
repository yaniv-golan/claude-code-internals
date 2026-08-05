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
    assert.ok(html.indexOf('class="fresh"') < html.indexOf('<footer class="site">'), `${rel}: badge is not above the footer`);
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
  // The legend is no longer repeated under every page -- it lives once, on the
  // entry page. Badges therefore cross-link to it, and the assertion is that the
  // target exists there rather than on the linking page.
  const { out } = buildOnce();
  const entry = fs.readFileSync(path.join(out, SECTION, 'index.html'), 'utf8');
  assert.match(entry, /id="tiers"/, 'the entry page must carry the one legend');
  for (const f of htmlFiles(out)) {
    const html = fs.readFileSync(f, 'utf8');
    if (!/class="chip tier-/.test(html)) continue;
    assert.match(html, /href="(?:\.\.\/)?#tiers"/, `${path.relative(out, f)} has badges but no legend link`);
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

test('lane scope is labelled identically in Markdown and HTML', () => {
  // Same divergence class as caveats, and it recurred: the lane badge was added
  // to the Markdown renderer first and the HTML path silently emitted nothing,
  // because HTML builds from its own badge helpers rather than from the .md.
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const LANES = /Local sandbox|Remote sandbox|Both sandboxes/g;
  let mdTotal = 0, htmlTotal = 0;
  for (const p of facts.pages) {
    if (p.slug === 'index' || p.slug === 'current-state') continue;
    const md = fs.readFileSync(path.join(out, SECTION, `${p.slug}.md`), 'utf8');
    const html = fs.readFileSync(path.join(out, SECTION, p.slug, 'index.html'), 'utf8');
    const m = (md.match(LANES) || []).length;
    const h = (html.match(LANES) || []).length;
    assert.strictEqual(h, m, `${p.slug}: HTML has ${h} lane labels, Markdown has ${m}`);
    mdTotal += m; htmlTotal += h;
  }
  const expected = facts.facts.filter(f => f.lane && f.page !== 'current-state').length;
  assert.strictEqual(mdTotal, expected, `expected ${expected} lane labels, rendered ${mdTotal}`);
  assert.strictEqual(htmlTotal, expected);
});

test('an unscoped fact renders no lane badge', () => {
  // Absence must stay silent. Defaulting to "Both sandboxes" would assert a
  // scope the source material never established -- the failure this field exists
  // to prevent.
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const unscoped = facts.facts.filter(f => !f.lane && f.page !== 'current-state');
  assert.ok(unscoped.length > 0, 'fixture should have unscoped facts');
  for (const f of unscoped.slice(0, 5)) {
    const html = fs.readFileSync(path.join(out, SECTION, f.page, 'index.html'), 'utf8');
    const i = html.indexOf(f.rule.slice(0, 40));
    assert.ok(i > 0, `rule not found for ${f.id}`);
    const block = html.slice(i, i + 400);
    assert.ok(!/tier-lane/.test(block), `${f.id} rendered a lane badge but has no lane`);
  }
});

test('every contract rule links to the page that explains it', () => {
  // The contract page's own summary promises this. Before v2.36.4 it was false:
  // the only <a> in each list item was the tier badge pointing at the legend, so
  // a reader saw 52 bold one-liners with nothing to click through to.
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const durable = facts.facts.filter(f => f.durability === 'durable');
  const html = fs.readFileSync(path.join(out, SECTION, 'contract', 'index.html'), 'utf8');
  const md = fs.readFileSync(path.join(out, SECTION, 'contract.md'), 'utf8');
  const linked = (html.match(/class="rule-link"/g) || []).length;
  assert.strictEqual(linked, durable.length, `HTML: ${linked} rule links for ${durable.length} rules`);
  const mdLinked = (md.match(/^- \[\*\*/gm) || []).length;
  assert.strictEqual(mdLinked, durable.length, `Markdown: ${mdLinked} rule links for ${durable.length} rules`);
});

test('every contract deep link resolves to a real anchor', () => {
  // Gate 4 already checks fragments at build time; this pins it against a future
  // refactor that stops emitting the ids while still emitting the links.
  const { out } = buildOnce();
  const html = fs.readFileSync(path.join(out, SECTION, 'contract', 'index.html'), 'utf8');
  const links = [...html.matchAll(/class="rule-link" href="\.\.\/([^/]+)\/#([^"]+)"/g)];
  assert.ok(links.length > 0, 'no rule links found');
  for (const [, slug, frag] of links) {
    const target = path.join(out, SECTION, slug, 'index.html');
    assert.ok(fs.existsSync(target), `missing page ${slug}`);
    assert.ok(fs.readFileSync(target, 'utf8').includes(`id="${frag}"`), `${slug} has no anchor #${frag}`);
  }
});

test('fact anchors are derived from the fact id, not the rule text', () => {
  // Rule wording is revised often -- ten rules were reworded across v2.36.1-3.
  // An anchor built from prose would break every inbound link on each rewrite.
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const f = facts.facts.find(x => x.page === 'files-and-paths');
  const html = fs.readFileSync(path.join(out, SECTION, 'files-and-paths', 'index.html'), 'utf8');
  const expected = 'fact-' + f.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  assert.ok(html.includes(`id="${expected}"`), `expected anchor ${expected}`);
});

test('sitemap lists every generated page and nothing else', () => {
  // The drift risk: a page added to author-facts.json but missing from the
  // sitemap is invisible to crawlers, and nothing else would notice.
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const xml = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  for (const p of facts.pages) {
    const want = p.slug === 'index' ? `/${SECTION}/` : `/${SECTION}/${p.slug}/`;
    assert.ok(locs.some(l => l.endsWith(want)), `sitemap missing ${want}`);
  }
  assert.strictEqual(locs.length, facts.pages.length + 1, 'sitemap should hold every page plus the root');
  for (const l of locs) assert.ok(l.startsWith('https://'), `sitemap loc not absolute: ${l}`);
});

test('robots.txt points at the sitemap and keeps the markdown crawlable', () => {
  const { out } = buildOnce();
  const robots = fs.readFileSync(path.join(out, 'robots.txt'), 'utf8');
  assert.match(robots, /^Sitemap: https:\/\/.+\/sitemap\.xml$/m);
  // The .md twins are the LLM-facing copy; blocking them would defeat llms.txt.
  assert.ok(!/Disallow:.*\.md/.test(robots), 'markdown must stay crawlable');
});

test('every indexable page declares its own canonical URL', () => {
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  for (const p of facts.pages) {
    const rel = p.slug === 'index' ? `${SECTION}/index.html` : `${SECTION}/${p.slug}/index.html`;
    const html = fs.readFileSync(path.join(out, rel), 'utf8');
    const m = html.match(/<link rel="canonical" href="([^"]+)"/);
    assert.ok(m, `${rel} has no canonical`);
    const want = p.slug === 'index' ? `/${SECTION}/` : `/${SECTION}/${p.slug}/`;
    assert.ok(m[1].startsWith('https://') && m[1].endsWith(want), `${rel} canonical is ${m[1]}`);
    assert.match(html, /property="og:title"/, `${rel} has no og:title`);
    assert.match(html, /application\/ld\+json/, `${rel} has no structured data`);
  }
});

test('the 404 page is noindex', () => {
  // It is reachable at every bad URL; indexing it would put a dead end in results.
  const { out } = buildOnce();
  const html = fs.readFileSync(path.join(out, '404.html'), 'utf8');
  assert.match(html, /name="robots" content="noindex/);
});

test('tool pointers appear at the reader moment, not everywhere', () => {
  // Placement is the point: the scaffolding tool is for someone who has not
  // written the skill yet, so it belongs at the entry point; the harness answers
  // "does mine do this?", so it belongs where a reader has just finished the
  // rules. Neither belongs on a topic page, where it would compete with the
  // "What is not established" section.
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const tools = facts.tools || [];
  assert.ok(tools.length >= 2, 'expected tool pointers in the data layer');
  const start = tools.find(t => t.slug === 'start').name;
  const verify = tools.find(t => t.slug === 'verify').name;

  const index = fs.readFileSync(path.join(out, SECTION, 'index.html'), 'utf8');
  assert.ok(index.includes(start) && index.includes(verify), 'index should carry both');

  const contract = fs.readFileSync(path.join(out, SECTION, 'contract', 'index.html'), 'utf8');
  assert.ok(contract.includes(verify), 'contract should carry the harness');
  assert.ok(!contract.includes(start), 'contract should NOT carry the scaffolding tool');

  for (const p of facts.pages) {
    if (['index', 'contract'].includes(p.slug)) continue;
    const html = fs.readFileSync(path.join(out, SECTION, p.slug, 'index.html'), 'utf8');
    for (const t of tools) {
      assert.ok(!html.includes(t.url), `${p.slug} should not promote ${t.name}`);
    }
  }
});

test('tool pointers are disclosed and never look like findings', () => {
  // Asserted on behaviour, not markup: the cards were <section> before this
  // redesign and are <div> after, and the contract page now carries a one-line
  // callout rather than a card. What must not change is that a pointer is
  // disclosed and never wears a confidence badge.
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  for (const rel of [`${SECTION}/index.html`, `${SECTION}/contract/index.html`]) {
    const html = fs.readFileSync(path.join(out, rel), 'utf8');
    assert.match(html, /Same author as this site/, `${rel} must disclose authorship`);
    for (const t of facts.tools || []) {
      const i = html.indexOf(t.url);
      if (i < 0) continue;
      // no confidence badge anywhere in the block the link sits in
      const around = html.slice(Math.max(0, i - 500), i + 900);
      assert.ok(!/class="chip tier-/.test(around), `${rel}: ${t.name} sits next to a confidence badge`);
    }
  }
});

test('tool pointers appear in both formats wherever they appear at all', () => {
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  for (const [md, html] of [[`${SECTION}/index.md`, `${SECTION}/index.html`],
                            [`${SECTION}/contract.md`, `${SECTION}/contract/index.html`]]) {
    const m = fs.readFileSync(path.join(out, md), 'utf8');
    const h = fs.readFileSync(path.join(out, html), 'utf8');
    for (const t of facts.tools || []) {
      assert.strictEqual(m.includes(t.url), h.includes(t.url),
        `${md} and ${html} disagree on whether ${t.name} is present`);
    }
  }
});

test('severity is rendered in both formats and never as a confidence tier', () => {
  // Severity is editorial -- what the mistake costs -- and confidence is how the
  // rule was checked. Collapsing the two would let a judgement inherit the weight
  // of a measurement, which is the one thing the tier system exists to prevent.
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const withSev = facts.facts.filter(f => f.severity);
  assert.ok(withSev.length > 0, 'expected severities in the data');
  for (const f of withSev) {
    assert.ok(['silent', 'loud', 'friction'].includes(f.severity), `${f.id}: bad severity ${f.severity}`);
    assert.ok(!['measured', 'binary', 'inference'].includes(f.severity), `${f.id}: severity collides with a tier`);
  }
  const html = fs.readFileSync(path.join(out, SECTION, 'files-and-paths', 'index.html'), 'utf8');
  const md = fs.readFileSync(path.join(out, SECTION, 'files-and-paths.md'), 'utf8');
  const n = facts.facts.filter(f => f.page === 'files-and-paths' && f.severity).length;
  assert.strictEqual((html.match(/class="chip sev sev-/g) || []).length, n, 'HTML severity count');
  assert.strictEqual((md.match(/Breaks silently|Fails loudly|Costs friction/g) || []).length, n, 'Markdown severity count');
});

test('the contract carries the data the filters need on every rule', () => {
  // Filtering is client-side over rules already present in the DOM. Without these
  // attributes the page still reads correctly but every filter silently matches
  // nothing -- a failure with no visible symptom.
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const durable = facts.facts.filter(f => f.durability === 'durable');
  const html = fs.readFileSync(path.join(out, SECTION, 'contract', 'index.html'), 'utf8');
  const rows = [...html.matchAll(/<label class="crule" data-id="([^"]+)" data-tier="([^"]*)" data-sev="([^"]*)"/g)];
  assert.strictEqual(rows.length, durable.length, `${rows.length} contract rows for ${durable.length} rules`);
  for (const [, id, tier, sev] of rows) {
    const f = durable.find(x => x.id === id);
    assert.ok(f, `contract row ${id} matches no fact`);
    assert.strictEqual(tier, f.tier);
    assert.strictEqual(sev, f.severity || '');
  }
  for (const kind of ['tier', 'sev']) {
    assert.ok(html.includes(`data-filter="${kind}"`), `no ${kind} filter buttons`);
  }
});

test('the sidebar lists every page, grouped, with the current page marked', () => {
  const { out } = buildOnce();
  const facts = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../../skill-package/skills/claude-code-internals/references/state/author-facts.json'), 'utf8'));
  const grouped = facts.pages.filter(p => p.nav_group);
  assert.ok(grouped.length > 0, 'expected nav groups in the data');
  for (const p of facts.pages) {
    const rel = p.slug === 'index' ? `${SECTION}/index.html` : `${SECTION}/${p.slug}/index.html`;
    const html = fs.readFileSync(path.join(out, rel), 'utf8');
    for (const g of grouped) {
      // Labels are HTML-escaped on the way out ("Files & paths" -> "Files &amp; paths"),
      // so compare against the escaped form rather than the source string.
      const label = (g.nav_label || g.title)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      assert.ok(html.includes(`>${label}<`), `${rel}: sidebar is missing ${g.slug}`);
    }
    // Scoped to <aside>: the stylesheet also contains [aria-current="page"]
    // selectors, and a whole-document count picks those up too.
    const aside = (html.match(/<aside>[\s\S]*?<\/aside>/) || [''])[0];
    assert.strictEqual((aside.match(/aria-current="page"/g) || []).length, 1,
      `${rel} should mark exactly one nav entry as current`);
  }
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
