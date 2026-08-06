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
  ['namespaced tool', 'the mcp__skills__list_skills tool enumerates them'],
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
    field_semantics: {
      measured: { fields: ['tier', 'sources', 'lane', 'verified', 'volatile_dependency', 'durability'], meaning: 'm' },
      guidance: { fields: ['rule', 'detail', 'caveats'], meaning: 'g' },
      editorial: { fields: ['severity'], meaning: 'e' },
    },
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

// --- allowlist criterion: observable-in-your-own-session ------------------
//
// Rule 3 conflated "namespaced" with "internal". Some namespaced tools are
// handed to the model and so are observable by any reader in their own session;
// publishing those discloses nothing. Plumbing the skill must never call stays
// blocked regardless of shape, which is what DISCLOSURE_NEVER enforces.

test('session tools an author can observe are publishable', () => {
  const { failures } = scanForDisclosure(
    'If the mcp__workspace__bash tool is available you are in Cowork; otherwise use Bash.', 'probe');
  assert.deepStrictEqual(failures, [], 'runtime detection needs the tool name verbatim');
});

test('plumbing a skill must never call is blocked even though it is a tool name', () => {
  for (const s of ['call device_commit_files next', 'use allow_cowork_file_delete']) {
    const { failures } = scanForDisclosure(s, 'probe');
    assert.ok(failures.some(f => /never-publish/.test(f)), `not blocked: ${s}`);
  }
});

test('widening the allowlist did not open the whole namespace', () => {
  const { failures } = scanForDisclosure('the mcp__skills__list_skills tool enumerates them', 'probe');
  assert.ok(failures.length > 0, 'only observable session tools are allowlisted, not all namespaced names');
});

// --- the two-clause criterion -------------------------------------------
//
// Clause 1 (observable) alone was incoherent: it admitted the session shell
// tool while banning the presentation tool from the same tool list, and could
// not justify banning permission tools that are equally observable. Clause 2
// (referenceable by a skill) is what separates them.

test('observable AND referenceable names are publishable', () => {
  for (const s of ['mcp__cowork__present_files', 'SendUserFile', 'mcp__workspace__bash',
                   'set when_to_use in your frontmatter']) {
    assert.deepStrictEqual(scanForDisclosure(s, 'probe').failures, [], `should pass: ${s}`);
  }
});

test('observable but NOT referenceable stays blocked', () => {
  // A skill must not call these: the agent self-escalates to them. Clause 1
  // passes (they are in the tool list); clause 2 fails.
  for (const s of ['call allow_cowork_file_delete', 'call request_cowork_directory']) {
    assert.ok(scanForDisclosure(s, 'probe').failures.some(f => /never-publish/.test(f)), s);
  }
});

// --- optional lane scope ------------------------------------------------
//
// Added by the 2026-08 audit, whose first direct remote-sandbox observation
// falsified a fact published with no lane qualifier. The field is OPTIONAL on
// purpose: absent means "never lane-scoped", which is an unknown, not a claim
// that the fact holds everywhere. A required field would have forced 52 facts
// to assert a scope nobody had established.

test('a valid lane value passes', () => {
  for (const lane of ['local', 'remote', 'both']) {
    const { dir } = fixture({
      facts: [{
        id: 'demo.one', page: 'demo', rule: 'R.', detail: 'D.', tier: 'measured',
        durability: 'durable', lane, volatile_dependency: false,
        sources: { lessons: [139], state_page: 'cowork-architecture' }, caveats: [],
      }],
    });
    assert.deepStrictEqual(validateAuthorFacts(dir, LESSONS, REGISTRY), [], `lane=${lane}`);
  }
});

test('an unknown lane is an error', () => {
  const { dir } = fixture({
    facts: [{
      id: 'demo.one', page: 'demo', rule: 'R.', detail: 'D.', tier: 'measured',
      durability: 'durable', lane: 'host-loop', volatile_dependency: false,
      sources: { lessons: [139], state_page: 'cowork-architecture' }, caveats: [],
    }],
  });
  const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
  assert.ok(errs.some(e => /unknown lane/.test(e)), errs.join('; '));
});

