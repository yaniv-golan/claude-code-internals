Updated: 2026-10-01 | Source: **Claude Desktop `app.asar` 2.16120.0 diffed against 2.9939.4** (both builds read; staged agent 2.1.284 in both), the **live GrowthBook cache decoded on 2026-10-01** (390 features), and the **`system/init` frames of the six local sessions started since the 2.16120.0 install** (two scheduled, four interactive; agent 2.1.284). Prompted by a sibling project's notes on the same build, then re-derived from the binaries here.

# Chapter 60: Desktop 2.16120.0 — Scheduled Runs, Host-Loop Permissions and the Preview Screenshot

---

## TABLE OF CONTENTS

219. [Lesson 219 — Scheduled Runs Get the Native Artifact Tool and Carry Their Files to the Cloud](#lesson-219--scheduled-runs-get-the-native-artifact-tool-and-carry-their-files-to-the-cloud)
220. [Lesson 220 — Host-Loop File Permissions: Approvals Pinned, Org Asks Reach the User](#lesson-220--host-loop-file-permissions-approvals-pinned-org-asks-reach-the-user)
221. [Lesson 221 — Screenshot Tools for Artifacts and the File Preview](#lesson-221--screenshot-tools-for-artifacts-and-the-file-preview)

---

# LESSON 219 — SCHEDULED RUNS GET THE NATIVE ARTIFACT TOOL AND CARRY THEIR FILES TO THE CLOUD

**From Desktop 2.16120.0 a scheduled Cowork run gets the native `Artifact` tool, as an interactive session does, instead of the `mcp__cowork__` artifact family (L212). An always-allow on a scheduled run's publish prompt is stored per task, so later runs of that task publish without asking. And the sweep that moves scheduled tasks to the cloud (L208) can now take a task that has attached files with it.**

## Native Artifact in scheduled runs

The session setup predicate that chooses between the two artifact families admits scheduled sessions:

```
2.9939.4   frameArtifactsEnabled && sessionType unset && no scheduledTaskId && !bridge && !dispatchChild && !HIPAA
2.16120.0  frameArtifactsEnabled && (sessionType unset || sessionType "scheduled") && !bridge && !dispatchChild && !HIPAA
```

The restriction moved earlier, to session start: a scheduled session has its `frameArtifactsEnabled` cleared unless key `scheduledRunFrameArtifacts` of the cowork runtime config (`1978029737`) is true. Its default in the code is **true**, and the key is absent from the served value on 2026-10-01, so the default applies. The two families stay mutually exclusive.

On disk: both scheduled runs since the install, of two different tasks, list `Artifact` and no `create_artifact`, `update_artifact` or `list_artifacts`. Scheduled runs on 2.9939.4 on the same machine had the family and no `Artifact`.

## A publish grant per scheduled task

When a scheduled run asks to publish with `Artifact` and the user answers always-allow, Desktop writes a grant for that task to `scheduled-task-grants/<account-org>/artifact-publish-grants.json` under its user-data folder. The grant is keyed by the task's id and its creation time. Later runs of the task that publish are approved without a prompt, and the session's audit log records `permission_auto_approved`.

The grant is offered only for a plain publish call (`Artifact` with a file path, no blocked path, `action` publish or unset). It is not offered to a sub-session, to a run through the host CLI launcher, or for a tool on the organization's forced-ask list. A stored publish rule also no longer counts as a reason to keep the task on this computer when the sweep considers moving it.

## Attached files no longer pin a task to this computer

In 2.9939.4 any attached file (`userSelectedFiles`) made the sweep classify the task `local_folders` and keep it local. In 2.16120.0 attached files keep it local only when the remote side cannot take files, which the code computes as `boundEnabled && boundFilesEnabled` from the sweep's config gate `2974609625`. Both are true in the served value on 2026-10-01.

A task with files moves only in the **bound** mode (tied to this device), never the device-free one, and only if:
- after app-storage paths are dropped there are at most 16 files, none blank and none on a network path;
- their parent folders can be shared;
- the served `heldBlockReasons` does not itself list `local_folders`. On 2026-10-01 it listed only `space` (L208).

The moved task carries the files, the parent folders it added and its folders. A parent folder that cannot be shared at copy time is reported as `unshareable_parent` in the migration telemetry.

## For an author

- A scheduled task's HTML output now goes through `Artifact`, as in an interactive session. Describe the outcome in the prompt rather than naming a tool: older Desktop builds and sessions with frame artifacts off still use `create_artifact`.
- Attaching files to a scheduled task no longer keeps it local. If the task must run on this computer, set it to run only on this computer.

---

# LESSON 220 — HOST-LOOP FILE PERMISSIONS: APPROVALS PINNED, ORG ASKS REACH THE USER

**In the host loop, Desktop's permission handler for the file tools changed in 2.16120.0 in three ways. When the user approves Read, Write, Edit, Glob or Grep, the call runs with the input that was judged, not with whatever the approval came back with. An organization policy that requires approval for a file tool now shows the user a prompt instead of refusing outright. And `allow_cowork_file_delete` refuses some requests before any prompt appears. Every agent Desktop spawns also gets `PYTHONDONTWRITEBYTECODE=1`.**

## The approval is pinned to the judged input

The host-loop `canUseTool` chain (L122, `cowork-permissions` state page) ends by asking the SDK's own handler, which shows the permission card. In 2.16120.0 its answer passes through one more step. For the path-gated file tools, an `allow` keeps its behavior but its `updatedInput` is replaced with the input the chain judged. If the card's answer differed, Desktop logs which keys differed (`allow pinned to the judged input`). A path the user did not see cannot ride on their approval. Earlier links, such as the auto-memory path rewrite, are not affected.

## Organization asks on file tools

An organization tool policy can require approval for a tool on each call (L184). For the path-gated file tools in the host loop:

| | 2.9939.4 | 2.16120.0 |
|---|---|---|
| main session | refused: "requires per-call approval under the organization's tool policy, and this session cannot prompt for file tools — treat it as blocked here" | passed on to the permission prompt (logged as `pre-fork approval path (managed ask)`), then pinned as above |
| side chat | refused: side chats cannot prompt | unchanged |

## `allow_cowork_file_delete` refuses before the prompt

These requests are refused with an explanation and no prompt: no file path; a path that is not a VM path inside a connected folder; a path with `.` or `..` segments; a path in the outputs folder, where deleting needs no permission; a folder the administrator set read-only; no session. In 2.9939.4 the user saw the approval prompt first and the refusal came afterwards.

## `PYTHONDONTWRITEBYTECODE=1`

The base environment Desktop builds for every agent it spawns sets `PYTHONDONTWRITEBYTECODE=1`, on first-party and third-party deployments alike, next to `MCP_CONNECTION_NONBLOCKING` and `API_TIMEOUT_MS`. Python started by the agent process, or by its children, stops leaving `__pycache__` folders. The variable's other occurrence is the list of variables forwarded to MCP server processes (L116). In the host loop the VM shell's environment is sealed (L116), and the host-loop code carries no `PYTHON` variable to pass on, so Python run through `mcp__workspace__bash` is not covered.

## For an author

- Do not expect a permission hook or an approval to change a file tool's input in Cowork's host loop: the approved call runs on the judged input.
- Under an organization policy that requires approval for file tools, expect a prompt in the main session, and still a refusal in side chats.
- Do not rely on `__pycache__` being written, or on its absence in the VM shell.

---

# LESSON 221 — SCREENSHOT TOOLS FOR ARTIFACTS AND THE FILE PREVIEW

**Desktop's `cowork` server gains two tools in 2.16120.0. `screenshot_file_preview` returns an image of an HTML or SVG file as the file preview panel renders it, and `screenshot_artifact` does the same for an artifact in the side panel. The first does not depend on the artifact family, so a session with the native `Artifact` tool has it too.**

## What they do

Both return a JPEG of what is visible without scrolling, at the panel's width (narrower than a browser window), plus a short note, or text saying why no screenshot was taken. Their descriptions tell the model to treat text in the image as page content, not instructions, and to retry at most twice.

- `screenshot_file_preview` takes `file_path`: a `.html`, `.htm` or `.svg` file this session wrote and presented with `present_files`. In the host loop a relative path resolves against the outputs folder. **The preview panel loads nothing from the web**: scripts, styles, fonts and images referenced by URL neither run nor show, for the user as for the screenshot.
- `screenshot_artifact` takes an artifact `id` (its slug), after `create_artifact` or `update_artifact`.

## When they are served

| Tool | Served when |
|---|---|
| `screenshot_file_preview` | `canVerifyArtifacts` and native file preview (`1978029737.coworkNativeFilePreview`), not a bridge session or dispatch child |
| `screenshot_artifact` | inside the `mcp__cowork__` artifact family (L212), with `canVerifyArtifacts` |

`canVerifyArtifacts` is `3229517805.verifyToolsEnabled` alone in 2.16120.0; in 2.9939.4 it also required the artifact family's gate `2940196192`. On 2026-10-01 `3229517805` is served force-on with `verifyToolsEnabled`, `debugLogEnabled`, `sharingEnabled` and `autoPublishEnabled` all true, and `coworkNativeFilePreview` is true. All six sessions since the install list `screenshot_file_preview`. The same gate's `sharingEnabled` is covered with the artifact store it shares from (L212).

## Imagine availability

The visualize server and the elicitation instruction (L147, L205) now depend on one availability check: gate `3444158716` on, the session not under the HIPAA restriction, and, when gate `2742800629` is on, the organization not having blocked inline visualizations. `imagineElicitationEnabled` is `286376943` and that check. On 2026-10-01 `3444158716` is served on and `2742800629` off. Whether the prompt was built with imagine is stored with the session; a change invalidates the cached system prompt, so it is rebuilt.

## For an author

- A skill that writes an HTML or SVG report can ask the model to present it and then check it with `screenshot_file_preview`. Keep scripts, styles and data inline: the preview loads nothing by URL.
- Treat both tools as optional. They depend on served flags and are absent in bridge sessions and dispatch children.
