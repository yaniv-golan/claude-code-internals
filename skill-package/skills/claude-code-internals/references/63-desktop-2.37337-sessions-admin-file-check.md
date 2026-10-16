Updated: 2026-10-16 (L235–L236: the v2.42304.0 notes; the Chat file-analysis network key removed in 2.42304.0) | Earlier: 2026-10-14 (L235–L236) | Source: **Claude Desktop `app.asar` 2.37337.1 diffed against 2.31226.1** (both builds read in full; the new build has 368 build files against 353), Desktop's UI bundle (`ion-dist`, current build only, so no old/new claim for code that lives only there), the **live GrowthBook cache decoded on 2026-10-14 with Desktop on Team** (428 features), live runs on 2.37337.1 on 2026-10-14, and Anthropic's release notes and configuration changelog for v2.37337.1 (read 2026-10-14). Both builds embed the same bundled agent, 2.1.295. Minified names are given with their chunk file, because the same short name is reused across chunks; chunk names are from 2.37337.1.

# Chapter 66: Desktop 2.37337 — Scheduled-Task Modes, Cloud Moves, Worktree Ownership, the Organization's File Check and Admin Policy

---

## TABLE OF CONTENTS

235. [Lesson 235 — What Desktop 2.37337 Changed in Sessions, Permissions and Computer Use](#lesson-235--what-desktop-237337-changed-in-sessions-permissions-and-computer-use)
236. [Lesson 236 — What Desktop 2.37337 Changed for Admins: the File Check, Sensitivity Labels, Device Profiles, EDR and SSH](#lesson-236--what-desktop-237337-changed-for-admins-the-file-check-sensitivity-labels-device-profiles-edr-and-ssh)

---

# LESSON 235 — WHAT DESKTOP 2.37337 CHANGED IN SESSIONS, PERMISSIONS AND COMPUTER USE

**A scheduled task created from a local Code-tab session now keeps that session's Auto or Bypass mode. `move_to_cloud` refuses from a worktree Desktop hasn't verified and when another message is waiting. Edits in a git worktree the conversation didn't make are rejected. The folder card is reworded, side-session notes are split by state, and computer use refuses to click through Claude's own windows and closes pop-up menus that background actions open. The refusal of app-level actions in a run nobody has opened is unchanged.**

## A scheduled task keeps a local session's mode (CODE-READ, `index.chunk-BolytlRP.js`, `index.chunk-BgYYQXqQ.js`)

- **Before:** only a task made from an SSH-host session carried a mode (`carriedTaskMode`).
- **Now:** a local, non-SSH Code-tab session passes `carriedTaskMode: this.taskModeHere.of(session)` too. `taskModeHere` is a new class (`Jv`):
  - it wraps the PreToolUse hooks and notes, per `tool_use_id` of `create_scheduled_task`, what the approval card said;
  - it holds at most 32 unanswered asks per session (`qv=32`); past that it logs "…its tasks keep no mode until the app restarts";
  - it consumes the note when the task is created.
- **The tool's reply** for a local task says the task will use tools and connectors without asking first, with the Auto (a classifier stops what looks unsafe) or Bypass (nothing reviews) wording. It adds, in paraphrase, that app-level actions still need the user and are refused in a run nobody has opened: changing scheduled tasks, folder access, settings, and switching connectors on or off.
- **New refusal:** a create that is owed a card and has none is refused ("Nothing was created…"), with telemetry `desktop_ccd_permission_auto_denied`, reason `create_scheduled_task_owed_card`.
- **New stored field** `permissionModeCarried: true`. A Manual-saved task's reply ends ", not in this session's mode".
- **One new "mode not saved" reason:** the card for this call named no mode, so none was saved.
- **Gate `346871663`** (`isFeatureEnabled`, unserved → off): a hard-linked task file is now written through; turning the gate on brings back the refusal.
- **Unchanged:** the lineage classifier (`wu()`: plain, routine, routineContinued, dispatchedHere, orphan, remoteDispatched, unresolvable) and Cowork's `unattended_deny` arms. Their code is identical to 2.31226.1.

## `move_to_cloud` gets stricter (CODE-READ, `index.chunk-BolytlRP.js`, `index.chunk-BcT8Ail-.js`)

The tool itself is unchanged: `mcp__ccd_session__move_to_cloud`, card-only, input `{summary (≤4000), environment_id?, skip_push?}`. Its refusal (`moveToCloudRefusal`) changed:

- **Worktree:** the hand-off folder resolves to `own`, `worktree` (a verified worktree move), `unverified_worktree` or `worktree_unavailable`. The last two refuse: "Claude is working in a worktree this app hasn't verified yet, so the session can't move to the cloud…"
- **A message queued elsewhere** now counts as pending input: "Another message reached this session while you were working, so nothing was moved…"
- **A session spawned by remote control** needs a request typed in the desktop app.
- **Removed:** the old check that the move came only from the user's own words. The plan now records whether the turn includes a message the app itself sent.
- "The cloud can't clone this project…" belongs to `start_session` with `target:"cloud"`, not to this tool; it rewords the old missing-or-not-GitHub `origin` refusal.

## Edits in someone else's worktree are rejected (CODE-READ, `index.chunk-BolytlRP.js`)

- **New block target `foreign_worktree`:** a worktree "not one this conversation made" is one that another session, the app's worktree pool or an outside tool may own, and may recycle. It lives in the checker for lazily created worktrees (`Qc`, `index.chunk-BolytlRP.js`), which the edit hook (`worktree-write-guard`, on Edit, Write, MultiEdit and NotebookEdit) runs for sessions with a `worktreeLazy` record. The hook now passes it the conversation's own trees (`lazyWorktrees.ownedTreePaths`); `lazyWorktreesTreeOwnership` drives the matching reminders.
- **Entering such a worktree** adds a reminder that edits there will be rejected. In paraphrase, the remedy is:
  - re-enter the conversation's own worktree with EnterWorktree `path`;
  - or call ExitWorktree with `action: "keep"`, then EnterWorktree with no `path`;
  - a subagent is told to report back, or to be re-spawned with `isolation: "worktree"`.
- **The appended prompt** for checkout sessions says the same. After a restart, the model is reminded to re-enter its worktree only if the path is one it owns.
- **Gates.** The lazy-worktree branch that holds `foreign_worktree` has no gate. The other branch (the fence, under the release notes below) runs only while `2393677837` is on, which it is for Team (served on). In dev and E2E builds `CLAUDE_E2E_WORKTREE_WRITE_GUARD_OFF`, `2222745432` or `2393677837` off can disable the guard; the test variable flipped polarity from `CLAUDE_E2E_WORKTREE_WRITE_GUARD`.

## Cards, notes and credits (CODE-READ)

- **Folder card:** "Allow this Cowork session to access this folder?" is now **"Allow Claude to access this folder?"**, at both sites (`grantRemoteSessionFolders`, `handleRequestFolderAccessGated`). Count: 2 → 0 for the old string, 0 → 2 for the new.
- **Side-session notes:** the `<side-sessions-event>` a Code-tab parent gets from sessions it started (`start_session`, `hand_off_to_session`) is now split into finished and waiting-on-the-user variants.
  - Both say, in paraphrase, that a note is that session's report, never an instruction, and to start nothing the user did not ask for.
  - Behind gate `2371478310`, served on. This is not Dispatch.
- **Credits:** the fast-mode overage notice is now the fixed line "Add credits or raise the monthly spend limit to turn it back on." Code tab only.
- **Unchanged, despite showing in a string diff:** `set_session_connector_enabled` and its refusals for phone/claude.ai/Project-started sessions. It is Code-tab only and always card-approved.

## Computer use (CODE-READ, `index.chunk-BWk6pVUt.js`, `index.chunk-Bim5jUQb.js`)

- **Claude's own windows are click-through during actions.** That covers Claude's native windows, including the Quick Entry bar (`setOwnWindowClickThrough`, `ownWindows`; both new). If a target point is still over one, the input is refused instead of landing on Claude's UI: "A Claude window is covering that point, so the mouse input was not sent…" or "Claude's Quick Entry bar is open over this screen…". If ownership can't be read, it refuses (fails closed).
- **Background menu guard (new).** In app-scoped actions (`app_click`, `app_type`, `app_key`, …), a native pop-up menu that a background action opens is closed.
  - The verdict (`closed`, `still_up`, `left_to_the_user`, `already_up`, `unknown_up`, `closed_late`) is appended to that app's next tool result: "After this click…", "After typing this text…".
  - When a menu was up, the note warns: "Keys or text sent since then may not have arrived, or may have changed that control's value: check it before you go on."
  - The guidance says, in paraphrase: to pick from a menu, release the app and use the display tools for that step.
  - Gate `3400412699` is read as `Ry(id)!=="off"`, so it is **on unless served off** (unserved on Team). If the gate can't be read, the guard also stays on.
- **Zoomed pages:** a ref click in the built-in browser now uses the visual viewport and refuses targets outside the visible part. The error says the page may be zoomed in.

## Computer use refuses to save into protected places (macOS; CODE-READ, 2.42304.0 `index.chunk-muI2IV6k.js` and `index.chunk-BEf0UhNC.js`, history from the backed-up asars)

This guard predates 2.37337 and has grown with most builds since. It is a check on computer-use **input**, not on file writes: before each type, key, click, drag or menu action, and on every key repeat, Desktop probes the app's Save panel (`savePanelProbe`, from the native module's `cuSavePanelProbe*`; darwin only) and refuses input that would save into a protected place.

- **What it refuses:**
  - typing a path (a `/`, or a leading `..` or `~`) or a protected name into the Save sheet's name box;
  - confirming a save, by click or Return, into a protected folder or under a protected name, or when the sheet doesn't show which folder it would use;
  - pointer input into a window whose document is itself protected;
  - from 2.42304.0, renaming or moving a document through its title-bar popover to a protected name or folder.
- **What counts as protected:**
  - any name starting with `.`, and anything under a hidden folder in the home directory (except `.Trash`);
  - `~/.ssh` (keys, `authorized_keys`, `known_hosts`), `Library/LaunchAgents` and `LaunchDaemons`, `.plist` files in `Library/Preferences`;
  - shell and terminal startup and config locations (zsh, bash, fish, oh-my-zsh, prezto, wezterm, kitty, iTerm2 AutoLaunch and others);
  - git config files and hooks, and virtualenv `activate` scripts;
  - file types that act when opened (`.command`, `.terminal`, `.webloc`, `.mobileconfig` and others).

  Names are compared after Unicode normalization and case folding, and symlinks are resolved.
- **New in 2.42304.0:** Homebrew's folders (`opt/homebrew`, `usr/local/homebrew`, `usr/local/cellar`, `/bin/brew`), the zsh and bash completion folders, Xcode's `xcdebugger` folder, and the title-bar popover checks. Nothing was removed.
- **What the model gets:** an `isError` result (telemetry `save_panel_restricted`) that says why and suggests saving under another name or asking the user to save it. It also says not to get around the refusal with scripting or shell commands.
- **History:** absent through 1.26832.0, first in 1.28929.0 (an ssh, launch-agent and shell-startup list), per-folder rules from 2.2553.1, the hidden-home rule in 2.26454.x.
- **Other platforms:** Linux file dialogs reuse the same name rules; the Windows guard (`file_dialog_restricted`) checks only which dialog control is targeted.
- **No gate of its own.** It runs wherever computer use runs, under computer use's own gates.
- **Separate from the connected-folder carve.** The `[protectedSubpaths]` list (L128) is maintained apart from this one. They overlap (`.ssh`, launch agents, shell startup files) but differ: this one covers Homebrew and completion folders, the carve covers `.aws`, `.gnupg` and `.claude` by name.

**For an author:** a skill that has computer use save a file should pick a plain name in an ordinary folder. A dot-file, a shell config or a `.command` file will be refused at the Save panel, and the model is told to hand that step to the user.

## Observed on 2.37337.1 (MEASURED, Team, 2026-10-14)

**Connector switches in the message box persist.** Gmail, Google Drive, Notion and Beeper Desktop were switched off in a task's **+ → Connectors** menu, meant for that task only. They were still off in the user's later sessions until switched back on (n=1). Treat these switches as a standing setting, not a per-conversation one.

## Served state on 2026-10-14 (MEASURED, Team)

- On: `2371478310` (side-session notes), `2393677837` (the non-lazy branch of the worktree guard).
- Unserved, so the code default applies: `3400412699` (menu guard, on by default), `346871663` (hard-link refusal, off by default).

## In the official release notes (checked 2026-10-14)

Anthropic's notes for v2.37337.1 (`claude.com/docs/cowork/changelog`) announce one item of this lesson. Notes are revised after publication, so this holds as of the date above.

- **Announced:** the background menu guard ("a dropdown menu that a click or key opens in a background app is now closed again at once").
- **Not in the notes (dark):** the scheduled-task mode carry, the `move_to_cloud` refusals, the `foreign_worktree` guard, the folder-card rewording, the side-session notes, the credits line, own-window click-through and zoomed-page refusals.
- **Nearby, a different mechanism:** the 2.31226.0 notes fix "file edits in a worktree session sometimes landing in the main checkout or in another session's worktree". That is the other branch of the same hook, not `foreign_worktree`; the two are alternatives (if/else on `worktreeLazy`), not stacked checks. What 2.31226.0 added (CODE-READ, `index.chunk-D5UeOeQn.js`, unchanged through 2.37337.1 apart from renamed symbols):
  - **Worktrees for a session's added folders.** The feature arrived whole: `folderWorktrees` occurs 0 times in 2.26454.2 and 71 in 2.31226.0.
  - **Per-folder fences.** `folderWorktreeFencesOf` returns one fence per live folder worktree, and a fork that shares its parent's checkout gets the parent's fences. The hook checks the session's own worktree, then each fence. A write into a base checkout or another worktree is blocked, naming the folder: "This session works on `<folder>` in an isolated git worktree at `<path>`, but `<file>` …". It blocks and never redirects, and Bash is not covered.
  - **A reminder for forks.** A fork that copies the transcript of a session with folder worktrees is told those worktrees belong to the session it was forked from, that it uses the folders in place, and "Do not edit the other session's worktree paths."
  - **Where it applies.** Local and WSL sessions always get the hook. An SSH session whose host doesn't apply the local workspace policy gets it only if it had its own worktree when its hooks were built.

  The shared-checkout warning to subagents, `externalWorktreeContainers` and gate `2393677837` already existed in 2.26454.2. Nothing SSH-Linux-specific changed in the hook in 2.37337.1, so where that build fixes the SSH-on-Linux case the notes describe was not found in the hook. Outside it (CODE-READ, 2.31226.1 vs 2.37337.1, plausible but not confirmed as the fix): the host-side write check on SSH, which had run only for Linux hosts over OpenSSH (`hostDecidesWriteChecks`), became `hostWriteChecksSystem`, now also covering macOS hosts. It now receives other sessions' worktrees and withholds the host worktree variables when one would be wrongly blocked (`withheld_for_extra_tree`). And a host started through the remote-managed launcher no longer counts as guarding, so the app keeps its own write check. The first fits "another session's worktree" and the second "the main checkout", but no fragment names Linux.

- **Computer use's save guard (above) in the notes:** 2.26454.0 (no hidden files in the home folder), 2.31226.0 (no saving into hidden folders) and 2.42304.0 (Homebrew's folders, shell start-up locations, protected document names) announce its growth. Its first appearance, in 1.28929.0, has no note, and neither do the Xcode and `/bin/brew` entries.
- **Later, in the v2.42304.0 notes (checked 2026-10-16, not read in the code):** the Git operations the app runs for you (the commit and stash around a branch switch, the in-folder branch switch, and the push behind "Continue in cloud") no longer run the repository's Git hooks, so push Git LFS objects from a terminal before continuing in the cloud. Archiving a session after Claude moved it to the cloud no longer deletes untracked files in its worktrees, and deleting a session on an SSH host whose helper hadn't updated no longer deletes a branch holding unpushed commits.

