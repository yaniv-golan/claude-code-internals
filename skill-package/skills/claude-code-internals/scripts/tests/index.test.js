'use strict';

/**
 * index.test.js — the in-memory TF-IDF index (lib/tfidf-index.js) and its cache.
 *
 * Every case that touches the cache points CCI_INDEX_CACHE_DIR at a scratch
 * directory, so the user's real cache is never written, and mutations work on a
 * scratch copy of topic-index.json, never the real one.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..');
const TOPIC = path.join(SCRIPTS, '..', 'references', 'topic-index.json');
const lib = require('../lib/tfidf-index.js');

const SCRATCH = [];
test.after(() => { for (const d of SCRATCH) fs.rmSync(d, { recursive: true, force: true }); });
function scratch(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  SCRATCH.push(dir);
  return dir;
}
const cacheFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

test('the in-memory index covers every lesson, in topic-index order', () => {
  const topic = JSON.parse(fs.readFileSync(TOPIC, 'utf8'));
  const ix = lib.buildIndex(topic);
  assert.deepStrictEqual(ix.entries.map((e) => e.id), topic.lessons.map((l) => l.id));
  for (const e of ix.entries) assert.ok(Object.keys(e.tfidf).length > 0, `lesson ${e.id} has no terms`);
  assert.deepStrictEqual(ix.vocabulary, Object.keys(ix.idf).sort());
});

test('lesson descriptions are indexed', () => {
  const topic = JSON.parse(fs.readFileSync(TOPIC, 'utf8'));
  const withDesc = topic.lessons.filter((l) => l.description);
  assert.ok(withDesc.length > 0, 'no lesson carries a description');
  const l = withDesc[0];
  assert.ok(lib.lessonText(l, topic.keyword_map).includes(l.description));
});

test('a cache hit returns exactly what a fresh build returns', () => {
  const dir = scratch('cci-index-cache-');
  const env = { CCI_INDEX_CACHE_DIR: dir };
  const fresh = lib.loadIndex({ topicIndexPath: TOPIC, env: { CCI_NO_INDEX_CACHE: '1' } });
  const miss = lib.loadIndex({ topicIndexPath: TOPIC, env });
  assert.strictEqual(cacheFiles(dir).length, 1, 'the miss did not write a cache file');
  const hit = lib.loadIndex({ topicIndexPath: TOPIC, env });
  // JSON.stringify also compares key order, which fixes float summation order.
  assert.strictEqual(JSON.stringify(miss), JSON.stringify(fresh));
  assert.strictEqual(JSON.stringify(hit), JSON.stringify(fresh));
});

test('search output is identical with the cache disabled, cold and warm', () => {
  const dir = scratch('cci-index-cache-');
  const run = (script, env) => execFileSync('node', [path.join(SCRIPTS, script), 'hook events not firing', '--json', '--top=10'],
    { encoding: 'utf8', env: { ...process.env, CCI_NO_INDEX_CACHE: '', CCI_INDEX_CACHE_DIR: '', ...env } });
  for (const script of ['search.js', 'semantic-search.js']) {
    const off = run(script, { CCI_NO_INDEX_CACHE: '1' });
    const cold = run(script, { CCI_INDEX_CACHE_DIR: dir });
    const warm = run(script, { CCI_INDEX_CACHE_DIR: dir });
    assert.strictEqual(cold, off, `${script}: cold cache differs`);
    assert.strictEqual(warm, off, `${script}: warm cache differs`);
  }
  assert.strictEqual(cacheFiles(dir).length, 1);
});

test('the cache is invalidated when topic-index bytes change', () => {
  const dir = scratch('cci-index-cache-');
  const env = { CCI_INDEX_CACHE_DIR: dir };
  const work = scratch('cci-index-topic-');
  const topicPath = path.join(work, 'topic-index.json');
  fs.copyFileSync(TOPIC, topicPath);

  const before = lib.loadIndex({ topicIndexPath: topicPath, env });
  const [firstFile] = cacheFiles(dir);

  const topic = JSON.parse(fs.readFileSync(topicPath, 'utf8'));
  topic.lessons[0].keywords = [...(topic.lessons[0].keywords || []), 'zzqqxxuniqueterm'];
  fs.writeFileSync(topicPath, JSON.stringify(topic, null, 2) + '\n');

  const after = lib.loadIndex({ topicIndexPath: topicPath, env });
  assert.ok(!before.vocabulary.includes('zzqqxxuniqueterm'));
  assert.ok(after.vocabulary.includes('zzqqxxuniqueterm'), 'stale cache served after topic-index changed');
  assert.strictEqual(JSON.stringify(after), JSON.stringify(lib.buildIndex(topic)));
  const files = cacheFiles(dir);
  assert.strictEqual(files.length, 2, 'expected the new entry beside the superseded one');
  assert.ok(files.includes(firstFile));
});

test('old cache entries are pruned to the newest few, and in-flight .tmp files are left alone', () => {
  const dir = scratch('cci-index-cache-');
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, `tfidf-index-old${i}.json`);
    fs.writeFileSync(f, '{}');
    fs.utimesSync(f, 1000 + i, 1000 + i);
  }
  fs.writeFileSync(path.join(dir, 'tfidf-index-x.json.123.abcd.tmp'), 'partial');
  lib.loadIndex({ topicIndexPath: TOPIC, env: { CCI_INDEX_CACHE_DIR: dir } });
  const left = fs.readdirSync(dir).sort();
  assert.ok(left.includes('tfidf-index-x.json.123.abcd.tmp'));
  assert.deepStrictEqual(left.filter((f) => /old/.test(f)), ['tfidf-index-old3.json', 'tfidf-index-old4.json', 'tfidf-index-old5.json']);
  assert.strictEqual(cacheFiles(dir).length, 4);
});

test('the cache key depends on the topic-index bytes (and the builder source)', () => {
  const a = lib.cacheKey(Buffer.from('{"lessons":[]}'));
  assert.strictEqual(a, lib.cacheKey('{"lessons":[]}'));
  assert.notStrictEqual(a, lib.cacheKey(Buffer.from('{"lessons": []}')));
});

test('a corrupt cache entry is ignored and rebuilt', () => {
  const dir = scratch('cci-index-cache-');
  const env = { CCI_INDEX_CACHE_DIR: dir };
  const fresh = lib.loadIndex({ topicIndexPath: TOPIC, env });
  const [f] = cacheFiles(dir);
  fs.writeFileSync(path.join(dir, f), '{"key": "truncated');
  assert.strictEqual(JSON.stringify(lib.loadIndex({ topicIndexPath: TOPIC, env })), JSON.stringify(fresh));
});

test('an unwritable cache directory falls back to an in-memory build without error', (t) => {
  if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) {
    t.skip('permission bits are not enforced here');
    return;
  }
  const dir = scratch('cci-index-ro-');
  fs.chmodSync(dir, 0o500);
  t.after(() => fs.chmodSync(dir, 0o700));
  const fresh = lib.loadIndex({ topicIndexPath: TOPIC, env: { CCI_NO_INDEX_CACHE: '1' } });
  const got = lib.loadIndex({ topicIndexPath: TOPIC, env: { CCI_INDEX_CACHE_DIR: path.join(dir, 'sub') } });
  assert.strictEqual(JSON.stringify(got), JSON.stringify(fresh));
  assert.deepStrictEqual(fs.readdirSync(dir), []);

  // and end to end: the CLI still answers, with nothing on stderr, exactly as with no cache
  // (a comparison, not a pinned lesson: corpus ranking assertions live in ranking-cases.json)
  const cli = (env) => execFileSync('node', [path.join(SCRIPTS, 'search.js'), 'list_skills', '--json', '--top=3'],
    { encoding: 'utf8', env: { ...process.env, CCI_INDEX_CACHE_DIR: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = cli({ CCI_NO_INDEX_CACHE: '', CCI_INDEX_CACHE_DIR: path.join(dir, 'sub') });
  assert.ok(JSON.parse(out).length > 0);
  assert.strictEqual(out, cli({ CCI_NO_INDEX_CACHE: '1' }));
});

test('cache directory candidates: override, else XDG, home, tmpdir — never the skill directory', () => {
  assert.deepStrictEqual(lib.cacheDirs({ CCI_INDEX_CACHE_DIR: '/x' }), ['/x']);
  const dirs = lib.cacheDirs({ XDG_CACHE_HOME: '/xdg' });
  assert.strictEqual(dirs[0], path.join('/xdg', 'claude-code-internals'));
  assert.strictEqual(dirs[dirs.length - 1], path.join(os.tmpdir(), 'claude-code-internals'));
  const skillDir = path.resolve(SCRIPTS, '..');
  for (const d of lib.cacheDirs({})) assert.ok(!path.resolve(d).startsWith(skillDir), `${d} is inside the skill directory`);
});

test('a relative $XDG_CACHE_HOME is ignored (XDG spec)', () => {
  const dirs = lib.cacheDirs({ XDG_CACHE_HOME: 'relative/cache' });
  assert.ok(dirs.every((d) => path.isAbsolute(d)), JSON.stringify(dirs));
  assert.ok(!dirs.some((d) => d.includes('relative')), JSON.stringify(dirs));
});

const noPosixOwnership = () => process.platform === 'win32' || typeof process.getuid !== 'function' || process.getuid() === 0;

test('a group- or world-writable cache directory is never read or written', (t) => {
  if (noPosixOwnership()) { t.skip('no POSIX ownership/permission semantics here'); return; }
  const loose = scratch('cci-index-loose-');
  fs.chmodSync(loose, 0o777);
  t.after(() => fs.chmodSync(loose, 0o700));
  const good = scratch('cci-index-good-');
  assert.strictEqual(lib.isTrustedDir(loose), false);
  assert.strictEqual(lib.isTrustedDir(good), true);
  assert.strictEqual(lib.selectCacheDir([loose, good]), good, 'the loose directory was selected');
  // A symlink to a loose directory is judged by its target's mode.
  const link = path.join(scratch('cci-index-link-'), 'cache');
  fs.symlinkSync(loose, link);
  assert.strictEqual(lib.isTrustedDir(link), false);

  // A crafted entry in the loose directory is not consulted, and nothing is written there.
  const key = lib.cacheKey(fs.readFileSync(TOPIC));
  const topic = JSON.parse(fs.readFileSync(TOPIC, 'utf8'));
  const ix = lib.buildIndex(topic);
  ix.entries[0].tfidf = { hooks: 50, hook: 50 };
  fs.writeFileSync(path.join(loose, `tfidf-index-${key}.json`), JSON.stringify({ key, ...ix }));
  const got = lib.loadIndex({ topicIndexPath: TOPIC, env: { CCI_INDEX_CACHE_DIR: loose } });
  assert.strictEqual(JSON.stringify(got), JSON.stringify(lib.buildIndex(topic)));
  assert.strictEqual(fs.readdirSync(loose).length, 1);
});

test('a crafted entry in a lower-priority cache directory is never read (end to end)', (t) => {
  if (noPosixOwnership()) { t.skip('no POSIX ownership/permission semantics here'); return; }
  const home = scratch('cci-index-home-');
  const tmpd = scratch('cci-index-tmp-');
  const planted = path.join(tmpd, 'claude-code-internals');
  fs.mkdirSync(planted, { mode: 0o700 });
  const bytes = fs.readFileSync(TOPIC);
  const key = lib.cacheKey(bytes);
  const ix = lib.buildIndex(JSON.parse(bytes));
  ix.entries.find((e) => e.id === 1).tfidf = { hooks: 50, hook: 50 }; // steer "hook" queries to lesson 1
  fs.writeFileSync(path.join(planted, `tfidf-index-${key}.json`), JSON.stringify({ key, ...ix }));
  const run = (env) => execFileSync('node', [path.join(SCRIPTS, 'search.js'), 'hook events', '--json', '--top=3'],
    { encoding: 'utf8', env: { ...process.env, CCI_INDEX_CACHE_DIR: '', XDG_CACHE_HOME: '', ...env } });
  const off = run({ CCI_NO_INDEX_CACHE: '1' });
  const got = run({ CCI_NO_INDEX_CACHE: '', HOME: home, TMPDIR: tmpd });
  assert.strictEqual(got, off, 'the planted tmpdir entry changed the results');
  assert.strictEqual(cacheFiles(path.join(home, '.cache', 'claude-code-internals')).length, 1, 'the home cache was not used');
});

test('a cache entry of the wrong shape is rebuilt, never used', () => {
  const topic = JSON.parse(fs.readFileSync(TOPIC, 'utf8'));
  const fresh = JSON.stringify(lib.buildIndex(topic));
  const key = lib.cacheKey(fs.readFileSync(TOPIC));
  const mutations = {
    'wrong id': (ix) => { ix.entries[0].id = 99999; },
    'entry not an object': (ix) => { ix.entries[0] = {}; },
    'missing entry': (ix) => { ix.entries.pop(); },
    'swapped order': (ix) => { [ix.entries[0], ix.entries[1]] = [ix.entries[1], ix.entries[0]]; },
    'tfidf is an array': (ix) => { ix.entries[3].tfidf = [1, 2]; },
    'non-number weight': (ix) => { ix.entries[3].tfidf.hooks = '50'; },
    'null weight': (ix) => { ix.entries[3].tfidf.hooks = null; },
    'idf missing': (ix) => { delete ix.idf; },
    'idf non-number': (ix) => { ix.idf[Object.keys(ix.idf)[0]] = 'x'; },
    'vocabulary not the idf terms': (ix) => { ix.vocabulary.push('zzz'); },
    'vocabulary not an array': (ix) => { ix.vocabulary = {}; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const dir = scratch('cci-index-shape-');
    const ix = lib.buildIndex(topic);
    mutate(ix);
    assert.strictEqual(lib.validCacheEntry({ key, ...ix }, key, topic.lessons), false, label);
    fs.writeFileSync(path.join(dir, `tfidf-index-${key}.json`), JSON.stringify({ key, ...ix }));
    const got = lib.loadIndex({ topicIndexPath: TOPIC, env: { CCI_INDEX_CACHE_DIR: dir } });
    assert.strictEqual(JSON.stringify(got), fresh, `${label}: the malformed entry was used`);
  }
  assert.strictEqual(lib.validCacheEntry({ key, ...lib.buildIndex(topic) }, key, topic.lessons), true);
});

test('a failed cache write leaves no temp file behind', () => {
  const dir = scratch('cci-index-full-');
  const key = lib.cacheKey(fs.readFileSync(TOPIC));
  // A directory where the cache file should go makes the rename fail after the temp write.
  fs.mkdirSync(path.join(dir, `tfidf-index-${key}.json`));
  const fresh = lib.loadIndex({ topicIndexPath: TOPIC, env: { CCI_NO_INDEX_CACHE: '1' } });
  const got = lib.loadIndex({ topicIndexPath: TOPIC, env: { CCI_INDEX_CACHE_DIR: dir } });
  assert.strictEqual(JSON.stringify(got), JSON.stringify(fresh));
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});
