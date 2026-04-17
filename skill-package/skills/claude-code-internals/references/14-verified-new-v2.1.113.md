Updated: 2026-04-18 | Source: Binary extraction from claude v2.1.112/v2.1.113

# Chapter 17: Verified New in v2.1.112–v2.1.113 (Source-Confirmed)

> **Provenance:** Direct binary extraction and structured diffing of v2.1.112 and v2.1.113
> bundles against the v2.1.111 baseline. v2.1.112 produced no material changes to env
> vars, slash commands, hook event types, or API betas (bugfix/refactor-only release).
> v2.1.113 is where the visible surface moved.

> **Narrative for this chapter — v2.1.113 is a direction correction.** Chapter 16 framed
> v2.1.110–v2.1.111 as "the binary thins, the server thickens," with Remote Workflow
> Commands as the headline expression of that pattern. v2.1.113 **partially reverses that
> arc.** Four threads run through the release, and they add up to a course change rather
> than a continuation:
>
> 1. **Retreat from surfaced remote orchestration.** All five Remote Workflow Commands
>    (`/autopilot`, `/bugfix`, `/dashboard`, `/docs`, `/investigate`) were removed outright —
>    zero residual occurrences in the bundle, no feature-flag gate, no deprecation shim.
>    The CCR v2 back-end (L73, `$X4()`, `CLAUDE_CODE_USE_CCR_V2`, `allow_remote_sessions`,
>    L60 `/autofix-pr`) survived unchanged; only the user-facing command surface was pulled.
>    Anthropic tried the "slash command spawns a cloud session" pattern, watched it, and
>    backed off after <3 release cycles.
> 2. **Pivot toward local-daemon mode.** `CLAUDE_BG_BACKEND=daemon` gives the binary three
>    daemon-process traits at once — SIGHUP is ignored, stdout EIO/EPIPE is latched
>    instead of thrown, the TTY-orphan-detector interval is bypassed. Paired with the
>    consumer-less `autoAddRemoteControlDaemonWorker` user setting (no code path reads it
>    in this bundle), this sketches a different surfacing of headless execution:
>    *the local binary hosts the session and survives terminal detachment, attached to
>    via the Remote Control bridge (L37)*, rather than *the cloud hosts the session and
>    the CLI dispatches to it*. Same destination (unattended operation), inverted
>    architecture.
> 3. **Reliability instrumentation blitz.** Three distinct watchdogs landed in one release
>    (async-agent stall, SDK session stall-reset, MCP transport-drop), plus four new
>    observational telemetry events covering prior-session crashes, image-pipeline
>    failures, `/update` refusals, and the new timestamps setting toggle. This is the
>    instrumentation a codebase preparing for long-running unattended execution needs —
>    daemons require supervision because nobody is watching live. Consistent with thread 2.
> 4. **`/update` is being prepared for launch.** The command has been disabled for 12
>    release cycles (since v2.1.101, L68). v2.1.113 actively edited its body, adding two
>    refusal paths that emit `tengu_update_refused` (active-tasks and transcript-path-drift).
>    The refusal conditions reveal the safety constraints the GA version will enforce.
>    In-place upgrade is the missing piece for a long-running daemon worker that should
>    survive its own upgrade without a restart.
>
> **Net read:** Claude Code is in architectural flux between three postures — classic
> interactive CLI, thin client dispatching to cloud sessions (L77's short life), and
> persistent local daemon. None is the settled state. Treat slash commands introduced
> in the most recent release as **experimental surface, not a stable contract**: the
> v2.1.110→v2.1.113 cycle is precedent for "ship a command, remove it two releases later."
>
> See the "Daemon-mode thread" cross-reference cluster below (L85 + L37 + L43 + L73) for
> the related-lessons path if you're trying to understand where this architecture is
> heading.

---

## TABLE OF CONTENTS

85. [Lesson 85 -- v2.1.112–v2.1.113 Command & Env Var Changes (Remote Workflow Sunset)](#lesson-85----v21112v21113-command--env-var-changes)

---

# LESSON 85 -- v2.1.112–v2.1.113 COMMAND & ENV VAR CHANGES

Catch-all for all observable surface changes landed in v2.1.112 and v2.1.113. v2.1.112
is a no-op for this chapter (bundle diff shows zero additions/removals across env vars,
slash commands, hook event types, and API beta strings). Everything below is v2.1.113.

## Remote Workflow Sunset (supersedes L77)

**Removed commands (all gone in v2.1.113):**

| Command | Removed-in | Prior role (see L77) |
|---------|-----------|----------------------|
| `/autopilot` | v2.1.113 | Spawn CCR v2 session that runs the autopilot workflow |
| `/bugfix` | v2.1.113 | Spawn CCR v2 session that reproduces/root-causes/fixes a bug |
| `/dashboard` | v2.1.113 | Spawn CCR v2 session that builds a dashboard from data sources |
| `/docs` | v2.1.113 | Spawn CCR v2 session that writes/updates a feature's docs |
| `/investigate` | v2.1.113 | Spawn CCR v2 session that root-causes an incident |

All five commands shared the `jA5`/`YA5()` registration/dispatch pair documented in L77.
Both symbols are gone: no references to `"autopilot"`, `"bugfix"`, `"dashboard"`, `"docs"`,
or `"investigate"` as slash-command registrations remain in the v2.1.113 bundle. There is
no feature-flag gate hiding them; the code was deleted.

`/autofix-pr` (L60, v2.1.94) is **not affected** — it is a different remote-workflow
command, gated independently by the `allow_remote_sessions` GrowthBook flag, and remains
registered in v2.1.113.

**What stays:** CCR v2 infrastructure itself (L73 multi-repo checkout, `$X4()` gate,
`CLAUDE_CODE_USE_CCR_V2` env var, `allow_remote_sessions` flag) is all still in the
bundle. Only the five user-facing commands were removed. The back-end remote session
machinery survives — which is consistent with Anthropic pruning a command surface that
didn't land, while keeping the scaffolding for future experiments.

**Why this matters:** L77 was the clearest example in the Chapter 16 narrative of
"binary thins, server thickens" (the CLI as a thin client spawning remote sessions).
Its removal after one release cycle signals the product team backed off that
surfacing — the capability exists, but it's not being exposed through top-level slash
commands. Treat L77 as historical context for what v2.1.110–v2.1.112 shipped.

## Renamed Command: `/less-permission-prompts` → `/fewer-permission-prompts`

The ~3.5KB methodology prompt command introduced in v2.1.111 (L84) was renamed in
v2.1.113. The new name is `/fewer-permission-prompts`. The description is identical
character-for-character to the old one; only the command name string changed in the
registration. Grammatically "fewer" is the correct quantifier for discrete permission
prompts.

**Migration impact:** any hooks, aliases, or user docs referring to the old name will
break. The unknown-command did-you-mean helper (`_a5()`, L84) should suggest the new
name via Fuse-style fuzzy match since the strings share 18 of 22 characters.

## Description Tweaks

| Command | Old description | New description |
|---------|-----------------|-----------------|
| `/compact` | "Clear conversation history but keep a summary in context. Optionally provide instructions to focus the summary on." | "Free up context by summarizing the conversation so far" |
| `/exit` | "Exit the REPL" | "Exit the CLI" |

Both are cosmetic — they do not change behavior. `/exit` still has alias `quit`,
`immediate: true`, and still dispatches through `kB7`. The `/exit` rewording aligns with
the v2.1.109 removal of REPL mode branding (L75 notes the REPL Screen was
non-user-facing). `/compact` is now described by its user benefit ("free up context")
rather than its mechanism ("summarize + clear"), though the optional
`argumentHint: "<optional custom summarization instructions>"` is unchanged.

## New Environment Variables

| Env Var | Default | Purpose |
|---------|---------|---------|
| `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` | `600000` (10 min) | Watchdog timeout on async agents. Parsed via `parseInt(env, 10) || 600000`. When no progress message arrives within the timeout, fires `tengu_async_agent_stall_timeout` telemetry (with `agent_type`, `stall_ms`, `last_message_type`, `message_count`), aborts the agent signal, and surfaces a stall error. See "Async Agent Stall Watchdog" below for the full progress-reset mechanism. |
| `CLAUDE_BG_BACKEND` | unset | Daemon-mode gate. When exactly `"daemon"` (`process.env.CLAUDE_BG_BACKEND==="daemon"`), three behaviors flip: (1) `bQ4()` returns true so the background stdout writer latches EIO/EPIPE into `L_9` instead of throwing; (2) SIGHUP is ignored (logged as `SIGHUP_ignored_bg` via `$6("info","shutdown_signal", ...)`) instead of exiting with code 129; (3) the TTY-orphan detector 30s `setInterval` (which checks `process.stdout.writable && process.stdin.readable` and exits if either drops) is skipped. Net effect: the process is designed to survive parent-shell detachment. Pairs with the new `autoAddRemoteControlDaemonWorker` user setting (see "New User Settings" below). |
| `CLAUDE_CODE_BS_AS_CTRL_BACKSPACE` | platform-dependent | Treat the backspace key as Ctrl+Backspace. Resolver `fF4(platform, env)` returns true if this env var is truthy-set (`EH(q)`), false if explicitly unset (`BK(q)`); otherwise defaults to true on `win32` **except** when `TERM_PROGRAM==="mintty"` or `TERM==="cygwin"`. Fixes the long-standing Windows terminal quirk where backspace arrives as BS (`\x08`) instead of the Ctrl+Backspace (`\x7F`) that Unix terminals send. |
| `CLAUDE_CODE_DECSTBM` | unset | Opt-in ANSI DECSTBM (Set Top and Bottom Margin) escape-sequence support for the fullscreen TUI. Cached one-shot resolver: returns false if not a TTY, if the terminal fails the shared `Pu6()` capability check, or if running under CI; otherwise **true if this env var is truthy**, else falls back to GrowthBook flag `tengu_marlin_porch`. Enables the scrolling-region primitive needed for the sticky status bar under `/tui` (L81). |

## New GrowthBook Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `tengu_marlin_porch` | false | Server-controlled rollout of DECSTBM scrolling-region support in the fullscreen TUI (L81). Consulted by the same cached resolver that reads `CLAUDE_CODE_DECSTBM` — the env var short-circuits the flag, matching the Fullscreen pattern where `CLAUDE_CODE_FULLSCREEN=1` short-circuits `tengu_pewter_brook`. |
| `tengu_silk_hinge` | false | Gates the new **"Show message timestamps"** user setting (see below). When false, the toggle does not appear in `/config`; `showMessageTimestamps` stays at its default `false`. `isAvailable: () => I_("tengu_silk_hinge", !1)` on the setting descriptor. |
| `tengu_amber_lynx` | false | Gates a code path inside the **"Submit Feedback / Bug Report"** dialog (component `LW7`). Exact behavior variant was not fully resolved from the bundle — the flag is read via `I_("tengu_amber_lynx", !1)` and stored as a component-local variable `G` that influences feedback submission, but the branching logic is split across async callbacks. Reported as observed-but-partially-resolved. |

## New User Settings

| Setting Key | Default | Gate | Purpose |
|-------------|---------|------|---------|
| `showMessageTimestamps` | `false` | `tengu_silk_hinge` | Render a timestamp above each assistant message. Registered in the `/config` settings descriptor with `source: "global"`, `type: "boolean"`, `appStateKey: "showMessageTimestamps"`. Toggling fires `tengu_show_message_timestamps_setting_changed` telemetry with `{ enabled }`. Stored in app state and persisted to user config. The `/config` diff-display narrates "Enabled/Disabled message timestamps" when it changes. |
| `autoAddRemoteControlDaemonWorker` | unset | (none in binary) | New entry in the user-config key list, alongside `remoteControlAtStartup` and `remoteDialogSeen` (L37 Bridge/Remote). The setting is exposed to the config surface but **no code path in the v2.1.113 bundle consumes it** — the consumer is likely server-side (CCR/bridge infrastructure) or forthcoming in a future release. Pairs conceptually with `CLAUDE_BG_BACKEND=daemon`: together they sketch a "Claude Code runs as a daemon worker under Remote Control" architecture that is not yet user-activatable. |

## Async Agent Stall Watchdog (CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS)

Expanded semantics beyond the env var description above:

- **What counts as progress:** each incoming agent message arrival resets the watchdog. The message type is stored in `M` as `"none" | <message.type>`; on stall-fire `M` becomes `last_message_type` in telemetry.
- **Reset method:** new in v2.1.113 — `resetStallWatchdog()` method on the session/runtime wrapper clears `this.stallFired` so a recovered stream can re-arm. The SDK session path uses the analogous mechanism for `tengu_sdk_stall` (same pattern, existing event).
- **On fire:** (1) aborts the agent's `AbortController` signal (`_.abort()`), (2) logs `[AsyncAgent ${H}] stall watchdog fired after ${j}ms with no progress (last message: ${M}); aborting` at error level, (3) emits `tengu_async_agent_stall_timeout`, (4) marks the task `failed` in the task registry with error `Agent stalled: no progress for ${j/1000}s (stream watchdog did not recover)`, (5) finalizes the task with `finalMessage: qbH(f)` (the accumulated message list).
- **Interaction with streaming:** the error message explicitly notes "stream watchdog did not recover" — meaning there is a lower-level stream-level watchdog whose recovery path is the first line of defense; the async-agent stall timer is the outer fallback. Expected hierarchy: per-stream byte watchdog (L74) → per-session SDK stall (`tengu_sdk_stall`) → per-async-agent stall (`tengu_async_agent_stall_timeout`).
- **Not resumable:** the task transitions to `failed` status; there is no rearm-and-continue path.

## MCP Call Watchdog (New in v2.1.113)

`activeCallWatchdogs` — newly-added `Set` on MCP transport-error state objects (`K.activeCallWatchdogs`). Each in-flight MCP tool call adds a watchdog descriptor `D = { armedAt: 0 }` to the set, then:

- **Every 30s:** logs `Tool '${O}' still running (${E}s elapsed)` to the MCP server diagnostics stream.
- **If `D.armedAt > 0` and 90s have elapsed since `armedAt`:** the call is aborted with `MCP server "${_}" transport dropped mid-call; response for tool "${O}" was lost` via a `dL` error. The `armedAt` timestamp is set by the transport layer when it observes a transport error mid-call; the 90s window is the recovery grace period before declaring the response lost.

This is **MCP reliability instrumentation**, distinct from agent-level stalls. It closes a long-standing hole where an MCP tool call could hang indefinitely if the transport dropped between request send and response receive.

## New Telemetry Events (Observational Only)

All observational — none change user-visible behavior beyond telemetry emission:

| Event | Trigger | Payload highlights |
|-------|---------|-------------------|
| `tengu_async_agent_stall_timeout` | Async-agent stall watchdog fires (see above) | `agent_type`, `stall_ms`, `last_message_type`, `message_count` |
| `tengu_unclean_exit` | Startup detects a prior **interactive** session that exited uncleanly (checked via `$Xq.push(...)` inspection path; logs `Prior session exited uncleanly: ${sessionId} (v${version})`) | `session_age_sec`, `prior_version`, `on_current_version` (boolean — did they upgrade since?) |
| `tengu_update_refused` | `/update` command refuses to run (the command itself is still `isEnabled: () => false` and `isHidden: true`, but the implementation body has been actively edited; refusal paths are: `active_tasks: true` when any task is `running`/`pending`, or `transcript_path_drift: true` when the session transcript path has drifted from the current project directory) | `active_tasks` or `transcript_path_drift` |
| `tengu_image_resize_degraded` | Image block processing throws a `VI` error during the image pipeline; the block is replaced with a text placeholder `[Image could not be processed: ${message}]` | `{}` (empty — just occurrence count) |
| `tengu_show_message_timestamps_setting_changed` | User toggles the new `showMessageTimestamps` setting in `/config` | `enabled: boolean` |

Removed in v2.1.113 (consistent with Remote Workflow sunset):

| Event | Prior purpose |
|-------|---------------|
| `tengu_remote_workflow_spawner_started` | Fired when one of the L77 remote-workflow spawners kicked off a CCR v2 session |
| `tengu_remote_workflow_spawner_result` | Fired on CCR v2 spawner completion/error |

## /update Command (Still Disabled, Still Being Iterated On)

The `/update` slash command remains `isEnabled: () => false` and `isHidden: true` in v2.1.113 — **not user-visible**. However, its implementation body now includes the two refusal paths described above (`tengu_update_refused` telemetry). The bundled module hash shifted (`lm7` → `CB7`), indicating active work on the command even while it is gated off. Interpretation: Anthropic is preparing a staged launch of `/update` (in-place native-installer upgrade). The refusal conditions suggest the launched behavior will: (1) reject updates while background tasks are running, and (2) reject updates when the session transcript has drifted from the project dir (likely to avoid leaving session state corrupted across a version swap).

## What Did Not Change in v2.1.113

- **Hook event types:** 19 event types, same set as v2.1.112/v2.1.111. No additions.
- **API beta strings:** 30 betas, identical set to v2.1.112/v2.1.111. `context-hint-2026-04-09` (L80), `ccr-byoc-2025-07-29` (L77/L73), `managed-agents-2026-04-01` (L76) all still present — the API surface did not churn this release.
- **CCR v2 back-end gates:** `CLAUDE_CODE_USE_CCR_V2`, `allow_remote_sessions`, `$X4()` still in the bundle. Multi-repo checkout infrastructure (L73) still present.
- **All other v2.1.110–v2.1.111 lessons (L78–L84):** Advisor Tool, PushNotification/KAIROS, Context Hint API, Fullscreen TUI, Proxy Auth Helper, System Prompt GB Override, and the L84 catch-all items (canary channel, slow first-byte watchdog, background plugin refresh, unknown-command did-you-mean, new telemetry events) are unchanged.

## Daemon-Mode Thread (Cross-Reference Cluster)

v2.1.113's `CLAUDE_BG_BACKEND=daemon` + `autoAddRemoteControlDaemonWorker` do not stand
alone — they connect to existing infrastructure lessons that together map the emerging
"persistent local Claude Code worker" architecture. Read as a group when you want to
understand where unattended execution is heading:

| Lesson | Role in the daemon-mode thread |
|--------|------|
| **L85** (this lesson) | Daemon-mode env gate (`CLAUDE_BG_BACKEND=daemon` — survives SIGHUP, latches stdout errors, bypasses orphan detector), new user setting (`autoAddRemoteControlDaemonWorker`, no consumer in binary), async-agent stall watchdog, MCP transport-drop watchdog, `/update` refusal logic (in-place upgrade preparation). |
| **L37** (Bridge/Remote) | The Remote Control bridge that the daemon worker is expected to plug into — the existing `remoteControlAtStartup` / `remoteDialogSeen` settings live alongside the new `autoAddRemoteControlDaemonWorker` in the same config block, signaling the architectural continuity. |
| **L43** (KAIROS / Cron) | Always-on push-notification + scheduled-agent infrastructure. A local daemon that can survive terminal detachment is the missing piece for scheduled triggers to reliably execute without a live CLI session. |
| **L73** (CCR v2 / Multi-Repo Checkout) | The CCR v2 back-end remained intact after the L77 command sunset. The question of whether daemon-mode plays a role in how CCR v2 orchestrators drive local binaries is unresolved in the bundle but architecturally plausible. |
| **L79** (PushNotification / KAIROS mobile push) | The user-visible proactive-notification path that a daemon-hosted session would need to notify the user when they aren't at the terminal. |
| **L68** (v2.1.101 disabled /update) | The `/update` command was introduced-but-disabled in v2.1.101; L85 documents its v2.1.113 iteration (refusal paths added). In-place upgrade pairs naturally with daemon mode — a persistent worker should be able to upgrade itself without a restart. |

**Unresolved in the v2.1.113 bundle** (questions worth tracking in future releases):

- What does the CCR v2 back-end become if the user-facing surface is gone? First-party-only (editor extensions, mobile apps via KAIROS), or resurfaced as a different command pattern?
- `autoAddRemoteControlDaemonWorker` has no consumer in the binary. Either (a) the consumer ships in a later release, (b) the consumer is server-side (GB-served config read by some server process), or (c) the setting is vestigial. Option (a) is most likely given the active instrumentation work.
- How does `/update` interact with a running daemon worker? The current refusal paths (active-tasks, transcript-path-drift) don't mention daemon-mode specifically. If the daemon is meant to survive its own upgrade in place, there's protocol work still invisible in this bundle.
- External context: local-first "personal AI gateway" products (e.g., OpenClaw and similar projects) occupy the persistent-local-worker + multi-channel-reachability space that L85's daemon-mode infrastructure appears to be building toward; worth watching whether future releases converge on a comparable first-party gateway surface.

## Risks Worth Flagging to Skill Users

- **Slash commands are not stable contracts.** The v2.1.110 → v2.1.113 cycle — ship five Remote Workflow Commands, delete all five — is precedent. Don't build workflows on a freshly-introduced slash-command surface until it has survived a few release cycles.
- **If daemon mode launches, hooks and permission flows assuming terminal I/O will need rethinking.** A `SIGHUP`-ignoring process also ignores shell-close signals; permission prompts that require interactive input have nowhere to go. Hook authors who assume a live TTY should expect new hook contexts under daemon-mode to emerge.

## Summary for v2.1.113

| Category | Count | Notes |
|----------|-------|-------|
| Commands removed | 5 | All Remote Workflow Commands from L77 (`/autopilot`, `/bugfix`, `/dashboard`, `/docs`, `/investigate`) |
| Commands renamed | 1 | `/less-permission-prompts` → `/fewer-permission-prompts` |
| Command descriptions changed | 2 | `/compact` and `/exit` (cosmetic only) |
| Env vars added | 4 | `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS`, `CLAUDE_BG_BACKEND` (daemon mode), `CLAUDE_CODE_BS_AS_CTRL_BACKSPACE`, `CLAUDE_CODE_DECSTBM` |
| GrowthBook flags added | 3 | `tengu_marlin_porch`, `tengu_silk_hinge` (message timestamps), `tengu_amber_lynx` (feedback dialog) |
| User settings added | 2 | `showMessageTimestamps`, `autoAddRemoteControlDaemonWorker` (no consumer in binary) |
| Telemetry events added | 5 | `tengu_async_agent_stall_timeout`, `tengu_unclean_exit`, `tengu_update_refused`, `tengu_image_resize_degraded`, `tengu_show_message_timestamps_setting_changed` |
| Telemetry events removed | 2 | `tengu_remote_workflow_spawner_started`, `tengu_remote_workflow_spawner_result` |
| New watchdog mechanisms | 2 | MCP call watchdog (`activeCallWatchdogs`, 30s progress / 90s abort), async-agent stall reset (`resetStallWatchdog`) |
| Hook event types | unchanged (19) | |
| API beta strings | unchanged (30) | |