## Who this affects and what to do

- **Scheduled-task users.** A task made from an Auto or Bypass Code-tab session now runs unattended in that mode. Check the mode before saving, and expect app-level steps to be refused in such runs.
- **Skill and agent authors who use worktrees.** Don't edit in a worktree the conversation didn't create. Use EnterWorktree with no `path` to get your own.
- **Anyone moving sessions to the cloud.** Leave the worktree, or wait for verification, before `move_to_cloud`, and don't queue another message while it runs.
- **Computer-use flows.** Close Quick Entry and Claude's own windows over the target. After background menu activity, re-check a control's value before relying on it.

---

# LESSON 236 — WHAT DESKTOP 2.37337 CHANGED FOR ADMINS: THE FILE CHECK, SENSITIVITY LABELS, DEVICE PROFILES, EDR AND SSH

**Desktop now carries the runtime for an organization file check: a program a third-party deployment names, which Cowork asks before Claude reads any file in a connected folder. The setting is marked for a future release and hidden from the admin settings page, but nothing stops a machine policy that sets it. While that check is configured, connected folders are not mounted into the VM at all, and a new `mcp__cowork__import_files` tool copies checked files in. The bundled Microsoft 365 connector can refuse files by Purview sensitivity label. A user's configuration-server pointer can override the device profile unless the profile forbids it. EDR integration gains a Windows path and a log-export section. Admins can turn off the shell in custom third-party deployments. Code-tab restart parking knows twice as many failure causes, which stay dark until a gate is served.**

