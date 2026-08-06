#!/usr/bin/env node
/**
 * validate-state.js — Integrity checker for the current-state layer.
 *
 * Validates references/state/registry.json and references/state/*.md against
 * topic-index.json: schema conformance, enum membership, unique ids, and
 * that every provenance/sources pointer resolves to a real lesson.
 *
 * Usage:
 *   node validate-state.js                 Validate the skill's references dir
 *   node validate-state.js --refs-dir <d>  Validate an alternate dir (tests)
 *
 * Exit 0 = valid, 1 = errors (printed one per line to stderr).
 * No external dependencies required.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const KINDS = [
  'env-var', 'slash-command', 'gate', 'api-beta',
  'hook-event', 'control-subtype', 'tool', 'ipc-interface',
];
const STATUSES = ['live', 'dark-launched', 'kill-switched', 'disabled', 'removed', 'renamed'];
const ID_PREFIX = {
  'env-var': 'env.', 'slash-command': 'cmd.', 'gate': 'gate.', 'api-beta': 'beta.',
  'hook-event': 'hook.', 'control-subtype': 'proto.', 'tool': 'tool.', 'ipc-interface': 'ipc.',
};
const REQUIRED_ENTRY_FIELDS = ['id', 'kind', 'name', 'status', 'as_of', 'summary', 'provenance'];
const REQUIRED_PAGE_FIELDS = ['domain', 'title', 'as_of_cli', 'sources', 'updated'];

/**
 * Parse a flat YAML-subset frontmatter block. Values that look like JSON
 * arrays (e.g. `sources: [107, 108]`) are parsed as JSON; everything else
 * is a string. Returns null if no frontmatter block found.
 */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    if (val.startsWith('[')) {
      try { val = JSON.parse(val); } catch { /* keep raw string; validator will flag */ }
    }
    fm[key] = val;
  }
  return fm;
}

// ---------------------------------------------------------------------------
// Publication disclosure rules (shared with site/generator/lint-disclosure.js)
//
// Shape-first, NOT a denylist. A denylist enumerates leaks we already know
// about; the leak that matters is an internal name nobody has seen yet, copied
// out of a state page while paraphrasing. So the primary rules match the SHAPE
// of internal identifiers, with denylists only where shape cannot discriminate.
// ---------------------------------------------------------------------------

/**
 * Words that legitimately look like internal identifiers in author-facing prose.
 *
 * THE CRITERION — TWO clauses, both required. An earlier single-clause version
 * ("can a reader observe this?") was incoherent: it admitted the session shell
 * tool while the list still banned the presentation tool from the same tool
 * list, and it could not justify banning permission tools that are equally
 * observable.
 *
 *   1. **Observable** — the reader can see this name in their own session.
 *   2. **Referenceable by a skill** — a skill may legitimately name or test for
 *      it. Permission tools the *agent* self-escalates to, and Desktop plumbing,
 *      fail this clause even though clause 1 passes.
 *
 * Anything failing either clause stays out regardless of how useful it seems.
 *
 * Rule 3 conflated "namespaced" with "internal". Those are different: some
 * namespaced tools are handed to the model and are therefore author-facing,
 * while `internal__*` really is plumbing a skill must never call.
 */
const DISCLOSURE_ALLOWLIST = new Set([
  // Delivery tools an author capability-checks. Anthropic's Cowork-staged
  // skill-creator names these inside a check; the check provides portability,
  // the names make it actionable. Both bare and namespaced spellings, because
  // the namespaced form is what a local-lane reader actually sees.
  'present_files', 'mcp__cowork__present_files',
  'SendUserFile', 'send_user_file', 'sendUserFile',
  // Session tools in the model's tool list. Needed verbatim by the runtime-
  // detection page, whose purpose is Cowork-specific detection: an author who
  // has decided they need it cannot act on a paraphrase.
  'mcp__workspace__bash', 'mcp__workspace__web_fetch',
  // Public skill frontmatter fields. These are documented surface, and a worked
  // example that shows frontmatter must be able to print them.
  'when_to_use', 'allowed_tools', 'disable_model_invocation', 'user_invocable',
]);

/**
 * Never publishable regardless of shape — plumbing a skill must not call, and
 * the permission tools the agent (not the skill) invokes. Checked explicitly so
 * that widening the allowlist above can never accidentally admit these.
 */
