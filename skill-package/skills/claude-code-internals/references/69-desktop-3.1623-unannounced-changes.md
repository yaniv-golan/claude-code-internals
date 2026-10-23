Updated: 2026-10-22 (L242) | Source: **Claude Desktop `app.asar` 3.1623.0 diffed against 2.42304.0** (both extracted; `.vite/build/`) and the two builds' UI bundles (`ion-dist`, archived per build); the live GrowthBook fcache decoded on 2026-10-21 under a Team organization; two runs in a Team organization on 2026-10-21; and Anthropic's Desktop release notes and configuration changelog for v3.1623.0, checked 2026-10-21 (the notes page carries no dates any more; the build's files are dated 2026-10-20). A subagent did the first pass; each item below was then re-read here. Minified names are given with their chunk file, because the same short name is reused across chunks.

# Chapter 72: What Desktop 3.1623.0 Changed Without Announcing It

---

## TABLE OF CONTENTS

242. [Lesson 242 — What Desktop 3.1623.0 Changed Without Announcing It](#lesson-242--what-desktop-31623-changed-without-announcing-it)

---

# LESSON 242 — WHAT DESKTOP 3.1623.0 CHANGED WITHOUT ANNOUNCING IT

**Desktop 3.1623.0 (bundling agent 2.1.304) announces Storage as new, but Storage, `/storage` and both cleanups were already in 2.42304.0; the new part is removing only the rows you tick. Unannounced: a new Desktop-side engine for resuming Code sessions after the five-hour limit (off until a server value turns it on), and a model-based security scan of user-made skills and plugins for third-party deployments. Five admin keys for typed artifacts are reserved and do nothing yet. How a Cowork task picks local or cloud did not change in this build.**

The announced changes this build touches are in their lessons: the device shell's time limit (Ch55/L215), task routing on Team (Ch63/L226, L210), and the admin keys (Ch67/L237).

## Storage: what was already there, and what it deletes

- **Already in 2.42304.0.** The `/storage` command (`name:"storage"`, gated on the capability `storageDialog`, ion-dist `cc183b3ab`) and the main process's `DeviceStorage` interface are in both builds. 3.1623.0 adds `DeviceStorage.runCodeCleanupSelected(token, keys)`: the main process removes only the ticked rows and refuses a selection that doesn't match the rows the preview listed ("refused a selection that does not match its preview … nothing removed", `index.chunk-BLvpT1n4.js`).
- **Code cleanup** removes the worktrees the app made for Code sessions that have been inactive for the chosen time. Sessions and branches stay unless you also choose to delete sessions; uncommitted changes are discarded only if you opt in.
- **Cowork cleanup** deletes inactive tasks *and chats* stored by the app, in full. A task counts as inactive by its last activity; busy and hidden ones are skipped, and starred ones are skipped except when an admin retention period (`coworkSessionRetentionDays`) runs the same deleter.
- **Measured but not deletable:** old CLI versions, browser panes, logs and crash dumps. Clearing the cache restarts the app and keeps you signed in.
- **A server switch can turn cleanup off:** `disableStorageCleanup` inside gate `1978029737` (new in this build). It wasn't in the served value on 2026-10-21, so cleanup is on.

## Code sessions: a new engine for resuming after the five-hour limit (dark)

A new engine (`LimitAutoResumeEngine`, `index.chunk-k9Bk8AAN.js`) watches for a request refused by the five-hour limit (`rateLimitType:"five_hour"`), holds the session, and resumes it when the limit resets: up to three attempts per session, tracked in a local store `ccd-limit-auto-resume`, logged as `desktop_ccd_limit_auto_resume`. The interface gets a matching `LimitAutoResume` IPC interface (armed state and held sessions). It runs only when gate `2810334838` returns `"on"`, and that gate was absent from the 2026-10-21 fcache, so it is off. Resuming after the limit is not new to users: the notes announced it as on by default in v1.32352.0 ("Auto-continue when limits reset"), and v2.37337.1 fixed it for sessions with background agents. The new part is this engine in the main process, which carries over earlier choices (`migrate`, and an account choice read from `epitaxyPrefs`). Whether it replaces the existing path once switched on wasn't traced.

## Third-party deployments: a model scans user-made skills

New admin key `skillScanningEnabled` ("Scan user-created skills", third-party only, marked `@next` in this build and stamped as released in 3.1623.0 by the 3.6556.1 schema, and fail-closed: an unreadable value counts as on). When it is on, Desktop advertises the capability `skill_plugins_scanning`, and importing skills from another Claude app waits until scanning is available to the member. The scan is a model call made by the app (`index.chunk-y9YoSS0s.js`) with a security reviewer's prompt that asks whether a plugin "acts against the interests of the person who installs and runs it". It looks for covert telemetry, undisclosed data destinations, remotely loaded instructions, credential exposure, tampering with guardrails or records, and spoofed system prompts. Each result (pass, warn, fail or error) is exported as `custom3p_skill_scan_completed`. A session can retry a scan (`retryLocalSkillScan`). What a failing verdict blocks wasn't traced.

## Reserved: typed artifacts for third-party deployments

Five new admin keys (`artifactsEnabled` plus `artifactsDashboardEnabled`, `artifactsDesignEnabled`, `artifactsMotionEnabled`, `artifactsSlidesEnabled`) are titled "Reserved setting 1" to "5", third-party only, and marked `@next` here; the 3.6556.1 schema stamps them as released in 3.1623.0. The reader returns on only for a third-party deployment whose `artifacts.enabled` is true, and the registry of artifact types it would enable is empty. Nothing uses them yet.

## Other changes

- **Local-session bans from two places (announced).** `disableDesktopLocalSessions`, `sshHostAllowlist` and `disableSshSavedPasswords` are now read from claude.ai admin settings as well as from the computer's own Claude Code managed settings. While the server switch `ccd_ssh_computer_policy_killswitch` is on, the computer's values are ignored. These apply to Code sessions only; Cowork's local tasks have their own rule (L208).
- **New IPC interfaces:** `Custom3pApiKeySignIn`, `SourceBranchPrefetch`, `WindowVibrancy` and `LimitAutoResume`; none removed. New methods include serving the built-in browser to a remote session (`serveRemoteBrowserSession`, `stopServingRemoteBrowserSession`).
- **Unchanged:** the control-protocol subtypes and the `mcp__`/`internal__` tool names are the same set in both builds.
- **Spawn environment:** `CLAUDE_CODE_DESKTOP_SKILLS_PLUGIN_DIR` is new; Desktop removes any copy of it from the environment it passes and sets its own when it has a value (`WCr`, `index.chunk-BLvpT1n4.js`).
- **Gates:** 65 numeric gate ids are new in `app.asar` and 7 are gone. Only four of the new ones were in the 2026-10-21 fcache. The others are absent, which means each one's code default, not off: depending on the helper, an absent gate reads as off or as the default written beside it, often on.

## Desktop 3.1623.4 (2026-10-22)

The patch release bundles agent 2.1.308 and changes little in Desktop itself. A subagent compared the two builds chunk by chunk; the items below were re-checked here.

- **Unchanged:** the IPC interfaces, the managed-policy keys, the local agent's spawn (its chunk has the same words in the same numbers; only short minified names differ), the scheduled-task code (L243), and the routing of new Cowork tasks with its interface files.
- **Sign-in:** the wait for the browser to return from a sign-in is now 10 minutes (`6e5`), and starting a sign-in again while one is waiting re-opens the sign-in page instead of silently joining it. A third-party deployment's Claude Console sign-in can be taken over after a restart, but that path needs the Windows key store; on macOS the build stores keys with `safe-storage`, so it never runs there. A sign-in that times out now says so instead of showing the generic failure.
- **Fallback models:** the model list built into the app, used when the live one can't be fetched, now defaults to the 5.5 models (`claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`).
- **A new VM image** (published 2026-10-22; contents not checked).
- **Bundled agent code:** the copy of the agent's remote-session code that Desktop carries adds a `checkpoint_done` system message (the agent uploads the events it was holding back and tells the viewer how far the stored transcript reaches, when the server asks with `checkpoint_request`), and its worker socket protocol moves to version 2.
- **Release notes:** v3.1623.4 lists plugins asking before using tools they pre-approve under `allowManagedPermissionRulesOnly`, and local servers in `managed-mcp.json` that use `${VAR}` only in `env` now running under `isLocalDevMcpEnabled: false`; neither was traced in code here.

## Desktop 3.6556.1

The next release (2026-10-22) is in L245. It brings the typed artifacts these reserved keys prepare for: a local Typed Artifact Service with its own tools, offered to interactive host-loop sessions.

## In the official release notes (checked 2026-10-21)

- **Announced:** Storage and `/storage` (as new), the removed "Open external link" confirmation, the local-session and SSH bans from both sources, `releaseChannel` and `quickEntryDefaultShortcut`, the `icon` on managed MCP servers.
- **Not in the notes:** that Storage was already in 2.42304.0, the selected-rows cleanup, the new five-hour resume engine (the feature itself was announced in v1.32352.0), skill scanning, the reserved artifact keys, the cleanup kill switch, the new IPC interfaces, and the device shell's 120-second limit (L215).

## Not traced

- What a failing skill scan blocks.
- Where the `storageDialog` capability comes from.
- The consumers of most of the 65 new gate ids, and of the UI bundle's new `__gb__` ids (1027 → 1128).