## The organization's file check (CODE-READ, `index.chunk-qbMm8eZ4.js` (new), `index.chunk-KpOoeR5G.js`, `index.chunk-m8lVroc8.js`)

- **Setting:** policy `coworkFileReadCheck` (`workspace.fileReadCheck`), `{command, timeoutSec 1–60 (default 10), cacheTtlSec 0–86400 (default 600)}`.
  - Scopes `["3p"]`, `remotePolicy:"remote-disabled"`, so it is device policy only.
  - **Not released yet:**
    - It is `public-undocumented` (newly so in 2.37337.1) and hidden from the settings page (`show: () => false`). It is the only `@next` key with both marks.
    - Neither the release notes nor the configuration changelog mention it.
    - It has stayed `"@next"` past the build after it appeared, which a Desktop-read key rarely does. On its own, `"@next"` is not evidence: see the stamp section below.
  - **But enforced if present.** The only code that reads `@next` is one helper for the OIDC editor; the policy reader ignores the marker. So a machine policy that sets the key is enforced by 2.37337.1. This is CODE-READ; no deployment with the check was run.
  - The schema existed in 2.31226.1; the runtime is new.
- **The command** must be a standalone program given by full local path, from machine-scoped policy. Scripts (`.cmd`, `.bat`, `.ps1`), shells and interpreters are rejected by pattern.
- **Fails closed.** An unreadable value becomes `/dev/null/unreadable-file-read-check`, and a session won't start if the program can't run.
- **Protocol:**
  - Desktop runs the program once per file, at most 4 at a time.
  - Its stdin is a JSON `tool_call` with `source.application:"claude-desktop"` and one `tool_use` of `tool_name:"Read"` with `input.file_path`.
  - **Allow** only on exit 0 with `action:"allow"` and no `user_approval` key. Anything else blocks. A `deny_reason` is shown to the model as the organization's reason.
  - An allow is cached per file identity (device, inode, size, mtime, ctime) for `cacheTtlSec`. A file that changes during the check is blocked.
