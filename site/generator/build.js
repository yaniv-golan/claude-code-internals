#!/usr/bin/env node
/**
 * build.js — generates the public skill-author site into site/dist/.
 *
 * The site is GENERATED, never hand-written: all published prose comes from
 * references/state/author-facts.json, which is validated by validate-state.js
 * at PR time. There is no second copy of the facts that can drift.
 *
 * Deviation from the plan, deliberate: the plan called for a vendored markdown
 * renderer so HTML could be built from the generated .md. That is unnecessary
 * here — the source is structured JSON, not markdown documents, so .md and
 * .html are both rendered from the SAME fact objects. That is a stronger
 * guarantee than parsing our own markdown back (there is no lossy round-trip),
 * and it keeps the repo's zero-dependency property with no vendored blob.
 *
 * Usage:
 *   node site/generator/build.js            build into site/dist
 *   node site/generator/build.js --out DIR  build elsewhere (tests)
 *
 * Exit 0 = built, 1 = a gate failed (the offending id is printed).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { scanForDisclosure } = require('../../skill-package/skills/claude-code-internals/scripts/validate-state.js');

const SITE_URL = process.env.SITE_URL || 'https://ccinternals.dev';
const SECTION = 'cowork';
const CUSTOM_DOMAIN = 'ccinternals.dev';

// Freshness bands, in days since the capture the facts were verified against.
// NOTE: these are rendered CLIENT-SIDE from a data attribute. A static site
// cannot recompute a build-time badge, so a build-time band would freeze at
// whatever it was on deploy day and read "fresh" indefinitely.
const BAND_FRESH = 45;
const BAND_AGING = 90;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, 'skill-package/skills/claude-code-internals/references/state');

const TIER_LABEL = {
  measured: 'Measured',
  binary: 'From binary',
  inference: 'Inference',
};
const TIER_TITLE = {
  measured: 'Observed live, with controls where noted',
  binary: 'Read from a shipped artifact; behaviour not exercised',
  inference: 'Stated inference — see caveats',
};

function die(msg) {
  console.error(`build.js: ${msg}`);
  process.exit(1);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Minimal inline formatting shared by both renderers: `code` and **bold**. */
function inlineHtml(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// --- load + gate -----------------------------------------------------------

function load() {
  const factsPath = path.join(STATE_DIR, 'author-facts.json');
  if (!fs.existsSync(factsPath)) die('gate 1: author-facts.json is missing');
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
  } catch (e) {
    die(`gate 1: author-facts.json is unparseable — ${e.message}`);
  }
  const registry = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'registry.json'), 'utf8'));

  // gate 2 — no published claim may outlive the capture it was made against.
  const as = registry.as_of || {};
  const fc = as.fcache_capture || {};
  const want = {
    cli: as.cli,
    desktop_asar: as.desktop_asar,
    fcache_content16: fc.content16,
    observed_at: fc.observed_at,
  };
  for (const [k, v] of Object.entries(want)) {
    if (doc.verified_against[k] !== v) {
      die(`gate 2: verified_against.${k} is "${doc.verified_against[k]}" but registry as_of says "${v}"`);
    }
  }

  // gate 3 — page/fact referential integrity and the volatile quarantine.
  const slugs = new Set(doc.pages.map(p => p.slug));
  for (const f of doc.facts) {
    if (!slugs.has(f.page)) die(`gate 3: fact "${f.id}" references unknown page "${f.page}"`);
    if (f.durability === 'volatile' && f.page !== 'current-state') {
      die(`gate 3: volatile fact "${f.id}" is assigned to content page "${f.page}"`);
    }
  }
  for (const p of doc.pages) {
    const generated = ['index', 'contract', 'current-state'];
    if (!generated.includes(p.slug) && !doc.facts.some(f => f.page === p.slug)) {
      die(`gate 3: page "${p.slug}" has no facts`);
    }
  }
  return { doc, registry };
}

// --- rendering -------------------------------------------------------------

function factsFor(doc, slug) {
  return doc.facts.filter(f => f.page === slug);
}

function renderFactMd(f) {
  const out = [`### ${f.rule}`, ''];
  out.push(`*${TIER_LABEL[f.tier]}*${f.volatile_dependency ? ' · *Depends on server-side configuration — can change without a version bump*' : ''}`, '');
  out.push(f.detail, '');
  for (const c of f.caveats || []) out.push(`> Caveat: ${c}`, '');
  return out;
}

