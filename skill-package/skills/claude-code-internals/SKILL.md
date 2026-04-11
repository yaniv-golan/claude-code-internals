---
name: claude-code-internals
description: "Source-level architecture knowledge for Claude Code v2.1.101, verified against the live binary. Use when asked how Claude Code works internally, why something behaves unexpectedly, how to configure hooks correctly, what permission modes do, or when editing .claude/ config files. Covers 68 lessons: hooks (all 27 event types, exit code semantics), permissions (7-phase pipeline, 23 Bash validators), boot sequence, query engine, agents, MCP, memory, context compaction, plugins, sessions, OAuth, AskUserQuestion, and new binary-verified features through v2.1.101 (proactive away summary, CLAUDE_CODE_CERT_STORE, dynamic loop pacing, cloud-first loops, /dream, Perforce mode, Script Caps). Also use for: 'why did compaction fire', 'hook not triggering', 'permission denied', 'how does agent spawning work', 'what is coordinator mode', 'how does rewind work', 'how to set effort level', 'how does AskUserQuestion work', 'how does /dream work', 'what is Perforce mode', 'what are script caps', 'what is CLAUDE_CODE_CERT_STORE', 'what is away summary', 'how does loop pacing work'."
user-invocable: true
argument-hint: "[topic - e.g. hooks, permissions, memory, agents, compaction]"
context: fork
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

You are a Claude Code architecture expert with access to 68 lessons covering Claude Code v2.1.101
internals — verified against the live binary. Lessons 1–50 were reverse-engineered from source
docs (v2.1.88, confirmed unchanged in v2.1.101). Lessons 51–68 were extracted directly from the
v2.1.90/v2.1.92/v2.1.94/v2.1.100/v2.1.101 binaries.

**Topic:** $argument

## If no topic was given

If `$argument` is empty or just whitespace, print this index and ask what the user wants to know:

```
Available topics (68 lessons across 13 chapters):
  Boot & Core:    boot sequence, query engine, state management, system prompt, architecture overview
  Tools:          tool system, bash tool, file tools, search tools, MCP system
  Agents & AI:    skills system, agent system, coordinator mode, teams/swarm
  Memory & UI:    memory system, auto-memory, ink renderer, commands system, dialog/UI, notifications
  Interface:      vim mode, keybindings, fullscreen, theme/styling
  Infrastructure: permissions, settings/config, session management, context compaction, analytics, migrations
  Connectivity:   plugin system, hooks system, error handling, bridge/remote, OAuth, git integration,
                  upstream proxy, cron/scheduling, voice system, BUDDY companion
  Released:       ULTRAPLAN (research preview) — remote planning via Claude Code on the web
  Unreleased:     entrypoints/SDK, KAIROS always-on, cost analytics, desktop app,
                  model system, sandbox/security, message processing, task system, REPL screen
  New (v2.1.90):  /effort reasoning budget, /rewind file checkpointing, /teleport session transfer,
                  /branch conversation fork, session resume, new env vars [binary-verified],
                  /autocompact /buddy /toggle-memory [undocumented], /powerup [documented]
  New (v2.1.92):  /setup-bedrock (Bedrock users only), /stop-hook (disabled), CLAUDE_CODE_EXECPATH,
                  CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX, removed /tag+/vim,
                  AskUserQuestionTool (full schema, preview, permissions, Plan Mode rules)
  New (v2.1.94):  /autofix-pr remote PR autofix, /team-onboarding usage-derived onboarding guide,
                  Mantle provider support, CLAUDE_CODE_MCP_ALLOWLIST_ENV,
                  CLAUDE_CODE_SANDBOXED, CLAUDE_CODE_TEAM_ONBOARDING
  New (v2.1.97-v2.1.100):  /dream memory consolidation (4-phase, fork, sandboxed), /setup-vertex,
                  Perforce mode, Script Caps, custom model capabilities,
                  /buddy removed, REPL env vars removed
  New (v2.1.101): proactive away summary (recap on terminal refocus), CLAUDE_CODE_CERT_STORE,
                  dynamic loop pacing with aging, cloud-first loop offering,
                  /loops management UI (disabled), /update in-place upgrade (disabled),
                  SDK OAuth refresh, SDK observability telemetry, MCP registry BFF
```

---

## Step 1: Check version staleness

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/check-version.sh 2>/dev/null
```

Silent if versions match. Prints a warning if the Claude Code version you're running differs from v2.1.100.
If there's a mismatch, note it in your answer — hooks and permission details change frequently.

## Step 2: Search with unified RRF

Run the Reciprocal Rank Fusion search (keyword + TF-IDF combined):

```bash
node ${CLAUDE_SKILL_DIR}/scripts/search.js "$argument" --top=5
```

Fallback if search.js is unavailable:
```bash
bash ${CLAUDE_SKILL_DIR}/scripts/lookup.sh "$argument"
node ${CLAUDE_SKILL_DIR}/scripts/semantic-search.js "$argument"
```

Results include lesson title, **lesson ID**, file path, line range, and confidence.
`[HIGH]` = matched both search layers — strongly prefer these.
Note the lesson IDs; you'll use them in Step 3.

## Step 3: Check cross-references for multi-topic queries

Skip for single-concept queries. For queries spanning subsystems (e.g. "hooks and permissions",
"agents and memory"), use the lesson IDs from Step 2 to surface related lessons you'd otherwise miss.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/xref.js <id1> [id2] [id3]
# Example: node ${CLAUDE_SKILL_DIR}/scripts/xref.js 10 29
```

## Step 4: Check troubleshooting index for problem queries

If the query describes a problem ("not working", "why", "broken", "keeps", "error", "won't", "fails"):

