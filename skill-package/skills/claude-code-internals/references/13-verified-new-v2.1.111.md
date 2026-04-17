Updated: 2026-04-17 | Source: Binary extraction from claude v2.1.110/v2.1.111

# Chapter 16: Verified New in v2.1.110–v2.1.111 (Source-Confirmed)

> **Provenance:** All details come from direct binary extraction and structured diffing of
> v2.1.110 and v2.1.111 bundles against the v2.1.109 baseline. v2.1.110 landed the bulk of
> the new surface area (Advisor Tool, Context Hint API, PushNotification, Remote Workflows,
> Fullscreen TUI); v2.1.111 added Proxy Auth Helper, System Prompt GB Override,
> `/less-permission-prompts`, and a handful of small telemetry/UX polish items.

> **Narrative for this chapter:** the binary is getting thinner and the server is getting
> smarter. Context Hint lets the server compact your context mid-flight; Advisor Tool lets
> a server-side reviewer model critique your main model's tool calls; System Prompt GB
> Override lets the server swap the system prompt wholesale; Canary lets the server pick
> which native-installer build you run. **Two users on the same binary can now get
> materially different behavior** depending on GrowthBook flag state. If you only read
> the bundle, you will miss this — every lesson below names both the client-side machinery
> and the server-side gate controlling it.

---

## TABLE OF CONTENTS

