Updated: 2026-04-23 | Source: Binary extraction from claude v2.1.117/v2.1.118

# Chapter 19: Verified New in v2.1.117–v2.1.118 (Source-Confirmed)

> **Provenance:** Direct binary extraction and structured diffing of v2.1.117 and v2.1.118
> bundles against the v2.1.116 baseline. Each release added user-visible surface, so both
> are covered: L87 for v2.1.117 (the `/fork` release + `/autocompact` and `/stop-hook`
> removal), L88 for v2.1.118 (UI consolidation: `/cost` + `/stats` merged into `/usage`,
> `cache-diagnosis-2026-04-07` beta, frontmatter shadow-validator, WIF OAuth locking,
> `/pro-trial-expired` stub, `/autofix-pr` deremoted).

> **Narrative for this chapter — two waves of change.**
> v2.1.117 is the **`/fork` release**: a new slash command (`/fork <directive>`) plus its
> supporting subagent type and bridge-reattach env vars land behind a GB flag
> (`tengu_copper_fox`), and two legacy commands (`/autocompact`, `/stop-hook`) drop out
> entirely. Two new OAuth-token override env vars (`CLAUDE_CODE_RATE_LIMIT_TIER`,
> `CLAUDE_CODE_SUBSCRIPTION_TYPE`) let deployments report a fake tier/subscription,
> presumably for testing.
>
> v2.1.118 is **UI consolidation + observability**: `/cost` and `/stats` stop existing as
> standalone commands and become aliases of `/usage`, which gains two registrations (one
> ink-gated TUI, one `supportsNonInteractive`). `/autofix-pr`'s description loses the
> "remote session" framing (continuing the Remote Workflow sunset from L85). A new API
> beta header `cache-diagnosis-2026-04-07` is sent opt-in and gracefully dropped if the
> server rejects it. A Zod-based **shadow validator** on skill/plugin frontmatter silently
> emits telemetry when it sees unknown keys or type mismatches — non-fatal, but diagnostic
> groundwork for a future stricter mode. Enterprise OAuth refresh gains a file-lock
> ("`wif_user_oauth_lock`") + retry layer to avoid race conditions when multiple
> Claude Code processes share credentials on disk.
>
> **What's NOT in v2.1.117–v2.1.118:** no new hook event types, no new permission
> phases, no new skill protocol fields beyond the `context: "fork"` that already existed
> in v2.1.116 (now wired to an actual subagent type). The `--remote` CLI flag remains the
> same. The OIDC Federation auth surface from L86 is unchanged.

---

## TABLE OF CONTENTS

87. [Lesson 87 -- v2.1.117 `/fork` Subagent Command, Rate-Limit/Subscription Overrides, `/autocompact` + `/stop-hook` Removal](#lesson-87----v21117-fork-subagent-command-rate-limitsubscription-overrides-autocompact--stop-hook-removal)
88. [Lesson 88 -- v2.1.118 `/cost` + `/stats` → `/usage` Aliases, `cache-diagnosis-2026-04-07`, Frontmatter Shadow Validator, WIF OAuth Locking](#lesson-88----v21118-cost--stats--usage-aliases-cache-diagnosis-2026-04-07-frontmatter-shadow-validator-wif-oauth-locking)

---

# LESSON 87 -- v2.1.117 `/fork` SUBAGENT COMMAND, RATE-LIMIT/SUBSCRIPTION OVERRIDES, `/autocompact` + `/stop-hook` REMOVAL

## `/fork` — Background Agent Inheriting Full Conversation

### What it is

A new slash command: `/fork <directive>` spawns a **background subagent that inherits
the full conversation context** of the parent session. The directive is the task prompt
for the forked agent; the agent runs asynchronously while the parent session continues.

Registration (in `$a7`):

```js
{ type: "local-jsx",
  name: "fork",
  description: "Spawn a background agent that inherits the full conversation",
  argumentHint: "<directive>",
  isEnabled: iv,
  load: () => Promise.resolve().then(() => (Oa7(), Ka7)) }
```

UI confirmation string: `"Fork started — processing in background"`.

### Three-layer gating

1. **`iv()`** — the slash-command's `isEnabled`: returns `sJ9() !== "disabled"`.
2. **`sJ9()`** — fork-mode resolver (memoized in `hp_`). Computes via `Sz1()` and emits a
   `tengu_fork_subagent_enabled` telemetry event with the resolved source.
3. **`GR()`** — the underlying fork-enabled check used elsewhere:

```js
function GR() {
  if (S8()) return false;                                     // non-interactive: no fork
  if (hH(process.env.CLAUDE_CODE_FORK_SUBAGENT)) return true; // env var override
  return S_("tengu_copper_fox", false);                       // GB flag, default false
}
```

So the priority is: **interactive-only → env-var opt-in → GB flag**. Users on
non-interactive (`claude -p …`) paths never see `/fork` even with the env var set.

### The `fork` subagent type (implicit)

A new agent type `"fork"` is registered in `Q4H` — but with an unusual `whenToUse`:

```js
{ agentType: "fork",
  whenToUse: "Implicit fork — inherits full conversation context. " +
             "Not selectable via subagent_type; triggered by omitting subagent_type " +
             "when the fork experiment is active.",
  tools: ["*"],
  maxTurns: 200,
  model: "inherit",
  permissionMode: "bubble",
  source: "builtin" }
```

Key properties:

- **Not user-selectable via `Task({ subagent_type: "fork" })`** — the comment says it's
  triggered by *omitting* `subagent_type` (with the fork experiment active), which means
  it's a fallback dispatch when the model calls Task without specifying a type.
- **`tools: ["*"]`** — inherits all tools from the parent.
- **`maxTurns: 200`** — long run budget, matching the "background processing" framing.
- **`model: "inherit"`** — uses the parent session's selected model.
- **`permissionMode: "bubble"`** — child permission requests bubble up to the parent's
  approval flow (same as `Task`).

### Parent-context inheritance options

Agent spawn passes `forkContextMessages` computed from `v.forksParentContext`:

```js
forkContextMessages:
  L ? w.messages                                          // full messages (replHydration kind="fork")
  : v.forksParentContext === "turn" ? w.messages.slice(w.turnStartIndex)  // current turn only
  : v.forksParentContext === true   ? w.messages          // full history
  : void 0                                                // no parent context
```

Three inheritance modes:

| `forksParentContext` value | Behavior |
|---|---|
| `"turn"` | Child sees messages from the parent's current turn start onward |
| `true` | Child sees the parent's full message history |
| falsy/absent | Child starts fresh (still with system prompt) |

The REPL-hydration path uses `{ kind: "fork", log: [...replayLog] }` to seed the forked
agent with the parent's REPL state — tool use, tool results, thinking blocks — so the
fork resumes mid-stream rather than re-executing tools.

### Dark-launch note

The `/fork` helpers `_a7` and `V75` **already existed in the v2.1.116 bundle** —
they were dark-launched code. What v2.1.117 actually ships is the *user-reachable*
surface: slash-command registration, `tengu_copper_fox` GB flag, `iv()`/`sJ9()` enable
chain, `CLAUDE_CODE_FORK_SUBAGENT` env var, `f`-keybinding chord, and the "Cannot fork
before the first conversation turn" guard. The fork infrastructure was wired up waiting
for a flag to flip; v2.1.117 is when the flag becomes flippable.

### Three distinct fork execution paths

Despite sharing the "fork" name, **three different helpers run** depending on how the
fork is triggered. They differ on the most important axis — synchronous vs background
— and it is easy to confuse them.

| Trigger | Helper | `isAsync` | Blocks parent? | Agent used | Tools |
|---|---|---|---|---|---|
| User types `/fork <directive>` | `_a7` → `quH` → `xy` | `true` | **No** — fire-and-forget | `ph` (fork subagent type) | `[*]` full inheritance |
| Slash command with `context: "fork"` frontmatter | `V75` → `xy` | `false` | Yes — inline streaming | `H.agent` from frontmatter → general-purpose fallback | From `H.allowedTools` or filtered default |
| Skill invoked via Skill tool with `context: "fork"` | `C75` → `xy` | `false` | Yes — inline streaming | `H.agent` from frontmatter → general-purpose fallback | Same as V75 |

`C75` is **new in v2.1.118**; `_a7` and `V75` both existed in v2.1.116.

#### Path 1 — `/fork <directive>` slash command (`_a7`, backgrounded)

The interesting path. When the user types `/fork deploy the staging branch`:

```js
// _a7(H = directive, _ = toolUseContext, q = canUseTool)
let K = _.renderedSystemPrompt;
if (!K) {
  if (K = await Cd5(_), !K) return null;   // guard: nothing to fork from → null
}
let O = {                                   // REPL replay log for hydration
  kind: "fork",
  log: (() => {
    let f = _.agentId ?? mDH;
    let M = _.getAppState().replContexts[f]?.replayLog;
    if (M) return [...M];
    if (_.replHydration?.kind === "resume") return ze_(_.messages);
    return [];
  })()
};
let T = bd5(H);                             // name from first 3 tokens of directive
let $ = H.length > 50 ? H.slice(0, 49) + "…" : H;   // description (truncate)
let A = GC(T);                              // new agentId
let { taskRegistry: z } = _;
let Y = Date.now();
let w = GuH({ agentId: A, description: $, prompt: H,
              selectedAgent: ph,            // THE fork subagent type
              taskRegistry: z, toolUseId: _.toolUseId });
let D = w.abortController;
_.agentLifecycle.registerName(T, kO(A));
// ... wraps in quH(...) which registers the task as async and launches xy(...)
//     with isAsync: true, forkContextMessages: _.messages (full history),
//     useExactTools: true, replHydration: O
return { agentId: A, name: T };
```

Key properties:

- **`isAsync: true`** — launches a **true background agent**. The parent conversation
  is not blocked; control returns to the user immediately.
- **`useExactTools: true`** — child receives the parent's tool list verbatim (no
  substitution, no filtering).
- **`forkContextMessages: _.messages`** — full parent message history, always. Not
  configurable at this path.
- **`replHydration: { kind: "fork", log }`** — seeds the forked agent with the parent's
  REPL replay log so tool results and thinking blocks carry over without replay.
- **Task-registry integration** — the fork is registered with the parent's
  `taskRegistry`, which means `/tasks` and the Task UI surface it like any other
  background subagent. `enableSummarization: true` so progress summaries feed the
  parent's UI.
- **Guard:** `if (!renderedSystemPrompt && !Cd5(_)) return null` — Id5 surfaces this as
  `"Cannot fork before the first conversation turn"` (new in v2.1.117).

The calling command `Id5` displays the confirmation:

```
<some-emoji> forked <name> (<last-4-of-agent-id>)
```

and returns `null` (no follow-up query). The "Fork started — processing in background"
string from the registration constants is the spinner label shown inside the task
registry UI, not the inline system message.

#### Path 2 — slash command with `context: "fork"` frontmatter (`V75`, synchronous)

A slash command declaring `context: "fork"` in its frontmatter runs through V75:

```js
// After processPromptSlashCommand resolves:
if (Y.context === "fork") return await V75(Y, _, K, O, q, A ?? Sj, w.hookMessages);
return await H$7(Y, _, K, O, T, z, w.hookMessages);   // normal inline expansion
```

V75 internals:

- `isAsync: false` — inline streaming. The parent conversation **blocks** on completion.
- UI updates via progress-message push: each assistant/user event becomes a
  `type: "progress"` message under `parentToolUseID: "forked-command-${name}"`; Ink
  re-renders the spinner area after each chunk.
- Agent: from `H.agent` (frontmatter) → fallback to `"general-purpose"` → fallback to
  first active agent. Throws `"No agent available for forked execution"` if no agents
  are loaded.
- Returns `{ messages: [userMessage, localCommandStdoutMessage], shouldQuery: false,
  command: H, resultText }` — the child's final output wraps inside
  `<local-command-stdout>` tags in the parent transcript.

#### Path 3 — skill invoked via Skill tool with `context: "fork"` (`C75`, synchronous, new in v2.1.118)

Same mechanics as V75 but reached via the Skill tool's invocation path (when the model
calls Skill rather than the user typing a slash). Emits
`tengu_skill_tool_invocation` with `execution_context: "fork"` and, like V75, runs
synchronously with skill-progress streaming through the `$` callback to the Skill tool's
progress UI. Returns `{ data: { success, commandName, status: "forked", agentId,
result } }` back to the Skill tool. Cleanup runs in a `finally { v8H(agentId) }` block.

