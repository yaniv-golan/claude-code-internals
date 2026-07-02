Updated: 2026-07-02 | Source: **First-party binary extraction & verification.** Every entry below was grepped from the installed **Claude.app (Desktop) `app.asar` 1.17377.2** (main process `.vite/build/index.js`), the staged **in-VM agent ELF `claude-code-vm/2.1.197/claude`** (a Linux/arm64 Bun-SEA bundle, extracted to JS via `extract-bundle.sh`), and the **live on-disk `fcache`** (decoded `CLF\x01` magic + gzip, this installation's snapshot 2026-07-02, a standard interactive Anthropic account). This chapter is the **delta since Ch24/L107 + Ch25/L108** (which were captured at app.asar 1.12603.1 / in-VM ELF 2.1.170). Minified identifiers drift across versions; each claim carries a literal byte anchor. Where a surface exists in the binary but its end-user reachability is gated, that is called out — presence of an IPC interface is not proof of a shipped, ungated UI.

# Chapter 26: Cowork Spaces, Scheduled Tasks, the Tasks Tool & File Checkpointing (app.asar 1.17377.2 / in-VM ELF 2.1.197)

> **What this chapter is.** The Cowork surface moved from a session-runtime story (background/daemon/fleet,
> Ch20/L89–L90) toward a **workspace product**. Two new Desktop IPC interfaces appear that did not exist at
> the Ch24/L107 baseline — **`CoworkSpaces`** (an organizing container for projects/folders/links/remote-sessions
> with per-space auto-memory) and **`CoworkScheduledTasks`** (cron + watcher tasks) — plus an agent-side
> **Tasks tool** family, **SDK file-checkpointing / rewind**, and a much larger stream-json control-protocol
> subtype set. Companion to Ch20/L89 (host-loop/split execution), Ch24/L107 (spawn + control protocol),
> Ch25/L108 (env-var / gate / control-protocol catalog).

> **Version deltas.** Desktop `app.asar` **1.12603.1 → 1.17377.2** (bundled Agent SDK `0.3.197`, Electron
> 42.5.1). In-VM agent ELF **`claude-code-vm/2.1.170` → `2.1.197`**. The exact prior binaries were pruned
> from disk (only 2.1.197 remains), so this diff is against the **documented Ch24/25 baseline**, which is the
> authoritative prior record. All `[binary]` claims below were re-grepped first-party in this session.

---

## TABLE OF CONTENTS

109. [Lesson 109 -- Cowork Spaces, Scheduled Tasks, the Tasks tool & file checkpointing](#lesson-109----cowork-spaces-scheduled-tasks-the-tasks-tool--file-checkpointing)

---

# LESSON 109 -- COWORK SPACES, SCHEDULED TASKS, THE TASKS TOOL & FILE CHECKPOINTING

`[VM]` = in-VM agent ELF `2.1.197`; `[ASAR]` = desktop main process `.vite/build/index.js` (1.17377.2).

## Part A — Cowork Spaces (Desktop IPC, new)

A **Space** is a Desktop-host organizational container that groups **projects**, **folders**, **links**, and
**remote sessions**, with a **per-space auto-memory** dir and **auto-description/summary/classification**. It
is exposed as an Electron `ipc` interface named **`CoworkSpaces`**, registered host-side and reachable from the
claude.ai web view over the same per-build-UUID channels with `senderFrame` trusted-origin validation as every
other Cowork interface (Ch24 established that IPC shape; e.g. `Incoming "addProjectToSpace" call on interface
"CoworkSpaces" from '${r.senderFrame?.url}' did not pass…` `[ASAR]`). This interface **did not exist** at the
Ch24 baseline.

**The 24 validated methods** (each with runtime arg + result validation) `[ASAR]`:

| Group | Methods |
| --- | --- |
| Lifecycle | `createSpace`, `deleteSpace`, `updateSpace`, `getSpace`, `getAllSpaces` |
| Projects | `addProjectToSpace`, `removeProjectFromSpace` |
| Folders | `addFolderToSpace`, `removeFolderFromSpace`, `createSpaceFolder`, `copyFilesToSpaceFolder`, `listFolderContents` |
| Links | `addLinkToSpace`, `removeLinkFromSpace` |
| Remote sessions | `setRemoteSessionSpace`, `removeRemoteSessionSpace`, `getRemoteSessionSpaces` |
| Memory / description | `getAutoMemoryDir`, `readSpaceMemoryIndex`, `setAutoDescription`, `summarizeSpace` |
| Session classification | `classifySessions` |
| File access | `readFileContents`, `openFile` |

Key model facts, from the byte anchors:

- Spaces carry **folders keyed by `folderPath`** `[ASAR]` (`"folderPath"` recurs across the folder methods),
  which is the host-side surface behind the already-documented `CLAUDE_CODE_WORKSPACE_HOST_PATHS`
  (Ch25/L108: `i.userSelectedFolders.join("|")`) — a Space's folder set is what the desktop injects into an
  agent session as pipe-separated host paths.
- **Per-space auto-memory.** `getAutoMemoryDir` / `getAutoMemoryDirForSession` `[ASAR]` return a
  space-scoped memory directory; `readSpaceMemoryIndex` reads its index. This is the Desktop counterpart to
  the agent's `CLAUDE_COWORK_MEMORY_INDEX_CONTENT` / `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` env inputs
  (Part C / Ch25) — the host owns the per-space memory store and hands it to the agent.
- **`classifySessions`** `[ASAR]` sorts existing sessions into Spaces (auto-organization); `setAutoDescription`
  + `summarizeSpace` generate a space's description/summary. These are host-driven LLM helpers, not agent tools.

**Reachability caveat.** The interface and its methods are present and validated in 1.17377.2. The gate that
governs whether the Spaces UI renders (`coworkTabEnabled` and related, see Part F) is a server-side control;
this chapter verifies the *interface contract*, not that a given account sees the tab.

## Part B — Cowork Scheduled & Watched Tasks (Desktop IPC + agent event, new)

A second new interface, **`CoworkScheduledTasks`** (aliased **`CCDScheduledTasks`**) `[ASAR]`, drives
**scheduled** (cron) and **watched** tasks that fire agent sessions on a timer or trigger. Its 9 validated
methods `[ASAR]`:

`createScheduledTask`, `updateScheduledTask`, `getAllScheduledTasks`, `updateScheduledTaskStatus`,
`getScheduledTaskFileContent`, `updateScheduledTaskFileContent`, `getWatcherHistory`,
`clearChromePermissions`, `removeApprovedPermission`.

Model facts from the anchors `[ASAR]`:

- A task is `{ prompt, cronExpression, enabled, … }` — `"cronExpression"`, `"prompt"`, and `"enabled"` are the
  recurring field keys; `"watcher"` marks the watched (trigger-driven) variant, with `getWatcherHistory`
  returning its fire log.
- Tasks carry **Chrome permissions** (`clearChromePermissions`, `removeApprovedPermission`) — a scheduled task
  can drive browser automation, and its granted site permissions are managed here.
- The scheduler is governed by four gate-flag names: `scheduledTasksWakeEnabled` (wake the host to run due
  tasks), `scheduledTaskStaleReapEnabled` (reap stale entries), `coworkScheduledTasksEnabled`,
  `ccdScheduledTasksEnabled` `[ASAR]`.

**Agent-side surfacing.** When a scheduled task fires, the agent emits a `type:"system"` message
`subtype:"scheduled_task_fire"` `[VM]` — `function Vmc(e){return{type:"system",subtype:"scheduled_task_fire",
content:e,isMeta:!1,timestamp:…,uuid:…}}` — which the transcript renderer prints as a dim status line
(`if(n.subtype==="scheduled_task_fire"){…dimColor:!0…}`). So the scheduled-task *scheduling/watching* lives in
the Desktop host; the agent only receives and surfaces the fire event. This is the Cowork-Desktop
first-class UI over the daemon-scheduled routine work from Ch20/L90 (`/schedule` → routines).

## Part C — The Tasks tool & background-task tuning (agent-side, new/expanded)

The agent gains a first-class **task-list tool family** (the deferred `TaskCreate`/`TaskList`/`TaskGet`/
`TaskUpdate`/`TaskStop`/`TaskOutput` tools visible in Cowork sessions), gated by new env:

| Var | Effect | Anchor `[VM]` |
| --- | --- | --- |
| `CLAUDE_CODE_ENABLE_TASKS` | Master gate for the Tasks tool family. `function vv(){if(yl(process.env.CLAUDE_CODE_ENABLE_TASKS))return!1;return!0}` — truthy value enables tasks. | `CLAUDE_CODE_ENABLE_TASKS:()=>ZRu` |
| `CLAUDE_CODE_TASK_LIST_ID` | Pin the persistent task-list id; `function D$(){if(process.env.CLAUDE_CODE_TASK_LIST_ID)return process.env.CLAUDE_CODE_TASK_LIST_ID;…}`. | `CLAUDE_CODE_TASK_LIST_ID:()=>_Pu` |
| `CLAUDE_AUTO_BACKGROUND_TASKS` | Auto-background delay; when truthy, `function Rbm(){…return 120000;}` — long-running work auto-moves to a background task after ~120 s. | `CLAUDE_AUTO_BACKGROUND_TASKS:()=>eOu` |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | Suppresses the `- \`run_in_background: true\` runs the agent as…` hint injected into a tool description; when set, the background-task affordance is hidden. | `!Fe.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS&&!T2()&&…` |
| `CLAUDE_CODE_BG_TASKS_REPORT_RUNNING` | Keeps a session's status as *not idle* while background tasks are running (`hasRunningBgTasks` → status stays live). | `if(n&&Fe.CLAUDE_CODE_BG_TASKS_REPORT_RUNNING)return!1` |

This is the runtime behind the **`tasks_tab` experiment** (Part F), which is force-ON to insiders in the live
`fcache`. Related agent control-protocol subtypes: `background_tasks`, `task_started`, `task_progress`,
`task_updated`, `task_summary`, `task_notification`, `stop_task` (Part E).

## Part D — SDK file checkpointing / rewind & remote recap (agent-side, new)

The agent now supports **file checkpointing with a rewind path** over the control protocol:

| Var / subtype | Effect | Anchor `[VM]` |
| --- | --- | --- |
| `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` | Enable file checkpointing; `function Drm(){return ct(process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING)&&!Fe.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING}`. | `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:()=>QRu` |
| `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING` | Kill switch that overrides the enable flag (see `Drm` above). | (same anchor) |
| `rewind_files` (request) | Roll files back to a prior user-message checkpoint: `subtype:"rewind_files",user_message_id:e,dry_run:t?.dryRun` — `dry_run` previews without writing. | `subtype:"rewind_files",user_message_id:…` |
| `file_snapshot` (system msg) | Records a checkpoint: `subtype:"file_snapshot",content:"File snapshot",level:"info",isMeta:!0,…`. | `subtype:"file_snapshot",content:"File snapshot"` |
| `CLAUDE_CODE_ENABLE_REMOTE_RECAP` | Enables the remote/away recap path (pairs with the `away_summary` subtype, Part E; extends the L101 proactive-away-summary feature to the remote/Cowork surface). | `CLAUDE_CODE_ENABLE_REMOTE_RECAP:()=>XRu` |

## Part E — Extended stream-json control-protocol surface (in-VM ELF 2.1.197)

The 2.1.197 agent carries ~90 `subtype` tokens on the control/transcript protocol — a large growth over the
seven dispatcher subtypes of Ch22/L105, the five spawn-contract subtypes of Ch24/L107, and the `Bv1`/`Uv1`
sets of Ch25/L108. **Complete list** (verbatim `subtype:"…"` / `subtype==="…"` tokens `[VM]`):

```
agents_killed api_error api_retry apply_flag_settings away_summary background_tasks bridge_state
bridge_status can_use_tool cancel_async_message channel_enable claude_authenticate claude_oauth_callback
claude_oauth_wait_for_completion commands_changed compact_boundary elicitation elicitation_complete error
error_during_execution error_max_budget_usd error_max_structured_output_retries error_max_turns file_snapshot
file_suggestions generate_session_title get_binary_version get_context_usage get_session_cost get_settings
get_usage hook_callback hook_progress hook_response hook_started host_auth_token_refresh informational init
initialize interrupt local_command mcp_authenticate mcp_clear_auth mcp_message mcp_oauth_callback_url
mcp_reconnect mcp_set_servers mcp_status mcp_toggle memory_recall memory_saved message_rated mirror_error
model_consent_fallback model_fallback model_refusal_fallback model_refusal_no_fallback notification
oauth_token_refresh permission_denied permission_retry plugin_install post_turn_summary read_file
reload_plugins reload_skills remote_control request_user_dialog rewind_files scheduled_task_fire
seed_read_state session_state_changed set_max_thinking_tokens set_mcp_permission_mode_override set_model
set_permission_mode side_question status stop_hook_summary stop_task submit_feedback success task_notification
task_progress task_started task_summary task_updated thinking_tokens turn_duration turn_starting
ultrareview_launch worker_shutting_down
```

**New relative to the documented (Ch24/L107 + Ch25/L108) sets**, grouped by role:

- **Session control (host→agent, blocking):** `apply_flag_settings`, `set_permission_mode`, `set_model`,
  `set_max_thinking_tokens`, `set_mcp_permission_mode_override`, `get_context_usage`, `get_settings`,
  `get_usage`, `session_state_changed`, `channel_enable`, `cancel_async_message`.
- **Runtime reloads:** `reload_plugins`, `reload_skills`, `read_file`, `commands_changed`, `plugin_install`,
  `seed_read_state`, `mcp_set_servers`, `mcp_reconnect`. (`register_repo_root` from Ch24 now confirms it can
  carry `reload_claude_md` / `reload_plugins` / `reload_skills` sub-flags `[VM]`.)
- **Tasks / background (Part C):** `background_tasks`, `task_started`, `task_progress`, `task_updated`,
  `task_summary`, `task_notification`, `stop_task`.
- **Checkpointing / recap (Part D):** `rewind_files`, `file_snapshot`, `away_summary`.
- **Scheduled tasks (Part B):** `scheduled_task_fire`.
- **Memory:** `memory_recall`, `memory_saved` (the agent surfaces recall/save events to the host — the UI side
  of the L90 memory-write survey).
- **Model fallback family:** `model_fallback`, `model_consent_fallback`, `model_refusal_fallback`,
  `model_refusal_no_fallback`.
- **Lifecycle / telemetry:** `turn_starting`, `turn_duration`, `worker_shutting_down`, `stop_hook_summary`,
  `submit_feedback`, `api_retry`, `thinking_tokens`, `compact_boundary`, `agents_killed`, `file_suggestions`,
  `mirror_error`, `bridge_state`, `bridge_status`, `remote_control`.

## Part F — Production `fcache` gate posture (snapshot 2026-07-02)

This installation's `fcache` decodes to **200 feature gates, 98 ON** (timestamp `1782941899533`). The **eleven
gates documented in Ch25/L108 are all in the same on/off state** (host-loop `1143815894` ON, Fable-model
`3045399524` ON, bridge-SDK-adapter `583857784` ON, cowork-runtime-config `1978029737` ON, task-limiter
`1648655587` ON `{perTask:1,global:3}`, auto-retry `1893165035` ON, sparkplug `2340532315` ON, `/rc`-alias
`2392971184` ON, coworkArtifacts `2940196192` ON; **coworkKappa `123929380` OFF, cli_plugin `2307090146`
OFF** — both now `source:"defaultValue"`). Value/experiment deltas worth noting:

- **Fable is the live Cowork model.** Gate `3045399524` now enables `["claude-fable-5[1m]", "claude-fable-5"]`
  with `alwaysLoad:true` — Claude Fable 5 (with a 1M-context variant) is the production model. (This matches
  the model running this session.)
- **`web_fetch` routes through the API, not the VM.** Cowork-runtime-config `1978029737` carries
  `coworkWebFetchViaApi:true`, `coworkWebFetchPrompt:true`, `workspaceBashWaitLonger:true`,
  `coworkNativeFilePreview:true`. Notably the **in-VM agent itself reads this gate** —
  `xi("1978029737","coworkWebFetchViaApi",!1,…)` `[VM]` — so web_fetch handling is a shared host/agent
  decision, not purely host-side.
- **New force-ON experiment `364911507` → `tasks_tab`.** `{"tasks_tab":{"enabled":true,"split":1,
  "salt":"tasks_v1","insiderForce":"treatment"}, …}` — the Tasks tab (Part C) is force-treatment for insiders,
  dark-launched to the general population. The same experiment bundle also force-treats `echo_unified_login`
  and carries `dismiss_feedback` / `silent_auto_update`.

**Method note (unchanged, restated):** a server-side gate can flip an entire surface; pin the gate *state* per
capture from the live `fcache`, and treat the presence of an IPC interface (Parts A–B) as a contract, not a
shipped UI.

## Part G — Session & log storage layout (host-loop, macOS, on-disk verified)

Where Cowork actually persists sessions, chat transcripts and logs — verified on-disk (macOS,
2026-07-02), not from the binary. Everything lives under `~/Library/Application Support/Claude/`
(session data) and `~/Library/Logs/Claude/` (runtime logs); **not** under `~/.claude/`. Each session is a
**self-contained sandbox directory with its own `.claude` config dir** — which, under host-loop, IS the host
CLI's `CLAUDE_CONFIG_DIR` (reconciling Ch24/L107: `/sessions/<id>/mnt/.claude` is the *VM-loop* path; the
host-loop path is the one below). The session config record carries `"hostLoopMode": true`, corroborating that
the loop runs host-side and writes host-side.

**Session store (the Cowork three-root namespace from L89):**

```
~/Library/Application Support/Claude/local-agent-mode-sessions/
  <accountId>/<orgId>/
    local_<sessionId>.json            # session CONFIG record (metadata, not messages):
                                       #   model, title, systemPrompt (~47KB), hostLoopMode,
                                       #   cliSessionId, cwd, enabledMcpTools, remoteMcpServersConfig,
                                       #   egressAllowedDomains, webFetchAllowedUrls,
                                       #   memoryGuidelinesTemplate, orgCliExecPolicies, emailAddress
    local_<sessionId>/                 # the session SANDBOX directory
      outputs/                         #   the agent's working directory (its cwd)
      uploads/                         #   user-attached files
      audit.jsonl  +  .audit-key       #   signed per-session audit log
      .claude/                         #   the per-session CLAUDE_CONFIG_DIR (host-loop)
        projects/<cwd-slug>/<cliSessionId>.jsonl   # ← THE CHAT TRANSCRIPT
        sessions/
        tasks/<cliSessionId>/1.json,2.json,…       # Tasks-tool state (Part C)
        session-env/<cliSessionId>
        plugins/  backups/  policy-limits.json  mcp-needs-auth-cache.json  .claude.json
```

- **The chat log is a standard Claude Code JSONL transcript** — record `type`s `user`/`assistant`/`attachment`/
  `queue-operation`/`last-prompt`/`mode`, with `message`/`content`/`toolUseResult`/`cwd`/`gitBranch`/
  `parentUuid`/`sessionId`/`version` keys — identical to the `~/.claude/projects/…jsonl` format, just rooted
  in the session's own `.claude`. It is keyed by the **`cliSessionId`** (the host CLI's id), which is distinct
  from the Cowork `<sessionId>`; the two are linked by the config record's `cliSessionId` field.
