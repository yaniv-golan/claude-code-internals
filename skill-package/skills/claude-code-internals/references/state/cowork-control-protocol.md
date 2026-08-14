---
domain: cowork-control-protocol
title: Cowork spawn + stream-json control protocol (current)
as_of_cli: 2.1.231
as_of_desktop: 1.30096.1
sources: [105, 107, 108, 109, 118, 119, 120, 121, 123, 124, 129, 130, 152]
updated: 2026-08-14
---

# Cowork spawn + stream-json control protocol (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter). This is the contract to implement if you want to
*drive* the agent faithfully (a headless harness, an SDK integration, any
external driver) — not the Desktop app's internal IPC.

## Spawn contract

- **`CLAUDE_CODE_IS_COWORK=1` is the activation marker** — Cowork mode is
  selected by this env var, not a CLI flag. It gates *mode*, not hook
  discovery; distinguish it from `CLAUDE_CODE_SESSION_KIND="bg"`, the
  separate `/background`-fork axis.
- **The `--cowork` flag is rejected** by the agent invocation
  ("can only be used with user scope") — the SDK passes no `--cowork`.
- **Do not set `CLAUDE_CODE_USE_COWORK_PLUGINS`.** The Desktop never sets
  it. Its only effect is to flip user-settings to `cowork_settings.json`
  and the plugin cache dir to `cowork_plugins/` — files the host never
  populates in a real Cowork session, so setting it silently breaks
  settings + plugin reads. That namespace belongs to the *standalone*
  `--cowork` path, not the Desktop's account/org root (see
  `cowork-architecture.md`).
- **Argv, roughly:**
  `-p --verbose --input-format stream-json --output-format stream-json
  --permission-prompt-tool stdio`
  - `--verbose` is required with `--output-format=stream-json --print`.
  - **`--permission-prompt-tool stdio`** routes `can_use_tool` /
    AskUserQuestion to the driver. Without it, AskUserQuestion is silently
    auto-dismissed and scripted answers never fire.
  - **`--effort medium --max-thinking-tokens 31999`** are explicitly
    **driver-passed** by the Desktop, not agent defaults. The agent's own
    defaults: effort tiers `["low","medium","high","xhigh","max"]` with
    internal default `high` (`xhigh` for opus-4-7); thinking defaults to
    `{type:"adaptive"}` when `MAX_THINKING_TOKENS` is unset. The literal
    `31999` does not appear anywhere in the in-VM bundle — it is purely a
    desktop-passed number. `CLAUDE_EFFORT` as a `process.env` var is a
    no-op.
  - **Full spawn-time resolution mechanism (L120, corrects L114's
    "backed by `CLAUDE_CODE_EFFORT_LEVEL`" claim):** neither knob is
    env-backed at spawn. Extended thinking: `maxThinkingTokens =
    zgi(extendedThinkingEnabled, extendedThinkingOverride, killSwitch)`
    resolves to **exactly `31999` or `0`, never an arbitrary budget**
    (`killSwitch` = a local settings object's `maxThinkingTokens === 0`
    field, used only as an exact-zero flag). Effort: `effort =
    qgi(effortOverride, perModelSetting, flatSettingOrMedium)` — a
    **local settings-file object** (`effort`/`effortByModel` fields),
    with a hardcoded `"medium"` string as the final fallback if unset —
    `CLAUDE_CODE_EFFORT_LEVEL` is real (lesson 93, the CLI's own global
    effort-tier pin) but backs a *different*, non-spawn-path
    `getDefaultEffort()` getter, not this resolver. Per-model effort has
    **four config classes**: literal
    picker models, no-picker models (still emit `--effort medium`), a
    `fable`/`mythos` regex-default class (`disallowThinkingDisabled:
    true` — "Off" isn't offered for these models' thinking picker), and
    unknown models (no config). A live-session toggle calls
    `query.setMaxThinkingTokens(enabled?31999:0)` /
    `query.applyFlagSettings({effortLevel})` — the first concrete
    payload shapes confirmed for `set_max_thinking_tokens` /
    `apply_flag_settings` below. **A second `apply_flag_settings` payload
    shape** (1.28929.0): `applyFlagSettings({permissions:
    {additionalDirectories, allow}})`, used by `grantArtifactDirReadAccess()`
    to push a live, mid-session read-only directory grant under host-loop —
    see `cowork-architecture.md`'s "Mount model and delete policy" section
    for the full artifact-mount-vs-native-tool context this payload serves.
  - Full logged argv also carries `--model …`, `--setting-sources=user`,
    `--permission-mode default`, `--allow-dangerously-skip-permissions`,
    and one `--plugin-dir` per enabled plugin.

