'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  scanForDisclosure,
  validateAuthorFacts,
} = require('../validate-state.js');

// --- the disclosure scanner ------------------------------------------------
//
// These are CONTROLS, not decoration. A scanner that never fires is worse than
// no scanner, because it reads as a guarantee. Each leak class the shape rules
// exist for gets a positive case, and clean prose gets a negative case.

const LEAKS = [
  ['server-flag id', 'the flag 1598976391 controls this'],
  ['raw epoch', 'stamped 1785910109684 at capture'],
  ['cli flag name', 'gated behind tengu_saddle_lantern'],
  ['namespaced tool', 'call mcp__cowork__present_files first'],
  ['internal tool', 'internal__remote_devices does the commit'],
  ['camelCase internal', 'the fileDeleteApprovedMounts list is persisted'],
  ['camelCase internal 2', 'true when hostLoopMode is set'],
  ['snake_case internal', 'emits code_change_published on push'],
  ['minified symbol', 'resolved by ece() at runtime'],
  ['infra naming', 'decoded from the fcache payload'],
];

for (const [name, text] of LEAKS) {
  test(`disclosure scanner catches ${name}`, () => {
    const { failures } = scanForDisclosure(text, 'probe');
    assert.ok(failures.length > 0, `expected a failure for: ${text}`);
  });
}

test('disclosure scanner passes ordinary author-facing prose', () => {
  const clean =
    'Write the deliverable to a stated path, then present it with whichever ' +
    'delivery tool the session offers. If none exists, state the path and stop. ' +
    'Do not assume a tool is present just because it was there last week.';
  assert.deepStrictEqual(scanForDisclosure(clean, 'probe').failures, []);
});

test('disclosure scanner allows explicitly author-facing tool names', () => {
  const { failures } = scanForDisclosure('use present_files when it exists', 'probe');
  assert.deepStrictEqual(failures, []);
});

test('quoted-span budget flags but does not fail', () => {
  const long = 'He said "' + 'word '.repeat(30).trim() + '" in the dialog.';
  const r = scanForDisclosure(long, 'probe');
  assert.deepStrictEqual(r.failures, [], 'quotes are a heuristic, never a hard failure');
  assert.ok(r.flags.length > 0, 'a 30-word quoted span should raise a review flag');
});

// --- author-facts.json schema ---------------------------------------------

function fixture(overrides = {}) {
  const doc = {
    schema_version: 1,
    verified_against: {
      cli: '2.1.217',
      desktop_asar: '1.25927.0',
      fcache_content16: 'abcdef0123456789',
      observed_at: '2026-08-05',
    },
    pages: [
      { slug: 'demo', title: 'Demo page', summary: 'A summary.', open_questions: [] },
      { slug: 'current-state', title: 'State', summary: 'Versions.', open_questions: [] },
    ],
    facts: [
      {
        id: 'demo.one',
        page: 'demo',
        rule: 'Do the durable thing.',
        detail: 'Because it works.',
        tier: 'measured',
        durability: 'durable',
        volatile_dependency: false,
        sources: { lessons: [139], state_page: 'cowork-architecture' },
        verified: '2026-08-05',
        caveats: [],
      },
    ],
    ...overrides,
  };
  const dir = mkStateDir('af-');
  fs.writeFileSync(path.join(dir, 'author-facts.json'), JSON.stringify(doc, null, 2));
  return { dir, doc };
}

/**
 * A state dir with the one page the fixture facts cite. sources.state_page is
 * validated against the *.md files actually present (domain == filename), so a
 * bare temp dir would fail the fixture for the right reason at the wrong time.
 */
function mkStateDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, 'cowork-architecture.md'), '---\ndomain: cowork-architecture\n---\n');
  return dir;
}

const REGISTRY = {
  as_of: {
    cli: '2.1.217',
    desktop_asar: '1.25927.0',
    fcache_capture: { content16: 'abcdef0123456789', observed_at: '2026-08-05' },
  },
};
const LESSONS = new Set([115, 121, 122, 138, 139, 140, 141, 142, 104, 116, 134, 108]);

