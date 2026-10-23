Updated: 2026-10-23 (L245) | Source: **Claude Desktop `app.asar` 3.6556.1** diffed against **3.1623.4** (both extracted; `.vite/build/`; chunks paired by an identifier-blind skeleton, then the changed pairs diffed), the two builds' UI bundles (`ion-dist`, archived per build), the managed-policy schema diff (`scripts/desktop-policy-schema.js`), and Anthropic's Desktop release notes for v3.6556.1 (dated 2026-10-22), checked 2026-10-23. No live run and no fresh flag-cache decode for this build, so a gate's on/off state is its code default. A subagent did the first pass; every item below was re-read here. Minified names are given with their chunk file, because the same short name is reused across chunks.

# Chapter 75: What Desktop 3.6556.1 Changed

---

## TABLE OF CONTENTS

245. [Lesson 245 — What Desktop 3.6556.1 Changed, Announced and Not](#lesson-245--what-desktop-36556-changed-announced-and-not)

---

# LESSON 245 — WHAT DESKTOP 3.6556.1 CHANGED, ANNOUNCED AND NOT

**Desktop 3.6556.1 keeps agent 2.1.308 and the same VM image, so every change is in Desktop itself. An MCP tool that its server marks as needing a person can now only be approved on the in-app card, and an unattended turn is refused it. The in-code `schedule` skill is gone. Desktop now implements `sshHostCommands`. A local "Typed Artifact Service" brings a new set of tools to interactive host-loop Cowork sessions only. Unannounced: `toolPolicyEndpoint` is removed, and every admin key now records whether a self-hosted session host applies it. The fix for plugins and skills in scheduled tasks was found only on the Code-tab side.**

## Unchanged

- **The pins:** agent 2.1.308 (`sdkWrapperVersion` 0.3.308) and VM image `072b6cbf` (published 2026-10-22), both as in 3.1623.4.
- **The vendored SDK and bridge chunks** are byte-identical apart from the build's release id.
- **The Cowork spawn's plugin and skill handoff** (L244), and **the scheduled-session rules** (L243). Both are re-read in this build under new minified names.

## Person-only MCP tools (announced)

The notes: MCP tools that their server marks as needing a person "ask only on the in-app card … and scheduled tasks go on without those calls."

- **The mark:** a tool whose `_meta` carries `"anthropic/requiresUserInteraction": true` now counts as needing a person (`index.chunk-DCfOtL-w.js`). Desktop already read the mark before; what is new is this rule.
  - The mark counts only for servers whose mark Desktop honours (`honoursPersonOnlyMark`, `index.chunk-CwIoiQq-.js`): any MCP server except the app's own servers and a built-in list.
- **On the card:** the "always allow" choices are dropped, so each call is approved on its own.
- **In an unattended turn:** the call is refused at once, logged as `deny (person-only, unattended)`. A scheduled run whose own turn is continuing (`scheduledRunContinued`) is exempt. Before this build only escalated tools were refused this way.
- **For a server author:** setting the mark on a tool makes a scheduled Cowork task skip that tool rather than wait for a person.

## Plugins and skills in scheduled tasks (announced; Cowork side not located)

The notes: "Fixed Claude not finding your plugins and skills in scheduled tasks and other tasks not open on screen, except in third-party deployments."

- **Code tab (found):** when the remote-plugin state reads `empty-manifest` because the first plugin sync after launch has not finished, Code sessions now wait up to 5 seconds for that sync and read again (`syncBeforeFirstRecord`, `index.chunk-C6IZyYvr.js`, gate `3963759544`). 3.1623.4 read once without waiting. Start timing gains `rpm_first_enabled_state_source`, `rpm_sync_wait_ms` and `rpm_sync_wait_timed_out`.
- **Cowork (not located):** the skills-plugin resolution, the host-loop plugin list and its 120-second sync budgets have the same structure as in 3.1623.4. No change conditioned on a scheduled task or an unopened session was found in the Cowork spawn.
- **Reading this:** linking the Code-tab wait to the release note, and explaining why third-party deployments are excluded (the wait sits behind a gate read with no default, and the org plugin sync it waits on is first-party), are inferences.

## `/schedule` and the `schedule` skill (announced)

- **The skill:** the in-code `schedule` skill is removed from the app's built-in list. The list is now the guided setup (and its former name), `consolidate-memory` and the usage explainer (`index.chunk-BwpRRBAq.js`).
- **The UI:** the onboarding hint "Type /schedule in any existing task" is removed from the UI strings. Per the notes, typing `/schedule` now fills in a scheduling request, like the Schedule button.
- **What stays:** the scheduled-task MCP tools. The UI gains per-action approval cards for creating, updating, deleting and running a task and for reading its history, plus a setting for how many days a scheduled task may reuse a lasting MCP-tool approval.

## `sshHostCommands` (announced)

- **The key** already existed in the vendored Claude Code settings schema: an entry with `id`, `name` and `command`, optionally `sshIdentityFile` and `startDirectory`.
- **New in Desktop:** its implementation, with the `LocalSessions` methods `getSSHHostCommands`, `createSSHCommandHost` and `cancelSSHCommandHost`. It returns no entries on Windows or in a third-party build.
- **Alongside it:**
  - MCP calls through an SSH host (`sshHostMcpCallTool`, `sshHostMcpReadResource`; MCP apps over SSH behind gate `2684344147`);
  - a ProxyJump depth limit of 3;
  - an askpass relay (`CLAUDE_SSH_ASKPASS_RELAY`, `_BROKER`, `_ASKER`);
  - `SSH_SK_HELPER`, `SSH_PKCS11_HELPER` and `SSH_SK_PROVIDER` stripped from an SSH child's environment.

## Typed Artifact Service (not in the notes)

- **The service:** a new local worker, `frame-local-worker` with an HTML-rewriter wasm, runs as "Claude Desktop Typed Artifact Service" (`index.chunk-CI-UZNsz.js`).
- **Its tools:** `db_get`, `db_list`, `db_write`, `create_from_type`, `publish_files`, `list_types`, `describe_type`, `list_files` and `read_file` (`index.chunk-Dpp_oKu-.js`).
- **Who gets them:** only interactive host-loop sessions, meaning sessions with no session type and no scheduled task (`index.chunk-DCfOtL-w.js`). A scheduled run and a Dispatch child (both typed sessions) don't get them, and neither does a VM-loop session (L243).
- **Claude Design** is withheld from a session that has these tools.
- **Connection to the admin keys:** they are the typed artifacts that the five reserved `artifacts*` admin keys (L242) prepare for. Those keys are now stamped as released in 3.1623.0.

## Admin keys

- **Added (third-party, `@next`):**
  - `installedUpdateEnforcementEnabled` and `installedUpdateEnforcementHours` (1–72): third-party and first-party scopes, gate `3141359837`;
  - `quickEntryScreenshotsEnabled` and `quickEntryFileSharingEnabled`.

  All four are in the notes (L237). The notes also list `headersHelperArgs` and `envHelperArgs` inside `managedMcpServers` entries, which are not top-level keys.
- **Removed, unannounced:** `toolPolicyEndpoint`, which was stamped 2.31226.0 and whose description said a self-hosted session host asks it before each tool call. Its UI text is gone too.
- **New on every key, unannounced:** a `selfHosted` annotation on 187 of 196 schema entries, `{execution, why}`. It says whether a self-hosted session host applies the key (`server`, 46), the device does (`client`, 31), the key is only reported (`reported`, 16), or neither (`none`, 94).
- **Organization settings from claude.ai:** `desktopHome` replaces `coworkTabEnabled`, and a feature an admin blocks now reports a per-key fail-closed value.

## Other changes

- **Spawn environment:** a Cowork session started with a project selected now gets `CLAUDE_CODE_ATTRIBUTION_PROJECT`, first-party only (`index.chunk-DCfOtL-w.js`).
- **Control channel:** the Code tab builds an `mcp_call` request with a deadline and `result_not_for_model: true`, a field absent from 3.1623.4.
- **IPC:**
  - new: the `claude.artifactShell` namespace, a transcript-for-report reader (gate `632367876`), remote-browser and preview controls under `Launch`, `getSessionList`, `WindowState`, and creating Simulator devices;
  - removed: `AppConfig.setAppFeature`, which a page could call to request an app feature.
- **The skills manifest:** a manifest that can't be used is moved aside as `.corrupt` and rebuilt, and held skill scans gain a repair pass.
- **Worktrees:** new Code worktrees verify their copied startup files, with a kill switch (gate `1934689456`).
- **Gates:** 17 numeric gate ids are new and one is gone (`2841250005`, in the remote-plugin sync).

## In the official release notes (checked 2026-10-23)

- **Announced and traced above:** person-only MCP tools, the scheduled-task plugin fix (Code side only), `/schedule`, `sshHostCommands`, and the four admin keys.
- **Announced, not traced:** the `allowedWorkspaceFolders` changes for SSH hosts and `%VAR%` entries, per-host permission modes, the iOS Simulator keys and rotation, and the bug fixes.
- **Not in the notes:** the Typed Artifact Service and its tools, the removal of `toolPolicyEndpoint`, the `selfHosted` annotation, `CLAUDE_CODE_ATTRIBUTION_PROJECT`, `setAppFeature`'s removal, worktree file verification, and the corrupt-manifest rebuild.

## Not traced

- A Cowork-side change behind the scheduled-task plugin fix, if there is one.
- The on/off state of the new gates; no flag cache was decoded for this build.
- What gates `1936069307`, `2369932081` and `592261068` control. Near `592261068` the build sets agent-version floors 2.1.268 and 2.1.283.
- Where `resources/office365-mcp` went: it is missing from the extracted archive, but the code still loads a file from it.
