Updated: 2026-09-23 | Source: **agent 2.1.280** (host Mach-O and standalone CLI, identical on every string cited), **`app.asar` 2.7032.0** with backups back to 1.18286.2, the live fcache `f82df085d027eff0`, **this machine's Desktop logs, 905 local Cowork audit logs and session transcripts**, live probes of the Desktop release feed, and **129 relayed `claude -p` runs** (two experiments, 40 + 89) made on this machine by a sibling session (re-scored here). **Does NOT move the CLI content baseline.**

Second batch of leads from the sibling-session consultation (Ch54 was the first), each re-derived first-party.

# Chapter 55: Forked Skills Get Rewritten, Two Ways to Ask the User, What Grants `save_skill`, and Five Smaller Mechanics

---

## TABLE OF CONTENTS

204. [Lesson 204 — A Forked Skill's Answer Is Rewritten Before the User Sees It](#lesson-204--a-forked-skills-answer-is-rewritten)
205. [Lesson 205 — Two Ways to Ask the User, and the Model Chooses](#lesson-205--two-ways-to-ask-the-user)
206. [Lesson 206 — What Grants `save_skill`, and a Second Server-Side Switch Channel](#lesson-206--what-grants-save_skill)
207. [Lesson 207 — Five Smaller Mechanics: Slash Skills, the OAuth Descriptor, Hook Feedback, a Plugin-Server Allowlist, an Unlisted Build](#lesson-207--five-smaller-mechanics)

---

# LESSON 204 — A FORKED SKILL'S ANSWER IS REWRITTEN

**A skill with `context: fork` runs as a separate sub-task, and only its final message goes back to the main conversation — which then writes its own answer to the user. In 129 measured runs, a Sonnet main model passed the fork's link through 0 times in 51 without special handling, and usually dropped its caveats. An inline skill has no such step.**

## The mechanism

Agent 2.1.280, `mapToolResultToToolResultBlockParam` for the Skill tool:

- **Forked:** the tool result is the plain text `Skill "<name>" completed (forked execution).` followed by `Result:` and the fork's **last assistant message** (text blocks joined). Anything the fork said only in earlier messages is lost. A background fork gets `launched (forked execution, running in the background)` instead. (A third mode returns the skill's instructions read-only.)
- **Inline:** the tool result is just `Launching skill: <name>`, and the skill's body goes into the main conversation itself, so the main model writes the answer with the skill's instructions in view. There is no relay.
- The result is not marked as untrusted unless the fork read Artifact content written by others, in which case an `<artifact-content-authored-by-others/>` note is prefixed.
- The skill listing gives the model no hint that a skill will fork: each entry is only its description, plus `when_to_use` if present (`HYe`), so the choice to call it is made without knowing its answer will be relayed.
- No instruction asks the main model to relay a forked skill's output verbatim. The Agent tool's prompt says the opposite for sub-agents: their report is invisible to the user, so summarise it. The main system prompt also tells the model not to generate URLs unless confident they help, while allowing URLs from the user's messages or local files; whether that rule causes the dropped links is not established.

## The measurements

Run on this machine by a sibling session in two experiments (40 and 89 runs): CLI 2.1.280, `claude -p`, one skill, three Cowork-authoring questions plus a control, three runs per question; re-scored here from the raw transcripts. The fork's result contained the link in every run.

| main model, skill variant | link reached the user | `?ref=` survived |
|---|---|---|
| Sonnet 5, baseline | 0/9 | — |
| Sonnet 5, a note in the skill asking the main model to include the line | 6/9 | 6/6 |
| Sonnet 5, link moved to the first line | 0/9 | — |
| Sonnet 5, three further variants and a realistic-settings arm | 0/33 | — |
| Opus 5.5, three variants | 24/27 | 1/24 |

- In **2 of the 3 runs where the note did not work**, the Sonnet main model told the user that an instruction inside a tool result looked like a prompt injection.
- Version caveats present in the fork's answer reached the user in 1–2 of 9 Sonnet runs; Opus mentioned the version every time but paraphrased it.
- The main model's answer ran to 36–39% of the fork's length on Sonnet, 55–58% on Opus.
- No control produced a link, and with the skill blocked the main model never invented one.

Limits: three runs per cell, one skill and one site, headless runs only, one version of each model, and no arm that removes the URL rule.

## For a skill author

- **Do not rely on a forked skill's wording, links or caveats reaching the user.** The main model rewrites and shortens it, and on Sonnet drops links.
- **Do not add notes addressed to the main model** asking it to pass things through: it helps only partly, and can make the model warn the user about a prompt injection.
- **Use inline (the default) for skills whose exact output matters**, or write essential content to a file the skill produces. (Inferred from the mechanism; not measured.)
- **Put everything essential in the fork's final message**; earlier messages never leave the fork.
- **Don't depend on query-string tracking parameters** in links; even when the link survives, they usually do not.

---

# LESSON 205 — TWO WAYS TO ASK THE USER

**When a skill needs input in Cowork, the model is told to use an on-screen form rather than AskUserQuestion, but both are available and the model decides. On this machine it used the form in about half the sessions that asked anything, AskUserQuestion in the rest, sometimes both.**

## The form is a visualisation tool

The form comes from a Desktop-internal SDK-MCP server named **`visualize`** (asar 2.7032.0, `getImagineServerDef`), with two tools:

- **`mcp__visualize__read_me`** — returns guidance for a chosen module: `diagram`, `mockup`, `interactive`, `data_viz`, `art`, `chart` or `elicitation`. Hidden in chat.
- **`mcp__visualize__show_widget`** — renders HTML the model writes (`widget_code`, `title`, `loading_messages`) as an MCP App (`ui://imagine/show-widget.html`). Its tool result is a fixed confirmation; the user's answers come back as their next message (L147).

The form is the `elicitation` module of a general visualisation server, not a dedicated form tool.

## Two gates, independent

| gate | controls | 2026-09-23 capture |
|---|---|---|
| `3444158716` | whether the `visualize` server exists in the session | force-on |
| `286376943` | whether the "collect input with the form" instruction is injected — on a Skill tool call (not inside sub-agents) and on a typed `/skill` command | force-on |

Neither gate consults the other, so a session could receive the instruction without the tools; one such session on this machine asked nothing. The instruction is advice: nothing blocks or rewrites AskUserQuestion.

## Measured

Across this machine's local Cowork records, the visualize tools are absent from every session on agent 2.1.111 and earlier and present in every session from 2.1.119. Every session that received the instruction also had AskUserQuestion. In the 157 sessions that received it:

| after the instruction, the model… | sessions |
|---|---|
| asked nothing | 86 |
| used the form only | 31 |
| used AskUserQuestion only | 27 |
| used both | 13 |

No week-to-week trend; the split looks like model choice, not a switch. Some `show_widget` calls are charts rather than forms, so the form row is slightly overstated. The injected instruction does not appear in `audit.jsonl` at all (SDK callback hooks are not audited); only the session transcript shows it, as a `hook_additional_context` attachment.

## For a skill author

Handle both: write your skill so that an answer arriving as a normal user message (from the form) and one arriving through AskUserQuestion both work. Declare `argument-hint` in your frontmatter; the injected instruction passes it through (L147).

---

# LESSON 206 — WHAT GRANTS `SAVE_SKILL`

**`mcp__cowork__save_skill` is no longer governed by the gate this skill used to name: gate `3246569822` has been gone from Desktop's code since 1.44121.1, though the server still sends it. It is now granted by org settings and a per-account access list that Desktop fetches from claude.ai every hour — a second server-side channel beside the GrowthBook gates.**

## The computation (asar 2.7032.0, chunk `Cpo4PQ3e`)

```
canSaveSkill = orgSkillCreationAllowed && (sticky ? session.canSaveSkill : skillsEnabled && !orgSkillsOff)
```

- **`orgSkillCreationAllowed`** is true unless: managed setting `workspace.skillCreationEnabled` is `false` (a third-party-deployment setting); the account is HIPAA-restricted; or the access list marks `skill_creation` as `blocked_by_platform`, `blocked_by_org_admin`, `blocked_by_org_tier` or `blocked_by_entitlement`. A bypass gate new in 2.7032.0, `3469616823` (absent from the capture), exempts the last three; `blocked_by_platform` is checked separately and is not bypassed.
- **`orgSkillsOff`** only applies when gate `3656976882` is on; it is off at capture.
- **Sticky:** once a session's system prompt is built, the value is reused (falling back to `false`) until it is rebuilt — on a model change, or when the org's skill-creation block or the served skills change (the same stickiness L129 describes for other session flags).
- **No account-type check.** The "1p-only" resolver this skill previously attributed to `canSaveSkill` belongs to `/setup-writing-style`, which read the same old gate.

## The access list

```
GET <claude.ai>/api/bootstrap/<orgId>/current_user_access   →   {features:[{feature, status}]}
```

Refreshed hourly (every five minutes while stale, and on demand at most once a minute), kept in memory only, and fetched only when the org has a policy backend. Statuses include `available`, `blocked_by_platform`, `blocked_by_org_admin`, `blocked_by_org_tier` and `blocked_by_entitlement`. Features read from it include `skills`, `skill_creation`, `claude_code_remote_control`, `claude_code_routines`, `claude_browser_extension`, `claude_code_web` and `cowork_browser_pane`. Like a GrowthBook gate, it can change what Cowork offers without any app update — but it is not in the fcache, so an fcache comparison will not show it.

## When it appeared on this machine

Across 3,024 `system/init` records in 905 local audit logs: the last session without `save_skill` was 2026-07-23 (agent 2.1.217), the first with it 2026-07-25 (agent 2.1.219), and every session since has had it. Desktop 1.24012.9 launched about six minutes before that first session, and 1.24012.1 and 1.24012.9 differ in bytes — so on this machine the tool arrived with an app update, and a server-side change cannot be told apart from it.

---

# LESSON 207 — FIVE SMALLER MECHANICS

## A `/skill` command leaves no Skill tool call

Typing `/plugin:skill` expands into two user messages and a permission update, not a tool call: a visible message carrying `<command-message>NAME</command-message>` and `<command-name>/NAME</command-name>` (plus `<command-args>` if any), and a hidden (`isMeta`) message with the skill body, beginning "Base directory for this skill". When the model invokes a skill instead, the transcript has a `tool_use` named `Skill`, followed by a hidden message whose `sourceToolUseID` is set. To count skill invocations from a transcript, count both: `Skill` tool calls, and `<command-name>` messages followed by a hidden message whose `parentUuid` is that message's id and which has no `sourceToolUseID`. Counting tool calls alone misses every typed invocation.

## Cowork passes the OAuth token through a file descriptor

In host-loop, on macOS and Linux, the Desktop removes `CLAUDE_CODE_OAUTH_TOKEN` from the agent's environment and sets `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3` instead: it writes the token to a mode-0600 temporary file, opens it, deletes the file and passes the open descriptor as the child's fd 3. If staging fails it logs "[HostLoop] Failed to stage OAuth token fd; falling back to env" and uses the variable. The agent reads `/dev/fd/3`, then deletes the variable from its environment. Present in every Desktop build back to 1.18286.2. A skill looking for `CLAUDE_CODE_OAUTH_TOKEN` in Cowork will not find it, by design.

## One feedback path for four hook events

```js
var LMn=` hook feedback:\n`,Xbr=["Stop","TeammateIdle","TaskCreated","TaskCompleted"];
function len(e,n){return`${e}${LMn}${n}`}
```

A blocking hook on any of these four events (exit code 2) produces a hidden user turn `<Event> hook feedback:` followed by a newline and `[<hook>]: <stderr>` (or "No stderr output"). Confirmed at the call site for Stop and TeammateIdle; the other two share the wrapper. The agent recognises these turns as system-injected by that prefix.

## An admin allow-list stops plugin MCP servers from running locally

From Desktop 2.2553.0 (the setting's own schema; first present in the 2.2553.1 build on hand, absent from 1.46388.4), a third-party-deployment managed setting `allowedPluginMcpServers` (up to 100 `{serverUrl}` patterns, `*` wildcards; empty list allows none) changes everything in L199 for plugins: the Desktop bridges no plugin servers and refuses to start any local plugin server ("allowedPluginMcpServers is set, so the desktop does not start X:Y"), and passes the list to the agent as managed MCP settings, so only remote servers matching a pattern connect. No empty stubs are made for the blocked ones.

## Desktop can receive a build the public feed never lists

This machine updated from Desktop 2.2553.1 to **2.2553.13** on 2026-09-22 at 20:12, and to 2.7032.0 four hours later. The public release manifest (`downloads.claude.ai/releases/darwin/universal/RELEASES.json`) lists only 2.7032.0 as current, published that morning; the Desktop's own update check goes to a per-device endpoint on `api.anthropic.com` that requires a device id. 2.2553.13 is a real build — its `vm_hash` resolves, while an invented neighbour 404s — served to this device after 2.7032.0 was already public. So "one build per announced Desktop version" does not hold: a device can run builds that appear in no public list, and which one it runs is visible only in its own log (`appVersion` in `main.log`).
