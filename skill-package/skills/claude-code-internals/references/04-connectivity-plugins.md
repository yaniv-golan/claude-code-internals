Updated: 2026-03-31 | Compiled Reference Batch 2
Created: 2026-03-31

# Claude Code Source Deep Dive -- Complete Technical Extraction (Lessons 09, 10, 20, 25, 27, 28, 36, 43, 44, 45)

---

# LESSON 09: PLUGIN SYSTEM

## Architecture Overview

The plugin system comprises **five conceptual layers**:

1. **Marketplace Sources** -- GitHub repos, git URLs, npm packages, local directories, URL-hosted JSON
2. **Manifest Schema** -- `plugin.json` declares exported capabilities
3. **Versioned Cache** -- Immutable per-version snapshots at `~/.claude/plugins/cache/{mkt}/{plugin}/{version}/`
4. **Dependency Resolution** -- DFS closure walk at install-time; fixed-point demote pass at load-time
5. **Lifecycle** -- Reconciliation -> autoupdate -> load -> hook/command registration -> MCP connection

## Plugin Lifecycle Phases

**Startup (non-blocking):**
- Merge declared marketplaces from settings + CLI flags
- Compare against known marketplaces
- Reconcile missing sources via git clone/HTTP fetch/npm install
- Auto-refresh plugins or set needsRefresh flag

**Background Autoupdate:**
- Identify auto-update-enabled marketplaces (official = true by default)
- Execute `refreshMarketplace()` for each
- Invoke `updatePluginOp()` per installation
- Notify REPL via `onPluginsAutoUpdated()`

**Plugin Install (user-triggered):**
- Parse marketplace input (`name@marketplace`)
- Check policy blocklist
- Resolve dependency closure via DFS (cycle detection, cross-marketplace blocking)
- Fetch from marketplace using appropriate method
- Calculate version: plugin.json field -> provided version -> git SHA -> "unknown"
- Copy to versioned cache at `~/.claude/plugins/cache/{mkt}/{plugin}/{ver}/`
- Update settings to enable plugin

**Load Phase (cache-only, per session):**
- Read `settings.enabledPlugins`
- Verify dependencies and demote broken plugins (fixed-point loop)
- Auto-uninstall delisted plugins
- Parse `plugin.json` via `PluginManifestSchema`
- Resolve paths for commands/, agents/, skills/, hooks/, mcpServers, lspServers

**Registration:**
- Extract commands from `.md` files -> namespaced `/plugin:cmd`
- Scan skills/ for SKILL.md subdirectories
- Convert hooks to `PluginHookMatcher[]`
- Register agent `.md` files
- Connect MCP servers with userConfig injection
- Register LSP servers

## Sources: two distinct schema unions

The word "source" covers **two different zod unions** in the binary. They are not interchangeable — a plugin-source type like `pip` is invalid as a marketplace source, and marketplace-only allowlist types like `hostPattern` are invalid inside a plugin entry.

### Plugin sources (`plugins[].source` inside a marketplace catalog)

How a single plugin listed in a marketplace catalog is fetched. Bare string form is also accepted and means "relative path from the marketplace root."

| Type | Details |
|------|---------|
| **github** | `{repo: "owner/name", ref?, path?, commit?}` — plugin lives in a GitHub repo |
| **git-subdir** | `{url, path, ref?}` — partial clone with sparse-checkout; version includes path hash |
| **url** | `{url}` — direct download of a plugin archive |
| **npm** | `{package, version?, registry?}` — installed to shared `npm-cache/node_modules/` then copied |
| **pip** *(undocumented)* | `{package, version?, registry?}` — PyPI name with specifier (`==1.0.0`, `>=2.0.0`); optional custom index URL. Parallels `npm` for Python-backed plugins |
| *(bare string)* | Relative path from the marketplace directory |

### Marketplace sources (how the catalog itself is fetched)

| Type | Details |
|------|---------|
| **github** | `{repo, ref?, path?, sparsePaths?}` — clones `owner/repo` over SSH (HTTPS in remote mode); official uses `anthropics/claude-plugins-official` |
| **git** *(undocumented)* | `{url, ref?, path?, sparsePaths?}` — HTTPS, SSH (`git@`), or `file://`; validated before clone |
| **url** | `{url}` — direct HTTP/HTTPS fetch of marketplace JSON; GCS fallback for official |
| **npm** | `{package, version?, registry?}` — installed to shared `npm-cache/node_modules/` then copied |
| **file** | `{path}` — local marketplace.json path; excluded from zip-cache |
| **directory** | `{path}` — local marketplace directory; excluded from zip-cache |
| **hostPattern** | Allowlist entry matching by host glob; used in policy-driven marketplace resolution |
| **pathPattern** | Allowlist entry matching by path glob; used in policy-driven marketplace resolution |
| **settings** | Sentinel pointing at a settings-declared marketplace (no network fetch of its own) |

**Official Marketplace:** Implicitly declared when any enabled plugin references it. Auto-clones `anthropics/claude-plugins-official` on first launch.

### Name Validation

The schema enforces two-layer impersonation defense:

```javascript
export const BLOCKED_OFFICIAL_NAME_PATTERN =
  /(?:official[^a-z0-9]*(anthropic|claude)|(?:anthropic|claude)[^a-z0-9]*official|^(?:anthropic|claude)[^a-z0-9]*(marketplace|plugins|official))/i

const NON_ASCII_PATTERN = /[^\u0020-\u007E]/

export function validateOfficialNameSource(name, source): string | null {
  if (source.source === 'github') {
    const repo = source.repo || ''
    if (!repo.toLowerCase().startsWith(`anthropics/`)) {
      return `The name '${name}' is reserved for official Anthropic marketplaces.`
    }
  }
  return null
}
```

