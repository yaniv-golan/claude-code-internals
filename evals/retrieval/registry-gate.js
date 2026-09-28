'use strict';
/**
 * registry-gate.js — how the registry-derived top-1 cases (registry-top1.json) are
 * judged. Pure; used by skill-package/.../tests/registry-top1.test.js and by
 * gen-registry-top1.js.
 *
 * The cases are provenance labels, not ground truth (plan §2.2, §4.7b), so the gate is
 * NET, and it follows the question set's lesson split (questions-v2.json `split`),
 * because holdout is never tuned against:
 *   - a DEV case is one whose expected lesson is a dev lesson (or in neither list: a
 *     lesson added after the split is not holdout, so it is gated);
 *   - a HOLDOUT case is one whose expected lesson is a holdout lesson: reported, never
 *     gated, never waived.
 * Against the recorded `passes_today`: LOST = recorded passing, now not first; GAINED =
 * recorded failing, now first. The gate fails when, on dev cases:
 *   - gained - lost < 0 (a net loss), or
 *   - a lost case is not in the named-loss list (registry-top1-losses.json), or it lost to
 *     another lesson than the entry records (`lost_to`), or
 *   - a named-loss entry is stale: its case no longer loses, names no case, or is a
 *     holdout case.
 * The named-loss list has the shape of a baseline's `waivers`: each entry names the case
 * and says why. It only shrinks deliberately (a stale entry fails), and it empties when
 * registry-top1.json is regenerated (every case then records its current result).
 */

/**
 * @param cases   registry-top1.json `cases` ({name, expected_id, passes_today})
 * @param split   questions-vN.json `split` ({dev: ids, holdout: ids})
 * @param losses  registry-top1-losses.json `losses` ([{name, lost_to, reason}])
 * @param topOf   (case) => the lesson id ranked first now, or null
 * @returns {{dev, holdout, failures: string[]}} dev/holdout: {n, lost: [{name, expected_id, top}], gained: [...], net}
 */
function judge(cases, split, losses, topOf) {
  const holdout = new Set(split.holdout);
  const out = { dev: { n: 0, lost: [], gained: [] }, holdout: { n: 0, lost: [], gained: [] } };
  const splitOf = new Map();
  for (const c of cases) {
    const side = holdout.has(c.expected_id) ? 'holdout' : 'dev';
    splitOf.set(c.name, side);
    const top = topOf(c);
    const r = out[side];
    r.n++;
    if (c.passes_today && top !== c.expected_id) r.lost.push({ name: c.name, expected_id: c.expected_id, top });
    if (!c.passes_today && top === c.expected_id) r.gained.push({ name: c.name, expected_id: c.expected_id, top });
  }
  for (const side of ['dev', 'holdout']) out[side].net = out[side].gained.length - out[side].lost.length;

  const failures = [];
  const named = new Map();
  for (const w of losses) {
    if (named.has(w.name)) failures.push(`named loss "${w.name}" is listed twice`);
    named.set(w.name, w);
    if (!w.reason) failures.push(`named loss "${w.name}" has no reason`);
  }
  if (out.dev.n === 0) failures.push('no dev registry cases: the gate judged nothing (an empty or holdout-only case list)');
  if (out.dev.net < 0) failures.push(`dev registry cases: net loss (${out.dev.gained.length} gained, ${out.dev.lost.length} lost)`);
  const lostByName = new Map(out.dev.lost.map((l) => [l.name, l]));
  for (const l of out.dev.lost) {
    const w = named.get(l.name);
    const got = l.top === null ? 'no result' : `L${l.top}`;
    if (!w) failures.push(`"${l.name}": expected L${l.expected_id} at rank 1, got ${got} — not in the named-loss list`);
    else if (w.lost_to !== l.top) failures.push(`"${l.name}": named loss records a loss to L${w.lost_to}, now ${got}`);
  }
  for (const w of losses) {
    if (!splitOf.has(w.name)) failures.push(`named loss "${w.name}" names no registry case — remove it`);
    else if (splitOf.get(w.name) === 'holdout') failures.push(`named loss "${w.name}" is a holdout case: holdout cases are reported, never waived — remove it`);
    else if (!lostByName.has(w.name)) failures.push(`named loss "${w.name}" is stale (the case no longer loses) — remove it`);
  }
  return { ...out, failures };
}

module.exports = { judge };