test('a valid author-facts fixture produces no errors', () => {
  const { dir } = fixture();
  assert.deepStrictEqual(validateAuthorFacts(dir, LESSONS, REGISTRY), []);
});

test('absent author-facts.json is not an error (reduced fixtures stay valid)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-empty-'));
  assert.deepStrictEqual(validateAuthorFacts(dir, LESSONS, REGISTRY), []);
});

test('verified_against drifting from registry as_of is an error', () => {
  const { dir } = fixture({
    verified_against: {
      cli: '2.1.198', // stale
      desktop_asar: '1.25927.0',
      fcache_content16: 'abcdef0123456789',
      observed_at: '2026-08-05',
    },
  });
  const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
  assert.ok(errs.some(e => /verified_against\.cli/.test(e)), errs.join('\n'));
});

test('a volatile fact on a content page is an error (quarantine)', () => {
  const { doc } = fixture();
  doc.facts[0].durability = 'volatile';
  const dir = mkStateDir('af-vol-');
  fs.writeFileSync(path.join(dir, 'author-facts.json'), JSON.stringify(doc, null, 2));
  const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
  assert.ok(errs.some(e => /volatile facts may only appear/.test(e)), errs.join('\n'));
});

test('a fact citing an unknown lesson is an error', () => {
  const { doc } = fixture();
  doc.facts[0].sources.lessons = [9999];
  const dir = mkStateDir('af-lesson-');
  fs.writeFileSync(path.join(dir, 'author-facts.json'), JSON.stringify(doc, null, 2));
  const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
  assert.ok(errs.some(e => /not in topic-index/.test(e)), errs.join('\n'));
});

test('a fact whose page does not exist is an error', () => {
  const { doc } = fixture();
  doc.facts[0].page = 'nope';
  const dir = mkStateDir('af-page-');
  fs.writeFileSync(path.join(dir, 'author-facts.json'), JSON.stringify(doc, null, 2));
  const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
  assert.ok(errs.some(e => /is not a declared page/.test(e)), errs.join('\n'));
});

test('published prose containing an internal identifier is an error', () => {
  const { doc } = fixture();
  doc.facts[0].detail = 'The hostLoopMode field decides this.';
  const dir = mkStateDir('af-leak-');
  fs.writeFileSync(path.join(dir, 'author-facts.json'), JSON.stringify(doc, null, 2));
  const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
  assert.ok(errs.some(e => /camelcase-internal/.test(e)), errs.join('\n'));
});

test('an unknown tier is an error', () => {
  const { doc } = fixture();
  doc.facts[0].tier = 'vibes';
  const dir = mkStateDir('af-tier-');
  fs.writeFileSync(path.join(dir, 'author-facts.json'), JSON.stringify(doc, null, 2));
  const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
  assert.ok(errs.some(e => /unknown tier/.test(e)), errs.join('\n'));
});

test('a content page with no facts is an error', () => {
  const { doc } = fixture();
  doc.pages.push({ slug: 'orphan', title: 'Orphan', summary: 'x', open_questions: [] });
  const dir = mkStateDir('af-orphan-');
  fs.writeFileSync(path.join(dir, 'author-facts.json'), JSON.stringify(doc, null, 2));
  const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
  assert.ok(errs.some(e => /has no facts/.test(e)), errs.join('\n'));
});

test('a fact citing a nonexistent state page is an error', () => {
  const { doc } = fixture();
  doc.facts[0].sources.state_page = 'no-such-page';
  const dir = mkStateDir('af-sp-');
  fs.writeFileSync(path.join(dir, 'author-facts.json'), JSON.stringify(doc, null, 2));
  const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
  assert.ok(errs.some(e => /is not an existing state page/.test(e)), errs.join('\n'));
});
