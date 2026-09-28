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

  // and end to end: the CLI still answers, with nothing on stderr
  const out = execFileSync('node', [path.join(SCRIPTS, 'search.js'), 'list_skills', '--json', '--top=1'],
    { encoding: 'utf8', env: { ...process.env, CCI_NO_INDEX_CACHE: '', CCI_INDEX_CACHE_DIR: path.join(dir, 'sub') }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(JSON.parse(out)[0].id, 129);
});

test('cache directory candidates: override, else XDG, home, tmpdir — never the skill directory', () => {
  assert.deepStrictEqual(lib.cacheDirs({ CCI_INDEX_CACHE_DIR: '/x' }), ['/x']);
  const dirs = lib.cacheDirs({ XDG_CACHE_HOME: '/xdg' });
  assert.strictEqual(dirs[0], path.join('/xdg', 'claude-code-internals'));
  assert.strictEqual(dirs[dirs.length - 1], path.join(os.tmpdir(), 'claude-code-internals'));
  const skillDir = path.resolve(SCRIPTS, '..');
  for (const d of lib.cacheDirs({})) assert.ok(!path.resolve(d).startsWith(skillDir), `${d} is inside the skill directory`);
});
