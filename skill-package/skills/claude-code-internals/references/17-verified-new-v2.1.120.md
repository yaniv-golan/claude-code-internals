Updated: 2026-04-25 | Source: Binary extraction from claude v2.1.119/v2.1.120

# Chapter 20: Verified New in v2.1.119–v2.1.120 (Source-Confirmed)

> **Provenance:** Direct binary extraction and structured diffing of v2.1.119 and v2.1.120
> bundles against the v2.1.118 baseline. v2.1.120 bundle embeds its own metadata literally:
> `VERSION: "2.1.120"`, `BUILD_TIME: "2026-04-24T19:00:49Z"`,
> `GIT_SHA: "080f07fb4224786b965b9ea0a35f0cff594f2eb6"`. Both releases shipped substantial
> user-facing surface, so each gets its own lesson: L89 for v2.1.119 (the Cowork-runtime
> GA), L90 for v2.1.120 (cold-start model, lean prompt, memory-write UX, plan-mode tripwire).

> **Narrative for this chapter — the Cowork runtime goes live, then gets refined.**
>
> v2.1.119 is the **runtime infrastructure release for [Claude Cowork](https://www.anthropic.com/product/claude-cowork)**,
> Anthropic's desktop task-automation product (research preview late January 2026, recently
> moved to GA on paid plans). Cowork sits on top of Claude Code's daemon + background-session
> machinery, and v2.1.119 is when that machinery becomes user-visible:
>
> - **`/background` + `/stop`** = fork the current main session into the background as a
>   `kind:"fork"` subagent (the same fork-subagent infrastructure shipped in L87, now reused).
>   Persistence model: PTY stream recorded to `CLAUDE_PTY_RECORD` file, transcript persisted
>   by the bridge transport, single-use `CLAUDE_BRIDGE_REATTACH_SESSION/SEQ` tokens (L87) for
>   reattach.
> - **`/daemon`** = Ink TUI managing three service categories (assistants, scheduled tasks,
>   remote-control servers). The "remote-control server" entry is the channel Cowork Desktop
>   talks to.
> - **Fleet view (`claude agents` CLI subcommand)** = standalone Ink TUI dashboard tracking
>   per-agent PR state (review status, CI checks, mergeability, additions/deletions). This is
>   the Cowork **Dispatch** product pattern: many parallel agents, each owning a worktree +
>   branch + PR; Fleet view is the CI-board.
> - **Classifier-summary system** = the status-update pipeline that powers Cowork Desktop's
>   "what's the agent doing right now" UI, via `notifyMetadataChanged({ post_turn_summary })`.
>   Heuristic-vs-LLM engine selection, three independent kill switches.
> - **`/autocompact` re-introduced** (token-count parameterized this time, after being removed
>   in L87) — fits the long-running unattended-execution story.
> - **17 new env vars** centered on session identity (`SESSION_KIND` taxonomy: `bg` |
>   `daemon` | `daemon-worker`), background plumbing, and agent dispatch.
>
> **The Cowork connection isn't named in the bundle.** There is no "cowork" string. Cowork is
> the *product label* for sessions running with `CLAUDE_CODE_SESSION_KIND="bg"`; detection is
> via the BG family. This matters when you read code: you will see `bg`/`daemon` everywhere
> and `Cowork` nowhere. Same architectural reality.
>
> v2.1.120 is **refinement, with one architectural reveal**:
>
> - **Persistent daemon install is kill-switched.** `xQH()` aborts with
>   *"daemon service is not installed (service install is disabled in this version; the daemon
>   runs on demand)"*. Despite all v2.1.119's `tengu_daemon_install` / `_auto_uninstall`
>   telemetry being live, the user-facing daemon is **strictly on-demand** — only `transient`
>   (silent) or `ask` (prompted) cold-start modes are available via the new
>   `CLAUDE_CODE_DAEMON_COLD_START` env var. The runtime exists; always-on daemon mode is
>   held back. This is the gap to watch.
> - **`CLAUDE_CODE_LEAN_PROMPT`** introduces a **per-section** prompt-shaping toggle pattern,
>   distinct from v2.1.116's wholesale `CLAUDE_CODE_SIMPLE` swap. Each leanable section has
>   its own gate (`LEAN_PROMPT env || <codename GB flag>`).
> - **`CLAUDE_COWORK_MEMORY_GUIDELINES`** lets the Cowork product **completely replace** the
>   normal memory-injection pipeline (sibling `_EXTRA_GUIDELINES` already existed for the
>   additive form). Cowork's escape hatch for tasks that need to ignore user memory.
> - **`tengu_memory_write_survey_event`** = an Approve/Reject confirmation dialog for memory
>   file writes, with a per-write LLM-generated summary (Sonnet 4.6, ≤120 chars) and a 5-second
>   countdown. Directly relevant to anyone running auto-memory pipelines.
> - **`tengu_plan_mode_violated`** = telemetry-only tripwire for "plan mode should have held
>   this but didn't." Observability over enforcement.
>
> **What's NOT in v2.1.119–v2.1.120:** no new hook event types (still 19), no new permission
> phases, no new API beta strings (still 32). The OIDC Federation surface from L86 is
> unchanged. The `/fork` machinery from L87 is reused, not modified.
>
> **Cross-reference cluster — Cowork's runtime stack:**
> L43 (KAIROS subsystem characterization) → L85 (`CLAUDE_BG_BACKEND=daemon` first public
> surface) → L87 (`/fork` + `CLAUDE_BRIDGE_REATTACH_SESSION/SEQ` reattach plumbing) →
> **L89 (this chapter)** is where it all becomes a coherent user-facing product surface.

---

## TABLE OF CONTENTS

