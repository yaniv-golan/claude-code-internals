Updated: 2026-09-23 | Source: **`app.asar` 2.7032.0** (sha256 `60d7d5fc…`) with 2.2553.1, 1.46388.4 and the backed-up asars back to 1.18286.2 for first-appearance, the **host Mach-O 2.1.260 / 2.1.275 / 2.1.280** and **in-VM ELF 2.1.280** (`a1b25d70…`), the **live GrowthBook fcache `f82df085d027eff0`** (2026-09-23), and the official CHANGELOG 2.1.261–2.1.280. **Does NOT move the CLI content baseline.**

Follow-up to Chapter 52: the three leads it left open, traced to the end.

# Chapter 53: Artifacts That Call Local Tools, a Remote Control Inbox, and Skills Staged From Your Folders

---

## TABLE OF CONTENTS

195. [Lesson 195 — Rendered Artifacts Can Call Local MCP Tools: The Desktop Channel](#lesson-195--rendered-artifacts-can-call-local-mcp-tools)
196. [Lesson 196 — `FetchInboxMessage` and the Remote Control Session Inbox](#lesson-196--fetchinboxmessage-and-the-remote-control-session-inbox)
197. [Lesson 197 — Skills From a Granted Folder Are Staged Into Cloud Sessions as Stubs](#lesson-197--skills-from-a-granted-folder-are-staged-as-stubs)
198. [Lesson 198 — One Probe, Four Surfaces: What a Relative Path Means Where](#lesson-198--one-probe-four-surfaces)

---

# LESSON 195 — RENDERED ARTIFACTS CAN CALL LOCAL MCP TOOLS

**Claude Desktop contains a complete channel for a rendered Artifact page to call the user's local MCP servers, switched by gate `2864556627`. `CLAUDE_ARTIFACT_HOST_GRANT` is the agent-side half: an allow-list of which local servers an Artifact published from Cowork may declare. The gate is on from the 2026-09-26 capture, but the channel is still closed end to end at two claude.ai layers. L211 has the live probe; this lesson is the mechanism.**

## The Desktop channel

The Desktop's `ArtifactHostTools` module (chunk `D3OyLXgG` in 2.7032.0, `DzZc-q0x` in 2.9939.2) answers a page that sends `claude-page:host-tools-hello`; the preloads (`claudePagePreview.js`, `mainView.js`) relay that message. It attaches to the Cowork preview pane, to artifact frames embedded in the main claude.ai window (at most 8 per window), and to that window's child windows. The Desktop replies over a `MessageChannelMain` port, and the page then sends:

```js
{kind:"call", server:"host:<name>", tool, input, grant}
```

which the Desktop runs through `LocalMcpServerManager.callTool` — the same manager that runs the servers in `claude_desktop_config.json`. The limits in code:

- `host:claude_browser` is a pseudo-server for the browser surface.
- 8 calls in flight and 30 calls per minute (`mcpCallsPerMinute`, from gate `3229517805`).
- A tool annotated read-only (`readOnlyHint:true`, not destructive) runs with no dialog. Any other tool needs a click in the Artifact and then a native "Allow this artifact to run …" dialog. From 2.9939.2 the dialog can offer "Don't ask again", but only when the org setting `coworkMcpWriteToolsAlwaysAllowEnabled` is on.
- Per-tool user toggles and admin policy blocks are honoured.
- The server list offered to the page is every connected `claude_desktop_config.json` server, minus reserved names and tools the user switched off. It is not narrowed to what the page declared.
- The page's `grant` field is only checked against a pattern and logged: `a=EEr.test(e.grant)?e.grant:"invalid"`. The Desktop never compares it with anything, so scoping a page to its declaration is left to claude.ai (L211).
- There is no session-type, HIPAA, frame-artifacts or artifact-owner check on this path.

Every call is refused with `capability_disabled` unless the gate is on:

```js
function YH(){return Ox("2864556627")}   // 2.9939.2; qV(){return jx("2864556627")} in 1.46388.4
```

The code first appears in Desktop **1.34493.1** (absent in 1.32885.1) and is unchanged in its checks through 2.9939.2, which only adds the "Don't ask again" path.

`2864556627` was served off (`defaultValue`) through the 2026-09-24 capture and **on (`source:"force"`, `ruleId:null`) from the 2026-09-26 capture**; it flipped between 2026-09-25 15:56 and 2026-09-26 16:56 UTC. It is the only one of 105 forced entries in that capture with no rule id. From one account a general rollout cannot be told from a targeted rule. The companion gate `3229517805` serves `{debugLogEnabled:true, verifyToolsEnabled:true}` with no `sharingEnabled` key, so republishing (below) is off.

## The agent-side allow-list: `CLAUDE_ARTIFACT_HOST_GRANT`

From Desktop 2.2553.1 the Cowork spawn sets:

```js
...re&&ie!==void 0&&{CLAUDE_ARTIFACT_HOST_GRANT:ie}
// ie = the session's artifactHostGrant, validated:
// {v:1, servers:[{server:"host:<name>", tools:[…]}]}, at most 50 servers × 200 tools,
// server /^host:[A-Za-z0-9_-]{1,64}$/, tool /^[A-Za-z0-9_-]{1,128}$/
```

`re` is true only for an **interactive, plain Cowork session with frame artifacts enabled**: not a scheduled task, not a bridge session, not a dispatch child, not unattended, and not a HIPAA-restricted account. `artifactHostGrant` arrives as a session-start field that no Desktop code writes. The claude.ai client sends the key (a Desktop that did not declare it logged "undeclared wire keys dropped: artifactHostGrant"), but none of 911 session records on the capturing machine carries a value, so in practice the variable is absent and nothing is narrowed. When an existing Artifact is republished, `CoworkArtifacts.getArtifactRepublishContent` builds its grant from the Artifact's `mcp__<server>__<tool>` entries that name a Desktop-local server, and only when sharing is enabled.

The agent reads the variable from **2.1.275** (0 in 2.1.260; 9 in the 2.1.275 and 2.1.280 Mach-O and the 2.1.280 ELF). In the `Artifact` tool's publish path it:

- reads the grant as `absent`, `unreadable` or `granted`;
- drops every `host:` server or tool the page declares that the grant does not list, adding a warning that "this computer did not grant the page these local tools, so they were left out of the manifest";
- refuses outright when the grant is unreadable ("no host: server can be declared from this session");
- refuses a redeploy whose stored declaration would carry ungranted local tools forward;
- filters nothing when the variable is absent.

Telemetry: `host_grant_narrowed`, `host_grant_unreadable`, `host_grant_carry_refused`.

## What this means

- **Today:** a rendered Artifact cannot call the user's local MCP tools. The Desktop half is on, but the Artifacts service refuses a `host:` declaration at publish, and the claude.ai frame shell refuses any `host:` call the published manifest does not carry (L211, measured). Collect secrets through elicitation, not a page form (L105).
- **When the service accepts `host:`:** the Desktop offers every connected local server to any claude.ai artifact frame it shows, and does not check the page's grant. Whatever limits a page to its declared tools will be claude.ai's, including the contract's "only the Artifact's owner can use host servers".
- Watch three things: `2864556627` in each fcache capture, `features.mcp.host` in the Artifacts contract roster (L211), and the shell's answer to a declared `host:` call.

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

Only a **cloud session** (a Cowork task running in the cloud) that has been granted a local folder, through `LocalAgentModeSessions.grantRemoteSessionFolders` after the consent dialog. Skipped when the org is HIPAA-restricted, when the target is a chat rather than a Cowork session, and when the user declines the dialog. The folder itself stays reachable only while the Desktop app is open: "Tasks that use files on your computer need the desktop app open" (Anthropic's support article 15520349, relayed, modified 2026-09-30; the device bridge, L126, L215). The local lane never calls it.

## The mechanism (chunk `5e9zcDZm`)

1. **Scan** `<folder>/.claude/skills/<name>/SKILL.md`: symlinked roots refused, entries sorted, VCS directories skipped.
2. **Upload** through the Files API to `/mnt/user-data/uploads/cowork-folders/<slug>-<sha256(path)[:12]>/.claude/skills/<name>/…`.
3. **Hand off** the staged directory to the claude.ai front end (IPC `cowork-session-directories-staged`); the cloud agent then finds `<dir>/.claude/skills` through ordinary project-skill discovery. The agent binary has no staging-specific code (`cowork-folders`: 0 in both 2.1.280 binaries).

The mode comes from gate **`2877254163`**, `"off" | "stubs" | "full"`, which is **`"stubs"` (force, rule `fr_mtkk8tfg`) when read on 2026-10-01**:

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

---

# LESSON 198 — ONE PROBE, FOUR SURFACES

**The same seven-step probe, run on the four places a Claude agent can be handed a skill, gives four different answers to "where does a relative path go". Only local Cowork refuses it. The fingerprint in step 0 tells the surfaces apart without guessing.**

Run on 2026-09-23 from one account: local Cowork (Desktop 2.7032.0), Cowork running in the cloud, Claude Code on the web, and a claude.ai chat with code execution. Local Cowork was checked against the machine's own transcript and Desktop log; the other three leave nothing on the machine, so their evidence is the pasted tool output. The claude.ai chat column may not be reachable on every organization: on 2026-10-02 an organization on the merged composer (no Chat/Cowork choice) gave each conversation a cloud session at its first shell or file turn (L216, L217), so a chat there ran in the cloud container; the chat column was not re-measured.

## The fingerprint

| | Cowork, local | Cowork, cloud | Claude Code on the web | claude.ai chat |
|---|---|---|---|---|
| shell tool | `mcp__workspace__bash` | `Bash` | `Bash` | `bash_tool` |
| shell `pwd` | `/sessions/<slug>` | `/home/claude` | `/home/user/<repo>` | `/` |
| `$HOME` | `/sessions/<slug>` | `/root` | `/root` | `/root` |
| `whoami` | `<slug>` (a per-session user) | `root` | `root` | `root` |
| `ls /mnt` | nothing | `vm attach sandboxing skills user-data` | `vm attach sandboxing skills user-data` | same, plus `transcripts` |
| `/root/.claude` | permission denied | present | present | absent |
| `CLAUDE_CODE_ENTRYPOINT` | not visible (sealed shell, L116) | `remote_cowork` | `remote` | not set |
| `CLAUDE_CODE_VERSION` | — | `2.1.42` (runner-set, not the agent, L174) | `2.1.42` | — |
| `claude --version` | 2.1.280 | 2.1.280 | 2.1.280 | not installed |
| file tools | Read/Write/Edit/Glob/Grep | Read/Write/Edit/Glob/Grep | Read/Write/Edit/Glob/Grep | `create_file`, `view`, `str_replace` (no search tools) |

Two single values separate the three cloud surfaces: `CLAUDE_CODE_ENTRYPOINT` (`remote_cowork` vs `remote`, unset in chat) and the presence of a `claude` binary. `/mnt/user-data` exists on all three and identifies nothing (L174). Local Cowork's shell is the only one whose user and home are the session slug.

## What each step did

| step | Cowork, local | Cowork, cloud | Claude Code on the web | claude.ai chat |
|---|---|---|---|---|
| Write `probe-rel.md` | **refused**: "File is in a directory that is denied by your permission settings." | written to `/home/claude/probe-rel.md` | written to the repo root | **refused**: "Relative paths are not supported … files for the user belong under /mnt/user-data/outputs/" |
| Read `probe-rel.md` | **refused** (same message) | read | read | **refused**: "not an absolute path. Run realpath …" |
| Write `/var/empty/probe2.md` | **refused** | written | written | written |
| where the model was told outputs go | the host outputs folder's absolute path | `/mnt/user-data/outputs` (in this session; switched per session, see below) | no outputs folder; "the primary working directory" (the repo) | `/mnt/user-data/outputs` |
| Glob `*.md`, no path | searched the outputs folder (re-anchored, L190) | searched `/home/claude`: 1,577 files, mostly package caches | searched the repo | no search tool |
| Grep `x`, no path | searched the outputs folder | searched `/home/claude`, 250-file cap, including files under `.claude/remote/` | searched the repo | no search tool |

## What this means for a skill

- **A relative path is only safe in Claude Code on the web**, where it means the repo. In local Cowork it is refused; in a claude.ai chat it is refused; in cloud Cowork it lands in `/home/claude`, which is not the outputs location, so a deliverable written there is never shown to the user.
- **The absolute outputs path each surface names is the one form that delivers everywhere it exists.** Local Cowork names a host path, chat names `/mnt/user-data/outputs`, and cloud Cowork names one or the other of two contracts (next point). Read it from the instructions; do not hard-code either.
- **In cloud Cowork the outputs contract is switched per session.** The claude.ai client carries two session features, `ccr_outputs_filestore_mount` and `ccr_outputs_path_delivery`, and words the device instructions it injects to match:
  - **Mount on, path delivery on** (this probe): `/mnt/user-data/outputs` is a mount (a symlink to `/mnt/attach/outputs`), the instructions name it, and a file written there with Write or Edit is delivered as soon as it is written, without `SendUserFile`. Files there "persist with the session and the user can open them from the chat sidebar".
  - **Mount on, path delivery off** (two sessions relayed by the skill-creator-plus project on 2026-09-28): the mount exists, but the instructions never mention it; they name the working directory (`/home/claude`) and `SendUserFile`.
  - **Mount off** (a third relayed session, 2026-09-28): `/mnt/user-data/outputs` is an ordinary empty directory, and the instructions again name the working directory and `SendUserFile`.

  All three states were seen on current builds, so the presence of the mount does not tell you whether writing there delivers anything. What decides a session's state is not visible from the client. The session's own instructions are served from the server and are in none of the artifacts on this machine, so the only way to know which contract applies is to read those instructions.
- **A pathless search means something different on each surface**: the outputs folder (local Cowork), the whole container home (cloud Cowork), the repo (web), and nothing at all (chat). Always pass a path.
- **In cloud Cowork a pathless search walks the agent's own credential directory.** The home contains `.claude/remote/.oauth_token` and `.session_ingress_token`, and a bare `Grep` listed them among its matches. A skill that searches without a path can put the names, and potentially the contents, of session credentials into the conversation.
- **Claude Code on the web acts on a real repository.** In this run the agent committed the probe files and pushed them to a new branch without being asked, to clear a hook's untracked-files warning. Probing there has side effects outside the session.

## Other things the probe showed

- **The ordered detection recipe (L116) needs its last refinement.** Cloud Cowork's shell sets `CLAUDECODE=1` and `CLAUDE_CODE_ENTRYPOINT=remote_cowork` but not `CLAUDE_CODE_IS_COWORK`, and has no `/sessions`. A recipe that stops at "`CLAUDECODE` set, so the CLI" misreads it; checking the entry point (`remote_cowork` / `remote` / other) separates cloud Cowork, Claude Code on the web and the CLI.
- **Local Cowork's shell can list other sessions' folder names.** `ls /sessions` from one session printed three other session slugs. Each session runs as its own Unix user (L117), and this probe did not test whether their contents are readable.
- **Local Cowork's VM has a `claude` binary on its path** (`claude --version` → 2.1.280), even in host-loop, where the agent itself runs on the host.
- **Cloud Cowork was offered the memory write tools.** Its tool list included `memory_write`, `memory_str_replace` and `memory_append`, where local Cowork sessions on the same account were offered only read and list (L194). One observation; the cloud lane's agent is configured server-side, not by the Desktop.
- **Cloud Cowork's `claude` binary is at `/opt/node22/bin/claude`** (relayed by the skill-creator-plus project, 2026-09-28).
- **`CLAUDE_CODE_VERSION=2.1.42` appears on Claude Code on the web too**, not only in cloud Cowork: it is runner metadata on both, never the agent's build (L174).