- **While the check is configured (host-loop Cowork):**
  - **Connected folders are not mounted into the VM.** The shell can't see them, and the bash tool description says so.
  - PreToolUse blocks Read, Edit, MultiEdit and Grep on unchecked files (Grep one file at a time). Glob and Write are exempt.
  - `@`-mentions are detached until checked. Disallowed attachments and images are dropped, with a reminder that a retry carries no files.
  - The model is told, in paraphrase: tell the user, don't look for another way to the content, and an administrator can help.
- **New tool `mcp__cowork__import_files`:**
  - Input `{paths: string[] (1–20 absolute file paths, not folders)}`; offered only when the check is configured, in host-loop, non-chat sessions.
  - It copies files from granted connected folders into the session's uploads folder, checking each one.
  - It returns the VM path for each copy, or a skip reason: `file-check`, `file-cap`, `total-cap`, `copy-failed`.
- **No GrowthBook gate.** Gate `1968338882` is only a kill switch for reusing an identical committed copy.

## Microsoft 365 sensitivity labels (CODE-READ, `index.chunk-BWk6pVUt.js`, `resources/office365-mcp/office365-mcp-stdio.mjs`)

- **Setting:** a managed `managedMcpServers` entry `{server:"microsoft365", sensitivityLabels:[{labelId, effect}]}`, 1–48 rows. It needs `tenantId` as a tenant GUID.
- **Delivery:** Desktop passes the rows only to the bundled M365 stdio server, as `MCP_SENSITIVITY_LABELS={"version":1,"labels":[…]}`.
- **Effect:** the server refuses SharePoint and OneDrive files that carry one of those labels. Any `effect` other than "block" warns and blocks too.
- **Failures** read as a misconfigured blocklist, or "policy is still loading". No gate. Absent from 2.31226.1.

