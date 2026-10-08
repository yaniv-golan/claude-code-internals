Updated: 2026-10-08 (L223: the plugin-zip validator, read in 2.26454.0 and 2.26454.2, plus a failed plugin sync observed on 2026-10-08; 2.26454.2 diffed against 2.26454.0) | Earlier source: **Claude Desktop `app.asar` 2.26454.0 diffed against 2.16120.0 and 2.19675.0** (all three builds read; staged agent 2.1.289), the **live GrowthBook cache decoded on 2026-10-07** (398 features), and the 2026-09-27 cache snapshot for served-value comparisons. The UI bundle (`ion-dist`) exists only for the installed build, so nothing here is claimed as a UI-bundle change.

# Chapter 61: Desktop 2.26454.0 — Spawn Environment, Scheduled Tasks in Auto Mode, and Gates Switched Off

---

## TABLE OF CONTENTS

222. [Lesson 222 — What Desktop 2.26454.0 Changed for Cowork](#lesson-222--what-desktop-2264540-changed-for-cowork)
223. [Lesson 223 — What Desktop Checks in a Plugin Zip, and How It Fails Without Telling You](#lesson-223--what-desktop-checks-in-a-plugin-zip-and-how-it-fails-without-telling-you)

---

# LESSON 222 — WHAT DESKTOP 2.26454.0 CHANGED FOR COWORK

**Desktop 2.26454.0 pins two agent settings off in every Cowork session. Since 2.19675.0, a scheduled task created from a Cowork session starts in Auto permission mode where the organization allows it. On 2026-10-07 the server switched off the cloud memory relay and the Computer Use permission gate, though the code that reads both is unchanged. The rules that decide whether a new task runs locally or in the cloud did not change.**

## Two agent settings pinned off

The main Cowork spawn environment gains two pinned values:

```
CLAUDE_CODE_SIMPLE:"0", CLAUDE_AGENT_SDK_MCP_NO_PREFIX:"0"
```

Desktop sets these two in the base environment it builds for every Cowork session, so whatever value the variables might otherwise carry, the session gets `"0"`. The same two names are also on the list Desktop removes from the user-configured environment variables that a Claude Code desktop (Code tab) session forwards, alongside the process-wrapper variable. The Cowork spawn forwards no user-configured variables, so that list does not apply to it. `CLAUDE_CODE_SIMPLE=1` replaces the system prompt and tool set with a minimal one (L86). `CLAUDE_AGENT_SDK_MCP_NO_PREFIX=1` drops the `mcp__<server>__` prefix from SDK-type MCP tool names, which include `mcp__workspace__*`. The agent (2.1.289) still reads `CLAUDE_CODE_SIMPLE`; only Desktop's handling changed. The code shows the pins. Why Desktop added them is not stated in the code.

## A model list that forces extended thinking on

The Desktop config object that holds `defaultSubagentModel`, `effortByModel` and `maxThinkingTokens` gains `thinkingAlwaysOnModels`, a list of model ids (new in 2.26454.0). The spawn-time thinking budget becomes 31999 when extended thinking is on *or* the session's model is on that list, so a listed model gets the full budget even with extended thinking switched off. The same check applies to a mid-session model change. The list is unset by default, so nothing changes unless an administrator's configuration sets it. L120's "thinking is either 31999 or 0" still holds; this is a second way to reach 31999.

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
- Cowork's model allow-list (`3045399524`) adds `claude-sonnet-5-5` and its `[1m]` variant. A later capture the same day also adds `claude-haiku-5-5` and its `[1m]` variant.
- In experiment bundle `364911507`, `delegation` and `echo_task_suggestions` are forced to control.

## Gates new in this window

There are 49 new gate ids, most of them for SSH and Claude Code desktop sessions. The Cowork-relevant ones:

- **`3626967935`** (served on): when the user trusts a remote folder, Desktop records that consent in settings, so the folder stays trusted. With the gate off, `browseAndAddTrustedFolder` returns Disabled.
- **Not in the 2026-10-07 cache:** `975160870` (`hostGitConfinedInstall`), `3165386771` (git private index directory) and `480673358` (`CLAUDE_CODE_HOST_WORKTREE_FENCE`), plus the two kill switches above.

One id was removed, `2685067074`, a boot-window latch.

## Local or cloud placement is unchanged

The placement rules, the `cowork-local-tasks-off` rule text and gate `3634338308` (still off) are the same in all three builds. The Personal Max change in L210, where new tasks run in the cloud, therefore did not come from a Desktop placement rule. That fits L210's finding that the claude.ai interface picks the lane.

## For an author

- A Cowork session always gets `CLAUDE_CODE_SIMPLE` and `CLAUDE_AGENT_SDK_MCP_NO_PREFIX` as `"0"`. If a harness copies the spawn environment, pin both the same way; if it forwards user-configured variables the way the Code tab does, drop both.
- A scheduled task made from a Cowork session may run in Auto mode, so tool asks you expect to see may be decided by the auto-mode classifier.
- Don't name an MCP server `memory` in `claude_desktop_config.json` anyway. While the relay is off, your server is used, but the gate can come back on and replace it without notice.
- Sonnet 5.5 and Haiku 5.5 are selectable in Cowork as of 2026-10-07.
- If a session thinks with extended thinking switched off, check the managed configuration for `thinkingAlwaysOnModels`.

---

# LESSON 223 — WHAT DESKTOP CHECKS IN A PLUGIN ZIP, AND HOW IT FAILS WITHOUT TELLING YOU

**Desktop checks every zip it unpacks against a size-and-shape policy. For a plugin, one file that compresses better than 50:1 fails the whole plugin. The error goes to `main.log` only. The plugin page still says the plugin is installed and on, and its skills never appear.**

## Observed

On 2026-10-08 (Desktop 2.26454.0, a Team org) a plugin uploaded under My Uploads showed as enabled, but its skills were missing from the `/` menu. `~/Library/Logs/Claude/main.log` had:

```
[RemotePluginManager] Failed to download founder-skills: Suspicious compression ratio for "tests/fixtures/two_figures_head_capture.json": 68:1 (max: 50:1) { errorCode: 'zip_extraction', name: 'ZipExtractionError', isUserFacing: false, … }
[RemotePluginManager] Sync complete: 0 downloaded, 0 removed, 0 orphans cleaned
```

The offending file was a test fixture of repetitive JSON. The same commit zipped without its `tests/` folder (largest ratio 7:1) synced at once, and its files on disk matched the source byte for byte (MEASURED, one plugin).

## The limits (CODE-READ, Desktop 2.26454.0 and 2.26454.2, identical)

One validator checks each zip entry before extraction. Its constants:

| limit | value |
|---|---|
| entries | 100,000 |
| total uncompressed size | 200 MiB for plugins (extensions: the `dxtMaxTotalSizeMB` setting, default 2,048 MB) |
| one file's uncompressed size | 512 MiB (checked for extensions only) |
| compression ratio | 50:1 |
| entry path / file name length | 1,024 / 255 characters |

Which checks run depends on the kind of zip:

| check | plugin | org plugin download | uploaded skill | extension (DXT/MCPB) |
|---|---|---|---|---|
| entry count, total size | yes | yes | yes | yes |
| ratio of **each file** over 50:1 | yes | yes | **no** | no |
| ratio of the **whole archive** over 50:1 | no | no | no | yes |
| path and name length | yes | yes | yes | no |
| a `.zip` inside the zip | refused | allowed | refused | allowed |
| `..` or absolute paths (before extraction) | no | no | no | yes |

A plugin downloaded from the organization uses the "org plugin download" column unless gate `3778108436` is on, which switches it to the stricter plugin column (and so bans nested zips); see Ch57/L213 for that gate's state. Extraction then writes into a staging folder (mode 0700), refuses any entry that would land outside it ("Path traversal detected in zip entry"), creates each file with an exclusive write so two names that collide on disk fail, and removes the staging folder if any one file fails, so a plugin arrives whole or not at all.

## For a skill author

- Keep test fixtures, recorded captures and other large repetitive files out of the plugin folder you ship. Text that repeats compresses far past 50:1.
- Before you release, check the largest per-file ratio of the zip you will publish, for example with `python3 -c "import zipfile,sys;print(max(i.file_size/max(i.compress_size,1) for i in zipfile.ZipFile(sys.argv[1]).infolist()))" plugin.zip`. Keep it well under 50; the server may repack your files.
- If a plugin shows as enabled but its skills or commands are missing, search `main.log` for `Failed to download <plugin name>`. Nothing in the app reports it.
- An uploaded skill (not a plugin) is not checked per file, so the same fixture would pass there.

## Desktop 2.26454.2

A patch build. The Desktop's own code is unchanged from 2.26454.0: the same gate ids, spawn environment, IPC interfaces, control-protocol subtypes and zip checks (MEASURED, content-matched across all 314 build files). What changed is the bundled agent, now **2.1.293**, fetched from a release-candidate channel (`claude-code-releases/rc/<commit>`, SDK `0.3.293-rc…`). The new agent knows variables and session fields that this Desktop does not yet set, among them `CLAUDE_CODE_DESKTOP_SKILL_SWITCHES`, `CLAUDE_CODE_HOST_SKILL_CATALOG` and `CLAUDE_CODE_REMOTE_TOOLS_HOST_ALLOWS_UNATTENDED`, so expect a later Desktop to pass per-skill switches, a host skill catalog and an unattended grant to the agent (INFERRED).
