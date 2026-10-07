Updated: 2026-09-25 | Source: **`app.asar` 2.9939.2** (sha256 `fe0c6d44b118a8ea436d3c3f539dcd31008e6f8f1d2568fc9ef84e860e33d24d`, the live install) and 2.7032.0, backed-up asars back to 1.18286.2, **agent 2.1.197 / 2.1.241 / 2.1.246 / 2.1.280 / 2.1.281**, the claude.ai interface code (the copy bundled in the app plus three builds the Desktop fetched on 2026-09-24/25), the live fcache (captured 2026-09-24 22:33Z), this machine's Desktop log and 2,123 local Cowork transcripts, **a live probe plugin run in cloud Cowork on 2026-09-24 and in local Cowork on 2026-09-25**, and **four live lane tests on 2026-09-25**. **Does NOT move the CLI or Desktop baselines.**

Prompted by a cowork-harness session that could not get a local Cowork session after a Desktop update, by a sibling session's review of the published "plugin hooks fire in Cowork" rule against three GitHub reports, and by the capturing user's own attempts to get a new task to run locally.

# Chapter 56: Scheduled Tasks Move to the Cloud, Plugin Hooks by Lane, and Where a New Task Runs

---

## TABLE OF CONTENTS

208. [Lesson 208 — Desktop Moves Local Scheduled Tasks to the Cloud on Its Own](#lesson-208--desktop-moves-local-scheduled-tasks-to-the-cloud)
209. [Lesson 209 — Plugin Hooks in Cowork, Event by Event and Lane by Lane](#lesson-209--plugin-hooks-in-cowork-event-by-event)
210. [Lesson 210 — Where a New Cowork Task Runs, and the Switch That Did Not Keep It Local](#lesson-210--where-a-new-cowork-task-runs)

---

# LESSON 208 — DESKTOP MOVES LOCAL SCHEDULED TASKS TO THE CLOUD

**A background sweep in Claude Desktop converts a local scheduled task into a cloud routine once it has a short track record. The task then runs in the cloud and reaches the user's Mac as a connected device. It is switched on server-side, present since Desktop 1.44121.1, and it is why a machine can stop starting local sessions without any update or setting change.**

## Observed

On the capturing machine an hourly scheduled task ran locally until the sweep took it:

```
2026-09-24 00:04  LocalAgentModeSessions.start …                      ← last local run (local time, UTC+3)
2026-09-24 00:23:10 [ScheduledTasks] Remote migration completed; local copy disabled: <task>
2026-09-24 00:23:10 routineFolderGrants: migrating local task <task> → trig_…
```

From then on the log shows no local session starts at all: the last `LocalAgentModeSessions.start` is 00:04:38 that night. (The `[remote-tools-device] served get_device_info` and `keep-awake` lines that follow are not a sign of the migration — they appear 33–188 times a day back to at least 2026-08-28, whenever cloud sessions reach the Mac.)

The migration ran under Desktop 2.7032.0, a day before the machine updated to 2.9939.2; the update was unrelated. Earlier in the week the same log shows the sweep deferring itself ("Deferring migration pass, retrying in 60s: the system slept or woke recently").

## The sweep

`[RemoteMigrationSweep]` (asar 2.9939.2, chunk `Cb2x-E4A`; identical in 2.7032.0) runs a pass every hour under the served config (the code's own default is every six hours, first pass ten minutes after launch), calls `completeRemoteMigration`, disables the local copy and stamps the task `migratedToRemote={triggerId, via:"sweep"}`. Its configuration is gate **`2974609625`**, force-on at the capture:

```
{enabled:true, boundEnabled:true, heldBlockReasons:["space"], passIntervalMinutes:60,
 minRunsObserved:2, minObservedDays:0.5, maxMigratesPerPass:10, failureCooldownMinutes:30,
 nextFireBufferMinutes:15, …}
```

So a local scheduled task that has run at least twice, with at least half a day between its first and last counted run, is a candidate — among other conditions. Two checks can keep it local (asar 2.16120.0; the same code in 2.9939.4):

- **Held reasons.** A reason listed in the served `heldBlockReasons` keeps the task local in every mode. The code accepts `chrome` and `built_in_browser` there as well as the task's own block reasons; for those two it also counts a task that merely used Chrome or the in-app browser (`Claude_Browser`) in an observed run. On 2026-10-01 the served list was `["space"]`, so only a task attached to a Space is held this way; Chrome use, in-app browser use and attached folders or files hold nothing.
- **Block reasons the cloud side can't take.** A schedule more often than hourly or a custom cron expression, a working directory, worktree or source branch, a dispatch hook, or no prompt keep the task local. Chrome use blocks only a move that is not tied to this computer; a **bound** move (below) takes it. Attached folders block unless bound moves are on (`boundEnabled`), and attached files unless the cloud side also accepts files (`boundFilesEnabled`, from 2.16120.0, L219); either way such a task moves only as a bound routine. Both switches were on at the 2026-10-01 capture.

A task whose next run is less than 15 minutes away waits for a later pass. Runs are counted against the task's current prompt, so editing the prompt restarts the count. Tasks already marked `migratedFromRemote` or `migratedToRemoteAt`, and watcher tasks, are skipped. A task tied to the device (local MCP servers, Chrome, computer use, folders) can still move, as a routine **bound** to this computer (`boundEnabled`). First present in the backed-up builds from Desktop 1.44121.1 (0 in every backup through 1.40609.1).

## Where a scheduled task is stored

A task's definition is a `SKILL.md` file, front matter `name` and `description` and the instructions as its body, at `~/Documents/claude/Scheduled/<task id>/SKILL.md` in the 2026-10-02 run (as the registry records it). The registry is `local-agent-mode-sessions/<acc>/<org>/scheduled-tasks.json` (top-level keys `scheduledTasks`, `recordedSkips`, `sundayAliasBoundaryStamped`, `dayFieldsOrBoundaryStamped`). Each entry has `id`, `displayName`, `enabled`, `filePath`, `createdAt`, `disableJitter`, `lastRunAt` and `observedToolUse`, which holds the run counts the sweep reads: `promptHash` and `promptSalt` (why editing the prompt restarts the count), `observedToolsVersion`, `runsObserved`, `firstRunAt`, `lastRunAt`, and per-kind counters `localMcpRuns`, `chromeRuns`, `computerUseRuns`, `requestFolderAccessRuns`, `builtInBrowserRuns` (Desktop 2.19675.0, a Team organization).

## What decides local or cloud for a new task

The Desktop main process decides only whether each lane is **allowed** (`placementRules`, per surface: device, SSH host, cloud). For Cowork only two rules can deny the device lane: an org requirement for self-hosted, and `cowork-local-tasks-off` for first-party accounts — the latch from gate `3634338308` (off by default at capture, and never logged as switched on here). With neither active, Cowork is "hybrid" and local is allowed. (Other rules — unreadable managed settings, `disableDesktopLocalSessions` — apply only to Claude Code surfaces; `no-self-hosted-endpoint` denies the cloud lane for third-party accounts.) The lane for each new task is picked by the claude.ai interface (L210).

A migrated routine can be moved back to "This computer" in its own settings; reverting keeps its `migratedToRemoteAt` stamp, so the sweep then skips it for good.

To confirm a local run, the Desktop log shows `LocalAgentModeSessions.start`, then `Starting local session local_<uuid> in /home/<slug>` and `[GBCache] Seeded GB cache into session local_<uuid>` (preceded by `[ScheduledTasks] Spawning new session for scheduled task <id>` for a routine). A cloud run produces no such line.

## Why it matters

When a scheduled task moves, it changes lane: its working directory, what a relative path means, which hooks fire and how (L209), what the shell can reach, and whether files it writes land on the Mac (L198). A skill written and tested against the task's local runs is suddenly running somewhere else, with no message to the user beyond the routine's location label. A test harness that depends on a scheduled task staying local will drift after two runs.

---

# LESSON 209 — PLUGIN HOOKS IN COWORK, EVENT BY EVENT

**Plugin hooks fire in both lanes, local and cloud sessions, with one exception: SessionStart did not fire in a new cloud session (it did on the local lane). A `Bash` matcher matches a local session's `mcp__workspace__bash` only through a tool alias the session must carry. And a hook that succeeds silently leaves no record, so "it didn't fire" is easy to conclude wrongly.**

## Cloud lane (live)

A probe plugin installed through Customize → Plugins declared SessionStart, UserPromptSubmit, PreToolUse (matchers `Bash`, `mcp__workspace__bash`, `Read`, `*`), PostToolUse (`*`) and Stop; each hook appended one line to a log and never blocked. A new task ran on the cloud lane (Desktop 2.9939.2); the log, read back from the container:

| event | fired | detail |
|---|---|---|
| UserPromptSubmit | yes, both turns | its added context reached the model; a block stops the turn silently (L218) |
| PreToolUse | yes | `Bash` matched the shell (`tool_name` `Bash`); `*` matched Bash and Write; `mcp__workspace__bash` never matched |
| PostToolUse | yes | Bash, Write |
| Stop | yes | |
| SessionStart | **no** | a brand-new session |

The SessionStart result fits Ch48's earlier cloud observation: SessionStart fired only on resume there, plausibly because plugins are synced after the session starts.

## Local lane (live)

The same probe plugin, in a local scheduled task (Desktop 2.9939.2, agent 2.1.281, Auto mode) — the host log, since a local session's hooks run on the Mac:

| event | fired | detail |
|---|---|---|
| SessionStart | **yes** | `source` `startup` on each new run (3 runs), `resume` when the session was reopened |
| UserPromptSubmit | yes, every turn | a block stops the turn and shows a notice (L218) |
| PreToolUse | yes | `*` matched Write and the shell; for the shell, `Bash`, `mcp__workspace__bash` and `*` **all** fired, each with `tool_name` `mcp__workspace__bash` |
| PostToolUse | yes | Write, `mcp__workspace__bash` |
| Stop | yes, every turn | |

The run made no Read call, so the `Read` matcher was not exercised. Agent 2.1.280 registers plugin hooks for all 33 events with no event filter, and nothing in the Desktop's session setup turns plugin hooks off (its hook-related settings only pass managed policy through). Older local transcripts agree: 111 recorded SessionStart successes and 54 context additions from plugin hooks, and PreToolUse denies from an installed plugin's Read and Bash guards honoured on agents 2.1.78 and 2.1.92. UserPromptExpansion fires only when a slash command or an MCP prompt is expanded.

A `claude` session started outside Cowork (an SDK harness, a CLI run) can load the same plugin and write to the same log; tell the runs apart by session time against the Desktop's `LocalAgentModeSessions.start` lines.

An interactive local session on Desktop 2.19675.0 (agent 2.1.286, 2026-10-02) agrees, with the probe's PreToolUse matcher `Agent|Task|Bash|mcp__workspace__bash|Read`. Every hook ran on the Mac with `cwd` `/private/var/empty` in both its input and its shell (L190); it could write to `/tmp` and to `$HOME` on the Mac, and nothing reached the VM. PreToolUse fired for `mcp__workspace__bash`, Read, the sub-agent dispatch (`tool_name` `Agent`) and the sub-agent's own Read. In two sessions the second turn started a new agent process: after turn 1 `main.log` shows `running → idle`, and the next message `idle → initializing`, a second `Starting local session` and fresh spawn options. So SessionStart fired again, `startup` on the first turn and `resume` on the second, each turn with its own Stop. The Desktop's code would normally pass a follow-up to the live process and arms no idle timeout here (`1978029737.idleGraceMs` is not served, so 0); why the process was gone was not found.

The hook input's `transcript_path` is the main session's transcript, reached through the config-dir staging link: `$TMPDIR/claude-hostloop-plugins/<hash>/projects/session/<cliSessionId>.jsonl`, the same for hooks fired inside a sub-agent. It contains no `/.claude/projects/` segment, so a hook that finds the session folder by matching `*/.claude/projects/*` finds nothing; resolve the link instead (`cd -P` into the part before `/projects/` gives `<session>/.claude`). A plugin's PreToolUse hook on `Agent` that denies a dispatch shows in the Desktop as a "Failed" sub-agent row, with no reason (next section). The model sees the hook's reason: in two local sessions (2026-10-03) a plugin's hook held a dispatch whose prompt the model had altered and quoted the prompt to send, and the model's next dispatch carried exactly that text (byte for byte, read from the transcripts) and ran. A hook can also change a dispatch, and the request record does not show it. In a local session (2026-10-03, one run), a plugin's PreToolUse hook on `Agent` returned `permissionDecision` `allow` with `updatedInput.prompt`: the sub-agent ran on the hook's prompt, its transcript's first message was the hook's text, and it acted on it. In the parent transcript the `tool_use` input still holds the prompt the model wrote, but the matching result record's `toolUseResult.prompt` holds the prompt that ran (the hook's for the changed dispatch, the model's for a control the hook left alone), and a `hook_success` attachment (`hookName` `PreToolUse:Agent`) carries the hook's output. The sub-agent's `.meta.json` holds no prompt, neither row said "Failed" in the Desktop, and the interface does not show a dispatch's prompt. A cloud session behaved the same (2026-10-03, one run, read from the interface's rendered rows since the container's files are not on the Mac): the hook ran in the container, the sub-agent reported the hook's prompt, the control was unchanged, and the container transcript (`/root/.claude/projects/-home-claude/<id>.jsonl`) held the `hook_success` record; only shell rows whose own command exited non-zero were marked "Failed". In the agent's code (2.1.286, read here) `updatedInput` replaces the whole input (`updatedInput ?? input`), so any field of the dispatch can be changed, agent type and model included. The replacement is checked against the tool's input schema, and one that fails (a partial object missing a required field, for example; unknown extra keys are tolerated) turns the hook's answer into a deny ("PreToolUse hook for … returned updatedInput that failed schema validation"). On an allow, the permission rules are checked again against the new input. Per a relayed read of the same code, a `hook_success` record is kept only when the hook printed something (which fits the silent control above), the model never sees it, and no gate applies. So the parent's `tool_use` is the request, not what ran: to know what a sub-agent was told, read `toolUseResult.prompt`, the first message of the sub-agent's own transcript (`subagents/agent-<id>.jsonl`) or the hook's output. The sub-agent's transcript also records the account's email address in a `session_context` attachment, and when that sub-agent repeated the reminder in its reply, the parent's harness flagged the hand-back as "instruction-shaped" (`system-reminder-tag`). A Write given a bare relative path is refused ("File is in a directory that is denied by your permission settings.") before any PreToolUse hook runs, so a Write hook never sees it (all measured 2026-10-02, Desktop 2.19675.0).

## A PreToolUse hook on a dispatch, by CLI version

A command hook (PreToolUse, matcher `Agent|Task`) that returned `permissionDecision` `allow` with `updatedInput.prompt` and an `additionalContext` was run against 31 CLI builds from 2.0.10 to 2.1.289, headless, with Haiku 4.5 as parent and sub-agent (MEASURED, 70 valid runs, two per build; 2026-10-05). Each mark existed only in the hook's output, so where it surfaced proves the path:

| | 2.0.10 – 2.1.8 | 2.1.9 – 2.1.96 | 2.1.100 – 2.1.289 |
|---|---|---|---|
| sub-agent runs on the hook's prompt | yes | yes | yes |
| `toolUseResult.prompt` | the hook's prompt | the hook's prompt | the hook's prompt |
| parent `tool_use.input.prompt` | the model's prompt | the model's prompt | the model's prompt |
| `additionalContext` reaches the model | **no** (0/22) | yes | yes |
| transcript rows `hook_success` + `hook_additional_context` | none | **none** | yes |
| dispatches per run | 1 | 1 | 1 |

- **The rewrite has no "since" version.** It held at the oldest build tested, so it is not a recent feature, and the parent's own record of the dispatch has never been what ran.
- **On 2.1.9–2.1.96 the transcript cannot prove the context arrived.** The model quoted it, but no row records it. 2.1.97–2.1.99 were not run.
- **The model never re-sent its original prompt** after a rewrite (one dispatch in all 70 runs).
- **The tool name changed:** `Task` up to 2.1.50, `Agent` from 2.1.70 (not bisected), in both the hook input and `tool_use.name`, while the `init` tools list still says `Task` at 2.1.289. Match `Agent|Task`.
- **A background dispatch is rewritten too** (2.1.289, one run): `toolUseResult.status` `async_launched`, with the hook's prompt.
- The parent's tool result wraps the sub-agent's reply in `[Subagent hand-back] …` from a build between 2.1.276 and 2.1.285 (absent at 2.1.275).

Not covered: plugin hooks (the same PreToolUse path in the code, not measured), and how a rewrite combines with the Desktop's own `Task` hook. Running old builds side by side has a trap: a build's auto-updater may delete installed versions (2.1.285 vanished at the first old-build run), so set `DISABLE_AUTOUPDATER=1`. 2.1.50 and 2.1.100 also needed `--strict-mcp-config` to avoid "Prompt is too long" before any dispatch.

**A deny on a dispatch is invisible to the user.** The model gets the hook's reason as the `is_error` tool result. The interface never shows it. In the claude.ai interface code that the Desktop ships (`ion-dist`, Desktop 2.19675.0, CODE-READ), Agent and Task are routed to a sub-agent card before the generic tool row, and the card receives only an outcome (Done, Failed or Stopped), the description and the sub-agent's steps, never the tool result. So it shows "Failed" and a step count, offers no tooltip, and opens only when there are steps. In the code, "No steps yet" is the text of an empty tab in the view for parallel dispatches. The newer step-row renderer labels a failed step with a short server-supplied `status_text` word or "Failed", and also has no path from a dispatch's result to the screen. The generic tool row does render error text, under "Error", which is how other tools' failures show. Seen in the UI: a denied dispatch on the Desktop showed "Failed" and no steps (2026-10-03, where the row read "No steps yet", and 2026-10-05), and on claude.ai web "Failed" with nothing to expand (2026-10-05). A plugin that holds a dispatch and wants the user to know why has to get the model to say it.

## Matchers and the local session's shell

A matcher made only of letters, digits, `_` and `|` is an exact, case-sensitive list (for some events `,`, space and `-` also separate entries); `*` or an empty matcher matches everything; anything else is an unanchored regular expression, which is also tested against alias names. Each list entry is expanded through the session's tool aliases — present in every agent checked, from 2.1.197 to 2.1.280:

```js
function Ope(e,n){let t=n&&Object.hasOwn(n,e)?n[e]:void 0;return t!==void 0&&t!==e?[e,t]:[e]}
```

A host-loop local session passes the alias `Bash` → `mcp__workspace__bash` (a first-class spawn option since about Desktop 1.20186.1, Ch35/L121), so a `Bash` matcher also matches the local session's shell, and the hook receives `tool_name` `mcp__workspace__bash` — seen live above. A session without that alias — older Desktop builds, or anything that starts the agent without it — gives a `Bash` matcher nothing to match; a reported `Bash` hook that never ran (May 2026) predates the alias. In a cloud session the shell is `Bash` itself. The file tools keep their names (`Read`, `Write`, `Edit`) on both lanes.

## Two traps

- **A silent hook leaves no trace.** The agent writes no transcript record for a hook that exits 0 with empty output. A missing PreToolUse or Stop record in a session therefore proves nothing; only hooks that print, add context, or block show up. (On a local lane the stream reports only SessionStart hook activity anyway — L203.)
- **A missing hook script can block, depending on the shell and the event.** `dash`, the usual `/bin/sh` on Debian and Ubuntu, exits **2** when it cannot open a script, which is the hook "block" code. macOS `sh` and `bash` exit 127, which is not (all three measured). The agent recognises this case only for a plugin's UserPromptSubmit hook and for any Stop, SubagentStop, TaskCompleted or TeammateIdle hook: exit 2 with empty output and a "no such file" or "can't open" error becomes a visible non-blocking error ("Hook script appears to be missing … Treating as non-blocking", with a hint to reinstall the plugin). For every other event — PreToolUse included — the exit 2 counts as a real block, so under `dash` a missing script refuses every call it matches. A hook that only warns when tested on a Mac can block on Linux. `/bin/sh` is `dash` both in a cloud session's container and in the Mac's Cowork VM (measured 2026-09-27, L215); local host-loop hooks run on macOS.

## For a plugin author

- Expect your hooks to fire in both lanes — but do not rely on SessionStart in a new cloud session.
- Write shell matchers as `Bash|mcp__workspace__bash` so they match whether or not the session carries the alias.
- When checking whether a hook ran, give it a side effect you can see — a log line, a file — rather than looking for it in the session record.
- Ship every script a hook command names inside the plugin, and test the installed plugin, not the source folder.
- To see what a sub-agent was told, read `toolUseResult.prompt` or the sub-agent's own transcript, not the parent's `tool_use`. A hook may have replaced it on any build.
- If your hook denies a dispatch, the user sees only "Failed". Word the reason so the model can pass it on.

---

# LESSON 210 — WHERE A NEW COWORK TASK RUNS

**The claude.ai interface, not the Desktop, picks the lane for a new Cowork task. Its code says an account that has opted out of cloud always gets a local session. On the capturing machine with Desktop 2.9939.2 the opt-out was saved, the app restarted, and new tasks still ran in the cloud — with and without Auto mode. With Desktop 2.16120.0 plain new tasks have run locally again on the same machine, but not every time. Check where each task ran.**

**Announced for Pro and Max plans: new tasks run only in the cloud from 2026-10-06. Seen in one Personal (Max) organization on 2026-10-04 and again on 2026-10-07, with the setting gone (below).** Anthropic's support article "Use Claude Cowork on web, desktop, and mobile" (page modified 2026-09-30, read 2026-10-02) opens: "Claude Cowork is now just Claude. Ask for what you need, and Claude decides whether that's a quick answer or a task. This is rolling out gradually to Pro and Max plans, with more plans to follow." Its notice reads: "Heads-up for Pro and Max plans: On October 6, 2026, new Cowork tasks run in the cloud and the Only on your computer option in Settings > General will be removed. Tasks you already started on your computer stay there." And: "Your scheduled tasks move to the cloud too, including ones that use files on your computer. Tasks that use files on your computer need the desktop app open." So a cloud task working on the user's files still depends on the desktop app being open (the device bridge, L215). Other plans are "to follow", with no date. On 2026-10-02 the setting read "Only on this computer", under Settings → General → Tasks on the merged interface and under Settings → Cowork on the older one. Press reports also give Team and Free plans a later date and Enterprise admins at least 30 days' notice; the article does not say so, and that was not checked. What this lesson says about the local lane still describes existing local tasks, plans the change has not reached, and builds before it.

## Three controls with one name

"Only on this computer" labels three different things:

| Where | What it stores |
|---|---|
| "Only on this computer", described "Stops when the app closes or this computer sleeps" (row id `cowork-backend` in the code). Where it sits depends on the interface generation (Desktop 2.19675.0, 2026-10-02): on the merged interface (no Chat/Cowork choice; a Personal organization) under Settings → General → Tasks, next to "Trusted folders" and "Preferred browser"; on the older interface (a Team organization) under Settings → Cowork, next to "Cowork files", "Trusted Cowork folders", "Preferred browser", "Open links in built-in browser" and "Allowed sites" | the account setting below |
| the Cloud/"Beta" popover in the task header, as the code has it; on 2026-10-02 (Desktop 2.19675.0) the older interface's header popup showed only "Claude Desktop (macOS)", "Connected" and "Manage computers", with no such setting, and on the merged interface clicking the header opened nothing | the same account setting |
| a scheduled task's form ("Advanced" badge; on 2026-10-02 the form also offered Frequency "Manual" and the note "Only runs while your computer is awake", and an existing local task showed Run now) | that task's own location, `local` or `remote` |

On a routine's card the same words are also a status label, next to "This computer", "Now runs in the cloud" and "Asleep or app closed".

## The account setting

The account switch writes `dramatic_shrimp_enabled` and `dramatic_shrimp_disabled_at` through `PATCH /api/account/settings`. The interface derives cloud-or-local from them:

```js
function Ws(e,t,n){if(e??!0)return!0;if(!n||!t)return!1;let r=Date.parse(t);return Number.isFinite(r)&&Date.now()-r>Bs}
// e = dramatic_shrimp_enabled, t = dramatic_shrimp_disabled_at, n = flag yukon_silver_dramatic_shrimp_internal
// true = cloud; Bs = 259200000 ms (3 days)
```

An unset value means cloud. For accounts carrying the internal flag, an opt-out lapses after three days, and a hook writes the account back to cloud. Two more rules apply when saving:
- Switching **to local** opens a feedback dialog. The setting is saved only when a reason is picked and the main button pressed; Cancel, Esc or clicking outside saves nothing. Switching to cloud saves at once.
- Switching to local does nothing unless `canOptOut` holds. While gate `cowork_remote_opt_out_returning_only_main` is on, that is only for accounts that already have an opt-out on record.

## The routing function

Every new Cowork task from the composer goes through one function (`fy` in the bundled build; the same text in the live builds fetched on 2026-09-25). It returns the first reason that applies:

1. `local_ungated` — the org has no cloud sessions
2. `local_override_forced` — flag `dramatic_shrimp_force_local`, Desktop only
3. **`local_opted_out` — the account setting says local**
4. `local_folder_forced` / `local_space_forced` — a folder or Space that cannot go to the cloud
5. `local_auto_permission_forced` / `local_bypass_permission_forced` — Auto or Bypass mode, when cloud does not support it
6. Chrome skip-approvals, options that need local, computer use, plugin stdio servers
7. otherwise `remote`

The value it reads for step 3 comes from the same formula as the Settings switch. Inside the Desktop it differs from the switch in one case: when the org forbids local sessions (`disabled_by_org_policy`, which the Desktop derives from `placementRules`), the router is told cloud while the switch still shows the account value. That case did not apply here (see L208).

The start event carries the chosen reason as `routing_reason` in telemetry; nothing on disk records it. The Desktop log shows only the outcome: `LocalAgentModeSessions.start` for local, nothing for cloud.

## What happened

Desktop 2.9939.2, 2026-09-25, a new task with no folder, the message `pwd; echo "EP=$CLAUDE_CODE_ENTRYPOINT"; hostname`:

| Condition | Result |
|---|---|
| account switch on (as found) | cloud — `/home/claude`, `EP=remote_cowork`, `vm`; no local start in the log |
| switch re-saved through the dialog, app quit and reopened | cloud, same output |
| same, Auto permission mode | cloud |
| scheduled task with its own "Only on this computer" on (Auto mode) | **local** — two `LocalAgentModeSessions.start` lines, `Starting local session local_… in /home/<slug>` |

So the code predicts local for all three plain tasks, and all three ran in the cloud. What makes the difference was not found. The interface code is not a fixed part of the app: the Desktop's `app://` handler serves a claude.ai build fetched from `assets-proxy.anthropic.com` and falls back to the copy in the app, and the Desktop's cache held three builds of the routing file from the previous day. All three, and the bundled copy, route step 3 identically, so the gap lies outside the code read here — most plausibly in what the server returns as the account's setting, which cannot be checked from the machine.

On Desktop 2.16120.0 (from 2026-09-30) the same machine has four plain local sessions on disk (no scheduled task, parent session or bridge), and a run on 2026-10-01 with the setting on came back `/sessions/<slug>` with `CLAUDE_CODE_ENTRYPOINT` unset (relayed from a sibling session). The user reports that the setting is honoured only some of the time. The Desktop app itself still contains no lane choice for a new task in its main process (`app.asar`), and its only veto there, an organization's local-tasks-off setting, is the same in 2.9939.4 and 2.16120.0 and allows local here. The interface is a separate bundle: on Desktop 2.19675.0 it ships in `Claude.app/Contents/Resources/ion-dist/` (about 190 MB, served through `app://`), and that is where "Only on this computer", `dramatic_shrimp_enabled` and the router's reasons (`local_ungated` … `local_opted_out` … `local_plugin_stdio_default`) are, none of them in `app.asar`. The organization block's message is there too: "Your organization doesn’t allow Cowork tasks on this computer." (admin setting `cowork_settings.local_vm_enabled`). By that router a toggle that is on keeps a task local, yet the merged composer sent tasks to the cloud with it on (below); how the merged composer chooses was not traced. The deprecation card's text (below) is in neither bundle nor anywhere in the Desktop's data folder, so it is most likely sent by the server (not confirmed).

A cloud task can still use the Mac: its "Computer" tools reach the Mac through the device bridge, but the shell there works only after a folder is connected to the task (`[remote-bash] … mounts=<folder>:rw` in the Desktop log). That is still a cloud session.

## The composer decides (Desktop 2.19675.0, 2026-10-02)

In a Personal organization with "Only on this computer" on, New opened one of two composers, and that decided the lane (composer shapes, and the cloud runs' output, observed in the UI; the local runs also from their config records on disk):

| Composer | First message | Result |
|---|---|---|
| explicit Chat/Cowork selector, Cowork selected | the fingerprint | **local**, `/sessions/<slug>`, URL `/cowork/local_…`, `hostLoopMode: true` (2 of 2) |
| merged, no selector | a file task, then the fingerprint | **cloud**, `/home/claude`, `EP=remote_cowork`, URL `/chat/…` |
| merged, no selector | the fingerprint | **cloud**; "Getting set up" seen in the UI |

So in these runs the composer, not the toggle and not the first message, decided. The composer's permission choice reaches the session: with "Automatically approve" selected, a local session's `init` and transcript carry `permissionMode` `auto` (one run, Team organization). Which composer New shows was not controlled: the selector appeared after switching organizations (once from a `/cowork/local_…` page), the merged composer from the sidebar's New. Each local run showed a card above the composer (wording from the UI accessibility dump): heading "Tasks on this computer are being deprecated", body "This task still works, but tasks on this computer are no longer maintained. From October 6, you won't be able to start new ones. For new work on this computer, use Claude Code.", with Learn more and Dismiss.

**The rollout goes per organization, not per account (2026-10-04, one run each).** On one account, the Personal (Max) organization had the unified composer on claude.ai web and in the Desktop: no Chat/Cowork choice, no cloud label, a Manual permission choice and an Output menu (Docs, Slides, Design, Google, Artifact). A new task from either ran in the cloud (`/home/claude`, `CLAUDE_CODE_ENTRYPOINT=remote_cowork`) under a `/chat/<uuid>` URL, and the Desktop task left no session record on the Mac. On the same day and account, the Team organization still offered the older Chat/Cowork composer, and its Desktop tasks ran locally. This was two days before the announced 2026-10-06 date for Pro and Max. **Re-checked on 2026-10-07 (Desktop 2.26454.0, agent 2.1.289, one run each).**
- **Personal (Max): cloud, no setting.** Settings → General → Tasks shows only "Trusted folders" and "Preferred browser"; "Only on this computer" is gone and there is no Settings → Cowork page. Switching the Desktop to this organization showed: "Your Cowork settings changed / New tasks run in the cloud now. Your files stay on your computer." The composer offered Chat/Cowork again (Cowork selected), and a new task ran in the cloud: `pwd` was `/home/claude`, under a `claude.ai/cowork/cse_…` URL. The same organization had started a local session on 2026-10-06 at 11:37Z (Desktop 2.19675.1), so the switch came after the announced date; the Desktop updated to 2.26454.0 that night. Whether the update or a server-side change did it is not known.
- **Team: still local.** The Chat/Cowork composer and Settings → Cowork "Only on this computer" are still there. With the switch on, a new task ran locally (`/sessions/<slug>`, a `local_…` URL). A Team task that morning also ran locally with the switch off (one session, origin unknown), so off does not force the cloud here.

A scheduled task set up by hand (Scheduled → New task → Set up manually) in a Team organization ran locally with Run now (`/sessions/<slug>`, `EP=` empty, config record `hostLoopMode: true` with its `scheduledTaskId`). The form (UI, 2026-10-02) offers Name, Description, Instructions, Project or folder, Model ("Default model"), Frequency ("Manual" by default), Permissions ("Automatically approve" by default) and, under Advanced, "Only on this computer", on by default, with the note "Only runs while your computer is awake. Use this if cloud scheduled tasks aren't suitable for your use case."

## For an author or tester

- Do not assume the Settings switch keeps a new task local, or that it sends it to the cloud. Check where each run went: `pwd` is `/sessions/<slug>` locally and `/home/claude` in the cloud, where `CLAUDE_CODE_ENTRYPOINT` is `remote_cowork`.
- To get a local session on demand, use a scheduled task with its own "Only on this computer" switch on, set to manual, and start it with Run now. On a Personal (Max) organization the form now names that switch "Require this computer", off by default, with the note "Only runs while your computer is awake. Gives Claude access to the folders you've allowed on this computer and to Claude in Chrome." (form seen 2026-10-07, no task run). Whether it still gives a local session there is not tested. Remember L208: a scheduled task that is not local-only can be moved to the cloud after two runs.
- When reporting it, say which control was set, and include the `pwd` output.
