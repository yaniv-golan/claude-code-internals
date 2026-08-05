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

module.exports = { validate, parseFrontmatter, KINDS, STATUSES };

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
