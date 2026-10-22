#!/usr/bin/env node
'use strict';

/**
 * desktop-changelog-scan.js — fetch Anthropic's official Claude Desktop release notes, report
 * what is new or reworded since the committed snapshot, and say for each new item whether a
 * lesson already covers it.
 *
 *   node scripts/desktop-changelog-scan.js                    report changes; write nothing
 *   node scripts/desktop-changelog-scan.js --accept           also write the snapshot
 *   node scripts/desktop-changelog-scan.js --check            exit 1 when unrecorded changes exist
 *   node scripts/desktop-changelog-scan.js --find <term>      which release-note items mention <term>
 *                                                             (case-sensitive when <term> has a capital)
 *   node scripts/desktop-changelog-scan.js --since <label>    report entries dated on or after <label>'s
 *
 * Options: --changelog <file> and --config <file> read local copies instead of fetching (tests,
 * offline), --archive-dir <dir> (default ~/ccinternals-host-probe/desktop-changelog), --root
 * <repo> (tests), --date YYYY-MM-DD (default today), --leads-only (hide items a lesson names).
 * Exit codes: 0 nothing new / written, 1 changes not accepted (--check), 2 usage or fetch error.
 *
 * WHY. The skill's Desktop lessons come from asar diffs. The release notes say which of that
 * surface Anthropic announced; the difference is the dark-launch insight, and an item the notes
 * announce that no lesson covers is a lead. The notes are revised after publication (entries
 * reworded, "Known issue" turned "Resolved", "This differs from earlier notes…"), so the
 * snapshot hashes every item and a rewording shows up, not only a new version.
 *
 * WHAT THE SNAPSHOT HOLDS. The repo is public and the notes are Anthropic's text, so
 * data/desktop-changelog.json keeps per entry only {date, bundled, items: [hash]}: a 16-hex
 * sha256 of each item's section and whitespace-normalized text. The verbatim pages go to the
 * off-repo archive, one file per fetched content hash.
 *
 * DATES. Until 2026-10 every entry carried its release date. The page now has none, so an entry
 * keeps the date it was first recorded with, and a new one gets the scan's date (--date). For an
 * undated entry, --since therefore means "first seen on or after".
 *
 * A "names" hit is a token match: a backticked identifier or quoted UI string from the item that
 * appears in a lesson. It proves a lesson names the thing, not that it says what the note says,
 * so those items are listed too, marked for comparison: a note that overturns a lesson sits
 * exactly there. --leads-only hides them. "no lesson names it" is a lead to read, not a gap to
 * fill blindly.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PAGES = {
  changelog: 'https://claude.com/docs/cowork/changelog.md',
  config: 'https://claude.com/docs/third-party/claude-desktop/configuration-changelog.md',
};
const RECORD_REL = 'data/desktop-changelog.json';
const SKILL_REL = 'skill-package/skills/claude-code-internals';
const DEFAULT_ARCHIVE = path.join(os.homedir(), 'ccinternals-host-probe', 'desktop-changelog');
/** A term more lessons than this name (Bash, PATH, auto) says nothing about coverage. */
const COMMON = 8;
/** Backticked tokens too generic to identify a lesson. */
const GENERIC = new Set(['true', 'false', 'boolean', 'string', 'integer', 'enum', 'array', 'object', 'allow', 'ask', 'blocked', 'builtin', 'null']);

const sha16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Split a page into [label, date, body]. Until 2026-10 entries were <Update label description>
 *  blocks; since then each starts at a bold version line ("**v3.1623.0**") and carries no date. */
function blocks(md) {
  const re = /<Update label="([^"]+)" description="([^"]*)">([\s\S]*?)<\/Update>/g;
  const out = [...md.matchAll(re)].map((m) => [m[1], m[2], m[3]]);
  if (out.length) return out;
  // Non-release blocks keep their old labels: "Baseline", "Known issue: …", "Resolved: …".
  const parts = md.split(/^\*\*(v\d+(?:\.\d+)+|Baseline|(?:Known issue|Resolved): [^*\n]+)\*\*[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) out.push([parts[i], null, parts[i + 1]]);
  return out;
}

/** Parse one release-notes page into [{label, date, bundled, items:[{section,text,hash}]}]. */
function parse(md) {
  const entries = [];
  for (const [label, date, body] of blocks(md)) {
    let section = '';
    let fence = false;
    let bundled = null;
    const items = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('```')) { fence = !fence; continue; }
      if (fence || !line || /^<\/?div/.test(line)) continue;
      const head = line.match(/^\*\*([^*]+?):?\*\*:?$/);
      if (head) { section = head[1]; continue; }
      if (/^\|\s*(MDM key|-)\s*\|/.test(line)) continue; // table header and separator rows
      const b = line.match(/^Bundled Claude Code version:\s*(\d+(?:\.\d+)+)/);
      if (b) { bundled = b[1]; continue; }
      const text = norm(line.replace(/^[*-]\s+/, ''));
      items.push({ section, text, hash: sha16(`${section}\n${text}`) });
    }
    entries.push({ label, date, bundled, items });
  }
  return entries;
}

