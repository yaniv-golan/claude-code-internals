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
    if (/^\d\d-.*\.md$/.test(f) || /^(topic-index|hand-keywords|cross-references|troubleshooting)\.json$/.test(f)) {
      fs.copyFileSync(path.join(src, f), path.join(refs, f));
    }
  }
  fs.mkdirSync(path.dirname(proposalsPath(dir)));
  fs.copyFileSync(proposalsPath(SKILL_DIR), proposalsPath(dir));
  fs.copyFileSync(path.join(SKILL_DIR, 'version.json'), path.join(dir, 'version.json'));
  return dir;
}
const topicPath = (dir) => path.join(dir, 'references', 'topic-index.json');
const topicOf = (dir) => JSON.parse(fs.readFileSync(topicPath(dir), 'utf8'));
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
  // a bare number is a substring key: '45' is live (hand key 'build 4567'), so it is UNREACHABLE
  assert.ok(!keys.includes('45678901'));
  assert.ok(report.fragment.some((f) => f.raw === '45678901' && f.shape === 'digits'));
  assert.strictEqual(report.unreachable, report.fragment.length);
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
  assert.strictEqual(HAND.keys.length, 4993);
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
  assert.doesNotMatch(sp.stdout + sp.stderr, /WARNING/, 'no stale or unknown-input vocabulary proposal is committed');
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

// --- HEAD guard (plan §5: file-writing scripts stop on HEAD or content-hash changes) -----------

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
  assert.deepStrictEqual(V.staleProposals(loaded.topic.lessons, loaded.lessonText, props.byId), { stale: [], unknown: [] });
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
    assert.deepStrictEqual(after.byId.get(id), { model: V.DEFAULT_MODEL, prompt_version: V.PROMPT_VERSION, date: '2026-09-28',
      input_sha256: V.inputSha256(l, loaded.lessonText(l)), terms: ['a stubbed phrase for testing', 'CLAUDE_CODE_NOPE is dropped'] });
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
const stubTerms = (terms) => async () => JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ terms }) });

test('a lesson edited after its vocabulary was generated: --check warns by id (no failure), --generate regenerates only it', async () => {
  const dir = fixture();
  const l89 = topicOf(dir).lessons.find((x) => x.id === 89);
  const word = P.load(dir).lessonText(l89).split('\n').slice(2).join(' ').match(/\b(the|a|is|and)\b/)[0];
  editLessonLine(dir, 89, ` ${word} `, ` ${word} quite `);
  assert.strictEqual(run(BUILD, ['--root', dir]).code, 0);
  for (const script of [BUILD, PREP]) {
    const sp = spawnSync('node', [script, '--check', '--root', dir], { encoding: 'utf8' });
    const r = { code: sp.status, out: sp.stdout + sp.stderr };
    assert.strictEqual(r.code, 0, `${path.basename(script)} --check must not fail on a prose edit:\n${r.out}`);
    assert.match(sp.stderr, /WARNING: .*1 lesson\(s\) changed since their vocabulary proposal was generated \(89\).*--generate/);
  }
  const res = P.checkLessons({ raw: fs.readFileSync(topicPath(dir), 'utf8'), lessonText: P.load(dir).lessonText, hand: HAND, proposals: loadProposals(dir) });
  assert.deepStrictEqual(res.errors, []);
  assert.strictEqual(res.warnings.length, 1);
  // --generate (no --regen) regenerates the stale lesson, and only it, from the edited text
  const prompts = [];
  const callModel = async (prompt) => { prompts.push(prompt); return stubTerms(['a regenerated phrase for testing'])(); };
  const lines = [];
  await P.runGenerate(dir, {}, { callModel, date: '2026-09-29' }, (l) => lines.push(l));
  assert.strictEqual(prompts.length, 1, lines.join('\n'));
  assert.match(prompts[0], new RegExp(`LESSON TITLE: ${l89.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.ok(prompts[0].includes(` ${word} quite `), 'the prompt carries the edited text');
  const after = loadProposals(dir);
  assert.strictEqual(after.byId.get(89).input_sha256, require('crypto').createHash('sha256').update(prompts[0]).digest('hex'));
  assert.deepStrictEqual(after.byId.get(89).terms, ['a regenerated phrase for testing']);
  const now = P.checkLessons({ raw: fs.readFileSync(topicPath(dir), 'utf8'), lessonText: P.load(dir).lessonText, hand: HAND, proposals: after, proposalsPin: after.sha256 });
  assert.deepStrictEqual([now.errors, now.warnings], [[], []]);
});

test('a proposal without input_sha256 has unknown inputs: warned, kept by --generate, replaced by --regen', async () => {
  const dir = fixture();
  const props = loadProposals(dir);
  delete props.byId.get(89).input_sha256;
  fs.writeFileSync(proposalsPath(dir), V.renderProposals(props.byId));
  const pinned = loadProposals(dir).sha256;
  const res = P.checkLessons({ raw: fs.readFileSync(topicPath(dir), 'utf8'), lessonText: P.load(dir).lessonText, hand: HAND, proposals: loadProposals(dir), proposalsPin: pinned });
  assert.deepStrictEqual(res.errors, []);
  assert.match(res.warnings.join('\n'), /1 lesson\(s\) have a vocabulary proposal whose generation inputs are unknown \(no input_sha256: 89\).*--regen/);
  let calls = 0;
  const callModel = async () => { calls++; return stubTerms(['a regenerated phrase for testing'])(); };
  await P.runGenerate(dir, { proposalsPin: pinned }, { callModel }, () => {});
  assert.strictEqual(calls, 0, 'unknown inputs are not regenerated by default');
  await P.runGenerate(dir, { proposalsPin: pinned, regen: [89] }, { callModel }, () => {});
  assert.strictEqual(calls, 1);
  assert.match(loadProposals(dir).byId.get(89).input_sha256, /^[0-9a-f]{64}$/);
});

test('a lesson edited while the model runs aborts the write: nothing written', async () => {
  const dir = fixture();
  const props = loadProposals(dir);
  props.byId.delete(89);
  fs.writeFileSync(proposalsPath(dir), V.renderProposals(props.byId));
  const before = fs.readFileSync(proposalsPath(dir), 'utf8');
  const l89 = topicOf(dir).lessons.find((x) => x.id === 89);
  const word = P.load(dir).lessonText(l89).split('\n').slice(2).join(' ').match(/\b(the|a|is|and)\b/)[0];
  const callModel = async () => { editLessonLine(dir, 89, ` ${word} `, ` ${word} quite `); return stubTerms(['a phrase for testing'])(); };
  await assert.rejects(P.runGenerate(dir, { proposalsPin: loadProposals(dir).sha256 }, { callModel }, () => {}), /lesson\(s\) 89 changed while the model ran.*nothing written/);
  assert.strictEqual(fs.readFileSync(proposalsPath(dir), 'utf8'), before);
});

// --- generation starts only from the pinned proposals file ---------------------------------

test('--generate refuses to start from an unpinned (hand-edited) or missing proposals file; --bootstrap is explicit', async () => {
  const dir = fixture();
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
  assert.deepStrictEqual(V.MODEL_FLAGS, ['--safe-mode', '--tools', '']);
});
