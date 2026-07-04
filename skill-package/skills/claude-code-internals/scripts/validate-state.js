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