### `bd5` — directive → short name

```js
function bd5(H) {
  return H.trim().split(/\s+/).slice(0, 3).join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)
    || "fork";
}
```

First **3 whitespace-delimited tokens**, lowercased, non-alphanumeric stripped, dashes
collapsed, trimmed to 24 chars. If empty after stripping (e.g., directive is all
punctuation), falls back to literal `"fork"`. Examples:

| Directive | Name |
|---|---|
| `deploy the staging branch` | `deploy-the-staging` |
| `fix bug #423` | `fix-bug-423` |
| `review PR 100 please` | `review-pr-100` |
| `🔥🔥🔥` | `fork` (fallback) |

### The `fork` subagent type (`ph`) — where it actually gets used

Critical correction: **only Path 1 uses `ph`**. The `tools: ["*"]`, `maxTurns: 200`,
`model: "inherit"`, `permissionMode: "bubble"` definition applies when the user types
`/fork`. Skill/command `context: "fork"` (Paths 2-3) uses whatever agent the frontmatter
specifies (or general-purpose), with that agent's own tool set and permission mode.

The `whenToUse` comment — "Not selectable via `subagent_type`; triggered by omitting
`subagent_type` when the fork experiment is active" — refers to a *hypothetical* Task
dispatcher fallback path. Grep for `selectedAgent: ph` in the bundle returns only the
`_a7` call site; no other code path ever resolves to the fork subagent type. If the
model calls Task without `subagent_type`, the existing fallback is `general-purpose`,
not `ph`. The fork-subagent-type is effectively a private implementation detail of the
`/fork` slash command, with infrastructure in place for broader dispatch that is not
yet wired up.

### Bridge reattach: `CLAUDE_BRIDGE_REATTACH_SESSION` / `CLAUDE_BRIDGE_REATTACH_SEQ`

Two new env vars appear in the bridge transport layer:

```js
let R = process.env.CLAUDE_BRIDGE_REATTACH_SESSION;
let W = process.env.CLAUDE_BRIDGE_REATTACH_SEQ;
if (R) {
  delete process.env.CLAUDE_BRIDGE_REATTACH_SESSION;
  delete process.env.CLAUDE_BRIDGE_REATTACH_SEQ;
}
let G = W ? Number.parseInt(W, 10) || void 0 : void 0;
```

Purpose: when a child process is re-spawned (e.g., the fork detaches and then the user
reattaches via the TUI), the session ID and sequence counter are passed in via env vars
and consumed exactly once. The `preSpawn` bridge lifecycle hook also **drops** these env
vars from the child's inherited environment (alongside `CLAUDE_CODE_TUI_JUST_SWITCHED`)
so a reattach context isn't accidentally inherited into further grandchildren.

Paired telemetry: `tengu_remote_attach_session_rejected` fires when a reattach fails.

### Keybinding

A new chord is registered in the query-ready shortcut table:

```js
dK.createElement(q_, { chord: "f", action: "fork" })
```

Pressing **`f`** (as a single-key chord when no other chord is pending) triggers
`/fork`'s interactive mode.

### Summary of `/fork` new surface

