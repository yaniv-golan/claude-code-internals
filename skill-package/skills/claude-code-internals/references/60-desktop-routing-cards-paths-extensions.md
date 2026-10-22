Updated: 2026-10-21 (L226: two Team runs that went to the cloud, and the row-vs-router split, read in the 3.1623.0 ion-dist and compared with 2.42304.0) | Earlier: 2026-10-16 (L229: the approval gate and "Always allow", read in app.asar 2.37337.1 and 2.42304.0 and the 2.42304.0 ion-dist); 2026-10-11 (L226–L230) | Source: the installed **Claude Desktop `app.asar` 2.31226.1** and its UI bundle (`ion-dist`, 2.31226.0 and 2.31226.1), read but **not diffed** against an earlier build, so nothing here is claimed as new; plus live runs on Desktop 2.31226.0/2.31226.1 between 2026-10-09 and 2026-10-11 in a Personal org and a Team org (local and cloud Cowork tasks, a phone-started task, a real MCPB extension, an uploaded and an org-marketplace copy of one plugin). Minified names are given with their chunk file, because the same short name is reused across chunks.

# Chapter 63: Desktop Cowork — Task Routing, Approval Cards, Paths, Local Extensions and Plugin Installs

---

## TABLE OF CONTENTS

226. [Lesson 226 — "Only on This Computer": Where the Local/Cloud Choice Lives, and That It Can Change Under You](#lesson-226--only-on-this-computer-where-the-localcloud-choice-lives-and-that-it-can-change-under-you)
227. [Lesson 227 — Which Tool Calls Show an Approval Card in a Local Cowork Session](#lesson-227--which-tool-calls-show-an-approval-card-in-a-local-cowork-session)
228. [Lesson 228 — The Model Sees VM Paths; audit.jsonl and the UI Show Host Paths](#lesson-228--the-model-sees-vm-paths-auditjsonl-and-the-ui-show-host-paths)
229. [Lesson 229 — Local Extensions (.mcpb) in Desktop: Updates, Confirmations, Errors, Settings](#lesson-229--local-extensions-mcpb-in-desktop-updates-confirmations-errors-settings)
230. [Lesson 230 — Plugin Installs: Desktop Rewrites Frontmatter, and Switching Off an Org-Marketplace Plugin Deletes Its Copy](#lesson-230--plugin-installs-desktop-rewrites-frontmatter-and-switching-off-an-org-marketplace-plugin-deletes-its-copy)

---

# LESSON 226 — "ONLY ON THIS COMPUTER": WHERE THE LOCAL/CLOUD CHOICE LIVES, AND THAT IT CAN CHANGE UNDER YOU

**The "Only on this computer" switch under Settings → General is a server-side account setting, not a local preference. Whether a given task runs locally or in the cloud is decided per task by a routing function that has many reasons to force local, and the switch's display and the actual routing can disagree. Before trusting any test of a Cowork task, check where it actually ran.**

## Where the setting lives (CODE-READ, ion-dist 2.31226.0/.1)

- Stored on the account: `account.settings.dramatic_shrimp_enabled` and `dramatic_shrimp_disabled_at` (`shared-26` `Uc`/`Bc`/`Wc`; "dramatic shrimp" is cloud Cowork). Opting out writes `{enabled:false, disabled_at:now}`.
- For internal accounts the opt-out expires after 3 days (`shared-26`, `Fc=2592e5` ms).
- The Settings row shows only while `ly(...)` holds (`shared-18` `ly`/`uy`): `available && canChooseBackend && !policy && (canOptOut || !isRemote || overridden)`.
- `canOptOut` needs `!optOutRetired` (gate `__gb__2534692942`) and either `!cowork_remote_opt_out_returning_only_main` or an account that has already opted out. So the row can vanish once the account is on the cloud.

## Per-task routing (CODE-READ, `shared-26` `sj`)

`sj` returns the first reason that applies. Every `local_*_forced` reason below also needs `canRunLocal`.

| order | reason | when |
|---|---|---|
| 1 | `local_ungated` | cloud Cowork not enabled for the account |
| 2 | `local_override_forced` | a forced local override is set |
| 3 | `local_opted_out` | the account is not on the cloud lane |
| 4 | `local_folder_forced` / `local_space_forced` | a selected folder or files (or a space) that can't go to the cloud |
| 5 | `local_bypass_permission_forced` / `local_auto_permission_forced` | Bypass or Auto chosen, and flag `ccr_mcp_permission_mode_override` (bypass) or `ccr_auto_permission_mode` (auto) is **off** |
| 6 | `local_chrome_skip_forced` | Chrome "skip all permission checks" chosen |
| 7 | `local_options_forced` | other options that require a local session |
| 8 | `local_computer_use_forced` | computer use on, and no device computer use in the cloud |
| 9 | `local_plugin_stdio_default` | plugin stdio servers bias local, **only** for accounts whose `dramatic_shrimp_enabled` was never set |
| — | `remote` | otherwise |

A separate error, `cowork_local_tasks_off`, exists for a task start that can't run locally.

## What it did in practice (MEASURED, Desktop 2.31226.0/.1)

| account | observation | n |
|---|---|---|
| Personal | Switch ON; turned OFF → tasks ran in the cloud and the row disappeared (2026-10-09) | 1 |
| Personal | 2026-10-11: row back and showing ON, no user action; a no-folder task still ran in the **cloud** (`pwd` /home/claude, `HOME=/root`, `CLAUDE_CODE_ENTRYPOINT=remote_cowork`, `CLAUDE_CODE_REMOTE=true`) | 1 |
| Personal | 2026-10-10 22:15Z: a task with only a connected folder ran **locally** (`/sessions/<slug>`), and the task showed a banner saying local-only Cowork tasks are being deprecated | 1 |
| Personal | 2026-10-11 04:15–04:35Z, switch still showing ON: four tasks with a connected folder all ran in the **cloud** (Manual and Auto) | 4 |
| Personal | Auto mode did **not** force local (cloud); Bypass not offered in the composer (only Manual and Auto) | 2 |
| Team | Switch ON; Desktop-started tasks ran locally (Desktop 2.31226, through 2026-10-11) | many sessions |
| Team | 2026-10-21, Desktop 3.1623.0, Manual, no folder: row showing ON, task ran in the **cloud** (`/home/claude`, `remote_cowork`, `CLAUDE_CODE_REMOTE=true`) | 1 |
| Team | Same day, with a Mac folder connected: still the **cloud**. The model also reached the Mac's VM through `device_bash` (L215), which is not a local task | 1 |
| Team | A task started from the phone app in Cowork mode ran in the **cloud** despite the switch | 1 |
| Team | A phone task sent as plain chat (not Cowork) got the skill without its plugin scripts; the skill reported its shared scripts unreachable | 1 |

## Why the row and the lane can disagree (CODE-READ, ion-dist 3.1623.0, `shared-26` and `cabd7b1c1`)

The row and the router read two different hooks:

- **The row** shows the account setting as stored: its switch is `!isRemote` from the raw hook (`Zc`, exported as `ih`), which reads `dramatic_shrimp_enabled` (with the 3-day expiry for internal accounts). Only `canOptOut` comes from the router's hook.
- **The router** gets `isRemote` from the mode hook (`Qc`, exported as `ah`). It starts from the same stored value, but several branches return `isRemote:true` regardless: cloud Cowork not available for the account, local tasks off by policy (`off_by_policy`), the account not loaded yet, and a plan check that routes some plans to the cloud.

So the row can show ON while the router sends the task to the cloud, and nothing on screen says which branch did it. L210 found a second cause outside these hooks: the merged composer (no Chat/Cowork choice, a `/chat/` URL) sent every task to the cloud, and it reached organizations one at a time. Which cause applied to the 2026-10-21 Team runs, and which composer they came from, was not recorded. The routing function itself (`sj` above, now `SO`) and the mode hook are unchanged from 2.42304.0 to 3.1623.0 (compared after renaming), so those runs did not come from a new Desktop build.

- **Connecting a folder doesn't force local any more when the cloud can reach it.** `local_folder_forced` applies only when the folder doesn't allow the cloud (`folderAllowsRemote`); the 2026-10-21 folder task went to the cloud and reached the folder through the device bridge (INFERRED from the run).
- **The Desktop's own switch for local tasks** (`cowork-local-tasks-off`, gate `3634338308`, L208) was still served off on 2026-10-21, so the Desktop allowed a local task; the choice was made in the interface.

## The composer's Auto/Manual choice (CODE-READ, `shared-8` `Wj`/`Uj`/`Kj`)

Sticky per org in the browser's local storage, key `cowork-unsupervised-sticky` = `{mode, orgUuid, chromeSkipAll?, keyFormat:4}`. Picking Manual writes `{mode:"manual-opt-out"}`. Nothing is written to the account. Because Auto/Bypass can force local (row 5), a sticky mode can change routing from one task to the next.

## For an author or tester

- Start every probe with a lane check: `pwd`, `echo $HOME $CLAUDE_CODE_ENTRYPOINT $CLAUDE_CODE_REMOTE`. Local Cowork runs under `/sessions/<slug>`; cloud Cowork under `/home/claude` with `ENTRYPOINT=remote_cowork`.
- Don't infer the lane from the switch, the org, the permission mode or the device that started the task.
- A skill that needs plugin scripts must say so and fail clearly when they are missing (the phone-chat case).

**In the official release notes (checked 2026-10-15):** from Desktop 2.37337.1, a Cowork task on a computer whose administrator turned off the local VM starts in the cloud. Before, it tried to start locally. The routing table above has no reason for this case; where it sits in `sj` wasn't traced.

---

# LESSON 227 — WHICH TOOL CALLS SHOW AN APPROVAL CARD IN A LOCAL COWORK SESSION

**In Manual mode a local (host-loop) Cowork session shows a card only for tools that are not pre-approved in the spawn's `allowedTools`, plus a fixed always-ask set (one exception: a folder request for a folder already attached, L231). Shell commands, edits inside connected folders and `present_files` are pre-approved, so they show no card. The "Allow Claude to change files in …" prompt is a separate folder dialog, not a tool card.**

## The layers (CODE-READ, asar 2.31226.1)

| layer | where | effect |
|---|---|---|
| Spawn `allowedTools` | `index.chunk-QEr06WaZ.js` `Jp`/`Kp` | Removes Bash, PowerShell, NotebookEdit, REPL, JavaScript, WebFetch, Read, Write, Edit, Glob, Grep. Adds `mcp__workspace__bash`, `Edit(<folder>/**)` + `Read(<folder>/**)` for outputs and each read-write connected folder, `Read(<folder>/**)` only for uploads and read-only folders, plus `present_files`, `propose_skills` and the artifact tools. **No card.** |
| Always-ask set `iXt` | `index.chunk-Cyt2WTko.js` | `mcp__cowork__allow_cowork_file_delete`, `request_cowork_directory`, `launch_code_session`, `save_skill`, and the 5 mutating `mcp__scheduled-tasks__*` tools. Always a card in Manual, reason "This tool requires explicit approval regardless of permission mode.", with one exception from 2.31226.0: `request_cowork_directory` naming a folder already attached to the session is allowed by `canUseTool` without a card (`permission_auto_approved`, `source:"attached_folder"`; L231). A deferral to the Auto-mode classifier exists only under `permissionMode:"auto"` (gates `1447478638`, `4202409342`). |
| `mcp__.*` hook | `ntr` | Never asks. Only blocks tools disabled in connector settings. |
| Everything else | Desktop `canUseTool` → `handleToolPermission` | A card, apart from a few auto-allows. |

## Deletes (CODE-READ)

Connected-folder mounts are `rw`, not `rwd`, until the mount is approved (`Bwge5-J7` `V`). So `rm` in a connected folder fails first, and the model then calls `allow_cowork_file_delete`. Its card reads "Allow Claude to permanently delete files in your {folderName} folder during this task?" with **Deny / Allow** only (ion-dist `ca44d5dae` `bu`). The outputs folder is already deletable.

## The folder prompt (CODE-READ)

"Allow Claude to change files in “{directory}”?" with **Cancel / Always allow / Allow** is a renderer dialog (`CoworkTrustDialog`, ion-dist `c2b3e8506`). The cloud code path also has a native dialog (`grantRemoteSessionFolders`, **Allow / Cancel**). MEASURED (Personal cloud task, 2026-10-11, n=1): both appear for a cloud task: first the "Allow Claude to change files in …" dialog (**Allow / Always allow**), then the native card saying the files leave this Mac, with an unchecked "Don't ask again".

## Observed (MEASURED, Desktop 2.31226.1)

- Team, local, Manual: 0 cards for `mcp__workspace__bash` (2 of 2 tasks), for `Write` (2 tasks) and for `present_files`. Only the folder dialog appeared.
- Personal, cloud task with the device bridge, composer showing Manual: every hook payload carried `permission_mode: "acceptEdits"` (20 of 20). The composer label is not the mode the agent runs in.
- Personal, cloud, composer showing Auto (2026-10-11, n=2): creating a file in the connected folder showed no card, and deleting it needed the same "permanently delete files" card as under Manual (L215). No other card appeared. Under Auto every hook payload carried `permission_mode: "auto"` (9 of 9), where the Manual runs carry `"acceptEdits"`. So a hook can tell Auto from Manual; it cannot tell Manual from Accept edits.
- Two local sessions in the same VM ran as different users (uid 1799 and 1800, each named after its session slug) but shared one `/tmp`. A file one session wrote was readable, not writable, by the other, and from the other session it stats as `nobody`/65534. MEASURED n=1.
- Each local task gets a new user and a new `HOME` (`/sessions/<slug>`). Something installed under `HOME` in one task (for example `pip install --user` into `~/.local/bin`) is gone in the next task (MEASURED, Desktop 2.31226.1, n=1). Installing tools in that shell: L173.

## For an author

- Don't design a skill around Manual mode stopping shell or file writes: in a local session it doesn't.
- Expect a failed `rm` before the delete card in a connected folder; handle the first failure instead of treating it as final.
- Use your own scratch directory (outputs or `mktemp -d`), never a fixed `/tmp/<name>`: another session can read it, and a stale copy owned by another session can't be overwritten.

---

# LESSON 228 — THE MODEL SEES VM PATHS; AUDIT.JSONL AND THE UI SHOW HOST PATHS

**In a local Cowork session the model works with VM paths under `/sessions/<id>/mnt/…`. Desktop rewrites those paths to host paths in every message it receives, before the message reaches the UI and `audit.jsonl`. So a path in `audit.jsonl` or on screen is not what the model saw or typed.**

## Where the rewrite happens (CODE-READ, asar 2.31226.1)

- The `mcp__workspace__bash` handler (`index.chunk-QEr06WaZ.js` `pp`) returns the VM's raw output. No rewrite in the tool.
- `QEr`: `let o=D.v(w.n(i),e,this.delegate.buildVMPathContext(e))`, where `D.v` is `k` in `Bwge5-J7`, runs on every SDK message Desktop receives, before it goes to `messageBuffer` (the UI) and `auditLog` (`audit.jsonl`). No gate.

| part | value |
|---|---|
| Match (regex `A`) | `(?<![a-zA-Z0-9])(/sessions/<vm>/mnt/[^\s)"`\]\\]+)`, plus `file://` and `computer://` forms |
| Mapped roots (`y`) | `outputs` and `uploads` (under `sessionStorageDir`), `.host-home`, `.auto-memory`, connected folders (via `mountNameMap`) |
| Not mapped | `.claude`, `.claude/skills`, plugin mounts, `.scheduled`; a bare `/sessions/<id>` (the `pwd`) |
| Paths with `..` | the mapper returns null; the text stays as is |

## The other direction (CODE-READ)

- Commands going into the VM: only plugin paths are mapped host → VM (`Uf`/`Gf`). A host path to a connected folder is **not** rewritten.
- `qLt` refuses commands that target host-only folders: "That command targets X, which bash cannot reach from the sandbox…" (gate `1978029737`, field `bashHostOnlyIntercept`, default true).

## Observed (MEASURED, Desktop 2.31226.1, Team, local)

- Mounts visible to the model: the connected folder's alias, `outputs`, `uploads`.
- A command recorded in `audit.jsonl` showed `AD=~/Library/Application Support/...` (a host path with a space); the model had typed the VM path.

## For an author or tester

- To learn what the model actually saw, read the VM side (the transcript's raw tool input or a probe that writes `pwd`), not `audit.jsonl` or the UI.
- Write VM paths in skill instructions. A host path to a connected folder will not work in bash.
- A path that comes back as `/sessions/...` in the UI is in an unmapped root (skills, plugins, `.claude`) or contains `..`.

---

# LESSON 229 — LOCAL EXTENSIONS (.MCPB) IN DESKTOP: UPDATES, CONFIRMATIONS, ERRORS, SETTINGS

**A sideloaded `.mcpb` never auto-updates. Desktop's client for local extensions doesn't advertise elicitation, so a server can't ask the user to confirm through a dialog. The user approves a call on Desktop's card, and "Always allow" there lasts across sessions. A JSON-RPC error from a local server reaches the user and the model only as a generic message. For how the server is launched and what environment it gets, see L224 (Chapter 62).**

## Updates (CODE-READ, asar 2.31226.0 `index.chunk-BC1wbmHw.js`; 2.31226.1 `index.chunk-Bk8mxCPb.js`)

- When `isDxtAutoUpdatesEnabled` is true (the default), Desktop checks for extension updates every 6 h (`216e5` ms); `main.log` shows "Starting periodic extension update checks".
- The check filters out ids starting `local.dxt`, `local.mcpb` or `local.unpacked`. An extension installed from a file never updates; install the new file by hand.
- Directory extensions download an update to a cache and apply it later.

## No elicitation (CODE-READ, asar 2.31226.1 `index.chunk-BEWlG8Pv.js`)

`LocalMcpServerManager`'s MCP client capabilities are `{roots?, extensions:{"io.modelcontextprotocol/ui", …}}`, with no `elicitation`. Only remote and custom-3p connector clients advertise `{elicitation:{url:{}}}`, and only URL mode. A local server's confirm-by-dialog path can never fire, so it needs a fallback, for example refusing with "requires confirm=true" and letting the model ask in chat.

## When Desktop asks before an extension's tool runs (CODE-READ, asar 2.37337.1 and 2.42304.0)

In Cowork and Code sessions an extension's tool calls pass Desktop's MCP tool-call gate (`mC`, 2.37337.1 `index.chunk-DPv6qSYD.js`). It checks in this order:

1. A tool in `disallowedTools` is refused.
2. A tool in the spawn's `allowedTools` runs. Desktop's own tools are listed there; an extension's tools are not.
3. A grant already given runs it. That means "Allow for this task" (a session rule) or a lasting "Always allow".
4. Bypass mode runs it. In Cowork this is the only mode that waives the card, and a fixed set of tools asks even then.
5. In Cowork's Auto mode a tool annotated `readOnlyHint: true` runs without a card (logged `auto_read_only`). Code sessions don't take this branch.
6. Anything else shows the approval card.

**"Always allow" is lasting.** The card is drawn by Desktop's interface code (ion-dist). Choosing "Always allow" saves an approval on the account for that tool (`toggleMcpToolAlwaysApproved`). The key is the tool's switch key plus a hash of the tool's definition, so the card comes back when an update changes the tool. The interface says so: "This tool has changed since you chose to always allow it, so it needs your approval again." It also says "“Always allow” choices now persist after you quit the app."
- An admin of a third-party deployment can set `mcpPersistentAlwaysAllowEnabled` to `false`. The card then offers "Allow for this session" instead. From 2.42304.0 this also covers Code sessions on the device, in WSL and over SSH (per the notes).
- An organization can switch "Always allow" off for Cowork while Chat keeps it: "‘Always allow’ is disabled for Cowork by your organization admin. It is still available in Chat mode." It is read as `coworkMcpWriteToolsAlwaysAllowEnabled`; that it applies only to write tools was not confirmed.

**Annotations.** `readOnlyHint` matters only in step 5. `destructiveHint` doesn't make Desktop ask about an extension's tool: Auto mode's re-prompt for destructive tools (L128) checks `isDestructiveConnectorTool`, which returns false for any local server. The admin per-tool policy (`managedMcpServers` `toolPolicy`) doesn't govern a local server either; `getManagedToolPolicy` returns early for one.

Not established: the card for a `.mcpb` on 2.42304.0 was not watched, and the plain Chat tab was not read.

## Observed (MEASURED, Desktop 2.31226.0/.1, one real extension)

| behaviour | n |
|---|---|
| A JSON-RPC error from the server (code -32602) shows as "The connector returned an error or an invalid response"; the server's text reaches neither the model nor the user | 1 |
| A tool result with `isError:true` carries its text through to the model | 1 |
| A Read-only toggle in the extension's settings saved as `false` twice, then saved correctly when done step by step (Save, then disable/enable). Cause of the first two unknown | 2 + 1 |
| Disable/enable restarts the server twice within about a second with a brief "unable to connect to extension server" notice; once it left the extension disabled | 1 extension, several restarts |
| A successful tool result rendered blank in Desktop's card and filled in minutes later | 1 extension, many calls |
| With a claude.ai connector for the same service also connected, a generic prompt went to the claude.ai connector; naming "the local … MCP" routed it to the extension | 1 |

## In the official release notes (checked 2026-10-16)

- **Announced:** that "Always allow" for MCP tools is persistent, through the admin key that turns it off (`mcpPersistentAlwaysAllowEnabled`, 1.24012.9; extended to Code sessions in 2.42304.0); read-only tools from managed and built-in servers offering "Always allow" (2.9939.2); and "Allow for this task" for connector tools (1.22209.0, 1.25927.0).
- **Not in the notes:** that the lasting approval is keyed to a hash of the tool's definition and asks again when the tool changes; the gate's order; that Auto mode runs a `readOnlyHint` tool without a card in Cowork; that `destructiveHint` and the managed `toolPolicy` don't apply to local servers; the Cowork-only switch for "Always allow"; the missing elicitation; and that a sideloaded `.mcpb` never updates. No note names `readOnlyHint` or `destructiveHint`.

## For an extension author

- Report expected failures as a tool result with `isError:true` and a clear message, not as a JSON-RPC error.
- Don't depend on elicitation for confirmations in Desktop; make the confirm a tool argument and explain it in the refusal text.
- Don't count on a confirm argument as the user's consent: the model fills it in. The user's checkpoint is Desktop's card, and one "Always allow" removes it for that tool until the tool's definition changes.
- Ship a new `.mcpb` for each fix and tell users to reinstall; there is no update path for sideloaded files.
- After changing a setting, check that it was saved (reopen the panel, or have the server log the value it got) before testing.
- If your server overlaps a claude.ai connector, give your tools distinct names and descriptions so the model can choose.

---

# LESSON 230 — PLUGIN INSTALLS: DESKTOP REWRITES FRONTMATTER, AND SWITCHING OFF AN ORG-MARKETPLACE PLUGIN DELETES ITS COPY

**An installed plugin's skill and agent files are not byte copies of the source: Desktop re-serializes their YAML frontmatter. Org-marketplace sync installed the plugin folder's `tests/` too (one case). Switching an org-marketplace plugin off removes its local copy at the next sync.**

## Frontmatter is rewritten (MEASURED, n=2 copies, Desktop 2.31226.1)

Compared against the source: an uploaded zip and an org-marketplace copy of the same plugin.

- 14 files (`agents/*.md`, `skills/*/SKILL.md`) differ byte-wise from the source.
- In all 14 the body is byte-identical and the frontmatter is equal as parsed YAML. A folded multi-line `description: >` became one line.
- So a byte diff of an installed plugin against its source reports false differences. Compare bodies and parsed frontmatter instead.

## Marketplace sync installs everything (MEASURED, n=1)

The marketplace copy had 571 files against 279 in the zip, because `tests/` was installed too. The compression-ratio check on uploaded zips (L223) doesn't apply to marketplace sync.

## Switching off deletes the copy (MEASURED, n=1, Team)

- After a Team marketplace plugin was switched off, the next sync logged "1 orphans cleaned" and removed its `rpm` folder.
- Customize then showed **Add** instead of a switch. Add re-downloaded it.
- So "off" for an org-marketplace plugin means uninstalled, not disabled; any local edits to the installed copy are gone.

## A marketplace listed in the settings file never refreshes (MEASURED, n=1, Team, Desktop 2.31226.1)

An organization's `cowork_settings.json` can name a marketplace under `extraKnownMarketplaces` (here a GitHub repository). Desktop installed from it once and never fetched it again:

- The cloned copy was months old while the repository had newer versions. The installed plugin was still the old version, and its **Update** was disabled because Desktop knew of nothing newer.
- **Manage marketplaces** didn't list that marketplace, so nothing in the UI refreshed it.
- Adding the same repository through **Add marketplace** cloned it fresh and installed the current version alongside.
- Customize then showed only the new copy, because the plugin names were the same. The old copy stayed **enabled**: the log kept counting it ("Found 3 enabled local plugins").
- Setting the old entry under `enabledPlugins` to `false` in `cowork_settings.json` took it out: the next task logged "Found 2 enabled local plugins (3 installed)". Its cached copy stayed on disk, unlike an organization-marketplace plugin that is switched off.
- That log line doesn't count plugins the organization pushes. In three later Team tasks an org plugin was loaded and its hooks ran, yet each spawn logged "Found 1 enabled local plugins (3 installed)": the 1 was the one Customize-installed plugin left on.

## Uploading a plugin the organization already provides (MEASURED, n=1 per organization, Desktop 2.31226.1)

- In a Team organization that provides founder-skills 0.18.4 from a marketplace, uploading founder-skills 0.19.0 as a zip (Customize → Plugins → Upload plugin) showed **no** clash, replace or keep-both dialog. It installed a second, private copy ("@My Uploads"), switched on, in its own `rpm/plugin_<id>` folder. The marketplace copy stayed installed and switched on.
- So a task could load both copies, and both copies' hooks. To test an upload alone, switch the other copy off for the test. Here that removed it from the task's `plugins` list: only the upload loaded.
- The marketplace copy was switched off for about 16 minutes. Two plugin syncs ran in that time, each logging "0 orphans cleaned", and its `rpm` folder stayed; switching it back on kept the same folder. This differs from the switch-off case above, which removed the folder at the next sync. Whether this marketplace is an organization marketplace in that case's sense was not checked.
- An upload in one organization doesn't appear in another. The same zip had to be uploaded again under Personal, and there too it installed beside the copies already listed, with no dialog.
- **When a private upload of the same name already exists, a dialog appears** (MEASURED, Personal, Desktop 2.37337.1, n=1). Uploading founder-skills 0.19.1 over the private 0.19.0 showed **"Replace existing plugin?"**, with Cancel and Replace and no keep-both option; renaming the plugin in `plugin.json` keeps both.
  - Replace overwrote the private copy, and the replacement arrived **off**, as the replaced copy had been.
  - Switching it on then showed a trust dialog: the plugin "includes components that run code", and enabling it grants access to everything on the computer.
  - **What opens it** (CODE-READ, ion-dist 2.42304.0 `caa0e4640-DK_6mBbz.js` and `ccffdda69-CyGf2pRl.js`): the server, not a name check in the app. A private upload is sent first without overwrite. Only when the server refuses it with `plugin_upload_already_exists` does the app show the dialog (`kind:"conflict"`). Replace sends the same file again with overwrite on; Cancel sends nothing and leaves the file selected. The app's list of installed plugins only picks the wording: "…is already installed from the {source} marketplace" when the same-named copy came from a marketplace, plain "…is already installed" otherwise. A marketplace copy is installed, not uploaded, so it never meets that check, which is why installing one never showed the dialog.
- **What triggers the dialog is OPEN.** The two measurements differ in two ways at once: the build (2.31226.1 vs 2.37337.1) and the existing copy (marketplace vs private upload).
  - The dialog lives in the UI bundle (`ion-dist`, no old copy to compare). Two code paths raise it (CODE-READ):
    - Desktop's own upload call, `uploadPlugin(…, replaceExisting)`, on a conflict;
    - the account's plugin save, on `plugin_upload_already_exists`.
  - On Desktop's own path (`installPluginFromZipWithPaths`, unchanged since 2.31226.1), a replaced marketplace copy keeps its on/off state, but a replaced earlier upload is switched on.
  - On the account path the server decides, and the UI says the plugin "was replaced and is now off". That matches what was seen.
- **The trust dialog** appears when a plugin has local MCP servers, hooks, monitors, CLIs or privileged reach (CODE-READ, `ion-dist`). A plugin with only skills, commands and agents gets none.

## A related default (MEASURED)

The scheduled-task delete dialog has "Also delete files on disk" **on** by default.

## For a plugin author

- Don't check an install by hashing files; compare bodies and parsed frontmatter.
- Don't rely on a particular YAML style (folded blocks, comments, key order) in frontmatter surviving install.
- Keep `tests/` and large fixtures out of the plugin folder, or expect them installed on every machine through the marketplace.
- Never edit an installed org-marketplace copy in place; it is deleted when the plugin is switched off.
- If users first installed your plugin from a marketplace named in the settings file, they won't get updates. Tell them to add the marketplace through Add marketplace and switch the old entry off in `cowork_settings.json`. Turning it off in the UI isn't possible, because the UI shows only the new copy.
- Don't read "Found N enabled local plugins" as the full set a task loads; org-pushed plugins aren't in it.
- Uploading a new version of a plugin the organization already provides adds a second copy rather than replacing it. Before testing an upload, switch the other copy off, and check the task's `plugins` list for which one loaded. Upload separately in each organization you test in.
