Updated: 2026-10-07 | Source: **Claude Desktop `app.asar` 2.26454.0 diffed against 2.16120.0 and 2.19675.0** (all three builds read; staged agent 2.1.289), the **live GrowthBook cache decoded on 2026-10-07** (398 features), and the 2026-09-27 cache snapshot for served-value comparisons. The UI bundle (`ion-dist`) exists only for the installed build, so nothing here is claimed as a UI-bundle change.

# Chapter 61: Desktop 2.26454.0 — Spawn Environment, Scheduled Tasks in Auto Mode, and Gates Switched Off

---

## TABLE OF CONTENTS

222. [Lesson 222 — What Desktop 2.26454.0 Changed for Cowork](#lesson-222--what-desktop-2264540-changed-for-cowork)

---

# LESSON 222 — WHAT DESKTOP 2.26454.0 CHANGED FOR COWORK

**Desktop 2.26454.0 stops two shell settings from reaching a Cowork session. Since 2.19675.0, a scheduled task created from a Cowork session starts in Auto permission mode where the organization allows it. On 2026-10-07 the server switched off the cloud memory relay and the Computer Use permission gate, though the code that reads both is unchanged. The rules that decide whether a new task runs locally or in the cloud did not change.**

## Two shell settings no longer reach Cowork

The main Cowork spawn environment gains two pinned values:

```
CLAUDE_CODE_SIMPLE:"0", CLAUDE_AGENT_SDK_MCP_NO_PREFIX:"0"
```

Both names are also added to the list of variables Desktop removes from the inherited environment before it applies its own values. That is the same list that already removes `PATH`, `CLAUDE_CODE_OAUTH_TOKEN` and the API-key and auth-header variables. Before 2.26454.0, a user who exported either variable in a shell that launched Desktop passed it through. `CLAUDE_CODE_SIMPLE=1` replaces the system prompt and tool set with a minimal one (L86). `CLAUDE_AGENT_SDK_MCP_NO_PREFIX=1` drops the `mcp__<server>__` prefix from MCP tool names, which would stop every `mcp__workspace__*` binding and the `mcp__.*` permission matcher from matching. The agent (2.1.289) still reads `CLAUDE_CODE_SIMPLE`; only Desktop's handling changed. The code shows what changed. That Desktop did this to fix leaked settings is an inference.

## Scheduled tasks created from a session start in Auto mode

From 2.19675.0 the scheduled-task bridge asks the active session for `newTaskPermissionMode`. The answer is Auto when all of these hold:

- the session is not a dispatch child,
- the deployment is not third-party,
- the account is first-party,
- the organization's `coworkAvailablePermissionModes` includes `auto`,
- kill switch `4175783504` is off.

Otherwise no mode is set and the task keeps the old default. `4175783504` is not in the 2026-10-07 cache. An unserved gate reads as off here, so Auto applies wherever the other conditions hold. This was read from the code and has not been tested live. The same bridge gives the model the task's file path as `/sessions/<id>/mnt/.scheduled/<taskId>/SKILL.md`.

## Escalated asks in unattended turns

`canUseTool` now routes a tool ask through an escalation step that knows whether the session's own turn, or its parent's for a dispatch child, is unattended. Each escalated ask is logged as `lam_escalated_tool_ask` with outcome `card` (shown to the user) or `unattended_deny`. A new kill switch, `3285376524`, takes part in the decision. It is not in the 2026-10-07 cache. How the escalation step uses the kill switch was not traced.

## Control protocol

Three request subtypes are new: `get_task_output` (`{subtype, task_id}`, sent by Desktop's `getTaskOutput`), and `ui_client_fault` and `ui_prompt_edit`, which are reports from the Claude Code desktop UI. None was removed. The forced-ask PreToolUse matcher is unchanged at nine tools: the four `mcp__cowork__` tools plus create, update and delete scheduled task and start and stop watching. The `Task`, `Skill` and `mcp__.*` hooks are unchanged too.

## Gates the server switched off on 2026-10-07

| Gate | 2026-09-29 | 2026-10-07 | Consumer in 2.26454.0 |
|---|---|---|---|
| `946844604` (cloud memory relay, L194) | on, force | off, default | unchanged: the relay is installed only while the gate is on; the binder answers `flag_off` |
| `2486083521` (`cuCanUseToolEnabled`, L148) | on, force | off, default | unchanged expression; with it off, `canUseTool` skips the Computer Use permission branch |

No code was removed for either change. With the relay off, the `memory` SDK-MCP server is not installed and is not added to `deniedMcpServers`, so a server named `memory` in `claude_desktop_config.json` runs again.

Served values that moved between the 2026-09-27 and 2026-10-07 caches:

- The migration sweep (`2974609625`, L208) now runs every 30 minutes instead of every 60, with a 15-minute cooldown after a failure instead of 30.
- Cowork's model allow-list (`3045399524`) adds `claude-sonnet-5-5` and its `[1m]` variant.
- In experiment bundle `364911507`, `delegation` and `echo_task_suggestions` are forced to control.

## Gates new in this window

There are 49 new gate ids, most of them for SSH and Claude Code desktop sessions. The Cowork-relevant ones:

- **`3626967935`** (served on): when the user trusts a remote folder, Desktop records that consent in settings, so the folder stays trusted. With the gate off, `browseAndAddTrustedFolder` returns Disabled.
- **Not in the 2026-10-07 cache:** `975160870` (`hostGitConfinedInstall`), `3165386771` (git private index directory) and `480673358` (`CLAUDE_CODE_HOST_WORKTREE_FENCE`), plus the two kill switches above.

One id was removed, `2685067074`, a boot-window latch.

## Local or cloud placement is unchanged

The placement rules, the `cowork-local-tasks-off` rule text and gate `3634338308` (still off) are the same in all three builds. The Personal Max change in L210, where new tasks run in the cloud, therefore did not come from a Desktop placement rule. That fits L210's finding that the claude.ai interface picks the lane.

## For an author

- A shell `CLAUDE_CODE_SIMPLE` or `CLAUDE_AGENT_SDK_MCP_NO_PREFIX` no longer changes a Cowork session's tools. If a harness copies the spawn environment, pin both to `"0"` the same way.
- A scheduled task made from a Cowork session may run in Auto mode, so tool asks you expect to see may be decided by the auto-mode classifier.
- Don't name an MCP server `memory` in `claude_desktop_config.json` anyway. While the relay is off, your server is used, but the gate can come back on and replace it without notice.
- Sonnet 5.5 is selectable in Cowork as of 2026-10-07.
