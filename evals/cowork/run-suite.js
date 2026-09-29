#!/usr/bin/env node
'use strict';
/**
 * run-suite.js — runs the cowork-harness suite in one ARM and records a results manifest, then
 * compares two arms per prompt. See README.md for the paired before/after design.
 *
 *   node run-suite.js run --arm before|after|ablation [--reps 3] [--only a,b] [--dotenv <path>]
 *   node run-suite.js compare <before.jsonl> <after.jsonl>
 *   node run-suite.js derive <run-dir>            # the post-hoc checks for one kept run (debugging)
 *
 * The before/after arms run every file in scenarios/: t01-t20 and g-pl-* at hostloop, and the
 * container-tier copies c01/c02/c07/c08/c19/c20 (script path). Each manifest line carries `fidelity`.
 *
 * `run` shells out to `cowork-harness run <scenario> --repeat N --output-format json` (plus
 * --ablate-skill for the ablation arm) one scenario at a time, and appends one JSON line per rep to
 * results/<arm>-<UTC timestamp>.jsonl (gitignored). Harness run dirs stay where the harness keeps
 * them (~/.cowork-harness/runs, or $COWORK_HARNESS_RUNS_DIR); the manifest records each path.
 *
 * Per rep it keeps: verdict, every assertion's pass/fail (keyed by index + key, so a known-red
 * assertion never hides the rest), the semantic per-claim profile, cost/usage/duration, verdict
 * signals, skillHash, models, ablated, and three post-hoc measures the harness has no key for,
 * derived from `cowork-harness trace <run-dir> --output-format json --full-results`:
 *   - stateFirst: did the fork touch the state layer (state.js / references/state/) before any
 *     search/lesson access? null when neither happened.
 *   - forkChars: length of the skill's own return (the Skill tool_result, `context: fork`).
 *   - shellCalls: shell calls made inside the fork (mcp__workspace__bash / Bash).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const SCEN_DIR = path.join(HERE, 'scenarios');
const RESULTS_DIR = path.join(HERE, 'results');
const PINNED_MODEL = 'claude-sonnet-5';
// Ablation arm: the general prompts only. With the skill removed, skill_triggered and every
// fork-anchored targeted check fail by construction; the per-claim semantic profile is the one
// measure that says whether the skill adds anything over the model's priors.
const ABLATION = (f) => /^g-/.test(f);
// Container-tier copies (c01/c02/c07/c08/c19/c20) of the script-dependent targeted scenarios. They
// run in the before/after arms with everything else (all of scenarios/ is read); they need the VM ELF
// the harness pins, or COWORK_AGENT_BINARY pointing at a staged one (hostloop tolerates a patch bump,
// container does not).
const CONTAINER = (f) => /^c\d\d-/.test(f);
function fidelityOf(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^fidelity:\s*(\S+)/m);
  return m ? m[1] : null;
}

function parseArgs(argv) {
  const o = { cmd: argv[0], reps: 3, only: null, arm: null, dotenv: process.env.COWORK_DOTENV || null, rest: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arm') o.arm = argv[++i];
    else if (a === '--reps') o.reps = Number(argv[++i]);
    else if (a === '--only') o.only = argv[++i].split(',');
    else if (a === '--dotenv') o.dotenv = argv[++i];
    else o.rest.push(a);
  }
  return o;
}

function harness(args, dotenv) {
  const full = [...(dotenv ? ['--dotenv', dotenv] : []), ...args];
  return spawnSync('cowork-harness', full, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

// ---------------------------------------------------------------------------
// post-hoc measures from the trace
// ---------------------------------------------------------------------------
const STATE_RX = /scripts\/state\.js|references\/state\//;
// "Search" = any search script, any lesson file or index, or a Grep/Glob over the whole
// references/ directory (a bare-directory target: `.../references"` or `.../references/"`).
const SEARCH_RX = /scripts\/(search|semantic-search|fetch-lesson|xref|troubleshoot)\.js|scripts\/lookup\.sh|references\/(\d\d-[^"'\s]+\.md|topic-index\.json|cross-references\.json|troubleshooting\.json)|references\/?"/;
const SHELL_RX = /^(Bash|mcp__workspace__bash)$/;

function derive(runDir, dotenv) {
  const r = harness(['trace', runDir, '--output-format', 'json', '--full-results'], dotenv);
  let rows;
  try { rows = JSON.parse(r.stdout).rows || []; } catch { return { error: 'trace unparseable' }; }
  const tools = rows.filter((x) => x.kind === 'tool');
  let firstState = -1, firstSearch = -1, shellCalls = 0;
  tools.forEach((t, i) => {
    const d = t.detailFull || t.detail || '';
    if (t.child && SHELL_RX.test(t.name)) shellCalls++;
    if (!t.child) return;
    if (firstState < 0 && STATE_RX.test(d)) firstState = i;
    if (firstSearch < 0 && SEARCH_RX.test(d)) firstSearch = i;
  });
  const stateFirst = firstState < 0 && firstSearch < 0 ? null
    : firstState >= 0 && (firstSearch < 0 || firstState < firstSearch);
  return { stateFirst, forkChars: forkChars(runDir), shellCalls, forkToolCalls: tools.filter((t) => t.child).length };
}

/** Length of the skill's own return, read from events.jsonl: trace's resultTextFull stops at 500
 * chars and result.json's toolResults at 10 KB. Includes the agent's ~280-char wrapper. */
