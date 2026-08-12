Updated: 2026-07-17 | Source: First-party binary diff, Claude.app (Desktop) `app.asar` **1.21459.0 → 1.22209.0** (two full asar extractions via `@electron/asar`, file-tree diff + targeted `rg` sweeps over prettified chunks: `index.chunk--qQnbF6Q.js` mobile-simulator tool definitions, `index.chunk-DgBG6rb4.js` simulator constants, `index.chunk-DPf0hBOc.js` the `remote-devices` server, `index.chunk-D3da7joD.js` server-list assembly and gating (`Sa()`/`createProxyServers`), `index.chunk-DD6nxfJK.js` `grand_prix` + the managed-settings schema, `index.chunk-CvIC2eOm.js` the `reservedServerNames` registry, `index.chunk-zzrNR3X_.js` the remote-Cowork-bridge tool builders). Native agent + VM ELF both remained pinned at SDK **2.1.209** across this bump (no version-namespace divergence to track). **No live GrowthBook fcache was captured for this pass** — every gate on/off claim below is limited to what the code itself encodes (a literal `default:false`, an `.optional()` schema with no `default:` key, etc.); nothing here should be read as a fresh production decode the way Ch25/L108's gate catalog or Ch35/L124's fcache-gzip capture were. Investigation delegated to a Fable-5 subagent against two locally cached asars (`~/cowork-agent-backup/desktop-asar/{1.21459.0,1.22209.0}/app.asar`); every claim below is the subagent's first-party grep/read evidence as relayed, not independently re-verified line-by-line by this pass.

# Chapter 36: Desktop Device Automation, the `grand_prix` Partner Bridge & Permission Tuning

---

## TABLE OF CONTENTS

