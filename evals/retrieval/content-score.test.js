#!/usr/bin/env node
/**
 * Offline tests for content-score.js on a synthetic corpus in a temp dir. No model calls.
 * Run: node --test evals/retrieval/content-score.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CS = require('./content-score.js');
const A = require('./agentic-run.js');

const line = (tag, i) => `${tag} line number ${String(i).padStart(3, '0')} with enough text`;

function makeSkill() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
  const R = path.join(dir, 'references');
  fs.mkdirSync(path.join(R, 'state'), { recursive: true });
  // Lesson 1 = lines 1-30, lesson 2 = lines 31-40 (shorter than MIN_LINES).
  const lesson = [];
  for (let i = 1; i <= 40; i++) lesson.push(i % 5 === 0 ? '' : line(i <= 30 ? 'alpha' : 'beta', i));
  fs.writeFileSync(path.join(R, '01-core.md'), lesson.join('\n'));
  fs.writeFileSync(path.join(R, 'topic-index.json'), JSON.stringify({ lessons: [
    { id: 1, file: '01-core.md', startLine: 1, endLine: 30 },
    { id: 2, file: '01-core.md', startLine: 31, endLine: 40 },
  ] }));
  const page = ['# Page', '', '## Section one'];
  for (let i = 1; i <= 25; i++) page.push(line('state', i));
  page.push('## Section two', line('other', 1));
  fs.writeFileSync(path.join(R, 'state', 'domain.md'), page.join('\n'));
  fs.writeFileSync(path.join(R, 'state', 'registry.json'), JSON.stringify({ entries: [
    { id: 'env.FOO_ONE', name: 'FOO_ONE', summary: 'Identity quad, set when accountId and email are present.' },
    { id: 'env.FOO_TWO', name: 'FOO_TWO', summary: 'Identity quad, set when accountId and email are present.' },
  ] }));
  return dir;
}

const userResult = (text, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: text, is_error: isError }] } });

test('a contiguous read credits the lesson; prefixes from grep -n and Read are stripped', () => {
  const C = CS.buildCorpus(makeSkill());
  const grep = [];
  for (let i = 1; i <= 25; i++) grep.push(`/x/references/01-core.md-${i}-${line('alpha', i)}`);
  assert.deepStrictEqual(CS.creditResult(grep.join('\n'), C).lessons, [1]);
  const read = [];
  for (let i = 3; i <= 24; i++) read.push(`${String(i).padStart(6)}→${line('alpha', i)}`);
  assert.deepStrictEqual(CS.creditResult(read.join('\n'), C).lessons, [1]);
});

test('fewer than MIN_LINES lines does not count; a short lesson counts when shown whole', () => {
  const C = CS.buildCorpus(makeSkill());
  const few = [];
  for (let i = 1; i <= 10; i++) few.push(line('alpha', i));
  assert.deepStrictEqual(CS.creditResult(few.join('\n'), C).lessons, []);
  const shortWhole = [];
  for (let i = 31; i <= 40; i++) shortWhole.push(line('beta', i));
  assert.ok(CS.creditResult(shortWhole.join('\n'), C).lessons.includes(2));
});

test('scattered matches far apart are not bridged into a span', () => {
  const C = CS.buildCorpus(makeSkill());
  const scattered = [1, 7, 13, 19, 26].map((i) => line('alpha', i)).join('\n');
  assert.deepStrictEqual(CS.creditResult(scattered, C).lessons, []);
});

test('state sections and registry entries; a shared summary needs the entry name too', () => {
  const C = CS.buildCorpus(makeSkill());
  const sec = [];
  for (let i = 1; i <= 25; i++) sec.push(line('state', i));
  assert.deepStrictEqual(CS.creditResult(sec.join('\n'), C).sections, ['state/domain.md#3']);
  const reg = '[env-var] FOO_ONE — live\n    Identity quad, set when accountId and email are present.';
  assert.deepStrictEqual(CS.creditResult(reg, C).registry, ['env.FOO_ONE']);
});

test('scoreTranscript ignores error results', () => {
  const C = CS.buildCorpus(makeSkill());
  const body = [];
  for (let i = 1; i <= 25; i++) body.push(line('alpha', i));
  assert.deepStrictEqual(CS.scoreTranscript([userResult(body.join('\n'), true)], C).content_lessons, []);
  assert.deepStrictEqual(CS.scoreTranscript([userResult(body.join('\n'))], C).content_lessons, [1]);
});

test('buildPrompt strips a SKILL.md frontmatter block', () => {
  const p = A.buildPrompt('---\nname: x\ncontext: fork\n---\nQuestion: $ARGUMENTS\n', 'why?', '/tmp/s');
  assert.ok(!p.includes('context: fork'));
  assert.ok(p.includes('Question: why?'));
});

test('stageSkill with a plugin bin: skills/<name> beside bin/, the launcher resolves the scripts', () => {
  const src = makeSkill();
  fs.mkdirSync(path.join(src, 'scripts'));
  fs.writeFileSync(path.join(src, 'scripts', 'hello.sh'), 'echo hi');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-bin-'));
  fs.writeFileSync(path.join(bin, 'tool'), '#!/usr/bin/env bash\nexec bash "$(dirname "$0")/../skills/' + path.basename(src) + '/scripts/hello.sh"\n', { mode: 0o755 });
  const s = A.stageSkill(src, bin);
  try {
    assert.strictEqual(path.basename(path.dirname(s.staged)), 'skills');
    assert.strictEqual(require('child_process').execFileSync(path.join(s.binDir, 'tool')).toString().trim(), 'hi');
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
