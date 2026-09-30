#!/usr/bin/env node
/**
 * agentic-run.js — the agentic retrieval eval.
 *
 * Runs a SKILL.md body ("arm") against questions the way a forked skill runs it: one
 * `claude -p` call per question, the model finds and reads lesson files with its own tools,
 * and the transcript (stream-json) says which lessons it actually read.
 *
 * Usage:
 *   node agentic-run.js --arm-file arms/arm-D.md --skill-dir <skill folder> \
 *     --questions questions-v4.json --split dev --strata plain,identifier,terse --out <dir> \
 *     [--baseline baseline-v3-search.json] [--concurrency 6] [--limit N] [--model M] [--summary-only]
 *
 * Per call:
 *   - The skill folder is staged once per run into a temp dir (a copy; the model never sees the
 *     worktree). cwd = a fresh empty dir per question. The prompt, on stdin from a file, is
 *     "Base directory for this skill: <staged path>" + the arm body with `$ARGUMENTS` -> the
 *     question and `${CLAUDE_SKILL_DIR}` -> the staged path (a body without `$ARGUMENTS` gets
 *     "Topic requested: <question>" appended) + the IDS instruction (IDS_INSTRUCTION).
 *   - Flags (FLAGS): --safe-mode --setting-sources project (no user/project settings, CLAUDE.md,
 *     plugins, hooks or advisor), --tools Read,Grep,Glob,Bash, --allowedTools with the same four
 *     (ALLOWED_TOOLS, as the shipped allowed-tools grants), --permission-prompts none (never
 *     prompted), --add-dir <staged path>. No bypassPermissions.
 *   - --output-format stream-json --verbose; the whole stream is kept (<qid>.stream.jsonl) and
 *     the parsed record (<qid>.json) caches the question, so a rerun resumes.
 *
 * read@ (FROZEN: fixed before any run, so every arm is scored by one rule): a lesson counts as read when one tool call covered >= 50% of its
 * range, or of one of its sub-ranges when the index lists them (the "↳" lines of
 * references/routing/index-*.md in the staged folder). Coverage by call:
 *   - Read with a limit: lines [offset, offset+limit-1] (offset defaults to 1);
 *   - Read without a limit: counts only lessons whose whole range lies inside its first 2000 lines;
 *   - Bash `sed -n 'a,bp' FILE`, `head [-n N] FILE` (10 by default), `cat FILE`: that line span of
 *     FILE, cut to the number of lines the call actually returned when it is the only command;
 *     a segment whose output is piped onward (filtered) or whose input is a pipe counts nothing.
 *   A call whose tool_result is an error covers nothing. Distinct lessons in order of first read;
 *   only the first 4 count (READ_CAP).
 * cited@: ids on the reply's last `IDS:` line. A question is a hit when any counted lesson has
 * relevant[id] >= 1 (strict). When the questions carry `relevant_pooled` (append-only judging),
 * the pooled score is reported beside it.
 *
 * Also recorded per question: tool calls by tool, Read-limit errors (MaxFileReadTokenExceeded /
 * "exceeds maximum allowed tokens"), permission denials, other tool errors, input/output/cache
 * tokens, cost (the CLI's total_cost_usd, also appended to the CCI_EVAL_LEDGER ledger), latency,
 * turns. Summary: per stratum x split, read@ and cited@ with Wilson 95% intervals, medians, and
 * (with --baseline) a paired comparison against keyword-only and fused search top-3 on the same
 * questions (discordant counts and an exact two-sided McNemar p).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const CC = require('./claude-call.js');
const lib = require('./lib.js');
const G = require('./gen-questions.js');

const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_CONCURRENCY = 6;
const READ_CAP = 4;
const READ_DEFAULT_LINES = 2000;
const HEAD_DEFAULT_LINES = 10;
const COVER_FRACTION = 0.5;
const IDS_INSTRUCTION = 'End your reply with a line `IDS: <comma-separated lesson ids you relied on>`.';
// The shipped SKILL.md grants plain `Bash` in allowed-tools, so the eval does too. A read-only
// allowlist was tried first and denied python3, awk, cd and compound commands in 35 of 187 arm-D dev
// questions, a handicap real use doesn't have. The staged copy is a throwaway temp dir.
const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const TIMEOUT_MS = 15 * 60 * 1000;
const READ_LIMIT_RX = /MaxFileReadTokenExceeded|exceeds maximum allowed tokens/i;
const PERMISSION_RX = /permission|not allowed|was blocked|requires approval|denied/i;

function flagsFor(stagedDir, model) {
  return [
    '-p', '--model', model, '--safe-mode', '--setting-sources', 'project',
    '--tools', 'Read,Grep,Glob,Bash',
    '--allowedTools', ALLOWED_TOOLS.join(','),
    '--permission-prompts', 'none', '--add-dir', stagedDir,
    '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
  ];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { armFile: null, skillDir: null, questions: null, split: null, strata: null, out: null, baseline: null, concurrency: DEFAULT_CONCURRENCY, limit: Infinity, model: DEFAULT_MODEL, summaryOnly: false, qids: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arm-file') o.armFile = path.resolve(argv[++i]);
    else if (a === '--skill-dir') o.skillDir = path.resolve(argv[++i]);
    else if (a === '--questions') o.questions = path.resolve(argv[++i]);
    else if (a === '--split') o.split = argv[++i];
    else if (a === '--strata') o.strata = argv[++i].split(',').filter(Boolean);
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--baseline') o.baseline = path.resolve(argv[++i]);
    else if (a === '--concurrency') o.concurrency = parseInt(argv[++i], 10);
    else if (a === '--limit') o.limit = parseInt(argv[++i], 10);
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--qids') o.qids = argv[++i].split(',').filter(Boolean);
    else if (a === '--summary-only') o.summaryOnly = true;
    else { process.stderr.write(`ERROR: unknown argument "${a}"\n`); process.exit(1); }
  }
  for (const k of ['armFile', 'skillDir', 'questions', 'out']) if (!o[k]) { process.stderr.write(`ERROR: --${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} is required\n`); process.exit(1); }
  return o;
}

// ---------------------------------------------------------------------------
// Lesson ranges from the routing index (pure)
// ---------------------------------------------------------------------------

const RANGE_RX = /^([A-Za-z0-9._-]+\.md):(\d+)-(\d+)$/;

/**
 * Parse references/routing/index-*.md text into lessons: [{id, file, start, end, subs: [{start, end}]}].
 * A lesson line starts with its id; its `file:start-end` field is the first ` · `-separated field
 * shaped like one. A "↳ file:start-end · heading" line is a sub-range of the lesson above it.
 */