125. [Lesson 125 — Mobile Simulator Tool Surfaces: Real Schemas, Structurally CCD-Only](#lesson-125----mobile-simulator-tool-surfaces)
126. [Lesson 126 — `remote_devices`: the Cowork-Facing Device Bridge](#lesson-126----remote_devices-the-cowork-facing-device-bridge)
127. [Lesson 127 — `grand_prix`: the Credential/Browser-Autofill Partner Bridge](#lesson-127----grand_prix-the-credentialbrowser-autofill-partner-bridge)
128. [Lesson 128 — Auto-Mode Tuning, Scheduled-Task Approval, OTLP Tracing & Hardening](#lesson-128----auto-mode-tuning-scheduled-task-approval-otlp-tracing--hardening)

---

# LESSON 125 — MOBILE SIMULATOR TOOL SURFACES

**Desktop 1.22209.0 ships real, fully-specified device-automation tools for iOS Simulator and Android Emulator — verbatim tool names, parameter schemas, and descriptions — but they are structurally impossible for any Cowork agent, sandboxed or not, to ever receive: gated first on session type (`"ccd"` only, never `"cowork"`/`"cowork-remote"`), then on a per-platform GrowthBook gate that defaults false, then on an org policy and a user-level app preference.**

## The tool schemas

Two internal MCP servers, each exposing exactly one tool, both literally named `control` (`SIMULATOR_MCP_TOOL_NAME`):

**iOS** — server `"Claude Code iOS Simulator"`. Description: *"Drive the iOS Simulator on this Mac. Use after building an iOS app with xcodebuild to install and launch it…"*. `inputSchema`: `action` (enum `attach, launch, screenshot, tap, swipe, touch_path, touch2_path, text, button, open_url, detach`, required) plus `app_path, device, bundle_id, x, y, points[], points2[], x2, y2, duration, text, name` (enum `IOS_BUTTONS`), `url`. Coordinates are in **device points**.

**Android** — server `"Claude Code Android Emulator"`, same tool name `control`. Description: *"Drive an Android emulator on this machine (emulators only — physical devices are not supported)…"*. Same `action` enum shape (no practical `touch2_path` handler on this platform); `bundle_id` is the required Android package id on launch; coordinates are in **screenshot pixels**; `open_url` shells out via `am start -a VIEW`.

The tool-group registry (`reservedServerNames.ts`, const `D`, `index.chunk-CvIC2eOm.js`) grew from 12 to 15 by adding `claude_code_ios_simulator`, `claude_code_android_emulator`, `remote_devices` (Lesson 126) — but that array is only a **name-collision guard** against user-supplied MCP servers with the same names; it plays no role in enablement.

## The gating chain — why Cowork structurally never sees these

Server assembly (`Sa()`) unconditionally `push`es both simulator defs into a candidate array; `createProxyServers` (`index.chunk-D3da7joD.js`, ~line 9481–9600) then filters by calling each server's own `isEnabled(t)`. For the simulator servers:

```
sessionType === "ccd" && !requireFullVmSandbox() && isIosSimulatorEnabled()
  && !getManagedConfig().workspace.disableMobileSimulatorTools
  && getAppPreference("claudeIosSimulatorAccessEnabled")
```

(Android mirrors this with its own per-platform enable flag.) Two independent facts exclude every Cowork agent, unconditionally:

1. **`sessionType === "ccd"`.** `"ccd"` denotes a Claude Code Desktop *coding* session — distinct from Cowork, whose `sessionType` is `"cowork"` (or `"cowork-remote"`, Lesson 126) and is **never** `"ccd"`. This alone removes the tools from any Cowork agent's candidate list before the org-policy check even runs.
2. **`!requireFullVmSandbox()`.** For orgs that *do* set `requireCoworkFullVmSandbox`, a second independent exclusion applies on top — and `handleToolCall` re-checks the same condition at call time, returning `SIMULATOR_VM_POLICY_DISABLED_MESSAGE` (*"The device simulator is disabled because your organization requires the full VM sandbox…"*) if a stale reference somehow slipped through.

**Verdict: the mobile-simulator tool-groups are `ccd`-session-only and cannot reach any Cowork agent's tool list, VM-sandboxed or not — confirmed structurally, by session-type discrimination, not merely by an org toggle that could theoretically be flipped.** This is a stronger and more durable guarantee than a single default-off gate would be.

## Per-platform enablement gates, and the sandbox

`isIosSimulatorEnabled = Zht(Skn)`, `Zht(e){return Vc(e,!1)===true}` — a `default:false` read. The two gate ids: **`3577536076`** (iOS), **`1403324732`** (Android). Both gate ids were already present in 1.21459.0's manifest per this pass's diff; what's new in 1.22209.0 is the actual tool **implementation** (simctl/adb driving code, the server definitions above) sitting behind them. *(No live fcache decode was performed this pass — "defaults false" is a code-level literal, not a fresh production on/off read; treat as structurally dark-launched, not confirmed off in every deployment.)*

> **CORRECTION (2026-08-13, live fcache decode against Desktop 1.28929.0, 254 features).** This
> lesson's caveat above ("no live fcache decode was performed") has now been resolved for one of the
> two gates, and the resolution is a real flip, not a confirmation: **`3577536076` (iOS) is now
> `on`/`force`** — no longer "defaulting false." **`1403324732` (Android) is still `off`/`defaultValue`
> — unchanged.** So the iOS simulator tool-group is live-enabled in production on this account, while
> Android remains dark. **This does not reopen the structural argument below.** The `sessionType==="ccd"`
> discrimination (a Cowork agent's `sessionType` is `"cowork"`/`"cowork-remote"`, never `"ccd"`) is
> independent of the per-platform gate and still holds — a Cowork agent cannot see either tool-group no
> matter how the gate resolves. What changed is only the answer to "is the iOS tool-group live for a
> `ccd` session," not "can Cowork reach it."

A new Seatbelt sandbox wraps the iOS control sidecar: profile `claude-ios-sim.sb`, env `CLAUDE_SIM_SANDBOX` (default **on** in packaged builds; `=0` is honored only in unpackaged dev builds).

## New managed setting

`disableMobileSimulatorTools` (workspace-scope managed flatKey) is a hard org kill-switch layered on top of the `isEnabled` chain above — its own doc string notes it "cannot be turned back on in Settings" once set.

---

# LESSON 126 — `remote_devices`: THE COWORK-FACING DEVICE BRIDGE

**`remote_devices` shares a registry slot with the mobile simulators (Lesson 125) but is a different mechanism pointed the opposite direction: not local device automation for a Claude Code Desktop coding session, but a Cowork-facing computer-use bridge to a real, paired remote device.**

## Server and tools

A distinct internal MCP server named `"remote-devices"` (UUID `63c20b00-cc9f-44b6-b75f-b541980465b7` in `INTERNAL_SERVER_UUIDS`, `index.chunk-DPf0hBOc.js`), telemetry `session_type: "cowork-remote"` — a session-type value distinct from both `"ccd"` (Lesson 125) and plain `"cowork"`. Tools: `computer_resolve_access`, `computer_request_access` (const `REMOTE_DEVICES_COMPUTER_REQUEST_ACCESS`), `computer_release_lock`, plus a dynamic set under prefix `computer_*` (`REMOTE_DEVICES_COMPUTER_TOOL_PREFIX="computer_"`). Descriptions describe resolving app identities (bundleId/displayName/tier) and requesting explicit user permission before controlling apps on a paired device — a permission model gated **per app**, not per session.

## Backing infrastructure

A device registry fetched via `GET /api/organizations/{org}/cowork/remote_devices`, enclave-key/safeStorage bound with per-device public keys. `index.chunk-zzrNR3X_.js` assembles a fuller remote-session tool set — `buildRemoteFileTools` (+ `DEVICE_REQUEST_FOLDER_ACCESS`), `buildRemoteComputerUseTools`, `buildRemoteSpaceMemoryTools`, `buildLocalMcpBridgeTools`, `DEVICE_BASH`, and `buildRemoteGrandPrixTools` (Lesson 127) — consistent with `remote_devices`/`cowork-remote` being a genuine Cowork bridge to an actual paired machine, not a simulator.

## What's confirmed vs. inferred

**Directly verified**: the server definition, its tool names, the device-registry endpoint, the enclave-key enrollment pattern, and the `zzrNR3X_` remote tool-builder set. **Inferred, and labeled as such**: that `remote_devices`/`cowork-remote` specifically means "a paired remote Mac running Desktop" — this reading follows from the device-registry endpoint plus enclave-key enrollment plus computer-use tool proxying, but no live pairing was observed in this pass. Also **not traced this pass**: the `remote-devices` server's own `isEnabled` predicate (unlike Lesson 125's simulator servers, whose gating chain was read in full) — so this lesson does not claim a confirmed reachability verdict the way Lesson 125 does for the simulators.

---

# LESSON 127 — `grand_prix`: THE CREDENTIAL/BROWSER-AUTOFILL PARTNER BRIDGE

**`grand_prix` is a signed, single-partner tool/prompt-injection framework: one hardcoded, HMAC-verified trusted partner can inject host tools, append text to the agent's system prompt, and service tab-scoped credential, address, and payment-card autofill requests against the user's live browser tab — built out substantially in 1.22209.0 from what was a bare skeleton in 1.21459.0.**

## Core mechanics

Code lives in `index.chunk-DD6nxfJK.js` (host, exports `buildGrandPrixHostTools`, `handleGrandPrixHostTool`, `getGrandPrixSystemPromptAppend`, `isGrandPrixCcrBridgeEnabled`, `resolveGrandPrixCcrBridgeToolDefs`, `buildGrandPrixHostToolAllowRules`) and a remote variant in `index.chunk-zzrNR3X_.js` (`[remoteGrandPrix]`, `buildRemoteGrandPrixTools` — the same builder Lesson 126 lists among the remote-device tool set).

A partner registry `Pm()`/`D4e`, keyed by a single stable partner id (`d2291431f58d728c`), loads a **signed** config `{salt, partners, orgFeature}` HMAC-verified against hardcoded keys. The partner supplies `protocolServices` — a map whose entries carry the actual tool definitions (`tool.manifest`, `tool.manifest.{list,fill,release,code}`), stub texts (`tool.stub`, `tool.stub_connected`, `tool.stub_disabled_by_policy`), and system-prompt appends (`prompt.code_session_append`, `prompt.cowork_session_append`). The Desktop is a relay: tool names/descriptions the model actually sees arrive from the partner's own signed payload, not from Desktop-authored code.

Roles: `request, list, fill, release, code`. Combined with `getActiveTabOrigin`/`getActiveTab`, `$expectedOrigin`, `$credentialId`, `$credentialRequests`, and telemetry `grand_prix_credential_request_outcome` carrying **`entry_count, has_login, has_address, has_card`**, the shape is unambiguous: browser **credential + address + payment-card autofill**, scoped to the active tab's origin. `list` enumerates available credentials, `fill` injects them into the live tab, `request` requests access, `code` sets up a code session. Channels are safeStorage-encrypted (`reconnectBundle`, `$channelScope`); unpaired tools return stub responses (`grand_prix_stub_response` with `disabled_by_policy`/`not_connected`/`now_connected`) gated by an org feature flag. A "CCR bridge" variant (`ccr.bridgeTools`, `isGrandPrixCcrBridgeEnabled`) adds extra tools when a Claude-Code-Remote bridge partner is present.

## What's new in 1.22209.0 vs. 1.21459.0

1.21459.0 had only a skeleton — `buildGrandPrixHostTools`, `getGrandPrixSystemPromptAppend`, a single `grandPrixRequest`. 1.22209.0 adds: the full `list/fill/release/code` role set; the credential/address/card telemetry fields (`has_card` etc.); the CCR bridge (`ccr.bridgeTools`, `isGrandPrixCcrBridgeEnabled`, `resolveGrandPrixCcrBridgeToolDefs`); the remote variant (`buildRemoteGrandPrixTools`/`[remoteGrandPrix]`); and a new event family: `grand_prix_stub_response`/`_tool_refused`/`_fill_outcome`/`_list_outcome`/`_pair_outcome`/`_code_prompt_outcome`/`_teardown`/`_disconnect`/`_nudge`.

## Reading

The original speculation ("looks like an agentic browser/credential automation pathway") is confirmed and sharpened: this is Anthropic's sanctioned path for a browser-credential/checkout autofill capability, deliberately fenced to one HMAC-verified partner rather than an open API surface — real infrastructure for "let Claude fill this form/checkout for you," substantially matured in this release but still single-partner and org-feature-gated, not a general capability.

---

# LESSON 128 — AUTO-MODE TUNING, SCHEDULED-TASK APPROVAL, OTLP TRACING & HARDENING

**Three new gate ids extend auto-mode's reach in opposite directions at once — broadening blanket auto-approval for routine work while walling destructive connector tools off from ever being permanently auto-approved — alongside unrelated hardening to protected-folder grants and extension signing, and a new, off-by-default OpenTelemetry tracing setting. None of these gates' live on/off states were captured this pass (no fresh fcache decode); only their code-level defaults and logic are documented below.**

## `tool_approval_default_always_allow` — gate `4200321681` (`coworkAutoModeAlwaysAllowOverride`)

Advertised capability `{feature:"tool_approval_default_always_allow", status:"available"}`, wired via `onAutoModeOverrideAlwaysAllow` → `respondToToolPermission` + telemetry `lam_auto_mode_always_allow_overridden`. The backing logic (`KSt`/`autoModeOverridesAlwaysAllow`) is the **inverse** of what the name suggests: in `permissionMode==="auto"` it returns `true` — which forces a **re-prompt**, not a silent allow — **only for destructive connector/MCP tools** (`isDestructiveConnectorTool`). A sibling guard `oBn` strips `updatedPermissions` from certain tool responses (`computer:request_access`, `computer:request_teach_access`, cowork tools) so "always allow" specifically **cannot be persisted** for them.

Net effect: auto-mode broadly auto-approves routine tool calls, but destructive connector tools are bounced back to an explicit prompt every time and can never be permanently always-allowed — a guardrail carve-out layered on top of a convenience feature, not a blanket loosening.

## Scheduled-task auto-approval — gate `1447478638` (`scheduledTaskToolsApprovableByAutoMode`)

Lets scheduled-task tools be auto-approved under auto mode (unless `isMdmAutoModeDisabled`); event `lam_scheduled_task_tool_auto_mode`. Extends the always-allow story above to recurring/cron work specifically.

## Session sleep/auto-resume — gate `1076115445` (`tryBeginSleepAutoResume`)

Auto-resumes a sleeping Cowork session. Paired with new stop-button telemetry (`lam_stop_button_received`/`lam_stop_button_completed`, `LocalAgentModeSessions.stop`, carries `was_running`) — together these read as session-lifecycle UX polish (sleep/resume, a real stop button) rather than a permission-model change.

## OTLP tracing — new managed setting `otlpTracesEnabled`, default OFF

New managed setting (flatKey `otlpTracesEnabled`; absent from 1.21459.0, which had only `otlpContentCapture`/`DesktopLogLevel`/`Endpoint`/`Headers`/`Protocol`/`ResourceAttributes`), `index.chunk-DD6nxfJK.js`:

```
tracesEnabled: Ie(On().optional(), { flatKey:"otlpTracesEnabled",
  support:{ enabled:{ scopes:["3p"], availableInVersion:"@next" } },
  title:{defaultMessage:"Export traces (beta)"}, category:"telemetry", ... })
```

`On().optional()` has **no `default:` key** (contrast `requireFullVmSandbox`'s explicit `default:!1`), so the value is `undefined` when unset. Runtime reads it with a strict `Oe().otlp.tracesEnabled===!0` check, and the spawn env emits `t.otlp.tracesEnabled ? "1" : ""` for `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` and `"otlp"`/`""` for `OTEL_TRACES_EXPORTER`. **Verdict: default OFF**, and `availableInVersion:"@next"` + `scopes:["3p"]` marks it dark-launched, 3p-managed-config-only. The env-var *name* `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` was already readable in the CLI agent's own env-var table at 1.21459.0; what's new in 1.22209.0 is this Desktop-side setting plus the spawn-env wiring that actually sets it from `otlp.tracesEnabled`.

## Protected-folder grant hardening

New event `lam_folder_grant_refused_protected` + guard `Ae`: folder grants are now refused outright when they would expose managed paths or a shell-config dotfile set — `.zshrc .zshenv .zprofile .zlogin .bashrc .bash_profile .bash_login .profile .netrc` (the dotfile list itself pre-existed 1.21459.0; the refusal path and telemetry are new). Closes a real hole: previously a user could grant an agent access to a folder that happened to contain shell/credential dotfiles without an explicit block.

## Extension/plugin signing hardened

The old interactive MCPB manifest-authoring flow is removed; a new mandatory DXT signature check (`DXT_SIGNATURE_REQUIRED`, RSASSA-PKCS1-v1_5-SHA512 — *"Extension archive is not signed and a valid signature is required"*) replaces it. Supply-chain tightening for the extension/plugin install path, unrelated to the permission-mode changes above.

## Two new managed flatKeys, total

`otlpTracesEnabled` (this lesson) and `disableMobileSimulatorTools` (Lesson 125) are the only two new managed-settings flatKeys found in this diff.

---

## Identifier table

| Identifier | Kind | Artifact | Effect |
|---|---|---|---|
| `SIMULATOR_MCP_TOOL_NAME` = `"control"` | tool name | asar `--qQnbF6Q.js` | Single tool per platform for iOS/Android simulator servers |
| iOS `isEnabled` predicate (`sessionType==="ccd" && !requireFullVmSandbox() && isIosSimulatorEnabled() && !disableMobileSimulatorTools && claudeIosSimulatorAccessEnabled`) | fn | asar `D3da7joD.js` | Structural Cowork exclusion (Lesson 125) |
| `3577536076` / `1403324732` | gate ids, `default:false` in code; **live (2026-08-13, fcache): iOS `on`/`force`, Android still `off`/`defaultValue`** | asar / fcache | iOS / Android simulator per-platform enable |
| `CLAUDE_SIM_SANDBOX` | env var | asar | Seatbelt sandbox toggle for the iOS sim sidecar (default on, packaged builds) |
| `disableMobileSimulatorTools` | managed flatKey | asar | Org kill-switch, layered on top of the `isEnabled` chain |
| `remote-devices` server, UUID `63c20b00-cc9f-44b6-b75f-b541980465b7` | MCP server | asar `DPf0hBOc.js` | Cowork-facing paired-device computer-use bridge (Lesson 126) |
| `computer_resolve_access`/`computer_request_access`/`computer_release_lock`/`computer_*` | tools | asar | `remote_devices` tool surface, per-app permission model |
| `buildGrandPrixHostTools`/`handleGrandPrixHostTool`/`Pm()`/`D4e` | fns | asar `DD6nxfJK.js` | `grand_prix` partner registry + tool dispatch (Lesson 127) |
| `grand_prix_credential_request_outcome` `{entry_count,has_login,has_address,has_card}` | telemetry | asar | Confirms credential/address/payment-card autofill scope |
| `4200321681` (`coworkAutoModeAlwaysAllowOverride`) / `KSt`/`autoModeOverridesAlwaysAllow` | gate + fn | asar | Forces re-prompt (not silent allow) for destructive connector tools under auto mode (Lesson 128) |
| `1447478638` (`scheduledTaskToolsApprovableByAutoMode`) | gate | asar | Scheduled-task tools auto-approvable under auto mode |
| `1076115445` (`tryBeginSleepAutoResume`) | gate | asar | Session sleep/auto-resume |
| `otlpTracesEnabled` | managed flatKey, no default (`undefined`) | asar `DD6nxfJK.js` | Default-OFF OpenTelemetry tracing for Cowork tasks; drives `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`/`OTEL_TRACES_EXPORTER` spawn env |
| `lam_folder_grant_refused_protected` / guard `Ae` | telemetry + fn | asar | New refusal for protected/dotfile folder grants |
| `DXT_SIGNATURE_REQUIRED` | const | asar | Mandatory RSASSA-PKCS1-v1_5-SHA512 extension signing, replaces old unsigned MCPB flow |

## What this means for skill and agent authors

- **Don't build a Cowork skill around the mobile-simulator tools.** `claude_code_ios_simulator`/`claude_code_android_emulator` are real, fully-specified device-automation tools — but they are `"ccd"`-session-only by session-type discrimination, a stronger guarantee than a single gate flip. A skill authored against them will never see them invoked inside Cowork, sandboxed or not.
- **`remote_devices` is the actual Cowork device story, not the simulators.** If a skill needs to reason about "Cowork controlling a device," it's this bridge (paired remote device, per-app `computer_request_access` permission model) — not the local-Mac simulator tools, which point the opposite direction (Claude Code Desktop driving a simulator *on* the Mac it's running on).
- **`grand_prix` is not a general credential API.** It's a single hardcoded partner's bridge; a skill or integration cannot register itself as a `grand_prix` partner — this is infrastructure for one sanctioned integration, not an extensibility point.
- **Auto-mode's "always allow" carve-out is a safety feature, not a loosening — read the name skeptically.** `tool_approval_default_always_allow`/gate `4200321681` sounds like it broadens silent approval; the actual logic forces a *re-prompt* for destructive connector tools specifically, and blocks that class from ever being persisted as always-allow. Don't assume a Cowork session under auto mode will silently approve a destructive connector tool call just because auto mode is on.
- **None of this chapter's three permission-tuning gates or the two new managed settings have a confirmed live on/off state** — this pass diffed code, not a live fcache. Treat status here as "exists in code, default/logic as documented" until a future chapter captures a fresh fcache decode against 1.22209.0 or later.

**Cross-references.** Ch23/L106 (the CLI-plugin credential broker — a different, `clis.*.env` single-CLI-secret channel; `grand_prix` (Lesson 127) is a third, distinct credential-adjacent mechanism, browser-tab-scoped rather than CLI-invocation-scoped) · Ch25/L108 (gate catalog and fcache-decode methodology — this chapter deliberately does not extend that catalog with live on/off states, for lack of a fresh capture; the 2026-08-13 correction above is the first live decode against this chapter's gates) · Ch32/L118 + Ch35/L121–124 (tool composition and the Cowork host-loop tool partition — the simulator/`remote_devices` tool-groups sit *above* that layer, in the server-assembly/`isEnabled` gating this chapter documents, not in `GY`'s per-dispatch composition) · Ch31/L117 (VM rootfs/mount forensics — `remote_devices`' device-registry enrollment is a different, non-mount-based bridge mechanism) · Ch37/L131 (the "absence/state expires" principle this chapter's 2026-08-13 gate flip independently reinforces — a gate's *default* isn't its live state either, not just its *absence*).
