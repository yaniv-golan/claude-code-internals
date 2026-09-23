Updated: 2026-09-23 | Source: **`app.asar` 2.7032.0** (sha256 `60d7d5fc…`) with 2.2553.1, 1.46388.4 and the backed-up asars back to 1.18286.2 for first-appearance, the **host Mach-O 2.1.260 / 2.1.275 / 2.1.280** and **in-VM ELF 2.1.280** (`a1b25d70…`), the **live GrowthBook fcache `f82df085d027eff0`** (2026-09-23), and the official CHANGELOG 2.1.261–2.1.280. **Does NOT move the CLI content baseline.**

Follow-up to Chapter 52: the three leads it left open, traced to the end.

# Chapter 53: Artifacts That Call Local Tools, a Remote Control Inbox, and Skills Staged From Your Folders

---

## TABLE OF CONTENTS

195. [Lesson 195 — Rendered Artifacts Can Call Local MCP Tools, Behind a Switch That Is Off](#lesson-195--rendered-artifacts-can-call-local-mcp-tools)
196. [Lesson 196 — `FetchInboxMessage` and the Remote Control Session Inbox](#lesson-196--fetchinboxmessage-and-the-remote-control-session-inbox)
197. [Lesson 197 — Skills From a Granted Folder Are Staged Into Cloud Sessions as Stubs](#lesson-197--skills-from-a-granted-folder-are-staged-as-stubs)

---

# LESSON 195 — RENDERED ARTIFACTS CAN CALL LOCAL MCP TOOLS

**Claude Desktop contains a complete channel for a rendered Artifact page to call the user's local MCP servers. It is switched off by gate `2864556627`, off at the 2026-09-23 capture. So the Ch22/L105 rule — a rendered artifact cannot call back — still holds, but it now rests on a server-side switch rather than on missing code. `CLAUDE_ARTIFACT_HOST_GRANT` is the agent-side half: an allow-list of which local servers an Artifact published from Cowork may declare.**

## The Desktop channel

The Desktop's `ArtifactHostTools` module (chunk `D3OyLXgG`) answers a page that sends `claude-page:host-tools-hello`; the artifact-pane preloads (`claudePagePreview.js`, `mainView.js`) implement that message. The Desktop replies over a `MessageChannelMain` port, and the page then sends:

```js
{kind:"call", server:"host:<name>", tool, input, grant}
```

which the Desktop runs through `LocalMcpServerManager.callTool` — the same manager that runs the servers in `claude_desktop_config.json`. The limits in code:

- `host:claude_browser` is a pseudo-server for the browser surface.
- 8 calls in flight and 30 calls per minute (`mcpCallsPerMinute`, from gate `3229517805`).
- A confirmation dialog for any tool that is destructive or not read-only, shown only right after the user clicked in the Artifact.
- Per-tool user toggles and admin policy blocks are honoured.

Every call is refused with `capability_disabled` unless `qV()`:

```js
function qV(){return jx("2864556627")}
```

| | 1.46388.4 | 2.2553.1 | 2.7032.0 |
|---|---|---|---|
| `claude-page:host-tools-hello` | 3 | 3 | 3 |
| gate id `2864556627` | 1 | 1 | 1 |

The channel is not new in this release: it was already in 1.46388.4. At the 2026-09-23 capture, `2864556627` is `{value:false, source:"defaultValue"}` — off, but served, so a server-side rule can turn it on without a client release. The companion gate `3229517805` serves `{debugLogEnabled:true, verifyToolsEnabled:true}` with no `sharingEnabled` key, so republishing (below) is off too.

## The agent-side allow-list: `CLAUDE_ARTIFACT_HOST_GRANT`

From Desktop 2.2553.1 the Cowork spawn sets:

```js
...re&&ie!==void 0&&{CLAUDE_ARTIFACT_HOST_GRANT:ie}
// ie = the session's artifactHostGrant, validated:
// {v:1, servers:[{server:"host:<name>", tools:[…]}]}, at most 50 servers × 200 tools,
// server /^host:[A-Za-z0-9_-]{1,64}$/, tool /^[A-Za-z0-9_-]{1,128}$/
```

`re` is true only for an **interactive, plain Cowork session with frame artifacts enabled**: not a scheduled task, not a bridge session, not a dispatch child, not unattended, and not a HIPAA-restricted account. `artifactHostGrant` arrives as a session-start field that no Desktop main-process code writes; the claude.ai web UI is the likely source. When an existing Artifact is republished, `CoworkArtifacts.getArtifactRepublishContent` builds its grant from the Artifact's `mcp__<server>__<tool>` entries that name a Desktop-local server, and only when sharing is enabled.

The agent reads the variable from **2.1.275** (0 in 2.1.260; 9 in the 2.1.275 and 2.1.280 Mach-O and the 2.1.280 ELF). In the `Artifact` tool's publish path it:

- reads the grant as `absent`, `unreadable` or `granted`;
- drops every `host:` server or tool the page declares that the grant does not list, adding a warning that "this computer did not grant the page these local tools, so they were left out of the manifest";
- refuses outright when the grant is unreadable ("no host: server can be declared from this session");
- refuses a redeploy whose stored declaration would carry ungranted local tools forward;
- filters nothing when the variable is absent.

Telemetry: `host_grant_narrowed`, `host_grant_unreadable`, `host_grant_carry_refused`.

## What this means

- **Today:** unchanged for authors. A rendered Artifact in Cowork cannot call MCP tools, because the Desktop side refuses every call while `2864556627` is off. Collect secrets through elicitation, not a page form (L105).
- **If the gate flips:** an Artifact page opened in the Desktop could call the user's local MCP servers, limited to what its manifest declares, which in turn is limited by the host grant, and with a confirmation for anything destructive.
- Watch `2864556627` in each fcache capture; it is the single switch.

---

# LESSON 196 — `FETCHINBOXMESSAGE` AND THE REMOTE CONTROL SESSION INBOX

**`FetchInboxMessage` (new in agent 2.1.275, unannounced) reads a message relayed into a Remote Control session from a linked chat thread or Claude Code project thread. It exists only while Remote Control is active. The cross-session `SendMessage` path is separate and got its own hold/release signal, `peer_message_hold`.**

## The tool

```js
var QTo=Ht({name:PFe, searchHint:"read a relayed inbox message from a linked thread",
  backgrounding:"never", maxResultSizeChars:20000, shouldDefer:!0,
  isEnabled(){return dl()||ACt()!==void 0}, …})       // PFe = "FetchInboxMessage"
```

- **Enabled** only when the REPL bridge is active (`replBridgeActive()`) or the process is a supervised bridge session. No `tengu_*` flag sits on `isEnabled`; the server enforces org enablement (`feature_disabled`).
- **Input:** `{file_id}` — "The file_id from the session-inbox notification you received".
- **Output:** `ok`, `body`, `enveloped_text`, `sender_display`, `sender_kind`, `source`, `slack_permalink`, `received_at`, `attachments_prefix`, or a `reason` on failure (`feature_disabled`, `untrusted_device`, `relogin`, `owner_changed`, `no_bridge`, `traffic_disabled`).
- **No permission prompt:** read-only, concurrency-safe, `checkPermissions` always allows.

## How messages arrive

The transcript never receives the message body. It receives a wake notification:

```xml
<wake reason="external-event"><event source="session-inbox" kind="message.received" …>
```

carrying `file_id`, `message_id` and the sender; the model then calls `FetchInboxMessage` to read it. Relayed content is marked untrusted (`trust="relay"`). The exception is a message whose outer envelope says `from="rc_owner"` — the server-verified owner of the machine — which the tool prompt tells the model to treat as the user's own request. Messages are kept for about a week, and attachments are downloaded into uploads.

## The other new agent→host frames

All are `type:"system"` messages, all 0 in 2.1.260 and present from 2.1.275:

| subtype | what it carries | Desktop 2.7032.0 consumes it? |
|---|---|---|
| `peer_message_hold` | a cross-session (`SendMessage`) message was held, released or dropped under the receiver's `crossSessionInbound` / permission-mode policy; `state`, `lane`, `from`, `cause`, `outcome`. "Informational only — there is no host-side approval through this frame." | no |
| `turn_preempted` | a rapid follow-up message preempted the current turn; requires the consumer to declare `initialize.rapidFollowupPreempt:true` and flag `tengu_zippy_spindle` (default off) | no (passed through, never set) |
| `turn_handoff_available` | a cloud worker offers to hand the turn off (`tools`, `worker_epoch`, `staged_files`) | no |
| `dev_intent` | `kind` `ios_app`/`android_app` plus a `trigger` (project scan, Xcode project, …) | **yes** — stored as `devIntents` (cap 16), used to open the iOS Simulator entry point |

Of all of this, only the peer hold is in the official CHANGELOG (2.1.271: cross-session messages held by the receiving session's permission-mode policy now leave a trace).

## `SubagentHandback`

Listed in L191; one detail matters to anyone reading sub-agent output. When the tool is on (`CLAUDE_CODE_SENDMESSAGE_HANDBACK`, else `tengu_lively_waffle` defaulting on, and only in auto mode), a sub-agent is told that "Only a SubagentHandback call reaches your caller as your result." Its result carries `handback: send | flagged | withheld`, where `flagged` is delivered under a security warning.

---

# LESSON 197 — SKILLS FROM A GRANTED FOLDER ARE STAGED AS STUBS

**When a user grants a folder on their Mac to a cloud Cowork session, the Desktop scans `<folder>/.claude/skills/*/SKILL.md` and uploads the skills into the cloud session. The live mode is `"stubs"`: the model gets each skill's frontmatter and a pointer telling it to run the real skill on the device. Local Cowork sessions do not do this.**

## Which sessions

Only a **cloud (remote) Cowork session** that has been granted a local folder, through `LocalAgentModeSessions.grantRemoteSessionFolders` after the consent dialog. Skipped when the org is HIPAA-restricted, when the target is a chat rather than a Cowork session, and when the user declines the dialog. The local lane never calls it.

## The mechanism (chunk `5e9zcDZm`)

1. **Scan** `<folder>/.claude/skills/<name>/SKILL.md`: symlinked roots refused, entries sorted, VCS directories skipped.
2. **Upload** through the Files API to `/mnt/user-data/uploads/cowork-folders/<slug>-<sha256(path)[:12]>/.claude/skills/<name>/…`.
3. **Hand off** the staged directory to the claude.ai front end (IPC `cowork-session-directories-staged`); the cloud agent then finds `<dir>/.claude/skills` through ordinary project-skill discovery. The agent binary has no staging-specific code (`cowork-folders`: 0 in both 2.1.280 binaries).

The mode comes from gate **`2877254163`**, `"off" | "stubs" | "full"`, which is **`"stubs"` (force) at the 2026-09-23 capture**:

- **`stubs`** uploads only a rewritten `SKILL.md`: the frontmatter is kept (a description is made from the first body line if there is none), and the body is replaced with a notice beginning "This is a staged stub. The full skill lives on the user's device…", telling the model to run the skill's scripts on the device with `device_bash`. Without a paired, online device, the stub tells the model to say the skill cannot be reached.
- **`full`** copies the whole skill tree.

## Limits

Defaults (gate `1603637451` can override them; it is absent from the capture):

| limit | what happens past it |
|---|---|
| 100 skills per folder | the first 100 in sorted order are kept; the only limit the user is told about (`onFolderSkillsCapped`, from 2.2553.1) |
| `SKILL.md` over 1 MiB | that skill skipped |
| frontmatter over 8 KiB, or control characters in it | that skill skipped |
| `full` mode: one asset over 4 MiB, over 64 files, a bad file name | the **whole skill** dropped |
| 32 MiB per folder | that skill **and every one after it** skipped |

Everything except the 100-skill cap is recorded only in telemetry (`lam_remote_folder_skills_staged`). No check compares folder-skill names with plugin skills.

**Admin policy.** Staging is blocked when managed settings set `strictPluginOnlyCustomization: true` or list `"skills"` in it, and it fails closed: an unreadable setting, or an org whose remote managed settings are not authoritative, counts as blocked.

## The `.claude` context pass (2.7032.0)

A second pass, gate `4018447017` (on), stages the folder's `.claude/CLAUDE.md` and `.claude/rules/**/*.md` into the same directory: at most 50 files, 8 MiB in total and 4 MiB each. The folder's root `CLAUDE.md` has been staged since at least 1.18286.2 (gate `144158705`, on).

## When it appeared

| | first Desktop build containing it |
|---|---|
| folder-skill staging (`2877254163`, the stub text) | **1.44121.1** (0 in 1.40609.1; no build between them was on hand) |
| `onFolderSkillsCapped` | 2.2553.1 |
| `.claude/CLAUDE.md` + rules pass | 2.7032.0 |

## For a skill author

- **A project's `.claude/skills` reaches a cloud Cowork session only as a stub**, and only when the user grants that folder to the session. The model sees your frontmatter; it does not see the body, and it cannot run your scripts in the cloud. Write a `description` that lets the model decide to use the skill from the frontmatter alone.
- **Keep under the limits.** Past 100 skills in one folder, or past 32 MiB in total, skills disappear without a message.
- **Local Cowork does not load a connected folder's `.claude/skills` at all** as far as the code shows: the local spawn passes `settingSources:["user"]`, and the agent loads project skills only when `projectSettings` is among its sources. This rests on agent symbols matched by shape rather than traced to one chunk; ship skills in a plugin if they must work in local Cowork.
