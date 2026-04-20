---

# Claude Code Source Deep Dive -- Complete Technical Extraction (10 Lessons)

---

## LESSON 03: THE SKILLS SYSTEM

### Core Concept
A skill is a named, reusable prompt workflow that Claude Code can discover and execute, stored as `SKILL.md` Markdown files with YAML frontmatter or bundled in the CLI binary.

### Skill Lifecycle (Six Stages)

**Discovery --> Load --> Parse --> Substitute --> Execute --> Inject**

**Discovery**
- Function: `getSkillDirCommands()` walks four locations in parallel
- Resolves symlinks via `realpath()` for deduplication
- Loads legacy `.claude/commands/` directories

**Load**
- Reads `skill-name/SKILL.md` files
- Listing budget computed in **characters**, not tokens (verified in v2.1.116 bundle: `X6_` in the skills module)
- Formula: `budget = ctxWindowTokens × 4 × skillListingBudgetFraction` (default fraction `0.01`); fallback `8000` if model context unknown; env override `SLASH_COMMAND_TOOL_CHAR_BUDGET`
- Per-skill description hard cap `skillListingMaxDescChars` (default `1536` chars), truncated with `…` before listing packing

**Parse**
- Frontmatter parsed into `Command` object
- Validates all fields (description, allowed tools, arguments, model override, hooks, paths, effort, shell)
- Skills with a non-empty `paths` field become **conditional skills** (stored in `Pf.conditionalSkills`, withheld from the listing until activated by a matching file edit/touch)
- Activation matcher uses the `ignore` npm package (gitignore-style), **not** glob matching
- `paths: **` (or any list that reduces to only `**`) is stripped at parse time → treated as unconditional

**Substitute** -- Argument substitution order:
1. Named args: `$foo`, `$bar` (mapped by position from `arguments` frontmatter)
2. Indexed args: `$ARGUMENTS[0]`, `$0`, `$1`
3. Full arg string: `$ARGUMENTS`
4. If no placeholder found and args exist: append as `ARGUMENTS: ...`
5. Shell injection: `` !`command` `` or ` ```! ` blocks (local skills only)
6. Special vars: `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}`

**Execute** -- Two modes via `context: fork` frontmatter:
- **Inline (default)**: Expanded prompt injected as user message in same context window
- **Forked**: Isolated sub-agent (`runAgent()`) with own token budget; parent receives final text output

**Inject**
- Skill tool returns `ToolResult`. Inline skills carry `allowedTools` and optional `model` override for subsequent tool calls. Forked skills display "Done" byline and feed sub-agent output back as context.

### Skill Sources & Priority

Priority hierarchy (first loaded wins):
1. **Managed/Policy** (`managed/.claude/skills/`) -- Enterprise-controlled, lockable via `CLAUDE_CODE_DISABLE_POLICY_SKILLS`
2. **User (Personal)** (`~/.claude/skills/`) -- Cross-project library, watched via chokidar
3. **Project** (`.claude/skills/`) -- Repository-scoped, walked up from project root
4. **Additional** (`--add-dir`) -- Per-session extra roots, each with `.claude/skills/`
5. **Legacy commands** (`.claude/commands/`) -- Tagged `loadedFrom: 'commands_DEPRECATED'`
6. **Bundled** -- Registered separately via `registerBundledSkill()`, merged into the same listing

Deduplication is by `realpath(SKILL.md)`, not by name. When two entries resolve to the same file, the second is **skipped** with log `"Skipping duplicate skill 'X' from Y (same file already loaded from Z)"`. Order in `QO8` loader is policy → user → project → additional → legacy, so higher-priority paths win. Bundled skills have distinct names and don't participate in realpath dedup.

### Listing Format Injected to the Model

When the Skill tool is available, a system-role message is injected with this verbatim header:

> *"The following skills are available for use with the Skill tool:"*

Each entry is rendered by `UP1`:
```
- ${name}: ${description} - ${whenToUse}
```
(description and whenToUse joined with ` - `, sharing one line and one budget). Name-only mode produces `- ${name}` with no description.

### Budget Algorithm (`kr6`)

Constants (from v2.1.116 bundle):
- `ZL9 = 0.01` -- `skillListingBudgetFraction` default
- `LL9 = 4` -- chars per token
- `BP1 = 8000` -- fallback budget when no context window known
- `gP1 = 1536` -- `skillListingMaxDescChars` default
- `Zr6 = 20` -- minimum per-skill allocation before global collapse

Algorithm:
1. Render every skill full (`- name: desc - when`), except those marked name-only by `E4H` (currently hardcoded `"on"` -- see "skillOverrides" below).
2. If total fits in budget → emit all full.
3. Otherwise: **bundled skills are protected** (kept full). Non-bundled become truncatable.
4. Compute `f = (remainingBudget - fixedCost) / truncatableCount` -- per-skill description budget.
5. If `f < 20` → **all truncatable skills collapse to `- ${name}`** (name-only mode, globally).
6. Otherwise → each description truncated to `f` characters via `t7(desc, f)`.

**Skills never disappear from the listing.** The failure mode when frontmatter bloats is silent global collapse to name-only -- every skill loses its description at once, and the model has nothing but names to choose from. One runaway `when_to_use` can trigger this for every skill in the listing.

Tunables (in settings):
- `skillListingBudgetFraction` -- fraction of context window for budget
- `skillListingMaxDescChars` -- per-skill pre-truncation cap

### SKILL.md Format & Frontmatter Reference

```yaml
---
name: "My Workflow"
description: "One-line summary"
when_to_use: "Use when X. Examples: ..."
allowed-tools:
  - Bash(gh:*)
  - Read
  - Write