Reserved names require `github.com/anthropics/` org source. Non-ASCII characters blocked to prevent homograph attacks.

## Plugin Manifest Schema (`plugin.json`)

Unknown top-level keys are silently stripped; unknown nested keys fail validation.

| Field | Type | Notes |
|-------|------|-------|
| name | string | Kebab-case, no spaces; used for namespacing `/plugin:cmd` |
| version | string? | Semver; highest priority version source |
| description | string? | User-facing text shown in `/plugin list` |
| dependencies | string[]? | Bare names inherit declaring plugin's marketplace; cross-marketplace blocked by default |
| commands | path or path[] or Record | Supplements `commands/` directory; object form supports inline content |
| hooks | path or HooksConfig or array | Supplements `hooks/hooks.json`; supports 20+ lifecycle events |
| mcpServers | path or McpbPath or Record or array | Supports `.mcpb`/`.dxt` bundles or inline config |
| lspServers | path or Record or array | Each: `command`, `extensionToLanguage` map, transport, env, timeouts |
| agents | path or path[] | Additional agent `.md` files beyond `agents/` |
| skills | path or path[] | Additional skill directories containing `SKILL.md` |
| outputStyles | path or path[] | Custom rendering definitions |
| channels | ChannelDecl[] | Messaging channels binding MCP server + prompts |
| userConfig | Record<key, Option> | User-configurable values prompted at enable; sensitive values -> keychain |
| settings | Record? | Merged when plugin enabled; only allowlisted keys kept (currently: `agent`) |
| author / homepage / repository / license / keywords | metadata | Discovery and attribution |

**Example plugin.json:**

```json
{
  "name": "my-plugin",
  "version": "1.2.0",
  "description": "Example plugin",
  "author": { "name": "Acme Corp", "url": "https://acme.example" },
  "license": "MIT",
  "dependencies": ["shared-utils"],
  "commands": {
    "hello": { "content": "Say hello to ${CLAUDE_PLUGIN_ROOT}" },
    "deploy": { "source": "./docs/deploy.md", "argumentHint": "[env]" }
  },
  "hooks": "./hooks/extra.json",
  "mcpServers": "./server.mcpb",
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensionToLanguage": { ".ts": "typescript", ".tsx": "typescriptreact" }
    }
  },
  "userConfig": {
    "API_KEY": {
      "type": "string",
      "title": "API Key",
      "description": "Your service API key",
      "sensitive": true,
      "required": true
    }
  }
}
```

**Plugin Directory Convention:** Without `plugin.json` fields, Claude Code auto-discovers `commands/*.md`, `agents/*.md`, `skills/*/SKILL.md`, `hooks/hooks.json`, and `.mcp.json`.

## Versioned Cache

**Path format:**
```
~/.claude/plugins/cache/{marketplace}/{plugin}/{version}/
```

**Version Priority (from pluginVersioning.ts):**
1. `plugin.json` `version` field (explicit semver, highest authority)
2. Provided version from marketplace entry
3. Pre-resolved git SHA
4. Git commit SHA from `.git/HEAD` (first 12 chars)
5. `'unknown'` fallback

**git-subdir Path Hashing:**
For monorepo plugins, version becomes `{sha12}-{pathHash8}` where path hash is SHA-256 of normalized subdir:
```
normPath = source.path
  .replace(/\\/g, '/')      // backslash -> forward slash
  .replace(/^\.\//, '')      // strip ./
  .replace(/\/+$/, '')       // strip trailing /
pathHash = createHash('sha256').update(normPath).digest('hex').substring(0, 8)
```

**Seed Cache Fallback:**
Enterprise deployments pre-populate `CLAUDE_CODE_PLUGIN_SEED_DIR` (read-only). Loader probes seeds before network fetch for zero-network-on-first-run scenarios.

**Zip Cache Mode:**
When `CLAUDE_CODE_PLUGIN_USE_ZIP_CACHE=1` (headless/container), plugins stored as `.zip` files, extracted to `claude-plugin-session-{hex}/` temp dirs at session start. Unix execute bits preserved via ZIP central directory `external_attr` field.

**Versioned Path Computation:**
```javascript
export function getVersionedCachePathIn(
  baseDir: string,
  pluginId: string,
  version: string,
): string {
  const { name: pluginName, marketplace } = parsePluginIdentifier(pluginId)
  const sanitizedMarketplace = (marketplace || 'unknown').replace(/[^a-zA-Z0-9\-_]/g, '-')
  const sanitizedPlugin    = (pluginName    || pluginId).replace(/[^a-zA-Z0-9\-_]/g, '-')
  const sanitizedVersion   = version.replace(/[^a-zA-Z0-9\-_.]/g, '-')
  return join(baseDir, 'cache', sanitizedMarketplace, sanitizedPlugin, sanitizedVersion)
}
```

## Dependency Resolution

### Install-time: `resolveDependencyClosure()`

DFS walk computing transitive closure with three rules:

