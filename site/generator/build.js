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
// Absolute origin, needed for canonical/og/sitemap URLs. Matches site/dist/CNAME;
// the apex is canonical because www and the github.io origin both 301 to it.
const ORIGIN = 'https://ccinternals.dev';
const CUSTOM_DOMAIN = 'ccinternals.dev';

// Freshness bands, in days since the capture the facts were verified against.
// NOTE: these are rendered CLIENT-SIDE from a data attribute. A static site
// cannot recompute a build-time badge, so a build-time band would freeze at
// whatever it was on deploy day and read "fresh" indefinitely.
const BAND_FRESH = 45;
const BAND_AGING = 90;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, 'skill-package/skills/claude-code-internals/references/state');

// Consumed by both the markdown and the HTML renderer. The two diverged once
// (md labelled caveats, HTML did not); a shared constant is what stops that
// recurring, since "rendered from the same fact objects" guarantees content
// parity, not chrome parity.
const CAVEAT_LABEL = 'Caveat:';

const TIER_LABEL = {
  measured: 'Measured',
  binary: 'From binary',
  inference: 'Inference',
};
// Reader-facing wording for the optional `lane` field. Absent means the fact was
// never lane-scoped -- deliberately rendered as nothing rather than "both", since
// unscoped is an unknown, not a claim of universality.
const LANE_LABEL = {
  local: 'Local sandbox',
  remote: 'Remote sandbox',
  both: 'Both sandboxes',
};

const TIER_TITLE = {
  measured: 'Observed live, with controls where noted',
  binary: 'Read from a shipped artifact; behaviour not exercised',
  inference: 'Stated inference — see caveats',
};

/**
 * The freshness badge. The date is SERVER-RENDERED: an empty span filled by
 * script means no date at all with JS off, in reader mode, or in a text
 * browser — which is precisely the arrival this badge exists for. The script
 * UPGRADES this (appends the age, sets the band); it never creates it.
 */
function freshnessBadge(verified) {
  return `<span class="fresh" data-verified="${esc(verified)}">Verified ${esc(verified)}</span>`;
}

/**
 * Tier legend. Rendered `open`: a collapsed <details> is not auto-expanded by
 * most browsers when targeted via #tiers, so a badge link would land a reader
 * on a closed summary and require a second tap for a load-bearing signal.
 */
function tierLegend() {
  return `<details class="legend" id="tiers" open>
<summary>What the confidence labels mean</summary>
<dl>
<dt>Measured</dt><dd>Observed live in a real session, with a control where noted.</dd>
<dt>From binary</dt><dd>Read out of a shipped artifact; the behaviour was not exercised.</dd>
<dt>Inference</dt><dd>Stated as inference in the source material — read the caveats.</dd>
</dl>
</details>`;
}

// Shared by every page. Upgrades server-rendered badges; degrades to the
// plain date when scripting is unavailable.
const AGE_SCRIPT = `<script>
(function () {
  function days(d) { return Math.floor((Date.now() - Date.parse(d + 'T00:00:00Z')) / 864e5); }
  var els = document.querySelectorAll('.fresh[data-verified]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i], n = days(el.dataset.verified);
    el.className = 'fresh ' + (n <= ${BAND_FRESH} ? '' : (n <= ${BAND_AGING} ? 'aging' : 'expired'));
    el.textContent = el.textContent + ' \u00b7 ' + n + ' day' + (n === 1 ? '' : 's') + ' ago';
  }
  var banners = document.querySelectorAll('.expired-banner[data-verified]');
  for (var j = 0; j < banners.length; j++) {
    var b = banners[j], m = days(b.dataset.verified);
    if (m > ${BAND_AGING}) {
      b.style.display = 'block';
      b.textContent = 'Last verified ' + m + ' days ago. Treat every detail as unverified.';
    }
  }
})();
</script>`;

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
  const lane = f.lane ? ` · *${LANE_LABEL[f.lane]}*` : '';
  out.push(`*${TIER_LABEL[f.tier]}*${lane}${f.volatile_dependency ? ' · *Depends on server-side configuration — can change without a version bump*' : ''}`, '');
  out.push(f.detail, '');
  for (const c of f.caveats || []) out.push(`> ${CAVEAT_LABEL} ${c}`, '');
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
      for (const f of fs_) out.push(`- [**${f.rule}**](${p.slug}.md) *(${TIER_LABEL[f.tier]})*`);
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
      for (const f of fs_) body.push(
        `<li><a class="rule-link" href="${up}${p.slug}/#${factAnchor(f)}"><strong>${inlineHtml(f.rule)}</strong></a> ${badge(f)}</li>`);
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
      body.push(`<h3 id="${factAnchor(f)}">${inlineHtml(f.rule)}</h3>`);
      body.push(`<p class="badges">${badge(f)}${laneBadge(f)}${f.volatile_dependency ? volatileBadge(up) : ''}</p>`);
      body.push(`<p>${inlineHtml(f.detail)}</p>`);
      for (const c of f.caveats || []) body.push(`<p class="caveat"><strong>${CAVEAT_LABEL}</strong> ${inlineHtml(c)}</p>`);
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
    canonical: page.slug === 'index' ? `/${SECTION}/` : `/${SECTION}/${page.slug}/`,
  });
}