function parseIndex(text) {
  const lessons = [];
  let last = null;
  for (const line of text.split('\n')) {
    const sub = line.match(/^\s*↳\s*([A-Za-z0-9._-]+\.md):(\d+)-(\d+)/);
    if (sub) {
      if (last && sub[1] === last.file) last.subs.push({ start: Number(sub[2]), end: Number(sub[3]) });
      continue;
    }
    const m = line.match(/^(\d+) · /);
    if (!m) continue;
    const field = line.split(' · ').map((f) => f.trim()).find((f) => RANGE_RX.test(f));
    if (!field) continue;
    const r = field.match(RANGE_RX);
    last = { id: Number(m[1]), file: r[1], start: Number(r[2]), end: Number(r[3]), subs: [] };
    lessons.push(last);
  }
  return lessons;
}

function loadRanges(stagedDir) {
  const dir = path.join(stagedDir, 'references', 'routing');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^index-\d+\.md$/.test(f)).sort() : [];
  if (!files.length) throw new Error(`no references/routing/index-*.md under ${stagedDir}`);
  const lessons = files.flatMap((f) => parseIndex(fs.readFileSync(path.join(dir, f), 'utf8')));
  const byFile = new Map();
  for (const l of lessons) { if (!byFile.has(l.file)) byFile.set(l.file, []); byFile.get(l.file).push(l); }
  const cache = new Map();
  const fileLines = (f) => {
    if (!cache.has(f)) { try { cache.set(f, outputLines(fs.readFileSync(path.join(stagedDir, 'references', f), 'utf8'))); } catch { cache.set(f, 0); } }
    return cache.get(f);
  };
  return { lessons, byFile, fileLines };
}

const overlap = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1);
const len = (r) => r.end - r.start + 1;

