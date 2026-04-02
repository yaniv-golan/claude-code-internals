#!/usr/bin/env node
/**
 * build-rvf-index.js
 *
 * Reads topic-index.json and builds a semantic-index.json with TF-IDF vectors
 * for cosine-similarity search over Claude Code internals lessons.
 *
 * Usage: node build-rvf-index.js
 *
 * Output: ../references/semantic-index.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Paths ---
const REFS_DIR = path.join(__dirname, '..', 'references');
const TOPIC_INDEX = path.join(REFS_DIR, 'topic-index.json');
const SEMANTIC_INDEX = path.join(REFS_DIR, 'semantic-index.json');

// --- Stop words (common English words that add noise to TF-IDF) ---
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are',
  'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we',
  'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
  'its', 'our', 'their', 'what', 'which', 'who', 'whom', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'about', 'above', 'after', 'again', 'also', 'any', 'because',
  'before', 'between', 'during', 'here', 'if', 'into', 'once',
  'out', 'over', 'then', 'there', 'through', 'under', 'until', 'up',
  'while', 'down', 'off', 'further', 'get', 'got'
]);

// --- Description templates keyed by lesson title patterns ---
// These enrich the searchable text beyond just keywords.
const DESCRIPTIONS = {
  1:  'How Claude Code boots up: CLI entrypoint, cold-start init, module eval, three-layer architecture, fast path, keychain prefetch, bare mode, worktree and tmux setup',
  2:  'Query engine loop that talks to the LLM API: streaming responses, content block deltas, retry with exponential backoff, 529 overload handling, opus fallback, prompt cache, autocompact triggers',
  3:  'Application state management: AppState store, React selectors, createStore, useSyncExternalStore, immutable state, speculation, side effects, permission mode tracking',
  4:  'How the system prompt is built: CLAUDE.md injection, memory injection, dynamic sections, prompt cache boundaries, include directives, frontmatter, subagent prompts, undercover mode, env info',
  5:  'Architecture capstone overview: six layers, data flow timeline, session wiring, query engine, tool system, hooks, state, async generators, the complete picture',
  6:  'Tool system: how tools are defined, registered, and orchestrated. Tool interface, concurrency, build-tool helper, tool results, context modifiers, streaming tool executor, sibling abort, permission context, Zod schemas',
  7:  'Bash tool: shell command execution, 23 security validators, sandboxing, shell snapshots, background execution, sed constraints, output handling',
  8:  'File tools for reading, writing, and editing: read-before-write enforcement, atomic writes, image support, PDF support, Jupyter notebooks, dedup, quote normalization, LSP notifications',
  9:  'Search tools Glob and Grep: ripgrep integration, mtime sorting, pagination, head limit, binary detection, EAGAIN retry',
  10: 'MCP Model Context Protocol: OAuth, stdio and SSE transports, elicitation, WebSocket, tool proxy, server deduplication, instructions',
  11: 'Skills system: skill.md files, frontmatter format, discovery, slash commands, skill lifecycle, bundled and MCP skills, conditional skills, live reloading, fork context',
  12: 'Agent system: subagents, fork, async agents, agent tool, built-in and custom agents, explore agent, worktree isolation, send-message, agent frontmatter',
  13: 'Coordinator mode: dispatcher, workers, scratchpad, parallel agents, research-synthesis-implement-verify pattern',
  14: 'Teams and Swarm: multi-agent teams, tmux pane creation, mailbox communication, teammate, iTerm2, in-process backend, permission sync, shutdown',
  15: 'Memory system: auto-memory, MEMORY.md, team memory, session memory, memory extraction, topic files, staleness detection, secret scanning',
  16: 'Auto memory and dreams: consolidation, extract-memories, memory recall, KAIROS memory, auto-dream, lock file, daily log',
  17: 'Ink renderer: terminal UI rendering with React-like reconciler, Yoga layout, screen buffer, virtual DOM, blit, dirty flag, scroll, style pool, wide character, ANSI',
  18: 'Commands system: slash commands, registration, local commands, prompt commands, local JSX commands, shell substitution, availability, bridge-safe',
  19: 'Dialog UI: wizard pattern, permission dialog, onboarding, launcher pattern, custom select, pane component',
  20: 'Notification system: toast notifications, terminal-notifier, OSC sequences, priority queue, Kitty, Ghostty, bell, progress reporting',
  21: 'Vim mode: keybindings, state machine, motions, text objects, operators, transitions, pure functions, discriminated union, dot repeat',
  22: 'Keybindings system: keyboard input handling, chord sequences, hotkeys, terminal decode, key matching, user customization',
  23: 'Fullscreen mode: alternate screen, mouse tracking, DEC mode, tmux integration, offscreen freeze',
  24: 'Theme and visual styling: colors, chalk, daltonized accessibility, color resolution, shimmer, vscode boost, tmux clamp, agent color',
  25: 'Permissions system architecture: allow-deny-ask model, auto mode, bypass rules, rule matching, decision pipeline, five permission modes, shadowed rules, permission explainer',
  26: 'Settings and configuration: 5-layer cascade, MDM, policy, settings schema, merge semantics, cache architecture, file watching with chokidar, remote managed settings, ETag, security check',
  27: 'Session management: JSONL transcript, resume, cloud sync, append-only, write pipeline, interrupt detection',
  28: 'Context compaction: context window management, microcompact, summarization, token management, four-tier, session memory compact, reactive compact, post-compact cleanup, context command',
  29: 'Analytics and telemetry: Datadog integration, GrowthBook feature flags, PII protection, sampling, event queue, kill switch, metadata enrichment',
  30: 'Migration system: idempotent migrations, settings upgrade, version gate, backward compatibility, discriminated union',
  31: 'Plugin system: marketplace, manifest, dependency resolution, versioned cache, plugin.json, autoupdate, user config, plugin lifecycle',
  32: 'Hooks system: lifecycle hooks, pre-tool-use, post-tool-use, exit code, hook events, session hooks, HTTP hooks, prompt hooks, agent hooks, async hooks',
  33: 'Error handling and recovery: retry logic, abort, conversation recovery, error taxonomy, typed errors, error overlay, persistent retry, deserialization',
  34: 'Bridge and remote control: CCR, WebSocket, JWT, bridge v1/v2, flush gate, standalone bridge, permission bridge',
  35: 'OAuth authentication: PKCE flow, token storage, keychain, token refresh, logout, enterprise, FedStart, scopes',
  36: 'Git integration: filesystem-first approach, git watcher, branch tracking, commit tracking, git config parser, ref validation, gitignore, GitHub auth',
  37: 'Upstream proxy system: CCR container, TLS, MITM, protobuf, connect over WebSocket, keepalive',
  38: 'Cron and task scheduling: jitter, recurring tasks, timer, cron task, one-shot tasks',
  39: 'Voice system: speech-to-text, audio backend, push-to-talk, hold-to-talk, WebSocket STT, focus mode, microphone',
  40: 'Buddy companion system: tamagotchi pet easter egg, sprites, PRNG, rarity, animation, April Fools',
  41: 'Ultraplan 30-minute remote planning: CCR session, polling, plan delivery, teleport, exit plan mode, remote execution',
  42: 'Entrypoints and Agent SDK: CLI bootstrap, control protocol, MCP server mode, daemon, fast paths',
  43: 'KAIROS always-on autonomous daemon: sleep tool, assistant mode, proactive, tick loop, brief tool, push notification, subscribe PR, queue priority, cron, scheduling',
  44: 'Cost analytics and observability: OpenTelemetry, Datadog, cost tracking, microdollars, session cost, proto fields, user buckets, quadratic backoff',
  45: 'Desktop app integration: IDE support, Chrome extension, computer use, deep link, native messaging, VSCode, JetBrains, lockfile discovery',
  46: 'Model system: provider, alias, allowlist, fast mode, model selection, 1M context, effort levels, model migrations, deprecation, subagent model, Bedrock, Vertex',
  47: 'Sandbox and security: seatbelt, bubblewrap, network control, filesystem control, bare git escape, secure storage, fallback storage, keychain',
  48: 'Message processing pipeline: normalization, user input, API transform, message construction, slug command, paste expansion, synthetic messages, message taxonomy',
  49: 'Task system: background tasks, task types, output management, local shell task, local agent task, remote agent task, in-process teammate task, dream task, task notification',
  50: 'REPL and Screen: render tree, query guard, virtual scroll, session resume, loading state, dialog priority, messages array, tool JSX, cancel handler, transcript mode, prompt input, spinner',
};

/**
 * Tokenize text into lowercase terms, splitting on non-alphanumeric chars,
 * filtering stop words and short tokens.
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Build term frequency map for a token list.
 * Returns { term: count } normalized by document length.
 */