const DISCLOSURE_NEVER = [
  // Fails clause 2: plumbing, or a permission tool the AGENT self-escalates to.
  // A skill naming any of these is doing something it should not.
  'device_commit_files',
  'allow_cowork_file_delete',
  'request_cowork_directory',
];

const DISCLOSURE_RULES = [
  {
    id: 'numeric-id',
    // Gate ids and raw epoch-ms. Versions are unaffected: dots break the run.
    re: /\b\d{8,}\b/g,
    why: 'looks like a server-flag id or a raw epoch timestamp',
    severity: 'fail',
  },
  {
    id: 'cli-flag-name',
    re: /\btengu_[a-z0-9_]+/gi,
    why: 'CLI feature-flag name',
    severity: 'fail',
  },
  {
    id: 'internal-tool-name',
    re: /\b(?:internal__[a-z_]+|mcp__[a-z_]+__[a-z_]+)/gi,
    why: 'internal or namespaced tool name',
    severity: 'fail',
  },
  {
    id: 'camelcase-internal',
    // The dominant leak class. >=12 chars and >=3 humps, e.g. the mount-approval
    // and loop-mode field names carried across from a state page.
    re: /\b[a-z]+(?:[A-Z][a-z0-9]+){2,}\b/g,
    why: 'camelCase identifier — describe the behaviour, not the field name',
    severity: 'fail',
    minLength: 12,
  },
  {
    id: 'snake-case-internal',
    re: /\b[a-z]+(?:_[a-z0-9]+){2,}\b/g,
    why: 'snake_case identifier — describe the behaviour, not the symbol',
    severity: 'fail',
  },
  {
    id: 'minified-symbol',
    // Shape cannot tell a minified symbol from prose, so this one stays curated.
    re: /\b(?:Pm|uOt|qX|p5e|h5e|g5e|w5e|IeA|vZe|Nen|wjt|Abt|GY|ece|uCe|Ypm|W1e)\(/g,
    why: 'minified symbol from a shipped bundle',
    severity: 'fail',
  },
  {
    id: 'infra-naming',
    re: /\b(?:growthbook|fcache|statsig)\b/gi,
    why: 'flag-infrastructure naming that only makes sense alongside ids',
    severity: 'fail',
  },
];

const QUOTE_SPAN_WORD_LIMIT = 15;
const QUOTE_PAGE_WORD_BUDGET = 40;

/**
 * Scan author-facing text for content that must not be published.
 * Returns {failures: [...], flags: [...]}; callers decide how to report.
 */
function scanForDisclosure(text, label) {
  const failures = [];
  const flags = [];
  if (typeof text !== 'string' || !text) return { failures, flags };

  for (const never of DISCLOSURE_NEVER) {
    if (text.includes(never)) {
      failures.push(`${label}: "${never}" — plumbing a skill must never call [never-publish]`);
    }
  }

  for (const rule of DISCLOSURE_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const hit = m[0];
      if (DISCLOSURE_ALLOWLIST.has(hit)) continue;
      if (rule.minLength && hit.length < rule.minLength) continue;
      failures.push(`${label}: "${hit}" — ${rule.why} [${rule.id}]`);
    }
  }

  // Quoted-span heuristic: catches verbatim prompt fragments, including the
  // split-into-two-short-spans evasion, via a cumulative budget.
  let quotedWords = 0;
  for (const m of text.matchAll(/[“"]([^”"]{2,})[”"]/g)) {
    const words = m[1].trim().split(/\s+/).length;
    quotedWords += words;
    if (words > QUOTE_SPAN_WORD_LIMIT) {
      flags.push(`${label}: quoted span of ${words} words — verify it is UI text, not prompt body`);
    }
  }
  if (quotedWords > QUOTE_PAGE_WORD_BUDGET) {
    flags.push(`${label}: ${quotedWords} quoted words total — over the per-item budget`);
  }
  return { failures, flags };
}

const AUTHOR_FACT_TIERS = ['measured', 'binary', 'inference'];
const AUTHOR_FACT_DURABILITY = ['durable', 'volatile'];
// Optional. Absent means the fact was not lane-scoped when written -- which the
// 2026-08 audit found is the case for most of them, and is NOT a claim that it
// holds in both. Set it only where a lane was actually established.
/** Every prose string that reaches a reader, with a label for the error message. */
function positionalTargets(doc) {
  const out = [];
  for (const f of doc.facts || []) {
    out.push([`author-facts.${f.id}.rule`, f.rule], [`author-facts.${f.id}.detail`, f.detail]);
    (f.caveats || []).forEach((c, i) => out.push([`author-facts.${f.id}.caveats[${i}]`, c]));
  }
  for (const p of doc.pages || []) {
    out.push([`author-facts.page.${p.slug}.summary`, p.summary], [`author-facts.page.${p.slug}.blurb`, p.blurb]);
    (p.open_questions || []).forEach((q, i) => out.push([`author-facts.page.${p.slug}.open_questions[${i}]`, q]));
  }
  for (const t of doc.tools || []) out.push([`author-facts.tools.${t.slug}.what`, t.what], [`author-facts.tools.${t.slug}.why`, t.why]);
  for (const r of doc.router || []) out.push(['author-facts.router', `${r.symptom} ${r.why} ${r.fix}`]);
  for (const t of doc.top5 || []) out.push(['author-facts.top5', `${t.rule} ${t.why}`]);
  return out.filter(([, v]) => typeof v === 'string');
}

const AUTHOR_FACT_LANES = ['local', 'remote', 'both'];

/**
 * Published prose must not encode its own position on a page. The same string is
 * rendered on a topic page, on the contract page, in the Markdown twin and in
 * facts.json for other consumers -- "the ordering below" is true in at most one
 * of those and was in fact true in none: the box it sat in has always been last
 * on its page. Comparisons ("above 1,024 chars") are allowed; bare positional
 * references are not.
 */
/**
 * A FACT travels: the same string renders on its topic page, on the contract
 * page, in the Markdown twin, and in facts.json, which has no pages at all. So
 * fact-level prose may not point at its container ("this page's open question",
 * "everything else on this page") -- the referent is absent in most renderings,
 * and on the contract page it names the wrong thing, since all 52 rules sit
 * together there.
 *
 * PAGE-level prose (summary, blurb, open questions) renders in exactly one
 * place, so "this page" is correct there and is deliberately allowed. "This
 * site" is allowed everywhere: the site is one referent in every rendering.
 */
/**
 * A retraction belongs in `caveats`, never in `detail`.
 *
 * `detail` is what an author reads to decide what to do; a note about what an
 * EARLIER VERSION OF THIS SITE said is release history, and only reaches someone
 * who read the old version. It is worth publishing at all only when a reader
 * could still act wrongly on the withdrawn advice -- and then it is a
 * qualification, which is what `caveats` is for and where it renders distinctly.
 *
 * Correcting a belief a reader may hold independently ("hooks are disabled in
 * Cowork") is not a retraction: write it as content, aimed at the belief.
 */
const RETRACTION_RE = /\b(an earlier (version|release)|previously said|used to say|we (?:said|claimed)|this (?:page|rule) (?:said|told))\b/i;
function scanRetraction(text) {
  if (typeof text !== 'string') return null;
  const m = RETRACTION_RE.exec(text);
  if (!m) return null;
  const at = Math.max(0, m.index - 40);
  return `retraction "${m[0]}" in detail — put it in caveats, and only if a reader ` +
         `could still act on the withdrawn advice: …${text.slice(at, m.index + 60)}…`;
}

const CONTAINER_RE = /\bth(?:is|e)\s+page\b(?!\s+that\s+explains)/i;
function scanContainer(text) {
  if (typeof text !== 'string') return null;
  const m = CONTAINER_RE.exec(text);
  if (!m) return null;
  const at = Math.max(0, m.index - 40);
  return `container reference "${m[0]}" in fact-level prose — a fact also renders on the contract page, ` +
         `in Markdown and in facts.json, where that referent does not exist: …${text.slice(at, m.index + 55)}…`;
}

const POSITIONAL_RE = /\b(above|below)\b(?!\s+(?:\d|a\s+\d|the\s+\d))/i;
function scanPositional(text) {
  if (typeof text !== 'string') return null;
  const m = POSITIONAL_RE.exec(text);
  if (!m) return null;
  const at = Math.max(0, m.index - 40);
  return `positional reference "${m[1]}" — say what you mean without relying on layout: …${text.slice(at, m.index + 50)}…`;
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate references/state/author-facts.json — the sole source of published
 * prose for the public site. Skipped silently when absent so that reduced test
 * fixtures stay valid; the site build hard-fails on a missing file instead.
 */
function validateAuthorFacts(stateDir, lessonIds, registry) {
  const errors = [];
  const p = path.join(stateDir, 'author-facts.json');
  if (!fs.existsSync(p)) return errors;

  // Domain == filename for state pages (see this directory's README).
  const statePageDomains = new Set(
    fs.readdirSync(stateDir)
      .filter(f => f.endsWith('.md') && f !== 'README.md')
      .map(f => f.replace(/\.md$/, '')));

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return [`author-facts.json unreadable: ${e.message}`];
  }

  if (doc.schema_version !== 1) errors.push('author-facts.json: schema_version must be 1');

  // The coupling that makes "no published claim silently outlives its capture"
  // mechanical rather than aspirational.
  const va = doc.verified_against || {};
  const as = (registry && registry.as_of) || {};
  const fc = as.fcache_capture || {};
  const expect = {
    cli: as.cli,
    desktop_asar: as.desktop_asar,
    fcache_content16: fc.content16,
    observed_at: fc.observed_at,
  };
  for (const [k, want] of Object.entries(expect)) {
    if (want === undefined) continue;
    if (va[k] !== want) {
      errors.push(`author-facts.json: verified_against.${k} "${va[k]}" != registry as_of "${want}" — re-verify the facts or restamp`);
    }
  }

  const pages = Array.isArray(doc.pages) ? doc.pages : [];
  const facts = Array.isArray(doc.facts) ? doc.facts : [];
  if (!pages.length) errors.push('author-facts.json: pages must be a non-empty array');
  if (!facts.length) errors.push('author-facts.json: facts must be a non-empty array');

  const slugs = new Set();
  for (const pg of pages) {
    const label = `author-facts page ${pg.slug || '(unnamed)'}`;
    for (const f of ['slug', 'title', 'summary']) {
      if (!pg[f]) errors.push(`${label}: missing "${f}"`);
    }
    if (pg.slug) {
      if (slugs.has(pg.slug)) errors.push(`${label}: duplicate slug`);
      slugs.add(pg.slug);
      if (!/^[a-z0-9-]+$/.test(pg.slug)) errors.push(`${label}: slug must be lowercase kebab-case`);
    }
    const scan = scanForDisclosure(pg.summary, `${label} summary`);
    errors.push(...scan.failures);
    for (const q of pg.open_questions || []) {
      errors.push(...scanForDisclosure(q, `${label} open_question`).failures);
    }
  }

  const ids = new Set();
  for (const [label, text] of positionalTargets(doc)) {
    const bad = scanPositional(text);
    if (bad) errors.push(`${label}: ${bad}`);
  }
  for (const f of doc.facts || []) {
    for (const [what, text] of [['rule', f.rule], ['detail', f.detail],
                                ...(f.caveats || []).map((c, i) => [`caveats[${i}]`, c])]) {
      const bad = scanContainer(text);
      if (bad) errors.push(`author-facts.${f.id}.${what}: ${bad}`);
      if (what === 'detail') {
        const r = scanRetraction(text);
        if (r) errors.push(`author-facts.${f.id}.${what}: ${r}`);
      }
    }
  }

  // `router` and `top5` are DERIVED: each row paraphrases one rule in different
  // words for a different reading moment. Stored as source, a paraphrase drifts
  // silently when its rule is reworded -- ten rules were reworded in v2.36.2 and
  // nothing would have noticed. Binding each row to a fact id makes the drift a
  // build failure instead.
  // `field_semantics` must actually cover the fields in use, or it becomes a
  // decorative claim about the schema rather than a description of it.
  const fsem = doc.field_semantics;
  if (fsem) {
    const declared = new Set(Object.values(fsem).flatMap(g => g.fields || []));
    const used = new Set((doc.facts || []).flatMap(f => Object.keys(f)));
    for (const k of ['id', 'page']) used.delete(k);   // identity, not a claim
    for (const k of used) {
      if (!declared.has(k)) errors.push(`author-facts.field_semantics: field "${k}" is used but not classified`);
    }
    if (!(fsem.editorial?.fields || []).includes('severity')) {
      errors.push('author-facts.field_semantics: severity must be classified editorial — it is a judgement, not a measurement');
    }
  }

  const factIds = new Map((doc.facts || []).map(f => [f.id, f]));
  for (const [key, rows] of [['router', doc.router], ['top5', doc.top5]]) {
    for (const [i, row] of (Array.isArray(rows) ? rows : []).entries()) {
      const label = `author-facts.${key}[${i}]`;
      if (typeof row.fact !== 'string' || !row.fact) {
        errors.push(`${label}: must name the fact it paraphrases via "fact"`);
        continue;
      }
      const f = factIds.get(row.fact);
      if (!f) { errors.push(`${label}: fact "${row.fact}" does not exist`); continue; }
      if (row.page && f.page !== row.page) {
        errors.push(`${label}: fact "${row.fact}" is on page "${f.page}", not "${row.page}"`);
      }
      if (f.durability !== 'durable') {
        errors.push(`${label}: fact "${row.fact}" is not durable, so it must not be promoted here`);
      }
    }
  }

  // `tools` — pointers to related projects, not findings. Validated for shape so
  // a broken link or a missing blurb cannot reach the site, but deliberately
  // carries no tier or verified date: it is not a claim about product behaviour.
  if (doc.tools !== undefined) {
    if (!Array.isArray(doc.tools)) {
      errors.push('author-facts: tools must be an array');
    } else {
      doc.tools.forEach((t, i) => {
        const label = `author-facts.tools[${i}]`;
        for (const f of ['slug', 'name', 'url', 'when', 'what', 'why']) {
          if (typeof t[f] !== 'string' || !t[f].trim()) errors.push(`${label}: ${f} is required`);
        }
        if (typeof t.url === 'string' && !/^https:\/\//.test(t.url)) {
          errors.push(`${label}: url must be absolute https`);
        }
      });
    }
  }

  for (const ft of facts) {
    const label = `author-facts fact ${ft.id || '(unnamed)'}`;
    // `verified` is deliberately absent: it is optional and means an individual
    // re-check, not the site-wide capture date.
    for (const f of ['id', 'page', 'rule', 'detail', 'tier', 'durability', 'sources']) {
      if (ft[f] === undefined || ft[f] === '') errors.push(`${label}: missing "${f}"`);
    }
    if (ft.id) {
      if (ids.has(ft.id)) errors.push(`${label}: duplicate id`);
      ids.add(ft.id);
    }
    if (ft.page && !slugs.has(ft.page)) errors.push(`${label}: page "${ft.page}" is not a declared page`);
    if (ft.tier && !AUTHOR_FACT_TIERS.includes(ft.tier)) errors.push(`${label}: unknown tier "${ft.tier}"`);
    if (ft.lane !== undefined && !AUTHOR_FACT_LANES.includes(ft.lane)) {
      errors.push(`${label}: unknown lane "${ft.lane}" (expected one of ${AUTHOR_FACT_LANES.join(', ')})`);
    }
    if (ft.durability && !AUTHOR_FACT_DURABILITY.includes(ft.durability)) {
      errors.push(`${label}: unknown durability "${ft.durability}"`);
    }
    if (typeof ft.volatile_dependency !== 'boolean') {
      errors.push(`${label}: volatile_dependency must be boolean`);
    }
    // `verified` is OPTIONAL and means "this fact was individually re-checked on
    // this date". Absent means "as of the site capture". Every fact carried the
    // capture date verbatim until v2.37.3, which made the field indistinguishable
    // from the capture and let a blanket restamp read as re-verification.
    if (ft.verified !== undefined) {
      if (!ISO_DATE.test(ft.verified)) errors.push(`${label}: verified must be YYYY-MM-DD`);
      else if (ft.verified === (registry.as_of?.fcache_capture?.observed_at)) {
        errors.push(`${label}: verified equals the capture date, so it says nothing — ` +
          `omit it unless this fact was re-checked on its own`);
      }
    }
    const src = ft.sources || {};
    for (const l of Array.isArray(src.lessons) ? src.lessons : []) {
      if (!lessonIds.has(l)) errors.push(`${label}: sources.lesson ${l} not in topic-index.json`);
    }
    if (!Array.isArray(src.lessons) || !src.lessons.length) {
      errors.push(`${label}: sources.lessons must be a non-empty array`);
    }
    // A typo here was silently accepted before: the canonical page a fact
    // restates must actually exist, or its provenance points at nothing.
    if (src.state_page !== undefined && !statePageDomains.has(src.state_page)) {
      errors.push(`${label}: sources.state_page "${src.state_page}" is not an existing state page`);
    }
    // Quarantine: volatile facts may exist, but never on a content page.
    if (ft.durability === 'volatile' && ft.page !== 'current-state') {
      errors.push(`${label}: volatile facts may only appear on the current-state page`);
    }
    for (const field of ['rule', 'detail']) {
      errors.push(...scanForDisclosure(ft[field], `${label} ${field}`).failures);
    }
    for (const c of ft.caveats || []) {
      errors.push(...scanForDisclosure(c, `${label} caveat`).failures);
    }
  }

  // Every content page must carry at least one fact, or it renders empty.
  for (const slug of slugs) {
    if (slug === 'index' || slug === 'contract' || slug === 'current-state') continue;
    if (!facts.some(f => f.page === slug)) errors.push(`author-facts.json: page "${slug}" has no facts`);
  }
  return errors;
}

const GATE_NAMESPACES = ['desktop_fcache', 'cli_growthbook'];
const GATE_SOURCES = ['force', 'defaultValue', 'experiment', 'override', null];
// Prose that ossifies a timestamped observation into a property. fcache membership
// churns between reads, so "absent" is only ever true *of a snapshot*. Record it in
// the structured `observed` field (present/source/on/at) instead.
const BANNED_GATE_PROSE = /\babsent from (?:the )?fcache\b|\bnot in the fcache\b|\bunevaluated\b/i;

/**
 * Gate entries carry two namespaces that are NOT interchangeable: Desktop numeric
 * GrowthBook ids (checkable against the fcache) and CLI GrowthBook flags (which are
 * not fcache keys at all, so an fcache lookup on them is a category error).
 */
function validateGate(entry, label, fc) {
  const errors = [];
  const ns = entry.namespace;
  if (!ns) {
    errors.push(`${label}: gate entries require "namespace" (${GATE_NAMESPACES.join('|')})`);
  } else if (!GATE_NAMESPACES.includes(ns)) {
    errors.push(`${label}: unknown gate namespace "${ns}"`);
  }
  const numericId = /^gate\.\d+$/.test(entry.id || '');
  if (ns === 'desktop_fcache' && !numericId) {
    errors.push(`${label}: namespace desktop_fcache requires a numeric gate id`);
  }
  if (ns === 'cli_growthbook' && numericId) {
    errors.push(`${label}: numeric gate ids are Desktop fcache keys, not CLI flags`);
  }

  if (ns === 'desktop_fcache') {
    const o = entry.observed;
    if (!o || typeof o !== 'object') {
      errors.push(`${label}: desktop_fcache gates require "observed" {present, source, on, at}`);
    } else {
      if (typeof o.present !== 'boolean') errors.push(`${label}: observed.present must be boolean`);
      if (!GATE_SOURCES.includes(o.source === undefined ? null : o.source)) {
        errors.push(`${label}: observed.source "${o.source}" not one of ${GATE_SOURCES.filter(Boolean).join('|')}|null`);
      }
      if (o.present === false && (o.source !== null || o.on !== null)) {
        errors.push(`${label}: observed.present=false requires source=null and on=null`);
      }
      if (o.present === true && typeof o.on !== 'boolean') {
        errors.push(`${label}: observed.present=true requires boolean observed.on`);
      }
      // An observation is meaningless without the snapshot it was made against.
      if (!o.at) errors.push(`${label}: observed.at missing (must name an fcache content16)`);
      else if (fc && fc.content16 && o.at !== fc.content16) {
        errors.push(`${label}: observed.at "${o.at}" does not match as_of.fcache_capture.content16 "${fc.content16}" — re-observe or restamp`);
      }
      // Value gates (those served an object) carry a second, independent axis: a key
      // inside the value may be absent while the gate itself is present and on. The
      // code then applies its own per-call default, which is SOMETIMES TRUE (measured:
      // 1978029737 serves 8 of 21 requested keys; bashHostOnlyIntercept and
      // scheduledTaskStaleReapEnabled both default true while unserved). So a served-key
      // list is never an enabled-behaviour inventory, and "key absent => off" is invalid.
      if (o.served_keys !== undefined) {
        if (!Array.isArray(o.served_keys) || o.served_keys.some(k => typeof k !== 'string')) {
          errors.push(`${label}: observed.served_keys must be an array of strings`);
        } else if (o.present !== true) {
          errors.push(`${label}: observed.served_keys requires observed.present=true`);
        } else {
          const sorted = [...o.served_keys].sort();
          if (o.served_keys.some((k, i) => k !== sorted[i])) {
            errors.push(`${label}: observed.served_keys must be sorted (stable diffs)`);
          }
        }
      }
    }
  } else if (entry.observed !== undefined) {
    errors.push(`${label}: cli_growthbook gates are not fcache keys and must not carry "observed"`);
  }

  if (typeof entry.summary === 'string' && BANNED_GATE_PROSE.test(entry.summary)) {
    errors.push(`${label}: summary asserts fcache absence in prose — record it in "observed" instead (membership churns between reads)`);
  }
  return errors;
}

/** Validate the state layer under refsDir. Returns an array of error strings. */
function validate(refsDir) {
  const errors = [];
  const stateDir = path.join(refsDir, 'state');
  const topicIndexPath = path.join(refsDir, 'topic-index.json');

  let lessonIds;
  try {
    lessonIds = new Set(JSON.parse(fs.readFileSync(topicIndexPath, 'utf8')).lessons.map(l => l.id));
  } catch (e) {
    return [`topic-index.json unreadable: ${e.message}`];
  }

  // --- registry.json ---
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(path.join(stateDir, 'registry.json'), 'utf8'));
  } catch (e) {
    errors.push(`registry.json unreadable: ${e.message}`);
    registry = null;
  }

  if (registry) {
    if (registry.schema_version !== 1) errors.push('registry.json: schema_version must be 1');
    if (!registry.as_of || typeof registry.as_of.cli !== 'string') {
      errors.push('registry.json: as_of.cli missing');
    }
    // fcache_capture must identify a *snapshot*, not merely a date. The payload is
    // refetched irregularly (measured 3.7-20.8 min apart) and its membership can change
    // count-neutrally, so a date cannot distinguish two different payloads. content16 is
    // sha256 over the canonicalised features object; the embedded timestamp is fetch
    // metadata only and must never be used as identity.
    const fc = registry.as_of && registry.as_of.fcache_capture;
    if (fc === undefined) {
      errors.push('registry.json: as_of.fcache_capture missing');
    } else if (typeof fc !== 'object' || fc === null || Array.isArray(fc)) {
      errors.push('registry.json: as_of.fcache_capture must be an object {content16, embedded_timestamp, feature_count} — a bare date cannot identify a snapshot');
    } else {
      if (!/^[0-9a-f]{16}$/.test(fc.content16 || '')) {
        errors.push('registry.json: as_of.fcache_capture.content16 must be 16 lowercase hex chars');
      }
      if (typeof fc.embedded_timestamp !== 'number') {
        errors.push('registry.json: as_of.fcache_capture.embedded_timestamp must be a number');
      }
      if (typeof fc.feature_count !== 'number') {
        errors.push('registry.json: as_of.fcache_capture.feature_count must be a number');
      }
    }
    // The cloud container runs its own agent build, independent of cli/desktop_asar — remote-lane
    // claims are governed by THAT axis. We do not hold the artifact; these are version strings
    // observed in session API traffic, so it is an observation range, not a pin. Optional (older
    // captures predate the axis), but typed when present so it cannot rot into free text.
    const cc = registry.as_of && registry.as_of.container_cc_version_observed;
    if (cc !== undefined) {
      if (typeof cc !== 'object' || cc === null || Array.isArray(cc)) {
        errors.push('registry.json: as_of.container_cc_version_observed must be an object {newest, range, note}');
      } else {
        if (typeof cc.newest !== 'string') {
          errors.push('registry.json: as_of.container_cc_version_observed.newest must be a version string');
        }
        if (!Array.isArray(cc.range) || cc.range.some(v => typeof v !== 'string')) {
          errors.push('registry.json: as_of.container_cc_version_observed.range must be an array of version strings');
        } else if (cc.newest && !cc.range.includes(cc.newest)) {
          errors.push(`registry.json: as_of.container_cc_version_observed.newest "${cc.newest}" is not present in range`);
        }
      }
    }
    if (registry.entries !== undefined && !Array.isArray(registry.entries)) {
      errors.push('registry.json: entries must be an array');
    }
    const seen = new Set();
    for (const entry of Array.isArray(registry.entries) ? registry.entries : []) {
      const label = entry.id || JSON.stringify(entry).slice(0, 60);
      for (const f of REQUIRED_ENTRY_FIELDS) {
        if (entry[f] === undefined || entry[f] === '') errors.push(`${label}: missing field "${f}"`);
      }
      if (entry.kind && !KINDS.includes(entry.kind)) errors.push(`${label}: unknown kind "${entry.kind}"`);
      if (entry.status && !STATUSES.includes(entry.status)) errors.push(`${label}: unknown status "${entry.status}"`);
      if (entry.id && entry.kind && ID_PREFIX[entry.kind] && !entry.id.startsWith(ID_PREFIX[entry.kind])) {
        errors.push(`${label}: id must start with "${ID_PREFIX[entry.kind]}" for kind ${entry.kind}`);
      }
      if (entry.status === 'renamed' && !entry.renamed_to) {
        errors.push(`${label}: status "renamed" requires renamed_to`);
      }
      if (entry.id) {
        if (seen.has(entry.id)) errors.push(`${label}: duplicate id`);
        seen.add(entry.id);
      }
      for (const p of Array.isArray(entry.provenance) ? entry.provenance : []) {
        if (!lessonIds.has(p.lesson)) errors.push(`${label}: provenance lesson ${p.lesson} not in topic-index.json`);
      }
      if (entry.kind === 'gate') errors.push(...validateGate(entry, label, fc));
    }
  }

  // --- lesson bounds ---
  // CLAUDE.md documents that inserting lines invalidates topic-index bounds and
  // that NOTHING validates them, so fetch-lesson.js silently returns the wrong
  // slice. That warning held: 20 lessons were pointing at the wrong line, one
  // set of them off by 123. startLine is unambiguous — it must land on the
  // lesson's own heading — so check it mechanically rather than by discipline.
  try {
    const ti = JSON.parse(fs.readFileSync(topicIndexPath, 'utf8'));
    const HDR = /^#{1,2} LESSON\s+\d+/i;
    for (const l of ti.lessons || []) {
      const lf = path.join(refsDir, l.file);
      // Absent lesson file => reduced test fixture, not drift. Same precedent as
      // author-facts.json: skip silently rather than fail a fixture for the
      // right reason at the wrong time. (Third validator rule to trip this.)
      if (!fs.existsSync(lf)) continue;
      const line = fs.readFileSync(lf, 'utf8').split('\n')[l.startLine - 1];
      if (line === undefined || !HDR.test(line)) {
        errors.push(`topic-index: L${l.id} startLine ${l.startLine} in ${l.file} is not a LESSON heading — bounds have drifted; re-derive them`);
      }
    }
  } catch (e) {
    errors.push(`topic-index bounds check failed: ${e.message}`);
  }

  // --- author-facts.json (published-site source) ---
  if (registry) errors.push(...validateAuthorFacts(stateDir, lessonIds, registry));

  // --- state pages ---
  let pageFiles = [];
  try {
    pageFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.md') && f !== 'README.md');
  } catch (e) {
    errors.push(`state dir unreadable: ${e.message}`);
  }
  const domains = new Set();
  for (const file of pageFiles) {
    const text = fs.readFileSync(path.join(stateDir, file), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) { errors.push(`${file}: missing frontmatter block`); continue; }
    for (const f of REQUIRED_PAGE_FIELDS) {
      if (fm[f] === undefined || fm[f] === '') errors.push(`${file}: missing frontmatter field "${f}"`);
    }
    if (fm.domain && fm.domain !== path.basename(file, '.md')) {
      errors.push(`${file}: domain "${fm.domain}" does not match filename`);
    }
    if (fm.domain) {
      if (domains.has(fm.domain)) errors.push(`${file}: duplicate domain "${fm.domain}"`);
      domains.add(fm.domain);
    }
    if (fm.updated && !/^\d{4}-\d{2}-\d{2}$/.test(String(fm.updated))) {
      errors.push(`${file}: updated must be YYYY-MM-DD`);
    }
    const sources = Array.isArray(fm.sources) ? fm.sources : [];
    if (fm.sources !== undefined && !Array.isArray(fm.sources)) {
      errors.push(`${file}: sources must be a JSON array like [107, 108]`);
    }
    if (Array.isArray(fm.sources) && fm.sources.length === 0) {
      errors.push(`${file}: sources must be non-empty`);
    }
    for (const s of sources) {
      if (!lessonIds.has(s)) errors.push(`${file}: source lesson ${s} not in topic-index.json`);
    }
  }

  return errors;
}

module.exports = {
  validate, parseFrontmatter, KINDS, STATUSES,
  // shared with site/generator/lint-disclosure.js so PR-time and build-time
  // enforcement can never drift apart
  scanForDisclosure, DISCLOSURE_RULES, DISCLOSURE_ALLOWLIST, DISCLOSURE_NEVER,
  validateAuthorFacts,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  let refsDir = path.join(__dirname, '..', 'references');
  const i = argv.indexOf('--refs-dir');
  if (i !== -1 && argv[i + 1]) refsDir = path.resolve(argv[i + 1]);
  const errors = validate(refsDir);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    console.error(`\n${errors.length} error(s).`);
    process.exit(1);
  }
  console.log('state layer OK');
}