/**
 * Lessons a coverage span counts as read (pure).
 * @param {{file: string, start: number, end: number, mode: 'range'|'whole'}} span
 *   mode 'range': >= COVER_FRACTION of the lesson range or of one sub-range;
 *   mode 'whole': the lesson's whole range inside the span (a Read without a limit).
 */
function lessonsCovered(span, ranges) {
  const out = [];
  for (const l of ranges.byFile.get(span.file) || []) {
    if (span.mode === 'whole') {
      if (l.start >= span.start && l.end <= span.end) out.push(l.id);
      continue;
    }
    const rs = [{ start: l.start, end: l.end }, ...l.subs];
    if (rs.some((r) => overlap(r, span) >= COVER_FRACTION * len(r))) out.push(l.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tool-call parsing (pure)
// ---------------------------------------------------------------------------

/** The references-relative file of an absolute path inside the staged skill dir, or null. */
function refFile(p, stagedDir, cwd) {
  if (!p) return null;
  const abs = path.resolve(cwd || '/', p);
  const refs = path.join(stagedDir, 'references') + path.sep;
  return abs.startsWith(refs) ? abs.slice(refs.length) : null;
}

/** Split a shell command into segments on unquoted | && || ; (with the operator that follows each). */
function shellSegments(cmd) {
  const segs = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < cmd.length) cur += cmd[++i]; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') { segs.push({ text: cur.trim(), op: two }); cur = ''; i++; continue; }
    if (c === '|' || c === ';' || c === '\n') { segs.push({ text: cur.trim(), op: c === '\n' ? ';' : c }); cur = ''; continue; }
    cur += c;
  }
  segs.push({ text: cur.trim(), op: null });
  return segs.filter((s) => s.text);
}

/** Tokenize one segment, honouring single/double quotes and backslashes. */
function shellWords(s) {
  const out = [];
  let cur = '';
  let q = null;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

/**
 * The line spans one Bash command reads from files (pure):
 * [{file (as written), start, end (Infinity = to EOF), single}] where `single` means the command
 * is exactly this one read (so its output line count can cut the span).
 */
function bashReadSpans(cmd) {
  const segs = shellSegments(cmd);
  const spans = [];
  let cwd = null;
  segs.forEach((seg, i) => {
    const w = shellWords(seg.text);
    const pipedIn = i > 0 && segs[i - 1].op === '|';
    const pipedOut = seg.op === '|';
    if (w[0] === 'cd' && w[1]) { cwd = cwd && !w[1].startsWith('/') ? path.join(cwd, w[1]) : w[1]; return; }
    if (pipedIn || pipedOut) return;
    const single = segs.length === 1 || (segs.every((s, j) => j === i || shellWords(s.text)[0] === 'cd'));
    const files = (args) => args.filter((a) => !a.startsWith('-'));
    if (w[0] === 'sed') {
      if (!w.includes('-n')) return;
      const rest = w.slice(1).filter((a) => a !== '-n');
      const script = rest.find((a) => /^\d+(,(\d+|\$))?p$/.test(a));
      if (!script) return;
      const m = script.match(/^(\d+)(?:,(\d+|\$))?p$/);
      const start = Number(m[1]);
      const end = m[2] === undefined ? start : (m[2] === '$' ? Infinity : Number(m[2]));
      for (const f of files(rest.filter((a) => a !== script))) spans.push({ file: f, start, end, single, cwd });
    } else if (w[0] === 'head') {
      let n = HEAD_DEFAULT_LINES;
      const args = [];
      for (let k = 1; k < w.length; k++) {
        const a = w[k];
        if (a === '-n' && w[k + 1] !== undefined) { n = parseInt(w[++k], 10); continue; }
        let m = a.match(/^-n(\d+)$/) || a.match(/^-(\d+)$/) || a.match(/^--lines=(\d+)$/);
        if (m) { n = parseInt(m[1], 10); continue; }
        args.push(a);
      }
      for (const f of files(args)) spans.push({ file: f, start: 1, end: n, single: single && files(args).length === 1, cwd });
    } else if (w[0] === 'cat') {
      const fs2 = files(w.slice(1));
      for (const f of fs2) spans.push({ file: f, start: 1, end: Infinity, single: single && fs2.length === 1, cwd });
    }
  });
  return spans;
}

/** Text of a tool_result's content (string or blocks). */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  return '';
}

/** Lines of output a Bash result carries (trailing newline ignored). */
function outputLines(text) {
  if (!text) return 0;
  return text.replace(/\n$/, '').split('\n').length;
}

/**
 * Parse a stream-json transcript (array of events) into the per-question record (pure).
 * @returns {{tool_calls, by_tool, reads: [{tool, file, start, end, mode, lessons}], read_lessons,
 *   read_limit_errors, permission_denials, other_errors, errors: [...], result_text, ids, result}}
 */
function parseTranscript(events, stagedDir, ranges) {
  const uses = new Map();
  const order = [];
  const results = new Map();
  let result = null;
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const c of ev.message.content) if (c && c.type === 'tool_use') { uses.set(c.id, c); order.push(c.id); }
    } else if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
      for (const c of ev.message.content) if (c && c.type === 'tool_result') results.set(c.tool_use_id, c);
    } else if (ev.type === 'result') {
      result = ev;
    }
  }
  const byTool = {};
  const reads = [];
  const errors = [];
  let readLimit = 0;
  let perm = 0;
  let other = 0;
  const readLessons = [];
  const note = (ids) => { for (const id of ids) if (!readLessons.includes(id)) readLessons.push(id); };
  for (const id of order) {
    const u = uses.get(id);
    byTool[u.name] = (byTool[u.name] || 0) + 1;
    const r = results.get(id);
    const text = r ? resultText(r.content) : '';
    const isErr = !!(r && r.is_error);
    if (isErr) {
      const kind = READ_LIMIT_RX.test(text) ? 'read_limit' : PERMISSION_RX.test(text) ? 'permission' : 'other';
      if (kind === 'read_limit') readLimit++; else if (kind === 'permission') perm++; else other++;
      errors.push({ tool: u.name, kind, input: u.input, message: text.slice(0, 300) });
      continue; // an error covers nothing
    }
    const inp = u.input || {};
    if (u.name === 'Read') {
      const file = refFile(inp.file_path, stagedDir);
      if (!file) continue;
      const start = Number.isFinite(Number(inp.offset)) && Number(inp.offset) > 0 ? Number(inp.offset) : 1;
      const hasLimit = Number.isFinite(Number(inp.limit)) && Number(inp.limit) > 0;
      const span = hasLimit
        ? { file, start, end: start + Number(inp.limit) - 1, mode: 'range' }
        : { file, start, end: start + READ_DEFAULT_LINES - 1, mode: 'whole' };
      const lessons = lessonsCovered(span, ranges);
      reads.push({ tool: 'Read', ...span, lessons });
      note(lessons);
    } else if (u.name === 'Bash') {
      const lines = outputLines(text);
      for (const s of bashReadSpans(String(inp.command || ''))) {
        const file = refFile(s.file, stagedDir, s.cwd);
        if (!file) continue;
        let end = s.end;
        if (s.single) end = Math.min(end, s.start + Math.max(lines, 0) - 1);
        // A multi-command span to EOF (cat among others): the file's own length, when known.
        if (!Number.isFinite(end)) end = ranges.fileLines ? ranges.fileLines(file) : s.start + Math.max(lines, 0) - 1;
        if (end < s.start) continue;
        const span = { file, start: s.start, end, mode: 'range' };
        const lessons = lessonsCovered(span, ranges);
        reads.push({ tool: 'Bash', command: String(inp.command).slice(0, 200), ...span, lessons });
        note(lessons);
      }
    }
  }
  const resultTextOut = result && typeof result.result === 'string' ? result.result : '';
  return {
    tool_calls: order.length, by_tool: byTool, reads, read_lessons: readLessons, read_counted: readLessons.slice(0, READ_CAP),
    read_limit_errors: readLimit, permission_denials: perm, other_errors: other, errors,
    result_text: resultTextOut, ids: parseIds(resultTextOut),
    cost_usd: result ? result.total_cost_usd || 0 : 0, usage: result ? CC.usageOf(result) : null,
    duration_ms: result ? result.duration_ms || null : null, num_turns: result ? result.num_turns || null : null,
    result_subtype: result ? result.subtype || null : null, result_is_error: result ? !!result.is_error : null,
  };
}

