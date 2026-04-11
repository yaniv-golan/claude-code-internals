Updated: 2026-04-11 | Source: Binary extraction from claude v2.1.92

# Chapter 10: Verified New in v2.1.92 (Source-Confirmed)

> Changes extracted by diffing the v2.1.92 bundle against v2.1.91.
> Build time confirmed: `2026-04-03T23:25:51Z` (from bundle constants).
> All claims verified against minified source via `diff-versions.sh` + manual bundle analysis.

---

## TABLE OF CONTENTS

57. [Lesson 57 -- v2.1.92 Command Changes](#lesson-57----v2192-command-changes)
58. [Lesson 58 -- New env vars in v2.1.92](#lesson-58----new-env-vars-in-v2192)

---

# LESSON 57 -- v2.1.92 COMMAND CHANGES

## Summary of slash command changes

| Change | Command | Notes |
|--------|---------|-------|
| Added | `/setup-bedrock` | Reconfigure AWS Bedrock — conditionally visible (requires `CLAUDE_CODE_USE_BEDROCK`). **Now officially documented.** |
| Added | `/stop-hook` | Session-only Stop hook via prompt — `isEnabled: () => false` (disabled) |
| Added | `/teleport` | Resume a Claude.ai web session — confirmed present (see Lesson 53 for full docs) |
| Removed | `/tag` | No longer present in binary |
| Removed | `/vim` | No longer present in binary |
| Changed | `/advisor` | Description updated: "Configure the Advisor Tool to consult a stronger model" |

---

## /setup-bedrock

**Description:** `"Reconfigure AWS Bedrock authentication, region, or model pins"`

**Availability gate:** `isHidden: () => !dH(process.env.CLAUDE_CODE_USE_BEDROCK)`
— only visible when `CLAUDE_CODE_USE_BEDROCK` is set (truthy). Always hidden for non-Bedrock users.

> **Status update (2026-04-11):** `/setup-bedrock` is now officially documented at
> code.claude.com/docs/en/commands. The official description reads: "Configure Amazon Bedrock
> authentication, region, and model pins through an interactive wizard. Only visible when
> `CLAUDE_CODE_USE_BEDROCK=1` is set." The implementation details below (telemetry events,
> internal function names, availability gate) remain unique to this lesson.

**What it does:** Launches the interactive Bedrock setup wizard (`kg_` React component via
`Tr6()`). Equivalent to re-running the Bedrock onboarding flow from within a session.

**Telemetry:**
```
tengu_bedrock_setup_started   — fired on command invocation
tengu_bedrock_setup_cancelled — fired on cancel
```

**Non-obvious behavior:**
- This command was likely present earlier as part of the Bedrock flow but became a visible
  slash command in v2.1.92. It will not appear in `/help` for users without Bedrock configured.
- No arguments — it opens the full interactive wizard.

---

## /stop-hook

**Description:** `"Set a session-only Stop hook with a quick prompt"`

**Type:** `local-jsx`, `immediate: true`

**Current status:** `isEnabled: () => false` — **DISABLED** in v2.1.92. The command is
present in the binary but cannot be invoked. Same pattern as `/toggle-memory` in v2.1.90.

**What it does (when enabled):** Opens a dialog to enter a stopping condition as a natural
language prompt. The prompt is stored as a session-scoped `Stop` hook of type `"prompt"`.
This lets users set a "done condition" (e.g., "Has Claude completed all requested tasks?")
without editing `settings.json`.

**Key behaviors extracted from source:**

```typescript
// Looks up existing Stop hooks (matcher == "" and type == "prompt")
function XA5(appState, sessionId) {
  const hooks = $hH(appState, sessionId, "Stop")
  return hooks.get("Stop")?.filter(h => h.matcher === "" && h.type === "prompt")
}
```

- **Tab key** toggles between "input" mode and "delete" mode — allows clearing the hook.
- If the entered prompt matches the existing hook exactly: responds "Stop hook unchanged".
- On submit with empty prompt: clears any existing Stop hook.
- Telemetry: `tengu_stop_hook_added { promptLength }`, `tengu_stop_hook_removed`
- The hook is **session-scoped only** — written to session state, not `settings.json`.
  It does not persist across restarts.

**UI title:** `"Set Stop hook (this session only)"`

**Non-obvious behavior:**
- Despite `isEnabled: () => false`, `isHidden` is not set to `false` explicitly — behavior
  may differ from `/toggle-memory` (check `/help` output after updates).
- The "delete" toggle (Tab) removes the hook if one already exists, giving a full
  create/update/delete workflow from a single dialog.

---

## /teleport (confirmed present in v2.1.92)

**Status:** Present in v2.1.91 reference docs (Lesson 53). The diff marks it as "Added"
in v2.1.92 — this likely means it was temporarily absent or hidden in v2.1.91, and is
now confirmed present in v2.1.92. No implementation changes detected. See Lesson 53 for
full documentation.

---

## Removed commands: /tag and /vim

Both `/tag` and `/vim` are absent from the v2.1.92 bundle. No documentation for either
was captured in previous lessons (they were present in v2.1.91 but not analyzed). Their
removal is noted here for completeness; no migration path is known.

---

## /advisor description change

The `/advisor` command description changed from:
```
"Configure the advisor model"
```
to:
```
"Configure the Advisor Tool to consult a stronger model for guidance"
```
(exact full description — the diff tool had truncated it at 64 chars)

This is a display-only change; the underlying functionality is unchanged (see Lesson 55
for the `advisorModel` setting and `advisor-tool-2026-03-01` beta).

---

# LESSON 58 -- NEW ENV VARS IN v2.1.92

Five new environment variables found in the v2.1.92 bundle that were absent from v2.1.91.

| Variable | Default | Purpose | Docs |
|----------|---------|---------|------|
| `CLAUDE_BASE` | — | Internal base identifier/env key used in bundle constants | Undocumented |
| `CLAUDE_CODE_EXECPATH` | `process.execPath` | Path to the Claude Code binary, auto-injected into spawned shell environments | Undocumented |
| `CLAUDE_CODE_SIMULATE_PROXY_USAGE` | — | Debug/test flag to simulate proxy usage | Undocumented |
| `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK` | — | Skip organization-level eligibility check for fast mode | Undocumented |
| `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` | hostname | Prefix for auto-generated Remote Control session names | **Official** (env-vars page + CLI reference) |

---

## CLAUDE_CODE_EXECPATH

**Source confirmation:**
```javascript
const Sa6 = "CLAUDE_CODE_EXECPATH"
// ...
async getEnvironmentOverrides($) {
  const A = {}
  A[Sa6] = process.execPath   // always injected
  // ...
  return A
}
```

**What it does:** Claude Code automatically sets `CLAUDE_CODE_EXECPATH` to `process.execPath`
(the path to the claude binary) in the environment of every spawned shell command. This makes
the binary path available to hook scripts and subprocesses without requiring users to discover
it themselves.

**Use case:** Hook scripts can use `$CLAUDE_CODE_EXECPATH` to invoke Claude Code
sub-commands or agents without hard-coding a path:
```bash
# In a hook script
"$CLAUDE_CODE_EXECPATH" --print "Summarize these changes"
```

**Non-obvious behavior:**
- This is injected automatically — users do not set it. Setting it manually in the
  environment has no effect as the value is always overwritten.
- Available to all hook types (PreToolUse, PostToolUse, Stop, etc.) and Bash tool executions.

---

## CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX

**Source confirmation:**
```javascript
function p6_() {
  const H = process.env.CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX || H77.hostname()
  return _77(H) || "remote-control"
}
function _77(H) {
  return H.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}
```

**What it does:** Sets the prefix for auto-generated session names in Remote Control mode.
Defaults to the machine hostname, sanitized to lowercase alphanumeric with hyphens.

**CLI help text:** `"Prefix for auto-generated session names (default: hostname; env: CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX)"`

**The `--session-name-prefix` flag** also sets this (overwrites the env var):
```bash
claude remote-control --session-name-prefix my-workstation
# or:
CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX=my-workstation claude remote-control
```

**Sanitization:** The value is lowercased and all non-alphanumeric characters are replaced
with hyphens; leading/trailing hyphens are stripped. If the result is empty, falls back to
`"remote-control"`.

---

## CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK

**Source confirmation:**
```javascript
// In X37() / session metadata:
{ fastModeEnabled: !dH(process.env.CLAUDE_CODE_DISABLE_FAST_MODE) }
// In fast mode org check (inferred from name and gating logic):
// dH(process.env.CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK) bypasses org eligibility check
```

**What it does:** Skips the organization-level check that gates fast mode availability.
Normal fast mode requires the user's org to be eligible; this flag bypasses that check.

**Use case:** Testing/debugging fast mode behavior without an eligible org account.

---

## CLAUDE_BASE

**Source confirmation:**
```javascript
var zC7 = "CLAUDE_BASE"
// Used as a string constant in the remote control / bridge module
```

The exact semantics of `CLAUDE_BASE` are unclear from the bundle — it appears as a string
constant identifier in the remote control / bridge module (`gX` init block). It may be
related to the base URL for CCR (Claude Cloud Run) infrastructure, but no concrete env var
read pattern (`process.env.CLAUDE_BASE`) was found in the analyzed sections. Likely an
internal constant name rather than a user-facing env var.

---

## CLAUDE_CODE_SIMULATE_PROXY_USAGE

**Source confirmation:** Present in the env var list extracted by `diff-versions.sh`.
No detailed implementation context was found in the analyzed bundle sections.

Likely a debug/QA flag to simulate proxy network conditions. Not recommended for general use.

---

## Changes from v2.1.91 for completeness

v2.1.91 had removed the following (noted in `version.json` from the prior update):
- `/pr-comments` command
- `/output-style` command
- `CLAUDE_CODE_MCP_INSTR_DELTA` env var
- `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTIONJ` env var (note: likely a typo in the original — "SUGGESTION" + "J")

None of these were documented in lessons (they were caught by the diff but deemed
not worth documenting). They remain absent in v2.1.92.

---

## Lesson 59 -- AskUserQuestionTool

**Source:** Binary extraction from v2.1.92

### Purpose

AskUserQuestionTool presents structured multiple-choice questions to the user during execution. Unlike plain text output, it renders a dedicated question form in the UI that requires explicit user selection before the conversation continues.

Use cases:
- Gather user preferences or requirements
- Clarify ambiguous instructions
- Get decisions on implementation choices
- Offer choices about what direction to take

### Tool Properties

| Property | Value |
|----------|-------|
| name | `AskUserQuestion` |
| searchHint | `"prompt the user with a multiple-choice question"` |
| shouldDefer | `true` (loaded via ToolSearch) |
| isReadOnly | `true` |
| isConcurrencySafe | `true` |
| requiresUserInteraction | `true` |
| maxResultSizeChars | 100,000 |

### Input Schema

**Top-level fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| questions | Question[] | Yes | 1–4 questions (must have unique text) |
| answers | Record<string, string> | No | User answers collected by permission component |
| annotations | object | No | Per-question annotations from user |
| metadata | `{ source?: string }` | No | Analytics identifier (e.g. `"remember"` for /remember command) |

**Question object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| question | string | Yes | Complete question text, should end with `?` |
| header | string | Yes | Short chip/tag label, max 12 characters |
| options | Option[] | Yes | 2–4 options (unique labels; "Other" is added automatically) |
| multiSelect | boolean | No | Default `false`. Set `true` for non-mutually-exclusive choices |

**Option object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| label | string | Yes | Display text (1–5 words) |
| description | string | Yes | Explanation of what option means or trade-offs |
| preview | string | No | Markdown or HTML fragment rendered when option is focused |

### Output Schema

| Field | Type | Description |
|-------|------|-------------|
| questions | Question[] | The questions that were asked |
| answers | Record<string, string> | Question text → answer string (multi-select answers are comma-separated) |
| annotations | object | Optional per-question annotations |

### Preview Feature

Options can include a `preview` field for rich visual comparisons:
- **Markdown preview**: rendered in a monospace box, supports multi-line with newlines
- **HTML preview**: must be a self-contained fragment (no `<html>`, `<body>`, `<!DOCTYPE>`, `<script>`, or `<style>` tags — inline styles only)
- When any option has a preview, the UI switches to side-by-side layout (options left, preview right)
- Previews are only supported for single-select questions (not `multiSelect`)

HTML validation rejects full documents and script/style tags, returning detailed error messages.

### Permission & Interaction Logic

`AskUserQuestion` always requires human involvement — it cannot be auto-approved even in `bypassPermissions` mode. Its `checkPermissions()` always returns `{ behavior: "ask" }`.

**isEnabled() guard**: returns `false` when other interactive tools are already pending (prevents overlapping permission prompts).

### Plan Mode Restrictions

- Use to clarify requirements or choose between approaches **before** finalizing a plan
- Do **not** use to ask "Is my plan ready?" or "Should I proceed?" — use `ExitPlanMode` instead
- Do **not** reference "the plan" in questions — users cannot see the plan until `ExitPlanMode` is called

### Recommended Option Ordering

If recommending a specific option, make it the first in the list and append `"(Recommended)"` to its label.

### Key Distinction from Text Output

| Aspect | AskUserQuestion | Plain text output |
|--------|----------------|-------------------|
| UI | Dedicated question form with selectable options | Inline markdown |
| Interaction | Blocks until user selects | No interaction required |
| Response | Structured answers object | No structured response |
| Permission | Always requires human involvement | N/A |

### Rendering Methods

- `renderToolResultMessage()` — displays "User answered Claude's questions:" followed by answer list
- `renderToolUseRejectedMessage()` — displays rejection message if user declines
- `toAutoClassifierInput()` — returns question texts joined by ` | ` for the security classifier