## Device profile vs a user's configuration-server pointer (CODE-READ, `index.chunk-BWk6pVUt.js`, `index.chunk-CGQsUM80.js`)

- A local `hybridPointer` (a configuration-server bootstrap URL the user chose) now supersedes the device profile's hybrid-scoped keys. The log says "[custom-3p] the device profile yields to the hybrid pointer".
- **It doesn't, if:**
  - the profile sets `disableDeploymentModeChooser`, or can't be read;
  - or `forceLoginOrgUUID` doesn't include the pointer's organization.
- The log export explains which applied ("the next launch ignores it…"). Policy only, no gate.

## EDR integration (CODE-READ, `index.chunk-BWk6pVUt.js`, `index.chunk-DkReRM12.js`)

- **The core is not new:**
  - `coworkEDRIntegration` (a signed package path) and `coworkEDRIntegrationVendor` come from device management;
  - the vendor's install script runs inside the Cowork VM when it reaches Ready (guest-side is INFERRED);
  - kill switch: gate `580613960`, served off, so not armed.
- **New:**
  - a Windows VM-service path (`Program Files\Claude\edr-integration\install.args`, HKLM policy checks);
  - a check that the package path matches the platform's path form;
  - a log-export section (`cowork-edr-integration`) listing runs and install output. It warns that an install entry only means the script exited 0, "not proof that a sensor is running". A fully third-party install shows "Anthropic's kill switch: none".