function renderPageMd(doc, page, registry) {
  const out = [`# ${page.title}`, '', page.summary, ''];
  const facts = factsFor(doc, page.slug);

  if (page.slug === 'contract') {
    out.push('Every rule on the site, grouped by the page that explains it. Generated — this page cannot disagree with the others.', '');
    for (const p of doc.pages) {
      const fs_ = factsFor(doc, p.slug).filter(f => f.durability === 'durable');
      if (!fs_.length) continue;
      out.push(`## ${p.title}`, '');
      for (const f of fs_) out.push(`- **${f.rule}** *(${TIER_LABEL[f.tier]})*`);
      out.push('');
    }
  } else if (page.slug === 'current-state') {
    out.push(...renderCurrentStateMd(doc, registry));
  } else if (page.slug === 'index') {
    out.push('## Pages', '');
    for (const p of doc.pages) {
      if (p.slug === 'index') continue;
      out.push(`- **${p.title}** — ${p.summary.split('. ')[0]}.`);
    }
    out.push('');
  } else {
    for (const f of facts) out.push(...renderFactMd(f));
  }

  if ((page.open_questions || []).length) {
    out.push('## What is not established', '');
    for (const q of page.open_questions) out.push(`- ${q}`);
    out.push('');
  }
  out.push('---', '',
    `Consistent with the capture of ${doc.verified_against.observed_at}. ` +
    'Exact artifact versions and capture identity are on the current-state page. ' +
    'This documentation does not detect product changes.', '');
  return out.join('\n');
}

function renderCurrentStateMd(doc, registry) {
  const as = registry.as_of;
  const fc = as.fcache_capture;
  const out = ['## Verified against', '',
    '| Artifact | Version |', '|---|---|',
    `| Claude Code CLI | ${as.cli} |`,
    `| Desktop application | ${as.desktop_asar} |`,
    `| Desktop-managed agent | ${as.agent_elf_parity_check} |`,
    `| In-VM agent | ${as.in_vm_elf} |`,
  ];
  if (as.container_cc_version_observed) {
    out.push(`| Remote-lane agent (observed range) | ${as.container_cc_version_observed.range.join(', ')} |`);
  }
  out.push('', `Capture identity: \`${fc.content16}\` · ${fc.feature_count} server-side entries observed · ${fc.observed_at}`, '');
  out.push('The capture identity is a content hash of the served configuration at observation time. ' +
    'It exists because that payload is refetched irregularly and its contents can change without ' +
    'any version changing, so a date alone cannot identify what was seen.', '');
  const vol = doc.facts.filter(f => f.durability === 'volatile');
  if (vol.length) {
    out.push('## Volatile observations', '');
    for (const f of vol) out.push(`- **${f.rule}** ${f.detail}`);
    out.push('');
  }
  return out;
}

// --- HTML ------------------------------------------------------------------

function pageHtml(doc, page, registry, depth) {
  const up = depth === 0 ? '' : '../';
  const facts = factsFor(doc, page.slug);
  const body = [];

  body.push(`<h1>${esc(page.title)}</h1>`);
  body.push(`<p class="summary">${inlineHtml(page.summary)}</p>`);

  if (page.slug === 'contract') {
    body.push('<p>Every rule on the site, grouped by the page that explains it. Generated — this page cannot disagree with the others.</p>');
    for (const p of doc.pages) {
      const fs_ = factsFor(doc, p.slug).filter(f => f.durability === 'durable');
      if (!fs_.length) continue;
      body.push(`<h2><a href="${up}${p.slug}/">${esc(p.title)}</a></h2><ul class="rules">`);
      for (const f of fs_) body.push(`<li><strong>${inlineHtml(f.rule)}</strong> ${badge(f)}</li>`);
      body.push('</ul>');
    }
  } else if (page.slug === 'current-state') {
    body.push(mdTablesToHtml(renderCurrentStateMd(doc, registry).join('\n')));
  } else if (page.slug === 'index') {
    body.push('<h2>Pages</h2><ul class="pages">');
    for (const p of doc.pages) {
      if (p.slug === 'index') continue;
      body.push(`<li><a href="${up}${p.slug}/">${esc(p.title)}</a><br><span class="muted">${inlineHtml(p.summary.split('. ')[0])}.</span></li>`);
    }
    body.push('</ul>');
  } else {
    for (const f of facts) {
      body.push('<section class="fact">');
      body.push(`<h3>${inlineHtml(f.rule)}</h3>`);
      body.push(`<p class="badges">${badge(f)}${f.volatile_dependency ? volatileBadge(up) : ''}</p>`);
      body.push(`<p>${inlineHtml(f.detail)}</p>`);
      for (const c of f.caveats || []) body.push(`<p class="caveat">${inlineHtml(c)}</p>`);
      body.push('</section>');
    }
  }

  if ((page.open_questions || []).length) {
    body.push('<h2>What is not established</h2><ul class="open">');
    for (const q of page.open_questions) body.push(`<li>${inlineHtml(q)}</li>`);
    body.push('</ul>');
  }

  const mdHref = page.slug === 'index' ? 'index.md' : `${up}${page.slug}.md`;
  return shell({
    title: page.title,
    description: page.summary.split('. ')[0] + '.',
    body: body.join('\n'),
    mdHref,
    up,
    verified: doc.verified_against.observed_at,
    slug: page.slug,
  });
}

