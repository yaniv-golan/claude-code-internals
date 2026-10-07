'use strict';

/**
 * prepare-lessons.test.js — the identifier extractor, the key-shape rules, the
 * collision rule, the derived (not frozen) generated set, the frozen hand source
 * and its projection (lesson deletion, retired keys, provenance loss), the
 * UNREACHABLE ceiling, the --check gate, the write guards (inputs and git HEAD),
 * and the consumers that ignore generated keys.
 * Integration cases run against a scratch COPY of the skill directory.
 */

const nodeTest = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..');
const SKILL_DIR = path.join(SCRIPTS, '..');
const PREP = path.join(SCRIPTS, 'prepare-lessons.js');
const BUILD = path.join(SCRIPTS, 'build.js');
const P = require('../prepare-lessons.js');
const {
  keywordCandidates, extractIdentifiers, keyFormOf, shapeReject, contextReject,
} = require('../lib/identifiers.js');
const { compileKey, keyHitsToken, surfaceTokens } = require('../lib/keyword-match.js');
const { buildIndex, tokenizeQuery } = require('../lib/tfidf-index.js');
const {
  BOUNDARY_FIELD, HAND_FILE, HAND_SHA256, loadHandSource, handTopic, handKeywords,
} = require('../lib/keyword-provenance.js');
const { parseOrdered, emit } = require('../check-json-format.js');
const V = require('../lib/vocab.js');
const { PROPOSALS_FILE, loadProposals, proposalsPath } = V;

// The vocabulary proposals (data/ at the repository root) are a build input, not part of the
// shipped skill zip; there nothing can be derived or checked, so every case skips.
const test = fs.existsSync(proposalsPath(SKILL_DIR)) ? nodeTest
  : Object.assign((name, fn) => nodeTest(name, { skip: 'data/vocab-proposals.json not present (the shipped skill package zip)' }, fn), { after: nodeTest.after });

const TOPIC = path.join(SKILL_DIR, 'references', 'topic-index.json');
const committed = () => JSON.parse(fs.readFileSync(TOPIC, 'utf8'));
const HAND = loadHandSource(SKILL_DIR);
/** Generated keys: keyword_map keys that are not in the hand source. */
const generatedOf = (t) => new Set(Object.keys(t.keyword_map).filter((k) => !HAND.keySet.has(k)));

