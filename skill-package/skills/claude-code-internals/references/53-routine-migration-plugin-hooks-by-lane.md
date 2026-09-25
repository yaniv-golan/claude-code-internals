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

**A background sweep in Claude Desktop converts a local scheduled task into a cloud routine once it has a short track record. The task then runs in the cloud and reaches the user's Mac as a connected device. It is switched on server-side, present since Desktop 1.44121.1, and it is why a machine can stop starting local Cowork sessions without any update or setting change.**

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

So a local scheduled task that has run at least twice, with at least half a day between its first and last counted run, is a candidate — among other conditions. It is held back by any of a list of block reasons: attached to a Space (`heldBlockReasons`), a schedule more often than hourly or a custom cron expression, a working directory, worktree or source branch, a dispatch hook, Chrome use, attached files, no prompt, or its next run less than 15 minutes away. Runs are counted against the task's current prompt, so editing the prompt restarts the count. Tasks already marked `migratedFromRemote` or `migratedToRemoteAt`, and watcher tasks, are skipped. A task tied to the device (local MCP servers, Chrome, computer use, folders) can still move, as a routine **bound** to this computer (`boundEnabled`). First present in the backed-up builds from Desktop 1.44121.1 (0 in every backup through 1.40609.1).

## What decides local or cloud for a new task

The Desktop main process decides only whether each lane is **allowed** (`placementRules`, per surface: device, SSH host, cloud). For Cowork only two rules can deny the device lane: an org requirement for self-hosted, and `cowork-local-tasks-off` for first-party accounts — the latch from gate `3634338308` (off by default at capture, and never logged as switched on here). With neither active, Cowork is "hybrid" and local is allowed. (Other rules — unreadable managed settings, `disableDesktopLocalSessions` — apply only to Claude Code surfaces; `no-self-hosted-endpoint` denies the cloud lane for third-party accounts.) The lane for each new task is picked by the claude.ai interface (L210).

A migrated routine can be moved back to "This computer" in its own settings; reverting keeps its `migratedToRemoteAt` stamp, so the sweep then skips it for good.

To confirm a local run, the Desktop log shows `LocalAgentModeSessions.start`, then `Starting local session local_<uuid> in /home/<slug>` and `[GBCache] Seeded GB cache into session local_<uuid>` (preceded by `[ScheduledTasks] Spawning new session for scheduled task <id>` for a routine). A cloud run produces no such line.

## Why it matters

When a scheduled task moves, it changes lane: its working directory, what a relative path means, which hooks fire and how (L209), what the shell can reach, and whether files it writes land on the Mac (L198). A skill written and tested against the task's local runs is suddenly running somewhere else, with no message to the user beyond the routine's location label. A test harness that depends on a scheduled task staying local will drift after two runs.

---

# LESSON 209 — PLUGIN HOOKS IN COWORK, EVENT BY EVENT

**Plugin hooks fire in both Cowork lanes, with one exception: SessionStart did not fire in a new cloud session (it did on the local lane). A `Bash` matcher matches Cowork's `mcp__workspace__bash` only through a tool alias the session must carry. And a hook that succeeds silently leaves no record, so "it didn't fire" is easy to conclude wrongly.**

## Cloud lane (live)

A probe plugin installed through Cowork → Customize → Plugins declared SessionStart, UserPromptSubmit, PreToolUse (matchers `Bash`, `mcp__workspace__bash`, `Read`, `*`), PostToolUse (`*`) and Stop; each hook appended one line to a log and never blocked. A new task ran on the cloud lane (Desktop 2.9939.2); the log, read back from the container:

| event | fired | detail |
|---|---|---|
| UserPromptSubmit | yes, both turns | its added context reached the model |
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
| UserPromptSubmit | yes, every turn | |
| PreToolUse | yes | `*` matched Write and the shell; for the shell, `Bash`, `mcp__workspace__bash` and `*` **all** fired, each with `tool_name` `mcp__workspace__bash` |
| PostToolUse | yes | Write, `mcp__workspace__bash` |
| Stop | yes, every turn | |

The run made no Read call, so the `Read` matcher was not exercised. Agent 2.1.280 registers plugin hooks for all 33 events with no event filter, and nothing in the Desktop's session setup turns plugin hooks off (its hook-related settings only pass managed policy through). Older local transcripts agree: 111 recorded SessionStart successes and 54 context additions from plugin hooks, and PreToolUse denies from an installed plugin's Read and Bash guards honoured on agents 2.1.78 and 2.1.92. UserPromptExpansion fires only when a slash command or an MCP prompt is expanded.

A `claude` session started outside Cowork (an SDK harness, a CLI run) can load the same plugin and write to the same log; tell the runs apart by session time against the Desktop's `LocalAgentModeSessions.start` lines.

## Matchers and the Cowork shell

