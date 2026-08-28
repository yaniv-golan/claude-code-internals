#!/usr/bin/env node
/**
 * check-json-format.js — pins the on-disk serialization of every index JSON.
 *
 * WHY THIS EXISTS. These files are edited by scripts far more often than by
 * hand, and they do not all share a format: two are indent=1, three are
 * indent=2 with a trailing newline, and the generated semantic index is
 * indent=2 with NO trailing newline. Rewriting one at the wrong indent — or
 * letting a tool re-sort a map whose order is deliberate — produces a diff of
 * five figures in which the actual change is invisible. That has happened
 * repeatedly, including twice in a single release, and a comment in CLAUDE.md
 * did not prevent it: a convention you have to remember is not a check.
 *
 * WHAT IT CATCHES. The comparison is byte-exact against a re-serialization of
 * the parsed content, so it catches an indent change, a trailing-newline
 * change, non-ASCII escaping, AND key reordering (JSON.stringify preserves
 * insertion order, so a re-sorted map no longer round-trips). It does NOT
 * validate meaning — validate-state.js does that.
 *
 * A JSON file under references/ that is not pinned here is an error, so a new
 * index cannot quietly arrive with an unpinned format.
 *
 * THE TRAP THAT MADE THIS NON-TRIVIAL, and the more dangerous of the two:
 * JavaScript objects do not preserve the order of integer-like keys. A key such
 * as "129", "31999" or "2307090146" is an array index as far as the engine is
 * concerned, so JSON.parse + JSON.stringify silently hoists every numeric key
 * to the front in ascending order. cross-references.json is keyed by lesson id
 * and topic-index.json's keyword_map contains gate ids and version numbers, so
 * BOTH are affected: any Node script that reads and rewrites them reorders
 * thousands of lines while changing nothing. Python's dicts preserve insertion
 * order and do not. That is why this checker ships its own order-preserving
 * parser instead of comparing against JSON.stringify: a checker built on the
 * round-trip it is meant to police would have to declare these two files
 * permanently broken, or accept the reordering it exists to catch.
 *
 * Practical rule: rewrite these files with a tool that preserves key order.
 *
 *   node scripts/check-json-format.js          exit 0 = all canonical
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REFS = path.join(__dirname, '..', 'references');

/** file (relative to references/) -> { indent, trailingNewline } */
const PINNED = {
  'cross-references.json':     { indent: 1, trailingNewline: true },
  'troubleshooting.json':      { indent: 1, trailingNewline: true },
  'topic-index.json':          { indent: 2, trailingNewline: true },
  'semantic-index.json':       { indent: 2, trailingNewline: false }, // written by build-rvf-index.js
  'state/registry.json':       { indent: 2, trailingNewline: true },
  'state/author-facts.json':   { indent: 2, trailingNewline: true },
};

function listJson(dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listJson(path.join(dir, ent.name), rel));
    else if (ent.name.endsWith('.json')) out.push(rel);
  }
  return out;
}

/**
 * Minimal order-preserving JSON reader. Returns a tree in which objects keep
 * their SOURCE key order, and primitives keep their SOURCE text — so numbers
 * and strings are never reformatted by this tool's own idea of them.
 * These files are machine-generated valid JSON; this is not a hardened parser.
 */
function parseOrdered(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const lit = (start) => src.slice(start, i);

  function value() {
    ws();
    const c = src[i];
    if (c === '{') {
      i++; const entries = []; ws();
      if (src[i] === '}') { i++; return { t: 'obj', entries }; }
      for (;;) {
        ws();
        const kStart = i; string(); const key = lit(kStart);
        ws(); if (src[i] !== ':') throw new Error(`expected ':' at ${i}`); i++;
        entries.push([key, value()]);
        ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === '}') { i++; return { t: 'obj', entries }; }
        throw new Error(`expected ',' or '}' at ${i}`);
      }
    }
    if (c === '[') {
      i++; const items = []; ws();
      if (src[i] === ']') { i++; return { t: 'arr', items }; }
      for (;;) {
        items.push(value()); ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ']') { i++; return { t: 'arr', items }; }
        throw new Error(`expected ',' or ']' at ${i}`);
      }
    }
    const start = i;
    if (c === '"') { string(); return { t: 'raw', text: lit(start) }; }
    while (i < src.length && !/[\s,\]}]/.test(src[i])) i++;
    if (i === start) throw new Error(`unexpected ${JSON.stringify(c)} at ${i}`);
    return { t: 'raw', text: lit(start) };
  }

  function string() {
    if (src[i] !== '"') throw new Error(`expected string at ${i}`);
    i++;
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '"') { i++; return; }
      i++;
    }
    throw new Error('unterminated string');
  }

  const v = value(); ws();
  if (i !== src.length) throw new Error(`trailing content at ${i}`);
  return v;
}

/** Re-emit in JSON.stringify's layout at a given indent, preserving order. */
function emit(node, indent, depth = 0) {
  const pad = (n) => ' '.repeat(indent * n);
  if (node.t === 'raw') return node.text;
  if (node.t === 'arr') {
    if (!node.items.length) return '[]';
    const inner = node.items.map(v => pad(depth + 1) + emit(v, indent, depth + 1));
    return '[\n' + inner.join(',\n') + '\n' + pad(depth) + ']';
  }
  if (!node.entries.length) return '{}';
  const inner = node.entries.map(([k, v]) => pad(depth + 1) + k + ': ' + emit(v, indent, depth + 1));
  return '{\n' + inner.join(',\n') + '\n' + pad(depth) + '}';
}

/** Best-effort diagnosis so the failure names the fix, not just the symptom. */
function detect(raw, tree) {
  for (const indent of [1, 2, 3, 4]) {
    for (const nl of [true, false]) {
      if (emit(tree, indent) + (nl ? '\n' : '') === raw) return `indent=${indent} trailingNewline=${nl}`;
    }
  }
  let hint = '';
  try {
    const reordered = JSON.stringify(JSON.parse(raw), null, 2);
    if (reordered !== emit(tree, 2)) {
      hint = ' — NOTE: this file has integer-like keys, so a Node read/rewrite reorders them; rewrite it with an order-preserving tool';
    }
  } catch { /* diagnosis only */ }
  return 'no canonical indent' + hint;
}

function main() {
  const found = listJson(REFS);
  const errors = [];

  for (const rel of found) {
    if (!PINNED[rel]) {
      errors.push(`${rel}: not pinned in check-json-format.js — add its {indent, trailingNewline} so the format cannot drift`);
    }
  }

  for (const [rel, want] of Object.entries(PINNED)) {
    const abs = path.join(REFS, rel);
    if (!fs.existsSync(abs)) { errors.push(`${rel}: pinned but missing`); continue; }
    const raw = fs.readFileSync(abs, 'utf8');
    let tree;
    try { tree = parseOrdered(raw); }
    catch (e) { errors.push(`${rel}: unparseable — ${e.message}`); continue; }
    const expected = emit(tree, want.indent) + (want.trailingNewline ? '\n' : '');
    if (raw !== expected) {
      errors.push(
        `${rel}: not canonical. Pinned indent=${want.indent} trailingNewline=${want.trailingNewline}; ` +
        `on disk looks like ${detect(raw, tree)}. Re-serialize at the pinned format ` +
        `(and never re-sort an existing map — append new keys at the end).`
      );
    }
  }

  if (errors.length) {
    console.error(`${errors.length} JSON format problem(s):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`json format OK (${Object.keys(PINNED).length} files canonical)`);
}

module.exports = { PINNED, detect, parseOrdered, emit };
if (require.main === module) main();
