#!/usr/bin/env node
'use strict';

/**
 * fcache-restamp.js — re-observe the Desktop GrowthBook cache (fcache) for every gate the
 * registry pins, compare it with the committed record, and restamp only when nothing moved.
 *
 *   node scripts/fcache-restamp.js                      compare; write when nothing moved
 *   node scripts/fcache-restamp.js --accept --note "…"  also write when something moved
 *   node scripts/fcache-restamp.js --check              read-only; exit 1 when a pinned gate moved
 *
 * Options: --fcache <file> (default: the Desktop's own), --archive-dir <dir> (default
 * ~/ccinternals-host-probe), --root <repo> (tests), --date YYYY-MM-DD (default today).
 * Exit codes: 0 written / nothing to do, 1 moved and not accepted, 2 usage, decode or format error.
 *
 * WHY. Restamps used to compare only present/source/on. A value gate can change inside its
 * served value with all three unchanged (2974609625's pass interval went 60 -> 30 minutes
 * between two restamps) and nothing noticed. So the served state of every pinned gate is
 * committed in data/fcache-pinned.json, git history is the archive of past values, and this
 * script is the only writer: it diffs key by key and refuses to restamp over a move.
 *
 * WHAT THE RECORD MAY HOLD. The repo is public. Per gate exactly {id, present, source, on,
 * value, per_account?}. Never experimentResult (it carries the account's GrowthBook bucketing
 * id), experiment or ruleId. A string leaf longer than 80 characters or containing a newline
 * is server-delivered prose (classifier prompts, memory guidelines) and is stored as
 * {"$sha256", "$len"} only; the verbatim capture stays in the off-repo archive.
 *
 * CONTENT16 must equal Python's sha256(json.dumps(features, sort_keys=True,
 * separators=(",", ":")))[:16], the id every earlier capture was stamped with. A rebuilt JS
 * object cannot produce it: integer-like keys (the gate ids) always enumerate first, in
 * numeric order. canon() serialises by hand instead, and decode() refuses input whose numbers
 * would not survive JSON.parse unchanged.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PROSE_MAX = 80;
const RECORD_REL = 'data/fcache-pinned.json';
const REFS_REL = 'skill-package/skills/claude-code-internals/references';
const DEFAULT_FCACHE = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'fcache');
const DEFAULT_ARCHIVE = path.join(os.homedir(), 'ccinternals-host-probe');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Python json.dumps string escaping with ensure_ascii=True: DEL (0x7f) and above become \uXXXX per UTF-16 unit. */
function pyString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20 || c >= 0x7f) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

/** Python json.dumps(v, sort_keys=True, separators=(",", ":")). Keys in code-unit order. */
function canon(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return pyString(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => pyString(k) + ':' + canon(v[k])).join(',') + '}';
}

const content16 = (features) => sha(canon(features)).slice(0, 16);

/** Number tokens (outside strings) that JSON.parse would not round-trip like Python does. */
function unsafeNumbers(text) {
  const bad = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
      const tok = m[0];
      const digits = tok.replace(/[-.]/g, '').replace(/[eE].*$/, '');
      if (/[eE]/.test(tok) || /\.\d*0$/.test(tok) || /^-0(\.0+)?$/.test(tok) || digits.length >= 16) bad.push(tok);
      i += tok.length;
      continue;
    }
    i++;
  }
  return bad;
}

function nonAsciiKeys(v, at = '', out = []) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of Object.keys(v)) {
      if (/[^\x00-\x7f]/.test(k)) out.push(at + '/' + k);
      nonAsciiKeys(v[k], at + '/' + k, out);
    }
  } else if (Array.isArray(v)) v.forEach((x, n) => nonAsciiKeys(x, at + '/' + n, out));
  return out;
}

class Fail extends Error {}