| Item | Value |
|---|---|
| Slash command | `/fork <directive>` (`isEnabled: iv`) |
| Subagent type | `"fork"` (implicit; tools `*`; maxTurns 200; inherit model; bubble perms) |
| Env var (enable) | `CLAUDE_CODE_FORK_SUBAGENT` (truthy = force-on) |
| GB flag | `tengu_copper_fox` (default `false`) |
| Env vars (reattach) | `CLAUDE_BRIDGE_REATTACH_SESSION`, `CLAUDE_BRIDGE_REATTACH_SEQ` |
| Telemetry | `tengu_fork_subagent_enabled`, `tengu_remote_attach_session_rejected` |
| Keybinding | `f` chord when ready |
| UI string | `"Fork started — processing in background"` |

## Rate-Limit / Subscription Overrides

Two new env vars feed directly into the OAuth token object:

```js
return {
  accessToken: …,
  refreshToken: …,
  expiresAt: …,
  scopes: ["user:inference"],
  subscriptionType: process.env.CLAUDE_CODE_SUBSCRIPTION_TYPE || null,
  rateLimitTier:    process.env.CLAUDE_CODE_RATE_LIMIT_TIER    || null
};
```

| Env var | Overrides |
|---|---|
| `CLAUDE_CODE_SUBSCRIPTION_TYPE` | Reported subscription type on the token object (defaults to `null`) |
| `CLAUDE_CODE_RATE_LIMIT_TIER` | Reported rate-limit tier on the token object (defaults to `null`) |

These are **set on the client-constructed token**, not pulled from the server. Purpose is
likely pre-launch testing of Pro-trial/subscription UI and rate-limit-tier code paths
without needing a real account in the right state. Together with the dark-launched
`/pro-trial-expired` (see L88) they form a test-hook surface for the Pro plan rollout.

Not a security boundary: the server still authoritatively knows your tier. But any
client-side UI that branches on `subscriptionType` or `rateLimitTier` (notifications,
upsells, warning banners) will respond to these overrides.

## `/schedule` Gains One-Time Scheduling

Description changed from:

- **v2.1.116:** `"Create, update, list, or run scheduled remote agents (triggers) that execute on a cron schedule."`

To (template literal):

- **v2.1.117+:** ``` `Create, update, list, or run scheduled remote agents (routines) ${H ? "on a cron schedule or once at a specific time" : "that execute on a cron schedule"}` ```

Two changes: **"triggers" → "routines"** (terminology shift), and a new one-time
scheduling capability gated on a runtime boolean `H`. The boolean likely reflects a GB
flag or server capability check — when it resolves true, users can schedule a single
future run (e.g., `/schedule at 2026-05-01T09:00 "task"`) rather than only recurring
crons.

## Removed: `/autocompact` and `/stop-hook`

Both commands are **removed outright** in v2.1.117 (not just disabled).

### `/autocompact` (gone)

Was in v2.1.116:
```js
{ name: "autocompact",
  description: "Configure the auto-compact window size",
  isEnabled: () => !S8(),   // interactive only
  isHidden: false,
  argumentHint: "[tokens|reset]",
  load: () => … }
```

Removed alongside its two telemetry keys:
- `tengu_autocompact_command` — command invocation
- `tengu_autocompact_dialog_opened` — dialog surface

Replacement path: auto-compact window is still configurable via `/config` settings UI or
the underlying setting key directly. Users had been able to set it via
`/autocompact [tokens]` or reset via `/autocompact reset`; these flows now route through
`/config`.

### `/stop-hook` (gone)

Was in v2.1.116 but already disabled:
```js
{ name: "stop-hook",
  description: "Set a session-only Stop hook with a quick prompt",
  immediate: true,
  isEnabled: () => false,
  load: () => … }
```

Gone entirely in v2.1.117 along with `tengu_stop_hook_command` and
`tengu_stop_hook_removed` telemetry. It had been a shelf-parked feature since at least
v2.1.92 (L57). Users wanting ad-hoc Stop hooks should configure them in
`.claude/settings.json` directly.

## Other v2.1.117 Observability Adds

Seven additional `tengu_*` identifiers landed without a corresponding new feature surface:

| Identifier | Measures | Likely purpose |
|---|---|---|
| `tengu_advisor_strip_retry` | `{query_source}` | Advisor Tool (L78) retry path: when the server rejects the request with specific wire markers, the client strips the advisor context and retries (`"retry:advisor-strip"` branch). |
| `tengu_byte_watchdog_fired_late` | `{idle_ms, late_ms, readable_errored}` | Byte watchdog (L74) fires >=1000ms after its idle timeout expired — indicates the event loop stalled. Used to detect host-level scheduling issues. |
| `tengu_team_artifact_tip_shown` | Tip display | Onboarding tip for the team-memory artifact surface (L62). |
| `tengu_tussock_oriole` | GB flag? | Unknown — the opaque codename suggests a GrowthBook flag, but no gated-off feature is wired up in this release. |
| `tengu_amber_redwood2` | GB flag | Version bump of `tengu_amber_redwood` (a canary-channel flag, per L84). Old flag removed simultaneously. |

The `tengu_mcp_concurrent_connect` flag (L86) is **removed** in v2.1.117, suggesting the
parallel-MCP-connect experiment either became default behavior or was rolled back.

## Surface Summary v2.1.117

| Category | v2.1.116 → v2.1.117 |
|---|---|
| Env vars | +3 (`CLAUDE_CODE_FORK_SUBAGENT`, `CLAUDE_CODE_RATE_LIMIT_TIER`, `CLAUDE_CODE_SUBSCRIPTION_TYPE`) |
| Slash commands | +1 (`/fork`); -2 (`/autocompact`, `/stop-hook`); 1 description changed (`/schedule`) |
| Subagent types | +1 (`fork` — implicit, not user-selectable via `subagent_type`) |
| Hook event types | 0 |
| API beta strings | 0 |
| Keybindings | +1 (`f` chord → fork) |
| GB feature flags | +2 (`tengu_copper_fox`, `tengu_amber_redwood2`); -2 (`tengu_amber_redwood`, `tengu_mcp_concurrent_connect`) |
| Telemetry events | +6 (`tengu_advisor_strip_retry`, `tengu_byte_watchdog_fired_late`, `tengu_fork_subagent_enabled`, `tengu_remote_attach_session_rejected`, `tengu_team_artifact_tip_shown`, `tengu_tussock_oriole`) |
| Removed surface | 4 (`/autocompact`, `/stop-hook`, `tengu_autocompact_*` ×2, `tengu_stop_hook_*` ×2) |

---

# LESSON 88 -- v2.1.118 `/cost` + `/stats` → `/usage` ALIASES, `cache-diagnosis-2026-04-07`, FRONTMATTER SHADOW VALIDATOR, WIF OAUTH LOCKING

## `/cost` and `/stats` Folded Into `/usage`

In v2.1.118 the standalone registrations for `/cost` and `/stats` are **deleted**. The
`/usage` command absorbs both as aliases, and gains **two registrations** for interactive
vs non-interactive contexts:

### Interactive registration (TUI)

```js
{ name: "usage",
  aliases: ["cost", "stats"],
  description: "Show session cost, plan usage, and activity stats",
  thinClientDispatch: "control-request",
  requires: { ink: true },
  … }
```

- Requires ink (TUI).
- Uses `thinClientDispatch: "control-request"` — routed through the remote control plane
  in thin-client (cloud) deployments.
- Description emphasizes the **unified view** (plan usage + activity stats — what `/stats`
  used to show).

### Non-interactive registration (headless)

```js
{ name: "usage",
  aliases: ["cost", "stats"],
  supportsNonInteractive: true,
  description: "Show the total cost and duration of the current session",
  isEnabled: () => S8(),
  get isHidden() { return !S8() },
  … }
```

- `S8()` returns `!x_.isInteractive` — true when we're in non-interactive mode.
- Description matches what `/cost` used to say.
- `supportsNonInteractive: true` — scriptable via `claude -p "/usage" …`.

