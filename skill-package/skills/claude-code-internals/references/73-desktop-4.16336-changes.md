Updated: 2026-11-05 (L246–L248) | Source: **Claude Desktop `app.asar` 4.16336.0** diffed against **3.6556.1** (both extracted; chunks paired by an identifier-blind skeleton, then string and token diffs), builds 3.6556.2, 4.29.0 and 4.4212.0 to date each change, the UI bundle in `ion-dist.asar`, the managed-policy schema diff, the bundled agent 2.1.317, Anthropic's Desktop release notes through v4.16336.0 (dated 2026-11-03), checked 2026-11-05, and the flag cache decoded on 2026-11-05 on a first-party Team account. Every claim is a read of the macOS build unless it says otherwise, and nothing here was run in a live session. Windows-only branches are compiled out of this build, so Windows rules are marked as such.

# Chapter 76: What Desktop 4.16336.0 Changed

---

## TABLE OF CONTENTS

246. [Lesson 246 — What Desktop 4.16336.0 Changed, Announced and Not](#lesson-246--what-desktop-416336-changed-announced-and-not)
247. [Lesson 247 — The Admin Keys and Connector Options Added in Desktop 4.x](#lesson-247--the-admin-keys-and-connector-options-added-in-desktop-4x)
248. [Lesson 248 — The Code Tab in Desktop 4.x: SSH Environment, Hooks, Auto Mode and Dev Servers](#lesson-248--the-code-tab-in-desktop-4x-ssh-environment-hooks-auto-mode-and-dev-servers)

---

# LESSON 246 — WHAT DESKTOP 4.16336.0 CHANGED, ANNOUNCED AND NOT

**Desktop 4.16336.0 moves to agent 2.1.317 on the same VM image. The UI bundle now lives in a sealed `ion-dist.asar`, so a search of the old folder finds nothing. The built-in browser reports per-site load outcomes to Anthropic. Connector tools can be renamed from uuid names to stable keys, though that is off here. Earlier connector approvals stop counting under a managed-rules lock. Opening macro-capable files asks first. The typed-artifact tools turn out to be third-party only.**

## The pins

| Build | Agent | `sdkWrapperVersion` | VM image |
|---|---|---|---|
| 3.6556.1, 3.6556.2 | 2.1.308 | 0.3.308 | `072b6cbf` |
| 4.29.0, 4.4212.0 | 2.1.309 | 0.3.309 | `072b6cbf` |
| 4.16336.0 | 2.1.317 | 0.3.317 | `072b6cbf` |

`BEt()` looks like an image id but belongs to the SSH manager (storage `claude-ssh-remote`). It moves from `be1c1ca5` to `b3081b51` in 4.16336.0, and it is not the VM image.

## Where the UI bundle went

- **The move:** from 4.29.0 the code loads `Resources/ion-dist.asar` when packaged. `Resources/ion-dist/` survives with only a stub `index.html`, kept for older running versions, so **a grep of that folder now finds nothing**. Extract the asar before searching UI strings. Older lessons that name `ion-dist/` describe the earlier layout.
- **The seal:** `Info.plist` `ElectronAsarIntegrity` lists both `app.asar` and `ion-dist.asar`, and the recorded header hashes match both files. The `app://` handler insists on a regular file, so a directory put at that path is refused and no page is served. What Electron does with a tampered file was not tested.
- **Why `app.asar` grew** (52.6 MB to 79.8 MB): mostly `resources/frame` (+24.8 MB), the typed-artifact shell, runtime and types. The runtime is the former `ion-dist/_frame-rt`. Then `resources/i18n` (+4.3 MB). Most new chunks over 30 KB are older chunks split up, so a new chunk is not evidence of a new feature.

## The built-in browser reports load outcomes (not in the notes)

New in 4.4212.0 (`index.chunk-C9iXV3l-.js`).

- **What is sent:** a POST to `/claudeai-rpc/anthropic.claudeai_edge.v1.ClientMetricsService/ReportMetrics` with `{top_site_loads:[…]}` and the account's bearer token.
- **A row:** `site`, `status`, `failed`, `maybe_captcha`, `maybe_login`, `got_in_later`, `got_in_by`, `count`. `got_in_by` says who cleared a block: `person`, `claude`, `itself` or `person_or_itself`. The captcha and login marks come from patterns on the page title.
- **What it covers:** only hosts on a built-in list of about 10,000 (`TOP_SITES`), reported as the matched hostname, for loads Claude asked for in the browser pane, plus same-tab follow-ups on that site for 5 minutes. Full URLs and titles are not in the row.
- **Conditions:** gate `1766199337` (on, by force, on this account), non-essential telemetry not disabled, the org holding the `third_party_analytics` capability, not HIPAA, not restricted mode, and the account and org matching. That capability is an org entitlement read from the access list, not a per-person prompt.
- **Not settled:** whether this account's org holds the capability, so whether rows actually leave this machine was not observed.

## Connector tools can change name (off here)

New in 4.16336.0, class `To` in `index.chunk-5BS-c_bO.js`, logged as `[ConnectorWireBoundary]`.

- **What it does:** rewrites `mcp__<uuid>__tool` to a key derived from the connector's URL, both ways, across spawn options, permission calls, hooks and rules. Collisions get `-a<hash>`. The names are saved with the session and copied to a branch.
- **When:** gate `52253313` on (absent from this cache, so off), agent 2.1.301 or newer, not SSH or WSL, and a new session. A resume with no saved names stays on uuid names, and with the gate off a session holding names goes back to uuid names.
- **The fallback:** uuid names stay if settings for the folder contain uuid-shaped rules or hook matchers (the check leaves out `permissions.allow`), if the install has diverged, or if settings can't be read.
- **What it would break, where the gate is on (inferred, not probed):** a plugin `hooks.json` matcher on a uuid name isn't in settings, so nothing triggers the fallback and the hook stops firing without an error. A `permissions.allow` entry on a uuid name stops matching, and the call asks. Skill text that names `mcp__<uuid>__` goes stale.
- **`CLAUDE_CODE_DESKTOP_CONNECTOR_NAMES=1`** is a separate path: Code-tab sessions only, attended, no SSH, gate `1420990291`, which reads as `connectorToolsAskFirst`.

## Connector approvals and file references (not in the notes)

- **Managed-rules lock:** with `allowManagedPermissionRulesOnly` on, an earlier approval no longer admits a connector call; the mode or a card decides (`rulesLocked`, `[mcpToolCallGate]`). If the lock can't be read within 5 seconds it counts as on. Gate `781221254` keeps this on unless served off.
- **File by reference:** Desktop can read a local file and put it into a Drive or Gmail connector call for the model. The first reference to a file asks the person, and the approval is bound to the file's hash. The check runs inside the `mcp__.*` PreToolUse hook from 4.29.0. Gmail is new here (`lam_gmail_host_fill`, `gmailmcp.googleapis.com`) and is refused when nobody can be asked or in a dispatched task. VM scratch paths are refused, with an error telling the model to copy the file to the outputs folder first. The gate behind Gmail was not resolved, so it may be off.

## Files Desktop now asks about before opening (not in the notes)

`[sessionOpenConsent]`. A session file with a macro-capable extension, a list of about 70 that takes in plain `.doc`, `.xls`, `.ppt`, `.odt` and `.ods` as well as `.docm` and `.xlsm`, gets an Allow dialog. A name with hidden or right-to-left characters is refused outright. After Allow, Desktop re-checks the inode, size, times and web-origin mark and refuses if the file changed. So a skill that hands the person an Office file adds a prompt. Kill gate `4127301062` is absent, so the check is on.

## Typed-artifact tools

- **Third-party only:** `create_from_type`, `publish_files` and the rest need at least one enabled artifact type, and the check returns false unless the deployment is third-party. So a first-party session never gets them. Of 1,010 `audit.jsonl` files from first-party Team sessions on this Mac, none names `create_from_type`, against 586 naming `save_skill`.
- **Which sessions in a third-party deployment:** host-loop, not scheduled, with no session type or type `chat` (from 4.29.0).
- **`db_write` always throws.** It stays declared and the prompt says it refuses every call. `list_typed_artifacts` is new in 4.4212.0.
- **Don't confuse** with `CLAUDE_CODE_COWORK_FRAME_ARTIFACTS=1`, which comes from `frameArtifactsEnabled`, a different switch that allows scheduled runs.
- **Approvals:** these tools' notifications get no Allow-once. Their rules can't be stored, and a scheduled run's auto-approve refuses the family.
- **Two hidden tool names:** the allowlist also admits two names held only as sha256 (lengths 15 and 20), carried over from 3.6556.1. They are never pre-approved: rules naming them can't be stored and an `allow` is forced back to ask. What they are is unknown.

## Spawn changes

- **Scheduled runs:** the env object gains `CLAUDE_CODE_DISABLE_FILE_MENTIONS=1` beside `CLAUDE_CODE_HOST_SCHEDULED_RUN=1`, from 4.29.0. `startSession` now drops a caller-supplied `scheduledTaskId` the session's record does not hold.
- **New env names:** `CLAUDE_CODE_HOST_GUARDS_ARTIFACTS_MCP=0` beside `CLAUDE_ARTIFACT_HOST_GRANT`, `CLAUDE_CODE_HOST_OFFERS_DEVICE_MCP`, `CLAUDE_CODE_HOST_SHORT_TEMP_DIRS=1`, `CLAUDE_CODE_DISABLE_ULTRATHINK`. Third-party spawns get `CLAUDE_CODE_UPFRONT_TOOLS=Monitor`. This list is what was read, not a full env diff.
- **Plugins:** `CLAUDE_CODE_PLUGIN_ATTRIBUTION` carries claude.ai plugin ids. The agent ignores it above 65,536 bytes, and then plugins that managed settings enable by marketplace won't load. `CLAUDE_CODE_PLUGIN_DIRS` in a person's settings env now tells Desktop which installs those folders replace on an SSH host.
- **Per-session MCPB cache:** from 4.29.0 each plugin mount gets its own writable `.mcpb-cache`, backed by `<session>/.vm-mcpb/<hash>` and marked optional (L139). The VM image's guest code accepts `optional`. Whether a real session mounted it was not observed.
- **Unchanged:** the `tools` and `allowedTools` lists are token-identical. L243's scheduled-session rules and L244's plugin handoff were re-read under new names and hold, apart from the items above. Not re-read: the forced permission mode, the `schedule` skill, and the VM-loop path rewrite.

## Also new, not in the notes

- **Zero data retention:** `[sessionTextPolicy]`, in 4.16336.0. About hourly, Desktop checks `/api/account` for `taint:claude_code_zdr` on any of the account's orgs. If found, Claude Code error text is left out of usage events and Sentry is blocked, and the result persists.
- **Split OAuth credentials (built, off):** an "everyday" token beside the Remote Control one that carries `user:sessions:claude_code`. When on, the local spawn keeps the everyday token and the CLI asks for the sessions token by kind (`CLAUDE_CODE_SESSIONS_OAUTH_TOKEN`). Its lifetime follows the org's session length, or a year if the org sets none. Gate `2575231602` is off here.
- **MCP App widgets in a native view:** `mcpAppView.js`, `McpAppViews` IPC, `claude-mcp-app:`. A sandboxed view with network cut, at most 3 at a time, only where a self-hosted session host reports `passesMcpAppPages`. Not the first-party path, so L105's no-`tools/call` finding stands. `mayUseMcpAppView` in the UI was not traced.
- **Scheduled-task prompt text:** gate `1966121882` (`{start_hour:6,end_hour:9}`, on) feeds model-facing text saying tasks may later move to the cloud and that runs starting in that Pacific window can be delayed. A sign of direction, not a shipped move.
- **Preview certificates:** the preview pane can accept an untrusted certificate on `localhost`, `*.localhost`, `127.0.0.1` or `::1`, stored per host, port and fingerprint for the browser session (`[PreviewCertificates]`). Kill gate `1533230508` is absent.
- **Code-tab deletion requests (built, off):** `/api/account/claude_code_desktop/session_deletions`, gate `2474107749` off, held while off.
- **Windows MSIX migration:** `[modern-installer]`, gate `1373298314` absent. Not exercised.
- **Moved gate:** `4074604942` (`1pDirectMcpPool`) went from off to on. It arms a local pool only if `managedMcpServers` holds a Microsoft 365 entry, so it does nothing on other machines.
- **Gates:** 131 ids are new. Only `1766199337` and `1966121882` are on for this account, 11 more are present and off, and 119 are absent. Most are SSH, git, worktree and simulator kill switches.

## Removed

- **Chrome shortcut tools:** gone from Desktop's tool array in 4.16336.0, and refused inside `browser_batch` too. The strings that remain are telemetry and labels, so a string count misleads. The standalone CLI's extension still lists them.
- **Gates:** `3469616823` (skill-creation access bypass), `480673358` (outer kill for `CLAUDE_CODE_HOST_WORKTREE_FENCE`; the darwin kill `2222745432` remains), `1731450842`.
- **`claude-ios-sim.sb`:** no `.sb` ships now; the profile is passed inline to `sandbox-exec -p`.
- **Model-facing preview IPC:** `previewSnapshot`, `navigatePreviewFromModel`, `callRemoteBrowserTool`.

## In the official release notes (checked 2026-11-05)

- **Announced and read in code:**
  - Skip all approvals and Auto follow the org's Cowork setting (`coworkOrgSkipApprovalsEnabled`, `coworkOrgAutoModeEnabled`), checked at start, on a mode change and before the next message, falling back to manual approval. Kill gate `2526291435`.
  - Reset App Data sends deletions first to `/api/account/cowork/session_deletions`, refused under HIPAA, Claude Code ZDR or too many orgs. The menu item is now Delete Cowork Data and Restart.
  - Stop now reaches a shell command, with "bash not run" and "bash ended" results.
  - HTML and SVG previews get a CSP `sandbox` without `allow-modals`.
  - Scheduled web fetch: in Auto and Skip all approvals modes URLs are added to the task's allowed set. An attended continuation of a scheduled task can get a card, where before none could. WebSearch results count as a source only when the CLI runs on this host or gate `1666705513` is off.
  - A deletion that can't complete keeps the task.
- **Announced, not located:** a project's message starting a Cowork task under Unified Claude, the hung-preview fix, and the "run can't start" notification.
- **Dates and admin keys:** see L237 and L247.

## Not traced

- The path that seeds a scheduled task's instructions as allowed URLs, and how the third-party exclusion is applied.
- The live state of every gate listed as absent, on any other account.
- `smol-bin.arm64.img` (no baseline to compare), `app.asar.unpacked`, and flags inside the UI bundle.

---

# LESSON 247 — THE ADMIN KEYS AND CONNECTOR OPTIONS ADDED IN DESKTOP 4.X

**Seven keys were added and none removed (196 to 203). `deploymentMode` is read now even though its stamp says `@next`, and `1p` overrides deployed third-party keys. `sessionStatusLine` runs a root-owned program. A key past its deprecation date stops counting as managed, which can reactivate a server configuration. `toolTimeoutSec` may not do what the notes say.**

## New keys

| Key | Stamp | Effect |
|---|---|---|
| `deploymentMode` | `@next`, read here | See below |
| `sessionStatusLine` | 4.4212.0 | See below |
| `projectsEnabled` | 4.4212.0 | `false` makes creating a project refuse with a warning. Applied without a restart |
| `inferenceTokenWarningPercent` | 4.29.0 | 1–100, default 75. Warning at that share of the token limit |
| `inferenceGatewayAutoModeServerChecks` | `@next`, read here | On a gateway in third-party mode, sets `CLAUDE_CODE_AUTO_MODE_SERVER`. The notes call it temporary, and it sends session details such as folder paths and a user name to the provider |
| `mcpAppWidgetsEnabled` | 4.4212.0, undocumented | Schema only, no Desktop reader: for a self-hosted host |
| `userFileUploadsEnabled` | 4.29.0, undocumented | No reader in Desktop's main process; the host refuses and tells Desktop to disable attaching |

## `deploymentMode`

- **Values:** `any`, `3p`, `1p`. Device management or a local file only; a value from a bootstrap server is ignored.
- **`1p`** beats deployed third-party keys. **`3p`** alone doesn't force third-party mode; it still needs an activating configuration. **`any`** behaves as unset: nothing locks.
- **Any value other than `any`**, or `disableDeploymentModeChooser` not false, makes the hybrid admin-console pointer ignored.
- **Older builds** read only `disableDeploymentModeChooser`, so for `3p` set both until devices update.
- **Trap:** a separate user setting with the same name holds the person's choice. It isn't the managed key.

## `sessionStatusLine`

One line above the message box in Cowork, Chat and Code, printed by a program Desktop runs.

- **Shape:** `command`, a file path, and `platformOverrides` with `win32`, `darwin`, `linux`. An older build rejects the whole setting when `platformOverrides` is present.
- **macOS check:** absolute and normalized, on the boot or Data volume, not under `/home`, `/net`, `/Volumes` and similar. The file and every parent must be owned by root with no group or other write. Symlinks must be root-owned, and the real path is checked again. Windows and Linux checks weren't read.
- **Limits:** check cached 60 seconds, run timeout 10 seconds, 64 KiB output, 300 ms debounce, at most 4 sessions and 10 runs per 10 seconds.
- **Environment:** filtered (`NODE_*`, `PYTHON*`, `GIT_*`, `LD_*`, `DYLD_*`, `ANTHROPIC_*`, `CLAUDE_*` and more dropped), `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, cwd `/`. Stdin is JSON: `{session_id, model:{id,display_name}}`.
- **With pricing on and no status line,** the slot shows a session cost estimate.

## `managedMcpServers` entries

- **`defaultState`** (`on`, `off`, remote entries): an invalid value becomes `off` with a warning. The person's own switch is kept per connector.
- **`oauth.omitResource`:** needs a client ID, one resolvable sign-in server, and a scope with at least one non-OIDC name. `openid`, `profile`, `email`, `address`, `phone` and `offline_access` don't count.
- **`platformOverrides`** (local, remote, web search): every OS's paths are validated on every OS, so one bad value drops the entry everywhere.
- **`toolTimeoutSec`** (5–3,600): the notes say it replaces `mcpToolTimeoutSec` for that server. The one reader found is on remote entries and only raises a floor: the effective value is `max(floor(global), floor(perServer))`, where a floor is at least 300 seconds. No reader was found for local entries. Measure it before relying on it, especially to shorten a timeout.
- **The GitHub connector** (github-mcp-server v2.0.2): the forced-ask set adds `pull_request_review_write` and `delete_repository`. The notes name only the first. Forced tools take the stricter of ask and policy, so blocked stays blocked and allow becomes ask. Read tools go from 54 to 57, write tools from 30 to 35.
- **Microsoft 365:** the saved sign-in is keyed by client ID, tenant ID, cloud and the CAE setting.
- **`inferenceModels[].behavesAs`:** names the model behind an alias, for effort levels and limits.

## Rules that changed

- **A key past its deprecation date,** such as `organizationPluginsUrl`, is ignored rather than a configuration error, and no longer counts as managed. A device profile holding only such keys is treated as no profile, so a served configuration applies again, with its retention periods (consequence read from the notes).
- **Code-tab egress:** with `coworkEgressAllowedHosts` unset, `blockReadsOutsideWorkingDirectories` off, and only a local configuration file, the Code tab now passes no allowlist, so shell commands reach the network (`codeTabEgressPolicy`). An empty list still allows no host. It fails closed if a managed source exists and can't be read. Cowork is unchanged.
- **`forceLoginOrgUUID`:** a Console sign-in outside the list logs a warning. Enforcement is built and held by one constant.
- **Provider API keys** are sealed where the computer has secure storage (`__sealed__:v1:`), and sealed values are refused in managed configuration.
- **HTTP 402** and billing-error text show "Billing issue".
- **Disabling tools:** `Bash` in `disabledBuiltinTools` also disables `Monitor`. `Monitor` alone turns off just it.
- **Computer policy beside server settings** (first-party only): `disableBrowserExternalNavigation`, `browserExternalPageTools` and `remoteControlAtStartup` from the device apply even with admin-console settings. A read failure fails closed. `disableBrowserCertificateExceptions` is new on the same path and not in the notes.
- **The skill scan** passes `organizationInstructions:"omit"`, so the scan's model call doesn't carry them. `skillScanningEnabled` now also covers marketplace plugins on the host, and is documented.

## Not traced

- `toolTimeoutSec` on local entries.
- The fix that leaves out a device's same-named server (`managed-mcp.json`): the mechanism wasn't found.
- Whether `disableNonessentialTelemetry` still blocks diagnostic uploads: its description dropped that line.
- The `NODE_EXTRA_CA_CERTS` fix, and "refused where no prompt" for forced GitHub tools.

---

# LESSON 248 — THE CODE TAB IN DESKTOP 4.X: SSH ENVIRONMENT, HOOKS, AUTO MODE AND DEV SERVERS

**SSH and WSL sessions now filter what they take from the local environment by value as well as name. Without Git Bash on Windows, a sync hook on `PreToolUse` or `PermissionRequest` blocks on any failure. `$defaults` behaves differently once Desktop sends its own auto-mode lists. Dev servers need approval unless the sandbox is strict. `ccd_pr` gives Code sessions PR and auto-merge tools.**

## What SSH and WSL take from your environment

From 4.29.0. In order:

1. **Never:** a denylist of named keys, anything ending `_FILE_DESCRIPTOR`, the prefixes `CLAUDE_DESKTOP_`, `CLAUDE_DEV_`, `CLAUDE_E2E_`, `CLAUDE_SSH_`, `CLAUDE_SIM_`, and OTLP certificate names.
2. **Outside the namespace, never:** the namespace is names starting `CLAUDE_`, `ANTHROPIC_` or `DISABLE_`, plus `ENABLE_TOOL_SEARCH`.
3. **Sent if the value differs from Desktop's own `process.env`,** meaning Desktop or a setting put it there.
4. **Otherwise sent only if the value is safe:** a number (unless the name ends in `_PORT`, `_PID`, `_FD`, `_KEY`, `_TOKEN`, `_SECRET`, `_PASSWORD` or `_PASSPHRASE`), a boolean word, or a value of a listed name such as `ANTHROPIC_MODEL` or `ANTHROPIC_DEFAULT_*_MODEL`.
5. **Providers:** for a switched-on provider, ids such as project and region go; base URLs and API keys stay unless saved.

Anything saved under an environment's Environment variables goes, whatever its name. Global saved variables go only inside the namespace. A withheld name shows in the transcript. Kill gate `1751199319` is absent, so the rule is active.

## SSH transport

- **OpenSSH was already the default on Mac and Linux** (gate `3946462706`, unchanged in this range). The breaking change is Windows-only, and that branch is compiled out of this build, so the rule below is read from strings and shared code.
- **Windows:** `sshTransport` is `auto`, `system-openssh` or `builtin`. A host that connected on the library stays on it (`host_kept`), and a PuTTY `.ppk` uses the library. The client must be Microsoft OpenSSH 9.4 or newer. Another OpenSSH of 8.5 or newer is accepted only when machine policy sets both keys and a trial proves arguments arrive whole.
- **`sshClientPath` with `%LOCALAPPDATA%\`** (4.4212.0): only where HKLM sets both keys, as `REG_SZ`, an `.exe`, with Claude not elevated in any way and no junction out of the folder. On failure nothing stands in.
- **Two sign-ins:** without connection sharing, file access opens its own connection. On a Mac that happens only after a `MaxSessions` refusal, remembered for 7 days.

## Hooks without Git Bash

The rule lives in the agent, not Desktop (agent 2.1.317; not run on Windows).

- **When:** Windows without Git Bash, on `PreToolUse` or `PermissionRequest`.
- **Rule:** a sync command hook with no `args` and no `"onFailure":"continue"` **blocks the call on any failure**: could not start, timed out, or exit other than 0 and 2. Setting `shell` makes no difference. The default of continuing doesn't apply.
- **Quoted-only commands** are just the case that always fails (exit 127), so the notes describe them as a separate change.
- **To avoid it:** add `args` (exec form, no shell), or `"onFailure":"continue"`, or install Git for Windows.
- **`onFailure`** is ignored for async hooks and on `Stop`, `SubagentStop`, `TaskCompleted` and `TeammateIdle`.

## Auto-mode lists and `$defaults`

The mechanism is in the agent from 2.1.316. The sources are user, flag and managed settings. `soft_deny`, `hard_deny` and `environment` are joined; `allow` is kept per source. The built-ins survive while any joined list holds `$defaults`.

Desktop sends a flag list with a leading `$defaults` for `environment`, `soft_deny` and `allow`. So in Desktop sessions:

- A managed `soft_deny` or `environment` **adds**, because Desktop's own list carries the sentinel.
- A managed `allow` without `$defaults` strips it from Desktop's flag list, so **the 16 replaceable built-in exceptions go**; Desktop's own added entries stay, and so does "Scheduled-Task Fires", which sits outside the replaceable slot (L252).
- A managed `hard_deny` without `$defaults` still **replaces** the built-ins, because Desktop sends no `hard_deny` (inferred from the three pieces together). L239 counted one built-in rule on 2.1.302.
- An unreadable managed `autoMode` drops the sentinel too.

A plain CLI session has no flag list, so a list you set replaces the built-ins there (L239).

## Dev servers from `launch.json`

From 4.4212.0, a mode that waives approval no longer waives it for a dev server when the session has a **strict** sandbox (`sandbox.enabled` true and `allowUnsandboxedCommands` false) or when managed `permissions` deny or ask on Bash. A timeout or unreadable rules keep the card. A sandbox that allows unsandboxed retries doesn't count.

Not in the notes (4.16336.0): in a session started over Remote Control, such a start is refused with "The dev server was not started" until a person presses Run. Gate `3039720315` defaults on.

## Other Code-tab rules

- **Auto mode over SSH** (not in the notes, 4.16336.0): before spawn and on a switch to Auto, Desktop reads this computer's managed settings. If they say off, or can't be read in time, Auto stays off and the session falls back to Default with a notice.
- **Resume after quit:** local and WSL only, within a day, and only if the turn was cut off. One message is sent: "The app was quit while you were working…". Third-party deployments also require the same signed-in person. At most 4 per launch pass, and it waits for someone to attend. Gate `1743527783` is forced on for third-party in this build.
- **Worktrees:** `git worktree add --no-checkout`, then a path-form checkout, so no `post-checkout` hook runs. `runPostCheckoutHook` is gone in 4.16336.0. Commit hooks still run. `.worktreeinclude` isn't new: up to 256 patterns, copying gitignored files only.
- **`desktopSessionCleanupPeriodDays`:** if a limit is set, Desktop stops renewing the transcript lease and leaves the file to the CLI's sweep. Managed `cleanupPeriodDays` wins, and only a value above 0 counts.
- **`Monitor`:** third-party spawns set `CLAUDE_CODE_UPFRONT_TOOLS=Monitor`. The agent-side enable condition wasn't found, so first-party Code sessions are not settled.
- **AppArmor on Linux hosts** (agent 2.1.310): where `apparmor_restrict_unprivileged_userns` is 1 and a trial `bwrap` fails, the sandbox counts as unavailable and commands run unsandboxed, unless `failIfUnavailable` is set. Desktop forces that only for a WSL target with an `allowedWorkspaceFolders` list, so an admin can't force failure over SSH from Desktop.

## `ccd_pr`: PR, CI and auto-merge tools

Not new in this range, and no earlier lesson covers it. Code sessions only (`sessionType==="ccd"`), gate `1776348311`, default on. Never in Cowork.

| Tool | Does |
|---|---|
| `get_status` | PR, checks, review decision, mergeability, merge queue, monitor switches |
| `set_monitor` | `auto_fix`, `address_comments`, `auto_archive_on_close` |
| `set_auto_merge` | `enabled`, `merge_method` (`squash` default, `merge`, `rebase`) |
| `bind_pr`, `unbind_pr` | Attach or detach a PR |

The four that change state refuse in unattended sessions and without a permission mode. Auto-merge works on github.com only and refuses a closed PR or one inherited from a forked session. Restoring a dismissed PR with `bind_pr` needs the person's consent. The prompt tells the model to use these and not to poll CI itself.

## Not traced

- What caused project and local MCP servers to disconnect after the first turn: an agent fix in 2.1.317, not located.
- Windows-only decisions, as stated above.
- `sshHostLauncher`, a new name with no schema entry.
