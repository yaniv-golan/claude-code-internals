Updated: 2026-10-11 (L226–L230) | Source: the installed **Claude Desktop `app.asar` 2.31226.1** and its UI bundle (`ion-dist`, 2.31226.0 and 2.31226.1), read but **not diffed** against an earlier build, so nothing here is claimed as new; plus live runs on Desktop 2.31226.0/2.31226.1 between 2026-10-09 and 2026-10-11 in a Personal org and a Team org (local and cloud Cowork tasks, a phone-started task, a real MCPB extension, an uploaded and an org-marketplace copy of one plugin). Minified names are given with their chunk file, because the same short name is reused across chunks.

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
| Team | Switch ON; Desktop-started tasks ran locally | many sessions |
| Team | A task started from the phone app in Cowork mode ran in the **cloud** despite the switch | 1 |
| Team | A phone task sent as plain chat (not Cowork) got the skill without its plugin scripts; the skill reported its shared scripts unreachable | 1 |

## The composer's Auto/Manual choice (CODE-READ, `shared-8` `Wj`/`Uj`/`Kj`)

Sticky per org in the browser's local storage, key `cowork-unsupervised-sticky` = `{mode, orgUuid, chromeSkipAll?, keyFormat:4}`. Picking Manual writes `{mode:"manual-opt-out"}`. Nothing is written to the account. Because Auto/Bypass can force local (row 5), a sticky mode can change routing from one task to the next.

## For an author or tester

- Start every probe with a lane check: `pwd`, `echo $HOME $CLAUDE_CODE_ENTRYPOINT $CLAUDE_CODE_REMOTE`. Local Cowork runs under `/sessions/<slug>`; cloud Cowork under `/home/claude` with `ENTRYPOINT=remote_cowork`.
- Don't infer the lane from the switch, the org, the permission mode or the device that started the task.
- A skill that needs plugin scripts must say so and fail clearly when they are missing (the phone-chat case).

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

**A sideloaded `.mcpb` never auto-updates. Desktop's client for local extensions doesn't advertise elicitation, so a server can't ask the user to confirm through a dialog. A JSON-RPC error from a local server reaches the user and the model only as a generic message. For how the server is launched and what environment it gets, see L224 (Chapter 62).**

## Updates (CODE-READ, asar 2.31226.0 `index.chunk-BC1wbmHw.js`; 2.31226.1 `index.chunk-Bk8mxCPb.js`)

- When `isDxtAutoUpdatesEnabled` is true (the default), Desktop checks for extension updates every 6 h (`216e5` ms); `main.log` shows "Starting periodic extension update checks".
- The check filters out ids starting `local.dxt`, `local.mcpb` or `local.unpacked`. An extension installed from a file never updates; install the new file by hand.
- Directory extensions download an update to a cache and apply it later.

## No elicitation (CODE-READ, asar 2.31226.1 `index.chunk-BEWlG8Pv.js`)

`LocalMcpServerManager`'s MCP client capabilities are `{roots?, extensions:{"io.modelcontextprotocol/ui", …}}`, with no `elicitation`. Only remote and custom-3p connector clients advertise `{elicitation:{url:{}}}`, and only URL mode. A local server's confirm-by-dialog path can never fire, so it needs a fallback, for example refusing with "requires confirm=true" and letting the model ask in chat.

## Observed (MEASURED, Desktop 2.31226.0/.1, one real extension)

| behaviour | n |
|---|---|
| A JSON-RPC error from the server (code -32602) shows as "The connector returned an error or an invalid response"; the server's text reaches neither the model nor the user | 1 |
| A tool result with `isError:true` carries its text through to the model | 1 |
| A Read-only toggle in the extension's settings saved as `false` twice, then saved correctly when done step by step (Save, then disable/enable). Cause of the first two unknown | 2 + 1 |
| Disable/enable restarts the server twice within about a second with a brief "unable to connect to extension server" notice; once it left the extension disabled | 1 extension, several restarts |
| A successful tool result rendered blank in Desktop's card and filled in minutes later | 1 extension, many calls |
| With a claude.ai connector for the same service also connected, a generic prompt went to the claude.ai connector; naming "the local … MCP" routed it to the extension | 1 |

## For an extension author

- Report expected failures as a tool result with `isError:true` and a clear message, not as a JSON-RPC error.
- Don't depend on elicitation for confirmations in Desktop; make the confirm a tool argument and explain it in the refusal text.
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

## A related default (MEASURED)

The scheduled-task delete dialog has "Also delete files on disk" **on** by default.

## For a plugin author

- Don't check an install by hashing files; compare bodies and parsed frontmatter.
- Don't rely on a particular YAML style (folded blocks, comments, key order) in frontmatter surviving install.
- Keep `tests/` and large fixtures out of the plugin folder, or expect them installed on every machine through the marketplace.
- Never edit an installed org-marketplace copy in place; it is deleted when the plugin is switched off.
- If users first installed your plugin from a marketplace named in the settings file, they won't get updates. Tell them to add the marketplace through Add marketplace and switch the old entry off in `cowork_settings.json`. Turning it off in the UI isn't possible, because the UI shows only the new copy.
- Don't read "Found N enabled local plugins" as the full set a task loads; org-pushed plugins aren't in it.