1. **Cycle detection** -- DFS stack tracks current path; cycle returns `{ reason: 'cycle' }`
2. **Cross-marketplace block** -- Plugin A from marketplace X cannot auto-install plugin B from marketplace Y (unless Y is on X's `allowCrossMarketplaceDependenciesOn` allowlist)
3. **Already-enabled skip** -- Dependencies already in settings skipped to avoid clobbering version pins; root never skipped

```javascript
export async function resolveDependencyClosure(
  rootId: PluginId,
  lookup: (id: PluginId) => Promise<DependencyLookupResult | null>,
  alreadyEnabled: ReadonlySet<PluginId>,
  allowedCrossMarketplaces: ReadonlySet<string> = new Set(),
): Promise<ResolutionResult> {
  const closure: PluginId[] = []
  const visited = new Set<PluginId>()
  const stack: PluginId[] = []

  async function walk(id, requiredBy) {
    if (id !== rootId && alreadyEnabled.has(id)) return null
    const idMkt = parsePluginIdentifier(id).marketplace
    if (idMkt !== rootMarketplace && !allowedCrossMarketplaces.has(idMkt)) {
      return { ok: false, reason: 'cross-marketplace', dependency: id, requiredBy }
    }
    if (stack.includes(id)) return { ok: false, reason: 'cycle', chain: [...stack, id] }
    if (visited.has(id)) return null
    visited.add(id)
    const entry = await lookup(id)
    if (!entry) return { ok: false, reason: 'not-found', missing: id, requiredBy }
    stack.push(id)
    for (const rawDep of entry.dependencies ?? []) {
      const dep = qualifyDependency(rawDep, id)
      const err = await walk(dep, id)
      if (err) return err
    }
    stack.pop()
    closure.push(id)
    return null
  }
  const err = await walk(rootId, rootId)
  if (err) return err
  return { ok: true, closure }
}
```

### Load-time: `verifyAndDemote()`

**Fixed-point loop** run every session start. Demoting plugin A (missing dependency) may expose plugin B depends on A, requiring B demotion. Loop repeats until no changes occur.

**Apt-style semantics:** Dependencies are _presence guarantees_, not code imports.

### Dependency Name Resolution

| Input | Context | Output |
|-------|---------|--------|
| `'shared-utils'` | From plugin `acme@acme-mkt` | `'shared-utils@acme-mkt'` (qualified) |
| `'shared-utils@acme-mkt'` | Already qualified | `'shared-utils@acme-mkt'` (unchanged) |
| `'shared-utils'` | From `--plugin-dir` plugin | `'shared-utils'` (@inline sentinel, unchanged) |

## Command, Skill, and Hook Loading

Commands in `commands/*.md` become slash commands: `/plugin-name:command-name`. Subdirectories create namespaces: `commands/ci/build.md` -> `/my-plugin:ci:build`.

Skills: Directories containing `SKILL.md`. Parent directory name becomes skill name; `${CLAUDE_SKILL_DIR}` injected.

### Variable Substitution

| Variable | Resolves to |
|----------|-------------|
| ${CLAUDE_PLUGIN_ROOT} | Absolute path to plugin's installed directory |
| ${CLAUDE_PLUGIN_DATA} | Plugin's writable data directory |
| ${CLAUDE_SKILL_DIR} | This skill's subdirectory (skill mode only) |
| ${CLAUDE_SESSION_ID} | Current session identifier |
| ${user_config.KEY} | User-configured option (sensitive keys -> placeholder) |

### All Lifecycle Events
```
PreToolUse | PostToolUse | PostToolUseFailure | PermissionDenied
Notification | UserPromptSubmit | SessionStart | SessionEnd | Stop | StopFailure
SubagentStart | SubagentStop | PreCompact | PostCompact
PermissionRequest | Setup | TeammateIdle
TaskCreated | TaskCompleted | Elicitation | ElicitationResult
ConfigChange | WorktreeCreate | WorktreeRemove
InstructionsLoaded | CwdChanged | FileChanged
```

## Security and Policy

Enterprise admins force-disable plugins via `managed-settings.json`. `isPluginBlockedByPolicy()` is the single source of truth.

### Installation Scopes

| Scope | Location | Notes |
|-------|----------|-------|
| **user** | `~/.claude/settings.json` | Active in all projects |
| **project** | `.claude/settings.json` | Committed to repo |
| **local** | `.claude/settings.local.json` | Not committed |
| **managed** | `managed-settings.json` | Read-only to users |

### Reverse Dependency Detection

```javascript
export function findReverseDependents(pluginId, plugins): string[] {
  const { name: targetName } = parsePluginIdentifier(pluginId)
  return plugins
    .filter(p => p.enabled && p.source !== pluginId &&
      (p.manifest.dependencies ?? []).some(d => {
        const qualified = qualifyDependency(d, p.source)
        return parsePluginIdentifier(qualified).marketplace
          ? qualified === pluginId : qualified === targetName
      }))
    .map(p => p.name)
}
```

## Background Autoupdate

**Non-in-place:** New version cached at new versioned path; running session continues with old path. REPL notified via `onPluginsAutoUpdated()`.

**Race Condition Handling:** Module stores notification in `pendingNotification`, delivered when handler eventually called.

---

# LESSON 10: THE HOOKS SYSTEM

## Core Files
- Hook event definitions: `src/entrypoints/sdk/coreTypes.ts` (`HOOK_EVENTS` const array)
- Execution logic: `src/utils/hooks.ts` and `src/utils/hooks/exec*Hook.ts`
- Configuration: `src/utils/hooks/hooksConfigSnapshot.ts`
- Metadata: `hooksConfigManager.ts -> getHookEventMetadata()`
- Session hooks: `sessionHooks.ts`
- Hook events (telemetry): `hookEvents.ts`

## All 27 Hook Events (Categorized)

**Lifecycle:** SessionStart, SessionEnd, Setup, Stop, StopFailure
**Tool execution:** PreToolUse, PostToolUse, PostToolUseFailure
**Agent/subagent:** SubagentStart, SubagentStop
**Compaction:** PreCompact, PostCompact
**Permission/policy:** PermissionRequest, PermissionDenied, UserPromptSubmit, ConfigChange, InstructionsLoaded
**Collaborative:** TeammateIdle, TaskCreated, TaskCompleted, Notification
**Filesystem:** CwdChanged, FileChanged, WorktreeCreate, WorktreeRemove
**MCP elicitation:** Elicitation, ElicitationResult

## Exit Code Semantics

**Critical Design:** Exit code 2 = model-visible blocking; other non-zero = user-visible only; exit 0 = silent success

**PreToolUse:** 0=proceed silently, 2=block tool+stderr to model, other=proceed+stderr to user
**PostToolUse:** 0=stdout in transcript, 2=stderr to model, other=stderr to user
**Stop:** 0=conclude silently, 2=prevent stop+stderr to model, other=conclude+stderr to user
**UserPromptSubmit:** 0=stdout injected to model, 2=block+erase prompt, other=stderr to user
**SessionStart/Setup:** 0=stdout as seed context, 2=ignored, other=stderr to user
**PreCompact:** 0=stdout as custom compact instructions, 2=block compaction
**CwdChanged/FileChanged:** No exit code 2 blocking; set `CLAUDE_ENV_FILE`

## Five Hook Command Types

### 1. `command` (Shell subprocess)
Options: `if`, `timeout`, `once`, `async`, `asyncRewake`, `statusMessage`, `shell`

### 2. `prompt` (LLM prompt)
Uses `$ARGUMENTS` placeholder. Model responds `{"ok": true}` or `{"ok": false, "reason": "..."}`.
Options: `if`, `timeout` (30s), `model`, `once`, `statusMessage`
Uses `queryModelWithoutStreaming` -- does NOT trigger UserPromptSubmit hooks.

### 3. `agent` (Agentic verifier)
Up to 50 turns with tool access. Calls `StructuredOutput` tool. Disallows AgentTool/plan mode.
Options: `if`, `timeout` (60s), `model`, `once`, `statusMessage`

```typescript
addFunctionHook(setAppState, sessionId, 'Stop', '',
  messages => hasSuccessfulToolCall(messages, SYNTHETIC_OUTPUT_TOOL_NAME),
  `You MUST call the ${SYNTHETIC_OUTPUT_TOOL_NAME} tool...`,
  { timeout: 5000 }
)
```

### 4. `http` (HTTP POST)
Supports env var interpolation in headers. SSRF guard blocks private IPs; loopback allowed.
Options: `if`, `timeout` (10 min), `headers`, `allowedEnvVars`, `once`, `statusMessage`

### 5. `function` (TypeScript callback)
In-process via `addFunctionHook()`. Session-scoped only.
Options: `id`, `timeout` (5s), `errorMessage`

## Configuration Sources (6 total, merged)

1. `userSettings` - `~/.claude/settings.json`
2. `projectSettings` - `.claude/settings.json`
3. `localSettings` - `.claude/settings.local.json`
4. `policySettings` - MDM/managed (enterprise admin)
5. `pluginHook` - `~/.claude/plugins/*/hooks/hooks.json`
6. `sessionHook` - In-memory only

**Policy powers:** `allowManagedHooksOnly: true` suppresses user/project/local/plugin hooks. `disableAllHooks: true` kills even managed hooks.

## Session Hooks API

```typescript
addSessionHook(setAppState, sessionId, 'Stop', '', { type: 'command', command: './verify.sh' })

const hookId = addFunctionHook(setAppState, sessionId, 'Stop', '',
  (messages, signal) => checkCondition(messages), 'Condition not met',
  { timeout: 5000, id: 'my-hook' })

removeFunctionHook(setAppState, sessionId, 'Stop', hookId)
```

**Non-Reactive Design:** Map mutation (not state update) prevents re-renders in parallel agent workflows.

## Async and asyncRewake

`async: true` -- hook launches, model doesn't wait; tracked in `AsyncHookRegistry`
`asyncRewake: true` -- background hook wakes model if exits with code 2

## HTTP Hooks Security (Three Layers)

1. **URL Allowlist:** `allowedHttpHookUrls` glob patterns
2. **Env Var Allowlist:** Only `allowedEnvVars` resolved; others -> empty string
3. **SSRF Guard:** Blocks private IPs; allows loopback; sanitizes CR/LF/NUL in headers

## The `if` Filter Field

Permission rule syntax: `"Bash(git *)"`, `"Read(*.ts)"`. Part of hook identity -- same command with different `if` = distinct hooks.

## Hook Event Bus (SDK Telemetry)

Three events: `started`, `progress` (1s interval), `response`. Up to 100 events buffered before handler attaches. SessionStart/Setup always emitted.

## Real-World Patterns

```json
// Lint-on-write guard
{ "PreToolUse": [{ "matcher": "Write", "hooks": [{ "type": "command",
  "command": "jq -e '.tool_input.file_path | test(\"test.*\\.ts$\")' <<< \"$CLAUDE_HOOK_INPUT\" && echo 'Must write tests' >&2 && exit 2 || exit 0" }]}]}

// Session context injection
{ "SessionStart": [{ "matcher": "startup", "hooks": [{ "type": "command",
  "command": "echo \"Today is $(date). Open PRs: $(gh pr list --json number | jq length)\"" }]}]}

// Stop verification with agent
{ "Stop": [{ "hooks": [{ "type": "agent",
  "prompt": "Verify implementation includes unit tests...", "timeout": 120 }]}]}

// .envrc auto-load
{ "CwdChanged": [{ "hooks": [{ "type": "command",
  "command": "[ -f .envrc ] && direnv export bash >> \"$CLAUDE_ENV_FILE\" || true" }]}]}

// LLM policy check
{ "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "prompt",
  "prompt": "The following bash command is about to run: $ARGUMENTS\nReturn ok: true only if not destructive...",
  "model": "claude-sonnet-4-6" }]}]}
```

---

# LESSON 44: ERROR HANDLING AND RECOVERY

## Four-Layer Architecture

1. **Typed Error Classes** (`utils/errors.ts`)
2. **API Retry Engine** (`services/api/withRetry.ts`)
3. **Terminal Error Overlay** (`ink/components/ErrorOverview.tsx`)
4. **Conversation Recovery** (`utils/conversationRecovery.ts`)

## Error Taxonomy

| Class | Purpose | Key Fields |
|-------|---------|-----------|
| `ClaudeError` | Base class | -- |
| `AbortError` | User cancellation (Esc/Ctrl-C) | `name = 'AbortError'` |
| `MalformedCommandError` | Slash-command parsing | -- |
| `ConfigParseError` | Corrupt config | `filePath`, `defaultConfig` |
| `ShellError` | Non-zero exit codes | `stdout`, `stderr`, `code`, `interrupted` |
| `TeleportOperationError` | SSH operations | `formattedMessage` |
| `TelemetrySafeError_I_VERIFIED_...` | Safe-to-telemetry | `telemetryMessage` |

### Three-Way Abort Check

```typescript
export function isAbortError(e: unknown): boolean {
  return (
    e instanceof AbortError ||
    e instanceof APIUserAbortError ||
    (e instanceof Error && e.name === 'AbortError')
  )
}
```

### Normalization Helpers

```typescript
export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
export function shortErrorStack(e: unknown, maxFrames = 5): string { /* truncate to 5 frames */ }
```

### Filesystem Error Helpers

```typescript
export function getErrnoCode(e: unknown): string | undefined
export function isFsInaccessible(e: unknown): e is NodeJS.ErrnoException
// Covers: ENOENT | EACCES | EPERM | ENOTDIR | ELOOP
```

## Tool Error Formatting

```typescript
export function formatError(error: unknown): string {
  // Center-truncate at 10,000 chars: 5k head + 5k tail
  if (fullMessage.length <= 10000) return fullMessage
  const halfLength = 5000
  return `${fullMessage.slice(0, halfLength)}\n\n...truncated...\n\n${fullMessage.slice(-halfLength)}`
}
```

Zod validation errors converted to LLM-friendly structured English.

## Error Log Sink

Buffered JSONL writer to `~/.cache/claude/errors/DATE.jsonl`. Guarded on `process.env.USER_TYPE !== 'ant'` (Anthropic internal only).

## API Retry Engine

### Retry Delay Formula

```typescript
export function getRetryDelay(attempt, retryAfterHeader?, maxDelayMs = 32000): number {
  if (retryAfterHeader) return parseInt(retryAfterHeader, 10) * 1000
  const baseDelay = Math.min(500 * Math.pow(2, attempt - 1), maxDelayMs)
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}
```

### 529 Overload Handling
Background queries bail immediately on 529. After 3 consecutive 529s on Opus, fallback to configured model.

### Context Overflow Auto-Adjustment
Floor of 3,000 tokens. If that doesn't fit, error re-thrown.

### 10+ Failure Modes Handled
529 model fallback, context overflow, OAuth refresh (401/403), Bedrock/Vertex auth clearing, exponential backoff, abort propagation, fast mode cooldown, background bailout.

### Persistent Retry Mode
`CLAUDE_CODE_UNATTENDED_RETRY=1`: max backoff 5 min, total cap 6 hours, 30s heartbeat yields.

## Conversation Recovery

### Four-Stage Deserialization
1. Legacy Migration (old attachment types)
2. Strip Bad Permission Modes
3. Filter Invalid Messages (unresolved tool_use, orphaned thinking, whitespace-only)
4. Interrupt Detection (none / interrupted_prompt / interrupted_turn)

### Interruption Classification

```typescript
if (lastMessage.type === 'assistant') return { kind: 'none' }
if (lastMessage.type === 'user' && !isToolUseResultMessage(lastMessage))
  return { kind: 'interrupted_prompt', message: lastMessage }
if (isToolUseResultMessage(lastMessage)) {
  if (isTerminalToolResult(lastMessage, messages, lastMessageIdx)) return { kind: 'none' }
  return { kind: 'interrupted_turn' }
}
```

### Synthetic Continuation
`interrupted_turn` -> inject `'Continue from where you left off.'` user message -> unified as `interrupted_prompt`.

---

# LESSON 20: BRIDGE AND REMOTE CONTROL

## Architecture Overview

Local REPL <-> claude.ai web front-end through bidirectional messaging. OAuth for bridge API; short-lived JWT for CCR worker endpoints.

## Bridge v1 vs v2

**v1 (Environment-Based):** POST /v1/environments -> poll for work -> decode WorkSecret -> ack/heartbeat. HybridTransport (WS reads + HTTP POSTs).

**v2 (Environment-Less):** POST /v1/code/sessions -> /bridge -> worker JWT + epoch. SSETransport reads + CCRClient writes. Gated by GrowthBook flag.

### WorkSecret (v1)

```typescript
type WorkSecret = {
  version: 1
  session_ingress_token: string
  api_base_url: string
  sources: Array<{ type: string; git_info?: ... }>
  auth: Array<{ type: string; token: string }>
  use_code_sessions?: boolean
}
```

## Session ID Compatibility

```typescript
export function toCompatSessionId(id: string): string {
  if (!id.startsWith('cse_')) return id
  return 'session_' + id.slice('cse_'.length)
}
export function toInfraSessionId(id: string): string {
  if (!id.startsWith('session_')) return id
  return 'cse_' + id.slice('session_'.length)
}
export function sameSessionId(a: string, b: string): boolean {
  const aBody = a.slice(a.lastIndexOf('_') + 1)
  const bBody = b.slice(b.lastIndexOf('_') + 1)
  return aBody.length >= 4 && aBody === bBody
}
```

## Transport Layer

```typescript
export type ReplBridgeTransport = {
  write(message: StdoutMessage): Promise<void>
  writeBatch(messages: StdoutMessage[]): Promise<void>
  close(): void
  isConnectedStatus(): boolean
  getLastSequenceNum(): number  // v1=0, v2=SSE high-water
  reportState(state: SessionState): void
  reportDelivery(id: string, s: 'processing'|'processed'): void
  flush(): Promise<void>
}
```

**v2 ACK pattern:** Report both 'received' and 'processed' immediately to prevent phantom prompt floods (CC-1263).

**Epoch mismatch (409):** Second worker registered -> old transport closes with code 4090 -> poll loop recovers.

## FlushGate

```typescript
class FlushGate<T> {
  start(): void       // mark flush in-progress
  end(): T[]          // return queued items
  enqueue(...items: T[]): boolean
  drop(): number      // discard queue
  deactivate(): void  // transport swapped
}
```

## Permission Bridge Protocol

`control_request` -> `control_response` (allow/deny + updatedInput) -> `control_cancel_request`

## Standalone Bridge

SpawnModes: `single-session`, `worktree`, `same-dir`

Backoff: connInitial=2s, connCap=2min, giveUp=10min. Session timeout: 24h.

```typescript
type SessionHandle = {
  sessionId: string
  done: Promise<SessionDoneStatus>
  kill(): void
  forceKill(): void
  activities: SessionActivity[]
  writeStdin(data: string): void
  updateAccessToken(token: string): void
}
```

Worker types: `"claude_code"`, `"claude_code_assistant"`, `"cowork"`

## Key Design Patterns

- Asymmetric transport (v2): SSE inbound, CCRClient outbound
- JWT validation boundary: OAuth for bridge API, JWT for CCR worker
- Epoch-based worker identity: 409 = epoch mismatch
- Cursor-based replay (v1) vs sequence-based replay (v2)

---

# LESSON 25: OAUTH AUTHENTICATION

## Architecture

OAuth 2.0 Authorization Code + PKCE. Three layers: crypto primitives, network client, orchestrator.
Two targets: Console (`platform.claude.com`) for API, Claude.ai (`claude.com/cai`) for subscribers.

## PKCE Primitives

```typescript
export function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32))
}
export function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(createHash('sha256').update(verifier).digest())
}
export function generateState(): string {
  return base64URLEncode(randomBytes(32))
}
```

## OAuth Flow

1. Start localhost callback server (port 0 = OS picks)
2. Build automatic + manual URLs from same PKCE values
3. Race: automatic (localhost redirect) vs manual (paste code)
4. Exchange code for tokens (redirect_uri must match exactly)
5. Fetch profile (subscription type, rate limit tier)
6. Redirect browser to success, cleanup

## Scopes

```
org:create_api_key  user:profile  user:inference  user:sessions:claude_code  user:mcp_servers  user:file_upload
```

`shouldUseClaudeAIAuth(scopes)` checks for `user:inference`.

## Token Storage

| Platform | Primary | Fallback |
|----------|---------|----------|
| macOS | macOS Keychain (`security` CLI) | plainText encrypted JSON |
| Linux | plainTextStorage | -- |
| Windows | plainTextStorage | -- |

**macOS security:** Hex encoding (avoid shell quoting + CrowdStrike), stdin for payloads <4032 bytes, stale-while-error cache.

## Token Refresh

5-minute buffer window. Profile skip optimization: skip `/api/oauth/profile` if all fields cached (saves ~7M requests/day fleet-wide).

Backend `ALLOWED_SCOPE_EXPANSIONS` allows refresh grants to include new scopes without re-login.

## Logout

1. Flush telemetry BEFORE clearing credentials (preserve org attribution)
2. Wipe secure storage
3. Clear all auth-dependent caches (OAuth, trusted device, betas, schemas, user data, GrowthBook, Grove, policy)
4. Update global config

## Authorization URL

```typescript
authUrl.searchParams.append('code', 'true')  // Claude Max upsell flag
authUrl.searchParams.append('code_challenge_method', 'S256')
// Optional: login_hint, login_method, orgUUID
```

## Enterprise/FedStart

`CLAUDE_CODE_CUSTOM_OAUTH_URL` with strict allowlist: beacon staging, claude.fedstart.com, claude-staging.fedstart.com.

---

# LESSON 28: GIT INTEGRATION

## Design Philosophy: Filesystem-First

Read `.git/` files directly via Node fs APIs -- never subprocess calls. Eliminates startup latency.

## Config Parser

```typescript
export async function parseGitConfigValue(
  gitDir: string, section: string, subsection: string | null, key: string
): Promise<string | null>
```

Sections/keys: case-insensitive. Subsections: case-sensitive. Supports unquoted/partially/fully quoted values. Known escapes: `\n`, `\t`, `\b`, `\\`, `\"`. Unknown: backslash dropped silently.

## Git Filesystem Reading

### resolveGitDir
Handles worktrees/submodules where `.git` is a file containing `gitdir: <path>`.

### readGitHead
| HEAD Content | Return |
|---|---|
| `ref: refs/heads/main` | `{ type: 'branch', name: 'main' }` |
| 40-hex SHA | `{ type: 'detached', sha: '...' }` |
| Anything else | `null` |

### resolveRef
1. Loose ref file -> 2. packed-refs -> 3. commonDir fallback (worktrees)

## GitFileWatcher

Watches: `.git/HEAD`, `.git/config`, `.git/refs/heads/<branch>`.

**Dirty-bit pattern:** Clear dirty BEFORE async compute; if file changes during compute, dirty re-set prevents stale writes.

Public API: `getCachedBranch()`, `getCachedHead()`, `getCachedRemoteUrl()`, `getCachedDefaultBranch()`

Default branch cascade: origin/HEAD symref -> origin/main -> origin/master -> "main"

## Security: Ref Validation

```typescript
export function isSafeRefName(name: string): boolean {
  if (!name || name.startsWith('-') || name.startsWith('/')) return false
  if (name.includes('..')) return false
  return /^[a-zA-Z0-9/._+@-]+$/.test(name)
}
export function isValidGitSha(s: string): boolean {
  return /^[0-9a-f]{40}$/.test(s) || /^[0-9a-f]{64}$/.test(s)
}
```

## Operation Tracking

```typescript
function gitCmdRe(subcmd: string, suffix = ''): RegExp {
  return new RegExp(`\\bgit(?:\\s+-[cC]\\s+\\S+|\\s+--\\S+=\\S+)*\\s+${subcmd}\\b${suffix}`)
}
```

Detects: commit (SHA from `[branch abc1234] msg`), push (branch from ref update), merge/rebase (from output text), PR (gh/glab/curl).

PR auto-linking via dynamic import (breaks circular dependency). PR URL regex: `/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/`

## GitHub Auth

`gh auth token` (local keyring only, no network). `stdout: 'ignore'` discards token at OS level.

## Gitignore

Global `~/.config/git/ignore` with `**/${filename}` rules. Never modifies individual repos.

---

# LESSON 36: UPSTREAM PROXY SYSTEM

## Architecture

CCR containers route outbound HTTPS through MITM-capable WebSocket tunnel. Session token never exposed to agent loop.

## Initialization (6 steps)

1. Environment guards (`CLAUDE_CODE_REMOTE` + `CCR_UPSTREAM_PROXY_ENABLED`)
2. Read `/run/ccr/session_token`
3. `prctl(PR_SET_DUMPABLE, 0)` via Bun FFI (blocks ptrace)
4. Download CA cert -> `~/.ccr/ca-bundle.crt`
5. Start relay (ephemeral TCP port)
6. Delete session_token after relay confirms listening

## CONNECT-over-WebSocket Relay

**Phase 1:** Accumulate CONNECT header (reject >8192 bytes). Parse host:port, open WS tunnel.
**Phase 2:** Pump bytes to WebSocket. Buffer in `st.pending[]` if WS not open yet.

### Protobuf Encoding

```typescript
// message UpstreamProxyChunk { bytes data = 1; }
export function encodeChunk(data: Uint8Array): Uint8Array {
  // tag 0x0a + varint length + data
}
```

## Runtime Dispatch

Bun vs Node detected via `typeof Bun !== 'undefined'`.

**Bun backpressure:** `sock.write()` silently drops remainder. Must track `writeBuf: Uint8Array[]` and drain on callback.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `HTTPS_PROXY` / `https_proxy` | Route through relay |
| `NO_PROXY` / `no_proxy` | Bypass (loopback, RFC1918, Anthropic, GitHub, npm, PyPI, crates) |
| `SSL_CERT_FILE` | OpenSSL/curl |
| `NODE_EXTRA_CA_CERTS` | Node.js |
| `REQUESTS_CA_BUNDLE` | Python |
| `CURL_CA_BUNDLE` | curl |

Only `HTTPS_PROXY` set, never `HTTP_PROXY`. Anthropic domains listed three ways for cross-runtime compatibility.

## Security

- `prctl(PR_SET_DUMPABLE, 0)` prevents ptrace
- Dual auth: WS upgrade (Bearer token) + CONNECT tunnel (Proxy-Authorization Basic)
- TLS corruption guard: after `st.established`, errors -> TCP close without plaintext response

## Keepalive and Chunking

30s keepalive (zero-length chunks) vs 50s sidecar timeout. Max chunk: 512KB (Envoy buffer cap).

## ConnState Guards

`wsOpen`, `established`, `closed`, `pending[]` -- each prevents a specific class of race condition.

---

# LESSON 43: CRON AND TASK SCHEDULING

## Five Layers

1. Tools: CronCreate/Delete/List
2. Core: cronScheduler.ts (tick loop, lock, jitter)
3. Storage: JSON file + session memory
4. React: useScheduledTasks hook
5. Fleet: cronJitterConfig.ts (GrowthBook)

## CronTask Model

```typescript
export type CronTask = {
  id: string, cron: string, prompt: string, createdAt: number,
  lastFiredAt?: number, recurring?: boolean, permanent?: boolean,
  durable?: boolean, agentId?: string
}
```

## Scheduler State Machine

Polling -> Enabling -> Running (1s `setInterval`). Lock via PID-based liveness probing.

## Jitter System

**Stable per-task fraction:** `parseInt(taskId.slice(0,8), 16) / 0x1_0000_0000`

**Recurring (forward jitter):** Up to `recurringFrac * interval`, capped at `recurringCapMs`.
**One-shot (backward jitter):** Fire slightly early; only on `:00`/`:30` minutes.

| Parameter | Default |
|-----------|---------|
| recurringFrac | 0.1 |
| recurringCapMs | 15 min |
| oneShotMaxMs | 90s |
| oneShotMinuteMod | 30 |
| recurringMaxAgeMs | 7 days |

## Tools

**CronCreate:** Validates cron against 366 days. Max 50 jobs. Teammates cannot create durable crons.
**CronDelete:** Validates ownership. Teammate isolation enforced.
**CronList:** Merged disk + session. Teammates see own; lead sees all.

## REPL Integration

Fired prompts queue at `priority: 'later'` with `WORKLOAD_CRON` (lower QoS). Drains between turns.

## Missed Tasks

One-shot: surfaced with injection-resistant code fence (fence length > longest backtick run in prompt). Deleted before model sees notification.
Recurring: NOT surfaced; check() loop handles correctly.

## Feature Gates

Build-time: `feature('AGENT_TRIGGERS')`. Runtime: `CLAUDE_CODE_DISABLE_CRON=1`, `tengu_kairos_cron`, `tengu_kairos_cron_durable`, `tengu_kairos_cron_config` (GrowthBook JSON for live jitter tuning).

---

# LESSON 27: VOICE SYSTEM

## Architecture

Push-to-talk pipeline: audio recording -> WebSocket STT -> transcript injection.

Files: `voice/voiceModeEnabled.ts`, `services/voice.ts`, `services/voiceStreamSTT.ts`, `hooks/useVoice.ts`, `hooks/useVoiceIntegration.tsx`

## Feature Gating

Double-gated: GrowthBook `VOICE_MODE` flag + OAuth auth (claude.ai only, not API keys/Bedrock/Vertex).

Preflight: isVoiceModeEnabled -> checkRecordingAvailability -> isVoiceStreamAvailable -> checkVoiceDependencies -> requestMicrophonePermission

## Audio Backends (Priority Order)

1. **audio-capture-napi** (macOS/Linux/Windows): In-process via cpal. ~1s warm, ~8s cold.
2. **arecord** (Linux): 150ms runtime probe.
3. **SoX** (macOS/Linux): External process. Args: `-q --buffer 1024 -t raw -r 16000 -e signed -b 16 -c 1 -`

## WebSocket STT Protocol

URL: `wss://api.anthropic.com/api/ws/speech_to_text/voice_stream`
Params: encoding=linear16, sample_rate=16000, channels=1, endpointing_ms=300, utterance_end_ms=1000

Messages: KeepAlive (8s), Binary PCM, CloseStream -> TranscriptText, TranscriptEndpoint, TranscriptError

Finalize sources: post_closestream_endpoint (~300ms), no_data_timeout (1.5s), ws_close (3-5s), safety_timeout (5s)

## Hold-to-Talk

```typescript
const RAPID_KEY_GAP_MS = 120
const HOLD_THRESHOLD = 5
const WARMUP_THRESHOLD = 2
const RELEASE_TIMEOUT_MS = 200
const REPEAT_FALLBACK_MS = 600
```

State machine: idle -> recording (synchronous before any await) -> processing -> idle

## Silent-Drop Replay

6 conditions: no_data_timeout + hadAudioSignal + wsConnected + !focusTriggered + empty transcript + !retried. Replays full audio buffer with 250ms delay.

## Focus Mode

Continuous recording on focus gain, stop on focus loss. 5s silence timeout. Each chunk flushed immediately (vs accumulated in hold-to-talk). No replay.

## Language and Keyterms

Normalization cascade: exact code -> name -> base language -> 'en'. Up to 50 keyterms boosted (hardcoded tech terms + project name + git branch words).

## Audio Levels

```typescript
export function computeLevel(chunk: Buffer): number {
  // RMS of 16-bit PCM, normalized to [0,1], sqrt-spread for quieter visibility
  return Math.sqrt(Math.min(rms / 2000, 1))
}
```

---

# LESSON 45: BUDDY COMPANION SYSTEM

## Overview

Unreleased Tamagotchi virtual pet. `feature('BUDDY')` flag. Six files in `src/buddy/`. Launch window: April 1-7, 2026 (local time).

## Bones/Soul Split

**Bones** (deterministic from userId): species, eye, hat, rarity, shiny, stats. Never stored. Regenerated via `hash(userId + SALT)`.

**Soul** (stored): name, personality, hatchedAt. AI-generated once.

**Merge:** `{ ...stored, ...bones }` -- fresh bones always override.

## Mulberry32 PRNG

```typescript
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

Seed: `hashString(userId + 'friend-2026-401')` using FNV-1a (or Bun.hash).

## Rarity

| Rarity | Weight | Stat Floor | Hat |
|--------|--------|------------|-----|
| Common | 60 | 5 | Never |
| Uncommon | 25 | 15 | Yes |
| Rare | 10 | 25 | Yes |
| Epic | 4 | 35 | Yes |
| Legendary | 1 | 50 | Yes |

Shiny: 1-in-100 (1-in-10,000 for legendary shiny).

## Stats

DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK. One peak (floor+50+rand*30), one dump (floor-10+rand*15), three scattered (floor+rand*40).

## Species (18 total)

duck, goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit, mushroom, chonk.

All hex-encoded at runtime to avoid build canary false positives.

Eyes: dot, star, x, circle, at, degree
Hats: none, crown, tophat, propeller, halo, wizard, beanie, tinyduck

## Sprite Engine

3 frames per species, 5 lines x 12 cols. Eye substitution `{E}`. Hat injection on blank top row. Blank row dropped if species never uses it and no hat.

## Animation

```typescript
const TICK_MS = 500
const BUBBLE_SHOW = 20  // ~10s
const FADE_WINDOW = 6   // ~3s
const PET_BURST_MS = 2500
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0]
```

Excited mode: cycle all frames. Idle mode: follow weighted sequence. -1 = blink.

Below 100 columns: collapse to one-line face + truncated speech (24 chars).

## Context Injection

`companionIntroText()` tells the model about the pet. Deduped per conversation via `companion_intro` attachment check.

## Launch Strategy

Teaser window: April 1-7, 2026 (local time). Rainbow `/buddy` notification for 15s during teaser. Local-time rollout sustains social media buzz + distributes soul-gen load.

## Anti-Cheat

All bones (rarity/species/stats) derived from userId hash, never stored. Users cannot edit config.

---

# END OF 10-LESSON EXTRACTION
