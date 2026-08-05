---
domain: cowork-permissions
title: Cowork permission stack (current)
as_of_cli: 2.1.221
as_of_desktop: 1.22209.0
sources: [89, 107, 108, 109, 115, 121, 122, 124, 128]
updated: 2026-07-17
---

# Cowork permission stack (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter).

## The layers (all simultaneously active, host-loop production)

1. **`--allowedTools` pre-approval** at spawn. `--allowedTools <built-ins>`
   pre-approves specific tools at process start — this, not a blanket
   auto-allow, is why some tools "just run" even under `default` permission
   mode. In host-loop, `WORKSPACE_ALLOWED_TOOLS = [mcp__workspace__bash]`
   (`w5e=[lae]`) pre-approves **bash only** — `mcp__workspace__web_fetch`
   is aliased (layer 2) but **not** pre-approved; it still flows through
   `canUseTool` like any other tool.

2. **Host-loop tool partition** — a set of constants (renamed and now
   **exported unminified** as of 1.20186.1/2.1.205, successors of the
   L107-era `gre`/`PNt`/`BDt`/`QDt`) that shape which built-in tools the
   host-side agent even offers:
   - `p5e` = `HOST_LOOP_EXCLUDED_BUILTIN_TOOLS` = `[Bash, NotebookEdit, REPL,
     JavaScript, WebFetch]` — dropped from the host-side allowed set entirely.
   - `h5e` = `HOST_LOOP_SAFE_BUILTIN_TOOLS` (Task + the `TaskCreate/Update/
     Get/List/Stop` family + Glob/Grep/Read/Edit/Write/WebSearch/Skill/
     AskUserQuestion/ToolSearch/SendUserMessage/Projects).
   - `g5e` = `[Read, Write, Edit, Glob, Grep]`, the path-gated set (layer 4
     below; `MultiEdit` is appended separately at the hook matcher, not
     part of `g5e` itself).
   - **`toolAliases`** (new first-class SDK spawn option, replacing the ad
     hoc `BDt`/`QDt` injection): `{Bash:"mcp__workspace__bash",
     WebFetch:"mcp__workspace__web_fetch"}` in host-loop. Single-hop
     resolution (`rc()`) when the model emits a `tool_use` named `Bash`/
     `WebFetch`. Deny rules on `Bash` deliberately do NOT expand to deny
     `mcp__workspace__bash` (`tXn`).

3. **Desktop-side PreToolUse `hooks` option** built in app.asar at spawn
   time (REAL — re-confirmed v2.17.2 after being wrongly overturned once).
   Passed as the `hooks` option when the local-agent session is spawned, so
   it is invisible to any grep of the CLI/in-VM agent bundle — it never
   lived there. Four matchers:
   - **`Task` matcher** blocks any call whose `tool_input.run_in_background`
     is truthy (`decision:"block", reason:"Background agents disabled"`);
     otherwise it emits `subagent_invoked` telemetry. This is a *second*,
     independent block from layer 5 below — Desktop-injected, `Task`-only,
     unconditional.
   - **`Skill` matcher** fires `skill_invoked` telemetry (plugin/marketplace
     attribution), can inject `additionalContext`, and fires
     `cowork_consolidate_memory_called` for the memory-consolidation skill.
   - **Joined-name matcher forces `permissionDecision:"ask"`** for 9
     `mcp__cowork__*`/scheduled-task tools, unconditionally — even under
     `--allow-dangerously-skip-permissions` — with reason *"This tool
     requires explicit approval regardless of permission mode."* The set:
     `Abt = [RrA, AQ, l0A, hv]` →
     `mcp__cowork__allow_cowork_file_delete`,
     `mcp__cowork__request_cowork_directory`,
     `mcp__cowork__launch_code_session`,
     `mcp__cowork__save_skill`; plus `EV`/`dV`/`Oue`/`xue` →
     `MCP_CREATE_SCHEDULED_TASK`/`MCP_UPDATE_SCHEDULED_TASK`/
     `MCP_START_WATCHING`/`MCP_STOP_WATCHING`, and a 5th scheduled-tasks
     name added at 1.20186.1, `MCP_DELETE_SCHEDULED_TASK` (the scheduled-
     tasks server). The set has grown with Cowork's feature surface: a
     pre-scheduled-tasks capture (app.asar 1.12603.1) recorded 5 names;
     1.17377.2 had 8; the live 1.20186.1 binary has 9.
   - **`mcp__.*` matcher** — a generic MCP-tool gate via `wjt(session,
     tool_name)`; a `"block"` decision short-circuits before the tool runs.