## Other admin-facing changes (CODE-READ)

- **Shell off in custom third-party deployments.** When the deployment's disabled built-ins include bash, `mcp__workspace__bash` answers: "Your organization's administrator has turned off shell commands…".
- **VM-loop sessions under a host-loop deployment are refused.** "This session can't continue: it was created to run inside the VM sandbox, which this deployment no longer uses. Start a new session." See L124 on host-loop stickiness.
- **Code-tab restart parking (mechanism pre-existing).** Desktop stops respawning a failing Code-tab CLI after 5 fast failures in a row or 15 in all ("automatic restarts are paused for this session"); a message resumes it.
  - New: 12 more failure categories with their own texts, among them `proxy_invalid`, `temp_dir_unusable`, `worktree_unverified`, `org_config_refused` and `cli_version_too_old`.
  - The categories come from the CLI's `startup_failure_reason`, requested with `CLAUDE_CODE_STARTUP_FAILURE_RESULTS=1`. In 2.37337.1 Desktop set it only when gate `3488857202` was on, and it was unserved, so users saw the generic text. 2.42304.0 drops that gate and sets the variable for Code-tab spawns by default; gate `2000661115` is now a kill switch (`return !gate`), unserved on 2026-10-16.
- **SSH:**
  - OpenSSH is the live transport (`3946462706` served on).
  - A banner explains the two cases the built-in library can't handle (`proxy_jump_unsupported`, `host_key_source_unsupported`).
  - A message names `claude-ssh-askpass.exe`, `claude-ssh-broker.exe` and `claude-ssh-proxy.exe` when the OS blocks the sign-in helper.
  - New kill switches: `1731450842` (user name via config file) and `1846651524` (host-key "who asks" check). Both are unserved, so the new behaviour is active.
  - `CLAUDE_SSH_NO_LOGIN_PATH_WARM` has a setter with no callers.
- **Plugins sent to an SSH host** are refused when a SKILL.md front matter has an `experimental` key, which can set plugin hooks (reason `skill_hooks`). A YAML parser that can't load also refuses ("SKILL.md was not read…").
- **MCP Apps from agent-spawned plugin servers (dark).** Gate `3184956269` would route widget `tools/call` and `resources/read` to plugin MCP servers the agent spawned in host-loop. It also sets `CLAUDE_CODE_MCP_APPS_HOST=1` at spawn. Unserved, so off. See L105 and L233.
- **`.host-home` translation** now strips repeated prefixes. Gate `61799151` (unserved) would restore the single-prefix match. See L117.
- **Standalone CLI sessions.** Desktop can list and tail them behind gate `1985233154`, served off; the feature was hard-off before.

## Gates new in this build, by effect (CODE-READ; served state MEASURED on Team, 2026-10-14)

| Gate | What it does | Served on Team |
|---|---|---|
| `3184956269` | MCP Apps routing for agent-spawned plugin servers | unserved (off) |
| `3488857202` | startup-failure results for Code-tab restarts | unserved (off); gone in 2.42304.0, replaced by kill switch `2000661115` |
| `3400412699` | close background pop-up menus | unserved (on by default) |
| `346871663` | refuse a hard-linked scheduled-task file | unserved (off) |
| `61799151` | old single-prefix `.host-home` match | unserved (off) |
| `3475553907` | organization default for unattended remote-control serving | unserved (off). 2.42304.0 no longer reads it (served off from 2026-10-16 all the same); the unattended-serving consent now uses gate `1311831313` |
| `1985233154` | list and tail standalone CLI sessions | off |
| `144153584` | browser-data import also needs an organization capability | on |
| `3868149774` | Preview user agent without `Electron/` | on |
| `1338660703` / `2897767209` | MCP / terminal for WSL sessions | off |