### Dispatch table

| Invocation | Context | Which `/usage` runs |
|---|---|---|
| `claude` then `/usage` | Interactive TUI | Interactive registration (ink dashboard) |
| `claude` then `/cost` / `/stats` | Interactive TUI | Interactive registration (aliases resolve) |
| `claude -p "/usage" …` | Headless | Non-interactive registration (cost + duration string) |
| `claude -p "/cost" …` | Headless | Non-interactive registration (aliases resolve) |

### Migration implications

- **Scripts using `/cost`** continue to work — alias resolution happens at the command
  registry, not at the caller.
- **Scripts using `/stats`** continue to work (also an alias), but the output surface
  shifts: what you get depends on context. In headless mode you now get just "cost and
  duration", not "usage statistics and activity" (which requires TUI).
- Help listings (`/help`) show `/usage` only; aliases are no longer listed as distinct
  commands. Users expecting to find `/cost` via autocomplete will need to type `/u`.

The five telemetry keys `tengu_autocompact_command`, `tengu_autocompact_dialog_opened`,
`tengu_stop_hook_command`, `tengu_stop_hook_removed` were already gone in v2.1.117; no
`/cost`- or `/stats`-specific telemetry was removed in v2.1.118 because these were UI-only
entries.

## `/autofix-pr` Deremoted from Remote

Description changed:

- **v2.1.117:** `"Spawn a remote Claude Code session that monitors and autofix"` (truncated
  match)
- **v2.1.118:** `"Monitor and autofix any issues with the current PR"`

The "remote session" framing is gone. This is consistent with the Chapter 17 Remote
Workflow Commands sunset (L85) — `/autofix-pr` (L73, CCR v2 plumbing) is being repositioned
as a local-first command that can optionally use remote compute rather than one that
spawns a remote session by default.

Underlying mechanism may or may not have changed — the description is part of the command
registry only. The L73 lesson on `/autofix-pr` + CCR v2 still applies for the execution
path; inspect the command's `load` function in a future release if runtime behavior
appears to have shifted.

## `/pro-trial-expired` (Dark-Launched)

New slash command, disabled:

```js
{ name: "pro-trial-expired",
  description: "Options shown when the Pro plan Claude Code trial has ended",
  isEnabled: () => false,
  … }
```

Paired telemetry: `tengu_pro_trial_expired_choice`.

Currently inert (`isEnabled: () => false`, like `/buddy` was date-gated). When enabled,
this is the **upsell/renewal UI** that appears when a user's Pro plan trial has expired —
offering choices (upgrade, extend, continue-free-tier, etc.). The telemetry key is
`_choice` (singular) implying a single tracked selection.

Combined with the `CLAUDE_CODE_SUBSCRIPTION_TYPE` env var override from L87, there is now
a full test-surface for Pro-trial-expired scenarios without needing a real account in
that state.

## New API Beta: `cache-diagnosis-2026-04-07`

A new beta header:

```
anthropic-beta: cache-diagnosis-2026-04-07
```

Purpose: **prompt cache diagnostics**. When enabled, the server returns additional
diagnostic information about cache hit rate, cache block structure, and cache read
efficiency in response metadata.

### Graceful degradation on server reject

```js
if (r && sj9(lH)) {
  r = false;
  UD_(false);
  V("[cache-diagnosis] server rejected beta — dropping", { level: "info" });
}
```

`sj9(lH)` inspects the server response for a specific rejection marker (likely a beta-not-
granted error or unknown-beta warning). When triggered:
1. Set the in-memory flag `r` to false.
2. Persist the decision via `UD_(false)` so subsequent requests omit the beta.
3. Log an info-level message.

This means a single rejection disables the beta for the remainder of the session —
preventing repeated header injection that would bloat logs.

Paired telemetry: `tengu_prompt_cache_diagnostics`.

### Who can use it

Like other `*-2026-*` betas, access is gated server-side by account allowlist. The client
sends the header opt-in (no env var or config flag currently surfaces this — it's enabled
by default in v2.1.118 for accounts on the allowlist, and no-ops for others).

## Frontmatter Shadow Validator

A new pattern for skill/agent/output-style frontmatter validation: **shadow-validate silently,
emit dedup'd telemetry, fail open**.

### The correction that matters

There **is no formal primary schema**. The primary path for skill/agent/output-style
frontmatter is **imperative field extraction** — `Cz8(frontmatter, content, name, kind)`
for skills and custom commands, and peer functions for agents and output-styles. These
functions read properties off the YAML-parsed object directly and coerce with JS:

```js
// Inside Cz8 (skill/command primary processor)
displayName: H.name != null ? String(H.name) : void 0,
description: T,                    // from cE(H.description, q) — coerced + null-safe
allowedTools: Jn(H["allowed-tools"]),
argumentHint: H["argument-hint"] != null ? String(H["argument-hint"]) : void 0,
whenToUse: H.when_to_use != null ? String(H.when_to_use) : void 0,
executionContext: H.context === "fork" ? "fork" : void 0,
effort: Y !== void 0 ? Cl(Y) : void 0,
createdBy: H.created_by === "dream-proposal" || H.improved_by === "dream-proposal"
           ? "dream-proposal" : void 0,
…
```

Unknown keys are silently **ignored** (never read by the extractor). Most type mismatches
are silently **coerced** (`String(H.name)`). The only hard rejection path in the primary
loader is an explicit precondition check — e.g., skills without a string `description`
log `Skill file ${path} is missing required 'description' in frontmatter` and return
null.

So: **the Zod schemas added in v2.1.118 are the *only* formal validation that exists**.
They run after YAML parse, before primary processing, purely for observability.

### The validator function

```js
function pjH(H, _) {          // H = kind: "skill"|"agent"|"output-style"; _ = YAML-parsed object
  try {
    let q = qT1[H]().strict().safeParse(_);
    if (q.success) return;
    for (let K of q.error.issues)
      if (K.code === "unrecognized_keys")
        for (let O of K.keys)
          Zj9("tengu_frontmatter_shadow_unknown_key", H, O);
      else {
        let O = String(K.path[0] ?? "");
        Zj9("tengu_frontmatter_shadow_mismatch", H, `${O}:${K.code}`);
      }
  } catch {}
}
```

Three operational details:

1. **`.strict()` is applied at call site.** The schema objects themselves are
   `N.object({...})` (non-strict — unknown keys allowed). `.strict()` is added inside
   `pjH` to turn unknown-key acceptance into an error. This means the same schema could
   be reused as non-strict elsewhere; today it is not.
2. **`safeParse`, not `parse`.** Zod's non-throwing API — failures live in the returned
   `error.issues` array instead of raising.
3. **`try { … } catch {}` envelope.** If the validator itself throws (malformed schema,
   bundler issue), skill loading is unaffected.

### The dispatch table

```js
qT1 = {
  skill:          eO1,   // skill schema (extends command schema)
  agent:          HT1,   // standalone agent schema
  "output-style": _T1    // output-style schema
}
```

**Three entries — no `"command"` entry.** Custom slash commands are validated via
`pjH("skill", frontmatter)` against `eO1`, which is a *superset* of the pure-command
schema (`tO1`). This means a custom command declaring skill-only fields like
`when_to_use` or `paths` will not shadow-fail.

### Per-session dedup: `Gj9`

The telemetry emitter `Zj9` is gated on a session-scoped Set:

```js
function Zj9(H, _, q) {
  let K = `${H}:${_}:${q}`;         // event + surface + detail
  if (Gj9.has(K)) return;           // already reported this tuple
  Gj9.add(K);
  Q(H, { surface: _, detail: q });
}
// var Gj9 = new Set()
```

So a skills directory with 50 skills all carrying the same unknown key emits **one**
event, not 50. Same applies across reloads during a single session. A fresh process
starts with an empty `Gj9`.

Operational consequence: telemetry volume is proportional to **distinct drift patterns**,
not to skill count — exactly what you want for server-side analysis of which keys drift.