- The `<cwd-slug>` is the path-slug of `local_<sessionId>/outputs` (the agent cwd), matching the CLI's
  standard project-slug convention.
- A smaller sibling store `~/Library/Application Support/Claude/claude-code-sessions/<accountId>/<orgId>/` also
  holds `local_<sessionId>.json` records (far fewer than `local-agent-mode-sessions`, and not a 1:1 mirror) —
  treat it as a secondary/legacy namespace, not the primary transcript store.
- Top-level `~/Library/Application Support/Claude/cowork-enabled-cli-ops.json` pins the owning `accountId`.

> **VM-side mounts are stood up by the VM image, not the client binaries.** The above is the *host-loop*
> host-side layout. Inside the guest VM, mounts under `/sessions/<id>/mnt/` are created by the VM image's
> **systemd `.mount` units**, which live in `~/Library/Application Support/Claude/vm_bundles/claudevm.bundle/
> rootfs.img` (a ~10 GB raw ext4 image) — **not** in the Desktop `app.asar` or the agent ELF. Verified: skills
> mount at `/sessions/<id>/mnt/.claude/skills` via a systemd unit named
> `sessions-<name>-mnt-.claude-skills.mount` (found verbatim in `rootfs.img`), corroborating the `.claude/skills`
> scheme from a third independent source. **Verification rule:** answer "where does Cowork mount/stage X" by
> grepping `rootfs.img` for the path and for `*.mount` unit names (`LC_ALL=C grep -a -o -m N "<str>" rootfs.img`);
> the agent ELF only shows how skills are *read* (`path.join(root,".claude","skills")`), not how the VM *lays them
> out*. "Absent from the client binaries" is **not** proof of "absent on disk" — the VM-image init stages files
> the client code never names.