The remaining new ids are kill switches whose default keeps the new behaviour on: SSH, git tracking-ref vetting, worktree pool, sleep redial, preview roots, terminal command time box, and the Chrome admin-off latch. `312571861` is inert. `3805388752` and `4113347374` have no reader in the bundle.

The 8 ids removed since 2.31226.1 were retired kill switches. What they guarded now runs unconditionally:
- SSH transcript resync;
- subagent `meta.json` listing;
- SSH auth-error teardown;
- remote restart;
- self-reconnect;
- SSH-MCP stderr;
- remote-plugin enabled state;
- the skipped-block card.

## In the official release notes (checked 2026-10-14)

- **Not in the notes (dark):** everything above. That covers the file check and `import_files`, sensitivity labels, the hybrid pointer, EDR, the shell-off message, restart-parking categories, the SSH banner and helper names, the `experimental` refusal, and every gate in the table.
- **Nearby:** the notes say a `WebFetch` or bare `Bash` entry in `disabledBuiltinTools` now also applies to Cowork and Chat conversations already open. They also say SSH on Windows runs only an `ssh.exe` found on PATH, never a `.bat`, `.cmd` or `.ps1` wrapper.
- **Announced:** the configuration changes in the next section.
- **Rechecked 2026-10-16 against the v2.42304.0 notes:**
  - Announced: Chat's file-analysis shell reaching `coworkEgressAllowedHosts`, with commands that run without asking.
  - Not in the notes: that this replaced the `@next` key `chatAdvancedFileAnalysisNetworkEnabled`, which was dropped unannounced; that Code-tab startup-failure categories are on by default (`2000661115`); and that gate `3475553907` is no longer read.

## Configuration changes the notes announce (CODE-READ, policy schema of both builds)

A string diff of the two builds did not surface these; a diff of the managed-policy schema (the `flatKey` entries in `index.pre.js`) did.

- **`developerModeEnabled`** (new; scopes `3p` and `1p`, hot-applied). Set to `false`:
  - installing an extension from a folder is refused: "Your organization has turned off Developer Mode, so extensions can't be installed from a folder.";
  - the bundle also has a routine that closes open DevTools under a Developer Mode log line. What triggers it was not traced.
- **Former key names are dropped.** 2.31226.1 had six `legacyFlatKey` aliases, each with a stated effect: `isDxtEnabled`, `isDxtSignatureRequired`, `isDxtDirectoryEnabled`, `enduserAttribution`, `trustBootstrapLocalExec`, `inferenceGatewayHeaders`. 2.37337.1 has none.
  - The `isDxtEnabled` strings still in the bundle belong to Desktop's internal developer-features object, not to managed configuration.
  - Per the notes, a macOS profile or Windows user policy holding only former names stops counting as managed configuration.
- **Egress no longer adds the provider's hosts.** The VM allowlist was `[...provider.vmAllowedDomains(), ...coworkEgressAllowedHosts]`; it is now the configured list alone.
  - An empty list now counts as authored (`emptyListIsAuthored`), which backs the Setup window's "Allow none".
- **Chat's file-analysis shell can get network (new, not in the notes).** On third-party deployments, Chat's advanced file analysis runs its shell as `mcp__workspace__bash` in the same local VM as Cowork.
  - In 2.31226.1 a Chat session's shell always had an empty allowlist (`disableBashNetwork`, `index.chunk-QEr06WaZ.js`).
  - In 2.37337.1 it gets `chatShellAllowedDomains()` (`index.chunk-m8lVroc8.js`). That is the `coworkEgressAllowedHosts` list when the key `chatAdvancedFileAnalysisNetworkEnabled` (`chatSurface.advancedFileAnalysisNetwork`, 3p only, `@next`) is on, Chat and file analysis are enabled, and Bash isn't disabled. Otherwise, and on first-party, the list is empty.
  - From 2.42304.0 that key is gone from the schema and the shell follows `coworkEgressAllowedHosts` whenever Chat and file analysis are on and Bash isn't disabled (`jNe`, `index.chunk-muI2IV6k.js`; an unrestricted policy gives `*`). On first-party the list stays empty. The 2.42304.0 notes announce exactly this, under `chatAdvancedFileAnalysisEnabled` and `coworkEgressAllowedHosts`: "With no list, or an empty one, they have no network access." The `@next` key never shipped.
  - The admin text says an empty list keeps the sandbox offline, `*` turns the network sandbox off, commands run without asking (`Bash: ask` in `builtinToolPolicy` restores prompting), and chats in the unified Chat and Cowork view already follow the Cowork list. No GrowthBook gate; the HIPAA `*` filter (L214) wraps this spawn too.