function termFrequency(tokens) {
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  // Normalize by document length (augmented TF to prevent bias toward long docs)
  const maxFreq = Math.max(...Object.values(tf), 1);
  for (const t in tf) {
    tf[t] = 0.5 + 0.5 * (tf[t] / maxFreq);
  }
  return tf;
}

/**
 * Compute IDF scores across all documents.
 * idf(t) = ln(N / df(t)) where df(t) = number of docs containing term t.
 */
function computeIDF(docTokenSets) {
  const N = docTokenSets.length;
  const df = {};
  for (const tokenSet of docTokenSets) {
    for (const t of tokenSet) {
      df[t] = (df[t] || 0) + 1;
    }
  }
  const idf = {};
  for (const t in df) {
    idf[t] = Math.log(N / df[t]);
  }
  return idf;
}

// --- Main ---
function main() {
  // 1. Load topic-index.json
  if (!fs.existsSync(TOPIC_INDEX)) {
    console.error(`ERROR: topic-index.json not found at ${TOPIC_INDEX}`);
    process.exit(1);
  }
  const topicIndex = JSON.parse(fs.readFileSync(TOPIC_INDEX, 'utf8'));
  const lessons = topicIndex.lessons;

  console.log(`Loaded ${lessons.length} lessons from topic-index.json`);

  // 2. Build combined searchable text and tokenize each lesson
  const entries = [];
  const allTokenSets = []; // array of Sets for IDF computation

  for (const lesson of lessons) {
    const desc = DESCRIPTIONS[lesson.id] || '';
    const keywordsText = (lesson.keywords || []).join(' ');

    // Build related topics from keyword_map: find keywords that map to this lesson
    const relatedTopics = new Set();
    if (topicIndex.keyword_map) {
      for (const [kw, ids] of Object.entries(topicIndex.keyword_map)) {
        if (ids.includes(lesson.id)) {
          relatedTopics.add(kw);
        }
      }
    }
    // Also include the lesson's own keywords
    for (const kw of (lesson.keywords || [])) {
      relatedTopics.add(kw);
    }

    // Combine all text for this entry
    const combinedText = [
      lesson.title,
      keywordsText,
      desc,
      [...relatedTopics].join(' ')
    ].join(' ');

    const tokens = tokenize(combinedText);
    const tokenSet = new Set(tokens);

    entries.push({
      id: lesson.id,
      title: lesson.title,
      file: lesson.file,
      startLine: lesson.startLine,
      endLine: lesson.endLine,
      text: combinedText,
      keywords: lesson.keywords || [],
      related_topics: [...relatedTopics].sort(),
    });

    allTokenSets.push(tokenSet);
  }

  // 3. Compute IDF
  const idf = computeIDF(allTokenSets);
  const vocabulary = Object.keys(idf).sort();

  console.log(`Vocabulary size: ${vocabulary.length} terms`);
  console.log(`IDF range: ${Math.min(...Object.values(idf)).toFixed(3)} - ${Math.max(...Object.values(idf)).toFixed(3)}`);

  // 4. Compute and attach TF-IDF vectors (stored as sparse objects for compactness)
  for (let i = 0; i < entries.length; i++) {
    const tokens = tokenize(entries[i].text);
    const tf = termFrequency(tokens);
    const tfidf = {};
    for (const t in tf) {
      if (idf[t] !== undefined) {
        tfidf[t] = +(tf[t] * idf[t]).toFixed(4);
      }
    }
    entries[i].tfidf = tfidf;
  }

  // 5. Write semantic-index.json
  const semanticIndex = {
    version: 1,
    created: new Date().toISOString(),
    description: 'TF-IDF semantic index for Claude Code internals lessons. Use semantic-search.js to query.',
    total_entries: entries.length,
    entries,
    vocabulary,
    idf: Object.fromEntries(
      Object.entries(idf).map(([k, v]) => [k, +v.toFixed(4)])
    ),
  };

  fs.writeFileSync(SEMANTIC_INDEX, JSON.stringify(semanticIndex, null, 2), 'utf8');
  console.log(`\nWrote semantic-index.json:`);
  console.log(`  Path: ${SEMANTIC_INDEX}`);
  console.log(`  Entries: ${entries.length}`);
  console.log(`  Vocabulary: ${vocabulary.length} terms`);
  console.log(`  File size: ${(fs.statSync(SEMANTIC_INDEX).size / 1024).toFixed(1)} KB`);
}

main();
