'use strict';
/**
 * fcache-restamp.test.js — scripts/fcache-restamp.js and the committed record it writes.
 *
 * Two halves. The live half asserts that data/fcache-pinned.json, registry.json and
 * author-facts.json agree (CI has no fcache, so equality between the three is what it can
 * check; the record's values are compared against the live cache by the script itself, in
 * release.js preflight). The unit half exercises the script on synthetic captures in a
 * scratch repo: Python-identical content16, the decoder's refusals, scrubbing, the key-level
 * diff, and the write gate (a moved value is never restamped without --accept --note).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const R = require('../fcache-restamp.js');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// ---- the committed record agrees with the registry ------------------------------------

test('the record, the registry and author-facts name the same capture', () => {
  const rec = read(R.RECORD_REL);
  const fc = read(`${R.REFS_REL}/state/registry.json`).as_of.fcache_capture;
  const va = read(`${R.REFS_REL}/state/author-facts.json`).verified_against;
  for (const k of ['content16', 'embedded_timestamp', 'feature_count', 'observed_at', 'mode']) {
    assert.deepStrictEqual(fc[k], rec.capture[k], `registry as_of.fcache_capture.${k}`);
  }
  assert.strictEqual(va.fcache_content16, rec.capture.content16);
  assert.strictEqual(va.observed_at, rec.capture.observed_at);
  assert.strictEqual(fc.pinned16, R.pinned16(rec.gates), 'pinned16 is the hash of the record\'s gates; only the script writes either');
});

test('every desktop_fcache gate is in the record with the same observation, and nothing else is', () => {
  const rec = read(R.RECORD_REL);
  const reg = read(`${R.REFS_REL}/state/registry.json`);
  const pinned = reg.entries.filter((e) => e.kind === 'gate' && e.namespace === 'desktop_fcache');
  assert.deepStrictEqual(rec.gates.map((g) => g.id), pinned.map((e) => e.id.slice(5)).sort(), 'same ids; record sorted by id as a string');
  const byId = new Map(rec.gates.map((g) => [g.id, g]));
  for (const e of pinned) {
    const g = byId.get(e.id.slice(5));
    for (const k of ['present', 'source', 'on']) assert.strictEqual(e.observed[k], g[k], `${e.id} observed.${k}`);
  }
});

test('the record holds only allowed fields, no server prose and no account hash', () => {
  const rec = read(R.RECORD_REL);
  const text = fs.readFileSync(path.join(ROOT, R.RECORD_REL), 'utf8');
  assert.strictEqual(text, JSON.stringify(rec, null, 2) + '\n', 'canonical layout');
  assert.deepStrictEqual(Object.keys(rec).sort(), ['capture', 'format', 'gates']);
  for (const g of rec.gates) {
    const extra = Object.keys(g).filter((k) => !['id', 'present', 'source', 'on', 'value', 'per_account'].includes(k));
    assert.deepStrictEqual(extra, [], `gate ${g.id} carries ${extra}`);
    assert.strictEqual('value' in g, g.present, `gate ${g.id}: value iff present`);
    assert.strictEqual(!!g.per_account, g.source === 'experiment', `gate ${g.id}: per_account iff source experiment`);
  }
  (function walk(v, at) {
    if (typeof v === 'string') assert.ok(v.length <= R.PROSE_MAX && !v.includes('\n'), `prose at ${at}`);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${at}.${k}`);
  })(rec.gates, 'gates');
  assert.doesNotMatch(text, /hashValue|experimentResult|ruleId/);
});

// ---- the script on synthetic captures ---------------------------------------------------

function clf(doc, ver = 2) {
  return Buffer.concat([Buffer.from([0x43, 0x4c, 0x46, ver, 0, 0x9a, 0xb7, 0xe2]), zlib.gzipSync(Buffer.from(typeof doc === 'string' ? doc : JSON.stringify(doc)))]);
}

/** A scratch repo with a two-gate registry, author-facts and (optionally) a record. */
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcache-restamp-'));
  const st = path.join(dir, R.REFS_REL, 'state');
  fs.mkdirSync(st, { recursive: true });
  fs.writeFileSync(path.join(dir, R.REFS_REL, 'lesson.md'), 'The sweep runs every 60 minutes (passIntervalMinutes) under gate 2974609625.\n');
  fs.writeFileSync(path.join(st, 'page.md'), 'nothing here\n');
  const reg = {
    schema_version: 1,
    as_of: { fcache_capture: { content16: '0000000000000000', embedded_timestamp: 1, feature_count: 0, observed_at: '2026-01-01' } },
    entries: [
      { id: 'gate.2974609625', kind: 'gate', name: '2974609625 (sweep)', status: 'live', summary: 's', provenance: [{ lesson: 208 }], namespace: 'desktop_fcache', observed: { present: true, source: 'force', on: true, at: '0000000000000000' } },
      { id: 'gate.17519066', kind: 'gate', name: '17519066', status: 'removed', summary: 's', provenance: [], namespace: 'desktop_fcache', observed: { present: true, source: 'defaultValue', on: true, at: '0000000000000000' } },
      { id: 'gate.tengu_x', kind: 'gate', name: 'tengu_x', status: 'live', summary: 's', provenance: [], namespace: 'cli_growthbook' },
    ],
  };
  fs.writeFileSync(path.join(st, 'registry.json'), JSON.stringify(reg, null, 2) + '\n');
  fs.writeFileSync(path.join(st, 'author-facts.json'), JSON.stringify({ schema_version: 1, verified_against: { fcache_content16: '0000000000000000', observed_at: '2026-01-01', desktop_note: 'old.' } }, null, 2) + '\n');
  return dir;
}