**Runtime / debug logs (`~/Library/Logs/Claude/`):**

| File | What it is |
| --- | --- |
| `cowork_host_loop_debug.log` (+ `latest` symlink → it) | The **host-loop agent** debug log (the primary Cowork log). |
| `cowork_vm_node.log`, `cowork_vm_swift.log` | The microVM side (Node guest + Swift host bridge). |
| `coworkd.log` (+ rotated `coworkd.log.1`) | The Cowork daemon. |
| `main.log`, `mcp.log`, `ssh.log`, `mcp-server-<name>.log` | Desktop main process, MCP aggregate + per-server, SSH. |

These are operational logs (status/telemetry lines), **not** conversation content — the messages live only in
the per-session `projects/<cwd-slug>/<cliSessionId>.jsonl`.

### When a transcript is *not* written to disk

The top-level session transcript is written by default, but several conditions suppress it — verified in the
in-VM agent bundle (2.1.197). Ordered by how likely each is to bite in Cowork:

1. **Deliberate opt-out — `--no-session-persistence` / SDK `persistSession:false`.** Option help `[VM]`:
   `"--no-session-persistence","Disable session persistence - sessions will not be saved to disk and cannot be
   resumed (only works with --print)"`. The SDK maps `persistSession:false` → the same flag
   (`if(…persistSession===!1)H.push("--no-session-persistence")`). **Note the `--print` restriction — Cowork
   spawns with `-p` (Ch24), so this flag is applicable to Cowork agents.** Cowork does not currently pass it
   (transcripts exist on disk), but a driver/SDK caller could. It is incompatible with the SDK `sessionStore`
   adapter (`"sessionStore cannot be used with persistSession: false — the storage adapter requires local
   writes to mirror from"`).
