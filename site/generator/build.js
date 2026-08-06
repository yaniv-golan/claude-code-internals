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
  // Dot + date. AGE_SCRIPT appends "· N days ago" and recolours the dot; without
  // scripting the date still stands on its own.
  return `<span class="dot" data-dot></span><span class="fresh" data-verified="${esc(verified)}">Verified ${esc(verified)}</span>`;
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
    var band = n <= ${BAND_FRESH} ? '' : (n <= ${BAND_AGING} ? 'aging' : 'expired');
    el.className = 'fresh ' + band;
    var dot = el.parentNode.querySelector('[data-dot]');
    if (dot) dot.className = 'dot ' + band;
    el.textContent = el.textContent + ' \u00b7 ' + (n === 0 ? 'today' : n + ' day' + (n === 1 ? '' : 's') + ' ago');
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


// Theme toggle and the contract page's filters, ticks and copy. Everything here
// is an enhancement: the pages are complete and readable with scripting off,
// and every rule is present in the DOM before any filter runs.
const UI_SCRIPT = `<script>
(function () {
  var root = document.documentElement;
  function current() {
    return root.getAttribute('data-t') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  var btn = document.querySelector('[data-theme-toggle]');
  function label() { if (btn) btn.textContent = current() === 'dark' ? 'light' : 'dark'; }
  label();
  if (btn) btn.addEventListener('click', function () {
    var next = current() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-t', next);
    try { localStorage.setItem('ccitheme', next); } catch (e) {}
    label();
  });

  var list = document.querySelector('[data-contract]');
  if (!list) return;
  var rules = [].slice.call(list.querySelectorAll('.crule'));
  var counter = document.querySelector('[data-count]');
  var total = rules.length;
  var on = { tier: [], sev: [] };

  function apply() {
    var shown = 0;
    rules.forEach(function (r) {
      var okT = !on.tier.length || on.tier.indexOf(r.dataset.tier) > -1;
      var okS = !on.sev.length || on.sev.indexOf(r.dataset.sev) > -1;
      var vis = okT && okS;
      r.classList.toggle('hide', !vis);
      if (vis) shown++;
    });
    [].forEach.call(list.querySelectorAll('.cgroup'), function (g) {
      var any = g.querySelector('.crule:not(.hide)');
      g.style.display = any ? '' : 'none';
    });
    if (counter) counter.textContent = 'showing ' + shown + ' of ' + total;
  }
  [].forEach.call(document.querySelectorAll('[data-filter]'), function (b) {
    b.addEventListener('click', function () {
      var kind = b.dataset.filter, val = b.dataset.value, cur = on[kind];
      var i = cur.indexOf(val);
      if (i > -1) cur.splice(i, 1); else cur.push(val);
      b.setAttribute('aria-pressed', i > -1 ? 'false' : 'true');
      apply();
    });
  });

  var KEY = 'ccichecks';
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} }
  rules.forEach(function (r) {
    var box = r.querySelector('input');
    if (!box) return;
    if (saved[r.dataset.id]) box.checked = true;
    box.addEventListener('change', function () {
      if (box.checked) saved[r.dataset.id] = 1; else delete saved[r.dataset.id];
      persist();
    });
  });
  var reset = document.querySelector('[data-reset]');
  if (reset) reset.addEventListener('click', function () {
    saved = {}; persist();
    rules.forEach(function (r) { var b = r.querySelector('input'); if (b) b.checked = false; });
  });

  var copy = document.querySelector('[data-copy]');
  if (copy) copy.addEventListener('click', function () {
    var out = [];
    [].forEach.call(list.querySelectorAll('.cgroup'), function (g) {
      if (g.style.display === 'none') return;
      var lines = [];
      [].forEach.call(g.querySelectorAll('.crule:not(.hide)'), function (r) {
        var box = r.querySelector('input');
        lines.push('- [' + (box && box.checked ? 'x' : ' ') + '] ' + r.dataset.rule +
          ' \\\`' + r.dataset.tier + '\\\`' + (r.dataset.sev ? ' \\\`' + r.dataset.sev.toUpperCase() + '\\\`' : ''));
      });
      if (lines.length) out.push('## ' + g.dataset.title + '\\n' + lines.join('\\n'));
    });
    var text = out.join('\\n\\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    var was = copy.textContent;
    copy.textContent = 'copied \\u2713';
    setTimeout(function () { copy.textContent = was; }, 1600);
  });
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
  const sev = f.severity ? ` · *${SEV_MEANS[f.severity]}*` : '';
  out.push(`*${TIER_LABEL[f.tier]}*${sev}${lane}${f.volatile_dependency ? ' · *Depends on server-side configuration — can change without a version bump*' : ''}`, '');
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
      for (const f of fs_) out.push(`- [**${f.rule}**](${p.slug}.md) *(${TIER_LABEL[f.tier]}${f.severity ? ' · ' + SEV_LABEL[f.severity] : ''})*`);
      out.push('');
    }
    // A reader who just went through every rule is the one asking how to check
    // them. This is the only page where that question is unavoidable.
    out.push(...toolsMd((doc.tools || []).filter(t => t.slug === 'verify'), 'Checking your own skill against these'));
  } else if (page.slug === 'current-state') {
    out.push(...renderCurrentStateMd(doc, registry));
  } else if (page.slug === 'index') {
    out.push('## Pages', '');
    for (const p of doc.pages) {
      if (p.slug === 'index') continue;
      out.push(`- **${p.title}** — ${p.summary.split('. ')[0]}.`);
    }
    out.push('');
    out.push(...toolsMd(doc.tools || [], 'Where this fits in your workflow'));
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

const SEV_LABEL = { silent: 'SILENT', loud: 'LOUD', friction: 'FRICTION' };
const SEV_MEANS = {
  silent: 'Breaks silently',
  loud: 'Fails loudly',
  friction: 'Costs friction',
};

/** Severity is editorial: what the mistake costs you, not how the rule was checked. */
function sevChip(f) {
  if (!f.severity) return '';
  return `<span class="chip sev sev-${f.severity}" title="${esc(SEV_MEANS[f.severity])}">` +
         `<i></i>${SEV_LABEL[f.severity]}</span>`;
}

/** First sentence of a rule — short enough for a table of contents, and never invented. */
function shortRule(rule) {
  const m = rule.match(/^[^.]+\./);
  return (m ? m[0] : rule).replace(/\.$/, '');
}

function homeBody(doc, up) {
  const durable = doc.facts.filter(f => f.durability === 'durable');
  const topics = doc.pages.filter(p => p.blurb && p.slug !== 'current-state');
  const b = [];
  b.push('<main>');
  b.push('<div style="max-width:720px">',
    `<h1>${esc(doc.pages.find(p => p.slug === 'index').title)}</h1>`,
    `<p class="lede">${inlineHtml(doc.pages.find(p => p.slug === 'index').summary.split('. ').slice(0, 2).join('. '))}.</p>`,
    `<p class="sub">Derived from shipped binaries and live sessions. This site does not detect product changes.</p>`,
    '</div>');

  if ((doc.router || []).length) {
    b.push('<section class="block">',
      '<div class="secthead"><h2 class="sect">Start from the symptom</h2>',
      '<span class="note">What you saw → why → what to do instead</span></div>',
      '<div class="router">');
    for (const r of doc.router) {
      b.push(`<a href="${up}${r.page}/">`,
        `<div class="sym">${inlineHtml(r.symptom)}</div>`,
        `<div class="why">${inlineHtml(r.why)}</div>`,
        `<div class="fix">${inlineHtml(r.fix)}</div>`, '</a>');
    }
    b.push('</div></section>');
  }

  b.push('<section class="twocol"><div>',
    '<h2 style="margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:-.02em">The five that break the most skills</h2>',
    '<p style="margin:0 0 20px;font-size:14.5px;color:var(--fg3)">If you read nothing else.</p>',
    '<ol class="top5">');
  (doc.top5 || []).forEach((t, i) => {
    b.push('<li>', `<span class="n">${String(i + 1).padStart(2, '0')}</span>`,
      `<div><div class="r"><a href="${up}${t.page}/" style="color:inherit">${inlineHtml(t.rule)}</a></div>`,
      `<div class="w">${inlineHtml(t.why)}</div></div>`, '</li>');
  });
  b.push('</ol></div>');

  b.push('<div class="legend" id="tiers">',
    '<h3>How to read the labels</h3>',
    '<div class="t">Confidence — how we know</div>',
    '<div class="badges" style="padding:0 0 6px">',
    '<span class="chip">MEASURED</span><span class="chip">FROM BINARY</span><span class="chip">INFERENCE</span>',
    '</div>',
    '<div class="d">Neutral on purpose. Provenance is not severity.</div>',
    '<hr>',
    '<div class="t">Severity — what it costs you</div>',
    '<div class="sevkey">');
  for (const k of ['silent', 'loud', 'friction']) {
    b.push(`<span><i style="background:var(--sev${k === 'silent' ? 1 : k === 'loud' ? 2 : 3})"></i>${SEV_MEANS[k]}</span>`);
  }
  b.push('</div>',
    '<div class="d" style="margin-top:8px">Editorial, not measured — a judgement about consequence.</div>',
    '</div></section>');

  b.push('<section class="block">',
    `<h2 class="sect" style="margin-bottom:20px">${topics.length} failure modes, one page each</h2>`,
    '<div class="pagegrid">');
  for (const p of topics) {
    const n = doc.facts.filter(f => f.page === p.slug && f.durability === 'durable').length;
    b.push(`<a href="${up}${p.slug}/"><div class="t"><div class="ttl">${esc(p.title)}</div>`,
      `<span class="c">${n} rules</span></div>`,
      `<div class="b">${inlineHtml(p.blurb)}</div></a>`);
  }
  b.push('</div></section>');

  b.push('<section class="block">',
    '<div class="secthead" style="border-bottom:0;padding-bottom:0;margin-bottom:18px">',
    '<h2 class="sect">Where this fits in your workflow</h2>',
    `<span class="note">${esc(TOOLS_NOTE)}</span></div>`,
    '<div class="tools">');
  for (const t of doc.tools || []) {
    b.push('<div class="tool">', `<div class="when">${esc(t.when)}</div>`,
      `<a class="nm" href="${t.url}">${esc(t.name)}</a>`,
      `<p>${inlineHtml(t.what)} ${inlineHtml(t.why)}</p>`, '</div>');
  }
  b.push('</div></section>');
  b.push(`<p class="sub" style="margin-top:44px">${durable.length} rules in total · <a href="${up}contract/">see them all on one page</a></p>`);
  b.push('</main>');
  return b.join('\n');
}

function topicBody(doc, page, up) {
  const facts = factsFor(doc, page.slug);
  const b = ['<main class="topic">', '<article>'];
  b.push(`<div class="kicker">${esc(page.nav_group || '')} · ${facts.length} rule${facts.length === 1 ? '' : 's'}</div>`);
  b.push(`<h1>${esc(page.title)}</h1>`);
  b.push(`<p class="lede">${inlineHtml(page.summary)}</p>`);
  b.push('<div class="facts">');
  for (const f of facts) {
    b.push('<section class="fact">',
      '<div class="facthead">',
      `<h2 id="${factAnchor(f)}">${inlineHtml(f.rule)}</h2>`,
      `<div class="badges">${sevChip(f)}${badge(f, up)}${laneBadge(f)}${f.volatile_dependency ? volatileBadge(up) : ''}</div>`,
      '</div>',
      `<p>${inlineHtml(f.detail)}</p>`);
    for (const c of f.caveats || []) {
      b.push(`<div class="caveat"><strong>${CAVEAT_LABEL}</strong> ${inlineHtml(c)}</div>`);
    }
    b.push('</section>');
  }
  b.push('</div>');
  if ((page.open_questions || []).length) {
    b.push('<section class="notest"><h2>What is not established</h2><ul>');
    for (const q of page.open_questions) b.push(`<li>${inlineHtml(q)}</li>`);
    b.push('</ul></section>');
  }
  b.push('</article>');
  b.push('<nav class="toc"><div class="navlabel">On this page</div>');
  for (const f of facts) b.push(`<a href="#${factAnchor(f)}">${esc(shortRule(f.rule))}</a>`);
  b.push(`<div class="all"><a href="${up}contract/">All ${doc.facts.filter(f => f.durability === 'durable').length} rules →</a></div>`);
  b.push('</nav></main>');
  return b.join('\n');
}

function contractBody(doc, page, up) {
  const durable = doc.facts.filter(f => f.durability === 'durable');
  const harness = (doc.tools || []).find(t => t.slug === 'verify');
  const b = ['<main class="wide">'];
  b.push('<div class="ctop"><div style="max-width:640px">',
    `<h1>${esc(page.title)}</h1>`,
    `<p class="lede" style="font-size:16.5px">${inlineHtml(page.summary)}</p></div>`,
    '<div class="cbtns">',
    '<button type="button" data-copy>copy as markdown</button>',
    '<button type="button" data-reset>reset ticks</button>',
    '</div></div>');
  if (harness) {
    b.push('<div class="harness">',
      `<span class="s">Rather not tick these by hand? <a href="${harness.url}" style="font-family:var(--mono);font-weight:600">${esc(harness.name)}</a> ${inlineHtml(harness.what)}</span>`,
      `<span class="n">${esc(TOOLS_NOTE)}</span></div>`);
  }
  b.push('<div class="filters">',
    '<span class="lbl">Confidence</span><div class="set">');
  for (const [k, v] of [['measured', 'MEASURED'], ['binary', 'FROM BINARY'], ['inference', 'INFERENCE']]) {
    b.push(`<button type="button" data-filter="tier" data-value="${k}" aria-pressed="false">${v}</button>`);
  }
  b.push('</div><span class="sep"></span><span class="lbl">Severity</span><div class="set">');
  for (const k of ['silent', 'loud', 'friction']) {
    b.push(`<button type="button" data-filter="sev" data-value="${k}" aria-pressed="false">${SEV_LABEL[k]}</button>`);
  }
  b.push('</div>', `<span class="count" data-count>showing ${durable.length} of ${durable.length}</span>`, '</div>');

  b.push('<div class="cols" data-contract>');
  for (const p of doc.pages) {
    const fs_ = factsFor(doc, p.slug).filter(f => f.durability === 'durable');
    if (!fs_.length) continue;
    b.push(`<section class="cgroup" data-title="${esc(p.title)}">`,
      `<div class="h"><a href="${up}${p.slug}/">${esc(p.title)}</a><span class="c">${fs_.length} rules</span></div>`,
      '<div>');
    for (const f of fs_) {
      b.push(`<label class="crule" data-id="${esc(f.id)}" data-tier="${esc(f.tier)}" data-sev="${esc(f.severity || '')}" data-rule="${esc(f.rule)}">`,
        '<input type="checkbox">',
        '<div>',
        `<div class="t"><a class="rule-link" href="${up}${p.slug}/#${factAnchor(f)}">${inlineHtml(f.rule)}</a></div>`,
        `<div class="m">${sevChip(f)}<span class="chip">${TIER_LABEL[f.tier]}</span><span class="d">${esc(f.verified)}</span></div>`,
        '</div></label>');
    }
    b.push('</div></section>');
  }
  b.push('</div></main>');
  return b.join('\n');
}

function pageHtml(doc, page, registry, depth) {
  const up = depth === 0 ? '' : '../';
  let body;
  if (page.slug === 'index') body = homeBody(doc, up);
  else if (page.slug === 'contract') body = contractBody(doc, page, up);
  else if (page.slug === 'current-state') {
    body = ['<main>', `<h1>${esc(page.title)}</h1>`, `<p class="lede">${inlineHtml(page.summary)}</p>`,
      mdTablesToHtml(renderCurrentStateMd(doc, registry).join('\n')), '</main>'].join('\n');
  } else body = topicBody(doc, page, up);

  const mdHref = page.slug === 'index' ? 'index.md' : `${up}${page.slug}.md`;
  return shell({
    doc,
    title: page.title,
    description: page.summary.split('. ')[0] + '.',
    body,
    mdHref,
    up,
    verified: doc.verified_against.observed_at,
    slug: page.slug,
    canonical: page.slug === 'index' ? `/${SECTION}/` : `/${SECTION}/${page.slug}/`,
  });
}

function badge(f, up) {
  // Links to the legend, which now lives once on the entry page rather than being
  // repeated below every page. A title= tooltip is invisible on touch devices, and
  // the tier is how a reader decides how much weight to give the claim.
  const href = up === undefined ? '#tiers' : `${up}#tiers`;
  return `<a class="chip tier-${f.tier}" href="${href}" title="${esc(TIER_TITLE[f.tier])}">${TIER_LABEL[f.tier]}</a>`;
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

