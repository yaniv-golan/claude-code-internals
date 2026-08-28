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

/**
 * Compare dotted numeric version strings. Returns <0, 0, >0.
 * Non-numeric or malformed segments sort as -1 so a typo reads as BEHIND
 * (which fails the gate) rather than AHEAD (which would not).
 */
function cmpVersion(a, b) {
  const seg = (v) => String(v || '').split('.').map(n => (/^\d+$/.test(n) ? Number(n) : -1));
  const x = seg(a), y = seg(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Split records by how their as_of relates to registry.as_of.cli.
 *
 * BEHIND is the failure: the record has not been reconciled to the current
 * baseline and may be stale. AHEAD is not — it means a targeted subsystem pass
 * verified that record against a NEWER artifact than the baseline, which is a
 * real and common thing to do here and must not be flattened into a false
 * baseline stamp just to keep the gate quiet. Before this split, any as_of that
 * merely differed was printed as "behind baseline", so the only way to keep the
 * gate green was to restamp a newer verification as older than it was.
 */
function audit(refsDir) {
  const { registry, pages } = loadState(refsDir);
  const baseline = registry.as_of.cli;
  const stale = [], ahead = [];
  const place = (rec, v) => {
    const c = cmpVersion(v, baseline);
    if (c < 0) stale.push(rec);
    else if (c > 0) ahead.push(rec);
  };
  for (const e of registry.entries || []) place({ id: e.id, as_of: e.as_of }, e.as_of);
  for (const p of pages) place({ file: p.file, as_of: p.as_of_cli }, p.as_of_cli);
  return { baseline, stale, ahead };
}

module.exports = { lookup, audit, cmpVersion };

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
    for (const s of r.ahead) console.log(`  ahead of baseline (verified against a newer artifact): ${s.id || s.file}  (as_of ${s.as_of})`);
    if (!r.stale.length) {
      const note = r.ahead.length ? ` (${r.ahead.length} verified ahead)` : '';
      console.log(`everything reconciled to baseline${note}`);
      process.exit(0);
    }
    console.log(`${r.stale.length} record(s) behind baseline:`);
    for (const s of r.stale) console.log(`  ${s.id || s.file}  (as_of ${s.as_of || 'MISSING'})`);
    process.exit(1);
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