argument-hint: "[branch] [message]"
arguments: branch message
context: fork
model: claude-opus-4-5
effort: high
version: "1.0.0"
user-invocable: true
paths: src/payments/**
hooks:
  PreToolUse:
    - matcher: ...
      agent: code
shell:
  interpreter: bash
---
```

### Field Reference Table

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Override directory-derived display name |
| `description` | string | One-line summary in skill listing |
| `when_to_use` | string | Detailed trigger instructions for Claude |
| `allowed-tools` | list | Tool permission patterns (narrowest: `Bash(gh:*)`) |
| `argument-hint` | string | Shown in CLI autocomplete |
| `arguments` | string/list | Named argument identifiers for `$name` substitution |
| `context` | `fork` | Runs as isolated sub-agent |
| `model` | string | Model alias or `inherit` |
| `effort` | low/medium/high/int | Thinking budget |
| `version` | string | Informational tag (no runtime effect) |
| `user-invocable` | bool | Default `true`; `false` **blocks user `/name` invocation** (model-only; also `isHidden: true`) |
| `paths` | list of gitignore-style patterns | Conditional activation; withheld until matching file edit/touch |
| `hooks` | object | Pre/post tool-use lifecycle hooks |
| `agent` | string | Agent type (e.g., `code`, `browser`) for forking |
| `shell` | object | Shell interpreter config for `!backtick` |
| `disable-model-invocation` | bool | **Blocks Skill-tool (model) invocation**; slash `/name` still works |

`user-invocable` and `disable-model-invocation` are symmetric opposites: one makes the skill model-only, the other makes it user-only.

### Advanced Patterns

**Conditional Skills (paths-based)**
- Stored at load in `Pf.conditionalSkills` (a Map), withheld from the listing
- Activation: `QIH(touchedPaths, root)` runs on file edits/touches; matches via the `ignore` npm package (gitignore syntax, not glob)
- Once activated, moved to `Pf.dynamicSkills` and added to `activatedConditionalSkillNames` for the rest of the session
- Pattern `**` (or any list reducing to just `**`) is stripped at parse → unconditional
- Telemetry: `tengu_dynamic_skills_changed` with `source: "conditional_paths"`
- Interacts with dynamic discovery: walking toward `cwd`, new `.claude/skills/` directories can be discovered; gitignored directories skipped

**Bundled Skills**
- Registered via `registerBundledSkill()`
- Use `BundledSkillDefinition` interface with `getPromptForCommand(args, context)` function instead of SKILL.md
- Well-known examples: `/simplify` (three parallel review agents), `/loop` (cron job), `/remember`, `/verify`, `/debug`, `/stuck`, `/skillify`
- Can include reference files via `files` property (extracted to nonce directory with `O_EXCL | O_NOFOLLOW | 0o600` flags to prevent symlink attacks)
- Conditional on feature flags: `feature('AGENT_TRIGGERS')`, `feature('KAIROS')`, `isKairosCronEnabled()`

Example registration:
```javascript
registerBundledSkill({
  name: 'simplify',
  description: 'Review changed code for reuse, quality, and efficiency.',
  userInvocable: true,
  async getPromptForCommand(args) {
    return [{ type: 'text', text: SIMPLIFY_PROMPT }]
  },
})
```

**MCP Skills**
- Detected by `loadedFrom === 'mcp'`
- Fetched via `fetchMcpSkillsForClient()` at connection time
- Parse skill frontmatter using same `parseSkillFrontmatterFields()` and `createSkillCommand()` as file-based skills
- Appear in SkillsMenu under "MCP skills" group
- Naming convention: `server-name:skill-name`

Key differences (verified in `dO8` / `createSkillCommand`):
- **Shell-processing pass skipped entirely**: the `on(E, ..., shell)` processor that expands `` !`cmd` `` and ``` ```! ``` blocks runs only when `loadedFrom !== "mcp"`. In MCP skills those blocks remain as **literal text** in the prompt -- not executed, not removed
- **`${CLAUDE_SKILL_DIR}` inert**: no `baseDir` is attached, so the token passes through unsubstituted
- **`${CLAUDE_SESSION_ID}` still works**: substitution happens before the MCP branch
- Registered separately in `AppState.mcp.commands`
- Merged via `getAllCommands()` at invocation time

Merge logic:
```javascript
const mcpSkills = context.getAppState().mcp.commands
  .filter(cmd => cmd.type === 'prompt' && cmd.loadedFrom === 'mcp')
const localCommands = await getCommands(getProjectRoot())
return uniqBy([...localCommands, ...mcpSkills], 'name')
```

### Permission & Auto-Allow Logic

Skill-tool `checkPermissions` waterfall (verified in `C5H` definition):
1. **Deny rules**: block if skill name matches an explicit deny rule or `prefix:*` pattern
2. **Allow rules**: proceed if an allow rule matches
3. **Safe-skill auto-allow**: `Y_5(skill)` returns true if every Command field outside the "safe" set is undefined/null/empty. Safe set (`z_5`):
   ```
   type, progressMessage, contentLength, argNames, model, effort, source, pluginInfo,
   disableNonInteractive, skillRoot, context, agent, getPromptForCommand, frontmatterKeys,
   createdBy, name, description, hasUserSpecifiedDescription, isEnabled, isHidden, aliases,
   isMcp, argumentHint, whenToUse, paths, version, disableModelInvocation, userInvocable,
   loadedFrom, immediate, userFacingName
   ```
   So `model`, `effort`, and `paths` are **safe** (no prompt). The fields that flip to "ask" are `allowedTools` (non-empty), `hooks` (non-empty), `shell`, and any other non-listed custom field
4. **Ask**: prompt user; suggestions include `addRules` for exact name and `name:*` prefix

Separate validation in `validateInput` (before `checkPermissions` runs):
- `disable-model-invocation: true` without a session `n47` override → rejected
- `E4H(skill) === "off"` or `"user-invocable-only"` → rejected (dead code; see "skillOverrides" below)

Slash-command invocation (`q_5`):
- `userInvocable === false` → user gets `"This skill can only be invoked by Claude, not directly by users."`

### Live Reloading
Watcher constants in `Bo5()`:
- `Io5 = 1000` ms -- chokidar `awaitWriteFinish.stabilityThreshold`
- `xo5 = 500` ms -- `pollInterval`
- `uo5 = 300` ms -- **reload debounce** on SKILL.md change (batches rapid edits)
- `mo5 = 2000` ms -- Bun stat-polling interval (avoids Bun `FSWatcher` deadlock)

On each batched change: fires `ConfigChange` hook (can block reload), clears memoization, re-emits skill list.

### skillOverrides Setting (UI-only in v2.1.116)

Settings schema defines:
```
skillOverrides: { [skillName]: "on" | "name-only" | "user-invocable-only" | "off" }
```
Effective-override lookup (`kS5`/`vS5`) feeds the `/skills` menu display, with precedence: policy → flag → author (`disableModelInvocation === true` implies `user-invocable-only`) → plugin source (implies `"on"`) → project settings → user settings.

**But runtime enforcement is stubbed.** The `E4H(skill)` function used by `kr6` (listing formatter), `fp5` (model-visibility filter), and `validateInput` is hardcoded `return "on"` in this build. So setting `skillOverrides.foo = "off"` today has no effect on the model listing or the Skill tool. The UI shows the override; the runtime ignores it.

Practical implication: to actually block a skill today, use the frontmatter fields `disable-model-invocation: true` or `user-invocable: false`, which are checked directly and do work.

### progressMessage (plumbed but unrendered in v2.1.116)

Every command-like object carries a `progressMessage` field: a short human label intended to appear in the spinner row while the command/skill executes (e.g. `"creating commit"`, `"analyzing your codebase"`).

**Defaults set at construction:**
- User slash commands (`.claude/commands/*.md`): `"running"`
- Skills (`$.isSkillMode`): `"loading"`
- MCP prompts (`<server>:<prompt>`): `"running"`
- Bundled plugin skills: `"loading"` when `isSkillMode`, else `"running"`

**Built-in overrides (hardcoded in the bundle):**

| Command | progressMessage |
|---|---|
| `/commit` | `creating commit` |
| `/commit-push-pr` | `creating commit and PR` |
| `/init` | `analyzing your codebase` |
| `/init-verifiers` | `analyzing your project and creating verifier skills` |
| `/statusline` | `setting up statusLine` |
| `/security-review` | `analyzing code changes for security risks` |
| `/team-onboarding` | `scanning usage data` |
| `/insights` | `analyzing your sessions` |

**The dead-code catch.** Only two read sites exist in the 92 MB v2.1.116 bundle, both feeding the rendering helper `c47` (exported as `formatSkillLoadingMetadata`):

1. `K_5(cmd)` — user-typed slash path: `c47(cmd.name, cmd.progressMessage)` when `loadedFrom ∈ {skills, plugin, mcp}`.
2. Agent preloaded-skills path: `EH(skillName, skill.progressMessage)` where `EH === c47`.

`c47` signature and body:

```js
function c47(H, _ = "loading") {   // `_` is the progressMessage
  return [
    `<command-message>${H}</command-message>`,
    `<command-name>${H}</command-name>`,
    "<skill-format>true</skill-format>"
  ].join("\n")
}
```

The second argument is accepted and defaulted but **never referenced in the output**. The field is plumbed end-to-end — declared, defaulted, hardcoded on builtins, passed to the render function — and then dropped at the leaf. Users see the `<command-name>/<command-message>` XML but not the progress label.

**Not a frontmatter field.** Searching the bundle for `progress-message` / any frontmatter parser path that writes `progressMessage` returns zero matches. Skill and command authors cannot set it from YAML today; only bundled builtins supply custom values.

**Safe-properties listing.** `progressMessage` is included in `z_5` (the auto-allow safe set), so if a parse path is ever added, customizing it won't trigger a permission prompt.

**Distinct from tool-use progress.** The other 40 `progressMessage` occurrences in the bundle belong to the tool-use progress stream (`progressMessagesByToolUseID`, `progressMessagesForMessage`, `bash_progress`, `mcp_progress`, `repl_tool_call`). That's a different field on a different shape and is actively rendered (e.g. the "Running…" spinner over streaming bash output).

**Likely history.** The builtin-specific strings (`"creating commit"` etc.) and the defaulted `_="loading"` parameter both read as a UI that used to render the message and was refactored without removing the field. A future build may re-wire `c47` to emit a `<progress-message>` element (or similar) — at which point the existing infrastructure would light up without touching command definitions.

### Legacy Support
`.claude/commands/` directory still supported with `loadedFrom: 'commands_DEPRECATED'`. Accepts both single `.md` files and `skill-name/SKILL.md` directory format. New work uses `.claude/skills/`.

---

## LESSON 05: THE AGENT SYSTEM

### Architecture Overview
The Agent System enables Claude instances to delegate work to child Claude instances through **AgentTool** (wire name: `Agent`), creating multi-level hierarchies at runtime. The legacy name is `Task` with both registered via aliases for backward compatibility.

### Three Agent Type Definitions

**BuiltInAgentDefinition**
```typescript
export type BuiltInAgentDefinition = BaseAgentDefinition & {
  source: 'built-in'
  baseDir: 'built-in'
  getSystemPrompt: (params: { toolUseContext: Pick<ToolUseContext, 'options'> }) => string
}
```
Dynamic system prompts; cannot be overridden but managed (policy) agents can shadow by `agentType` name.

**CustomAgentDefinition**
```typescript
export type CustomAgentDefinition = BaseAgentDefinition & {
  getSystemPrompt: () => string
  source: SettingSource
  filename?: string
  baseDir?: string
}
```
Loaded from `.claude/agents/*.md` or JSON in `settings.json`.

**PluginAgentDefinition**
```typescript
export type PluginAgentDefinition = BaseAgentDefinition & {
  getSystemPrompt: () => string
  source: 'plugin'
  plugin: string
}
```
Bundled with plugins; treated as admin-trusted for MCP server policy.

**Priority Order**: built-in --> plugin --> userSettings --> projectSettings --> flagSettings --> policySettings (later groups overwriting earlier ones).

### Built-In Agent Types

| Agent | Model | Tools | Mode |
|-------|-------|-------|------|
| general-purpose | default subagent | `['*']` | sync/async |
| Explore | haiku/inherit | read-only (no Edit/Write) | sync |
| Plan | inherit | same disallowed as Explore | sync |
| verification | inherit | no Edit/Write | background: true (async) |
| fork | inherit | `['*']` with useExactTools | experimental |
| statusline-setup | default | limited shell | sync |

### Sync vs Async Lifecycle

The `shouldRunAsync` boolean forces async if:
- `run_in_background === true`
- `selectedAgent.background === true`
- `isCoordinator`
- `forceAsync` (fork experiment)
- `assistantForceAsync` (KAIROS mode)
- `proactiveModule?.isProactiveActive()`

**Synchronous Path**:
1. Build system prompt via `getSystemPrompt()` + `enhanceSystemPromptWithEnvDetails()`
2. Create git worktree if `isolation === 'worktree'` (slug: `agent-{earlyAgentId.slice(0,8)}`)
3. `await runAgent(params)` -- parent blocked
4. Return `status: 'completed'` with agent's final text

**Asynchronous Path**:
1. `registerAsyncAgent()` creates `agentBackgroundTask` with own `AbortController`
2. Returns `status: 'async_launched'` with `agentId`, `outputFile`, `canReadOutputFile`
3. `void runAsyncAgentLifecycle(...)` detached; wrapped in `runWithAgentContext()`
4. `enqueueAgentNotification()` on completion via `<task-notification>`

Constraint: In-process teammates cannot launch background agents -- throws if `isInProcessTeammate()` and `run_in_background === true`.

### Fork Path (Experimental)

Triggered when `subagent_type` omitted and `FORK_SUBAGENT` feature gate enabled.

**buildForkedMessages() Algorithm**:
1. Clone parent's full assistant message (all tool_use blocks, thinking, text)
2. Build `tool_result` blocks with identical placeholder: `"Fork started -- processing in background"`
3. Append per-child directive (only differing part)

Result: `[...history, assistant(all_tool_uses), user(placeholder_results..., directive)]`

**Fork Child Boilerplate**:
```typescript
export function buildChildMessage(directive: string): string {
  return `<fork-boilerplate>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. Your system prompt says "default to forking." IGNORE IT
2. Do NOT converse, ask questions, or suggest next steps
3. USE your tools directly: Bash, Read, Write, etc.
4. If you modify files, commit before reporting
5. Response MUST begin with "Scope:". No preamble.

Output format:
  Scope: <echo assignment in one sentence>
  Result: <answer or key findings>
  Key files: <relevant paths>
  Files changed: <list with commit hash>
  Issues: <list if present>
</fork-boilerplate>

FORK_DIRECTIVE: ${directive}`
}
```

**Fork Recursive Guard** -- Two signals prevent infinite recursion:
- `toolUseContext.options.querySource === 'agent:builtin:fork'`
- `isInForkChild(messages)` scans for `<fork-boilerplate>` tag

### Worktree Isolation

```typescript
const earlyAgentId = createAgentId()
let worktreeInfo: { worktreePath: string; worktreeBranch?: string; headCommit?: string } | null = null
if (effectiveIsolation === 'worktree') {
  const slug = `agent-${earlyAgentId.slice(0, 8)}`
  worktreeInfo = await createAgentWorktree(slug)
}

const cleanupWorktreeIfNeeded = async () => {
  if (!worktreeInfo) return {}
  const { worktreePath, worktreeBranch, headCommit } = worktreeInfo
  worktreeInfo = null
  if (headCommit) {
    const changed = await hasWorktreeChanges(worktreePath, headCommit)
    if (!changed) {
      await removeAgentWorktree(worktreePath, worktreeBranch, gitRoot)
      return {}
    }
  }
  return { worktreePath, worktreeBranch }
}
```

Smart cleanup: if the agent made no git-tracked changes, the worktree is deleted automatically. If it did make changes, the branch is kept.

### SendMessageTool & Swarm Protocol

Enabled when `isAgentSwarmsEnabled()` returns true.

**Message Routing**:

| To | Type | Result |
|----|------|--------|
| teammate-name | string | Written to mailbox; auto-resumed if stopped |
| "*" | string | Broadcast to all except sender |
| any name | shutdown_request | Structured shutdown; recipient approves/rejects |
| "team-lead" | shutdown_response | Approve triggers `gracefulShutdown(0)` |
| any name | plan_approval_response | Team-lead approves/rejects plans |
| "uds:\<path\>" | string | Unix domain socket to local peer |
| "bridge:\<session-id\>" | string only | Remote control via Anthropic servers |

**Spawn Teammate Command**:
```typescript
const teammateArgs = [
  `--agent-id ${quote([teammateId])}`,
  `--agent-name ${quote([sanitizedName])}`,
  `--team-name ${quote([teamName])}`,
  `--agent-color ${quote([teammateColor])}`,
  `--parent-session-id ${quote([getSessionId()])}`,
  plan_mode_required ? '--plan-mode-required' : '',
  agent_type ? `--agent-type ${quote([agent_type])}` : '',
].filter(Boolean).join(' ')

const inheritedFlags = buildInheritedCliFlags({ planModeRequired, permissionMode })
const spawnCommand = `cd ${quote([workingDir])} && env ${envStr} ${quote([binaryPath])} ${teammateArgs}${flagsStr}`
await sendCommandToPane(paneId, spawnCommand, !insideTmux)
```

### Agent Frontmatter Schema

| Field | Type | Effect |
|-------|------|--------|
| name | string (required) | Unique identifier; used as `subagent_type` |
| description | string (required) | "When to use" guidance shown to parent LLM |
| model | sonnet\|opus\|haiku\|inherit\|\<id\> | inherit = parent's model at runtime |
| tools | string[] | Allow-list; `['*']` all tools; omit = inherit default |
| disallowedTools | string[] | Subtract from pool after allow-list |
| permissionMode | default\|acceptEdits\|bypassPermissions\|auto\|plan\|bubble | Overrides parent mode |
| maxTurns | positive int | Hard cap before agent stops |
| background | boolean | Always async regardless of param |
| isolation | worktree \| remote (ant-only) | Git worktree isolation per spawn |
| memory | user\|project\|local | Persistent across sessions |
| mcpServers | string[] \| object[] | Additive MCP servers |
| hooks | HooksSettings | Session-scoped; registered only while running |
| skills | string[] | Slash commands preloaded |
| initialPrompt | string | Prepended to first user turn |
| effort | low\|normal\|high \| int | Extended thinking budget |
| requiredMcpServers | string[] | Agent hidden if not authenticated |

### Custom Agent Markdown Format

```markdown
---
name: my-agent
description: A focused TypeScript refactoring specialist.
model: sonnet
tools:
  - Read
  - Edit
  - Bash
  - Grep
  - Glob
permissionMode: acceptEdits
maxTurns: 50
memory: project
isolation: worktree
---

You are a TypeScript refactoring specialist. Your job is to improve
type safety and reduce any-casts in the provided code.

Rules:
- Only touch files explicitly requested
- Run tsc --noEmit before and after
- Commit with clear message before reporting
```

### Explore Agent Implementation

```typescript
export const EXPLORE_AGENT: BuiltInAgentDefinition = {
  agentType: 'Explore',
  model: process.env.USER_TYPE === 'ant' ? 'inherit' : 'haiku',
  disallowedTools: [
    AGENT_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  omitClaudeMd: true,
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () => getExploreSystemPrompt(),
}
```

Saves ~5-15 Gtok/week via `omitClaudeMd: true`.

### Type Guards

```typescript
export function isBuiltInAgent(agent: AgentDefinition): agent is BuiltInAgentDefinition {
  return agent.source === 'built-in'
}
export function isCustomAgent(agent: AgentDefinition): agent is CustomAgentDefinition {
  return agent.source !== 'built-in' && agent.source !== 'plugin'
}
export function isPluginAgent(agent: AgentDefinition): agent is PluginAgentDefinition {
  return agent.source === 'plugin'
}
```

### Key Design Patterns
1. **Discriminated Union**: `AgentDefinition` uses `source` field to narrow types
2. **Feature Gates**: Fork path gated by `FORK_SUBAGENT`
3. **Async Isolation**: Background agents get independent `AbortController`
4. **Prompt Cache Optimization**: Fork uses byte-identical placeholders for N parallel children
5. **Smart Cleanup**: Worktree deleted if zero git-tracked changes detected

---

## LESSON 21: COORDINATOR MODE

### Architecture Overview
Coordinator mode is a first-class operating mode in Claude Code where Claude acts exclusively as a dispatcher -- it never runs tools itself.

**Activation**: Single environment variable `CLAUDE_CODE_COORDINATOR_MODE=1`. The function `isCoordinatorMode()` reads this at runtime with no caching.

### Tool Restrictions

Coordinator Allowed Tools (from `constants/tools.ts`):
```
COORDINATOR_MODE_ALLOWED_TOOLS = new Set([
  AGENT_TOOL_NAME,              // 'Agent'
  TASK_STOP_TOOL_NAME,          // 'TaskStop'
  SEND_MESSAGE_TOOL_NAME,       // 'SendMessage'
  SYNTHETIC_OUTPUT_TOOL_NAME,   // internal output tool
])
```

Workers receive full `ASYNC_AGENT_ALLOWED_TOOLS` access (Bash, Read, Edit, Glob, Grep, WebSearch, Skill, Notebook, Worktree, plus MCP tools).

### Core Functions

**isCoordinatorMode()**:
```typescript
export function isCoordinatorMode(): boolean {
  if (feature('COORDINATOR_MODE')) {
    return isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE)
  }
  return false
}
```

**matchSessionMode()** -- mutates `process.env` directly; no caching means changes take effect immediately:
```typescript
export function matchSessionMode(
  sessionMode: 'coordinator' | 'normal' | undefined,
): string | undefined {
  if (!sessionMode) return undefined
  const currentIsCoordinator = isCoordinatorMode()
  const sessionIsCoordinator  = sessionMode === 'coordinator'
  if (currentIsCoordinator === sessionIsCoordinator) return undefined
  if (sessionIsCoordinator) {
    process.env.CLAUDE_CODE_COORDINATOR_MODE = '1'
  } else {
    delete process.env.CLAUDE_CODE_COORDINATOR_MODE
  }
  logEvent('tengu_coordinator_mode_switched', { to: sessionMode })
  return sessionIsCoordinator
    ? 'Entered coordinator mode to match resumed session.'
    : 'Exited coordinator mode to match resumed session.'
}
```

**getCoordinatorUserContext()** -- builds worker tool list dynamically:
```typescript
const INTERNAL_WORKER_TOOLS = new Set([
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
])

export function getCoordinatorUserContext(
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
): { [k: string]: string } {
  if (!isCoordinatorMode()) return {}
  const workerTools = isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)
    ? [BASH_TOOL_NAME, FILE_READ_TOOL_NAME, FILE_EDIT_TOOL_NAME].sort().join(', ')
    : Array.from(ASYNC_AGENT_ALLOWED_TOOLS)
        .filter(name => !INTERNAL_WORKER_TOOLS.has(name))
        .sort()
        .join(', ')
  let content = `Workers spawned via the Agent tool have access to these tools: ${workerTools}`
  if (mcpClients.length > 0) {
    const serverNames = mcpClients.map(c => c.name).join(', ')
    content += `\n\nWorkers also have access to MCP tools from connected MCP servers: ${serverNames}`
  }
  if (scratchpadDir && isScratchpadGateEnabled()) {
    content += `\n\nScratchpad directory: ${scratchpadDir}\nWorkers can read and write here without permission prompts.`
  }
  return { workerToolsContext: content }
}
```

### Task Notification Format

```xml
<task-notification>
  <task-id>agent-a1b</task-id>
  <status>completed</status>  <!-- completed | failed | killed -->
  <summary>Agent "Investigate auth bug" completed</summary>
  <result>Found null pointer in src/auth/validate.ts:42...</result>
  <usage>
    <total_tokens>4820</total_tokens>
    <tool_uses>11</tool_uses>
    <duration_ms>18432</duration_ms>
  </usage>
</task-notification>
```

### Four-Phase Workflow

| Phase | Who | Purpose |
|-------|-----|---------|
| Research | Workers (parallel) | Investigate codebase, find files, understand problem |
| Synthesis | **Coordinator** | Read findings, craft specific implementation specs with file paths and line numbers |
| Implementation | Workers | Make targeted changes per spec, run tests, commit |
| Verification | Workers | Prove the code works independently |

### Parallelism Rules
- **Read-only tasks (research)**: Run multiple concurrently; multiple `Agent` calls in single coordinator turn
- **Write-heavy tasks (implementation)**: One at a time per overlapping file set
- **Verification**: Can run alongside implementation on different file areas

### Continue vs. Spawn Fresh Decision Matrix

| Situation | Action | Why |
|-----------|--------|-----|
| Research explored exactly the files that need editing | Continue | Worker has files in context AND gets clear plan |
| Research was broad but implementation is narrow | Spawn fresh | Avoid exploration noise in focused implementation |
| Correcting failure or extending recent work | Continue | Worker has error context |
| Verifying code a different worker wrote | Spawn fresh | Verifier should see code with fresh eyes |
| First attempt used entirely wrong approach | Spawn fresh | Wrong-approach context pollutes retry |
| Unrelated task | Spawn fresh | No useful context to reuse |

### Mode Comparison Table

| Dimension | Single-Agent | Coordinator |
|-----------|--------------|-------------|
| Role | Does the work itself | Dispatches and synthesizes; never executes |
| Tool count | Full tool set | 4 tools only: Agent, SendMessage, TaskStop, SyntheticOutput |
| Filesystem access | Direct read/write | None -- must delegate to workers |
| System prompt | Standard Claude Code prompt | `getCoordinatorSystemPrompt()` |
| Worker context | Not injected | `getCoordinatorUserContext()` injects tool list + MCP servers + scratchpad |
| Parallelism | Sequential tool calls | Multiple concurrent workers via parallel `Agent` calls |
| Session resume | Mode irrelevant | `matchSessionMode()` flips env var to restore correct mode |
| Simple mode variant | N/A | `CLAUDE_CODE_SIMPLE=1` limits workers to Bash + Read + Edit only |
| Scratchpad | N/A | Shared directory injected into worker context |

### Scratchpad Implementation
- Feature Gate: `tengu_scratch` must be active
- Circular dependency note: scratchpad gate check is duplicated in `coordinatorMode.ts` as local `isScratchpadGateEnabled()` instead of importing from `utils/permissions/filesystem.ts` to avoid circular dependency chain
- Workers can write findings, partial results, or structured data for later workers to read without permission prompts

### Feature Gates
- `COORDINATOR_MODE`: Controls whether coordinator mode can activate
- `CLAUDE_CODE_SIMPLE`: Strips workers to Bash, Read, Edit only
- `tengu_scratch`: Enables scratchpad directory injection

### Critical Design Constraint
"Never write 'based on your findings.' This phrase delegates understanding to the worker instead of the coordinator doing its job." The synthesis phase is the coordinator's most critical responsibility -- must transform findings into specific file paths and line numbers before re-delegating.

---

## LESSON 22: TEAMS & SWARM

### Core Architecture
A swarm is a named team of Claude agents sharing a config file, task list, and file-based mailbox. One agent acts as **team lead** (creates team, spawns teammates, assigns tasks, manages shutdown). All others are **teammates**.

Feature activation: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Two primary tools: `TeamCreate` and `TeamDelete`.

### TeamCreate Workflow (Five Steps)

1. **Uniqueness Check**: Calls `readTeamFile(team_name)`. If name exists, `generateWordSlug()` substitutes random name
2. **Write Team Config**: Writes `TeamFile` JSON to `~/.claude/teams/<sanitized-name>/config.json`. Seeds members array with lead's entry (`name: "team-lead"`)
3. **Create Task List**: Calls `resetTaskList()` and `ensureTasksDir()` so task numbering starts at 1. Calls `setLeaderTeamName()` for correct task directory routing
4. **Update AppState**: Sets `appState.teamContext` with team name, file path, lead agent ID, and initial teammates map
5. **Register Cleanup**: Adds team to `registerTeamForSessionCleanup()` Set

### TeamCreate Source Code

```typescript
async call(input, context) {
  const { setAppState, getAppState } = context
  const appState = getAppState()
  const existingTeam = appState.teamContext?.teamName
  if (existingTeam) {
    throw new Error(`Already leading team "${existingTeam}". Use TeamDelete first.`)
  }
  const finalTeamName = generateUniqueTeamName(team_name)
  const leadAgentId   = formatAgentId(TEAM_LEAD_NAME, finalTeamName)
  const teamFile: TeamFile = {
    name: finalTeamName,
    createdAt: Date.now(),
    leadAgentId,
    leadSessionId: getSessionId(),
    members: [{
      agentId:      leadAgentId,
      name:         TEAM_LEAD_NAME,
      agentType:    leadAgentType,
      model:        leadModel,
      joinedAt:     Date.now(),
      tmuxPaneId:   '',
      cwd:          getCwd(),
      subscriptions: [],
    }],
  }
  await writeTeamFileAsync(finalTeamName, teamFile)
  registerTeamForSessionCleanup(finalTeamName)
  await resetTaskList(taskListId)
  await ensureTasksDir(taskListId)
  setLeaderTeamName(sanitizeName(finalTeamName))
  setAppState(prev => ({
    ...prev,
    teamContext: {
      teamName: finalTeamName, teamFilePath, leadAgentId,
      teammates: { [leadAgentId]: { name: TEAM_LEAD_NAME, color: assignTeammateColor(leadAgentId), spawnedAt: Date.now() } }
    }
  }))
}
```

### File Structure

```
~/.claude/
  teams/
    my-team/
      config.json             # TeamFile (members, permissions)
      permissions/
        pending/              # perm requests from workers
        resolved/             # approved / rejected responses
  tasks/
    my-team/
      0001.json
      0002.json
```

### TeamFile Type Definition

```typescript
type TeamFile = {
  name:            string
  description?:    string
  createdAt:       number           // epoch ms
  leadAgentId:     string           // "team-lead@my-team"
  leadSessionId?:  string
  hiddenPaneIds?:  string[]
  teamAllowedPaths?: TeamAllowedPath[]
  members: Array<{
    agentId:        string          // "researcher@my-team"
    name:           string
    agentType?:     string
    model?:         string
    prompt?:        string
    color?:         string
    planModeRequired?: boolean
    joinedAt:       number
    tmuxPaneId:     string
    cwd:            string
    worktreePath?:  string
    sessionId?:     string
    subscriptions:  string[]
    backendType?:   'tmux' | 'iterm2' | 'in-process'
    isActive?:      boolean
    mode?:          PermissionMode
  }>
}
```

Agent ID Format: Pattern `agentName@teamName` (e.g., `researcher@my-team`).

### Three Spawn Backends

| Backend | Selection Criteria | Kill Method |
|---------|-------------------|-------------|
| tmux | Inside tmux session (highest priority) OR tmux available as fallback | `kill-pane -t <paneId>` |
| iterm2 | In iTerm2 with `it2` CLI available; user hasn't chosen tmux preference | `it2 session close -f -s <id>` |
| in-process | Non-interactive (`-p` flag), explicit `--teammate-mode in-process`, or no pane backend available | Abort via AbortController |

**Backend Detection Algorithm**:
```typescript
// 1. Running INSIDE tmux? Always use tmux.
if (await isInsideTmux()) {
  return { backend: createTmuxBackend(), isNative: true }
}
// 2. In iTerm2 with it2 CLI? Use iTerm2 (unless user prefers tmux).
if (isInITerm2()) {
  if (!getPreferTmuxOverIterm2()) {
    const it2Available = await isIt2CliAvailable()
    if (it2Available) {
      return { backend: createITermBackend(), isNative: true }
    }
  }
  if (await isTmuxAvailable()) {
    return { backend: createTmuxBackend(), isNative: false, needsIt2Setup: true }
  }
}
// 3. Standalone terminal with tmux installed
if (await isTmuxAvailable()) {
  return { backend: createTmuxBackend(), isNative: false }
}
// 4. Nothing available
throw new Error(getTmuxInstallInstructions())
```

Detection uses environment variables captured at module load time (`TMUX`, `TMUX_PANE`, `TERM_PROGRAM`, `ITERM_SESSION_ID`). Shell overwriting them has no effect.

**tmux Socket**: `getSwarmSocketName()` returns `claude-swarm-${process.pid}`.

**Pane Creation Serialization**: Promise-based mutex via `acquirePaneCreationLock()` prevents race conditions. After each pane creation, backend sleeps 200 ms for shell initialization.

### iTerm2 Dead-Session Recovery

Module-level array tracks pane session UUIDs. When a user closes a pane manually, next spawn retries:
```typescript
while (true) {
  const splitResult = await runIt2(splitArgs)
  if (splitResult.code !== 0 && targetedTeammateId) {
    const listResult = await runIt2(['session', 'list'])
    if (!listResult.stdout.includes(targetedTeammateId)) {
      teammateSessionIds.splice(idx, 1)   // prune dead session
      continue                               // retry with next-to-last
    }
    throw new Error(...)
  }
  break
}
```

### In-Process Backend

Runs inside leader's Node.js process. Shares API client and MCP connections but gets fully isolated identity context via `AsyncLocalStorage`.

```typescript
const abortController = createAbortController()
// Strip parent messages -- teammates start with an empty conversation
toolUseContext: { ...this.context, messages: [] }
```

### CLI Flags and Environment Variables

**Flags always forwarded** (if applicable): `--dangerously-skip-permissions`, `--permission-mode acceptEdits`, `--model`, `--settings`, `--plugin-dir`, `--teammate-mode`, `--chrome / --no-chrome`

**Environment variables always set**: `CLAUDECODE=1`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `CLAUDE_CODE_AGENT_COLOR=<color>`

**Plan Mode Safety**: If `planModeRequired=true`, bypass-permissions flags are NOT propagated.

### Mailbox Messaging

File-based mailbox at `~/.claude/teams/<team>/inbox/<agent-name>/`. Leader polls inboxes; messages delivered as synthetic user turns.

**Message Types**:

| Type | Direction | Purpose |
|------|-----------|---------|
| plain text | any --> any | Task updates, questions, results |
| shutdown_request | lead --> teammate | Graceful shutdown signal |
| idle notification | teammate --> lead | System-generated after every turn end |
| permission_request | worker --> lead | Worker needs UI approval |
| permission_response | lead --> worker | Approval/denial |
| mode_set_request | lead --> teammate | Change teammate's permission mode |
| sandbox_permission_request | worker --> lead | Network access approval |

### Permission Sync -- SwarmPermissionRequest Schema

```typescript
type SwarmPermissionRequest = {
  id:                  string          // "perm-<ts>-<random>"
  workerId:            string
  workerName:          string
  workerColor?:        string
  teamName:            string
  toolName:            string
  toolUseId:           string
  description:         string
  input:               Record<string, unknown>
  permissionSuggestions: unknown[]
  status:              'pending' | 'approved' | 'rejected'
  resolvedBy?:         'worker' | 'leader'
  resolvedAt?:         number
  feedback?:           string
  updatedInput?:       Record<string, unknown>
  permissionUpdates?:  unknown[]
  createdAt:           number
}
```

Locking uses `.lock` file with `proper-lockfile` semantics.

### Leader Permission Bridge (In-Process Only)

```typescript
let registeredSetter: SetToolUseConfirmQueueFn | null = null
export function registerLeaderToolUseConfirmQueue(setter): void {
  registeredSetter = setter
}
export function getLeaderToolUseConfirmQueue() {
  return registeredSetter
}
```

### Full Lifecycle

**Phase 1 -- Setup**: Lead calls `TeamCreate`, creates tasks with `TaskCreate`, spawns teammates with `Agent` tool.

**Phase 2 -- Parallel Work**: Teammates claim unassigned tasks, work, send progress via `SendMessage`. After each turn, idle notification sent automatically.

**Phase 3 -- Shutdown**: Lead sends `shutdown_request` to each teammate, teammate approves and exits, sets `isActive: false`. Lead waits until no active non-lead members, then calls `TeamDelete`.

**Phase 4 -- Cleanup Guard**: If session ends without `TeamDelete`, shutdown hook calls `cleanupSessionTeams()`. Panes killed, directories removed.

### TeamDelete Tool

Takes no input. Refuses to run if any member has `isActive !== false`, forcing graceful shutdown first. `cleanupTeamDirectories()` collects `worktreePath` entries, destroys each git worktree with `git worktree remove --force` (falls back to `rm -rf`).

### UI Components

**TeamStatus (Footer Badge)**: Reads `appState.teamContext.teammates`, counts non-lead members, renders pill. Returns null when zero teammates.

**TeamsDialog (Interactive Panel)**: Two-level navigation (list view / detail view). Refreshes on 1-second interval. Mode cycling uses `setMultipleMemberModes()` for atomic multi-write.

```typescript
setMultipleMemberModes(teamName, [
  { memberName: 'researcher', mode: 'acceptEdits' },
  { memberName: 'tester',     mode: 'acceptEdits' },
])
```

---

## LESSON 08: MEMORY SYSTEM

### Three Memory Layers

**Layer 1: Auto Memory** -- Persistent facts surviving across all future sessions at `~/.claude/projects/<slug>/memory/`

**Layer 2: Session Memory** -- In-session notes updated in background as context grows at `~/.claude/session-memory/<uuid>.md`

**Layer 3: Team Memory** -- Shared memories synced to server API, scoped to GitHub repo via `memory/team/ <-> /api/claude_code/team_memory`

### Auto Memory -- MEMORY.md Index File

Capped at 200 lines / 25,000 bytes. Lines beyond silently truncated with warning. Functions as pointer manifest rather than content storage.

```
- [User Role](user_role.md) -- Senior engineer, Go expert
- [Feedback -- No mock DB](feedback_no_mock_db.md) -- Always hit real DB
```

### Topic File Format

```yaml
---
name: Feedback -- No Mock Database
description: Integration tests must hit a real database, never mocks
type: feedback
---
```

The description field is the text the selector model sees when deciding which files to load.

### Type Taxonomy (Closed to Four)

- **user** -- Always private. Role, goals, expertise level
- **feedback** -- Default private, team only for project-wide conventions. Corrections AND confirmations
- **project** -- Bias toward team. Ongoing work, goals, initiatives, incidents -- NOT derivable from code/git
- **reference** -- Usually team. Pointers to external systems

### Excluded Content Categories

- Code patterns, conventions, architecture, file paths
- Git history and recent changes
- Debugging solutions or fix recipes
- Ephemeral task details
- Anything in CLAUDE.md files

These exclusions apply EVEN when the user explicitly asks to save.

### Path Resolution & Security

```typescript
export const getAutoMemPath = memoize((): string => {
  const override = getAutoMemPathOverride() ?? getAutoMemPathSetting()
  if (override) return override
  const projectsDir = join(getMemoryBaseDir(), 'projects')
  return join(projectsDir, sanitizePath(getAutoMemBase()), 'memory') + sep
}, () => getProjectRoot())
```

Worktrees of the same repo share a single memory directory through `findCanonicalGitRoot()`.

### Extraction Pipeline

1. Query ends (main agent stops tool calls)
2. Gate check (feature flag + cursor delta)
3. Scan memdir (frontmatter headers only)
4. Fork agent (perfect clone, shared cache)
5. Write + notify (max 5 turns, then cursor advance)

### Mutual Exclusion Logic

```typescript
function hasMemoryWritesSince(
  messages: Message[],
  sinceUuid: string | undefined,
): boolean {
  for (const message of messages) {
    const filePath = getWrittenFilePath(block)
    if (filePath !== undefined && isAutoMemPath(filePath)) {
      return true
    }
  }
  return false
}
```

### Selector Model for Relevance

Sonnet call loads up to 5 relevant files from frontmatter. Scan reads only first 30 lines of each file (frontmatter range), not full body.

### Staleness Detection

```typescript
export function memoryFreshnessText(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs)
  if (d <= 1) return ''
  return (
    `This memory is ${d} days old. Memories are point-in-time ` +
    `observations, not live state -- claims about code behavior may ` +
    `be outdated. Verify against current code before asserting as fact.`
  )
}
```

### Session Memory

**Template Sections**: Session Title, Current State, Task specification, Files and Functions, Workflow, Errors & Corrections, Codebase and System Documentation, Learnings, Key results, Worklog.

Custom templates at `~/.claude/session-memory/config/template.md`.

**Extraction Triggers** (throttled):
```typescript
{
  minimumMessageTokensToInit:  10_000,
  minimumTokensBetweenUpdate:   5_000,
  toolCallsBetweenUpdates:          3,
}
```

**Token Budget**: 12,000 tokens total, each section limited to 2,000 tokens. Hard truncation at line boundary with `[... section truncated for length ...]`.

### Team Memory Sync

API contract:
```
GET  /api/claude_code/team_memory?repo={owner/repo}
PUT  /api/claude_code/team_memory?repo={owner/repo}
```

Sync rules:
- Pull: server wins per-key (local files overwritten)
- Push: delta upload -- only keys whose sha256 hash differs
- File deletions do NOT propagate
- PUT body batched at 200KB max

**File Watcher**: Session-level watcher with 2-second debounced push. Uses native `fs.watch({ recursive: true })` instead of chokidar.

**Secret Scanning**: 35+ secret patterns from gitleaks ruleset scan before push:
```typescript
{ id: 'anthropic-api-key',  source: `\\b(sk-ant-api03-[a-zA-Z0-9_\\-]{93}AA)...` },
{ id: 'github-pat',          source: 'ghp_[0-9a-zA-Z]{36}' },
{ id: 'aws-access-token',    source: '\\b((?:A3T[A-Z0-9]|AKIA|ASIA)...)' },
{ id: 'stripe-access-token',  source: '\\b((?:sk|rk)_(?:test|live|prod)_...)' },
```

**Path Traversal Defense**: Two-level: (1) `path.resolve()` eliminates `..` segments, (2) `realpath()` catches symlink escapes.

### KAIROS / Assistant Mode

Uses append-only daily log pattern:
```
Writes to: <autoMemPath>/logs/YYYY/MM/YYYY-MM-DD.md
Append-only, timestamped bullets
MEMORY.md is read-only (maintained by separate nightly /dream skill)
```

KAIROS mode does not compose with TEAMMEM -- mutually exclusive.

### Feature Flags & Disable Mechanisms

- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` -- Full disable
- `CLAUDE_CODE_SIMPLE=1` -- Drops memory section from system prompt
- `autoMemoryEnabled: false` -- Settings override in `localSettings` or `userSettings`
- `tengu_passport_quail` -- GrowthBook feature flag gating extraction

---

## LESSON 40: AUTO MEMORY & DREAMS

### Two-Layer Memory Lifecycle

**Layer 1 (Per-turn)**: After each final response, a forked agent reviews new messages and writes topic files to disk.

**Layer 2 (Cross-session)**: After 24h + 5 sessions, a consolidation agent merges, prunes, and re-indexes the memory directory.

### Memory Directory Structure

Path resolution precedence:
1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` environment variable
2. `getSettingsForSource('localSettings').autoMemoryDirectory` from settings.json
3. `~/.claude/projects/<sanitized-git-root>/memory/` (default)

Keyed on canonical git root -- all worktrees share one memory directory.

```
~/.claude/projects/<slug>/memory/
  MEMORY.md
  user_role.md
  feedback_testing.md
  project_auth.md
  .consolidate-lock    # mtime == lastConsolidatedAt
  logs/                # KAIROS/assistant-mode only
    2026/03/2026-03-31.md
```

### Memory Taxonomy (Four Types)

| Type | Purpose |
|------|---------|
| **user** | Role, goals, knowledge level, communication preferences |
| **feedback** | Corrections AND confirmations. Stores the rule + Why: + How to apply: |
| **project** | Ongoing work, deadlines, incidents. Not derivable from code or git |
| **reference** | Where to find information in external systems |

Topic file structure:
```yaml
---
name: feedback_no_db_mocks
description: Integration tests must use a real DB
type: feedback
---

# Don't mock the database in integration tests

**Why:** Prior incident where mock/prod divergence...
**How to apply:** Any test exercising DB query paths...
```

### Layer 1 -- Extract Memories

Triggered via `handleStopHooks` --> `executeExtractMemories()`.

**State Management** -- all mutable state in `initExtractMemories()`:
```typescript
let lastMemoryMessageUuid: string | undefined  // cursor
let inProgress: boolean                         // overlap guard
let pendingContext: ...                         // stash for trailing run
let turnsSinceLastExtraction: number           // throttle counter
```

**Overlap Coalescing**: If extraction running when new turn completes, context stashed in `pendingContext`. When running extraction finishes, fires trailing run.

**Extraction Flow**:
1. Check if extraction in progress
2. Verify main agent hasn't written to memory paths
3. `scanMemoryFiles()` -- build manifest
4. `buildExtractAutoOnlyPrompt()` or `buildExtractCombinedPrompt()`
5. `runForkedAgent()` with `maxTurns=5, skipTranscript=true`
6. Turn 1: Parallel Read calls for files to update
7. Turn 2: Parallel Write/Edit calls
8. Advance cursor
9. `extractWrittenPaths()` from messages
10. If `pendingContext` stashed, run trailing extraction

**Tool Permissions** (`createAutoMemCanUseTool()`):
```typescript
if (tool.name === FILE_READ_TOOL_NAME || GREP || GLOB) return allow()
if (tool.name === BASH_TOOL_NAME && tool.isReadOnly(parsed.data)) return allow()
if ((EDIT || WRITE) && isAutoMemPath(input.file_path)) return allow()
return denyAutoMemTool(tool, reason)
```

### Layer 2 -- Auto Dream (Consolidation)

Three gates (cheapest first):
1. **Time**: Hours since `lastConsolidatedAt` >= `minHours` (default: 24)
2. **Session**: Transcript files with mtime > `lastConsolidatedAt` >= `minSessions` (default: 5)
3. **Lock**: No other process mid-consolidation

**Lock File Design** -- `.consolidate-lock` body contains PID; the mtime IS `lastConsolidatedAt`:
```typescript
const [s, raw] = await Promise.all([stat(path), readFile(path, 'utf8')])
if (isProcessRunning(holderPid)) return null
await writeFile(path, String(process.pid))
const verify = await readFile(path, 'utf8')
if (parseInt(verify) !== process.pid) return null
```

Rollback: `rollbackConsolidationLock(priorMtime)` rewinds mtime via `utimes()`.

**Consolidation Prompt -- Four Phases**:
1. **Orient**: `ls` the memory dir, read `MEMORY.md`, skim topic files
2. **Gather recent signal**: Check daily logs (KAIROS mode), grep transcripts narrowly
3. **Consolidate**: Write or update topic files. Merge near-duplicates. Convert relative dates to absolute
4. **Prune and index**: Update `MEMORY.md` -- keep under 200 lines / 25 KB

**Dream Progress Tracking**:
```typescript
function makeDreamProgressWatcher(taskId, setAppState) {
  return msg => {
    for (const block of msg.message.content) {
      if (block.type === 'text') text += block.text
      if (block.type === 'tool_use') toolUseCount++
      if (EDIT || WRITE) touchedPaths.push(input.file_path)
    }
    addDreamTurn(taskId, { text, toolUseCount }, touchedPaths, setAppState)
  }
}
```

### Recall -- findRelevantMemories

Two-step pipeline:
```typescript
const memories = (await scanMemoryFiles(memoryDir, signal))
  .filter(m => !alreadySurfaced.has(m.filePath))

const selectedFilenames = await selectRelevantMemories(
  query, memories, signal, recentTools
)
// sideQuery -> Sonnet, max_tokens: 256, JSON schema output
// Returns: { selected_memories: string[] }
```

Selects up to five topic files relevant to current query.

**Tool Documentation Suppression**: If the model is actively using a tool (in `recentTools`), that tool's reference documentation memory is suppressed.

**Staleness Signals**: Files >1 day old get caveat text. Section header "Before recommending from memory" evaluated better than "Trusting what you recall" because it triggers at the decision point.

### Cache Efficiency

The forked agent pattern shares the parent's prompt cache. Tool list must match for cache sharing to work (tools are part of cache key).

```typescript
const hitPct = ((cache_read_tokens / totalInput) * 100).toFixed(1)
logForDebugging(`[extractMemories] cache: read=${cache_read} create=${cache_create} (${hitPct}% hit)`)
```

### KAIROS / Assistant Mode

In long-lived sessions, memory shifts to append-only daily log model. The log path pattern is stored in the prompt without today's literal date -- the prompt is cached and must not be invalidated on midnight rollover. The model derives the current date from a `date_change` attachment appended when midnight rolls.

---

## LESSON 11: INK RENDERER

### Seven-Stage Pipeline

**Stage 1: React Reconciler (reconciler.ts)**
Custom host implements `react-reconciler` interface targeting ink's DOM instead of browser DOM.
- `createInstance`: Maps JSX to node types (ink-box, ink-text, ink-virtual-text, etc.)
- `commitUpdate`: Diffs props and styles, skips marking dirty for event handlers
- `resetAfterCommit`: Triggers layout computation then rendering

When React renders `<Text>` inside another `<Text>`, inner node becomes `ink-virtual-text` -- a ghost node with no Yoga backing.

**Stage 2: Virtual DOM (dom.ts)**
```
DOMElement {
  nodeName: 'ink-root' | 'ink-box' | 'ink-text' | etc.
  style: Styles
  attributes: Record
  childNodes: DOMElement[]
  yogaNode?: LayoutNode
  dirty: boolean
}
```

**Stage 3: Yoga Layout**
C++ Flexbox engine compiled to WASM. Adapter translates string enums to numeric constants. Text nodes use custom measure function for width calculation.

**Stage 4: renderNodeToOutput (render-node-to-output.ts)**
Recursive tree walk converting laid-out nodes to operations. Checks blit fast path conditions for dirty nodes.

**Stage 5: Output Operations Queue (output.ts)**
Command buffer: write, blit, clear, clip/unclip, shift (DECSTBM hardware scroll), noSelect. Two-pass replay.

**Stage 6: Screen Buffer (screen.ts)**
Packed Int32Array with 2 words per cell (8 bytes total):
```
Word 0: charId (32 bits) -- CharPool index
Word 1: styleId[31:17] | hyperlinkId[16:2] | cellWidth[1:0]
```

Shared CharPool and HyperlinkPool across buffers enable blit via integer ID copy without re-interning.

**Stage 7: Cell Diff --> Terminal**
Diffs damage bounding box only. Emits minimal ANSI sequence via cached `StylePool.transition(fromId, toId)`.

### Reconciler Implementation

**createInstance Handler**:
```typescript
const type = (originalType === 'ink-text' && hostContext.isInsideText)
  ? 'ink-virtual-text'
  : originalType
const node = createNode(type)
for (const [key, value] of Object.entries(newProps)) {
  applyProp(node, key, value)
}
```

**commitUpdate Handler**:
```typescript
const props = diff(oldProps, newProps)
const style = diff(oldProps['style'], newProps['style'])
if (props) {
  for (const [key, value] of Object.entries(props)) {
    if (EVENT_HANDLER_PROPS.has(key)) {
      setEventHandler(node, key, value); continue
    }
    setAttribute(node, key, value)
  }
}
if (style) applyStyles(node.yogaNode, style)
```

Event handlers stored in `node._eventHandlers` prevent dirty marking on handler identity changes.

### Node Type System

- **ink-root**: One per session, holds FocusManager, always has yogaNode
- **ink-box**: Maps `<Box>`, full flex properties, handles overflow/scroll/borders
- **ink-text**: Maps `<Text>`, custom measure function, squashes child text nodes
- **ink-virtual-text**: Text nested in text, no yogaNode, invisible to layout
- **ink-raw-ansi**: Pre-rendered ANSI content, custom measure, bypasses squash/wrap/style
- **ink-link**: OSC 8 hyperlink wrapper, no yogaNode, metadata carrier
- **ink-progress**: No yogaNode, JS-handled rendering

### Dirty Flag System

`markDirty` walks UP the parent chain, setting `node.dirty = true` on every ancestor. A spinner five levels deep marks five nodes dirty; everything else stays clean and gets blitted.

For a 200x40 terminal showing a streaming response, only ~40 cells per frame are written -- the rest are O(1) `TypedArray.set()` copies.

### Yoga Layout Adapter

```typescript
type LayoutNode = {
  insertChild(child: LayoutNode, index: number): void
  removeChild(child: LayoutNode): void
  calculateLayout(width?: number, height?: number): void
  setMeasureFunc(fn: LayoutMeasureFunc): void
  getComputedLeft/Top/Width/Height(): number
  setFlexDirection/PositionType/Overflow(value): void
  free(): void
  freeRecursive(): void
}
```

Critical: Call `clearYogaNodeReferences(node)` BEFORE `yogaNode.freeRecursive()` to avoid dangling WASM references.

**DOM vs Yoga Index Mismatch**:
```typescript
let yogaIndex = 0
if (newChildNode.yogaNode && node.yogaNode) {
  for (let i = 0; i < index; i++) {
    if (node.childNodes[i]?.yogaNode) {
      yogaIndex++
    }
  }
}
```

### Blit Fast Path (Six Conditions)

```typescript
if (!node.dirty && !skipSelfBlit && 
    node.pendingScrollDelta === undefined && cached &&
    cached.x === x && cached.y === y &&
    cached.width === width && cached.height === height &&
    prevScreen) {
  output.blit(prevScreen, fx, fy, fw, fh)
  blitEscapingAbsoluteDescendants(node, output, prevScreen, fx, fy, fw, fh)
  return
}
```

Kill switch: `prevFrameContaminated` flag set when selection overlay mutates screen, alt-screen entered/resized, or `forceRedraw()` called.

### ScrollBox Hardware Scroll

When scrollTop changes and nothing else moves, emit ScrollHint `{top, bottom, delta}`. Diff layer emits DECSTBM + SU/SD hardware scroll (O(1) vs O(rows) escape sequences).

`pendingScrollDelta` drains at most `innerHeight - 1` rows per frame. `drainAdaptive` for xterm.js/VS Code; `drainProportional` for native terminals.

### Screen Buffer Design

BigInt64Array view for single-call bulk zero-fill. Shared CharPool/HyperlinkPool means blit copies integer IDs directly with no re-interning.

Screen carries: damage bounding box, per-cell noSelect bitmap, per-row softWrap array for selection copy.

### StylePool

Intern pattern with bit 0 encoding "visible on space":
```typescript
id = (rawId << 1) | 
     (styles.length > 0 && hasVisibleSpaceEffect(styles) ? 1 : 0)
```

Even IDs = fg-only styles. Odd IDs = styles that paint space cells. `transition(fromId, toId)` pre-computes and caches ANSI escape strings -- zero allocations after first call.

### Wide Character Handling

```typescript
const enum CellWidth {
  Narrow = 0,      // single-column character
  Wide = 1,        // CJK/emoji -- actual char, 2 visual cols
  SpacerTail = 2,  // second col of wide char -- skip in renderer
  SpacerHead = 3,  // wide char at line end continuing next row
}
```

When `setCellAt` writes Narrow over Wide, must clear ghost SpacerTail at x+1.

### Renderer Alt-Screen Invariants

```typescript
const height = options.altScreen ? terminalRows : yogaHeight
return {
  screen: renderedScreen,
  viewport: {
    width: terminalWidth,
    height: options.altScreen ? terminalRows + 1 : terminalRows,
  },
  cursor: {
    x: 0,
    y: options.altScreen ? Math.max(0, Math.min(screen.height, terminalRows) - 1) : screen.height,
    visible: !isTTY || screen.height === 0,
  }
}
```

The `viewport.height = terminalRows + 1` trick prevents full-screen clear trigger in alt-screen mode.

---

## LESSON 13: COMMANDS SYSTEM

### Core Architecture

```typescript
export type Command = CommandBase &
  (PromptCommand | LocalCommand | LocalJSXCommand)
```

Discriminant field `type` must be exactly `"local"`, `"local-jsx"`, or `"prompt"`.

### Three Command Execution Types

**Local Commands**: Pure TypeScript functions, synchronous, return `LocalCommandResult` (`{type:'text'}`, `{type:'compact'}`, `{type:'skip'}`). Examples: `/clear`, `/compact`, `/cost`.

**Local JSX Commands**: Render React/Ink components. Return `ReactNode` via `call(onDone, context, args)`. Blocked from bridge/remote mode. Examples: `/help`, `/model`, `/config`, `/memory`.

**Prompt Commands**: Expand to text content blocks sent to model. Declare `getPromptForCommand(args, context)` returning `ContentBlockParam[]`. Examples: `/commit`, `/review`, `/init`.

### CommandBase Contract Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Slash command identifier |
| `description` | string | Shown in typeahead; can be a getter |
| `aliases` | string[]? | Alternative names |
| `isEnabled` | () => boolean | Runtime feature-flag guard |
| `isHidden` | boolean? | Hide from UI while allowing invocation |
| `availability` | CommandAvailability[]? | Auth gate: `'claude-ai'` or `'console'` |
| `argumentHint` | string? | Grayed hint in typeahead |
| `immediate` | boolean? | Run without waiting for in-flight AI requests |
| `loadedFrom` | string? | Origin: `'skills'`, `'plugin'`, `'bundled'`, `'mcp'` |
| `whenToUse` | string? | Model-facing usage hint from SKILL.md |
| `isSensitive` | boolean? | Redact args from conversation history |

### Registration Pipeline

```
Static COMMANDS() + Skills dirs + Plugins + Workflows 
--> loadAllCommands(cwd) 
--> filter(availability + isEnabled) 
--> getCommands(cwd)
```

**Stage 1 -- Static Core Commands**: Memoized function returning ~80 built-in commands with conditional feature-flagged spreads.

**Stage 2 -- Dynamic Loading** (merge order, high-to-low priority):
1. bundledSkills
2. builtinPluginSkills
3. skillDirCommands
4. workflowCommands
5. pluginCommands
6. pluginSkills
7. COMMANDS() (built-ins last)

**Stage 3 -- Filtering**: Re-runs `availability` and `isEnabled` checks on every call.

### Lazy Loading Pattern

```typescript
const compact = {
  type: 'local',
  name: 'compact',
  load: () => import('./compact.js'),
}
```

### Shell Substitution in Prompts

Pattern: `` !`shell command` ``

```
const PROMPT = `## Context
- Current git status: !`git status`
- Current git diff: !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`
`
```

`executeShellCommandsInPrompt` scans and replaces patterns with live output.

### REPL Integration & Dispatch -- Three Paths

```
/compact --> REPL --> LocalCommand.load() then call(args, ctx) --> LocalCommandResult --> Update messages state
/model   --> REPL --> LocalJSX.load() then renders ReactNode --> Mounts component, waits for onDone() --> Unmounts
/commit  --> REPL --> PromptCommand.getPromptForCommand(args, ctx) --> ContentBlockParam[] become first user message --> Enter query mode
```

### onDone Callback Contract (Local JSX)

```typescript
type LocalJSXCommandOnDone = (
  result?: string,
  options?: {
    display?: 'skip' | 'system' | 'user'
    shouldQuery?: boolean
    metaMessages?: string[]
    nextInput?: string
    submitNextInput?: boolean
  }
) => void
```

### Availability & Feature Gating

```typescript
export function meetsAvailabilityRequirement(cmd: Command): boolean {
  if (!cmd.availability) return true
  for (const a of cmd.availability) {
    switch (a) {
      case 'claude-ai':
        if (isClaudeAISubscriber()) return true; break
      case 'console':
        if (!isClaudeAISubscriber() && !isUsing3PServices()
            && isFirstPartyAnthropicBaseUrl()) return true; break
    }
  }
  return false
}
```

### Internal-Only Commands Gate

```typescript
export const INTERNAL_ONLY_COMMANDS = [
  backfillSessions, breakCache, bughunter, commit, commitPushPr, mockLimits, bridgeKick,
].filter(Boolean)

// Inside COMMANDS():
...(!process.env.IS_DEMO && process.env.USER_TYPE === 'ant'
  ? INTERNAL_ONLY_COMMANDS : [])
```

### Cache Management -- Three Layers

| Cache | Key | Contents |
|-------|-----|----------|
| `COMMANDS()` | none (singleton) | Static built-in list |
| `loadAllCommands` | `cwd` string | Merged pool from all sources |
| `getSkillToolCommands` | `cwd` string | Filtered prompt commands for SkillTool |

`meetsAvailabilityRequirement` and `isCommandEnabled` are deliberately NOT memoized -- re-evaluated on every call.

### Bridge & Remote Mode

**Remote-Safe Commands**: Only commands in `REMOTE_SAFE_COMMANDS` available before CCR init (session, exit, clear, help, theme, cost, plan).

**Bridge-Safe Commands**:
```typescript
export function isBridgeSafeCommand(cmd: Command): boolean {
  if (cmd.type === 'local-jsx') return false  // always blocked
  if (cmd.type === 'prompt') return true      // always safe
  return BRIDGE_SAFE_COMMANDS.has(cmd)          // local needs explicit opt-in
}
```

---

## LESSON 35: DIALOG UI

### Four-Layer Architecture

**Layer 1 -- Launchers** (`dialogLaunchers.tsx`): Async functions that dynamically import components and resolve a Promise when user is done.

**Layer 2 -- Helpers** (`interactiveHelpers.tsx`): `showDialog` / `showSetupDialog` wrap renders in `AppStateProvider` + `KeybindingSetup`.

**Layer 3 -- Design System** (`Dialog`, `Pane`, `PermissionDialog`): Opinionated Ink wrappers for consistent chrome and keybindings.

**Layer 4 -- Feature Components**: Per-tool permission requests, onboarding steps, wizard pages.

### Dialog Launcher Pattern

```typescript
export async function launchSnapshotUpdateDialog(
  root: Root,
  props: { agentType: string; scope: AgentMemoryScope; snapshotTimestamp: string }
): Promise<'merge' | 'keep' | 'replace'> {
  const { SnapshotUpdateDialog } = await import('./components/agents/SnapshotUpdateDialog.js');
  return showSetupDialog<'merge' | 'keep' | 'replace'>(root, done =>
    <SnapshotUpdateDialog ... onComplete={done} onCancel={() => done('keep')} />
  );
}
```

### showDialog Primitive

```typescript
export function showDialog<T = void>(
  root: Root,
  renderer: (done: (result: T) => void) => React.ReactNode
): Promise<T> {
  return new Promise<T>(resolve => {
    const done = (result: T): void => void resolve(result);
    root.render(renderer(done));
  });
}
```

### showSetupDialog Wrapper

```typescript
export function showSetupDialog<T = void>(
  root: Root,
  renderer: (done: (result: T) => void) => React.ReactNode
): Promise<T> {
  return showDialog<T>(root, done =>
    <AppStateProvider>
      <KeybindingSetup>{renderer(done)}</KeybindingSetup>
    </AppStateProvider>
  );
}
```

### Design System Components

**Dialog**: Standard chrome for confirm/cancel. Registers `confirm:no` (Esc and n) and `app:exit` / `app:interrupt` (Ctrl-C/D). `isCancelActive` prop disables bindings when embedded text input is focused.

**Pane**: Borderless region used by slash-command screens. Renders colored divider line as top border.

**PermissionDialog**: Specialized frame for tool permission requests. Does NOT register keybindings -- handled by `PermissionPrompt` nested inside.

```typescript
<Box flexDirection="column" borderStyle="round" borderColor={color}
  borderLeft={false} borderRight={false} borderBottom={false} marginTop={1}>
  <Box paddingX={1} flexDirection="column">
    <Box justifyContent="space-between">
      <PermissionRequestTitle ... workerBadge={workerBadge} />
      {titleRight}
    </Box>
  </Box>
  <Box flexDirection="column" paddingX={innerPaddingX}>{children}</Box>
</Box>
```

### Permission Request System

**Tool-to-Component Routing** (`PermissionRequest.tsx`):
```typescript
function permissionComponentForTool(tool: Tool) {
  switch (tool) {
    case FileEditTool:   return FileEditPermissionRequest;
    case FileWriteTool:  return FileWritePermissionRequest;
    case BashTool:       return BashPermissionRequest;
    case PowerShellTool: return PowerShellPermissionRequest;
    case WebFetchTool:   return WebFetchPermissionRequest;
    case SkillTool:      return SkillPermissionRequest;
    default:             return FallbackPermissionRequest;
  }
}
```

**PermissionPrompt Option Type**:
```typescript
export type PermissionPromptOption<T extends string> = {
  value: T;
  label: ReactNode;
  feedbackConfig?: { type: 'accept' | 'reject'; placeholder?: string; };
  keybinding?: KeybindingAction;
};
```

### CustomSelect Widget

```typescript
type BaseOption<T> = {
  label: ReactNode;
  value: T;
  description?: string;
  disabled?: boolean;
};
type InputOption<T> = BaseOption<T> & {
  type: 'input';
  onChange: (value: string) => void;
  placeholder?: string;
  allowEmptySubmitToCancel?: boolean;
  showLabelWithValue?: boolean;
  resetCursorOnUpdate?: boolean;
};
```

An `'input'`-type option embeds a live text field inside the select list.

### Wizard Pattern

**WizardProvider**: Holds `currentStepIndex`, `wizardData`, navigation history, completion state.

**useWizard Hook**: Returns `goNext`, `goBack`, `setData`, current step metadata.

**WizardDialogLayout**:
```typescript
const { currentStepIndex, totalSteps, title: providerTitle, goBack } = useWizard();
const stepSuffix = showStepCounter !== false
  ? ` (${currentStepIndex + 1}/${totalSteps})`
  : "";
return <>
  <Dialog title={`${title}${stepSuffix}`} subtitle={subtitle}
    onCancel={goBack} isCancelActive={false} hideInputGuide={true}>
    {children}
  </Dialog>
  <WizardNavigationFooter instructions={footerText} />
</>
```

Setting `isCancelActive={false}` disables Dialog's built-in Esc handler because WizardProvider registers its own exit handler via `useExitOnCtrlCDWithKeybindings()`.

### Onboarding Component

```typescript
type StepId = 'preflight' | 'theme' | 'oauth' | 'api-key' | 'security' | 'terminal-setup';
interface OnboardingStep {
  id: StepId;
  component: React.ReactNode;
}
```

On each `goToNextStep()` the step's `id` is sent to analytics as `'tengu_onboarding_step'`.

---

## LESSON 30: NOTIFICATION SYSTEM

### Two Separate Notification Pipelines

**Pipeline 1: In-REPL Toast Queue** -- `context/notifications.tsx` --> `components/PromptInput/Notifications.tsx`

**Pipeline 2: OS/Terminal Notifier** -- `services/notifier.ts` --> `ink/useTerminalNotification.ts`

These operate independently -- toast queue modifies React state; terminal notifier writes OSC/BEL escape sequences directly to TTY.

### Pipeline 1: In-REPL Toast Queue

**Type Definitions**:
```typescript
type Priority = 'low' | 'medium' | 'high' | 'immediate'

type BaseNotification = {
  key: string
  invalidates?: string[]
  priority: Priority
  timeoutMs?: number          // default 8000 ms
  fold?: (accumulator: Notification, incoming: Notification) => Notification
}

type TextNotification = BaseNotification & { text: string; color?: keyof Theme }
type JSXNotification  = BaseNotification & { jsx: React.ReactNode }

export type Notification = TextNotification | JSXNotification
```

**Priority System** (NOT FIFO -- `getNext()` promotes highest-priority via linear reduce):
```typescript
const PRIORITIES: Record<Priority, number> = {
  immediate: 0,
  high:      1,
  medium:    2,
  low:       3,
}

export function getNext(queue: Notification[]): Notification | undefined {
  if (queue.length === 0) return undefined
  return queue.reduce((min, n) =>
    PRIORITIES[n.priority] < PRIORITIES[min.priority] ? n : min
  )
}
```

| Priority | Rank | Behavior | Usage |
|----------|------|----------|-------|
| immediate | 0 | Preempts current display; bumped item re-queues (non-immediate only) | Rate limit reached, overage mode |
| high | 1 | Queued, wins over medium/low | Rate limit warning, model deprecation |
| medium | 2 | Beats low | LSP errors, env-hook errors |
| low | 3 | Shown last | Env-hook success (5s timeout) |

**State Shape**:
```typescript
{
  current: Notification | null,
  queue:   Notification[]
}
```

Module-level `currentTimeoutId` singleton (not React state) tracks auto-dismiss timer.

**addNotification Decision Tree**:

For `immediate`: Clear existing timeout, set new timeout, set `current = notif`, filter queue.

For non-immediate with `fold`: Check if `current.key === notif.key` --> fold, or check queue for same key --> fold in queue.

For non-immediate without fold: Append to filtered queue, call `processQueue()`.

**processQueue Implementation** (setTimeout receives arguments explicitly to avoid stale closures):
```typescript
const processQueue = useCallback(() => {
  setAppState(prev => {
    const next = getNext(prev.notifications.queue)
    if (prev.notifications.current !== null || !next) return prev
    currentTimeoutId = setTimeout(
      (setAppState, nextKey, processQueue) => {
        currentTimeoutId = null
        setAppState(prev => {
          if (prev.notifications.current?.key !== nextKey) return prev
          return { ...prev, notifications: { queue: prev.notifications.queue, current: null } }
        })
        processQueue()
      },
      next.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      setAppState, next.key, processQueue
    )
    return {
      ...prev,
      notifications: { queue: prev.notifications.queue.filter(_ => _ !== next), current: next }
    }
  })
}, [setAppState])
```

### Complete Hook Inventory

| Hook | Notification Key | Priority | Trigger |
|------|------------------|----------|---------|
| `useRateLimitWarningNotification` | `rate-limit-warning` | high | Approaching usage limit |
| `useRateLimitWarningNotification` | `limit-reached` | immediate | Entered overage mode |
| `useDeprecationWarningNotification` | `model-deprecation-warning` | high | Model deprecated |
| `useLspInitializationNotification` | `lsp-error-{source}` | medium | LSP init failure (5s poll) |
| `useFastModeNotification` | `fast-mode` | high | Model switches to fast/turbo |
| `useAutoModeUnavailableNotification` | `auto-mode-unavailable` | high | Auto model selection unavailable |
| `useModelMigrationNotifications` | `model-migration` | high | Active model migrated/renamed |
| `useNpmDeprecationNotification` | `npm-deprecation` | high | npm package deprecated |
| `usePluginAutoupdateNotification` | `plugin-autoupdate` | low | Plugin auto-updated |
| `usePluginInstallationStatus` | `plugin-install-{name}` | medium | Plugin install result |
| `useMcpConnectivityStatus` | `mcp-connectivity` | medium | MCP server connection change |
| `useIDEStatusIndicator` | `ide-status` | medium | IDE connection changes |
| `useInstallMessages` | `install-msg-*` | low | Post-update install notes |
| `useTeammateShutdownNotification` | `teammate-shutdown` | high | Companion agent exited unexpectedly |
| `useSettingsErrors` | `settings-error-*` | high | Settings validation errors |

### Pipeline 2: OS/Terminal Notifier

**sendNotification Entry Point**:
```typescript
export async function sendNotification(
  notif: NotificationOptions,
  terminal: TerminalNotification,
): Promise<void> {
  const config = getGlobalConfig()
  const channel = config.preferredNotifChannel
  await executeNotificationHooks(notif)   // user hooks first
  const methodUsed = await sendToChannel(channel, notif, terminal)
  logEvent('tengu_notification_method_used', {
    configured_channel: channel, method_used: methodUsed, term: env.terminal,
  })
}
```

**Channel Routing**:
```typescript
switch (channel) {
  case 'auto':           return sendAuto(opts, terminal)
  case 'iterm2':         terminal.notifyITerm2(opts);              return 'iterm2'
  case 'iterm2_with_bell': terminal.notifyITerm2(opts); terminal.notifyBell(); return 'iterm2_with_bell'
  case 'kitty':           terminal.notifyKitty({ ...opts, id: generateKittyId() }); return 'kitty'
  case 'ghostty':         terminal.notifyGhostty(opts);            return 'ghostty'
  case 'terminal_bell':   terminal.notifyBell();                    return 'terminal_bell'
  case 'notifications_disabled': return 'disabled'
}
```

**Terminal Escape Sequences**:
```typescript
// iTerm2: OSC 9
notifyITerm2({ message, title }) {
  const display = title ? `${title}:\n\n${message}` : message
  writeRaw(wrapForMultiplexer(osc(OSC.ITERM2, `\n\n${display}`)))
}

// Kitty: three-step OSC 99 (title, body, focus)
notifyKitty({ message, title, id }) {
  writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:d=0:p=title`, title)))
  writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:p=body`, message)))
  writeRaw(wrapForMultiplexer(osc(OSC.KITTY, `i=${id}:d=1:a=focus`, '')))
}

// Ghostty: single OSC
notifyGhostty({ message, title }) {
  writeRaw(wrapForMultiplexer(osc(OSC.GHOSTTY, 'notify', title, message)))
}

// BEL: raw 0x07 -- NOT wrapped (tmux needs bare BEL for bell-action)
notifyBell() { writeRaw(BEL) }
```

**Progress Reporting** (OSC 9;4 sequences):
```typescript
terminal.progress('running', 42)       // 42% progress bar
terminal.progress('indeterminate')    // spinning indicator
terminal.progress('error', 80)        // error state at 80%
terminal.progress('completed')        // clears indicator
terminal.progress(null)              // explicit clear
```

### Background Task Notification Collapsing

```typescript
export function collapseBackgroundBashNotifications(
  messages: RenderableMessage[],
  verbose: boolean,
): RenderableMessage[] {
  if (!isFullscreenEnvEnabled()) return messages
  if (verbose) return messages            // ctrl+O shows each individually
  // Only successful completions collapse. Failed/killed remain individual.
  // Synthesizes: "<task_notification>...N background commands completed...</task_notification>"
}
```

### MCP Channel Notifications (Kairos)

6-Layer Security Gates:
1. **Capability**: Server must declare `experimental['claude/channel']`
2. **Runtime flag**: `isChannelsEnabled()` -- GrowthBook kill-switch
3. **Auth**: Requires Claude.ai OAuth token
4. **Org policy**: Team/Enterprise must set `channelsEnabled: true`
5. **Session opt-in**: Server must be in `--channels` flag
6. **Allowlist**: Plugin marketplace verification + approved-plugin ledger check

### Key Design Patterns

1. **Priority-based dequeue**: Non-FIFO queue using `getNext()` reduce
2. **Immediate preemption**: `immediate` priority bumps current back into queue (non-immediate only)
3. **Notification folding**: Duplicate-key merge via `fold` function
4. **Module singleton timeout**: `currentTimeoutId` (not React state) for synchronous cancellation
5. **useRef for once-per-session**: `hasRunRef` prevents re-firing
6. **Stale closure avoidance**: setTimeout receives arguments explicitly
7. **Terminal multiplexer awareness**: OSC sequences wrapped in DCS except BEL (tmux-native)

---

That is the complete extraction of all 10 lessons. Every code example, type definition, architecture pattern, data structure, configuration detail, file path, workflow description, and design decision has been captured from:

1. `/03-skills-system` -- Skill lifecycle, four sources, SKILL.md frontmatter, MCP skills, permission logic, live reloading
2. `/05-agent-system` -- Agent types, sync/async lifecycle, fork path, worktree isolation, swarm protocol
3. `/21-coordinator-mode` -- Dispatcher-only mode, 4-tool restriction, four-phase workflow, scratchpad
4. `/22-teams-swarm` -- TeamCreate/TeamDelete, three spawn backends, file-based mailbox, permission sync
5. `/08-memory-system` -- Three memory layers (auto/session/team), extraction pipeline, team sync, secret scanning
6. `/40-auto-memory-dreams` -- Extract memories per-turn, consolidation/dream agent, lock file design, recall pipeline
7. `/11-ink-renderer` -- Seven-stage pipeline, blit fast path, packed Int32Array screen buffer, hardware scroll
8. `/13-commands-system` -- Three command types, registration pipeline, shell substitution, bridge/remote safety
9. `/35-dialog-ui` -- Four-layer launcher pattern, Dialog/Pane/PermissionDialog components, wizard pattern
10. `/30-notification-system` -- Dual pipelines (toast queue + OS notifier), priority dequeue, terminal escape sequences, MCP channel security