## Handshake

- **`initialize` is the first message.** The driver sends
  `{type:"control_request", request_id, request:{subtype:"initialize"}}`
  before the user turn. It also carries `systemPrompt`,
  `appendSubagentSystemPrompt`, `toolAliases`, `hooks`, and
  `sdkMcpServers`.
  - **`appendSubagentSystemPrompt` consumption is env-gated, not just
    option-gated (lesson 123).** The agent only applies the option when
    BOTH `process.env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT` is
    truthy AND `initialize.appendSubagentSystemPrompt` is present. The
    CLI's own self-set helper (`YRp`) that flips this env var on has
    exactly one call site — the hidden `--append-subagent-system-prompt
    <prompt>` CLI flag path — it is **not** invoked by the `initialize`
    handler itself. So a driver that sends the option over `initialize`
    without independently setting the env var in the agent's process env
    gets **no append**; the Desktop covers this by setting
    `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT:"1"` unconditionally in
    every Cowork spawn env. The append applies to **Task sub-agents
    only** (not fork/`useExactTools` dispatches) and **propagates to
    nested sub-agents**. Content itself is `subagent_env_hl`/
    `subagent_env_vm` (see `cowork-architecture.md`), server-overridable
    only when GrowthBook gate `124685897` is on (OFF at the 2026-07-11
    capture — the hardcoded text ships).
  - **`toolAliases`** is a first-class SDK option (new at
    1.20186.1/2.1.205; lesson 121): `{Bash: "mcp__workspace__bash",
    WebFetch: "mcp__workspace__web_fetch"}` in Cowork host-loop. When the
    model emits a `tool_use` whose name is a key in this map, execution
    resolves the mapped name instead (single-hop, no chains) — this is
    now the documented form of the mechanism formerly described only as
    an ad hoc injection (`BDt`/`QDt`, Ch24/L107). Deny rules on `Bash`
    deliberately do NOT expand to deny `mcp__workspace__bash` (`tXn`).
- **The `control_response` envelope is doubly nested:**

  ```json
  {"type":"control_response","response":{"subtype":"success","request_id":"…","response":{ /* payload */ }}}
  ```

  The payload sits under an **inner** `response`. Getting this wrong
  yields `ZodError: expected object, received undefined`.

## Subtype inventory pointer

The registry's `proto.*` entries are the canonical, versioned list of
control-protocol subtypes — do not duplicate that enumeration here. As of
the in-VM ELF 2.1.197, there are roughly 90 `subtype` tokens on the
combined control/transcript protocol, spanning session control, runtime
reloads, tasks/background, checkpointing/recap, scheduled tasks, memory,
model-fallback, and lifecycle/telemetry families. Consult the registry for
the full, current set. The load-bearing ones worth knowing by name:

- **`mcp_message`** (agent→driver) — the agent tunnels JSON-RPC for an SDK
  MCP server out as `control_request{subtype:"mcp_message", server_name,
  message:<jsonrpc>}`; the driver replies
  `control_response{response:{mcp_response:{jsonrpc:"2.0", id, result}}}`.
  The driver **is** the MCP server — it handles `initialize`/`tools/list`/
  `tools/call`. Declare `sdkMcpServers:["workspace"]` in `initialize` to
  connect one (surfaces as `mcp__workspace__bash` etc.).