2. **Child / sub-agent sessions are ephemeral by default (most Cowork-relevant).** A dedicated
   `CLAUDE_CODE_CHILD_SESSION` path plus the gate `function Xje(){if(Fe.CLAUDE_CODE_FORCE_SESSION_PERSISTENCE)
   return!1;if(!(Fe.CLAUDE_CODE_CHILD_SESSION&&LA()&&!cm()))return!1;return!Iyd()}` `[VM]`, and the override env
   `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` that exists *specifically to force child sessions to persist*. So the
   **parent** Cowork session's chat is written, but agents it spawns — `run_in_background` tasks, Tasks-tool
   children (Part C), `/fork` subagents — are not guaranteed their own resumable on-disk transcript unless
   persistence is forced.
3. **Best-effort write — failures are logged, not fatal.** Session/config writes are wrapped in try/catch that
   log to the debug log and let the agent keep running (`catch{w(\`Failed to stat session file…\`)}`,
   `"Non-fatal: failed to write…"`). So if the target dir is unwritable, the session **works normally while its
   chat silently never lands on disk**. In host-loop that target is the per-session `.claude` above — a
   read-only/misconfigured `CLAUDE_CONFIG_DIR`, a full disk, or bad permissions there produces a silently
   missing transcript with no user-visible error.
