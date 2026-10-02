Updated: 2026-10-02 | Source: **first-hand probe runs on 2026-10-02** (Desktop 2.19675.0 and claude.ai web, cloud agent 2.1.287) for the folder card, the protected-path refusal, Chrome and the lazy session start; **`app.asar` 2.9939.2** (the live install), **a live probe in a cloud Cowork task on 2026-09-27** (Desktop 2.9939.2 connected, `CLAUDE_CODE_ENTRYPOINT=remote_cowork`), this machine's Desktop log and the probe folder on disk, and the claude.ai interface code the Desktop fetched on 2026-09-24/25 (three builds, including the protobuf descriptors embedded in it); plus the device tools' schemas and one commit run relayed from a peer session's cloud Cowork probes on 2026-10-01 (Desktop 2.16120.0). **Does NOT move the CLI or Desktop baselines.**

Prompted by a review request from the skill-creator-plus project, whose maintainer had watched a cloud session started from the web list folders on their Mac.

# Chapter 58: How a Cloud Session Reaches the User's Computer, and How a Chat Becomes a Workspace

---

## TABLE OF CONTENTS

215. [Lesson 215 — The Device Tools: How a Cloud Cowork Session Reads, Writes and Runs Commands on the Mac](#lesson-215--the-device-tools)
216. [Lesson 216 — One Conversation, Two Runtimes: How claude.ai Moves a Chat Into a Cowork Workspace](#lesson-216--one-conversation-two-runtimes)

---

# LESSON 215 — THE DEVICE TOOLS

**A cloud session reaches the user's computer only through a family of `mcp__remote-devices__…` tools that the running Desktop app serves. The session's own file tools and shell act on the cloud container. A path on the Mac passed to the ordinary Write tool "succeeds" and creates the file in the container, not on the Mac. Files come in by staging a copy, go back by committing a file from the outputs folder, and shell commands run in the Mac's own Cowork Linux VM with the granted folder mounted.**

## When it applies

A Cowork task running in the cloud, while the Desktop app on the user's computer is open and signed in to the same account. The conversation header shows the computer as a connected device (the laptop icon with a green dot; on 2026-10-02 it read "Claude Desktop (macOS), Connected" in a merged-composer `/chat/` conversation too), and the session's side panel lists "Used in this session: <computer> …/<folder>" once a folder is in use. The tools are deferred: the session loads them through ToolSearch before the first call. The user sees that step as "Loaded tools" rows; expanding one shows more "Loaded tools" lines and the model's reasoning, but not the tool list, and the text "Setting up the requested device tool access" was not on screen (Desktop 2.19675.0, 2026-10-02), so it may be model-facing only.

The family, as the Desktop registers it (asar 2.9939.2): `list_devices`, `get_device_info`, `device_list_dir`, `device_stage_files`, `device_commit_files`, `device_bash`, `device_request_folder_access`, `device_request_delete_permission`, the artifact tools `create_artifact` / `update_artifact` / `list_artifacts` / `list_legacy_live_artifacts`, `project_memory_read` / `project_memory_write`, the `computer_*` screen-control tools (L126) and the built-in browser's `Claude_Browser__*` tools. All carry the `mcp__remote-devices__` prefix.

## What a session sees before any grant

`get_device_info` returns, with no folder granted:

- `platform`, `arch`, `appVersion` (the Desktop build), `electronVersion`, `nodeVersion`, `deviceName`;
- `connectedFolders`, empty until a grant;
- `homeDirectories`: the names of the **top-level folders in the user's home folder, minus protected ones** (asar 2.16120.0). Plain files are left out, and so is any folder that is, or lies inside, a protected location (see "Getting a folder"), so `.claude`, `.ssh`, `.aws`, `.gnupg`, `.kube` and `.docker` never appear even though other dotfolders do. Folders under the app's own storage or on a mount the policy refuses are dropped too. The list is capped at 500. `Desktop`, `Documents` and `Downloads` are marked `requiresGrantBeforeListing`; their names are shown, their contents are not. The field is sent only while gate `2745857735` is on and `device_request_folder_access` is available (both true on 2026-10-01);
- `localMcpServers`: every local MCP server the Desktop knows, with its state (`announced`, `failed`) and, for a failed one, its error text (labelled as untrusted server output).

So a cloud session learns the names of the user's home folders and local servers without asking.

## Getting a folder

`device_request_folder_access` takes paths and a reason. The user sees a card in the conversation (Desktop 2.19675.0, 2026-10-02): "Claude wants to use a folder on your computer", then under "From the tool:" the path and "Claude will be able to read and change files in this folder for this session. Because this task runs in the cloud, files Claude uses leave your device.", a **Folder** row and a **Why** row with the reason, and the buttons **Decline** (Esc) and **Allow once** (⌘↵). The grant covers that session only. Home directories, system roots and protected locations are never granted. For a protected location the prompt is still shown and the refusal comes after Allow once (below; seen for `~/.claude` and `~/.claude/skills`); home directories and system roots were not tried. On approval the tool returns `{"granted":["/Users/<user>/<folder>"]}` and the folder appears in `connectedFolders`.

That prompt is drawn by the client the user is chatting in, not by the Desktop app: its wording is not in the asar. Where the user approves depends on the tool's mode, which the Desktop picks from three gates (asar 2.16120.0, values from the 2026-10-01 cache):

| Mode | Gates | Where the user approves |
|---|---|---|
| off | `2745857735` off | the tool is not offered |
| dialog | `2745857735` on, `49458538` off | a native dialog on the computer ("Folder access request") |
| card | `49458538` on, `733405693` off | a prompt in the user's client, before the call reaches the computer |
| classifier | `733405693` on | as card, or in auto mode a native dialog on the computer |

On 2026-10-01 all three gates were on, so the mode was classifier. `2745857735` was forced on; the other two were served with their default values (source `defaultValue` in the cache, not absent from it).

The computer checks the paths only after the request arrives, and it checks for protected locations before anything else, ahead of its own native dialog. The prompt in the user's client is not filtered: in card or classifier mode it is shown for a protected folder, and the refusal comes only after the user clicks **Allow once**: "paths[0] is a protected system or credential location and can't be connected. Nothing was granted." The message names the parameter, not the path. That wording is used only when the path was written with `~`; the same folder written as an absolute path gets the general "A requested folder can't be granted to this session" text.

The protected locations, all relative to the home folder (asar 2.16120.0):

- Claude's own configuration: `.claude`, `.claude.json` (and its backup), and Claude Code's install and state folders under `.local`;
- credential folders: `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.config/gcloud`, `.config/gh`, and on macOS `Library/Keychains`, `Library/Cookies` and `Library/Application Support`;
- folders that start programs at login: `Library/LaunchAgents`, `Library/LaunchDaemons`;
- shell startup files (`.zshrc`, `.bashrc`, `.profile` and their siblings), `.netrc`, and `.config/powershell`.

A folder inside one of these counts as protected too. On 2026-10-02 (Desktop 2.19675.0, Personal organization, a merged-composer conversation), a request for `~/.claude/skills` and one for `~/.claude` each showed the card with **Allow once**, and after Allow once each failed with the protected-location refusal. In one of them the model then told the user the refusal had come before any prompt reached them; the screenshot of the card shows otherwise.

From the tool's schema (2026-10-01): one call takes 1 to 8 canonical absolute paths (symlinks and `.`/`..` are refused) and a `reason` of at most 500 characters. The user approves or declines the set as a whole, and after a decline the schema tells the model not to repeat the request.

## Paths

| Where | Path form |
|---|---|
| `device_list_dir`, `device_stage_files`, `device_commit_files` | the absolute path on the computer (`~` means the user's home), or the `~/mnt/<folder>` spelling, which is resolved and echoed back as `resolvedPath` / `resolvedDevicePath` |
| `device_bash` | `$HOME/mnt/<folder>`, where `$HOME` is `/sessions/rcw-<id>` in the Mac's Cowork VM |
| staged copies in the cloud container | `/mnt/user-data/uploads/<folder>/<relative path>` |
| files to commit back | a file under the container's outputs folder, `/mnt/user-data/outputs` (a symlink to `/mnt/attach/outputs`), or a `SendUserFile` id; which of the two the session is told to use depends on its outputs switches (L198) |
| the session's own Read / Write / Bash | the cloud container only |

## Reading: stage a copy

`device_stage_files` copies named files (not folders) into the container, through the Files API (`[remote-file] staged 1/1 files … files-api` in the Desktop log). The probe's file arrived byte-identical: the same SHA-256 on the Mac and at `/mnt/user-data/uploads/cci-device-probe/seed.txt`. The uploads folder did not exist before the first stage. Each result carries the file's modification time on the computer, which is what the commit guard later compares. Defaults: at most 50 files, 400 MB per file and 500 MB per call (configurable). Cloud-only files, such as iCloud placeholders on macOS, are downloaded first, and beyond 5 files or 50 MB of them the call needs an explicit acknowledgement.

## Writing: commit from the outputs folder

`device_commit_files` does not take content. Each file is named either by `fileUuid`, from an earlier `SendUserFile` (the schema calls it preferred when available), or by `stagedPath`, an absolute path under `/mnt/user-data/outputs/`; paths outside that root are rejected. So no `SendUserFile` is needed first: a 2026-10-01 run wrote the file into the outputs folder with the shell and committed it by `stagedPath`. The destination, `devicePath`, must be an absolute path inside a connected folder (`~` allowed). The committed files arrived with mode `0600` and, in the 2026-10-01 run, a `com.apple.provenance` extended attribute. Its own description tells the model to commit every file deliverable the user asked for, since an uncommitted file never reaches the disk. Limits: 50 files, 10 or 20 MB per file depending on the session host, 100 MB per call.

**The overwrite guard.** When the destination exists, the commit compares the modification time the model passes (`expectedMtimeMs`, normally from the stage result) with the file on the computer, and refuses on a mismatch:

```json
{"written":[],"rejected":[{"devicePath":"…/seed.txt","reason":"device file changed since stage; re-stage with device_stage_files to pick up the user's edit and reapply your change. force=true overwrites the user's newer file — use only if that's intended.","deviceMtimeMs":1790511687884,"deviceBytes":25}]}
```

The file on the Mac was untouched. `force` overrides the guard.

No approval prompt appeared for either commit in a Manual-mode task; the folder grant is the approval.

## The ordinary Write tool does not reach the Mac

Asked to write `/Users/<user>/cci-device-probe/native-write.txt` with its own Write tool, the session got "File created successfully". The file exists only in the cloud container, in a new root-owned `/Users/<user>/cci-device-probe` directory. Nothing appeared on the Mac. There is no error to notice.

## Commands: `device_bash` runs in the Mac's Cowork VM

`device_bash` does not run in the cloud container. It runs in the local Cowork VM on the user's computer:

```
/sessions/rcw-01htlausazoaximwzmliltin
uid=1634(rcw-01htlausazoaximwzmliltin) …
Linux claude 6.8.0-138-generic … aarch64 GNU/Linux
PRETTY_NAME="Ubuntu 22.04.5 LTS"
/usr/bin/dash                         ← readlink -f /bin/sh
```

Each cloud session gets its own VM user, `rcw-<id>`. The granted folder is mounted read-write at `$HOME/mnt/<folder>`. The Desktop logs each call as `[remote-bash] vmUser=rcw-… mounts=<folder>:rw`. A file written there appeared on the Mac, owned by the user, with mode `0644`. A call runs 45 seconds by default. If the VM is still starting or fails, the tool says so and points to stage and commit instead. A folder that cannot be mounted, such as a network drive, stays reachable only through list, stage and commit.

**Deleting needs a second grant.** `rm` in the mounted folder failed with "Operation not permitted", and the tool appended a note naming `device_request_delete_permission`. That tool shows "Allow Claude to permanently delete files in this folder on your computer?" with **Allow for this session**. After approval the mount became `rwd` (`mounts=<folder>:rwd` in the log) and `rm` worked. The code grants it without a prompt in a task set to skip all approvals. This is the same per-mount delete model as local Cowork (L109).

## The shells

`/bin/sh` is `dash` both in the cloud container and in the Mac's Cowork VM (both measured here). That settles L209's open point: a hook script that is missing exits 2 in both places, while local host-loop hooks run on macOS, whose `sh` exits 127.

## `computer://` links: which ones work

Measured on 2026-09-29 (Desktop 2.9939.4, agent 2.1.284) with the same links written by the model in a cloud conversation and in a local session. The model's own text contained every link in both cases (confirmed from the model's echo in the cloud and from the transcript locally), so what differs is how the app renders them.

| link target | cloud conversation (Desktop and claude.ai web alike) | local session |
|---|---|---|
| a file the conversation wrote with Write (working directory `/home/claude`, or the outputs mount) — in any earlier turn too | link, opens | link, opens |
| a file the conversation sent with `SendUserFile` | link, opens | not tested |
| a file the conversation wrote under `/mnt/user-data/working/` | **plain text** | — |
| an existing file the conversation never wrote (`/home/claude/.bashrc`) | **plain text** | — |
| a file on the user's computer, folder granted | **plain text** | link, opens, and a file card is added |
| an existing file in a connected folder the session never wrote | — | link, opens, and a file card is added |
| a `/sessions/<name>/mnt/outputs/…` VM path | — | link, opens: the Desktop rewrites it to the host path, URL-encoding spaces, before it is displayed |

So in the cloud, only a file this conversation's own tools produced gets a working link; everything else is shown as plain text, with no error. Locally, any link to a real file works, and every linked file also gets a file card.

The client code (the claude.ai interface, builds of 2026-09-24/25) carries a path-based rule for cloud sessions — handed-over files, the outputs mount, `/mnt/user-data/working/` and host paths are openable — that does not match these results; the rendering follows the conversation's own list of produced files instead, which leaves out writes it marks as working-document writes. That the list is the mechanism is inferred from the code; the behaviour is measured. What happens after a cloud conversation is archived was not tested: the archive action was not offered in the app on this account, and the code says only handed-over files stay openable.

## Chrome from a cloud conversation

On 2026-10-02, in merged-composer conversations on the web and on Desktop 2.19675.0, asking which browsers were connected listed this computer's Chrome (extension 1.0.98). The tool rows do not expand, so the list is in the model's text, but it matched a direct `list_connected_browsers` call from a separate Claude Code session on the same machine. A turn that only used Chrome set up no session: no "Getting set up" notice and no session fetch (L217).

The browser list can be empty while the extension looks fine, seen in the Claude Code CLI, not a cloud session. In a CLI session (2.1.286) on this machine, `list_connected_browsers` returned an empty list and the Chrome tools said "Browser extension is not connected", although the extension's side panel worked and showed the same account and organization. Logging out and back in from the extension's options page fixed it, without restarting the session. A working side panel does not show that the extension is registered with the bridge.

## For a skill author

- In a cloud session, link only to files the session wrote or sent in this conversation, and prefer handing the file over. A `computer://` link to anything else, including the user's own files on their computer, shows as plain text. Locally any real file can be linked, and a link written with the VM path still works.
- In a cloud session, a path on the user's computer means nothing to the file tools or the shell. To read a file there, stage it and read the staged copy. To deliver onto the computer, write into the outputs folder and let the session commit it. Do not name the device tools from a skill (see `delivery.never-commit-to-disk`); the platform's own tool descriptions already tell the model to commit deliverables.
- Do not trust a successful Write to a `/Users/…` path in a cloud session. Check where the session is: `pwd` is `/home/claude` there.
- A shell command meant for the user's files must go through `device_bash` and `$HOME/mnt/<folder>`, and it runs on Linux, not macOS.
- Deleting in a connected folder needs its own approval. Plan for it being declined.
- A cloud session cannot be granted `~/.claude` or anything inside it, and `get_device_info` does not list it. The user is still shown the folder prompt and can click Allow once; the refusal comes after. A skill that needs the user's local skills or settings has to ask the user to bring the files in another way.

---

# LESSON 216 — ONE CONVERSATION, TWO RUNTIMES

**In the current claude.ai client, "chat" and "Cowork" are not two separate products that a conversation belongs to for good. A conversation carries a work mode, and a chat can be upgraded into a cloud session (a Cowork workspace) partway through, by the client, the server or the model. A Cowork session can also be continued as, or shown as, a chat. So the runtime a skill finds itself in is not fixed by what the user opened.**

The mechanism is read from the client code and the API schema it embeds; the server's decision logic is not visible. The upgrade itself is seen live (2026-10-02, claude.ai web and Desktop 2.19675.0, an organization on the merged composer, which has no Chat/Cowork choice): a new conversation gets a `claude.ai/chat/<uuid>` URL and no cloud session. The first turn that needs a shell or file tool shows a status line "Getting set up for this session  Ns ›" with an elapsed counter for about 5 to 7 seconds, a cloud session (`cse_…`) is created, and the header's computer icon gets a green dot and reads "Claude Desktop (macOS), Connected". The URL stays `/chat/`. Which actor triggers it, and whether it is the workspace upgrade below, was not traced. L217 covers what it means for skills.

## What the composer decides

The composer picks a backend from where it is mounted and from the conversation record, not from the message (all three builds):

```js
V=E?So?"session":za?"hub":"rest":rt&&a?"session":O===null?"rest":"hub"
// E: an existing conversation;  So: it has a session_id;  za: an external conversation;
// rt: the page is a Cowork route;  a: an onSessionCreate handler;  O: the hub client is available
```

A conversation that already has a Cowork session goes to that session. An ordinary conversation goes to the **hub** backend (the "bard" API, reported as `chat_backend "c3"`) when the hub client is available, else to the older REST backend. A new message on a Cowork page (`/cowork/…`, reached from the Chat/Cowork choice where an organization still has it) starts a session. The model, the tools and the message text are not inputs.

## The hub can turn a chat into a workspace

The hub API's schema is embedded in the client as protobuf descriptors (`anthropic/bard/api/v1alpha/bard_api.proto` and `conversation.proto`, base64 string literals, so plain text search misses them):

- **A conversation has a work mode**: `WORK_MODE_CHAT`, `WORK_MODE_WORKSPACE_PROXY`, `WORK_MODE_TOOL_FAULT_PROXY` or `WORK_MODE_FULL_PROXY`.
- **A `WorkspaceUpgrade`** moves it into a workspace on the lane `WORKSPACE_UPGRADE_LANE_COWORK_REMOTE`, a cloud session. It can use a pre-provisioned session (`pre_rented_session_id`) and can continue an existing Cowork session (`continue_cowork_session_id`).
- **Upgrade triggers**: `OPEN_WORKSPACE`, `INTERCEPTED_TOOL`, `FULL_PROXY_SEND`, `DEVICE_ELECTION`, `COWORK_CONTINUATION`, `ATTACHMENT`, `MEDIA_LIMIT`, `ARTIFACT_START` and `CCS_FIRST_SEND`.
- **The client requests it on a send**, with `workModeOverride: "workspace_proxy"`, when the user has picked a local folder and a target device (device election).
- **The model can start it mid-turn** through a tool named `hub_workspace_setup`. The client renders it as a workspace being set up, then tells the model the workspace is ready and to carry on with the task.

Several triggers name things the server sees and the client does not, such as an intercepted tool call, an attachment or a media limit. So the server most likely upgrades conversations on its own; that is inferred from the schema, and what makes it choose is not visible. The client reads the tool-fault and full-proxy modes but never sets them. No path from a workspace back to plain chat was found.

## A Cowork session can become, or be shown as, a chat

- Opening a Cowork session's link has three outcomes: render it inside the chat interface (`HubCoworkSessionChat`), redirect to a chat conversation, or show the older Cowork page.
- Reading a session can return a `continuation` pointing at a conversation. Two server reasons, `cowork_session_presented_as_chat` and `cowork_read_belongs_to_conversation`, send the visitor to that conversation.
- The recent-items list can include Cowork sessions presented as chats (`served-cowork-recents`), controlled by the flag `cai_serene_pine`, whose default comes from `cai_ticklish_lemon`.

Other flags in this area include `claude_ai_hub_web_delivery` and `cai_hub_preview_optout`. None of their values were read.

## Not the same as the Desktop's Chat mode

The Desktop app has its own "Chat mode" session (`sessionType "chat"`, L166). It is a local agent session with the permission mode fixed to default, no folders and no scheduled tasks, whose shell starts in the outputs folder. It is unrelated to the hub's work modes.

## Why it matters

- The runtime a skill runs in can change between turns of one conversation. A chat with no sub-agent tool and no shell can become a cloud session with both, and possibly with a user's computer attached (L215).
- A skill that routes by capability should check the tools it has at each step, not once at the start.
- "The user opened Cowork" and "the user opened a chat" say less than they used to about where the skill will run.