### The four schemas (complete)

Two helper types recur:

| Helper | Definition | Meaning |
|---|---|---|
| `ml6` / `NM` / `Z__` | `union([string, number, boolean, null])` | "scalar" — any primitive |
| `gyH` | `union([ml6, array<string>])` | scalar-or-string-array (CSV-or-YAML-list pattern) |

#### `tO1` — slash-command base (reachable only via `eO1.extend()`)

```js
tO1 = N.object({
  name:                       NM().optional(),  // Display name; defaults to filename
  description:                NM().optional(),  // One-line summary
  model:                      NM().optional(),  // haiku|sonnet|opus|inherit|<id>
  "allowed-tools":            gyH().optional(), // Tools CSV or YAML list
  "argument-hint":            NM().optional(),  // Placeholder text after command name
  arguments:                  gyH().optional(), // @internal typed variant of argument-hint
  "disable-model-invocation": Z__().optional(), // true = users only, no model invoke
  "user-invocable":           Z__().optional(), // false = hidden from users
  effort:                     NM().optional(),  // low|medium|high|max|<integer>
  shell:                      NM().optional(),  // bash|powershell
  version:                    NM().optional()   // @internal bookkeeping
})
```

All fields optional; all scalar or scalar-or-string-array. **11 keys.**

#### `eO1` — skill (`tO1().extend(...)`)

All of `tO1` plus:

```js
eO1 = tO1().extend({
  when_to_use:  NM().optional(),                                      // Guidance for model
  paths:        gyH().optional(),                                     // Glob patterns
  hooks:        N.unknown().optional(),                               // settings.json hooks shape
  context:      N.enum(["inline", "fork"]).nullable().optional(),     // Execution context (L87)
  agent:        NM().optional(),                                      // Agent type when context:fork
  created_by:   NM().optional(),                                      // @internal provenance
  improved_by:  NM().optional(),                                      // @internal provenance
  mcpServers:   N.unknown().optional(),                               // @internal
  lspServers:   N.unknown().optional(),                               // @internal
  agents:       N.unknown().optional(),                               // @internal
  outputStyles: N.unknown().optional(),                               // @internal
  channels:     N.unknown().optional(),                               // @internal
  monitors:     N.unknown().optional(),                               // @internal
  settings:     N.unknown().optional()                                // @internal
})
```

**11 base + 14 skill-specific = 25 keys.** Note: `context` is the only typed enum
(`"inline" | "fork"`) — any other string fires `invalid_enum_value` mismatch telemetry.

#### `HT1` — agent (standalone, does NOT extend tO1)

```js
HT1 = N.object({
  name:            NM().describe(...),                    // REQUIRED — how Agent tool addresses it
  description:     NM().describe(...),                    // REQUIRED — when to use, shown in listing
  model:           NM().optional(),                       // haiku|sonnet|opus|inherit|<id>
  tools:           gyH().optional(),                      // Replaces default tool set
  disallowedTools: gyH().optional(),                      // Removes from default (ignored if `tools` set)
  color:           NM().optional(),                       // @internal display color
  effort:          NM().optional(),
  permissionMode:  NM().optional(),                       // Permission mode
  mcpServers:      N.unknown().optional(),                // MCP servers on run
  hooks:           N.unknown().optional(),                // Hooks for this agent
  maxTurns:        N.union([N.number(), N.string(), N.null()]).optional(),
  skills:          gyH().optional(),                      // Preloaded skills
  initialPrompt:   NM().optional(),                       // Auto-submitted first message (main-session only)
  memory:          NM().optional(),                       // user|project|local
  background:      Z__().optional(),                      // Background by default
  isolation:       NM().optional()                        // worktree
})
```

**16 keys.** Two **required** — `name` and `description`. Missing either fires
`invalid_type` (code `too_small` / `invalid_type_undefined`) shadow telemetry **before**
the primary loader's own missing-description check runs. Note the camelCase: `disallowedTools`,
`mcpServers`, `maxTurns`, `initialPrompt`, `permissionMode` — deliberate divergence from
the skill schema's kebab-case (`allowed-tools`, `argument-hint`). Mixing styles fires
shadow telemetry.

#### `_T1` — output-style

```js
_T1 = N.object({
  name:                        NM().optional(),
  description:                 NM().optional(),
  "keep-coding-instructions":  Z__().optional(),   // Keeps default coding instructions in prompt
  "force-for-plugin":          Z__().optional()    // @internal — plugin-bundled styles only
})
```

**4 keys.** All optional.

### Where `pjH` is called

Four call sites, all during file-system discovery:

```js
pjH("skill",        frontmatter)   // Skills loader (recursive SKILL.md scan)
pjH("skill",        frontmatter)   // Custom-command loader (.claude/commands/*.md)
pjH("agent",        frontmatter)   // Agent-file loader
pjH("output-style", frontmatter)   // Output-style iterator
```

Not hooked into: plugin.json, mcp.json, settings.json, memory files. Those have their
own dedicated (non-shadow) parsers.

### Known drift points — what will fire telemetry today

The notable gap is **`progressMessage`**. Per L11 (v2.9.1 deep-dive), progressMessage is
an object-level field on the command/skill descriptor — **not a frontmatter field** —
and no YAML parser path writes it today. But the field name is surfaced in internal
documentation and in safe-properties allowlists, so any skill author who tries it
aspirationally (`progressMessage: "analyzing your codebase"`) will:

1. **Get no behavior** (the primary extractor doesn't read it).
2. **Fire `tengu_frontmatter_shadow_unknown_key`** on first load per session.

Watch list: if `progressMessage` graduates to a real YAML-sourced field (L11's "likely
history" speculation that `c47` will be re-wired to emit `<progress-message>`), `eO1`
will need to be extended to include it — and today's shadow-telemetry signal is probably
the very data Anthropic uses to decide when and how.

Other likely drift sources:

| Pattern | Why it fires |
|---|---|
| `allowedTools` (camelCase) in a skill | Schema uses `allowed-tools` (kebab) |
| `argumentHint` in a skill | Schema uses `argument-hint` |
| `disableModelInvocation` / `userInvocable` in a skill | Schema uses kebab-case |
| `allowed-tools` (kebab) in an agent | Agent schema uses `tools` (not `allowed-tools`) |
| `when_to_use` or `paths` in an **agent** | These are skill-only; absent from `HT1` |
| Any `tool-*`, `model-*`, `custom-*` author conventions | Unknown keys — fire as unknown |
| `context: "background"` or anything other than `inline`/`fork` | Enum mismatch |
| `maxTurns: "200"` in an agent | Accepted (union of number|string|null); no fire |
| `allowed-tools: "Read, Grep"` as a comma-string | Accepted (`gyH` scalar branch); no fire |

Type-mismatch telemetry is unlikely in practice because `ml6` (scalar union) accepts
`string | number | boolean | null` — YAML naturally produces these and most wrong-shape
values coerce silently. The dominant telemetry source will be **unknown keys**.

### Why this matters

This is **the groundwork for a future strict-mode**. Anthropic can now:

1. Count how many real-world installations have unknown keys or type mismatches.
2. See **which** keys drift most often (via the key name in the telemetry payload) —
   `Gj9` dedup makes this signal clean (one event per unique drift).
3. Decide whether to promote specific keys from "allowed but unknown" to "documented
   alias" (e.g., accept both `allowedTools` and `allowed-tools`) — or to reject
   outright in a strict mode.

If you author skills and maintain a fleet: run your frontmatter through the `eO1`/`HT1`
schemas now, because today's `tengu_frontmatter_shadow_unknown_key` signals may become
hard load-failures in a later release. The schema is frozen in the v2.1.118 bundle; the
tables above are the canonical source until Anthropic documents the shadow schema
publicly.

## WIF User-OAuth Locking

### Two-release attribution

The locking **mechanism** landed in **v2.1.117** — `Vk4` (retry loop), `Gv_` (wrapper),
`RY` (lock helper), and the `tvq = 5` retry constant all appear in the v2.1.117 bundle.
The **telemetry** emitting around it landed in **v2.1.118** — all four
`tengu_wif_user_oauth_lock_*` events plus `tengu_oauth_token_refresh_lock_release_error`
and `tengu_oauth_401_recovered_from_disk` are new in v2.1.118.

So users upgrading from v2.1.116:
- v2.1.117 **silently** got correctness: refresh races stopped cascade-failing
  concurrent Claude Code processes.
- v2.1.118 **observably** got the same behavior plus telemetry that an operator can
  trace when things go wrong.

The mechanism details below apply to v2.1.117+; the telemetry column applies to v2.1.118+.

### The scenario

Two Claude Code processes on the same machine share a refresh token on disk. Both
detect the token is about to expire and race to refresh it. Without locking:

1. Process A reads `refresh_token=T1`, exchanges for `access_token=A1` and new
   `refresh_token=T2`, writes T2 to disk.
2. Process B reads `refresh_token=T1` (before A wrote T2), exchanges — **401, T1 already
   used**.
3. Process B's session breaks even though the account is fine.

### The mechanism: `proper-lockfile` directory lock

The lock uses the `proper-lockfile` npm package (evidenced by the `ELOCKED` error code
and the `{lockfilePath || ${H}.lock}` path convention in the bundled helper). The lock
is a **directory-level mutex** — not a file-level advisory lock:

```js
// Gv_(fn, credentialsPath): wraps an async function with the refresh lock
function Gv_(H, _) {
  let q = evq.dirname(_);                   // lock the DIRECTORY, not the file
  return async (K) => {
    let O = await Vk4(q);                   // acquire (with retries)
    try {
      Q("tengu_wif_user_oauth_lock_acquired", {});
      return await H(K);                    // run the wrapped refresh
    } finally {
      Q("tengu_wif_user_oauth_lock_released", {});
      try { await O(); } catch (T) { wH(T); }   // release; log but swallow errors
    }
  };
}
```

Key detail: `evq.dirname(_)` — the lock is taken on the **containing directory** of the
credentials file (typically `<config_dir>/credentials/` for OIDC user-OAuth profiles,
see L86). This serializes *all* credentials operations across profiles in that dir, not
just one file. Two processes refreshing different profiles in the same dir will block
each other.

Under the hood, `proper-lockfile` implements the mutex as `<dir>.lock/` — it
`mkdir`s a sibling directory; `mkdir` is atomic on POSIX filesystems, so the first
process wins. Stale-lock detection uses `mtime` probing. This works across NFS/SMB (where
`fcntl` advisory locks are unreliable); it **fails** on filesystems that don't support
`mkdir` atomicity (certain exotic network stores).

### The retry loop: `Vk4`

```js
async function Vk4(H) {
  for (let _ = 0; ; _++) {
    try {
      return await RY(H, { onCompromised: (q) => wH(q) });
    } catch (q) {
      if (q.code !== "ELOCKED") throw q;          // unexpected errors bubble
      if (_ >= tvq) {                             // tvq = 5
        throw Q("tengu_wif_user_oauth_lock_retry_limit", { attempt: _ }),
              new e5(`Could not acquire credentials lock at ${H} after ${tvq} retries`);
      }
      Q("tengu_wif_user_oauth_lock_retry", { attempt: _ });
      await B8(1000 + Math.random() * 1000);      // 1000-2000ms jittered backoff
    }
  }
}
```

Concrete numbers:

| Parameter | Value |
|---|---|
| `tvq` (max retries) | **5** |
| Backoff per retry | **1000–2000 ms** uniform random (`1000 + Math.random() * 1000`) |
| Max total wait | ~**10 s** (5 retries × up to 2s each, worst case) |
| Min total wait | ~**5 s** (5 retries × 1s each, best case) |
| Final error class | `e5` (typed error) |
| Final error message | `"Could not acquire credentials lock at <path> after 5 retries"` |

**Only `ELOCKED` is retried** — any other error (filesystem, permission, disk-full)
bubbles immediately. This is deliberate: lock-held contention is the only recoverable
case; everything else signals a deeper problem.

### The `onCompromised` callback

`RY` (the inner helper) wraps `proper-lockfile.lock(path, opts)`:

```js
function RY(H, _) {
  let q = await oy6().lock(H, _);
  return Object.assign(q, { [Symbol.asyncDispose]: q });   // ES2022 `using` support
}
```

Two subtleties:

1. **`Symbol.asyncDispose` binding.** The lock's release function is re-attached as the
   dispose callback, so callers can use `await using lock = await RY(dir, opts)` and
   get automatic release at block exit.
2. **`onCompromised: wH`** (logger). `proper-lockfile` calls this when it detects the
   lock's `mtime` drifted (indicating another process force-deleted the lockfile or
   reset its mtime). The current holder logs the warning but **continues its critical
   section** — there's no recovery. A compromised lock means you could be writing
   concurrently with whoever stole it. The pattern says "log, keep going"; for WIF that
   is a pragmatic choice because the refresh operation is idempotent enough (either
   both writes succeed with the same new token, or the second one overwrites).

### Debugging `tengu_wif_user_oauth_lock_retry_limit`

If this fires, it means **another Claude Code process held the credentials lock for at
least 5 seconds**. That is unusual — a well-behaved refresh completes in <1s. Likely
causes:

1. **A stuck Claude Code process** — network hang during token exchange (firewalled egress,
   DNS timeout, ISP interception).
2. **A crashed Claude Code process** that held the lock and didn't clean up. On a cold
   start, the stale lockfile should be detected by `proper-lockfile`'s `stale` option
   (which defaults to 10s) and overridden — but if within that window, retries will see
   `ELOCKED`.
3. **Filesystem problem** — lockfile on NFS with broken `mkdir` semantics.

To investigate, on macOS/Linux:

```
lsof <config_dir>/credentials/.lock
ls -la <config_dir>/credentials/.lock
```

If a Claude Code PID holds it and hasn't moved for >5s, attach a debugger or `kill` the
holder and retry. Manual `rmdir <config_dir>/credentials/.lock` clears the lock if
nobody owns it — **safe only when you've confirmed no live holder**.

### Telemetry events (v2.1.118+)

| Event | Fires when | Payload |
|---|---|---|
| `tengu_wif_user_oauth_lock_acquired` | Lock acquired (post-retry) | `{}` |
| `tengu_wif_user_oauth_lock_released` | Lock released (normal path) | `{}` |
| `tengu_wif_user_oauth_lock_retry` | ELOCKED on acquire, retrying | `{ attempt }` |
| `tengu_wif_user_oauth_lock_retry_limit` | Exhausted 5 retries | `{ attempt }` (always 5) |
| `tengu_oauth_token_refresh_lock_release_error` | Release threw; error swallowed | `{}` |

### `tengu_oauth_401_recovered_from_disk` — the belt-and-suspenders path

A separate, non-locking reliability event. When a request returns 401 despite an
apparently valid in-memory token, the code rereads the credentials file from disk
(another process may have refreshed it while we held a stale cached copy) before giving
up. Fires when that disk re-read **successfully recovers**:

```js
let w = await GtH();   // re-read credentials from disk
if (w && w.accessToken !== T)
  return Q("tengu_oauth_token_refresh_race_recovered", {}), true;
return false;
```

Two telemetry events land in v2.1.118 for this path: `tengu_oauth_401_recovered_from_disk`
and the pre-existing `tengu_oauth_token_refresh_race_recovered` (not new — only newly
companioned). This is **backup coverage** for cases the lock can't catch: a sibling
process refreshed the token *between* the current process's in-memory cache load and the
outbound request, so the lock isn't contested — but the in-memory token is stale.

### Impact for users

- **Local multi-session**: Running two `claude` instances in different terminals on the
  same account works reliably under token-refresh timing.
- **CI / headless multi-worker**: Multiple `claude -p` worker processes sharing a
  credentials file no longer cascade-fail on a single refresh-race.
- **CCR v2 / daemon-mode (L85)**: The daemon-worker architecture benefits most — many
  short-lived worker processes off a long-lived token store.
- **Lock failure mode**: if all 5 retries fail (≥5s contention), the process throws
  — it does NOT silently fall through. Callers should handle the thrown `e5` error
  with the verbatim message above.

## Agent Stop Hook — New Telemetry, Pre-Existing Mechanism

v2.1.118 adds `tengu_agent_stop_hook_blocking`. Tracing the call site reveals an
**entirely new hook TYPE** that had shipped silently in earlier releases and was not
documented anywhere: an **AI verification hook** that runs its own sub-conversation to
decide whether the parent agent is allowed to stop. The mechanism (`bs7` function) is
present in v2.1.116; only the `_blocking`-outcome telemetry is new in v2.1.118.

### What it is

A hook config can now declare an AI-driven verification instead of (or alongside) the
traditional shell-command hook. When the event fires, Claude Code spawns a **dedicated
verification agent** whose only job is to return a structured verdict: `{ok: true}` (the
condition is met — allow the parent to proceed) or `{ok: false, reason: "..."}` (block
and report why).

### The `bs7` function — full mechanics

Signature: `bs7(H = hookConfig, _ = hookName, q = hookEvent, K = hookContext, O = signal,
T = parentToolUseContext, $ = toolUseId?, A = agentName?)`.

```js
async function bs7(H, _, q, K, O, T, $, A) {
  let z = $ || `hook-${randomUUID()}`;
  let Y = T.agentId ? dX(T.agentId) : ET();
  let w = UT(v_(), Y).resolvedPath;           // path to parent's transcript file
  let J = H.timeout ? H.timeout * 1000 : 60000;   // 60s default, configurable
  let L = ys7();                               // structured-output tool
  let h = [...T.options.tools
             .filter(c => !v4(c, GX))          // drop existing structured-output tool
             .filter(c => !d4H.has(c.name)),   // apply hook-agent denylist
           L];                                 // add the hook's own structured-output tool
  let E = (q === "Stop" || q === "SubagentStop")
    ? "You are verifying a stop condition in Claude Code. Your task is to verify that the agent completed the given plan."
    : `You are evaluating a ${q} hook in Claude Code. Your task is to evaluate the condition described in the user message.`;
  let C = $K([`${E} The conversation transcript is available at: ${w}
You can read this file to analyze the conversation history if needed.

Use the available tools to inspect the codebase and verify the condition.
Use as few steps as possible - be efficient and direct.

When done, return your result using the ${GX} tool with:
- ok: true if the condition is met
- ok: false with reason if the condition is not met`]);
  // ... spawn subagent with C as system prompt, H.prompt as user message,
  //     up to B=50 turns, mode "dontAsk", Read(transcript) auto-allowed
}
```

Key numbers and flags:

| Parameter | Value |
|---|---|
| Max turns in the hook's sub-conversation | **50** (constant `B`) |
| Default timeout | **60 s** (`60000` ms) |
| Timeout override | `hookConfig.timeout` in **seconds** |
| Model | `hookConfig.model` or default (`GJ()`) |
| Permission mode | `"dontAsk"` — hook agent never prompts |
| Auto-allowed tool | `Read(/<transcript-path>)` added to session rules |
| Thinking | Disabled (`thinkingConfig: {type: "disabled"}`) |
| Interactive mode | Forced off (`isNonInteractiveSession: true`) |
| Agent ID namespace | `${AK6}${randomUUID()}` — prefixed to distinguish from regular agents |

### The system prompt (verbatim)

For `Stop` / `SubagentStop` events:

```
You are verifying a stop condition in Claude Code. Your task is to verify that
the agent completed the given plan. The conversation transcript is available at:
<transcript-path>
You can read this file to analyze the conversation history if needed.

Use the available tools to inspect the codebase and verify the condition.
Use as few steps as possible - be efficient and direct.

When done, return your result using the <StructuredOutput-tool-name> tool with:
- ok: true if the condition is met
- ok: false with reason if the condition is not met
```

For any other event:

```
You are evaluating a <eventName> hook in Claude Code. Your task is to evaluate
the condition described in the user message. The conversation transcript is
available at: …
```

The hook's `prompt` field is passed as the **user message** — the agent evaluates it
against the transcript and available tools.

### The five outcomes

| Outcome | Trigger | Telemetry | Return value |
|---|---|---|---|
| `success` | Hook tool returned `{ok: true}` | `tengu_agent_stop_hook_success` | `{hook, outcome: "success", message}` |
| `blocking` | Hook tool returned `{ok: false, reason}` | **`tengu_agent_stop_hook_blocking`** ← NEW in v2.1.118 | `{hook, outcome: "blocking", blockingError: {blockingError: "Agent hook condition was not met: <reason>", command: H.prompt}}` |
| `cancelled` | Loop exceeded 50 turns | `tengu_agent_stop_hook_max_turns` | `{hook, outcome: "cancelled"}` |
| `cancelled` | Loop ended without structured output | `tengu_agent_stop_hook_error` (`errorType: 1`) | `{hook, outcome: "cancelled"}` |
| `non_blocking_error` | Thrown exception | `tengu_agent_stop_hook_error` (`errorType: 2`) | `{hook, outcome: "non_blocking_error", message}` |

All outcomes carry `{durationMs, turnCount, hookEvent, agentName}` in the payload.

### What v2.1.118 instruments that earlier versions didn't

Comparing hook-outcome telemetry coverage:

| Outcome | v2.1.116 | v2.1.118 |
|---|---|---|
| `success` | yes | yes |
| `max turns` | yes | yes |
| `error` | yes | yes |
| **`blocking`** | **no** | **yes** |

The absence of `_blocking` telemetry in earlier releases meant Anthropic had no direct
count of how often agent hooks actually blocked agents from stopping — they could only
infer it from the gap between `success` and the other outcomes. v2.1.118 closes that
observability hole. If you see `tengu_agent_stop_hook_blocking` firing more than you
expected, it means an agent hook is returning `ok: false` — check the hook's `reason`
field and the agent's final state at the recorded `turnCount`.

### Hook config shape (reconstructed)

Based on the fields accessed (`H.prompt`, `H.timeout`, `H.model`), an agent hook config is:

```yaml
# In an agent's hooks array (or settings.json "hooks"):
- type: agent               # presumably — distinguishes from shell-command hooks
  event: Stop               # or PreToolUse / PostToolUse / etc.
  prompt: "Verify the plan in the last user message has been completed."
  timeout: 120              # optional, seconds (default 60)
  model: sonnet             # optional, model override
```

The actual discriminator key (e.g., `type: "agent"` vs. `type: "command"`) is not
definitively visible in the `bs7` call site — the function receives an already-shaped
hook object. Confirm by searching your installed version's bundle for `hook.type` or
the dispatcher that decides between shell-hook and agent-hook execution.

### Implications for hook authors

- **Hooks are no longer just shell commands.** An agent hook can reason about the
  conversation transcript and the codebase using the same tools the parent agent had.
  This is powerful — a Stop hook can verify "all tests pass and no TODOs left" by
  actually running tests and grepping — but it's also **expensive** (up to 50 turns of
  LLM calls per hook invocation).
