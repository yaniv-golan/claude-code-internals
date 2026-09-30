#!/usr/bin/env node
/**
 * Offline tests for agentic-run.js: lesson-range mapping, Read/sed/head/cat parsing and the
 * frozen read@ rule, on synthetic index text and synthetic stream-json transcripts. No model
 * calls. Run: node --test evals/retrieval/agentic-run.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const A = require('./agentic-run.js');

const STAGED = '/tmp/stage/claude-code-internals';
const REF = (f) => `${STAGED}/references/${f}`;

const INDEX = [
  '# Lesson index, part 1 of 1. Generated; do not edit.',
  'One line per lesson: id · title · Lesson N · file:start-end · description · asks: ...',
  '',
  '1 · Boot Sequence · Lesson 01 · 01-core.md:25-232 · How it boots · asks: why is startup slow',
  '2 · Query Engine · Lesson 04 · 01-core.md:236-501 · asks: retries',
  '3 · Tiny · Lesson 05 · 01-core.md:502-520 · asks: tiny',
  '89 · Cowork Runtime · Lesson 89 · 17-big.md:83-2064 · asks: background · read-more: https://x/?ref=skill',
  '    ↳ 17-big.md:83-990 · What this release is',
  '    ↳ 17-big.md:991-1702 · Tool architecture',
  '    ↳ 17-big.md:1703-2064 · Implications',
  '90 · After Big · Lesson 90 · 17-big.md:2066-2100 · asks: after',
].join('\n');

function ranges(fileLines = { '01-core.md': 600, '17-big.md': 2100 }) {
  const lessons = A.parseIndex(INDEX);
  const byFile = new Map();
  for (const l of lessons) { if (!byFile.has(l.file)) byFile.set(l.file, []); byFile.get(l.file).push(l); }
  return { lessons, byFile, fileLines: (f) => fileLines[f] || 0 };
}

// A transcript builder: [tool_use input, tool_result {text, is_error}] pairs plus a result event.
function transcript(calls, finalText = 'answer\nIDS: 1, 2', extra = {}) {
  const ev = [{ type: 'system', subtype: 'init' }];
  calls.forEach(([name, input, res], i) => {
    const id = `tu_${i}`;
    ev.push({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
    ev.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: res.blocks ? [{ type: 'text', text: res.text }] : res.text, is_error: !!res.is_error }] } });
  });
  ev.push({ type: 'result', subtype: 'success', result: finalText, total_cost_usd: 0.12, duration_ms: 3456, num_turns: calls.length + 1, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 }, ...extra });
  return ev;
}
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

test('parseIndex: lesson ranges, Lesson N ignored, sub-ranges attach to the lesson above', () => {
  const ls = A.parseIndex(INDEX);
  assert.deepStrictEqual(ls.map((l) => [l.id, l.file, l.start, l.end, l.subs.length]), [
    [1, '01-core.md', 25, 232, 0], [2, '01-core.md', 236, 501, 0], [3, '01-core.md', 502, 520, 0],
    [89, '17-big.md', 83, 2064, 3], [90, '17-big.md', 2066, 2100, 0],
  ]);
  assert.deepStrictEqual(ls[3].subs[1], { start: 991, end: 1702 });
});

test('lessonsCovered: the 50% rule on the range or on one sub-range', () => {
  const R = ranges();
  // Lesson 1 is 208 lines: 104 lines covered is exactly 50% -> read; 103 -> not.
  assert.deepStrictEqual(A.lessonsCovered({ file: '01-core.md', start: 25, end: 128, mode: 'range' }, R), [1]);
  assert.deepStrictEqual(A.lessonsCovered({ file: '01-core.md', start: 25, end: 127, mode: 'range' }, R), []);
  // A span across two lessons counts each that is >= 50% covered.
  assert.deepStrictEqual(A.lessonsCovered({ file: '01-core.md', start: 100, end: 400, mode: 'range' }, R), [1, 2]);
  // Lesson 89 (1982 lines) is never 50% covered by one 700-line Read, but its sub-range 991-1702 is.
  assert.deepStrictEqual(A.lessonsCovered({ file: '17-big.md', start: 991, end: 1702, mode: 'range' }, R), [89]);
  assert.deepStrictEqual(A.lessonsCovered({ file: '17-big.md', start: 991, end: 1340, mode: 'range' }, R), [], '49% of a sub-range is not a read');
  // Another file's ranges never match.
  assert.deepStrictEqual(A.lessonsCovered({ file: '02-other.md', start: 1, end: 9999, mode: 'range' }, R), []);
});

test('lessonsCovered: a Read without a limit counts only lessons wholly inside its first 2000 lines', () => {
  const R = ranges();
  assert.deepStrictEqual(A.lessonsCovered({ file: '01-core.md', start: 1, end: 2000, mode: 'whole' }, R), [1, 2, 3]);
  assert.deepStrictEqual(A.lessonsCovered({ file: '17-big.md', start: 1, end: 2000, mode: 'whole' }, R), [], 'lesson 89 ends at 2064');
  assert.deepStrictEqual(A.lessonsCovered({ file: '17-big.md', start: 100, end: 2099, mode: 'whole' }, R), [], 'lesson 89 starts before 100; lesson 90 ends at 2100');
});

test('shell parsing: segments, quotes, and the read spans of sed -n / head / cat', () => {
  assert.deepStrictEqual(A.shellSegments("sed -n '1,5p' a | head -3 && echo 'x|y'").map((s) => [s.text, s.op]), [["sed -n '1,5p' a", '|'], ['head -3', '&&'], ["echo 'x|y'", null]]);
  assert.deepStrictEqual(A.shellWords(`sed -n "10,20p" '/a b/c.md'`), ['sed', '-n', '10,20p', '/a b/c.md']);
  assert.deepStrictEqual(A.bashReadSpans(`sed -n '236,501p' ${REF('01-core.md')}`), [{ file: REF('01-core.md'), start: 236, end: 501, single: true, cwd: null }]);
  assert.deepStrictEqual(A.bashReadSpans(`sed -n '40p' f.md`)[0].end, 40);
  assert.deepStrictEqual(A.bashReadSpans(`sed -n '40,$p' f.md`)[0].end, Infinity);
  assert.deepStrictEqual(A.bashReadSpans(`head -n 300 f.md`)[0], { file: 'f.md', start: 1, end: 300, single: true, cwd: null });
  assert.deepStrictEqual(A.bashReadSpans(`head -50 f.md`)[0].end, 50);
  assert.deepStrictEqual(A.bashReadSpans(`head f.md`)[0].end, 10);
  assert.deepStrictEqual(A.bashReadSpans(`cat f.md`)[0].end, Infinity);
  // Filtered output counts nothing; neither does a command reading a pipe.
  assert.deepStrictEqual(A.bashReadSpans(`sed -n '1,500p' f.md | grep hooks`), []);
  assert.deepStrictEqual(A.bashReadSpans(`grep -n x f.md | head -5`), []);
  assert.deepStrictEqual(A.bashReadSpans(`sed '1,5p' f.md`), [], 'sed without -n prints everything; not a range read');
  assert.deepStrictEqual(A.bashReadSpans(`grep -n hooks f.md`), []);
  // cd then a relative path.
  const s = A.bashReadSpans(`cd ${STAGED}/references && sed -n '25,232p' 01-core.md`);
  assert.deepStrictEqual([s[0].file, s[0].cwd, s[0].single], ['01-core.md', `${STAGED}/references`, true]);
  // Two reads in one command: neither is "single".
  assert.deepStrictEqual(A.bashReadSpans(`sed -n '1,9p' a.md; sed -n '1,9p' b.md`).map((x) => x.single), [false, false]);
});

test('parseTranscript: Read with offset/limit, Read without limit, sed, head, cat, errors, cap of 4', () => {
  const R = ranges();
  const ev = transcript([
    ['Read', { file_path: REF('routing/index-1.md') }, { text: 'index...' }],
    ['Grep', { pattern: 'x', path: REF('routing/sections.md'), output_mode: 'content', '-n': true }, { text: '89 · 17-big.md:995 · x' }],
    ['Read', { file_path: REF('17-big.md'), offset: 991, limit: 712 }, { text: lines(712), blocks: true }],
    ['Read', { file_path: REF('17-big.md') }, { text: 'File content (40000 tokens) exceeds maximum allowed tokens (25000).', is_error: true }],
    ['Bash', { command: `sed -n '236,501p' ${REF('01-core.md')}` }, { text: lines(266) }],
    ['Bash', { command: `head -n 232 ${REF('01-core.md')}` }, { text: lines(232) }],
    ['Read', { file_path: REF('01-core.md'), offset: 502, limit: 19 }, { text: lines(19) }],
    ['Read', { file_path: REF('17-big.md'), offset: 2066, limit: 35 }, { text: lines(35) }],
    ['Bash', { command: 'rm -rf /' }, { text: 'Permission to use Bash with command rm -rf / has been denied.', is_error: true }],
  ]);
  const r = A.parseTranscript(ev, STAGED, R);
  assert.deepStrictEqual(r.read_lessons, [89, 2, 1, 3, 90]);
  assert.deepStrictEqual(r.read_counted, [89, 2, 1, 3], 'only the first 4 distinct lessons count');
  assert.deepStrictEqual(r.by_tool, { Read: 5, Grep: 1, Bash: 3 });
  assert.strictEqual(r.tool_calls, 9);
  assert.strictEqual(r.read_limit_errors, 1);
  assert.strictEqual(r.permission_denials, 1);
  assert.strictEqual(r.other_errors, 0);
  assert.deepStrictEqual(r.ids, [1, 2]);
  assert.strictEqual(r.cost_usd, 0.12);
  assert.deepStrictEqual(r.usage, { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 });
  assert.strictEqual(r.duration_ms, 3456);
});

test('parseTranscript: a Bash read is cut to the lines it returned; a failed call covers nothing', () => {
  const R = ranges();
  // cat of the whole file, output truncated to 100 lines: lesson 1 (25-232) is not 50% covered.
  let r = A.parseTranscript(transcript([['Bash', { command: `cat ${REF('01-core.md')}` }, { text: lines(100) }]]), STAGED, R);
  assert.deepStrictEqual(r.read_lessons, []);
  r = A.parseTranscript(transcript([['Bash', { command: `cat ${REF('01-core.md')}` }, { text: lines(600) }]]), STAGED, R);
  assert.deepStrictEqual(r.read_lessons, [1, 2, 3]);
  // A Read that errored for any reason covers nothing.
  r = A.parseTranscript(transcript([['Read', { file_path: REF('01-core.md'), offset: 25, limit: 208 }, { text: 'boom', is_error: true }]]), STAGED, R);
  assert.deepStrictEqual([r.read_lessons, r.other_errors], [[], 1]);
  // A relative path (the cwd is an empty dir) or a path outside the staged references is ignored.
  r = A.parseTranscript(transcript([['Read', { file_path: 'references/01-core.md', offset: 25, limit: 208 }, { text: lines(208) }]]), STAGED, R);
  assert.deepStrictEqual(r.read_lessons, []);
  // A Read with offset but no limit: whole lessons within [offset, offset+1999].
  r = A.parseTranscript(transcript([['Read', { file_path: REF('01-core.md'), offset: 236 }, { text: lines(365) }]]), STAGED, R);
  assert.deepStrictEqual(r.read_lessons, [2, 3]);
});

test('parseIds: last IDS line wins; missing line is null; markdown bold tolerated', () => {
  assert.deepStrictEqual(A.parseIds('x\nIDS: 3, 88,  12\n'), [3, 88, 12]);
  assert.deepStrictEqual(A.parseIds('IDS: 1\nmore\n**IDS:** 7, 7, 9'), [7, 9]);
  assert.strictEqual(A.parseIds('no line here'), null);
  assert.deepStrictEqual(A.parseIds('IDS: none'), []);
});

test('buildPrompt: base-directory line, $ARGUMENTS and ${CLAUDE_SKILL_DIR} substituted, IDS instruction appended', () => {
  const p = A.buildPrompt('Topic requested: $ARGUMENTS\n\nFiles in `${CLAUDE_SKILL_DIR}/references`.\n', 'why  is\nstartup slow?', STAGED);
  assert.ok(p.startsWith(`Base directory for this skill: ${STAGED}\n\nTopic requested: why is startup slow?\n`));
  assert.ok(p.includes(`\`${STAGED}/references\``));
  assert.ok(!p.includes('$ARGUMENTS') && !p.includes('${CLAUDE_SKILL_DIR}'));
  assert.ok(p.trimEnd().endsWith(A.IDS_INSTRUCTION));
  const q = A.buildPrompt('No slot here.', 'q?', STAGED);
  assert.ok(q.includes('Topic requested: q?'));
});

test('flags: read-only Bash allowlist, no bypassPermissions, prompts denied, staged dir added', () => {
  const f = A.flagsFor('/s', 'claude-sonnet-5');
  const allowed = f[f.indexOf('--allowedTools') + 1];
  assert.ok(allowed.includes('Bash(sed -n:*)') && allowed.includes('Bash(grep:*)'));
  assert.ok(!/Bash\)|Bash,|Bash$/.test(allowed.replace(/Bash\([^)]*\)/g, '')), 'no unrestricted Bash');
  assert.ok(!f.includes('bypassPermissions') && !f.includes('--dangerously-skip-permissions'));
  assert.deepStrictEqual(f.slice(f.indexOf('--permission-prompts'), f.indexOf('--permission-prompts') + 2), ['--permission-prompts', 'none']);
  assert.strictEqual(f[f.indexOf('--add-dir') + 1], '/s');
  assert.ok(f.includes('--safe-mode') && f.includes('stream-json') && f.includes('--verbose'));
});

test('wilson and McNemar', () => {
  const w = A.wilson(90, 100);
  assert.ok(Math.abs(w.lo - 0.8256) < 0.001 && Math.abs(w.hi - 0.9448) < 0.001, JSON.stringify(w));
  assert.deepStrictEqual(A.wilson(0, 0), { p: null, lo: null, hi: null });
  assert.strictEqual(A.mcnemarExact(0, 0), 1);
  assert.ok(Math.abs(A.mcnemarExact(0, 6) - 0.03125) < 1e-9);
  assert.ok(Math.abs(A.mcnemarExact(3, 3) - 1) < 1e-9);
});

test('summarize: read@/cited@ per stratum x split and the paired comparison', () => {
  const qs = [
    { qid: 'a', stratum: 'plain', split: 'dev', relevant: { 1: 2, 5: 1 } },
    { qid: 'b', stratum: 'plain', split: 'dev', relevant: { 2: 2 } },
    { qid: 'c', stratum: 'plain', split: 'dev', relevant: { 3: 2 }, relevant_pooled: { 3: 2, 9: 1 } },
  ];
  const rec = (qid, read, ids) => ({ qid, read_counted: read, read_lessons: read, ids, by_tool: { Read: 1 }, tool_calls: 1, read_limit_errors: 0, permission_denials: 0, other_errors: 0, cost_usd: 0.1, duration_ms: 10, usage: null });
  const records = [rec('a', [5], [5]), rec('b', [7], null), rec('c', [9], [3])];
  const baseline = { questions: [{ qid: 'a', keyword: { hit3: false }, fused: { hit3: true } }, { qid: 'b', keyword: { hit3: true }, fused: { hit3: false } }, { qid: 'c', keyword: { hit3: true }, fused: { hit3: true } }] };
  const [row] = A.summarize(records, qs, baseline);
  assert.deepStrictEqual([row.n, row.read_at.k, row.cited_at.k, row.no_ids_line, row.read_at_pooled.k], [3, 1, 2, 1, 2]);
  assert.deepStrictEqual([row.paired.keyword.agent_only, row.paired.keyword.search_only, row.paired.keyword.net], [1, 2, -1]);
  assert.deepStrictEqual([row.paired.fused.agent_only, row.paired.fused.search_only], [0, 1]);
});