89. [Lesson 89 -- v2.1.119 Cowork Runtime Goes Live: `/background`, `/daemon`, Fleet View, Classifier-Summary, Session Identity Taxonomy](#lesson-89----v21119-cowork-runtime-goes-live-background-daemon-fleet-view-classifier-summary-session-identity-taxonomy)
90. [Lesson 90 -- v2.1.120 Daemon On-Demand Model, `CLAUDE_CODE_LEAN_PROMPT`, Memory-Write Approval UX, Plan-Mode Tripwire, `CLAUDE_COWORK_MEMORY_GUIDELINES`](#lesson-90----v21120-daemon-on-demand-model-claude_code_lean_prompt-memory-write-approval-ux-plan-mode-tripwire-claude_cowork_memory_guidelines)

---

# LESSON 89 -- v2.1.119 COWORK RUNTIME GOES LIVE: `/background`, `/daemon`, FLEET VIEW, CLASSIFIER-SUMMARY, SESSION IDENTITY TAXONOMY

## What this release is

v2.1.119 is the runtime layer for Anthropic's [Claude Cowork](https://www.anthropic.com/product/claude-cowork)
desktop task-automation product. Cowork was launched in research preview late January 2026
and recently moved to GA on paid plans. From the Cowork blog:

> *"Where Chat is a conversation, Cowork is a working session: you describe the task, Claude
> plans and executes it, and you steer along the way."* — [claude.com/blog/cowork-research-preview](https://claude.com/blog/cowork-research-preview)

What ships in this Claude Code release is the *engine*: background sessions, the on-demand
daemon, the agents dashboard (`claude agents` = "Fleet view"), the daemon-managed service
registry, and the heuristic-vs-LLM classifier-summary pipeline that pushes status updates
to the Cowork Desktop UI via `notifyMetadataChanged`. The Cowork product features
("Scheduled Tasks", "Dispatch", "Projects", "Computer Use") map onto these primitives.

**There is no "cowork" string in the bundle.** Cowork is the *product label*. Detection is
via `CLAUDE_CODE_SESSION_KIND ∈ {"bg", "daemon", "daemon-worker"}`. When you read this
chapter and the source, treat "background session" / "BG" as the technical name and "Cowork"
as the product context.

### ⚠ Critical: most of these surfaces are dark-launched

The runtime *code* shipped in v2.1.119; the *user-facing surface* is gated behind GrowthBook
flags or hardcoded kill-switches. **Confirmed empirically** (Claude Max v2.1.119):

| Surface | Status | Gate |
|---------|--------|------|
| `/daemon` slash command | ❌ DARK-LAUNCHED for everyone | `OqH() = return false` (hardcoded literal — no flag override possible) |
| `claude agents` Fleet view Ink TUI | ❌ DARK-LAUNCHED by default | `isAgentsFleetEnabled() = C0H() = v_("tengu_slate_meadow", false)`. When off, `claude agents` falls through to a **legacy agent-listing utility** that just prints installed plugin agents + built-ins — not the Fleet view dashboard. |
| `/background` + `/bg` slash command | ⚠ GATED | Same `tengu_slate_meadow` GB flag. Appears flipped on for Claude Max / Cowork-product users; off for default. Per-command `isEnabled: () => true` is misleading — the command-resolver-array inclusion is what's gated: `...Q3K && C0H() ? [Q3K] : []`. |
| `/stop` slash command | ⚠ CONDITIONAL (no separate dark-launch gate) | `isEnabled: E4 = () => x4H() === "bg"`. Only enabled inside a bg session. Since `/background` is what creates bg sessions, this is transitively gated by `tengu_slate_meadow` for most users. |
| `/autocompact` slash command | ✅ LIVE | Unconditional in master command-list array `SN8` |
| `/fork` slash command (L87) | ✅ LIVE since v2.1.117 | No gate |

**Methodology note:** when a new slash command appears in the bundle diff, three distinct
gates exist — (1) per-command `isEnabled` field, (2) **master command-resolver-array
inclusion** (the `...VAR && fn() ? [VAR] : []` spread expression), (3) per-command
`isHidden`. *Registration in the bundle does not mean the command is reachable.* Always
trace the array-inclusion expression. The original draft of this chapter missed this
distinction and treated several dark-launched commands as live; sections below have been
corrected to flag dark-launch status, but always verify on your own account by typing the
command — gate evaluation may be cohort-specific.

The information below describes what each surface *will do* when its gate is open, plus
notes the current gating status. **Read with the live/dark-launched distinction in mind.**

---

## `/background` + `/bg` — Fork the Current Session into the Background

> **Surface status: GB-flag gated** (`tengu_slate_meadow`, default false). Live for
> Claude Max / Cowork-product users; "Unknown command" on default accounts. The
> `isEnabled: () => true` field on the registration is misleading — it's the *per-command*
> check; the actual gate is at the **command-resolver-array inclusion** level.

Per-command registration (in `vO3`):

```js
{ type: "local-jsx",
  name: "background",
  aliases: ["bg"],
  description: "Continue this session in the background and free the terminal",
  isEnabled: () => true,                    // ← always-true at this level…
  load: () => Promise.resolve().then(() => (cV8(), HTK)) }
```

…but the master command-resolver array gates the inclusion:

```js
...Q3K && C0H() ? [Q3K] : [],               // C0H() = v_("tengu_slate_meadow", false)
```

`Q3K` is the import name for the `/background` module. When `tengu_slate_meadow` is on,
typing `/bg` works because of the alias.

### What `/background` actually does

The handler `YTK(H, _, q)` does **not** spawn a fresh agent. It forks the **current main
session** into a background fork-subagent using the **v2.1.119-improved** `/fork`
infrastructure. Per the official Anthropic v2.1.119 changelog: *"`/fork` now writes a
pointer and hydrates on read instead of full conversation copies."* So /background uses the
L87 fork-subagent *type* (still `kind:"fork"`), but the parent-conversation-inheritance
mechanism switched from full-duplication (as L87 documents) to pointer-based hydration
on demand in v2.1.119. Concretely:

1. Capture the rendered system prompt of the current session.
2. Copy the REPL replay log (or hydrate from messages if no log exists yet).
3. Truncate the directive to ≤50 chars for the agent description.
4. Create a forked agent with `kind: "fork"` (the implicit fork subagent type from L87).
5. Resolve the agent's model via `E$H(pS.model, _.options.mainLoopModel, void 0, ...)`.
6. Register in the `taskRegistry` as an async task with `isAsync: true`.
7. Return the dispatched task to the parent REPL, which continues without it.

So **`/background` = `/fork(<context>)` of the current main session** — same fork machinery,
inverted source: where `/fork` (L87) forks a *new directive* off the current context,
`/background` forks the *current session* off the current context. Both end up as
`kind: "fork"` subagents.

### CLI form

A second invocation path exists outside the slash-command surface. The CLI argv parser
includes a flag-driven background spawn (telemetry: `j("tengu_background", { via_flag: true,
via: "flag" })`) and a sibling `claude respawn` subcommand that calls `respawnHandler` /
`rmHandler` for cleanup. So three ways to reach a background session:

1. `/background` (or `/bg`) inside an interactive REPL
2. CLI flag form: spawning Claude Code with the background flag (`claude --bg <command>` or
   similar — exact argv shape is in `A.handleBgFlag(H)`)
3. Left-arrow keybinding from foreground REPL → spawns child `claude agents` (see Fleet view
   below) which can then dispatch agents

### Confirmation string

The user sees: `"Fork started — processing in background"`.

---

## `/stop` — Stop the Current Background Session

> **Surface status: conditionally enabled — no separate dark-launch gate.** Per-command
> `isEnabled: vK = () => SESSION_KIND === "bg"`. So `/stop` only appears in the
> slash-command menu inside a bg session. Since bg sessions are spawned by `/background`
> (which is gated by `tengu_slate_meadow`), `/stop` is transitively unreachable for users
> without that GB flag flipped. Verified: in v2.1.119 the registration uses identifier
> `E4 = () => x4H() === "bg"`; the v2.1.120 helper is the same predicate via `vK`.

Two registrations, matching the dual-registration pattern from `/usage`/`/model` in
L88/L86:

```js
// Interactive (Ink modal):
hO3 = {
  type: "local-jsx", name: "stop",
  description: "Stop this background session; transcript and worktree are kept",
  immediate: true,
  isEnabled: vK,                    // only enabled in bg sessions
  requires: { ink: true },
  load: () => Promise.resolve().then(() => (OTK(), KTK)),
}

// Non-interactive (headless):
SO3 = {
  type: "local", name: "stop",
  supportsNonInteractive: true,
  description: "Stop this background session; transcript and worktree are kept",
  isEnabled: vK,
  load: () => Promise.resolve().then(() => ($TK(), TTK)),
}
```

`vK` = `() => T1H() === "bg"` — `/stop` is invisible outside background sessions.

### Interactive UI flow (`VO3`)

Renders an Ink confirmation modal:

> **Stop this background session?**
> *Restart it from agents anytime.*
>
> [Stop session] [Keep running]

Confirming dispatches `jF("stop_command")` through the bridge IPC; cancelling closes the
modal. The "Restart it from agents anytime" subtitle confirms the design intent: stopped
sessions remain visible and resumable from the agents panel.

### What gets kept

`"transcript and worktree are kept"` — neither is deleted on stop. The session can be
restarted later. Specifically:

- **Transcript** — persisted by the bridge transport. Log line on session start:
  `[bridge:repl] Session persistence enabled — transcript writer + hydrate readers registered`.
- **PTY recording** — `CLAUDE_PTY_RECORD` env var holds a file path; the internal
  `--bg-pty-host <sock> <cols> <rows> -- <file> [args...]` argv mode (verbatim from the
  bundle's bad-argv error message) hosts the PTY over a unix socket and records the entire
  terminal stream (`Bun.Terminal` `data` callback writes to `w?.write(Buffer.from(W))`). The
  recording survives stop.
- **Worktree** — if the agent ran in worktree-isolation mode (see Background Isolation
  below), the `.claude/worktrees/<id>/` directory is left in place.

### Reattach handshake (uses L87 plumbing)

When a stopped session is resumed, the bridge transport reads two single-use env vars:

- `CLAUDE_BRIDGE_REATTACH_SESSION` — session ID
- `CLAUDE_BRIDGE_REATTACH_SEQ` — sequence number to replay from

```js
let R = process.env.CLAUDE_BRIDGE_REATTACH_SESSION,
    W = process.env.CLAUDE_BRIDGE_REATTACH_SEQ;
if (R) {
  delete process.env.CLAUDE_BRIDGE_REATTACH_SESSION,
  delete process.env.CLAUDE_BRIDGE_REATTACH_SEQ;
}
let G = W ? Number.parseInt(W, 10) || void 0 : void 0;
```

Both are **deleted from `process.env` immediately after read** — single-use. Children spawned
later don't reuse them. Persistence is gated by org policies `allow_remote_control` (required)
and `allow_remote_sessions` (required for mirror mode).

These env vars were added in v2.1.117 (L87) but only fully consumed in v2.1.119.

### Sibling: internal `bridge` command

A non-slash-command sibling exists: `yO3 = async () => { await jF("bridge"); return { type:"skip" } }`.
Used internally to re-establish the bridge channel when needed.

---

## `/daemon` — Ink TUI Managing Three Service Categories

> **Surface status: HARDCODED OFF for everyone in v2.1.119 and v2.1.120.** Typing `/daemon`
> returns *"Unknown command: /daemon"* on every account. This is **not** a GB-flag flip
> away — the gate function is `function OqH() { return false }` (a literal), so the master
> command-resolver array spread `...Q$6 && OqH() ? [Q$6] : []` always evaluates empty.
> Expect this to remain off until Anthropic ships a real implementation of `OqH()`. The
> registration object exists in the bundle (described below) so the daemon-management
> machinery can be code-reviewed and its eventual surface understood — but it is not
> currently a usable command.

Registered as `F53` in v2.1.120 (and `iK3` in v2.1.119; the rename is cosmetic):

```js
{ type: "local-jsx",
  name: "daemon",
  description: "Manage background services: assistants, scheduled tasks, and remote control",
  immediate: true,
  requires: { ink: true },
  load: () => Promise.resolve().then(() => (MV8(), JV8)) }
```

Imported into the master command-array as `Q$6` and gated:

```js
function OqH() { return !1 }                // literally returns false
...
...Q$6 && OqH() ? [Q$6] : [],               // → never included
```

### Three managed service categories

The label table `l3K` defines the kinds:

```js
l3K = {
  scheduled: "scheduled task",
  assistant: "assistant",
  remoteControl: "remote-control server",
}
```

And the action labels `u53`:

```js
u53 = { uninstall: "Uninstall service", stop: "Stop" }
```

So the TUI exposes: list services, stop a running service, uninstall a service. Install/start
live elsewhere (see CLI form below).

### What each category is

- **`assistant`** — long-lived Cowork agents (a `bg` session that's expected to run for hours
  or days, picking up tasks dispatched to it).
- **`scheduled`** — tasks tied to the `/schedule` command (paired with the v2.1.117 routine/
  trigger system; see L87 for the triggers→routines terminology shift). When a scheduled
  task fires, the daemon spawns a worker to execute it.
- **`remoteControl`** — the channel Cowork Desktop / claude.ai web UI talks to. Each entry
  has a `spawnMode` field (default `"same-dir"`).

### CLI form

The daemon also has a CLI surface, parsed by `$Y3(H)`:

```
claude daemon                    # default: list
claude daemon --json             # list, JSON output
claude daemon -a <kind> <dir>    # add service (kind = assistant|scheduled|remoteControl)
claude daemon -r <id>            # remove service by id
claude daemon --add=<dir>        # alt add form
claude daemon --remove=<id>      # alt remove form
```

The list of registered services lives in a config file written to `GH_()` (which resolves to
`<config-dir>/sessions`). Each entry has `{ dir, name }`; `remoteControl` entries also get
`spawnMode`.

### Lease + supervisor model

The daemon supervises its own workers. Key telemetry events that fire in the supervisor loop:

- `tengu_daemon_install` — service install
- `tengu_daemon_lease` — lease acquired (single-daemon-per-config-dir invariant)
- `tengu_daemon_self_restart_on_upgrade` — daemon polls for "binary identity" changes via
  `setInterval(L, A)`; when the running binary differs from disk, sets `W = true`, emits this
  event, and gracefully restarts (`v.manager?.killAll("SIGTERM")`, supervisor close, await
  worker shutdown). Standard hot-upgrade pattern.
- `tengu_daemon_idle_exit` — idle timeout reached, daemon shuts down
- `tengu_daemon_worker_crash` — a worker crashed
- `tengu_daemon_worker_permanent_exit` — worker exhausted retries
- `tengu_daemon_auto_uninstall` — service auto-uninstalled (likely after repeated failures)
- `tengu_daemon_config_reload` — config file changed, reloaded
- `tengu_daemon_control` — control-plane command received

### Worker spawn / dispatch

Worker lifecycle telemetry:
`tengu_bg_worker_spawn`, `tengu_bg_worker_exit`, `tengu_bg_dispatch`,
`tengu_bg_dispatch_fallback`, `tengu_bg_agent_dispatch`, `tengu_bg_agent_action`,
`tengu_bg_agent_terminal`, `tengu_bg_attach`, `tengu_bg_attach_legacy_autorespawn`,
`tengu_bg_adopt`, `tengu_bg_classify`, `tengu_bg_orphan_reap`, `tengu_bg_proto_mismatch`,
`tengu_bg_pty_unavailable`, `tengu_bg_respawn_exhausted`, `tengu_bg_respawn_stale`,
`tengu_bg_roster_parse_failed`, `tengu_bg_skew_nudge`.

That's a thorough instrumentation surface — the daemon expects to be observed.

---

## `/autocompact` — Re-Introduced with Token-Count Parameter

Removed in v2.1.117 (L87), back in v2.1.119 with a different shape. Two registrations
(interactive + non-interactive), matching the established dual-registration pattern.

Interactive (`ag7`):
```js
{ type: "local-jsx", name: "autocompact",
  description: "Configure the auto-compact window size",
  isEnabled: () => og7() && !V8(),
  isHidden: false,
  argumentHint: "[auto|<tokens>]",
  load: () => Promise.resolve().then(() => (rg7(), ig7)),
  userFacingName() { return "autocompact" } }
```

Non-interactive (`l08`):
```js
{ type: "local", name: "autocompact",
  supportsNonInteractive: true,
  description: "Configure the auto-compact window size",
  get isHidden() { return !V8() },
  isEnabled() { return og7() && V8() },
  argumentHint: "[auto|<tokens>]",
  load: () => Promise.resolve().then(() => (g08(), lg7)),
  userFacingName() { return "autocompact" } }
```

`og7()` returns `WI7()` — the autocompact-feature gate. `V8()` is the
non-interactive/headless detector. They split the dual registrations: interactive form
runs in TTY sessions, non-interactive in headless.

### Argument form

`[auto|<tokens>]`:

- `/autocompact auto` — reset to default
- `/autocompact 50000` — set the auto-compact threshold to 50,000 tokens
- `/autocompact` (no arg) — opens an interactive Ink dialog "Auto-compact Window" with
  telemetry `tengu_autocompact_dialog_opened` (source: "dialog")

### Constants nearby

```js
U08 = 1e5    // 100,000 — likely default
d08 = 1e5    // 100,000 — maybe min
c08 = 1e6    // 1,000,000 — likely max
$GH = 0
```

So roughly: default ~100k tokens, max ~1M. Per-session token threshold above which
auto-compaction triggers.

### State field

Read via `qU5(H) = H.autoCompactWindow`. Stored on app state as `autoCompactWindow: number`.

### Telemetry events

- `tengu_autocompact_command` — command invoked with arg
- `tengu_autocompact_dialog_opened` — no-arg form opened the dialog (source: "dialog")

### How it differs from the pre-L87 form

The previous incarnation (removed in v2.1.117) was a binary on/off toggle. The new form is
**explicitly token-count parameterized**. This is the long-running-unattended-execution shape:
when a Cowork agent runs for hours, the user (or the agent itself, via `/autocompact 200000`)
needs to control how aggressively conversation gets summarized.

---

## Fleet View = `claude agents` CLI Subcommand (Cowork's PR Dashboard)

> **Disambiguation: `claude agents` (CLI subcommand) vs `/agents` (slash command).** These
> are two **different surfaces** with confusingly-similar names — the original draft of
> this section conflated them.
>
> - **`/agents` slash command** is `{type:"local-jsx", name:"agents", description:"Manage
>   agent configurations"}` — pre-existed v2.1.118, always enabled, opens an Ink panel for
>   agent-config management. **Not** the Fleet view. **Not** new in v2.1.119/v2.1.120.
> - **`claude agents` CLI subcommand** is what this section documents — and it has the
>   dual code path described below (Fleet view if `tengu_slate_meadow` enabled; legacy
>   agent-listing utility if not).
>
> **Surface status: DARK-LAUNCHED on default accounts.** When `tengu_slate_meadow` is off
> (the default), `claude agents` does NOT mount the Fleet view Ink TUI described below.
> Instead, it falls through to a **legacy agent-listing utility** that prints something
> like:
>
> ```
> $ claude agents
> 21 active agents
>
> Plugin agents:
>   plugin-name:agent-name · sonnet
>   ...
>
> Built-in agents:
>   claude-code-guide · haiku
>   Explore · haiku
>   general-purpose · inherit
>   ...
> ```
>
> This is just an installed-agents registry dump — useful for "what agents do I have?" but
> NOT the dashboard described in the rest of this section. Fleet view (the Ink TUI with
> per-agent PR state tracking) only appears when `tengu_slate_meadow` is on.
>
> The Ink TUI form below is what users with the gate flipped see. The original draft of
> this chapter conflated the two paths; both exist, and the `claude agents` CLI argv
> branch chooses based on the gate.

Fleet view is the **agents dashboard**. Despite the name `tengu_fleetview`, it is *not* a
panel inside a regular session — it's a **standalone CLI subcommand** that mounts its own
Ink TUI when its gate is open.

### Trigger paths

1. **`claude agents`** CLI subcommand. Argv-parser branch:
   ```js
   if (H[0] === "agents" && ph3(H.slice(1)) && process.stdout.isTTY) {
     // gate: isAgentsFleetEnabled() = C0H() = v_("tengu_slate_meadow", false)
     // when false → falls through to legacy listing utility
     // when true  → initialize logging, mount Ink TUI:
     await mountFleetView(rootInk);
   }
   ```
   Requires TTY. Gated on `isAgentsFleetEnabled() = C0H() = v_("tengu_slate_meadow", false)`
   — the same gate as `/background`.

2. **Left-arrow keybinding** from foreground REPL. The handler at `tengu_open_agents_via_left`:
   ```js
   c("tengu_open_agents_via_left", { was_empty: q === null });
   if (S_("tengu_bg_leftarrow_inprocess", true)) {
     return await U0K(z, O);  // run in-process
   }
   return gzH({ args: ["agents"], env: { CLAUDE_AGENTS_SELECT: z } });
   ```
   By default spawns a child `claude agents` subprocess with `CLAUDE_AGENTS_SELECT=<id>` to
   pre-select an agent. The `tengu_bg_leftarrow_inprocess` GB flag toggles in-process
   rendering instead.

3. **`tengu_fg_left_arrow_agents`** — telemetry for the foreground left-arrow keypress that
   opens the agents view.

### What the TUI shows

A list of all background-spawned agents, with **per-agent PR state tracking**. The state
fields tracked per PR (`href`):

- `state` (filters out `MERGED` / `CLOSED`)
- `title`
- `review` (status of PR review)
- `mergeable` (boolean / `mergeStateStatus`)
- `mergeStateStatus`
- `checks.passed`, `checks.failed`, `checks.pending` (CI status)
- `additions`, `deletions` (diff size)

### Batched vs per-PR fetch

The `tengu_fleetview_pr_batch` GB toggle controls fetch strategy:

```js
let w7 = S_("tengu_fleetview_pr_batch", true);
if (w7) {
  let n7 = await AP7(g1);  // batched: one GitHub API call for all PRs
  i4 = n7.statuses;
  for (let k4 of n7.unbatched) i4.set(k4, await Qw8(k4));
} else {
  i4 = new Map(await Promise.all(g1.map(async (n7) => [n7, await Qw8(n7)])));
  // fallback: one call per PR
}
```

Batched is the default-on form for users with many PRs in flight (Cowork Dispatch can spawn
dozens of parallel agents).

### Why this is the Cowork "Dispatch" UI

Cowork's "Dispatch" feature spawns many parallel agents, each working on its own task. The
canonical workflow: each agent gets its own worktree → branch → PR. Fleet view is the
CI-board-style monitoring dashboard for that fleet. PR-state tracking is load-bearing because
the user needs to know which agents finished, which are blocked on review, which have failing
CI.

### Bonus: `claude respawn`

Same argv parser also recognizes `H[0] === "respawn"`, calling `A.respawnHandler(H[1])` or
`A.rmHandler(H[1])` for agent cleanup/respawn from the CLI. This is the recovery surface for
when a Fleet view operation needs to bounce a stuck worker.

---

## Session Identity Taxonomy

Three new session-identity env vars carry the Cowork-runtime context:

| Env Var | Values | Purpose |
|---------|--------|---------|
| `CLAUDE_CODE_SESSION_KIND` | `"bg"` \| `"daemon"` \| `"daemon-worker"` \| unset (interactive) | **The discriminator.** What kind of session is this? |
| `CLAUDE_CODE_SESSION_ID` | string | Stable session identifier for cross-process correlation |
| `CLAUDE_CODE_SESSION_NAME` | string | Human-readable session name (shown in Fleet view) |
| `CLAUDE_CODE_SESSION_LOG` | string (path) | Log file path for the session |

### Helpers

```js
function T1H() {
  let H = process.env.CLAUDE_CODE_SESSION_KIND;
  if (H === "bg" || H === "daemon" || H === "daemon-worker") return H;
  return;  // anything else → interactive
}
function vK() { return T1H() === "bg" }            // is this a background session?
function uC_() { return process.env.CLAUDE_BG_BACKEND === "daemon" }  // is backend a daemon?
```

`T1H()` is the canonical resolver. It validates the env var to one of three values. Anything
else (or unset) → interactive.

`vK()` is the most-used predicate — gates `/stop`'s `isEnabled`, the worktree-prompt rewrite,
and the classifier-summary surface detection.

### The 5-var BG-context check

A 5-variable union check exists in `bV()` (env-stripping helper):

```js
T = process.env.CLAUDE_CODE_SESSION_KIND !== void 0
 || process.env.CLAUDE_BG_SOURCE !== void 0
 || process.env.CLAUDE_BG_ISOLATION !== void 0
 || process.env.CLAUDE_BG_BACKEND !== void 0
 || process.env.CLAUDE_CODE_SESSION_NAME !== void 0;
```

When *any* of these five are set, the helper considers the process to be in a background
context. **All five are then deleted from `process.env` before subprocess spawn:**

```js
delete $.CLAUDE_CODE_SESSION_KIND;
delete $.CLAUDE_BG_SOURCE;
delete $.CLAUDE_BG_ISOLATION;
delete $.CLAUDE_BG_BACKEND;
delete $.CLAUDE_CODE_SESSION_NAME;
```

So daemon plumbing **does not leak into child processes** the bg session spawns (e.g., user
tools, hooks). Children see a clean env unless explicitly opted in.

> **Version note (v2.1.160):** the delete-chain has since grown from 5 to **12** vars — the
> original five plus `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_SUBSCRIPTION_TYPE`,
> `CLAUDE_CODE_RATE_LIMIT_TIER`, `CLAUDE_BG_AUTH_SNAPSHOT_PATH`,
> `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`, `CLAUDE_BG_SESSION_PERMISSION_RULES`, and
> `CLAUDE_BG_MEMORY_TOGGLED_OFF`. The expansion now also scrubs the **credential** vars
> (OAuth token, subscription, rate-limit tier, the one-shot auth-snapshot path) from children —
> the same defensive posture as the one-shot snapshot handoff (L99). The 5-var form above is
> accurate for v2.1.119/v2.1.120.

### Background isolation: runtime prompt rewriting

When `CLAUDE_CODE_SESSION_KIND === "bg"` and `CLAUDE_BG_ISOLATION === "worktree"`, the agent's
**system prompt is mutated at runtime** to insert (`bA3()`):

> *"This agent is configured with `isolation: worktree`. Call the EnterWorktree tool as your
> first action — before reading files or running commands — unless your cwd is already under
> `.claude/worktrees/`. If EnterWorktree fails (e.g. not a git repo), continue in place."*

Or for the non-worktree default:

> *"Before making any code changes, use the EnterWorktree tool to isolate your work from
> other parallel jobs and the user's working copy — unless your cwd is already under
> `.claude/worktrees/`, in which case you're already isolated. If you're only reading,
> searching, or answering questions, skip this and work in place. If EnterWorktree fails
> (e.g. not a git repo), continue in place."*

This is a **prompt-level enforcement of the worktree-isolation invariant** Cowork's Dispatch
needs (parallel agents must not stomp each other's working copy). The model is instructed to
self-isolate via tool use, not relying on any process-level sandboxing.

`CLAUDE_JOB_DIR` carries the per-job state directory (where the worktree, transcript, PTY
recording live).

---

## Classifier-Summary System: Cowork Desktop's Status Pipeline

This is the architecturally significant new pipeline that the Cowork Desktop UI consumes.
When you see Cowork's "What's Claude doing right now" / "Waiting on Bash approval" status
in the desktop app, it is rendered from `notifyMetadataChanged({ post_turn_summary })` events
emitted by this system.

### Surface detection (`iS7`)

```js
function iS7() {
  if (vK()) return new Set(["bg"]);              // bg short-circuits everything else
  let H = new Set();
  if (mC_()) H.add("watched");                                                    // heartbeat
  if (hH(process.env.CLAUDE_CODE_REMOTE) || C8()) H.add("ccr");                   // CCR remote
  if (process.env.CLAUDE_CODE_ENVIRONMENT_KIND === "bridge" || TiH()) H.add("bridge");
  if (process.env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop") H.add("desktop");  // Cowork Desktop
  if (sS7()) H.add("cli");                                                        // currently sS7()===false
  return H;
}
```

**Six surfaces** Claude Code knows about: `bg` (background session, takes priority), `watched`
(running under heartbeat watchdog), `ccr` (Claude Code Remote), `bridge` (Anthropic's bridge
channel), `desktop` (claude-desktop entrypoint = Cowork Desktop), `cli` (currently
dark-launched).

### Surface→capability map (`rS7`)

```js
rS7 = {
  bg:      ["state"],
  watched: ["state"],
  ccr:     ["summary"],
  bridge:  ["summary"],
  desktop: ["summary"],
  cli:     ["summary"],
}
```

Two output kinds:
- **`state`** — machine-readable status (background workers report this for daemon/orchestrator)
- **`summary`** — human-readable string (UI surfaces show this)

### Capability filter (`oS7`)

```js
function oS7(H) {
  let _ = new Set(),
      q = jy5(S_("tengu_classifier_disabled_surfaces", ""));
  for (let K of H) {
    if (q.has(K)) continue;
    for (let O of rS7[K]) _.add(O);
  }
  if (H.has("bg")) _.delete("summary");        // bg always loses summary capability
  if (S_("tengu_classifier_summary_kill", false)) _.delete("summary");  // master kill
  return _;
}
```

Two kill switches:
1. `tengu_classifier_disabled_surfaces` — comma-separated list of surfaces to skip entirely
2. `tengu_classifier_summary_kill` — wipes the summary capability everywhere (master kill)

### Engine selection (`aS7`)

```js
function aS7(H) {
  if (H.size === 0) return null;
  let _ = H.has("state")
    ? "llm"                                     // state always uses LLM
    : process.env.CLAUDE_CODE_CLASSIFIER_SUMMARY !== void 0
      ? hH(process.env.CLAUDE_CODE_CLASSIFIER_SUMMARY) ? "llm" : "heuristic"
      : fy5();
  // Cost circuit-breaker: if LLM resolved AND tengu_cobalt_wren on → downgrade to heuristic
  return _ === "llm" && S_("tengu_cobalt_wren", false) ? "heuristic" : _;
}

function fy5() {
  if (S_("tengu_classifier_summary_llm_emit", false)) return "llm";
  if (S_("tengu_classifier_summary_heuristic_emit", false)) return "heuristic";
  return null;
}
```

Engine resolution priority:
1. State capability → always `"llm"`
2. `CLAUDE_CODE_CLASSIFIER_SUMMARY` env var (truthy → `"llm"`, falsy → `"heuristic"`) — manual override
3. GB flags `tengu_classifier_summary_llm_emit` / `_heuristic_emit` — staged rollout
4. Default → `null` (no engine, no emission)

**Cost circuit-breaker:** if engine resolves to `"llm"` AND `tengu_cobalt_wren` GB flag is on,
the engine is downgraded to `"heuristic"`. So `tengu_cobalt_wren` is the LLM-cost kill switch
for this pipeline.

### Output schema (`Jy5`)

```js
function Jy5(H) {
  return {
    status_category: H.state === "blocked" ? "blocked" : "review_ready",
    status_detail: H.detail,
    needs_action: H.state === "blocked" ? (H.needs ?? "") : "",
  };
}
```

Three fields:
- `status_category`: `"blocked"` | `"review_ready"`
- `status_detail`: human-readable string (e.g., `"Waiting on permission: Bash"`)
- `needs_action`: present when blocked (e.g., `"Approve or deny Bash"`)

### Use site (`My5`)

```js
async function My5(H, _) {  // H = tool use, _ = context
  let q = oS7(iS7());
  if (!q.has("summary") || aS7(q) === null) return;
  let K = {
    status_category: "blocked",
    status_detail: `Waiting on permission: ${H.tool_name}`,
    needs_action: `Approve or deny ${H.tool_name}`,
  };
  _?.notifyMetadataChanged({ post_turn_summary: K });
}
```

When a tool needs permission and the surface supports summary emission, the system pushes a
`post_turn_summary` via `notifyMetadataChanged`. **This is the API Cowork Desktop subscribes
to.** The desktop UI updates to show "Claude is waiting on Bash approval" without polling.

### Why this matters

Cowork Desktop's "what's the agent doing" UI is *implemented at the Claude Code layer* via
this system. The LLM-vs-heuristic split + three independent kill switches show Anthropic is
cost-conscious about always-on LLM classification. The surface map (`bg`/`watched`/`ccr`/
`bridge`/`desktop`/`cli`) is the canonical inventory of "where can Claude Code run" as
understood by the binary.

---

## Pro-Trial Conversion Flow

Cowork is a paid-plan-only feature, so the trial-conversion screen lives at the Claude Code
surface where users hit the gate:

| Telemetry Event | Trigger |
|-----------------|---------|
| `tengu_pro_trial_start_screen_shown` | Trial-start screen rendered |
| `tengu_pro_trial_start_pressed` | User clicked "start trial" |
| `tengu_pro_trial_start_ok` | Trial start succeeded |
| `tengu_pro_trial_start_error` | Trial start failed |

This is the upsell funnel for Cowork. Pre-existing OAuth + bridge + remote-control
infrastructure (L37 / L86) carries the actual auth.

---

## New Environment Variables (16, after diff correction — see L88 note on `_FORK_SUBAGENTM` artifact)

| Env Var | Purpose |
|---------|---------|
| `CLAUDE_CODE_SESSION_KIND` | Session-kind discriminator: `"bg"` \| `"daemon"` \| `"daemon-worker"`. The canonical "what kind of session is this?" check. |
| `CLAUDE_CODE_SESSION_ID` | Stable session identifier for cross-process correlation |
| `CLAUDE_CODE_SESSION_NAME` | Human-readable session name (Fleet view list) |
| `CLAUDE_CODE_SESSION_LOG` | Path to session log file |
| `CLAUDE_BG_ISOLATION` | Background-isolation mode. Value `"worktree"` triggers runtime prompt rewriting (see Background Isolation above). |
| `CLAUDE_BG_RENDEZVOUS_SOCK` | Path to unix socket for daemon↔worker IPC. Used to send shutdown signals to idle workers (see L90 `tengu_bg_retired`). |
| `CLAUDE_BG_SOURCE` | Where the BG session was spawned from (set by daemon when dispatching workers) |
| `CLAUDE_JOB_DIR` | Per-job state directory: worktree, transcript, PTY recording all live here |
| `CLAUDE_PTY_RECORD` | File path for terminal-stream recording. Internal `--bg-pty-host <sock> <cols> <rows> -- <file> [args...]` argv mode hosts the PTY over a unix socket and records the entire terminal stream via `Bun.Terminal` `data` callback to this file. |
| `CLAUDE_AGENT` | Agent identifier (set when running as a Fleet-view-tracked agent) |
| `CLAUDE_AGENTS_SELECT` | Pre-selected agent ID to highlight in Fleet view (used when left-arrow keybinding spawns child `claude agents`) |
| `CLAUDE_CODE_AGENT` | Internal agent identity for the Claude Code instance (parallel to the agent-config concept) |
| `CLAUDE_CODE_HIDE_CWD` | UI privacy knob: when truthy, blanks the `cwd` field in the status-line/header display. Doesn't affect actual cwd. Useful for screensharing/streaming. |
| `CLAUDE_CODE_VERIFY_PROMPT` | **Debugging-workflow discipline toggle, NOT a safety gate.** When set (or `tengu_sparrow_ledger` GB flag on), injects a "reproduce_verify_workflow" section into the system prompt: 3-step reproduce → fix → re-observe instructions. See L90 for the full prompt content. |
| `CLAUDE_CODE_CLASSIFIER_SUMMARY` | Manual override for classifier-summary engine selection: truthy → `"llm"`, falsy → `"heuristic"`. Bypasses GB-flag-driven default. |
| `CLAUDE_INTERNAL_FC_OVERRIDES` | Internal function-calling overrides (no user-facing surface in v2.1.119) |

### Stealth promotions (already-existing env vars that became load-bearing in v2.1.119)

These pre-existed in v2.1.118 (3 occurrences each) but their occurrence counts jumped in
v2.1.119 because they became central to the BG-runtime path. The corrected env-var diff
(see L88) doesn't flag them since they were already present:

- `CLAUDE_BG_BACKEND` (L85) — now central to `uC_()` daemon-backend check
- `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` — additive Cowork memory hint (the bypass form
  `CLAUDE_COWORK_MEMORY_GUIDELINES` arrives in v2.1.120, see L90)

---

## New Slash Commands (4)

| Command | Description |
|---------|-------------|
| `/background` (alias `/bg`) | Continue this session in the background and free the terminal |
| `/stop` | Stop this background session; transcript and worktree are kept (only enabled when `SESSION_KIND === "bg"`) |
| `/daemon` | Manage background services: assistants, scheduled tasks, and remote-control servers |
| `/autocompact` | Configure the auto-compact window size *(re-introduced — was removed in v2.1.117 / L87)* |

`/exit` description changed: `Exit the CLI` → `Exit the CLI (in a background session: detach
or stop)` — acknowledges that exit semantics depend on the session kind.

---

## New Telemetry / GB Flag Identifiers (62)

Categorized below. None require user-visible surface changes; all are observability/feature-gate.

### Background + daemon (36 events) — daemon supervisor + worker lifecycle

`tengu_background`, `tengu_background_already_bg`, `tengu_background_declined`,
`tengu_background_fork`, `tengu_background_spawn_failed`, `tengu_bg_adopt`,
`tengu_bg_agent_action`, `tengu_bg_agent_dispatch`, `tengu_bg_agent_terminal`,
`tengu_bg_attach`, `tengu_bg_attach_legacy_autorespawn`, `tengu_bg_classify`,
`tengu_bg_daemon_install`, `tengu_bg_daemon_zombie_restart`, `tengu_bg_dispatch`,
`tengu_bg_dispatch_fallback`, `tengu_bg_leftarrow_inprocess`, `tengu_bg_orphan_reap`,
`tengu_bg_proto_mismatch`, `tengu_bg_pty_unavailable`, `tengu_bg_respawn_exhausted`,
`tengu_bg_respawn_stale`, `tengu_bg_roster_parse_failed`, `tengu_bg_skew_nudge`,
`tengu_bg_worker_exit`, `tengu_bg_worker_spawn`, `tengu_daemon_auto_uninstall`,
`tengu_daemon_config_reload`, `tengu_daemon_control`, `tengu_daemon_idle_exit`,
`tengu_daemon_install`, `tengu_daemon_lease`, `tengu_daemon_self_restart_on_upgrade`,
`tengu_daemon_start`, `tengu_daemon_worker_crash`, `tengu_daemon_worker_permanent_exit`

### Fleet view (4 events)

`tengu_fleetview` (TUI mounted), `tengu_fleetview_pr_batch` (batched PR fetch toggle),
`tengu_fg_left_arrow_agents` (foreground left-arrow keypress), `tengu_open_agents_via_left`
(agents view spawned via left arrow)

### Pro-trial conversion (4 events)

`tengu_pro_trial_start_screen_shown`, `tengu_pro_trial_start_pressed`,
`tengu_pro_trial_start_ok`, `tengu_pro_trial_start_error`

### Classifier / summary (4 events + flags)

`tengu_classifier_disabled_surfaces` (skip-list flag), `tengu_classifier_summary_heuristic_emit`
(staged-rollout flag for heuristic), `tengu_classifier_summary_llm_emit` (staged-rollout flag
for LLM), `tengu_classifier_summary_kill` (master kill switch)

### Codename GB flags (5 — feature-rollout vehicles)

| Flag | Identified usage |
|------|------------------|
| `tengu_cobalt_wren` | Classifier-summary cost circuit-breaker (downgrades LLM → heuristic) |
| `tengu_hazel_osprey_floor` | Not yet identified |
| `tengu_sepia_cormorant` | Not yet identified |
| `tengu_slate_meadow` | Not yet identified |
| `tengu_sparrow_ledger` | `CLAUDE_CODE_VERIFY_PROMPT` GB-flag form (gates the reproduce-verify workflow prompt section) |

### Other (9 events)

`tengu_assistant_install`, `tengu_auto_mode_subsequent_approval`,
`tengu_autocompact_command`, `tengu_autocompact_dialog_opened`, `tengu_mcp_degraded`,
`tengu_migrate_user_intent_to_settings`, `tengu_quota_mismatch`, `tengu_remote_trigger`,
`tengu_spinner_stalled_ui`

### Removed (1)

`tengu_thinking_clear_latched` — gone with no replacement.

---

## Pre-Existing Public Surface Worth Cross-Referencing

The L89 user-facing surface is mostly dark-launched, but two **pre-existing public** slash
commands are closely related and *do* work for default users — worth knowing about
alongside the new dark-launched material:

| Command | Description (verbatim from registration) | Note |
|---------|------------------------------------------|------|
| `/agents` | "Manage agent configurations" | Pre-existed v2.1.118. Different from the dark-launched `claude agents` Fleet view CLI subcommand — see disambiguation in the Fleet View section above. |
| `/tasks` (alias `/bashes`) | "List and manage background tasks" | Pre-existed v2.1.118. Public surface for managing background bash tasks (the **Ctrl+B** backgrounded shell commands), distinct from the dark-launched `/background` (which forks the *session*). If a user asks "how do I manage my background tasks", `/tasks` is the answer for default users; `/daemon` is the answer for Cowork users when its gate is opened. |

## Public Settings Added in v2.1.119 (Confirmed via Official Changelog)

The official Anthropic v2.1.119 changelog confirms one settings addition my diff missed.
`scripts/diff-versions.sh` extracts env vars but not `~/.claude/settings.json` keys, so this
slipped through:

| Setting | Description |
|---------|-------------|
| `prUrlTemplate` | "URL template for PR links in the footer badge and inline messages. Placeholders: `{host} {owner} {repo} {number} {url}`. Example: `https://reviews.example.com/{owner}/{repo}/...`." Used by `JA_(H)` (PR-link rendering helper). Supports the Fleet view's per-PR display when that surface eventually opens, plus the existing footer/inline PR-badge display today. |

> **Tooling gap noted**: `scripts/diff-versions.sh` `extract_settings()` does not exist —
> the script extracts env vars, slash commands, hook event types, API beta strings, and
> tengu_* identifiers, but not config-schema field names. Future versions of this skill
> should consider adding settings extraction (look for `Z(\w*).object({...})` Zod schemas
> or settings-key string sets).

## What Did NOT Change in v2.1.119

- **Hook event types**: 19, unchanged
- **API beta strings**: 32, unchanged (no new beta despite the major surface additions)
- **Permission pipeline**: unchanged 7-phase flow (L8)
- **OIDC Federation surface (L86)**: unchanged
- **`/fork` subagent type / `kind:"fork"`**: unchanged. The *parent-conversation
  inheritance mechanism* did change in v2.1.119 (full-copy → pointer + hydrate-on-read,
  per official changelog) — see `/background` section above. The subagent type itself,
  the `iv()` enable check, and the `tengu_copper_fox` GB flag are all unchanged.

---

## Cowork's Tool Architecture: Why `Bash` Isn't Where You Expect It (And Where It Is)

> **History — corrected three times.** Originally added v2.11.3 with a wrong mechanism
> (claimed the CLI's async filter strips Bash; binary shows Bash IS in that allowlist).
> Corrected v2.11.13 (2026-05-09) but kept sub-agent-specific framing. Corrected
> v2.11.14 (2026-05-10) widening the scope to Cowork-wide. Corrected v2.11.15
> (2026-05-10) leading with the clean framing instead of incrementally fixing the
> original. The empirical claim ("Cowork sub-agents declared with narrow `tools:` lists
> that include `Bash` find it unavailable") was always correct; the mechanism
> explanations and scope framings shipped between v2.11.3 and v2.11.14 were wrong in
> ways that masked the actual simple story.

### The simple story

**Cowork has no built-in `Bash` tool. At any dispatch level. Period.**

The shell path in Cowork is `mcp__workspace__bash` — an MCP tool registered by the
desktop's `workspace` MCP server, which runs commands inside the workspace VM. It's
in the **deferred tool tier**: name visible in the registry, schema loaded on demand
via `ToolSearch`, callable after that. Same on macOS, Windows, Linux; same at
top-level main session, async forked sub-agent, sync Task-tool sub-agent. The literal
name `Bash` doesn't refer to a registered tool *anywhere* in Cowork.

The reason `SKILL.md` files routinely say "run X via bash" without ever declaring
`allowed-tools: Bash` and have it work, is that the main-thread model has both
`ToolSearch` (immediate tier) and `mcp__workspace__bash` (deferred tier) in its
registered set. When the model reads "run X via bash," it calls `ToolSearch` to load
the bash tool's schema, then invokes `mcp__workspace__bash` with the command. From
the skill author's perspective, "Bash works in Cowork." From the binary's
perspective, no tool named `Bash` was ever called.

The reason a sub-agent with a *narrow* `tools:` declaration like
`["Read", "Bash", "Task", "Glob", "Grep"]` *can't* do shell isn't the async filter:
the literal name `Bash` doesn't resolve, `Task` is canonicalized to `Agent` (which is
in the sub-agent drop set under default settings), and `mcp__workspace__bash` isn't
declared. The agent ends up with `{Read, Glob, Grep}` — read-only.

This is exactly what the [founder-skills v0.3.0 incident](#what-the-founder-skills-v030-incident-actually-was)
was. The fix the team chose (adding `Write`/`Edit`) gave the agent persistence; an
alternative fix would have been adding `mcp__workspace__bash` + `ToolSearch`, with
the operational caveats discussed below.

### Mechanism: desktop-side host-loop registration excludes the names

The exclusion happens in the desktop bundle (`Claude.app/Contents/Resources/app.asar`
→ `.vite/build/index.js`), not the CLI bundle. When the desktop spawns a Cowork
session, it runs the registered built-in tools through a host-loop-safe set. Five
names are excluded: `Bash`, `NotebookEdit`, `REPL`, `JavaScript`, `WebFetch`. Each
gets an MCP replacement registered separately by the workspace MCP server:

- `Bash` → `mcp__workspace__bash` (Linux aarch64 Ubuntu shell inside the workspace VM)
- `WebFetch` → `mcp__workspace__web_fetch`

The exclusion is **Cowork-mode only**. CCD mode (host CLI invoked without `--cowork`,
no microVM) registers all five normally — host bash is callable as `Bash` in CCD.

The CLI does have its own async sub-agent allowlist filter (`Tw8`/`LW8`), and it runs,
and `Bash` is in its allowlist (via the spread member `[Bash, PowerShell]`). But
that's irrelevant for the Bash question in Cowork because the desktop's exclusion
already removed Bash from the input pool. The CLI filter is downstream — it does
enforce real differential restrictions on async sub-agents (drops `AskUserQuestion`,
`Agent`, plan-mode tools, etc.), but those are unrelated to Bash.

### Cowork's tool tiers

Cowork's tool availability has two tiers. Both top-level and sub-agent see the same
two-tier shape; they differ only by the `Agent` tool (top-level has it; sub-agents
don't, because of the CLI's drop set).

- **Immediate tier** — schemas pre-loaded, callable directly. Small set of ~10 names:
  `Edit, Glob, Grep, Read, Skill, ToolSearch, Write, Agent` (top-level only) plus a
  small visualize-MCP set.
- **Deferred tier** — name visible in the registry, schema loaded on demand via
  `ToolSearch`. Calling a deferred tool directly fails with `InputValidationError`
  until ToolSearch loads its schema.

**Most of the toolset is deferred**, not just shell. `WebSearch`, `AskUserQuestion`,
all `mcp__cowork__*`, all `mcp__workspace__*` (including `mcp__workspace__bash`), all
`mcp__skills__*`, all `mcp__plugins__*`, all `mcp__scheduled-tasks__*`, plus all
connector-server tools (Slack, Notion, Calendar, Gmail, Canva, Airtable, etc.) — all
deferred.

This tiering is the Cowork architectural choice that makes the user-perceived "Bash
works" experience possible. The model has `ToolSearch` immediate, the deferred tier
visible by name, and the inference to load+call the right deferred tool when a user
or skill says "run X via bash." Skill authors don't need to know which specific MCP
tool runs commands — the model figures it out — as long as they're in a context
where the deferred tools are accessible.

### Why `SKILL.md` works without `allowed-tools`

A SKILL.md running in the main thread has the full Cowork tool registry available:
immediate + deferred. When the skill body says "run the script via bash" (or shows
`python3 scripts/foo.py`), the model:

1. Recognizes the request needs shell.
2. Calls `ToolSearch` (immediate tier) to find a bash-capable tool.
3. ToolSearch returns the schema for `mcp__workspace__bash` (deferred → now loaded).
4. Model invokes `mcp__workspace__bash` with the command.

No `allowed-tools` declaration was needed because the registered tool set is the full
Cowork set; the only constraint `allowed-tools` controls is *permission*, not
*availability*. The skill author writes shell-using prose; the model handles the
actual call.

### Why a narrow-`tools:` sub-agent doesn't get the same behavior

A sub-agent dispatched by `SKILL.md` gets a tool set built from its own `tools:`
frontmatter intersected with the inherited Cowork tool set. The behavior depends
sharply on what the agent declared:

- **Wildcard `tools: ["*"]`**: the sub-agent inherits the full filtered base set,
  including `mcp__workspace__bash` (deferred) and `ToolSearch` (immediate). It can
  use shell with the same "ToolSearch then call" pattern the main thread uses.
- **Narrow declaration omitting shell-relevant names**: e.g.
  `tools: ["Read", "Bash", "Task", "Glob", "Grep"]`. The intersection with registered
  tool names is:
  - `Read`, `Glob`, `Grep` → registered → kept
  - `Bash` → not a registered tool name in Cowork → no-op (drops to `invalidTools`)
  - `Task` → canonicalized to `Agent` at parse → in the sub-agent drop set → no-op
  - Result: `{Read, Glob, Grep}`. Read-only. No shell. No persistence.

The narrow-declaration case is the founder-skills v0.3.0 case. It's **not** that the
filter "stripped Bash" — there was no registered Bash to strip. It's that the
declaration named tools that don't exist in Cowork, plus omitted the tools that
*could* have given the agent shell (`mcp__workspace__bash` and `ToolSearch`).

### What the founder-skills v0.3.0 incident actually was

The founder-skills team's [2026-04-29 investigation](https://github.com/yaniv-golan/lool-ventures-founder-skills/blob/main/docs/internal/2026-04-29-cowork-subagent-investigation.md)
(in the project's internal docs) documented a Cowork run where five sub-agents
silently produced prose narration instead of artifact files. The diagnostic stages
were sound; the empirical findings (sub-agents reporting `tool_uses: 0`, fabricating
shell transcripts in their narrative replies, resolving to `{Read, Glob, Grep}`)
were correct. The root-cause attribution was wrong:

- **Stated cause**: "Cowork's async sub-agent dispatch filters Bash out of every
  sub-agent's toolset, regardless of what the agent's `tools:` frontmatter declares."
- **Actual cause**: The sub-agent's `tools:` declaration named `Bash` and `Task`,
  neither of which is a registered tool name in Cowork. Both no-op'd. The
  declaration's intersection with the registered set yielded `{Read, Glob, Grep}`.

The team's fix (v0.3.1: add `Write`/`Edit` to the agent declarations) was correct
for their use case — the agents needed to persist data files, and `Write`/`Edit` are
real registered names that work without VM dependency. But this fix doesn't give
agents shell. For their full pipeline (producer scripts, compose, validation),
shell-bound work had to live somewhere — and the team's v0.4.1 architecture
correctly chose the main thread for that.

The team's v0.4.1 architecture ("SKILL.md runs in main thread; sub-agents do
analytical work via Read/Edit/Glob/Grep only") is **right architecture**, even
though the rationale documented in their `cowork-architecture-and-v0.4.x-learning.md`
("Cowork sub-agents can't run Bash because of the filter") is partially wrong. The
right rationale: narrow sub-agent tool declarations that omit
`mcp__workspace__bash` + `ToolSearch` have no shell path in Cowork; main-thread
orchestration is simpler than declaring those + the ToolSearch dance + the
operational baggage of `mcp__workspace__bash` (VM dependency, no cwd carryover,
mount-path translation, `outputs/` boundary, `pip --break-system-packages`,
Linux-only shell idioms).

### `mcp__workspace__bash` operational contract

Skills targeting Cowork that DO use shell from a sub-agent need to know
`mcp__workspace__bash` is **not equivalent to host `Bash`**. From an actual probe of
a v2.1.121-bundled Cowork session:

- **Sandbox is a Linux microVM, not the user's Mac.** aarch64 Ubuntu container at
  `/sessions/<sessionId>/`. Even on macOS or Windows, the bash inside is Linux bash
  with a Linux PATH. On Windows the VM is served by `CoworkVMService` (Hyper-V); on
  macOS by Apple Hypervisor with `smol-bin.{x64,arm64}.img`.
- **Each call is independent — no cwd or env carryover between calls.** Multi-step
  pipelines must chain (`&&`, `;`, `|`) into a single command, or use absolute paths
  in every step. A skill that does `cd foo` in one call and expects the next call's
  cwd to be `foo/` is broken in Cowork.
- **Skill files mount under `/sessions/<id>/mnt/`, not at host paths.** A SKILL.md
  saying `python3 scripts/foo.py` doesn't work as written — `scripts/foo.py` is a
  host-relative path that doesn't exist in the VM. The skill needs to either
  `cd /sessions/<id>/mnt/.claude/skills/<skill>/` first (chained into the same
  `mcp__workspace__bash` call as the python invocation) or use the absolute mount
  path: `python3 /sessions/<id>/mnt/.claude/skills/<skill>/scripts/foo.py`.
  Hard-coded host paths (`/Users/yaniv/...`) fail in the VM.
- **Persistence boundary: only `/sessions/<id>/mnt/outputs/` survives session end.**
  Maps to the host's `~/Library/Application Support/.../outputs/` directory and is
  what the user can see via the Cowork desktop UI. Files written elsewhere in the
  sandbox (`/tmp/`, `~`, scratch dirs) vanish at session end and are invisible to
  the user during the session.
- **Sandbox tooling.** Python 3, Node.js, standard CLI tools (git, curl, jq, etc.),
  and allowlisted network egress are preinstalled. The exact allowlist depends on
  the Cowork user's network-egress setting in `Settings → Capabilities → Allow
  network egress`. `pip install` requires `--break-system-packages` (PEP 668).
- **Out of scope: native-Mac driving.** Skills opening native macOS apps,
  controlling the desktop, driving Adobe apps, or reading host paths outside the
  mounts go through *different* MCP servers, not through `mcp__workspace__bash`.
- **VM dependency.** When the platform VM service fails to start,
  `mcp__workspace__bash` dies with `Workspace unavailable. The isolated Linux
  environment failed to start.` File-op tools (`Read`, `Write`, `Edit`, `Glob`,
  `Grep`) keep working because they don't depend on the VM. See
  [GH#56772](https://github.com/anthropics/claude-code/issues/56772) for the
  Windows-specific autostart failure.

For skill authors moving a working CCD skill into Cowork, the most common breakages
are: (1) relative-path script invocations breaking under VM mount paths;
(2) `cd`-then-do-stuff patterns broken by the no-cwd-carryover rule; (3) artifacts
written outside `outputs/` invisible to the user; (4) `pip install` failing without
`--break-system-packages`; (5) host-path references (e.g. `/Users/...`) failing
because they don't exist in the VM.

### What the CLI's async sub-agent filter actually does (for completeness)

The CLI has a filter that runs at sub-agent dispatch time. It IS the gate for several
real restrictions on async sub-agents — distinct from Layer 1's Cowork-wide name
exclusion, but worth knowing because it explains other absences:

- `AskUserQuestion` — dropped from forked sub-agents. Top session keeps it.
- `Agent` — dropped from forked sub-agents (no nested dispatch).
- `ExitPlanMode`, `EnterPlanMode`, `TaskOutput`, `WaitForMcpServers` — also dropped.

These are CLI-side and DO take effect at the async-dispatch boundary. They're real,
they affect behavior, and they explain why a sub-agent can't ask the user questions
or dispatch nested sub-agents. They just don't explain Bash unavailability — Bash
was never registered in Cowork to be in this filter's input.

The original v2.11.3 source-level trace (preserved as archaeology below) accurately
described this filter's mechanism — `Tw8`/`Jl_`/`vc`/`r3H`/`F_8`/`Sz`/`n0`/`ev6`. It
just looked at the wrong layer for the Bash question. Skip ahead to
[Implications](#implications--updated-v21113-revised-2026-05-10) for the actionable
guidance; what follows is debugging archaeology of the wrong layer.

### Plugin hooks in Cowork sessions

> **CORRECTION (v2.11.18, verified against CLI 2.1.159).** The original v2.11.16 version of
> this section claimed plugin hooks "never fire in Cowork" *because* `--setting-sources=user`
> excludes plugin scope from hook discovery. **That mechanism is empirically false** and is
> retracted below. What remains verified: (1) the desktop *does* spawn the in-VM CLI with
> `--setting-sources=user` + per-plugin `--plugin-dir` (the logged argv below is real); (2) the
> "zero hook lines in `cowork_vm_node.log`" observation is real. What's corrected: the *cause*.
> **RESOLVED (real-Cowork test, 2026-06-01):** plugin hooks DO fire in Cowork (host-loop staging);
> the determinant is a three-root plugin namespace — a real desktop Cowork session reads only
> `local-agent-mode-sessions/<acc>/<org>/cowork_plugins` (install via the Cowork app UI), which the
> standalone-CLI `--cowork` install never reaches. The empty-log observation = plugins not in that
> namespace. Full mechanism below.

#### What was wrong: `--setting-sources=user` does NOT exclude plugin hooks

Direct test against the live CLI 2.1.159 — a canary plugin whose `SessionStart` hook runs
`bash ${CLAUDE_PLUGIN_ROOT}/h.sh`:

```bash
claude --plugin-dir <canary> -p "hi"                       # hook FIRES
claude --plugin-dir <canary> --setting-sources=user -p "hi" # hook STILL FIRES, ${CLAUDE_PLUGIN_ROOT} resolves
CLAUDE_CODE_USE_COWORK_PLUGINS=1 \
  claude --plugin-dir <canary> --setting-sources=user -p "hi" # FIRES; data under cowork_plugins/
```

So `--setting-sources=user` — applied to exactly the `--plugin-dir` plugins the real Cowork argv
loads — does **not** suppress plugin `SessionStart` hooks. Binary trace agrees: plugin hooks load
through the **plugin-enablement pipeline**, not settings-source resolution. `loadPluginHooks` (`p6H`
in 2.1.159) iterates *enabled* plugins and reads each one's `hooksConfig` into the full event map
(including `SessionStart`); the `SessionStart` dispatcher `await`s it. The only gates are
`CLAUDE_CODE_SIMPLE`/`--bare`, `disableAllHooks`, and `allowManagedHooksOnly` (the last only when
there are *no* managed plugins) — **none Cowork-specific, none tied to `--setting-sources`.** There
is no `CLAUDE_CODE_IS_COWORK` branch anywhere near hook loading or dispatch. `${CLAUDE_PLUGIN_ROOT}`
is injected/substituted for any plugin-associated hook regardless of session type.

#### New verified finding: there are THREE plugin roots (the namespace split is subtler than ph5())

The Cowork-specific difference is a namespace split, but it has **two distinct Cowork roots** — and the
binary's `ph5()`/`A41()` only describe the standalone-CLI one:

1. `~/.claude/plugins/` + `settings.json` — **regular CCD**.
2. `~/.claude/cowork_plugins/` + `~/.claude/cowork_settings.json` — what the **standalone CLI's**
   `claude plugin install --cowork` writes to (binary `ph5()`/`A41()`, gated by
   `CLAUDE_CODE_USE_COWORK_PLUGINS`/`useCoworkPlugins`). A CLI run in this mode fires plugin hooks from
   here (verified locally).
3. `~/Library/Application Support/Claude/local-agent-mode-sessions/<accountId>/<orgId>/cowork_plugins/cache/<mp>/<plugin>/<version>/`
   (plus `…/<acc>/<org>/rpm/plugin_<id>` for org-remote plugins) — what the **desktop Cowork app**
   actually provisions sessions from, keyed by **account + org**. Installs done via the **Cowork app
   plugin UI** land here. ⚠️ The standalone-CLI `--cowork` install (root #2) does **NOT** reach root #3,
   so a CLI `--cowork` install is invisible to a real desktop Cowork session. To get a plugin into a
   desktop Cowork session you must install it through the Cowork app, not the standalone CLI.

`--cowork` on `claude plugin` subcommands also enforces "can only be used with user scope."

#### RESOLVED: plugin hooks DO fire in Cowork (host-loop execution)

Verified end-to-end (2026-06-01). A canary plugin (SessionStart hook running
`bash ${CLAUDE_PLUGIN_ROOT}/h.sh`, emitting `additionalContext`) was installed via the **Cowork app
UI** (root #3) and a real desktop Cowork session was opened. The model received the hook's
`additionalContext` verbatim — `COWORK_HOOK_CANARY_FIRED … root=/var/folders/.../T/claude-hostloop-plugins/<hash>`
— so the hook **fired** and `${CLAUDE_PLUGIN_ROOT}` **resolved**.

Mechanism: at session start the desktop's **host loop** builds a temp staging dir
`/var/folders/.../T/claude-hostloop-plugins/` containing one `<hash>` symlink **per enabled plugin** →
its real dir (e.g. `…/<acc>/<org>/cowork_plugins/cache/<mp>/<plugin>/<ver>` for marketplace plugins, or
`…/<acc>/<org>/rpm/plugin_<id>` for org-remote plugins). `${CLAUDE_PLUGIN_ROOT}` resolves to that
host-loop symlink path, and the hook executes **host-side via the host loop** (not inside the VM).

**So the original "zero hook lines" observation is fully explained:** those sessions' hook-bearing
plugins simply weren't installed into the desktop's account/org Cowork namespace (root #3), so they
weren't symlinked into the host-loop staging, so nothing fired. Nothing about `--setting-sources` or
hook-scope was ever involved. The determinant is **which plugin root the plugin lives in**, and the
fix is **install via the Cowork app UI** (or org-remote/RPM), not the standalone CLI.

#### What the hook-firing test did NOT prove — and the in-VM `${CLAUDE_PLUGIN_ROOT}` resolution (tested 2026-06-01)

The canary above proves exactly two things: the SessionStart hook **executes host-side**, and its
`additionalContext` (stdout JSON) **reaches the model**. It says **nothing** about whether a hook's
*side effects* — an `export FOO=…`, a `mkdir`/`cp`, or a staged script — are visible to the **in-VM
agent shell** (`mcp__workspace__bash`). Those are separate questions, because hooks run on the host
while the agent's bash runs in a Linux microVM (see [`mcp__workspace__bash` operational
contract](#mcp__workspace__bash-operational-contract)). A second probe (`coworkroot-probe`, installed
via the Cowork app UI, run in a real desktop session) settled them:

| Probe | Result | Conclusion |
| --- | --- | --- |
| `${CLAUDE_PLUGIN_ROOT}` substituted in **skill content** (STEP 1) | `…/T/claude-hostloop-plugins/<hash>` — **the host path** | The token resolves to the **same host staging path in skill content as in hook commands**. It is **NOT context-dependent** — it is host-side *everywhere*. |
| `ls`/exec that token path from `mcp__workspace__bash` | **fails** — path absent in the VM | `${CLAUDE_PLUGIN_ROOT}` is **useless for in-VM invocation**: it names a host path the sandbox cannot see. |
| `find … -name <script>` in the VM (ground truth) | `/sessions/<id>/mnt/.remote-plugins/plugin_<id>/scripts/<script>` | Plugin files **are** mounted in-VM, but at a **remapped** path keyed by `plugin_<id>` under `.remote-plugins/` (the `rpm`/org-remote half of root #3; the marketplace half mounts under `.local-plugins/cache/<mp>/<plugin>/<ver>`, per the argv below). |
| hook `export PROBE_ENV_FROM_HOOK=…` read in-VM | **empty** | A hook's environment exports do **not** cross into the agent shell. |
| host `/tmp/...` file written by the hook, `cat` in-VM | **missing** | Host filesystem writes by a hook are **not** visible in the VM. |
| `env` field in `~/.claude/settings.json` (user scope), read in-VM | **empty** | The settings `env` map is `Object.assign`'d into `process.env` for the **CLI** (binary: `Object.assign(process.env, v9_(I6(scope)…))` over user/project/local/managed/policy; schema `env: h.record(h.string())`), and a fresh CLI session echoes the value — but it does **not** reach the Cowork sandbox. |
| `env` field in `/Library/Application Support/ClaudeCode/managed-settings.json` (managed scope), read in-VM | **empty** | Even the highest-priority host settings scope does not cross. **No host-filesystem settings scope (user OR managed) reaches the Cowork sandbox** (re-verified v2.1.160, 2026-06-02 with `hello-from-host`/`hello-from-managed` sentinels). |

**Consequences for skill authors targeting Cowork:**

- **Do not invoke plugin scripts via `${CLAUDE_PLUGIN_ROOT}` from skill content that runs in-VM** — the
  substituted value is a host path that fails in the sandbox. The token is correct only inside *hook
  commands* (which run host-side).
- The viable in-VM escape hatch is the **runtime-discovered mount**:
  `/sessions/<id>/mnt/.remote-plugins/plugin_<id>/…` (or `.local-plugins/cache/…` for marketplace
  installs). `plugin_<id>` is install-specific, so discover it at runtime (e.g.
  `find /sessions/*/mnt/.*-plugins -name <script>`) rather than hardcoding it.
- **Never depend on a `SessionStart` hook to `export` an env var or stage a file for the agent — nor on the
  `settings.json` `env` field (user *or* managed scope)** — none of these cross the host↔VM boundary. Pass
  data by **flag/argument** to a script invoked at the discovered mount path, or write it where the VM can
  read it. (This is the same class of bug as a host-injected `$VAR` contract: it works in single-process
  CCD, silently breaks in Cowork.) For getting a third-party API key (Airtable/Affinity, etc.) *into* a
  Cowork session, the host has no env channel to the **in-VM shell** — use an MCP server (`mcpServers` in
  `claude_desktop_config.json`, key in the server's `env:` block — runs host-side, see the split-execution
  section below), a proxy that injects credentials into outbound calls, or the account-level claude.ai
  connectors; the only thing the *sandbox shell* ingests from the host is Anthropic's own auth via the SDK
  RPC channel (see L99).

#### Split execution: host-side MCP servers vs the sealed in-VM shell (verified 2026-06-03)

The host↔VM table above is about the **in-VM agent shell** (`mcp__workspace__bash`). But Cowork has a **split execution model**, and the other half changes the credential story. Empirically tested (real desktop Cowork session, app v1.x / CLI v2.1.160):

- **stdio MCP servers declared in `~/Library/Application Support/Claude/claude_desktop_config.json` run on the HOST, not in the VM** — spawned by the Desktop (Electron) app through a login shell, and bridged into the Cowork session as `mcp__<server>__*` tools. Proof: a `cowork-probe` entry (`npx @modelcontextprotocol/server-everything`) appeared in a Cowork session, and its `get-env` returned **macOS host paths** (`/opt/homebrew/.../node`, user-agent `darwin arm64`, `__CF_USER_TEXT_ENCODING`, the full host *shell* `PATH` incl. pyenv/cargo/nvm/pnpm) **plus** the per-server `PROBE_MARKER=from-desktop-config` from its `env:` block.
- **This corrects the "import-only" read of `claude_desktop_config.json`.** That was true only for the *CLI binary* (where the file is reachable solely via `claude mcp add-from-claude-desktop`). The *Desktop app* genuinely reads `mcpServers` from it (it has validation + error dialogs: *"…not valid MCP server configurations and were skipped"*) and wires those servers into Cowork.
- **The MCP env-allowlist (`CLAUDE_CODE_MCP_ALLOWLIST_ENV` → `RW8`/`oG8`/`LU5`={HOME,LOGNAME,PATH,SHELL,TERM,USER}) governs only CLI-spawned servers** (`.mcp.json`/`--mcp-config`, in-sandbox). It does **not** govern these Desktop-host-spawned servers, which receive the full host env. (So `launchctl setenv`/`~/.zshrc` vars likely reach a `claude_desktop_config.json` server — not isolation-tested; the `PROBE_MARKER` arrived via `env:`.)
- **The host→Cowork *session* env is Anthropic-auth-only** — built by `Ucr({oauthToken, apiHost, shellPath, subscriptionType})` (`sessionEnv`), not user-controllable. The local-agent session-config schema `{skills, mcpServers, hooks, agents, clis}` has **no `env` field**.

**Getting credentials in — the validated routes:**

| Need | Route | Why it works |
| --- | --- | --- |
| Key for an MCP-shaped integration | `claude_desktop_config.json` → `mcpServers.<name>.env` | server runs host-side, key never enters the VM, available in every Cowork session after a Desktop restart |
| Key for a **non-MCP CLI run in the in-VM shell** | secrets file in a **mounted folder**, read inline | no env channel reaches the in-VM shell; the filesystem mount is the only host→VM path (read + use in ONE `mcp__workspace__bash` call — no env carryover) |
| Standard CRM/data ops | account-level claude.ai connectors (`remoteMcpServers`) | OAuth-once, no keys |

**"Always-mounted path" = a Cowork Project (= the code's `CoworkSpace`).** Verified by the binary string `Space "${n}" not found. Use list_projects to see available spaces` — the UI's **"Project"** and the code's **"Space"** are the same object. There is **no** free-form "always mount path X" key in `claude_desktop_config.json`; per-spawn mounts derive from `userSelectedFolders` + app dirs (note: the auto-mounted `.claude` is a *per-session synthesized* dir from session storage — `getClaudeConfigDir()` — **not** `~/.claude`, which is why user `settings.json` `env` never reaches the VM). A folder-bound Project (`ProjectLocal`, fields incl. `ccdFolderPath` + `autoMountFolders`, stored server-side at claude.ai, *"Claude will have read and write access to this folder"*) auto-mounts its folder for every session started in it. So: attach the secrets-file folder to a Project → it's mounted in every session of that Project, no manual per-session mount. `localAgentModeTrustedFolders` (in `claude_desktop_config.json`) is trust/auto-**approval**, not auto-mount (*"directory mounts use userSelectedFolders"*).

#### Verified: the desktop launch argv

The desktop does spawn the in-VM CLI with `--setting-sources=user` + per-plugin `--plugin-dir`
(real, from `~/Library/Logs/Claude/cowork_vm_node.log`):

```
[Spawn:create] id=<uuid> name=<session-name> cmd=/usr/local/bin/claude args=
  --output-format stream-json --verbose --input-format stream-json
  --max-thinking-tokens 31999 --effort medium --model claude-opus-4-6
  ...
  --setting-sources=user                                         ← THIS
  --permission-mode default --allow-dangerously-skip-permissions
  ...
  --plugin-dir /sessions/<id>/mnt/.local-plugins/cache/<mp>/<plugin>/<version>
  --plugin-dir /sessions/<id>/mnt/.local-plugins/cache/<mp2>/<plugin2>/<version>
  ...
```

`--setting-sources=user` restricts the CLI's *settings* resolution to user scope (i.e.
`~/.claude/settings.json`). The original section inferred from this that plugin-scoped hooks are
"silently excluded from hook discovery." **That inference is wrong** (see the correction above):
plugin hooks don't flow through settings-source resolution at all — they flow through the
plugin-enablement pipeline, and `--plugin-dir` plugins fire their hooks even with
`--setting-sources=user` set. The argv is real; the exclusion conclusion drawn from it is not.

Empirical confirmation (real observation, now *explained*): across 8 MB of recent
`cowork_vm_node.log` and 2 MB of `coworkd.log` activity, **zero "hook" log lines for any Cowork
session**, while CCD-mode sessions (IDs `local_<uuid>` vs the `<adj>-<adj>-<word>` Cowork pattern)
on the same host show `[Stop hook] Query completed` entries. This observation is genuine, but per the
RESOLVED note above it does **not** mean hooks are *excluded* — it means the hook-bearing plugins in
those sessions weren't installed into the desktop's account/org Cowork namespace
(`local-agent-mode-sessions/<acc>/<org>/cowork_plugins`), so none were symlinked into the host-loop
staging and nothing fired. The real-Cowork test (canary installed via the Cowork app UI) **did** fire.

#### Upstream tracking

- [#16288 — Plugin hooks not loaded from external hooks.json file](https://github.com/anthropics/claude-code/issues/16288):
  the general CLI bug. Per binary analysis pasted into the thread, most hook
  dispatchers in the CLI (e.g. `runAgent` for `SubagentStart/Stop`, the `Stop` hook
  path) call hook execution without first `await`-ing `loadPluginHooks()`. Plugin
  hooks load fire-and-forget at startup. If the load promise hasn't resolved when
  the dispatcher runs, plugin hooks are invisible. Only `processSessionStartHooks`
  has the await guard. Affects CCD too (intermittently, per race timing).
- [#27398 — Cowork: Plugin hooks from hooks/hooks.json never fire](https://github.com/anthropics/claude-code/issues/27398):
  the user-reported symptom. Its title attributes the cause to "`--setting-sources user` excludes
  plugin scope" — **that attribution is the mechanism this correction retracts** (see above; closed
  as a duplicate of #16288). The symptom reports may be real; the `--setting-sources` *cause* is not
  the explanation. The more likely real cause is the namespace split (a normally-installed plugin
  isn't in `cowork_plugins/`) — pending the decisive real-Cowork test.

The #16288 race is a real, separate bug, independent of this correction: most CLI hook dispatchers
fire `loadPluginHooks()` fire-and-forget; only `processSessionStartHooks` awaits it, so a slow load
can make plugin hooks invisible (affects CCD intermittently too). That race is orthogonal to anything
Cowork-specific.

#### Reported impact (from issue thread — symptoms, cause now reattributed)

Plugin authors reported `Stop`/`SubagentStop` telemetry hooks and `PostToolUse:Skill` matchers
silently no-opping in Cowork, and `UserPromptSubmit` working inconsistently. These symptom reports
may be genuine, but per the correction above they are **not** explained by `--setting-sources=user`
excluding plugin scope. If reproduced, the likely cause is the plugin not being in the Cowork
namespace (or the #16288 race) — to be confirmed by the real-Cowork test.

#### Workaround

Declaring hooks in `~/.claude/settings.json` (user scope) is a reliable fallback — those fire in
both Cowork and CCD. (This works regardless of the root cause; it is *not* evidence that plugin hooks
are excluded.) For shipping plugin hooks in Cowork, the right path is to install the plugin into the
Cowork namespace (`claude plugin install --cowork`, user scope) so it's actually loaded — then,
pending the decisive test, its `hooks/hooks.json` should fire like any other plugin's.

#### Implication for the `userconfig-probe` plugin

The `userconfig-probe` plugin declares its `SessionStart` hook in `hooks/hooks.json`. Earlier this
section claimed that hook "will not fire in Cowork — it's plugin-scope, excluded by
`--setting-sources=user`." **Retracted.** Whether it fires depends on whether the plugin is in the
Cowork namespace (and, possibly, on headless-mode behavior) — not on settings-source scope. To
validate end-to-end, install it with `--cowork` and run the real-Cowork log test above; the
user-scope `settings.json` fallback also works.

### Original v2.11.3 trace (preserved for archaeology)

What follows is the original v2.11.3 source-level trace of the CLI's async sub-agent
filter (`Tw8`/`Jl_`/`vc`/`r3H`/`F_8`/`Sz`/`n0`/`ev6`). The trace is correct as a
description of *that filter*, but the filter is not the gate that explains "Bash
unavailable in Cowork." See [Cowork-wide tool architecture](#cowork-wide-tool-architecture)
above for the actual mechanism. The user-facing version of this material is in [the
Skills/Plugins/Marketplaces gist](https://gist.github.com/yaniv-golan/303b6213b7a33167b3f98b076a5f81ad).

### The mechanism

Three functions on the dispatch path. Bundle symbols (v2.1.120):

```js
// 1. Async-mode flag derivation. Set per-spawn at sub-agent dispatch.
isAsync: (O === true || v.background === true) && !lFH

// 2. Base-tool filter. Applied BEFORE user's tools:[] is consulted.
function Tw8({tools: H, isBuiltIn: _, isAsync: q = false, permissionMode: K}) {
  return H.filter((O) => {
    if (yJ(O)) return true;                       // unconditional pass-through
    if (p4(O, GX) && K === "plan") return true;   // edit-tools in plan mode
    if (r3H.has(O.name)) return false;            // r3H = drop set (BashOutput, Agent, …)
    if (!_ && F_8.has(O.name)) return false;      // F_8 = r3H spread, applies to non-builtin
    if (q && !Jl_.has(O.name)) {                  // ASYNC + name not in allowlist
      if (V9() && _X()) {                         // experimental-agent-teams fallback
        if (p4(O, Z9)) return true;               // Z9 = "Agent"
        if (gN9.has(O.name)) return true;         // gN9 = supplementary allowlist
      }
      return false;                               // → DROPPED
    }
    return true;
  });
}

// 3. User-declared tools[] classifier. Intersects user's list with post-Tw8 base.
function vc(H, _, q = false, K = false) {
  // ... (full body in bundle) ...
  // Returns: { hasWildcard, validTools, invalidTools, unavailableTools, resolvedTools, allowedAgentTypes }
  // resolvedTools is what reaches the model.
}
```

### `Jl_` allowlist contents — CORRECTED v2.11.13

```
Bq    "Read"
dV    "WebSearch"
_v    "TodoWrite"
A4    "Grep"
NY    "WebFetch"
h1    "Glob"
L9    "Edit"
s7    "Write"
Af    "NotebookEdit"
Xf    "Skill"
cN    "TaskStop"
...gP   (SPREAD — was unresolved at original trace time; v2.11.13 resolved it)
        gP = VW = [wq, D9] = ["Bash", "PowerShell"]
QW, $j, Al_, zl_, JA, FP   (other resolved members in v2.1.138 / v2.1.119:
                            "StructuredOutput", "ToolSearch", "EnterWorktree",
                            "ExitWorktree", "REPL", "Monitor")
```

**v2.11.3 said:** `Dq = "Bash"` is not in `Jl_`. **v2.11.13 correction:** `Dq` was the
wrong symbol to grep for — Bash's symbol was `wq` (v2.1.119) and `Vq` (v2.1.138). Bash
IS in `Jl_` (v2.1.119) and `Ys_` (v2.1.138), via the `...VW` / `...$2` spread member.
Cross-version verification:

```
v2.1.119: VW = [wq, D9];   wq = "Bash";   D9 = "PowerShell";
          jQ_ = new Set([..., ...VW, ...]);    // spreads Bash, PowerShell

v2.1.138: $2 = [Vq, h9];   Vq = "Bash";   h9 = "PowerShell";
          Ys_ = new Set([..., ...$2, ...]);    // spreads Bash, PowerShell
```

The fallback path `(V9() && _X())` (v2.1.119) / `(r9() && PW())` (v2.1.138) is the
experimental-agent-teams gate — re-enables `Agent` plus a supplementary set
`gN9`/`Up9 = {TaskCreate, TaskGet, TaskList, TaskUpdate, SendMessage, CronCreate,
CronDelete, CronList}`. Also not relevant to Bash availability.

The async-allowlist filter is **not** what removes Bash from Cowork sub-agents. See the
[Two-layer gate](#two-layer-gate-host-loop-substitution-then-async-allowlist) section
above.

### `r3H` / `F_8` drop set

```
r3H = new Set([xh, GX, Q3H, Z9, ST])
F_8 = new Set([...r3H])
```

- `xh` = the `BashOutput` tool
- `GX` = edit-related (resolves `p4(O, GX)` in the plan-mode bypass)
- `Q3H` = unresolved
- `Z9` = `"Agent"`
- `ST` = unresolved

Applied unconditionally for non-built-in agents (`if (!_ && F_8.has(O.name)) return false`).
**Bash isn't in `r3H` or `F_8`** — the Bash drop happens via the async path, not the
plugin-source path.

### Tool-name parse and canonicalization

User-declared tool patterns go through `Sz` → `n0` before reaching `vc`'s lookup:

```js
function Sz(H) {
  let _ = GT4(H, "(");
  if (_ === -1) return { toolName: n0(H) };
  // ... handles "Bash(gh:*)" form ...
}

function n0(H) {
  return Object.hasOwn(ev6, H) ? ev6[H] : H;
}

ev6 = {
  Task: Z9,                  // "Agent"
  KillShell: cN,             // current name
  AgentOutputTool: xh,       // BashOutput
  BashOutputTool: xh,        // BashOutput
  ...X8q ? { Brief: X8q.BRIEF_TOOL_NAME } : {}
};
```

So `"Task"` in a user's `tools:` array is canonicalized to `"Agent"` at parse. In `vc`'s
classifier, the Agent special-case is:

```js
if (N === Z9) {                         // canonicalized name === "Agent"
  if (h) L = h.split(",").map(...);     // capture allowedAgentTypes from "Agent(general-purpose,Explore)"
  if (!K) { P.push(v); continue }       // K=false (default) → push to validTools, skip resolvedTools
}
```

With default `K = false`, declaring `"Task"` (or `"Agent"`) in the array marks it
syntactically valid but **never adds the Agent tool to `resolvedTools`** — and never
strips other tools. It's a no-op for filtering purposes. Declaring `"Task"` does not
"poison" the list, contrary to a tempting pattern-match.

### Why `general-purpose` works in Cowork-async but plugin fork-skills don't

`general-purpose` registration in the bundle:

```js
{
  agentType: "general-purpose",
  whenToUse: "...",
  tools: ["*"],                        // ← wildcard form
  source: "built-in",
  baseDir: "built-in",
  getSystemPrompt: aB1
}
```

The wildcard form (`["*"]` *or* `undefined`) takes the early-return branch in `vc`:

```js
if (O === void 0 || (O.length === 1 && O[0] === "*"))
  return { hasWildcard: true, ..., resolvedTools: D };
```

`D` is the post-`Tw8` base set. So `general-purpose` inherits `Read`, `Write`, `Edit`,
`Glob`, `Grep`, `WebSearch`, `WebFetch`, etc. — everything the async filter allows.
A plugin fork-skill that declares e.g. `tools: ["Read", "Bash", "Glob", "Grep"]` gets
the *intersection* of that list with `D` — which is `{Read, Glob, Grep}`. Read-only.

### Empirical confirmation

Probe (one sub-agent, one tight write-a-file contract, in a Cowork session):

| Variant | Declared `tools:` | Result |
|---------|-------------------|--------|
| Plugin fork-skill, before fix | `["Read", "Bash", "Task", "Glob", "Grep"]` | `fail`, no file |
| Same skill, after adding `Write`/`Edit` | `[..., "Bash", "Task", ..., "Write", "Edit"]` | `done`, file present, byte-exact match |
| `general-purpose` (control) | `["*"]` (built-in default) | `done`, file present (used `Write`, not Bash) |

The "before" → "after" delta is `Write` and `Edit` declarations — keeping `Bash` and
`Task` unchanged. Both had been hypothesized as candidates for the strip (`Bash` because
Cowork might be permission-tightening; `Task` because it was the only declaration absent
from a known-working plugin agent's frontmatter). Neither hypothesis matched the source
trace. The fix that worked is the one the source predicted.

### Implications — UPDATED v2.11.13 (revised 2026-05-10)

For skill authors targeting Cowork (top-level main session AND forked sub-agents alike):

- **Declaring `tools: [..., "Bash", ...]` is a no-op in Cowork.** The literal name
  `Bash` doesn't refer to a registered tool in any Cowork dispatch level. Declarations
  fall into `invalidTools` silently. This is true at top-level too — the asymmetry
  prior versions of this lesson implied (top-level has Bash, sub-agent doesn't) does
  not exist. Cowork main sessions also lack built-in `Bash`; they just hide it well
  because the model knows to use `mcp__workspace__bash` transparently when a user asks
  for shell.

- **The canonical Cowork shell path is `mcp__workspace__bash` via `ToolSearch`.**
  Declare it in the agent's `tools:` frontmatter (literal exact match — `mcp__server__*`
  wildcards don't work in agent declarations), call `ToolSearch` to load its schema,
  then invoke. This applies to both top-level and sub-agent dispatch. See
  [`mcp__workspace__bash` operational contract](#mcpworkspacebash--the-operational-contract)
  for the substantive constraints on how it differs from CCD-mode `Bash`.

- **`Write` / `Edit` for portable artifact persistence.** Both work in Cowork and CCD
  without VM dependency. They reach the user's real filesystem directly. Most portable
  path; survives even when the workspace VM service has failed to start.

- **Moving shell-bound work to the top Cowork session does not give you built-in Bash.**
  Top-level lacks built-in Bash too; it just routes to `mcp__workspace__bash`
  transparently. The "move to top session" pattern that earlier versions of this lesson
  suggested still has merit — the top session has the `Agent` tool (sub-agents don't)
  and absorbs intermediate work into parent context — but it's not "the place where
  Bash is registered." There is no such place in Cowork.

What's *actually* sub-agent-specific (the CLI's `LW8`/`Ys_` filter is real, just not
the Bash gate):

- **`AskUserQuestion` is dropped from forked sub-agents** by the CLI's drop set
  (`$zH`). Sub-agents can't ask the user questions; only the top session can.
- **`Agent` is dropped from forked sub-agents** — sub-agents can't dispatch
  sub-sub-agents.
- **`ExitPlanMode`, `EnterPlanMode`, `TaskOutput`, `WaitForMcpServers` are dropped**
  from sub-agents by the same set.

These are CLI-side restrictions that DO take effect at the async-dispatch boundary,
distinct from Layer 1's Cowork-wide Bash exclusion.

The "missing tool" surfaces silently to the model. `unavailableTools` and
`invalidTools` are internal classifier buckets; only `resolvedTools` reaches the
model's tool listing. From inside the sub-agent, a filtered-out tool is
indistinguishable from one that was never declared. This is the cognitive trap that
produced the original wrong-mechanism claim — empirically the model "doesn't have
Bash," and there are several layers that could explain it. The actual layer was the
desktop-side host-loop registration; the lesson's original trace looked at the
downstream CLI filter and the empirical probe (correctly) reported absence without
distinguishing layers.
- **Skill telemetry doesn't surface this either.** Tool-use count > 0 in parent telemetry
  reflects whatever tools the sub-agent *did* call (Read, Glob) — not the gap between
  declared and resolved.

### Cross-references

- **L11** (Skills, ch1) — frontmatter `tools:` field, `context: fork` semantics
- **L87** (`/fork` subagent + reattach plumbing) — fork dispatch is what becomes
  Cowork's async path. The filtering described here applies to *every* `kind:"fork"`
  spawn in a background context, not just Cowork-product use cases.
- **L37** (Bridge / Remote Control) — the transport layer that defines what "background"
  means in the first place
- **L88** (settings persistence) — settings layer where `policySettings.disabledTools`
  could (in principle) provide an alternative gate; not connected to this filter today

### MCP path: the same filter, the other direction

The `Tw8` body shown above starts with `if (yJ(O)) return true;`. `yJ` resolves at offset
5,036,218:

```js
function yJ(H) { return H.name?.startsWith("mcp__") || H.isMcp === true; }
```

This is the **MCP fast-path**. It runs before the `Jl_` allowlist gate, before the
`F_8` non-built-in drop set, before the `r3H` universal drop set. **Any tool whose name
starts with `mcp__` (or whose object has `isMcp === true`) survives the filter
unconditionally** — `isAsync`, `isBuiltIn`, and `permissionMode` are all ignored for
MCP entries. This is the runtime mechanism behind "expose the work as MCP tools" as
the documented Cowork-async escape hatch: a custom MCP server's tools are immune to
the entire `Tw8` regime by name shape alone.

#### How parent MCP state reaches the fork

Sub-agent dispatch site at offset ~8,001,500 (in the agent-tool `Z9` invocation):

```js
let n = Ja(i, w.getAppState().mcp.tools.concat(h), { skipReplFilter: true }),
  ...
  availableTools: L ? w.options.tools : n,
```

- `i` is the sub-agent's permission context.
- `w.getAppState().mcp.tools` is the parent session's **live** MCP tool list — sourced
  from the React state container managed by `MCPConnectionManager`, not by re-resolving
  `.mcp.json` for the child.
- `h = w.options.tools.filter(yJ)` adds any MCP tools the parent had in its option list
  that haven't yet shown up in the live state (covers race-window cases at session boot).
- `L` is the user-typed-`/fork` flag (L87). For `context: fork` skills going through
  Cowork-async dispatch, `L` is false — the sub-agent receives `availableTools = n`.

`Ja` at offset 8,711,381:

```js
function Ja(H, _, q) {
  let K = tR(H, q);                     // base tools (built-in)
  let O = r8H(_, H);                    // MCP tools after permission filter
  return Rw([...K].sort(T).concat(O.sort(T)), "name");
}
```

So a Cowork-async fork inherits the parent's MCP connections **by reference** — the same
client objects, the same tool instances. The fork does not open its own MCP clients. This
is why a server connected once at the parent's session boot is callable from every fork
that follows.

#### `requiredMcpServers` enforces presence at dispatch with a 30-second poll

Same dispatch site, immediately above the `Ja` call:

```js
let N = v.requiredMcpServers;
if (N?.length) {
  let AH = P.mcp.clients.some(s =>
    s.type === "pending" && N.some(a => s.name.toLowerCase().includes(a.toLowerCase()))
  );
  if (AH) {
    let KH = Date.now() + 30000;
    while (Date.now() < KH) {
      await w8(500);                                            // 500ms poll interval
      zH = w.getAppState();
      if (zH.mcp.clients.some(/* failed match */)) break;
      if (!zH.mcp.clients.some(/* still pending */)) break;
    }
  }
  if (!ei_(v, JH)) {
    throw new Error(`Agent '${v.agentType}' requires MCP servers matching: ${...}.`);
  }
}
```

**Up to 30 seconds, polled every 500ms, against the parent's live `state.mcp.clients`.**
If a required server ends up `failed` or never appears, dispatch throws with a useful
error. This is the runtime contract for the `requiredMcpServers` agent-frontmatter field
(documented as a field but not as a behavior). Authors who want fail-fast behavior on
missing MCP infrastructure should declare it.

#### Negative finding: there is no skill-callable runtime MCP registration

Verified by exclusion against the v2.1.120 bundle:

- **`claude mcp add --scope dynamic`** is explicitly rejected at offset 7,368,245:
  `case "dynamic": throw new Error("Cannot add MCP server to scope: dynamic");`. The
  user-addable scopes (`project` → `.mcp.json`, `user` → settings.json `mcpServers`,
  `local` → local settings) all write to disk only.
- **The chokidar watcher does not watch `.mcp.json`.** `PW3()` at offset ~12,533,956
  enumerates only skill / command directories (`userSettings/skills`,
  `userSettings/commands`, `projectSettings/skills`, `projectSettings/commands`,
  plus `--add-dir` paths' `.claude/skills`). Modifying `.mcp.json` mid-session has zero
  runtime effect — the live `state.mcp.clients` set is fixed at session boot.
- **`/mcp` exposes reconnect / toggle on already-known servers** via `MCPConnectionManager`.
  No add-server flow reaches the connection manager mid-session.
- **Runtime-injection paths that exist** are all out-of-band for skill bodies:
  `--mcp-config` CLI flag (process boot only), `dynamicMcpConfig` REPL prop (populated
  from `--mcp-config`), SDK `io({extraServers})` / `setSettingSources` callbacks (SDK-only).

The working pattern for "dynamic MCP capabilities from a skill" is therefore
**static declaration with a behaviorally dynamic server**: the launcher is in
plugin manifest or `.mcp.json`, but the launcher process reads runtime state — env vars,
`${CLAUDE_PLUGIN_DATA}/runtime.json`, stdin — to decide which tools to expose. Skills
mutate the state the launcher reads; the registration itself is static.

#### Agent `tools:` matches MCP names exactly — no `mcp__server__*` expansion

The `Sz` → `n0` chain shown above is exact-match by canonicalized name. The classifier
loop in `vc` does `f.get(toolName)` — a literal `Map.get`. There is no glob, no prefix
expansion, no server-level wildcard.

| Form | Where it works | Where it doesn't |
|------|----------------|------------------|
| `tools: ["*"]` | Agent declarations (wildcard branch in `vc` returns `hasWildcard: true`, `resolvedTools = D` — full filtered base set including all live MCP tools) | n/a |
| `tools: ["mcp__myserver__exact_tool_name"]` | Agent declarations (literal `f.get` hit) | n/a |
| `tools: ["mcp__myserver__*"]` | **Permission rules only** — `allowedTools` / `disallowedTools` go through a different validator at offset ~1,111,367 that explicitly accepts the `*` form for MCP and recommends it as the canonical syntax for server-wide grants. | **Not in agent `tools:` declarations** — falls into `invalidTools` silently, same failure mode as a typo. |
| `tools: ["mcp__myserver"]` | n/a | Same as above — exact match fails, no implicit expansion. |

The trap: copying `mcp__server__*` from a permission rule into an agent's frontmatter
looks correct (the validator accepts it; the rule works in `allowedTools`), but the
runtime classifier silently drops it. Authors get the same "agent has no tools"
symptom as the Bash-strip case, and the cause looks identical from the model's side.

### Status of the symbol resolutions — CORRECTED v2.11.13

The original v2.11.3 list said `Dq=Bash`. **That was wrong.** `Dq` is unresolved (not
Bash in any traced version). Bash's symbol in v2.1.119 was `wq`, in v2.1.138 is `Vq`,
and it reaches `Jl_`/`Ys_` indirectly via the spread member `VW`/`$2`.

Resolved (v2.1.119 / v2.1.138 — minified symbols rename per release):
- v2.1.119: `wq=Bash, D9=PowerShell, VW=[wq,D9]`, jQ_ allowlist contents:
  `lq=Read, hV=WebSearch, ZS=TodoWrite, T4=Grep, NY=WebFetch, V1=Glob, ...VW, C9=Edit,
  _K=Write, Hf=NotebookEdit, wf=Skill, vW=StructuredOutput, Kj=ToolSearch,
  TQ_=EnterWorktree, $Q_=ExitWorktree, $A=REPL, pP=Monitor, EN=TaskStop`.
  Drop set `R3H = {Ly=TaskOutput, wX=ExitPlanMode, M3H=EnterPlanMode, S9=Agent,
  YA=AskUserQuestion}`.
- v2.1.138: `Vq=Bash, h9=PowerShell, $2=[Vq,h9]`, Ys_ allowlist: same shape, renamed
  symbols (`H9=Read, Sh=WebSearch, yC=TodoWrite, W4=Grep, fj=WebFetch, E1=Glob, ...$2,
  L7=Edit, rK=Write, bX=NotebookEdit, SM=Skill, RG=StructuredOutput, hA=ToolSearch,
  $BH=EnterWorktree, $s_=ExitWorktree, G$=REPL, z2=Monitor, Pu=TaskStop`).
  Drop set `$zH = {mc=TaskOutput, gW=ExitPlanMode, OzH=EnterPlanMode, O7=Agent,
  YT=AskUserQuestion, zzH=WaitForMcpServers}` (one new member: WaitForMcpServers).

New in v2.1.138 that v2.1.119 didn't have:
- `Fp9 = new Set([O7, Pu, QW, RG, ...[], ...[], ...[]])` — fork-subagent-specific
  allowlist, much more restrictive than `Ys_`. Resolved members: `Agent, TaskStop,
  SendMessage, StructuredOutput`. Three empty conditional spreads suggest feature-flag-
  gated additions.

Filter / dispatch function symbols:
- v2.1.119: `gz8` (filter), `jQ_` (async allowlist), `R3H` (drop), `LH8` (non-builtin
  drop), `lk9` (experimental fallback), `Oc` (classifier), `vJ` (MCP fast-path).
- v2.1.138: `LW8` (filter), `Ys_` (async allowlist), `$zH` (drop), `M58` (non-builtin
  drop), `Up9` (experimental fallback), `el` (classifier), `hG` (MCP fast-path).
- **All renamed.** Pin extractors to behavioral anchors (`({tools, isBuiltIn, isAsync,
  permissionMode})` signature, `[Bash, PowerShell]` array spread, `name?.startsWith
  ("mcp__")` fast-path body), not symbol names.

The v2.11.3 conclusion ("symbol trace is the explanation [for Bash being filtered]") was
wrong — the Bash filter explanation is in the *desktop bundle*, not the CLI bundle. The
empirical probe was correct; the symbol trace looked at the wrong file.

---

## Risks Worth Flagging

1. **The bg-context env vars are stripped from subprocess env.** If you write a hook that
   needs to know it's running inside a background session, do **not** rely on
   `process.env.CLAUDE_CODE_SESSION_KIND` from the hook process — it'll be deleted before
   spawn. Check via the bridge channel or the session log file path.
2. **`SESSION_KIND === "bg"` mutates the system prompt.** If you compare prompt contents
   across runs (e.g., for evals), expect divergence between interactive and bg sessions.
3. **The classifier-summary system can run an LLM call per turn.** Three kill switches
   exist for a reason. If you're observing higher API costs in Cowork-runtime sessions,
   `CLAUDE_CODE_CLASSIFIER_SUMMARY=0` forces heuristic.
4. **Fleet view PR-batch is on by default.** If your workflow involves many private repos
   or rate-limited GitHub apps, the batched form may surface as a single rate-limit
   pinch point rather than a slow per-PR drip. Toggle via `tengu_fleetview_pr_batch`.
5. **`/daemon` is a TUI; persistent install is *not* shipped in v2.1.119** (see L90 — this
   becomes explicit with `xQH()`'s kill-switch and the `transient`/`ask` cold-start model).
6. **Cowork has no built-in `Bash` tool — at any dispatch level.** The empirical claim
   that fork sub-agents lack Bash was always right. Corrected twice (v2.11.13) — the
   mechanism is *not* the `Tw8`/`Jl_` async filter (Bash IS in that allowlist via
   spread), and the scope is *not* sub-agent-specific (top-level Cowork main sessions
   also lack built-in Bash). The actual gate is the desktop bundle's
   `HOST_LOOP_EXCLUDED_BUILTIN_TOOLS = {Bash, NotebookEdit, REPL, JavaScript, WebFetch}`,
   which strips these names from registration in Cowork mode entirely.
   `mcp__workspace__bash` is the canonical Cowork shell tool — runs in the workspace
   Linux VM, available as a deferred MCP tool that loads via `ToolSearch`. See
   [Cowork's Tool Architecture](#coworks-tool-architecture-why-bash-isnt-where-you-expect-it-and-where-it-is)
   above.

7. **`mcp__workspace__bash` is not equivalent to host `Bash`.** Five operational
   constraints worth flagging: (a) no cwd or env carryover between calls — chain
   multi-step pipelines with `&&` / `;` or use absolute paths; (b) host-side skill
   files mount under `/sessions/<id>/mnt/`, not at their host path — relative-path
   script invocations need to `cd` to the mount or use absolute mount paths; (c) only
   `/sessions/<id>/mnt/outputs/` survives session end as user-visible artifact storage;
   (d) `pip install` requires `--break-system-packages`; (e) it's Linux aarch64 Ubuntu
   inside the VM regardless of host OS, so platform-specific shell idioms (e.g. macOS
   `pbpaste`, BSD `sed -i ''`) don't work. Skills that move from CCD to Cowork will hit
   these.

8. **Don't probe a session's tool availability by listing immediate tools alone.**
   Cowork's immediate tier is small (~10 tools at top-level: `Edit, Glob, Grep, Read,
   Skill, ToolSearch, Write, Agent` + the visualize MCPs; sub-agents are the same minus
   `Agent`). Most tools — including `WebSearch`, all `mcp__cowork__*`, all
   `mcp__workspace__*`, all connector tools — are in the deferred tier, name-visible
   but schema-loaded only when `ToolSearch` is called. Tools missing from the immediate
   list may still be callable. The original v2.11.3 probe missed this and concluded
   shell was unreachable from sub-agents — it isn't, just deferred.

9. **Plugin hooks DO fire in Cowork; the determinant is which plugin root the plugin lives in, NOT
   `--setting-sources`** (corrected + RESOLVED v2.11.18). The earlier claim — that
   `--setting-sources=user` silently excludes plugin-scoped hooks — is **retracted**: tested against
   CLI 2.1.159, `--plugin-dir <plugin> --setting-sources=user` fires the `SessionStart` hook and
   resolves `${CLAUDE_PLUGIN_ROOT}`; the binary loads plugin hooks via the plugin-enablement pipeline
   (`loadPluginHooks`/`p6H`), not settings-source resolution. **End-to-end confirmed (2026-06-01):** a
   canary plugin installed via the **Cowork app UI** fired its SessionStart hook in a real desktop
   Cowork session. Mechanism: the desktop's **host loop** symlinks each enabled plugin into a temp
   `claude-hostloop-plugins/<hash>` dir and runs hooks host-side; `${CLAUDE_PLUGIN_ROOT}` resolves to
   that staging path. The catch is the **three-root namespace split**: regular `~/.claude/plugins/`;
   the standalone-CLI Cowork root `~/.claude/cowork_plugins/` (what `claude plugin install --cowork`
   writes — `ph5()`/`A41()`); and the **desktop's** account/org root
   `local-agent-mode-sessions/<acc>/<org>/cowork_plugins/cache` (+`rpm/`), which is the ONLY one a
   real Cowork session reads. A plugin not in root #3 is never loaded → no hooks — which fully
   explains the original "zero hook lines" observation. **Fix:** install via the Cowork app UI (or
   org-remote/RPM); the standalone CLI `--cowork` does NOT reach the desktop's namespace. `#16288`
   (fire-and-forget `loadPluginHooks` race) remains a real separate bug; `#27398`'s `--setting-sources`
   attribution is the retracted part. See the
   ["Plugin hooks in Cowork sessions"](#plugin-hooks-in-cowork-sessions) subsection above.

---

## Source-of-Truth Cross-Check (v2.11.2 audit)

Cross-checked against the [official Anthropic v2.1.119 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md):

**Confirmed (in both bundle and official changelog):**
- `prUrlTemplate` setting (added to v2.1.119 — see Public Settings section above)
- `CLAUDE_CODE_HIDE_CWD` env var
- `/fork` mechanism change to pointer + hydrate-on-read (this section reflected in the
  /background description above)

**Bundle-only (NOT in official changelog → confirms dark-launch framing):**
- `/background`, `/bg`, `/stop`, `/daemon`, `/autocompact` re-introduction
- Fleet view (`claude agents` Ink TUI dashboard)
- All `CLAUDE_CODE_SESSION_KIND/ID/NAME/LOG`, `CLAUDE_BG_*`, `CLAUDE_PTY_RECORD`, etc.
- All 62 new `tengu_*` identifiers, including the codename flags
- Classifier-summary status pipeline
- Pro-trial conversion flow

The complete absence of any of the above from Anthropic's public v2.1.119 changelog is
strong external corroboration that these are Cowork-runtime infrastructure shipped to
the binary but held back from user-facing announcement until the GB flags are flipped.

**Official v2.1.119 changelog items NOT covered in this lesson** (out of scope — not
Cowork-related):
- Vim mode Esc behavior fix
- Plugin pinning auto-update to highest satisfying git tag
- Subagent + SDK MCP server reconfiguration parallel connect
- Configuration settings persistence to `~/.claude/settings.json`

---

## Cross-References — The Cowork Runtime Stack

| Lesson | Role in the Cowork-runtime story |
|--------|----------------------------------|
| **L37** (Bridge / Remote Control) | The bridge transport that persists transcripts and gates BG sessions on `allow_remote_control` / `allow_remote_sessions` org policies |
| **L43** (KAIROS — Always-On Autonomous Daemon) | The original architectural characterization of the daemon subsystem, from ant-only feature flags. v2.1.119 is the first release where the daemon's user-facing surface (`/daemon`, `/background`, Fleet view) becomes coherent. |
| **L77** (Remote Workflow Commands — sunset in L85) | Anthropic's earlier attempt at "thin client dispatching to cloud sessions." The v2.1.119 model inverts this: local daemon hosts the session, Cowork Desktop attaches via bridge. |
| **L85** (`CLAUDE_BG_BACKEND=daemon` first public surface) | Daemon-mode env gate that v2.1.119 builds on — `uC_() = process.env.CLAUDE_BG_BACKEND === "daemon"` is consulted everywhere |
| **L86** (OIDC Federation, `/model` headless) | The auth machinery that paid Cowork tiers use; the headless-command pattern (`supportsNonInteractive: true`) that `/stop` and `/autocompact` adopt |
| **L87** (`/fork` + `CLAUDE_BRIDGE_REATTACH_SESSION/SEQ` plumbing) | `/background` reuses `/fork`'s `kind: "fork"` subagent infrastructure unchanged. The single-use reattach env vars introduced in L87 are consumed by v2.1.119's bridge persistence. |
| **L88** (`/cost` + `/stats` → `/usage` aliases, dual registration pattern) | `/stop` and `/autocompact` adopt the same dual-registration pattern (interactive Ink + headless `supportsNonInteractive`) |
| **L90** (next) | Cleans up v2.1.119: kill-switches persistent daemon install, adds the cold-start model, lean-prompt toggle, memory-write UX, plan-mode tripwire |

---

## Summary for v2.1.119

| Category | Count | Notes |
|----------|-------|-------|
| Slash commands added (registrations in bundle) | 4 | `/background` (alias `/bg`), `/stop`, `/daemon`, `/autocompact` (re-added) |
| Slash commands actually live for default users | 1 | Only `/autocompact` is universally reachable. `/daemon` is hardcoded off (`OqH() = false`); `/background` is gated by `tengu_slate_meadow` GB flag (default false; flipped on for Claude Max / Cowork users); `/stop` is conditionally enabled by `SESSION_KIND==='bg'` and transitively gated by the same GB flag. |
| Slash command descriptions changed | 1 | `/exit` |
| Env vars added | 16 | (after diff correction — `_FORK_SUBAGENTM` was a string-table artifact) |
| Telemetry / GB flag identifiers added | 62 | Background+daemon (36), Fleet view (4), pro-trial (4), classifier (4), codenames (5), other (9) |
| Telemetry events removed | 1 | `tengu_thinking_clear_latched` |
| Hook event types | 19 (unchanged) | |
| API beta strings | 32 (unchanged) | |
| New product surface | Cowork runtime | The infrastructure for [Claude Cowork](https://www.anthropic.com/product/claude-cowork) — daemon, background sessions, Fleet view, classifier-summary status pipeline |

---

# LESSON 90 -- v2.1.120 DAEMON ON-DEMAND MODEL, `CLAUDE_CODE_LEAN_PROMPT`, MEMORY-WRITE APPROVAL UX, PLAN-MODE TRIPWIRE, `CLAUDE_COWORK_MEMORY_GUIDELINES`

## What this release is

v2.1.120 is the **refinement release** that follows v2.1.119's Cowork-runtime GA. Mostly
small-grained additions and one architectural reveal: persistent daemon install is
**kill-switched in this version**. The `xQH()` function aborts with:

> *"daemon service is not installed (service install is disabled in this version; the daemon
> runs on demand)"*

So despite all of v2.1.119's `tengu_daemon_install` / `_auto_uninstall` telemetry being live,
the user-facing daemon is **strictly on-demand** in v2.1.120. The runtime exists; always-on
daemon mode is held back. This is the gap to watch for v2.1.121+.

The release also adds: a per-section prompt-shaping toggle (`CLAUDE_CODE_LEAN_PROMPT`), an
Approve/Reject confirmation UX for memory-file writes, a debugging-workflow prompt
discipline (`CLAUDE_CODE_VERIFY_PROMPT`), a plan-mode runtime tripwire, and Cowork's
memory-injection bypass (`CLAUDE_COWORK_MEMORY_GUIDELINES`).

The bundle now embeds version metadata literally:

```js
{ ISSUES_EXPLAINER: "report the issue at https://github.com/anthropics/claude-code/issues",
  PACKAGE_URL: "@anthropic-ai/claude-code",
  README_URL: "https://code.claude.com/docs/en/overview",
  VERSION: "2.1.120",
  FEEDBACK_CHANNEL: "https://github.com/anthropics/claude-code/issues",
  BUILD_TIME: "2026-04-24T19:00:49Z",
  GIT_SHA: "080f07fb4224786b965b9ea0a35f0cff594f2eb6" }
```

(Useful citation reference for verifying the exact build this lesson tracks against.)

---

## Daemon On-Demand Cold-Start Model

### The kill switch

`xQH()`:
```js
async function xQH() {
  if (!await aa()) aJ("daemon service is not installed (service install is disabled in this version; the daemon runs on demand)")
}
```

`aa()` checks whether the daemon is installed as a system service. In v2.1.120 it always
returns false-equivalent for purposes of the install check — the function aborts with the
above error any time something asks the daemon to be installed as a persistent service.

So the user-facing daemon model in v2.1.120 is **strictly on-demand**: the daemon spins up
when needed (a `/daemon`-managed service is started, a `/background` session needs a host,
or a `/schedule`-driven cron task fires), runs, and exits when idle.

### Cold-start mode env var

`CLAUDE_CODE_DAEMON_COLD_START` accepts two values: `"transient"` | `"ask"`.

```js
function Ci6() {
  let H = process.env.CLAUDE_CODE_DAEMON_COLD_START;
  if (H === "transient" || H === "ask") return H;
  let _ = GwH()?.settings.daemonColdStart;
  if (_ !== void 0) return _;
  return vT1?.daemonColdStartGbDefault() ?? "transient";
}
```

Resolution order:
1. Env var (if `"transient"` or `"ask"`)
2. `settings.json` `daemonColdStart` field
3. GB default `daemonColdStartGbDefault()` (defaults to `"transient"`)

| Mode | Behavior |
|------|----------|
| `"transient"` *(default)* | Daemon spins up on demand silently, exits when idle |
| `"ask"` | Prompts the user before starting daemon (paired with `tengu_bg_daemon_cold_start_ask` / `tengu_bg_daemon_cold_start_ask_answer` telemetry) |

There is **no `"persistent"` or `"installed"` mode** in v2.1.120. That's the gap to watch.

### Daemon hot-upgrade on binary change

The daemon supervisor includes a self-restart-on-upgrade loop:

```js
let o = setInterval(() => {
  if (O.aborted || W) return clearInterval(o);
  L();  // poll for binary identity change
}, A);
o.unref();
// ...
if (W) c("tengu_daemon_self_restart_on_upgrade", {});
Y.write("supervisor", "shutting down");
U(); await g;
// gracefully kill workers, close manager, await close, dispose, return { upgradeDetected: W }
```

When the daemon detects that its own binary has been upgraded, it sets `W = true`, emits
`tengu_daemon_self_restart_on_upgrade`, gracefully shuts down workers (`SIGTERM`), and exits.
The next on-demand spin-up uses the new binary version. Standard hot-upgrade pattern, paired
with the v2.1.113 (L85) `/update` refusal-path work.

### Auto-relaunch rate limits

`CLAUDE_AGENTS_AUTO_RELAUNCHED_AT` (constant `Ih8`) is set by the daemon when it
auto-relaunches a crashed background agent — timestamps the relaunch so the new instance
can detect "I am a relaunched instance" on startup. The accessor names in the same module
identify the rate-limit policy:

```js
{ AUTO_RELAUNCH_UNFOCUSED_MS: () => oz6,
  AUTO_RELAUNCH_MIN_INTERVAL_MS: () => sYK,
  AUTO_RELAUNCH_ENV_KEY: () => Ih8 }
```

| Constant | Value | Purpose (per accessor name) |
|----------|-------|------------------------------|
| `oz6` | `3600000` ms (1 hour) | `AUTO_RELAUNCH_UNFOCUSED_MS` — minimum focus-loss duration before an agent becomes eligible for auto-relaunch (don't auto-relaunch agents the user just looked away from briefly) |
| `sYK` | `21600000` ms (6 hours) | `AUTO_RELAUNCH_MIN_INTERVAL_MS` — minimum interval between successive auto-relaunches of the same agent (rate-limit) |
| `Ih8` | `"CLAUDE_AGENTS_AUTO_RELAUNCHED_AT"` | `AUTO_RELAUNCH_ENV_KEY` — the env-var key used to stamp the relaunch timestamp |
| `[PERF:bg-remount-start]` | log marker | Performance instrumentation hook |

So the policy is: an agent must have been unfocused for at least 1 hour AND the last
auto-relaunch must have been at least 6 hours ago before the daemon will auto-relaunch it
again. The actual *retry cap* is enforced elsewhere via `tengu_daemon_worker_permanent_exit`
(see L89's daemon supervisor telemetry); these constants are the rate-limit gates, not the
retry counter.

---

## `CLAUDE_CODE_LEAN_PROMPT` — Per-Section Prompt-Shaping Toggle

### Pattern: granular, not wholesale

Distinct from v2.1.116's `CLAUDE_CODE_SIMPLE` / `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` (L86),
which **replace the entire system prompt**. `CLAUDE_CODE_LEAN_PROMPT` is **per-section**:
each "leanable" prompt section has its own gate function with the same shape:

```js
function <gate>() {
  if (hH(process.env.CLAUDE_CODE_LEAN_PROMPT)) return true;
  return S_("<codename GB flag>", false);
}
```

**`LEAN_PROMPT` env var SET → manual override** (forces lean for *all* leanable sections).
Otherwise each section consults its own GB flag.

### Two leanable sections in v2.1.120

| Section | Gate | Codename GB flag | Notes |
|---------|------|------------------|-------|
| **Bash/ripgrep tool description** | `Fz(H)` | `tengu_vellum_lantern` | Also model-gated to `claude-opus-4-7`. When lean: 5-bullet ripgrep-first description; when not: full multi-paragraph description. |
| **Memory-types section** | `cK8()` | `tengu_ochre_finch` | When lean: structured `ig1(types)` short form (uses `memory-types` skill reference); when not: long-form prose |

### Bash/ripgrep variant (`Fz` and `ci6(H)`)

When lean mode is on AND the model is `claude-opus-4-7`, the Bash tool description becomes:

> *Content search built on ripgrep. Prefer this over `grep`/`rg` via Bash — results integrate
> with the permission UI and file links.*
>
> *- Full regex syntax (e.g. "log.*Error", "function\\s+\\w+"). Ripgrep, not grep — escape
> literal braces (`interface\{\}`).*
> *- Filter with `glob` (e.g. "**/*.tsx") or `type` (e.g. "js", "py", "rust").*
> *- `output_mode`: "content" (matching lines), "files_with_matches" (paths only, default),
> or "count".*
> *- `multiline: true` for patterns that span lines.*

So **part of the lean-prompt push is per-model copy tuning**. Opus 4.7 is treated as
ripgrep-fluent and gets the slim version; other models get the full description.

### Memory-types variant (`cK8()` and `zXH(H, _)`)

When lean mode is on, the long-form memory-types prose is replaced by the structured short
form generated by `ig1(types)`:

```js
function ig1(H) {
  return [
    "## Types of memory",
    "",
    "Save a memory when you learn one of the following — pick the matching `type:`:",
    "",
    ...H.map((_) => `- **${_}** — ${ng1[_]}`),
    "",
    `Invoke the \`${dK8}\` skill for scope, body structure and examples once you've decided to save.`,
    "",
  ];
}
```

The reader is referred to the `memory-types` skill (constant `dK8 = "memory-types"`) for the
detailed body. This is a **pattern**: lean mode delegates verbose content to skills.

### Why two patterns coexist

- `CLAUDE_CODE_SIMPLE` — total replacement (e.g., for a different agent persona)
- `CLAUDE_CODE_LEAN_PROMPT` — granular per-section staged rollouts (e.g., trim cost without
  losing all default discipline)

Don't conflate them.

> **Update (v2.1.159):** the lean prompt is now the **default** ("except for Haiku, Sonnet,
> Opus 4.7 and earlier" — CHANGELOG 2.1.154), i.e. the staged rollout this section describes has
> graduated. The Bash/ripgrep gate `tengu_vellum_lantern` (and its `claude-opus-4-7`-only model
> guard) is **removed from the v2.1.159 bundle**; `tengu_ochre_finch` (memory-types section)
> survives. Treat the per-section flag table above as the v2.1.120 snapshot, not current gating.

---

## `CLAUDE_EFFORT` — A Skill Frontmatter Field, NOT an Env Var

**Important diff-correction:** v2.1.120's env-var diff initially flagged `CLAUDE_EFFORT` as
new, but **there is no `process.env.CLAUDE_EFFORT` read anywhere** in the bundle. The diff
regex picked up the literal string `"CLAUDE_EFFORT"` from a binary string-table dump of the
template-substitution token. The actual semantics:

### Two surfaces

1. **Skill/command frontmatter field** `effort:` — listed in the `_X5` skill-frontmatter
   key set alongside `model`, `type`, `source`, `pluginInfo`, etc. Flows through
   `getEffortValue()` in the agent context.
2. **Template substitution token** `${CLAUDE_EFFORT}` — gets replaced inside skill/command
   markdown bodies via `_I(model, effortValue)`.

### Substitution mechanism

When a skill/command is loaded, the prompt body is processed:

```js
E = E.replaceAll("${CLAUDE_EFFORT}",
  _I(G ?? x.options.mainLoopModel, v ?? x.getEffortValue()))
```

If the skill declares `effort: high` in frontmatter, `getEffortValue()` returns `"high"`, and
the substitution resolves to a model-aware effort phrase via `_I`.

### Value space

```js
function _L1(H) {
  switch (H) {
    case "low":    return "Quick, straightforward implementation with minimal overhead";
    case "medium": return "Balanced approach with standard implementation and testing";
    case "high":   return "Comprehensive implementation with extensive testing and documentation";
    case "xhigh":  return "Deeper reasoning than high…";  // truncated in observed bundle
  }
}
```

| Value | Phrase injected via `${CLAUDE_EFFORT}` |
|-------|---------------------------------------|
| `low` | "Quick, straightforward implementation with minimal overhead" |
| `medium` | "Balanced approach with standard implementation and testing" |
| `high` *(default)* | "Comprehensive implementation with extensive testing and documentation" |
| `xhigh` | "Deeper reasoning than high…" *(truncated)* |

`_I(model, effort)` = `JIH(model, effort) ?? "high"` then `RPH(string)` validates. `JIH` is
the per-model gate (some models may not support `xhigh`).

> **Note (v2.1.159):** the substituter's minified name is `bk(model, effort)` in v2.1.159
> (`_I` is the v2.1.120 name — minified identifiers drift between builds; the mechanism is
> unchanged). The effort tier set also gained `max` (full set `["low","medium","high","xhigh","max"]`)
> and Opus 4.8 ships defaulting to `high` (Opus 4.7 defaulted to `xhigh`) — see the
> v2.1.159 chapter for the launch/effort details.

### Critical implication for skill authors

This is a **prompt-shaping mechanism, not a model API parameter**. The descriptions above
are literal English text injected into the prompt — Claude reads "Comprehensive
implementation with extensive testing and documentation" and adjusts behavior accordingly.
There is no `extra_thinking_tokens=high` API parameter being set.

For a skill, declare:

```yaml
---
name: my-skill
description: ...
effort: high
---

You are tasked with X. ${CLAUDE_EFFORT}

Do Y...
```

The body will become: `You are tasked with X. Comprehensive implementation with extensive
testing and documentation. Do Y...`.

---

## `CLAUDE_COWORK_MEMORY_GUIDELINES` — The Cowork Memory-Bypass Escape Hatch

### Two-tier memory injection

Cowork now has two env-var hooks for influencing the memory-injection slot in the system
prompt:

| Env Var | Behavior | When Set |
|---------|----------|----------|
| `CLAUDE_COWORK_MEMORY_GUIDELINES` *(NEW in v2.1.120)* | **Replaces the entire memory-injection pipeline.** Returns `\`# auto memory\n${q.trim()}\`` and short-circuits — no team memory, no per-topic files, no MEMORY.md index. | Cowork wants the agent to operate with a specific memory context that supersedes user/team memory |
| `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` *(pre-existed since v2.1.118)* | **Appends to normal memory.** Wrapped as `[O]` and merged with the user's regular memory pipeline. | Cowork wants to add task-specific guidance on top of user memory |

### Replace path (`Bf_(H)`)

```js
async function Bf_(H) {
  let _ = $4(),  // is auto-memory enabled?
      q = process.env.CLAUDE_COWORK_MEMORY_GUIDELINES;
  if (_ && q && q.trim()) {
    let $ = W$();
    return await j9H($), NQ($, { memory_type: "auto" }),
      `# auto memory\n${q.trim()}`;
  }
  // ... falls through to normal memory pipeline using EXTRA_GUIDELINES if present
}
```

So when set, **`CLAUDE_COWORK_MEMORY_GUIDELINES` wholesale replaces the user's auto-memory
content** with whatever string Cowork passes in. The local memory file path is still
consulted (and `j9H` / `NQ` track its modification), but its content is *not* inserted into
the prompt.

### Why both forms exist

- **Replace** (`_GUIDELINES`): Cowork-spawned agents that should ignore the user's general
  memory (e.g., a focused task agent that shouldn't be biased by user-personal preferences)
- **Append** (`_EXTRA_GUIDELINES`, pre-existing): Cowork-spawned agents that should respect
  user memory but get task-specific additions

### Implication for users running auto-memory pipelines

If you have a custom auto-memory system writing to `~/.claude/projects/<project>/memory/` or
similar, **Cowork can override it completely** by setting `CLAUDE_COWORK_MEMORY_GUIDELINES`
when spawning a session. Your memory contents won't be in the prompt for that session even
though the file exists.

---

## `tengu_memory_write_survey_event` — Approve/Reject Dialog for Memory Writes

A new UX component that surfaces a confirmation dialog when Claude writes a memory file.

### How the summary is generated

When a memory write happens, a fast LLM call (`Y03`) summarizes the change for the dialog:

```js
async function Y03(H, _) {
  if (v4()) return null;  // gated off
  try {
    let q = await PAH({
      systemPrompt: $03,    // "You write one-sentence confirmation summaries for an Approve/Reject dialog."
      userPrompt: A03 + jv9(H),
      signal: _,
      options: {
        model: d$().sonnet46,
        querySource: "memory_write_survey_summarize",
        agents: [],
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        mcpTools: [],
        maxOutputTokensOverride: 150,
        enablePromptCaching: false,  // each summary is one-shot, not worth cache
      },
    });
    return eK(q.message.content, " ").trim() || null;
  } catch (q) {
    return y(`[memoryWriteSurvey] summarize failed: ${NH(q)}`), null;
  }
}
```

### The prompts (constants `$03` and `A03`)

System prompt:
> *"You write one-sentence confirmation summaries for an Approve/Reject dialog."*

User prompt (prepended to the actual diff):
> *"Summarize this memory file update in one short sentence (≤120 chars) for a confirmation
> dialog. State what was recorded or changed; no preamble."*

### Dialog state machine

```js
z03 = {
  state: "closed",
  record: null,
  summary: null,
  lineCount: 0,
  summaryLineThreshold: 0,
  countdownSec: null,
  handleOutcome: () => {},
}
```

State fields:
- `state` — closed / open / etc.
- `record` — the write being surveyed
- `summary` — LLM-generated string (≤120 chars)
- `lineCount` — size of the write
- `summaryLineThreshold` — small writes below this threshold may bypass the dialog
- `countdownSec` — auto-action countdown (constant `T03 = 5`, so likely 5-second auto-decision)
- `handleOutcome` — callback for the user's choice

### Telemetry constant

`O03 = "tengu_memory_write_survey_event"` — fires on each survey emission.

### Implication for users running auto-memory pipelines

When the GB flag for this UX rolls out, **every auto-memory write will surface a confirmation
prompt** with a per-write Sonnet-4.6-generated summary and 5-second countdown. If you have
an automated memory-saving pipeline (e.g., a hook that writes summaries every N turns), the
user experience will change from "silent background writes" to "interactive confirmation
flow" — you may want to design `summaryLineThreshold` into your writes so trivial updates
bypass the prompt.

---

## `CLAUDE_CODE_VERIFY_PROMPT` — Debugging-Workflow Discipline (NOT Safety)

**Naming hypothesis disproved.** Despite the name, this is **not** a Cowork action-verification
safety gate. It's a **prompt-shaping toggle** that adds a "reproduce_verify_workflow"
instruction section to the system prompt.

### Gate function (`VA3`)

```js
function VA3() {
  let H = hH(process.env.CLAUDE_CODE_VERIFY_PROMPT),
      _ = H || S_("tengu_sparrow_ledger", false);
  if (_) y(`verify_prompt_arm_active source=${H ? "env" : "growthbook"}`);
  return _;
}
```

Returns true if env var SET OR `tengu_sparrow_ledger` GB flag on. Logs which source
activated it.

**This identifies `tengu_sparrow_ledger` as the dark-launch GB flag for this experiment.**
(One of the v2.1.119-introduced codename flags.)

### Injected text (`yA3`)

When armed, the system-prompt assembly injects this section:

> *Work step by step:*
>
> *1. Reproduce the issue and observe the actual symptom before editing (hit the URL, read
> the rendered page, inspect the built file).*
> *2. Edit the source to resolve the issue.*
> *3. Re-observe the symptom to verify the fix. Rebuild, reload, or regenerate as needed.
> Don't stop until the symptom is gone.*

### Mechanism

The system-prompt assembly (`w2(H, _, q, K)`) includes:

```js
xR("reproduce_verify_workflow", () => VA3() ? yA3 : null)
```

So when the gate fires, `yA3` is included in the prompt; otherwise null and the section is
omitted.

### Bonus: prompt-section literals discovered in same region

Useful citations for L11 (Skills System) and other lessons referencing system prompts:

- **`ZE7`** = subagent system prompt:
  > *"You are an agent for Claude Code, Anthropic's official CLI for Claude. Given the user's
  > message, you should use the tools available to complete the task. Complete the task fully
  > — don't gold-plate, but don't leave it half-done. When you complete the task, respond
  > with a concise report covering what was done and any key findings — the caller will
  > relay this to the user, so it only needs the essentials."*

- **`uA3`** = "Context management" prompt section:
  > *"# Context management*
  > *When working with tool results, write down any important information you might need
  > later in your response, as the original tool result may be cleared later."*

- **`pA3`** = "Focus mode" prompt section (gated by `BA3()`):
  > *"# Focus mode*
  > *The user has focus mode enabled. In focus mode, the user only sees your final text
  > message in each response. They do not see tool calls, tool results, or any text you emit
  > between tool calls. This overrides earlier guidance about giving short updates between
  > tool calls — skip those updates and put everything the user needs to know in your final
  > message. Do not assume they saw earlier progress updates."*

---

## `tengu_plan_mode_violated` — Observability Tripwire (NOT Enforcement)

A new telemetry event that fires when plan mode *should have* held a tool call but didn't.

### Logic

```js
if (S === "plan"                                     // we're in plan mode
    && H.name !== BP                                  // not the first plan-whitelisted tool
    && H.name !== _v                                  // not the second plan-whitelisted tool
    && x.decisionReason?.type !== "other") {         // permission decision wasn't "other"
  let o = true;
  try { o = H.isReadOnly(M) } catch { o = false }    // is this tool's call read-only?
  let _H = false;
  if (!o
      && (H.name === s7 || H.name === L9)            // Edit (s7) or Write (L9)
      && "file_path" in M
      && typeof M.file_path === "string") {
    _H = hPH(Vq(M.file_path), M).behavior === "allow"; // per-path allow rule?
  }
  if (!o && !_H) {
    c("tengu_plan_mode_violated", {                  // emit telemetry, then continue
      toolName: O7(H.name),
      decisionReasonType: x.decisionReason?.type,
    })
  }
}
```

**No early return. No thrown error. No enforcement.** The code emits the event and proceeds
to the next branch. Real plan-mode enforcement lives upstream at the permission layer
(L8 phase pipeline).

### What this tripwire catches

A tool call that is:
- Inside plan mode (`S === "plan"`)
- NOT one of two plan-whitelisted tools (likely `ExitPlanMode` + one other — the symbols
  `BP` and `_v` — which are allowed even in plan mode)
- NOT read-only (per the tool's own `isReadOnly()` check)
- NOT a write to a per-path-allowed file (Edit/Write hitting an allow-listed path)

### Why this matters

Plan mode is a *contract* enforced by the permission layer. This tripwire is **observability
for cases where the contract held but should be tightened**, or for diagnosing user reports
of "plan mode let X through." Past-tense naming (`_violated`) matches the observational role.

If you're seeing high counts of `tengu_plan_mode_violated`, the permission layer likely has
a gap (a tool whose `isReadOnly()` returns true incorrectly, or a path-allow rule that's
too broad).

---

## `tengu_bg_retired` — Idle Worker Reaper (NOT Feature Sunset)

The codename misled the original investigation — this is **not** about a sunset feature.
It's the daemon's idle-worker garbage collector firing.

### Six "do not retire" guards

```js
{
  if (!_) return { retired: false, reason: "no-state" };
  if (!j0(_)) return { retired: false, reason: "not-settled" };
  if ((_.inFlight?.tasks ?? 1) > 0 || (_.inFlight?.queued ?? 1) > 0)
    return { retired: false, reason: "inflight" };
  if (_.inFlight?.kinds.includes("session_cron"))
    return { retired: false, reason: "session-cron" };
  if (_.routine) return { retired: false, reason: "routine" };
  let q = _.updatedAt && Date.now() - Date.parse(_.updatedAt);
  if (!q || q < H) return { retired: false, reason: "grace" };
  return this.retiring = true,
    c("tengu_bg_retired", { rvSent: this.shutdownWorker(), settledForMs: q, state: _.state }),
    { retired: true };
}
```

| Reason | Skips retirement when… |
|--------|------------------------|
| `no-state` | Worker has no reported state |
| `not-settled` | State not yet settled (still initializing) |
| `inflight` | Active or queued tasks > 0 |
| `session-cron` | Worker is handling a `session_cron` task (don't kill mid-cron) |
| `routine` | Worker is a recurring routine |
| `grace` | Last update inside grace window (still warm) |

When *all* checks pass: marks `retiring = true`, calls `shutdownWorker()` (sends shutdown
via `CLAUDE_BG_RENDEZVOUS_SOCK` rendezvous socket), kills PTY with SIGTERM, emits the event
with payload `{ rvSent, settledForMs, state }`.

`rvSent` = whether the rendezvous-shutdown signal was sent successfully.

---

## `/schedule` Description Simplified (Not a New Registration)

`/schedule` already existed since v2.1.117 (L87 — one-time scheduling, triggers→routines
terminology). The v2.1.119→v2.1.120 diff initially flagged `/schedule` as "added," but
verification shows **only one registration in both versions** (`grep -c 'name:"schedule"'`
returns 1 in each). What actually changed is the **description string format**:

```js
// v2.1.119:
description: `Create, update, list, or run scheduled remote agents (routines) ${H ? "on a cron schedule or once at a specific time" : "that execute on a cron schedule"}.`

// v2.1.120:
description: "Create, update, list, or run scheduled remote agents (routines) that execute on a cron schedule."
```

So v2.1.119 had a **conditional description** with two variants (one mentioning one-time
scheduling, one cron-only). v2.1.120 collapsed it to a **single static cron-only string**.
The conditional `${H?...}` was removed — likely the one-time-vs-recurring branching logic
moved to `whenToUse` or to per-form help text. Functionally `/schedule` still supports both
recurring and one-time scheduling (the underlying handler is unchanged); only the
description copy simplified.

The diff regex flags this as "added" because the description tuple `(name, description)`
differs across versions. Treat it as a **description tweak, not a new command surface**.

---

## New Environment Variables (4)

| Env Var | Purpose |
|---------|---------|
| `CLAUDE_CODE_DAEMON_COLD_START` | Daemon cold-start mode: `"transient"` (silent on-demand) or `"ask"` (prompted). Resolution: env → `settings.json daemonColdStart` → GB default `daemonColdStartGbDefault()` (defaults to `"transient"`). |
| `CLAUDE_CODE_LEAN_PROMPT` | Manual override for per-section lean prompt mode. When set, all leanable sections (Bash/ripgrep, memory-types, future) use their slim variants regardless of GB-flag rollout state. |
| `CLAUDE_COWORK_MEMORY_GUIDELINES` | Cowork's memory-injection bypass. When set + non-empty + auto-memory enabled, completely replaces the entire memory-injection pipeline with the env var's content. Sibling to pre-existing `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` (additive form). |
| `CLAUDE_AGENTS_AUTO_RELAUNCHED_AT` | Daemon-set timestamp on auto-relaunched workers. Lets the relaunched instance detect "I am a relaunched instance" on startup. Rate-limit policy: agent must be unfocused ≥1h (`oz6` = `AUTO_RELAUNCH_UNFOCUSED_MS`) AND ≥6h since last relaunch (`sYK` = `AUTO_RELAUNCH_MIN_INTERVAL_MS`). Retry cap enforced separately via `tengu_daemon_worker_permanent_exit`. |

---

## New GrowthBook Feature Flags (in v2.1.120)

| Flag | Identified usage |
|------|------------------|
| `tengu_amber_anchor` | Not yet identified |
| `tengu_ochre_finch` | Lean prompt: gates the slim memory-types section (replaces verbose prose with `ig1(types)` short form) |
| `tengu_quiet_harbor` | Not yet identified |
| `tengu_slate_siskin` | Not yet identified |
| `tengu_umber_petrel` | Not yet identified |
| `tengu_vellum_lantern` | Lean prompt: gates the slim Bash/ripgrep tool description (Opus 4.7 only) |

---

## Removed GrowthBook Feature Flags (11)

`tengu_amber_quartz_disabled`, `tengu_amber_swift`, `tengu_bridge_client_presence_enabled`,
`tengu_bridge_multi_session_denied`, `tengu_ccr_bridge_multi_session`, `tengu_cinder_almanac`,
`tengu_garnet_plover`, `tengu_lodestone_enabled`, `tengu_pebble_leaf_prune`,
`tengu_slate_ribbon`, `tengu_toolref_defer_j8m`

Normal feature-flag graduation/cleanup. None has been observed as user-facing in this skill's
prior chapters.

---

## New Telemetry Events (5)

| Event | Trigger | Payload highlights |
|-------|---------|--------------------|
| `tengu_bg_daemon_cold_start_ask` | `CLAUDE_CODE_DAEMON_COLD_START="ask"` mode shows the cold-start prompt | (likely empty / minimal) |
| `tengu_bg_daemon_cold_start_ask_answer` | User answered the cold-start prompt | The answer |
| `tengu_bg_retired` | Idle background worker reaped (see "Idle Worker Reaper" above) | `{ rvSent, settledForMs, state }` |
| `tengu_daemon_startup_crash` | Daemon crashed during startup | (likely error info) |
| `tengu_memory_write_survey_event` | Memory-write Approve/Reject dialog emitted | (probably the survey outcome / record fields) |
| `tengu_plan_mode_violated` | Tool call slipped through plan mode (see "Plan-mode Tripwire" above) | `{ toolName, decisionReasonType }` |

---

## Removed Env Vars (1)

| Env Var | Notes |
|---------|-------|
| `CLAUDE_CODE_FORK_SUBAGENTM` | **Was never a real env var.** A diff-tool artifact: in v2.1.119's binary string table, the byte adjacent to `CLAUDE_CODE_FORK_SUBAGENT` (the real env var, from v2.1.117 / L87) happened to be `M`, and the prior `\b...\b` regex slurped it. v2.1.120's adjacent byte is `f` (lowercase), so the regex now stops correctly. The real `CLAUDE_CODE_FORK_SUBAGENT` exists in both versions, unchanged. The diff script `extract_envvars` was rewritten to use JS-context anchors instead of word boundaries; both the v2.1.119 false-add and v2.1.120 false-remove are gone after that fix. |

---

## What Did NOT Change in v2.1.120

- **Hook event types**: 19, unchanged
- **API beta strings**: 32, unchanged
- **`/fork` machinery (L87)**: unchanged
- **OIDC Federation (L86)**: unchanged
- **Cowork runtime surface (L89)**: `/background`, `/stop`, `/daemon`, Fleet view all
  unchanged (this is a refinement release on top of the v2.1.119 GA)

---

## Cross-References

| Lesson | Connection |
|--------|------------|
| **L11** (Skills System) | Skills can declare `effort:` in frontmatter; `${CLAUDE_EFFORT}` is a body-template substitution. Update L11's frontmatter table to include `effort` if it's not yet documented. |
| **L43** (KAIROS) | Daemon hot-upgrade is the missing piece KAIROS needs for unattended longevity. v2.1.120's polling+restart loop is the implementation. |
| **L85** (`CLAUDE_BG_BACKEND=daemon`) | The persistent-install kill-switch in v2.1.120 confirms L85's "daemon-mode is staged" framing — the runtime exists, the always-on user surface is held back. |
| **L86** (`CLAUDE_CODE_SIMPLE` / `_SYSTEM_PROMPT`) | `CLAUDE_CODE_LEAN_PROMPT` is the *granular* counterpart to L86's wholesale prompt swap. Both coexist; pick based on need. |
| **L89** (this chapter) | v2.1.120 refines v2.1.119's Cowork-runtime GA — same surface, more knobs and safer defaults |

---

## Risks Worth Flagging

1. **Auto-memory pipelines will hit a confirmation dialog when the GB flag rolls out.**
   If you have a hook that writes memory files frequently, design your writes to fall
   below `summaryLineThreshold` to bypass the dialog — or expect users to see Approve/Reject
   prompts on every memory update.
2. **`CLAUDE_COWORK_MEMORY_GUIDELINES` can wholesale replace user memory.** A Cowork-spawned
   session can effectively ignore the user's memory configuration for the duration of that
   session. This is intentional design but worth knowing for debugging "why isn't my memory
   showing up in this session."
3. **`CLAUDE_EFFORT` is a prompt-shaping mechanism, not a model API parameter.** Do not
   confuse with provider-side reasoning-effort knobs (e.g., OpenAI's `reasoning_effort`).
   Setting `effort: high` in a skill frontmatter just inserts an English instruction into
   the prompt; it does not allocate more thinking tokens at the API layer.
4. **Persistent daemon install is held back, not removed.** The `tengu_daemon_install` /
   `_auto_uninstall` telemetry is live and the supervisor is fully built. Future releases
   may flip the kill switch — watch for changes to `xQH()` / `aa()`.
5. **`CLAUDE_CODE_LEAN_PROMPT` has model-conditional sections.** The Bash description swap
   only fires for `claude-opus-4-7`. If you're noticing prompt drift across model swaps,
   the lean toggle may be the cause.

---

## Summary for v2.1.120

| Category | Count | Notes |
|----------|-------|-------|
| Slash commands added | 0 | `/schedule`'s description was simplified (template-literal conditional → static string), no new command added |
| Env vars added | 4 | `CLAUDE_CODE_DAEMON_COLD_START`, `CLAUDE_CODE_LEAN_PROMPT`, `CLAUDE_COWORK_MEMORY_GUIDELINES`, `CLAUDE_AGENTS_AUTO_RELAUNCHED_AT` |
| Env vars removed | 0 | (`_FORK_SUBAGENTM` was a diff-tool artifact, never real) |
| GrowthBook flags added | 6 | `tengu_amber_anchor`, `tengu_ochre_finch` (lean prompt: memory), `tengu_quiet_harbor`, `tengu_slate_siskin`, `tengu_umber_petrel`, `tengu_vellum_lantern` (lean prompt: Bash) |
| GrowthBook flags removed | 11 | Routine cleanup of dark-launched-and-graduated flags |
| Telemetry events added | 6 | `tengu_bg_daemon_cold_start_ask` (+ `_answer`), `tengu_bg_retired`, `tengu_daemon_startup_crash`, `tengu_memory_write_survey_event`, `tengu_plan_mode_violated` |
| Hook event types | 19 (unchanged) | |
| API beta strings | 32 (unchanged) | |
| Daemon model | **Strictly on-demand** | Persistent install kill-switched via `xQH()`. `transient` (default) and `ask` are the only cold-start modes. |
| Major architectural reveal | Cowork's memory-bypass | `CLAUDE_COWORK_MEMORY_GUIDELINES` lets Cowork-spawned sessions ignore user memory entirely |
