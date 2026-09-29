'use strict';
/**
 * version-pins.js — every place the skill version is written down, in one table.
 *
 * Two consumers read this table, so they cannot disagree:
 *   - scripts/tests/release-consistency.test.js asserts that every pin states
 *     version.json's skill_version (and that every pin still matches at least once);
 *   - the repository's scripts/release.js bumps every pin to the new version.
 *
 * Each `re` is global, carries the `d` flag (match indices) and has exactly one
 * capture group: the version itself. Only these pinned forms count. The README
 * legitimately mentions many other version numbers (CLI 2.1.x, asar 1.x/2.x,
 * historical skill versions in prose), so nothing here scans for x.y.z broadly.
 *
 * The captured CLI version (version.json captured_version) is NOT in this table:
 * it changes with the content, before a release, and is pinned by the "captured
 * from" test plus the captured_version == registry.as_of.cli equality test.
 */

const SKILL_VERSION_PINS = [
  { file: 'skill-package/skills/claude-code-internals/version.json', describe: 'skill_version field', re: /"skill_version":\s*"(\d+\.\d+\.\d+)"/dg },
  { file: 'skill-package/.claude-plugin/plugin.json', describe: 'plugin manifest version', re: /^ {2}"version":\s*"(\d+\.\d+\.\d+)"/dgm },
  { file: 'README.md', describe: '**Skill Version:** banner', re: /\*\*Skill Version:\*\*\s*(\d+\.\d+\.\d+)/dg },
  { file: 'README.md', describe: 'file-tree "Version tracking (v…" comment', re: /Version tracking \(v(\d+\.\d+\.\d+)/dg },
  { file: 'README.md', describe: 'version.json example "skill_version"', re: /"skill_version":\s*"(\d+\.\d+\.\d+)"/dg },
  { file: 'README.md', describe: '"What this fork adds (v2.2.0–v…" line', re: /v2\.2\.0.v(\d+\.\d+\.\d+),/dg },
];

/** Every match of `re` in `text`, as {version, start, end} of the capture group. */
function pinMatches(text, re) {
  if (!re.global || !re.hasIndices) throw new Error(`pin regex ${re} needs the g and d flags`);
  return [...text.matchAll(re)].map((m) => ({ version: m[1], start: m.indices[1][0], end: m.indices[1][1] }));
}

/**
 * Replace the version in every match of `re`. Throws when there is no match (a
 * reworded pin must fail loudly, not be skipped) or when a match does not state
 * `from` (the file is not at the version being bumped from).
 */
function bumpText(text, re, from, to, label = String(re)) {
  const ms = pinMatches(text, re);
  if (!ms.length) throw new Error(`${label}: no pin matches ${re}; reworded or removed?`);
  const wrong = ms.filter((m) => m.version !== from);
  if (wrong.length) throw new Error(`${label}: pin states ${wrong.map((m) => m.version).join(', ')}, expected ${from}`);
  let out = '';
  let at = 0;
  for (const m of ms) { out += text.slice(at, m.start) + to; at = m.end; }
  return out + text.slice(at);
}

module.exports = { SKILL_VERSION_PINS, pinMatches, bumpText };
