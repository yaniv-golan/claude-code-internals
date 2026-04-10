Updated: 2026-04-03 | Source: Binary extraction from claude v2.1.90

# Chapter 9: Verified New in v2.1.90 (Source-Confirmed)

> These lessons were extracted directly from the v2.1.90 binary and cross-referenced against
> v2.1.88. All claims here have been verified against minified source. The prior lesson files
> (01–05) were captured from markdown.engineering at v2.1.88 and remain accurate for those
> subsystems (hook types, permission pipeline, boot sequence, etc. are unchanged).
>
> **Documentation status note:** Lessons 51–54 cover features that ARE officially documented
> at code.claude.com/docs (commands, CLI reference, settings). The value of this chapter is
> the **implementation-level detail** extracted from the binary — internal type names, state
> keys, API betas, telemetry event names, and non-obvious behaviors not in the official docs.
> Lesson 55 contains a mix: the session resume auto-prompt, advisor model, and several env
> vars are **genuinely undocumented** (not in official docs as of 2026-04-03).
> Lesson 56 documents four new commands found in v2.1.90 that are absent from v2.1.88.
> /powerup and /buddy (base command) are officially documented; /buddy sub-arguments,
> /autocompact, and /toggle-memory are not.

---

## TABLE OF CONTENTS

51. [Lesson 51 -- /effort Command & Reasoning Budget](#lesson-51----effort-command--reasoning-budget)
52. [Lesson 52 -- /rewind & File Checkpointing](#lesson-52----rewind--file-checkpointing)
53. [Lesson 53 -- /teleport: Session Transfer](#lesson-53----teleport-session-transfer)
54. [Lesson 54 -- /branch: Conversation Forking](#lesson-54----branch-conversation-forking)
55. [Lesson 55 -- Session Resume & New env vars](#lesson-55----session-resume--new-env-vars)
56. [Lesson 56 -- New Commands: /autocompact (undoc), /buddy (doc, args undoc), /powerup (doc), /toggle-memory (undoc)](#lesson-56----new-commands)

---

# LESSON 51 -- /effort COMMAND & REASONING BUDGET

## Official docs coverage

**Documented** at `/en/commands` and `/en/settings` (effortLevel key) and env-vars page
(`CLAUDE_CODE_EFFORT_LEVEL`). The official docs describe usage. This lesson adds the
internal implementation details extracted from the binary.

## Confirmed from source

Binary path: `name:"effort", description:"Set effort level for model usage"`
API beta: `effort-2025-11-24`
Settings key: `effortLevel` (persisted, enum: `low | medium | high | max`)
Env var override: `CLAUDE_CODE_EFFORT_LEVEL` (set to `"unset"` or `"auto"` to clear)

## How It Works

`/effort [low|medium|high|max|auto]` sets the reasoning budget for the current (and future)
sessions for supported models. Persisted in `userSettings.effortLevel`.

```
/effort high   → Claude thinks deeply before responding
/effort low    → quick edits, minimal deliberation
/effort auto   → model decides when to think (adaptive thinking)
/effort        → opens picker UI
```

Effort is also settable per-agent in agent definition files:
```yaml
effort: high         # named level
effort: 1000         # integer budget (tokens)
```

## Supported Effort Levels (from model config schema)

```
N.array(N.enum(["low", "medium", "high", "max"]))
```

The `max` level corresponds to "ultrathink" (`ultrathink_effort` message type); it injects
a system message: `"The user has requested reasoning effort level: high. Apply this to the
current turn."` (type: `ultrathink_effort`, level: `"high"`).

## Effort in the Query Pipeline

`effortValue` flows through the query pipeline as a distinct parameter alongside `thinkingType`
and `fastMode`. It is logged to telemetry as `effortValue` in `tengu_api_query` events.

## Non-obvious behavior

- Changing effort mid-session affects the next turn only; previous responses are unaffected.
- `effortLevel` persists across sessions by default. Set `CLAUDE_CODE_EFFORT_LEVEL=unset` to
  prevent persistence.
- `supportedEffortLevels` in the model config schema determines which levels are valid for a
  given model. Not all models support all levels.
- `supportsAdaptiveThinking` flag controls whether `auto` is available.
- Official docs list `low`, `medium`, `high` only; `max` (ultrathink) and `auto` are binary-
  confirmed present but not mentioned in official docs.

---

# LESSON 52 -- /rewind & FILE CHECKPOINTING

## Official docs coverage

**Documented** at `/en/commands` (`/rewind`, alias `/checkpoint`) and env-vars page
(`CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING`). This lesson adds internal type names, the
`--rewind-files` CLI flag, and the snapshot data model.

## Confirmed from source

Command: `name:"rewind", aliases:["checkpoint"]`
Setting: `fileCheckpointingEnabled` (boolean, global)
State key: `fileHistory: FileHistoryState` (snapshots + tracked files)
Telemetry: `tengu_file_history_rewind_success`, `tengu_file_history_rewind_failed`
CLI flag: `--rewind-files <user-message-id>` (not in official CLI reference)

## What It Does

Claude checkpoints all files it touches before every edit. A `FileHistoryState` object tracks:
- `snapshots`: array of `{ messageId, filePath, content }` (or null for deletions)
- `trackedFiles`: Set of paths Claude has modified this session

`/rewind` (or double-tap `Esc Esc`) opens a UI showing all checkpoints keyed to prior
messages. The user can roll back:
- **Files only** — reverts edited files to their state before the selected message
- **Conversation only** — removes messages after the selected point
- **Both** — full rollback

## Implementation Details

```typescript
// Rewind to snapshot at given messageId
await rewindFileHistory(fileHistoryState, messageId)
// → calls $S1(state, snapshot) which calls restoreFile() for each changed file
// → telemetry: tengu_file_history_rewind_success { filesChangedCount }

// Check if rewind is possible
canRewind = fileCheckpointingEnabled && fg_(fileHistory, messageId)
```

Backup files are stored alongside originals (path derived via `PfH(originalPath)`). Rewind
uses `copyFile()` to restore; handles deletions (null snapshot) by calling `unlink()`.

## CLI Usage (not in official docs)

```bash
# Restore files to state before a specific user message (non-interactive)
claude --resume <session> --rewind-files <user-message-uuid>
# Prints: "Files rewound to state at message <uuid>"
```

## Non-obvious behavior

- `fileCheckpointingEnabled` defaults to `true` (opt-out, not opt-in).
- Rewind is **per-file diff**, not whole-snapshot. Only files Claude touched are tracked.
- Double-tap `Esc Esc` shows a preview of what would change (`dryRun: true`) before applying.
- `TombstoneMessage` type marks conversation messages that were removed during a rewind.
- The conversation rewind does NOT use `fileHistory` — it operates on the message store
  separately, controlled by `messageId` and the session's message array.

---

# LESSON 53 -- /teleport: SESSION TRANSFER

## Official docs coverage

**Documented** at `/en/cli-reference` (`--teleport <session-id>`: "Resume a web session in
your local terminal"). This lesson adds the full transfer protocol, git validation logic,
internal function names, and the distinction from ULTRAPLAN's teleport.

## Confirmed from source

Command: `name:"teleport"` (also `claude --teleport <session-id>` CLI flag)
Functions: `teleportFromSessionsAPI()`, `teleportResumeCodeSession()`, `RfH()`
API endpoint: `GET /v1/code/sessions/{id}/teleport-events`
State key: `teleportedSessionInfo: { isTeleported, hasLoggedFirstMessage, sessionId }`

## What It Does

Teleport transfers a Claude.ai **web session** into the local terminal, replaying the full
conversation history with tool access. Separate from ULTRAPLAN's `teleportToRemote()` which
sends a local session to a remote container.

```bash
claude --teleport <session-id>
# or: /teleport (opens session picker)
```

The session ID comes from the web URL (claude.ai/code/sessions/...).

## Transfer Protocol

1. Validate authentication (requires claude.ai account, not just API key)
2. Validate git state: `validateGitState()` — must be in the correct repo checkout
3. Fetch events: `GET /v1/code/sessions/{id}/teleport-events?limit=1000&cursor=<cursor>`
4. Paginate up to 100 pages of events (`pollRemoteSessionEvents()`)
5. Process messages: `processMessagesForTeleportResume()` reconstructs conversation
6. Check out the remote session's branch: `checkOutTeleportedSessionBranch()`
7. Start local session with full history injected

## Git Validation Requirements

The repo must match the remote session's repo:
```
case "not_in_repo": → Error: "You must run claude --teleport <id> from a checkout of <repo>"
case "mismatch": → Error: shows current repo vs required repo
case "match" / "no_repo_required": → proceed
```

Repository info is fetched from the sessions API (`sessionHost`, `sessionRepo`). Branch is
auto-checked-out via `checkOutTeleportedSessionBranch()`.

## Differences from ULTRAPLAN teleport

| Feature | `/teleport` (this lesson) | ULTRAPLAN teleport |
|---------|--------------------------|-------------------|
| Direction | web → local terminal | local → remote CCR container |
| Trigger | CLI flag / slash command | ULTRAPLAN button in web UI |
| Sessions API | `teleport-events` endpoint | `teleportToRemote()` creates new session |
| Auth requirement | claude.ai account | claude.ai account |

## Non-obvious behavior

- `teleportedSessionInfo.hasLoggedFirstMessage` gates a one-time "teleported session" banner.
- The `archiveRemoteSession()` function is called as cleanup if any step after session creation fails.
- HTTP 404 on events: returns empty array (session not found or no events yet).
- HTTP 401 on events: throws — prompts user to `/login`.
- The `CLAUDE_CODE_RESUME_THRESHOLD_MINUTES` / `CLAUDE_CODE_RESUME_TOKEN_THRESHOLD` thresholds
  do NOT apply to teleport; those control a separate auto-resume prompt (Lesson 55).

---

# LESSON 54 -- /branch: CONVERSATION FORKING

## Official docs coverage

**Documented** at `/en/commands` (`/branch [name]`: "Create a branch of the current
conversation at this point. Alias: /fork"). This lesson adds the internal agent type,
context inheritance mechanism, and isolation semantics.

## Confirmed from source

Command: `name:"branch", aliases:["fork"]`
Description: `"Create a branch of the current conversation at this point"`
Argument hint: `[name]`

## What It Does

`/branch [name]` (alias `/fork [name]`) forks the current conversation at the current
message. After branching, both the original and the fork can continue independently with
different approaches.

```
/branch fix-attempt-1    → starts a named fork
/branch                  → opens naming UI
/fork                    → alias, same behavior
```

## Use Cases

- Try two different implementations without losing the other
- Explore a risky refactor while preserving the current working state
- Let one branch go deep on debugging while another tries a rewrite

## Implementation

The branch command uses the `fork` agent type (`agentType: "fork"`). A fork inherits the full
conversation context of its parent (`forkContextMessages`). The fork is a subagent — it runs
in its own context, isolated from the parent's files:

```
"This fork will not affect the parent's files."
```

The fork agent description: `"Implicit fork — inherits full conversation context"`.

When invoked, the fork starts immediately (`immediate: true` in the command definition).

## Non-obvious behavior

- Forks are **not git branches** — they fork the conversation, not the repository. Git state
  is shared between parent and fork (same working directory).
- The `name` argument is optional metadata, not a filesystem or git identifier.
- A fork is a full subagent with independent tool access; it can edit files, run bash, etc.
- Multiple forks from the same parent are independent of each other.
- This is distinct from ULTRAPLAN's multi-agent parallelism; `/branch` is interactive,
  single-user conversation divergence.

---

# LESSON 55 -- SESSION RESUME & NEW ENV VARS

## Session Resume Auto-Prompt

### Documentation status: UNDOCUMENTED

Not present in official docs (commands, settings, env-vars pages) as of 2026-04-02.
Extracted entirely from binary.

### Confirmed from source

Feature flag: `u_("tengu_gleaming_fair", false)` (must be enabled server-side)
Thresholds:
- `CLAUDE_CODE_RESUME_THRESHOLD_MINUTES` (default: `70`) — **not in official env-vars docs**
- `CLAUDE_CODE_RESUME_TOKEN_THRESHOLD` (default: `100000`) — **not in official env-vars docs**

### How It Works

When a session has been idle for ≥ `RESUME_THRESHOLD_MINUTES` AND the token count exceeds
`RESUME_TOKEN_THRESHOLD`, Claude proactively asks if the user wants to resume the session
(surface a "pick up where you left off" prompt).

```javascript
const idleMinutes = (Date.now() - lastMessageTime) / 60000
if (idleMinutes >= threshold && tokenCount >= tokenThreshold) {
  // show resume prompt (dismissed via T_().resumeReturnDismissed)
}
```

The idle check uses the last user or assistant message older than 60 seconds (to avoid false
triggers on very recent activity). The feature gate `tengu_gleaming_fair` defaults to `false`,
meaning this feature is off for most users until Anthropic enables it server-side.

### Configuration

```bash
# Override thresholds (env vars not in official docs — binary-confirmed only)
export CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=30
export CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=50000

# Cannot be disabled by users directly; controlled by Anthropic via feature gate
```

---

## Advisor Model

### Documentation status: UNDOCUMENTED

Not present in official docs as of 2026-04-02. Extracted from binary.

Setting: `advisorModel` (string, model ID)
API beta: `advisor-tool-2026-03-01`

A secondary model that can be invoked as a "server-side advisor" tool during sessions.
When configured, Claude Code passes requests to this model via the `advisor-tool` beta.
The use case appears to be routing certain decisions (code review, plan validation) to a
separate model without exposing a client-side tool call.

---

## New env vars in v2.1.90 (not in v2.1.88)

Documentation status noted per variable. "Official" = appears in code.claude.com/docs/en/env-vars.

| Variable | Default | Purpose | Docs |
|----------|---------|---------|------|
| `CLAUDE_CODE_RESUME_THRESHOLD_MINUTES` | 70 | Minutes idle before auto-resume prompt | Undocumented |
| `CLAUDE_CODE_RESUME_TOKEN_THRESHOLD` | 100000 | Min tokens for auto-resume prompt | Undocumented |
| `CLAUDE_CODE_AGENT_COST_STEER` | — | Cost steering hint for agent spawning | Undocumented |
| `CLAUDE_CODE_DISABLE_CLAUDE_API_SKILL` | — | Disable the built-in Claude API skill | Undocumented |
| `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE` | — | Keep marketplace plugins when load fails | Official |
| `CLAUDE_CODE_REMOTE_SETTINGS_PATH` | — | Path to remote/shared settings file | Undocumented |
| `CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH` | — | Skip Anthropic AWS auth flow | Undocumented |
| `CLAUDE_CODE_USE_ANTHROPIC_AWS` | — | Use Anthropic-managed AWS endpoints | Undocumented |

### Removed from v2.1.88

| Variable | Was Used For |
|----------|-------------|
| `CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK` | Debug: skip injection validator |
| `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` | Disable mouse click handling |

---

## API Betas active in v2.1.90

All betas confirmed present in the binary (string literals extracted from bundle).
The `advisor-tool-2026-03-01` beta is not mentioned in official docs.

| Beta string | Introduced | Docs |
|-------------|-----------|------|
| `effort-2025-11-24` | Reasoning effort levels | Official |
| `task-budgets-2026-03-13` | Per-agent token/turn budgets | Official |
| `advisor-tool-2026-03-01` | Server-side advisor model tool | **Undocumented** |
| `afk-mode-2026-01-31` | AFK/idle mode behavior | Official |
| `fast-mode-2026-02-01` | Fast mode (same model, faster output) | Official |
| `compact-2026-01-12` | Compaction API | Official |
| `advanced-tool-use-2025-11-20` | Extended tool use patterns | Official |
| `tool-search-tool-2025-10-19` | Tool search / deferred tools | Official |
| `skills-2025-10-02` | Skills system | Official |
| `ccr-triggers-2026-01-30` | CCR/remote scheduled triggers | Official |
| `environments-2025-11-01` | Environment management | Official |
| `redact-thinking-2026-02-12` | Redact extended thinking from context | Official |
| `prompt-caching-scope-2026-01-05` | Prompt cache scoping | Official |
| `interleaved-thinking-2025-05-14` | Interleaved thinking | Official |
| `oauth-2025-04-20` | OAuth authentication | Official |
| `web-search-2025-03-05` | Web search tool | Official |
| `mcp-client-2025-11-20` | MCP client protocol | Official |
| `mcp-servers-2025-12-04` | MCP server discovery | Official |

---

## Correction to existing lessons

**Hook types (Lesson 10):** The claim of "27 hook event types" is CONFIRMED CORRECT.
Extracted directly from `xv1` array in v2.1.90 binary — all 27 are present unchanged in
both v2.1.88 and v2.1.90. **All 27 are officially documented** at `/en/hooks`. The exact list:

```
PreToolUse, PostToolUse, PostToolUseFailure,
Notification, UserPromptSubmit,
SessionStart, SessionEnd, Stop, StopFailure,
SubagentStart, SubagentStop,
PreCompact, PostCompact,
PermissionRequest, PermissionDenied,
Setup, TeammateIdle,
TaskCreated, TaskCompleted,
Elicitation, ElicitationResult,
ConfigChange,
WorktreeCreate, WorktreeRemove,
InstructionsLoaded, CwdChanged, FileChanged
```

The official hooks page documents all of them, including the less-obvious ones
(ConfigChange, WorktreeCreate/Remove, InstructionsLoaded, CwdChanged, FileChanged,
Elicitation/ElicitationResult, PermissionRequest/Denied).

---

# LESSON 56 -- NEW COMMANDS: /autocompact, /buddy, /powerup, /toggle-memory

## Documentation status

Verified against the official commands page (2026-04-03):

| Command | Docs | Official description |
|---------|------|---------------------|
| `/autocompact` | **Undocumented** | — |
| `/buddy` | **Documented** (base only) | "Interactive pet creature that watches you code" (v2.1.89 changelog). Sub-arguments `[pet\|off\|on]` are undocumented. |
| `/powerup` | **Documented** | "Discover Claude Code features through quick interactive lessons with animated demos" |
| `/toggle-memory` | **Undocumented** | — |

For documented commands, this lesson still adds value via binary-extracted implementation
details (state keys, telemetry events, availability gates, internal type names) not in the
official docs. All details extracted via `diff-versions.sh` + binary analysis.

---

## /autocompact [tokens|reset]

**What it does:** Interactively configures the auto-compact window size — the token
threshold at which context compaction fires. Complements `CLAUDE_CODE_AUTO_COMPACT_WINDOW`
and the `autoCompactWindow` setting.

**Two variants** (interactive and non-interactive):
- `local-jsx`: interactive UI, hidden in non-interactive mode
- `local` (supportsNonInteractive: true): plain-text output, enabled in interactive mode

**Usage:**
```
/autocompact           → show current window size and source
/autocompact 500k      → set to 500,000 tokens
/autocompact 200000    → set to 200,000 tokens (exact)
/autocompact 200       → shorthand for 200k
/autocompact reset     → clear to model default (also: unset, default)
```

**Status display includes:**
- Current token limit and its source: `(from CLAUDE_CODE_AUTO_COMPACT_WINDOW)`,
  `(from settings)`, or `(model default)`
- Whether the value is capped by the model's context window
- Whether auto-compact is currently enabled

**Implementation:**
```
handler: z8_(argument, context)
telemetry: tengu_autocompact_command { action: "reset"|"set", tokens?: number }
settings key: userSettings.autoCompactWindow (number | undefined)
```

**Non-obvious behavior:**
- If `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set in the environment, `/autocompact`
  refuses to make changes: "CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes
  precedence. Unset it to change this setting."
- The effective window is `min(userSetting, modelContextWindow)` — the model's
  window caps the configured value.
- `reset` sets `autoCompactWindow` to `undefined`, which falls back to the model default.

---

## /buddy [pet|off|on]

> **Removed in v2.1.97.** All buddy-specific code was fully deleted, not just hidden.
> See L64 in Chapter 12 for removal details. The implementation below documents the
> feature as it existed through v2.1.96.

**What it does:** Hatches and manages a persistent "coding companion" — a named
character (e.g. a snail) that sits beside the input box and occasionally comments.

**Availability gate (`Qn_()`):** Hidden unless ALL of:
1. First-party auth (claude.ai account — not API key only)
2. Not in headless/non-interactive mode
3. Current date ≥ April 2026 (`getMonth() >= 3 && getFullYear() === 2026`, or year > 2026)

The date gate means `/buddy` was code-complete in v2.1.90 but intentionally dark-launched
to activate automatically starting April 2026.

**Arguments:**
```
/buddy        → hatch a new companion (runs immediately; immediate: true)
/buddy pet    → pet your companion (sets companionPetAt: Date.now() in app state)
/buddy off    → mute companion (sets companionMuted: true — silences speech bubbles)
/buddy on     → unmute companion (sets companionMuted: false)
```

**State keys** (in app state):
- `companionMuted: boolean` — suppresses speech bubbles without removing companion
- `companionPetAt: number` — timestamp of last pet interaction
- `companion` — the companion object, persisted via `N48()`; includes `name` and rarity tier

**Rarity tiers** (from `JE4`):
```javascript
{ common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 }
```
The value appears to be a weight or point value associated with the companion type.

**Companion system prompt injection:**
When a companion exists and is not muted, `Voq()` injects a system message:
```
"# Companion\n\nA small ${type} named ${name} sits beside the user's input box..."
```
This is what drives the companion's personality responses.

**Feature flag string:** `"friend-2026-401"` (internal identifier)

---

## /powerup

**What it does:** Opens an interactive JSX UI that walks the user through short
lessons on Claude Code features. Think of it as an in-app onboarding/discovery tool.

**No arguments.** `type: "local-jsx"` — renders a full React component (`OJ7`).

**UI strings extracted:**
- Title: `"Power-ups"`
- Completion: `"All powered up"` / `"Now go build something."`
- Exit: `"Power-ups closed"`

**Implementation:**
```
component: OJ7 (React, rendered via createElement)
module: TJ7 (loaded lazily on first /powerup invocation)
immediate: false (waits for load)
```

No telemetry event names found for individual lesson completion (may be in `OJ7`
component itself, which is deeply nested JSX).

**Non-obvious behavior:**
- Always available (no `isHidden` or auth gate found).
- The content of the interactive lessons is compiled into the `OJ7` React component;
  it cannot be configured or extended by users.

---

## /toggle-memory

**What it does:** Toggles auto-memory on/off for the current session only. When
disabled, Claude neither reads from nor writes to memory for the remainder of the
session.

**State key:** `R_.memoryToggledOff` (boolean, session-scoped — resets on restart)

**Usage:** `/toggle-memory` (no arguments, non-interactive only: `supportsNonInteractive: false`)

**Response messages:**
```
→ off: "Automemory disabled for this session · this conversation will not write
        or read new memories, and previously-loaded memory content should not
        be referenced. Run /toggle-memory again to re-enable."

→ on:  "Automemory re-enabled · memory content may be referenced and new
        memories can be saved."
```

**Telemetry:** `tengu_memory_toggled { toggled_off: boolean }`

**Non-obvious behavior:**
- `isEnabled: () => false` — the command definition sets `isEnabled` to always
  return `false`. This means the command is **currently disabled** in v2.1.90
  even though it's present in the binary. It is likely unreleased/in development.
  `isHidden` is `false`, so it may appear in `/help` listings but cannot be invoked.
- Session-scoped only: `R_.memoryToggledOff` is in-process state, not persisted.
  Restarting Claude Code re-enables auto-memory regardless.
- Does not affect memory already loaded at session start — the message says
  "previously-loaded memory content should not be referenced" as an instruction
  to the model, not a technical guarantee.