function run(script, args) {
  try {
    return { code: 0, out: execFileSync('node', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const SCRATCH = [];
test.after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });
/** A scratch repository layout: <root>/skill-package/skills/claude-code-internals (returned) and <root>/data. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-prep-'));
  SCRATCH.push(root);
  const dir = path.join(root, 'skill-package', 'skills', 'claude-code-internals');
  const refs = path.join(dir, 'references');
  fs.mkdirSync(refs, { recursive: true });
  const src = path.join(SKILL_DIR, 'references');
  for (const f of fs.readdirSync(src)) {
    // catalog.md is a build.js-derived output; copy it so build.js --check on an
    // unedited fixture stays clean (any lesson-affecting edit regenerates it).
    if (/^\d\d-.*\.md$/.test(f) || f === 'catalog.md' || /^(topic-index|hand-keywords|cross-references|troubleshooting|site-links)\.json$/.test(f)) {
      fs.copyFileSync(path.join(src, f), path.join(refs, f));
    }
  }
  // build.js also derives references/routing/ and the state pages' read_more: field.
  for (const d of ['routing', 'state']) fs.cpSync(path.join(src, d), path.join(refs, d), { recursive: true });
  fs.mkdirSync(path.dirname(proposalsPath(dir)));
  fs.copyFileSync(proposalsPath(SKILL_DIR), proposalsPath(dir));
  fs.copyFileSync(path.join(SKILL_DIR, 'version.json'), path.join(dir, 'version.json'));
  return dir;
}
const topicPath = (dir) => path.join(dir, 'references', 'topic-index.json');
const topicOf = (dir) => JSON.parse(fs.readFileSync(topicPath(dir), 'utf8'));

/** Lessons in `dir` whose proposal's input_sha256 differs from the current prompt, in index order. */
function staleIn(dir) {
  const loaded = P.load(dir);
  return V.staleProposals(loaded.topic.lessons, loaded.lessonText, loadProposals(dir).byId).stale;
}
/**
 * In a fixture copy only: re-stamp every stale proposal (except the ids in `keep`) with its
 * lesson's current input_sha256, so the fixture starts with no stale lesson whatever the
 * committed tree carries (a lesson prose edit leaves its proposal stale, by design, until the
 * next --generate). Terms are untouched, so vocab_keys and stamps still derive. A rewritten
 * file is no longer the pinned one: returns the file's sha256, to pass as proposalsPin.
 */
function freshen(dir, keep = []) {
  const loaded = P.load(dir);
  const props = loadProposals(dir);
  const redo = staleIn(dir).filter((id) => !keep.includes(id));
  for (const id of redo) {
    const l = loaded.topic.lessons.find((x) => x.id === id);
    props.byId.get(id).input_sha256 = V.inputSha256(l, loaded.lessonText(l));
  }
  if (redo.length) fs.writeFileSync(proposalsPath(dir), V.renderProposals(props.byId));
  const left = staleIn(dir);
  assert.ok(left.every((id) => keep.includes(id)), `freshen left only \`keep\` stale: ${left}`);
  return loadProposals(dir).sha256;
}
const KNOB = 'CLAUDE_CODE_PREPARE_LESSONS_TEST_KNOB';

/** Edit topic-index.json through the order-preserving tree (JSON.parse hoists integer-like keys). */
function editTree(dir, fn) {
  const tree = parseOrdered(fs.readFileSync(topicPath(dir), 'utf8'));
  fn(tree);
  fs.writeFileSync(topicPath(dir), emit(tree, 2) + '\n');
}
const entry = (obj, key) => obj.entries.find(([k]) => k === JSON.stringify(key));
const lessonItems = (tree) => entry(tree, 'lessons')[1].items;
const idOf = (item) => Number(entry(item, 'id')[1].text);

/** Insert lines right after a lesson's heading, in a fixture, then re-derive bounds. */
function insertIntoLesson(dir, lessonId, lines) {
  const l = topicOf(dir).lessons.find((x) => x.id === lessonId);
  const file = path.join(dir, 'references', l.file);
  const all = fs.readFileSync(file, 'utf8').split('\n');
  all.splice(l.startLine, 0, ...lines);
  fs.writeFileSync(file, all.join('\n'));
  const b = run(BUILD, ['--root', dir]);
  assert.strictEqual(b.code, 0, b.out);
}
/** Remove every line containing `needle` from a lesson's file, then re-derive bounds. */
function removeFromLesson(dir, lessonId, needle) {
  const l = topicOf(dir).lessons.find((x) => x.id === lessonId);
  const file = path.join(dir, 'references', l.file);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter((x) => !x.includes(needle)).join('\n'));
  const b = run(BUILD, ['--root', dir]);
  assert.strictEqual(b.code, 0, b.out);
}

// --- extractor ------------------------------------------------------------------

test('keyword candidates: the published extractor rules', () => {
  const text = [
    'Set `CLAUDE_CODE_FOO_BAR=1` and run `claude plugin install my-plugin`.',
    'Gate 2307090146 guards /schedule-now; see tengu_saddle_lantern and mcp__skills__list_skills.',
    'The store calls `store.getState()` and `r.session_ingress_token`; config lives in `settings.local.json`.',
    'Symbols: `isEnabled`, `W1e`, plain `hooks`, a hash `toolu_01QFu3XtsYaihDoj4iCSDQ4g`, version `2.1.198`.',
    '```',
    'INSIDE_A_FENCE and `fenced_span`',
    '```',
  ].join('\n');
  const got = keywordCandidates(text).map((c) => c.raw);
  for (const want of ['CLAUDE_CODE_FOO_BAR', 'my-plugin', '2307090146', '/schedule-now', 'tengu_saddle_lantern',
    'mcp__skills__list_skills', 'session_ingress_token', 'settings.local.json', 'isEnabled', 'W1e', '2.1.198', 'INSIDE_A_FENCE']) {
    assert.ok(got.includes(want), `expected candidate ${want}; got ${got.join(', ')}`);
  }
  // member-access chains are split, plain words and hashes are not identifiers,
  // code spans inside fences are not spans (the CAPS rule still sees the fence).
  for (const not of ['store.getState', 'r.session_ingress_token', 'hooks', 'toolu_01QFu3XtsYaihDoj4iCSDQ4g', 'fenced_span', 'claude plugin install my-plugin']) {
    assert.ok(!got.includes(not), `did not expect candidate ${not}`);
  }
});

test('context rejections: markup slashes and truncated mcp__ names', () => {
  const rejected = [];
  const got = keywordCandidates('Close with </summary>. Tools `mcp__cowork__*` and `mcp__scheduled-tasks__list_tasks` (mcp__scheduled-tasks__list_tasks); run /real-cmd.', rejected).map((c) => c.raw);
  assert.ok(got.includes('/real-cmd'));
  assert.ok(got.includes('mcp__scheduled-tasks__list_tasks'));
  const why = Object.fromEntries(rejected.map((r) => [r.raw, r.reason]));
  assert.strictEqual(why['/summary'], 'xml-tag');
  assert.strictEqual(why.mcp__scheduled, 'mcp-truncated'); // the mcp__ rule stops at '-'
  assert.strictEqual(why.mcp__cowork__, 'mcp-truncated');
  // a slash command that also occurs in prose is kept
  assert.strictEqual(contextReject('/summary', 'see </summary> and run /summary'), null);
});

test('key shapes: short, short-digit, hash, character-class and permission shapes are never keys', () => {
  const cases = {
    kz7: 'short', W1e: 'short', 'r-x': 'short',
    '2.1.197': 'short-digits', '10-20': 'short-digits',
    'f47ac10b-58cc-4372-a567-0e02b2c3d479': 'hash', mcp__a34d41f6: 'hash', deadbeef0123cafe: 'hash',
    'A-Za-z': 'char-class', '0-9a-f': 'char-class', '8-hex': 'char-class',
    'drwxr-xr-x': 'permission', 'rw-r--r--': 'permission',
  };
  for (const [raw, reason] of Object.entries(cases)) assert.strictEqual(shapeReject(raw, keyFormOf(raw)), reason, raw);
  for (const raw of ['CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE', '2307090146', '1.25927.0', 'claude-opus-4-5-20251101', 'dark-ansi', 'tengu_saddle_lantern']) {
    assert.strictEqual(shapeReject(raw, keyFormOf(raw)), null, raw);
  }
});

test('camelCase identifiers are stored in separator form, reachable by the identifier as typed', () => {
  assert.strictEqual(keyFormOf('switchSession'), 'switch-session');
  assert.strictEqual(keyFormOf('SendMessage'), 'send-message');
  assert.strictEqual(keyFormOf('getMCPServer'), 'get-mcp-server');
  assert.strictEqual(keyFormOf('CLAUDE_CODE_X'), 'CLAUDE_CODE_X');
  for (const raw of ['switchSession', 'SendMessage', 'getMCPServer', 'isEnabled']) {
    // Generated keys are compiled exact-only (lib/keyword-match.js): never hand kebab phrases.
    const ck = compileKey(keyFormOf(raw), { exactOnly: true });
    assert.ok(ck.isIdentifier, `${raw} key is identifier-shaped`);
    assert.ok(tokenizeQuery(raw).some((t) => keyHitsToken(ck, t)), `typing ${raw} hits its key`);
    // and no plain word inside it does
    for (const w of ['switch', 'session', 'send', 'message', 'enabled']) assert.ok(!keyHitsToken(ck, w));
  }
  // The same spelling as a HAND key is a kebab phrase: its words hit it.
  assert.ok(keyHitsToken(compileKey('switch-session'), 'session'));
});

test('a key must be self-reachable: /code (a query stop word) can never be hit by a query token', () => {
  assert.strictEqual(P.selfReachable('/code', '/code'), false);
  assert.strictEqual(P.selfReachable('/schedule', '/schedule'), true);
  // A key's joined form drops every non-alphanumeric character, so /foo-bar is hit by foobar.
  assert.strictEqual(P.selfReachable('/foo-bar', '/foo-bar'), true);
  const { derived, report } = planOf({}, [[1, 'Run /foo-bar, /code and /bazquux now.']]);
  assert.deepStrictEqual(derived.map((d) => d.key), ['/foo-bar', '/bazquux']);
  assert.ok(report.rejected.some((r) => r.raw === '/code' && r.reason === 'not-self-reachable'));
});

// evals/ is not part of the shipped skill package; this check skips there.
const EVALS = path.join(SKILL_DIR, '..', '..', '..', 'evals', 'retrieval');

test('the eval suite reuses the same extractor (leak masking is unchanged)', (t) => {
  if (!fs.existsSync(EVALS)) { t.skip('evals/ not present'); return; }
  assert.strictEqual(require(path.join(EVALS, 'lib.js')).extractIdentifiers, extractIdentifiers);
});

// --- collision rule ---------------------------------------------------------------

function miniTopic(keywordMap, lessons, handKw = {}) {
  return { lessons: lessons.map(([id]) => ({ id, title: `L${id}`, keywords: handKw[id] || [] })), keyword_map: keywordMap };
}
const planOf = (keywordMap, lessons, handKw) => {
  const texts = new Map(lessons);
  return P.planIdentifiers(miniTopic(keywordMap, lessons, handKw), (l) => texts.get(l.id));
};

test('collision rule: a candidate whose query token an existing key already owns is never appended', () => {
  // The when_to_use flip: a raw identifier with the same joined form, mapped to a lower id,
  // would have tied and won on the lowest-id tie-break.
  const { derived, report } = planOf({ when_to_use: [88] }, [
    [11, 'Uses `when-to-use` and `whenToUse` and `WHEN_TO_USE`.'],
    [88, 'The `when_to_use` field.'],
  ]);
  assert.deepStrictEqual(derived.map((a) => a.key), []);
  const skipped = [...report.normalized, ...report.claimed, ...report.fragment].map((x) => x.raw).sort();
  assert.deepStrictEqual(skipped, ['WHEN_TO_USE', 'when-to-use', 'whenToUse']);
});

test('rule 3c, identifier branch: same joined form, different normalized form, is still refused', () => {
  // 3b cannot see this pair ('whento use' vs 'when to use'); only 3c's joined-form check does.
  const { derived, report } = planOf({ whento_use: [88] }, [[11, 'The `when_to_use` field.'], [88, 'nothing']]);
  assert.deepStrictEqual(derived, []);
  assert.deepStrictEqual(report.normalized, []);
  assert.deepStrictEqual(report.claimed.map((c) => [c.raw, c.owners]), [['when_to_use', [88]]]);
});

test('collision rule: substring keys may not hit any live token; fresh identifiers are appended', () => {
  const { derived, report } = planOf({ 'how to send': [5], 'message queue': [6], 'build 4567': [7] }, [
    [1, '`SendMessage` and `brand_new_flag` and `brand_new_flag` and `Qx79` and gate 45678901'],
    [2, 'Also `brand_new_flag` once.'],
    [5, ''], [6, ''], [7, ''], // hand keys must point at existing lessons (else they are orphans)
  ]);
  const keys = derived.map((a) => a.key);
  // camelCase is stored in separator form, hit only by its joined token, so the live
  // words send/message no longer block it
  assert.deepStrictEqual(derived.find((a) => a.key === 'send-message').lessons, [1]);
  // a bare number, as a generated key, is hit only by its whole number (a phrase: no partial
  // credit), so a live substring ('456', inside hand key 'build 4567') no longer blocks it
  assert.deepStrictEqual(derived.find((a) => a.key === '45678901').lessons, [1]);
  assert.ok(!report.fragment.some((f) => f.raw === '45678901'));
  assert.strictEqual(report.unreachable, report.fragment.length);
  // ...but its whole number taken by a hand key still blocks it (claimed: reachable via that key)
  const taken = planOf({ 'gate 45678901': [5] }, [[1, 'gate 45678901 is on'], [5, '']]);
  assert.ok(!taken.derived.some((a) => a.key === '45678901'));
  assert.ok(taken.report.claimed.some((c) => c.raw === '45678901'));
  // Multi-lesson rule: the lesson with the most occurrences is the home; others are reported.
  const flag = derived.find((a) => a.key === 'brand_new_flag');
  assert.deepStrictEqual(flag.lessons, [1]);
  assert.ok(report.elsewhere.some((e) => e.raw === 'brand_new_flag' && e.others.includes(2)));
  assert.ok(keys.includes('Qx79'));
});

test('hand wins: a hand key or a home lesson\'s hand keyword is never generated', () => {
  const { derived, report } = planOf({ some_hand_key: [2] }, [
    [1, '`some_hand_key` and `my_flag_name`'],
    [2, 'x'],
  ], { 1: ['my_flag_name'] });
  assert.deepStrictEqual(derived, []);
  assert.ok(report.alreadyKey.some((a) => a.raw === 'some_hand_key'));
  assert.ok(report.handKeyword.some((a) => a.raw === 'my_flag_name'));
});

test('occurrences are counted where the extraction finds them: repeated member-access occurrences decide the home', () => {
  const count = (text, raw) => keywordCandidates(text).find((c) => c.raw === raw).count;
  // member access counts (the segment is what the extraction produces)
  assert.strictEqual(count('`r.session_ingress_token`, `r.session_ingress_token` and `x.session_ingress_token`', 'session_ingress_token'), 3);
  // one place hit by two rules (code span + CAPS) counts once; a fence counts for CAPS only
  assert.strictEqual(count('`CLAUDE_CODE_FOO_BAR=1` then CLAUDE_CODE_FOO_BAR\n```\nCLAUDE_CODE_FOO_BAR\n```', 'CLAUDE_CODE_FOO_BAR'), 3);
  // outside the extraction contexts a camelCase name is not an occurrence (prose, fenced code)
  assert.strictEqual(count('`O.installPath` and installPath in prose\n```\nO.installPath\n```', 'installPath'), 1);
  // markup and truncated contexts do not count
  assert.strictEqual(count('run /real-cmd, /real-cmd, and <b>/real-cmd', '/real-cmd'), 2);
  const { derived } = planOf({}, [
    [1, 'Three: `r.session_ingress_token`, `r.session_ingress_token`, `x.session_ingress_token`.'],
    [2, 'Two: `session_ingress_token` and `session_ingress_token`.'],
  ]);
  assert.deepStrictEqual(derived.map((d) => [d.key, d.lessons]), [['session_ingress_token', [1]]]);
});

test('a key whose home set has more than 2 lessons is skipped', () => {
  const { derived, report } = planOf({}, [[1, '`spread_flag_x`'], [2, '`spread_flag_x`'], [3, '`spread_flag_x`'], [4, '`pair_flag_y`'], [5, '`pair_flag_y`']]);
  assert.deepStrictEqual(derived.map((d) => [d.key, d.lessons]), [['pair_flag_y', [4, 5]]]);
  assert.deepStrictEqual(report.spread.map((s) => [s.raw, s.home]), [['spread_flag_x', [1, 2, 3]]]);
});

test('on the committed index, every generated key opened only tokens no hand key hit', () => {
  const cur = committed();
  const before = handTopic(cur, HAND).topic;
  const beforeKeys = Object.keys(before.keyword_map).map(compileKey);
  // Identifier keys only: vocabulary keys are ordinary phrases and may share words (rule 4).
  const added = cur.lessons.flatMap((l) => l.identifier_keys || []).filter((k, i, a) => a.indexOf(k) === i);
  assert.ok(added.length > 0, 'the committed index carries the identifier backfill');
  for (const k of added) {
    const surface = [...surfaceTokens(compileKey(k, { exactOnly: true }))];
    for (const t of surface) {
      assert.ok(!beforeKeys.some((b) => keyHitsToken(b, t)), `generated key "${k}" hits "${t}", which a hand key already hit`);
    }
    assert.ok(cur.keyword_map[k].length <= P.MAX_HOMES, `generated key "${k}" maps to more than ${P.MAX_HOMES} lessons`);
  }
});

// --- hand keys: a frozen source file, projected; provenance never inferred -----------------

const sha256 = (s) => require('crypto').createHash('sha256').update(s).digest('hex');
const handPath = (dir) => path.join(dir, 'references', HAND_FILE);

test('hand-keywords.json is the frozen snapshot, and the committed index is exactly its derived form', () => {
  assert.strictEqual(HAND.sha256, HAND_SHA256);
  assert.strictEqual(HAND.keys.length, 5000);
  const cur = committed();
  const raw = fs.readFileSync(TOPIC, 'utf8');
  const lessonText = P.load(SKILL_DIR).lessonText;
  const { errors, derived } = P.checkLessons({ raw, lessonText, hand: HAND, proposals: loadProposals(SKILL_DIR) });
  assert.deepStrictEqual(errors, []);
  // keyword_map = every hand key (no lesson is deleted), in snapshot order, then the generated keys
  const keys = P.storedKeyList(raw).map(([k]) => k);
  assert.deepStrictEqual(keys.slice(0, HAND.keys.length), HAND.keys.map((k) => k.key));
  assert.deepStrictEqual(keys.slice(HAND.keys.length), derived.map((d) => d.key));
  // the sets are disjoint: nothing generated is a hand key, retired or not
  for (const d of derived) assert.ok(!HAND.keySet.has(d.key), d.key);
  // each lesson: its snapshot keywords verbatim (lesson 87 keeps its duplicate), then identifier_keys
  for (const l of cur.lessons) {
    const handKw = (HAND.lessonKeywords.get(l.id) || []).map((x) => x.value);
    assert.deepStrictEqual(l.keywords, [...handKw, ...(l.identifier_keys || []), ...(l.vocab_keys || [])], `lesson ${l.id}`);
  }
  assert.deepStrictEqual(Object.keys(cur[BOUNDARY_FIELD]), ['unreachable_max']);
});

test('an edited or missing hand-keywords.json fails the check and stops a run', () => {
  const dir = fixture();
  const hp = handPath(dir);
  const tree = parseOrdered(fs.readFileSync(hp, 'utf8'));
  entry(tree, 'keyword_map')[1].entries.push(['"a hand edit"', { t: 'arr', items: [{ t: 'raw', text: '1' }] }]);
  fs.writeFileSync(hp, emit(tree, 2) + '\n');
  const before = fs.readFileSync(topicPath(dir), 'utf8');
  for (const [script, args] of [[PREP, ['--check', '--root', dir]], [BUILD, ['--check', '--root', dir]], [PREP, ['--root', dir]]]) {
    const r = run(script, args);
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /hand-keywords\.json is not the frozen snapshot/);
  }
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), before);
  fs.rmSync(hp);
  const gone = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(gone.code, 1, gone.out);
  assert.match(gone.out, /hand-keywords\.json is missing/);
});

test('--accept-hand-keys no longer exists: there is no path that re-classifies keys as hand', () => {
  assert.throws(() => P.parseArgs(['--accept-hand-keys']), /unknown argument "--accept-hand-keys"/);
  const r = run(PREP, ['--accept-hand-keys', '--dry-run']);
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /unknown argument/);
});

/** A fixture whose topic-index carries NO keyword data: empty keyword_map, no keywords, no identifier_keys. */
function strippedFixture() {
  const dir = fixture();
  editTree(dir, (tree) => {
    entry(tree, 'keyword_map')[1].entries = [];
    for (const item of lessonItems(tree)) item.entries = item.entries.filter(([k]) => !['"identifier_keys"', '"keywords"', '"vocab_keys"', '"vocab"'].includes(k));
  });
  return dir;
}