- **`mcp_call`** (host→VM) — invoke any subprocess MCP tool by
  fully-qualified name (`mcp__server__tool`) through the control channel,
  bypassing the model turn entirely. Its own schema doc states *"No
  permission check (control channel is trusted, same as other
  subtypes)"* — a real trust boundary; SDK-type servers are excluded, this
  targets subprocess MCP clients only.
- **`rewind_files`** (host→VM) — roll files back to a prior user-message
  checkpoint: `{subtype:"rewind_files", user_message_id, dry_run?}`;
  `dry_run` previews without writing. Paired system message
  `file_snapshot` records each checkpoint. Gated by
  `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`
  (killable via `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING`).
- **`register_repo_root`** (host→VM) — add a working-directory root at
  runtime (must be a subdir of cwd), optionally carrying
  `reload_claude_md`/`reload_plugins`/`reload_skills` sub-flags. The
  runtime hook behind multi-repo workflows.
- **`scheduled_task_fire`** (VM→transcript, `type:"system"`) — emitted
  when a Desktop-scheduled cron/watcher task fires a session:
  `{type:"system", subtype:"scheduled_task_fire", content, isMeta:false,
  timestamp, uuid}`. The scheduling and watching itself live entirely in
  the Desktop host (`CoworkScheduledTasks`/`CCDScheduledTasks` IPC); the
  agent only receives and surfaces the fire event, rendered as a dim
  status line in the transcript.

Two dispatcher classification sets are worth knowing verbatim:
- **Blocking** (block message processing while in-flight): `Bv1 = {
  interrupt, set_permission_mode, set_model, set_max_thinking_tokens,
  set_color, mcp_toggle, message_rated }`.
- **Async-park** (handled out-of-band): `Uv1 = { can_use_tool,
  request_user_dialog, elicitation }` — `request_user_dialog` has a ~6s
  auto-cancel.

## AskUserQuestion answer shape

Question input: `input.questions[] = {question, header, options:
[{label, description}], multiSelect}`. To **allow**, reply with
`updatedInput.answers = Record<questionText, chosenLabel>` (schema:
`answers: z.record(z.string(), z.string())`). The model then proceeds with
the chosen answer. This is the over-the-wire answer shape for the same
AskUserQuestion tool documented elsewhere in this skill.

## Per-`tool_use` stream envelope (fixed field set)

The locally-`yield`ed stream-json objects carry a **small, fixed** per-message
field set (first-party, VM ELF 2.1.197 + host CLI 2.1.201): `type`
(`assistant`/`user`), `message`, `parent_tool_use_id`, `session_id`, `uuid`,
`error`, `request_id`, `supersedes` (conditional), and `tool_use_meta`
(conditional). The only per-tool metadata, `tool_use_meta`, is **display-only**:
`{id, display_name, server_display_name?, icon_url?}[]` (MCP tool titles/icons).