77. [Lesson 77 -- Remote Workflow Commands (/autopilot, /bugfix, /dashboard, /docs, /investigate)](#lesson-77----remote-workflow-commands)
78. [Lesson 78 -- Advisor Tool (Server-Side Reviewer Model)](#lesson-78----advisor-tool)
79. [Lesson 79 -- PushNotification Tool + KAIROS Mobile Push](#lesson-79----pushnotification-tool--kairos)
80. [Lesson 80 -- Context Hint API (Server-Driven Micro-Compaction)](#lesson-80----context-hint-api)
81. [Lesson 81 -- Fullscreen TUI, /focus, and /tui](#lesson-81----fullscreen-tui-focus-tui)
82. [Lesson 82 -- Proxy Auth Helper](#lesson-82----proxy-auth-helper)
83. [Lesson 83 -- System Prompt Modifications (GB Override, Append-Subagent, Verified-vs-Assumed)](#lesson-83----system-prompt-modifications)
84. [Lesson 84 -- v2.1.110–v2.1.111 Command & Env Var Changes](#lesson-84----v21110v21111-command--env-var-changes)

---

# LESSON 77 -- REMOTE WORKFLOW COMMANDS

## Overview

Five new slash commands — `/autopilot`, `/bugfix`, `/dashboard`, `/docs`, `/investigate` —
are registered from a shared array `jA5` and dispatched through a single spawner `YA5()`.
All five delegate execution to a **remote CCR v2 session** (Cloud Code Runner): the local
CLI creates a cloud session via `POST /v1/sessions` with the beta header
`anthropic-beta: ccr-byoc-2025-07-29`, then sends the user's task verbatim as the
session's first message, prefixed with the command name.

These are not local-prompt templates. The CLI is a thin client; the behavior lives in the
remote session host.

## Command Registration

```js
// jA5 — shared definition array
[
  { name: "autopilot", description: "Start an autopilot session in the cloud" },
  { name: "bugfix",    description: "Fix a bug in the cloud" },
  { name: "dashboard", description: "Open the CCR dashboard" },
  { name: "docs",      description: "Write documentation in the cloud" },
  { name: "investigate", description: "Investigate a codebase question in the cloud" },
]
```

Each entry is expanded into a full slash command object by the shared factory, which sets
`supportsNonInteractive: false` (interactive-only), `isHidden: !$X4()` (hidden unless CCR
v2 enabled), and points `call` at `YA5()`.

## Dispatch Flow

1. User invokes `/autopilot <task>` (or any of the five).
2. `YA5()` checks `$X4()` — the CCR v2 gate. If false, prints an error and exits.
3. Spawns a new remote session via `POST /v1/sessions` with the BYOC (bring-your-own-cloud)
   beta header.
4. First message sent: `/${commandName} ${userTask}` — the remote session receives the
   slash command name as part of the user message, not as a separate field.
5. Local CLI detaches; session proceeds server-side. Dashboard opens in a browser for
   `/dashboard`.

## CCR v2 Dependency

`$X4()` — the CCR v2 master gate — must return true. Otherwise all five commands are
hidden. CCR v2 is itself gated behind `CLAUDE_CODE_USE_CCR_V2` plus server-side
provisioning.

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `jA5` | Array of five workflow definitions |
| `YA5()` | Shared dispatcher; spawns remote session |
| `$X4()` | CCR v2 availability gate |
| `ccr-byoc-2025-07-29` | Beta header for remote session creation |

## Why This Matters

This is Anthropic productizing "headless Claude Code in the cloud." Paired with
PushNotification (L79), the workflow is: kick off `/autopilot "fix this bug"` from your
laptop, close your terminal, get a phone notification when the work needs your input.
The local CLI is becoming an orchestrator, not the runtime.

---

# LESSON 78 -- ADVISOR TOOL

## Overview

**Advisor Tool** is a server-side reviewer model that critiques the primary model's tool
calls in real time. When enabled, certain tool calls are routed through a secondary model
(the "advisor") which returns a `server_tool_use` / `advisor_tool_result` content block
pair; the primary model sees the advisor's assessment before its call is actually executed.

This is the "superego" pattern shipped in production. It is aggressively gated — strict
model allow-list, first-party-only, four independent kill switches.

## Four-Gate Enablement

```js
function zx() {
  if (VH(process.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL)) return false;
  if (gq() !== "firstParty" || !co()) return false;
  if (VH(process.env.CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL)) return true;
  return I_("tengu_sage_compass2", {}).enabled ?? false;
}
```

Gates (all must pass unless the experimental env var short-circuits):

1. **`CLAUDE_CODE_DISABLE_ADVISOR_TOOL`** — hard off-switch (`VH` = truthy env parse).
2. **`gq() === "firstParty"`** — rejects Bedrock/Vertex/third-party routing; advisor only
   runs on Anthropic first-party API.
3. **`co()`** — additional entitlement check (login/session/org).
4. **Model allow-list** (enforced at call site via `byH()`):

```js
function byH(H) {
  let _ = H.toLowerCase();
  return _.includes("opus-4-7") || _.includes("opus-4-6") || _.includes("sonnet-4-6") || false;
}
```

The experimental env var (`CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL`) bypasses the GB
flag but **not** the first-party / entitlement / model checks.

## Protocol

Advisor is a *server-side tool* — the client doesn't execute it. On enabled requests, the
server inserts `server_tool_use` / `advisor_tool_result` content blocks into the response
stream. The primary model consumes them as regular assistant content. To the user, this
manifests as the model occasionally referencing the advisor's feedback in its reasoning.

## Why Strict Model Gating

Opus-4-6, Opus-4-7, Sonnet-4-6 are the only models trained to produce and consume the
advisor content-block format correctly. Earlier Opus 4.X checkpoints would treat the
advisor blocks as noise. This is why the gate is a hard allow-list, not a feature flag.

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `zx()` | Master advisor enablement check |
| `byH()` | Model allow-list check |
| `tengu_sage_compass2` | GB flag (default: false) |
| `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` | Hard off-switch |
| `CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL` | GB-bypass opt-in |
| `server_tool_use` / `advisor_tool_result` | Content block types |

## Implications

Agent-on-agent is now a shipped runtime primitive, not an SDK pattern. Combined with the
append-subagent-prompt flag (L83), multi-model composition is becoming core infrastructure.
Premium-tier compute only — advisor doubles the inference cost of any gated call.

---

# LESSON 79 -- PUSHNOTIFICATION TOOL & KAIROS

## Overview

**PushNotification** is a new tool the model can call to send a push notification to the
user's mobile device via Anthropic's **KAIROS** push infrastructure. The tool exists to
let long-running autonomous sessions (especially CCR v2 / Remote Workflows, L77) reach
out to the user when they need input — without requiring the user to keep the terminal
open.

Data flow: `model` → `PushNotification` tool call → **Remote Control bridge** (local
macOS/desktop agent) → **KAIROS** (Anthropic push service) → user's registered device.

## Input Schema

The input schema is deliberately minimal — the only accepted `status` value is
`literal("proactive")`. The model cannot send arbitrary push content; it can only signal
*"I am waiting proactively; consider notifying the user."* The actual notification
composition happens downstream.

## Output (6 Variants)

The tool result encodes why the push did or did not happen, keyed on `disabledReason`
(`config_off` / `user_present` / `bridge_inactive`) crossed with `localSent` and `hasFocus`:

| disabledReason | localSent | hasFocus | Meaning |
|----------------|-----------|----------|---------|
| `config_off` | — | — | User disabled push in settings |
| `user_present` | — | — | Suppressed: user is actively at the terminal |
| `bridge_inactive` | — | — | Remote Control bridge not running |
| (none) | true | true | Local notification shown; terminal focused |
| (none) | true | false | Local notification shown; terminal in background |
| (none) | false | — | Remote push dispatched (no local app) |

The model uses these to decide whether to retry or change approach.

## Relationship to Brief

Despite both using the word "proactive," **PushNotification and Brief are distinct tools**.
Brief is the separate daily-summary tool; PushNotification is transactional "I'm waiting
on you" signaling. Don't conflate them.

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `PushNotification` | Tool name (model-visible) |
| `"proactive"` | Only accepted input status |
| `disabledReason` | Output-variant discriminator |
| Remote Control bridge | Local relay (macOS/desktop) |
| KAIROS | Anthropic server-side push infrastructure |

---

# LESSON 80 -- CONTEXT HINT API

## Overview

**Context Hint API** (beta header `context-hint-2026-04-09`) is a server-driven signaling
channel that lets the API tell the client to compact (or modify) its context mid-flight.
The server can reject a request with specific status codes (422, 424, 409, 529, SSE
`invalid_request`) that instruct the client to perform a **keep-recent micro-compaction**
and retry — without user involvement.

This is the single most consequential architectural shift in v2.1.110: **the client no
longer owns context state alone**.

## Activation

```js
buildRequestParams() {
  if (!_ || q) return null;  // _ = first-party, q = non-main-thread
  return { betaHeader: "context-hint-2026-04-09", body: { context_hint: { enabled: true } } };
}
```

The controller (`YE5`) returns `null` — meaning Context Hint is *not* advertised on the
request — unless:

- Request is first-party (not Bedrock/Vertex)
- Request is on a `repl_main_thread*` thread (not subagent, not SDK background)
- GrowthBook master gate `tengu_hazel_osprey` is on (checked via `sF7()`)

## Server Signals

When Context Hint is advertised, the server may reject with:

| Signal | Meaning |
|--------|---------|
| HTTP 422 (reject) | Context too large; compact and retry |
| HTTP 424 (reject) | Dependency condition; compact and retry |
| HTTP 409 (busy) | Temporary; retry with compaction |
| HTTP 529 (overload) | Server overload; compact to reduce load |
| SSE `invalid_request` with `type: "context_hint_rejection"` | Mid-stream rejection |

Receiving any of these triggers `sT9()` — the **keep-recent micro-compaction** — which
keeps the most recent `keepRecent=5` turns and summarizes everything before.

## Why This Is Different

Before Context Hint, compaction was client-initiated (user ran `/compact`, or the CLI
detected token-limit proximity). Now the *server* decides, based on its own view of
tokenization, model state, and load. The client obeys. Two users on the same binary will
get different compaction behavior depending on whether `tengu_hazel_osprey` is on for them.

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `YE5` | Context Hint controller |
| `sF7()` | GB master gate check |
| `sT9()` | Keep-recent micro-compaction (`keepRecent=5`) |
| `tengu_hazel_osprey` | GB flag (default: false) |
| `context-hint-2026-04-09` | Beta header |
| `repl_main_thread*` | Thread-type allow-list |

## Troubleshooting

If context seems to be compacting without user action, and the user is on first-party API
running an opus-4-X/sonnet-4-X model, Context Hint is the likely cause. There is no env
var to disable it — you can only verify by checking whether GB flag `tengu_hazel_osprey`
is on for your org.

---

# LESSON 81 -- FULLSCREEN TUI, /FOCUS, /TUI

## Overview

Claude Code can now render as a **fullscreen terminal UI** — taking over the full alt-screen
buffer, like `vim` or `htop`, rather than scrolling inline. Two new slash commands:

- `/focus` — starts a focus session (Pomodoro-like timer with fullscreen rendering)
- `/tui` — toggles fullscreen mode on/off

## Activation Precedence

Fullscreen activation is decided by `Qq()` with a **5-tier precedence** (first match wins):

1. **`CLAUDE_CODE_NO_FLICKER=1`** — hard disable (highest priority)
2. **`CLAUDE_CODE_FULLSCREEN=1`** — hard enable
3. **tmux control mode** — auto-disable when running inside `tmux -CC`
4. **`userSettings.tui`** — user-level setting (`"on"` / `"off"` / `"auto"`)
5. **`tengu_pewter_brook`** — GB flag (default: false) for gradual rollout

## `/tui` Command

Invoking `/tui` does not simply re-render — it **respawns the entire process** via
`child_process.spawn()` with the new fullscreen mode encoded in the env. This is because
alt-screen enter/exit requires reinitializing stdin/stdout in raw mode and rebuilding
the render tree from scratch. The spawn trick is the cheapest way to do that cleanly.

## `/focus` Command

`/focus [minutes]` starts a focus-timer session. The UI takes over the full screen, shows
a countdown, hides non-essential chrome, and on completion returns to normal rendering.
Useful for deep-work sessions where you want Claude Code's progress visible but everything
else backgrounded.

## Upsell Gating

A "try fullscreen mode" upsell appears in certain contexts, gated by
`tengu_ochre_hollow` (default: false). This is separate from the activation gate — the
upsell controls *showing the hint*, not *enabling the mode*.

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `Qq()` | Fullscreen activation precedence resolver |
| `CLAUDE_CODE_NO_FLICKER` | Hard-disable env var |
| `CLAUDE_CODE_FULLSCREEN` | Hard-enable env var |
| `tui` | User setting (`on`/`off`/`auto`) |
| `tengu_pewter_brook` | Rollout flag |
| `tengu_ochre_hollow` | Upsell-shown flag |

## Troubleshooting

If `/tui` doesn't seem to work: check if you're in tmux control mode (`tmux -CC`) — it
auto-disables fullscreen regardless of flags. Set `CLAUDE_CODE_FULLSCREEN=1` to force-enable
for testing. If the terminal goes blank after `/tui`, your terminal emulator may not support
alt-screen mode cleanly — set `CLAUDE_CODE_NO_FLICKER=1` to force-disable.

---

# LESSON 82 -- PROXY AUTH HELPER

## Overview

Corporate proxies often require authentication that rotates faster than a static
`HTTPS_PROXY` URL can express. Proxy Auth Helper lets the user configure a **shell
command** whose stdout is used as the proxy `Proxy-Authorization` header — similar in
spirit to `apiKeyHelper` and `awsAuthRefresh`.

## Configuration

```js
function qP_() {
  if (process.env.CLAUDE_CODE_PROXY_AUTHENTICATE !== "1") return null;
  // ... load helper command from user/project settings
  // ... exec with 30s timeout, cache result with stale-cache fallback
}
```

Strict env gate: `CLAUDE_CODE_PROXY_AUTHENTICATE` must equal the literal string `"1"`.
Any other value (including `"true"`) disables.

## Workspace-Trust Protection

The helper command can be configured at three scopes:

1. **User settings** (`~/.claude/settings.json`) — always trusted
2. **Project settings** (`.claude/settings.json`) — **requires workspace trust**
3. **Local project settings** (`.claude/settings.local.json`) — **requires workspace trust**

Untrusted workspaces cannot override the helper. This prevents a hostile repo from
dropping a `.claude/settings.json` that exfiltrates credentials via the "proxy auth"
command.

## Caching and Failure Handling

- 30-second exec timeout
- Result cached in memory
- On exec failure, falls back to last-cached value (stale-cache fallback) rather than
  failing the request, so transient helper errors don't kill the session

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `qP_()` | Helper resolution function |
| `CLAUDE_CODE_PROXY_AUTHENTICATE` | Strict `"1"` gate |
| `proxyAuthHelper` | Settings key |
| 30s | Exec timeout |

## Pairs With

`apiKeyHelper` (L1-era), `awsAuthRefresh` (Bedrock), and now `proxyAuthHelper` form the
"user-defined shell command produces rotating credential" pattern. All three share the
workspace-trust model.

---

# LESSON 83 -- SYSTEM PROMPT MODIFICATIONS

This lesson covers three distinct system-prompt-related changes landed in v2.1.111.

## 83a. System Prompt GB Override

The server can now replace the entire system prompt via a GrowthBook feature whose name
is supplied through an env var:

```js
let HH = VH(process.env.CLAUDE_CODE_REMOTE)
       ? process.env.CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE : void 0;
let a = () => {
  if (!HH) return Y.systemPrompt;
  let rH = I_(HH, "");
  return typeof rH === "string" && rH.length > 0 ? rH : Y.systemPrompt;
};
```

Activation requires **both**:

1. `CLAUDE_CODE_REMOTE` env var is truthy (i.e., running in a CCR/remote context)
2. `CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE` is set to a GB feature name
3. The GB feature returns a non-empty string

If all three pass, the GB feature's string value **replaces** the system prompt entirely.
Falls back to the default on any failure. This is the mechanism by which CCR-hosted
sessions can run with a different system prompt than the local CLI ships with — without
a binary release.

## 83b. Verified-vs-Assumed System Prompt

A new safety rubric added to the default system prompt distinguishing between information
the model has **verified** from tool output versus information it is **assuming** from
context. The intent is to reduce hallucination-via-confidence: the model is instructed
to explicitly flag when it is acting on assumption rather than verified fact.

## 83c. Append Subagent System Prompt

New per-call augmentation for subagent dispatches:

```js
if (!P && VH(process.env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT)
        && q.options.appendSubagentSystemPrompt) {
  a = t7([...a, q.options.appendSubagentSystemPrompt]);
}
```

Triple-gated: `P` must be false (subagent is running with parent's composed prompt, not a
wholesale override), env var must be set, and the call must supply
`appendSubagentSystemPrompt`. This is the per-call analogue of top-level
`appendSystemPrompt`, isolated to Task/Agent dispatches.

## Composition Matrix

| Layer | Who sets it | Scope |
|-------|-------------|-------|
| Default `Y.systemPrompt` | Claude Code binary | Baseline |
| GB override | Server (CCR contexts) | Replaces entirely |
| `appendSystemPrompt` | SDK caller | Appended to top-level |
| `appendSubagentSystemPrompt` | SDK caller, per Task call | Appended to subagent prompt only |

## Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `CLAUDE_CODE_REMOTE` | Required gate for GB override |
| `CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE` | GB feature name for override |
| `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT` | Gate for subagent append |
| `appendSubagentSystemPrompt` | Task call option |

---

# LESSON 84 -- v2.1.110–v2.1.111 COMMAND & ENV VAR CHANGES

Catch-all for new slash commands, env vars, feature flags, and small telemetry/UX
additions that don't warrant their own lessons.

## New Slash Commands (v2.1.110–v2.1.111)

| Command | Version | Notes |
|---------|---------|-------|
| `/autopilot` | v2.1.110 | Remote Workflow (L77) |
| `/bugfix` | v2.1.110 | Remote Workflow (L77) |
| `/dashboard` | v2.1.110 | Remote Workflow (L77) |
| `/docs` | v2.1.110 | Remote Workflow (L77) |
| `/investigate` | v2.1.110 | Remote Workflow (L77) |
| `/focus` | v2.1.110 | Fullscreen focus-timer (L81) |
| `/tui` | v2.1.110 | Toggle fullscreen (L81) |
| `/less-permission-prompts` | v2.1.111 | Methodology prompt (see below) |

## `/less-permission-prompts`

A built-in slash command whose body is a ~3.5KB methodology prompt instructing Claude on
how to minimize permission-prompt noise when completing a task. The prompt enumerates
**all auto-allowed commands** — making it double as a source-of-truth reference for what
Claude Code's sandbox permits without confirmation. Registered unconditionally via
`KqK()` within `N7K()`; no GB flag or env var gate.

Coexists with user-installed skills of the same name: slash commands are dispatched by
exact name match and take precedence over model-contextual Skill activation, so the
built-in wins when the user types `/less-permission-prompts` directly.

## New Environment Variables

| Env Var | Purpose | Lesson |
|---------|---------|--------|
| `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` | Hard-off for Advisor Tool | L78 |
| `CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL` | Bypass GB flag for Advisor | L78 |
| `CLAUDE_CODE_FULLSCREEN` | Force-enable fullscreen TUI | L81 |
| `CLAUDE_CODE_NO_FLICKER` | Force-disable fullscreen TUI | L81 |
| `CLAUDE_CODE_PROXY_AUTHENTICATE` | Strict `"1"` gate for proxy auth helper | L82 |
| `CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE` | GB feature name for system prompt override | L83a |
| `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT` | Gate for subagent prompt append | L83c |
| `CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH` | Post-command plugin refresh | below |
| `CLAUDE_SLOW_FIRST_BYTE_MS` | Slow first-byte watchdog threshold (default 30000) | below |

## New Feature Flags

| Flag | Default | Purpose | Lesson |
|------|---------|---------|--------|
| `tengu_sage_compass2` | false | Advisor Tool master gate | L78 |
| `tengu_hazel_osprey` | false | Context Hint master gate | L80 |
| `tengu_pewter_brook` | false | Fullscreen TUI rollout | L81 |
| `tengu_ochre_hollow` | false | Fullscreen upsell-shown | L81 |
| `tengu_canary` | `{}` | Native-installer canary channel | below |

**Still-unresolved codenames observed in the bundle but whose mechanism was not
confirmed via extraction:** `tengu_cobalt_ridge`, `tengu_crimson_vector`,
`tengu_loud_sugary_rock`, `tengu_slate_ribbon`, `tengu_velvet_moth`. Reported here as
observed-but-unresolved rather than speculated about.

## Slow First-Byte Watchdog

A `setTimeout` is armed when a streaming request begins; if no stream chunk arrives
within `CLAUDE_SLOW_FIRST_BYTE_MS` (default `30000`, parsed
`parseInt(env||"",10) || 30000`), the timer fires, emits `tengu_api_slow_first_byte` with
`{ model, provider: Qm(), attempt: PH, elapsed_ms: J_ }`, and logs `warn` "Slow first
byte: no stream chunk Xs after request sent (attempt N)". **Purely observational** —
the request is not aborted.

## Canary Channel (`rp1()`)

Reads GrowthBook feature `tengu_canary` expecting `{ external: string }` where the string
is a valid semver (validated via `Pl9.valid`). The native-installer target-picker `op1()`
consults `rp1()` and overrides the ordinary target **only if** `aJ(canary, target)`
(canary is newer than target) **and** `!exceedsMaxVersion`.

Net effect: a server-controlled rolling-canary channel that pulls a subset of
native-installer users forward to pre-release builds without code changes.

## Background Plugin Refresh

Gated by both the `CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH` env flag **and** a
mutable `ZH?.needsRefresh` bit that other plugin operations set when they've mutated
installed plugins. After a main command completes, the hook clears the bit
(`ZH.needsRefresh = !1`) and awaits `NH()`.

## Unknown Command Did-You-Mean (`_a5()`)

When the CLI sees an unknown slash command `H`, it runs
`BCH(K, q.map(T => ({ name: T })))` (Fuse-style fuzzy match), picks the top hit `O`,
writes `unknown command "${H}"` plus `  └ Did you mean claude ${O}?` (plus a nudge to
`claude -p "${H}"` for prompt mode) to stderr, emits `tengu_unknown_command_suggestion`,
and exits with code 1.

## New Telemetry Events (Observational Only)

| Event | Source |
|-------|--------|
| `tengu_api_slow_first_byte` | Slow first-byte watchdog |
| `tengu_unknown_command_suggestion` | Did-you-mean for unknown slash commands |
| `tengu_external_editor_context_changed` | `externalEditorContext` toggle |
| `tengu_slash_link_clicked` | User clicked a terminal hyperlink from Claude |
| `tengu_review_remote_stopped` | CCR review session shut down |
| `tengu_vscode_sdk_stream_ended_no_result` | SDK transport closed without final result |
| `tengu_relay_chain_v` | Versioned relay chain diagnostic |
| `tengu_tool_search_unsupported_model` | ToolSearch invoked on unsupported model |
| `tengu_thinking_clear_latched` | Thinking buffer cleared while latched |

Pattern: **measure first, intervene later**. None of these change user-visible behavior;
all emit telemetry so Anthropic can decide what to fix.

## New Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `externalEditorContext` | false | Include active-file info from external editor in context |
| `prStatusFooterEnabled` | true | Show PR state in status-line footer |
| `tui` | `"auto"` | Fullscreen mode (`on` / `off` / `auto`) |
| `proxyAuthHelper` | — | Shell command producing proxy auth header (L82) |

## New Beta Headers

| Header | Purpose | Lesson |
|--------|---------|--------|
| `context-hint-2026-04-09` | Context Hint API | L80 |

## Bundle Size

| Version | Bundle size | Delta from v2.1.109 |
|---------|-------------|---------------------|
| v2.1.109 | 91,338,496 bytes (89,198 KB) | — |
| v2.1.110 | ~ (intermediate) | — |
| v2.1.111 | 90,685,440 bytes (88,560 KB) | -638 KB (-0.7%) |

v2.1.111 is slightly *smaller* than v2.1.109 despite adding substantial new functionality —
reflects internal refactoring and dead-code removal offsetting the new features.

---

## Narrative Summary: Why v2.1.110–v2.1.111 Matters

If there is one sentence to take away from this chapter: **Claude Code is no longer a
self-contained client.** Context Hint lets the server compact your context. Advisor Tool
lets a server-side model review your primary model's calls. System Prompt GB Override
lets the server swap the prompt wholesale in remote contexts. Canary lets the server
pick your installer version.

Pair that with Remote Workflows (cloud-hosted sessions) and PushNotification/KAIROS
(mobile push), and the product shape is visibly shifting: Claude Code as a *headless
agent running in the cloud that pings you when it needs you*, with the local CLI as
orchestrator rather than runtime.

Everything ships dark: each new capability has both an env-var kill switch and a GB flag
gate. That is production discipline, but it also means **two users on the same binary
can experience different behavior** depending on flag state. Reading the bundle alone
no longer tells you how a given user's Claude Code actually behaves.