test('every keyword field is build output: a run on an index with none reproduces the committed file byte for byte', () => {
  const dir = strippedFixture();
  const committedRaw = fs.readFileSync(TOPIC, 'utf8');
  const bad = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(bad.code, 1, bad.out);
  const r = run(PREP, ['--root', dir]);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), committedRaw);
  const again = run(PREP, ['--root', dir]);
  assert.strictEqual(again.code, 0, again.out);
  assert.match(again.out, /already up to date/);
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), committedRaw);
  assert.strictEqual(sha256(fs.readFileSync(handPath(dir), 'utf8')), HAND_SHA256);
});

test('losing identifier_keys fails the check, and a plain run (no flag) restores it', () => {
  const dir = fixture();
  const original = fs.readFileSync(topicPath(dir), 'utf8');
  editTree(dir, (tree) => { for (const item of lessonItems(tree)) item.entries = item.entries.filter(([k]) => k !== '"identifier_keys"'); });
  const r = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /record other identifier_keys than derived/);
  const b = run(BUILD, ['--check', '--root', dir]);
  assert.strictEqual(b.code, 1, b.out);
  // provenance comes from hand-keywords.json, so the generated keys are still generated
  const res = P.checkLessons({ raw: fs.readFileSync(topicPath(dir), 'utf8'), lessonText: P.load(dir).lessonText, hand: HAND, proposals: loadProposals(dir) });
  assert.strictEqual(res.derived.length, generatedOf(committed()).size);
  const w = run(PREP, ['--root', dir]);
  assert.strictEqual(w.code, 0, w.out);
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), original);
  assert.strictEqual(run(BUILD, ['--check', '--root', dir]).code, 0);
});

test('a generated key copied into a lesson as if hand-written, or a hand key dropped, fails the check and is undone by a run', () => {
  const dir = fixture();
  const original = fs.readFileSync(topicPath(dir), 'utf8');
  const t = topicOf(dir);
  const l = t.lessons.find((x) => (x.identifier_keys || []).length);
  const k = l.identifier_keys[0];
  const handKey = HAND.keys.find((x) => x.items.length === 1).key;
  editTree(dir, (tree) => {
    const item = lessonItems(tree).find((it) => idOf(it) === l.id);
    // make the generated key look hand-written: drop it from identifier_keys only
    const ik = entry(item, 'identifier_keys')[1];
    ik.items = ik.items.filter((n) => JSON.parse(n.text) !== k);
    const kmap = entry(tree, 'keyword_map')[1];
    kmap.entries = kmap.entries.filter(([q]) => JSON.parse(q) !== handKey);
  });
  const r = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /not the projection of hand-keywords\.json: 1 hand key\(s\) missing/);
  assert.match(r.out, /record other identifier_keys than derived/);
  assert.strictEqual(run(PREP, ['--root', dir]).code, 0);
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), original);
});

// --- generated keys are derived: stale, moved and deleted ------------------------------

test('--check fails on an unappended identifier; a run appends it; removing it from the text removes the key', () => {
  const dir = fixture();
  const original = fs.readFileSync(topicPath(dir), 'utf8');
  insertIntoLesson(dir, 107, [`A new knob: \`${KNOB}\`.`]);
  const r = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`${KNOB} \\(lesson 107\\)`));
  assert.match(r.out, /run node scripts\/prepare-lessons\.js/);
  const b = run(BUILD, ['--check', '--root', dir]);
  assert.strictEqual(b.code, 1, 'build.js --check carries the same gate');
  assert.match(b.out, /lesson keywords incomplete/);
  assert.match(b.out, new RegExp(KNOB));

  assert.strictEqual(run(PREP, ['--root', dir]).code, 0);
  assert.strictEqual(run(PREP, ['--check', '--root', dir]).code, 0);
  assert.strictEqual(run(BUILD, ['--check', '--root', dir]).code, 0);
  const t = topicOf(dir);
  assert.deepStrictEqual(t.keyword_map[KNOB], [107]);
  assert.ok(t.lessons.find((l) => l.id === 107).identifier_keys.includes(KNOB));
  // a search for it now ranks the lesson first on the keyword layer
  const tok = tokenizeQuery(KNOB)[0];
  const owners = Object.entries(t.keyword_map).filter(([k]) => keyHitsToken(compileKey(k), tok)).flatMap(([, v]) => v);
  assert.deepStrictEqual(owners, [107]);
  const raw = fs.readFileSync(topicPath(dir), 'utf8');
  assert.strictEqual(raw, emit(parseOrdered(raw), 2) + '\n');

  // Remove it again: the stored key is now stale, --check says so, a run drops it
  // everywhere, and every surviving key is back in its original position.
  removeFromLesson(dir, 107, KNOB);
  const stale = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(stale.code, 1, stale.out);
  assert.match(stale.out, /no longer derived from the lesson text: CLAUDE_CODE_PREPARE_LESSONS_TEST_KNOB/);
  assert.strictEqual(run(PREP, ['--root', dir]).code, 0);
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), original);
});

test('a key whose occurrences move to another lesson is re-homed in place', () => {
  const dir = fixture();
  insertIntoLesson(dir, 107, ['', `\`${KNOB}\` and \`${KNOB}\``]);
  insertIntoLesson(dir, 108, ['', `\`${KNOB}\``]);
  assert.strictEqual(run(PREP, ['--root', dir]).code, 0);
  assert.deepStrictEqual(topicOf(dir).keyword_map[KNOB], [107]);
  const pos = () => Object.keys(topicOf(dir).keyword_map).indexOf(KNOB);
  const at = pos();
  insertIntoLesson(dir, 108, ['', `\`${KNOB}\` \`${KNOB}\` \`${KNOB}\``]);
  const r = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /now belong to other lessons: CLAUDE_CODE_PREPARE_LESSONS_TEST_KNOB/);
  assert.strictEqual(run(PREP, ['--root', dir]).code, 0);
  const t = topicOf(dir);
  assert.deepStrictEqual(t.keyword_map[KNOB], [108]);
  assert.strictEqual(pos(), at, 're-homed in place, not moved to the end');
  assert.ok(!(t.lessons.find((l) => l.id === 107).identifier_keys || []).includes(KNOB));
  assert.ok(!t.lessons.find((l) => l.id === 107).keywords.includes(KNOB));
  assert.ok(t.lessons.find((l) => l.id === 108).identifier_keys.includes(KNOB));
  assert.strictEqual(run(PREP, ['--check', '--root', dir]).code, 0);
});

/** Lesson ids some other index (cross-references.json, troubleshooting.json) names. */
function referencedIds(dir) {
  const xref = JSON.parse(fs.readFileSync(path.join(dir, 'references', 'cross-references.json'), 'utf8'));
  const ts = JSON.parse(fs.readFileSync(path.join(dir, 'references', 'troubleshooting.json'), 'utf8'));
  return new Set([
    ...Object.keys(xref.references).map(Number), ...Object.values(xref.references).flat().map((r) => r.id),
    ...ts.symptoms.flatMap((s) => s.lessons || []),
  ]);
}
/** Delete a lesson: its text (heading to endLine) and its topic-index entry. Nothing else. */
function deleteLesson(dir, victim) {
  const file = path.join(dir, 'references', victim.file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.splice(victim.startLine - 1, victim.endLine - victim.startLine + 1);
  fs.writeFileSync(file, lines.join('\n'));
  editTree(dir, (tree) => { const ls = entry(tree, 'lessons')[1]; ls.items = ls.items.filter((it) => idOf(it) !== victim.id); });
}

/**
 * After a lesson is deleted its vocabulary proposal is stale: --generate drops it (no model
 * call) and the proposals file gets a new hash, which the maintainer pins in the same
 * commit. Returns the check errors with that new hash pinned.
 */
async function dropStaleProposals(dir) {
  const stale = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(stale.code, 1, stale.out);
  assert.match(stale.out, /proposals for 1 lesson id\(s\) not in the index .*--generate/);
  await P.runGenerate(dir, {}, { callModel: async () => { throw new Error('no model call expected'); } }, () => {});
  const after = loadProposals(dir);
  assert.match(run(BUILD, ['--check', '--root', dir]).out, /is not the pinned proposals file/);
  return P.checkLessons({ raw: fs.readFileSync(topicPath(dir), 'utf8'), lessonText: P.load(dir).lessonText, hand: HAND, proposals: after, proposalsPin: after.sha256 }).errors;
}

test('deleting a lesson is automatic: build.js + prepare-lessons.js, no flag, no keyword edit, hand-keywords.json never written', async () => {
  const dir = fixture();
  const t0 = topicOf(dir);
  const referenced = referencedIds(dir);
  const handOnly = (id) => HAND.keys.filter((k) => k.items.length === 1 && k.items[0].id === id).map((k) => k.key);
  const handShared = (id) => HAND.keys.filter((k) => k.items.length > 1 && k.items.some((it) => it.id === id));
  // a lesson no other index names, with generated keys of its own, hand keys naming only it,
  // and hand keys it shares with other lessons
  const victim = t0.lessons.find((l) => !referenced.has(l.id) &&
    (l.identifier_keys || []).some((k) => t0.keyword_map[k].length === 1) && handOnly(l.id).length && handShared(l.id).length);
  assert.ok(victim, 'fixture needs a deletable lesson');
  const owned = victim.identifier_keys.filter((k) => t0.keyword_map[k].length === 1);
  const handBefore = fs.readFileSync(handPath(dir), 'utf8');
  const handStat = fs.statSync(handPath(dir)).mtimeMs;

  deleteLesson(dir, victim);
  const b = run(BUILD, ['--root', dir]);
  assert.strictEqual(b.code, 0, b.out); // a stale keyword_map is not a build error
  assert.strictEqual(run(BUILD, ['--check', '--root', dir]).code, 1, 'the keyword fields are stale until prepare-lessons.js runs');
  const p = run(PREP, ['--root', dir]);
  assert.strictEqual(p.code, 0, p.out);

  // the keyword fields are derived; what is left is the deleted lesson's vocabulary proposal
  assert.deepStrictEqual(await dropStaleProposals(dir), []);
  const t = topicOf(dir);
  for (const k of owned) assert.ok(!(k in t.keyword_map), `generated key ${k} of the deleted lesson survived`);
  for (const k of handOnly(victim.id)) assert.ok(!(k in t.keyword_map), `hand key ${k} naming only the deleted lesson is still projected`);
  for (const k of handShared(victim.id)) {
    assert.deepStrictEqual(t.keyword_map[k.key], k.items.map((it) => it.id).filter((id) => id !== victim.id), `hand key ${k.key} keeps its live lessons`);
  }
  assert.ok(!Object.values(t.keyword_map).flat().includes(victim.id));
  // the hand source is untouched: same bytes, not rewritten
  assert.strictEqual(fs.readFileSync(handPath(dir), 'utf8'), handBefore);
  assert.strictEqual(fs.statSync(handPath(dir)).mtimeMs, handStat);
  // and the run is idempotent
  assert.match(run(PREP, ['--root', dir]).out, /already up to date/);
});

test('a retired hand key (its only lesson deleted) stays hand: it is never generated from another lesson', async () => {
  const dir = fixture();
  const t0 = topicOf(dir);
  const referenced = referencedIds(dir);
  // a hand key naming a single, deletable lesson, identifier-shaped so the extractor would take it
  const cand = HAND.keys.find((k) => k.items.length === 1 && !referenced.has(k.items[0].id) && /^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(k.key) &&
    k.key.length > 8 && !Object.keys(t0.keyword_map).some((o) => o !== k.key && compileKey(o).joined === compileKey(k.key).joined));
  assert.ok(cand, 'fixture needs a single-lesson identifier hand key');
  const victim = t0.lessons.find((l) => l.id === cand.items[0].id);
  const host = t0.lessons.find((l) => l.id !== victim.id && l.file !== victim.file && !referenced.has(l.id));
  deleteLesson(dir, victim);
  assert.strictEqual(run(BUILD, ['--root', dir]).code, 0);
  insertIntoLesson(dir, host.id, ['', `Mentions \`${cand.key}\` twice: \`${cand.key}\`.`]);
  const reportFile = path.join(dir, 'report.json');
  const p = run(PREP, ['--root', dir, '--report', reportFile]);
  assert.strictEqual(p.code, 0, p.out);
  // the retired rule is what kept it out (without it, the key would have been generated)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(reportFile, 'utf8')).report.retired.filter((r) => r.key === cand.key).map((r) => r.home), [[host.id]]);
  const t = topicOf(dir);
  assert.ok(!(cand.key in t.keyword_map), 'a retired hand key came back as a generated key');
  assert.ok(!(t.lessons.find((l) => l.id === host.id).identifier_keys || []).includes(cand.key));
  assert.deepStrictEqual(await dropStaleProposals(dir), []);
  // unit form of the same rule
  const { derived, report } = P.planIdentifiers(miniTopic({}, [[1]]), () => '`retired_hand_key`', { retired: new Set(['retired_hand_key']) });
  assert.deepStrictEqual(derived, []);
  assert.deepStrictEqual(report.retired.map((r) => r.key), ['retired_hand_key']);
  assert.strictEqual(report.unreachable, 0);
});

// --- unreachable ceiling ------------------------------------------------------------

test('the UNREACHABLE count cannot grow silently', () => {
  const dir = fixture();
  const n = topicOf(dir)[BOUNDARY_FIELD].unreachable_max;
  assert.ok(Number.isInteger(n));
  editTree(dir, (tree) => {
    const b = entry(tree, BOUNDARY_FIELD)[1];
    entry(b, 'unreachable_max')[1] = { t: 'raw', text: String(n - 1) };
  });
  const r = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`UNREACHABLE identifiers rose from ${n - 1} to ${n}`));
  assert.strictEqual(run(BUILD, ['--check', '--root', dir]).code, 1);
  const refused = run(PREP, ['--root', dir]);
  assert.strictEqual(refused.code, 1, refused.out);
  assert.match(refused.out, /--accept-unreachable/);
  assert.strictEqual(run(PREP, ['--root', dir, '--accept-unreachable']).code, 0);
  assert.strictEqual(topicOf(dir)[BOUNDARY_FIELD].unreachable_max, n);
  assert.strictEqual(run(PREP, ['--check', '--root', dir]).code, 0);
});

