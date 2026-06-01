Updated: 2026-06-01 | Source: Binary extraction from claude v2.1.159 (structured diff vs v2.1.138; cross-checked against CHANGELOG 2.1.139–2.1.159)

# Chapter 21: Verified New in v2.1.139–v2.1.159 (Source-Confirmed)

> **Provenance:** Direct binary extraction of the v2.1.159 bundle and structured diffing
> against the v2.1.138 baseline (recovered from the release CDN, checksum-verified), plus a
> cross-check against the official CHANGELOG for 2.1.139–2.1.159. Counts from the diff:
> +48 env vars / −5, +7 slash commands / −4, +2 API betas, +135 `tengu_*` / −31. Condensed
> coverage: one source-grounded section per lesson (L91–L104). The exhaustive per-identifier
> traces live in the repo's internal `docs/internal/deep-dive-2.1.159.md`.

> **Narrative for this chapter — a two-headed release.**
> v2.1.159 straddles a **model launch** (Opus 4.8 becomes the default, drops its default effort
> to `high`, adds an `xhigh`/`max` tier ladder) and a **new orchestration subsystem** (Dynamic
> Workflows: a `Workflow` tool driving a deterministic JS script that fans out sub-agents, with
> a journal-resume mechanism, a 1000-agent cap, and an optional token budget). Around those two
> pillars sits a band of plumbing/consent changes: streaming tool execution went fully GA (gate
> deleted), auto permission mode is being promoted to default with a repo-spoof guard, an
> org-managed skills/plugins **sync** subsystem pulls from Console, a Cloud **gateway** OAuth
> provider lands, host-delegated credential refresh generalizes L86's OIDC work, and the
> background runtime gains self-upgrade ("binary takeover") + a Fleet→agent-view rename. Plus a
> new `MessageDisplay` hook (the live master hook array is now **30**, not the 27/19 older
> chapters cite), a `/loop` keepalive, removal of the plan-mode interview phase, and ~30 new
> codename GB flags.
>
> **Recurring theme — measurement bugs in our own tooling.** Several "findings" this cycle trace
> to `diff-versions.sh` artifacts, not real behavior: the hook-event undercount (suffix
> allowlist), env-var false positives (`ANTHROPIC_ENVIRONMENT_ID/KEY`, `CLAUDE_CODE_SKILL_NAME`
> are markdown/exports — same class as L90's `CLAUDE_EFFORT`), allowlisted-but-dead vars
> (`CLAUDE_CODE_USE_GATEWAY`), and slash-command false-removals (`/remote-control`). The extractor
> was hardened in v2.11.17; claims below are post-fix and source-verified.

---

## TABLE OF CONTENTS

91. [Lesson 91 -- Dynamic Workflows (`Workflow` tool, journal-resume, agent/budget caps, keyword trigger)](#lesson-91----dynamic-workflows)
92. [Lesson 92 -- Coordinator Mode (worker-team dispatch role, composes with Workflows)](#lesson-92----coordinator-mode)
93. [Lesson 93 -- Opus 4.8 Launch + Effort/Fast-Mode (`high` default, `xhigh`/`max` ladder, downgrade override)](#lesson-93----opus-48-launch--effortfast-mode)
94. [Lesson 94 -- Streaming Tool Execution GA + Streaming Reliability Layer](#lesson-94----streaming-tool-execution-ga--reliability)
95. [Lesson 95 -- `MessageDisplay` Hook + the 30-Event Master Array (+ Stop-Hook Block Cap, `reloadSkills`/`sessionTitle`)](#lesson-95----messagedisplay-hook--the-30-event-master-array)
96. [Lesson 96 -- Auto-Mode Promotion to Default + Repo-Spoof Guard](#lesson-96----auto-mode-promotion--repo-spoof-guard)
97. [Lesson 97 -- Cloud Gateway OAuth Provider](#lesson-97----cloud-gateway-oauth-provider)
98. [Lesson 98 -- Org-Managed Skills/Plugins Sync + CLI-as-Skill](#lesson-98----org-managed-skillsplugins-sync--cli-as-skill)
99. [Lesson 99 -- Host-Delegated Credential Refresh + OIDC env-quad extension](#lesson-99----host-delegated-credential-refresh)
100. [Lesson 100 -- Background Runtime: Binary Takeover + Fleet→Agent-View Rename](#lesson-100----background-runtime-binary-takeover--agent-view-rename)
101. [Lesson 101 -- `/loop` Keepalive (KAIROS self-pacing safety net)](#lesson-101----loop-keepalive-kairos)
102. [Lesson 102 -- Plan-Interview Removal + Team-Memory Multistore + Command Churn + Spend Nudges](#lesson-102----plan-interview-removal--team-memory--command-churn)
103. [Lesson 103 -- PEWTER_OWL Gate over the `SendUserMessage` (Brief) Tool](#lesson-103----pewter_owl-over-senduserMessage)
104. [Lesson 104 -- New Codename GB-Flag Triage (~30 flags)](#lesson-104----codename-gb-flag-triage)

---

# LESSON 91 -- DYNAMIC WORKFLOWS

**What it is.** A new subsystem letting the model run a deterministic JavaScript "script" that
fans out sub-agents (parallel or pipelined) and collects their results — the `Workflow` tool.
A `journal.jsonl` lets an interrupted run resume by skipping already-finished agents. Typing the
literal word "workflow" in a prompt opts that turn into the Workflow tool (`alt+w` to dismiss).
Rides on the L87/L89 fork-subagent infrastructure but is a distinct spawning path.

**Mechanism.**
- Master gate `AW()`: `dK6()` kill switch (`CLAUDE_CODE_DISABLE_WORKFLOWS` truthy OR
  `settings.disableWorkflows===true`) → `O87()` org policy (`v7('allow_workflows')`) → `FP8()`/`RP5()`
  availability+default → `GP5()` (`settings.enableWorkflows`) override. `defaultOn = $K()!=="pro"`:
  **non-pro and unauthenticated default ON; pro defaults OFF** (inverse of the usual rollout pattern).
- `CLAUDE_CODE_WORKFLOWS` is tri-state in `RP5()`: truthy→availability from `tengu_workflows_enabled`;
  explicit-false→unavailable; unset→Statsig+plan fallthrough.
- Caps: hard agent cap `t4K=1000` → `WorkflowAgentCapError` + `tengu_workflow_agent_cap_exceeded`.
  Token budget defaults to **none** (`budget.total=null`→`Infinity`); only bites when a caller sets it
  (`SE4()`) → `tengu_workflow_budget_cap_exceeded`.
- Resume: `journal.jsonl` appends `{type:'started'}`/`{type:'result'}`; completed agents are skipped on
  re-run; `tengu_workflow_journal_started_hit_respawn` counts started-but-unfinished agents respawned
  ("respawn" = resume-after-restart, not crash-restart).
- Keyword trigger: `Id8` matches `/workflows?/`; gated by `AW() && lK6()`
  (`workflowKeywordTriggerEnabled`, default true) `&& isRegularUserPrompt`. `/config` exposes the toggle.
- `/workflows` slash command (`local-jsx`, `isEnabled:()=>AW()`) is a run-history browser.

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `Workflow` (`mH_`) | tool | gated by `AW()` | run a deterministic multi-agent script |
| `CLAUDE_CODE_WORKFLOWS` | env | unset | tri-state availability override |
| `CLAUDE_CODE_DISABLE_WORKFLOWS` | env | unset | hard kill |
| `tengu_workflows_enabled` | GB flag | true | server rollout switch |
| `t4K` / `WorkflowAgentCapError` | const/error | 1000 | hard agent cap per run |
| `tengu_workflow_budget_cap_exceeded` | telemetry/error | budget null | token-budget cap (opt-in) |
| `tengu_workflow_journal_started_hit_respawn` | telemetry | always-on | resume instrumentation |
| `tengu_workflow_keyword`(`_dismissed`/`_restored`) | telemetry | — | keyword-trigger UI |
| `tengu_workflow_launched`/`_completed`/`_phase_completed`/`_saved`/`_usage_warning_accepted` | telemetry | — | lifecycle observability |
| `/workflows` | slash | `AW()` | history browser |

---

# LESSON 92 -- COORDINATOR MODE

**What it is.** A **distinct** session dispatch role (not the Workflows UI) that orchestrates worker
*teams* with its own system prompt and `TeamCreate`/`TeamDelete` tools. Workflows and coordinator
mode are orthogonal gates that **compose**: the Workflow tool joins the coordinator toolset only if
Dynamic Workflows is also enabled.

**Mechanism.**
- Gate `jb()`: requires `bH(CLAUDE_CODE_COORDINATOR_MODE)`; blocked unless remote in the
  `fR()&&!Q8()&&!bH(CLAUDE_CODE_REMOTE)` branch (a remote/headless restriction).
- `isCoordinatorMode()` guards toolset composition: `[_Z6, ZH_, Ad8(), ...(mH_ && AW() ? [mH_] : [])]`
  — the Workflow tool `mH_` is appended **only if `AW()` is true** too.
- System prompt: `WN5`/`getCoordinatorSystemPrompt` (worker-team orchestration framing).
- `matchSessionMode(XN5)` mutates the env var on resume + emits `tengu_coordinator_mode_switched`.
  `CLAUDE_CODE_COORDINATOR_MODE` is in the `$Kq` child-env passthrough allowlist.
- `tengu_coordinator_panel` (default true; off under `S8()`) gates the coordinator UI panel.

> **Caveat:** the `TeamCreate`/`TeamDelete` string tokens already existed in 2.1.138 (count 6); only
> the coordinator-mode *dispatch wiring* (`jb`/`isCoordinatorMode` + env gate + system-prompt swap) is
> new. No standalone `/coordinator` slash command was found.

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `CLAUDE_CODE_COORDINATOR_MODE` | env | unset | enables the coordinator dispatch role (remote-gated) |
| `tengu_coordinator_panel` | GB flag | true | coordinator UI panel |
| `tengu_coordinator_mode_switched` | telemetry | — | mode (un)set on resume |
| `TeamCreate`/`TeamDelete` | tools | coordinator-only | worker-team management (tokens predate 2.1.159) |

---

# LESSON 93 -- OPUS 4.8 LAUNCH + EFFORT/FAST-MODE

**What it is.** `claude-opus-4-8` is the new default top model. Unlike 4.7 it ships tuned to `high`
effort (4.7 defaulted to `xhigh`), on the theory that most tasks don't need maximum reasoning; users
opt into `xhigh` for hard problems via `/effort`. A launch banner announces it (capped, first-party
only). The old fast-mode env var that *upgraded* 4.6→4.7 is gone; the new one *downgrades* 4.8→4.6.

**Mechanism.**
- Model ID `claude-opus-4-8` is bare on firstParty/Vertex/Foundry/anthropicAws, `us.anthropic.…` on
  Bedrock, `anthropic.…` on Mantle; `n9()`→`TM()` normalizes provider prefixes to canonical.
- Effort ladder `eN=["low","medium","high","xhigh","max"]` (alias `med→medium`). Resolver `Zo(model,fb)`:
  env override `CLAUDE_CODE_EFFORT_LEVEL` (`unset`/`auto`→null) → per-model default `nK6()` (4.8→`high`,
  4.7→`xhigh`, else `high`) → clamp (`max→high` if not max-capable; `xhigh→high` if not xhigh-capable
  via `acH()`, which excludes claude-3-*, opus-4-0/4-1/4-5/4-6, sonnet-*, haiku-4-5). Label "Opus 4.8/4.7 only".
- Launch banner: `tengu_opus48_launch_shown`; gate requires `opus48LaunchSeenCount < 8` **AND**
  firstParty (never shows on Bedrock/Vertex/Foundry). `unpinOpus48LaunchEffort` (default false) pins
  effort at the launch default until the user changes `/effort`.
- `${CLAUDE_EFFORT}` substituter is `bk(model,effort)` in 2.1.159 (L90's `_I` is the v2.1.120 minified
  name — identifier drift, mechanism unchanged).
- Fast-mode: `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` truthy → downgrade to Opus 4.6 (`ip()`).
  Removed: `CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE`, `tengu_fennel_kite_model`.
- Model-routing fallbacks: `tengu_api_model_not_found_fallback_triggered` (404 model → fallback retry),
  `tengu_refusal_fallback_triggered` (refusal → discard stream, re-run on fallback). `effort-2025-11-24`
  beta predates 4.8 (reused, not new).

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `claude-opus-4-8` | model ID | new default | Opus 4.8 |
| `tengu_opus48_launch_shown` | telemetry | — | launch banner (cap 8, firstParty); replaces `_opus47_` |
| `tengu_ultra_effort` | telemetry | — | enter/exit `xhigh` ("ultra") reminder banner |
| `CLAUDE_CODE_EFFORT_LEVEL` | env | null/auto | global effort pin |
| `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` | env | unset | truthy → downgrade 4.8→4.6 |
| `CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE` / `tengu_fennel_kite_model` | env/flag | **removed** | 4.7-era fast-mode gone |
| `tengu_api_model_not_found_fallback_triggered` / `tengu_refusal_fallback_triggered` | telemetry+behavior | — | model-routing fallbacks |

---

# LESSON 94 -- STREAMING TOOL EXECUTION GA + RELIABILITY

**What it is.** Tool calls now begin executing as their input streams in, **for everyone, with no
opt-out** — "enabled for all users" (CHANGELOG 2.1.154). Around it, a reliability layer adds retries
for stalled/idle connections and a byte-level idle watchdog.

**Mechanism.**
- GA: the `config.gates.streamingToolExecution` gate (Statsig `tengu_streaming_tool_execution2`) was
  **deleted** — not defaulted on. The executor is built unconditionally (`new U__(...)`, formerly the
  gated `jM_`); the A/B telemetry (`_used`/`_not_used`) is gone. **No remaining env/flag escape hatch.**
- Pre-first-event retries: `tengu_streaming_stale_connection_retry` (connection closes before first
  event → retry with linear backoff); `tengu_streaming_watchdog_retry` (idle watchdog fires → immediate
  retry, no backoff).
- Byte watchdog: `CH5()` idle timeout precedence — env `CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS` > legacy
  `CLAUDE_STREAM_IDLE_TIMEOUT_MS` > Statsig `tengu_byte_stream_idle_timeout_ms` (default 300000),
  clamped `[10000, 1800000]`. Applies to SSE (on by default) and Bedrock eventstream (opt-in via
  `CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK`); `IH5()` kill/force via `CLAUDE_ENABLE_BYTE_WATCHDOG`.
- 400/usage repair (telemetry-only, always-active): `tengu_thinking_signature_strip_retry`,
  `tengu_media_block_strip_retry`, `tengu_reorder_tool_uses_skipped_for_thinking`,
  `tengu_message_delta_usage_missing`.

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `tengu_streaming_tool_execution2`/`_used`/`_not_used` | gate+telemetry | **removed** | streaming tool exec now ungated |
| `CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS` | env | →300000 | byte-watchdog idle timeout |
| `CLAUDE_ENABLE_BYTE_WATCHDOG`/`_BEDROCK` | env | SSE on / Bedrock off | watchdog kill-force / Bedrock opt-in |
| `tengu_byte_stream_idle_timeout_ms` | GB flag | 300000 | server-tuned timeout |
| `tengu_streaming_stale_connection_retry`/`_watchdog_retry` | telemetry | — | pre-first-event retries |

---

# LESSON 95 -- `MessageDisplay` HOOK + THE 30-EVENT MASTER ARRAY

**What it is.** A new `MessageDisplay` hook event fires as an assistant message streams (and once when
complete) and can rewrite what's shown on screen — **without** changing the stored transcript — by
returning `hookSpecificOutput.displayContent`. It is the **30th** entry in the master hook-event array.

> **Count correction.** Older chapters cite "27" (ch9/L10, correct for v2.1.90) and "19" (ch17/L85-era
> — a `diff-versions.sh` undercount artifact). The live master array is **30**:
> `PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit,
> UserPromptExpansion, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop,
> PreCompact, PostCompact, PermissionRequest, PermissionDenied, Setup, TeammateIdle, TaskCreated,
> TaskCompleted, Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove,
> InstructionsLoaded, CwdChanged, FileChanged, MessageDisplay`. The old extractor's suffix allowlist
> silently dropped `MessageDisplay`/`PostToolBatch`/`CwdChanged`/`FileChanged` in *both* bundles
> (fixed in v2.11.17).

**Mechanism.**
- `MessageDisplay` plumbing: Zod input (`MessageDisplay`, `turn_id`, `message_id`, `index`, `final`,
  `delta`); output with optional `displayContent`; executor `vq_` (`executeMessageDisplayHooks`); fired
  at `$W4` (streaming, per batch) and `zW4` (completed). Output replaces the on-screen delta only.
- Gated by config-presence (`WV('MessageDisplay',...)`) — **no Statsig flag**; disabled unless a hook
  is configured.
- `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (default **8**): if a Stop hook blocks more than the cap
  consecutively, the CLI overrides it and ends the turn (`tengu_stop_hook_block_count` with
  `hit_cap:true`); `<=0` disables.
- `SessionStart`/`UserPromptSubmit` output gained `reloadSkills:boolean` (mid-session skill rescan +
  `hook_session_start_reload_skills`) and `sessionTitle:string` (programmatic `/rename`).
- `tengu_hook_plugin_metrics` (plugin-hook numeric/boolean output dual-emit); `tengu_hook_prompt_too_long_retry`
  (evaluator-prompt truncation retry — magnitude ≈ a quarter of the token budget, not "half the messages").

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `MessageDisplay` (`vq_`) | hook event #30 | config-gated, no flag | rewrite on-screen delta, not transcript |
| `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` | env | 8 | consecutive Stop-block override ceiling |
| `reloadSkills` / `sessionTitle` | hook output fields | absent | mid-session skill rescan / programmatic rename |
| `tengu_hook_plugin_metrics` / `tengu_hook_prompt_too_long_retry` | telemetry | — | plugin-hook metrics / evaluator truncation retry |

---

# LESSON 96 -- AUTO-MODE PROMOTION + REPO-SPOOF GUARD

**What it is.** Auto mode (an LLM classifier vets each tool call, auto-runs the safe ones, blocks the
rest) is being promoted from opt-in toward the default permission mode, via a one-time notice + a nudge
dialog. A new security guard refuses to let a checked-in repo silently force auto mode.

**Mechanism.**
- 3P provider gate `rH6(H)`: firstParty/anthropicAws → auto mode always available; other providers →
  require `bH(CLAUDE_CODE_ENABLE_AUTO_MODE)`. **New** wiring; 3P auto mode injects the
  `afk-mode-2026-01-31` beta header (the beta token itself predates 2.1.159).
- Rollout config `tengu_auto_mode_config.enabled` normalized to `enabled|disabled|opt-in`, default
  `"opt-in"` (the normalizer + default are **not** new — only the notice/nudge/default-offer UI is).
- Promotion UI (all new): `tengu_auto_default_notice_shown` (once); `tengu_auto_default_nudge_shown`
  (dialog mount); `tengu_auto_default_nudge_resolved` (accept → writes
  `userSettings.permissions.defaultMode:"auto"`).
- Security guard: `tengu_settings_auto_mode_untrusted_source_ignored` — `defaultMode:"auto"` is honored
  only from `[policySettings, userSettings, flagSettings]`; `projectSettings`/`localSettings`
  (repo-controllable) are **ignored** with a warning. Real default-deny.
- Removed: `tengu_auto_notice_once`. (`tengu_auto_compact_routed_reactive` shares the prefix but belongs
  to auto-**compaction**, not auto permission mode.)

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `CLAUDE_CODE_ENABLE_AUTO_MODE` | env | unset | required for auto mode on 3P providers |
| `tengu_auto_mode_config.enabled` | GB config | `"opt-in"` | rollout switch (normalizer predates) |
| `tengu_auto_default_notice_shown`/`_nudge_shown`/`_nudge_resolved` | telemetry | — | promotion UI |
| `tengu_settings_auto_mode_untrusted_source_ignored` | telemetry+guard | default-deny | repo cannot force auto mode |

---

# LESSON 97 -- CLOUD GATEWAY OAUTH PROVIDER

**What it is.** A brand-new enterprise login option (provider value `"gateway"`, label "Cloud
gateway") that authenticates via short-lived JWTs with IdP refresh. Entered through `/login`, **not**
an env var.

**Mechanism.**
- Client built with `Authorization: Bearer <jwt>`, `apiKey:null`, `baseURL: gatewayAuth.url`; `x-api-key`
  explicitly disabled. Refresh via OIDC `idpRefreshToken` with in-flight de-dup; on expiry: "Cloud
  gateway session expired — run /login to reconnect."
- Selected via `/login` (`tengu_oauth_gateway_selected` → `state:"gateway_setup"`).
- ⚠️ `CLAUDE_CODE_USE_GATEWAY` does **NOT** select the gateway — it appears only in the env-name
  allowlist (both bundles) and is **never read**; `Zq()` does not branch on it. Treat as dead/reserved.

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| Cloud gateway (`gatewayAuth`/`xY()`) | provider | login-set | JWT + IdP-refresh enterprise gateway |
| `tengu_oauth_gateway_selected` | telemetry | — | `/login` gateway option chosen |
| `CLAUDE_CODE_USE_GATEWAY` | env | unconsumed | **dead/reserved** — does not select gateway |

---

# LESSON 98 -- ORG-MANAGED SKILLS/PLUGINS SYNC + CLI-AS-SKILL

**What it is.** When enabled, Claude Code pulls the authoritative skills/plugins list from your
*organization's* Console config and reconciles local staging dirs to match — enterprise push
distribution, not git/marketplace. Separately, a dark-launched built-in `claude-code-docs` skill
answers questions about Claude Code itself.

**Mechanism.**
- Two pure-env truthy gates (`bH`), both default OFF, not Statsig: `CLAUDE_CODE_SYNC_SKILLS` (10-min
  re-sync) and `CLAUDE_CODE_SYNC_PLUGINS` (+ MCP reconcile).
- Source of truth: `GET /api/oauth/organizations/:orgUUID/skills/list-skills?include_wiggle_skills=true`
  and `.../plugins/list-plugins?enabled_only=true`, `auth:"teleport-org"`. Diff against local
  `manifest.json` under `~/.claude/skills` or `~/.claude/plugins/synced`; download/remove dirs to match.
- Timeouts: MCP-reconcile `CLAUDE_CODE_SYNC_PLUGINS_MCP_TIMEOUT_MS` default **10000** (not 30000); plugin
  install `CLAUDE_CODE_SYNC_PLUGINS_INSTALL_TIMEOUT_MS` default 30000; skills wait
  `CLAUDE_CODE_SYNC_SKILLS_WAIT_TIMEOUT_MS` default 5000. `tengu_plugins_sync_mcp_skipped` fires only when
  the MCP timeout is explicitly `0`; an actual timeout fires `tengu_plugins_sync_mcp_timeout`.
- CLI-as-skill: `CLAUDE_CODE_SKILL_NAME`/`CLAUDE_CODE_SKILL_DESCRIPTION` are **NOT env reads** — module
  exports holding constants (`claude-code-docs` + its trigger description). Registered by
  `registerClaudeCodeSkill` (`isEnabled:()=>tengu_birch_kettle`, default OFF; suppressed by
  `CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL`).
- `/run`, `/run-skill-generator` (`disableModelInvocation:true`), `/reload-skills` are project-app/skill
  commands unrelated to org sync. (2.1.157: `.claude/skills` plugin dirs auto-load —
  `tengu_plugin_skills_dir_loaded`.)

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `CLAUDE_CODE_SYNC_SKILLS`/`_PLUGINS` | env | OFF | org-managed reconcile from Console |
| `CLAUDE_CODE_SYNC_PLUGINS_MCP_TIMEOUT_MS` | env | **10000** | MCP reconcile bound |
| `CLAUDE_CODE_SYNC_PLUGINS_INSTALL_TIMEOUT_MS` / `_SKILLS_WAIT_TIMEOUT_MS` | env | 30000 / 5000 | install / startup-wait bounds |
| `CLAUDE_CODE_SKILL_NAME`/`_DESCRIPTION` | **module export** | constants | CLI-as-skill identity (NOT env vars) |
| `tengu_birch_kettle` | GB flag | false | `/claude-code-docs` skill |
| `tengu_skill_tool_fork_recursion_blocked` | guard+telemetry | always-on | prevents skill self-fork recursion |

---

# LESSON 99 -- HOST-DELEGATED CREDENTIAL REFRESH

**What it is.** A host app embedding the SDK (Desktop, VS Code, local-agent) can supply and refresh
credentials on demand over the SDK control channel, so embedded sessions never force a re-login.
Background workers receive a one-shot on-disk credential snapshot. `ANTHROPIC_WORKSPACE_ID` joins L86's
OIDC env-quad.

**Mechanism.**
- Capability advertisement (parent→child): `CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH="1"` /
  `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH="1"`, set when the host supplies `getOAuthToken`/`getHostAuthToken`
  callbacks. Child reads via `bH` and, under entrypoints `{claude-desktop, claude-desktop-3p, local-agent}`,
  schedules `requestHostAuthTokenRefresh`. (Entrypoint sets differ: OAuth refresh covers
  `{claude-desktop, local-agent, claude-vscode}` — VS Code gets OAuth but not host-auth.)
- RPC: `{subtype:"host_auth_token_refresh"}`→`response.authToken`; `{subtype:"oauth_token_refresh"}`→
  `response.accessToken`. Default 30000ms.
- `CLAUDE_CODE_HOST_AUTH_ENV_VAR` (default `ANTHROPIC_AUTH_TOKEN`): names the token-holding env var;
  presence sets `managedByHost` (also true if `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` is truthy).
  `CLAUDE_CODE_HOST_AUTH_REFRESH_TIMEOUT_MS` overrides the default.
- `CLAUDE_BG_AUTH_SNAPSHOT_PATH`: single-use bg credential handoff — reads path, deletes env var, unlinks
  file, installs `{accessToken, scopes?, subscriptionType?, rateLimitTier?}`.
- `ANTHROPIC_WORKSPACE_ID`: real runtime read in OIDC env-quad mode, joining
  `organization_id`/`federation_rule_id`/`web_identity_token_file` (machinery is L86-era).
- ⚠️ `ANTHROPIC_ENVIRONMENT_ID`/`ANTHROPIC_ENVIRONMENT_KEY` are **NOT CLI env reads** — they live only in
  the bundled claude-api skill markdown (SDK `EnvironmentWorker` example). Same false-positive class as
  L90's `CLAUDE_EFFORT`.

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH`/`_OAUTH_REFRESH` | env (capability) | unset | host-delegated credential refresh |
| `CLAUDE_CODE_HOST_AUTH_ENV_VAR` | env | `ANTHROPIC_AUTH_TOKEN` | names host token var; flips managedByHost |
| `CLAUDE_BG_AUTH_SNAPSHOT_PATH` | env | presence | one-shot bg credential handoff |
| `ANTHROPIC_WORKSPACE_ID` | env | OIDC env-quad only | workspace disambiguation |
| `ANTHROPIC_ENVIRONMENT_ID`/`_KEY` | **doc-only** | n/a | SDK EnvironmentWorker, NOT the CLI |
| `CLAUDE_SECURESTORAGE_CONFIG_DIR` | env | `~/.claude` | relocate secure cred storage |

---

# LESSON 100 -- BACKGROUND RUNTIME: BINARY TAKEOVER + AGENT-VIEW RENAME

**What it is.** Launching a newer Claude Code now retires an older still-running background daemon so
new work uses the current binary ("binary takeover"), with fallbacks if the binary moved or was deleted
mid-upgrade. "Fleet view" was renamed end-to-end to "agent view." Continues L89/L90.

**Mechanism.**
- `tengu_bg_binary_takeover` (Statsig, default **true**): retires the older on-demand runtime when
  `VERSION` differs (compare via `BMO()`, requires `daemonOrigin==='transient'`). Spawn fallbacks
  (telemetry): `_spawn_execpath_fallback` (ENOENT/EACCES → pin to `process.execPath`),
  `_spawn_versions_fallback` (scan `versions/`), `tengu_bg_spawn_binary_gone` (binary deleted → crash
  with "run your command again").
- Reaper: `tengu_bg_retire_grace_bridged_min` (default 480 min = 8h; low-mem shortens to 1 min).
  `tengu_bg_retire_pinned_low_mem` evicts even pinned workers under low memory — **Linux-only**
  (`By6()`→0 on macOS disables it; threshold `tengu_bg_low_mem_mb` default 1024).
- **Fleet→agent-view rename:** env `CLAUDE_CODE_DISABLE_AGENTS_FLEET`→`CLAUDE_CODE_DISABLE_AGENT_VIEW`;
  setting `disableBackgroundAgents`→`disableAgentView`; new one-shot `CLAUDE_CODE_AGENT_VIEW_RELAUNCH`.
  The `claude agents` command behavior is unchanged — **L89's "Fleet view" framing is now naming-stale.**
- Bridge attestation: `tengu_bridge_attestation_enforce` (default false) + `_config`;
  `CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY` restricts reattach to outbound-only.
- New bg env: `CLAUDE_BG_SESSION_PERMISSION_RULES` (JSON allow/deny, only when `SESSION_KIND==='bg'`);
  `CLAUDE_BG_TCC_DISCLAIMED` (macOS one-shot native self-respawn); `CLAUDE_CODE_SUPERVISED` (uncaught
  exception → clean exit for a supervisor); `CLAUDE_CODE_SPAWN_TIMESTAMP_MS`; PTY `CLAUDE_PTY_HOST_EXEC` /
  `CLAUDE_PTY_ORPHAN_CHECK_MS` (default 2000).
- Dark/dead: `tengu_ccr_v2_send_events_cli` (`d26()` defined, **zero consumers**);
  `tengu_rename_full_session_fork` (default false).

> **Cross-ref — Cowork plugin-hook namespace (L89, updated v2.11.18).** A real-Cowork test this cycle
> resolved the L89 question: plugin hooks **do** fire in Cowork (host-loop symlink staging into
> `claude-hostloop-plugins/<hash>`); the determinant is a **three-root** plugin namespace, where a
> desktop Cowork session reads only `local-agent-mode-sessions/<acc>/<org>/cowork_plugins/cache` (+`rpm/`)
> — which the standalone-CLI `--cowork` install never reaches. See the L89 subsection.

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `tengu_bg_binary_takeover` | GB flag | true | self-upgrade retires stale daemon |
| `tengu_bg_retire_grace_bridged_min` | GB flag | 480 (8h) | bridged-idle worker grace |
| `tengu_bg_retire_pinned_low_mem` | telemetry+behavior | Linux-only | low-mem pinned-worker eviction |
| `CLAUDE_CODE_DISABLE_AGENT_VIEW` / `_AGENT_VIEW_RELAUNCH` | env | unset | agent-view disable / relaunch marker |
| `tengu_bridge_attestation_enforce`(`_config`) | GB flag | false | bridge attestation gate |
| `CLAUDE_BG_SESSION_PERMISSION_RULES` / `_TCC_DISCLAIMED` / `CLAUDE_CODE_SUPERVISED` | env | unset | bg perm-rules / TCC disclaim / supervised exit |
| `tengu_ccr_v2_send_events_cli` | GB flag | false | **dead code, no consumer** |

---

# LESSON 101 -- `/loop` KEEPALIVE (KAIROS)

**What it is.** `/loop` runs a prompt on a recurring interval; in "dynamic" mode the model picks its own
next-wakeup delay. New in this cycle: a keepalive safety net that arms a ~20-min fallback wakeup when a
self-pacing loop ends a turn *without* rescheduling itself, so it doesn't silently die.

**Mechanism.**
- `HO7()=bH(CLAUDE_CODE_LOOP_KEEPALIVE) || tengu_kairos_loop_keepalive` (env force-on over Statsig,
  default false). When a loop turn ends without rescheduling and no `kind:"loop"` cron exists, arms
  `qO7()`.
- Strictly subordinate to dynamic mode `A5H()` (`tengu_kairos_loop_dynamic`, default false, predates this
  cycle): enabling only the env var without the dynamic flag does nothing (`gate_off`). Fallback delay
  ~1200s (20 min), clamped `[60, 3600]`; emits `tengu_loop_keepalive_fired`.
- `tengu_loop_dynamic_wakeup_ends_turn` = the opposite path (model self-rescheduled). `tengu_loop_ended`
  with reasons `gate_off`, `aged_out` (>7-day max).
- **`/dream` is NOT removed** (a diff-tool note): in v2.1.138 it was a `name:"dream"` command; in 2.1.159
  it's reclassified to a built-in **routine** (clustered with `/catch-up`, `/morning-checkin`, cron
  `0 */2 * * *`). Its slash-command registration genuinely changed shape — the diff's "removed" was for
  the registration, not the feature.

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `CLAUDE_CODE_LOOP_KEEPALIVE` | env | unset | force keepalive on (over Statsig) |
| `tengu_kairos_loop_keepalive` | GB flag | false | keepalive rollout switch |
| `tengu_loop_keepalive_fired` | telemetry | — | ~20-min fallback wakeup armed (clamped 1–60 min) |
| `tengu_kairos_loop_dynamic` | GB flag | false (predates) | self-pacing mode + keepalive prerequisite |
| `/dream` | routine | present | reclassified command→routine, NOT removed |

---

# LESSON 102 -- PLAN-INTERVIEW REMOVAL + TEAM MEMORY + COMMAND CHURN

**What it is.** The interactive "interview" some users got on entering plan mode is fully gone. New
team-memory lets a session mount multiple memory stores. Several commands churned.

**Mechanism.**
- Plan interview **removed**: env `CLAUDE_CODE_PLAN_MODE_INTERVIEW_PHASE` and flags
  `tengu_plan_mode_interview_phase`, `tengu_ask_user_question_finish_plan_interview` all gone. Plan V2
  explore-agents survive.
- Team memory (new): `CLAUDE_MEMORY_STORES` JSON array (path-string or `{path, mode:rw|ro, mount}`;
  duplicate mounts throw). Background sync emits `tengu_team_mem_multistore_sync`
  (`pull_failures`/`push_failures`/`conflicts`/`secrets_skipped`) / `_config_invalid`.
  `CLAUDE_BG_MEMORY_TOGGLED_OFF="1"` propagates memory-off into bg children.
- Command churn: `/commit` + `/commit-push-pr` **removed** as builtins (migrated to the commit-commands
  plugin). `/usage-credits` (rename of `/extra-usage`, which survives as a hidden alias). `/scroll-speed`
  (terminal-gated, `tengu_scroll_speed_set`). `/wellbeing` is **dark-launched** (`isEnabled:()=>!1`,
  break reminders/quiet hours). `/remote-control` and `/dream` were NOT removed (diff-tool artifacts —
  dynamic ternary description / routine reclassification respectively).
- Monetization: `tengu_spend_limit_nudge_{cancel,save,upgrade,wait}` (credit-limit dialog);
  `tengu_startup_notice` (server-pushed startup banner, string config); `tengu_fotw_nudge_shown`
  (Feature-of-the-Week, backed by `tengu_lilac_loom`).

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `CLAUDE_CODE_PLAN_MODE_INTERVIEW_PHASE` (+2 flags) | env/flag | **removed** | interview phase gone |
| `CLAUDE_MEMORY_STORES` | env | unset | mount multiple rw/ro memory stores |
| `tengu_team_mem_multistore_sync`/`_config_invalid` | telemetry | — | team-memory sync cycle |
| `CLAUDE_BG_MEMORY_TOGGLED_OFF` | env | unset | propagate memory-off into bg child |
| `/usage-credits` (alias hidden `/extra-usage`), `/scroll-speed`, `/wellbeing` (dark) | slash | — | pay-as-you-go / scroll speed / break reminders |
| `tengu_spend_limit_nudge_*` / `tengu_startup_notice` / `tengu_fotw_nudge_shown` | telemetry/config | — | spend nudges / startup banner / FOTW |

---

# LESSON 103 -- PEWTER_OWL OVER `SendUserMessage`

**What it is.** Not a new tool. `SendUserMessage` (renamed from `Brief` *back in 2.1.138*, with `Brief`
kept as an alias) is Claude's internal, non-user-invokable "send a visible message to the user" channel.
What 2.1.159 adds is a `pewter_owl` gate layer and an alternate prompt that tells the model to use the
channel **less**.

**Mechanism.**
- Namespace `j5H`: `SendUserMessage` (current), `Brief` (legacy alias). `userFacingName()` returns `""`
  (internal), `isReadOnly()=true`.
- Prompt selection: `prompt()` returns the brief prompt (`rZ8`, "route everything through it") or the
  pewter_owl variant (`oZ8`, a tighter "verbatim" framing that tells the model NOT to route its final
  answer through the tool) depending on `GH_()`.
- Gate `KY8()`: `PK(CLAUDE_CODE_PEWTER_OWL)`→off override; `bH(...)`→force-on; else model filter
  (`tengu_pewter_owl_model` non-empty AND model matches) + `tengu_pewter_owl_*` flags /
  `clientDataCache.pewter_owl_*`. `tengu_pewter_owl_model` is an *eligibility filter*, not a model router.

> **Net:** the Brief→SendUserMessage rename predates 2.1.159; PEWTER_OWL is a new gate layer (not a new
> tool). The notable bit is that the pewter_owl prompt variant *reduces* messaging-tool reliance — an
> experiment in the opposite direction from brief mode.

| Identifier | Kind | Default | Effect |
|---|---|---|---|
| `SendUserMessage`/`Brief` | tool name/alias | n/a | internal output channel (rename predates 2.1.159) |
| `CLAUDE_CODE_PEWTER_OWL` | env | unset | hard on/off (off-override beats all; force-on) |
| `tengu_pewter_owl_header`/`_tool`/`_brief` | GB flags | false | three independent pewter_owl capabilities |
| `tengu_pewter_owl_model` | GB flag (string) | `""` | model-scope eligibility filter |

---

# LESSON 104 -- NEW CODENAME GB-FLAG TRIAGE

**What it is.** ~30 new `Z_("tengu_<codename>", <default>)` GrowthBook flags, none present in 2.1.138.
Contrary to "mostly dark launch," **most are wired into real control flow** (model selection, auto-mode,
a slash command, prompt-text injection, nudge copy). Defaults are almost all off; only `cobalt_thicket`
defaults on (and merely caps a debug level).

**Triage.**
- **Gate real features:** `cedar_hollow_7m`/`quartz_heron`/`amber_redwood3`/`amber_rokovoko`
  (model/compaction tuning — `amber_rokovoko` feeds `precomputeBufferFraction`); `harbor_willow`/`moss_anchor`/`maple_pier`
  (auto-mode on / extend-to-noninteractive / nudge gate); `birch_kettle` (`/claude-code-docs`);
  `amber_lattice` (injects Anthropic auth into allowlisted plugins on first-party accounts); `brick_follow`
  (forward interim voice transcripts); `marble_lark` (personal/user-scoped memory writes); `alder_compass`
  (powerup-onboarding nudge); `dune_wren`/`garnet_finch` (loop/goal nudges); `lilac_loom` (Feature-of-the-Week).
- **String/enum prompt-or-copy overrides** (let Anthropic edit prompts/copy server-side without a
  release): `cinder_plover`/`heron_brook` (prompt-text injection — AskUserQuestion / coding instruction);
  `pewter_lark`/`kestrel_arch` (enums, default `'off'` — `/goal` copy A/B, opusplan reminder).
- **Cosmetic:** `shining_fractals` (spinner/shimmer).
- **Opaque / lightly-wired:** `cobalt_thicket` (defaults ON; caps debug level to 2), `basalt_meadow`,
  `basalt_scarp`, `chert_bezel`, `compass_dial`, `pewter_summit`, `vellum_siding`, `loggia_carousel`,
  `cedar_marsh`, `bridge_vivid`.
- **Removed codenames:** `ashen_kelp`, `birch_compass`, `cobalt_raccoon`, `coral_fern`, `ember_trail`,
  `ladder_mq7`, `loud_sugary_rock2`, `maple_tide`, `porch_bell_9f`, `sedge_lantern_holdback`,
  `slate_kestrel`, `slate_meadow`, `tern_alloy`, `tide_elm`, `timber_lark`, `vellum_lantern`,
  `willow_prism`.

> Several are **not boolean** — string/enum-valued — which is the point: they let prompt/copy be edited
> server-side. Treat the opaque set as dark launches pending future wiring.
