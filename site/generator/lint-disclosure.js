#!/usr/bin/env node
/**
 * lint-disclosure.js — scan a built site (or any directory) for content that
 * must not be published: server-flag ids, internal tool names, camelCase and
 * snake_case internals, minified symbols, flag-infrastructure naming, and
 * over-long quoted spans.
 *
 * The pattern list is IMPORTED from validate-state.js rather than duplicated,
 * so PR-time validation and build-time linting can never drift apart.
 *
 * build.js already runs this as gate 5. This standalone entry point exists so
 * the same check can be run over an arbitrary directory — a downloaded deploy
 * artifact, a preview build, or a reviewer's local copy.
 *
 * Usage:
 *   node site/generator/lint-disclosure.js [dir]     (default: site/dist)
 *
 * Exit 0 = clean, 1 = at least one failure. Review flags are printed but do
 * not fail: they are heuristics (quoted-span length), not determinations.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { scanForDisclosure } = require('../../skill-package/skills/claude-code-internals/scripts/validate-state.js');

/**
 * Reduce a file to its published prose. HTML loses script/style/markup (the
 * risk is a name reaching a reader, not our own template code); JSON is
 * reduced to its string VALUES (our published field names are not leaks).
 */
function proseOf(rel, raw) {
  if (rel.endsWith('.html')) {
    return raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  if (rel.endsWith('.json')) {
    const out = [];
    try {
      (function walk(v) {
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      })(JSON.parse(raw));
    } catch {
      return raw; // unparseable: scan it all rather than skip it
    }
    return out.join('\n');
  }
  return raw;
}

function walkDir(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, base, acc);
    else acc.push(path.relative(base, p));
  }
  return acc;
}

function lint(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`lint-disclosure: ${dir} does not exist — run build.js first`);
    process.exit(1);
  }
  const failures = [];
  const flags = [];
  let scanned = 0;
  for (const rel of walkDir(dir)) {
    if (!/\.(html|md|txt|json)$/.test(rel)) continue;
    scanned++;
    const raw = fs.readFileSync(path.join(dir, rel), 'utf8');
    const r = scanForDisclosure(proseOf(rel, raw), rel);
    failures.push(...r.failures);
    flags.push(...r.flags);
  }
  return { failures, flags, scanned };
}

if (require.main === module) {
  const dir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'dist');
  const { failures, flags, scanned } = lint(dir);
  for (const f of failures) console.error(`FAIL  ${f}`);
  for (const f of flags) console.log(`flag  ${f}`);
  if (failures.length) {
    console.error(`\nlint-disclosure: ${failures.length} failure(s) across ${scanned} file(s)`);
    process.exit(1);
  }
  console.log(`lint-disclosure: clean (${scanned} files, ${flags.length} review flag(s))`);
}

module.exports = { lint, proseOf };