test('the UNREACHABLE ceiling must be a present non-negative integer; only --accept-unreachable (re)sets it', () => {
  const n = committed()[BOUNDARY_FIELD].unreachable_max;
  const mutations = {
    'field deleted': (b) => { b.entries = b.entries.filter(([k]) => k !== '"unreachable_max"'); },
    'a string': (b) => { entry(b, 'unreachable_max')[1] = { t: 'raw', text: JSON.stringify(String(n)) }; },
    negative: (b) => { entry(b, 'unreachable_max')[1] = { t: 'raw', text: '-1' }; },
    fractional: (b) => { entry(b, 'unreachable_max')[1] = { t: 'raw', text: `${n}.5` }; },
    'record deleted': null,
  };
  for (const [what, mutate] of Object.entries(mutations)) {
    const dir = fixture();
    editTree(dir, (tree) => {
      if (mutate) mutate(entry(tree, BOUNDARY_FIELD)[1]);
      else tree.entries = tree.entries.filter(([k]) => k !== JSON.stringify(BOUNDARY_FIELD));
    });
    const before = fs.readFileSync(topicPath(dir), 'utf8');
    const c = run(PREP, ['--check', '--root', dir]);
    assert.strictEqual(c.code, 1, `${what}: ${c.out}`);
    assert.match(c.out, what === 'record deleted' ? /no keyword_boundary record/ : /unreachable_max (is missing|must be a non-negative integer)/, what);
    assert.strictEqual(run(BUILD, ['--check', '--root', dir]).code, 1, what);
    const w = run(PREP, ['--root', dir]);
    assert.strictEqual(w.code, 1, `${what}: a plain run must not treat a malformed ceiling as initialization`);
    assert.match(w.out, /--accept-unreachable/);
    assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), before, `${what}: written without the flag`);
    const ok = run(PREP, ['--root', dir, '--accept-unreachable']);
    assert.strictEqual(ok.code, 0, `${what}: ${ok.out}`);
    assert.deepStrictEqual(topicOf(dir)[BOUNDARY_FIELD], { unreachable_max: n }, what);
    assert.strictEqual(run(BUILD, ['--check', '--root', dir]).code, 0, what);
  }
  // unit form
  assert.deepStrictEqual(P.ceilingOf({ [BOUNDARY_FIELD]: { unreachable_max: 0 } }), { value: 0 });
  for (const bad of [{}, { [BOUNDARY_FIELD]: {} }, { [BOUNDARY_FIELD]: { unreachable_max: '84' } }, { [BOUNDARY_FIELD]: { unreachable_max: -1 } }, { [BOUNDARY_FIELD]: { unreachable_max: null } }]) {
    assert.ok(P.ceilingOf(bad).error, JSON.stringify(bad));
  }
});

test('a ceiling above the count is lowered automatically by a plain run', () => {
  const dir = fixture();
  const n = topicOf(dir)[BOUNDARY_FIELD].unreachable_max;
  editTree(dir, (tree) => { entry(entry(tree, BOUNDARY_FIELD)[1], 'unreachable_max')[1] = { t: 'raw', text: String(n + 5) }; });
  assert.strictEqual(run(PREP, ['--check', '--root', dir]).code, 0, 'a higher ceiling is not a failure');
  assert.strictEqual(run(PREP, ['--root', dir]).code, 0);
  assert.strictEqual(topicOf(dir)[BOUNDARY_FIELD].unreachable_max, n);
});

// --- TF-IDF: generated keys reach the keyword layer only -------------------------------

test('the TF-IDF index is identical with and without the generated keys', () => {
  const cur = committed();
  assert.deepStrictEqual(buildIndex(cur), buildIndex(handTopic(cur, HAND).topic));
});

// --- consumers ignore generated keys ------------------------------------------------------

test('lookup.sh ignores generated keys', (t) => {
  if (spawnSync('jq', ['--version']).status !== 0) { t.skip('jq not installed'); return; }
  const dir = fixture();
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(SCRIPTS, 'lookup.sh'), path.join(dir, 'scripts', 'lookup.sh'));
  insertIntoLesson(dir, 107, ['', `A new knob: \`${KNOB}\`.`]);
  assert.strictEqual(run(PREP, ['--root', dir]).code, 0);
  assert.deepStrictEqual(topicOf(dir).keyword_map[KNOB], [107]);
  const q = spawnSync('bash', [path.join(dir, 'scripts', 'lookup.sh'), 'prepare_lessons_test_knob'], { encoding: 'utf8' });
  assert.strictEqual(q.status, 1, q.stdout);
  assert.match(q.stderr, /No matches/);
  const hand = spawnSync('bash', [path.join(dir, 'scripts', 'lookup.sh'), 'hooks'], { encoding: 'utf8' });
  assert.strictEqual(hand.status, 0);
  // a vocabulary key that is the only key containing its word is ignored too
  const ti = topicOf(dir);
  const words = new Map();
  for (const k of Object.keys(ti.keyword_map)) for (const w of k.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 5)) words.set(w, (words.get(w) || []).concat(k));
  const vocabOnly = [...words].find(([w, ks]) => ks.length === 1 && ti.lessons.some((l) => (l.vocab_keys || []).includes(ks[0])) && !Object.keys(ti.keyword_map).some((k) => k !== ks[0] && k.toLowerCase().includes(w)));
  assert.ok(vocabOnly, 'some word occurs only in one vocabulary key');
  const v = spawnSync('bash', [path.join(dir, 'scripts', 'lookup.sh'), vocabOnly[0]], { encoding: 'utf8' });
  assert.strictEqual(v.status, 1, `${vocabOnly[0]}: ${v.stdout}`);
});

test('search.js, semantic-search.js and fetch-lesson.js print hand keywords only', () => {
  const cur = committed();
  const lesson = cur.lessons.find((l) => l.id === 89);
  assert.ok(lesson.identifier_keys.length, 'lesson 89 carries generated identifier keys');
  assert.ok(lesson.vocab_keys.length, 'lesson 89 carries generated vocabulary keys');
  for (const k of lesson.vocab_keys) assert.ok(!handKeywords(lesson).includes(k), `vocab key ${k} is not a hand keyword`);
  const meta = JSON.parse(execFileSync('node', [path.join(SCRIPTS, 'fetch-lesson.js'), '89', '--meta'], { encoding: 'utf8' }));
  assert.deepStrictEqual(meta.keywords, handKeywords(lesson));
  for (const script of ['search.js', 'semantic-search.js']) {
    const out = JSON.parse(execFileSync('node', [path.join(SCRIPTS, script), '--json', 'cowork background session daemon fleet'], { encoding: 'utf8' }));
    assert.ok(out.length);
    for (const r of out) {
      const l = cur.lessons.find((x) => x.id === r.id);
      assert.deepStrictEqual(r.keywords, handKeywords(l), `${script} lesson ${r.id}`);
    }
  }
});

// --- --check ------------------------------------------------------------------------

test('--check passes on the committed tree', () => {
  const r = run(PREP, ['--check']);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /prepare-lessons check OK/);
  const sp = spawnSync('node', [PREP, '--check'], { encoding: 'utf8' });
  // Stale proposals warn, not fail (P.STALE_VOCAB_BLOCKS; were it true, the exit
  // code above would already be 1). Any other warning (unknown generation input,
  // integrity) is a committed defect.
  const warnings = (sp.stdout + sp.stderr).split('\n').filter((l) => /WARNING/.test(l));
  const stale = warnings.filter((l) => /changed since their vocabulary proposal was generated/.test(l));
  assert.deepStrictEqual(warnings.filter((l) => !stale.includes(l)), [], 'no unknown-input or other vocabulary warning is committed');
  if (stale.length) console.log(`# stale vocabulary proposals (warn only, not a failure): ${stale.join(' ')}`);
});

test('--check refuses to judge stale bounds', () => {
  const dir = fixture();
  const l = topicOf(dir).lessons.find((x) => x.id === 107);
  const file = path.join(dir, 'references', l.file);
  const all = fs.readFileSync(file, 'utf8').split('\n');
  all.splice(l.startLine, 0, 'an inserted line');
  fs.writeFileSync(file, all.join('\n'));
  const r = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /run node scripts\/build\.js first/);
});

// --- write guard ------------------------------------------------------------------------

test('an input edited while the pass runs aborts the write; nothing is written, not even the report', () => {
  const dir = fixture();
  insertIntoLesson(dir, 107, ['', `A new knob: \`${KNOB}\`.`]);
  const tiBefore = fs.readFileSync(topicPath(dir), 'utf8');
  const l = topicOf(dir).lessons.find((x) => x.id === 107);
  const file = path.join(dir, 'references', l.file);
  const reportFile = path.join(dir, 'report.json');
  const quiet = () => {};
  assert.throws(
    () => P.runIdentifiers(dir, { reportFile, beforeWrite: () => fs.appendFileSync(file, '\nedited by a peer mid-run\n') }, quiet),
    (e) => e.code === 'EINPUTCHANGED' && e.message.includes(l.file),
  );
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), tiBefore, 'topic-index.json was written despite the abort');
  assert.ok(!fs.existsSync(reportFile), 'the report was written before the result was validated and written');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'references')).filter((f) => f.endsWith('.tmp')), [], 'no temp file left behind');

  // topic-index.json itself edited mid-run is a change too.
  const dir2 = fixture();
  insertIntoLesson(dir2, 107, ['', `A new knob: \`${KNOB}\`.`]);
  assert.throws(
    () => P.runIdentifiers(dir2, { beforeWrite: () => fs.appendFileSync(topicPath(dir2), ' ') }, quiet),
    (e) => e.code === 'EINPUTCHANGED' && e.message.includes('topic-index.json'),
  );
});

// --- HEAD guard (file-writing scripts stop on HEAD or content-hash changes) ------------------