function badge(f) {
  return `<span class="tier tier-${f.tier}" title="${esc(TIER_TITLE[f.tier])}">${TIER_LABEL[f.tier]}</span>`;
}
function volatileBadge(up) {
  return ` <a class="tier tier-volatile" href="${up}what-can-change-under-you/">Can change without a version bump</a>`;
}

/** Convert the small subset of markdown current-state emits (tables, headings, lists). */
function mdTablesToHtml(md) {
  const out = [];
  let inTable = false;
  for (const line of md.split('\n')) {
    if (/^\|/.test(line)) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map(c => inlineHtml(c.trim()));
      if (!inTable) { out.push('<table>'); inTable = true; out.push('<tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr>'); continue; }
      out.push('<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }
    if (/^## /.test(line)) out.push(`<h2>${inlineHtml(line.slice(3))}</h2>`);
    else if (/^- /.test(line)) out.push(`<p>${inlineHtml(line.slice(2))}</p>`);
    else if (line.trim()) out.push(`<p>${inlineHtml(line)}</p>`);
  }
  if (inTable) out.push('</table>');
  return out.join('\n');
}

function shell({ title, description, body, mdHref, up, verified, slug }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Claude Cowork for Skill Authors</title>
<meta name="description" content="${esc(description)}">
<link rel="alternate" type="text/markdown" href="${mdHref}">
<style>
:root { color-scheme: light dark; --fg:#111; --muted:#666; --line:#ddd; --accent:#0b62d6; --warn:#8a5a00; --bad:#a11; }
@media (prefers-color-scheme: dark) { :root { --fg:#e6e6e6; --muted:#9aa; --line:#333; --accent:#6aa9ff; --warn:#e0a83a; --bad:#ff8080; } }
body { font:16px/1.65 system-ui,-apple-system,sans-serif; max-width:46rem; margin:0 auto; padding:2rem 1.25rem 5rem; color:var(--fg); }
nav { display:flex; gap:1rem; flex-wrap:wrap; font-size:.9rem; border-bottom:1px solid var(--line); padding-bottom:.75rem; margin-bottom:1.5rem; }
a { color:var(--accent); }
h1 { font-size:1.6rem; line-height:1.25; margin:0 0 1rem; }
h2 { font-size:1.15rem; margin:2.25rem 0 .5rem; }
h3 { font-size:1rem; margin:0 0 .35rem; }
.summary { font-size:1.05rem; border-left:3px solid var(--accent); padding-left:1rem; }
.fact { border-top:1px solid var(--line); padding-top:1.25rem; margin-top:1.5rem; }
.badges { margin:.2rem 0 .6rem; }
.tier { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; border:1px solid var(--line); border-radius:3px; padding:.1rem .4rem; text-decoration:none; }
.tier-measured { color:#0a7; border-color:#0a7; }
.tier-binary { color:var(--accent); border-color:var(--accent); }
.tier-inference { color:var(--warn); border-color:var(--warn); }
.tier-volatile { color:var(--warn); border-color:var(--warn); }
.caveat { color:var(--muted); font-size:.92rem; border-left:2px solid var(--line); padding-left:.75rem; }
.muted { color:var(--muted); }
table { border-collapse:collapse; width:100%; font-size:.92rem; }
td,th { border:1px solid var(--line); padding:.35rem .6rem; text-align:left; }
code { font-size:.9em; background:rgba(127,127,127,.14); padding:.05rem .3rem; border-radius:3px; }
footer { margin-top:3rem; border-top:1px solid var(--line); padding-top:1rem; font-size:.88rem; color:var(--muted); }
#fresh { display:inline-block; font-size:.8rem; padding:.15rem .5rem; border-radius:3px; border:1px solid var(--line); }
#fresh.aging { color:var(--warn); border-color:var(--warn); }
#fresh.expired { color:var(--bad); border-color:var(--bad); font-weight:600; }
#expired-banner { display:none; border:1px solid var(--bad); color:var(--bad); padding:.75rem 1rem; border-radius:4px; margin-bottom:1.5rem; }
ul.pages li { margin-bottom:.75rem; }
</style>
</head>
<body data-verified="${esc(verified)}">
<nav>
  <a href="${up}">Start here</a>
  <a href="${up}contract/">The contract</a>
  <a href="${up}what-can-change-under-you/">What can change</a>
  <a href="${up}current-state/">Verified against</a>
  <a href="${mdHref}">This page as Markdown</a>
</nav>
<div id="expired-banner"></div>
${body}
<footer>
<p><span id="fresh"></span></p>
<p><strong>Unofficial.</strong> Not affiliated with Anthropic. Derived from shipped binaries and live
sessions, then stamped with the build it was checked against.
<strong>This documentation does not detect product changes</strong> — behaviour served from Anthropic's
side can change at any time, with no version bump and no signal here.</p>
<p>Part of the <a href="https://github.com/yaniv-golan/claude-code-internals">Claude Code Internals</a>
project · <a href="${up}facts.json">facts.json</a> · <a href="${up}../llms.txt">llms.txt</a></p>
</footer>
<script>
// Age is computed on load, not at build time: a static page built on day 10
// would otherwise still claim "fresh" on day 200.
(function () {
  var d = document.body.dataset.verified, el = document.getElementById('fresh');
  if (!d || !el) return;
  var days = Math.floor((Date.now() - Date.parse(d + 'T00:00:00Z')) / 864e5);
  var band = days <= ${BAND_FRESH} ? '' : (days <= ${BAND_AGING} ? 'aging' : 'expired');
  el.className = band;
  el.textContent = 'Verified ' + d + ' · ' + days + ' day' + (days === 1 ? '' : 's') + ' ago';
  if (band === 'expired') {
    var b = document.getElementById('expired-banner');
    b.style.display = 'block';
    b.textContent = 'This page was last verified ' + days + ' days ago. Treat every detail as unverified.';
  }
})();
</script>
</body>
</html>
`;
}

// --- emit ------------------------------------------------------------------

function build(outDir) {
  const { doc, registry } = load();
  const section = path.join(outDir, SECTION);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(section, { recursive: true });

  const emitted = new Set();
  const write = (rel, content) => {
    const p = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    emitted.add(rel);
  };

  for (const page of doc.pages) {
    const md = renderPageMd(doc, page, registry);
    if (page.slug === 'index') {
      write(`${SECTION}/index.md`, md);
      write(`${SECTION}/index.html`, pageHtml(doc, page, registry, 0));
    } else {
      write(`${SECTION}/${page.slug}.md`, md);
      write(`${SECTION}/${page.slug}/index.html`, pageHtml(doc, page, registry, 1));
    }
  }

  // published facts.json — a projection, not a copy
  const pub = {
    schema_version: 1,
    site: SITE_URL,
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    verified: {
      date: doc.verified_against.observed_at,
      note: 'Exact artifact versions and capture identity are on the current-state page.',
      current_state_url: `${SITE_URL}/${SECTION}/current-state/`,
    },
    disclaimer: 'This documentation does not detect product changes. It records what was verified on a date against a build.',
    tiers: TIER_TITLE,
    facts: doc.facts.filter(f => f.durability === 'durable').map(f => ({
      id: f.id,
      page: `${SITE_URL}/${SECTION}/${f.page}/`,
      rule: f.rule,
      detail: f.detail,
      tier: f.tier,
      server_flag_dependent: !!f.volatile_dependency,
      verified: f.verified,
      caveats: f.caveats || [],
    })),
    open_questions: doc.pages.flatMap(p => (p.open_questions || []).map(q => ({
      page: `${SITE_URL}/${SECTION}/${p.slug === 'index' ? '' : p.slug + '/'}`,
      question: q,
    }))),
  };
  write(`${SECTION}/facts.json`, JSON.stringify(pub, null, 2) + '\n');

  // llms.txt at the site root — one line per page, pointing at raw markdown
  const llms = [
    '# Claude Code Internals',
    '',
    '> Unofficial, reverse-engineered reference derived from shipped binaries and live sessions.',
    '> Each section is stamped with the build it was verified against. This site does NOT detect',
    '> product changes: behaviour served from Anthropic\'s side can change with no version bump.',
    '',
    '## Cowork for skill authors',
    '',
  ];
  for (const p of doc.pages) {
    const mdUrl = p.slug === 'index'
      ? `${SITE_URL}/${SECTION}/index.md`
      : `${SITE_URL}/${SECTION}/${p.slug}.md`;
    llms.push(`- [${p.title}](${mdUrl}): ${p.summary.split('. ')[0]}.`);
  }
  llms.push('', '## Machine-readable', '',
    `- [facts.json](${SITE_URL}/${SECTION}/facts.json): every published rule with confidence tier and caveats.`, '');
  write('llms.txt', llms.join('\n'));

  // root index — the site is project-level; sections live underneath
  write('index.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Code Internals</title>
<meta name="description" content="Unofficial reference derived from shipped binaries and live sessions.">
<style>body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:40rem;margin:12vh auto;padding:0 1.25rem;color-scheme:light dark}h1{font-size:1.35rem}li{margin:.6rem 0}.muted{opacity:.7;font-size:.9rem}</style>
</head><body>
<h1>Claude Code Internals</h1>
<p>Unofficial reference derived from shipped binaries and live sessions.</p>
<ul>
  <li><a href="${SECTION}/">Cowork for skill authors</a> — what your skill can rely on inside Claude Cowork.</li>
</ul>
<p class="muted">Not affiliated with Anthropic. Machine-readable index at <a href="llms.txt">/llms.txt</a>.</p>
</body></html>
`);

  write('CNAME', CUSTOM_DOMAIN + '\n');

  // static passthrough — preserves existing published URLs
  const staticSrc = path.join(REPO_ROOT, 'site', 'static');
  if (fs.existsSync(staticSrc)) {
    for (const f of fs.readdirSync(staticSrc)) {
      write(`static/${f}`, fs.readFileSync(path.join(staticSrc, f)));
    }
  }

  // gate 4 — every internal link must have a target in the emitted set
  const linkErrors = [];
  for (const rel of emitted) {
    if (!rel.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(outDir, rel), 'utf8');
    const base = path.dirname(rel);
    for (const m of html.matchAll(/href="([^"#:]+)"/g)) {
      const href = m[1];
      if (href.startsWith('http') || href.startsWith('mailto:')) continue;
      let target = path.normalize(path.join(base, href));
      if (href.endsWith('/') || !path.extname(href)) target = path.join(target, 'index.html');
      if (!fs.existsSync(path.join(outDir, target))) {
        linkErrors.push(`${rel} -> ${href} (resolved ${target})`);
      }
    }
  }
  if (linkErrors.length) die(`gate 4: ${linkErrors.length} broken internal link(s):\n  ${linkErrors.join('\n  ')}`);

  // gate 5 — disclosure lint over the published PROSE of everything emitted.
  // HTML is stripped of <script>/<style>/tags first: the risk is an internal
  // name reaching a reader, not our own template code, and scanning raw markup
  // just reports the generator's own DOM calls.
  const disc = [];
  const flags = [];
  for (const rel of emitted) {
    if (!/\.(html|md|txt|json)$/.test(rel)) continue;
    let text = fs.readFileSync(path.join(outDir, rel), 'utf8');
    if (rel.endsWith('.html')) {
      text = text
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
    } else if (rel.endsWith('.json')) {
      // Scan values only. Our own published schema field names are not leaks,
      // and including them would make the lint fire on its own output format.
      const strings = [];
      (function walk(v) {
        if (typeof v === 'string') strings.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      })(JSON.parse(text));
      text = strings.join('\n');
    }
    const r = scanForDisclosure(text, rel);
    disc.push(...r.failures);
    flags.push(...r.flags);
  }
  if (disc.length) die(`gate 5: disclosure lint matched published output:\n  ${disc.slice(0, 25).join('\n  ')}`);

  // gate 6 — staleness NEVER fails the build. An expired site must still be
  // deployable, otherwise the expired notice itself can never ship.
  const days = Math.floor((Date.now() - Date.parse(doc.verified_against.observed_at + 'T00:00:00Z')) / 864e5);
  const band = days <= BAND_FRESH ? 'fresh' : days <= BAND_AGING ? 'aging' : 'expired';

  console.log(`built ${emitted.size} files into ${path.relative(REPO_ROOT, outDir)}`);
  console.log(`  pages: ${doc.pages.length}  facts: ${doc.facts.length}  verified: ${doc.verified_against.observed_at} (${days}d, ${band})`);
  if (flags.length) {
    console.log(`  ${flags.length} review flag(s) (not fatal):`);
    for (const f of flags.slice(0, 10)) console.log(`    ${f}`);
  }
  if (band === 'expired') {
    console.log('  NOTE: past the freshness limit — pages will render the expired banner.');
  }
  return { emitted, days, band };
}

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const out = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(REPO_ROOT, 'site', 'dist');
  build(out);
}

module.exports = { build, SITE_URL, SECTION };
