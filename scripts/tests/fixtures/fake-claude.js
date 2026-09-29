#!/usr/bin/env node
/**
 * fake-claude.js — an offline stand-in for the `claude plugin …` calls that
 * release.js --publish makes. Used only by scripts/tests/release.test.js and the
 * scratchpad sandbox.
 *
 *   plugin marketplace update <name>    logged, no effect
 *   plugin install|update <id>          "installs" the skill dir of FAKE_GH_ORIGIN's main
 *                                       into CLAUDE_CONFIG_DIR/plugins/cache/… and records
 *                                       it in CLAUDE_CONFIG_DIR/plugins/installed_plugins.json;
 *                                       FAKE_CLAUDE_INSTALL=noop succeeds without installing anything
 *
 * Every invocation is appended to FAKE_CLAUDE_LOG as one JSON line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(args)}\n`);
if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'update') process.exit(0);
if (args[0] === 'plugin' && (args[1] === 'install' || args[1] === 'update')) {
  if (process.env.FAKE_CLAUDE_INSTALL === 'noop') process.exit(0);
  const id = args[2];
  const origin = process.env.FAKE_GH_ORIGIN;
  const config = process.env.CLAUDE_CONFIG_DIR;
  const v = JSON.parse(execFileSync('git', ['-C', origin, 'show', 'main:skill-package/skills/claude-code-internals/version.json'], { encoding: 'utf8' }));
  const installPath = path.join(config, 'plugins', 'cache', 'claude-code-internals-marketplace', 'claude-code-internals', v.skill_version);
  const skill = path.join(installPath, 'skills', 'claude-code-internals');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'version.json'), JSON.stringify(v, null, 2));
  const reg = path.join(config, 'plugins', 'installed_plugins.json');
  const data = fs.existsSync(reg) ? JSON.parse(fs.readFileSync(reg, 'utf8')) : { version: 2, plugins: {} };
  data.plugins[id] = [{ scope: 'user', installPath, version: v.skill_version }];
  fs.writeFileSync(reg, JSON.stringify(data, null, 2));
  process.exit(0);
}
process.stderr.write(`fake-claude: unsupported invocation: ${args.join(' ')}\n`);
process.exit(2);