/** Terms an item names: backticked identifiers and quoted UI strings. */
function terms(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`]{3,80})`/g)) {
    const t = m[1].trim();
    if (!GENERIC.has(t.toLowerCase()) && !/^\d+$/.test(t)) out.add(t);
  }
  for (const m of text.matchAll(/[“"]([^”"]{4,80})[”"]/g)) out.add(m[1].trim());
  for (const m of text.matchAll(/\[`?([A-Za-z][\w.]{3,60})`?\]\(/g)) out.add(m[1]);
  return [...out];
}

/** The lessons as {file, lines, bounds:[{id,start,end}]} for term lookup. */
function loadLessons(root) {
  const skill = path.join(root, SKILL_REL);
  const index = JSON.parse(fs.readFileSync(path.join(skill, 'references', 'topic-index.json'), 'utf8'));
  const byFile = new Map();
  for (const l of index.lessons) {
    if (!byFile.has(l.file)) byFile.set(l.file, []);
    byFile.get(l.file).push({ id: l.id, start: l.startLine, end: l.endLine });
  }
  return [...byFile].map(([file, bounds]) => ({
    file, bounds, text: fs.readFileSync(path.join(skill, 'references', file), 'utf8'),
  }));
}

/** Lesson ids whose text contains the term (UI strings match case-insensitively). */
function lessonsNaming(lessons, term) {
  const ids = new Set();
  const ci = /\s/.test(term);
  const needle = ci ? term.toLowerCase() : term;
  for (const f of lessons) {
    const hay = ci ? f.text.toLowerCase() : f.text;
    let i = hay.indexOf(needle);
    while (i !== -1) {
      const line = hay.slice(0, i).split('\n').length;
      const hit = f.bounds.find((b) => line >= b.start && line <= b.end);
      if (hit) ids.add(hit.id);
      i = hay.indexOf(needle, i + needle.length);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/** Compare parsed pages with the record: per entry, items added and items gone. */
function diff(pages, record) {
  const changes = [];
  for (const [page, entries] of Object.entries(pages)) {
    const old = (record && record.pages && record.pages[page]) || {};
    for (const e of entries) {
      const prev = old[e.label];
      const prevSet = new Set(prev ? prev.items : []);
      const nowSet = new Set(e.items.map((i) => i.hash));
      const added = e.items.filter((i) => !prevSet.has(i.hash));
      const gone = prev ? prev.items.filter((h) => !nowSet.has(h)).length : 0;
      if (!prev || added.length || gone) changes.push({ page, label: e.label, date: e.date, isNew: !prev, added, gone });
    }
    for (const label of Object.keys(old)) {
      if (!entries.some((e) => e.label === label)) changes.push({ page, label, date: old[label].date, isNew: false, added: [], gone: old[label].items.length, dropped: true });
    }
  }
  return changes;
}

function snapshot(pages, date) {
  const out = { schema_version: 1, sources: PAGES, scanned: date, pages: {} };
  for (const [page, entries] of Object.entries(pages)) {
    out.pages[page] = {};
    for (const e of entries) {
      out.pages[page][e.label] = { date: e.date, bundled: e.bundled, items: e.items.map((i) => i.hash) };
    }
  }
  return out;
}

/** The date of the entry labelled floor, so --since also keeps undated notes (Known issue, Resolved) of that period. */
function sinceDate(pages, floor) {
  const want = floor.replace(/^v?/, 'v');
  for (const entries of Object.values(pages)) {
    const e = entries.find((x) => x.label === want);
    if (e) return e.date;
  }
  return null;
}

function args(argv) {
  const o = { accept: false, check: false, leadsOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--accept') o.accept = true;
    else if (a === '--check') o.check = true;
    else if (a === '--leads-only') o.leadsOnly = true;
    else if (a === '--find') o.find = val();
    else if (a === '--since') o.since = val();
    else if (a === '--changelog') o.changelog = val();
    else if (a === '--config') o.config = val();
    else if (a === '--archive-dir') o.archive = val();
    else if (a === '--root') o.root = val();
    else if (a === '--date') o.date = val();
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

async function load(name, file) {
  if (file) return fs.readFileSync(file, 'utf8');
  // One retry: a first fetch has failed transiently ("fetch failed") where curl succeeded.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(PAGES[name]);
      if (!res.ok) throw new Error(`${PAGES[name]}: HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
}

async function main(argv) {
  let o;
  try { o = args(argv); } catch (e) { console.error(e.message); return 2; }
  const root = o.root || path.resolve(__dirname, '..');
  const date = o.date || new Date().toISOString().slice(0, 10);
  const raw = {};
  try {
    raw.changelog = await load('changelog', o.changelog);
    raw.config = await load('config', o.config);
  } catch (e) { console.error(`fetch failed: ${e.message}`); return 2; }
  const pages = { changelog: parse(raw.changelog), config: parse(raw.config) };
  if (!pages.changelog.length) { console.error('no release entries parsed from the changelog; the page format changed'); return 2; }
  const recPath = path.join(root, RECORD_REL);
  const record = fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, 'utf8')) : null;
  // Undated entries (the page has had no dates since 2026-10) keep the date first recorded, else today's.
  for (const [page, entries] of Object.entries(pages)) {
    for (const e of entries) if (!e.date) e.date = record?.pages?.[page]?.[e.label]?.date || date;
  }

  if (o.find) {
    // A term with a capital letter is an identifier or acronym: match its case ("EDR" ≠ "credential").
    const cased = /[A-Z]/.test(o.find);
    const has = (t) => (cased ? t.includes(o.find) : t.toLowerCase().includes(o.find.toLowerCase()));
    let n = 0;
    for (const [page, entries] of Object.entries(pages)) {
      for (const e of entries) {
        for (const it of e.items) {
          if (has(it.text)) { n++; console.log(`${e.label} (${e.date}) ${page}${it.section ? ' · ' + it.section : ''}: ${it.text}`); }
        }
      }
    }
    console.log(n ? `${n} item(s) mention "${o.find}".` : `No release-note item mentions "${o.find}" (as of ${date}).`);
    return 0;
  }

  const floor = o.since ? sinceDate(pages, o.since) : null;
  if (o.since && !floor) { console.error(`--since ${o.since}: no entry with that label`); return 2; }
  const changes = diff(pages, record).filter((c) => !floor || c.date >= floor);
  const lessons = loadLessons(root);

  let leads = 0, covered = 0;
  for (const c of changes) {
    const tag = c.dropped ? 'entry removed' : c.isNew ? 'new entry' : `${c.added.length} item(s) added or reworded, ${c.gone} gone`;
    console.log(`\n== ${c.page} ${c.label} (${c.date}) — ${tag}`);
    for (const it of c.added) {
      const named = terms(it.text).map((t) => ({ t, ids: lessonsNaming(lessons, t) }));
      const hit = named.filter((x) => x.ids.length && x.ids.length <= COMMON);
      if (hit.length) covered++; else leads++;
      if (hit.length && o.leadsOnly) continue;
      console.log(`${hit.length ? '~' : '-'} [${it.section || '—'}] ${it.text}`);
      if (hit.length) console.log('    a lesson names this: check the lesson agrees with the note');
      console.log(named.length
        ? `    ${named.map((x) => `${x.t} → ${!x.ids.length ? 'no lesson' : x.ids.length > COMMON ? `common (${x.ids.length} lessons)` : x.ids.map((i) => 'L' + i).join(',')}`).join('; ')}`
        : '    (no identifier or quoted string to match; read it)');
    }
  }
  const total = changes.reduce((n, c) => n + c.added.length, 0);
  console.log(`\n${changes.length} entr${changes.length === 1 ? 'y' : 'ies'} changed, ${total} item(s) new or reworded: ` +
    `${covered} name something a lesson names (~: check the lesson agrees${o.leadsOnly ? '; hidden by --leads-only' : ''}), ${leads} name nothing a lesson names (-: leads).`);
  if (record) console.log(`Snapshot: ${record.scanned}.`);
  else console.log('No snapshot yet: every entry counts as new. Use --since <label> to narrow, --accept to record.');

  if (o.check) return changes.length ? 1 : 0;
  if (!o.accept) {
    if (changes.length) console.log('Nothing written. Log the leads, then re-run with --accept.');
    return 0;
  }
  const archive = o.archive || DEFAULT_ARCHIVE;
  fs.mkdirSync(archive, { recursive: true });
  for (const [name, text] of Object.entries(raw)) {
    const f = path.join(archive, `${date}-${name}-${sha16(text)}.md`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, text);
  }
  fs.writeFileSync(recPath, JSON.stringify(snapshot(pages, date), null, 2) + '\n');
  console.log(`Wrote ${RECORD_REL}; pages archived in ${archive}.`);
  return 0;
}

module.exports = { parse, terms, diff, snapshot, sinceDate, lessonsNaming, main };

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code));
