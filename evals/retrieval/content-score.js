'use strict';
/**
 * content-score.js — credit what the model actually saw, by matching tool-result text to the corpus.
 *
 * The frozen read@ rule in agentic-run.js parses commands (Read offsets, `sed -n`, `head`, `cat`), so
 * it misses lesson text that arrived any other way: Grep content mode with context, a piped or
 * multi-line `sed`, a `$VAR`-prefixed path, or `fetch-lesson.js` output. This scorer ignores the
 * command and reads the result instead:
 *
 *   - Every corpus line (lesson files and state pages) that is at least MIN_CHARS long once trimmed
 *     and occurs exactly once in the corpus becomes a key -> (file, line).
 *   - Each non-error tool result is split into lines; a `file:N:` / `file-N-` / `N:` / `N→` prefix
 *     (grep -n, Read's line numbers) is stripped before lookup.
 *   - Per result and per file, matched line numbers are joined into spans, bridging gaps of up to
 *     GAP lines (blank lines, table rules and other short lines that are not keys).
 *   - A lesson counts when one result's spans cover >= MIN_LINES of its lines (or all of it, if it
 *     is shorter, measured from its first to its last matchable line). A state-page section (a heading of level >= 2, up to the next heading of the same
 *     or higher level) counts the same way.
 *   - A registry entry counts as seen when one result carries both its name and the start of its
 *     summary (state.js output, or the raw registry.json entry). Several summaries are shared verbatim
 *     (the identity env vars), so the name is required too.
 *
 * Results are keyed by text, not by the tree's line numbers, so stored runs can be rescored against
 * the corpus they were staged from without re-deriving ranges.
 */

const fs = require('fs');
const path = require('path');

const MIN_CHARS = 12;
const MIN_LINES = 20;
const GAP = 4;

