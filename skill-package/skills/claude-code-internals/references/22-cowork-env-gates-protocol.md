Updated: 2026-06-13 | Source: **First-party binary extraction & verification.** Every entry below was grepped from the installed **Claude.app (Desktop) `app.asar` 1.12603.1** (main process `.vite/build/index.js`), the **in-VM agent ELF `claude-code-vm/2.1.170/claude`** (Bun-SEA JS bundle), and the **live on-disk `fcache`** — surfaced by the same verification workflow as Ch24/L107 and individually re-grep-confirmed (presence + behavior anchor). Minified identifiers and gate IDs drift across versions; gate *states* are this installation's `fcache` snapshot (a standard interactive Anthropic account, 2026-06-13).

# Chapter 25: Cowork & Desktop Environment Variables, Production GrowthBook Gates, and the Extended Control-Protocol Surface (app.asar 1.12603.1 / in-VM ELF 2.1.170)

> **What this chapter is.** A binary-verified reference catalog of the Cowork/Desktop surface that the
> other chapters touch but don't enumerate: (A) environment variables read by the in-VM agent and/or the
> desktop host, (B) the GrowthBook feature gates that are *force-on/off in production* (decoded from the
> live `fcache`), and (C) the full set of stream-json control-protocol request/system-message subtypes
> beyond the seven dispatcher subtypes of Ch22/L105 and the five spawn-contract subtypes of Ch24/L107.
> Companion to Ch20/L89 (host-loop/split execution), Ch24/L107 (spawn + control protocol), Ch23/L106
> (the `cli_plugin` gate).

---

## TABLE OF CONTENTS