4. **`--no-create-session-in-dir`.** A separate flag (`else if(y==="--no-create-session-in-dir")u=!1`) that
   suppresses creating the session file in the project dir at all.
5. **Retention cleanup deletes it after the fact.** The setting `cleanupPeriodDays` — *"Number of days to
   retain chat transcripts before automatic cleanup (default: 30). Minimum 1. …use `--no-session-persistence`
   to disable"* `[VM]`. Write succeeds, then the transcript is reaped later (`0` is rejected because it
   previously silently disabled cleanup).

Lower-level: some internal events carry an `ephemeral:!0` flag (streaming/replay buffers) and are never
persisted — event-level, not the whole chat; `CLAUDE_CODE_JSONL_TRANSCRIPT` is a transcript-format toggle, not
an on/off switch. **Bottom line:** a top-level Cowork chat is missing from disk only if something spawned the
agent with `persistSession:false`, it's a non-force-persisted background/sub-agent child, or the per-session
`.claude` dir couldn't be written (the last fails silently).

---

## Cross-references

- **Ch20 / L89–L90** — Cowork runtime GA, split execution / host-loop, `/schedule` → routines (Scheduled
  Tasks here are the Desktop-UI evolution of that), `CLAUDE_COWORK_MEMORY_GUIDELINES` memory pipeline.
- **Ch24 / L107** — the spawn + control-protocol contract; this chapter extends its subtype set (Part E) and
  its `register_repo_root` reload flags.
- **Ch25 / L108** — the env-var / gate / control-protocol catalog this chapter is the delta against;
  `CLAUDE_CODE_WORKSPACE_HOST_PATHS` (Spaces folders), `CLAUDE_COWORK_MEMORY_INDEX_CONTENT` (per-space memory),
  and the `Bv1`/`Uv1` dispatcher sets.
- **Not new:** `ANTHROPIC_WORKSPACE_ID` appears in the 2.1.197 agent's telemetry
  (`workspace_id:Xb("ANTHROPIC_WORKSPACE_ID")`) but was already documented in Ch21/L86 as the OIDC
  env-quad workspace-disambiguation var — it is *not* the Spaces id.