**Skill scope is NOT in the stream.** Internally the agent tracks `activeSkill`
and threads an `attribution` bundle —
`c$(querySource, spawnedBySkill, activeSkill, activeMcpServer, activeMcpTool)` —
onto every **outbound API request**, but that quintuple appears on **zero**
`yield`ed stream objects. So a harness reading the stream cannot attribute a tool
call to a skill exactly; for **inline** skills the ceiling is a sticky
"active-skill window" (mirroring the agent's own no-pop `activeSkill`), while
**fork** skills' inner tool calls arrive as `skill_progress`-wrapped messages
carrying `parent_tool_use_id` = the `Skill` call id (exact). See Ch32/L118.

## Sub-agent dispatch wire contract (lessons 121–124)

Extends the fixed per-`tool_use` envelope above with the sub-agent-
dispatch-specific pieces, re-verified against Desktop 1.20186.1 + host/
in-VM agent 2.1.205:

- **`task_started`** (`type:"system"`) carries the **RESOLVED** sub-agent
  type on the wire — `{type:"system", subtype:"task_started", task_id,
  tool_use_id, description, subagent_type, task_type, workflow_name,
  prompt}`. `subagent_type` reflects resolution, including the type-less-
  dispatch fallback to built-in `general-purpose` — a stream consumer
  gets the real agent type without parsing the dispatching `tool_use`
  input. Sibling subtypes in the same emitter family: `task_progress`,
  `task_updated`, `task_notification`, `background_tasks_changed`,
  `thinking_tokens`. See `proto.task_started` in the registry.
- **`permission_denied`** (`type:"system"`) is a native denial-
  attribution event, but for **pre-ask denials only**:
  `{tool_name, tool_use_id, agent_id, decision_reason_type,
  decision_reason, message}`, `agent_id` schema-documented as *"Subagent
  ID when the denied tool call originated inside a subagent."* It fires
  only when `decideLocation==="pre-ask"` — automatic rule/mode/classifier
  denials evaluated before the host is ever asked. It does **not** fire
  for interactive `can_use_tool` asks the host answers deny, and does
  **not** fire for PreToolUse-hook denials (those surface as an
  `is_error` tool_result — see `plugins-skills-hooks.md`'s PreToolUse
  section). No `tool_input`/path field. Practical effect for Cowork: the
  host-loop path-gate hook (`cowork-permissions.md` layer 4) never
  produces this event — treat it as a corroborating signal for pre-ask
  denials, never the sole source of path-denial observability. See
  `proto.permission_denied`.
- **The Agent-dispatch completion envelope** carries the resolved model
  and identity. The completion object itself:
  `{agentId, agentType, content, resolvedModel, totalDurationMs,
  totalTokens, totalToolUseCount, usage, toolStats}`. The on-wire
  `toolUseResult` field on the paired user message carries two more
  wrapper-level additions — production logs show exactly `[agentId,
  agentType, content, prompt, resolvedModel, status, toolStats,
  totalDurationMs, totalTokens, totalToolUseCount, usage]`.
  `agent_progress` messages also carry `resolvedModel`. A stream consumer
  should read `toolUseResult.resolvedModel` for the model a sub-agent
  actually ran on — not the dispatching assistant message's `model`
  field.
- **Force-ask matcher is now 9 joined names**, up from 8 (Ch24/L107,
  Ch25/L108): the scheduled-tasks server gained
  `MCP_DELETE_SCHEDULED_TASK` alongside `MCP_CREATE_SCHEDULED_TASK`/
  `MCP_UPDATE_SCHEDULED_TASK`/`MCP_START_WATCHING`/`MCP_STOP_WATCHING`
  and the four `mcp__cowork__*` tools. Full current table lives in
  `cowork-permissions.md` layer 3.
- **Agent-type sessions (`SESSION_TYPE_AGENT`) get a new
  `mcp__dispatch__*` tool family** for Desktop-mediated **cross-session**
  continuation — distinct from sub-agent resume (severed at spawn, see
  `cowork-permissions.md` layer 8): `mcp__dispatch__send_message` ("Send
  a user message to a local session... use this when the user's message
  is a continuation of an existing session", routes via `e.sendMessage`,
  logs `lam_dispatch_send_message`), `mcp__dispatch__list_projects`, and
  a name-setting tool (`MCP_DISPATCH_SET_AGENT_NAME`) gated behind a
  session-level `dispatchAgentNameEnabled` flag — plus
  `LIST_CODE_WORKSPACES` behind gate `3723845789`. This operates at the
  session level, not the sub-agent level; it does not restore Task-tool
  resume.
- **fcache decode recipe changed.** As of the 2026-07-11 capture the
  on-disk `fcache` is no longer raw JSON: it's a container with magic
  `CLF\x01\x00` + 3 bytes, then a **gzip stream starting at byte 8**
  (observed: 24,863 bytes on disk → 86,779 decompressed, 207 gates).
  Decode with `tail -c +9 fcache | gunzip`. Raw `grep`/`strings` against
  the file — the technique used through v2.26.0 — no longer works and
  will falsely report gates as absent.

## Compaction subtypes

`{type:"system", subtype:"compact_boundary", …, compact_metadata}` fires on
auto/manual compaction — **8 stream-emit producer sites** in 2.1.197 (identical
in 2.1.201). **`microcompact_boundary`** is a distinct subtype string but
**asymmetric: 0 emit sites** — its only two occurrences are a string-table
constant and one Ink TUI renderer case that renders nothing
(`if(subtype==="microcompact_boundary")return null`). So micro-compaction is
**render-only and suppressed, NOT serialized into the stream** on this evidence;
a stream/headless `compaction_occurred` signal should key on `compact_boundary`
(keying on `microcompact_boundary` catches nothing). See Ch32/L118 Part D.

## Cloud tasks: teleport-to-cloud and the bridge-session worker (Ch33/L119)

Two distinct Desktop-hosted mechanisms surfaced from a self-updated Desktop
build turned out to be unchanged infrastructure, not a new feature — IPC
surface diff between Desktop 1.18286.2 and 1.19367.0: **zero interfaces
added/removed, +14/-0 methods, none cloud-task related.**

**`teleportToCloud(sessionId, environmentId)`** re-hosts a local session to
the cloud (not a state stream): `checkReadiness` (remote-session rejection +
OAuth-token presence + clean working tree) → `pushBranch` (progress
`pushing_branch`) → stop the local session → `generateTranscriptSummary`
(progress `generating_summary`) → `POST ${claudeAiUrl}/v1/sessions` (progress
`creating_session`; header `anthropic-beta: ccr-byoc-2025-07-29`) → returns
`{sessionId, title, url, summary}` where `url` is the **absolute**
`https://claude.ai/code/<id>`.

**Bridge-session workers** are a *third* execution role beyond host-loop/
VM-loop (Ch20/L89, Ch24/L107): a process that claims and executes
cloud-hosted work items rather than running the agent loop itself. Both the
Desktop and the CLI agent independently implement a poll/ack/stop client
against `GET|POST /v1/environments/{id}/work/{poll,ack/{id},stop/{id}}`.
**The CLI agent binary itself carries this client** (`pollForWork`/
`acknowledgeWork`/`stopWork`, log-prefix `[bridge:api]`) — this is
`claude remote-control`. Production dispatch ordering: poll → claim → branch
on `work.type`: `"session"` → `handleSessionWork` (spawn/attach a real
Cowork session); `"healthcheck"` → immediate ack, no session created;
unrecognized type → warn and skip. `work_type` is not a closed client-side
enum — just an open string with two currently-meaningful values and
graceful unknown-value handling. A `401`/`403`/`404`/`409` on poll triggers
a bounded number of re-register attempts before the poller gives up
permanently. A newly-vendored (1.19367.0 only) but **unused** SDK helper
pair, `WorkPoller`/`EnvironmentWorker` (`@anthropic-ai/sdk/helpers/beta/
environments`, beta `managed-agents-2026-04-01`), ships alongside this
hand-rolled client with no app-level call site — a dependency-bundling
delta, not a runtime migration.

**`CLAUDE_CODE_ENVIRONMENT_KIND=bridge` is this exact mechanism** — closing
a gap this page (via Ch25/L108) previously left open. `claude
remote-control`'s poller sets the var **itself**, at the point it spawns a
child CLI process to run a claimed `"session"`-type work item (spawn env:
`CLAUDE_CODE_ENVIRONMENT_KIND:"bridge"`, `CLAUDE_CODE_SESSION_ACCESS_TOKEN`,
child argv `--print --sdk-url <url> --session-id <id> --input-format
stream-json --output-format stream-json --replay-user-messages`, worktree
`bridge-<slug>`). **The Desktop never assigns this value** (confirmed: zero
spawn-env assignments in either build). The classifier-summary surface map
(Ch25/L108) ORs *two* independent signals into the `"bridge"` surface —
`CLAUDE_CODE_ENVIRONMENT_KIND==="bridge"` (the env-var path, above) **or**
`replBridgeActive` (a live in-process flag toggled by the SDK-adapter bridge
transport's connection state — `connected`/`ready`→true, `failed`→false —
which is how a Desktop-hosted bridge session reaches the identical surface
without ever receiving the env var). `byoc`/`anthropic_cloud` are sibling
*environment-provider* kinds of the same environments API and feed the
pre-existing `ccr` surface, not `bridge` — don't conflate the three values.

Gate `583857784` (Ch25/L108, "bridge-SDK-adapter transport") is confirmed
the *same* bridge-session concept as this section, not a homonym — its call
chain (`poll → bind → connectSessionTransport → gate check`) is reached
directly from `handleSessionWork`. Gate `1978029737` (Ch25/L108,
cowork-runtime-config) gained a previously-undocumented key,
`sessionsBridgePollIntervalMs`, alongside the already-known
`sessionsBridgePollBlockMs`. The 2026-08-13 fcache re-decode serves this
gate's config object with **11 keys total** (up from the 8 previously
recorded), adding three plugin/skill-sync cadence keys
(`pluginsFullSyncStalenessMs`, `pluginsSyncIntervalMs`,
`skillsSyncIntervalMs`). It also supplies a worked methodology example
(Ch41/L152): the served value for `coworkWebFetchDedupTtlMs` moved from
900000 to 3600000, while the reader's own code-literal default (used only
when the key is *absent* from a served payload) is still 900000 — two
different numbers governing two different code paths; a served-value
change is never grounds for calling the code-literal default stale. See
Ch33/L119 for full grep evidence,
including two items reported as unresolved rather than assumed: no
`heartbeat` request/response pair was located inside the `/v1/environments/
{id}/work` family specifically (a separate, pre-existing `POST
/worker/heartbeat` endpoint exists but its relationship to this call chain
is unconfirmed), and no fully enumerable `work_type` schema was found.

