Updated: 2026-10-15 (L237) | Source: Anthropic's Claude Desktop release notes and configuration changelog for v1.32352.0 (2026-08-17) through v2.37337.1 (2026-10-13), read 2026-10-14; the managed-policy schema in Desktop `app.asar` 2.37337.1 (`.vite/build/index.pre.js`), with each key's introducing build from the schema's own stamp; and a code read of how Desktop 2.37337.1 applies six of the keys. Behavior marked "per the notes" was not checked in the code.

# Chapter 67: Desktop Admin Controls Added August–October 2026

---

## TABLE OF CONTENTS

237. [Lesson 237 — The Managed-Configuration Keys Desktop Added from August to October 2026](#lesson-237--the-managed-configuration-keys-desktop-added-from-august-to-october-2026)

---

# LESSON 237 — THE MANAGED-CONFIGURATION KEYS DESKTOP ADDED FROM AUGUST TO OCTOBER 2026

**Between Desktop 1.37937.0 and 2.37337.1 an organization's administrator gained keys that change what Claude is told, which plugins load, which permission modes and files are reachable, where traffic goes, how long sessions are kept, and how scheduled tasks reuse approvals. Most apply only to third-party deployments (custom inference: Bedrock, Vertex, Foundry, a gateway); a few also apply to claude.ai organizations managed by device profile. Before blaming a skill or plugin for behaving differently on one organization's machines, check which of these keys that organization sets.**

## Reading a key's reach

Every key below is an entry in Desktop's managed-policy schema (Ch66/L236 explains the entry's fields). Two fields decide who it affects:

- `scopes`: `3p` is a third-party deployment. `1p` is a claude.ai organization whose Macs or PCs carry a managed profile. A key with only `3p` does nothing on a claude.ai organization.
- `readers`: the clients that apply the key. `desktop,code` means Desktop also hands the key to the Claude Code agent it runs, so it shapes the agent's own settings.

The "since" column is the build in the key's `availableInVersion` stamp (2.37337.1 schema).

## What Claude is told

| key | since | scopes | effect |
|---|---|---|---|
| `organizationInstructions` | 1.37937.0 | 3p | Up to 3,000 characters (trimmed; schema `min(1).max(3e3)`), appended to the system prompt in Chat, Cowork and Code |

How it reaches the model (CODE-READ, 2.37337.1):
- **Placement:** Desktop appends the text to the Agent SDK system prompt (`preset: "claude_code"`, `append`), inside `<organizationInstructions>…</organizationInstructions>`.
- **The preamble:** it tells the model these are the administrator's instructions, that it must follow them, and that they take priority over the user's own preferences.
- **Tag escaping:** a closing tag inside the administrator's text is defused with a zero-width space, so the text can't end the block early.

The notes call it guidance, not an enforced control. For a skill author this is a second system-prompt source you don't see: on such an organization the model may refuse or reshape a step your skill asks for because of an instruction that appears nowhere in your test runs.

## Which plugins load

| key | since | scopes | effect |
|---|---|---|---|
| `userPluginMarketplacesEnabled` | 1.37937.0 | 3p | `false`: members can't add their own marketplaces. From 2.16120.0 also hides marketplaces the organization didn't provision, refuses installs and updates from them, and sessions load plugins only from organization sources, app uploads and the user's skills folder; nothing is deleted (per the notes) |
| `userPluginUploadsEnabled` | 1.37937.0 | 3p | `false`: members can't upload plugins |

In the code both default to allowed: anything but an explicit `false` leaves the door open. Removing the organization's plugins endpoint from the configuration uninstalls the plugins it installed, as removing a marketplace already did (v1.32885.1, per the notes).

## Permission modes and file reach

| key | since | scopes | readers | effect |
|---|---|---|---|---|
| `disableBypassPermissionsMode` | 1.46388.1 | 3p | desktop,code | Removes bypass mode from Code and Cowork |
| `blockReadsOutsideWorkingDirectories` | 1.46388.1 | 3p, 1p | desktop,code | File tools read only the session folder and `allowedWorkspaceFolders`; sandboxed shells lose the home folder (per the notes) |
| `allowedWorkspaceFolders` | older (1.2581.0) | 3p, 1p | desktop,code | Gained reach in this window: limits which of a project's folders Chat can read (2.19675.1), and its read-only entries are enforced for file tools in SSH sessions except on Windows hosts and hosts with their own Claude Code managed settings (2.31226.0), per the notes |

How the first two reach the agent (CODE-READ, 2.37337.1):
- **`disableBypassPermissionsMode`:** on a third-party deployment set to `true`, Desktop writes `disableBypassPermissionsMode: "disable"` into the managed settings it gives the agent.
- **`blockReadsOutsideWorkingDirectories`:** Desktop writes `permissions.blockReadsOutsideWorkingDirectories: true` there too. It needs an agent of at least 2.1.257; with an older one Desktop reports the state `cli-too-old` instead of applying it.

## Network

| key | since | scopes | effect |
|---|---|---|---|
| `egressProxyUrl`, `egressProxyPacUrl` | 1.44121.1 | 3p, 1p | Route egress through a fixed proxy or a PAC file instead of the OS proxy. The PAC file wins when both are set. Cowork's workspace follows it on macOS and Windows. Read only from device management or a local file, never from a bootstrap URL (per the notes) |
| `skipWebFetchPreflight` | 1.37937.0 | 3p | Code sessions stop contacting api.anthropic.com to check a domain before a fetch (per the notes) |
| `coworkVmIpv6Enabled` | 1.52386.0 | 3p | Gives the Cowork VM IPv6; `coworkEgressAllowedHosts` still decides which hosts are reachable (per the notes) |