4. **Path-gating PreToolUse hook** (re-anchored at 1.20186.1: now lives in
   `configureHostLoopExecution`/`et` within `index.chunk-CS-g0Skn.js`, VM-
   path deny `xe()`, read-only-root writes `qt()` — the unminified export
   names `HOST_LOOP_PATH_GATED_BUILTIN_TOOLS`/`configureHostLoopExecution`
   are the stable sync sentinels, not byte offsets; successor of the
   L107-era `IeA`/`vZe`/`Nen`). Matcher: `Read|Write|Edit|Glob|Grep|
   MultiEdit` (`g5e` + `MultiEdit` appended at the hook, not in `g5e`
   itself). `/sessions` (exact or prefix) is **denied, not translated** —
   `xe()` checks membership in `g5e` only (no `MultiEdit`), so a
   `/sessions/...` `MultiEdit` skips the friendly VM-path message but is
   still blocked by containment. **Allow-roots**: hostCwd, hostOutputsDir,
   hostUploadsDir (read-only for mutating tools), `.claude/projects` +
   staged-config projects (read-only, spooled tool results),
   autoMemoryHostDir, skillsPluginPath, readOnlyPluginPaths (read-only),
   `additionalDirectories` (connected folders), plus live connected
   folders and, for **non-mutating tools only**,
   `getMidSessionReadOnlyPaths()`. **`qt()` is a 3-category write-block**
   for `Jt=[Write,Edit,MultiEdit]`: uploads (hardlink — "writing here
   would overwrite it on their disk"), spooled projects ("read-only in
   this session (spooled tool results)"), and plugin/skill/knowledge
   content ("read-only in this session (plugin, skill, or knowledge
   content)"). Outside all roots → blocked, with a pointer to
   `request_cowork_directory`. **Second enforcement layer**:
   `canUseTool=async(g,S,k)=>xe(g,S)??Qt(g,S,...)??Se(g,S,k)` — a
   conditional wrapper (`Se&&`) that still funnels through the same
   `/sessions/` deny even on a hook bypass. This exists because host-loop
   Cowork is **one shared scratch space with two path namespaces, not two
   filesystems**: the host-loop system prompt tells the model every call
   starts in "the same scratch space the Read/Write/Edit tools use," just
   seen at a different absolute path from the VM shell
   (`mcp__workspace__bash` sees it at `/mnt/outputs`). The fix for a
   denied path is the prompt's own guidance — bare/relative filenames —
   not routing everything through bash. **Confirmed to apply to
   sub-agents identically to the main thread**: hooks are registered
   process-globally with no subagent exclusion, and the hook-input schema
   documents `agent_id` as the subagent discriminator (present only
   inside a subagent tool call) — see `cowork-architecture.md`'s
   "Sub-agent execution" section.

5. **CLI speculation-engine `run_in_background` abort** for `Ih` = [Bash,
   PowerShell] only — independent of layer 3's `Task` block. Two separate
   mechanisms, both real, both currently active.

6. **Session rules** via `CLAUDE_BG_SESSION_PERMISSION_RULES`.

7. **Per-mount delete approval** — `fileDeleteApprovedMounts` is a real
   per-mount set on the session object, **recomputed per bash call**
   (`computeBashMounts`), not cached once. Mounts default to `rw` (write,
   no delete) and become `rwd` only once their mount name is added to
   that set, which happens when the user approves an
   `allow_cowork_file_delete` request (one of the 9 tools forced to `ask`
   in layer 3 — see `cowork-control-protocol.md`'s "Sub-agent dispatch
   wire contract" for the current count). **Bridge sessions never get
   `rwd`**, regardless of approval state. Applies identically to
   host-loop bash mounts and VM-loop mounts.

8. **Explicit `tools:` list at spawn — subagent resume severed** (L115).
   The Desktop passes an explicit `tools:` array (and matching
   `allowedTools:`) that omits `SendMessage` — the CLI's resume path for
   completed background agents (don't confuse it with `SendUserMessage`,
   which IS present for brief sessions). Combined with
   `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` in the same spawn env (strips
   `run_in_background` from the Task schema → subagents run synchronously)
   and layer 3's `Task` hook, a Cowork model cannot continue a completed
   subagent at all: redo/repair dispatch with a fresh agent is the only
   continuation primitive. In the standalone CLI the same binary resumes
   completed agents via `SendMessage({to: <agentId>})`
   (`resumeAgentBackground`, transcript reload, `resumedAgentId`).

`--allow-dangerously-skip-permissions` is a **capability grant**; mode
stays `default` (auth is layered on top, not replaced). Without
`--permission-prompt-tool stdio` at spawn, `AskUserQuestion` is silently
auto-dismissed and scripted answers never fire.

## Auto-mode tuning at Desktop 1.22209.0 (lesson 128, no live gate-state capture)

Three new gate ids extend auto-mode, found in a code diff only — **no live
fcache decode was performed for this pass**, so treat these as
"exists in code, logic as documented" rather than a confirmed production
on/off state:

- **`4200321681` (`coworkAutoModeAlwaysAllowOverride`)** backs the
  advertised capability `tool_approval_default_always_allow`. Read the
  name skeptically: the logic (`KSt`/`autoModeOverridesAlwaysAllow`) is
  the *inverse* of what it suggests — under `permissionMode==="auto"` it
  forces a **re-prompt** (not a silent allow) specifically for destructive
  connector/MCP tools (`isDestructiveConnectorTool`), and a sibling guard
  (`oBn`) strips `updatedPermissions` so "always allow" can never be
  **persisted** for `computer:request_access`, `computer:
  request_teach_access`, or cowork tools. Net effect: auto-mode's
  blanket convenience gets a permanent carve-out for the risky class, not
  a loosening of it.
- **`1447478638` (`scheduledTaskToolsApprovableByAutoMode`)** — lets
  scheduled-task tools be auto-approved under auto mode too (unless
  `isMdmAutoModeDisabled`).
- **`1076115445` (`tryBeginSleepAutoResume`)** — session sleep/auto-resume;
  paired with new stop-button telemetry
  (`lam_stop_button_received`/`_completed`,
  `LocalAgentModeSessions.stop`).

Also new: folder-grant hardening refuses managed paths and a shell dotfile
set (`.zshrc .zshenv .zprofile .zlogin .bashrc .bash_profile .bash_login
.profile .netrc`) outright, with new telemetry
`lam_folder_grant_refused_protected` — previously a user could grant a
folder containing these without an explicit block. Full detail: Chapter
36 / lesson 128.

## Not part of the stack (adjacent, don't conflate)

- The host↔VM MCP-server split is a **credential/execution** boundary, not
  a permission layer: stdio servers in `claude_desktop_config.json` run
  host-side with full host env; `mcp__workspace__bash`/`web_fetch` run
  sealed in the VM. `mcp__workspace__web_fetch` genuinely routes host-side
  to `POST /api/organizations/<org>/cowork/web_fetch`.
- `${CLAUDE_PLUGIN_ROOT}` resolves to one value host-side
  (`claude-hostloop-plugins/<hash>`) — accepted by host file tools, but
  useless to in-VM bash, which must use the VM-mounted plugin path instead.

## Known past errors (do not re-introduce)

- **"No 5-tool forced-ask hook" (v2.15.0)** — WRONG. A re-verification pass
  grepped only the CLI/in-VM agent bundle and wrongly retracted the claim;
  the config is Desktop-side (app.asar), passed as the `hooks` spawn
  option, and was never going to appear in that bundle. Re-confirmed live
  against 1.17377.2, independently cross-checked against a third-party
  binary capture. See L107 methodology note.
- **"`--setting-sources=user` excludes plugin-scoped hooks in Cowork"** —
  WRONG. Plugin hooks DO fire in Cowork (host-loop symlink staging); the
  real determinant is the **three-root plugin namespace** — a desktop
  Cowork session reads only
  `local-agent-mode-sessions/<acc>/<org>/cowork_plugins/cache` (+`rpm/`),
  which the standalone-CLI `--cowork` install does not reach. Install via
  the Cowork app UI (or org-remote/RPM) to land in the namespace a real
  session reads.
- **"Cowork ignores `--mcp-config` outright"** — overbroad. The drop only
  fires under `I5()` (safe mode) or `xB8()` (hermetic-remote: both
  `CLAUDE_CODE_REMOTE` and `CLAUDE_CODE_REMOTE_HERMETIC_MODE`). A plain
  `SESSION_KIND=bg` Cowork session does not by itself trigger the drop.