/** git, isolated from the user's and the system's config and hooks. */
function git(dir, ...args) {
  const hooks = path.join(dir, '.no-hooks');
  fs.mkdirSync(hooks, { recursive: true });
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${hooks}`, '-C', dir, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' },
  });
}
function gitFixture() {
  const dir = fixture();
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  return dir;
}

test('prepare-lessons.js: HEAD moving mid-run (no file changed) aborts the write', (t) => {
  if (spawnSync('git', ['--version']).status !== 0) { t.skip('git not installed'); return; }
  const { gitHead } = require('../build.js');
  const dir = gitFixture();
  insertIntoLesson(dir, 107, ['', `A new knob: \`${KNOB}\`.`]);
  const before = fs.readFileSync(topicPath(dir), 'utf8');
  const h0 = gitHead(dir);
  assert.match(h0, /^[0-9a-f]{40}/);
  assert.throws(
    () => P.runIdentifiers(dir, { beforeWrite: () => git(dir, 'commit', '-q', '--allow-empty', '-m', 'peer') }, () => {}),
    (e) => e.code === 'EINPUTCHANGED' && /git HEAD moved/.test(e.message),
  );
  assert.notStrictEqual(gitHead(dir), h0);
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), before);
  // HEAD still: the same run writes
  assert.strictEqual(P.runIdentifiers(dir, {}, () => {}).wrote, true);
});

test('build.js: HEAD moving mid-run aborts the write; outside git the guard is skipped', (t) => {
  if (spawnSync('git', ['--version']).status !== 0) { t.skip('git not installed'); return; }
  const { build, gitHead, writeOutputs } = require('../build.js');
  const dir = gitFixture();
  const l = topicOf(dir).lessons.find((x) => x.id === 107);
  const file = path.join(dir, 'references', l.file);
  const all = fs.readFileSync(file, 'utf8').split('\n');
  all.splice(l.startLine, 0, 'an inserted line');
  fs.writeFileSync(file, all.join('\n')); // stale bounds: build.js has something to write
  const before = fs.readFileSync(topicPath(dir), 'utf8');
  const derived = build(dir);
  derived.head = gitHead(dir);
  derived.headDir = dir;
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'peer');
  assert.throws(() => writeOutputs(derived), (e) => e.code === 'EINPUTCHANGED' && /git HEAD moved/.test(e.message));
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), before);
  assert.strictEqual(run(BUILD, ['--root', dir]).code, 0, 'HEAD still: the CLI writes');

  // not a git work tree: no HEAD, no guard, and --check never needs git
  const plain = fixture();
  assert.strictEqual(gitHead(plain), null);
  const env = { ...process.env, PATH: '/nonexistent' };
  const c = spawnSync(process.execPath, [BUILD, '--check', '--root', plain], { encoding: 'utf8', env });
  assert.strictEqual(c.status, 0, c.stdout + c.stderr);
});

// --- vocabulary (rule 4, lib/vocab.js) ------------------------------------------------

test('vocabulary rules: clean, drop identifiers / existing keys / hand keywords / long terms, share across at most 2 lessons', () => {
  const state = new P.KeyState({ hooks: [1], 'plugin cache': [2] });
  const handKw = new Map([[1, new Set(['why hooks do not fire'])], [2, new Set()], [3, new Set()], [4, new Set()]]);
  const prop = (terms) => ({ model: 'm', prompt_version: 'v', date: '2026-01-01', terms });
  const byId = new Map([
    [1, prop(['  "Why do my HOOKS not fire?" ', 'Hooks', 'set CLAUDE_CODE_FOO to fix it', 'use `hooks` wisely', 'Why hooks do not fire', 'x'.repeat(81), 'shared phrase here'])],
    [2, prop(['plugin-cache', 'Shared phrase here!', 'the café problem', 'wide phrase'])],
    [3, prop(['wide phrase', 'only mine'])],
    [4, prop(['wide phrase'])],
  ]);
  const lessons = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
  const r = V.planVocab(lessons, state, handKw, byId);
  assert.deepStrictEqual(r.derived.map((d) => [d.key, d.lessons]), [
    ['why do my hooks not fire', [1]],
    ['shared phrase here', [1, 2]],
    ['only mine', [3]],
  ]);
  assert.deepStrictEqual(r.missing, [5]);
  assert.deepStrictEqual([...r.stamps.keys()], [1, 2, 3, 4]);
  assert.deepStrictEqual(r.report.dropped, {
    'already a key': 2, 'contains an identifier': 2, 'too long': 1, 'non-ascii': 1,
    'a hand keyword of its lesson': 1, 'proposed for more than 2 lessons': 1,
  });
});

test('the committed index carries vocabulary for every lesson, keyword layer only', () => {
  const cur = committed();
  const props = loadProposals(SKILL_DIR);
  assert.deepStrictEqual(props.errors, []);
  for (const l of cur.lessons) {
    assert.ok(props.byId.has(l.id), `lesson ${l.id} has proposals`);
    const p = props.byId.get(l.id);
    assert.deepStrictEqual(l.vocab, { model: p.model, prompt_version: p.prompt_version, date: p.date, terms_sha256: V.termsSha256(p.terms) });
  }
  const vocabKeys = cur.lessons.flatMap((l) => l.vocab_keys || []);
  assert.ok(vocabKeys.length > 1000);
  for (const k of vocabKeys) assert.ok(!HAND.keySet.has(k), `${k} is generated, not hand`);
});

test('the proposals file is tracked outside the shipped skill directory and is the pinned one', () => {
  const abs = proposalsPath(SKILL_DIR);
  assert.strictEqual(path.relative(path.join(SKILL_DIR, '..', '..', '..'), abs), PROPOSALS_FILE);
  assert.ok(!abs.startsWith(path.join(SKILL_DIR, '..', '..') + path.sep), 'not under skill-package/');
  assert.strictEqual(loadProposals(SKILL_DIR).sha256, V.PROPOSALS_SHA256);
  // every entry records the hash of the prompt it was generated from, and it is the current one
  const loaded = P.load(SKILL_DIR);
  const props = loadProposals(SKILL_DIR);
  const { stale, unknown } = V.staleProposals(loaded.topic.lessons, loaded.lessonText, props.byId);
  assert.deepStrictEqual(unknown, [], 'every proposal records the input it was generated from');
  for (const l of loaded.topic.lessons) assert.ok(props.byId.has(l.id), `lesson ${l.id} has a proposal`);
  // Stale ones warn by design (a lesson prose edit must not fail CI); P.STALE_VOCAB_BLOCKS flips that.
  if (P.STALE_VOCAB_BLOCKS) assert.deepStrictEqual(stale, [], 'no stale vocabulary proposal is committed');
  else if (stale.length) console.log(`# stale vocabulary proposals (warn only, not a failure): lessons ${stale.join(', ')}`);
});

test('a lesson without vocabulary proposals fails --check and names --generate', () => {
  const dir = fixture();
  const props = loadProposals(dir);
  props.byId.delete(107);
  fs.writeFileSync(proposalsPath(dir), V.renderProposals(props.byId));
  const r = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /1 lesson\(s\) have no vocabulary proposals .*\(107\).*--generate/);
  assert.match(r.out, /is not the pinned proposals file/, 'the edit itself is caught by the pin');
  assert.strictEqual(run(BUILD, ['--check', '--root', dir]).code, 1);
});

test('an edited, missing or stale-entry proposals file fails --check; --generate drops stale entries and prints the new hash', async () => {
  const dir = fixture();
  // one term edited by hand: the derivation would still check, the pin does not
  const props = loadProposals(dir);
  props.byId.get(89).terms[0] = 'a hand edit';
  fs.writeFileSync(proposalsPath(dir), V.renderProposals(props.byId));
  const edited = run(BUILD, ['--check', '--root', dir]);
  assert.strictEqual(edited.code, 1, edited.out);
  assert.match(edited.out, /data\/vocab-proposals\.json is not the pinned proposals file .*PROPOSALS_SHA256/);
  assert.match(edited.out, /vocab stamp other than their proposal's: 89/, 'the stamp records the terms hash');
  // an entry for a lesson that is not in the index
  const fresh = fixture();
  const p2 = loadProposals(fresh);
  p2.byId.set(9999, { model: 'm', prompt_version: 'p', date: 'd', terms: ['x'] });
  fs.writeFileSync(proposalsPath(fresh), V.renderProposals(p2.byId));
  const stale = run(PREP, ['--check', '--root', fresh]);
  assert.strictEqual(stale.code, 1, stale.out);
  assert.match(stale.out, /proposals for 1 lesson id\(s\) not in the index \(9999\)/);
  const lines = [];
  const noModel = async () => { throw new Error('no model call expected'); };
  // the added entry is itself an unpinned edit: --generate refuses to start from it
  const edit = fs.readFileSync(proposalsPath(fresh), 'utf8');
  await assert.rejects(P.runGenerate(fresh, {}, { callModel: noModel }, () => {}), /is not the pinned proposals file/);
  assert.strictEqual(fs.readFileSync(proposalsPath(fresh), 'utf8'), edit, 'nothing written');
  // accepted deliberately (--bootstrap), the entry of a lesson not in the index is dropped
  await P.runGenerate(fresh, { bootstrap: true }, { callModel: noModel }, (l) => lines.push(l));
  assert.ok(!loadProposals(fresh).byId.has(9999), 'dropped');
  const hash = loadProposals(fresh).sha256;
  assert.strictEqual(hash, V.PROPOSALS_SHA256, 'dropping the added entry restores the committed file');
  assert.ok(lines.some((l) => l.includes(`sha256 is now ${hash}`)), lines.join('\n'));
  assert.ok(lines.some((l) => /set PROPOSALS_SHA256 in scripts\/lib\/vocab\.js/.test(l)), lines.join('\n'));
  assert.strictEqual(run(PREP, ['--check', '--root', fresh]).code, 0);
  // missing
  fs.rmSync(proposalsPath(fresh));
  const gone = run(PREP, ['--check', '--root', fresh]);
  assert.strictEqual(gone.code, 1, gone.out);
  assert.match(gone.out, /data\/vocab-proposals\.json is missing/);
});

test('stored vocab_keys and vocab stamps must equal the derivation from the proposals; a plain run restores them', () => {
  const dir = fixture();
  const original = fs.readFileSync(topicPath(dir), 'utf8');
  editTree(dir, (tree) => {
    const item = lessonItems(tree).find((it) => idOf(it) === 89);
    const vk = entry(item, 'vocab_keys')[1];
    vk.items = vk.items.slice(1);
    entry(entry(item, 'vocab')[1], 'model')[1] = { t: 'raw', text: '"someone-else"' };
  });
  const r = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /record other vocab_keys than derived/);
  assert.match(r.out, /vocab stamp other than their proposal/);
  assert.strictEqual(run(PREP, ['--root', dir]).code, 0);
  assert.strictEqual(fs.readFileSync(topicPath(dir), 'utf8'), original);
});

