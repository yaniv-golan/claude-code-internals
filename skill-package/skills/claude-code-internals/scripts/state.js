#!/usr/bin/env node
/**
 * state.js — Query the current-state layer.
 *
 * Usage:
 *   node state.js <query>       Find registry entries + state pages matching
 *                               <query> (case-insensitive substring on
 *                               name/id/domain/title)
 *   node state.js --audit       List records whose as_of lags the registry
 *                               baseline (reconciliation view after a new
 *                               binary version)
 *   node state.js ... --json    Machine-readable output
 *
 * The LLM should try this BEFORE lesson search when the question is about
 * current behavior; use search.js/fetch-lesson.js for history & provenance.
 * No external dependencies required.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./validate-state.js');

const DEFAULT_REFS = path.join(__dirname, '..', 'references');

function loadState(refsDir) {
  const stateDir = path.join(refsDir, 'state');
  const registry = JSON.parse(fs.readFileSync(path.join(stateDir, 'registry.json'), 'utf8'));
  if (!registry || typeof registry !== 'object' || !registry.as_of || typeof registry.as_of.cli !== 'string') {
    throw new Error('registry.json malformed (as_of.cli missing) — run validate-state.js');
  }
  if (registry.entries !== undefined && !Array.isArray(registry.entries)) {
    throw new Error('registry.json malformed (entries is not an array) — run validate-state.js');
  }
  const pages = fs.readdirSync(stateDir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => {
      const fm = parseFrontmatter(fs.readFileSync(path.join(stateDir, f), 'utf8')) || {};
      return { file: f, path: path.join(stateDir, f), domain: fm.domain || '', title: fm.title || '',
               as_of_cli: fm.as_of_cli || '', sources: fm.sources || [] };
    });
  return { registry, pages };
}

/** Substring lookup across registry entries and state pages. */
function lookup(refsDir, query) {
  const q = String(query).toLowerCase();
  const { registry, pages } = loadState(refsDir);
  return {
    entries: (registry.entries || []).filter(e =>
      e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) ||
      (e.renamed_to || '').toLowerCase().includes(q)),
    pages: pages.filter(p =>
      p.domain.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)),
  };
}

/** Everything whose as_of lags registry.as_of.cli. */
function audit(refsDir) {
  const { registry, pages } = loadState(refsDir);
  const baseline = registry.as_of.cli;
  const stale = [];
  for (const e of registry.entries || []) {
    if (e.as_of !== baseline) stale.push({ id: e.id, as_of: e.as_of });
  }
  for (const p of pages) {
    if (p.as_of_cli !== baseline) stale.push({ file: p.file, as_of: p.as_of_cli });
  }
  return { baseline, stale };
}

module.exports = { lookup, audit };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const args = argv.filter(a => a !== '--json');
  const refsDir = DEFAULT_REFS;

  if (args[0] === '--audit') {
    let r;
    try { r = audit(refsDir); } catch (e) { console.error(`state layer unreadable: ${e.message}`); process.exit(1); }
    if (json) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
    console.log(`baseline: CLI ${r.baseline}`);
    if (!r.stale.length) { console.log('everything reconciled to baseline'); process.exit(0); }
    console.log(`${r.stale.length} record(s) behind baseline:`);
    for (const s of r.stale) console.log(`  ${s.id || s.file}  (as_of ${s.as_of || 'MISSING'})`);
    process.exit(0);
  }

  if (!args[0]) {
    console.error('usage: node state.js <query> | --audit  [--json]');
    process.exit(2);
  }

  let r;
  try { r = lookup(refsDir, args[0]); } catch (e) { console.error(`state layer unreadable: ${e.message}`); process.exit(1); }
  if (json) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  if (!r.entries.length && !r.pages.length) { console.log('no matches'); process.exit(0); }
  for (const e of r.entries) {
    const extra = e.status === 'renamed' ? ` -> ${e.renamed_to}` : '';
    console.log(`[${e.kind}] ${e.name} — ${e.status}${extra} (as of ${e.as_of})`);
    console.log(`    ${e.summary}`);
    console.log(`    provenance: ${e.provenance.map(p => 'L' + p.lesson).join(', ')}`);
  }
  for (const p of r.pages) {
    console.log(`[page] ${p.domain} — ${p.title} (as of CLI ${p.as_of_cli})`);
    console.log(`    ${p.path}`);
  }
}