/** Lesson ids on the last `IDS:` line of a reply (pure). */
function parseIds(text) {
  const lines = String(text || '').split('\n').filter((l) => /^\s*\**\s*IDS\s*:/i.test(l));
  if (!lines.length) return null;
  const last = lines[lines.length - 1].replace(/^\s*\**\s*IDS\s*:\s*/i, '');
  return [...new Set((last.match(/\d+/g) || []).map(Number))];
}

// ---------------------------------------------------------------------------
// Scoring (pure)
// ---------------------------------------------------------------------------

/** Wilson score interval for k successes of n at 95%. */
function wilson(k, n, z = 1.959963984540054) {
  if (!n) return { p: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** Exact two-sided McNemar p from discordant counts b, c (binomial, p = 0.5). */
function mcnemarExact(b, c) {
  const n = b + c;
  if (!n) return 1;
  const k = Math.min(b, c);
  let logC = 0;
  let tail = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
    if (i <= k) tail += Math.exp(logC - n * Math.LN2);
  }
  return Math.min(1, 2 * tail);
}

/** Scoring relevance: the judged set, else the source lesson alone (an unjudged stratum/split). */
function relevanceOf(q) {
  if (q.relevant) return { rel: q.relevant, basis: 'judged' };
  if (q.lesson_id !== null && q.lesson_id !== undefined) return { rel: { [q.lesson_id]: 2 }, basis: 'source-only' };
  return { rel: null, basis: 'none' };
}
const relOf = (q) => relevanceOf(q).rel;

const hitAny = (ids, rel) => !!(ids && rel && ids.some((id) => (rel[id] || 0) >= 1));
const median = (xs) => { const a = xs.filter((x) => x != null).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function summarize(records, questions, baseline) {
  const byQ = new Map(questions.map((q) => [q.qid, q]));
  const groups = new Map();
  for (const r of records) {
    const q = byQ.get(r.qid);
    if (!q) continue;
    const k = `${q.stratum}|${q.split}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ r, q });
  }
  const base = baseline ? new Map(baseline.questions.map((b) => [b.qid, b])) : null;
  const rows = [];
  for (const [k, items] of [...groups.entries()].sort()) {
    const [stratum, split] = k.split('|');
    const n = items.length;
    const readHits = items.filter(({ r, q }) => hitAny(r.read_counted, relOf(q))).length;
    const citeHits = items.filter(({ r, q }) => hitAny(r.ids, relOf(q))).length;
    const hasPooled = items.some(({ q }) => q.relevant_pooled);
    const row = {
      stratum, split, n,
      read_at: { k: readHits, ...wilson(readHits, n) },
      cited_at: { k: citeHits, ...wilson(citeHits, n) },
      ...(hasPooled ? {
        read_at_pooled: (() => { const x = items.filter(({ r, q }) => hitAny(r.read_counted, q.relevant_pooled || relOf(q))).length; return { k: x, ...wilson(x, n) }; })(),
      } : {}),
      source_only_relevance: items.filter(({ q }) => relevanceOf(q).basis === 'source-only').length,
      no_ids_line: items.filter(({ r }) => r.ids === null).length,
      read_limit_errors: items.reduce((t, { r }) => t + r.read_limit_errors, 0),
      permission_denials: items.reduce((t, { r }) => t + r.permission_denials, 0),
      other_tool_errors: items.reduce((t, { r }) => t + r.other_errors, 0),
      median_cost_usd: median(items.map(({ r }) => r.cost_usd)),
      total_cost_usd: items.reduce((t, { r }) => t + (r.cost_usd || 0), 0),
      median_latency_ms: median(items.map(({ r }) => r.duration_ms)),
      median_tool_calls: median(items.map(({ r }) => r.tool_calls)),
      median_lessons_read: median(items.map(({ r }) => r.read_lessons.length)),
      median_input_tokens: median(items.map(({ r }) => r.usage && (r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens))),
      median_output_tokens: median(items.map(({ r }) => r.usage && r.usage.output_tokens)),
      tool_calls_by_tool: items.reduce((m, { r }) => { for (const [t, c] of Object.entries(r.by_tool)) m[t] = (m[t] || 0) + c; return m; }, {}),
    };
    if (base) {
      row.paired = {};
      for (const arm of ['keyword', 'fused']) {
        let both = 0; let agentOnly = 0; let baseOnly = 0; let neither = 0; let m = 0;
        for (const { r, q } of items) {
          const b = base.get(q.qid);
          if (!b || !b[arm]) continue;
          m++;
          const a = hitAny(r.read_counted, relOf(q));
          const s = !!b[arm].hit3;
          if (a && s) both++; else if (a) agentOnly++; else if (s) baseOnly++; else neither++;
        }
        row.paired[arm] = { n: m, agent: { k: both + agentOnly, ...wilson(both + agentOnly, m) }, search: { k: both + baseOnly, ...wilson(both + baseOnly, m) }, agent_only: agentOnly, search_only: baseOnly, net: agentOnly - baseOnly, mcnemar_p: mcnemarExact(agentOnly, baseOnly) };
      }
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** The prompt for one question (pure). */
function buildPrompt(armText, question, stagedDir) {
  let body = armText.split('${CLAUDE_SKILL_DIR}').join(stagedDir);
  const q = String(question).replace(/\s+/g, ' ').trim();
  body = body.includes('$ARGUMENTS') ? body.split('$ARGUMENTS').join(q) : `${body.trimEnd()}\n\nTopic requested: ${q}`;
  return `Base directory for this skill: ${stagedDir}\n\n${body.trimEnd()}\n\n${IDS_INSTRUCTION}\n`;
}

function stageSkill(skillDir) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-agentic-'));
  const staged = path.join(fs.realpathSync(root), path.basename(skillDir));
  fs.cpSync(skillDir, staged, { recursive: true, filter: (src) => !/\/(node_modules|\.git)(\/|$)/.test(src) });
  return staged;
}

async function runOne(q, ctx) {
  const recFile = path.join(ctx.out, `${q.qid}.json`);
  if (fs.existsSync(recFile)) return JSON.parse(fs.readFileSync(recFile, 'utf8'));
  const prompt = buildPrompt(ctx.armText, q.text, ctx.staged);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-agentic-cwd-'));
  const t0 = Date.now();
  const r = await CC.spawnClaude(prompt, flagsFor(ctx.staged, ctx.model), { cwd, timeoutMs: TIMEOUT_MS });
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.writeFileSync(path.join(ctx.out, `${q.qid}.stream.jsonl`), r.stdout);
  const events = r.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const parsed = parseTranscript(events, ctx.staged, ctx.ranges);
  CC.record({ tag: 'agentic-run', model: ctx.model, cost_usd: parsed.cost_usd, ms: Date.now() - t0, code: r.code, qid: q.qid, ...(parsed.usage || {}) });
  const rec = { qid: q.qid, stratum: q.stratum, split: q.split, exit_code: r.code, wall_ms: Date.now() - t0, stderr: r.stderr.slice(0, 2000), ...parsed };
  if (r.code !== 0 || !events.some((e) => e.type === 'result')) {
    process.stderr.write(`${q.qid}: exit ${r.code}, no result event; not cached (rerun retries)\n`);
    return { ...rec, failed: true };
  }
  fs.writeFileSync(recFile, JSON.stringify(rec, null, 1) + '\n');
  return rec;
}

function selectQuestions(all, o) {
  let qs = all.filter((q) => q.stratum !== 'negative' && (!o.split || q.split === o.split) && (!o.strata || o.strata.includes(q.stratum)) && (!o.qids || o.qids.includes(q.qid)));
  return qs;
}

function printTable(rows) {
  const pct = (x) => (x == null ? '   - ' : (100 * x).toFixed(1).padStart(5));
  const ci = (w) => `${pct(w.p)} [${pct(w.lo)},${pct(w.hi)}]`;
  console.log('stratum     split     n   read@ [95% CI]          cited@ [95% CI]         rlimErr perm  $med   calls');
  for (const r of rows) {
    console.log(`${r.stratum.padEnd(11)} ${r.split.padEnd(8)} ${String(r.n).padStart(3)}  ${ci(r.read_at)}  ${ci(r.cited_at)}  ${String(r.read_limit_errors).padStart(6)} ${String(r.permission_denials).padStart(4)}  ${(r.median_cost_usd || 0).toFixed(3)}  ${r.median_tool_calls}`);
    for (const [arm, p] of Object.entries(r.paired || {})) {
      console.log(`    vs ${arm.padEnd(7)} n=${p.n} agent ${pct(p.agent.p)} search ${pct(p.search.p)} agent-only ${p.agent_only} search-only ${p.search_only} net ${p.net >= 0 ? '+' : ''}${p.net} McNemar p=${p.mcnemar_p.toFixed(3)}`);
    }
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  fs.mkdirSync(o.out, { recursive: true });
  const armText = fs.readFileSync(o.armFile, 'utf8');
  const qRaw = fs.readFileSync(o.questions);
  const qdoc = JSON.parse(qRaw);
  const selected = selectQuestions(qdoc.questions, o);
  // Order randomized per arm (seeded by the arm's sha256), then --limit.
  const armSha = sha256(armText);
  const ordered = lib.seededShuffle([...selected].sort((a, b) => a.qid.localeCompare(b.qid)), lib.mulberry32(parseInt(armSha.slice(0, 8), 16))).slice(0, o.limit);
  const baseline = o.baseline ? JSON.parse(fs.readFileSync(o.baseline, 'utf8')) : null;
  const metaFile = path.join(o.out, 'run-meta.json');
  const meta = {
    arm_file: path.basename(o.armFile), arm_sha256: armSha, skill_dir: o.skillDir, questions_file: path.basename(o.questions), questions_sha256: sha256(qRaw),
    split: o.split, strata: o.strata, model: o.model, read_rule: { cover_fraction: COVER_FRACTION, read_cap: READ_CAP, read_default_lines: READ_DEFAULT_LINES, head_default_lines: HEAD_DEFAULT_LINES },
    ids_instruction: IDS_INSTRUCTION, allowed_tools: ALLOWED_TOOLS,
  };
  if (fs.existsSync(metaFile)) {
    const prev = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    for (const k of ['arm_sha256', 'questions_sha256', 'model']) if (prev[k] !== meta[k]) throw new Error(`${o.out} holds a run with a different ${k}; use a new --out`);
  }
  let records = [];
  if (!o.summaryOnly) {
    const staged = stageSkill(o.skillDir);
    const ranges = loadRanges(staged);
    meta.flags = flagsFor('<staged>', o.model).join(' ');
    meta.lessons_in_index = ranges.lessons.length;
    fs.writeFileSync(metaFile, JSON.stringify({ ...meta, started_at: new Date().toISOString() }, null, 1) + '\n');
    const ctx = { out: o.out, armText, staged, ranges, model: o.model };
    let budgetStop = null;
    records = await G.mapPool(ordered, o.concurrency, async (q) => {
      if (budgetStop) return null;
      try { return await runOne(q, ctx); } catch (err) {
        if (err instanceof CC.BudgetExceededError) { budgetStop = err.message; return null; }
        throw err;
      }
    });
    if (budgetStop) process.stderr.write(`stopped: ${budgetStop}\n`);
    fs.rmSync(path.dirname(staged), { recursive: true, force: true });
  }
  // Summary over every cached record of the selected questions (so --summary-only and resumes agree).
  records = ordered.map((q) => path.join(o.out, `${q.qid}.json`)).filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const rows = summarize(records, qdoc.questions, baseline);
  const summary = { ...meta, generated_at: new Date().toISOString(), selected: ordered.length, completed: records.length, baseline_file: o.baseline ? path.basename(o.baseline) : null, rows };
  fs.writeFileSync(path.join(o.out, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  printTable(rows);
  console.log(`${records.length}/${ordered.length} questions; total $${records.reduce((t, r) => t + (r.cost_usd || 0), 0).toFixed(2)}; summary in ${path.join(o.out, 'summary.json')}`);
}

module.exports = {
  READ_CAP, IDS_INSTRUCTION, ALLOWED_TOOLS, flagsFor,
  parseIndex, loadRanges, lessonsCovered, refFile, shellSegments, shellWords, bashReadSpans,
  parseTranscript, parseIds, wilson, mcnemarExact, summarize, buildPrompt, selectQuestions, relevanceOf,
};

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`ERROR: ${err.message}\n`); process.exit(1); });
}
