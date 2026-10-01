'use strict';
/**
 * vocab-history.js — find the lesson text a vocabulary proposal was written
 * from (prepare-lessons.js --generate only).
 *
 * A proposal records input_sha256, the hash of buildPrompt() over the lesson
 * as it then read (title, summary, text). The text itself is not stored, but
 * git has it: walk the commits that touched the lesson's file or the index, newest first,
 * rebuild the lesson from that commit's topic-index.json bounds and file, and
 * return the version whose prompt hashes to input_sha256. The update prompt
 * shows it to the model, so "a topic the edit added" is decidable instead of
 * guessed. No match (no git, history rewritten, the buildPrompt() template
 * changed since, or the lesson moved files) returns null, and the update then
 * allows no new-topic swaps.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const MAX_COMMITS = 300;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * @param skillDir   the skill directory (…/skills/claude-code-internals)
 * @param lesson     the lesson as it is now ({id, file})
 * @param want       the proposal's input_sha256
 * @param hashOf     (lesson, text) -> sha256 hex (vocab.js inputSha256)
 * @returns {{text: string, commit: string} | null}
 */
function findPreviousText(skillDir, lesson, want, hashOf) {
  if (!want) return null;
  const refs = path.join(skillDir, 'references');
  let prefix;
  try { prefix = git(refs, ['rev-parse', '--show-prefix']).trim(); } catch { return null; }
  // A prompt hashes the lesson's text AND its index entry (title, summary, bounds), and either
  // can change without the other: walk commits that touched the file or the index.
  let commits;
  try {
    commits = git(refs, ['log', `-n${MAX_COMMITS}`, '--format=%H', '--', lesson.file, 'topic-index.json']).split('\n').filter(Boolean);
  } catch { return null; }
  const blobCache = new Map(); // blob id -> parsed index or split file
  const blobAt = (c, rel, parse) => {
    const id = git(refs, ['rev-parse', `${c}:${prefix}${rel}`]).trim();
    if (!blobCache.has(id)) blobCache.set(id, parse(git(refs, ['cat-file', 'blob', id])));
    return blobCache.get(id);
  };
  for (const c of commits) {
    try {
      const topic = blobAt(c, 'topic-index.json', JSON.parse);
      const then = (topic.lessons || []).find((l) => l.id === lesson.id);
      if (!then || then.file !== lesson.file) continue;
      const lines = blobAt(c, then.file, (t) => t.split('\n'));
      const text = lines.slice(then.startLine - 1, then.endLine).join('\n');
      if (hashOf(then, text) === want) return { text, commit: c };
    } catch { /* this commit lacks the file or the index: older than the lesson */ }
  }
  return null;
}

module.exports = { findPreviousText, MAX_COMMITS };
