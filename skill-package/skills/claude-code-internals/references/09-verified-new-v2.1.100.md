Updated: 2026-04-10 | Source: Binary extraction from claude v2.1.100

# Chapter 12: Verified New in v2.1.97--v2.1.100 (Source-Confirmed)

> These changes accumulate across three releases: v2.1.97, v2.1.98, and v2.1.100.
> v2.1.100 itself is a bugfix-only release on top of v2.1.98 (zero new env vars,
> commands, hooks, or API betas; bundle shrank by ~3KB).
>
> **Provenance:** Details marked **[v2.1.100]** come from direct binary extraction
> of the v2.1.100 bundle (2026-04-10) and are not yet corroborated by the packaged
> reference corpus. All other claims are validated against changelog diffs.
>
> **No changes** in hook event types (19 unchanged) or API beta strings (28 unchanged).

---

## TABLE OF CONTENTS

62. [Lesson 62 -- /dream: User-Facing Memory Consolidation](#lesson-62----dream-user-facing-memory-consolidation)
63. [Lesson 63 -- Perforce Mode & Script Caps](#lesson-63----perforce-mode--script-caps)
64. [Lesson 64 -- v2.1.97--v2.1.100 Command & Env Var Changes](#lesson-64----v2197v21100-command--env-var-changes)

---

# LESSON 62 -- /DREAM: USER-FACING MEMORY CONSOLIDATION

## Overview

`/dream` (alias `/learn`) is a reflective memory consolidation command. It spawns a forked
Claude session that reviews recent activity, then reads, writes, merges, and prunes files in
the project's memory directory. It operates on the same `MEMORY.md` index + individual topic
files that the auto-memory system uses.

Introduced as a user-facing slash command in **v2.1.97** with `userInvocable: true`. The
underlying `autoDream` background mechanism existed since at least v2.1.96 (documented in
Lesson 16 and the unreleased-features chapter) but was not exposed as a command.

## Invocation Modes

### 1. Manual: `/dream` or `/dream consolidate`

- User types `/dream` in the CLI
- Runs in a **fork** context (a separate Claude conversation branch)
- The fork receives a 4-phase prompt ("Dream: Memory Consolidation")

### 2. Auto-dream (background)

Triggered as a **fire-and-forget background task in the post-turn lifecycle** (`handleStopHooks`),
alongside prompt suggestions and memory extraction -- not at the start of the loop. Only fires
for the **root agent** (not subagents: `!toolUseContext.agentId`). Skipped in bare mode (`-p` flag).

Gate chain (cheapest-first):

| # | Condition | Source |
|---|-----------|--------|
| 1 | `kairosActive` -> skip if true | Packaged refs (L55) |
| 2 | `isRemoteMode` -> skip | Packaged refs (L55) |
| 3 | Not non-interactive mode | Both |
| 4 | Not SDK mode | **[v2.1.100]** |
| 5 | Memory enabled | Both |
| 6 | `autoDreamEnabled` (settings OR server flag `tengu_onyx_plover`) | Both |
| 7 | Feature gate `tengu_kairos_dream` (5-min cache TTL) | **[v2.1.100]** |
| 8 | Time gate: hours >= 24 | Both |
| 9 | Scan throttle: last scan >= 10min | Both |
| 10 | Session count: >= 5 sessions | Both |
| 11 | Lock acquisition | Both |

> Gates 1-2 (`kairosActive`, `isRemoteMode`) map to `J_5()` in the v2.1.100 bundle, which
> currently returns `false` unconditionally. The outer `M_5()` function handles gates 3-6.

### 3. Scheduled: `/dream nightly` **[v2.1.100]**

- Sets up a **cron-based recurring trigger** via `RemoteTrigger`
- Picks a random time in hours 0-5 (e.g. `42 2 * * *` = 2:42am)
- Persisted to `.claude/scheduled_tasks.json`
- Auto-expires after the standard trigger expiry period
- Deduplicates: checks for existing `/dream consolidate` triggers and removes them first
- After scheduling, runs an immediate consolidation

## Auto-Dream Trigger Thresholds

| Gate | Default | Source |
|------|---------|--------|
| `minHours` since last consolidation | **24 hours** | Server config `tengu_onyx_plover` or hardcoded `qA7` |
| `minSessions` since last consolidation | **5 sessions** | Same |
| Scan throttle | **10 minutes** (600,000ms) | Hardcoded `f_5` |
| Lock expiry | **1 hour** (3,600,000ms) | Hardcoded `ks1` |

## Lock Mechanism

Lock file: `.consolidate-lock` inside the memory directory.

1. Checks if `.consolidate-lock` exists and is < 1 hour old
2. If locked, checks if the PID stored inside is still alive -- if so, skips
3. If stale or absent, writes own PID, re-reads to confirm (atomic acquire via write-then-verify)
4. On completion, updates the lock mtime (serves as "last consolidated at" timestamp)
5. On failure, **rolls back** the lock mtime to the previous value so the next run retries sooner (via `kl_()`)

The "last consolidated at" timestamp is derived from the lock file's `mtime` (via `Zl_()`),
not a separate state file.

## Session Selection

- Lists all `.jsonl` files in the session transcripts directory
- Filters to sessions with `mtime > lastConsolidatedAt`
- Excludes the **current session** ID
- Passes session count and IDs to the prompt (auto-dream only; manual mode doesn't list them)

## The 4-Phase Prompt

The consolidation prompt (`C9_()`) instructs the forked Claude through four phases. The prompt
is parameterized via template variables; the [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)
repo independently confirmed these (tagged `ccVersion: 2.1.98`).

| Template variable | Maps to (bundle) | Purpose |
|-------------------|-------------------|---------|
| `${MEMORY_DIR}` | `Fz()` | Memory directory path |
| `${MEMORY_DIR_CONTEXT}` | `$jH` | "This directory already exists..." boilerplate |
| `${TRANSCRIPTS_DIR}` | `cw(_8())` | Session transcripts path |
| `${INDEX_FILE}` | `DP` = `"MEMORY.md"` | Index filename |
| `${INDEX_MAX_LINES}` | `kt` = `200` | Max index lines |
| `${POST_GATHER_FN}` | `HA7()` | Hook for additional gather instructions |
| `${ADDITIONAL_CONTEXT}` | User-supplied args | Extra context appended to prompt |
| `${HAS_TRANSCRIPT_SOURCE_NOTE}` | conditional | Controls transcript source note |

### Phase 1 -- Orient

- `ls` the memory directory to see what exists
- Read `MEMORY.md` to understand the current index
- Skim existing topic files to avoid creating duplicates
- Check for `logs/` or `sessions/` subdirectories (assistant-mode layout)

### Phase 2 -- Gather Recent Signal

Sources in priority order:

1. **Daily logs** (`logs/YYYY/MM/YYYY-MM-DD.md`) if present
2. **Existing memories that drifted** -- facts that contradict current codebase state
3. **Transcript search** -- selective `grep` of JSONL transcripts for narrow terms

Explicitly instructed: "Don't exhaustively read transcripts. Look only for things you already
suspect matter."

### Phase 3 -- Consolidate

- Write or update memory files at the top level of the memory directory
- Use the memory file format from the system prompt's auto-memory section (frontmatter with
  name/description/type)
- Merge new signal into existing topic files rather than creating near-duplicates
- Convert relative dates to absolute dates
- Delete contradicted facts at the source

### Phase 4 -- Prune and Index

- Update `MEMORY.md` to stay under **200 lines** and ~25KB
- Each entry: one line, under ~150 characters: `- [Title](file.md) -- one-line hook`
- Remove pointers to stale/wrong/superseded memories
- Shorten verbose entries (>200 chars belong in the topic file, not the index)
- Add pointers to newly important memories
- Resolve contradictions between files

## Tool Constraints (Sandboxing)

The dream fork runs with heavily restricted tool access.

| Tool | Allowed? | Constraint |
|------|----------|------------|
| Read | Yes | Unrestricted |
| Glob | Yes | Unrestricted |
| Grep | Yes | Unrestricted |
| Bash | Read-only + rm | Read-only commands (`ls`, `find`, `grep`, `cat`, `stat`, `wc`, `head`, `tail`), plus `rm` for `.md` paths inside memory dir **[v2.1.100]** |
| Write | Memory dir only | `file_path` must pass `py()` (starts with memory dir path) |
| Edit | Conditional | Normal mode: allowed only inside memory dir. Tiny memory mode: **banned entirely** -- must `rm` + `Write` **[v2.1.100]** |
| All others | Denied | Agent, WebSearch, WebFetch, NotebookEdit, etc. |

**[v2.1.100]** If memory is toggled off, ALL tools are denied with: "Memory is toggled off.
Run /toggle-memory to re-enable automemory."

## Team Memory

When team memory is enabled (`isTeamMemoryEnabled()`), the prompt appends a `team/` subdirectory
section (`Y_5` constant) with rules:

- Review `team/` alongside personal files in Phase 1
- Merge near-duplicates within `team/` in Phase 3
- Delete personal memories that restate team memories
- **Conservative pruning** of `team/`: only delete if clearly contradicted by code; don't delete
  things you don't recognize (a teammate may rely on them)
- Do NOT promote personal memories into `team/` during a dream -- that's a deliberate user action
  via `/remember`

## Tiny Memory Mode **[v2.1.100]**

Feature flag: `tengu_billiard_aviary`

When active:
- A different prompt variant is used (referenced as `U$7` vs `C9_`)
- `Edit` tool is fully blocked -- the model must delete and rewrite files rather than editing in place
- Prompt states: "memories are immutable, so use rm + Write to replace, never edit in place"

## Lifecycle Tracking

Dream runs are tracked as a `DreamTask` in the app state:

```
{
  type: "dream",
  status: "running" | "completed" | "failed" | "killed",
  phase: "starting" | "updating",
  filesTouched: string[],       // file paths written/deleted
  turns: object[],              // last 30 message summaries (text + toolUseCount)
  sessionsReviewing: number,    // count of sessions being reviewed
  abortController: AbortController,  // user can kill mid-run
  priorMtime: number            // for lock rollback on failure
}
```

The `onMessage` callback (`P_5`) tracks file touches by inspecting tool_use blocks for Edit/Write
`file_path` inputs and Bash `rm` commands targeting `.md` files.

On completion, if files were touched and an `appendSystemMessage` callback exists, it sends a
notification like `{verb: "Improved", ...fileInfo}`.

## Telemetry Events **[v2.1.100]**

| Event | When |
|-------|------|
| `tengu_dream_invoked` | Manual `/dream` (mode: consolidate, schedule, schedule_unavailable) |
| `tengu_auto_dream_skipped` | Auto-dream skipped (reason: sessions, lock) |
| `tengu_auto_dream_fired` | Auto-dream starting (hours_since, sessions_since) |
| `tengu_auto_dream_completed` | Finished (cache_read, cache_created, output tokens, files_touched_count) |
| `tengu_auto_dream_failed` | Error during dream (phase, error_class) |
| `tengu_auto_dream_toggled` | User toggled the setting |

## Memory Path Resolution & Scope

- Operates **per-project** -- reads/writes the project-specific memory directory and reviews
  session transcripts for that project only
- Does not cross project boundaries
- Modifies only `.md` files inside the memory directory and `MEMORY.md`
- The `context: "fork"` setting means it runs as a separate conversation branch, not inline

Important nuances:
- **Override precedence:** Explicit path override > settings path > default `~/.claude/projects/<hash>/memory/`
- **Worktrees share memory:** Worktrees of the same repo share a single memory directory through
  `findCanonicalGitRoot()`. This means dream consolidation in one worktree affects all worktrees.
- **Relationship to other memory systems:** Dream operates on the same files as the real-time
  auto-memory extraction pipeline. The two are mutually exclusive per-turn (extraction runs
  post-turn; dream runs as a separate background fork). Session memory (JSONL transcripts) is
  read-only input to dream, not modified by it.

## Key Identifiers in the Bundle **[v2.1.100]**

| Symbol | Purpose |
|--------|---------|
| `C9_()` | Builds the consolidation prompt (normal mode) |
| `iu5()` | Builds the scheduling prompt |
| `nu5()` | Registers the `/dream` slash command |
| `Qu5()` | `isEnabled` check for the command |
| `N9_()` | `autoDreamEnabled` check (settings + server flag) |
| `TA7()` | Auto-dream initialization (sets up `KA7`) |
| `OA7()` | Auto-dream entry point (called from main loop) |
| `Mi_()` | Tool permission filter (sandboxing) |
| `r17()` | Lock acquire |
| `kl_()` | Lock rollback |
| `Zl_()` | Read last-consolidated-at timestamp |
| `Fz()` | Memory directory path |
| `Ll_()` | Lock file path (memory dir + `.consolidate-lock`) |
| `l17()` | List session JSONL files |
| `o17()` | List sessions touched since timestamp |
| `s17()` | Create DreamTask in app state |
| `t17()` | Update DreamTask (file touches, turns) |
| `e17()` | Finalize DreamTask (mark completed) |
| `H57()` | Mark DreamTask failed |
| `P_5()` | onMessage callback (tracks file touches) |

---

# LESSON 63 -- PERFORCE MODE & SCRIPT CAPS

## Perforce Mode (`CLAUDE_CODE_PERFORCE_MODE`)

### What It Is

Introduced in **v2.1.98**. Adds first-class support for Perforce (Helix Core) version control
workspaces. Perforce uses a "checkout before edit" model -- files are read-only on disk until
explicitly opened for edit via `p4 edit`. This conflicts with Claude Code's default behavior
of writing files directly.

When the env var is truthy, Claude Code:
1. Injects a Perforce-aware preamble into the system context
2. Blocks write operations on read-only files with an actionable error message
3. Detects Perforce workspaces via `.p4config` marker files

### Activation

```bash
export CLAUDE_CODE_PERFORCE_MODE=1
```

No other configuration is needed. The feature is entirely gated on this single env var via `zA6()`.

### System Context Injection

When active, the system context (built alongside `gitStatus`) includes a `perforceMode` field:

> This is a Perforce workspace. Files not yet opened for edit are read-only; if a file is
> read-only, run `p4 edit <file>` via Bash to check it out before modifying. Files that are
> already writable have been opened and can be edited directly.

This appears at the same level as `gitStatus` and `claudeMd`, so the model sees it on every turn.

### Tool-Level Enforcement

The read-only check is implemented via `dXH(mode)`:

```javascript
// Returns true when Perforce mode is on AND file lacks owner-write permission
// 128 = 0200 octal = Unix owner-write permission bit
function dXH(mode) {
  return zA6() && (mode & 128) === 0
}
```

When `dXH` triggers, the tool returns a validation failure with a specific error message (`UXH`):

> File is read-only -- it has not been opened for edit in Perforce. Run `p4 edit <file>` to
> check it out, then retry. Do not chmod the file writable; that bypasses Perforce tracking.

Enforced in **three tools**:

| Tool | Error code | Behavior |
|------|-----------|----------|
| **Edit** | `errorCode: 11` | Checked after file size validation, before content diffing. Uses `behavior: "ask"`. |
| **Write** | `errorCode: 6` | Checked after permission-settings validation, before timestamp comparison. |
| **NotebookEdit** | `errorCode: 11` | Checked after read-state validation. |

All three return the same `UXH` error message instructing the model to run `p4 edit` via Bash.

### VCS Detection

Perforce is recognized in the VCS type detection array (`WvK`):

```javascript
WvK = [
  [".git",      "git"],
  [".hg",       "mercurial"],
  [".svn",      "svn"],
  [".p4config", "perforce"],
  ["$tf",       "tfs"],
  [".tfvc",     "tfs"],
  [".jj",       "jujutsu"],
  [".sl",       "sapling"]
]
```

### What It Does NOT Do

The implementation is intentionally minimal:
- Does not run any `p4` commands itself
- Does not auto-checkout files (tells the **model** to run `p4 edit`, not the harness)
- Does not replace git functionality (git status/diff still run if `.git` exists alongside `.p4config`)
- Does not modify Bash tool behavior
- Does not provide Perforce-specific diff or status views

It's a **guard + prompt** approach: prevent accidental writes to locked files, and teach the model
the correct Perforce workflow.

### Why This Matters

Many enterprise codebases use Perforce (game studios, large monorepos, binary-heavy projects).
Without this mode, Claude Code would attempt to write files and get `EACCES` errors, then
potentially try `chmod` to "fix" the permission -- which bypasses Perforce tracking entirely.
The error message explicitly warns against this because `chmod +w` would make the file writable
locally but Perforce wouldn't know it was modified, leading to lost changes on the next `p4 sync`.

### Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `zA6()` | Returns `true` if `CLAUDE_CODE_PERFORCE_MODE` is truthy |
| `dXH(mode)` | Returns `true` if Perforce mode on AND file lacks owner-write bit |
| `UXH` | Error message string for read-only file denial |
| `WvK` | VCS detection marker array (includes `.p4config` -> `"perforce"`) |

---

## Script Caps (`CLAUDE_CODE_SCRIPT_CAPS`)

### What It Is

Introduced in **v2.1.98**. A **per-command Bash call-count limiter** -- an anti-exfiltration
security mechanism for scripted/subprocess environments with potentially untrusted input.

### When It's Active

Only in "script mode" -- when `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is truthy. This is the same
mode that scrubs sensitive env vars from subprocesses and captures GitHub Actions paths.

### Format

JSON object mapping **command substrings** to **maximum allowed call counts**:

```bash
export CLAUDE_CODE_SCRIPT_CAPS='{"curl": 3, "wget": 2, "gh api": 5}'
```

Parsing (`Vtq`):
- Must be a valid JSON object (not array)
- Values must be finite numbers
- Keys must be non-empty strings (after trimming)
- Invalid entries are silently filtered out
- Parse failures result in `null` (caps disabled)

### How It Works

1. **Initialization** (`Tb6`): On startup in script mode, captures environment context and
   parses `CLAUDE_CODE_SCRIPT_CAPS` via `Vtq()`
2. **Before every Bash execution** (`Ob6`): The command text is parsed by `PhH()` (shell
   command parser), then each key in the caps object is searched for as a **substring**
3. **Counting**: Occurrences tallied cumulatively across the session in a `Map` (`qb6`).
   A single command containing the substring twice counts as 2
4. **Enforcement**: When cumulative count exceeds the cap, throws:

> Script call limit exceeded: \<cmd\> has been called N times (cap: K). This limit prevents
> data exfiltration via repeated write operations in untrusted-input workflows.

### Why It Exists

When Claude Code runs as a subprocess (CI/CD, GitHub Actions, automated pipelines), malicious
prompt injection could try to exfiltrate data by making many small network requests. Script caps
let the operator set hard limits. The substring matching is intentionally simple -- `"curl"`
matches `curl`, `curl -s`, and even `nocurl` (by design: coarse safety net, not precise allowlist).

### Relationship to Other Script-Mode Hardening

| Feature | Purpose |
|---------|---------|
| Env scrubbing (`Tp4`) | Strips `ANTHROPIC_API_KEY` and other sensitive vars from subprocess environments |
| Script caps (`Ob6`) | Limits how many times specific command patterns can run |
| GitHub paths capture (`Tb6`) | Saves `GITHUB_PATH`, `GITHUB_ENV`, `GITHUB_OUTPUT`, etc. for safe access |
| MCP allowlist (`$b6`) | Controls MCP server access in script mode |

### Key Identifiers

| Symbol | Purpose |
|--------|---------|
| `dJ()` | Returns `true` if script mode is active |
| `Tb6()` | Script-mode initialization |
| `Vtq()` | Parses `CLAUDE_CODE_SCRIPT_CAPS` JSON |
| `FqH` | Parsed caps object or `null` |
| `qb6` | Cumulative call counter (`Map<string, number>`) |
| `Ob6(cmd)` | Enforcement function -- called before each Bash execution |

---

# LESSON 64 -- V2.1.97--V2.1.100 COMMAND & ENV VAR CHANGES

## New Commands

### /setup-vertex (v2.1.98)

Reconfigure Google Vertex AI authentication, project, region, or model pins. Hidden unless
`CLAUDE_CODE_USE_VERTEX` is set:

```javascript
get isHidden() { return !pH(process.env.CLAUDE_CODE_USE_VERTEX) }
```

Companion to `/setup-bedrock` (added in v2.1.92, documented in L57). Both are provider-specific
configuration wizards that only appear when their respective provider env var is active.

## Removed Commands

### /buddy (removed in v2.1.97)

Was date-gated (April 2026+) in v2.1.96 with `isHidden` check. **Completely removed** in v2.1.97 --
not just the registration, but all buddy-specific code. Remaining "buddy" strings in v2.1.100 are
unrelated (`PlistBuddy` macOS utility, "onboarding buddy" in `/team-onboarding` prompt text).

See L56 in Chapter 9 for the original implementation details as they existed through v2.1.96.

## New Environment Variables

### ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES (v2.1.97)

Declares capabilities for a custom model set via `ANTHROPIC_CUSTOM_MODEL_OPTION`. When enterprise
users route through Bedrock, Foundry, Vertex, or Mantle with a non-standard model ID, Claude Code
can't determine what features the model supports. This env var bypasses the name-based guessing.

**Format:** Comma-separated, case-insensitive capability names:

```bash
export ANTHROPIC_CUSTOM_MODEL_OPTION="my-custom-claude-4"
export ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES="thinking,effort,interleaved_thinking"
```

**Model configuration array** (`BG4`): In v2.1.96 this was `XR4` with 3 entries. In v2.1.97 it
became `BG4` with a 4th entry for custom models:

```javascript
BG4 = [
  { modelEnvVar: "ANTHROPIC_DEFAULT_OPUS_MODEL",
    capabilitiesEnvVar: "ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES" },
  { modelEnvVar: "ANTHROPIC_DEFAULT_SONNET_MODEL",
    capabilitiesEnvVar: "ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES" },
  { modelEnvVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    capabilitiesEnvVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES" },
  { modelEnvVar: "ANTHROPIC_CUSTOM_MODEL_OPTION",
    capabilitiesEnvVar: "ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES" }
]
```

**Recognized capabilities** (5 strings checked via `Q8H` in the codebase):

| Capability | What it controls | Fallback heuristic |
|------------|-----------------|-------------------|
| `thinking` | Extended thinking support | `true` unless model name contains `"claude-3-"` |
| `interleaved_thinking` | Thinking interleaved with tool use | Varies by provider |
| `adaptive_thinking` | Adaptive thinking mode | `true` for `opus-4-6` / `sonnet-4-6` |
| `effort` | Reasoning effort level control | `true` for `opus-4-6` / `sonnet-4-6` |
| `max_effort` | Whether max effort level is available | `false` for haiku |

**Companion env vars** for custom models:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | The model ID itself |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_NAME` | Display name in model picker (fallback: model ID) |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION` | Description in model picker (fallback: "Custom model (<id>)") |

### CLAUDE_CODE_MAX_CONTEXT_TOKENS (v2.1.98)

Override the maximum context token window size. Two references in bundle. Allows operators to
artificially constrain the context window below the model's actual limit.

### CLAUDE_CODE_PERFORCE_MODE (v2.1.98)

Enable Perforce workspace mode. See Lesson 63 for full deep dive.

### CLAUDE_CODE_SCRIPT_CAPS (v2.1.98)

Per-command Bash call-count limiter for script mode. See Lesson 63 for full deep dive.

## Removed Environment Variables

| Variable | Removed in | Notes |
|----------|-----------|-------|
| `CLAUDE_CODE_REPL` | v2.1.97 | REPL mode flag |
| `CLAUDE_REPL_MODE` | v2.1.97 | Companion to `CLAUDE_CODE_REPL` |
| `CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT` | v2.1.97 | Hook additional context injection for save operations |

## Bundle Size Across Versions

| Version | Bundle size | Delta |
|---------|------------|-------|
| v2.1.96 | 88,270,886 bytes (86,207 KB) | -- |
| v2.1.97 | 88,391,364 bytes (+120 KB) | +0.14% |
| v2.1.98 | 89,120,955 bytes (+730 KB) | +0.83% |
| v2.1.100 | 89,117,501 bytes (-3 KB) | -0.004% |
