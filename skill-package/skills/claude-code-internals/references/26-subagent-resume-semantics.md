Updated: 2026-07-04 | Source: Binary extraction from the standalone CLI bundle **v2.1.198** (SEA-extracted, `/tmp` working copy of the Ch27 baseline) + Claude.app (Desktop) `app.asar` **1.18286.0** (`.vite/build/index.js`, the Ch28 capture). Cross-artifact chapter: the mechanism lives in the CLI, the severing lives in the Desktop spawn config — neither artifact alone tells the whole story (the same trap as Ch24/L107's wrongly-overturned forced-ask hook).

# Chapter 29: Subagent Resume Semantics — Task Is One-Shot, SendMessage Is the Resume Path, and Cowork Severs It

> **Provenance.** Direct inspection of the v2.1.198 CLI bundle (Task tool schema chain
> `THm`/`SHm`/`fLo`, the SendMessage tool `CLm`, the resume function `dfe` /
> `resumeAgentBackground`, the fork agent definition `U3`) and of app.asar 1.18286.0
> (the local-agent spawn's `tools:`/`allowedTools:` lists, `env` block, and PreToolUse
> `hooks` option). Minified identifiers are per-build and drift release to release;
> match by mechanism, not symbol.

---

## TABLE OF CONTENTS

115. [Lesson 115 -- Subagent Resume Semantics: Task vs SendMessage, CLI vs Cowork](#lesson-115----subagent-resume-semantics)

---

# LESSON 115 -- SUBAGENT RESUME SEMANTICS: TASK VS SENDMESSAGE, CLI VS COWORK

## The short answer

Can a completed subagent be continued? **It depends on the surface, and the split is a
single Desktop spawn decision — not anything in the Task tool itself:**

- **Everywhere:** each `Task` call spawns a fresh agent. There is no resume/continue
  parameter in the Task schema (Part A).
- **Standalone CLI (v2.1.198): yes.** A completed or stopped background agent is
  resumed with its full prior context via `SendMessage({to: <agentId>})` — a
  first-class path the binary advertises to the model in the Task tool's own prompt
  text (Part B). `subagent_type: "fork"` and `Workflow resumeFromRunId` are sibling
  continuation primitives.
- **Cowork (Desktop 1.18286.0): no.** The Desktop's spawn config omits `SendMessage`
  from the session's tool list and disables backgrounding, so the resume machinery —
  still present in the host CLI binary — is unreachable (Part C). The only
  continuation primitives left are redo-dispatch (fresh agent, full task) and
  repair-dispatch (fresh agent pointed at surviving artifacts plus the verbatim
  error).

**Gotcha:** guidance written from one surface silently mis-generalizes to the other.
A skill authored and tested in Cowork will conclude "resume isn't available" and
needlessly redo work in the CLI; one authored against the CLI will tell the model to
`SendMessage` an agent id in Cowork, where the tool doesn't exist.

**How a skill should branch on this.** Don't detect the product — detect the
capability. The severing mechanism *is* the tool list (Part C), so the presence of
`SendMessage` in the model's available tools is the exact, future-proof test.
Skill-content phrasing that works on both surfaces:

> If a `SendMessage` tool is available, continue the completed agent by calling
> `SendMessage` with its `agentId` (format `a...-...`, from the spawn result) as `to`.
> If there is no `SendMessage` tool (e.g. Cowork), dispatch a fresh Task instead:
> re-run the full task, or point the new agent at the surviving artifacts plus the
> verbatim error.

This stays correct even if Anthropic later flips the Cowork spawn config — a
product-name check would not. For general runtime detection (scripts, other
surface-dependent behavior), see Ch30/L116.

## Part A — the Task tool really is one-shot per call (both products)

The Task tool's input schema chain in the v2.1.198 bundle is `THm()` (core) →
`SHm()` (merge + extend) → `fLo()` (final, gated omissions). The full field set:

```
description, prompt, subagent_type, model, run_in_background,   // THm
name, team_name (deprecated), mode,                              // SHm merge
isolation ("worktree"|"remote"), cwd                             // SHm extend
```

There is **no resume/continue/agentId input parameter**. `fLo()` then applies two
omissions: `cwd` is always dropped from the model-facing schema, and
`run_in_background` is dropped when `sJt` (`process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`)
is truthy **or** `PX()` is true (the fork experiment active: `CLAUDE_CODE_FORK_SUBAGENT`
env or GrowthBook rollout via `s_p()` — in that mode agents background by default and
the parameter disappears rather than defaulting).

So **each Task call spawns a fresh agent**, on every surface. The Task spawn telemetry
even stamps it: `tengu_agent_tool_selected` fires with `is_resume: !1` on every
Task-tool dispatch.

## Part B — the CLI's first-class resume path: SendMessage

Continuation lives in a different tool. In the standalone CLI this is not some buried
internal — the binary **tells the model about it** in the Task tool's own prompt text:

> "To continue a previously spawned agent, use SendMessage with the agent's ID or name
> as the `to` field — **that resumes it with full context**. A new Task call starts a
> fresh agent with no memory of prior runs (except subagent_type: \"fork\"), so the
> prompt must be self-contained."

and again in SendMessage's prompt:

> "Refer to active teammates by name; **to resume a completed background agent, use
> the `agentId` (format `a...-...`) from its spawn result.**"

### The recipient-resolution switch

SendMessage's `call` resolves the `to` field to one of several cases; four matter here:

| Resolution | Behavior |
|---|---|
| `agent-live` | Message queued for the running agent's next tool round (`AGe`). No resume needed. |
| `agent-stopped` | **Resume.** Calls `dfe({agentId, prompt, ...})`. If `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` is set, awaits completion and returns the final text inline ("resumed it with your message and ran to completion"); otherwise resumes in the background ("You'll be notified when it finishes") and the tool result carries **`resumedAgentId`**. |
| `agent-evicted` | Also resume — for teammates via `resumeInProcessTeammate` (`cLl`, rehydrating prior messages: "resumed it as an in-process teammate with N prior messages"), else `dfe` from transcript ("had no active task; resumed from transcript"). |
| `agent-stopped-by-user` | **Refused**: "Agent … was stopped by the user and was not resumed. Treat its work as cancelled; only start a new agent for it if the user explicitly asks." |

### What `dfe` (logged as `resumeAgentBackground`) actually does

1. Marks the task `resuming` in the registry (throws `Agent <id> is already running or
   being resumed` on a double-resume).
2. Reads the agent's **persisted transcript** from disk (`fNe(qc(agentId))` + metadata
   `e7(...)`); on failure fires `subagent_launch`/`subagent_resume_setup_read_failed`.
   If the disk transcript is missing it falls back to in-memory mirrored messages
   ("disk transcript missing; using N in-memory messages mirrored during the run");
   with neither, it throws `No transcript found for agent ID: <id>`
   (`subagent_resume_transcript_missing`).
3. Honors the user-stop marker: `stoppedByUser` blocks resume unless the call is
   `userInitiated` (in which case the stop marker is cleared via `Jme`).
4. Rebuilds the agent context and continues the loop with the new prompt appended —
   `invocationKind: "resume"` in the agent context, spawn depth and start time
   preserved from the original task.
5. **Fork agents resume too**, with an extra step: the parent system prompt must be
   reconstructable (`subagent_resume_fork_prompt_missing` → "Cannot resume fork agent:
   unable to reconstruct parent system prompt" when it isn't).

The `resumedAgentId` field in the tool result is consumed by the session-rehydration
scanner: on session resume it walks prior tool results, and any agent whose id appears
as a `resumedAgentId` is marked `redispatched` so it isn't offered for resume twice.

### Availability

SendMessage (`CLm`, name `O_`) is registered **unconditionally** in the master tool
list `F4()` and defines no `isEnabled` of its own, so it inherits the tool-factory
default `A5d = { isEnabled: () => !0, ... }` — live in the plain CLI, not behind a
team or experiment gate. (What *is* gated by `il()` — agent teams — is only the
structured team-protocol message *schema*: `gLm()` returns the full `SLl()` union with
teams enabled, else `hLm()` plain-string-only. Plain-text resume of a completed agent
needs no team.)

### Three continuation primitives

Beyond SendMessage-resume, the CLI carries two more ways to continue prior work
without a from-scratch redispatch:

- **`subagent_type: "fork"`** (`U3`): "Fork — inherits full conversation context.
  Selected explicitly via subagent_type: \"fork\" when the fork experiment is active;
  never the default." (`tools: ["*"]`, `maxTurns: 200`, `model: "inherit"`.)
- **`Workflow({scriptPath, resumeFromRunId})`** (L91): completed `agent()` calls with
  unchanged `(prompt, opts)` replay from cache; only edited/new calls re-run.

> **EXTENSION (v2.28.0, L124):** Re-verified 2026-07-11 against asar 1.20186.1 + agent 2.1.205 — the
> sever-at-spawn conclusion holds (`SendMessage` still absent from `tools:`/`allowedTools:`, only
> `SendUserMessage` appears; both disable vars still unconditional in the main spawn env; the Desktop
> `Task` PreToolUse hook still blocks `run_in_background`) — with three deltas: (i) `run_in_background`
> **polarity flipped** — background is now the default ("Set to false to run this agent
> synchronously"), and under `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` the param is stripped from the Task
> schema entirely, not merely defaulted off; (ii) the CLI's `agent-stopped` `SendMessage` branch now
> treats the disable var as an **`awaitCompletion` mode-switch** (resume-and-run-synchronously) instead
> of an outright refusal — moot in Cowork either way; (iii) **new**: agent-type sessions get
> `mcp__dispatch__send_message` (plus `MCP_DISPATCH_LIST_PROJECTS`, a `dispatchAgentNameEnabled`-gated
> `MCP_DISPATCH_SET_AGENT_NAME`, and gate-`3723845789`'s `LIST_CODE_WORKSPACES`) — a Desktop-mediated
> **cross-session** continuation primitive, distinct from sub-agent resume. See Ch35/L124.

## Part C — Cowork severs the resume path at spawn time

In app.asar 1.18286.0, the local-agent (Cowork) session spawn makes three moves, each
independently sufficient to close the resume path:

1. **SendMessage is absent from the spawned agent's tool set.** The spawn's explicit
   `tools:` array is:

   ```
   ["Task","Bash","Glob","Grep","Read","Edit","Write","NotebookEdit","WebFetch",
    TaskCreate,TaskUpdate,TaskGet,TaskList,TaskStop, "WebSearch","Skill","REPL",
    "JavaScript","AskUserQuestion","ToolSearch",
    ...sessionType===<brief>?["SendUserMessage"]:[], ...["Projects" when gated]]
   ```

   No `SendMessage` (don't confuse it with `SendUserMessage`, the internal
   message-to-the-user tool, L103). The parallel `allowedTools:` pre-approval list
   also lacks it, and so does the host-loop safe list `GGt`/`PNt` (L107). With no
   model-facing entry point, the entire `dfe` resume machinery is unreachable —
   present in the host CLI binary, dead in the session.

2. **`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1"`** in the spawn env — so even the Task
   schema the Cowork model sees has `run_in_background` omitted (`fLo`'s `sJt` branch)
   and subagents run synchronously, one-shot.

3. **The Desktop PreToolUse `Task` hook** (L107/L114) blocks any call whose
   `tool_input.run_in_background` is truthy: `{decision:"block", reason:"Background
   agents disabled"}` — belt-and-suspenders over (2).

So **in Cowork a completed subagent genuinely cannot be continued**: redo-dispatch and
repair-dispatch (fresh agent, optionally pointed at surviving artifacts plus the
verbatim error) are the only continuation primitives available to the model. But that
is because the Desktop *removes* the resume path at spawn — not because the Task tool
"is one-shot" in some deeper sense than it is everywhere.

## Part D — correction to Ch28/L114: where the two disable vars are actually set

L114 Part E catalogued `CLAUDE_CODE_DISABLE_AGENTS_FLEET` as "set to \"1\" alongside
`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:\"1\"` in a **Tasks-tool-child spawn path**."
Re-grepping the same 1.18286.0 asar: each variable appears **exactly once** in the
whole bundle, and the site is the **main local-agent spawn env builder** — the same
object literal that sets `CLAUDE_CODE_IS_COWORK:"1"`, `CLAUDE_CODE_ENTRYPOINT:
"local-agent"`, `CLAUDE_CODE_TAGS: lam_session_type:${sessionType??"chat"}`, and
`CLAUDE_CODE_ENABLE_TASKS:"true"`. There is no separate Tasks-tool-child spawn site in
this build. The practical consequence is bigger than L114 implied: backgrounding and
Fleet/agent-view are suppressed for **every** Cowork session, not just nested
Tasks-tool children. (Note the adjacent `CLAUDE_CODE_ENABLE_TASKS:"true"` — the
Ch26/L109 Tasks *tool family* is ON in Cowork even while *background* tasks are
disabled; the two knobs are independent.)

## Identifier table

| Identifier | Kind | Artifact | Effect |
|---|---|---|---|
| `THm`/`SHm`/`fLo` | zod schema chain | CLI 2.1.198 | Task tool input; no resume param; `fLo` omits `run_in_background` under `sJt \|\| PX()` |
| `sJt` | const | CLI 2.1.198 | `Oe.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` |
| `PX()`/`Ipa()`/`s_p()` | gate fns | CLI 2.1.198 | Fork experiment active (env `CLAUDE_CODE_FORK_SUBAGENT` or GB rollout) → background-by-default, param omitted |
| `CLm` (name `O_`) | tool | CLI 2.1.198 | SendMessage; no own `isEnabled` → default-enabled via `A5d` |
| `dfe` | async fn | CLI 2.1.198 | `resumeAgentBackground`: transcript reload + loop continuation; `stoppedByUser` guard; fork-prompt reconstruction |
| `resumedAgentId` | tool-result field | CLI 2.1.198 | Returned on async resume; consumed by session-rehydration to mark `redispatched` |
| `resumeInProcessTeammate` (`cLl`) | fn | CLI 2.1.198 | Evicted-teammate rehydration with prior-message count |
| `U3` | agent def | CLI 2.1.198 | `subagent_type: "fork"` — inherits full conversation context |
| `tengu_agent_tool_selected.is_resume` | telemetry field | CLI 2.1.198 | `false` for every Task spawn; resume flows carry `invocationKind: "resume"` |
| Cowork spawn `tools:`/`allowedTools:` | spawn config | asar 1.18286.0 | Explicit tool lists; SendMessage absent from both |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`/`_DISABLE_AGENTS_FLEET` | env vars | asar 1.18286.0 | Set once each, in the **main** local-agent spawn env (corrects L114's "Tasks-tool-child" siting) |
| `Task` PreToolUse matcher | Desktop hook | asar 1.18286.0 | Blocks `run_in_background` truthy ("Background agents disabled") |

## Methodology note (the transferable lesson)

A capability claim about "Claude Code and Cowork" is really **three** claims: the CLI
binary's mechanism, the Desktop's spawn-time configuration of that binary, and the
intersection the model actually experiences. Here the mechanism (resume) exists in the
CLI, is advertised to the model in prompt text, and is then made unreachable in Cowork
by a spawn-time tool-list omission — so testing only in Cowork produces a false
universal ("resume isn't available"), and grepping only the CLI produces the opposite
false universal ("resume always works"). Same artifact-scoping trap as L107's
forced-ask hook, in the other direction. Also worth keeping: "appears exactly once in
the bundle" is a cheap, decisive check when a lesson claims a *distinct* spawn path
sets a variable (Part D).

**Cross-references.** Ch21/L91 (Workflow `resumeFromRunId`) · Ch21/L92 (teams; the
`il()` gate that shapes SendMessage's schema, not its availability) · L87 (`/fork` and
the fork subagent type this chapter's fork-resume path serves) · Ch24/L107 (Cowork
spawn contract, host-loop tool partition, the Desktop `hooks` spawn option) ·
Ch26/L109 (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, Tasks tool family) · Ch28/L114
(the spawn-path siting corrected in Part D).