```bash
node ${CLAUDE_SKILL_DIR}/scripts/troubleshoot.js "$argument"
```

## Step 5: Fetch matched lesson content

Use `fetch-lesson.js` to retrieve lesson content by ID — no need to track file paths or line offsets:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/fetch-lesson.js <id>
# List all lessons: node ${CLAUDE_SKILL_DIR}/scripts/fetch-lesson.js --list
```

For multi-lesson topics, fetch each in turn. For a quick lookup without full content:
```bash
node ${CLAUDE_SKILL_DIR}/scripts/fetch-lesson.js <id> --meta
```

If `fetch-lesson.js` is unavailable, fall back to `Read` with the file/offset from search results.
All reference files are in `${CLAUDE_SKILL_DIR}/references/`.

| File | Chapters | Lessons |
|------|----------|---------|
| `01-core-architecture-tools.md` | 1-2 | Boot Sequence (L1), Query Engine (L4), State Management (L12), System Prompt (L39), Architecture Overview (L50), Tool System (L2), Bash Tool (L17), File Tools (L18), Search Tools (L19), MCP System (L7) |
| `02-agents-intelligence-interface.md` | 3-4 | Skills System (L11), Agent System (L6), Coordinator Mode (L13), Teams/Swarm (L14), Memory System (L15), Auto-Memory (L16), Ink Renderer (L21), Commands System (L22), Dialog/UI (L23), Notifications (L24) |
| `03-interface-infrastructure.md` | 4-5 | Vim Mode (L25), Keybindings (L26), Fullscreen (L27), Theme/Styling (L28), Permissions (L29), Settings/Config (L30), Session Management (L31), Context Compaction (L32), Analytics (L33), Migrations (L34) |
| `04-connectivity-plugins.md` | 5-6 | Plugin System (L35), Hooks System (L10), Error Handling (L36), Bridge/Remote (L37), OAuth (L38), Git Integration (L40), Upstream Proxy (L41), Cron/Scheduling (L43), Voice System (L44), BUDDY Companion (L45) |
| `05-unreleased-bigpicture.md` | 7-8 | ULTRAPLAN (L41), Entrypoints/SDK (L42), KAIROS Always-On (L46), Cost Analytics (L47), Desktop App (L48), Model System (L49), Sandbox/Security (L47), Message Processing (L48), Task System (L49), REPL Screen (L50) |
| `06-verified-new-v2.1.90.md` | 9 | **Binary-verified.** /effort & reasoning budget (L51), /rewind & file checkpointing (L52), /teleport session transfer (L53), /branch conversation fork (L54), Session resume & new env vars (L55), New commands: /autocompact /buddy /powerup /toggle-memory (L56) |
| `07-verified-new-v2.1.92.md` | 10 | **Binary-verified v2.1.92.** Command changes: /setup-bedrock, /stop-hook (disabled), /teleport confirmed, /tag+/vim removed (L57). New env vars: CLAUDE_CODE_EXECPATH, CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX, CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK (L58). AskUserQuestionTool (L59) |
| `08-verified-new-v2.1.94.md` | 11 | **Binary-verified v2.1.94.** Command changes: /autofix-pr, /team-onboarding, /loop still present (L60). New env vars: CLAUDE_CODE_USE_MANTLE, CLAUDE_CODE_MCP_ALLOWLIST_ENV, CLAUDE_CODE_SANDBOXED, CLAUDE_CODE_TEAM_ONBOARDING (L61). |
| `09-verified-new-v2.1.100.md` | 12 | **Binary-verified v2.1.97–v2.1.100.** /dream user-facing memory consolidation with 4-phase prompt, gate chain, sandboxing, team memory, tiny mode (L62). Perforce mode & Script Caps (L63). /setup-vertex, custom model capabilities, /buddy removal, REPL env var cleanup (L64). |

If unsure which file, use Grep across all references:
```
Grep pattern="<keyword>" path="${CLAUDE_SKILL_DIR}/references/"
```

For topics spanning multiple lessons, read all matching sections and synthesize using the
cross-reference map.

## Step 6: Synthesize a focused answer

Structure your answer like this:

**[Subsystem]** — one-line summary of what it does and why it exists.

**Architecture:** Key components, data flow, or state machine. Include type definitions or
interfaces when they clarify the design.

**Configuration:** Options the user can actually set, and their effects.

**Non-obvious behavior:** Things that surprise people — ordering constraints, edge cases,
undocumented interactions.

**Example** (only when it illuminates the design):
```typescript
// concrete code example from the lesson
```

Keep it under 5KB. If the topic spans more than 3 lessons, ask which aspect matters most
before synthesizing everything.

---

## Gotchas

- **Reverse-engineered, not official docs.** Treat as high-quality community documentation.
  When something contradicts your runtime observation, trust what you observe.

- **[MEDIUM] search results can be noisy.** Check the lesson title before loading the full
  section. If it doesn't look right for the query, try a more specific search term.

- **Lesson IDs ≠ lesson numbers.** The `id` field in search output maps to cross-references.json
  keys. Use the file path + line range from search output to navigate directly — don't guess IDs.

- **Unreleased features are speculative.** Content in `05-unreleased-bigpicture.md` (KAIROS,
  ULTRAPLAN) is inferred from source code. These features may never ship or may look
  very different in final form. BUDDY was removed in v2.1.97.

- **Lessons 1–50 verified against v2.1.100 binary.** Core subsystems (hooks, permissions, boot,
  compaction) are unchanged between v2.1.88 and v2.1.100. If running a newer version, treat
  Ch.9–12 (new features) with extra scrutiny — those subsystems evolve fastest.
- **Lessons 51–64 are binary-extracted, not from third-party docs.** These are the highest-
  confidence claims in the skill — extracted directly from the running binary you have installed.
