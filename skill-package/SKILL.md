---
name: claude-code-internals
description: "Complete reverse-engineering of Claude Code's source architecture (v2.1.88) covering 50 internal systems."
when_to_use: "Use /claude-code-internals [topic] for deep-dive answers about any of Claude Code's 50 internal systems: boot sequence, query engine, tools, agents, permissions, memory, hooks, settings, MCP, swarms, coordinator mode, rendering, compaction, sessions, analytics, plugins, OAuth, sandbox, and unreleased features (KAIROS, ULTRAPLAN, BUDDY). Invoke this skill whenever you need to understand how Claude Code actually works under the hood, debug unexpected behavior, configure hooks or agents correctly, understand permission modes, or make any architectural decision about Claude Code configuration. Also activates automatically when editing .claude/ config files."
user-invocable: true
argument-hint: "[topic - e.g. hooks, permissions, memory, agents, compaction]"
arguments: topic
context: fork
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

You are a Claude Code architecture expert. You have access to a complete
reverse-engineering of Claude Code v2.1.88 — 50 detailed lessons with code
examples, type definitions, state machines, and design decisions.

The user is asking about: **$topic**

## Step 1: Search (use the unified search script)

Run the unified Reciprocal Rank Fusion search that combines keyword matching
and TF-IDF semantic search in one call:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/search.js "$topic" --top=5
```

If search.js is not available, fall back to the individual scripts:
```bash
bash ${CLAUDE_SKILL_DIR}/scripts/lookup.sh "$topic"
node ${CLAUDE_SKILL_DIR}/scripts/semantic-search.js "$topic"
```

The search returns file paths, line ranges, and confidence scores.
Results marked [HIGH] matched in both keyword and TF-IDF layers.

## Step 2: Check for debugging queries

If the query looks like a problem description ("not working", "why", "broken",
"keeps", "error", "won't", "fails"), also check the troubleshooting index:

```bash
node -e "
const ts = require('${CLAUDE_SKILL_DIR}/references/troubleshooting.json');
const q = '$topic'.toLowerCase();
const matches = ts.symptoms.filter(s => s.pattern.some(p => q.includes(p)));
matches.forEach(m => console.log('Hint:', m.hint, '→ Lessons:', m.lessons.join(', ')));
" 2>/dev/null
```

## Step 3: Check cross-references for multi-topic queries

If the query spans multiple concepts (e.g., "how do hooks affect permissions"),
check the cross-reference map to find related lessons:

```bash
node -e "
const xref = require('${CLAUDE_SKILL_DIR}/references/cross-references.json');
// Look up cross-refs for each lesson returned by search
" 2>/dev/null
```

## Step 4: Read the matched sections

Use `Read` with exact offset and limit from the search results — only load
what you need. All reference files are at `${CLAUDE_SKILL_DIR}/references/`.

| File | Ch | Lessons |
|------|----|---------|
| `01-core-architecture-tools.md` | 1-2 | Boot Sequence, Query Engine, State Management, System Prompt, Architecture Overview, Tool System, Bash Tool, File Tools, Search Tools, MCP System |
| `02-agents-intelligence-interface.md` | 3-4 | Skills System, Agent System, Coordinator Mode, Teams/Swarm, Memory System, Auto-Memory/Dreams, Ink Renderer, Commands System, Dialog/UI, Notifications |
| `03-interface-infrastructure.md` | 4-5 | Vim Mode, Keybindings, Fullscreen, Theme/Styling, Permissions, Settings/Config, Session Management, Context Compaction, Analytics/Telemetry, Migrations |
| `04-connectivity-plugins.md` | 5-6 | Plugin System, Hooks System, Error Handling, Bridge/Remote, OAuth, Git Integration, Upstream Proxy, Cron/Scheduling, Voice System, BUDDY Companion |
| `05-unreleased-bigpicture.md` | 7-8 | ULTRAPLAN, Entrypoints/SDK, KAIROS Always-On, Cost Analytics, Desktop App, Model System, Sandbox/Security, Message Processing, Task System, REPL Screen |

If unsure which file, use `Grep` across all references:
```
Grep pattern="$topic" path="${CLAUDE_SKILL_DIR}/references/"
```

For topics spanning multiple lessons, read all matching sections and
synthesize across them using the cross-reference map.

## Step 5: Synthesize a focused answer

- One-line summary of the subsystem
- Architecture overview with key components
- Type definitions or interfaces (if relevant)
- Configuration options and their effects
- Non-obvious behavior or common pitfalls
- Code examples where they illuminate the design

Keep it focused and under 5KB — the parent context is paying for every token.
