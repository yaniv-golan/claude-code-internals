Updated: 2026-04-16 | Source: Binary extraction from claude v2.1.107/v2.1.108/v2.1.109

# Chapter 15: Verified New in v2.1.107–v2.1.109 (Source-Confirmed)

> **Provenance:** All details come from direct binary extraction and structured diffing of 
> v2.1.107, v2.1.108, and v2.1.109 bundles against the v2.1.104 baseline. Bundle size increased
> ~1.5MB (90.0MB → 91.3MB). v2.1.109 had no structural changes vs v2.1.108 — likely internal
> bug fixes only.

---

## TABLE OF CONTENTS

72. [Lesson 72 -- /recap: On-Demand Session Recap](#lesson-72----recap-on-demand-session-recap)
73. [Lesson 73 -- Multi-Repo Checkout & Base Refs](#lesson-73----multi-repo-checkout--base-refs)
74. [Lesson 74 -- Byte-Level Stream Watchdog](#lesson-74----byte-level-stream-watchdog)
75. [Lesson 75 -- REPL Mode](#lesson-75----repl-mode)
76. [Lesson 76 -- v2.1.107–v2.1.109 Command & Env Var Changes](#lesson-76----v21107v21109-command--env-var-changes)

---

# LESSON 72 -- /RECAP: ON-DEMAND SESSION RECAP

## Overview

New slash command `/recap` — "Generate a one-line session recap now". This is the **on-demand**
counterpart to the passive away summary system documented in L65. The away summary generates
automatically when the user returns from 5+ minutes away; `/recap` lets users trigger a recap
manually at any time.

Gated behind feature flag `tengu_sedge_lantern` (same as away summary L65).
`supportsNonInteractive: false` — interactive CLI only.

## Settings Toggle

`awaySummaryEnabled` setting toggle (label: "Session recap") appears in `/config` when
`tengu_sedge_lantern` is enabled. Persists via `userSettings.awaySummaryEnabled`. When false,
disables the passive away summary; when absent or true, enabled.

## Environment Variable Override

The `CLAUDE_CODE_ENABLE_AWAY_SUMMARY` env var can force-enable (`true`) or force-disable
(`false`) the away summary, overriding the feature flag. Check order:

1. `CLAUDE_CODE_ENABLE_AWAY_SUMMARY` env var — if explicitly `true`/`false`, overrides everything
2. `tengu_sedge_lantern` feature flag — server-side gate
3. Non-interactive guard — `supportsNonInteractive: false` blocks headless/SDK
4. `awaySummaryEnabled` user setting — final user-level toggle

## Updated Prompt Text (v2.1.107)

```
"The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences,
no markdown. Lead with the overall goal and current task, then the one next action. Skip
root-cause narrative, fix internals, secondary to-dos, and em-dash tangents."
```

Slightly refined from v2.1.101 — now leads with "overall goal and current task" instead of
"name the task".

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `lyH()` | Away summary enabled check (env → flag → setting) |
| `ou_(H)` | Generate away summary (signal-aware) |
| `_Z5` | `/recap` command call handler |
| `qZ5` | `/recap` command registration object |
| `tengu_sedge_lantern` | Feature flag (default: false) |
| `awaySummaryEnabled` | User setting in `/config` toggle |
| `CLAUDE_CODE_ENABLE_AWAY_SUMMARY` | Env var override |

---

# LESSON 73 -- MULTI-REPO CHECKOUT & BASE REFS

## Overview

Two new environment variables enable multi-repo checkout support, designed for **CCR v2**
(Cloud Code Runner) remote agents operating across multiple repositories simultaneously.
These env vars are set by the external CCR orchestrator — they are not intended for local
CLI use.

- `CLAUDE_CODE_REPO_CHECKOUTS` — JSON map of `{label: path}` for multi-repo checkout support
- `CLAUDE_CODE_BASE_REFS` — JSON map of `{label: ref}` for base branch references across repos

## Parsing

Both parsed via `jnq(H)` which `JSON.parse`s the env var and validates string→string map
entries.

## Architecture

| Function | Purpose |
|----------|---------|
| `BE6()` | Returns the checkouts map (memoized); defaults to `[["", cwd()]]` if env var unset |
| `Dnq()` | Returns the base refs map (memoized) |
| `Mnq(H)` | Resolves a file path to its checkout label |
| `Pnq(H)` | Initializes branch watching for all checkout paths |
| `gE6()` | Polls current branches across all checkouts and notifies via callback when branches change |

## CCR v2 Dependency

`Pnq()` — the branch-watching initializer — is only called when `CLAUDE_CODE_USE_CCR_V2`
is enabled. This makes the entire multi-repo checkout feature part of the CCR v2 remote
infrastructure, not standalone local functionality.

## Branch Monitoring

When active, `Pnq()` sets up `fs.watchFile` on each checkout's `.git/HEAD` file with a
**1-second polling interval**. When a branch change is detected, `gE6()` reports the
current branches to the CCR server as `external_metadata.current_branches`. This data
flows to the remote session management layer — it is NOT displayed in the local CLI UI.

## Base Ref Resolution (Diff Generation)

`TQ1()` resolves the merge-base ref for Write/Edit tool diffs using a 3-tier fallback:

1. **Per-repo ref** — from `CLAUDE_CODE_BASE_REFS` map (keyed by checkout label)
2. **Global ref** — from `CLAUDE_CODE_BASE_REF` (singular, pre-existing env var)
3. **Auto-detected** — default branch via `git remote show origin`

This enables the remote agent to generate accurate diffs even when operating across
multiple repos with different base branches.

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `BE6()` | Get repo checkouts map (memoized) |
| `Dnq()` | Get base refs map (memoized) |
| `Mnq(H)` | Resolve file path → checkout label |
| `Pnq(H)` | Init branch watching for all checkouts (CCR v2 only) |
| `gE6()` | Poll and notify on branch changes |
| `TQ1()` | Merge-base resolution (3-tier fallback) |
| `CLAUDE_CODE_USE_CCR_V2` | Gate for branch-watching activation |

---

# LESSON 74 -- BYTE-LEVEL STREAM WATCHDOG

## Overview

`CLAUDE_ENABLE_BYTE_WATCHDOG` env var controls the byte-level stream watchdog. This is the
byte-level counterpart to the event-level stream watchdog documented in L70.

Feature flag: `tengu_stream_watchdog_default_on` (default: **true** — watchdog is on by default).

## Enablement Logic

Check logic in `Dv4()`:

1. If env var is explicitly `false` → disabled
2. If env var is explicitly `true` → enabled
3. Otherwise → defaults to feature flag value

## Relationship to Event Watchdog (L70)

The byte watchdog operates at the transport layer: it detects when no raw bytes are received
from the HTTP response stream, independent of whether complete SSE events have been parsed.
The event watchdog (L70) fires when bytes are flowing but no complete events are being formed.

The `tier` field in `tengu_streaming_idle_timeout` telemetry (documented in L70) distinguishes:

| `tier` value | Watchdog |
|-------------|----------|
| `"byte"` | This watchdog (byte-level) |
| `"event"` | The event-level watchdog (L70) |

## Implementation

When `Dv4()` returns `true`, the fetch wrapper `Mv4(H, _)` wraps the response body through
a `TransformStream` that sets a per-chunk timeout — if no bytes arrive within the configured
window, the stream is errored with a timeout. The `tier` field in telemetry events
distinguishes which watchdog fired (`"byte"` vs `"event"`), enabling separate monitoring of
transport-layer vs protocol-layer stalls.

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `Dv4()` | Byte watchdog enabled check |
| `Mv4(H, _)` | Fetch wrapper that applies byte-level timeout |
| `tengu_stream_watchdog_default_on` | Feature flag (default: true) |
| `CLAUDE_ENABLE_BYTE_WATCHDOG` | Env var override |

---

# LESSON 75 -- REPL MODE

## Overview

`CLAUDE_CODE_REPL` env var enables/disables a new "REPL mode". `CLAUDE_REPL_VARIANT` env var
selects which REPL variant to use (read via `wnq()`). REPL mode creates a **sealed VM
context** where the model can execute JavaScript/TypeScript code directly, with access to
built-in helper shortcuts and a restricted tool set.

Feature flag: `tengu_slate_harbor` (default: **false**).

## Enablement Logic

`Wj()` enablement check:

1. Requires `K6H()` — this is `isRunningWithBun`, which always returns `true` in the Bun SEA
   binary (effectively a no-op gate in production)
2. If env var is explicitly `false` → disabled
3. If env var is explicitly `true` → enabled
4. Otherwise → only enabled for `cli`/`remote` entrypoints with the feature flag

## Constants

| Symbol | Value | Purpose |
|--------|-------|---------|
| `j$` | `"REPL"` | REPL mode constant |
| `CrH` | `"main"` | Default REPL variant |

## VM Context & Helper Shortcuts

REPL mode creates a sealed VM context with custom tool wrappers and helper shortcuts that
provide a Unix-like scripting feel inside JavaScript:

| Shortcut | Maps to |
|----------|---------|
| `sh(cmd)` | Bash tool execution |
| `cat(path)` | Read tool |
| `rg(pattern, path)` | Grep tool (content search) |
| `rgf(pattern)` | Glob tool (file search) |
| `gl(pattern)` | Glob tool (alias) |
| `put(path, content)` | Write tool |
| `gh(args)` | GitHub CLI wrapper |
| `chdir(path)` | Change working directory |
| `log(...)` | Console output |
| `str(obj)` | JSON.stringify helper |
| `o(obj)` | Object inspection |
| `REPO` | Current repository root |

Additionally, model sampling functions are available: `haiku()`, `opus()`, `sonnet()` —
allowing REPL code to invoke Claude models directly.

## Code Transpilation

Code submitted to the REPL is transpiled via `Bun.Transpiler({loader: "js", replMode: true})`.
`import` and `require` statements are **blocked** — REPL code runs in an isolated context
without access to Node.js/Bun module loading.

## Tool Restriction Mechanism

The `OkH` set restricts which tools are available:

```javascript
OkH = new Set([Read, Write, Edit, Bash, NotebookEdit])
```

This restriction works by removing OkH tools from the top-level tool list but **re-adding
them inside the REPL VM context** via `G47()` / `U4H()`. The model interacts with tools
through the VM helper functions rather than direct tool calls.

## Output Style Variants

`CLAUDE_REPL_VARIANT` supports multiple output styles:

| Variant | Behavior |
|---------|----------|
| `"default"` / `"main"` | Standard output |
| `"Explanatory"` | More verbose, explanation-oriented |
| `"Learning"` | Teaching-oriented output |
| custom string | Passed through as custom style label |

The variant affects query source labeling and output formatting.

## State & Session Management

- **State persists** across calls within a session — variables and definitions survive
  between REPL executions
- **Replay log** — a log of executed code is maintained for session hydration
- **Three hydration modes:** `"fresh"` (new session), `"resume"` (restore from transcript),
  `"fork"` (subagent clone)
- **Transparent wrapper** — REPL tool use blocks are invisible in the conversation transcript
- **Compaction-aware** — warns when VM state is cleared due to context compaction

## Execution Limits

- Default timeout: **30 seconds** per execution
- Maximum timeout: **600 seconds**
- Inner tool calls (via helper shortcuts) **pause the timer** — only raw JS execution counts

## Query Source Labeling

Queries in REPL mode use `"repl_main_thread"` as the source. This is significant because
`OS9()` — the prompt suggestion generator — only fires for
`querySource === "repl_main_thread"`, tying prompt suggestions to REPL usage.

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `Wj()` | REPL mode enabled check |
| `K6H()` | `isRunningWithBun` precondition (always true in SEA binary) |
| `wnq()` | Get REPL variant from env |
| `j$` | REPL mode constant (`"REPL"`) |
| `CrH` | Default REPL variant (`"main"`) |
| `OkH` | Set of tools allowed in REPL mode |
| `G47()` | Re-inject tools inside REPL VM context |
| `U4H()` | REPL tool wrapper injection |
| `OS9()` | Prompt suggestion generator (REPL-only) |
| `tengu_slate_harbor` | Feature flag (default: false) |

---

# LESSON 76 -- V2.1.107–V2.1.109 COMMAND & ENV VAR CHANGES

This catch-all lesson documents all other surface-level changes.

## Removed Commands

| Command | Status | Notes |
|---------|--------|-------|
| `/think-back` | **Removed** (v2.1.107) | Completely gone from the binary — not just disabled |
| `/thinkback-play` | **Removed** (v2.1.107) | Completely gone from the binary |

## Changed Commands

| Command | Old Description | New Description | Version |
|---------|----------------|-----------------|---------|
| `/clear` | "Clear conversation history and free up context" | "Start fresh: discard the current conversation and context" | v2.1.108 |

## New API Beta Strings

| Beta String | Version | Purpose |
|-------------|---------|---------|
| `managed-agents-2026-04-01` | v2.1.107 | Managed Agents API (see Embedded Documentation below) |

## Managed Agents Embedded Documentation

The v2.1.107 bundle embeds **33 documentation files** (~324KB of markdown) for the
`claude-api` built-in skill. Of these, **11 files (~117KB)** are specific to the Managed
Agents API:

| Embedded File | Content |
|---------------|---------|
| `managed-agents-overview` | High-level architecture and concepts |
| `managed-agents-core` | Core API: agents, sessions, turns |
| `managed-agents-environments` | Environment provisioning and lifecycle |
| `managed-agents-events` | Event streaming and webhooks |
| `managed-agents-tools` | Tool definitions and registration |
| `managed-agents-client-patterns` | Client-side patterns (polling, reconnection) |
| `managed-agents-onboarding` | Getting started guide |
| `managed-agents-api-reference` | Full REST API reference |
| SDK: Python | Python SDK usage |
| SDK: TypeScript | TypeScript SDK usage |
| SDK: curl | curl examples |

### Language Detection

`ZU5()` detects the project language from file markers:

| Marker | Language |
|--------|----------|
| `.py`, `requirements.txt` | Python |
| `.ts`, `package.json` | TypeScript |
| `.go`, `go.mod` | Go |
| `.java`, `pom.xml` | Java |
| `.rb`, `Gemfile` | Ruby |
| `.php`, `composer.json` | PHP |
| `.cs`, `.csproj` | C# |

Go, Java, Ruby, PHP, and C# have **no managed-agents specific files** — the skill instructs
the model to translate from the base SDK patterns (Python/TypeScript).

### Template Processing

Embedded docs use template variables (e.g., `{{OPUS_ID}}`) substituted at load time from
`SKILL_MODEL_VARS`. HTML comments are stripped during processing.

### Gating

Disabled by `CLAUDE_CODE_DISABLE_CLAUDE_API_SKILL` env var. The bundle size increase from
v2.1.104 to v2.1.107 (+2.9MB) is largely attributable to these embedded documentation
strings.

## New Env Vars (v2.1.108)

| Env Var | Purpose |
|---------|---------|
| `CLAUDE_API_SKILL_DESCRIPTION` | Exported description string for the built-in claude-api skill |
| `CLAUDE_CODE_REPL` | Enable/disable REPL mode (see L75) |
| `CLAUDE_REPL_VARIANT` | REPL variant selection (see L75) |
| `CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME` | Internal team name passed to spawned Claude subprocesses via env |

## New Env Vars (v2.1.107)

| Env Var | Purpose |
|---------|---------|
| `CLAUDE_CODE_ENABLE_AWAY_SUMMARY` | Force enable/disable away summary (see L72) |
| `CLAUDE_ENABLE_BYTE_WATCHDOG` | Enable/disable byte-level stream watchdog (see L74) |
| `CLAUDE_CODE_REPO_CHECKOUTS` | Multi-repo checkout paths JSON map (see L73) |
| `CLAUDE_CODE_BASE_REFS` | Multi-repo base branch refs JSON map (see L73) |
| `CLAUDE_CODE_RESUME_FROM_SESSION` | Session ID to hydrate from when resuming remote/CCR sessions |
| `CLAUDE_CODE_ULTRAREVIEW_PREFLIGHT_FIXTURE` | Test fixture for `/ultrareview` preflight checks; if set, its JSON value overrides the remote preflight result |

## New Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `tengu_stream_watchdog_default_on` | `true` | Byte-level stream watchdog (L74) |
| `tengu_slate_harbor` | `false` | REPL mode (L75) |

Note: `tengu_sedge_lantern` (away summary) and `tengu_chomp_inflection` (prompt suggestions)
already existed but now have user-visible settings toggles in `/config` when enabled.

## Settings Toggles

| Setting ID | Label | Feature Flag | Version |
|-----------|-------|-------------|---------|
| `awaySummaryEnabled` | "Session recap" | `tengu_sedge_lantern` | v2.1.107 |
| `promptSuggestionEnabled` | "Prompt suggestions" | `tengu_chomp_inflection` | pre-existing (already in v2.1.104) |

## Rate Limit Upgrade Paths

### Unified Rate Limit Headers

The API response now includes a comprehensive set of unified rate limit headers:

| Header | Purpose |
|--------|---------|
| `anthropic-ratelimit-unified-status` | Current rate limit status |
| `anthropic-ratelimit-unified-reset` | Reset timestamp |
| `anthropic-ratelimit-unified-upgrade-paths` | Comma-separated upgrade options |
| `anthropic-ratelimit-unified-representative-claim` | Current usage claim |
| `anthropic-ratelimit-unified-overage-status` | Overage tier status |
| `anthropic-ratelimit-unified-overage-reset` | Overage reset timestamp |
| `anthropic-ratelimit-unified-overage-disabled-reason` | Why overage is unavailable |
| `anthropic-ratelimit-unified-fallback` | Fallback indicator |

Parsed by `HS9()` into a structured rate limit state object.

### Three-Layer Suggestion System

1. **Server header hints** — `upgrade-paths` header returns options like `upgrade_plan`,
   `overage` directly from the API
2. **Client lever hints** — `oV9()` decision tree generates inline notifications suggesting
   model downgrade or effort reduction (e.g., "try /model sonnet · ~2x runway")
3. **Interactive options menu** — auto-opens on rate limit rejection, presenting actionable
   options to the user

### Client Lever Hints (`oV9()` Decision Tree)

Gated by `tengu_garnet_plover` (default: false). Only activates for:
- **Pro plan** users
- **`seven_day`** rate limit window only

Suggestions include:
- Model downgrade: opus → sonnet (~2x runway)
- Effort reduction: high/max → medium

### Early Warning Thresholds

Rate limit warnings fire before actual rejection, based on utilization vs elapsed time:

| Window | Utilization | Elapsed |
|--------|-------------|---------|
| 5-hour (`daily`) | 90% | 72% |
| 7-day (`seven_day`) | 75% | 60% |
| 7-day (`seven_day`) | 50% | 35% |
| 7-day (`seven_day`) | 25% | 15% |

### Feature Flags

| Flag | Purpose |
|------|---------|
| `tengu_garnet_plover` | Client lever hints (pro-only, seven_day only) |
| `tengu_jade_anvil_4` | Reorder options in the interactive menu |
| `tengu_coral_beacon` | Team plan upgrade option in menu |

## Bundle Size

| Version | Bundle size | Delta from v2.1.104 |
|---------|-------------|---------------------|
| v2.1.104 | 89,801,578 bytes (87,697 KB) | -- |
| v2.1.107 | 92,697,563 bytes (90,524 KB) | +2.9 MB (+3.2%) |
| v2.1.108 | 91,334,545 bytes (89,194 KB) | +1.5 MB (+1.7%) |
| v2.1.109 | 91,338,496 bytes (89,198 KB) | +1.5 MB (+1.7%) |

Note: v2.1.107 was larger than v2.1.108/v2.1.109 — the managed-agents SDK documentation adds
significant embedded string content.