test('--generate asks the model only for lessons without proposals, adds them, and derives their keys (stubbed model)', async () => {
  const dir = fixture();
  freshen(dir); // no committed-stale lesson: every model call below is for a missing proposal
  const props = loadProposals(dir);
  props.byId.delete(107);
  props.byId.delete(12);
  fs.writeFileSync(proposalsPath(dir), V.renderProposals(props.byId));
  const calls = [];
  const callModel = async (prompt, { model }) => {
    calls.push({ model, title: prompt.match(/^LESSON TITLE: (.*)$/m)[1] });
    return JSON.stringify({ type: 'result', is_error: false, result: '```json\n{"terms": ["a stubbed phrase for testing", "CLAUDE_CODE_NOPE is dropped"]}\n```' });
  };
  const quiet = () => {};
  // the maintainer's starting point is a pinned file (here: pinned by the test)
  const pinned = loadProposals(dir).sha256;
  const dry = await P.runGenerate(dir, { dryRun: true, proposalsPin: pinned }, { callModel }, quiet);
  assert.strictEqual(dry.generated, 0);
  assert.strictEqual(calls.length, 0, 'a dry run calls no model');
  const lines = [];
  const r = await P.runGenerate(dir, { proposalsPin: pinned }, { callModel, date: '2026-09-28' }, (l) => lines.push(l));
  assert.strictEqual(r.generated, 2);
  assert.deepStrictEqual(calls.map((c) => c.model), [V.DEFAULT_MODEL, V.DEFAULT_MODEL]);
  const after = loadProposals(dir);
  const loaded = P.load(dir);
  for (const id of [12, 107]) {
    const l = loaded.topic.lessons.find((x) => x.id === id);
    // A lesson without terms gets the fresh prompt; outside a repository (no evals/) the collision
    // check cannot run, and the proposal says so.
    assert.deepStrictEqual(after.byId.get(id), { model: V.DEFAULT_MODEL, prompt_version: V.PROMPT_VERSION, date: '2026-09-28',
      input_sha256: V.inputSha256(l, loaded.lessonText(l)), collision_check: 'skipped: no evals/retrieval next to the skill package',
      terms: ['a stubbed phrase for testing', 'CLAUDE_CODE_NOPE is dropped'] });
  }
  const t = topicOf(dir);
  assert.deepStrictEqual(t.keyword_map['a stubbed phrase for testing'], [12, 107]);
  assert.ok(!('claude_code_nope is dropped' in t.keyword_map));
  // the new file is not the pinned one until the constant is updated: the run says so, --check fails
  assert.ok(lines.some((l) => l.includes(`sha256 is now ${after.sha256}`)), lines.join('\n'));
  const check = run(PREP, ['--check', '--root', dir]);
  assert.strictEqual(check.code, 1, check.out);
  assert.match(check.out, /is not the pinned proposals file/);
  // with the constant updated (passed as the pin), everything else checks clean
  const res = P.checkLessons({ raw: fs.readFileSync(topicPath(dir), 'utf8'), lessonText: P.load(dir).lessonText, hand: HAND, proposals: after, proposalsPin: after.sha256 });
  assert.deepStrictEqual(res.errors, []);
  // nothing left to generate: no further calls
  await P.runGenerate(dir, { proposalsPin: after.sha256 }, { callModel }, quiet);
  assert.strictEqual(calls.length, 2);
});

// --- stale vocabulary: the lesson changed since the model saw it ------------------------

/** Replace `from` with `to` on one line inside a lesson (same line count, bounds unchanged). */
function editLessonLine(dir, lessonId, from, to) {
  const l = topicOf(dir).lessons.find((x) => x.id === lessonId);
  const file = path.join(dir, 'references', l.file);
  const all = fs.readFileSync(file, 'utf8').split('\n');
  const i = all.findIndex((x, n) => n >= l.startLine && n < l.endLine && x.includes(from));
  assert.ok(i >= 0, `lesson ${lessonId} has a line containing ${from}`);
  all[i] = all[i].replace(from, to);
  fs.writeFileSync(file, all.join('\n'));
}
/**
 * The lesson the vocabulary-update tests below edit. It must be current in the committed tree (one
 * test asserts that the edit makes it, and only it, stale), leave room under MAX_TERMS_CAP for the
 * terms the tests add, and have a " the " line for editLessonLine. These tests used lesson 89 by
 * number, which broke whenever a real edit to lesson 89 grew its proposal to the cap; 89 is still
 * preferred while it qualifies.
 */
const VL = (() => {
  const loaded = P.load(SKILL_DIR);
  const byId = loadProposals(SKILL_DIR).byId;
  const stale = new Set(V.staleProposals(loaded.topic.lessons, loaded.lessonText, byId).stale);
  const hasThe = (l) => fs.readFileSync(path.join(SKILL_DIR, 'references', l.file), 'utf8').split('\n')
    .some((x, n) => n >= l.startLine && n < l.endLine && x.includes(' the '));
  const ok = (l) => byId.has(l.id) && !stale.has(l.id) && byId.get(l.id).terms.length <= V.MAX_TERMS_CAP - 3 && hasThe(l);
  const pick = loaded.topic.lessons.find((l) => l.id === 89 && ok(l)) || loaded.topic.lessons.find(ok);
  assert.ok(pick, 'some lesson qualifies as the vocabulary-update fixture');
  return pick.id;
})();
const stubTerms = (terms) => async () => JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ terms }) });

