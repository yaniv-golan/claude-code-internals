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
 * THE CRITERION, so this list stays principled rather than growing by drift:
 * **can a reader observe this name in their own session?** A tool the model is
 * given appears in that session's tool list — publishing it discloses nothing,
 * it only saves the reader from having to go look. A name they cannot observe
 * (Desktop plumbing, feature-flag ids, minified symbols, config field names)
 * stays out regardless of how useful it might seem.
 *
 * Rule 3 conflated "namespaced" with "internal". Those are different: some
 * namespaced tools are handed to the model and are therefore author-facing,
 * while `internal__*` really is plumbing a skill must never call.
 */
const DISCLOSURE_ALLOWLIST = new Set([
  // Delivery tools an author capability-checks. Anthropic's own bundled
  // skill-authoring guidance names these inside a check, and the check is what
  // provides portability — the names are what make it actionable.
  'present_files', 'send_user_file', 'sendUserFile',
  // Session tools that appear in the model's tool list. Needed verbatim by the
  // runtime-detection page, whose whole purpose is Cowork-specific detection:
  // an author who has decided they need to branch on runtime cannot act on a
  // paraphrase of the thing they must test for.
  'mcp__workspace__bash', 'mcp__workspace__web_fetch',
  // ordinary hyphen/underscore prose that may appear in examples
  'skill_md', 'claude_md',
]);

/**
 * Never publishable regardless of shape — plumbing a skill must not call, and
 * the permission tools the agent (not the skill) invokes. Checked explicitly so
 * that widening the allowlist above can never accidentally admit these.
 */
const DISCLOSURE_NEVER = [
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
  for (const ft of facts) {
    const label = `author-facts fact ${ft.id || '(unnamed)'}`;
    for (const f of ['id', 'page', 'rule', 'detail', 'tier', 'durability', 'sources', 'verified']) {
      if (ft[f] === undefined || ft[f] === '') errors.push(`${label}: missing "${f}"`);
    }
    if (ft.id) {
      if (ids.has(ft.id)) errors.push(`${label}: duplicate id`);
      ids.add(ft.id);
    }
    if (ft.page && !slugs.has(ft.page)) errors.push(`${label}: page "${ft.page}" is not a declared page`);
    if (ft.tier && !AUTHOR_FACT_TIERS.includes(ft.tier)) errors.push(`${label}: unknown tier "${ft.tier}"`);
    if (ft.durability && !AUTHOR_FACT_DURABILITY.includes(ft.durability)) {
      errors.push(`${label}: unknown durability "${ft.durability}"`);
    }
    if (typeof ft.volatile_dependency !== 'boolean') {
      errors.push(`${label}: volatile_dependency must be boolean`);
    }
    if (ft.verified && !ISO_DATE.test(ft.verified)) errors.push(`${label}: verified must be YYYY-MM-DD`);
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