## VCS SDK events + SDK-MCP skill servers (L129/L130)

**Two new `type:"system"` subtypes** replace Desktop's `gh pr create`
regex-scraping: `code_change_published` (emitted by `izr()` on an observed
github PR-create URL) and `vcs_state_changed` (emitted by `hlo()` per observed
commit/push/merge/rebase; `kind` a strict enum agent-side, `"unknown"`-default
on the consumer). Both **emit from agent 2.1.216** (0 at 2.1.215, 12/12 at
2.1.216/2.1.217), are **git-operation-driven, not per-run**, and are **ungated
agent-side** (`1311049725` / `cliSupportsVcsSdkEvents` are Desktop-only, absent
from the CLI). Desktop *consumption* is floored at 2.1.217
(`isPinnedCliAtLeast`), so a 2.1.216 agent + paired Desktop is a one-version
blind window. Full `type:"system"` set (2.1.217): `init`, `status`,
`hook_started`, `hook_progress`, `hook_response`, `post_turn_summary`,
`task_summary`, `background_tasks_changed`, `code_change_published`,
`vcs_state_changed`, `commands_changed`, `elicitation_complete`,
`files_persisted`, `mirror_error`, `model_refusal_fallback`, + nested
`bridge_state`.

**Skill-discovery tools arrive over this same channel:** the `mcp__skills__*` /
`mcp__plugins__*` tools the model actually sees are SDK-MCP servers declared in
`initialize.sdkMcpServers`, tunneled as `control_request{subtype:"mcp_message"}`
— NOT the native `ListSkills`/etc. See `plugins-skills-hooks.md` and Chapter 37
(L129/L130), `references/34-skill-discovery-vcs-events-containment.md`.
