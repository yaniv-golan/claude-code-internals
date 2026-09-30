#!/usr/bin/env node
/**
 * check-history-markers.js — fails when a lesson or state page narrates the
 * history of this skill's own claims.
 *
 * THE RULE. Lessons and state pages carry only current facts about the
 * tooling. A trap is welcome ("X looks like Y but is Z"); a confession is not
 * ("CORRECTED (2026-05-10): we previously said X"). Retraction narration —
 * what an earlier version claimed, when it was withdrawn, who caught it —
 * belongs in CHANGELOG.md. A lesson states the correct fact plainly.
 * (state/README.md, "Correct lessons in place; put the correction history in
 * CHANGELOG.md".)
 *
 * THE PREDICATE. Two arms, applied line by line to references/*.md and
 * references/state/*.md, after dropping fenced code blocks and blanking inline
 * code spans (so a quoted identifier such as `CORRECTION` is never a hit):
 *
 *   A. bold-start: a line (after optional list, number or blockquote markers)
 *      that opens with a bold span containing correct(ed|ion|ions),
 *      re-correct…, or retract(ed|ion|s) — case-insensitive. This is the shape
 *      every retraction banner took ("**CORRECTION (v2.11.18)…**",
 *      "**History — corrected three times.**", "**Corrected framing**:").
 *      Bare "correct" is not matched: "**… is correct for both …**" is an
 *      adjective, not a marker.
 *   B. uppercase banner word anywhere: CORRECTED, CORRECTION(S), RETRACTED,
 *      RETRACTION, WITHDRAWN, AMENDED, UPDATED — case-sensitive, so the
 *      metadata line "Updated: 2026-…" and a heading like "Updated Prompt Text"
 *      pass. Exempt: the all-caps `# LESSON N — TITLE` heading line, where
 *      uppercase is the house style rather than a banner (a lesson title is
 *      indexed and linked, so retitling is a separate decision).
 *
 * No allowlist: every hit so far had a rewrite that kept the fact.
 *
 *   node scripts/check-history-markers.js      exit 0 = no markers
 *   CHECK_HISTORY_MARKERS_REFS=<dir> overrides the references directory (tests).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BOLD_START = /^\s*(?:(?:[-*+]|\d+\.|>)\s*)*\*\*[^*]*?\b(?:re-?)?(?:correct(?:ed|ion|ions)|retract(?:ed|ion|ions|s)?)\b/i;
const BANNER_WORD = /\b(?:CORRECTED|CORRECTION|CORRECTIONS|RETRACTED|RETRACTION|WITHDRAWN|AMENDED|UPDATED)\b/;
const LESSON_TITLE = /^#\s+LESSON\s+\d+\b/;
const FENCE = /^\s*(?:```|~~~)/;

/** Hits in one file's text: [{line, arm, text}] (1-based lines). */
function scanText(text) {
  const hits = [];
  let inFence = false;
  text.split('\n').forEach((raw, i) => {
    if (FENCE.test(raw)) { inFence = !inFence; return; }
    if (inFence) return;
    const line = raw.replace(/`[^`\n]*`/g, '``');
    if (BOLD_START.test(line)) hits.push({ line: i + 1, arm: 'bold-start', text: raw });
    else if (!LESSON_TITLE.test(line) && BANNER_WORD.test(line)) hits.push({ line: i + 1, arm: 'banner-word', text: raw });
  });
  return hits;
}

function markdownFiles(refsDir) {
  const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.md')).sort().map((f) => path.join(d, f)) : []);
  return [...list(refsDir), ...list(path.join(refsDir, 'state'))];
}

function scan(refsDir) {
  const out = [];
  for (const file of markdownFiles(refsDir)) {
    for (const h of scanText(fs.readFileSync(file, 'utf8'))) out.push({ file: path.relative(refsDir, file), ...h });
  }
  return out;
}

function main() {
  const refs = process.env.CHECK_HISTORY_MARKERS_REFS || path.join(__dirname, '..', 'references');
  const hits = scan(refs);
  if (hits.length === 0) {
    console.log(`history markers OK (${markdownFiles(refs).length} files)`);
    return 0;
  }
  console.error(`check-history-markers: ${hits.length} history marker(s) in lessons/state pages.`);
  console.error('State the current fact plainly (keep a trap if useful); move the retraction narration to CHANGELOG.md.');
  for (const h of hits) console.error(`  references/${h.file}:${h.line} [${h.arm}] ${h.text.trim().slice(0, 160)}`);
  return 1;
}

module.exports = { BOLD_START, BANNER_WORD, scanText, scan };

if (require.main === module) process.exit(main());