- **Timeouts matter.** Default 60s might be too tight for verification hooks that need
  to run test suites or do substantial codebase analysis. Override via `timeout: <seconds>`.
- **The transcript path is auto-allowed for Read.** The hook agent can always read
  `<transcript-path>` without triggering a permission prompt, via a session-scoped
  allowlist rule.
- **Compromised state on timeout.** If the 50-turn max or 60s timeout fires, the hook
  returns `cancelled` — neither blocking nor success. Whether the parent agent continues
  after `cancelled` depends on the caller's handling; verify per-event-type in your
  configuration.
- **No thinking budget.** Agent hooks run with thinking disabled (`thinkingConfig:
  {type: "disabled"}`), which means reasoning-heavy verification will be limited to
  tool-use chains without extended-thinking support.

## Frontmatter Shadow, WIF Locking — Context

Both are **pre-landing observability** work. The shadow validator is, today, the first
and only formal frontmatter schema in the codebase; the WIF locking is the first formal
multi-process coordination primitive on the credentials file. Neither ships user-visible
behavior — they ship measurements. Historically this pattern (land measurement, then land
the feature-enable that uses it) has led to behavior changes in subsequent releases.
Worth watching v2.1.119+ for:

- **Primary validation adopting the shadow schema.** Today `Cz8` reads properties off
  YAML objects imperatively; a natural next step is to route the primary loader through
  `qT1[kind]()` (non-strict) before imperative extraction. That still wouldn't reject
  unknown keys, but it would normalize types (turn a numeric `name` into a string before
  extraction) and enable the strict upgrade later.
