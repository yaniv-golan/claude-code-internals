'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { countSymbol } = require('../count-symbol.js');

// Synthetic artifacts, so these tests do not depend on a binary being on disk.
const ascii = (s) => Buffer.from(s, 'ascii');
const wide  = (s) => Buffer.from(s, 'utf16le');
const cat   = (...b) => Buffer.concat(b);

test('plain ASCII: all three instruments agree', () => {
  const r = countSymbol(cat(ascii('xx FOO yy FOO zz')), 'FOO');
  assert.deepStrictEqual([r.ascii, r.utf16, r.stripped], [2, 0, 2]);
  assert.ok(r.agree);
});

test('UTF-16LE storage is invisible to an ASCII search but counted here', () => {
  const r = countSymbol(cat(ascii('a'), wide('FOO'), ascii('b')), 'FOO');
  assert.strictEqual(r.ascii, 0, 'ASCII search must not see the wide copy');
  assert.strictEqual(r.utf16, 1);
  // stripping the NULs turns the wide copy into a findable ASCII one
  assert.strictEqual(r.stripped, 1);
  assert.ok(r.agree, 'decode-only case must agree');
});

test('mixed storage sums, and the stripped extract equals the sum', () => {
  const r = countSymbol(cat(ascii('FOO'), wide('FOO'), ascii('-FOO')), 'FOO');
  assert.deepStrictEqual([r.ascii, r.utf16, r.sum], [2, 1, 3]);
  assert.strictEqual(r.stripped, 3);
  assert.ok(r.agree);
});

// THE CONTROL THAT MATTERS. Null padding between two entries is swallowed by
// stripping, gluing the tail of one onto the head of the next and inventing a
// token that exists in neither encoding. A total alone cannot reveal this.
test('fabrication across null padding is detected and refused', () => {
  const buf = cat(ascii('FOO'), Buffer.from([0, 0]), ascii('BAR'));
  const r = countSymbol(buf, 'FOOBAR');
  assert.strictEqual(r.ascii, 0);
  assert.strictEqual(r.utf16, 0);
  assert.strictEqual(r.stripped, 1, 'stripping must glue FOO+BAR');
  assert.ok(!r.agree, 'must not agree');
  assert.strictEqual(r.delta, 1);
});

test('absence is unambiguous across all three', () => {
  const r = countSymbol(ascii('nothing here'), 'ZZZ');
  assert.deepStrictEqual([r.ascii, r.utf16, r.stripped, r.agree], [0, 0, 0, true]);
});

test('overlapping matches are counted, not skipped', () => {
  const r = countSymbol(ascii('aaaa'), 'aa');
  assert.strictEqual(r.ascii, 3);
});

// --- edge cases found by adversarial review ------------------------------
//
// Both of these previously returned a confident result that read as evidence.

test('a non-ASCII symbol is refused, not answered with an agreeing zero', () => {
  assert.throws(() => countSymbol(Buffer.from('cafe cafe', 'utf8'), 'caf\u00e9'), /printable ASCII/);
});

test('a NUL-bearing symbol is refused rather than under-counted', () => {
  assert.throws(() => countSymbol(Buffer.from([0x41, 0x00, 0x42]), 'A\u0000B'), /printable ASCII/);
});

test('UTF-16BE storage disagrees without implying fabrication', () => {
  // 00 46 00 4F 00 4F = "FOO" big-endian: neither needle sees it, stripping does.
  const r = countSymbol(Buffer.from([0x00,0x46,0x00,0x4f,0x00,0x4f]), 'FOO');
  assert.deepStrictEqual([r.ascii, r.utf16, r.stripped], [0, 0, 1]);
  assert.ok(!r.agree, 'must refuse a single number');
  assert.strictEqual(r.delta, 1);
});