108. [Lesson 108 -- Cowork/Desktop env vars, production gates, and the extended control protocol](#lesson-108----coworkdesktop-env-vars-production-gates-and-the-extended-control-protocol)

---

# LESSON 108 -- COWORK/DESKTOP ENV VARS, PRODUCTION GATES, AND THE EXTENDED CONTROL PROTOCOL

## Part A — environment variables (binary-verified, current as of 2.1.170 / asar 1.12603.1)

All present in the binary noted; `[VM]` = in-VM agent ELF, `[ASAR]` = desktop main process. Behavior is
from the cited anchor.

### Model / effort / thinking control

| Var | Effect | Anchor |
| --- | --- | --- |
| `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` `[VM]` | Bypass the per-model effort allowlist (effort is otherwise limited to fable-5/mythos-5/opus-4-8/opus-4-7 + select models). | `if(K8(process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT))return!0` |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` `[VM]` | Stop selecting/routing to `[1m]`-tagged models (for proxies/gateways without 1M support). | `function yzq(){return K8(process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT)}` |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` `[VM]` | Suppress adaptive (extended) thinking even on supporting models (opus-4-6/sonnet-4-6). | `K8(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING)&&(X.includes("opus-4-6")||…)` |
| `CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP` `[VM]` | Disable silent old-alias→canonical-ID remap; send the exact model string. | `function wlq(){return!K8(process.env.CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP)}` |
| `CLAUDE_CODE_BG_CLASSIFIER_MODEL` `[VM][ASAR]` | Override the model for the bg classifier/summarizer (post-turn summaries → Cowork Desktop). | `CLAUDE_CODE_BG_CLASSIFIER_MODEL:()=>nVO` (`nVO=mq.str()`) |
| `CLAUDE_CODE_AUTO_MODE_MODEL` `[VM][ASAR]` | Override the model auto-mode selects. | `CLAUDE_CODE_AUTO_MODE_MODEL:()=>lVO` |
| `ANTHROPIC_DEFAULT_FABLE_MODEL` (+ `_NAME`, `_DESCRIPTION`, `_SUPPORTED_CAPABILITIES`) `[VM][ASAR]` | Fable-5 model-family override quartet, matching the existing OPUS/SONNET/HAIKU pattern; in the managed-settings propagation allowlist (`T88`), so org policy → subagents. | `if(process.env.ANTHROPIC_DEFAULT_FABLE_MODEL)return…` |

### Cowork / background-session runtime

| Var | Effect | Anchor |
| --- | --- | --- |
| `CLAUDE_CODE_ENVIRONMENT_KIND` `[VM][ASAR]` | Deployment-type tag: `byoc` (bring-your-own-cloud), `anthropic_cloud`, `bridge`. Drives the classifier-summary surface map; `byoc` adds `ccr` to the surface set; `bridge` adds `bridge`. | `function O36(){…q==="byoc"||q==="anthropic_cloud"…}` |
| `CLAUDE_CODE_BYOC_ENABLE_DATADOG` `[VM]` | Under `ENVIRONMENT_KIND=byoc`, Datadog is suppressed unless this is also set. | `function Sb_(){return …==="byoc"&&!K8(process.env.CLAUDE_CODE_BYOC_ENABLE_DATADOG)}` |
| `CLAUDE_CODE_WORKER_EPOCH` `[VM][ASAR]` | CCR worker epoch (int) the host passes in; stale-`end_session` guard (a `reason:"archived"` end_session is ignored when epoch>1). Missing/NaN → `missing_epoch`. | `e=u?parseInt(u,10):NaN; if(isNaN(e))throw new T2A("missing_epoch")` |
| `CLAUDE_CODE_WORKSPACE_HOST_PATHS` `[VM][ASAR]` | Pipe-separated host folders the desktop injects (`userSelectedFolders.join("|")`); the agent emits them as `workspace.host_paths` telemetry. | `CLAUDE_CODE_WORKSPACE_HOST_PATHS:i.userSelectedFolders.join("|")` |
| `CLAUDE_BG_CLAIM_AUTH`, `CLAUDE_BG_SOCKET_TOKENS_PATH`, `CLAUDE_BG_RV_AUTH`, `CLAUDE_BG_PTY_AUTH` `[VM]` | The bg/Cowork auth handshake: claim/socket-tokens carry host→worker auth; RV/PTY carry rendezvous- and PTY-socket tokens. **All deleted from `process.env` immediately after read (single-use).** Complement `CLAUDE_BG_RENDEZVOUS_SOCK` (L89). | `let q=j8.CLAUDE_BG_CLAIM_AUTH;delete process.env.CLAUDE_BG_CLAIM_AUTH;…` |
| `CLAUDE_BG_STARTUP_WEDGE_MS` `[VM]` | Startup-watchdog timeout (default 45000); fires → kill the hung bg worker. | `Number(process.env.CLAUDE_BG_STARTUP_WEDGE_MS)||45000` |
| `CLAUDE_COWORK_MEMORY_INDEX_CONTENT` `[VM]` | Inject the Cowork memory index as a raw string (non-empty = use directly; empty = disable; unset = file path). Sibling of `CLAUDE_COWORK_MEMORY_GUIDELINES` (L90). | `let D=process.env.CLAUDE_COWORK_MEMORY_INDEX_CONTENT;if(D!=="")…` |

### Auth / security / isolation

| Var | Effect | Anchor |
| --- | --- | --- |
| `CLAUDE_CODE_ENABLE_XAA` `[VM][ASAR]` | Gate the **XAA (Cross-App Authentication, SEP-990)** OIDC flow for MCP OAuth: enables `xaaIdp` config + the `--xaa` mcp flag; without it, any `oauth.xaa` server config throws. | `if(!s7q())throw Error(\`XAA is not enabled (set CLAUDE_CODE_ENABLE_XAA=1)…\`)` |
| `CLAUDE_TRUSTED_DEVICE_TOKEN` `[VM]` | Inject a trusted-device token directly, skipping proactive enrollment. | `[trusted-device] CLAUDE_TRUSTED_DEVICE_TOKEN env var is set, skipping enrollment` |
| `CLAUDE_CODE_DONT_INHERIT_ENV` `[VM]` | Bash-tool subprocesses get an empty base env (only `SHELL`/`GIT_EDITOR`/`CLAUDECODE=1`) instead of inheriting `process.env` — hermetic shell. | `env:{...process.env.CLAUDE_CODE_DONT_INHERIT_ENV?{}:av(),SHELL:q,…}` |

### Agent SDK integration `[VM][ASAR]`

| Var | Effect |
| --- | --- |
| `CLAUDE_AGENT_SDK_CLIENT_APP` | Appended as `client-app/<val>` in User-Agent / `x-app`. |
| `CLAUDE_AGENT_SDK_VERSION` | Appended as `agent-sdk/<val>` in User-Agent. |
| `CLAUDE_AGENT_SDK_MCP_NO_PREFIX` | Suppress the tool-name prefix for MCP tools on `sdk`-type connections. |
| `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS` | With the multi-agent fork gate, returns an empty built-in-agents list. |

### Workflow / plan / compaction / misc

| Var | Effect | Anchor |
| --- | --- | --- |
| `CLAUDE_CODE_PLAN_V2_AGENT_COUNT` / `_EXPLORE_AGENT_COUNT` `[VM]` | Override Dynamic-Workflow (plan-v2) main / explore parallel-agent counts (default tier-based: enterprise/team→3 else 1). | `parseInt(process.env.CLAUDE_CODE_PLAN_V2_AGENT_COUNT,10)` |
| `CLAUDE_CODE_COLD_COMPACT` `[VM]` | Trigger cold compaction (discard whole in-flight conversation) vs normal summary-preserving autocompact. | `function L_7(){return K8(process.env.CLAUDE_CODE_COLD_COMPACT)}` |
| `CLAUDE_AFTER_LAST_COMPACT` `[VM]` | Append `{after_last_compact:true}` to the skill/plugin-registry API query (skill sync after compaction). | `K8(process.env.CLAUDE_AFTER_LAST_COMPACT)?{after_last_compact:!0}:void 0` |
| `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` `[VM]` | Three-way toggle for Git guidance in the system prompt (truthy=off, falsy-string=force-on, unset=policy). | `function iA8(){…CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS…}` |

### Desktop-only (`[ASAR]`; filtered out of the VM agent env)

| Var | Effect | Anchor |
| --- | --- | --- |
| `CLAUDE_AI_URL` | Override the claude.ai base URL (staging/localhost detection); explicitly stripped before spawning the agent (`if(a==="CLAUDE_AI_URL")continue`). | `process.env.CLAUDE_AI_URL||Ac().claudeAiUrl` |
| `CLAUDE_EXTRA_HEADERS_TOKEN` | Signed JWT (verified against an embedded public key) that injects extra HTTP headers into API requests; rejected → `console.warn`. | `function $Br(){const A=process.env.CLAUDE_EXTRA_HEADERS_TOKEN;…}` |
| `CLAUDE_UPDATER_TOKEN` | Signed JWT overriding the auto-updater config (server URL/channel). | `function VBr(){const A=process.env.CLAUDE_UPDATER_TOKEN;…}` |
| `CLAUDE_DESKTOP_LOCAL_FRAME_SHELL` | `=1` enables the local-frame-shell render path (embedded webviews; alters link-click + CSP for sub-frames). | `if(process.env.CLAUDE_DESKTOP_LOCAL_FRAME_SHELL!=="1")return null` |

## Part B — production GrowthBook gates (decoded from the live `fcache`)

The desktop reads gates via `dt(id)` (→ `.on`) and `Qn(id,key,default)` (→ sub-keys), seeded from
`/api/desktop/features` and disk-cached at `userData/fcache` (`CLF` magic + gzip). All states below are
**this installation's snapshot** (standard interactive Anthropic account, 2026-06-13). `source:"force"`
= server-forced override, not a local experiment.

| Gate | State | What it controls |
| --- | --- | --- |
| `1143815894` | **on** (force) | **Host-loop** (Ch20/L89). `f_()`→`cPt()`→`dt(this)`. Production = host-loop. |
| `3045399524` | **on** (force) | **Fable model allow** — `{enabled:["claude-fable-5[1m]","claude-fable-5"],alwaysLoad:true}`; whitelists claude-fable-5 (+1M) as selectable in Desktop. |
| `583857784` | **on** (force) | **Bridge transport SDK adapter** (`Dfn`) — Cowork sessions use the SDK-based transport (`Bfn`) instead of the legacy CCR HTTP transport (`Rfn`). Current production transport path. |
| `1978029737` | **on** (force) | **Cowork runtime multi-key config** — `sessionsBridgePollBlockMs:30`, `coworkNativeFilePreview:true`, **`coworkWebFetchViaApi:true`**, **`coworkWebFetchPrompt:true`**, `workspaceBashWaitLonger:true` (+ skillsSync/idleGrace/timeouts). Master Cowork tuning gate. |
| `1648655587` | **on** (force) | **Task dispatch rate-limiter** — `{perTask:1, global:3}`. A dispatch session launches ≤1 sub-task; ≤3 concurrent globally. A real throughput ceiling on Cowork task dispatch. |
| `1893165035` | **on** (force) | **Auto-retry error categories** — `categories:["api_prompt_too_long","process_already_running","api_model_not_found","api_request_too_large"]`. Note `api_model_not_found` is auto-retried (can mask model unavailability). |
| `2340532315` | **on** (force) | **Plugin sync ("sparkplug")** — startup `syncPlugins()`, per-session manifest load, enabled-state backfill. OFF → `enabled_state_source:"sparkplug-off"`. Master Cowork-plugin gate. |
| `2392971184` | **on** (force) | **`/rc` alias + replay-user-messages** — registers `/rc` for `/remote-control`, adds `replay-user-messages` to spawn extraArgs, expands OAuth scope `user:sessions:claude_code`. |
| `2940196192` | **on** (force) | **coworkArtifacts** — artifact `getAllWithDiskStatus()`, `askClaude()` inference, the artifacts tool list. |
| `123929380` | **off** (default) | **coworkKappa** — a named Kappa skill variant + project-mounting for non-session-typed clients; off for the standard client. |
| `2307090146` | **off** (default) | **`cli_plugin`** broker (Ch23/L106). Confirmed off for the standard interactive account (force-on only for the `3p`/CCD class via the `Vdr` map). |

## Part C — the extended control-protocol surface

Beyond Ch22/L105's dispatcher subtypes (`initialize`, `can_use_tool`, `hook_callback`, `mcp_message`,
`elicitation`, `oauth_token_refresh`, `host_auth_token_refresh`) and Ch24/L107's
`mcp_call`/`register_repo_root`/`request_user_dialog`/`stage_file`/`end_session`, these are also verified:

### Additional request subtypes

| Subtype | Direction | Purpose |
| --- | --- | --- |
| `get_session_cost` | host→VM | Fetch the remote container's formatted session cost (same text `/usage` prints) so a thin client shows real cost, not `$0.00`. |
| `get_binary_version` | host→VM | Returns `{version, buildTime}` so `/version` in `--remote` mode shows both client and remote CLI versions. (This bundle embeds `version:"2.1.170"`, `buildTime:"2026-06-09T15:09:09Z"`.) |
| `generate_session_title` | VM↔host | LLM-driven session titling: `{description, persist?}` → `{title}`. |
| `ultrareview_launch` | host→VM | Control-channel entry point for `/ultrareview`: `{args, confirm}` → injects the command + a session-URL status message; graceful fallback if blocked. |
| `side_question` | VM→host | Free-form inline question → `{response, synthetic}` (`synthetic:true` when auto-accepted). |

### New `type:"system"` message subtypes (emitted by the VM into the output stream)

`elicitation_complete` (`{mcp_server_name, elicitation_id}` — URL-mode elicitation done), `files_persisted`
(`{files:[{filename,file_id}], failed:[…], processed_at}` — companion to `stage_file`),
`local_command_output` (`{content}` — slash-command output piped through the SDK stream, e.g. `/voice`,
`/usage`), `api_metrics` (`{ttft_ms, otps, …}` — per-turn latency), `thinking` (`{content}` — rendered
thinking text). The headless output filter skips `elicitation_complete`/`files_persisted`/
`local_command_output` (alongside `hook_progress`/`hook_response`/`commands_changed`).

### Dispatcher classification sets (verbatim)

- **Blocking** (block message processing while in-flight): `Bv1 = new Set(["interrupt","set_permission_mode","set_model","set_max_thinking_tokens","set_color","mcp_toggle","message_rated"])` — note `set_color` and `mcp_toggle` are blocking.
- **Async-park** (handled out-of-band): `Uv1 = new Set(["can_use_tool","request_user_dialog","elicitation"])` — `request_user_dialog` (L107) is the third member, with a ~6 s auto-cancel and five `tengu_request_user_dialog_*` telemetry events.
