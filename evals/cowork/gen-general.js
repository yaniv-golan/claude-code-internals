#!/usr/bin/env node
'use strict';
/**
 * gen-general.js — the GENERAL arm of the cowork-harness suite (see README.md).
 *
 * Two steps, both deterministic except the one model call:
 *
 *   node gen-general.js generate [--seed N] [--count N] [--model M]
 *       Picks N plain-language DEV questions from ../retrieval/questions-v2.json by a seeded
 *       shuffle (no hand picking), slices each source lesson exactly as fetch-lesson.js does
 *       (lib.getLessonText), and asks a model for the rubric claims a correct answer must make.
 *       Writes claims/general-claims.json with the generator model id, prompt version, and the
 *       sha256 of every lesson slice the claims were generated from. Claims are never hand-edited:
 *       to change them, change the prompt (bump PROMPT_VERSION) and regenerate.
 *
 *   node gen-general.js write
 *       Renders scenarios/g-<qid>.yaml from claims/general-claims.json. No model call.
 *
 *   node gen-general.js check
 *       Exits 1 if any source lesson slice no longer hashes to the recorded value (the claims
 *       were generated from text that has since changed — regenerate before trusting them).
 *
 * The model is called like ../retrieval/gen-relevance.js does: `claude -p` with --safe-mode and
 * no tools, stdin ignored, cwd a fresh temp dir so this repo's CLAUDE.md cannot steer it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const lib = require('../retrieval/lib.js');
const G = require('../retrieval/gen-questions.js');

const HERE = __dirname;
const QUESTIONS = path.join(HERE, '..', 'retrieval', 'questions-v2.json');
const CLAIMS = path.join(HERE, 'claims', 'general-claims.json');
const SCEN_DIR = path.join(HERE, 'scenarios');

const PROMPT_VERSION = 'claims-v1';
const DEFAULT_MODEL = 'claude-fable-5-1'; // neither the answering model (sonnet-5) nor the judge (opus-5-5)
const DEFAULT_SEED = 1;
const DEFAULT_COUNT = 10;
const MODEL_FLAGS = ['--safe-mode', '--tools', ''];
const JUDGE_MODEL = 'claude-opus-5-5';
const PROMPT_PREFIX = 'Using the claude-code-internals skill: ';

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function parseArgs(argv) {
  const o = { cmd: argv[0], seed: DEFAULT_SEED, count: DEFAULT_COUNT, model: DEFAULT_MODEL };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--seed') o.seed = Number(argv[++i]);
    else if (argv[i] === '--count') o.count = Number(argv[++i]);
    else if (argv[i] === '--model') o.model = argv[++i];
    else throw new Error(`unknown arg ${argv[i]}`);
  }
  return o;
}

function lessonById() {
  const m = new Map();
  for (const l of lib.loadTopicIndex().lessons) m.set(String(l.id), l);
  return m;
}

function pickQuestions(seed, count) {
  const qs = JSON.parse(fs.readFileSync(QUESTIONS, 'utf8')).questions
    .filter((q) => q.stratum === 'plain' && q.split === 'dev')
    .sort((a, b) => (a.qid < b.qid ? -1 : 1));
  return lib.seededShuffle(qs, lib.mulberry32(seed)).slice(0, count);
}

function buildPrompt(question, lessonText) {
  return [
    'You are writing a grading rubric for an answer-quality test.',
    'Below is a user question and the SOURCE LESSON that answers it.',
    '',
    'Write 3 to 5 claims that a correct answer to the question MUST make. Rules:',
    '- Every claim must be directly supported by the lesson text. Do not add outside knowledge.',
    '- Each claim is one discrete, independently checkable statement in plain words.',
    '- Each claim must be relevant to what the question asks — something a good answer would say.',
    '- Prefer specific, discriminating facts from the lesson (numbers, limits, conditions, orderings,',
    '  named behaviors) over generic truths any model would state without the lesson.',
    '- Do not require exact identifiers, file names, or function names when a plain paraphrase would',
    '  carry the same fact; say "(or equivalent wording)" where exact phrasing is not the point.',
    '- Never make a claim about tools, searching, citing sources, lesson numbers, links, or formatting —',
    '  only about the substance of the answer.',
    '',
    'Reply with JSON only: {"claims": ["...", "..."]}',
    '',
    `QUESTION:\n${question}`,
    '',
    `SOURCE LESSON:\n${lessonText}`,
  ].join('\n');
}

function callModel(prompt, opts) {
  return new Promise((resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-general-cwd-'));
    execFile('claude', ['-p', '--model', opts.model, ...MODEL_FLAGS, '--output-format', 'json', prompt],
      { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        fs.rmSync(tmp, { recursive: true, force: true });
        if (err) reject(new Error(`claude -p failed: ${err.message}\n${stderr}`));
        else resolve(stdout);
      });
  });
}

async function generate(o) {
  const lessons = lessonById();
  const picked = pickQuestions(o.seed, o.count);
  const out = [];
  for (const q of picked) {
    const lesson = lessons.get(String(q.lesson_id));
    if (!lesson) throw new Error(`${q.qid}: lesson id ${q.lesson_id} not in topic-index`);
    const text = lib.getLessonText(lesson);
    let claims = null;
    for (let attempt = 0; attempt < 3 && !claims; attempt++) {
      try {
        const parsed = await G.callModelJSON(callModel, buildPrompt(q.text, text), o);
        const c = Array.isArray(parsed.claims) ? parsed.claims.map(String).filter((s) => s.trim()) : [];
        if (c.length >= 3 && c.length <= 5) claims = c;
      } catch (e) { process.stderr.write(`${q.qid}: attempt ${attempt}: ${e.message}\n`); }
    }
    if (!claims) throw new Error(`${q.qid}: no valid claims after 3 attempts`);
    process.stderr.write(`${q.qid} (lesson ${lesson.id} ${lesson.title}): ${claims.length} claims\n`);
    out.push({
      qid: q.qid, lesson_id: Number(lesson.id), lesson_title: lesson.title, lesson_file: lesson.file,
      lesson_lines: [Number(lesson.startLine), Number(lesson.endLine)], lesson_sha256: sha256(text),
      question: q.text, claims,
    });
  }
  const doc = {
    generator: { model: o.model, flags: MODEL_FLAGS.join(' '), prompt_version: PROMPT_VERSION,
      prompt_sha256: sha256(buildPrompt('', '')), generated_at: new Date().toISOString() },
    selection: { source: 'evals/retrieval/questions-v2.json', stratum: 'plain', split: 'dev',
      method: 'qid-sorted, lib.seededShuffle(mulberry32(seed)), first N', seed: o.seed, count: o.count,
      questions_sha256: sha256(fs.readFileSync(QUESTIONS)) },
    judge_model: JUDGE_MODEL,
    questions: out,
  };
  fs.writeFileSync(CLAIMS, JSON.stringify(doc, null, 2) + '\n');
  process.stderr.write(`wrote ${path.relative(process.cwd(), CLAIMS)}\n`);
}

function yq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function write() {
  const doc = JSON.parse(fs.readFileSync(CLAIMS, 'utf8'));
  for (const q of doc.questions) {
    const minPass = Math.ceil(q.claims.length / 2);
    const lines = [
      `# General: ${q.qid} — source lesson id ${q.lesson_id} (${q.lesson_title}).`,
      `# GENERATED by gen-general.js from claims/general-claims.json — do not hand-edit; regenerate.`,
      `# Claims model: ${doc.generator.model} (${doc.generator.prompt_version}); lesson sha256 ${q.lesson_sha256.slice(0, 16)}.`,
      `# min_pass is a loose floor; the per-claim profile (assertions[].semanticClaims) is the real signal.`,
      `name: g-${q.qid}`,
      'session: ../sessions/hostloop-sonnet5.yaml',
      'fidelity: hostloop',
      'on_unanswered: fail',
      'timeout_ms: 900000',
      `prompt: ${yq(PROMPT_PREFIX + q.question)}`,
      'assert:',
      "  - skill_triggered: 'claude-code-internals'",
      "  - tool_no_error: '.*'",
      '  - max_tool_errors: 0',
      '  - semantic_matches:',
      `      judge_model: ${yq(doc.judge_model)}`,
      // false: judge the user-visible answer. The fork's own return is a Skill tool_result, which
      // semantic_matches never sees; `true` would add only the text of sub-agents the fork dispatched.
      '      include_subagent_text: false',
      `      min_pass: ${minPass}`,
      '      rubric:',
      ...q.claims.map((c) => `        - ${yq(c)}`),
    ];
    const f = path.join(SCEN_DIR, `g-${q.qid}.yaml`);
    fs.writeFileSync(f, lines.join('\n') + '\n');
    process.stderr.write(`wrote ${path.relative(process.cwd(), f)}\n`);
  }
}

function check() {
  const doc = JSON.parse(fs.readFileSync(CLAIMS, 'utf8'));
  const lessons = lessonById();
  let stale = 0;
  for (const q of doc.questions) {
    const l = lessons.get(String(q.lesson_id));
    const h = l ? sha256(lib.getLessonText(l)) : null;
    if (h !== q.lesson_sha256) { stale++; console.log(`STALE ${q.qid}: lesson ${q.lesson_id} text changed`); }
  }
  console.log(stale ? `${stale} stale` : `all ${doc.questions.length} lesson slices match`);
  process.exit(stale ? 1 : 0);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.cmd === 'generate') return generate(o);
  if (o.cmd === 'write') return write();
  if (o.cmd === 'check') return check();
  throw new Error('usage: gen-general.js generate [--seed N] [--count N] [--model M] | write | check');
}

main().catch((e) => { process.stderr.write(`ERROR: ${e.message}\n`); process.exit(1); });