function forkChars(runDir) {
  const f = path.join(runDir, 'events.jsonl');
  if (!fs.existsSync(f)) return null;
  let n = null;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('forked execution')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'user' || e.parent_tool_use_id) continue;
    for (const c of (e.message && Array.isArray(e.message.content) ? e.message.content : [])) {
      if (c.type !== 'tool_result') continue;
      const text = typeof c.content === 'string' ? c.content
        : (c.content || []).map((x) => x.text || '').join('');
      if (/completed \(forked execution\)/.test(text)) n = (n || 0) + text.length;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
function summarize(res, meta, dotenv) {
  const a = (res.assertions || []).map((x, i) => {
    const key = Object.keys(x.assertion || {})[0];
    const rec = { i, key, pass: !!x.pass };
    if (x.semanticClaims) rec.claims = x.semanticClaims.map((c) => ({ i: c.index, pass: !!c.pass }));
    if (x.judgeInvalid) rec.judgeInvalid = true;
    return rec;
  });
  const models = (res.models || []).filter((m) => !/^</.test(m));
  const rec = {
    ...meta,
    runDir: res.outDir,
    skillHash: res.fingerprint && res.fingerprint.skillHash,
    models,
    ablated: !!res.ablated,
    skillInvoked: (res.skillsInvoked || []).some((s) => /claude-code-internals/.test(s)),
    pass: !!(res.verdict && res.verdict.pass),
    assertions: a,
    signals: ((res.verdict && res.verdict.signals) || []).map((s) => `${s.severity}:${s.code}`),
    nonDeterministic: !!res.nonDeterministic,
    costUsd: res.cost ? res.cost.usd : null,
    usage: res.usage ? { input: res.usage.input_tokens, output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens, cacheCreate: res.usage.cache_creation_input_tokens } : null,
    durationMs: res.durationMs,
    finalChars: (res.finalMessage || '').length,
    derived: res.outDir ? derive(res.outDir, dotenv) : null,
  };
  // A rep is a measurement of the arm it claims to be, or it is discarded:
  const invalid = [];
  if (meta.arm === 'ablation' && res.ablated !== true) invalid.push('ablation-unstamped');
  if (meta.arm === 'ablation' && rec.skillInvoked) invalid.push('skill-invoked-under-ablation');
  // t09 (bare slash) omits skill_triggered on purpose; everywhere else a rep without the skill
  // measured the model, not the skill.
  const expectsSkill = a.some((x) => x.key === 'skill_triggered');
  if (meta.arm !== 'ablation' && expectsSkill && !rec.skillInvoked) invalid.push('skill-not-invoked');
  if (!models.length || !models.every((m) => m === PINNED_MODEL)) invalid.push('model-not-pinned-model');
  if ((res.modelFallbacks || []).length) invalid.push('model-fallback');
  rec.valid = invalid.length === 0;
  rec.invalidReasons = invalid;
  return rec;
}

function runArm(o) {
  if (!['before', 'after', 'ablation'].includes(o.arm)) throw new Error('--arm before|after|ablation');
  let files = fs.readdirSync(SCEN_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  if (o.arm === 'ablation') files = files.filter(ABLATION);
  if (o.only) files = files.filter((f) => o.only.some((p) => f.startsWith(p)));
  if (files.some(CONTAINER) && !process.env.COWORK_AGENT_BINARY && !process.env.COWORK_HARNESS_ALLOW_AGENT_FALLBACK) {
    process.stderr.write('note: container scenarios selected and COWORK_AGENT_BINARY is unset; they fail if the baseline-pinned VM ELF is not staged (see README "Running it")\n');
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(RESULTS_DIR, `${o.arm}-${stamp}.jsonl`);
  const hashes = new Set();
  for (const f of files) {
    const args = ['run', path.join(SCEN_DIR, f), '--output-format', 'json'];
    if (o.reps >= 2) args.push('--repeat', String(o.reps));
    if (o.arm === 'ablation') args.push('--ablate-skill');
    const t0 = Date.now();
    const r = harness(args, o.dotenv);
    let env;
    try { env = JSON.parse(r.stdout); } catch {
      fs.appendFileSync(out, JSON.stringify({ arm: o.arm, scenario: f, error: 'harness output unparseable', exit: r.status, stderrTail: (r.stderr || '').slice(-2000) }) + '\n');
      process.stderr.write(`${f}: harness output unparseable (exit ${r.status})\n`);
      continue;
    }
    (env.results || []).forEach((res, rep) => {
      const rec = summarize(res, { arm: o.arm, scenario: f.replace(/\.ya?ml$/, ''), fidelity: fidelityOf(path.join(SCEN_DIR, f)), rep }, o.dotenv);
      if (rec.skillHash) hashes.add(rec.skillHash);
      fs.appendFileSync(out, JSON.stringify(rec) + '\n');
      process.stderr.write(`${rec.scenario} rep${rep}: ${rec.pass ? 'PASS' : 'FAIL'}${rec.valid ? '' : ' (INVALID rep)'} $${rec.costUsd} ${Math.round(rec.durationMs / 1000)}s\n`);
    });
    process.stderr.write(`${f}: ${Math.round((Date.now() - t0) / 1000)}s wall\n`);
  }
  if (hashes.size > 1) process.stderr.write(`WARNING: ${hashes.size} skill hashes in one arm — SKILL.md changed mid-arm; this arm is not one generation\n`);
  process.stderr.write(`manifest: ${out}\n`);
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------
function load(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error && r.valid);
}
function rate(xs) { return xs.length ? xs.filter(Boolean).length / xs.length : null; }
function fmt(x) { return x == null ? '  -  ' : `${Math.round(x * 100)}%`.padStart(5); }
function median(xs) { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; }

function compare(fa, fb) {
  const A = load(fa), B = load(fb);
  const scen = [...new Set([...A, ...B].map((r) => r.scenario))].sort();
  const regressions = [];
  for (const s of scen) {
    const a = A.filter((r) => r.scenario === s), b = B.filter((r) => r.scenario === s);
    console.log(`\n${s}  (valid reps: ${a.length} -> ${b.length}; skillHash ${[...new Set(a.map((r) => (r.skillHash || '').slice(0, 8)))]} -> ${[...new Set(b.map((r) => (r.skillHash || '').slice(0, 8)))]})`);
    const n = Math.max(0, ...[...a, ...b].map((r) => r.assertions.length));
    for (let i = 0; i < n; i++) {
      const key = ([...a, ...b].find((r) => r.assertions[i]) || { assertions: [] }).assertions[i].key;
      const ra = rate(a.map((r) => r.assertions[i] && r.assertions[i].pass));
      const rb = rate(b.map((r) => r.assertions[i] && r.assertions[i].pass));
      const flag = ra != null && rb != null && rb < ra ? '  <-- dropped' : '';
      if (flag) regressions.push(`${s} #${i} ${key}`);
      console.log(`  #${i} ${key.padEnd(30)} ${fmt(ra)} -> ${fmt(rb)}${flag}`);
      const ca = a.map((r) => r.assertions[i] && r.assertions[i].claims).filter(Boolean);
      const cb = b.map((r) => r.assertions[i] && r.assertions[i].claims).filter(Boolean);
      const nc = Math.max(0, ...[...ca, ...cb].map((c) => c.length));
      for (let c = 0; c < nc; c++) {
        const pa = rate(ca.map((x) => x[c] && x[c].pass)), pb = rate(cb.map((x) => x[c] && x[c].pass));
        const f2 = pa != null && pb != null && pb < pa ? '  <-- dropped' : '';
        if (f2) regressions.push(`${s} #${i} claim ${c}`);
        console.log(`      claim ${c}                         ${fmt(pa)} -> ${fmt(pb)}${f2}`);
      }
    }
    const d = (xs, k) => median(xs.map((r) => r.derived && r.derived[k]));
    const sf = (xs) => rate(xs.map((r) => r.derived && r.derived.stateFirst).filter((x) => x != null));
    console.log(`  stateFirst ${fmt(sf(a))} -> ${fmt(sf(b))} | forkChars p50 ${d(a, 'forkChars')} -> ${d(b, 'forkChars')} | shellCalls p50 ${d(a, 'shellCalls')} -> ${d(b, 'shellCalls')} | cost p50 ${median(a.map((r) => r.costUsd))} -> ${median(b.map((r) => r.costUsd))}`);
  }
  console.log(`\n${regressions.length} per-prompt drop(s)${regressions.length ? ':\n  ' + regressions.join('\n  ') : ''}`);
  console.log('A drop over 3 reps is a lead to read, not a verdict: open both arms\' run dirs (trace / verify-run) before calling it a regression.');
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.cmd === 'run') return runArm(o);
  if (o.cmd === 'compare') return compare(o.rest[0], o.rest[1]);
  if (o.cmd === 'derive') return console.log(JSON.stringify(derive(o.rest[0], o.dotenv), null, 2));
  throw new Error('usage: run-suite.js run --arm before|after|ablation [--reps N] [--only p1,p2] [--dotenv f] | compare <a.jsonl> <b.jsonl> | derive <run-dir>');
}

module.exports = { derive, summarize, compare };
if (require.main === module) main();