/** Decode a CLF fcache file: "CLF" + format byte (1 or 2), 4 unexplained bytes, then gzip. */
function decode(buf) {
  if (buf.length < 10 || buf.slice(0, 3).toString('latin1') !== 'CLF') throw new Fail('not an fcache file (no CLF magic)');
  const ver = buf[3];
  if (ver !== 1 && ver !== 2) throw new Fail(`unknown fcache format version ${ver} (known: 1, 2)`);
  let text;
  try { text = zlib.gunzipSync(buf.slice(8)).toString('utf8'); } catch (e) { throw new Fail(`gunzip from byte 8 failed: ${e.message}`); }
  const bad = unsafeNumbers(text);
  if (bad.length) throw new Fail(`numbers that would not hash like Python: ${[...new Set(bad)].slice(0, 5).join(', ')}`);
  const doc = JSON.parse(text);
  if (!doc || typeof doc.features !== 'object') throw new Fail('decoded fcache has no features object');
  const keys = nonAsciiKeys(doc.features);
  if (keys.length) throw new Fail(`non-ASCII keys sort differently in JS and Python: ${keys.slice(0, 3).join(', ')}`);
  return { doc, text, version: ver };
}

/** Replace server-delivered prose with a fingerprint. */
function scrub(v) {
  if (typeof v === 'string') return (v.length > PROSE_MAX || v.includes('\n')) ? { $sha256: sha(v).slice(0, 16), $len: v.length } : v;
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = scrub(v[k]);
    return out;
  }
  return v;
}

/** The record entry for one gate: exactly {id, present, source, on, value?, per_account?}. */
function observe(features, id) {
  const f = features[id];
  if (!f) return { id, present: false, source: null, on: null };
  const e = { id, present: true, source: f.source == null ? null : f.source, on: !!f.on, value: scrub(f.value) };
  if (f.source === 'experiment') e.per_account = true;
  return e;
}

const pinned16 = (gates) => sha(canon(gates)).slice(0, 16);

/** Key-level diff of two scrubbed values. Returns lines like "a.b: 60 -> 30". */
function diffValues(a, b, at = '') {
  const name = at || '(value)';
  if (canon(a) === canon(b)) return [];
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x) && !('$sha256' in x);
  if (isObj(a) && isObj(b)) {
    const out = [];
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const p = at ? `${at}.${k}` : k;
      if (!(k in a)) out.push(`${p}: added ${canon(b[k])}`);
      else if (!(k in b)) out.push(`${p}: removed (was ${canon(a[k])})`);
      else out.push(...diffValues(a[k], b[k], p));
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ca = a.map(canon);
    const cb = b.map(canon);
    const added = cb.filter((x) => !ca.includes(x));
    const removed = ca.filter((x) => !cb.includes(x));
    const out = [];
    if (added.length) out.push(`${name}: members added ${added.join(', ')}`);
    if (removed.length) out.push(`${name}: members removed ${removed.join(', ')}`);
    if (!added.length && !removed.length) out.push(`${name}: order changed`);
    return out;
  }
  const show = (x) => (x && typeof x === 'object' && '$sha256' in x) ? `<prose ${x.$len} chars ${x.$sha256}>` : canon(x);
  return [`${name}: ${show(a)} -> ${show(b)}`];
}

/** Last path segment of each diff line: the key names worth grepping prose for. */
const changedKeys = (lines) => [...new Set(lines.map((l) => l.split(':')[0].split('.').pop()).filter((k) => k && k !== '(value)'))];

/** Compare the record with a fresh observation of the registry's pinned gates. */
function compare(record, registry, features) {
  const pinned = registry.entries.filter((e) => e.kind === 'gate' && e.namespace === 'desktop_fcache');
  const prev = new Map((record ? record.gates : []).map((g) => [g.id, g]));
  const moves = [];
  const gates = [];
  for (const e of pinned) {
    const id = e.id.slice('gate.'.length);
    const now = observe(features, id);
    gates.push(now);
    const was = prev.get(id);
    const removed = e.status === 'removed';
    if (!was) { moves.push({ id, entry: e, kind: 'new', removed, lines: [`new pinned gate: ${now.present ? `${now.source}/${now.on ? 'on' : 'off'}` : 'not served'}`] }); continue; }
    const lines = [];
    for (const k of ['present', 'source', 'on']) if (was[k] !== now[k]) lines.push(`${k}: ${was[k]} -> ${now[k]}`);
    if (!!was.per_account !== !!now.per_account) lines.push(`per_account: ${!!was.per_account} -> ${!!now.per_account}`);
    lines.push(...diffValues(was.value === undefined ? null : was.value, now.value === undefined ? null : now.value));
    if (lines.length) moves.push({ id, entry: e, kind: removed ? 'served-unread' : 'moved', removed, lines });
  }
  const unpinned = [...prev.keys()].filter((id) => !gates.some((g) => g.id === id));
  gates.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { gates, moves, unpinned };
}