- **A malformed `managedMcpServers` `toolPolicy`** is kept with every tool treated as "blocked", with the error "…is not a map of tool names to permissions".
- **Deprecation flags** are cleared on `managedMcpServers`, `orgPluginSettings`, `builtinToolPolicy`, `inferenceCustomHeaders`, `bootstrapHeaders` and `otlpHeaders`/`otlpResourceAttributes`. The old spellings now fail as plain invalid values. For `ask-session` the configuration changelog (Desktop 1.40609.0) spells out what an unrecognized value becomes in each field: `ask` for a built-in tool, `blocked` for a plugin-delivered tool, and an invalid entry for a managed server. Use `ask`.
- **Also in the schema diff:** the `toolPolicyRules` key (added `@next` in 2.31226.0) is gone, unannounced. `toolPolicyEndpoint` was stamped `2.31226.0`, also unannounced.

## Reading a policy key's release state (MEASURED, 40 Desktop builds, 1.18286.2 → 2.42304.0; CODE-READ, `index.pre.js`)

- **Each key names its readers.** `readers` lists the clients that apply it: `desktop`, `m365` (the Claude add-in for Microsoft 365) and `code` (the Claude Code CLI signed in to the organization by itself). A missing field means `["desktop"]`.
  - Desktop applies only keys that list `desktop`. A device policy that sets any other key is ignored with a log line: "…this key is read by another Claude client… Claude Desktop never reads it."
  - In 2.37337.1, 8 keys are `["m365"]`: the Entra sign-in keys, the Office host, feature and access-policy keys, `skillBundles` and `inferenceBedrockWebIdentityRoleArn`. One key, `claudeCodeSettings`, is `["code"]`. The admin web UI edits them on its Office and Code pages.
- **`availableInVersion:"@next"` means no released Desktop reads the key yet.** Once Desktop starts reading a key, the next build stamps the version that started. All 53 stamps seen name a version no later than the key's last `@next` build.
  - Example: `otlpAttrMaxChars` was `["m365"]` and `@next` from 1.44121.1. It became Desktop-read in 2.31226.0, was still `@next` in 2.31226.0 and 2.31226.1, and is stamped `2.31226.0` in 2.37337.1. The configuration changelog lists it under v2.31226.0.
  - So a key read only by another client stays `@next` for good, and a new Desktop key, such as `developerModeEnabled`, is `@next` in the very build whose notes announce it.
- **A Desktop-read key still `@next` after the next build is the unusual case.** `coworkFileReadCheck` (`["desktop","code"]`) was `@next` from 2.31226.0 through 2.37337.1, and Desktop enforced it regardless (above). 2.42304.0 stamps it `2.37337.1`, and `developerModeEnabled` too.
- **An `@next` key can also be dropped before it ships.** `chatAdvancedFileAnalysisNetworkEnabled` was `@next` in 2.37337.1 and is absent from 2.42304.0; its behavior shipped under existing keys instead (above).
- **`public-undocumented` predicts silence in the notes.** 22 of the 25 keys flagged that way in 2.37337.1 are never named in the notes or the configuration changelog. 149 of the other 163 are.
- So read "released" off the notes, the `readers` field and the undocumented flag, never off the stamp alone.

## Who this affects and what to do

- **Third-party admins updating to 2.37337.**
  - List your inference provider's, gateway's and OTLP collector's hosts, and `api.anthropic.com`, in `coworkEgressAllowedHosts` if agents' shell commands, web fetches or http hooks call them. They are no longer added for you.
  - Rename any former key names (`isDxt*`, `enduserAttribution`, `trustBootstrapLocalExec`, `inferenceGatewayHeaders`). Their settings no longer apply, and a profile holding only former names can make the device unmanaged.
- **Third-party admins considering a file check.** It is unreleased and undocumented, so treat it as a preview, not a supported control.
  - If you test it: ship a signed, standalone program at a fixed path and set it by machine policy. Make it answer `{"action":"allow"}` with exit 0 quickly; anything else blocks.
  - Users' shell commands will no longer see connected folders. Tell them files come in through `import_files` or attachments.
- **Skill authors.** Under a file check, don't rely on shell access to connected folders, `@`-mentions or Glob-then-bash patterns. Read with the file tools, or import first.
- **M365 admins.** Use only the `block` effect, and set `tenantId`.
- **SSH users of plugins.** Move any `experimental:` front-matter fields to the top level, or the plugin won't be sent to the host.
