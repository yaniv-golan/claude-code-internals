Updated: 2026-04-08 | Source: Binary extraction from claude v2.1.94

# Chapter 11: Verified New in v2.1.94 (Source-Confirmed)

> These changes are new relative to the previous verified baseline in this skill
> (v2.1.92). Some may have first appeared in an intermediate build before v2.1.94.
> Build time confirmed: `2026-04-07T20:25:46Z` (from the embedded `BUILD_TIME` constant).
> Claims below were validated by diffing the v2.1.94 bundle against v2.1.92 and then
> manually inspecting the relevant minified source blocks.

---

## TABLE OF CONTENTS

60. [Lesson 60 -- v2.1.94 Command Changes](#lesson-60----v2194-command-changes)
61. [Lesson 61 -- New env vars in v2.1.94](#lesson-61----new-env-vars-in-v2194)

---

# LESSON 60 -- v2.1.94 COMMAND CHANGES

## Summary of command changes

| Change | Command | Notes |
|--------|---------|-------|
| Added | `/autofix-pr` | Local JSX command that spins up a remote Claude Code session to monitor and autofix the current PR |
| Added | `/team-onboarding` | Built-in prompt command that generates onboarding guidance from your own Claude Code usage |
| Not removed | `/loop` | Still present in v2.1.94; naive regex diffs can misreport it as removed because the command metadata now uses getter syntax |

---

## /autofix-pr

**Description:** `"Spawn a remote Claude Code session that monitors and autofixes the current PR"`

**Type:** `local-jsx`

**Source confirmation:**
```javascript
{
  type:"local-jsx",
  name:"autofix-pr",
  description:"Spawn a remote Claude Code session that monitors and autofixes the current PR",
  isEnabled:()=>d8()&&OO("allow_remote_sessions"),
  get isHidden(){return!d8()||!OO("allow_remote_sessions")}
}
```

**Availability gate:** The command only enables when the `d8()` predicate passes and the
`allow_remote_sessions` policy flag is enabled. Elsewhere in the auth module, `d8` is exported
as `isClaudeAISubscriber`, so the gate appears to require Claude.ai-authenticated usage plus
org policy approval for remote sessions.

**What it does:** Opens a local JSX flow that creates a remote Claude Code session for the
current pull request and then subscribes that session to an autofix workflow. Visible progress
states in the bundle include:

- `"Spawning remote Claude Code session..."`
- `"Turning on autofix..."`

**Public documentation note:** Anthropic PM Noah Zweben publicly described `/autofix-pr` as
sending the current session to the cloud so the PR autofixer has full context to address CI
failures and comments. That description matches the bundle evidence that this command hands off
to remote-session infrastructure rather than running as a purely local PR helper.

**Non-obvious behavior:**
- This is not a plain local command; it is explicitly remote-session driven.
- The command is hidden, not merely disabled, when the availability gate fails.
- The feature is tightly coupled to remote review / remote session infrastructure rather than
  the local Git-only PR tooling.

---

## /team-onboarding

**Description:** `"Help teammates ramp on Claude Code with a guide from your usage"`

**Type:** `prompt`

**Source confirmation:**
```javascript
{
  type:"prompt",
  name:"team-onboarding",
  description:"Help teammates ramp on Claude Code with a guide from your usage",
  allowedTools:["Edit(ONBOARDING.md)","Bash(ls:*)"],
  contentLength:0,
  isEnabled:()=>BH(process.env.CLAUDE_CODE_TEAM_ONBOARDING)||C_("tengu_flint_harbor",!1),
  isHidden:!1,
  progressMessage:"scanning usage data",
  source:"builtin"
}
```

**What it does:** Generates an onboarding guide for teammates based on the user's Claude Code
usage history, then writes that guide into `ONBOARDING.md`. The command is intentionally
restricted to a very small tool surface:

- `Edit(ONBOARDING.md)`
- `Bash(ls:*)`

**Prompt-generation details extracted from source:**
- Reads a feature-flag payload with `prompt`, `guideTemplate`, and `windowDays`
- Clamps `windowDays` into the range `1..365`
- Collects `usageData`, `sessionCount`, and `slashCommandCount` before producing the guide

**Discovery / onboarding surfaces:** The same env var also participates in onboarding UI
discovery. A separate source path checks for the exact values:

- `CLAUDE_CODE_TEAM_ONBOARDING=banner`
- `CLAUDE_CODE_TEAM_ONBOARDING=step`

These appear to force the related discovery banner or step even before the slash command is run.

**Non-obvious behavior:**
- `isHidden: false` means the command can remain visible even when it is feature-gated off.
- This is a built-in prompt command, not a skill/plugin command.
- The output is grounded in the user's prior Claude Code behavior, not a static onboarding template.

---

## /loop is still present in v2.1.94

The structured diff initially reported `/loop` as removed, but manual inspection shows the
command still exists in v2.1.94 with the same user-facing description and argument hint.

**Why the false positive happened:** In v2.1.92 the command used direct object fields:

```javascript
name:"loop",description:"Run a prompt or slash command on a recurring interval ..."
```

In v2.1.94 the same metadata moved to getters:

```javascript
name:"loop",get description(){return"Run a prompt or slash command on a recurring interval ..."}
```

This is a tooling gotcha for bundle diff scripts, not a user-visible command removal.

---

# LESSON 61 -- NEW ENV VARS IN v2.1.94

Seven new environment variables are present in the v2.1.94 bundle relative to the v2.1.92
baseline used by this skill.

| Variable | Purpose | Notes |
|----------|---------|-------|
| `ANTHROPIC_BEDROCK_MANTLE_API_KEY` | Mantle provider credential slot | Inferred from naming and provider env lists |
| `ANTHROPIC_BEDROCK_MANTLE_BASE_URL` | Override Mantle base URL | Defaults from AWS region if unset |
| `CLAUDE_CODE_MCP_ALLOWLIST_ENV` | Toggle MCP env allowlisting | Defaults to enabled in `local-agent` entrypoint |
| `CLAUDE_CODE_SANDBOXED` | Mark the session as already sandboxed/trusted | Short-circuits trust checks |
| `CLAUDE_CODE_SKIP_MANTLE_AUTH` | Skip Mantle auth refresh | Debug/test style flag |
| `CLAUDE_CODE_TEAM_ONBOARDING` | Enable team-onboarding command / discovery flows | Also accepts `banner` and `step` discovery values |
| `CLAUDE_CODE_USE_MANTLE` | Enable Mantle as a provider backend | Added alongside Bedrock/Vertex/Foundry/AWS provider selection |

---

## Mantle provider additions

The biggest v2.1.94 env-var change is a new provider family named `mantle`.

**Provider selection source confirmation:**
```javascript
return BH(process.env.CLAUDE_CODE_USE_BEDROCK) ? "bedrock"
  : BH(process.env.CLAUDE_CODE_USE_FOUNDRY) ? "foundry"
  : BH(process.env.CLAUDE_CODE_USE_ANTHROPIC_AWS) ? "anthropicAws"
  : BH(process.env.CLAUDE_CODE_USE_MANTLE) ? "mantle"
  : BH(process.env.CLAUDE_CODE_USE_VERTEX) ? "vertex"
  : "firstParty"
```

**Base URL source confirmation:**
```javascript
const baseURL =
  Ci("ANTHROPIC_BEDROCK_MANTLE_BASE_URL")
  ?? (awsRegion ? `https://bedrock-mantle.${awsRegion}.api.aws/anthropic` : void 0)
```

**Auth-skip source confirmation:**
```javascript
const skipAuth = BH(process.env.CLAUDE_CODE_SKIP_MANTLE_AUTH)
const creds = !process.env.AWS_BEARER_TOKEN_BEDROCK && !skipAuth ? await RC() : null
```

**What this means:**
- `CLAUDE_CODE_USE_MANTLE` adds a new provider branch next to Bedrock, Vertex, Foundry, and Anthropic AWS.
- `ANTHROPIC_BEDROCK_MANTLE_BASE_URL` overrides the default Mantle endpoint; otherwise the base URL is derived from `AWS_REGION` / `AWS_DEFAULT_REGION`.
- `CLAUDE_CODE_SKIP_MANTLE_AUTH` disables the normal AWS credential refresh path for this provider.
- `ANTHROPIC_BEDROCK_MANTLE_API_KEY` appears in provider env lists and sensitive-env scrub lists, which strongly suggests a dedicated credential path for Mantle-backed sessions.

**Non-obvious behavior:**
- Mantle is treated as a first-class provider, not just a Bedrock flag.
- The default URL format makes this look like a Bedrock-adjacent Anthropic endpoint rather than the standard Anthropic API base URL.

---

## CLAUDE_CODE_MCP_ALLOWLIST_ENV

**Source confirmation:**
```javascript
function Qc6() {
  let H = process.env.CLAUDE_CODE_MCP_ALLOWLIST_ENV
  if (BH(H)) return true
  if (p1(H)) return false
  return process.env.CLAUDE_CODE_ENTRYPOINT === "local-agent"
}
```

**What it does:** Controls whether MCP environment allowlisting is enabled. If the env var is
unset, the default is `true` when running under the `local-agent` entrypoint.

**Non-obvious behavior:**
- This mirrors the nearby `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` gate, suggesting the same
  "explicit true / explicit false / local-agent default" pattern.
- The exact allowlist contents are implemented elsewhere; this function only controls the gate.

---

## CLAUDE_CODE_SANDBOXED

**Source confirmation:**
```javascript
function av4() {
  if (BH(process.env.CLAUDE_CODE_SANDBOXED)) return true
  if ($JH()) return true
  if (v6H()) return true
  // ... otherwise walk trusted project settings
}
```

**What it does:** Short-circuits the trust / sandbox acceptance check. When this env var is set,
Claude Code treats the current session as already sandboxed or otherwise trusted.

**Why it matters:** This is not just a cosmetic flag. It changes whether the trust dialog
appears and whether the workspace is considered safe enough to proceed without additional user
confirmation.

---

## CLAUDE_CODE_TEAM_ONBOARDING

This env var affects both command availability and onboarding discovery:

- Truthy value enables the `/team-onboarding` command gate
- Exact values `banner` and `step` force specific onboarding discovery flows

This makes it more than a simple boolean feature flag.

---

## Practical summary

Relative to the v2.1.92 baseline, v2.1.94 introduces:

- Two real new command surfaces: `/autofix-pr` and `/team-onboarding`
- A new provider backend and env family: `mantle`
- A new MCP env gate: `CLAUDE_CODE_MCP_ALLOWLIST_ENV`
- An explicit sandbox/trust override: `CLAUDE_CODE_SANDBOXED`

The most important user-visible additions are the remote PR autofix flow and the usage-derived
team onboarding guide; the most important infrastructure change is the Mantle provider path.