## MCP tools and scheduled tasks

| key | since | scopes | effect |
|---|---|---|---|
| `mcpToolTimeoutSec` | 1.37937.0 | 3p | An MCP tool-call timeout, an integer from 60 to 3600 seconds |
| `mcpScheduledTaskApprovalLifetimeDays` | 2.7032.0 | 3p | How long a scheduled task may reuse a lasting "always allow" for an MCP tool, 0 to 3650 days. The lasting option is offered even when persistent approvals are otherwise off; `0` removes it (per the notes) |

`mcpToolTimeoutSec` reaches the agent as the environment variable `MCP_TOOL_TIMEOUT`, in milliseconds (CODE-READ). When the key is unset Desktop sets nothing and the agent's own default applies (180 s per the notes). This is the agent's timeout. The 180 s per call in Ch65/L233 is a separate constant in Desktop's cloud MCP bridge, and whether this key reaches it was not traced.

## Sessions kept on the device

| key | since | scopes | effect |
|---|---|---|---|
| `chatSessionRetentionDays`, `coworkSessionRetentionDays`, `codeSessionRetentionDays` | 1.52386.0 | 3p | Delete idle sessions, with their files, from the device after N days (the form suggests 90) |
| `sessionRetentionHold` | 1.52386.0 | 3p | A legal hold that suspends that deletion |

In the code the hold wins over every period (CODE-READ). For forensics this matters: on such a deployment the on-disk transcripts and session records the Cowork lessons read (Ch37/L129–L132) can be gone by policy, not by a bug.

## Updates, restarts and the rest

| key | since | scopes | effect (per the notes) |
|---|---|---|---|
| `relaunchEnforcementHours` | 1.40609.0 | 3p | Forces a restart after served configuration changes (0–336 hours; unset means 1 hour). From 1.46388.1 it also covers configuration changed by device management |
| `configRecheckIntervalMinutes` | 1.46388.1 | 3p | How often managed configuration is re-checked; the default went from 30 to 10 minutes |
| `disableAutoUpdates` | older (1.2581.0) | 3p, 1p | From 2.26454.0 also decides whether Cowork's workspace image downloads in the background (unless `true`) instead of at the first task |
| `isClaudeCodeForDesktopEnabled` | older (1.2581.0) | 3p, 1p | From 1.44121.1, `false` also blocks Code sessions requested directly, Preview's dev-server scan and offering the computer for Remote Control ("Code sessions are turned off by your organization") |
| `builtinBrowserEnabled`, `builtinBrowserDefaultDomainPolicy`, `builtinBrowserAllowedDomains`, `builtinBrowserBlockedDomains` | 2.2553.0 | 3p | Allow the built-in browser for Cowork and Code, and set its site policy |
| `claudeAiImport` (`allowedOrganizationUuids`, `automatic3pImport`) | key 1.10628.0; these fields 2.26454.0 and 2.31226.0 | 3p | Limit history import to listed claude.ai organizations (sign-in only; file import off), and import automatically: Cowork artifacts, projects, memory, global instructions, scheduled tasks, uploads, skills and plugins, applied without asking except a project's own instructions (the code side of the import is Ch64/L231) |
| `keepAwakeEnabled` | 2.7032.0 | 3p | Keep the computer awake for scheduled work |
| `defaultModelEffort`, `alwaysStartWithDefaultModel` | 2.110.0 | 3p | An organization default for effort, and starting every session on the default model |

## For a skill or plugin author

- **Hidden instructions.** On a third-party deployment the model may carry `organizationInstructions` you never see. If a step behaves differently on one customer's machines, ask whether that organization sets them.
- **No bypass mode.** A workflow that assumes bypass mode is unavailable where `disableBypassPermissionsMode` is set. Design for Ask or Auto.
- **Reads outside the folder.** Where `blockReadsOutsideWorkingDirectories` is on, reading anything outside the session folder and the allowed folders fails. That includes the home folder and a plugin's files read by an absolute host path. Ship what you read with the plugin.
- **Your plugin may not load.** Where user marketplaces are off, a plugin installed from your marketplace doesn't load. Organization distribution is the only route there.

## For an admin

- **Check the scopes first.** Most of these keys apply only to third-party deployments. A claude.ai organization gets only the `1p` ones: `blockReadsOutsideWorkingDirectories`, `allowedWorkspaceFolders`, the two egress-proxy keys, `disableAutoUpdates` and `isClaudeCodeForDesktopEnabled`.
- **Check the agent version.** `blockReadsOutsideWorkingDirectories` does nothing on an agent older than 2.1.257.
- **A hold costs disk.** A retention hold keeps every session on the device until it is lifted.

## Not established

What each key does was checked in the code only where marked CODE-READ: `organizationInstructions`, the two plugin keys' defaults, `disableBypassPermissionsMode`, `blockReadsOutsideWorkingDirectories`, `mcpToolTimeoutSec` and the retention hold. The rest is from Anthropic's notes. None was set on a test machine. Which keys an organization actually sets can't be seen from a lesson. On a managed Mac, read the profile, or the configuration a third-party deployment loads.

---
