# Claude Code Internals

> A self-contained Claude Code skill that gives Claude source-level knowledge of its own architecture — 218 lessons covering every internal subsystem, searchable three ways.

**Writing skills that survive Cowork → [ccinternals.dev/cowork](https://ccinternals.dev/cowork/)**

**License:** MIT | Version and capture details: see [`skills/claude-code-internals/version.json`](skills/claude-code-internals/version.json)

---

## Table of Contents

- [What This Is](#what-this-is)
- [Why This Skill Is Useful](#why-this-skill-is-useful)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation--turn-this-into-your-own-local-skill)
- [Usage Examples](#usage-examples)
- [Sample Output](#sample-output)
- [Getting the Most Out of It](#getting-the-most-out-of-it)
- [Troubleshooting](#troubleshooting)
- [What's Inside](#whats-inside)
- [Version Tracking](#version-tracking)
- [Platform Compatibility](#platform-compatibility)
- [License](#license)

---

## What This Is

This is a Claude Code skill (a local knowledge package that Claude Code loads automatically) containing a complete reverse-engineering of Claude Code's internal architecture. 218 detailed lessons cover every major subsystem — from the boot sequence to unreleased features. When you type `/claude-code-internals hooks` or `/claude-code-internals permissions`, Claude doesn't guess or hallucinate. It reads actual architecture documentation, searches through indexed reference material, and gives you source-level answers with code examples and type definitions.

Without this skill, Claude knows *how to use* Claude Code but doesn't know *how Claude Code works internally*. With it, Claude becomes an expert on its own implementation — the query engine's retry logic, the 33 hook event types (as of 2.1.280), the 7-phase permission pipeline, the compaction algorithm, the agent spawn lifecycle, all of it.

## Why This Skill Is Useful

### The Core Problem

Claude Code is a powerful tool, but Claude doesn't understand its own internals. Ask it "what hook events are available?" and it'll give you a partial, sometimes wrong answer. Ask it "why did compaction eat my context?" and it'll speculate. Ask it "how do permission modes actually work?" and you'll get a general answer that misses the 23 Bash security validators and the 7-phase decision pipeline.

This is because Claude's training data doesn't include Claude Code's source code. It knows the public docs, but not the implementation details that matter when you're configuring complex behavior.

### What Changes With This Skill

- **Claude stops guessing.** Every answer comes from indexed architecture documentation, not training data. When you ask about hooks, Claude reads the actual hook system lesson that documents the hook event types (33 as of 2.1.280), exit code semantics, and 5 command types.

- **You get source-level depth.** Not "hooks let you run commands before and after tool use" but "PreToolUse hooks receive `{tool_name, tool_input}` as JSON on stdin, exit 0 proceeds silently, exit 1 proceeds with stderr shown to user, exit 2 blocks the tool and sends stderr to the model."

- **Configuration becomes precise.** Instead of trial-and-error when setting up agents, hooks, or permission rules, Claude can tell you exactly what fields are expected, what the valid values are, and what edge cases to watch for.

- **Debugging gets real answers.** "Why isn't my hook firing?" becomes answerable — Claude can check whether the matcher regex matches, whether the hook is in the right settings layer, whether the snapshot-capture-at-startup behavior means you need a session restart.

### Who Benefits Most

- **Claude Code power users** who configure hooks, agents, skills, and permissions
- **Developers building on Claude Code** who need to understand the agent system, coordinator mode, or MCP integration
- **Anyone debugging Claude Code behavior** who needs to understand what's happening under the hood

## How It Works

### Architecture

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

```
                    User asks: "/claude-code-internals hooks"
                                    |
                                    v
                    +-------------------------------+
                    |        SKILL.md (brain)        |
                    |   Parses topic, chooses        |
                    |   search strategy              |
                    +-------------------------------+
                                    |
                   +----------------+----------------+
                   |                |                |
                   v                v                v
          +-------------+  +---------------+  +----------------+
          | lookup.sh   |  | semantic-     |  | search.js      |
          | (keyword)   |  | search.js     |  | (unified)      |
          |             |  | (TF-IDF)      |  |                |
          | jq query    |  | cosine sim    |  | keyword rank   |
          | against     |  | against       |  | first, then    |
          | the keyword |  | per-lesson    |  | TF-IDF-only    |
          | map         |  | TF-IDF        |  | matches        |
          |             |  | vectors       |  |                |
          +------+------+  +-------+-------+  +-------+--------+
                 |                 |                   |
                 v                 v                   v
          file:line refs     ranked lessons     one ranking
                 |                 |                   |
                 +--------+-------+-------------------+
                          |
                          v
               +------------------------+
               |   Read matched section  |
               |   with offset/limit     |
               |   (only load what's     |
               |    needed)              |
               +------------------------+
                          |
                          v
               +------------------------+
               |   Synthesize answer     |
               |   < 5KB with code       |
               |   examples              |
               +------------------------+
```

</details>

### The Search Layers

| Layer | Script | Speed | Best For | Requires |
|-------|--------|-------|----------|----------|
| **Unified** | `search.js` | ~60ms | **Use this by default** — keyword matches in keyword order, then TF-IDF-only matches | Node.js |
| **1. Keyword** | `lookup.sh` | Instant | Exact terms: "hooks", "permissions", "KAIROS" | `jq` |
| **2. TF-IDF** | `semantic-search.js` | ~50ms | Natural language: "how does Claude decide what tools to use" | Node.js |

- **Layer 1** uses `jq` to search the keyword map, which points at exact file:line ranges.
- **Layer 2** tokenizes your query and computes cosine similarity against per-lesson TF-IDF vectors covering all 218 lessons. The index is not shipped: it is built in memory from `topic-index.json` on first use (then cached under your user cache directory; `CCI_NO_INDEX_CACHE=1` disables the cache). Pure Node.js, no dependencies.
- **`search.js`** runs both: the keyword layer's results lead, and TF-IDF adds the lessons the keyword layer missed. It is the one to reach for unless you specifically want a single layer's behaviour.

### Auto-Trigger Hook

A PreToolUse hook fires whenever Claude is about to edit files under `.claude/`. It injects a reminder into the model's context:

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

```
PreToolUse hook fires on Edit/Write/Bash targeting .claude/
                            |
                            v
              +----------------------------+
              | config-aware-hook.sh       |
              | Parses tool_input JSON     |
              | Checks if path contains    |
              | .claude/                   |
              +----------------------------+
                            |
              +-------------+-------------+
              |                           |
              v                           v
        .claude/ path              Other path
        detected                   detected
              |                           |
              v                           v
        stdout: reminder           silent exit 0
        exit 0 (proceed)          (no output)
              |
              v
        Model sees:
        "Claude Code internals
         available via
         /claude-code-internals [topic]"
```

</details>

This means Claude gets a nudge to consult the architecture docs before modifying Claude Code configuration — without blocking the operation.

## Prerequisites

| Requirement | Minimum Version | Check Command | Notes |
|-------------|----------------|---------------|-------|
| **Claude Code** | v2.1.0+ | `claude --version` | Skills require a recent version |
| **Node.js** | v18+ | `node --version` | Required for `search.js` (the default) and Layer 2 (TF-IDF search) |
| **jq** | Any | `jq --version` | Required for `lookup.sh`, the keyword fallback used when `search.js` cannot run |

**Install missing prerequisites:**

```bash
# macOS (Homebrew)
brew install jq node
```

## Installation — Turn This Into Your Own Local Skill

### Overview

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

```
  +----------+    +----------+    +----------+    +----------+    +--------+
  |  1. Get  | -> | 2. mkdir | -> | 3. chmod | -> |4. Restart| -> |5. Use! |
  |  the zip |    |  + unzip |    |  scripts |    |  Claude  |    |        |
  |          |    |          |    |          |    |  Code    |    | /claude-|
  | claude-  |    | ~/.claude|    | chmod +x |    |          |    |internals|
  | internals|    | /skills/ |    | scripts/ |    | Skills   |    |  hooks  |
  | .zip     |    | claude-  |    | *.sh     |    | register |    |        |
  |          |    | internals|    | *.js     |    | at start |    |        |
  +----------+    +----------+    +----------+    +----------+    +--------+
```

</details>

### From the Zip File (Recommended)

If someone sends you `claude-code-internals.zip`, this is all you need:

```bash
# 1. Create the skill directory
mkdir -p ~/.claude/skills/claude-code-internals

# 2. Unzip into it
cd ~/.claude/skills/claude-code-internals
unzip ~/path/to/claude-code-internals.zip

# 3. Make scripts executable
chmod +x scripts/*.sh scripts/*.js

# 4. Restart Claude Code (skills register on startup)
# Close your terminal and reopen, or start a new Claude Code session

# 5. Verify it works — type this in Claude Code:
#   /claude-code-internals hooks
# You should see a detailed response about all 33 hook events,
# exit code semantics, and configuration format. If you see
# "Unknown skill" instead, Claude Code needs a restart.
```

That's it. The zip contains everything the skill needs — the SKILL.md brain, all 218 lessons, the lesson index (`topic-index.json`), the current-state layer, and the scripts. The TF-IDF search index is built in memory from `topic-index.json` on first use, so there is nothing extra to ship. No npm install, no server, no API keys.

### From This Repo

```bash
cp -r skill-package/* ~/.claude/skills/claude-code-internals/
```

### Activate the PreToolUse Hook (Optional)

This adds a gentle nudge whenever Claude is about to modify `.claude/` config files. It is opt-in for **every** install type — a plugin install does not register it for you either, so this step applies whether you installed as a plugin or copied the files above. To enable it, add it to the `hooks` object in `~/.claude/settings.json`:

```json
"PreToolUse": [
  {
    "matcher": "(Edit|Write|Bash)",
    "hooks": [
      {
        "type": "command",
        "command": "~/.claude/skills/claude-code-internals/scripts/config-aware-hook.sh",
        "timeout": 5
      }
    ]
  }
]
```

> **Note:** If your `~/.claude/settings.json` doesn't have a `hooks` object yet, create one:
> ```json
> { "hooks": { "PreToolUse": [ ... ] } }
> ```
> If `settings.json` doesn't exist at all, create it with that content.
>
> The `command` path above is for a manual/copy install and is stable across releases. For a plugin install, point `command` at the plugin's cache copy instead — `~/.claude/plugins/cache/claude-code-internals-marketplace/claude-code-internals/<version>/skills/claude-code-internals/scripts/config-aware-hook.sh` — which changes each release, so re-point it after updating. (`${CLAUDE_PLUGIN_ROOT}` only expands inside a plugin-declared hook, not in `settings.json`.)

## Usage Examples

### Basic Topic Lookup

```
/claude-code-internals hooks
```
Returns all 33 hook event types (as of 2.1.280), exit code semantics (0=proceed, 1=proceed+warn, 2=block), 5 command types, configuration format, and the critical detail that hook config is snapshot-captured at startup.

```
/claude-code-internals permissions
```
Returns the 7-phase permission pipeline, 6 permission modes, the 23 Bash security validators, rule matching (exact, prefix, wildcard), rule sources and priority order, auto-mode fast paths, and bypass mode limitations.

### Natural Language Questions

```
/claude-code-internals how does context compaction work
```
Returns the compaction algorithm, token thresholds, microcompact vs full compaction, what gets preserved vs summarized, and how to avoid losing important context.

### Debugging Scenarios

```
/claude-code-internals why isn't my hook firing
```
Surfaces: Hook config is snapshot-captured once at startup (changes mid-session don't take effect), matcher regex must match the tool name, PreToolUse vs PostToolUse timing, and the exit code contract.

### Configuration Reference

```
/claude-code-internals settings cascade
```
Returns the 5-layer config cascade (policy > project > user > local > CLI), Zod schema validation, chokidar file watching, and how layers merge.

### When Keyword Search Fails, TF-IDF Succeeds

```
/claude-code-internals what happens when Claude runs out of context space
```
The keyword "compaction" doesn't appear in the query, but the TF-IDF layer matches it to the Context Compaction lesson because of overlapping terms like "context" and the semantic structure of the question.

## Sample Output

Here's what the search layers actually return:

**Keyword lookup** (`lookup.sh hooks`, first matches):
```
48-forced-ask-deferral-silent-turn-2.1.260.md:295:352 "Function Hooks: A Second Hook-Authoring Surface"
04-connectivity-plugins.md:699:841 "Hooks System"
47-desktop-1.46388-lanes-computed-env-flags.md:264:350 "Four Flags Named: ENABLE_FUNCTION_HOOKS, COZY_TEAPOT, WISE_COMET, MODEL_CATALOG"
```

**TF-IDF search** (`semantic-search.js "how does context compaction work"`, top 3; long keyword lists trimmed):
```
Query: "how does context compaction work"
Tokens: [context, compaction, work]
============================================================

  1. Context Compaction (Lesson 28) [MEDIUM]
     Score: 0.1685  #######
     File:  03-interface-infrastructure.md:973-1059
     Keywords: compaction, context-window, microcompact, summarization, token-management

  2. Context Hint API (Server-Driven Micro-Compaction) (Lesson 80) [MEDIUM]
     Score: 0.1334  #####
     File:  13-verified-new-v2.1.111.md:239-306
     Keywords: context-hint, context-hint-api, context-hint-2026-04-09, tengu_hazel_osprey, YE5, …

  3. Marble Origami: Reversible Context Collapse Persistence (Lesson 69) [MEDIUM]
     Score: 0.1332  #####
     File:  10-verified-new-v2.1.101.md:745-872
     Keywords: marble-origami, context-collapse, contextCollapse, compaction, reversible, …
```

The skill then reads the matched section with exact line offsets and synthesizes a focused answer under 5KB.

## Getting the Most Out of It

1. **Use it BEFORE configuring anything under `.claude/`.** The skill knows exact formats, valid values, and edge cases. This eliminates the trial-and-error cycle of "change config, restart, test, find out it doesn't work, repeat."

2. **Use natural language when keywords don't work.** If "compaction" doesn't find what you need, try "what happens when Claude runs out of context space" — the TF-IDF layer handles fuzzy matching.

3. **Know its limits.** This is captured from a specific Claude Code build — see `version.json`'s `captured_version` for the exact one. If Claude Code has updated since, some internals may have changed. The `check-version.sh` script detects this automatically.

## Smart Features

### Unified Search (keyword first)

Instead of choosing between keyword search and TF-IDF, `search.js` runs both. Every lesson the keyword layer returns comes first, in keyword order; the lessons only TF-IDF found follow, in TF-IDF order. On the repository's retrieval question sets this order beat [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) of the two layers, which pushed the keyword layer's first pick out of the top 3; `--fused` still ranks by RRF, for comparison.

```bash
node scripts/search.js "hook events"
# Returns: Hooks System [HIGH - both layers], plus related lessons
```

Results are labeled with confidence:
- **HIGH** — Both keyword and TF-IDF returned it
- **MEDIUM** — Keyword layer only
- **LOW** — TF-IDF layer only

### Version Staleness Detection

The skill automatically warns when Claude Code has updated past the captured version:

```bash
bash scripts/check-version.sh
# Silent if versions match
# Warns: "captured from vA.B.C but you are running vX.Y.Z"
```

### Troubleshooting Index

180 common problems mapped to relevant lessons with one-line hints:

```bash
# When the skill sees a debugging query like "hook not firing", it checks
# troubleshooting.json and surfaces:
#   Hint: Hook config is snapshot-captured at startup. Restart Claude Code.
#   → Lessons: 32 (Hooks), 26 (Settings), 1 (Boot Sequence)
```

### Cross-Reference Map

758 lesson-to-lesson connections enable multi-topic synthesis. When you ask "how do hooks interact with permissions?", the skill reads both the Hooks lesson AND the Permissions lesson because the cross-reference map links them (relevance: 0.85).

## RuFlo Task Orchestration (hook only)

The package ships one artifact for RuFlo integration: the PreToolUse hook in
`hooks-config.json` and `scripts/config-aware-hook.sh`. When a task touches
Claude Code configuration, it injects a reminder pointing at this skill.

That hook is the whole integration. There is no embedding pipeline, no
`claude-code-internals` vector namespace, and no neural search layer in this
repository — `scripts/lib/tfidf-index.js` derives a local TF-IDF index from
`topic-index.json` in memory and nothing else. Search works entirely offline
through Layers 1 and 2.

## Troubleshooting

**"Unknown skill" when typing `/claude-code-internals`**
Skills register at startup. Restart Claude Code (close terminal, reopen) and try again.

**`lookup.sh` fails with "command not found: jq"**
Install jq: `brew install jq` (macOS) or `apt-get install jq` (Linux).

**`semantic-search.js` fails or returns no results**
Check Node.js version: `node --version` (requires v18+). If the file isn't executable: `chmod +x scripts/semantic-search.js`.

**Hook doesn't fire when editing `.claude/` files**
Hook config is snapshot-captured once at startup. If you just added the hook to `settings.json`, restart Claude Code. Also verify the script path is correct and the script is executable: `chmod +x scripts/config-aware-hook.sh`.

**Search returns the wrong lesson**
Try a different query phrasing. Layer 1 (keyword) is exact-match only. Layer 2 (TF-IDF) works better with natural language. If both miss, the topic may span multiple lessons — try broader terms.

## What's Inside

<details>
<summary>Directory Structure (click to expand)</summary>

```
skill-package/skills/claude-code-internals/   (the skill — exactly what the zip contains)
|
+-- SKILL.md              Skill brain (search strategy + topic index)
+-- version.json          Version tracking (see file)
+-- hooks-config.json     PreToolUse hook definition
+-- references/           Chapter .md files plus the JSON indexes
|                         (topic-index, hand-keywords, cross-references,
|                          troubleshooting) and the state/ current-state layer
+-- scripts/              Search scripts (search.js, semantic-search.js,
                          lookup.sh, ...), lib/, maintenance scripts, and tests/
```

The repository also holds this README, the LICENSE, and the root README and
plugin manifest — none of which are part of the zip. See **What's in the Zip**
below for the file-by-file breakdown.

</details>

The lessons are organized into chapters across the `references/*.md` files; see
`version.json` for the current lesson and chapter counts.

### What's in the Zip

The `claude-code-internals.zip` file is the complete, shareable package. It contains everything needed to install and use the skill:

| File | Purpose |
|------|---------|
| `SKILL.md` | The skill brain — seven-step workflow, gotchas, and the reference-file map |
| `version.json` | Skill version, captured CLI version and date, and the derived lesson and chapter counts |
| `hooks-config.json` | Example PreToolUse hook definition (portable paths) |
| `references/*.md` | The chapter files holding every lesson |
| `references/topic-index.json` | Per-lesson bounds and keywords, plus the keyword map (keyword fields derived by `prepare-lessons.js`) |
| `references/hand-keywords.json` | The frozen hand-written keywords that `topic-index.json` projects; never edited, never written by a script |
| `references/cross-references.json` | Lesson-to-lesson links |
| `references/troubleshooting.json` | Symptom entries with lesson pointers and hints |
| `references/state/` | Current-state layer — domain pages, `registry.json`, `author-facts.json` |
| `scripts/` (query) | `search.js` (unified, keyword first — use this by default), `semantic-search.js`, `lib/tfidf-index.js` (the TF-IDF index, derived from `topic-index.json` at load and cached outside the skill directory), `lookup.sh`, `fetch-lesson.js`, `xref.js`, `troubleshoot.js`, `state.js` |
| `scripts/` (maintenance) | `build.js`, `prepare-lessons.js`, `validate-state.js`, `check-json-format.js`, `check-history-markers.js`, `count-symbol.js`, `check-version.sh`, `extract-bundle.sh`, `diff-versions.sh`, `config-aware-hook.sh` |
| `scripts/tests/` | Tests guarding release consistency, derived fields, JSON canonical format, search and the state layer |

The zip is exactly `skill-package/skills/claude-code-internals/`, so it does **not** contain this README or the LICENSE — those live in the repository.

## Version Tracking

`version.json` holds five fields:

- `skill_version` — this skill's release version (also in `.claude-plugin/plugin.json`);
- `captured_version` — the Claude Code CLI build the content baseline was read from;
- `captured_date` — when that baseline was captured;
- `lessons_count` and `chapters_count` — derived from the reference files by `scripts/build.js`.

See `version.json` for the real, current values; per-release history is in the repository's `CHANGELOG.md`. When Claude Code updates beyond the pinned `captured_version`, the internals knowledge may be stale. To update:

1. Re-download lessons from the source
2. Replace the files in `references/`
3. Run `node scripts/build.js` to re-derive lesson bounds and counts (the TF-IDF index is derived from `topic-index.json` at search time; nothing to rebuild), then `node scripts/prepare-lessons.js` to derive the keyword fields of `topic-index.json` (`build.js --check` fails until it has run). Never edit keywords by hand: the hand-written ones are frozen in `references/hand-keywords.json`. Deleting a lesson needs no keyword edit, but a **new** lesson also needs `node scripts/prepare-lessons.js --generate` (the one model-calling step) to propose its vocabulary — `build.js --check` fails until that has run
4. Update `version.json` with the new version

## Platform Compatibility

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | Fully tested | Primary development platform |
| **Linux** | Expected to work | Uses standard bash, jq, Node.js |
| **Windows (WSL)** | Expected to work | Run inside WSL, not native Windows |
| **Windows (native)** | Not supported | Bash scripts require a Unix shell |

## License

MIT License. See [LICENSE](LICENSE) for full text.

The architecture lesson content in `references/` is sourced from [markdown.engineering](https://www.markdown.engineering/learn-claude-code/) and is used for educational and tooling purposes. The skill packaging, indexes, search scripts, and hook integrations are original work.