test('an absent lane is not an error', () => {
  const { dir } = fixture();
  assert.deepStrictEqual(validateAuthorFacts(dir, LESSONS, REGISTRY), []);
});

// --- prose must not encode its own position ------------------------------
//
// The same string renders on a topic page, on the contract page, in the
// Markdown twin, and in facts.json for other consumers. "The ordering below"
// is true in at most one of those -- and was true in none of them, because the
// box it sat in has always been last on its page. Found by a reader, not by
// any check, which is why there is now a check.

test('bare positional references are rejected', () => {
  for (const prose of [
    'The ordering below degrades safely.',
    'The guidance below is written to be correct in both.',
    'Same author, and not part of the verified material above.',
  ]) {
    const { dir } = fixture({
      pages: [
        { slug: 'demo', title: 'Demo page', summary: 'A summary.', open_questions: [prose] },
        { slug: 'current-state', title: 'State', summary: 'Versions.', open_questions: [] },
      ],
    });
    const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
    assert.ok(errs.some(e => /positional reference/.test(e)), `should have been caught: ${prose}`);
  }
});

test('numeric comparisons are not positional references', () => {
  // "above 1,024 characters" is a comparison, not a claim about layout.
  const { dir } = fixture({
    pages: [
      { slug: 'demo', title: 'Demo page', summary: 'Descriptions above 1,024 characters are truncated.', open_questions: [] },
      { slug: 'current-state', title: 'State', summary: 'Versions.', open_questions: [] },
    ],
  });
  assert.deepStrictEqual(
    validateAuthorFacts(dir, LESSONS, REGISTRY).filter(e => /positional reference/.test(e)), []);
});

// --- facts may not point at their container ------------------------------
//
// A fact renders in at least four places: its topic page, the contract page,
// the Markdown twin, and facts.json, which has no pages at all. "See this
// page's open question" resolves in one of those. On the contract page it is
// actively wrong, because all 52 rules sit together there. Page-level prose is
// exempt: a summary or open question renders in exactly one place.

test('fact-level prose may not reference its page', () => {
  for (const detail of [
    "Measured in the default configuration; see this page's open question.",
    'This is the pattern that survives everything else on this page.',
  ]) {
    const { dir } = fixture({
      facts: [{
        id: 'demo.one', page: 'demo', rule: 'R.', detail, tier: 'measured',
        durability: 'durable', volatile_dependency: false,
        sources: { lessons: [139], state_page: 'cowork-architecture' }, caveats: [],
      }],
    });
    const errs = validateAuthorFacts(dir, LESSONS, REGISTRY);
    assert.ok(errs.some(e => /container reference/.test(e)), `should have been caught: ${detail}`);
  }
});

test('page-level prose may reference its page, and any prose may reference the site', () => {
  const { dir } = fixture({
    pages: [
      { slug: 'demo', title: 'Demo page', summary: 'A summary.',
        open_questions: ['Anything on this page can be true today and false tomorrow.'] },
      { slug: 'current-state', title: 'State', summary: 'Versions.', open_questions: [] },
    ],
    facts: [{
      id: 'demo.one', page: 'demo', rule: 'R.',
      detail: 'Drawn from the failure modes on this site rather than a measurement.',
      tier: 'measured', durability: 'durable', volatile_dependency: false,
      sources: { lessons: [139], state_page: 'cowork-architecture' }, caveats: [],
    }],
  });
  assert.deepStrictEqual(
    validateAuthorFacts(dir, LESSONS, REGISTRY).filter(e => /container reference/.test(e)), []);
});

// --- the three architecture fixes (v2.37.3) ------------------------------

test('verified may not restate the capture date', () => {
  // All 53 facts carried the capture date verbatim, so the field was
  // indistinguishable from the capture and a blanket restamp read as
  // re-verification. Present now means "re-checked on its own".
  const { dir } = fixture({
    facts: [{
      id: 'demo.one', page: 'demo', rule: 'R.', detail: 'D.', tier: 'measured',
      durability: 'durable', volatile_dependency: false, verified: '2026-08-05',
      sources: { lessons: [139], state_page: 'cowork-architecture' }, caveats: [],
    }],
  });
  assert.ok(validateAuthorFacts(dir, LESSONS, REGISTRY).some(e => /says nothing/.test(e)));
});

