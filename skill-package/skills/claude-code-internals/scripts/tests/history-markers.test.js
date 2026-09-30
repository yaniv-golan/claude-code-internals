'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CHECKER = path.join(__dirname, '..', 'check-history-markers.js');
const { scanText } = require('../check-history-markers.js');

function run(refsDir) {
  const env = refsDir ? { ...process.env, CHECK_HISTORY_MARKERS_REFS: refsDir } : process.env;
  try {
    return { code: 0, out: execFileSync('node', [CHECKER], { encoding: 'utf8', env }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const SCRATCH = [];
test.after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });
function scratchRefs(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-markers-'));
  SCRATCH.push(dir);
  fs.mkdirSync(path.join(dir, 'state'));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}

test('the lessons and state pages carry no history markers', () => {
  const r = run();
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /history markers OK/);
});

test('retraction banners are caught, in lessons and in state pages', () => {
  const dir = scratchRefs({
    '01-a.md': 'text\n> **CORRECTION (v2.11.18, verified).** The original said X.\n',
    'state/page.md': '- **History — corrected three times.** Originally added v2.11.3\n',
  });
  const r = run(dir);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /01-a\.md:2 \[bold-start\]/);
  assert.match(r.out, /state\/page\.md:1 \[bold-start\]/);
});

test('each banner shape the sweep removed is a hit', () => {
  for (const line of [
    '> ### ⚠️ CORRECTED 2026-08-05 — the global-collapse failure mode no longer exists',
    '### Implications — UPDATED v2.11.13 (revised 2026-05-10)',
    '**Corrected framing**: 1.19367.0 newly vendors the SDK helper',
    '- **Correction 1 — three progress events, not two.**',
    '**Re-correction (binary-verified live):** the original claim was real',
    '**Retracted from v2.36.0 by v2.36.1:** the read-after-write race',
    '**WITHDRAWN (2026-08-27, same day) — the probe.**',
    '> **AMENDED 2026-08-05.** Two of the four claims have rotted.',
    '| `x` | on | label. **CORRECTED in v2.22.1**: this table mislabeled it |',
  ]) {
    assert.strictEqual(scanText(line).length, 1, `not caught: ${line}`);
  }
});

test('traps, adjectives, code and metadata are not hits', () => {
  for (const line of [
    '**Trap:** grepping for `Dq` finds nothing.',
    '**There is no single path form that is correct for both tools.**',
    'Updated: 2026-08-27 | Source: first-party',
    '## Updated Prompt Text (v2.1.107)',
    'The exemption covers sentences containing `CORRECTION` or `runner-set`.',
    '### Memory Correction Hint Pattern',
    '# LESSON 114 -- DESKTOP v1.18286.0 RE-VERIFICATION, EFFORT-SPAWN CORRECTION & NEW COWORK SURFACE',
    'a one-line pointer ("corrected in v2.49.5, see CHANGELOG")',
  ]) {
    assert.deepStrictEqual(scanText(line), [], `false positive: ${line}`);
  }
});

test('fenced code blocks are skipped', () => {
  const text = 'prose\n```js\nconst MSG = "CORRECTED";\n**CORRECTION** inside a fence\n```\nafter\n';
  assert.deepStrictEqual(scanText(text), []);
  const dir = scratchRefs({ '02-b.md': text });
  assert.strictEqual(run(dir).code, 0);
});
