Updated: 2026-10-11 (L231–L232) | Source: **Claude Desktop `app.asar` 2.31226.0 and 2.31226.1 diffed against 2.26454.2** (all three builds read; the two vendored agent-SDK chunks are content-identical between 2.26454.2 and 2.31226.0, so every change found there is Desktop's own code; 2.31226.0 → 2.31226.1 changes 4 of 353 build files, the bundled agent and data), the **live GrowthBook cache decoded on 2026-10-10** (416 features), and the agent staging folder on the capturing Mac read on 2026-10-11. Nothing here was probed live in a session. Minified names are given with their chunk file, because the same short name is reused across chunks; chunk names are from 2.31226.1.

# Chapter 64: Desktop 2.31226 — Attached-Folder Requests, Dispatch's Task Switch, Spawn Environment and Third-Party Imports

---

## TABLE OF CONTENTS

231. [Lesson 231 — What Desktop 2.31226 Changed in Cowork Permissions and Scheduled-Task Creation](#lesson-231--what-desktop-231226-changed-in-cowork-permissions-and-scheduled-task-creation)
232. [Lesson 232 — What Desktop 2.31226 Changed in the Bundled Agent, Its Environment and Third-Party Imports](#lesson-232--what-desktop-231226-changed-in-the-bundled-agent-its-environment-and-third-party-imports)

---

# LESSON 231 — WHAT DESKTOP 2.31226 CHANGED IN COWORK PERMISSIONS AND SCHEDULED-TASK CREATION

**From Desktop 2.31226.0, a `request_cowork_directory` call that names a folder already attached to the session is allowed without a card, in Manual mode too, and is recorded as `permission_auto_approved` with `source:"attached_folder"`. A scheduled task created through Dispatch is now checked against its own server switch (gate `1908184743`) instead of the organization's "no new local scheduled tasks" flag. While that gate is served off, Dispatch can create a local scheduled task in an organization that has turned new local scheduled tasks off. The routine-migration sweep keeps a folder-bound task local when the organization's Cowork remote control is off, and Desktop's scan of a plugin's `hooks.json` now skips malformed entries instead of the whole file. All CODE-READ; none of it was probed live.**

## An already-attached folder skips the card (CODE-READ, `index.chunk-QEr06WaZ.js`)

The forced-ask PreToolUse hook is unchanged: the same nine tools, `request_cowork_directory` among them, still get `permissionDecision:"ask"` (L227). The new branch is in Desktop's `canUseTool`, which handles that ask:

```
if(u!==void 0&&!t.Hy(e)&&!c&&!t.KY("912981541")&&te.viaHostCliLauncher===!1&&!t.eO(l)&&!f)
  → {behavior:"allow", …, decisionClassification:"user_permanent"}
```

| term | meaning |
|---|---|
| `u` | the requested path resolves to a folder already attached to the session |
| `t.Hy(e)` | the tool is on an admin-policy ask list (excluded) |
| `c` | `RD` → `Xer` (`index.chunk-Cyt2WTko.js`): the request carries an ask reason other than the forced-ask text (excluded) |
| `viaHostCliLauncher`, `t.eO(l)` | a session started through the host CLI launcher (excluded) |
| `f` | a scheduled-task run whose task did not itself select that folder (`Tm`; excluded) |
| `912981541` | kill switch; **absent** from the 2026-10-10 fcache, so the branch is active |

When it fires, `audit.jsonl` gets `{type:"system", subtype:"permission_auto_approved", tool_name, source:"attached_folder"}`, `main.log` gets "[canUseTool] Allowing request_cowork_directory without a card: the folder is already attached to the session", and telemetry `lam_builtin_tool_auto_mode` carries `outcome:"attached_folder_allow"`. A second site in the same chunk, under the same kill switch, skips re-adding an already-resolved folder in a host-loop session. A folder that is **not** yet attached still gets the card.

## Dispatch has its own create switch (CODE-READ, `index.chunk-Cyt2WTko.js`; refusal text in `index.chunk-hKMR2oV6.js`)

```
newLocalTasksOff:     ()=>Kl()?.coworkNewLocalScheduledTasksOff===!0&&W().type!=="3p"&&!iy()
dispatchLocalTasksOff:()=>zy("1908184743")==="on"&&W().type!=="3p"&&!iy()     // new in 2.31226.0
createAndSave(e,t){ … if(t?this.dispatchLocalTasksOff():this.newLocalTasksOff()){ …refused… } }
```

- `t` is `madeByDispatch`. Before 2.31226.0 every create went through `newLocalTasksOff`.
- `coworkNewLocalScheduledTasksOff` is an organization/account flag the server delivers, in the same schema as `isEnterprise`, `coworkRemoteScheduledTasksEnabled` and `coworkTrustedDevicesRequired`. It is not a managed (MDM) setting.
- Gate `1908184743` is served **off** (`defaultValue`) on 2026-10-10. So today a Dispatch create is refused by nothing on this path, whatever the organization flag says. A create from a Cowork session or the app still obeys the organization flag.
- A refused Dispatch create tells the model "Dispatch can no longer create scheduled tasks, so nothing was created." and to have the user create it in the app. Other refused creates keep the existing "Scheduled tasks can no longer be created on this computer…" text.
- Importing sibling scheduled tasks also honours `newLocalTasksOff` (`local_tasks_off`).

## The migration sweep keeps a bound task local when remote control is off (CODE-READ, `index.chunk-QEr06WaZ.js`)

The `[RemoteMigrationSweep]` config (value gate `2974609625`, L208) gains two code keys, both default `true`:

- **`coworkRemoteControlOffKeepsLocal`**: for a bound task (one with attached folders or files), `Us` compares the organization's `cowork_remote_control` account setting. A status that is set and is neither `available` nor `blocked_by_org_tier` returns `remote_control_disabled` (an unset status does not); a reading that belongs to a different organization returns `remote_control_unknown`. Either way the task is skipped with `requiresComputer:true` and stays a local scheduled task.
- **`protectedDataSignHold`**: holds the signed migration while the operating system's protected data (the keystore) is unavailable (INFERRED from the names).

The served value on 2026-10-10 carries neither key, so both defaults apply. It otherwise serves `enabled`, `boundEnabled` and `boundFilesEnabled` true, `passIntervalMinutes` 30, `maxMigratesPerPass` 10 and `heldBlockReasons:["space"]`.

## Desktop's `hooks.json` scan skips malformed entries (CODE-READ, `index.chunk-Cyt2WTko.js`)

Desktop's own scan of an installed plugin (`paa`, log tag `[HookParsing]` `caa`) used to validate the whole `hooks.json` against one schema and drop the file on any failure. With gate `4261020843` (`laa`, read `Ry(laa,!0)`: default on, absent from the fcache) it now parses each event and each matcher entry separately (`uaa`), keeps the valid ones, and logs a `main.log` warning with the counts of skipped events and matcher entries and the plugin name. This is Desktop's scan only (it feeds what Desktop knows about the plugin). The agent loads hooks with its own loader, which this change does not touch (INFERRED from the caller).

## Served state on 2026-10-10 (MEASURED, live fcache)

- `2486083521` (`cuCanUseToolEnabled`, the Computer Use permission gate) and `946844604` (the cloud memory relay) are force-ON again; both were off at the 2026-10-07 capture (L222).
- `3229517805` is back to `defaultValue` and serves only `debugLogEnabled` and `verifyToolsEnabled`, so local-artifact sharing (`sharingEnabled`, `autoPublishEnabled`) reads its default, off.
- At a later capture the same day (2026-10-11 16:42) all three were back to their 2026-10-07 values: `2486083521` and `946844604` off (`defaultValue`), `3229517805` force-on with `sharingEnabled` and `autoPublishEnabled` true. These three follow the organization Desktop has selected (L234): the off/force-on/default-config pattern is Team's, the other is Personal's. Read the live fcache, and note the organization, before relying on any of them.
- `1908184743` off; `912981541` and `4261020843` absent (their code defaults apply: the attached-folder branch and the tolerant scan are on).

## Who this affects and what to do

- **Skill authors.** Don't use `request_cowork_directory` as a way to make the user confirm access to a folder the session already has: no card appears. To find these allows afterwards, search `audit.jsonl` for `source:"attached_folder"`.
- **Testers counting cards.** L227's always-ask set still applies, except for this case; script the attached-folder request separately.
- **Admins.** In 2.31226.x the organization flag that turns off new local scheduled tasks does not stop Dispatch from creating one while gate `1908184743` is off. If that matters, check the scheduled-task list after Dispatch use. Turning Cowork remote control off keeps folder-bound scheduled tasks on the computer instead of migrating them.
- **Plugin authors.** Validate `hooks.json` yourself. Desktop showing some of a plugin's hooks no longer means the whole file parsed.

---

# LESSON 232 — WHAT DESKTOP 2.31226 CHANGED IN THE BUNDLED AGENT, ITS ENVIRONMENT AND THIRD-PARTY IMPORTS

**Desktop 2.31226.1 bundles agent 2.1.295 from the regular release path; 2.31226.0 still shipped 2.1.293 from a release-candidate path. From 2.31226.0 Desktop adds `CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST=1` to the environment it builds for Code-tab sessions and the remote-control tool host (not the Cowork local-agent spawn), which lets the agent keep auto-updating plugins although Desktop disables its own updater; it sets `CLAUDE_CODE_DESKTOP_SKILL_SWITCHES=1` only on third-party (custom inference) installs. The third-party history import grows from sessions to six kinds, each with its own kill key; memory is imported only under a gate that is not served, and an imported skill the server did not scan is deleted again. A relay for plugin UI events in Cowork sessions is in the code but dark.**

## The bundled agent (MEASURED)

| Desktop | agent | fetched from | SDK |
|---|---|---|---|
| 2.31226.0 | 2.1.293 (commit `3abc54a9…`) | `downloads.claude.ai/claude-code-releases/rc/<commit>` | `0.3.293-rc…` |
| 2.31226.1 | 2.1.295 (commit `07e8f67e…`, built 2026-10-08) | `downloads.claude.ai/claude-code-releases` | `0.3.295` |

`manifestSignatureEnforcement` stays `"flag"`. On the capturing Mac (2026-10-11) the agent runs from `~/Library/Application Support/Claude/claude-code/2.1.295/9d6405864fdc/claude.app`. The folder's `.verified` file holds the full sha256 `9d6405864fdc2c95…`, which equals the manifest's darwin-arm64 **`bundle.checksum`** (not the checksum of the `claude.zst` binary), and the folder name is its first 12 hex digits. Only the 2.1.295 folder is present.

## `CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST` (CODE-READ, `index.chunk-Cyt2WTko.js`)

```
async function HHr(e){VHr(e),await BHr(e)||(e[bqe]="1")}     // bqe = "CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST"
```

- `VHr` first deletes any inherited copy, case-insensitively.
- `BHr` returns true, so the variable is **not** set, when: gate `4274920779` is off (`Ry("4274920779",!0)`: default on, absent from the fcache); the install is third-party; Desktop's own auto-update is disabled (`autoUpdate.disabled`); `UHe()` holds (not traced); the inherited or login-shell environment sets `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` (`RHr` over `LHr`); the login shell has no `HOME`; or the check throws.
- The only caller is `OUr` (exported `wv`), which builds the environment for Code-tab sessions (`index.chunk-BCHP6ll9.js`) and the remote-control tool-host helper (`index.chunk-B1oFmUyS.js`). It runs on the process plus shell environment before `HJ` adds the managed block, whose `MFr` always sets `DISABLE_AUTOUPDATER:"1"`. The Cowork local-agent spawn (`index.chunk-QEr06WaZ.js`) builds its environment from `HJ` directly and so gets `DISABLE_AUTOUPDATER=1` without the marker.
- What the agent does with it (CODE-READ, agent 2.1.295 `Ooe`): it decides whether **plugin** auto-update is skipped. Without the marker, plugin auto-update is skipped whenever the agent's own auto-updater is disabled ("Plugin autoupdate: skipped (auto-updater disabled)"), which `DISABLE_AUTOUPDATER=1` causes. With the marker, that is no longer a reason; plugin auto-update is skipped only for another disable reason (`rA(!1)`, not traced) or one found under the host's pin (`findSkipReasonUnderHostPin`, logged "Plugin autoupdate: off under the host's pin (…)"). `FORCE_AUTOUPDATE_PLUGINS` overrides both. The agent also deletes the marker from the environment of processes it starts.

## `CLAUDE_CODE_DESKTOP_SKILL_SWITCHES` (CODE-READ, `index.chunk-Cyt2WTko.js`)

`MFr(e.localAgent?"cowork":"code")` passes `skillSwitches:t.usesLocalSkillStorage()` into the managed block `WBt`, which adds `...n.skillSwitches&&{CLAUDE_CODE_DESKTOP_SKILL_SWITCHES:"1"}`. `usesLocalSkillStorage()` returns true in the third-party provider class and false in the first-party one (class identity read from position in the file, INFERRED), so the variable reaches Cowork and Code-tab sessions on third-party installs only. Agent 2.1.295 stores it in session state (`setDesktopSkillSwitches`); what it then changes was not traced. Desktop still sets neither `CLAUDE_CODE_HOST_SKILL_CATALOG` nor `CLAUDE_CODE_REMOTE_TOOLS_HOST_ALLOWS_UNATTENDED`.

## The third-party history import (CODE-READ, `index.chunk-Bylz1u4k.js`, `index.chunk-CSeX1oWS.js`)

The importer that brings a third-party install's local history into a claude.ai account (direction INFERRED from the log tags `[claude-ai-import:…]`, telemetry `desktop_third_party_import`) used to import sessions only. It now runs six steps:

```
T=["sessions","projects","scheduledTasks","memory","skills","mcpServers"]
```

| step | condition |
|---|---|
| any | not `disableThirdPartyHistoryImport` |
| projects / scheduledTasks / skills / mcpServers | not the matching kill key in value gate `1978029737`: `disableThirdPartyProjectsImport`, `…ScheduledTasksImport`, `…SkillsImport`, `…McpServerImport` |
| memory | gate `2766090483` on **and** the import allowed by managed configuration or the override, not by the organization setting (`oe`, `C`). The gate is absent from the fcache, so memory is never imported today |
| skills | uploaded to the organization. If the server's reply lacks `scan_requested`, Desktop logs "uploaded without a content scan" and deletes the skill with `POST /api/organizations/<org>/skills/delete-skill` (`Y`); a skill deleted this way is not counted as imported and ends the skills step for that pass. A failed delete logs "unscanned upload not removed" |

Gate `659073223`, when on, stops the claimed-import path with "switched off remotely"; it is absent, so that path is not switched off. New IPC methods `HistoryImport_$_listSourceExtras` and `HistoryImport_$_importSourceExtras` drive the new steps. Reachability depends on organization and managed settings and was not probed.

## A dark relay for plugin UI events (CODE-READ, `index.chunk-Aip7qImQ.js`)

A new `[coworkUiSurface]` module relays `type:"system"` messages from a fixed subtype set, including `ui_log` (a top-level `{kind:"log", plugin, text}` notice) and `ui_invalidate`, from a Cowork session to the renderer (IPC event `EngineSurface_$_uiSessionChanged`), holding up to 32 early messages until the session's initialize result says it serves a UI surface. `mayServe` requires a host-loop session that is not a host-CLI-launcher or chat session **and** gate `3922223025`, which is absent from the fcache, so nothing is relayed. INFERRED: the Desktop half of plugin UI (panes, notices) for Cowork. A lead until the gate is served.

## Who this affects and what to do

- **Tools that read the agent's environment.** `DISABLE_AUTOUPDATER=1` is always set by Desktop. Expect `CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST=1` in Code-tab sessions and the remote-control helper of first-party installs, not in Cowork local sessions.
- **Plugin authors.** In a first-party Code-tab session on agent 2.1.295 or later the `DISABLE_AUTOUPDATER=1` that Desktop sets no longer stops the agent auto-updating plugins; in a Cowork local session it still does (no marker). Code-read, not probed: check the installed version rather than assuming either.
- **Testers pinning the agent version.** Read the folder under `claude-code/<version>/` and its `.verified`; the 12-hex folder name is the manifest's bundle checksum prefix.
- **Third-party admins.** Skills may behave differently from a first-party install once the agent acts on `CLAUDE_CODE_DESKTOP_SKILL_SWITCHES`; that behaviour is not traced yet.
- **Admins moving a third-party install to a claude.ai organization.** Projects, scheduled tasks, skills and MCP servers can now come across, each switchable off. Memory needs both a managed allow and a gate that is not served. Check the organization's skills list afterwards: a skill the server did not scan is removed again.
