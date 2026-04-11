Updated: 2026-03-31 | Compiled Reference
Created: 2026-03-31

# Claude Code Source Deep Dive -- Complete Technical Extraction (10 Lessons)

Source: https://www.markdown.engineering/learn-claude-code/

---

## TABLE OF CONTENTS

1. [Lesson 01 -- Boot Sequence](#lesson-01----boot-sequence)
2. [Lesson 04 -- Query Engine & LLM API](#lesson-04----query-engine--llm-api)
3. [Lesson 12 -- State Management](#lesson-12----state-management)
4. [Lesson 39 -- System Prompt Construction](#lesson-39----system-prompt-construction)
5. [Lesson 50 -- Architecture Overview (Capstone)](#lesson-50----architecture-overview-capstone)
6. [Lesson 02 -- Tool System](#lesson-02----tool-system)
7. [Lesson 17 -- Bash Tool](#lesson-17----bash-tool)
8. [Lesson 18 -- File Tools (Read, Write, Edit)](#lesson-18----file-tools-read-write-edit)
9. [Lesson 19 -- Search Tools (Glob & Grep)](#lesson-19----search-tools-glob--grep)
10. [Lesson 07 -- MCP System](#lesson-07----mcp-system)

---

# LESSON 01 -- BOOT SEQUENCE

## Source Files

- `entrypoints/cli.tsx` -- CLI entrypoint with fast-path dispatch
- `main.tsx` -- Commander parsing and initialization
- `setup.ts` -- Session wiring and configuration
- `bootstrap/state.ts` -- Global session state management
- `replLauncher.tsx` -- REPL component mounting
- `ink.ts` -- React TUI rendering wrapper

## Three-Layer Architecture

**Layer 1: CLI Entrypoint** (`cli.tsx`) -- Zero-cost fast paths, environment preparation, argument dispatch

**Layer 2: Main Function** (`main.tsx`) -- Commander argument parsing, initialization, migrations, permission validation

**Layer 3: Setup + REPL** (`setup.ts` + `replLauncher.tsx`) -- Session wiring, Ink-based React component rendering

## Phase 1: CLI Entrypoint Design

The entrypoint uses deliberate thin bootstrapping with dynamic imports. Fast paths like `--version`, `--daemon-worker`, and `--claude-in-chrome-mcp` return without loading the heavy CLI surface.

```typescript
// Fast path requiring zero imports
const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
  console.log(`${MACRO.VERSION} (Claude Code)`)
  return
}

// All other paths load the startup profiler
const { profileCheckpoint } = await import('../utils/startupProfiler.js')
profileCheckpoint('cli_entry')
```

The CLI handles environment mutations that must occur before module evaluation:
- COREPACK pinning disabled via `COREPACK_ENABLE_AUTO_PIN=0`
- CCR containers receive 8 GB heap cap through `NODE_OPTIONS`

## Phase 2: Parallel Prefetch Side-Effects

Top-level side effects in `main.tsx` execute before other imports, marked with explicit ESLint disable comments:

```typescript
profileCheckpoint('main_tsx_entry')   // timestamp module eval start
startMdmRawRead()                      // MDM policy subprocesses
startKeychainPrefetch()                // macOS keychain reads
```

MDM reads via `plutil`/`reg query` take 20-40ms each. Keychain reads require ~65ms on macOS when done synchronously. By firing these during module evaluation (~135ms), they run concurrently with imports and results are cached when needed.

The `applySafeConfigEnvironmentVariables()` function inside `init()` depends on MDM policy being loaded. By starting the read at module-eval time, the subprocess completes before `ensureMdmSettingsLoaded()` is called.

## Phase 3: Commander Argument Parsing

After imports load, `eagerLoadSettings()` processes `--settings` and `--setting-sources` flags before Commander runs, then `parse()` resolves:
- Working directory (`cwd`)
- Permission mode
- Model selection
- Session resumption flags
- MCP server configuration
- Numerous other flags

```typescript
// Migrations run once per config version bump
const CURRENT_MIGRATION_VERSION = 11
function runMigrations(): void {
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    migrateAutoUpdatesToSettings()
    migrateSonnet45ToSonnet46()
    migrateOpusToOpus1m()
    // ...8 more migration functions...
    saveGlobalConfig(prev => ({ ...prev, migrationVersion: CURRENT_MIGRATION_VERSION }))
  }
}
```

**Gotcha:** Migrations run on every process start but are gated by version. Downgrading Claude Code leaves the migration version advanced, preventing re-runs and causing subtle config inconsistencies.

## Phase 4: Session Wiring (`setup.ts`)

The `setup()` function performs checks in carefully ordered sequence:

1. Node.js >= 18 version gate
2. Custom session ID via `switchSession()` if `--session` provided
3. UDS (Unix Domain Socket) messaging server startup for hook process discovery
4. Teammate/swarm snapshot capture (non-bare mode only)
5. iTerm2 and Terminal.app restoration for interrupted setups
6. **`setCwd(cwd)` call** -- must precede filesystem-dependent operations
7. Hooks config snapshot reading `.claude/settings.json` from new cwd
8. FileChanged hook watcher initialization
9. Optional worktree creation and tmux session setup
10. Background jobs: `initSessionMemory()`, `getCommands()` prefetch, plugin hooks
11. `initSinks()` -- attaches analytics and error sinks, drains queued events
12. `logEvent('tengu_started')` -- first reliable "process started" beacon
13. API key prefetch (safe path only)
14. Release notes check and recent activity fetch
15. Permission safety checks (root/sudo guard, Docker sandbox gate)
16. Previous session exit metrics logging from `projectConfig`

```typescript
// Critical ordering: setCwd must precede hooks snapshot
setCwd(cwd)

// IMPORTANT: Must be called AFTER setCwd()
// so hooks are loaded from correct directory
captureHooksConfigSnapshot()
```

**The `tengu_started` beacon:** Placed immediately after `initSinks()` before any parsing, fetching, or I/O that could throw. This ensures the session-success-rate denominator is recorded even when downstream code fails. Source comments reference incident `inc-3694` where a crash in `checkForReleaseNotes()` meant every subsequent event was lost.

**Bare mode (`--bare` / `CLAUDE_CODE_SIMPLE`):** Strips non-essential startup for scripted/SDK calls. Skipped components include:
- UDS messaging server (no hook injection)
- Teammate snapshot (swarm not used)
- Session memory initialization
- Plugin hook pre-loading
- Attribution hooks and repo classification
- All deferred prefetches

Design principle: bare mode prioritizes latency for CI pipeline scenarios.

**Worktree + tmux creation:** When `--worktree` is passed:
1. Resolve canonical git root (handling existing worktree nesting)
2. Generate slug from `getPlanSlug()` or PR number
3. Call `createWorktreeForSession()` -- delegates to WorktreeCreate hook if configured
4. Optionally create tmux session at worktree path
5. Call `setCwd(worktreePath)` and `setProjectRoot()`
6. Call `clearMemoryFileCaches()` since cwd changed
7. Re-capture hooks config from worktree's `.claude/settings.json`

The `setProjectRoot()` call fixes project identity (session history, skills, CLAUDE.md) to the worktree root for the session duration.

## Phase 5: Global State (`bootstrap/state.ts`)

The state module is the single source of truth for session-scoped globals. The source comment states: "DO NOT ADD MORE STATE HERE -- BE JUDICIOUS WITH GLOBAL STATE."

**State tracked:**

- **Identity:** `sessionId`, `originalCwd`, `projectRoot`, `cwd`
- **Costs:** `totalCostUSD`, `modelUsage`, token counters, FPS metrics
- **Flags:** `isInteractive`, `sessionBypassPermissionsMode`, `isRemoteMode`
- **Telemetry:** `meter`, `loggerProvider`, `tracerProvider`
- **Cache:** `promptCache1hEligible`, `afkModeHeaderLatched`, `fastModeHeaderLatched`
- **Hooks:** `registeredHooks`, `invokedSkills`, `sessionCronTasks`

```typescript
function getInitialState(): State {
  let resolvedCwd = ''
  try {
    // Resolve symlinks for consistent session storage paths
    resolvedCwd = realpathSync(cwd())
  } catch { resolvedCwd = cwd() }

  return {
    originalCwd: resolvedCwd,
    projectRoot: resolvedCwd,
    sessionId: asSessionId(randomUUID()),
    isInteractive: true,
    totalCostUSD: 0,
    // ... ~60 more fields
  }
}
```

**Prompt cache stability:** Fields like `afkModeHeaderLatched` and `fastModeHeaderLatched` keep Anthropic API request headers stable once activated. Toggling the header would bust server-side prompt cache, causing expensive re-processing of ~50-70K tokens.

## Phase 6: Ink Rendering

Final step renders the React-based TUI. `launchRepl()` dynamically imports components (avoiding circular imports) then calls `renderAndRun()`:

```typescript
export async function launchRepl(
  root: Root,
  appProps: AppWrapperProps,
  replProps: REPLProps,
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>,
): Promise<void> {
  const { App }  = await import('./components/App.js')
  const { REPL } = await import('./screens/REPL.js')
  await renderAndRun(root, <App {...appProps}><REPL {...replProps} /></App>)
}
```

The `ink.ts` wrapper automatically wraps every render with `<ThemeProvider>`, enabling `ThemedBox` and `ThemedText` components without per-call-site theme context mounting:

```typescript
function withTheme(node: ReactNode): ReactNode {
  return createElement(ThemeProvider, null, node)
}

export async function render(node, options) {
  return inkRender(withTheme(node), options)
}
```

**After first render:** `startDeferredPrefetches()` fires background work not needed for initial display: `initUser()`, `getUserContext()`, MCP URL prefetch, model capability refresh, and file change detector initialization. This work runs while the user types their first message, hidden by human reaction time.

## Key Takeaways

- Boot is **three nested layers**: CLI entrypoint -> main function -> setup + REPL render
- **Fast paths in `cli.tsx`** never load `main.tsx`; `claude --version` returns in milliseconds
- **MDM and keychain reads launch at module-eval time** to parallelize with ~135ms import chain
- **`setCwd()` must precede `captureHooksConfigSnapshot()`** -- enforced by source comments
- **Bare mode** strips every non-essential startup step for scripted/SDK use
- **`bootstrap/state.ts` is the global state ledger**; prompt cache latch fields protect server-side caching
- **`tengu_started` event is earliest reliable beacon**; everything after `initSinks()` counts toward success rate
- **Deferred prefetches run after first render**, hidden in typing window -- architecture emphasizes perceived latency

---

# LESSON 04 -- QUERY ENGINE & LLM API

## The Four-Layer Architecture

1. **QueryEngine.submitMessage()** -- Validates prompts, constructs system messaging, resolves the model, records transcript, delegates to `query()`
2. **query() -> queryLoop()** -- An async generator that loops until tool-calling ceases; each iteration equals one model invocation
3. **queryModel/callModel** -- Invokes Anthropic API via streaming, wrapped in `withRetry()`
4. **Stop hooks & token budget** -- Post-turn external hook execution; token budget determines whether to inject continuation nudges

**Core principle:** Every Claude Code interface funnels through the identical `query()` generator, establishing it as the canonical source for turn mechanics.

## Message Flow Sequence

- User submits prompt to QueryEngine
- System fetches prompt parts, builds initial system message
- QueryEngine calls query() with messages and system prompt
- Within queryLoop iteration:
  - Applies tool result budget / microcompact / snip / autocompact
  - Calls queryModel with messages, tools, config
  - Posts to `/v1/messages` endpoint with streaming
  - Receives content_block_delta events
  - Yields AssistantMessage with text/tool_use blocks
  - StreamingToolExecutor tracks tool_use blocks
  - If tool_use blocks present: executes tools, appends tool_results, continues loop
  - If no tool calls: runs handleStopHooks()
  - Checks token budget; may inject nudge and continue
  - Yields Terminal with completion reason

## QueryEngine Class Structure

```typescript
export class QueryEngine {
  private mutableMessages: Message[]
  private abortController: AbortController
  private totalUsage: NonNullableUsage
  private permissionDenials: SDKPermissionDenial[]

  // Turn-scoped; cleared at submitMessage() start
  private discoveredSkillNames = new Set<string>()

  async *submitMessage(
    prompt: string | ContentBlockParam[],
    options?: { uuid?: string; isMeta?: boolean },
  ): AsyncGenerator<SDKMessage> {
    // 1. Build system prompt (fetchSystemPromptParts)
    // 2. processUserInput -- handles slash commands
    // 3. recordTranscript -- persists BEFORE the API call
    // 4. yield* query({ messages, ... })
    // 5. yield final result SDKMessage
  }
}
```

**Critical design:** Transcript is written to disk before API invocation, enabling session resumption even if the process terminates before response arrival.

## The queryLoop() While(true) Core

The loop maintains a typed `State` object across iterations:

```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined   // WHY we looped again
}
```

### Seven Continuation Reasons

| transition.reason | Meaning |
|---|---|
| `max_output_tokens_escalate` | First 8k cap hit; retry at 64k |
| `max_output_tokens_recovery` | Model hit output limit; inject recovery nudge (up to 3x) |
| `reactive_compact_retry` | Prompt-too-long -> compact -> retry |
| `collapse_drain_retry` | Prompt-too-long -> drain stages -> retry |
| `stop_hook_blocking` | Stop hook returned blocking error; re-query |
| `token_budget_continuation` | Budget indicates more work needed; nudge + continue |
| _(needs follow-up)_ | Model returned tool_use blocks -> execute -> loop |

**Exit conditions:** Loop terminates with `Terminal` reason: `completed`, `blocking_limit`, `model_error`, `prompt_too_long`, `aborted_streaming`, `stop_hook_prevented`, `image_error`.

## Streaming & API Layer

The `queryModel` async generator calls the Anthropic endpoint and re-yields events:

```typescript
for await (const message of deps.callModel({
  messages: prependUserContext(messagesForQuery, userContext),
  systemPrompt: fullSystemPrompt,
  thinkingConfig: toolUseContext.options.thinkingConfig,
  tools: toolUseContext.options.tools,
  signal: toolUseContext.abortController.signal,
  options: { model: currentModel, fallbackModel, ... },
})) {
  if (message.type === 'assistant') {
    assistantMessages.push(message)
    const toolBlocks = message.message.content
      .filter(b => b.type === 'tool_use')
    if (toolBlocks.length > 0) needsFollowUp = true
  }
  yield yieldMessage
}
```

### Streaming Tool Execution

When `config.gates.streamingToolExecution` is enabled, `StreamingToolExecutor` fires tools while the stream remains open, enabling parallel execution and reduced latency on multi-tool turns.

**Tombstone messages:** Mid-stream fallback triggers yield `{ type: 'tombstone', message }` to prevent "thinking blocks cannot be modified" API errors on retry.

### withRetry() -- Exponential Backoff Strategy

Every API call passes through `withRetry()` in `services/api/withRetry.ts`, retrying up to `DEFAULT_MAX_RETRIES = 10` times with `SystemAPIErrorMessage` yielded before each sleep:

```typescript
export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32000,
): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) return seconds * 1000
  }
  const baseDelay = Math.min(
    BASE_DELAY_MS * Math.pow(2, attempt - 1),
    maxDelayMs,
  )
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}
```

**Retry decision rules:**
- **529 (overloaded):** Only foreground sources retry; background sources bail to prevent cascade amplification
- **Opus fallback:** After 3 consecutive 529s on non-custom Opus, throws `FallbackTriggeredError` switching to `fallbackModel`
- **OAuth 401:** Forces token refresh via `handleOAuth401Error()` before retry
- **Context overflow 400:** Parses token counts from error, computes new `maxTokensOverride`
- **Persistent mode (UNATTENDED_RETRY):** Retries indefinitely with 30-min backoff cap, yields heartbeat every 30s
- **ECONNRESET/EPIPE:** Detects stale socket; calls `disableKeepAlive()` before retry

### SSE Stream -> AssistantMessage Reconstruction

Anthropic streaming sends: `message_start` -> content_block pairs -> `message_delta` (final usage + stop_reason) -> `message_stop`.

Usage tracking occurs in-place on final message:

```typescript
if (message.event.type === 'message_start') {
  currentMessageUsage = updateUsage(EMPTY_USAGE, message.event.message.usage)
}
if (message.event.type === 'message_delta') {
  currentMessageUsage = updateUsage(currentMessageUsage, message.event.usage)
  if (message.event.delta.stop_reason != null) {
    lastStopReason = message.event.delta.stop_reason
  }
}
```

**Prompt caching detail:** When `backfillObservableInput` modifies tool_use input, only a cloned message is yielded to observers; the original remains byte-identical.

## Context Management & Autocompact Pipeline

Pre-API call reduction occurs in priority order:

1. **applyToolResultBudget()** -- Caps individual tool result byte size; large results stored externally with reference stubs
2. **snipCompact (HISTORY_SNIP)** -- Removes provably unneeded middle messages, freeing tokens without summarization
3. **microcompact / cached microcompact** -- Merges consecutive tool-result/user pairs into condensed summaries; cached variant uses API-side cache edits
4. **contextCollapse (CONTEXT_COLLAPSE)** -- Read-time projection over full REPL history; staged collapses committed per entry. **Reversible:** persisted as `marble-origami-snapshot` (last-writer-wins state) and `marble-origami-commit` (array of finalized collapses) in session JSONL. Full original messages are retained, enabling restore on resume. See Lesson 69 for details.
5. **autoCompact** -- At blocking limit approach, triggers full summarization via forked agent; loop continues immediately post-compact

**Blocking limit check** occurs after all compaction. If context exceeds limit, synthetic `PROMPT_TOO_LONG_ERROR_MESSAGE` is yielded and loop exits with `blocking_limit` reason.

**Reactive compact** triggers on real 413 from API. Engine withholds error during streaming, attempts one reactive compaction, surfaces error if that fails (skips stop hooks to prevent death spiral).

**task_budget carryover** across compaction:

```typescript
if (params.taskBudget) {
  const preCompactContext =
    finalContextTokensFromLastResponse(messagesForQuery)
  taskBudgetRemaining = Math.max(
    0,
    (taskBudgetRemaining ?? params.taskBudget.total) - preCompactContext,
  )
}
```

## Stop Hooks -- Post-Turn Lifecycle

After model completion (absent tool calls/recovery), `handleStopHooks()` in `query/stopHooks.ts` executes.

### Three Hook Categories

1. **Stop Hooks** -- Registered via `settings.json` hooks configuration; run in parallel; results collected as `hook_success`, `hook_non_blocking_error`, or `hook_error_during_execution` attachments

2. **TaskCompleted hooks** -- Teammate mode only; fire for each `in_progress` task owned by agent; mirror stop hook semantics

3. **TeammateIdle hooks** -- Teammate mode only; fire on idle transition; can block or prevent continuation

4. **Fire-and-forget background tasks** -- Skipped in bare mode (`-p` flag); fired without `await` in interactive mode:

```typescript
if (!isBareMode()) {
  void executePromptSuggestion(stopHookContext)
  if (feature('EXTRACT_MEMORIES') && isExtractModeActive()) {
    void extractMemoriesModule!.executeExtractMemories(...)
  }
  if (!toolUseContext.agentId) {
    void executeAutoDream(...)
  }
}
```

## Token Budget -- Auto-Continue Feature

`query/tokenBudget.ts` implements auto-continuation for SDK paths:

```typescript
const COMPLETION_THRESHOLD = 0.9   // 90% used = done
const DIMINISHING_THRESHOLD = 500  // <500 new tokens = no progress

export function checkTokenBudget(
  tracker: BudgetTracker,
  agentId: string | undefined,
  budget: number | null,
  globalTurnTokens: number,
): TokenBudgetDecision {
  if (agentId || budget === null || budget <= 0) {
    return { action: 'stop', completionEvent: null }
  }
  const pct = Math.round((globalTurnTokens / budget) * 100)
  const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD
  if (!isDiminishing && turnTokens < budget * COMPLETION_THRESHOLD) {
    return { action: 'continue', nudgeMessage: ... }
  }
  return { action: 'stop', ... }
}
```

**Early-stop conditions:**
- **Budget exhausted:** Turn tokens >= 90% -> stop
- **Diminishing returns:** After 3+ continuations, if current AND previous delta both under 500 tokens -> stop

Nudge message injected as `isMeta` user message (invisible in REPL), loop continues with `transition.reason = 'token_budget_continuation'`.

## Key Design Principles

- **One loop, many exits:** `while(true)` in queryLoop exits via typed `Terminal` with named reasons
- **Generators compose:** `submitMessage`, `query`, `queryLoop`, `queryModel`, `withRetry`, `handleStopHooks` all `async function*`, enabling clean `yield*` composition
- **Transcript-first reliability:** User message written to disk before API call; process kill leaves resumable session
- **Feature-gating for dead code:** `feature('HISTORY_SNIP')`, `feature('TOKEN_BUDGET')`, etc. evaluated at bundle time by Bun, eliminating unreachable code
- **Background effects fire-and-forget:** Memory extraction, suggestions, auto-dream are `void` promises; must not block stream or run in bare mode
- **Smart retry beyond exponential backoff:** Foreground/background routing, fast-mode cooldowns, OAuth refresh, persistent keep-alive, Opus->fallback, context-overflow recalculation

---

# LESSON 12 -- STATE MANAGEMENT

## Architecture Overview

Claude Code implements custom state management in 35 lines of TypeScript without Redux, Zustand, or Context. Three layers:

**Layer 1 -- Primitive:** `createStore<T>` is a generic, framework-free store
**Layer 2 -- Domain:** `AppState` + `AppStateStore` contain the full state shape (400+ fields)
**Layer 3 -- React:** `AppStateProvider` + hooks wire the store into Context

Supporting systems:
- **Side-Effect:** `onChangeAppState` fires on every state transition
- **Derived State:** `selectors.ts` contains pure functions over AppState slices
- **Transition Logic:** `teammateViewHelpers.ts` handles stateful updaters

## The createStore Pattern

```typescript
type Listener = () => void
type OnChange<T> = (args: { newState: T; oldState: T }) => void

export type Store<T> = {
  getState: () => T
  setState: (updater: (prev: T) => T) => void
  subscribe: (listener: Listener) => () => void
}

export function createStore<T>(
  initialState: T,
  onChange?: OnChange<T>,
): Store<T> {
  let state = initialState
  const listeners = new Set<Listener>()

  return {
    getState: () => state,

    setState: (updater) => {
      const prev = state
      const next = updater(prev)
      if (Object.is(next, prev)) return   // bail if no change
      state = next
      onChange?.({ newState: next, oldState: prev })  // side-effect hook
      for (const listener of listeners) listener()  // notify React
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)  // unsubscribe
    },
  }
}
```

### Design Rationale

**Why not useState/useReducer?** React's hooks tie state to component tree lifetime. Claude Code needs state readable from non-React code: headless mode, SDK print layer, per-process teammate sessions, and the `onChangeAppState` side-effect chain.

**Why not Zustand/Jotai?** Zero additional bundle dependency. The interface needed -- `getState`, `setState`, `subscribe` -- maps exactly to `useSyncExternalStore` requirements.

### Key Invariant

`setState` takes an updater function `(prev) => next`, never a partial object. This enforces immutability at the call site: callers must spread previous state and return a new reference. `Object.is` equality checking means re-renders only fire when the reference actually changes.

### useSyncExternalStore Integration

React 18's `useSyncExternalStore` takes three arguments: `subscribe`, `getSnapshot`, and optional `getServerSnapshot`. The contract:

- **subscribe:** Register callback, return unsubscribe function. Matches `store.subscribe` exactly.
- **getSnapshot:** Return current value synchronously. This is selector-wrapped `store.getState()`.

```typescript
// From AppState.tsx -- full useAppState implementation:
export function useAppState(selector) {
  const store = useAppStore()
  const get = () => selector(store.getState())
  return useSyncExternalStore(store.subscribe, get, get)
}
```

The `get` closure is recreated on every render if `selector` changes identity -- React Compiler's `_c` memo cache caches it by `[selector, store]`. Inline arrow selectors defeat the cache on every render.

## AppState Shape

`AppState` is defined in `state/AppStateStore.ts` with over 90 distinct fields. The type is `DeepImmutable<{...}>` for serializable portions, with specific fields escaping immutability.

**Escape hatch fields:** `tasks`, `agentNameRegistry`, `sessionHooks`, `activeOverlays`, `replContext` contain function types that TypeScript's recursive readonly transform doesn't handle.

### Field Categories

**Session Core -- Model & Settings:**
- settings, verbose
- mainLoopModel, mainLoopModelForSession
- thinkingEnabled, effortValue, fastMode
- kairosEnabled, agent, authVersion

**UI State -- View & Navigation:**
- expandedView, isBriefOnly
- footerSelection, spinnerTip
- activeOverlays, statusLineText
- viewSelectionMode, coordinatorTaskIndex

**Permissions -- Tool & Denial:**
- toolPermissionContext (mode, bypass flags)
- denialTracking
- initialMessage (mode override)
- pendingPlanVerification

**Agent & Tasks -- Concurrency:**
- tasks (keyed by taskId)
- agentNameRegistry (name -> AgentId)
- foregroundedTaskId, viewingAgentTaskId
- teamContext, standaloneAgentContext

**Remote & Bridge -- Connectivity:**
- remoteSessionUrl, remoteConnectionStatus
- replBridgeEnabled/Connected/Active/...
- ultraplanSessionUrl, isUltraplanMode
- workerSandboxPermissions

**Subsystem State -- Features:**
- mcp (clients, tools, commands, resources)
- plugins (enabled, disabled, installationStatus)
- speculation, promptSuggestion
- notifications, elicitation, todos, inbox
- tungstenActive* (tmux panel), bagel* (browser)
- computerUseMcpState, replContext, fileHistory

### Selected Field Reference

| Field | Type | Purpose |
|-------|------|---------|
| settings | SettingsJson | Full settings.json contents -- read by nearly every subsystem |
| mainLoopModel | ModelSetting | Active model override; null = use default |
| toolPermissionContext | ToolPermissionContext | Current permission mode (default/plan/auto/yolo) plus bypass availability flags |
| tasks | { [taskId]: TaskState } | Live state for all in-flight agent tasks |
| agentNameRegistry | Map<string, AgentId> | Name -> AgentId routing table populated by Agent tool |
| speculation | SpeculationState | Idle or active predictive completion state |
| expandedView | 'none' \| 'tasks' \| 'teammates' | Controls which panel is expanded |
| notifications | { current, queue } | Priority-queued notification system |
| replBridgeEnabled | boolean | Desired state of always-on bridge |
| mcp.pluginReconnectKey | number | Monotonically incremented by /reload-plugins |
| initialMessage | { message, mode, ... } \| null | Set to trigger a REPL query programmatically |
| activeOverlays | ReadonlySet<string> | Registry of open Select dialogs |
| fileHistory | FileHistoryState | Snapshots + tracked files for undo/rewind support |
| attribution | AttributionState | Commit authorship tracking for git operations |
| tungstenActiveSession | { sessionName, socketName, target } \| undef | Active tmux integration session |
| computerUseMcpState | { allowedApps, grantFlags, ... } \| undef | Per-session computer-use allowlist |

### DeepImmutable and Escape Hatch

```typescript
export type AppState = DeepImmutable<{
  settings: SettingsJson
  verbose: boolean
  // ... ~60 serializable fields ...
}> & {
  // Excluded from DeepImmutable -- contain function types
  tasks: { [taskId: string]: TaskState }
  agentNameRegistry: Map<string, AgentId>
  mcp: { clients: MCPServerConnection[]; /* ... */ }
  // ...
}
```

### SpeculationState Deep Dive

The most complex field is a discriminated union:

```typescript
type SpeculationState =
  | { status: 'idle' }
  | {
      status: 'active'
      id: string
      abort: () => void
      startTime: number
      messagesRef: { current: Message[] }     // mutable ref -- no array copy per msg
      writtenPathsRef: { current: Set<string> } // relative paths in overlay
      boundary: CompletionBoundary | null
      suggestionLength: number
      toolUseCount: number
      isPipelined: boolean
      contextRef: { current: REPLHookContext }
      pipelinedSuggestion?: { text: string; promptId: ...; generationRequestId: ... } | null
    }
```

The `messagesRef` and `writtenPathsRef` fields are intentionally mutable -- they escape immutability so speculation can append messages to in-progress prediction without triggering full store update and re-render for every token.

## onChangeAppState -- the Side-Effect Chokepoint

The second argument to `createStore` is optional `onChange` callback. Claude Code passes `onChangeAppState` -- a single function firing on every state transition, diffing relevant fields to drive side effects.

### Current Diff Blocks

```typescript
export function onChangeAppState({ newState, oldState }) {

  // 1. Permission mode -- sync to CCR external_metadata + SDK status stream
  const prevMode = oldState.toolPermissionContext.mode
  const newMode = newState.toolPermissionContext.mode
  if (prevMode !== newMode) {
    const prevExternal = toExternalPermissionMode(prevMode)
    const newExternal  = toExternalPermissionMode(newMode)
    if (prevExternal !== newExternal) {
      notifySessionMetadataChanged({ permission_mode: newExternal, ... })
    }
    notifyPermissionModeChanged(newMode)
  }

  // 2. mainLoopModel -- persist to settings + bootstrap override
  if (newState.mainLoopModel !== oldState.mainLoopModel) {
    if (newState.mainLoopModel === null) {
      updateSettingsForSource('userSettings', { model: undefined })
      setMainLoopModelOverride(null)
    } else {
      updateSettingsForSource('userSettings', { model: newState.mainLoopModel })
      setMainLoopModelOverride(newState.mainLoopModel)
    }
  }

  // 3. expandedView -- persist to globalConfig
  if (newState.expandedView !== oldState.expandedView) {
    saveGlobalConfig(current => ({
      ...current,
      showExpandedTodos: newState.expandedView === 'tasks',
      showSpinnerTree:   newState.expandedView === 'teammates',
    }))
  }

  // 4. verbose -- persist to globalConfig
  if (newState.verbose !== oldState.verbose) {
    saveGlobalConfig(current => ({ ...current, verbose: newState.verbose }))
  }

  // 5. tungstenPanelVisible -- ant-only, persist to globalConfig
  if (process.env.USER_TYPE === 'ant' && newState.tungstenPanelVisible !== oldState.tungstenPanelVisible) {
    saveGlobalConfig(current => ({ ...current, tungstenPanelVisible: newState.tungstenPanelVisible }))
  }

  // 6. settings -- clear auth caches + re-apply env vars
  if (newState.settings !== oldState.settings) {
    clearApiKeyHelperCache()
    clearAwsCredentialsCache()
    clearGcpCredentialsCache()
    if (newState.settings.env !== oldState.settings.env) {
      applyConfigEnvironmentVariables()
    }
  }
}
```

### The Externalization Guard

Not all internal permission modes have external equivalents. `toExternalPermissionMode` collapses internal-only names like `'bubble'` and `'ungated-auto'` to `'default'` before sending to CCR.

### externalMetadataToAppState -- The Inverse

```typescript
export function externalMetadataToAppState(
  metadata: SessionExternalMetadata
): (prev: AppState) => AppState {
  return prev => ({
    ...prev,
    ...(typeof metadata.permission_mode === 'string'
      ? { toolPermissionContext: {
            ...prev.toolPermissionContext,
            mode: permissionModeFromString(metadata.permission_mode),
          }}
      : {}),
    ...(typeof metadata.is_ultraplan_mode === 'boolean'
      ? { isUltraplanMode: metadata.is_ultraplan_mode }
      : {}),
  })
}
```

Returns an updater function `(prev) => AppState` -- designed to be passed directly to `store.setState()`.

## The React Hooks Layer

`state/AppState.tsx` exports three hooks and one provider:

```typescript
// Read a slice -- re-renders only when the selected value changes
const verbose = useAppState(s => s.verbose)
const model   = useAppState(s => s.mainLoopModel)

// Write without subscribing -- stable reference, never causes re-renders
const setAppState = useSetAppState()
setAppState(prev => ({ ...prev, verbose: true }))

// Get the raw store -- for passing to non-React helpers
const store = useAppStateStore()
doSomethingOutsideReact(store.getState, store.setState)
```

### Selector Rule

Do NOT return new objects or arrays from the selector. `useSyncExternalStore` compares snapshots with `Object.is`. An inline `s => ({ a: s.a, b: s.b })` creates a new object on every render, triggering infinite re-render loop.

```typescript
// Good -- returns existing reference
const { text, promptId } = useAppState(s => s.promptSuggestion)

// Bad -- new object every render
const { text, promptId } = useAppState(s => ({
  text: s.promptSuggestion.text,
  promptId: s.promptSuggestion.promptId
}))
```

## Selectors and Transition Helpers

### selectors.ts -- Pure Derivations

Functions deriving computed values from `AppState` slices. Accept `Pick<AppState, ...>` (not the full state) so callers can test in isolation.

```typescript
export function getViewedTeammateTask(
  appState: Pick<AppState, 'viewingAgentTaskId' | 'tasks'>
): InProcessTeammateTaskState | undefined { ... }

export type ActiveAgentForInput =
  | { type: 'leader' }
  | { type: 'viewed';     task: InProcessTeammateTaskState }
  | { type: 'named_agent'; task: LocalAgentTaskState       }

export function getActiveAgentForInput(appState: AppState): ActiveAgentForInput { ... }
```

### teammateViewHelpers.ts -- Colocated State Transitions

Not React hooks -- take `setAppState` as argument, making them testable and usable from any context.

```typescript
export function enterTeammateView(
  taskId: string,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void

export function exitTeammateView(
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void

export function stopOrDismissAgent(
  taskId: string,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void
```

### Retain/Evict Lifecycle for Agent Tasks

- **Stub form:** `retain: false`, `messages: undefined`. Row shows in panel but no transcript loaded.
- **Retained form:** `retain: true`, messages loaded. Triggered by `enterTeammateView`. Blocks eviction.
- **Eviction pending:** Task is terminal, `evictAfter = Date.now() + 30_000`. Row lingers 30s (PANEL_GRACE_MS).
- **Immediate dismiss:** `evictAfter = 0`. Filter hides row immediately.

## Full Data Flow Diagram

1. Component calls `useSetAppState()` -> returns `store.setState`
2. `store.setState(updater)` is invoked
3. Check: `Object.is(next, prev)?`
   - Same: Return (no-op)
   - Changed: Continue
4. `state = next`
5. `onChangeAppState({ newState, oldState })`
   - Permission mode changed? -> notify CCR + SDK
   - mainLoopModel changed? -> update settings + override
   - expandedView changed? -> save globalConfig
   - settings changed? -> clear auth caches + apply env vars
6. `for listener of listeners: listener()`
7. `useSyncExternalStore` triggers re-render
8. `selector(store.getState())` compares with `Object.is`
   - Changed: Component re-renders
   - Same: Render skipped

## Context vs State: Where Context Lives

**React Context (thin):** modalContext, overlayContext, promptOverlayContext

**Hooks over AppState:** notifications.tsx -- reads/writes `AppState.notifications`

**External Store Pattern:** fpsMetrics, stats -- own data outside AppState

**Side-Effect Manager:** mailbox, voice, QueuedMessage -- manage WebSocket/IPC connections

**context.ts is Different:** The top-level `context.ts` is entirely unrelated to React Context. It builds the system prompt injected into each API call: `getSystemContext()` (git status, cache breaker) and `getUserContext()` (CLAUDE.md files, current date). Both are `memoize()`d.

---

# LESSON 39 -- SYSTEM PROMPT CONSTRUCTION

## Six-Layer Pipeline

1. **Priority resolver** -- determines which prompt runs (override -> coordinator -> agent -> custom -> default)
2. **Content factory** -- builds static and dynamic sections
3. **Section registry** -- manages memoized vs. volatile caching
4. **CLAUDE.md loader** -- discovers and injects user instructions
5. **Memory system** -- auto-memory injection from MEMORY.md
6. **Cache boundary** -- splits prompt for token-cost optimization

## Priority Waterfall

`buildEffectiveSystemPrompt()` implements strict precedence:

- **Override mode** (loop): returns override only; all other sources ignored
- **Coordinator mode**: returns coordinator prompt + append
- **Agent mode** (proactive): returns default + custom agent instructions + append
- **Agent mode** (normal): returns agent prompt + append
- **Custom prompt**: returns custom + append
- **Default**: returns default prompt + append

Key insight: "appendSystemPrompt is the only thing that always appends -- it is added to every branch except when overrideSystemPrompt is active."

## Static vs. Dynamic Split

The prompt divides at marker `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`:

**Static sections** (globally cacheable):
- Identity and system rules
- Task scope and security guidance
- Tool usage patterns
- Tone, style, output efficiency

**Dynamic sections** (session-specific, never globally cached):
- Session guidance
- Memory/CLAUDE.md content
- Environment info (CWD, git status, platform)
- Language preferences
- MCP server instructions
- Scratchpad paths

## CLAUDE.md Discovery & Loading

Four-scope hierarchy (processed in order, later files override earlier):

1. Managed memory: `/etc/claude-code/CLAUDE.md`
2. User memory: `~/.claude/CLAUDE.md`
3. Project memory: `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`
4. Local memory: `CLAUDE.local.md` (closest to CWD wins)

Files are discovered by walking upward from current directory; closer files appear last (higher priority).

### @include Directive

Syntax supported:
- `@shared-rules.md` (relative)
- `@./scripts/lint-conventions.md` (explicit relative)
- `@~/company/standards.md` (home-relative)
- `@/absolute/path/rules.md` (absolute)

Circular references prevented; non-existent targets silently skipped.

### Frontmatter Path Filtering

YAML frontmatter with `paths` key gates instructions to glob patterns:

```yaml
---
paths:
  - src/components/**
  - "*.tsx"
---
Always use named exports in React components.
```

## Dynamic Section Registry

| Section | Content | Cache |
|---------|---------|-------|
| session_guidance | Question-asking tips, agent contracts | memoized |
| memory | CLAUDE.md hierarchy + MEMORY.md | memoized |
| env_info_simple | CWD, git, platform, shell, OS, model | memoized |
| language | Language preference override | memoized |
| output_style | Named style from settings | memoized |
| mcp_instructions | Per-server instructions | **volatile** |
| scratchpad | Session scratchpad path rules | memoized |
| token_budget | Context-length guidance | memoized |

**mcp_instructions is volatile because** MCP servers can connect and disconnect between turns, so cached instructions would go stale.

## Memory Auto-Injection (MEMORY.md)

Auto-memory file truncated to **200 lines or 25,000 bytes** (whichever fires first). Warning appended if truncated.

## Environment Info Section

`computeSimpleEnvInfo()` produces:
- Primary working directory
- Git repository status
- Platform (darwin/linux/win32)
- Shell detection
- OS version
- Model name and ID
- Knowledge cutoff date
- Available Claude Code modes

**Undercover mode**: strips all model name references when `isUndercover()` active.

## MCP Server Instructions

Connected servers with `instructions` field have text injected into system prompt. Experimental `mcpInstructionsDelta` path delivers instructions as persisted attachment objects rather than re-injecting into prompt each turn (avoids cache bust on late-connecting servers).

## Subagent Enhancement

Subagents start from `DEFAULT_AGENT_PROMPT` (not full `getSystemPrompt()`), then `enhanceSystemPromptWithEnvDetails()` appends:
- Environment context in `<env>` XML tags
- Note: "Agent threads always have their cwd reset between bash calls -- use absolute file paths"
- Anti-emoji and anti-colon-before-tools rules

Uses fuller `computeEnvInfo()` variant (includes `uname -sr` output).

## Escape Hatches

**CLAUDE_CODE_SIMPLE=1**: Three-line stub prompt (CWD + date only) for benchmarking raw model without Claude Code overhead.

**Proactive/KAIROS mode**: Short autonomous-agent identity instead of interactive-session prompt.

## Critical Implementation Notes

- All `// @[MODEL LAUNCH]` comments mark code requiring human updates at each new Claude model release
- ANT-only branches compiled out via Bun dead-code elimination for external binary
- Cache entries keyed by section name, stored in `bootstrap/state.ts`
- Managed memory file wrapped with: "Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written."

---

# LESSON 50 -- ARCHITECTURE OVERVIEW (CAPSTONE)

## Full Architecture: Six Layers

1. **Boot** -- Startup, settings, migrations, session wiring
2. **UI Shell** -- Ink-rendered terminal interface
3. **State** -- Immutable AppState plus global singleton state
4. **Query Engine** -- Conversation lifecycle, system prompt assembly, API streaming
5. **Tools** -- Capability registry (Bash, file I/O, agents, search, MCP, skills)
6. **Services** -- Anthropic API client, MCP connections, context compaction

### Core Technology Stack

TypeScript application built on Bun, React/Ink (terminal UI), and the Anthropic API.

### Source Files

`main.tsx`, `setup.ts`, `QueryEngine.ts`, `query.ts`, `tools.ts`, `Tool.ts`, `bootstrap/state.ts`, `state/AppStateStore.ts`, `replLauncher.tsx`, `screens/REPL.tsx`, `services/api/`, `services/mcp/`

## Data Flow: User Input to API Response

1. `processUserInput()` parses slash commands and builds UserMessage
2. `QueryEngine.fetchSystemPromptParts()` assembles combined system prompt
3. **Critical:** `recordTranscript()` persists messages to disk BEFORE the API call
4. `query()` initiates streaming API request via `deps.sendRequest()`
5. API events yield through the generator to REPL
6. `canUseTool()` permission gate evaluates each tool invocation
7. Tool handlers execute (potentially in parallel via StreamingToolExecutor)
8. Tool results append to messages; loop continues until `stop_reason = end_turn`
9. Final `SDKResultMessage` yields with cost, usage, denials, stop reason

## Boot Sequence Optimization

### Top-Level Side Effects (Before Module Imports Complete)
- `startMdmRawRead()` -- MDM policy subprocess
- `startKeychainPrefetch()` -- macOS keychain reads

### After init()
- `preconnectAnthropicApi()` -- TCP connection warm-up before first user input

### After First Render
- `startDeferredPrefetches()` -- User/git context, tips, model capabilities

### Session Wiring Priority
`captureHooksConfigSnapshot()` must execute after `setCwd()` but before any query. This freezes hooks configuration to prevent mid-session file modifications from injecting malicious hook commands.

The ~135ms module evaluation cost overlaps with subprocess dispatcher calls. Heavy modules (OpenTelemetry ~400KB, gRPC ~700KB) are lazy-loaded via dynamic `import()` only when needed.

## QueryEngine Architecture

### State Ownership
```
class QueryEngine {
  private config: QueryEngineConfig
  private mutableMessages: Message[]
  private abortController: AbortController
  private permissionDenials: SDKPermissionDenial[]
  private totalUsage: NonNullableUsage
  private readFileState: FileStateCache
  private discoveredSkillNames: Set<string>
  private loadedNestedMemoryPaths: Set<string>
}
```

### submitMessage() Turn Lifecycle

1. `processUserInput()` -- slash command handling
2. `recordTranscript(messages)` -- persist to disk before API
3. `fetchSystemPromptParts()` -- assemble system + user + system context
4. `getSlashCommandToolSkills()` -- load cached skills/plugins
5. Yield `buildSystemInitMessage()` -- SDK receives tool list
6. Enter `query()` loop -- streaming API call + tool execution
7. Yield `SDKResultMessage` -- final cost/usage/denials/stop_reason

## Tool System Architecture

### Tool Interface
```
interface Tool {
  name: string
  description: string
  inputSchema: ZodSchema
  isEnabled(): boolean
  call(input, context: ToolUseContext): AsyncGenerator
  renderToolResult(result, context): React.ReactNode
}
```

### Available Base Tools
BashTool, FileReadTool, FileEditTool, FileWriteTool, GlobTool, GrepTool, WebFetchTool, WebSearchTool, AgentTool, SkillTool, TodoWriteTool, LSPTool, ListMcpResourcesTool, ReadMcpResourceTool, ToolSearchTool, TaskCreateTool, TaskUpdateTool, TaskListTool, TaskGetTool, EnterPlanModeTool, ExitPlanModeV2Tool, EnterWorktreeTool, ExitWorktreeTool, ConfigTool, AskUserQuestionTool, TungstenTool, BriefTool, NotebookEditTool, plus feature-gated tools (SleepTool, MonitorTool, WorkflowTool).

### ToolUseContext Properties

| Property | Type | Purpose |
|----------|------|---------|
| messages | Message[] | Full conversation history |
| mainLoopModel | ModelSetting | Current model for sub-agents |
| tools | Tools | Available tool set |
| mcpClients | MCPServerConnection[] | Active MCP connections |
| agentDefinitions | AgentDefinitionsResult | Custom agent configs |
| abortController | AbortController | Shared abort signal |
| readFileState | FileStateCache | File diff/undo snapshot |
| setAppState | Setter<AppState> | UI state mutation |
| handleElicitation | ElicitFn | OAuth flow handling |

### Feature-Gated Tools Pattern

```
const SleepTool =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('./tools/SleepTool/SleepTool.js').SleepTool
    : null
```

## Two-Layer State Management

### Layer 1: Global Singleton (bootstrap/state.ts)
Process-lifetime constants accessible without React:
- sessionId, cwd, projectRoot, model, auth token
- telemetry meter, hook registry
- totalCostUSD, totalAPIDuration, modelUsage
- tokenBudgetInfo

### Layer 2: React State (state/AppStateStore.ts)
`DeepImmutable<AppState>` updated via `setAppState(prev => ...)`:
- settings, mainLoopModel, toolPermissionContext
- messages, mcpClients, agentDefinitions
- speculation, fileHistory, plugins, tasks

Design principle: "bootstrap/state.ts is a module-level singleton (plain JS object) while AppState is React context. This separation means the query engine and tools can access session identity without importing React."

## Session Management

Sessions are persistent conversations with unique UUID stored as JSONL under `~/.claude/projects/<cwd-hash>/<session-id>.jsonl`.

### Session Lifecycle Functions
- `getSessionId()` -- read/generate UUID
- `registerSession()` -- track concurrent sessions
- `recordTranscript(messages)` -- enqueue lazy write
- `flushSessionStorage()` -- forced flush
- `cacheSessionTitle()` -- first message becomes title
- `loadTranscriptFromFile()` -- resume path

### Write Queue Design
Transcript writes use lazy 100ms drain timers. User message writes are awaited; assistant message writes are fire-and-forget.

## Permission System

Every tool call passes through `canUseTool()` -- the architectural choke point.

| Mode | Behavior | Configuration |
|------|----------|---|
| default | Ask user for tools not in allow-list | Normal CLI startup |
| auto | Automatically allow safe tools, block dangerous | `--permission-mode auto` |
| bypass | Allow all tools without asking | `--dangerously-skip-permissions` |

## Context Compaction

- **Trigger**: `calculateTokenWarningState()` at ~80% context fill
- **Process**: `buildPostCompactMessages()` sends to Claude with summarization prompt
- **HISTORY_SNIP**: Feature-gated snip compaction via `snipCompact.ts`
- **500k continuation**: `checkTokenBudget()` handles responses exceeding max_output_tokens

## Hooks: User-Defined Lifecycle Events

| Hook Type | Fires When | Blocks? |
|-----------|-----------|---------|
| PreToolUse | Before tool executes | Yes - can deny |
| PostToolUse | After tool completes | No |
| PreCompact | Before compaction | No |
| PostCompact | After compaction | No |
| Stop | At end_turn | Yes - can continue |
| Notification | Notification event | No |
| FileChanged | Watched file modified | No |
| SessionStart | Before first query | Yes - delays query |

Security invariant: Snapshot captures hooks configuration once at startup. Prevents malicious project from modifying `settings.json` mid-session.

## Interactive vs. Headless Execution

| Aspect | Interactive (default) | Headless (-p/--print) |
|--------|----------------------|----------------------|
| UI | Ink/React terminal rendering | stdout text only |
| Trust Dialog | Shown on first launch | Skipped |
| Session Transcript | Awaited before API | Fire-and-forget |
| React Imports | Fully loaded | Never imported |
| Plugin Prefetch | Background during setup | Skipped |
| Deferred Prefetches | After first render | Skipped |
| Query Path | REPL -> ask() | print.ts -> QueryEngine |
| Entrypoint | cli | sdk-cli |

## Agent Swarms and Sub-Agents

`AgentTool` enables recursive execution. In swarm mode (`ENABLE_AGENT_SWARMS=true`), agents communicate via UDS messaging server.

## Master Timeline: Cold Start to First Token

```
t=0ms        $ claude (cli.tsx main())
t=1ms        profileCheckpoint('cli_entry')
t=1ms        startMdmRawRead()
t=1ms        startKeychainPrefetch()
t=136ms      Module eval complete
t=140ms      Commander.parse()
t=141ms      init()
t=145ms      ensureMdmSettingsLoaded()
t=160ms      preconnectAnthropicApi()
t=161ms      runMigrations()
t=163ms      setup(cwd, permissionMode, ...)
t=165ms      captureHooksConfigSnapshot() (CRITICAL)
t=180ms      showSetupScreens()
t=182ms      launchRepl()
t=190ms      FIRST RENDER (user sees prompt)
t=191ms      startDeferredPrefetches()
            [user types prompt and hits Enter]
t+3ms        recordTranscript(messages) (PERSIST BEFORE API)
t+9ms        deps.sendRequest()
t+50ms       FIRST TOKEN ARRIVES
```

## Key Design Patterns

1. **Async Generator Threading** -- Entire data flow from API to UI is a chain of async generators
2. **Dead Code Elimination via feature()** -- Bun's bundle-time `feature('FLAG_NAME')` completely removes disabled feature branches
3. **Cache-Warming for Latency** -- Critical paths pre-warmed in parallel during setup
4. **Immutable AppState + Mutable Bootstrap** -- React state is immutable; session-level constants live in plain module singleton
5. **isBareMode() Fast Path** -- Every expensive startup operation guarded by `if (!isBareMode())`
6. **Parallel Subprocess Investment** -- Subprocesses and async operations fire as early as possible

---

# LESSON 02 -- TOOL SYSTEM

## Files Covered

`Tool.ts`, `tools.ts`, `tools/utils.ts`, `services/tools/toolOrchestration.ts`, `services/tools/toolExecution.ts`, `services/tools/StreamingToolExecutor.ts`

## The Tool Interface (Tool.ts)

```typescript
export type Tool<
  Input extends AnyObject,
  Output,
  P extends ToolProgressData
> = {
  name: string                 // primary identifier the model uses
  aliases?: string[]          // legacy names for backward compat
  inputSchema: Input          // Zod schema -- source of truth for validation
  maxResultSizeChars: number  // overflow -> persist to disk

  call(
    args: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>

  checkPermissions(
    input: z.infer<Input>,
    context: ToolUseContext
  ): Promise<PermissionResult>

  isConcurrencySafe(input: z.infer<Input>): boolean
  isReadOnly(input: z.infer<Input>): boolean
  isDestructive?(input: z.infer<Input>): boolean
}
```

### buildTool() Factory Function

```typescript
const TOOL_DEFAULTS = {
  isEnabled:         () => true,
  isConcurrencySafe: () => false,   // conservative: assume state mutation
  isReadOnly:        () => false,
  isDestructive:     () => false,
  checkPermissions:  (input) =>
    Promise.resolve({ behavior: 'allow', updatedInput: input }),
  toAutoClassifierInput: () => '',
  userFacingName:    () => '',
}

export function buildTool<D extends AnyToolDef>(def: D): BuiltTool<D> {
  return {
    ...TOOL_DEFAULTS,
    userFacingName: () => def.name,
    ...def,
  } as BuiltTool<D>
}
```

### ToolResult and contextModifier

```typescript
export type ToolResult<T> = {
  data: T
  newMessages?: (UserMessage | AssistantMessage | ...)[]
  contextModifier?: (context: ToolUseContext) => ToolUseContext
}
```

The `contextModifier` mutates shared state without global variables. Applied serially after completion. Concurrent tools cannot use it.

### Optional Methods: UI & Security

- `renderToolUseMessage()` -- React node during streaming input
- `renderToolResultMessage()` -- React node for result in transcript
- `renderGroupedToolUse()` -- batch rendering for multiple same-type tools
- `toAutoClassifierInput()` -- compact security classifier representation; return `''` to skip
- `extractSearchText()` -- transcript search indexing
- `interruptBehavior()` -- `'cancel'` or `'block'`
- `shouldDefer` / `alwaysLoad` -- ToolSearch deferred loading flags

## Registration (tools.ts)

### getAllBaseTools() -- Exhaustive Catalog

```typescript
const REPLTool = process.env.USER_TYPE === 'ant'
  ? require('./tools/REPLTool/REPLTool.js').REPLTool
  : null

const SleepTool = feature('PROACTIVE') || feature('KAIROS')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null

export function getAllBaseTools(): Tools {
  return [
    AgentTool, TaskOutputTool, BashTool,
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    FileReadTool, FileEditTool, FileWriteTool,
    WebFetchTool, TodoWriteTool, WebSearchTool,
    // ... 30+ more tools, conditionally included
    ...(isToolSearchEnabledOptimistic() ? [ToolSearchTool] : []),
  ]
}
```

### getTools() -- Context Filtering

1. **Simple mode** (`CLAUDE_CODE_SIMPLE`) -- only Bash, Read, Edit
2. **REPL mode** -- hides primitive tools
3. **Deny rules** -- filters tools matching `alwaysDenyRules`
4. **`isEnabled()`** -- per-tool veto

### assembleToolPool() -- Built-ins + MCP, Cache-Stable Sort

```typescript
export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)
  const byName = (a, b) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',
  )
}
```

Built-ins sorted alphabetically as prefix, then MCP tools. Interleaving would invalidate cache whenever MCP tools sort between built-ins.

## Orchestration (toolOrchestration.ts)

### Partitioning Algorithm

- Consecutive tools with `isConcurrencySafe(input) === true` batch together and run parallel
- Non-safe tools break batches and run alone serially
- Try/catch wraps `isConcurrencySafe()` -- parse failures default to `false`

```typescript
for (const toolUse of toolUseMessages) {
  const safe = isConcurrencySafe(toolUse)
  if (safe && lastBatch?.isConcurrencySafe) {
    lastBatch.blocks.push(toolUse)
  } else {
    acc.push({ isConcurrencySafe: safe, blocks: [toolUse] })
  }
}
```

Concurrent batches use `all()` async-generator combinator with ceiling from `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default 10).

### Context Mutation: contextModifier Dance

```typescript
// Serial: apply immediately so next tool sees updated context
if (update.contextModifier) {
  currentContext = update.contextModifier.modifyContext(currentContext)
}

// Concurrent: queue, apply after batch
queuedContextModifiers[toolUseID].push(modifyContext)
for (const modifier of modifiers) {
  currentContext = modifier(currentContext)
}
```

## Streaming Execution (StreamingToolExecutor.ts)

### Tool Lifecycle States

```typescript
type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'
```

### Concurrency Guard: canExecuteTool()

```typescript
private canExecuteTool(isConcurrencySafe: boolean): boolean {
  const executing = this.tools.filter(t => t.status === 'executing')
  return (
    executing.length === 0 ||
    (isConcurrencySafe && executing.every(t => t.isConcurrencySafe))
  )
}
```

### Sibling Abort: Bash Errors Cascade

Only Bash errors cascade via `siblingAbortController`. Read/WebFetch/etc treated as independent.

```typescript
if (isErrorResult && tool.block.name === BASH_TOOL_NAME) {
  this.hasErrored = true
  this.erroredToolDescription = getToolDescription(tool)
  this.siblingAbortController.abort('sibling_error')
}
```

### In-Order Result Emission

Despite concurrent execution, results emit in model's requested order. Achieved by iterating `this.tools` in insertion order, yielding only when head tool is `completed`.

## Tool Execution Pipeline (toolExecution.ts)

### Full checkPermissionsAndCallTool() Flow

1. **Zod validation** -- `inputSchema.safeParse(input)`. Failure returns `InputValidationError`
2. **Semantic validation** -- `tool.validateInput()`. Custom per-tool checks
3. **Speculative classifier** -- Bash speculatively starts allow-classifier before hooks
4. **backfillObservableInput** -- creates shallow clone, adds legacy/derived fields
5. **PreToolUse hooks** -- async generators; yield progress, update input, set permission result
6. **canUseTool()** -- main permission gate
7. **tool.call()** -- actual execution with progress callback
8. **PostToolUse hooks** -- run after completion
9. **Result serialization** -- `mapToolResultToToolResultBlockParam()` + size-budget processing

### Input Mutation Safety: backfillObservableInput

```typescript
const backfilledClone =
  tool.backfillObservableInput && processedInput !== null
    ? ({ ...processedInput } as typeof processedInput)
    : null
if (backfilledClone) {
  tool.backfillObservableInput!(backfilledClone as Record<string, unknown>)
  processedInput = backfilledClone
}
```

Original `parsedInput.data` goes to `tool.call()`. Mutating original alters serialized transcript and breaks VCR fixture hashes.

### Defense-in-Depth: _simulatedSedEdit Stripping

```typescript
if (tool.name === BASH_TOOL_NAME && '_simulatedSedEdit' in processedInput) {
  const { _simulatedSedEdit: _, ...rest } = processedInput
  processedInput = rest
}
```

### Progress + Result Multiplexing via Stream

```typescript
const stream = new Stream<MessageUpdateLazy>()

checkPermissionsAndCallTool(..., progress => {
  stream.enqueue({ message: createProgressMessage(...) })
})
  .then(results => {
    for (const r of results) stream.enqueue(r)
  })
  .finally(() => stream.done())

return stream
```

## Permission Context

```typescript
export type ToolPermissionContext = DeepImmutable<{
  mode: PermissionMode
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
  alwaysAllowRules: ToolPermissionRulesBySource
  alwaysDenyRules:  ToolPermissionRulesBySource
  alwaysAskRules:   ToolPermissionRulesBySource
  isBypassPermissionsModeAvailable: boolean
  shouldAvoidPermissionPrompts?: boolean
  awaitAutomatedChecksBeforeDialog?: boolean
}>
```

---

# LESSON 17 -- BASH TOOL

## Seven Validation/Execution Layers + Three Output Layers

The Bash Tool implements seven distinct validation and execution layers before spawning any subprocess, followed by three output-handling layers.

## Shell Snapshot System

Every session captures the user's shell configuration into `~/.claude/shell-snapshots/snapshot-{shell}-{timestamp}-{random}.sh`.

**Snapshot Contents:**
- Functions via `typeset -f` (zsh) or `declare -F` (bash)
- Shell options (`setopt`/`shopt`)
- User aliases (excluding system wrappers like `winpty` on Windows)
- Embedded ripgrep shim if system `rg` unavailable
- Embedded `find`/`grep` shims in ant-native builds
- Process PATH from `process.env.PATH`

**Graceful Degradation:** If snapshot creation fails, spawns with `-l` (login shell flag). TOCTOU-aware re-check via `access(snapshotFilePath)`.

## Command Building Pipeline

`buildExecCommand()` assembles six sequential stages:

1. **Windows null redirect rewrite**: `2>nul` -> `2>/dev/null`
2. **Stdin redirect decision**: Appends `< /dev/null` for non-interactive commands
3. **Quote wrapping**: Single-quotes for eval pass via `singleQuoteForEval()`
4. **Pipe rearrangement**: Moves `< /dev/null` between first command and pipe
5. **Command assembly**: Sources snapshot, applies env script, disables extglob, evals quoted command
6. **Shell prefix formatting**: Applies `CLAUDE_CODE_SHELL_PREFIX` if set

**Extglob disabling**: Post-snapshot, injects `shopt -u extglob` (bash) or `setopt NO_EXTENDED_GLOB` (zsh) to prevent filename-based glob expansion attacks.

## The 23 Security Validators

Each validator returns: `allow` (early-pass), `passthrough` (no opinion), or `ask` (permission dialog). First non-passthrough result wins.

| # | Validator | Purpose |
|---|-----------|---------|
| 1 | INCOMPLETE_COMMANDS | Tabs, leading flags, continuation operators |
| 2 | JQ_SYSTEM_FUNCTION | jq env/path/builtins/modulemeta/debug intrinsics |
| 3 | JQ_FILE_ARGUMENTS | jq --args, --jsonargs, --rawfile, --slurpfile, --arg |
| 4 | OBFUSCATED_FLAGS | Encoded characters or unusual spacing |
| 5 | SHELL_METACHARACTERS | Unquoted `;`, `&&`, `||`, `|` |
| 6 | DANGEROUS_VARIABLES | `$BASH_ENV`, `$ENV`, `$CDPATH`, `$IFS` |
| 7 | NEWLINES | Unquoted newlines as command separators |
| 8 | DANGEROUS_PATTERNS (substitution) | Unquoted `$()`, `${}`, `$[]`, backticks, `<()`, `>()`, Zsh `=()` |
| 9 | DANGEROUS_PATTERNS (input redirect) | Unquoted `<` (except safe `< /dev/null`) |
| 10 | DANGEROUS_PATTERNS (output redirect) | Unquoted `>` or `>>` to non-null targets |
| 11 | IFS_INJECTION | `IFS=` assignment or unquoted `$IFS` |
| 12 | GIT_COMMIT_SUBSTITUTION | Early-allow for `git commit -m "msg"` without dangerous patterns |
| 13 | PROC_ENVIRON_ACCESS | References to `/proc/*/environ` |
| 14 | MALFORMED_TOKEN_INJECTION | Uses shell-quote parser to detect injection via unbalanced quotes |
| 15 | BACKSLASH_ESCAPED_WHITESPACE | Backslash-escaped spaces/tabs |
| 16 | BRACE_EXPANSION | Unquoted `{a,b,c}` or `{1..10}` |
| 17 | CONTROL_CHARACTERS | Raw ASCII \x00-\x1f (except tab/newline) |
| 18 | UNICODE_WHITESPACE | Non-ASCII whitespace (NBSP, em-space, zero-width) |
| 19 | MID_WORD_HASH | `#` adjacent to closing quote like `'x'#` |
| 20 | ZSH_DANGEROUS_COMMANDS | zmodload, emulate, sysopen, sysread, syswrite, zpty, ztcp, zsocket, zf_* |
| 21 | BACKSLASH_ESCAPED_OPERATORS | Backslash before `\;`, `\|`, `\&` |
| 22 | COMMENT_QUOTE_DESYNC | Quote-stripping places `#` at word boundary |
| 23 | QUOTED_NEWLINE | Literal newline inside quoted string |

**50-subcommand cap** returns `ask` as default -- legitimate commands never approach this limit.

**ValidationContext structure:**
```typescript
type ValidationContext = {
  originalCommand: string
  baseCommand: string
  unquotedContent: string
  fullyUnquotedContent: string
  fullyUnquotedPreStrip: string
  unquotedKeepQuoteChars: string
  treeSitter?: TreeSitterAnalysis | null
}
```

## Permission Plumbing

`bashToolHasPermission()` layers four independent checks:

1. **Permission mode**: Read-only mode denial
2. **Security validators**: 23-validator chain
3. **Read-only constraints**: Prevents writes/deletes in read-only mode
4. **Path constraints**: Allowlist/denylist enforcement
5. **Sed constraints**: Preview dialog for `sed -i` patterns
6. **Command operator permissions**: Per-subcommand rule matching

**Environment variable stripping before rule matching:**

*Phase 1*: Strip leading env vars in `SAFE_ENV_VARS` allowlist (build/locale/display vars -- NOT `PATH`, `LD_PRELOAD`, `PYTHONPATH`).

*Phase 2*: Strip wrapper commands (`timeout`, `time`, `nice`, `nohup`).

Both phases iterate to fixed-point.

**Rule matching modes:**
- **Exact**: `Bash(git status)` -- only that exact command
- **Prefix (legacy)**: `Bash(npm run:*)` -- matches `npm run` plus anything
- **Wildcard**: `Bash(git * --force)` -- glob pattern matching

## Sandboxing

`shouldUseSandbox()` makes four-way decision:

1. Sandboxing enabled system-wide
2. User-override check
3. Empty command check
4. User-configured excluded commands

**Sandbox controls:**
- Filesystem read: deny-only list (e.g., `~/.ssh`)
- Filesystem write: allow-only list (e.g., project dir, `$TMPDIR`)
- Network: optional `allowedHosts`/`deniedHosts`

## Background Execution

Three execution paths:
1. **Explicit**: `run_in_background: true` -- model-initiated
2. **User-initiated**: Ctrl+B during execution
3. **Auto-background**: After 15 seconds in assistant mode

## Output Handling

**Size limits:**
- `BASH_MAX_OUTPUT_DEFAULT`: 30,000 chars (configurable)
- `BASH_MAX_OUTPUT_UPPER_LIMIT`: 150,000 chars (hard cap)
- Tool-results directory copy: capped at 64 MB

**Image detection**: stdout starting with base64 PNG/JPEG header -> `isImage: true`

**Semantic exit code interpretation**: `interpretCommandResult()` maps non-zero codes to human-readable notes (e.g., `grep` exit 1 = "no matches").

**Claude Code hints protocol**: CLIs setting `CLAUDECODE=1` emit `<claude-code-hint />` tags to stderr. Tool scans, records, then strips before model sees output.

## Input/Output Schemas

```typescript
const fullInputSchema = z.strictObject({
  command: z.string(),
  timeout: z.number().optional(),
  description: z.string().optional(),
  run_in_background: z.boolean().optional(),
  dangerouslyDisableSandbox: z.boolean().optional(),
  _simulatedSedEdit: z.object({
    filePath: z.string(),
    newContent: z.string()
  }).optional()  // NEVER exposed to model
})
```

`_simulatedSedEdit` hidden from model schema to prevent bypassing permission dialog.

## UI Classification

```javascript
BASH_SEARCH_COMMANDS = ['find', 'grep', 'rg', 'ag', 'ack', ...]
BASH_READ_COMMANDS = ['cat', 'head', 'tail', 'jq', 'awk', ...]
BASH_LIST_COMMANDS = ['ls', 'tree', 'du']
BASH_SEMANTIC_NEUTRAL_COMMANDS = ['echo', 'printf', 'true', 'false', ':']
BASH_SILENT_COMMANDS = ['mv', 'cp', 'rm', 'mkdir', ...]
```

---

# LESSON 18 -- FILE TOOLS (READ, WRITE, EDIT)

## Core Invariant

"Every write operation requires a prior read of the target file."

## Tool Capabilities Summary

| Capability | Read | Write | Edit |
|---|---|---|---|
| Read-only/safe for concurrency | Yes | No | No |
| Requires prior Read of existing file | -- | Yes | Yes |
| Handles images natively | Yes | No | No |
| Handles PDFs natively | If supported | No | No |
| Handles Jupyter notebooks | Yes | No | No -- use NotebookEdit |
| Quote normalization | -- | -- | Yes |
| Dedup (skip re-sending unchanged file) | Yes | -- | -- |
| Token limit enforced | 25,000 tok default | -- | -- |
| LSP notifications on save | No | Yes | Yes |
| Max file size (Edit) | -- | -- | 1 GiB |

## Read Tool Deep-Dive

### Pagination: offset + limit
Default: up to 2,000 lines starting at line 1.

### Token Limit Enforcement
Two-stage gate: fast rough estimate first, then exact token count if suspicious. Default **25,000** tokens. 256 KB size gate checks before reading.

Truncation was tested (issue #21841) and reverted -- throwing yields ~100-byte error vs. ~25K token truncated response.

### Image Support
Detected types: PNG, JPG, JPEG, GIF, WebP. Optionally resized via `sharp` or native `image-processor-napi`.

**macOS detail:** Screenshot filenames use either regular space or thin space (U+202F) before AM/PM. Read auto-retries with alternate space on ENOENT.

### PDF Support
`pages` parameter: ranges like `"1-5"`, `"3"`, `"10-20"`. Hard cap: **20 pages per call**.

### Jupyter Notebooks
`.ipynb` files: Every cell passed through `mapNotebookCellsToToolResult()`.

### Dedup: Avoiding Re-Sent Unchanged Files

```javascript
readFileState.set(fullFilePath, {
  content,
  timestamp: getFileModificationTime(fullFilePath),
  offset,
  limit,
})
```

On subsequent Read, checks on-disk `mtime`. If matches, returns lightweight stub. A/B data showed ~18% of Read calls are same-file re-reads.

### Blocked Device Paths

```javascript
'/dev/zero', '/dev/random', '/dev/urandom', '/dev/full'
'/dev/stdin', '/dev/tty', '/dev/console'
'/dev/fd/0', '/dev/fd/1', '/dev/fd/2'
```

### Limits Precedence: env var > GrowthBook > default

1. `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`
2. GrowthBook flag `tengu_amber_wren`
3. Hardcoded default -- 25,000 tokens / 256 KB

## Write Tool Deep-Dive

Full-content replacement. Creates new file or overwrites existing entirely.

### The Read-Before-Write Gate

Three failure modes:
1. **No read in session** -- `errorCode: 2`
2. **Read was partial** -- `errorCode: 2`, partial reads flagged `isPartialView: true`
3. **File modified after read** -- `errorCode: 3`

**Windows special case:** On Windows, mtime can change without content changes. For full reads, Write falls back to content comparison.

### Line-Ending Policy
Write always persists with **LF line endings**, regardless of old file's endings.

### Atomic Write Sequence

```javascript
// 1. mkdir (async, before critical section)
await fs.mkdir(dir)

// 2. Backup for file history (async, idempotent)
await fileHistoryTrackEdit(...)

// 3. Sync read + staleness check (critical section starts)
meta = readFileSyncWithMetadata(fullFilePath)
if (lastWriteTime > lastRead.timestamp) throw FILE_UNEXPECTEDLY_MODIFIED_ERROR

// 4. Write to disk (critical section ends)
writeTextContent(fullFilePath, content, enc, 'LF')
```

### After Successful Write

- LSP notifications: `didChange` + `didSave`
- VSCode diff update
- readFileState updated
- CLAUDE.md telemetry if applicable
- Skill discovery for path

## Edit Tool Deep-Dive

Exact string replacement. Only diff transmitted.

### String Replacement Mechanics

If string appears more than once, Edit refuses with error `9` unless `replace_all: true`.

### Quote Normalization

`findActualString()` normalizes both file and search string to straight quotes, locates match, returns original curly-quote version. `preserveQuoteStyle()` applies curly-quote style to `new_string`.

```javascript
str
  .replaceAll('\u2018', "'")  // left single curly
  .replaceAll('\u2019', "'")  // right single curly
  .replaceAll('\u201C', '"')  // left double curly
  .replaceAll('\u201D', '"')  // right double curly
```

### Contraction Detection
Single quote flanked by two Unicode letters treated as apostrophe, gets right single curly quote.

### New File Creation via Edit
`old_string: ""` on non-existent file creates it.

### The Desanitization Table
API sanitizes certain XML-like tokens. Edit tries desanitized version of `old_string`:

```
'<fnr>'           -> '<function_results>'
'<n>'             -> '<name>'
'<o>'             -> '<output>'
'<e>'             -> '<error>'
'\n\nH:'          -> '\n\nHuman:'
'\n\nA:'          -> '\n\nAssistant:'
```

### Trailing Whitespace Stripping
`normalizeFileEditInput()` strips trailing whitespace from each line of `new_string`. **Exception:** `.md` and `.mdx` files skipped.

## The Read-Before-Write Contract (Both Tools)

1. **Phase 1**: Read stores `{ content, timestamp, offset, limit }` in `readFileState`
2. **Phase 2**: `validateInput()` checks readFileState (pre-permission)
3. **Phase 3**: `call()` runs atomic staleness check again (synchronous read)
4. **Phase 4**: Write/Edit executes and updates readFileState

---

# LESSON 19 -- SEARCH TOOLS (GLOB & GREP)

## Two Search Tools

| Tool | User-facing name | What it searches | Returns | Hard limit |
|------|------------------|------------------|---------|-----------|
| Glob | Search | File names (glob) | Array of file paths sorted by mtime | 100 files (configurable) |
| Grep | Search | File contents (regex) | Paths, lines, or counts | 250 lines/files (default head_limit) |

Both tools share the user-facing name "Search."

## Glob Delegates to ripgrep

The Glob tool does not use Node's `fs.glob` or JavaScript glob libraries. Entirely delegates to ripgrep via `utils/glob.ts`.

### Core glob() Function

```typescript
export async function glob(
  filePattern: string,
  cwd: string,
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
  toolPermissionContext: ToolPermissionContext,
): Promise<{ files: string[]; truncated: boolean }>
```

### ripgrep Arguments
- `'--files'` -- list files instead of searching content
- `'--glob', searchPattern` -- the glob pattern
- `'--sort=modified'` -- sort by modification time
- `'--no-ignore'` (conditional)
- `'--hidden'` (conditional)

### Absolute-Path Pattern Decomposition

```typescript
export function extractGlobBaseDirectory(pattern: string): {
  baseDir: string; relativePattern: string
} {
  const match = pattern.match(/[\*?\[{\]/)
  if (!match || match.index === undefined) {
    return { baseDir: dirname(pattern), relativePattern: basename(pattern) }
  }
  const staticPrefix = pattern.slice(0, match.index)
  const lastSep = Math.max(
    staticPrefix.lastIndexOf('/'),
    staticPrefix.lastIndexOf(sep)
  )
  if (lastSep === -1) return { baseDir: '', relativePattern: pattern }
  return {
    baseDir: staticPrefix.slice(0, lastSep),
    relativePattern: pattern.slice(lastSep + 1)
  }
}
```

### Environment Variables
- `CLAUDE_CODE_GLOB_NO_IGNORE=false` -- respect `.gitignore` (default: include everything)
- `CLAUDE_CODE_GLOB_HIDDEN=false` -- exclude hidden files (default: include them)

## Grep's Three Output Modes

### files_with_matches
- **Flag**: `rg -l`
- Returns only file paths, sorted by mtime

### content
- **Flag**: `rg` (default)
- Supports `-n`, `-B`/`-A`/`-C`, multiline mode

### count
- **Flag**: `rg -c`
- Returns per-file match counts

### Output Mode Dispatch

```typescript
if (output_mode === 'files_with_matches') {
  args.push('-l')
} else if (output_mode === 'count') {
  args.push('-c')
}

if (show_line_numbers && output_mode === 'content') {
  args.push('-n')
}

if (output_mode === 'content') {
  if (context !== undefined) {
    args.push('-C', context.toString())
  } else if (context_c !== undefined) {
    args.push('-C', context_c.toString())
  } else {
    if (context_before !== undefined) args.push('-B', context_before.toString())
    if (context_after  !== undefined) args.push('-A', context_after.toString())
  }
}
```

### mtime Sort in files_with_matches Mode

```typescript
const stats = await Promise.allSettled(
  results.map(_ => getFsImplementation().stat(_))
)
const sortedMatches = results
  .map((_, i) => {
    const r = stats[i]!
    return [_, r.status === 'fulfilled' ? (r.value.mtimeMs ?? 0) : 0] as const
  })
  .sort((a, b) => {
    if (process.env.NODE_ENV === 'test') return a[0].localeCompare(b[0])
    const timeComparison = b[1] - a[1]
    return timeComparison === 0 ? a[0].localeCompare(b[0]) : timeComparison
  })
  .map(_ => _[0])
```

## Pagination: head_limit and offset

```typescript
function applyHeadLimit<T>(
  items: T[],
  limit: number | undefined,
  offset: number = 0,
): { items: T[]; appliedLimit: number | undefined } {
  if (limit === 0) {
    return { items: items.slice(offset), appliedLimit: undefined }
  }
  const effectiveLimit = limit ?? 250
  const sliced = items.slice(offset, offset + effectiveLimit)
  const wasTruncated = items.length - offset > effectiveLimit
  return {
    items: sliced,
    appliedLimit: wasTruncated ? effectiveLimit : undefined,
  }
}
```

- `limit=0` is the unlimited escape hatch
- `appliedLimit` only set when truncation occurs
- Head-limiting before path relativization

## ripgrep Binary Resolution

Three-mode resolution chain, evaluated once per process and memoized:

**system**: User has `USE_BUILTIN_RIPGREP` set to falsy AND `rg` is on PATH

**embedded**: Running in bundled Bun mode. Spawned via `process.execPath` with `argv0='rg'`

**builtin**: Default npm install. Platform-specific binary at `vendor/ripgrep/<arch>-<platform>/rg[.exe]`

```typescript
type RipgrepConfig = {
  mode: 'system' | 'builtin' | 'embedded'
  command: string
  args: string[]
  argv0?: string
}

const getRipgrepConfig = memoize((): RipgrepConfig => {
  const userWantsSystemRipgrep = isEnvDefinedFalsy(process.env.USE_BUILTIN_RIPGREP)
  if (userWantsSystemRipgrep) {
    const { cmd: systemPath } = findExecutable('rg', [])
    if (systemPath !== 'rg') {
      // SECURITY: Use command name 'rg', NOT systemPath
      return { mode: 'system', command: 'rg', args: [] }
    }
  }
  if (isInBundledMode()) {
    return {
      mode: 'embedded',
      command: process.execPath,
      args: ['--no-config'],
      argv0: 'rg',
    }
  }
  const command = process.platform === 'win32'
    ? path.resolve(rgRoot, `${process.arch}-win32`, 'rg.exe')
    : path.resolve(rgRoot, `${process.arch}-${process.platform}`, 'rg')
  return { mode: 'builtin', command, args: [] }
})
```

### macOS Code-Signing for Builtin Binary
Vendored `rg` re-signed with `codesign --sign -` (ad-hoc). Quarantine xattr stripped.

### EAGAIN Retry with Single-Threaded Fallback

```typescript
if (!isRetry && isEagainError(stderr)) {
  ripGrepRaw(args, target, abortSignal, handleResult, true)
  return
}

function isEagainError(stderr: string): boolean {
  return (
    stderr.includes('os error 11') ||
    stderr.includes('Resource temporarily unavailable')
  )
}
```

One retry with `-j 1` for that specific call only.

## Performance Architecture

- **Timeout**: 20 seconds standard, 60 seconds WSL
- **Buffer Cap**: 20MB (`MAX_BUFFER_SIZE`)
- **Line Length Cap**: 500 chars (`--max-columns 500`)
- **Path Relativization**: Saves tokens on all returned paths
- **Concurrent Safety**: Both tools declare `isConcurrencySafe() = true`
- **Streaming for File Counting**: `countFilesRoundedRg()` uses streaming counter, not buffered

## VCS Directory Exclusions (Grep)

```typescript
const VCS_DIRECTORIES_TO_EXCLUDE = [
  '.git', '.svn', '.hg', '.bzr', '.jj', '.sl',
] as const
```

## Pattern Safety

Leading-dash patterns use `-e` flag:
```typescript
if (pattern.startsWith('-')) {
  args.push('-e', pattern)
} else {
  args.push(pattern)
}
```

**UNC Path Bypass**: Skip filesystem `stat` calls for `\\` or `//` paths to prevent NTLM credential leaks.

---

# LESSON 07 -- MCP SYSTEM

## Core Architecture Layers

- **services/mcp/**: Connection lifecycle, config loading, OAuth, transport construction
- **tools/MCPTool/**: Proxy wrapper for remote MCP tool calls
- **commands/mcp/**: User-facing `/mcp` slash command interface
- **components/mcp/**: React UI panels for settings and management

## Transport Types (8 Total)

**Public Transports (OAuth-capable):**
- **stdio**: Spawns subprocess, communicates via stdin/stdout (default)
- **sse**: HTTP Server-Sent Events with `ClaudeAuthProvider`
- **http**: Streamable HTTP (MCP 2025-03-26 spec) supporting OAuth + session-ingress JWT
- **ws**: WebSocket with `protocols: ['mcp']`, proxy agent and mTLS support

**IDE-Only Transports:**
- **sse-ide**: SSE variant without OAuth
- **ws-ide**: WebSocket accepting optional `X-Claude-Code-Ide-Authorization` header

**Internal Transports:**
- **sdk**: Control-message bridge to SDK process via stdout/stdin
- **in-process**: Linked pair using `createLinkedTransportPair()`, delivers messages via `queueMicrotask`

## Configuration Scope Cascade (7 levels)

1. **enterprise** (highest): `managed-mcp.json` -- blocks all user add/remove operations
2. **dynamic**: CLI flag `--mcp-config <path>`
3. **claudeai**: Claude.ai connector API (deduplicated by URL signature)
4. **project**: `.mcp.json` (nearest-to-cwd wins; parent dirs searched with child override)
5. **local**: `~/.claude/projects/<hash>/` per-project state
6. **user**: `~/.claude/settings.json` global config
7. **managed** (lowest): Plugin-provided servers (namespaced `plugin:name:server`)

When `managed-mcp.json` exists, "calling `addMcpConfig()` throws immediately: 'enterprise MCP configuration is active and has exclusive control.'"

Enterprise policy can define `allowedMcpServers` and `deniedMcpServers` matching by name, command array, or glob URL patterns (denylist takes precedence).

## Connection Lifecycle (8 Phases)

1. **Config assembly**: Merge all scopes, policy filter, expand env vars (`$VAR` / `${VAR}`)
2. **Batched connection**: Stdio servers batch at 3; remote servers at 20 (memoized by `name + JSON(config)`)
3. **Transport construction**: Instantiate SDK transport class with auth providers, proxy agents, mTLS
4. **client.connect() with timeout**: Default 30s (configurable via `MCP_TIMEOUT`); races against timeout promise
5. **Auth handling**: `UnauthorizedError` (401) moves server to `needs-auth` state; injects `McpAuthTool` pseudo-tool
6. **Capability negotiation**: Declares `roots: {}` and `elicitation: {}` capabilities; truncates server instructions to 2048 chars
7. **Tool/resource/prompt fetch**: Parallel fetch; normalizes tool names to `mcp__server__tool`
8. **Live notifications**: Subscribes to list-changed notifications with exponential backoff reconnect (1s -> 30s cap, max 5 attempts)

## Tool Proxying & Normalization

**Normalization rules:**
- Replace non-alphanumeric (except `_` and `-`) with underscore
- For claude.ai servers: collapse consecutive underscores, strip leading/trailing
- Full tool name: `mcp__<server>__<tool>`

**Hard limits:**
- Tool descriptions: 2048 character cap
- Server instructions: 2048 character cap
- Total result > 100 KB triggers truncation

**Result handling:**
- Image content: resized/downsampled, returned as base64
- Binary blobs: persisted to disk, path returned as text

## OAuth Authentication Flow

PKCE flow with XAA (Cross-App Access) extension support.

When server enters `needs-auth` state, system injects `mcp__<server>__authenticate`. Model triggers OAuth, receives authorization URL, upon callback completion real tools replace pseudo-tool.

**Slack quirk normalization**: Slack returns HTTP 200 with `{"error":"invalid_refresh_token"}` instead of standard 400. Claude Code normalizes to `invalid_grant` before SDK processing, rewriting to synthetic 400.

**XAA mode**: When `xaa: true`, exchanges IdP ID-token for MCP server's OAuth token silently.

## Elicitation System

Two modes:
- **form mode**: Server sends JSON Schema; user fills form with `accept`, `decline`, or `cancel`
- **url mode**: Server sends URL; two-phase system opens URL, waits for `ElicitationComplete` notification

Requests queue in `AppState.elicitation.queue` as `ElicitationRequestEvent` objects.

## Server Deduplication

By content signature, not name:
- Stdio: `stdio:["cmd","arg1"]`
- Remote: `url:https://vendor.example.com/mcp`

**Rules:**
- Manual wins over plugin
- First plugin wins if two provide same server
- Enabled manual wins over claude.ai
- Plugin servers namespaced `plugin:name:server`

**CCR proxy unwrapping**: `unwrapCcrProxyUrl()` extracts original vendor URL from proxy URL before signature comparison.

---

# END OF COMPILATION

This document contains the complete technical extraction from all 10 lessons of the Claude Code Source Deep Dive course at https://www.markdown.engineering/learn-claude-code/. Every architecture detail, code example, design pattern, data structure, and configuration reference has been preserved.
