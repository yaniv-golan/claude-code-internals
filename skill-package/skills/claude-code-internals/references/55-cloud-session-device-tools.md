Updated: 2026-09-27 | Source: **`app.asar` 2.9939.2** (the live install), **a live probe in a cloud Cowork task on 2026-09-27** (Desktop 2.9939.2 connected, `CLAUDE_CODE_ENTRYPOINT=remote_cowork`), this machine's Desktop log and the probe folder on disk, and the claude.ai interface code the Desktop fetched on 2026-09-24/25 (three builds, including the protobuf descriptors embedded in it). **Does NOT move the CLI or Desktop baselines.**

Prompted by a review request from the skill-creator-plus project, whose maintainer had watched a cloud session started from the web list folders on their Mac.

# Chapter 58: How a Cloud Session Reaches the User's Computer, and How a Chat Becomes a Workspace

---

## TABLE OF CONTENTS

215. [Lesson 215 — The Device Tools: How a Cloud Cowork Session Reads, Writes and Runs Commands on the Mac](#lesson-215--the-device-tools)
216. [Lesson 216 — One Conversation, Two Runtimes: How claude.ai Moves a Chat Into a Cowork Workspace](#lesson-216--one-conversation-two-runtimes)

---

# LESSON 215 — THE DEVICE TOOLS

**A cloud Cowork session reaches the user's computer only through a family of `mcp__remote-devices__…` tools that the running Desktop app serves. The session's own file tools and shell act on the cloud container. A path on the Mac passed to the ordinary Write tool "succeeds" and creates the file in the container, not on the Mac. Files come in by staging a copy, go back by committing a file from the outputs folder, and shell commands run in the Mac's own Cowork Linux VM with the granted folder mounted.**

## When it applies

A Cowork task running in the cloud, while the Desktop app on the user's computer is open and signed in to the same account. The task header shows the computer as a connected device (the laptop icon with a green dot), and the session's side panel lists "Used in this session: <computer> …/<folder>" once a folder is in use. The tools are deferred: the session loads them through ToolSearch ("Setting up the requested device tool access") before the first call.

The family, as the Desktop registers it (asar 2.9939.2): `list_devices`, `get_device_info`, `device_list_dir`, `device_stage_files`, `device_commit_files`, `device_bash`, `device_request_folder_access`, `device_request_delete_permission`, the artifact tools `create_artifact` / `update_artifact` / `list_artifacts` / `list_legacy_live_artifacts`, `project_memory_read` / `project_memory_write`, the `computer_*` screen-control tools (L126) and the built-in browser's `Claude_Browser__*` tools. All carry the `mcp__remote-devices__` prefix.

## What a session sees before any grant

`get_device_info` returns, with no folder granted:

- `platform`, `arch`, `appVersion` (the Desktop build), `electronVersion`, `nodeVersion`, `deviceName`;
- `connectedFolders`, empty until a grant;
- `homeDirectories`: the name of **every top-level entry in the user's home folder**, dotfiles included. `Desktop`, `Documents` and `Downloads` are marked `requiresGrantBeforeListing`; their names are shown, their contents are not;
- `localMcpServers`: every local MCP server the Desktop knows, with its state (`announced`, `failed`) and, for a failed one, its error text (labelled as untrusted server output).

So a cloud session learns the names of the user's home folders and local servers without asking.

## Getting a folder

`device_request_folder_access` takes paths and a reason. The user sees "Claude wants to use a folder on your computer", with the path, the reason, a note that files the task uses will leave the device because it runs in the cloud, and **Decline** / **Allow once**. The grant covers that session only. Home directories, system roots and protected locations cannot be requested. On approval the tool returns `{"granted":["/Users/<user>/<folder>"]}` and the folder appears in `connectedFolders`.

## Paths

| Where | Path form |
|---|---|
| `device_list_dir`, `device_stage_files`, `device_commit_files` | the absolute path on the computer (`~` means the user's home), or the `~/mnt/<folder>` spelling, which is resolved and echoed back as `resolvedPath` / `resolvedDevicePath` |
| `device_bash` | `$HOME/mnt/<folder>`, where `$HOME` is `/sessions/rcw-<id>` in the Mac's Cowork VM |
| staged copies in the cloud container | `/mnt/user-data/uploads/<folder>/<relative path>` |
| files to commit back | a file under the container's outputs folder, `/mnt/user-data/outputs` (a symlink to `/mnt/attach/outputs`), or a `SendUserFile` id |
| the session's own Read / Write / Bash | the cloud container only |

## Reading: stage a copy

`device_stage_files` copies named files (not folders) into the container, through the Files API (`[remote-file] staged 1/1 files … files-api` in the Desktop log). The probe's file arrived byte-identical: the same SHA-256 on the Mac and at `/mnt/user-data/uploads/cci-device-probe/seed.txt`. The uploads folder did not exist before the first stage. Each result carries the file's modification time on the computer, which is what the commit guard later compares. Defaults: at most 50 files, 400 MB per file and 500 MB per call (configurable). Cloud-only files, such as iCloud placeholders on macOS, are downloaded first, and beyond 5 files or 50 MB of them the call needs an explicit acknowledgement.

## Writing: commit from the outputs folder

`device_commit_files` does not take content. It takes a file already written under the container's outputs folder (or a `SendUserFile` id), and a destination that must be an absolute path inside a connected folder. The probe's committed file arrived with mode `0600`. Its own description tells the model to commit every file deliverable the user asked for, since an uncommitted file never reaches the disk. Limits: 50 files, 10 or 20 MB per file depending on the session host, 100 MB per call.

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

## For a skill author

- In a cloud session, a path on the user's computer means nothing to the file tools or the shell. To read a file there, stage it and read the staged copy. To deliver onto the computer, write into the outputs folder and let the session commit it. Do not name the device tools from a skill (see `delivery.never-commit-to-disk`); the platform's own tool descriptions already tell the model to commit deliverables.
- Do not trust a successful Write to a `/Users/…` path in a cloud session. Check where the session is: `pwd` is `/home/claude` there.
- A shell command meant for the user's files must go through `device_bash` and `$HOME/mnt/<folder>`, and it runs on Linux, not macOS.
- Deleting in a connected folder needs its own approval. Plan for it being declined.

---

# LESSON 216 — ONE CONVERSATION, TWO RUNTIMES

**In the current claude.ai client, "chat" and "Cowork" are not two separate products that a conversation belongs to for good. A conversation carries a work mode, and a chat can be upgraded into a cloud Cowork workspace partway through, by the client, the server or the model. A Cowork session can also be continued as, or shown as, a chat. So the runtime a skill finds itself in is not fixed by what the user opened.**

This lesson is read from the client code and the API schema it embeds. None of it was observed in a live session, and the server's decision logic is not visible.

## What the composer decides

The composer picks a backend from where it is mounted and from the conversation record, not from the message (all three builds):

```js
V=E?So?"session":za?"hub":"rest":rt&&a?"session":O===null?"rest":"hub"
// E: an existing conversation;  So: it has a session_id;  za: an external conversation;
// rt: the page is a Cowork route;  a: an onSessionCreate handler;  O: the hub client is available
```

A conversation that already has a Cowork session goes to that session. An ordinary conversation goes to the **hub** backend (the "bard" API, reported as `chat_backend "c3"`) when the hub client is available, else to the older REST backend. A new message on a Cowork page starts a session. The model, the tools and the message text are not inputs.

## The hub can turn a chat into a workspace

The hub API's schema is embedded in the client as protobuf descriptors (`anthropic/bard/api/v1alpha/bard_api.proto` and `conversation.proto`, base64 string literals, so plain text search misses them):

- **A conversation has a work mode**: `WORK_MODE_CHAT`, `WORK_MODE_WORKSPACE_PROXY`, `WORK_MODE_TOOL_FAULT_PROXY` or `WORK_MODE_FULL_PROXY`.
- **A `WorkspaceUpgrade`** moves it into a workspace on the lane `WORKSPACE_UPGRADE_LANE_COWORK_REMOTE`, a cloud Cowork session. It can use a pre-provisioned session (`pre_rented_session_id`) and can continue an existing Cowork session (`continue_cowork_session_id`).
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

- The runtime a skill runs in can change between turns of one conversation. A chat with no sub-agent tool and no shell can become a cloud Cowork session with both, and possibly with a user's computer attached (L215).
- A skill that routes by capability should check the tools it has at each step, not once at the start.
- "The user opened Cowork" and "the user opened a chat" say less than they used to about where the skill will run.
