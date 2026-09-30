#!/usr/bin/env node
/**
 * claude-call.js — the one way the eval scripts call `claude -p`.
 *
 * Every call:
 *   - writes the prompt to a file and hands that file to the child as stdin (never a
 *     prompt argument, never an inherited or piped stdin, never a `while read` loop);
 *   - runs with cwd = a fresh, empty temp directory (no CLAUDE.md, no project settings);
 *   - records its cost from the CLI's own report (`total_cost_usd` of the json envelope,
 *     or of the final `result` event of a stream-json run) in a cost ledger, when one is
 *     configured.
 *
 * Ledger and cap (optional, for a human-run generation or eval):
 *   CCI_EVAL_LEDGER=/abs/path/ledger.jsonl   one JSON line per call: {ts, tag, model, cost_usd, ...}
 *   CCI_EVAL_BUDGET_USD=45                   refuse to START a call once the ledger total reaches this
 * The cap is checked before each spawn, so concurrent calls can overshoot it by at most
 * (concurrency - 1) calls. Without CCI_EVAL_LEDGER nothing is recorded and nothing capped.
 *
 * No dependencies. CommonJS.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

class BudgetExceededError extends Error {}

function ledgerPath() {
  return process.env.CCI_EVAL_LEDGER || null;
}

function budgetUsd() {
  const v = process.env.CCI_EVAL_BUDGET_USD;
  return v ? Number(v) : Infinity;
}

/** Sum of cost_usd over a ledger file (0 when absent). */
function ledgerTotal(file = ledgerPath()) {
  if (!file || !fs.existsSync(file)) return 0;
  let total = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { total += Number(JSON.parse(line).cost_usd) || 0; } catch { /* torn line: ignore */ }
  }
  return total;
}

function checkBudget() {
  const cap = budgetUsd();
  if (!Number.isFinite(cap)) return;
  const spent = ledgerTotal();
  if (spent >= cap) throw new BudgetExceededError(`eval budget reached: $${spent.toFixed(2)} spent of $${cap} (ledger ${ledgerPath()})`);
}

function record(entry) {
  const file = ledgerPath();
  if (!file) return;
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

/** Usage summary from a json envelope or a stream-json `result` event. */
function usageOf(env) {
  const u = (env && env.usage) || {};
  return {
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_read_input_tokens: u.cache_read_input_tokens || 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
  };
}

/**
 * Spawn `claude` with `args` (no prompt argument), the prompt as stdin from a file, cwd an
 * empty temp dir. Resolves {code, stdout, stderr, ms}. Does not parse or record anything.
 *
 * @param {string} prompt
 * @param {string[]} args
 * @param {{timeoutMs?: number, cwd?: string, keepDir?: boolean}} [o]
 */
function spawnClaude(prompt, args, o = {}) {
  checkBudget();
  const promptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-eval-prompt-'));
  const cwd = o.cwd || fs.mkdtempSync(path.join(os.tmpdir(), 'cci-eval-cwd-'));
  const promptFile = path.join(promptDir, 'prompt.txt');
  fs.writeFileSync(promptFile, prompt);
  // An optional system prompt goes in a file too (--system-prompt-file), never on the command line.
  if (o.systemPrompt != null) { const spf = path.join(promptDir, 'system.txt'); fs.writeFileSync(spf, o.systemPrompt); args = [...args, '--system-prompt-file', spf]; }
  return new Promise((resolve) => {
    const fd = fs.openSync(promptFile, 'r');
    const t0 = Date.now();
    const p = spawn('claude', args, { cwd, stdio: [fd, 'pipe', 'pipe'], env: { ...process.env, ...(o.env || {}) } });
    let stdout = '';
    let stderr = '';
    let timer = null;
    if (o.timeoutMs) timer = setTimeout(() => { stderr += `\n[claude-call] killed after ${o.timeoutMs} ms`; p.kill('SIGTERM'); }, o.timeoutMs);
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => {
      if (timer) clearTimeout(timer);
      fs.closeSync(fd);
      fs.rmSync(promptDir, { recursive: true, force: true });
      if (!o.cwd) fs.rmSync(cwd, { recursive: true, force: true });
      resolve({ code, stdout, stderr, ms: Date.now() - t0 });
    });
  });
}

/**
 * `claude -p --model <model> [...flags] --output-format json`, prompt on stdin. Records the
 * envelope's cost in the ledger. Resolves the raw stdout (the envelope), like the callers'
 * previous execFile-based default; rejects on a non-zero exit.
 */
async function callJSON(prompt, { model, flags = [], tag = '', timeoutMs = 600000, env = null, systemPrompt = null } = {}) {
  const r = await spawnClaude(prompt, ['-p', '--model', model, ...flags, '--output-format', 'json', '--no-session-persistence'], { timeoutMs, env, systemPrompt });
  let envelope = null;
  try { envelope = JSON.parse(r.stdout); } catch { /* recorded below as unparsed */ }
  record({ tag, model, cost_usd: (envelope && envelope.total_cost_usd) || 0, ms: r.ms, code: r.code, ...usageOf(envelope), parsed: !!envelope });
  if (r.code !== 0) throw new Error(`claude -p exited ${r.code}: ${r.stderr.slice(0, 500)}`);
  return r.stdout;
}

module.exports = { BudgetExceededError, ledgerPath, budgetUsd, ledgerTotal, checkBudget, record, usageOf, spawnClaude, callJSON };

if (require.main === module) {
  // `node claude-call.js --total` prints the ledger total.
  if (process.argv.includes('--total')) console.log(`$${ledgerTotal().toFixed(4)} (${ledgerPath() || 'no ledger configured'})`);
}