- **Strict frontmatter mode** (e.g., `tengu_frontmatter_strict` GB flag) that promotes
  specific shadow errors — probably unknown-key mismatches for `progressMessage` and
  camelCase siblings first — to hard load failures.
- **Multi-process credential-manager consolidation** — a dedicated daemon that owns the
  refresh token and serves access tokens to child processes via socket, making the WIF
  advisory lock unnecessary.

## Removed Env Vars: `CLAUDE_CODE_AGENT_NAME`, `CLAUDE_CODE_TEAM_NAME`

Both gone in v2.1.118. Previously used for displaying the current agent/team in the UI
(L12 Teams/Swarm, L63 Script Caps). Replacement surface: agent/team context is now
derived from the session state via `standaloneAgentContext` (YY_()) and team-membership
via the team-memory subsystem — no env-var override remains.

If your workflow set these manually to label sessions: the label is now driven by the
session file's `agentName` field and the `TeamMemory` registry. Setting them in the
environment has no effect as of v2.1.118.

## Other v2.1.118 Observability Adds

15 additional `tengu_*` identifiers not covered above:

| Identifier | Likely meaning |
|---|---|
| `tengu_agent_stop_hook_blocking` | See dedicated "Agent Stop Hook" section above — AI verification hook returned `{ok: false, reason}` |
| `tengu_auto_mode_opt_in_dialog_decline_dont_ask` | "Don't ask again" checkbox on the Auto mode opt-in dialog |
| `tengu_ember_trail` | GB flag codename (unknown feature) |
| `tengu_keybindings_dom` | DOM-based keybinding surface — likely for the Desktop App (L48) |
| `tengu_mocha_barista` | GB flag codename (unknown feature) |
| `tengu_orchid_mantis` | GB flag codename (unknown feature) |
| `tengu_push_notif_upsell_notification_shown` | Push-notification upsell toast (pairs with L79 PushNotification) |
| `tengu_slate_kestrel` | GB flag codename (unknown feature) |
| `tengu_terminal_probe` | Terminal capability probing (e.g., xterm vs iTerm2 vs VSCode) |
| `tengu_warm_resume_hint_eligible` | When session resume would benefit from a warm hint — marble-origami plumbing (L69) |

Three telemetry events were **removed** in v2.1.118: `tengu_ccr_post_turn_summary` (the GB
flag it gated was removed — feature either shipped default-on or was rolled back),
`tengu_config_tool_changed`, `tengu_vscode_cc_auth` (VSCode-Claude-Code authentication
handshake — the `vscode_cc_auth` subsystem appears to have consolidated into the general
OAuth path).

## Surface Summary v2.1.118

| Category | v2.1.117 → v2.1.118 |
|---|---|
| Env vars | -2 (`CLAUDE_CODE_AGENT_NAME`, `CLAUDE_CODE_TEAM_NAME`) |
| Slash commands | +1 (`/pro-trial-expired` dark-launched); -3 (`/cost`, `/stats` folded into `/usage` aliases; `/schedule` a false-positive removal due to description template-literal); 2 description changes (`/autofix-pr`, `/usage`) |
| Hook event types | 0 |
| API beta strings | +1 (`cache-diagnosis-2026-04-07`) |
| GB feature flags | +4 codename flags (`tengu_ember_trail`, `tengu_mocha_barista`, `tengu_orchid_mantis`, `tengu_slate_kestrel`); -1 (`tengu_ccr_post_turn_summary` removed) |
| Telemetry events | +16 (shadow validator ×2, WIF OAuth lock ×4, OAuth 401 recover ×1, observability ×9); -2 (`tengu_config_tool_changed`, `tengu_vscode_cc_auth`) |
| Removed surface | `/cost` + `/stats` standalone (folded into `/usage` aliases — callers still work), 2 env vars, 3 telemetry events |

## Cross-References

- **L11 (Skills System)** — `context: "fork"` frontmatter field, already accepted in
  v2.1.116, now actually dispatches to the new `fork` subagent type (L87). The shadow
  validator (L88) also targets skill frontmatter — future strict mode will tighten L11's
  schema.
- **L29 (Permissions)** — `/fork`'s `permissionMode: "bubble"` matches `Task`'s; child
  permission prompts bubble up to the parent's UI.
- **L38 (OAuth)** — WIF user-OAuth locking (L88) hardens the refresh path; the
  multi-process race this fixes is a hazard this lesson describes in passing.
- **L73 (`/autofix-pr` + CCR v2)** — `/autofix-pr`'s description change in L88 signals a
  shift away from the "remote session" framing; the command remains but is being
  repositioned.
- **L74 (Byte Watchdog)** — `tengu_byte_watchdog_fired_late` (L87) measures the stall
  cases the byte watchdog catches late.
- **L78 (Advisor Tool)** — `tengu_advisor_strip_retry` (L87) is a new retry path in the
  Advisor Tool wire protocol.
- **L85 (v2.1.113 Remote Workflow sunset)** — `/autofix-pr`'s description change in L88
  continues the same direction: less emphasis on "spawn remote session", more on "local
  command with optional remote compute".
- **L86 (OIDC Federation)** — the WIF OAuth locking in L88 hardens the token-refresh path
  that OIDC Federation also uses (both share `<config_dir>/credentials/<profile>.json`).

## What to watch for next

- **`tengu_copper_fox` flipping on by default** — when the `/fork` experiment graduates,
  the `CLAUDE_CODE_FORK_SUBAGENT` env var override becomes moot. Description + keybinding
  will likely move out of "experiment" framing in a release announcement.
- **Strict frontmatter mode** — the shadow validator (L88) is telemetry-only today and
  the Zod schemas are the only formal validation that exists (primary handling is
  imperative via `Cz8`). A future release may route the primary path through the same
  schemas non-strict (normalizing types) and then promote unknown-key rejection for
  specific keys. The most likely first casualty is `progressMessage` — documented in L11
  but absent from `eO1` — which will silently emit telemetry today but could become a
  hard load failure.
- **`/pro-trial-expired` enable date** — currently `isEnabled: () => false`. When the
  date-gate flips (or when a GB flag enables it), pre-existing trials will start seeing
  the expiry UI. Combined with the `CLAUDE_CODE_SUBSCRIPTION_TYPE`/`…_RATE_LIMIT_TIER`
  env vars, this is test-groundwork for a Pro plan trial rollout.
- **Cache diagnostics tooling** — `cache-diagnosis-2026-04-07` is a server-granted beta.
  A CLI surface (e.g., `/usage --cache` or a `claude debug cache` subcommand) is the
  natural next step; not present in v2.1.118.
- **Removed `tengu_mcp_concurrent_connect`** (in v2.1.117) — parallel MCP connect likely
  became default behavior. Verify in the next MCP-boot benchmark: connect time should
  have dropped from linear in server count to roughly constant.
