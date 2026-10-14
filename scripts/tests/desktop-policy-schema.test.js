'use strict';
/**
 * desktop-policy-schema.test.js — scripts/desktop-policy-schema.js on synthetic builds: the asar
 * reader, schema extraction (stamp, undocumented, hidden, legacy names) and the diff.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../desktop-policy-schema.js');

const OLD = 'a:U(x,{flatKey:"keepAwakeEnabled",support:{enabled:{scopes:["3p"],availableInVersion:"2.7032.0"}}}),' +
  'b:U(x,{flatKey:"otlpAttrMaxChars",support:{enabled:{scopes:["3p"],availableInVersion:"@next"}}}),' +
  'c:U(x,{flatKey:"isDesktopExtensionEnabled",legacyFlatKey:{name:"isDxtEnabled",effect:"…"},support:{enabled:{scopes:["3p","1p"],availableInVersion:"1.2581.0"}}})';
const NEW = 'a:U(x,{flatKey:"keepAwakeEnabled",support:{enabled:{scopes:["3p"],availableInVersion:"2.7032.0"}}}),' +
  'b:U(x,{flatKey:"otlpAttrMaxChars",support:{enabled:{scopes:["3p"],availableInVersion:"2.31226.0"}}}),' +
  'c:U(x,{flatKey:"isDesktopExtensionEnabled",support:{enabled:{scopes:["3p","1p"],availableInVersion:"1.2581.0"}}}),' +
  'd:U(x,{flatKey:"coworkFileReadCheck",visibility:"public-undocumented",show:()=>!1,support:{enabled:{scopes:["3p"],availableInVersion:"@next"}}})';

/** A minimal asar holding .vite/build/index.pre.js, in Electron's layout. */
function asar(dir, name, body) {
  const data = Buffer.from(body, 'utf8');
  const header = Buffer.from(JSON.stringify({ files: { '.vite': { files: { build: { files: { 'index.pre.js': { size: data.length, offset: '0' } } } } } } }), 'utf8');
  const pad = (4 - (header.length % 4)) % 4;
  const pickle = Buffer.alloc(16 + header.length + pad);
  pickle.writeUInt32LE(4, 0);
  pickle.writeUInt32LE(8 + header.length + pad, 4);
  pickle.writeUInt32LE(4 + header.length + pad, 8);
  pickle.writeUInt32LE(header.length, 12);
  header.copy(pickle, 16);
  const f = path.join(dir, name);
  fs.writeFileSync(f, Buffer.concat([pickle.subarray(0, 8), pickle.subarray(8), data]));
  return f;
}

test('extract: stamp, undocumented, hidden and legacy names', () => {
  const n = P.extract(NEW);
  assert.strictEqual(n.keys.coworkFileReadCheck.avail, '@next');
  assert.ok(n.keys.coworkFileReadCheck.undocumented && n.keys.coworkFileReadCheck.hidden);
  assert.deepStrictEqual(P.extract(OLD).legacy, ['isDxtEnabled']);
  assert.deepStrictEqual(n.legacy, []);
});

test('diff: added key, restamped key, dropped legacy name', () => {
  const lines = P.diff(P.extract(OLD), P.extract(NEW));
  assert.ok(lines.includes('+ coworkFileReadCheck (@next, undocumented, hidden)'));
  assert.ok(lines.some((l) => l.startsWith('~ otlpAttrMaxChars: @next') && l.includes('2.31226.0')));
  assert.ok(lines.includes('- legacy name isDxtEnabled'));
  assert.ok(!lines.some((l) => l.includes('keepAwakeEnabled')));
});

test('reads index.pre.js out of an asar archive and from an extracted root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dps-'));
  const f = asar(dir, 'app.asar', NEW);
  assert.strictEqual(P.readAsarFile(f, '.vite/build/index.pre.js'), NEW);
  fs.mkdirSync(path.join(dir, 'x/.vite/build'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'x/.vite/build/index.pre.js'), OLD);
  const log = console.log; const out = [];
  console.log = (...a) => out.push(a.join(' '));
  try { assert.strictEqual(P.main([path.join(dir, 'x'), f]), 0); } finally { console.log = log; }
  assert.match(out.join('\n'), /3 -> 4 keys/);
});
