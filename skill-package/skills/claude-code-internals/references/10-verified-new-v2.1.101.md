Updated: 2026-04-11 | Source: Binary extraction from claude v2.1.101

# Chapter 13: Verified New in v2.1.101 (Source-Confirmed)

> **Provenance:** All details come from direct binary extraction of the v2.1.101 bundle
> (2026-04-11) and diffing against v2.1.100. Bundle size increased ~670KB (89.4MB to 90.0MB).
>
> **No changes** in hook event types (19 unchanged) or API beta strings (28 unchanged).

---

## TABLE OF CONTENTS

65. [Lesson 65 -- Proactive Recap: Away Summary System](#lesson-65----proactive-recap-away-summary-system)
66. [Lesson 66 -- CA Certificate Store Configuration](#lesson-66----ca-certificate-store-configuration)
67. [Lesson 67 -- Dynamic Loop Pacing & Cloud-First Offering](#lesson-67----dynamic-loop-pacing--cloud-first-offering)
68. [Lesson 68 -- v2.1.101 Command & Env Var Changes](#lesson-68----v21101-command--env-var-changes)

---

# LESSON 65 -- PROACTIVE RECAP: AWAY SUMMARY SYSTEM

## Overview

When the user switches away from the terminal for 5+ minutes, Claude generates a brief
recap of the current task state and injects it as a system message. The recap appears as
`※ recap: <text>` when the user returns. **Entirely new in v2.1.101** -- the `away_summary`
message subtype and its rendering code were pre-wired in v2.1.100, but all generation logic
is new.

Gated behind feature flag `tengu_sedge_lantern` (default: `false`).

## Architecture

The system is implemented as a React hook `nr7(messages, setMessages, isBusy)` inside the
main conversation component. It uses terminal focus/blur events, a 5-minute timer, and a
constrained forked API call.

### Focus Detection

Terminal focus state is tracked via xterm escape sequences. State values: `"unknown"`,
`"focused"`, `"blurred"`. Changes are notified via `KoH()` callback registration.

### Trigger Flow

1. Terminal loses focus (blur event)
2. 5-minute timer starts (`yx5 = 300000`)
3. If terminal refocuses before timer fires: cancel timer, abort any in-flight API call
4. Timer fires:
   - If system is busy (processing a query): set deferred flag (`A.current = true`), wait
   - When busy→idle transition occurs and deferred flag is set: fire immediately
   - Guard `Cx5()`: conversation must meet minimum thresholds
   - Guard `Ex5()`: last substantive message must not already be an `away_summary`
5. Call `Qr7(signal)` to generate the summary

### Conversation Thresholds

| Gate | Threshold | Purpose |
|------|-----------|---------|
| `Vx5` | 3 | Minimum total real user messages before first summary |
| `Sx5` | 2 | Minimum real user messages since last `away_summary` |

"Real user messages" are counted by `ir7()`: `type === "user"` AND not `isMeta`, not
`isCompactSummary`, not `isVirtual`.

`Ex5()` walks backwards from the end of messages (skipping trailing `api_metrics`) to check
if the most recent substantive message is already an `away_summary`. This prevents duplicate
summaries.

## Summary Generation (`Qr7`)

Uses `wW()` (the main query function) with a forked API call. Key constraints:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `maxTurns` | 1 | Single turn only |
| `canUseTool` | All denied | No tool access: "Away summary cannot use tools" |
| `skipCacheWrite` | `true` | Don't pollute the prompt cache |
| `skipTranscript` | `true` | Don't appear in session transcript logs |
| `querySource` | `"away_summary"` | Analytics tracking |
| `forkLabel` | `"away_summary"` | Fork identification |

Uses cached `CacheSafeParams` (via `ejH()`) for full conversation context -- the summary
has access to the system prompt, user context, and full message history without re-fetching.

### The Prompt

```
"The user stepped away and is coming back. Under 40 words, 1-2 plain sentences -- no
markdown. Name the task, then the one next action. They remember the session -- skip
root-cause narrative, fix internals, secondary to-dos, and em-dash tangents."
```

Tightly crafted to avoid verbosity. Sent as a single user message via `r_({ content: vx5 })`.

### Result Extraction

`Nx5()` extracts all text content blocks from assistant messages, concatenates, and trims.
Only `type: "text"` blocks are kept. API error messages are filtered out.

## Message Format

```javascript
{
  type: "system",
  subtype: "away_summary",
  content: "<recap text>",
  timestamp: new Date().toISOString(),
  uuid: randomUUID(),
  isMeta: false
}
```

Injected at the end of the messages array. If the last message is `api_metrics`, the summary
is inserted just before it (preserving metrics at the tail).

## Rendering

```
※ recap: <dim italic text>
```

- Icon: `※` (reference mark symbol, `\u203B`)
- Label: `recap:` in bold dim
- Content: dim italic
- Not selectable for copy (returns `false` in the renderable check)

## Cancellation

Three levels:

1. **Focus restore**: Clears timeout + aborts AbortController + resets deferred flag
2. **New summary request**: Aborts any prior in-flight request before creating new controller
3. **Component unmount**: Removes focus listener, clears timeout, aborts controller, nulls refs

Inside `Qr7`: the abort signal is wired from the outer controller to an inner `AbortController`.
After `await wW(...)`, checks `signal.aborted` before proceeding. Catch block also checks abort
to avoid logging errors on intentional cancellation.

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `nr7()` | React hook: timer management, focus tracking, injection |
| `Cx5()` | "Enough conversation" guard (checks message count thresholds) |
| `Ex5()` | "Already summarized" guard (checks if last message is away_summary) |
| `ir7()` | Real user message predicate (excludes meta/compact/virtual) |
| `Qr7()` | Async summary generator (constrained API call) |
| `Lf7()` | Creates `{type: "system", subtype: "away_summary"}` message object |
| `Nx5()` | Extracts text from assistant response |
| `vx5` | The prompt text string |
| `yx5` | Timer constant: `300000` (5 minutes) |
| `Vx5` | Threshold: 3 (min total user messages) |
| `Sx5` | Threshold: 2 (min user messages since last summary) |
| `ejH()` | Retrieves cached CacheSafeParams for forked call |

---

# LESSON 66 -- CA CERTIFICATE STORE CONFIGURATION

## Overview

`CLAUDE_CODE_CERT_STORE` is a new environment variable that gives enterprise users explicit
control over which CA certificate stores Claude Code uses for TLS connections. Previously only
the `--use-system-ca` / `--use-openssl-ca` CLI flags (checked via `NODE_OPTIONS`) were available.

**New in v2.1.101.** Replaces the `applyExtraCACertsFromConfig()` function that no longer exists.

## Configuration

### Environment Variable

```bash
# Use both bundled and system certs (default)
export CLAUDE_CODE_CERT_STORE="bundled,system"

# System certs only (e.g. for corporate proxy with custom CA)
export CLAUDE_CODE_CERT_STORE="system"

# Bundled Node.js root certs only
export CLAUDE_CODE_CERT_STORE="bundled"
```

Values are comma-separated, case-insensitive, trimmed. Unrecognized values are warned and
ignored. If the env var is set but yields zero valid entries, falls back to the default.

### Resolution Priority

1. `CLAUDE_CODE_CERT_STORE` env var (if set, parsed by `OCK()`)
2. `NODE_OPTIONS` flags `--use-system-ca` or `--use-openssl-ca` (if present → `["system"]`)
3. Default: `["bundled", "system"]` (both stores)

## Certificate Loading Architecture

### Parser: `OCK()`

```javascript
function OCK() {
  let H = process.env.CLAUDE_CODE_CERT_STORE;
  if (H) {
    let _ = [];
    for (let q of H.split(",")) {
      let K = q.trim().toLowerCase();
      if (K === "bundled" || K === "system") {
        if (!_.includes(K)) _.push(K);
      } else if (K)
        N(`CA certs: unrecognized CLAUDE_CODE_CERT_STORE source '${K}', ignoring`,
          { level: "warn" });
    }
    return _.length > 0 ? _ : Lx8;  // Lx8 = ["bundled", "system"]
  }
  if (v2H("--use-system-ca") || v2H("--use-openssl-ca"))
    return ["system"];
  return Lx8;
}
```

`v2H()` checks `NODE_OPTIONS` for a specific flag by splitting on whitespace.

### Loader: `fm` (memoized)

The core cert loading function, wrapped in lodash `memoize` (runs once, result cached):

1. Call `OCK()` to resolve store list
2. Read `NODE_EXTRA_CA_CERTS` path
3. **Early exit on Node.js** (not Bun): if no extra certs and no explicit `CLAUDE_CODE_CERT_STORE`,
   return `undefined` (rely on Node's default cert handling)
4. Load **bundled** certs: `tls.rootCertificates` array
5. Load **system** certs: `tls.getCACertificates("system")` (Bun-specific API; unavailable on Node)
6. **Fallback**: if system fails/empty and bundled wasn't requested, load `tls.rootCertificates` anyway
7. Append `NODE_EXTRA_CA_CERTS` file contents if present
8. Deduplicate: `[...new Set(arr)]`
9. Return combined cert array

### Application: Per-Connection, Effectively Global

```
CLAUDE_CODE_CERT_STORE / --use-system-ca
          │
          ▼
      OCK() → store list ["bundled","system"]
          │
          ▼
      fm() (memoized) → cert array + NODE_EXTRA_CA_CERTS
          │
    ┌─────┼──────────┐
    ▼     ▼          ▼
  MN()  CD_()      ED_()
  (WS)  (undici)   (axios https.Agent)
    │     │          │
    ▼     ▼          ▼
  per-conn  setGlobal-  axios.defaults
  tls opts  Dispatcher  .httpsAgent
```

- `MN()`: returns `{ca: certs}` merged with mTLS client cert/key for WebSocket connections (10 call sites)
- `CD_()`: creates an `undici.Agent` with custom certs (Node) or `{tls: opts}` (Bun)
- `ED_()`: memoized `https.Agent` with `keepAlive: true` for axios
- `tdH()`: applies agents globally at init -- sets `axios.defaults.httpsAgent` and `undici.setGlobalDispatcher()`

### Cache Invalidation

`Zx8()` clears the `fm` cache. Called by `fi()` (settings reload handler) which also clears:
- mTLS cache (`uC.cache.clear()`, `ED_.cache.clear()`)
- Proxy agent cache (`yJ6()`)
- Global agent configuration (`tdH()`)

This means env var or settings changes take effect **without restart**.

## Logging

Extensive diagnostic logging via `N()` (internal logger):

| Message | Level |
|---------|-------|
| `CA certs: stores=..., extraCertsPath=...` | info |
| `CA certs: Loaded N bundled root certificates` | info |
| `CA certs: Loaded N system CA certificates` | info |
| `CA certs: system store returned empty/unavailable` | info |
| `CA certs: Failed to load system CA certificates: ...` | error |
| `CA certs: Appended extra certificates from NODE_EXTRA_CA_CERTS (...)` | info |
| `CA certs: Failed to read NODE_EXTRA_CA_CERTS file: ...` | error |
| `CA certs: unrecognized CLAUDE_CODE_CERT_STORE source '...', ignoring` | warn |
| `Cleared CA certificates cache` | info |

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `OCK()` | Parse `CLAUDE_CODE_CERT_STORE`, check CLI flags, return store list |
| `Lx8` | Default store list: `["bundled", "system"]` |
| `fm` | Memoized cert loader (core function) |
| `Zx8()` | Clear `fm` cache (called on settings reload) |
| `v2H()` | Check for flags in `NODE_OPTIONS` |
| `MN()` | Merge mTLS + CA certs for WebSocket/TLS options |
| `CD_()` | Merge mTLS + CA certs for undici Agent / Bun tls |
| `ED_()` | Memoized `https.Agent` with custom certs for axios |
| `tdH()` | Apply agents globally (axios defaults + undici global dispatcher) |
| `fi()` | Settings reload: clears all caches, reconfigures agents |
| `R7()` | Array deduplication (`[...new Set(H)]`) |

---

# LESSON 67 -- DYNAMIC LOOP PACING & CLOUD-FIRST OFFERING

## Overview

v2.1.101 introduces two major enhancements to the loop system:

1. **Dynamic loop pacing** (`tengu_kairos_loop_dynamic`): the model picks its own wakeup
   delay via `ScheduleWakeup`, with clamping, aging, and cache-aware scheduling
2. **Cloud-first offering** (`tengu_cinder_almanac`): for long-interval or daily loops,
   prompts the user to use a cloud schedule instead of a local session loop

Both are gated behind feature flags (default: `false`).

## Dynamic Loop Pacing

### Feature Flag

`tengu_kairos_loop_dynamic` (default: `false`). Checked via `Bs4()` / `isLoopDynamicEnabled()`.

**Entirely new in v2.1.101.** The `loopChainStartedAt` field existed in R_ state in v2.1.100,
but all scheduling logic is new.

### Constants

| Symbol | Value | Purpose |
|--------|-------|---------|
| `qNH` | 60 | `MIN_LOOP_DELAY_SECONDS` |
| `YsH` | 3600 | `MAX_LOOP_DELAY_SECONDS` (1 hour) |
| `wsH` | 300000 | 5-minute threshold for cache lead optimization |

### Configuration (`tengu_kairos_cron_config`)

Defaults (overridable via feature flag with Zod validation):

| Field | Default | Max | Purpose |
|-------|---------|-----|---------|
| `recurringFrac` | 0.5 | -- | Jitter fraction |
| `recurringCapMs` | 1,800,000 | -- | 30-min jitter cap |
| `recurringMaxAgeMs` | 604,800,000 | 2,592,000,000 | 7-day default, 30-day max; auto-stop threshold |
| `cacheLeadMs` | 15,000 | 60,000 | Cache lead optimization window |

### `scheduleLoopWakeup` (`Fs4(delaySeconds, prompt, reason)`)

Core scheduling function. Called by the `ScheduleWakeup` tool.

**Flow:**

1. Clean up prior loop crons for same prompt (`ds4()` -- filters `kind: "loop"` tasks)
2. Detect stale chain: if `lastScheduledFor` is older than `MAX_LOOP_DELAY` (3600s) ago, reset
3. Determine chain start time: reuse existing `startedAt` or set to now
4. **Age check**: if `now - startedAt >= recurringMaxAgeMs` (default 7 days):
   - Mark as `agedOut` in state
   - Fire `tengu_loop_dynamic_wakeup_aged_out` with `loop_age_ms` and `max_age_ms`
   - Return `null` (stop scheduling)
5. Clamp delay via `gs4()` (see below)
6. Generate cron expression from target time: `{minutes} {hours} * * *`
7. Register cron task via `PpH()` with random hex ID from `U39()`
8. Update loop state: `{startedAt, lastScheduledFor}`
9. Enable scheduled tasks: `cOH(true)`
10. Fire `tengu_loop_dynamic_wakeup_scheduled` telemetry

### Delay Clamping (`gs4`)

```javascript
// Handle edge cases
NaN → MIN (60s), +Infinity → MAX (3600s), -Infinity → MIN (60s)
// Otherwise: round and clamp to [60, 3600]
Math.max(60, Math.min(3600, Math.round(delay)))
```

After clamping, snap to next minute boundary (`Us4()`) since cron only fires on whole minutes.

### Cache Lead Optimization

For delays <= 5 minutes: try shifting the target earlier by whole minutes to stay within
the prompt cache window (5-minute TTL). The `cacheLeadMs` (default 15s) controls how close
to the cache boundary the wakeup can be placed. Target is shifted back by 60s increments as
long as it stays >= `MIN_LOOP_DELAY` from now.

This is a practical optimization: a wakeup at 4:45 that hits a warm cache is cheaper than
one at 5:15 that misses it.

### Loop State Management

```javascript
_96(prompt) → { startedAt, lastScheduledFor, agedOut? }  // get
fT_(prompt, state)                                        // set
W5K(prompt)                                               // delete
```

Stored in `R_.loopChainStartedAt`, keyed by prompt string.

### `makeLoopShortId` (`U39`)

```javascript
Math.floor(Math.random() * 4294967295)  // 0 to 2^32-1
  .toString(16).padStart(8, "0")
```

Random 8-character hex string used as cron task ID.

## Cloud-First Offering

### Feature Flag

`tengu_cinder_almanac` (default: `false`). **New in v2.1.101.** Layered on top of pre-existing
`tengu_surreal_dali` (remote sessions flag, present since v2.1.100).

### Preconditions (all must be true)

1. `CLAUDE_CODE_REMOTE` is NOT set (not already running in cloud)
2. `tengu_surreal_dali` is enabled (remote sessions feature flag)
3. `allow_remote_sessions` permission is granted
4. `tengu_cinder_almanac` is enabled
5. No existing allowed channels (`ew().length === 0`)

### Trigger Conditions

Either of:
- Parsed interval >= 60 minutes
- Daily phrasing: "every morning", "daily", "every day", "each night", "every weekday"

### Prompt Injection

The `JHK()` function generates a prompt block that is interpolated into the `/loop` skill
template. It instructs the model to:

1. Call `AskUserQuestion` with header "Schedule" and two options:
   - **"Cloud schedule (recommended)"**: "Runs in Anthropic's cloud even after you close this session"
   - **"This session only"**: "Runs in this terminal until you exit"
2. If **Cloud schedule**: invoke `Skill({skill: "schedule", args: "<original input>"})`.
   Do NOT create a local cron. Stop completely.
3. If **This session only** + interval trigger: continue with local loop at that interval.
4. If **This session only** + daily phrasing only (no numeric interval): explain that a daily
   loop won't fire before session closes. Suggest cloud schedule or shorter interval. Stop.

### Footer Annotation

When `tengu_cinder_almanac` is enabled and loops already exist, `/loop` appends:
*"Runs until you close this session. For durable cloud-based loops, use /schedule"*

## `/loops` Management UI (Disabled)

A new JSX-based slash command for managing recurring loops and stop-hooks. Registered as
`type: "local-jsx"` with `isEnabled: () => false` (currently disabled).

### Registration

```javascript
{ type: "local-jsx", name: "loops",
  description: "List, create, and delete recurring loops and stop-hooks",
  immediate: true, isEnabled: () => false }
```

### UI Component (`gS7`)

Interactive React/Ink component with two views:

**List mode:**
- Shows active crons (`{human interval} . {prompt (50 chars)} . {id}`) and stop-hooks
  (`until {condition (50 chars)} . stop-hook`)
- Keys: `d` delete, `n` new, `up/down` navigate, `escape` cancel
- Cron delete via `Ga([id])`, stop-hook delete via `QKH()`

**Create mode:**
- Radio toggle: `(o) every` (interval loop) or `(o) until` (stop condition)
- "every" mode: interval field (default `"10m"`, validated via `EX5 = /^(\d+)([smhd])$/i`)
  + prompt field
- "until" mode: condition text field
- Only one global prompt stop-hook at a time (creating clears existing ones first)
- Keys: `tab` switch mode/field, `up/down` cycle fields, `enter` submit, `escape` back

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `Bs4()` | `isLoopDynamicEnabled()` -- checks `tengu_kairos_loop_dynamic` |
| `Fs4()` | `scheduleLoopWakeup(delay, prompt, reason)` |
| `gs4()` | Delay clamping + minute snapping + cache lead optimization |
| `Us4()` | Snap timestamp to next minute boundary |
| `U39()` | `makeLoopShortId()` -- random 8-char hex |
| `_96()` | Get loop chain state by prompt |
| `fT_()` | Set loop chain state |
| `ds4()` | Clean up prior loop crons for same prompt |
| `JHK()` | Cloud-first prompt injection function |
| `iF5()` | `/loop` skill registration |
| `bX5()` | `/loops` command entry function |
| `gS7` | `/loops` React/Ink UI component |
| `CX5()` | Interval validation for `/loops` create mode |

---

# LESSON 68 -- V2.1.101 COMMAND & ENV VAR CHANGES

## New Commands

### /update (hidden, disabled)

In-place self-update that relaunches with `--resume <sessionId>` to continue the conversation.

```javascript
{ type: "local", name: "update",
  description: "Switch to the latest version (conversation continues)",
  supportsNonInteractive: false, isEnabled: () => false, isHidden: true }
```

**Important: no actual update/install step.** The command resolves the `claude` binary on
PATH (via `wI7()`: try `which claude` first, fall back to current process) and relaunches it
with the current session ID. The assumption is a newer binary is already available.

**Execution flow (`W05`):**
1. Resolve launcher via `wI7()` -- PATH lookup, then fallback to `process.execPath`
2. Get session ID from `R_.sessionId`
3. Set "exiting" flag, keep event loop alive (`setInterval(() => {}, 2^30)`)
4. Flush telemetry (2s timeout), restore terminal, run cleanup handlers (2s timeout)
5. Print: `"Switching from {VERSION} to latest… conversation will continue"`
6. Spawn: `claude --resume <sessionId>` with `stdio: "inherit"`
7. Strip parent signal handlers, wait for child exit, mirror exit code

**Contrast with CLI `claude update`:** The CLI command (`Cd5`) is a full updater that detects
install type (npm, native, homebrew, winget, apk), checks npm registry for latest version,
and runs the appropriate install. `/update` is a simpler "relaunch" mechanism that may
eventually integrate with the full updater.

### /loops (disabled)

See Lesson 67 for details.

## New Environment Variables

### CLAUDE_CODE_CERT_STORE

See Lesson 66 for full deep dive.

### CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH

Signals that the SDK caller has provided an OAuth token refresh callback. When set (and the
entrypoint matches known SDK entrypoints), enables `requestOAuthTokenRefresh()`.

**Refresh flow:**
1. API returns 401
2. If env var is truthy AND entrypoint matches SDK entrypoints → invoke refresh callback
3. Callback (`getOAuthToken`) returns a new token from the parent SDK process
4. If new token differs from expired one → replace `process.env.CLAUDE_CODE_OAUTH_TOKEN`, retry
5. If callback returns `null` → log debug: "no token available"
6. If callback returns same expired token → log error: "returned the same expired token"
7. Success fires `tengu_oauth_401_sdk_callback_refreshed`

## New Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `tengu_sedge_lantern` | `false` | Proactive recap on terminal refocus (L65) |
| `tengu_cinder_almanac` | `false` | Cloud-first offering in `/loop` (L67) |
| `tengu_kairos_loop_dynamic` | `false` | Dynamic loop pacing via `ScheduleWakeup` (L67) |
| `tengu_mcp_directory_visibility` | `["published"]` | MCP registry visibility filter |
| `tengu_mcp_directory_bff` | `false` | MCP registry BFF endpoint switch |

## MCP Registry Changes

Two new feature flags control MCP server registry fetching:

- `tengu_mcp_directory_visibility`: array of visibility strings (default `["published"]`)
  used as query parameters when fetching from the registry
- `tengu_mcp_directory_bff`: when `true`, uses a BFF (backend-for-frontend) endpoint instead
  of the legacy paginated API. Registry URLs are loaded into `anH` (a `Set`) at startup and
  used to identify "official" MCP servers.

## SDK Observability

Seven new telemetry events for SDK health monitoring:

| Event | Purpose |
|-------|---------|
| `tengu_sdk_ttft` | Time-to-first-token |
| `tengu_sdk_control_roundtrip` | Control message latency |
| `tengu_sdk_result` | Result delivery tracking |
| `tengu_sdk_stall` | Stall detection |
| `tengu_sdk_transport_error` | Transport-level failures |
| `tengu_sdk_schema_violation` | Schema validation issues |
| `tengu_sdk_session_crash` | Session crash reporting |

## GrowthBook Feature Flag Internals

Claude Code uses GrowthBook for feature gating. All `tengu_*` flags are evaluated via a
common mechanism documented here. Understanding this is essential for diagnosing why gated
features (like `/dream`, away summary, dynamic loops) are unavailable.

### Evaluation Function: `E_(flagName, defaultValue)`

Exported as `getFeatureValue_CACHED_MAY_BE_STALE`. Evaluation chain:

1. **`RZH()` — env override check**: Returns `NQq`, which is hardcoded to `null` in the
   production binary and **never assigned**. Dead code path.
2. **`GZH()` — config override check**: Stubbed as `function GZH(){return}` (returns
   `undefined`). The setter `BS4()` and clearer `FS4()` are also no-ops. Override path
   **completely disabled** in production.
3. **`Nb` — in-memory Map**: Populated from the GrowthBook SDK's remote evaluation response.
   This is the live authoritative source.
4. **`w_().cachedGrowthBookFeatures`** — Persisted to `~/.claude.json` as a fallback cache.
   Used when the SDK hasn't initialized yet (first ~5 seconds of startup).
5. **Default value** from the calling code (typically `false` for gated features).

### SDK Configuration

| Setting | Value |
|---------|-------|
| API host | `https://api.anthropic.com/` (Anthropic's proxy, NOT standard GrowthBook CDN) |
| Client key | `sdk-zAZezfDKGoZuXXKe` |
| Mode | `remoteEval: true` — evaluation happens **server-side** |
| Cache key attributes | `["id", "organizationUUID"]` — flags are per-user/org |
| Init timeout | 5000ms |

Because `remoteEval: true`, the SDK sends user attributes to Anthropic's server and receives
pre-evaluated flag values. The SDK never has flag rules/conditions locally — it cannot evaluate
flags offline using its own logic.

### SDK Initialization

The GrowthBook SDK init is **lazy** — wrapped in a memoized thunk (`QS6 = A6(...)`) that
only fires when something first accesses a feature flag. This means:
- No network request until the first `E_()` call
- The `Nb` map is empty until init completes
- During init (up to 5s timeout), `E_()` falls through to the cache

### Cache Persistence and Writeback

Flag values are cached in `~/.claude.json` under the `cachedGrowthBookFeatures` key. This
cache is:
- Written after each successful server fetch
- Read on startup before the SDK initializes (provides values for the first ~5 seconds)
- **Replaced entirely** by the server response within seconds of startup

The cache writeback function `yQq()` replaces the **entire** `cachedGrowthBookFeatures`
object with `Object.fromEntries(Nb)`:

```javascript
function yQq() {
  let H = Object.fromEntries(Nb);       // ALL flags from server
  let _ = w_();
  if (Pj(_.cachedGrowthBookFeatures, H)) return;  // skip if identical
  p_((q) => ({...q, cachedGrowthBookFeatures: H})); // REPLACE entire object
}
```

This means any key NOT in the server response gets **wiped** from the cache. For flags
the server doesn't send at all (like `tengu_kairos_dream` when not enrolled), the key
is removed entirely — not set to `false`, just deleted.

### Flag Absence vs Explicit False

Flags can be in three states relative to the server response:
- **Explicitly returned** (true or false): stored in `Nb`, authoritative
- **Absent from response**: NOT in `Nb`, falls through to cache, but cache gets wiped by `yQq()`
- **Not in cache either**: falls through to the default value in the calling code

For `tengu_kairos_dream`, the server does not include it in the response at all. `Nb` never
contains it, so `E_()` correctly falls through to the cache — but `yQq()` has already
replaced the cache with `Object.fromEntries(Nb)` which doesn't include the key.

### Local Override Feasibility

All three built-in override mechanisms are **stripped from the production build**:

| Method | Status | Details |
|--------|--------|---------|
| Env var override (`NQq`) | Dead code | Hardcoded `null`, never assigned |
| Config override (`GZH/BS4/FS4`) | Stubbed no-ops | Functions return immediately |
| Forced features | Not exposed | No env var like `CLAUDE_CODE_FEATURE_FLAGS` exists |
| Edit `~/.claude.json` cache | Wiped on startup | `yQq()` replaces entire object with server response |
| Binary patch | **SIGKILL on macOS** | Bun SEA is code-signed; modifying any bytes triggers macOS kill |
| Cache injection + watcher | **Works** | Inject flag, poll to re-inject after `yQq()` writeback (see below) |

### Cache Injection Workaround

For flags **absent from the server response** (not explicitly `false`, just missing), cache
injection with a filesystem watcher can force activation:

1. Write `"tengu_kairos_dream": true` into `~/.claude.json` `cachedGrowthBookFeatures`
2. Start a background poller that re-injects the flag every 500ms for ~30 seconds
3. Launch Claude Code — the SDK initializes, `yQq()` wipes the cache, the poller re-injects
4. When `/dream` is invoked, `E_()` checks `Nb` (miss) → falls through to cache (hit: `true`)
5. After the 30s poller exits, the flag persists because nothing overwrites it mid-session

This works because:
- `isEnabled` is checked lazily at dispatch time (not at registration)
- `Nb` never contains the flag (server doesn't send it)
- `yQq()` only fires during startup SDK init, not continuously
- The poller survives the single writeback event

This does NOT work for flags the server **explicitly returns as `false`** — those populate
`Nb` and `Nb.has()` returns `true`, short-circuiting the cache fallback.

### Bun SEA Code Signing

The Claude binary is a **Bun Single Executable Archive** — a Mach-O arm64 binary with the
JS bundle embedded as a binary resource. On macOS, the binary is **code-signed**. Any
modification to the binary bytes (even within the embedded JS source) invalidates the
signature, causing macOS to SIGKILL the process on launch. This makes traditional binary
patching (byte replacement of function bodies) non-viable on macOS.

### Wrapper Functions

| Symbol | Purpose |
|--------|---------|
| `E_(H, _)` | Core evaluator (`getFeatureValue_CACHED_MAY_BE_STALE`) |
| `dN(H, _, q)` | `getFeatureValue_CACHED_WITH_REFRESH` — delegates to `E_`, ignores TTL param |
| `uS4(H)` | `hasGrowthBookEnvOverride` — checks `NQq` (always `null` → always `false`) |
| `RZH()` | Returns env overrides (`NQq`, always `null`) |
| `GZH()` | Returns config overrides (stubbed, returns `undefined`) |
| `BS4()` | `setGrowthBookConfigOverride` (no-op) |
| `FS4()` | `clearGrowthBookConfigOverrides` (no-op) |
| `Zo()` | Stats/GrowthBook enabled check (false for Bedrock/Vertex/Foundry) |
| `tAH()` | `isStatsEnabled` — true for standard API users |
| `yQq()` | Cache writeback — replaces `cachedGrowthBookFeatures` with `Object.fromEntries(Nb)` |
| `QS6` | Lazy SDK init thunk (memoized via `A6()`) |
| `Nb` | In-memory `Map` of flag values from remote eval |
| `Pj()` | Deep equality check (skips writeback if cache already matches) |
| `mS4()` | Returns merged view: `Nb` entries if available, else cached features |

### Non-obvious Behavior

- **Bedrock/Vertex/Foundry users bypass flags entirely**: `Zo()` returns `false`, so `E_()`
  always returns the default value. For most gated features this means `false` (disabled).
- **The 5-minute TTL parameter** passed to `dN()` (e.g., `bF5 = 300000` for dream) is
  **completely ignored** in v2.1.101 — `dN` just delegates to `E_` without any TTL logic.
- **Flag values are user+org specific**: the `remoteEval` mode sends `id` and
  `organizationUUID` as attributes, enabling targeted rollouts per user or organization.
- **SDK init is lazy**: the GrowthBook client is not created until the first flag is checked.
  Before init, `Nb` is empty and `E_()` falls through to the cache or default.
- **Cache writeback is destructive**: `yQq()` replaces the entire `cachedGrowthBookFeatures`
  object, not just the changed keys. Flags absent from the server response are deleted.
- **Binary patching is not viable on macOS**: the Bun SEA binary is code-signed. Modifying
  any bytes causes macOS to SIGKILL the process on launch.
- **`isEnabled` is lazy for all commands**: slash commands are always registered; `isEnabled`
  is a function reference checked at dispatch time via `Ve()`. This means flag changes take
  effect immediately without session restart.

## Bundle Size

| Version | Bundle size | Delta |
|---------|------------|-------|
| v2.1.100 | 89,117,501 bytes (87,029 KB) | -- |
| v2.1.101 | 89,787,416 bytes (87,683 KB) | +670 KB (+0.75%) |