function badge(f) {
  // Links to the on-page legend: a title= tooltip is invisible on touch devices,
  // and the tier is how a reader decides how much weight to give the claim.
  return `<a class="tier tier-${f.tier}" href="#tiers" title="${esc(TIER_TITLE[f.tier])}">${TIER_LABEL[f.tier]}</a>`;
}
/**
 * Stable per-fact anchor. Derived from the fact id, NOT the rule text: rule
 * wording gets revised (v2.36.1-3 rewrote ten of them) and an anchor built from
 * prose would silently break every inbound link when that happens.
 */
/**
 * TechArticle + BreadcrumbList. Deliberately NOT FAQPage: since 2023 Google
 * restricts FAQ rich results to a narrow set of authoritative sites, so marking
 * these pages up as FAQ would add weight for a result they will not receive.
 * TechArticle is the honest type and carries the freshness signal.
 */
function jsonLd({ title, description, canonical, verified }) {
  const url = ORIGIN + canonical;
  const isHome = canonical === `/${SECTION}/`;
  const graph = [{
    '@type': 'TechArticle',
    '@id': url + '#article',
    headline: title,
    description,
    url,
    inLanguage: 'en',
    isAccessibleForFree: true,
    ...(verified ? { dateModified: verified } : {}),
    author: { '@type': 'Person', name: 'Yaniv Golan', url: 'https://github.com/yaniv-golan' },
    publisher: { '@type': 'Person', name: 'Yaniv Golan', url: 'https://github.com/yaniv-golan' },
  }];
  if (!isHome) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Claude Cowork for Skill Authors', item: `${ORIGIN}/${SECTION}/` },
        { '@type': 'ListItem', position: 2, name: title, item: url },
      ],
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