const features = (interval, prompt = 'short') => ({
  2974609625: { value: { passIntervalMinutes: interval, enabled: true, models: ['a', 'b'], prompt }, on: true, off: false, source: 'force', ruleId: 'fr_x', experiment: null, experimentResult: null },
  17519066: { value: true, on: true, off: false, source: 'defaultValue', ruleId: null },
  1978029737: { value: { k: 1 }, on: true, off: false, source: 'experiment', experimentResult: { hashValue: 'secret-user-hash' } },
});
const capture = (f, extra = {}) => ({ timestamp: 1791363742444, mode: '1p', features: f, ...extra });

function runIn(dir, fcacheDoc, args = []) {
  const fc = path.join(dir, 'fcache.bin');
  fs.writeFileSync(fc, Buffer.isBuffer(fcacheDoc) ? fcacheDoc : clf(fcacheDoc));
  const lines = [];
  const code = R.run(['--root', dir, '--fcache', fc, '--archive-dir', path.join(dir, 'archive'), '--date', '2026-10-07', ...args], (l) => lines.push(l));
  return { code, out: lines.join('\n') };
}
const hashFiles = (dir) => ['data/fcache-pinned.json', `${R.REFS_REL}/state/registry.json`, `${R.REFS_REL}/state/author-facts.json`]
  .map((f) => (fs.existsSync(path.join(dir, f)) ? crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex') : 'absent')).join();

test('content16 equals Python json.dumps(sort_keys=True, separators=(",",":")), numeric keys and non-ASCII included', () => {
  // Precomputed with: python3 -c 'import json,hashlib;print(hashlib.sha256(json.dumps(F,sort_keys=True,separators=(",",":")).encode()).hexdigest()[:16])'
  const F = { 17519066: { a: 'é\u007f😀', b: [1, 0.5, -3, null, true] }, 1004628546: { 'z"\\': '\n\t' } };
  assert.strictEqual(R.canon(F), '{"1004628546":{"z\\"\\\\":"\\n\\t"},"17519066":{"a":"\\u00e9\\u007f\\ud83d\\ude00","b":[1,0.5,-3,null,true]}}');
  assert.strictEqual(R.content16(F), '9df66f1f1d6f94c6');
});

test('content16 reproduces a real capture id when its decode is on this machine', (t) => {
  const f = path.join(os.homedir(), 'ccinternals-host-probe', 'fcache-preflight-20260927-003510.json');
  if (!fs.existsSync(f)) { t.skip('no saved 2026-09-27 decode on this machine'); return; }
  assert.strictEqual(R.content16(JSON.parse(fs.readFileSync(f, 'utf8')).features), 'd21cd40b42abe59d');
});

test('decode refuses a bad magic, an unknown version and numbers that would not hash like Python', () => {
  assert.throws(() => R.decode(Buffer.from('XXXX0000garbage')), /CLF magic/);
  assert.throws(() => R.decode(clf(capture({}), 3)), /format version 3/);
  for (const n of ['1.0', '1e5', '-0', '12345678901234567']) {
    assert.throws(() => R.decode(clf(`{"features":{"1":{"value":${n}}}}`)), /would not hash like Python/, n);
  }
  assert.doesNotThrow(() => R.decode(clf('{"features":{"1":{"value":0.5,"s":"1.0 in a string is fine"}}}')));
  assert.throws(() => R.decode(clf('{"features":{"é":{}}}')), /non-ASCII keys/);
  assert.strictEqual(R.decode(clf(capture({}), 1)).version, 1);
});

test('first run writes the record; experiment results, ruleIds and long prose never reach it', () => {
  const dir = scratch();
  const long = 'x'.repeat(R.PROSE_MAX + 1);
  const r = runIn(dir, capture(features(60, long)), ['--accept', '--note', 'first record']);
  assert.strictEqual(r.code, 0, r.out);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'data/fcache-pinned.json'), 'utf8'));
  assert.deepStrictEqual(rec.gates.map((g) => g.id), ['17519066', '2974609625'], 'only desktop_fcache gates, string order');
  const text = JSON.stringify(rec);
  assert.doesNotMatch(text, /secret-user-hash|fr_x|xxxxxxxxxx/);
  assert.strictEqual(rec.gates[1].value.prompt.$len, long.length);
  const reg = JSON.parse(fs.readFileSync(path.join(dir, R.REFS_REL, 'state/registry.json'), 'utf8'));
  assert.strictEqual(reg.as_of.fcache_capture.pinned16, R.pinned16(rec.gates));
  assert.ok(reg.entries.slice(0, 2).every((e) => e.observed.at === rec.capture.content16));
  assert.strictEqual(reg.entries[2].observed, undefined, 'cli_growthbook gates untouched');
  assert.ok(fs.existsSync(path.join(dir, 'archive', `fcache-${rec.capture.content16}.json`)), 'verbatim capture archived off-repo');
});

