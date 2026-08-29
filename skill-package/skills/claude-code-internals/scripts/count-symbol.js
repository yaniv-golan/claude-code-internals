#!/usr/bin/env node
/**
 * count-symbol.js — count a literal symbol in a binary artifact, safely.
 *
 * WHY THIS EXISTS. Counting a string in an app.asar or a Bun-compiled binary
 * has three independent failure modes, and this repo has shipped a wrong number
 * from each of them:
 *
 *   grep -c                 counts LINES. These artifacts are effectively one
 *                           enormous line, so it under-reports by a different
 *                           factor for every symbol.
 *   ASCII-only search       blind to UTF-16LE-stored strings. Some prose and
 *                           tool descriptions are stored wide; an ASCII count
 *                           silently omits them.
 *   null-stripped extract   `tr -d '\0'` DECODES UTF-16LE (helpful) and ALSO
 *                           glues bytes across null padding (harmful), which
 *                           fabricates tokens by swallowing a string-table
 *                           length prefix. The occurrence count can be correct
 *                           while the extracted NAME is corrupt.
 *
 * THE CONTRACT. This returns the three counts separately and REFUSES to report
 * a single total when they disagree, because a total is identical whether the
 * stripped extract decoded or fabricated — the split is the only signal that
 * distinguishes them. That refusal is the point of the tool; do not add a
 * --force that collapses it.
 *
 *   node scripts/count-symbol.js <artifact> <symbol> [--json]
 *
 * exit 0 = counts agree (ascii + utf16 === stripped), total is trustworthy
 * exit 3 = counts disagree; inspect before publishing any number
 * exit 1 = usage / IO error
 */

'use strict';

const fs = require('fs');

/**
 * All three counts for one symbol in one artifact.
 * Throws on a symbol this tool cannot count honestly:
 *   - non-ASCII, because each search would encode it differently and the result
 *     would be a confident, agreeing ZERO — a manufactured "absent from X".
 *   - containing NUL, because the stripped copy cannot contain it, so `stripped`
 *     would under-count and the disagreement would be the tool's own fault.
 */
function countSymbol(buf, symbol) {
  if (!/^[\x20-\x7e]+$/.test(symbol)) {
    throw new Error(
      `refusing to count ${JSON.stringify(symbol)}: symbol must be printable ASCII. ` +
      `A non-ASCII needle is encoded differently by each search and would return an ` +
      `agreeing zero, which reads as a verified absence.`);
  }
  const ascii = Buffer.from(symbol, 'ascii');
  const utf16 = Buffer.from(symbol, 'utf16le');
  // Strip NULs in place into a preallocated buffer. Buffer#filter inherits
  // TypedArray semantics and returns an Array of numbers, which OOMs on a
  // 200 MB artifact — the failure this helper exists to make unnecessary.
  const out = Buffer.allocUnsafe(buf.length);
  let w = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) out[w++] = buf[i];
  const stripped = out.subarray(0, w);

  const occurrences = (hay, needle) => {
    let n = 0, i = 0;
    for (;;) {
      const at = hay.indexOf(needle, i);
      if (at === -1) return n;
      n++; i = at + 1;                       // overlapping-safe
    }
  };

  const a = occurrences(buf, ascii);
  const u = occurrences(buf, utf16);
  const s = occurrences(stripped, ascii);
  return { ascii: a, utf16: u, stripped: s, sum: a + u, agree: s === a + u, delta: s - (a + u) };
}

module.exports = { countSymbol };

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const [artifact, symbol] = args.filter(a => a !== '--json');
  if (!artifact || !symbol) {
    console.error('usage: node count-symbol.js <artifact> <symbol> [--json]');
    process.exit(1);
  }
  let buf;
  try { buf = fs.readFileSync(artifact); }
  catch (e) { console.error(`cannot read ${artifact}: ${e.message}`); process.exit(1); }

  const r = countSymbol(buf, symbol);
  if (json) { console.log(JSON.stringify(r, null, 2)); process.exit(r.agree ? 0 : 3); }

  console.log(`${symbol}`);
  console.log(`  ascii          ${r.ascii}`);
  console.log(`  utf-16le       ${r.utf16}`);
  console.log(`  ascii+utf16    ${r.sum}`);
  console.log(`  null-stripped  ${r.stripped}`);
  if (r.agree) {
    console.log(`  => ${r.sum}   (all instruments agree; safe to publish)`);
    process.exit(0);
  }
  console.log(`  => NO SINGLE NUMBER. stripped differs by ${r.delta > 0 ? '+' : ''}${r.delta}.`);
  // Do NOT name a single cause. A positive delta has at least two, and asserting
  // one without testing is the exact error this tool exists to prevent.
  if (r.delta > 0) {
    console.log(`     The stripped extract found MORE. EITHER it glued bytes across null padding`);
    console.log(`     and fabricated a match, OR it decoded an encoding neither needle covers`);
    console.log(`     (UTF-16BE, or a NUL-padded fixed-width entry). The counts cannot tell these`);
    console.log(`     apart. Inspect the bytes at the extra hit before publishing anything.`);
  } else {
    console.log(`     The stripped extract found FEWER. Inspect the bytes; publish neither number.`);
  }
  process.exit(3);
}