function factAnchor(f) {
  return 'fact-' + f.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
function laneBadge(f) {
  // Rendered only when `lane` is set. An unscoped fact gets no badge at all --
  // absence is an unknown, and a "Both sandboxes" default would assert more than
  // the source material does. Mirrors the markdown renderer; keep the two together.
  return f.lane ? ` <span class="tier tier-lane">${LANE_LABEL[f.lane]}</span>` : '';
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

function shell({ title, description, body, mdHref, up, verified, slug, canonical }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Claude Cowork for Skill Authors</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${ORIGIN}${canonical}">
<link rel="alternate" type="text/markdown" href="${mdHref}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Claude Cowork for Skill Authors">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${ORIGIN}${canonical}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">${jsonLd({ title, description, canonical, verified })}</script>
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
/* Lane is scope, not confidence -- deliberately muted so it never competes
   with the tier badge a reader uses to weigh the claim. */
.tier-lane { color:var(--muted); border-color:var(--line); }
/* The contract is a checklist of 50+ one-liners; without an affordance it
   reads as a wall of text with nothing to click. */
.rules li { margin:.35rem 0; }
.rule-link { color:inherit; text-decoration:none; border-bottom:1px solid var(--line); }
.rule-link:hover { border-bottom-color:var(--accent); color:var(--accent); }
.caveat { color:var(--muted); font-size:.92rem; border-left:2px solid var(--line); padding-left:.75rem; }
.muted { color:var(--muted); }
table { border-collapse:collapse; width:100%; font-size:.92rem; }
td,th { border:1px solid var(--line); padding:.35rem .6rem; text-align:left; }
code { font-size:.9em; background:rgba(127,127,127,.14); padding:.05rem .3rem; border-radius:3px; }
footer { margin-top:3rem; border-top:1px solid var(--line); padding-top:1rem; font-size:.88rem; color:var(--muted); }
.fresh { display:inline-block; font-size:.8rem; padding:.15rem .5rem; border-radius:3px; border:1px solid var(--line); }
.fresh.aging { color:var(--warn); border-color:var(--warn); }
.fresh.expired { color:var(--bad); border-color:var(--bad); font-weight:600; }
.freshline { margin:0 0 1.5rem; font-size:.9rem; color:var(--muted); }
.expired-banner { display:none; border:1px solid var(--bad); color:var(--bad); padding:.75rem 1rem; border-radius:4px; margin-bottom:1.5rem; }
details.legend { border:1px solid var(--line); border-radius:4px; padding:.6rem .9rem; margin:1.5rem 0; font-size:.9rem; }
details.legend summary { cursor:pointer; font-weight:600; }
details.legend dt { margin-top:.5rem; font-weight:600; }
details.legend dd { margin:0 0 .1rem; color:var(--muted); }
ul.pages li { margin-bottom:.75rem; }
</style>
</head>
<body>
<nav>
  <a href="${up}">Start here</a>
  <a href="${up}contract/">The contract</a>
  <a href="${up}what-can-change-under-you/">What can change</a>
  <a href="${up}current-state/">Verified against</a>
  <a href="${mdHref}">This page as Markdown</a>
</nav>
<div class="expired-banner" data-verified="${esc(verified)}"></div>
<p class="freshline">${freshnessBadge(verified)} What was checked, and when — not a guarantee it is still true.</p>
${body}
${tierLegend()}
<footer>
<p><strong>Unofficial.</strong> Not affiliated with Anthropic. Derived from shipped binaries and live
sessions, then stamped with the build it was checked against.
<strong>This documentation does not detect product changes</strong> — behaviour served from Anthropic's
side can change at any time, with no version bump and no signal here.</p>
<p><strong>Found something wrong?</strong>
<a href="https://github.com/yaniv-golan/claude-code-internals/issues">Open an issue</a> — corrections
are the cheapest way this stays accurate.</p>
<p>By <a href="https://github.com/yaniv-golan">Yaniv Golan</a> · part of the
<a href="https://github.com/yaniv-golan/claude-code-internals">Claude Code Internals</a> project ·
<a href="${up}facts.json">facts.json</a> · <a href="${up}../llms.txt">llms.txt</a></p>
</footer>
${AGE_SCRIPT}
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

  // sitemap/robots/favicon — generated from the same doc.pages loop above, so a
  // new page cannot be added without appearing in the sitemap.
  const urls = doc.pages.map(pg => ({
    loc: ORIGIN + (pg.slug === 'index' ? `/${SECTION}/` : `/${SECTION}/${pg.slug}/`),
    // The contract page changes whenever any rule does; topic pages less often.
    priority: pg.slug === 'index' ? '1.0' : pg.slug === 'contract' ? '0.9' : '0.8',
  }));
  urls.unshift({ loc: ORIGIN + '/', priority: '0.7' });
  write('sitemap.xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${doc.verified_against.observed_at}</lastmod>` +
                  `<priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n');

  // The .md twins stay crawlable on purpose: they are the LLM-facing copy, and
  // every HTML page declares itself canonical, so they cannot split ranking.
  write('robots.txt',
    'User-agent: *\n' +
    'Allow: /\n' +
    'Disallow: /static/\n' +
    `Sitemap: ${ORIGIN}/sitemap.xml\n`);

  write('favicon.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="12" fill="#0b62d6"/>' +
    '<text x="32" y="44" font-family="system-ui,sans-serif" font-size="34" font-weight="700" ' +
    'fill="#fff" text-anchor="middle">cw</text></svg>\n');

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
    // Deliberately NOT a precomputed age or band. A value baked at build time
    // freezes on the deploy date and reads "fresh" forever — the defect this
    // project already shipped once in the rendered badge. Consumers get the
    // date and the thresholds and compute age at read time.
    staleness: {
      verified: doc.verified_against.observed_at,
      compute: 'age = today - verified; do not cache a precomputed band',
      bands_days: { fresh: BAND_FRESH, aging: BAND_AGING },
    },
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

  // root index — a destination in its own right. Per-section dates rather than
  // one site-wide badge: the verification date belongs to a section's facts, so
  // a single site date would be a category error the moment a second section
  // exists. NOTE: there is no section registry yet — this enumerates what the
  // generator knows about, which is one section.
  const sections = [{
    slug: SECTION,
    title: 'Cowork for skill authors',
    blurb: 'What your skill can rely on inside Claude Cowork — paths, file delivery, deletes, the shell, runtime detection, plugins and sub-agents.',
    verified: doc.verified_against.observed_at,
  }];
  const oldest = sections.map(x => x.verified).sort()[0];
  write('index.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Code Internals — how Claude Code and Cowork actually behave</title>
<meta name="description" content="Unofficial reference for skill authors, derived from shipped binaries and live sessions, stamped with the build each claim was verified against.">
<link rel="canonical" href="${ORIGIN}/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Claude Code Internals">
<meta property="og:title" content="Claude Code Internals — how Claude Code and Cowork actually behave">
<meta property="og:description" content="Unofficial reference for skill authors, derived from shipped binaries and live sessions, stamped with the build each claim was verified against.">
<meta property="og:url" content="${ORIGIN}/">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Claude Code Internals — how Claude Code and Cowork actually behave">
<meta name="twitter:description" content="Unofficial reference for skill authors, derived from shipped binaries and live sessions, stamped with the build each claim was verified against.">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Claude Code Internals',
  url: ORIGIN + '/',
  inLanguage: 'en',
  author: { '@type': 'Person', name: 'Yaniv Golan', url: 'https://github.com/yaniv-golan' },
})}</script>
<style>
:root { color-scheme: light dark; --fg:#111; --muted:#666; --line:#ddd; --accent:#0b62d6; --warn:#8a5a00; --bad:#a11; }
@media (prefers-color-scheme: dark) { :root { --fg:#e6e6e6; --muted:#9aa; --line:#333; --accent:#6aa9ff; --warn:#e0a83a; --bad:#ff8080; } }
body { font:16px/1.65 system-ui,-apple-system,sans-serif; max-width:44rem; margin:0 auto; padding:3rem 1.25rem 5rem; color:var(--fg); }
a { color:var(--accent); }
h1 { font-size:1.55rem; margin:0 0 .75rem; }
h2 { font-size:1.1rem; margin:2.5rem 0 .75rem; }
.lede { font-size:1.05rem; }
.section { border:1px solid var(--line); border-radius:6px; padding:1.1rem 1.25rem; margin:1rem 0; }
.section h3 { margin:0 0 .35rem; font-size:1.05rem; }
.muted { color:var(--muted); font-size:.9rem; }
.fresh { display:inline-block; font-size:.8rem; padding:.15rem .5rem; border-radius:3px; border:1px solid var(--line); }
.fresh.aging { color:var(--warn); border-color:var(--warn); }
.fresh.expired { color:var(--bad); border-color:var(--bad); font-weight:600; }
.expired-banner { display:none; border:1px solid var(--bad); color:var(--bad); padding:.75rem 1rem; border-radius:4px; margin-bottom:1.5rem; }
footer { margin-top:3rem; border-top:1px solid var(--line); padding-top:1rem; font-size:.88rem; color:var(--muted); }
</style>
</head><body>
<div class="expired-banner" data-verified="${oldest}"></div>
<h1>Claude Code Internals</h1>
<p class="lede">An unofficial reference for people writing Claude skills. Every claim here is derived
from shipped binaries and live sessions, and carries the build it was checked against and how
confident that check was.</p>
<p>Claude Cowork runs your skill in a sandbox whose rules differ from the Claude Code CLI in ways that
silently break otherwise-correct skills — files that never reach the user, deletes that fail, a shell
that cannot see your environment. This documents those differences.</p>
<h2>Sections</h2>
${sections.map(x => `<div class="section">
<h3><a href="${x.slug}/">${esc(x.title)}</a></h3>
<p>${esc(x.blurb)}</p>
<p>${freshnessBadge(x.verified)}</p>
</div>`).join('\n')}
<h2>What this is not</h2>
<p><strong>Not official, and not affiliated with Anthropic.</strong> It is reverse-engineered from
shipped software. <strong>It does not detect product changes</strong> — behaviour served from
Anthropic's side can change at any time, with no version bump and no signal here. Claims are stamped
with a date and a confidence label so you can judge how much weight to give them.</p>
<footer>
<p><strong>Found something wrong?</strong>
<a href="https://github.com/yaniv-golan/claude-code-internals/issues">Open an issue</a> — corrections
are the cheapest way this stays accurate.</p>
<p>By <a href="https://github.com/yaniv-golan">Yaniv Golan</a> · source on
<a href="https://github.com/yaniv-golan/claude-code-internals">GitHub</a> ·
machine-readable index at <a href="llms.txt">/llms.txt</a></p>
</footer>
${AGE_SCRIPT}
</body></html>
`);

  // 404 — a cold arrival on a stale or mistyped URL otherwise gets GitHub's
  // default page with no route back into the site.
  write('404.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not found — Claude Code Internals</title>
<meta name="robots" content="noindex,follow">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:34rem;margin:14vh auto;padding:0 1.25rem;color-scheme:light dark}h1{font-size:1.3rem}</style>
</head><body>
<h1>That page isn't here</h1>
<p>It may have moved, or the URL may be from an older version of this site.</p>
<p><a href="/">Start from the top</a> · <a href="/${SECTION}/">Cowork for skill authors</a></p>
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

  // gate 4 — every internal link must resolve, INCLUDING fragments.
  //
  // The previous regex was /href="([^"#:]+)"/ — it excluded '#', so it skipped
  // same-page anchors AND cross-page fragments like `contract/#tiers`. Badge
  // links would have pointed at nothing with no gate noticing. Resolve the path
  // part against the emitted set, then the fragment against that document.
  const linkErrors = [];
  const idsOf = (abs) => new Set(
    [...fs.readFileSync(abs, 'utf8').matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const rel of emitted) {
    if (!rel.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(outDir, rel), 'utf8');
    const base = path.dirname(rel);
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // external scheme
      const [rawPath, frag] = href.split('#');
      let targetRel;
      if (!rawPath) {
        targetRel = rel;                                // same-document fragment
      } else {
        // A leading slash is site-root-relative, not page-relative. Without this
        // the gate resolved /favicon.svg against each page's own directory and
        // reported a missing file for a link that was correct.
        targetRel = rawPath.startsWith('/')
          ? path.normalize(rawPath.slice(1))
          : path.normalize(path.join(base, rawPath));
        if (rawPath.endsWith('/') || !path.extname(rawPath)) {
          targetRel = path.join(targetRel, 'index.html');
        }
        if (!fs.existsSync(path.join(outDir, targetRel))) {
          linkErrors.push(`${rel} -> ${href} (no such target: ${targetRel})`);
          continue;
        }
      }
      if (frag && targetRel.endsWith('.html')) {
        if (!idsOf(path.join(outDir, targetRel)).has(frag)) {
          linkErrors.push(`${rel} -> ${href} (no id="${frag}" in ${targetRel})`);
        }
      }
    }
  }
  if (linkErrors.length) die(`gate 4: ${linkErrors.length} broken link(s):\n  ${linkErrors.join('\n  ')}`);

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