A matcher made only of letters, digits, `_` and `|` is an exact, case-sensitive list (for some events `,`, space and `-` also separate entries); `*` or an empty matcher matches everything; anything else is an unanchored regular expression, which is also tested against alias names. Each list entry is expanded through the session's tool aliases — present in every agent checked, from 2.1.197 to 2.1.280:

```js
function Ope(e,n){let t=n&&Object.hasOwn(n,e)?n[e]:void 0;return t!==void 0&&t!==e?[e,t]:[e]}
```

Local host-loop Cowork passes the alias `Bash` → `mcp__workspace__bash` (a first-class spawn option since about Desktop 1.20186.1, Ch35/L121), so a `Bash` matcher also matches the Cowork shell, and the hook receives `tool_name` `mcp__workspace__bash` — seen live above. A session without that alias — older Desktop builds, or anything that starts the agent without it — gives a `Bash` matcher nothing to match; a reported `Bash` hook that never ran (May 2026) predates the alias. In cloud Cowork the shell is `Bash` itself. The file tools keep their names (`Read`, `Write`, `Edit`) on both lanes.

## Two traps

- **A silent hook leaves no trace.** The agent writes no transcript record for a hook that exits 0 with empty output. A missing PreToolUse or Stop record in a session therefore proves nothing; only hooks that print, add context, or block show up. (On a local lane the stream reports only SessionStart hook activity anyway — L203.)
- **A missing hook script can block, depending on the shell and the event.** `dash`, the usual `/bin/sh` on Debian and Ubuntu, exits **2** when it cannot open a script, which is the hook "block" code. macOS `sh` and `bash` exit 127, which is not (all three measured). The agent recognises this case only for a plugin's UserPromptSubmit hook and for any Stop, SubagentStop, TaskCompleted or TeammateIdle hook: exit 2 with empty output and a "no such file" or "can't open" error becomes a visible non-blocking error ("Hook script appears to be missing … Treating as non-blocking", with a hint to reinstall the plugin). For every other event — PreToolUse included — the exit 2 counts as a real block, so under `dash` a missing script refuses every call it matches. A hook that only warns when tested on a Mac can block on Linux.

## For a plugin author

- Expect your hooks to fire in both lanes — but do not rely on SessionStart in a new cloud session.
- Write shell matchers as `Bash|mcp__workspace__bash` so they match whether or not the session carries the alias.
- When checking whether a hook ran, give it a side effect you can see — a log line, a file — rather than looking for it in the session record.
- Ship every script a hook command names inside the plugin, and test the installed plugin, not the source folder.

---

# LESSON 210 — WHERE A NEW COWORK TASK RUNS

**The claude.ai interface, not the Desktop, picks the lane for a new Cowork task. Its code says an account that has opted out of cloud always gets a local session. On the capturing machine the opt-out was saved, the app restarted, and new tasks still ran in the cloud — with and without Auto mode. The one route shown to produce local sessions was a scheduled task with its own "Only on this computer" switch on.**

## Three controls with one name

"Only on this computer" labels three different things:

| Where | What it stores |
|---|---|
| Settings → General → Tasks (row id `cowork-backend`, deep link `?highlight=cowork_backend`); description "Stops when the app closes or this computer sleeps" | the account setting below |
| the Cloud/"Beta" popover in the task header | the same account setting |
| a scheduled task's form ("Advanced" badge) | that task's own location, `local` or `remote` |

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

1. `local_ungated` — the org has no cloud Cowork
2. `local_override_forced` — flag `dramatic_shrimp_force_local`, Desktop only
3. **`local_opted_out` — the account setting says local**
4. `local_folder_forced` / `local_space_forced` — a folder or Space that cannot go to the cloud
5. `local_auto_permission_forced` / `local_bypass_permission_forced` — Auto or Bypass mode, when cloud does not support it
6. Chrome skip-approvals, options that need local, computer use, plugin stdio servers
7. otherwise `remote`

The value it reads for step 3 comes from the same formula as the Settings switch. Inside the Desktop it differs from the switch in one case: when the org forbids local Cowork (`disabled_by_org_policy`, which the Desktop derives from `placementRules`), the router is told cloud while the switch still shows the account value. That case did not apply here (see L208).

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

A cloud task can still use the Mac: its "Computer" tools reach the Mac through the device bridge, but the shell there works only after a folder is connected to the task (`[remote-bash] … mounts=<folder>:rw` in the Desktop log). That is still a cloud session.

## For an author or tester

- Do not assume the Settings switch keeps a new task local. Check where it ran: `pwd` is `/sessions/<slug>` locally and `/home/claude` in the cloud, where `CLAUDE_CODE_ENTRYPOINT` is `remote_cowork`.
- To get a local session on demand, use a scheduled task with its own "Only on this computer" switch on, set to manual, and start it with Run now. Remember L208: a scheduled task that is not local-only can be moved to the cloud after two runs.
- When reporting it, say which control was set, and include the `pwd` output.
