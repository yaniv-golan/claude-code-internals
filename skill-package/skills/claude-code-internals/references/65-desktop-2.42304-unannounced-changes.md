Updated: 2026-10-16 (L238) | Source: **Claude Desktop `app.asar` 2.42304.0 diffed against 2.37337.1** (both extracted; `.vite/build/`), first-hand reads of every item below; the live GrowthBook fcache decoded on 2026-10-16 under a Team organization (content16 `574e7bdaed951bfc`); and Anthropic's Desktop release notes and configuration changelog for v2.42304.0 (2026-10-15), checked 2026-10-16. Gate ids were found by a subagent and each item was then re-read here. Minified names are given with their chunk file, because the same short name is reused across chunks.

# Chapter 68: What Desktop 2.42304.0 Changed Without Announcing It

---

## TABLE OF CONTENTS

238. [Lesson 238 — What Desktop 2.42304.0 Changed Without Announcing It](#lesson-238--what-desktop-242304-changed-without-announcing-it)

---

# LESSON 238 — WHAT DESKTOP 2.42304.0 CHANGED WITHOUT ANNOUNCING IT

**Desktop 2.42304.0 (2026-10-15, bundling agent 2.1.299) changes several things its release notes don't mention. In the Code tab, Claude has to find the `start_session` tool through tool search before it can use it, and detailed startup-failure messages are on by default. Over SSH, the fallback that auto-accepted unconfirmed host keys is gone, and Desktop leaves plugins the host already has to the host. On Windows Store installs, plugin paths point at the real folder. Three admin keys are prepared but not yet read. Most new switches are kill switches that nobody serves yet, so the new behavior is what users get.**

The announced changes of this build are in the lessons they touch: approvals and "Always allow" (Ch63/L229), synced-plugin zips (Ch61/L223), the Git and worktree fixes (Ch66/L235), Chat's file-analysis network (Ch66/L236) and the admin keys (Ch67/L237).

## Code tab

| change | evidence (2.42304.0) | before (2.37337.1) |
|---|---|---|
| `mcp__ccd_session__start_session` is no longer always loaded, so the model must find it through tool search first | `{name:rx,…,...n??Vx()?{}:{alwaysLoad:!0}}`, `rx="start_session"`, `Vx(){return t.RZ("1849776485",!0)}`; the gate defaults on and is unserved | `{name:px,…,alwaysLoad:!0}` |
| Detailed startup-failure categories (`proxy_invalid`, `cli_version_too_old` and the rest) are on by default | `CLAUDE_CODE_STARTUP_FAILURE_RESULTS` is set unless kill switch `2000661115` is on (`function ua(){return!t.LZ("2000661115")}`); unserved | set only when gate `3488857202` was on, and it was unserved |
| Desktop tags sub-agent messages in its own saved copy of the conversation with `parent_tool_use_id: "subagent:<agentId>"` | `SV(e){return t.LZ("469868978")?e:t.oh(e)}`, applied to `messageBuffer` on preload, rewind, undo and clear; kill switch unserved | not tagged |

The tag is Desktop's storage only. The agent's stream-json envelope (Ch32/L118) is unchanged; a reader of Desktop's saved session can now tell a sub-agent's rows by that prefix.

## SSH sessions

- **No more host-key fallback.** The kill switch `ccd_ssh_short_command_options_killswitch` (gate `557784691`) and the `acceptNew` path it fed are gone. Background SSH commands used it to run with `StrictHostKeyChecking=accept-new`, saving host keys nobody confirmed. The user-facing texts that tell you how to opt into `accept-new` yourself remain.
- **Plugins the host already has stay with the host.** Desktop reads the host's `enabledPlugins` and `plugins/installed_plugins.json` and doesn't hand over its own copies of those (log: "plugin(s) left to the host's own install"). Kill switch `4255248502`, unserved. So on an SSH host with its own Claude Code plugins, the host's version of a plugin runs, not Desktop's.

## Plugins

- **Windows Store (MSIX) installs.** A plugin's `installPath` and `sdkPath` under the MSIX-virtualized Roaming folder are translated to the physical LocalCache copy, once both trees list the same files (log: "…giving Claude Code the original path"). Kill switch `4012727013`, unserved. `${CLAUDE_PLUGIN_ROOT}` there now names the real folder.
- **`disableSideloadFlags`.** Desktop's own refusal of plugins at local spawn, for an organization whose Claude Code managed settings set `disableSideloadFlags` ("Desktop skills and plugins are off in this session. Your organization's managed settings block them."), predates this build. 2.42304.0 gives it a kill switch, `3324120397`, unserved, so the refusal still applies.

## Cowork

- **Drive export under HIPAA.** A restricted (HIPAA) organization exporting a session file to Google Drive used to get `hipaa_gated` every time. Now the check is skipped when gate `2645895612` is on and GrowthBook data is fresh. It is unserved, so these organizations are still refused.
- **`save_to_disk` is not new.** Computer use already had it, set to `false`, and the note "save_to_disk had no effect…" already existed. 2.42304.0 ties it, for Cowork's built-in browser server only, to gate `135563052`, which is unserved. Nothing changes for users yet.
- **Unattended serving.** Gate `3475553907` (an organization default for unattended remote-control serving) is no longer read. The consent check now uses `1311831313`, served off.

## Admin keys prepared but not yet read

Three new policy-schema keys, all for third-party deployments and all `availableInVersion:"@next"` (Ch66/L236 explains the stamp):

| key | what the schema says |
|---|---|
| `releaseChannel` | `autoUpdate.releaseChannel`: `stable` (default) or `staggered`. Marked internal-only; the updater already reads it |
| `sshConfigs` | Up to 100 SSH connections provisioned by the admin ("SSH connections", "Add connection"); beta feature `sshRemoteSessions`; asks for the user's consent |
| `disableDesktopLocalSessions` | "Disable local Code sessions"; warns when no SSH host is allowed. The Claude Code managed-settings key of the same name already existed (per the 1.37937.0 notes); this is the Desktop policy form |

## In the official release notes (checked 2026-10-16)

- **Not in the notes:** everything in this lesson. No v2.42304.0 note names `start_session`, tool search for Code-tab tools, startup-failure categories, sub-agent tagging, host keys or `accept-new`, plugins on the SSH host, MSIX plugin paths, Drive export for HIPAA organizations, `releaseChannel` or `sshConfigs`. Also in this build and not announced until v3.1623.0: Storage and the `/storage` command (gated on the capability `storageDialog`; L242).
- **Later notes (checked 2026-10-21):** v3.1623.0 announces `releaseChannel` (`staggered` gets releases after they have fully rolled out on `stable`, skipping the ones in between), and its schema stamps `disableDesktopLocalSessions` and `sshConfigs` as available from 2.42304.0. The v3.1623.0 notes also say the Claude Code managed-settings `disableDesktopLocalSessions` now honours the text "true" and also applies where claude.ai admin settings apply (L242). Anthropic later added 13 Code-tab items and a third-party note (a failing `PreToolUse` hook on Windows without Git for Windows now blocks the call) to the v2.42304.0 entry itself; none of them names an item above.
- **Nearby:** the notes announce that third-party SSH sessions carry on across an app restart on macOS and Linux and that Desktop restarts Claude Code on the host when it is lost mid-task. That `sshConfigs` belongs to the same work is INFERRED from the key's `sshRemoteSessions` beta flag, not traced.

## For a skill or plugin author

- **Don't assume `start_session` is in the Code tab's tool list.** A skill that tells the model to call it should expect a tool-search step first.
- **On an SSH host, test with the host's plugins.** If the host has its own install of your plugin, that copy runs, whatever Desktop has.
- **On Windows Store installs, don't hard-code the virtualized path.** Read your root from `${CLAUDE_PLUGIN_ROOT}`.
- **Reading Desktop's saved sessions:** sub-agent rows now carry `parent_tool_use_id` starting `subagent:`.

## Not established

- None of this was observed live; it is all read in the code.
- Each kill switch could be turned on server-side at any time, which would restore the 2.37337.1 behavior. Read the fcache before relying on one (Ch35/L124).