/**
 * Tool pointers. These are the same author's projects and are NOT findings:
 * they carry no tier and no verified date, and are labelled so a reader can see
 * the difference at a glance. Placement is by reader moment, not by category --
 * the two tools answer different questions and are shown where those questions
 * arise, rather than collected into a "links" section nobody reads.
 */
// No positional wording: this note renders after the tools on the entry page and
// before the rules on the contract page, and appears in the markdown twin too.
const TOOLS_NOTE = 'Same author as this site, and not part of the verified material.';

function toolsMd(tools, heading) {
  if (!tools.length) return [];
  const out = [`## ${heading}`, ''];
  for (const t of tools) {
    out.push(`**${t.when} — [${t.name}](${t.url})**`, '', `${t.what} ${t.why}`, '');
  }
  out.push(`*${TOOLS_NOTE}*`, '');
  return out;
}

function toolsHtml(tools, heading) {
  if (!tools.length) return [];
  const out = [`<h2>${esc(heading)}</h2>`];
  for (const t of tools) {
    out.push('<section class="tool">',
      `<h3><span class="when">${esc(t.when)}</span> <a href="${t.url}">${esc(t.name)}</a></h3>`,
      `<p>${inlineHtml(t.what)} ${inlineHtml(t.why)}</p>`,
      '</section>');
  }
  out.push(`<p class="muted tool-note">${esc(TOOLS_NOTE)}</p>`);
  return out;
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

function navHtml(doc, up, slug) {
  // Grouped by nav_group, in page order. Groups come from the data so a new page
  // joins the sidebar without touching this function.
  const order = [];
  const byGroup = new Map();
  for (const p of doc.pages) {
    if (!p.nav_group) continue;
    if (!byGroup.has(p.nav_group)) { byGroup.set(p.nav_group, []); order.push(p.nav_group); }
    byGroup.get(p.nav_group).push(p);
  }
  const link = (p, cls) => {
    const href = p.slug === 'index' ? up : `${up}${p.slug}/`;
    const on = p.slug === slug ? ' aria-current="page"' : '';
    return `<a class="${cls}" href="${href}"${on}>${esc(p.nav_label || p.title)}</a>`;
  };
  const out = ['<nav class="side">', '<div class="navtop">',
    `<a class="nav-1" href="${up}"${slug === 'index' ? ' aria-current="page"' : ''}>Start here</a>`,
    `<a class="nav-1" href="${up}contract/"${slug === 'contract' ? ' aria-current="page"' : ''}>The contract` +
    ` <span class="navcount">${doc.facts.filter(f => f.durability === 'durable').length}</span></a>`,
    '</div>'];
  for (const g of order) {
    out.push(`<div class="navgroup"><div class="navlabel">${esc(g)}</div>`);
    for (const p of byGroup.get(g)) out.push(link(p, 'nav-2'));
    out.push('</div>');
  }
  out.push('</nav>');
  return out.join('\n');
}

function shell({ doc, title, description, body, mdHref, up, verified, slug, canonical, wide }) {
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,300..800;1,400..600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
--bg:oklch(0.99 0 0);--panel:oklch(0.972 0 0);--sunk:oklch(0.955 0 0);
--fg:oklch(0.17 0 0);--fg2:oklch(0.42 0 0);--fg3:oklch(0.6 0 0);
--line:oklch(0.895 0 0);--line2:oklch(0.94 0 0);
--accent:oklch(0.45 0.11 155);--accent-soft:oklch(0.955 0.028 155);
--sev1:oklch(0.5 0.16 25);--sev1b:oklch(0.86 0.06 25);
--sev2:oklch(0.52 0.11 70);--sev2b:oklch(0.87 0.06 70);
--sev3:oklch(0.5 0 0);--sev3b:oklch(0.86 0 0);
--codebg:oklch(0.965 0.004 155);
--bad:oklch(0.5 0.16 25);
--mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
}
html[data-t="dark"]{
--bg:oklch(0.17 0 0);--panel:oklch(0.208 0 0);--sunk:oklch(0.235 0 0);
--fg:oklch(0.955 0 0);--fg2:oklch(0.755 0 0);--fg3:oklch(0.6 0 0);
--line:oklch(0.31 0 0);--line2:oklch(0.255 0 0);
--accent:oklch(0.79 0.14 155);--accent-soft:oklch(0.28 0.045 155);
--sev1:oklch(0.74 0.14 25);--sev1b:oklch(0.38 0.09 25);
--sev2:oklch(0.8 0.11 75);--sev2b:oklch(0.38 0.07 75);
--sev3:oklch(0.68 0 0);--sev3b:oklch(0.34 0 0);
--codebg:oklch(0.215 0 0);--bad:oklch(0.74 0.14 25);
}
/* Dark by system preference until the reader chooses; the toggle then wins by
   stamping data-t on <html>, which is set before first paint to avoid a flash. */
@media (prefers-color-scheme: dark){
html:not([data-t="light"]){
--bg:oklch(0.17 0 0);--panel:oklch(0.208 0 0);--sunk:oklch(0.235 0 0);
--fg:oklch(0.955 0 0);--fg2:oklch(0.755 0 0);--fg3:oklch(0.6 0 0);
--line:oklch(0.31 0 0);--line2:oklch(0.255 0 0);
--accent:oklch(0.79 0.14 155);--accent-soft:oklch(0.28 0.045 155);
--sev1:oklch(0.74 0.14 25);--sev1b:oklch(0.38 0.09 25);
--sev2:oklch(0.8 0.11 75);--sev2b:oklch(0.38 0.07 75);
--sev3:oklch(0.68 0 0);--sev3b:oklch(0.34 0 0);
--codebg:oklch(0.215 0 0);--bad:oklch(0.74 0.14 25);
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:'Public Sans',ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;text-wrap:pretty}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
code{font-family:var(--mono);font-size:.92em}
::selection{background:var(--accent-soft)}
input[type=checkbox]{accent-color:var(--accent)}
.layout{display:flex;align-items:flex-start;min-height:100vh}
/* Sidebar */
aside{position:sticky;top:0;flex:0 0 272px;height:100vh;overflow:auto;padding:26px 20px 28px;border-right:1px solid var(--line);background:var(--panel)}
.brand{display:flex;flex-direction:column;gap:2px;margin-bottom:26px}
.brand .dom{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--fg3)}
.brand .name{font-size:19px;font-weight:700;letter-spacing:-.02em;color:var(--fg)}
nav.side{display:flex;flex-direction:column;gap:22px}
.navtop{display:flex;flex-direction:column;gap:1px}
.navgroup{display:flex;flex-direction:column;gap:6px}
.navlabel{padding:0 12px;font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--fg3)}
.nav-1,.nav-2{position:relative;display:block;border-radius:7px;text-decoration:none}
.nav-1{padding:7px 12px;font-size:14.5px;font-weight:600;color:var(--fg)}
.nav-2{padding:6px 12px;font-size:14px;color:var(--fg2)}
.nav-1:hover,.nav-2:hover{background:var(--sunk);text-decoration:none}
[aria-current="page"]{background:var(--accent-soft)!important;color:var(--fg)}
[aria-current="page"]::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:2px;border-radius:2px;background:var(--accent)}
.navcount{font-family:var(--mono);font-size:10.5px;font-weight:500;color:var(--fg3)}
.sidefoot{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);font-size:12.5px;line-height:1.5;color:var(--fg3)}
.sidefoot a{color:var(--fg2)}
/* Column + header */
.col{flex:1;min-width:0}
header.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 40px;border-bottom:1px solid var(--line);background:var(--bg)}
.stamp{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:12px;color:var(--fg2)}
.dot{display:inline-block;width:7px;height:7px;border-radius:99px;background:var(--accent)}
.dot.aging{background:var(--sev2)}.dot.expired{background:var(--bad)}
.baractions{display:flex;align-items:center;gap:8px}
.baractions a{font-family:var(--mono);font-size:12px;color:var(--fg2)}
.sep{width:1px;height:16px;background:var(--line)}
button.tt{display:flex;align-items:center;gap:7px;padding:5px 11px;border:1px solid var(--line);border-radius:99px;background:transparent;color:var(--fg2);font-family:var(--mono);font-size:11.5px;cursor:pointer}
button.tt:hover{border-color:var(--fg3)}
main{padding:56px 40px 80px;max-width:1000px}
main.wide{max-width:1180px;padding-top:48px}
main.topic{display:grid;grid-template-columns:minmax(0,712px) 208px;gap:56px;max-width:none}
/* Typography */
h1{margin:0 0 18px;font-size:40px;line-height:1.1;font-weight:800;letter-spacing:-.03em}
main.topic h1{font-size:36px;line-height:1.12;letter-spacing:-.028em}
.lede{margin:0 0 14px;font-size:18.5px;line-height:1.55;color:var(--fg2)}
.sub{margin:0;font-size:15px;line-height:1.6;color:var(--fg3)}
.kicker{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--fg3);margin-bottom:14px}
h2.sect{margin:0;font-size:15px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;font-family:var(--mono)}
.secthead{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding-bottom:12px;border-bottom:1px solid var(--fg)}
.secthead .note{font-size:13px;color:var(--fg3)}
section.block{margin-top:52px}
/* Symptom router */
.router a{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:22px;padding:18px 0;border-bottom:1px solid var(--line2);color:var(--fg);text-decoration:none}
.router a:hover{background:var(--panel);text-decoration:none}
.router .sym{font-family:var(--mono);font-size:13.5px;line-height:1.5;font-weight:500}
.router .why{font-size:14px;line-height:1.5;color:var(--fg2)}
.router .fix{font-size:14px;line-height:1.5;color:var(--fg);font-weight:600}
/* Top 5 + legend */
.twocol{margin-top:52px;display:grid;grid-template-columns:1.25fr 1fr;gap:44px}
ol.top5{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:16px}
ol.top5 li{display:grid;grid-template-columns:26px 1fr;gap:12px}
ol.top5 .n{font-family:var(--mono);font-size:12.5px;color:var(--fg3);padding-top:3px}
ol.top5 .r{font-size:16px;line-height:1.4;font-weight:650;color:var(--fg)}
ol.top5 .w{margin-top:3px;font-size:14px;line-height:1.5;color:var(--fg2)}
.legend{padding:22px;border:1px solid var(--line);border-radius:10px;background:var(--panel);align-self:start}
.legend h3{margin:0 0 12px;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--fg3)}
.legend .t{font-size:13.5px;font-weight:650;margin-bottom:5px}
.legend .d{font-size:13px;line-height:1.5;color:var(--fg3)}
.legend hr{border:0;height:1px;background:var(--line);margin:14px 0}
.sevkey{display:flex;flex-direction:column;gap:5px}
.sevkey span{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--fg2)}
.sevkey i{width:6px;height:6px;border-radius:99px;display:inline-block}
/* Page grid */
.pagegrid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line2);border:1px solid var(--line2)}
.pagegrid a{display:block;padding:20px;background:var(--bg);color:var(--fg);text-decoration:none}
.pagegrid a:hover{background:var(--panel);text-decoration:none}
.pagegrid .t{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.pagegrid .ttl{font-size:16.5px;font-weight:650;line-height:1.3}
.pagegrid .c{font-family:var(--mono);font-size:11px;color:var(--fg3);white-space:nowrap}
.pagegrid .b{margin-top:6px;font-size:14px;line-height:1.5;color:var(--fg2)}
/* Facts */
.facts{display:flex;flex-direction:column;gap:40px}
.fact h2{margin:0;flex:1 1 340px;font-size:22px;line-height:1.28;font-weight:700;letter-spacing:-.018em;scroll-margin-top:80px}
.facthead{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.badges{display:flex;gap:6px;align-items:center;padding-top:5px;flex-wrap:wrap}
.fact p{margin:12px 0 0;font-size:16px;line-height:1.62;color:var(--fg2)}
.chip{padding:2px 8px;border:1px solid var(--line);border-radius:4px;font-family:var(--mono);font-size:10px;letter-spacing:.06em;color:var(--fg2);text-decoration:none;white-space:nowrap}
.chip:hover{text-decoration:none;border-color:var(--fg3)}
.sev{display:inline-flex;align-items:center;gap:6px}
.sev i{width:5px;height:5px;border-radius:99px;display:inline-block}
.sev-silent{border-color:var(--sev1b);color:var(--sev1)}.sev-silent i{background:var(--sev1)}
.sev-loud{border-color:var(--sev2b);color:var(--sev2)}.sev-loud i{background:var(--sev2)}
.sev-friction{border-color:var(--sev3b);color:var(--sev3)}.sev-friction i{background:var(--sev3)}
.chip.lane{color:var(--fg3);border-style:dashed}
.caveat{margin-top:14px;padding-left:14px;border-left:2px solid var(--line);font-size:14.5px;line-height:1.55;color:var(--fg3)}
.caveat strong{font-weight:650;color:var(--fg2)}
.notest{margin-top:48px;padding:22px;border:1px dashed var(--line);border-radius:10px}
.notest h2{margin:0 0 10px;font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--fg3)}
.notest li{font-size:15px;line-height:1.6;color:var(--fg2);margin-bottom:6px}
.notest ul{margin:0;padding-left:18px}
/* On this page */
nav.toc{position:sticky;top:88px;align-self:start;display:flex;flex-direction:column;gap:9px}
nav.toc .navlabel{padding:0;margin-bottom:2px}
nav.toc a{font-size:13px;line-height:1.4;color:var(--fg2)}
nav.toc .all{margin-top:6px;padding-top:12px;border-top:1px solid var(--line)}
/* Tools */
.tools{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.tool{padding:22px;border:1px dashed var(--line);border-radius:10px}
.tool .when{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--fg3)}
.tool a.nm{display:block;margin:7px 0 10px;font-family:var(--mono);font-size:17px;font-weight:600;letter-spacing:-.01em}
.tool p{margin:0;font-size:14.5px;line-height:1.6;color:var(--fg2)}
.tool-note{font-size:13px;color:var(--fg3)}
/* Contract */
.ctop{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;flex-wrap:wrap}
.cbtns{display:flex;gap:8px}
.cbtns button{padding:8px 14px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--fg);font-family:var(--mono);font-size:12px;cursor:pointer}
.cbtns button:hover{border-color:var(--fg3)}
.harness{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:18px;padding:12px 16px;border:1px dashed var(--line);border-radius:8px}
.harness .s{font-size:14.5px;line-height:1.5;color:var(--fg2)}
.harness .n{font-size:13px;color:var(--fg3);margin-left:auto}
.filters{position:sticky;top:41px;z-index:4;display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin:26px 0 8px;padding:12px 0;border-top:1px solid var(--fg);border-bottom:1px solid var(--line);background:var(--bg)}
.filters .lbl{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--fg3)}
.filters .set{display:flex;gap:6px}
.filters button{padding:3px 9px;border:1px solid var(--line);border-radius:5px;background:transparent;color:var(--fg3);font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;cursor:pointer}
.filters button[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--fg);color:var(--fg)}
.count{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--fg2)}
.cols{column-count:2;column-gap:48px;margin-top:22px}
.cgroup{break-inside:avoid;margin:0 0 30px}
.cgroup .h{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}
.cgroup .h a{font-size:16px;font-weight:700;line-height:1.3;letter-spacing:-.012em;color:var(--fg)}
.cgroup .h .c{font-family:var(--mono);font-size:11px;color:var(--fg3);white-space:nowrap}
.crule{display:grid;grid-template-columns:18px 1fr;gap:10px;padding:9px 0;border-top:1px solid var(--line2);cursor:pointer}
.crule input{margin:4px 0 0;width:14px;height:14px}
.crule .t{font-size:14.5px;line-height:1.45;font-weight:550;color:var(--fg)}
.crule .m{display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:wrap}
.crule .m .chip{font-size:9.5px;padding:1px 6px;color:var(--fg3)}
.crule .m .d{font-family:var(--mono);font-size:9.5px;color:var(--fg3);margin-left:auto}
.crule.hide{display:none}
/* Tables, code, footer */
table{border-collapse:collapse;width:100%;font-size:14px;margin-top:14px}
td,th{border:1px solid var(--line);padding:7px 10px;text-align:left}
th{background:var(--panel);font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-family:var(--mono);color:var(--fg3);font-weight:600}
footer.site{padding:20px 40px 40px;border-top:1px solid var(--line);font-size:13px;line-height:1.6;color:var(--fg3)}
footer.site a{color:var(--fg2)}
.expired-banner{display:none;margin:0 40px 20px;border:1px solid var(--bad);color:var(--bad);padding:.75rem 1rem;border-radius:6px}
@media (max-width:960px){
aside{display:none}
main,main.wide{padding:32px 20px 64px}
main.topic{display:block;padding:32px 20px 64px}
nav.toc{display:none}
.twocol,.pagegrid,.tools,.cols{display:block;column-count:1}
.twocol>*+*,.tools>*+*{margin-top:20px}
.router a{grid-template-columns:1fr;gap:6px}
header.bar{padding:12px 20px}
h1{font-size:30px}
}
</style>
<script>(function(){try{var t=localStorage.getItem('ccitheme');if(t)document.documentElement.setAttribute('data-t',t);}catch(e){}})();</script>
</head>
<body>
<div class="layout">
<aside>
  <div class="brand">
    <div class="dom">ccinternals.dev</div>
    <div class="name">Cowork for skill authors</div>
  </div>
  ${navHtml(doc, up, slug)}
  <div class="sidefoot">Unofficial. Not affiliated with Anthropic. <a href="https://github.com/yaniv-golan/claude-code-internals/issues">Open an issue</a></div>
</aside>
<div class="col">
<header class="bar">
  <div class="stamp">${freshnessBadge(verified)}</div>
  <div class="baractions">
    <a href="${mdHref}">view as .md</a>
    <span class="sep"></span>
    <button class="tt" type="button" data-theme-toggle aria-label="Toggle colour theme">dark</button>
  </div>
</header>
<div class="expired-banner" data-verified="${esc(verified)}"></div>
${body}
<footer class="site">
Unofficial · not affiliated with Anthropic · behaviour served from Anthropic's side can change with no
version bump and no signal here · <a href="https://github.com/yaniv-golan/claude-code-internals/issues">open an issue</a>
· by <a href="https://github.com/yaniv-golan">Yaniv Golan</a>
· <a href="${up}facts.json">facts.json</a> · <a href="${up}../llms.txt">llms.txt</a>
</footer>
</div>
</div>
${AGE_SCRIPT}
${UI_SCRIPT}
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
