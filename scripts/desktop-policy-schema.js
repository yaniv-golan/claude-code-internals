#!/usr/bin/env node
'use strict';

/**
 * desktop-policy-schema.js — diff Claude Desktop's managed-policy schema between two builds.
 *
 *   node scripts/desktop-policy-schema.js <old> <new>     <old>/<new>: an app.asar, or an
 *                                                          extracted asar root (holding .vite/build)
 *   node scripts/desktop-policy-schema.js <build>         list that build's keys and their marks
 *
 * WHY. A string diff of two asars did not report developerModeEnabled (new in 2.37337.1) or the
 * six dropped legacyFlatKey aliases; the release notes did. Every managed key is one schema
 * entry in .vite/build/index.pre.js with a flatKey, so diffing those entries is exhaustive for
 * config keys where a string diff is not.
 *
 * READING THE MARKS (L236). availableInVersion "@next" means "added in this build"; a later
 * build stamps the introducing version. A key that stays "@next" for several builds is held
 * back. public-undocumented predicts that the release notes never name the key. Test "released"
 * against the notes (scripts/desktop-changelog-scan.js --find <key>), not the stamp alone.
 *
 * Exit codes: 0 done, 2 usage or read error.
 */

const fs = require('fs');
const path = require('path');

const PRE = '.vite/build/index.pre.js';
/** How far past a flatKey an entry's options can reach before the next entry. */
const SPAN = 6000;

/** The bytes of one file inside an asar archive. */
function readAsarFile(asar, rel) {
  const fd = fs.openSync(asar, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonLen = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonLen);
    fs.readSync(fd, json, 0, jsonLen, 16);
    let node = JSON.parse(json.toString('utf8'));
    for (const part of rel.split('/')) {
      if (!node.files || !node.files[part]) throw new Error(`${rel} not in ${asar}`);
      node = node.files[part];
    }
    const buf = Buffer.alloc(node.size);
    fs.readSync(fd, buf, 0, node.size, 8 + headerSize + Number(node.offset));
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function loadPre(p) {
  const st = fs.statSync(p);
  return st.isDirectory() ? fs.readFileSync(path.join(p, PRE), 'utf8') : readAsarFile(p, PRE);
}

/** Schema entries by flatKey: {avail, scopes, undocumented, hidden, deprecated, legacy}. */
function extract(src) {
  const out = {};
  const starts = [...src.matchAll(/flatKey:"([^"]+)"/g)];
  starts.forEach((m, i) => {
    const end = Math.min(i + 1 < starts.length ? starts[i + 1].index : src.length, m.index + SPAN);
    const seg = src.slice(m.index, end);
    const avail = (seg.match(/availableInVersion:"([^"]+)"/) || [])[1] || null;
    const rec = {
      avail,
      scopes: (seg.match(/scopes:\[([^\]]*)\]/) || [])[1] || null,
      undocumented: seg.includes('public-undocumented'),
      hidden: /show:\(\)=>!1/.test(seg),
      deprecated: /deprecat/i.test(seg),
    };
    if (!out[m[1]]) out[m[1]] = rec; // the first entry wins; later ones are references
  });
  const legacy = [...src.matchAll(/legacyFlatKey:\{name:"([^"]+)"/g)].map((x) => x[1]);
  return { keys: out, legacy: [...new Set(legacy)].sort() };
}

function marks(r) {
  return [r.avail === '@next' ? '@next' : r.avail, r.undocumented && 'undocumented', r.hidden && 'hidden', r.deprecated && 'deprecated']
    .filter(Boolean).join(', ');
}

function diff(a, b) {
  const lines = [];
  const ak = Object.keys(a.keys), bk = Object.keys(b.keys);
  for (const k of bk.filter((k) => !a.keys[k]).sort()) lines.push(`+ ${k} (${marks(b.keys[k])})`);
  for (const k of ak.filter((k) => !b.keys[k]).sort()) lines.push(`- ${k} (${marks(a.keys[k])})`);
  for (const k of ak.filter((k) => b.keys[k]).sort()) {
    const was = marks(a.keys[k]), now = marks(b.keys[k]);
    if (was !== now || a.keys[k].scopes !== b.keys[k].scopes) lines.push(`~ ${k}: ${was} [${a.keys[k].scopes}] -> ${now} [${b.keys[k].scopes}]`);
  }
  for (const n of a.legacy.filter((n) => !b.legacy.includes(n))) lines.push(`- legacy name ${n}`);
  for (const n of b.legacy.filter((n) => !a.legacy.includes(n))) lines.push(`+ legacy name ${n}`);
  return lines;
}

function main(argv) {
  if (argv.length < 1 || argv.length > 2) {
    console.error('usage: desktop-policy-schema.js <old app.asar|dir> <new app.asar|dir>   (or one build to list)');
    return 2;
  }
  let s;
  try { s = argv.map((p) => extract(loadPre(p))); } catch (e) { console.error(e.message); return 2; }
  if (s.some((x) => !Object.keys(x.keys).length)) { console.error('no flatKey entries found; the schema format changed'); return 2; }
  if (s.length === 1) {
    for (const [k, r] of Object.entries(s[0].keys).sort()) console.log(`${k} (${marks(r)})`);
    console.log(`${Object.keys(s[0].keys).length} keys; legacy names: ${s[0].legacy.join(', ') || 'none'}`);
    return 0;
  }
  const lines = diff(s[0], s[1]);
  lines.forEach((l) => console.log(l));
  const held = Object.entries(s[1].keys).filter(([, r]) => r.avail === '@next').map(([k]) => k).sort();
  console.log(`\n${Object.keys(s[0].keys).length} -> ${Object.keys(s[1].keys).length} keys, ${lines.length} change(s).`);
  console.log(`@next in the new build (added in it, or held back if also @next before): ${held.join(', ') || 'none'}`);
  console.log('Check each against the notes: node scripts/desktop-changelog-scan.js --find <key>');
  return 0;
}

module.exports = { readAsarFile, extract, diff, marks, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