/** file:line hits for a gate id and the changed key names, across lessons and state pages. */
function proseHits(refsDir, id, keys) {
  const files = [
    ...fs.readdirSync(refsDir).filter((f) => f.endsWith('.md')).map((f) => path.join(refsDir, f)),
    ...fs.readdirSync(path.join(refsDir, 'state')).filter((f) => f.endsWith('.md')).map((f) => path.join(refsDir, 'state', f)),
  ];
  const pats = [id, ...keys];
  const hits = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, n) => {
      if (pats.some((p) => line.includes(p))) hits.push(`${path.relative(refsDir, f)}:${n + 1}`);
    });
  }
  return hits;
}

/** Rewrite a JSON file through parse/stringify, refusing if that would not round-trip. */
function rewriteJson(file, indent, mutate) {
  const raw = fs.readFileSync(file, 'utf8');
  const obj = JSON.parse(raw);
  if (JSON.stringify(obj, null, indent) + '\n' !== raw) throw new Fail(`${file} does not round-trip through JSON.stringify(…, ${indent}); refusing to rewrite it`);
  mutate(obj);
  return JSON.stringify(obj, null, indent) + '\n';
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseArgs(argv) {
  const o = { fcache: DEFAULT_FCACHE, archive: DEFAULT_ARCHIVE, root: path.resolve(__dirname, '..'), accept: false, check: false, note: null, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => { if (argv[i + 1] === undefined) throw new Fail(`${a} needs a value`); return argv[++i]; };
    if (a === '--accept') o.accept = true;
    else if (a === '--check') o.check = true;
    else if (a === '--note') o.note = need();
    else if (a === '--fcache') o.fcache = need();
    else if (a === '--archive-dir') o.archive = need();
    else if (a === '--root') o.root = path.resolve(need());
    else if (a === '--date') o.date = need();
    else throw new Fail(`unknown argument ${a}`);
  }
  if (o.check && o.accept) throw new Fail('--check is read-only; it cannot be combined with --accept');
  if (o.accept && !(o.note && o.note.trim())) throw new Fail('--accept needs --note "<what moved and what you updated>"');
  return o;
}

function run(argv, log = console.log) {
  const o = parseArgs(argv);
  if (!fs.existsSync(o.fcache)) throw new Fail(`no fcache at ${o.fcache} (is Claude Desktop installed and signed in?)`);
  const { doc, text } = decode(fs.readFileSync(o.fcache));
  const features = doc.features;
  const c16 = content16(features);
  const capture = { content16: c16, embedded_timestamp: doc.timestamp, feature_count: Object.keys(features).length, observed_at: o.date || today(), mode: doc.mode === undefined ? null : doc.mode };

  const recordFile = path.join(o.root, RECORD_REL);
  const registryFile = path.join(o.root, REFS_REL, 'state', 'registry.json');
  const factsFile = path.join(o.root, REFS_REL, 'state', 'author-facts.json');
  const record = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf8')) : null;
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  const { gates, moves, unpinned } = compare(record, registry, features);

  if (!o.check) {
    fs.mkdirSync(o.archive, { recursive: true });
    const arch = path.join(o.archive, `fcache-${c16}.json`);
    if (!fs.existsSync(arch)) fs.writeFileSync(arch, text);
  }

  const prevCap = record ? record.capture : null;
  log(`fcache ${c16} (${capture.feature_count} features, mode ${capture.mode}); record ${prevCap ? prevCap.content16 : '(none)'}`);
  const modeMoved = prevCap && prevCap.mode !== capture.mode;
  if (modeMoved) log(`MODE CHANGED: ${prevCap.mode} -> ${capture.mode} (a different account or deployment; values may differ for that reason alone)`);
  const refsDir = path.join(o.root, REFS_REL);
  for (const m of moves) {
    log(`${m.kind.toUpperCase()} gate.${m.id} (${m.entry.name})${m.removed ? ' [registry: removed, never blocks]' : ''}`);
    for (const l of m.lines) log(`    ${l}`);
    const lessons = (m.entry.provenance || []).map((p) => p.lesson).filter(Boolean);
    if (lessons.length) log(`    provenance lessons: ${lessons.join(', ')}`);
    const hits = proseHits(refsDir, m.id, changedKeys(m.lines));
    if (hits.length) log(`    re-read: ${hits.slice(0, 20).join(' ')}${hits.length > 20 ? ` (+${hits.length - 20} more)` : ''}`);
  }
  for (const id of unpinned) log(`UNPINNED gate.${id}: in the record but no longer a desktop_fcache gate in the registry; dropped on write`);

  const blocking = moves.filter((m) => !m.removed).length + (modeMoved ? 1 : 0);
  if (o.check) {
    if (prevCap && prevCap.content16 !== c16) log(`note: the live fcache (${c16}) differs from the record (${prevCap.content16}); restamp before relying on it`);
    log(blocking ? `check: ${blocking} pinned gate change(s) not in the record` : 'check: no pinned gate moved');
    return blocking ? 1 : 0;
  }
  if (blocking && !o.accept) {
    log(`refusing to restamp: ${blocking} change(s). Update the affected registry summaries, lessons and state pages, then re-run with --accept --note "…"`);
    return 1;
  }

  const p16 = pinned16(gates);
  const at = c16;
  const newRecord = { format: 1, capture, gates };
  const regText = rewriteJson(registryFile, 2, (r) => {
    r.as_of.fcache_capture = { content16: c16, embedded_timestamp: capture.embedded_timestamp, feature_count: capture.feature_count, observed_at: capture.observed_at, mode: capture.mode, pinned16: p16 };
    const byId = new Map(gates.map((g) => [g.id, g]));
    for (const e of r.entries) {
      if (e.kind !== 'gate' || e.namespace !== 'desktop_fcache') continue;
      const g = byId.get(e.id.slice('gate.'.length));
      const keep = e.observed && e.observed.served_keys !== undefined ? { served_keys: e.observed.served_keys } : {};
      e.observed = { present: g.present, source: g.source, on: g.on, at, ...keep };
    }
  });
  const factsText = rewriteJson(factsFile, 2, (a) => {
    const va = a.verified_against;
    va.fcache_content16 = c16;
    va.observed_at = capture.observed_at;
    const n = gates.length;
    const line = o.note && o.note.trim()
      ? `${capture.observed_at}: fcache re-captured (${c16}, ${capture.feature_count} features) by scripts/fcache-restamp.js; ${n} pinned gates re-checked including served values. ${o.note.trim()}`
      : `${capture.observed_at}: fcache re-captured (${c16}, ${capture.feature_count} features) by scripts/fcache-restamp.js; ${n} pinned gates re-checked including served values, none changed.`;
    va.desktop_note = `${line} ${va.desktop_note || ''}`.trim();
  });
  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  fs.writeFileSync(recordFile, JSON.stringify(newRecord, null, 2) + '\n');
  fs.writeFileSync(registryFile, regText);
  fs.writeFileSync(factsFile, factsText);
  log(`restamped to ${c16} (pinned16 ${p16}): ${RECORD_REL}, registry.json, author-facts.json`);
  return 0;
}

module.exports = { canon, content16, pyString, unsafeNumbers, decode, scrub, observe, pinned16, diffValues, compare, run, Fail, RECORD_REL, REFS_REL, PROSE_MAX };

if (require.main === module) {
  try { process.exitCode = run(process.argv.slice(2)); } catch (e) {
    if (e instanceof Fail) { console.error(`fcache-restamp: ${e.message}`); process.exitCode = 2; } else throw e;
  }
}