/** Build the corpus index from a skill directory (…/skills/claude-code-internals). */
function buildCorpus(skillDir) {
  const R = path.join(skillDir, 'references');
  const lessons = JSON.parse(fs.readFileSync(path.join(R, 'topic-index.json'), 'utf8')).lessons
    .map((l) => ({ id: l.id, file: l.file, start: l.startLine, end: l.endLine }));
  const byFile = new Map();
  for (const l of lessons) { if (!byFile.has(l.file)) byFile.set(l.file, []); byFile.get(l.file).push(l); }
  const files = [
    ...fs.readdirSync(R).filter((f) => /^\d\d-.*\.md$/.test(f)).map((f) => [f, path.join(R, f)]),
    ...fs.readdirSync(path.join(R, 'state')).filter((f) => /\.md$/.test(f)).map((f) => [`state/${f}`, path.join(R, 'state', f)]),
  ];
  const lineMap = new Map();
  const dup = new Set();
  const sections = new Map();
  for (const [name, p] of files) {
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    lines.forEach((t, i) => {
      const k = t.trim();
      if (k.length < MIN_CHARS) return;
      if (lineMap.has(k)) { dup.add(k); return; }
      lineMap.set(k, [name, i + 1]);
    });
    if (name.startsWith('state/')) {
      const hs = [];
      lines.forEach((t, i) => { const m = t.match(/^(#{1,6})\s/); if (m) hs.push({ lvl: m[1].length, line: i + 1, title: t.replace(/^#+\s*/, '').trim() }); });
      const secs = [];
      for (let i = 0; i < hs.length; i++) {
        if (hs[i].lvl < 2) continue;
        let end = lines.length;
        for (let j = i + 1; j < hs.length; j++) if (hs[j].lvl <= hs[i].lvl) { end = hs[j].line - 1; break; }
        secs.push({ id: `${name}#${hs[i].line}`, start: hs[i].line, end, title: hs[i].title });
      }
      sections.set(name, secs);
    }
  }
  for (const k of dup) lineMap.delete(k);
  // "All of it" means from the first to the last line that can be matched: a lesson or section that
  // ends in a blank line or a table rule could otherwise never be covered whole.
  const keyLines = new Map();
  for (const [file, ln] of lineMap.values()) { if (!keyLines.has(file)) keyLines.set(file, []); keyLines.get(file).push(ln); }
  const keyExtent = (file, start, end) => {
    const ls = (keyLines.get(file) || []).filter((n) => n >= start && n <= end);
    return ls.length ? Math.max(...ls) - Math.min(...ls) + 1 : 0;
  };
  for (const l of lessons) l.need = Math.min(MIN_LINES, Math.max(1, keyExtent(l.file, l.start, l.end)));
  for (const [f, secs] of sections) for (const sec of secs) sec.need = Math.min(MIN_LINES, Math.max(1, keyExtent(f, sec.start, sec.end)));
  let registry = [];
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(R, 'state', 'registry.json'), 'utf8'));
    const arr = Object.values(reg).find((v) => Array.isArray(v) && v.length && v[0] && v[0].id) || [];
    registry = arr.map((e) => ({ id: e.id, name: String(e.name || '').split(' ')[0], probe: normalize(String(e.summary || '')).slice(0, 40) })).filter((e) => e.probe.length >= 20 && e.name.length >= 3);
  } catch { /* no registry in this tree */ }
  return { lessons, byFile, lineMap, sections, registry };
}

const normalize = (s) => s.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();

/** Strip a grep/Read line-number prefix from one result line. */
function stripPrefix(raw) {
  return raw
    .replace(/^\s*(?:[^\s:]*\/)?[\w.-]+\.(?:md|json)[:-]\d+[:-]/, '')
    .replace(/^\s*\d+(?:\t|→|: |:|- |-)/, '')
    .trim();
}

/** Spans [{file, start, end}] of corpus lines found in one result's text. */
function spansOf(text, corpus) {
  const per = new Map();
  for (const raw of String(text).split('\n')) {
    const k = stripPrefix(raw);
    if (k.length < MIN_CHARS) continue;
    const hit = corpus.lineMap.get(k);
    if (!hit) continue;
    if (!per.has(hit[0])) per.set(hit[0], []);
    per.get(hit[0]).push(hit[1]);
  }
  const out = [];
  for (const [file, ns] of per) {
    ns.sort((a, b) => a - b);
    let s = ns[0];
    let e = ns[0];
    for (let i = 1; i < ns.length; i++) {
      if (ns[i] - e <= GAP) e = ns[i];
      else { out.push({ file, start: s, end: e }); s = e = ns[i]; }
    }
    out.push({ file, start: s, end: e });
  }
  return out;
}

const covered = (spans, r) => spans.reduce((t, s) => t + (s.file === r.file ? Math.max(0, Math.min(s.end, r.end) - Math.max(s.start, r.start) + 1) : 0), 0);

/** What one tool result showed: lesson ids, state-section ids, registry entry ids. */
function creditResult(text, corpus) {
  const spans = spansOf(text, corpus);
  const lessons = [];
  const sections = [];
  const files = new Set(spans.map((s) => s.file));
  for (const f of files) {
    for (const l of corpus.byFile.get(f) || []) {
      if (covered(spans, { file: f, ...l }) >= l.need) lessons.push(l.id);
    }
    for (const sec of corpus.sections.get(f) || []) {
      if (covered(spans, { file: f, start: sec.start, end: sec.end }) >= sec.need) sections.push(sec.id);
    }
  }
  const registry = [];
  if (corpus.registry.length) {
    const t = normalize(String(text));
    for (const e of corpus.registry) if (t.includes(e.probe) && t.includes(e.name)) registry.push(e.id);
  }
  return { lessons, sections, registry };
}

const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : '');

/** Score a whole transcript (array of stream-json events): union over non-error tool results. */
function scoreTranscript(events, corpus) {
  const lessons = [];
  const sections = new Set();
  const registry = new Set();
  for (const ev of events) {
    if (!ev || ev.type !== 'user' || !ev.message || !Array.isArray(ev.message.content)) continue;
    for (const c of ev.message.content) {
      if (!c || c.type !== 'tool_result' || c.is_error) continue;
      const r = creditResult(resultText(c.content), corpus);
      for (const id of r.lessons) if (!lessons.includes(id)) lessons.push(id);
      for (const s of r.sections) sections.add(s);
      for (const g of r.registry) registry.add(g);
    }
  }
  return { content_lessons: lessons, content_state_sections: [...sections], content_registry: [...registry] };
}

module.exports = { MIN_CHARS, MIN_LINES, GAP, buildCorpus, stripPrefix, spansOf, creditResult, scoreTranscript };