test('a fact with no verified date is valid', () => {
  const { dir } = fixture({
    facts: [{
      id: 'demo.one', page: 'demo', rule: 'R.', detail: 'D.', tier: 'measured',
      durability: 'durable', volatile_dependency: false,
      sources: { lessons: [139], state_page: 'cowork-architecture' }, caveats: [],
    }],
  });
  assert.deepStrictEqual(validateAuthorFacts(dir, LESSONS, REGISTRY), []);
});

test('derived rows must name the fact they paraphrase', () => {
  // router and top5 restate a rule in different words. Ten rules were reworded
  // in one release; without a binding, a stale paraphrase is invisible.
  for (const [row, pattern] of [
    [{ page: 'demo', rule: 'x', why: 'y' }, /must name the fact/],
    [{ page: 'demo', fact: 'no.such.fact', rule: 'x', why: 'y' }, /does not exist/],
    [{ page: 'current-state', fact: 'demo.one', rule: 'x', why: 'y' }, /is on page/],
  ]) {
    const { dir } = fixture({ top5: [row] });
    assert.ok(validateAuthorFacts(dir, LESSONS, REGISTRY).some(e => pattern.test(e)),
      `should have been caught: ${JSON.stringify(row)}`);
  }
});

test('field_semantics must classify every field in use, with severity editorial', () => {
  const { dir: unclassified } = fixture({
    facts: [{
      id: 'demo.one', page: 'demo', rule: 'R.', detail: 'D.', tier: 'measured',
      durability: 'durable', volatile_dependency: false, mood: 'breezy',
      sources: { lessons: [139], state_page: 'cowork-architecture' }, caveats: [],
    }],
  });
  assert.ok(validateAuthorFacts(unclassified, LESSONS, REGISTRY).some(e => /not classified/.test(e)));

  const { dir: misfiled } = fixture({
    field_semantics: {
      measured: { fields: ['tier', 'sources', 'lane', 'verified', 'volatile_dependency', 'durability', 'severity'], meaning: 'm' },
      guidance: { fields: ['rule', 'detail', 'caveats'], meaning: 'g' },
      editorial: { fields: [], meaning: 'e' },
    },
  });
  assert.ok(validateAuthorFacts(misfiled, LESSONS, REGISTRY).some(e => /classified editorial/.test(e)));
});

// --- retractions belong in caveats ---------------------------------------
//
// `detail` is what an author reads to decide what to do. A note about what an
// earlier version of this site said is release history: it reaches only someone
// who read the old version, and it is worth publishing at all only when a reader
// could still act wrongly on the withdrawn advice. Then it is a qualification,
// which is what caveats are for.

test('a retraction in detail is rejected', () => {
  for (const detail of [
    'Use what is there. An earlier version of this rule said installs would fail or hang.',
    'This rule said otherwise previously.',
  ]) {
    const { dir } = fixture({
      facts: [{
        id: 'demo.one', page: 'demo', rule: 'R.', detail, tier: 'measured',
        durability: 'durable', volatile_dependency: false,
        sources: { lessons: [139], state_page: 'cowork-architecture' }, caveats: [],
      }],
    });
    assert.ok(validateAuthorFacts(dir, LESSONS, REGISTRY).some(e => /retraction/.test(e)),
      `should have been caught: ${detail}`);
  }
});

test('the same retraction is fine in caveats, and correcting a belief is not a retraction', () => {
  const { dir } = fixture({
    facts: [{
      id: 'demo.one', page: 'demo', rule: 'R.',
      // aimed at a belief the reader may hold independently — that is content
      detail: 'Hooks do run. If you have heard otherwise, the determinant is installation namespace.',
      tier: 'measured', durability: 'durable', volatile_dependency: false,
      sources: { lessons: [139], state_page: 'cowork-architecture' },
      caveats: ['An earlier release of this rule told authors to retry. That is withdrawn.'],
    }],
  });
  assert.deepStrictEqual(
    validateAuthorFacts(dir, LESSONS, REGISTRY).filter(e => /retraction/.test(e)), []);
});
