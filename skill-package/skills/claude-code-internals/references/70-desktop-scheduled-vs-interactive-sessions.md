Updated: 2026-10-22 (L243) | Source: **Claude Desktop `app.asar` 3.1623.4** (the installed build, byte-identical to the archived copy) and the bundled agent **2.1.308**, read on 2026-10-22; the session records, `audit.jsonl` files and `main.log` of one Mac (1,003 Cowork session records, agents 2.1.2xx–2.1.308); and Anthropic's Desktop release notes through v3.6556.1, checked 2026-10-22. Re-read in **Desktop 3.6556.1** on 2026-10-23 (full diff in L245): every rule below still holds under new minified names, and the section on 3.6556.1 adds two differences. A subagent did the first code pass; the session-type assignment, the `send_user_message` rule, the `AskUserQuestion` removal, the environment variable, the attendance flag and the first-message tag were re-read here, and the on-disk counts were re-counted here. Minified names are given with their chunk file, because the same short name is reused across chunks.

# Chapter 73: Scheduled Cowork Tasks Are a Different Kind of Session

---

## TABLE OF CONTENTS

243. [Lesson 243 — What a Scheduled Cowork Task Gets That an Interactive One Doesn't, and the Reverse](#lesson-243--what-a-scheduled-cowork-task-gets-that-an-interactive-one-doesnt-and-the-reverse)

---

# LESSON 243 — WHAT A SCHEDULED COWORK TASK GETS THAT AN INTERACTIVE ONE DOESN'T, AND THE REVERSE

**Desktop starts a scheduled Cowork task as a session of type `scheduled`; a task a person starts has no type at all. The type decides part of what the agent gets: a scheduled run has no `AskUserQuestion`, no onboarding role picker and no `mcp__cowork__send_user_message`, runs with `CLAUDE_CODE_HOST_SCHEDULED_RUN=1`, has its own turn limit, and its first message is tagged as a scheduled trigger. On accounts where new tasks go to the cloud (L210, L226), a scheduled task is the only local Cowork session left, so anything learned from one has to be read with these differences in mind.**

## How the type is set (CODE-READ, `index.chunk-DbIevS2k.js`)

- When a session starts with a scheduled task's id and no type, Desktop sets the type: `!e.sessionType&&e.scheduledTaskId&&(e.sessionType=t.tZ)` (offset 420299). `tZ` is `"scheduled"`. The same table (`index.chunk-uXhgx7My.js`) has `agent` (the Dispatch/bridge orchestrator), `dispatch_child`, `chat` and `radar`. A task started from the composer has none.
- The type is also exported to the agent as a tag: `CLAUDE_CODE_TAGS` = `lam_session_type:<type>`, with `chat` when there is none.

## What a scheduled run doesn't get

| tool | rule | code |
|---|---|---|
| `mcp__cowork__send_user_message` | offered only to a session with **no** type, and only when gate `3045399524` enables it (for every model, or for the session's model) | `zt=!a.sessionType&&(Rt.enabled===!0\|\|Array.isArray(Rt.enabled)&&!!F&&Rt.enabled.includes(F))`, offset 254034 |
| `AskUserQuestion` and `mcp__cowork-onboarding__show_onboarding_role_picker` | added to `disallowedTools` whenever the session has a scheduled task's id | `scheduledTaskId&&(Y.disallowedTools=[…,"AskUserQuestion",t.fX])`, offset 405399 |

- Every typed session fails the `send_user_message` rule, not only scheduled ones: Dispatch children and the Dispatch orchestrator don't get it either (the orchestrator gets the agent's own `SendUserMessage` instead).
- Dispatch children and bridge sessions also lose `AskUserQuestion`, through a separate "renderer-dependent tools" list. So a missing `AskUserQuestion` doesn't by itself mean a scheduled run.
- `save_skill` is still offered; what changes is only the context the skill scan (L242) records.
- **Measured** (this Mac, 2026-10-22): of the scheduled sessions whose first `system/init` frame could be matched to their record, none listed `AskUserQuestion` or `send_user_message` (161 of 161). Interactive sessions listed `AskUserQuestion` in all 83 and `send_user_message` in 56; the rest predate the tool or ran a model the gate didn't list.

## What a scheduled run gets instead (CODE-READ)

- **`CLAUDE_CODE_HOST_SCHEDULED_RUN=1`** in the agent's environment, set only for type `scheduled` (`index.chunk-DbIevS2k.js` offset 378670; the object is in `index.chunk-BHK0ncEj.js`). The agent (2.1.308) reads it in four places. The one traced: a scheduled-trigger message may carry a `fireReason` from the host, and the agent honours it only in a process the host started with this variable. The other three (a skipped startup fallback, a flag function that returns false, a prompt section left out) weren't traced to their purpose.
- **A turn limit:** `scheduledTaskMaxTurns`, else `maxTurns`, else 100.
- **Unattended for credentials:** the spawn marks the session `unattended` when it has a scheduled task's id, and credential overrides are resolved for the context `scheduled-task` rather than `interactive`.
- **A tagged first message:** the first user message carries `origin` `{kind:"task-notification", subkind:"scheduled-trigger", fireReason:"scheduled"}`; other unattended turns carry `{kind:"auto-continuation"}`. Desktop also adds `initiator:"scheduled-task"`, but no `audit.jsonl` on this Mac contains it, so the file most likely records the agent's copy of the message, not Desktop's.
- **Per-task approvals:** a scheduled task's own saved approvals are checked first (`shouldAutoApprovePermission(scheduledTaskId, …)`).
- **The permission mode is not forced:** it is the task's saved mode, else `default`. Scheduled runs on this Mac ran in both `auto` and `default`.
- **Artifacts:** Desktop drops the cowork artifact tools for a scheduled run when the `scheduledRunFrameArtifacts` value inside gate `1978029737` is off (default on). On agents 2.1.260–2.1.281 scheduled runs had `mcp__cowork__*_artifact` tools where interactive runs had the agent's own `Artifact` tools; from 2.1.284 both have the same set.

## How to tell a scheduled session from an interactive one

| where | marker | reliability |
|---|---|---|
| the session record `local_<id>.json` | `"sessionType":"scheduled"` with a `scheduledTaskId` (`scheduledRunContinued` appears only on these) | **best**: 442 of 442 scheduled records; none of the 552 records without a type |
| `main.log`, the `[HostLoop] sdkOptions after patch` line | `CLAUDE_CODE_HOST_SCHEDULED_RUN` among the environment key names (the line prints names, not values) | good as a cross-check |
| `audit.jsonl`, the first user message | `origin.subkind` `scheduled-trigger` | only from agent 2.1.286; older scheduled runs show the generic `auto-continuation` that Dispatch turns also show |
| `audit.jsonl`, the `init` frame | no `AskUserQuestion` | necessary, not sufficient (Dispatch and bridge sessions lack it too) |

`getSessionsForScheduledTask` lines in `main.log` come from the task list in the interface, not from a run.

## For a skill or test author

- **A skill that asks the user a question can't do it in a scheduled run.** `AskUserQuestion` is not offered; write the scheduled path so it decides on its own or records the open question in its output.
- **A tool list or environment captured from a scheduled run is not an interactive session's.** Subtract the differences above before comparing, and treat the three missing tools as known from the code, not observed.
- **To detect a scheduled run from inside a skill**, check `CLAUDE_CODE_HOST_SCHEDULED_RUN` in the agent's environment. It reaches the host-side agent; whether it reaches the VM shell wasn't checked (the VM shell gets almost no host environment, L116).
- **Release notes after this build:** v3.6556.1 fixes Claude not finding plugins and skills in scheduled tasks (except in third-party deployments), and makes MCP tools that their server marks as needing a person ask only on the in-app card, so a scheduled task goes on without those calls.

## In Desktop 3.6556.1

- **No typed-artifact tools.** The Typed Artifact Service's tools (`create_from_type`, `db_get` and the rest, L245) are offered only to host-loop sessions with no session type and no scheduled task (`index.chunk-DCfOtL-w.js`). A scheduled run never gets them.
- **Person-only MCP tools are refused.** A tool whose server marks it as needing a person is refused at once in an unattended turn, so a scheduled run goes on without it. A scheduled run whose own turn is continuing is exempt.
- **No `schedule` skill.** The in-code `schedule` skill is gone; the scheduled-task tools remain.

## Not traced

- The purpose of three of the agent's four uses of `CLAUDE_CODE_HOST_SCHEDULED_RUN`.
- Whether the Code tab's sessions, `radar` sessions or SSH sessions go through this spawn path.
- Any way to start a local session with no type other than the composer.