test('a lesson edited after its vocabulary was generated: --check warns by id (no failure), --generate regenerates only it', async () => {
  const dir = fixture();
  // The CLI checks only the pinned proposals file, so the fixture keeps the committed one here and
  // this part asserts on the delta: whatever the committed tree already has stale, plus the fixture lesson VL.
  const baseline = staleIn(dir);
  assert.ok(!baseline.includes(VL), `lesson ${VL} starts current`);
  const l89 = topicOf(dir).lessons.find((x) => x.id === VL);
  const word = P.load(dir).lessonText(l89).split('\n').slice(2).join(' ').match(/\b(the|a|is|and)\b/)[0];
  editLessonLine(dir, VL, ` ${word} `, ` ${word} quite `);
  assert.strictEqual(run(BUILD, ['--root', dir]).code, 0);
  const expected = topicOf(dir).lessons.map((l) => l.id).filter((id) => id === VL || baseline.includes(id));
  assert.deepStrictEqual(staleIn(dir), expected, `the edit made ${VL} stale, and nothing else`);
  const staleLine = `${expected.length} lesson\\(s\\) changed since their vocabulary proposal was generated \\(${expected.join(', ')}\\).*--generate`;
  // P.STALE_VOCAB_BLOCKS (false: the design) decides warn vs fail; both branches are pinned here.
  const blocks = P.STALE_VOCAB_BLOCKS;
  for (const script of [BUILD, PREP]) {
    const sp = spawnSync('node', [script, '--check', '--root', dir], { encoding: 'utf8' });
    const r = { code: sp.status, out: sp.stdout + sp.stderr };
    assert.strictEqual(r.code, blocks ? 1 : 0, `${path.basename(script)} --check ${blocks ? 'must fail' : 'must not fail'} on a prose edit:\n${r.out}`);
    assert.match(sp.stderr, new RegExp(blocks ? staleLine : `WARNING: .*${staleLine}`));
  }
  // From here on the fixture starts fresh: only VL is stale (the file is re-pinned in-process).
  const pin = freshen(dir, [VL]);
  assert.deepStrictEqual(staleIn(dir), [VL]);
  const res = P.checkLessons({ raw: fs.readFileSync(topicPath(dir), 'utf8'), lessonText: P.load(dir).lessonText, hand: HAND, proposals: loadProposals(dir), proposalsPin: pin });
  assert.strictEqual(res.errors.filter((e) => /changed since their vocabulary proposal/.test(e)).length, blocks ? 1 : 0);
  assert.strictEqual(res.warnings.length, blocks ? 0 : 1);
  if (!blocks) assert.deepStrictEqual(res.errors, []);
  // --generate (no --regen) UPDATES the stale lesson, and only it: its previous terms plus the edited text
  const priorTerms = loadProposals(dir).byId.get(VL).terms;
  const prompts = [];
  const callModel = async (prompt) => { prompts.push(prompt); return stubTerms(['a regenerated phrase for testing'])(); };
  const lines = [];
  await P.runGenerate(dir, { proposalsPin: pin }, { callModel, date: '2026-09-29' }, (l) => lines.push(l));
  assert.strictEqual(prompts.length, 1, lines.join('\n'));
  assert.match(prompts[0], new RegExp(`LESSON TITLE: ${l89.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.ok(prompts[0].includes(` ${word} quite `), 'the prompt carries the edited text');
  for (const t of priorTerms) assert.ok(prompts[0].includes(`\n- ${t}\n`), `the update prompt lists the previous term "${t}"`);
  assert.match(prompts[0], /KEEP every term that is still true/);
  assert.ok(lines.some((l) => new RegExp(`1 proposal\\(s\\) are stale .* updated from their previous terms: ${VL}`).test(l)), lines.join('\n'));
  const after = loadProposals(dir);
  const l89now = P.load(dir).topic.lessons.find((x) => x.id === VL);
  // input_sha256 identifies the lesson text (the fresh prompt's hash), not the update prompt sent,
  // so the updated proposal is current at once.
  assert.strictEqual(after.byId.get(VL).input_sha256, V.inputSha256(l89now, P.load(dir).lessonText(l89now)));
  assert.notStrictEqual(after.byId.get(VL).input_sha256, require('crypto').createHash('sha256').update(prompts[0]).digest('hex'));
  assert.strictEqual(after.byId.get(VL).prompt_version, V.UPDATE_PROMPT_VERSION);
  assert.strictEqual(after.byId.get(VL).prior_terms_sha256, V.termsSha256(priorTerms));
  // The stub's bare {"terms"} reply mentions no previous term: every one is kept by rule (a
  // reply that leaves a term out never drops it), and its one phrase is added, under the cap.
  const p89 = after.byId.get(VL);
  assert.deepStrictEqual(p89.terms, [...priorTerms, 'a regenerated phrase for testing']);
  assert.deepStrictEqual(p89.replaced, []);
  assert.deepStrictEqual(p89.kept_by_rule.map((k) => k.term), priorTerms);
  assert.ok(p89.kept_by_rule.every((k) => k.reason === 'not listed in keep or drop'));
  // The fixture is not a git checkout, so the previous text is not found and nothing is added for a topic.
  assert.match(prompts[0], /ADD nothing/);
  assert.doesNotMatch(prompts[0], /LESSON TEXT BEFORE THE EDIT/);
  assert.strictEqual(p89.previous_text, 'not found');
  const now = P.checkLessons({ raw: fs.readFileSync(topicPath(dir), 'utf8'), lessonText: P.load(dir).lessonText, hand: HAND, proposals: after, proposalsPin: after.sha256 });
  assert.deepStrictEqual([now.errors, now.warnings], [[], []]);
});

test('a proposal without input_sha256 has unknown inputs: warned, kept by --generate, replaced by --regen', async () => {
  const dir = fixture();
  freshen(dir); // no committed-stale lesson: --generate has nothing else to regenerate
  const props = loadProposals(dir);
  delete props.byId.get(VL).input_sha256;
  fs.writeFileSync(proposalsPath(dir), V.renderProposals(props.byId));
  const pinned = loadProposals(dir).sha256;
  const res = P.checkLessons({ raw: fs.readFileSync(topicPath(dir), 'utf8'), lessonText: P.load(dir).lessonText, hand: HAND, proposals: loadProposals(dir), proposalsPin: pinned });
  assert.deepStrictEqual(res.errors, []);
  assert.match(res.warnings.join('\n'), new RegExp(`1 lesson\\(s\\) have a vocabulary proposal whose generation inputs are unknown \\(no input_sha256: ${VL}\\).*--regen`));
  let calls = 0;
  const callModel = async () => { calls++; return stubTerms(['a regenerated phrase for testing'])(); };
  await P.runGenerate(dir, { proposalsPin: pinned }, { callModel }, () => {});
  assert.strictEqual(calls, 0, 'unknown inputs are not regenerated by default');
  await P.runGenerate(dir, { proposalsPin: pinned, regen: [VL] }, { callModel }, () => {});
  assert.strictEqual(calls, 1);
  assert.match(loadProposals(dir).byId.get(VL).input_sha256, /^[0-9a-f]{64}$/);
});

test('a lesson edited while the model runs aborts the write: nothing written', async () => {
  const dir = fixture();
  const props = loadProposals(dir);
  props.byId.delete(VL);
  fs.writeFileSync(proposalsPath(dir), V.renderProposals(props.byId));
  const before = fs.readFileSync(proposalsPath(dir), 'utf8');
  const l89 = topicOf(dir).lessons.find((x) => x.id === VL);
  const word = P.load(dir).lessonText(l89).split('\n').slice(2).join(' ').match(/\b(the|a|is|and)\b/)[0];
  const callModel = async () => { editLessonLine(dir, VL, ` ${word} `, ` ${word} quite `); return stubTerms(['a phrase for testing'])(); };
  await assert.rejects(P.runGenerate(dir, { proposalsPin: loadProposals(dir).sha256 }, { callModel }, () => {}), new RegExp(`lesson\\(s\\) ${VL} changed while the model ran.*nothing written`));
  assert.strictEqual(fs.readFileSync(proposalsPath(dir), 'utf8'), before);
});

// --- generation starts only from the pinned proposals file ---------------------------------

test('--generate refuses to start from an unpinned (hand-edited) or missing proposals file; --bootstrap is explicit', async () => {
  const dir = fixture();
  freshen(dir); // no committed-stale lesson: the --bootstrap run below regenerates only lesson 2
  const props = loadProposals(dir);
  props.byId.get(1).terms[0] = 'a manual phrase';
  fs.writeFileSync(proposalsPath(dir), V.renderProposals(props.byId));
  const edited = fs.readFileSync(proposalsPath(dir), 'utf8');
  let calls = 0;
  const callModel = async () => { calls++; return stubTerms(['a regenerated phrase for testing'])(); };
  for (const opts of [{ regen: [2] }, {}, { regen: [2], dryRun: true }]) {
    await assert.rejects(P.runGenerate(dir, opts, { callModel }, () => {}),
      /is not the pinned proposals file .*nothing generated.*previous --generate run, set PROPOSALS_SHA256.*--bootstrap/);
  }
  assert.strictEqual(calls, 0, 'no model call');
  assert.strictEqual(fs.readFileSync(proposalsPath(dir), 'utf8'), edited, 'nothing written');
  // the command line says the same, and exits 1
  const cli = run(PREP, ['--regen', '2', '--root', dir]);
  assert.strictEqual(cli.code, 1, cli.out);
  assert.match(cli.out, /is not the pinned proposals file/);
  // --bootstrap: the maintainer accepts the file as it is (an intentional re-pin)
  const lines = [];
  await P.runGenerate(dir, { regen: [2], bootstrap: true }, { callModel }, (l) => lines.push(l));
  assert.strictEqual(calls, 1);
  assert.match(lines.join('\n'), /--bootstrap: starting from the proposals file as it is/);
  assert.strictEqual(loadProposals(dir).byId.get(1).terms[0], 'a manual phrase', 'kept, because --bootstrap was asked for');
  // a missing file: restore it, unless this is the first-ever file
  const none = fixture();
  fs.rmSync(proposalsPath(none));
  await assert.rejects(P.runGenerate(none, {}, { callModel }, () => {}), /vocab-proposals\.json is missing .*nothing generated.*--bootstrap/);
  assert.strictEqual(calls, 1);
  assert.ok(!fs.existsSync(proposalsPath(none)));
});

test('--bootstrap parses only with --generate / --regen', () => {
  assert.strictEqual(P.parseArgs(['--generate', '--bootstrap']).bootstrap, true);
  assert.strictEqual(P.parseArgs(['--regen', '3', '--bootstrap']).bootstrap, true);
  assert.strictEqual(P.parseArgs(['--generate']).bootstrap, false);
  assert.throws(() => P.parseArgs(['--bootstrap']), /only applies to --generate/);
  assert.throws(() => P.parseArgs(['--check', '--bootstrap']), /only applies to --generate/);
});

test('input_sha256 in the proposals file: optional, a sha256 digest, kept by renderProposals', () => {
  const ok = { model: 'm', prompt_version: 'p', date: 'd', terms: ['x'] };
  assert.deepStrictEqual(V.proposalErrors({ lessons: { 1: ok } }), []);
  assert.deepStrictEqual(V.proposalErrors({ lessons: { 1: { ...ok, input_sha256: 'a'.repeat(64) } } }), []);
  assert.match(V.proposalErrors({ lessons: { 1: { ...ok, input_sha256: 'nope' } } }).join(), /input_sha256 must be a sha256/);
  const text = V.renderProposals(new Map([[1, { ...ok, input_sha256: 'b'.repeat(64) }], [2, ok]]));
  assert.deepStrictEqual(Object.keys(JSON.parse(text).lessons[1]), ['model', 'prompt_version', 'date', 'input_sha256', 'terms']);
  assert.ok(!('input_sha256' in JSON.parse(text).lessons[2]));
  // the hash is of the exact prompt: title, summary and text all count
  const l = { id: 1, title: 'T', description: 'D' };
  const h = V.inputSha256(l, 'body');
  assert.notStrictEqual(V.inputSha256({ ...l, title: 'T2' }, 'body'), h);
  assert.notStrictEqual(V.inputSha256({ ...l, description: 'D2' }, 'body'), h);
  assert.notStrictEqual(V.inputSha256(l, 'body2'), h);
  assert.strictEqual(h, require('crypto').createHash('sha256').update(V.buildPrompt(l, 'body')).digest('hex'));
});

test('--generate command line: default model, flags parsed, never part of --check', () => {
  const o = P.parseArgs(['--generate', '--model', 'claude-x', '--concurrency', '2']);
  assert.strictEqual(o.generate, true);
  assert.strictEqual(o.model, 'claude-x');
  assert.strictEqual(o.concurrency, 2);
  assert.strictEqual(P.parseArgs([]).model, 'claude-opus-5-5');
  assert.deepStrictEqual(P.parseArgs(['--regen', '3,4']).regen, [3, 4]);
  assert.throws(() => P.parseArgs(['--regen', 'x']));
  assert.deepStrictEqual(V.MODEL_FLAGS, ['--safe-mode', '--setting-sources', 'project', '--tools', '']);
});

// --- update mode, --fresh, and the collision check ----------------------------------------

test('--fresh and --regen redraw a stale lesson with the fresh prompt', async () => {
  for (const opts of [{ fresh: true }, { regen: [VL] }]) {
    const dir = fixture();
    editLessonLine(dir, VL, ' the ', ' the quite ');
    assert.strictEqual(run(BUILD, ['--root', dir]).code, 0);
    const pin = freshen(dir, [VL]);
    const prompts = [];
    const callModel = async (prompt) => { prompts.push(prompt); return stubTerms(['a redrawn phrase for testing'])(); };
    await P.runGenerate(dir, { proposalsPin: pin, ...opts }, { callModel, questions: null }, () => {});
    assert.strictEqual(prompts.length, 1, JSON.stringify(opts));
    assert.doesNotMatch(prompts[0], /KEEP every term/, JSON.stringify(opts));
    const p = loadProposals(dir).byId.get(VL);
    assert.strictEqual(p.prompt_version, V.PROMPT_VERSION);
    assert.strictEqual(p.prior_terms_sha256, undefined);
    assert.strictEqual(p.input_sha256, require('crypto').createHash('sha256').update(prompts[0]).digest('hex'));
  }
  assert.throws(() => P.parseArgs(['--fresh']), /--fresh only applies to --generate/);
});

test('the proposals file keeps prior_terms_sha256, collision_check and withheld through render and load', () => {
  const byId = new Map([[7, { model: 'm', prompt_version: V.UPDATE_PROMPT_VERSION, date: 'd', input_sha256: 'a'.repeat(64),
    prior_terms_sha256: 'b'.repeat(64), collision_check: 'questions-v2.json dev', previous_text: 'c'.repeat(40), replaced: ['an old phrase'], dropped: [{ term: 'an old phrase', why: 'inaccurate', replacement: 'x y' }], kept_by_rule: [{ term: 'k', reason: 'r' }], title_term_restored: 'an old phrase', terms: ['x y', 'z w'], withheld: [{ term: 'z w', qid: 'pl-0001' }] }]]);
  const text = V.renderProposals(byId);
  assert.deepStrictEqual(V.proposalErrors(JSON.parse(text)), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cci-props-'));
  SCRATCH.push(dir);
  fs.writeFileSync(path.join(dir, 'p.json'), text);
  assert.deepStrictEqual(V.loadProposals(dir, path.join(dir, 'p.json')).byId.get(7), byId.get(7));
  assert.match(V.proposalErrors({ lessons: { 7: { ...byId.get(7), withheld: [{ term: 'x' }] } } }).join('\n'), /withheld must be/);
  assert.match(V.proposalErrors({ lessons: { 7: { ...byId.get(7), replaced: [1] } } }).join('\n'), /replaced must be/);
});

test('planVocab drops a withheld term', () => {
  const state = { map: new Map(), byNorm: new Map() };
  const prop = { model: 'm', prompt_version: 'v', date: 'd', terms: ['kept phrase here', 'withheld phrase here'], withheld: [{ term: 'Withheld phrase here?', qid: 'q' }] };
  const r = V.planVocab([{ id: 1 }], state, new Map(), new Map([[1, prop]]));
  assert.deepStrictEqual(r.derived.map((d) => d.key), ['kept phrase here']);
  assert.deepStrictEqual(r.report.dropped, { 'withheld at generation (collision)': 1 });
});

test('collision check: a new term that takes another lesson\'s dev question is withheld; kept terms and acceptable lessons are not', () => {
  const C = require(path.join(SKILL_DIR, 'scripts', 'lib', 'vocab-collision.js'));
  const topic = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'references', 'topic-index.json'), 'utf8'));
  const odd = 'zebra quokka marmalade';
  const qs = [
    { qid: 'pl-9001', text: `why does ${odd} happen`, lesson_id: 12, relevant: { 12: 2 } },
    { qid: 'pl-9002', text: `why does ${odd} happen`, lesson_id: 12, relevant: { 12: 2, 89: 1 } },
  ];
  const cand = [{ term: odd, key: odd }, { term: 'an unrelated phrase nobody asks', key: 'an unrelated phrase nobody asks' }];
  assert.deepStrictEqual(C.findCollisions({ topic, lessonId: 89, candidates: cand, keptKeys: [], questions: qs }), [{ term: odd, qid: 'pl-9001' }]);
  // Lesson 89 acceptable for the only question: nothing to withhold.
  assert.deepStrictEqual(C.findCollisions({ topic, lessonId: 89, candidates: cand, keptKeys: [], questions: [qs[1]] }), []);
  // Already first without the term (a kept term carries it): the new term takes nothing.
  assert.deepStrictEqual(C.findCollisions({ topic, lessonId: 89, candidates: [cand[0]], keptKeys: [odd], questions: qs }), []);
  // A term planVocab drops anyway (key null) is never simulated.
  assert.deepStrictEqual(C.findCollisions({ topic, lessonId: 89, candidates: [{ term: odd, key: null }], keptKeys: [], questions: qs }), []);
});

test('collision check reads only dev identifier/plain questions of the current gated set', (t) => {
  const C = require(path.join(SKILL_DIR, 'scripts', 'lib', 'vocab-collision.js'));
  const q = C.loadDevQuestions(SKILL_DIR);
  if (!q.questions) { t.skip(q.reason); return; }
  const lib = require(path.join(SKILL_DIR, '..', '..', '..', 'evals', 'retrieval', 'lib.js'));
  const all = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, '..', '..', '..', 'evals', 'retrieval', lib.CURRENT_QUESTIONS), 'utf8')).questions;
  const dev = all.filter((x) => (x.stratum === 'identifier' || x.stratum === 'plain') && x.split === 'dev').map((x) => x.qid);
  assert.deepStrictEqual(q.questions.map((x) => x.qid), dev);
  assert.ok(all.some((x) => x.split === 'holdout'), 'control: the set has holdout questions to leave out');
  assert.strictEqual(q.source, `${lib.CURRENT_QUESTIONS} dev`);
});

const stubUpdate = (reply) => async () => JSON.stringify({ type: 'result', is_error: false, total_cost_usd: 0.0123, result: JSON.stringify(reply) });

test('--generate withholds a colliding new term; a withheld replacement gives back the term it replaced', async () => {
  const dir = fixture();
  editLessonLine(dir, VL, ' the ', ' the quite ');
  assert.strictEqual(run(BUILD, ['--root', dir]).code, 0);
  const pin = freshen(dir, [VL]);
  const prior = loadProposals(dir).byId.get(VL).terms;
  const odd = 'zebra quokka marmalade';
  const questions = [{ qid: 'pl-9001', text: `why does ${odd} happen`, lesson_id: 12, relevant: { 12: 2 } }];
  const lines = [];
  const reply = { keep: prior.slice(0, -1), drop: [{ term: prior[prior.length - 1], why: 'inaccurate', replacement: odd }], add: [] };
  await P.runGenerate(dir, { proposalsPin: pin }, { callModel: stubUpdate(reply), questions }, (l) => lines.push(l));
  const p = loadProposals(dir).byId.get(VL);
  assert.strictEqual(p.collision_check, 'injected questions');
  assert.deepStrictEqual(p.withheld, [{ term: odd, qid: 'pl-9001' }]);
  assert.deepStrictEqual(p.terms, prior, 'the replaced term is back, the withheld replacement gone');
  assert.deepStrictEqual(p.replaced, []);
  assert.strictEqual(p.dropped, undefined);
  assert.deepStrictEqual(p.kept_by_rule, [{ term: prior[prior.length - 1], reason: `replacement withheld ("${odd}", pl-9001)` }]);
  assert.ok(!(odd in topicOf(dir).keyword_map), 'a withheld term is never a key');
  assert.ok(lines.some((l) => new RegExp(`lesson ${VL}: withheld 1 new term`).test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => new RegExp(`lesson ${VL}: model call \\$0\\.0123`).test(l)), 'the per-call cost is logged');
  assert.ok(lines.some((l) => /model calls cost \$0\.0123 in total/.test(l)), lines.join('\n'));
  // A withheld ADDED term just stays out.
  const dir2 = fixture();
  editLessonLine(dir2, VL, ' the ', ' the quite ');
  assert.strictEqual(run(BUILD, ['--root', dir2]).code, 0);
  const pin2 = freshen(dir2, [VL]);
  await P.runGenerate(dir2, { proposalsPin: pin2 }, { callModel: stubUpdate({ keep: prior, drop: [], add: [odd] }), questions }, () => {});
  const p2 = loadProposals(dir2).byId.get(VL);
  assert.deepStrictEqual(p2.withheld, [{ term: odd, qid: 'pl-9001' }]);
  assert.deepStrictEqual(p2.terms, [...prior, odd], 'an added term stays in terms as the model wrote it; derivation drops it');
  assert.strictEqual(p2.kept_by_rule, undefined);

  // The next update does not treat the withheld term as a previous term: it is not offered to the
  // model, and when the model proposes it again it is checked again and stays withheld.
  editLessonLine(dir2, VL, ' the quite ', ' the rather ');
  assert.strictEqual(run(BUILD, ['--root', dir2]).code, 0);
  const pin3 = freshen(dir2, [VL]);
  let offered = null;
  const capture = async (args) => { offered = JSON.stringify(args); return stubUpdate({ keep: [...prior, odd], drop: [], add: [] })(); };
  await P.runGenerate(dir2, { proposalsPin: pin3 }, { callModel: capture, questions }, () => {});
  const p3 = loadProposals(dir2).byId.get(VL);
  assert.ok(offered && !offered.includes(odd), 'the withheld term is not listed as a previous term');
  assert.deepStrictEqual(p3.withheld, [{ term: odd, qid: 'pl-9001' }], 're-proposed, it is withheld again');
  assert.ok(!(odd in topicOf(dir2).keyword_map), 'and never becomes a key');
});

test('resolveUpdate: true terms survive any reply; only inaccurate or named-duplicate drops stand', () => {
  const prior = ['alpha one', 'beta two', 'gamma three', 'delta four', 'Epsilon five?'];
  // Planted-false-term control: the inaccurate term goes (with its replacement), the true ones stay verbatim.
  let r = V.resolveUpdate(prior, { keep: ['alpha one', 'beta two', 'gamma three', 'EPSILON FIVE'], drop: [{ term: 'delta four', why: 'inaccurate', duplicate_of: null, replacement: 'delta now' }], add: [] });
  assert.deepStrictEqual(r.terms, ['alpha one', 'beta two', 'gamma three', 'Epsilon five?', 'delta now'], 'kept terms are the previous spelling');
  assert.deepStrictEqual(r.dropped, [{ term: 'delta four', why: 'inaccurate', replacement: 'delta now' }]);
  assert.strictEqual(r.swaps.get('delta now'), 'delta four');
  // L215-style: a new topic must not cost true terms. Drops without a valid reason are refused,
  // an omitted term is kept, and the new topic is ADDED.
  r = V.resolveUpdate(prior, {
    keep: ['alpha one'],
    drop: [
      { term: 'beta two', why: 'duplicate', duplicate_of: 'not a kept term', replacement: null },
      { term: 'gamma three', why: 'room for the new topic', duplicate_of: null, replacement: null },
      { term: 'delta four', why: 'duplicate', duplicate_of: 'alpha one', replacement: null },
    ],
    add: ['new topic a', 'new topic b'],
  });
  assert.deepStrictEqual(r.terms, ['alpha one', 'beta two', 'gamma three', 'Epsilon five?', 'new topic a', 'new topic b']);
  assert.deepStrictEqual(r.dropped, [{ term: 'delta four', why: 'duplicate', duplicate_of: 'alpha one' }]);
  assert.deepStrictEqual(r.keptByRule.map((k) => [k.term, k.reason]), [
    ['beta two', 'duplicate_of names no kept term'],
    ['gamma three', 'drop reason is neither inaccurate nor duplicate'],
    ['Epsilon five?', 'not listed in keep or drop'],
  ]);
  // The cap: added terms are cut, kept terms never.
  const full = Array.from({ length: 15 }, (_, i) => `kept term ${i}`);
  r = V.resolveUpdate(full, { keep: full, drop: [], add: Array.from({ length: 6 }, (_, i) => `added term ${i}`) });
  assert.strictEqual(r.terms.length, V.MAX_TERMS_CAP);
  assert.deepStrictEqual(r.terms.slice(0, 15), full);
  assert.deepStrictEqual(r.terms.slice(15), ['added term 0', 'added term 1', 'added term 2']);
  // A bare {"terms"} reply reads as keep/add.
  assert.deepStrictEqual(V.parseUpdate(JSON.stringify({ result: JSON.stringify({ terms: ['x y'] }) })), { keep: ['x y'], drop: [], add: [] });
});

test('the update prompt asks for keep/drop/add, shows the text before the edit, and adds for a new topic only then', () => {
  const l = { title: 'Screenshot Tools for Artifacts', description: 'd' };
  const without = V.buildUpdatePrompt(l, 'TEXT NOW', ['a term'], null);
  assert.match(without, /ADD nothing/);
  assert.match(without, /Never drop a term that is true and distinct/);
  assert.match(without, /"keep": \["\.\.\."\], "drop": \[\{"term"/);
  const withPrev = V.buildUpdatePrompt(l, 'TEXT NOW', ['a term'], 'TEXT BEFORE');
  assert.match(withPrev, /LESSON TEXT BEFORE THE EDIT:\nTEXT BEFORE\n\nLESSON TEXT NOW:\nTEXT NOW/);
  assert.match(withPrev, /already in\s+the lesson before the edit is NOT new/);
  assert.match(withPrev, new RegExp(`at most ${V.MAX_TERMS_CAP} terms`));
  assert.doesNotMatch(withPrev, /replace up to/);
});

test('keepTitleTerm puts back a title-topic term only when the update dropped the last one', () => {
  const l = { title: 'Screenshot Tools for Artifacts (L221)' };
  const prior = ['why is the screenshot tool unavailable?', 'an unrelated phrase', 'another phrase'];
  // One title-topic term survives: nothing to do.
  assert.deepStrictEqual(V.keepTitleTerm(l, prior, ['an unrelated phrase', 'screenshot of html']), { terms: ['an unrelated phrase', 'screenshot of html'], restored: null });
  // All dropped: the first dropped one replaces the last NEW term, kept terms untouched.
  assert.deepStrictEqual(V.keepTitleTerm(l, prior, ['an unrelated phrase', 'another phrase', 'a brand new term']),
    { terms: ['an unrelated phrase', 'another phrase', prior[0]], restored: prior[0] });
  // No title-topic term before: nothing to keep.
  assert.deepStrictEqual(V.keepTitleTerm(l, ['x y z'], ['a b c']).restored, null);
});

test('--generate passes the previous text to an update and records its commit', async () => {
  const dir = fixture();
  editLessonLine(dir, VL, ' the ', ' the quite ');
  assert.strictEqual(run(BUILD, ['--root', dir]).code, 0);
  const pin = freshen(dir, [VL]);
  const prior = loadProposals(dir).byId.get(VL).terms;
  const prompts = [];
  const callModel = async (p) => { prompts.push(p); return stubTerms(prior)(); };
  await P.runGenerate(dir, { proposalsPin: pin }, { callModel, questions: [], previous: () => ({ text: 'THE TEXT BEFORE', commit: 'f'.repeat(40) }) }, () => {});
  assert.match(prompts[0], /LESSON TEXT BEFORE THE EDIT:\nTHE TEXT BEFORE\n/);
  const p = loadProposals(dir).byId.get(VL);
  assert.strictEqual(p.previous_text, 'f'.repeat(40));
  assert.deepStrictEqual(p.replaced, []);
});

test('findPreviousText finds the committed lesson text a proposal was written from', (t) => {
  const H = require(path.join(SKILL_DIR, 'scripts', 'lib', 'vocab-history.js'));
  const loaded = P.load(SKILL_DIR);
  const props = loadProposals(SKILL_DIR);
  // A lesson whose proposal is current: its text now is the text it was written from.
  const l = loaded.topic.lessons.find((x) => props.byId.get(x.id) && props.byId.get(x.id).input_sha256 === V.inputSha256(x, loaded.lessonText(x)));
  const found = H.findPreviousText(SKILL_DIR, l, props.byId.get(l.id).input_sha256, V.inputSha256);
  if (!found) { t.skip('no git history here (e.g. a tracked-only copy without .git)'); return; }
  assert.strictEqual(found.text, loaded.lessonText(l));
  assert.match(found.commit, /^[0-9a-f]{40}$/);
  assert.strictEqual(H.findPreviousText(SKILL_DIR, l, '0'.repeat(64), V.inputSha256), null, 'an unknown hash finds nothing');
});

test('--fill-gaps reviews a current lesson under the same rules: adds for an old gap, drops nothing true', async () => {
  const dir = fixture();
  const pin = freshen(dir);
  assert.ok(!staleIn(dir).includes(VL), `lesson ${VL} is current: --fill-gaps does not need it stale`);
  const prior = loadProposals(dir).byId.get(VL).terms;
  const prompts = [];
  // The reply tries to swap a true term out for the gap; the rule keeps it and adds the gap term.
  const reply = { keep: prior.slice(0, -1), drop: [{ term: prior[prior.length - 1], why: 'make room', replacement: null }], add: ['a gap phrase for testing'] };
  const callModel = async (p) => { prompts.push(p); return stubUpdate(reply)(); };
  await P.runGenerate(dir, { proposalsPin: pin, fillGaps: [VL] }, { callModel, questions: [], previous: () => { throw new Error('no history lookup for --fill-gaps'); } }, () => {});
  assert.strictEqual(prompts.length, 1);
  assert.match(prompts[0], /covers a topic that none of the terms reaches/);
  assert.doesNotMatch(prompts[0], /LESSON TEXT BEFORE THE EDIT|The lesson was edited/);
  const p = loadProposals(dir).byId.get(VL);
  assert.strictEqual(p.prompt_version, V.FILL_GAPS_PROMPT_VERSION);
  assert.strictEqual(p.previous_text, undefined);
  assert.deepStrictEqual(p.replaced, []);
  assert.deepStrictEqual(p.terms, [...prior, 'a gap phrase for testing']);
  assert.deepStrictEqual(P.parseArgs(['--fill-gaps', '221']).fillGaps, [221]);
  assert.strictEqual(P.parseArgs(['--fill-gaps', '221']).generate, true);
  await assert.rejects(P.runGenerate(dir, { proposalsPin: loadProposals(dir).sha256, fillGaps: [VL], regen: [VL] }, { callModel }, () => {}), /both --regen .* and --fill-gaps/);
});