test('a value moved inside a gate: reported key by key, nothing written without --accept', () => {
  const dir = scratch();
  assert.strictEqual(runIn(dir, capture(features(60)), ['--accept', '--note', 'first']).code, 0);
  const before = hashFiles(dir);
  const r = runIn(dir, capture(features(30)));
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /MOVED gate\.2974609625/);
  assert.match(r.out, /passIntervalMinutes: 60 -> 30/);
  assert.match(r.out, /re-read: lesson\.md:1/, 'the sentence quoting the old value is listed');
  assert.strictEqual(hashFiles(dir), before, 'refused run writes nothing');
  assert.strictEqual(runIn(dir, capture(features(30)), ['--check']).code, 1);
  assert.throws(() => runIn(dir, capture(features(30)), ['--accept']), /needs --note/);
  assert.strictEqual(runIn(dir, capture(features(30)), ['--accept', '--note', 'sweep 60 -> 30; L208 updated']).code, 0);
  assert.strictEqual(runIn(dir, capture(features(30)), ['--check']).code, 0);
});

test('nothing moved: the restamp writes without --accept; a removed gate never blocks', () => {
  const dir = scratch();
  assert.strictEqual(runIn(dir, capture(features(60)), ['--accept', '--note', 'first']).code, 0);
  const f = features(60);
  f[17519066] = { value: false, on: false, off: true, source: 'defaultValue' };
  f[123] = { value: true, on: true, source: 'force' }; // an unpinned feature changes the capture id
  const r = runIn(dir, capture(f));
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /SERVED-UNREAD gate\.17519066/);
  const va = JSON.parse(fs.readFileSync(path.join(dir, R.REFS_REL, 'state/author-facts.json'), 'utf8')).verified_against;
  assert.match(va.desktop_note, /^2026-10-07: fcache re-captured/);
  assert.match(va.desktop_note, / old\.$/, 'previous note kept');
});

test('diffValues: flags, leaves, array members, order and prose fingerprints', () => {
  assert.deepStrictEqual(R.diffValues({ a: 1, b: 2 }, { a: 1, c: 2 }), ['b: removed (was 2)', 'c: added 2']);
  assert.deepStrictEqual(R.diffValues({ m: ['x', 'y'] }, { m: ['x', 'z'] }), ['m: members added "z"', 'm: members removed "y"']);
  assert.deepStrictEqual(R.diffValues({ m: ['x', 'y'] }, { m: ['y', 'x'] }), ['m: order changed']);
  const p = (s) => R.scrub(s);
  assert.match(R.diffValues({ q: p('a'.repeat(100)) }, { q: p('b'.repeat(100)) })[0], /^q: <prose 100 chars [0-9a-f]{16}> -> <prose 100 chars/);
  assert.deepStrictEqual(R.diffValues({ deep: { x: { y: 1 } } }, { deep: { x: { y: 1 } } }), []);
});

test('a mode change blocks, and a missing fcache is a usage error', () => {
  const dir = scratch();
  assert.strictEqual(runIn(dir, capture(features(60)), ['--accept', '--note', 'first']).code, 0);
  const r = runIn(dir, capture(features(60), { mode: '3p' }));
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /MODE CHANGED: 1p -> 3p/);
  assert.throws(() => R.run(['--root', dir, '--fcache', path.join(dir, 'nope')], () => {}), /no fcache/);
});
