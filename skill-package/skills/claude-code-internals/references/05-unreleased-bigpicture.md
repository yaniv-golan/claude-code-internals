# Claude Code Source Deep Dive -- 10 Lessons Complete Technical Extraction

---

## LESSON 1: ULTRAPLAN -- 30-Minute Remote Planning

**Source files:**
- `commands/ultraplan.tsx`
- `utils/ultraplan/ccrSession.ts`
- `utils/ultraplan/keyword.ts`
- `utils/teleport.tsx`
- `tasks/RemoteAgentTask/RemoteAgentTask.tsx`

### Four Phases

**Phase 1 - Trigger Detection:** `keyword.ts` scans for "ultraplan" or routes `/ultraplan` command

**Phase 2 - CCR Launch:** `teleportToRemote()` creates session, uploads git bundle, returns session ID

**Phase 3 - Long-Poll:** `pollForApprovedExitPlanMode()` polls event stream every 3 seconds for up to 30 minutes

**Phase 4 - Plan Delivery:** Plan lands locally via `UltraplanChoiceDialog` or executes in CCR

### Keyword Trigger: Smart Disambiguation

The `findKeywordTriggerPositions()` function in `keyword.ts` filters OUT triggers in these contexts:

```javascript
// 1. Slash-command input -- /ultraplan routed to command handler
if (text.startsWith('/')) return []

// 2. Inside paired delimiters: `backticks`, "quotes", <tags>, {braces}, [brackets], (parens)
// e.g. `src/ultraplan/foo.ts` or <ultraplan> in HTML do NOT trigger

// 3. Path/identifier context: preceded/followed by / \ -
// e.g. src/ultraplan/ or --ultraplan-mode do NOT trigger

// 4. Followed by ? -- question about the feature shouldn't invoke
// e.g. "what is ultraplan?" does NOT trigger

// 5. Followed by . + word char (file extension)
// e.g. ultraplan.tsx does NOT trigger
```

**Keyword replacement logic:**

```javascript
export function replaceUltraplanKeyword(text: string): string {
  const [trigger] = findUltraplanTriggerPositions(text)
  if (!trigger) return text
  const before = text.slice(0, trigger.start)
  const after  = text.slice(trigger.end)
  if (!(before + after).trim()) return ''
  // Preserves user casing: "ultraplan" -> "plan", "Ultraplan" -> "Plan"
  return before + trigger.word.slice('ultra'.length) + after
}
```

### Launch Sequence -- The Detached Pattern

```javascript
export async function launchUltraplan(opts): Promise<string> {
  // Synchronously set ultraplanLaunching to block duplicate launches
  setAppState(prev => prev.ultraplanLaunching ? prev :
    { ...prev, ultraplanLaunching: true })

  void launchDetached({ blurb, seedPlan, getAppState, setAppState, signal, onSessionReady })

  return buildLaunchMessage(disconnectedBridge)
  // "--- ultraplan\nStarting Claude Code on the web..."
}
```

**Design insight:** The `ultraplanLaunching` flag is set synchronously before detached flow starts. This closes the window where two rapid keypresses could both pass the guard check before either calls `teleportToRemote()`. Flag clears when session URL arrives or on error.

### Prompt Construction

```javascript
export function buildUltraplanPrompt(blurb: string, seedPlan?: string): string {
  const parts: string[] = []
  if (seedPlan) {
    parts.push('Here is a draft plan to refine:', '', seedPlan, '')
  }
  parts.push(ULTRAPLAN_INSTRUCTIONS) // from prompt.txt, wrapped in <system-reminder>
  if (blurb) {
    parts.push('', blurb)
  }
  return parts.join('\n')
}
```

The blurb and seed plan render visibly to the user in CCR browser. Scaffolding instructions go in `<system-reminder>` tag -- model sees them, UI hides them. Word "ultraplan" is absent from prompt to prevent remote CCR CLI from self-triggering.

### Eligibility Checks

`checkRemoteAgentEligibility()` validates preconditions as notifications (not thrown errors):

```javascript
// RemoteAgentTask.tsx -- formatted error messages
case 'not_logged_in':
  return 'Please run /login and sign in with your Claude.ai account (not Console).'
case 'no_remote_environment':
  return 'No cloud environment available. Set one up at https://claude.ai/code/onboarding?magic=env-setup'
case 'not_in_git_repo':
  return 'Background tasks require a git repository.'
case 'no_git_remote':
  return 'Background tasks require a GitHub remote.'
case 'github_app_not_installed':
  return 'The Claude GitHub app must be installed on this repository first.'
case 'policy_blocked':
  return "Remote sessions are disabled by your organization's policy."
```

### teleportToRemote() -- CCR Session Factory

```javascript
const session = await teleportToRemote({
  initialMessage: prompt,
  description:   blurb || 'Refine local plan',
  model:         getUltraplanModel(),    // opus4.6 from GrowthBook flag
  permissionMode: 'plan',
  ultraplan:      true,
  signal,
  useDefaultEnvironment: true,
  onBundleFail:  msg => { bundleFailMsg = msg }
})
```

Process: Claude Haiku generates session title and `claude/<slug>` branch name from description, POSTs to `/v1/sessions` with OAuth headers, git source, and initial message. Returned `session.id` anchors everything that follows.

### The Polling Engine -- Cursor-Based Pagination

```javascript
const POLL_INTERVAL_MS = 3000
const MAX_CONSECUTIVE_FAILURES = 5  // ~600 calls over 30min; tolerate transient 5xx

while (Date.now() < deadline) {
  if (shouldStop?.()) throw new UltraplanPollError('poll stopped by caller', 'stopped', ...)

  const resp = await pollRemoteSessionEvents(sessionId, cursor)
  cursor = resp.lastEventId
  const result = scanner.ingest(resp.newEvents)
  // ... classify result and update phase ...
  await sleep(POLL_INTERVAL_MS)
}
```

Calls `GET /v1/sessions/{id}/events?after_id={cursor}`, fetching up to 50 pages per call. Cursor advances to `response.lastEventId` -- poller never re-reads events.

### ExitPlanModeScanner -- Pure Stateful Classifier

Tracks three internal collections:
- `exitPlanCalls` (tool_use IDs for ExitPlanMode)
- `results` (tool_result blocks keyed by ID)
- `rejectedIds` (IDs user rejected in browser)

**ScanResult kinds:**

```javascript
// 'approved'   -> plan in tool_result with is_error=false, marker "## Approved Plan:"
// 'teleport'   -> is_error=true but contains ULTRAPLAN_TELEPORT_SENTINEL marker
// 'rejected'   -> is_error=true, no sentinel -- user said "revise this"
// 'pending'    -> tool_use seen, no tool_result yet (browser showing approval dialog)
// 'terminated' -> result(non-success) -- remote session crashed or hit max turns
// 'unchanged'  -> no new relevant events
```

**Precedence:** If batch contains both approval AND subsequent crash, approved plan is returned. Order: approved > terminated > rejected > pending > unchanged.

### Phase Transitions

Poller surfaces three phases via `onPhaseChange()`:

- **running** (default): Remote executing turns, no special badge
- **needs_input**: Remote asked clarifying question, idle. Badge: "needs input"
- **plan_ready**: ExitPlanMode tool_use exists with no tool_result. Badge: "plan ready"

**Quiet-idle heuristic:**

```javascript
const quietIdle =
  (sessionStatus === 'idle' || sessionStatus === 'requires_action') &&
  newEvents.length === 0

const phase: UltraplanPhase = scanner.hasPendingPlan
  ? 'plan_ready'
  : quietIdle
    ? 'needs_input'
    : 'running'
```

CCR flips to "idle" briefly between tool turns. Poller only trusts it when there is no activity on same tick.

### Plan Delivery: Two Paths

**Path A: Remote Execution**

User clicked "Execute" inside CCR browser PlanModal. Remote session already in coding mode.

```javascript
if (executionTarget === 'remote') {
  updateTaskState(taskId, setAppState, t => ({
    ...t, status: 'completed', endTime: Date.now()
  }))
  enqueuePendingNotification({
    value: [
      `Ultraplan approved -- executing in Claude Code on the web. Follow along at: ${url}`,
      '',
      'Results will land as a pull request when the remote session finishes.',
      'There is nothing to do here.'
    ].join('\n'),
    mode: 'task-notification'
  })
}
```

Do NOT archive session (archiving stops it). Do NOT show choice dialog. Mark task completed, enqueue notification.

**Path B: Teleport**

User clicked "Teleport back to terminal" in PlanModal browser. Browser sends `is_error=true` tool_result with sentinel string `__ULTRAPLAN_TELEPORT_LOCAL__` prefix followed by plan text.

**Sentinel extraction:**

```javascript
export const ULTRAPLAN_TELEPORT_SENTINEL = '__ULTRAPLAN_TELEPORT_LOCAL__'

function extractTeleportPlan(content): string | null {
  const text = contentToText(content)
  const marker = `${ULTRAPLAN_TELEPORT_SENTINEL}\n`
  const idx = text.indexOf(marker)
  if (idx === -1) return null         // no sentinel -> normal rejection
  return text.slice(idx + marker.length).trimEnd()
}

// approved path uses different extractor
function extractApprovedPlan(content): string {
  // Checks "## Approved Plan (edited by user):\n" first,
  // then "## Approved Plan:\n"
}
```

### Stopping and Cleanup

```javascript
export async function stopUltraplan(taskId, sessionId, setAppState): Promise<void> {
  await RemoteAgentTask.kill(taskId, setAppState) // archives session internally
  setAppState(prev => ({
    ...prev,
    ultraplanSessionUrl:     undefined,
    ultraplanPendingChoice:  undefined,
    ultraplanLaunching:      undefined
  }))
  enqueuePendingNotification({ value: `Ultraplan stopped.\n\nSession: ${url}`, ... })
  enqueuePendingNotification({
    value: 'The user stopped the ultraplan session above. Do not respond...',
    mode: 'task-notification',
    isMeta: true  // model-only instruction, not shown to user
  })
}
```

**Orphan prevention:** If error occurs after `teleportToRemote()` succeeds but before poll loop is healthy, catch block archives session explicitly. Without this, remote container runs for 30 minutes with no poller watching.

### RemoteAgentTask Integration

```javascript
type RemoteAgentTaskState = TaskStateBase & {
  type:             'remote_agent'
  remoteTaskType:   RemoteTaskType   // 'ultraplan' | 'ultrareview' | 'remote-agent' | ...
  sessionId:        string
  isUltraplan?:     boolean
  ultraplanPhase?:  Exclude<UltraplanPhase, 'running'>  // 'needs_input' | 'plan_ready'
  log:              SDKMessage[]
  todoList:         TodoList
}
```

The `isUltraplan: true` flag distinguishes from regular remote-agent tasks so generic poller `startRemoteSessionPolling` knows not to declare completion -- ULTRAPLAN lifecycle owned by `startDetachedPoll`.

### Model Selection and Feature Flags

```javascript
function getUltraplanModel(): string {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_ultraplan_model',
    ALL_MODEL_CONFIGS.opus46.firstParty   // fallback
  )
}
```

### Phase State Machine

```
running -> needs_input (quietIdle: sessionStatus=idle AND newEvents=0)
running -> plan_ready (ExitPlanMode tool_use seen, no tool_result)
needs_input -> running (user replies in browser, new events arrive)
plan_ready -> running (user rejects plan: is_error=true, no sentinel)
plan_ready -> approved (user approves: is_error=false, executionTarget=remote)
plan_ready -> teleport (user clicks "back to terminal", sentinel found, executionTarget=local)
running -> terminated (result non-success, subtype=error_during_execution or error_max_turns)
running -> timeout (30 minutes elapsed, no approval)
approved -> [END]
teleport -> [END]
terminated -> [END]
timeout -> [END]
```

### ExitPlanModeScanner Ingest Logic

**First pass:** Walk every event, update three data structures:
- For `type:'assistant'` messages: tool_use block with name `exit_plan_mode_v2` pushed to `exitPlanCalls[]`
- For `type:'user'` messages: tool_result blocks stored in `results` map keyed by `tool_use_id`
- For `type:'result'` non-success subtype: set `terminated` flag with subtype string

**Second pass (scan):** Iterate `exitPlanCalls` newest to oldest, skip rejected IDs:
- No tool_result yet -> `{ kind: 'pending' }`
- tool_result with `is_error=true` + sentinel -> `{ kind: 'teleport' }`
- tool_result with `is_error=true`, no sentinel -> `{ kind: 'rejected' }`
- tool_result with `is_error=false` -> `{ kind: 'approved' }`

---

## LESSON 2: ENTRYPOINTS & AGENT SDK

**Source files:**
- `src/entrypoints/cli.tsx`
- `src/entrypoints/init.ts`
- `src/entrypoints/mcp.ts`
- `src/entrypoints/agentSdkTypes.ts`
- `src/entrypoints/sandboxTypes.ts`
- `src/entrypoints/sdk/` subdirectory

### cli.tsx -- Bootstrap Dispatcher

`src/entrypoints/cli.tsx` runs before any other module evaluation. Design philosophy: load minimal code for each fast-path.

**Fast Paths (Detection Order):**

1. **`--version / -v`**: Zero imports; prints `MACRO.VERSION` (inlined at build time)
2. **`--dump-system-prompt`**: Loads only config, model, prompts modules
3. **Chrome/Computer-Use MCP**: `--claude-in-chrome-mcp` and `--computer-use-mcp` launch standalone servers
4. **`--daemon-worker=<kind>`**: Spawned by daemon supervisor; loads only worker registry
5. **Bridge/Remote Control**: `remote-control`, `rc`, `sync`, `bridge` subcommands
6. **`daemon` subcommand**: Long-running supervisor; delegates to `daemon/main.js`
7. **Background sessions**: `ps`, `logs`, `attach`, `kill`, `--bg` without loading interactive UI
8. **Fallthrough**: Full CLI via `main.tsx`

```javascript
if (feature('BRIDGE_MODE') && (args[0] === 'remote-control' || args[0] === 'rc'
    || args[0] === 'remote' || args[0] === 'sync' || args[0] === 'bridge')) {
  const { bridgeMain } = await import('../bridge/bridgeMain.js');
  await bridgeMain(args.slice(1));
  return;
}
```

**Design Pattern**: Every fast-path checks a `feature()` flag -- a Bun build-time dead-code-elimination gate. Unsupported features are completely absent from external distribution builds, not just runtime-gated.

### init.ts -- Shared Initialization

Memoized `init()` function. Performs one-time setup before the first API call.

**init() Sequence (In Order):**

1. `enableConfigs()` -- validates and activates settings system
2. `applySafeConfigEnvironmentVariables()` -- applies safe env vars pre-trust dialog
3. `applyExtraCACertsFromConfig()` -- sets TLS CA certs before first connection
4. `setupGracefulShutdown()` -- registers SIGTERM/SIGINT handlers for flush-on-exit
5. `initialize1PEventLogging()` -- lazily loads OpenTelemetry analytics (~400KB deferred)
6. `populateOAuthAccountInfoIfNeeded()` -- fills missing OAuth cache from keychain
7. `initJetBrainsDetection()` -- detects IDE host asynchronously
8. `initializeRemoteManagedSettingsLoadingPromise()` -- sets up enterprise policy loading
9. `configureGlobalMTLS() / configureGlobalAgents()` -- TLS + proxy agents
10. `preconnectAnthropicApi()` -- warms TCP+TLS (~150ms) in parallel with CLI parsing
11. `initUpstreamProxy()` -- CCR upstream proxy for org-injected credentials (CLAUDE_CODE_REMOTE)
12. `registerCleanup(shutdownLspServerManager)` -- LSP teardown on exit
13. `ensureScratchpadDir()` -- creates scratch dir if enabled

**Separate Flow**: `initializeTelemetryAfterTrust()` called only after user accepts trust dialog, separating consent-independent setup from consent-gated telemetry.

### mcp.ts -- Claude Code as MCP Server

When invoked with `claude --mcp`, Claude Code runs as a standard Model Context Protocol server over stdio.

```javascript
const server = new Server(
  { name: 'claude/tengu', version: MACRO.VERSION },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: await Promise.all(tools.map(async tool => ({
    ...tool,
    description: await tool.prompt(...),
    inputSchema: zodToJsonSchema(tool.inputSchema),
  })))
}))

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const tool = findToolByName(tools, params.name)
  return await tool.call(params.arguments, toolUseContext, ...)
})
```

MCP server forces `isNonInteractiveSession: true` and disables thinking (`thinkingConfig: { type: 'disabled' }`). Exposes only `review` slash command.

### agentSdkTypes.ts -- Public SDK Contract

All function bodies throw `'not implemented'` -- actual implementations injected at runtime by SDK transport layer.

**Module Structure:**

| Module | Purpose | Examples |
|--------|---------|----------|
| `sdk/coreTypes.ts` | Serializable, transport-safe types from Zod schemas | `SDKMessage`, `SDKUserMessage`, `ModelUsage`, `PermissionResult`, `HookInput` |
| `sdk/runtimeTypes.ts` | Non-serializable types with callbacks and methods | `SDKSession`, `Options`, `Query`, `SdkMcpToolDefinition` |
| `sdk/controlTypes.ts` | Control protocol for SDK builders | `SDKControlRequest`, `SDKControlResponse` |
| `sdk/settingsTypes.generated.ts` | Full Settings type from JSON schema | `Settings` |

### Top-Level SDK Functions

```javascript
// V1 API (stable) -- headless one-shot query
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}): Query

// V2 API (@alpha) -- persistent multi-turn sessions
export function unstable_v2_createSession(options: SDKSessionOptions): SDKSession
export function unstable_v2_resumeSession(sessionId: string, options: SDKSessionOptions): SDKSession
export async function unstable_v2_prompt(message: string, options: SDKSessionOptions): Promise<SDKResultMessage>

// Session management
export async function listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>
export async function getSessionInfo(sessionId: string): Promise<SDKSessionInfo | undefined>
export async function getSessionMessages(sessionId: string): Promise<SessionMessage[]>
export async function renameSession(sessionId: string, title: string): Promise<void>
export async function tagSession(sessionId: string, tag: string | null): Promise<void>
export async function forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult>

// In-process MCP server
export function createSdkMcpServer(options: { name: string; tools: SdkMcpToolDefinition[] }): McpSdkServerConfigWithInstance
export function tool<S>(name, description, schema, handler): SdkMcpToolDefinition<S>
```

### Control Protocol (SDK Builders)

| Subtype | Direction | Purpose |
|---------|-----------|---------|
| `initialize` | SDK -> CLI | Start session; pass hooks, MCP servers, agents, system prompt overrides |
| `interrupt` | SDK -> CLI | Cancel currently running turn |
| `can_use_tool` | CLI -> SDK | Request tool use permission; SDK responds allow/deny |
| `set_permission_mode` | SDK -> CLI | Change permission mode |
| `set_model` | SDK -> CLI | Switch model for subsequent turns |
| `set_max_thinking_tokens` | SDK -> CLI | Adjust extended thinking budget |
| `mcp_status` | SDK -> CLI | Query MCP server connection states |
| `get_context_usage` | SDK -> CLI | Inspect context window utilization by category |

### Initialize Request Example

```javascript
{
  subtype: "initialize",
  hooks: {
    "PreToolUse": [{ hookCallbackIds: ["my-hook"], matcher: "Bash" }]
  },
  sdkMcpServers: ["my-server"],
  systemPrompt: "You are a coding assistant.",
  agents: {
    "reviewer": { description: "Reviews code changes", ... }
  }
}
```

### 26 Hook Events

```javascript
export const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied',
  'SessionStart', 'SessionEnd', 'Setup',
  'Stop', 'StopFailure',
  'PreCompact', 'PostCompact',
  'SubagentStart', 'SubagentStop', 'TeammateIdle',
  'TaskCreated', 'TaskCompleted',
  'Notification', 'UserPromptSubmit',
  'ConfigChange', 'InstructionsLoaded', 'CwdChanged', 'FileChanged',
  'Elicitation', 'ElicitationResult',
  'WorktreeCreate', 'WorktreeRemove',
] as const
```

### Daemon & Bridge Mode (@internal)

**Scheduled Tasks / Cron:**

```javascript
export function watchScheduledTasks(opts: {
  dir: string
  signal: AbortSignal
  getJitterConfig?: () => CronJitterConfig
}): ScheduledTasksHandle

{
  events(): AsyncGenerator<ScheduledTaskEvent>
  getNextFireTime(): number | null
}
```

**Remote Control / Bridge:**

```javascript
export async function connectRemoteControl(opts: ConnectRemoteControlOptions):
  Promise<RemoteControlHandle | null>

{
  sessionUrl: string
  environmentId: string
  bridgeSessionId: string
  write(msg: SDKMessage): void
  sendResult(): void
  inboundPrompts(): AsyncGenerator<...>
  controlRequests(): AsyncGenerator<...>
  permissionResponses(): AsyncGenerator<...>
  onStateChange(cb): void  // ready | connected | reconnecting | failed
  teardown(): Promise<void>
}
```

### sandboxTypes.ts -- Process Isolation Config

```javascript
{
  enabled: boolean
  failIfUnavailable: boolean
  autoAllowBashIfSandboxed: boolean
  allowUnsandboxedCommands: boolean
  network: {
    allowedDomains: string[]
    allowManagedDomainsOnly: boolean
    allowUnixSockets: string[]
    allowLocalBinding: boolean
    httpProxyPort: number
    socksProxyPort: number
  }
  filesystem: {
    allowWrite: string[]
    denyWrite: string[]
    denyRead: string[]
    allowRead: string[]
    allowManagedReadPathsOnly: boolean
  }
}
```

### Complete Invocation Flow

```
Dev -> SDK: query("fix this bug", { cwd: "/project" })
SDK -> CLI: spawn claude --sdk-transport=process
CLI -> CLI: cli.tsx -> main.tsx init()
CLI -> SDK: control: initialize response (commands, models, account)
SDK -> CLI: user message (stdin)
CLI -> API: streaming API request
API --> CLI: assistant tokens
CLI --> SDK: SDKAssistantMessage stream
CLI -> SDK: control: can_use_tool? (Bash)
SDK --> CLI: allow
CLI -> CLI: execute tool
CLI --> SDK: SDKToolResultMessage
CLI --> SDK: SDKResultMessage (final)
SDK --> Dev: async generator yields messages
```

---

## LESSON 3: KAIROS -- ALWAYS-ON AUTONOMOUS DAEMON

### Feature Flag Architecture

```javascript
feature('KAIROS')                    // Full assistant mode (ant-only)
feature('KAIROS_BRIEF')              // SendUserMessage independently
feature('KAIROS_PUSH_NOTIFICATION')  // PushNotificationTool
feature('KAIROS_GITHUB_WEBHOOKS')    // SubscribePRTool
feature('KAIROS_CHANNELS')           // MCP channel notifications
feature('AGENT_TRIGGERS')            // Cron scheduling (gb-gated)
feature('PROACTIVE')                 // Lighter proactive mode (ant-only)
```

**DCE Requirement**: Uses positive ternaries, not negative early-returns:

```javascript
// CORRECT
return feature('KAIROS') ? doKairosThings() : false

// WRONG -- defeats constant-folding
if (!feature('KAIROS')) return false
return doKairosThings()
```

### Runtime State Pivot: `kairosActive`

Location: `bootstrap/state.ts` (line 1085)

```typescript
export function getKairosActive(): boolean {
  return STATE.kairosActive  // default: false
}
```

**Cascading Effects When True:**

| Subsystem | Behavior |
|-----------|----------|
| Memory | Switches to `buildAssistantDailyLogPrompt()` (daily logs) instead of MEMORY.md |
| BriefTool | Auto-enables without opt-in; system prompt hard-codes "MUST use SendUserMessage" |
| Fast Mode | Lifts SDK restriction on Opus 4.6 in non-interactive sessions |
| AutoDream | Returns `false` from `isGateOpen()` -- uses disk-skill dream instead |
| Bridge | Registers as `workerType: 'claude_code_assistant'` in session picker |
| Scheduler | Auto-enables cron tasks; bypasses `isLoading` gate |

### The Tick Loop & Sleep Mechanism

Model receives periodic `<tengu_tick>` XML messages:

```
"You are running autonomously. You will receive <tengu_tick> prompts that
keep you alive between turns -- just treat them as 'you're awake, what now?'
The time in each <tengu_tick> is the user's current local time."

"If you have nothing useful to do on a tick, you MUST call Sleep.
Never respond with only a status message like 'still waiting' -- that wastes
a turn and burns tokens."
```

**Cost Transparency**: Model told about:
- Each wake-up incurs an API call
- 5-minute prompt cache expiry window
- Trade-off: longer sleep = fewer API calls but risks cold cache

### Queue Priority System

```typescript
type QueuePriority = 'now' | 'next' | 'later'
// 'now'   -- interrupt current tool call immediately (Esc + send)
// 'next'  -- wait for current tool to finish, then inject. Wakes SleepTool.
// 'later' -- end-of-turn drain. Also wakes SleepTool.
```

### KAIROS Tool Suite

| Tool | Gate | Purpose |
|------|------|---------|
| **SleepTool** | PROACTIVE or KAIROS | Yield execution; respects min/maxSleepDurationMs |
| **SendUserMessage (Brief)** | KAIROS or KAIROS_BRIEF | Primary output; `status: 'proactive'` vs `'normal'` |
| **SendUserFile** | KAIROS only | Standalone file delivery |
| **PushNotification** | KAIROS or KAIROS_PUSH_NOTIFICATION | Push to user device |
| **SubscribePR** | KAIROS_GITHUB_WEBHOOKS | Subscribe to GitHub PR webhooks |
| **CronCreate** | AGENT_TRIGGERS | Schedule prompts on cron expressions |
| **CronDelete** | AGENT_TRIGGERS | Remove scheduled tasks |
| **CronList** | AGENT_TRIGGERS | List scheduled tasks |

### BriefTool Entitlement vs Activation

```typescript
export function isBriefEnabled(): boolean {
  return feature('KAIROS') || feature('KAIROS_BRIEF')
    ? (getKairosActive() || getUserMsgOptIn()) && isBriefEntitled()
    : false
}
```

**isBriefEntitled()** (permission): `kairosActive` OR env var `CLAUDE_CODE_BRIEF` OR GrowthBook flag
**isBriefEnabled()** (activation): Requires entitlement AND explicit opt-in

### Cron Scheduling System

```typescript
type CronTask = {
  id:          string
  cron:        string       // 5-field cron in local timezone
  prompt:      string
  createdAt:   number
  lastFiredAt?: number
  recurring?:  boolean
  permanent?:  boolean      // exempt from recurringMaxAgeMs expiry
  durable?:    boolean      // false = session-only, undefined = disk-backed
  agentId?:    string       // routes to teammate's queue
}
```

**Durability Tiers:**
- **Session-Only** (`durable: false`): Never written to disk. Disappears on exit.
- **Durable** (`durable: true`): Persists to `.claude/scheduled_tasks.json`. Survives restarts.

**Jitter System**: Model told to pick non-round minutes. Scheduler adds up to 10% period jitter (max 15 min) for recurring, up to 90 seconds for one-shot landing on :00/:30.

### AutoDream: Background Memory Consolidation

**Gate Chain (Cheapest-First):**
1. `kairosActive` -> skip if true
2. `isRemoteMode` -> skip
3. `!autoMemEnabled` -> skip
4. `!autoDreamEnabled` -> skip
5. Time gate: hours >= 24 default
6. Scan throttle: last scan >= 10min
7. Session count: >= 5 sessions
8. Lock acquisition

**Four Consolidation Phases:**
- Phase 1 - Orient: Read MEMORY.md index, skim existing topic files
- Phase 2 - Gather: Daily logs, drifted memories, transcript grep
- Phase 3 - Consolidate: Merge signal, convert relative dates, delete contradictions
- Phase 4 - Prune & Index: Update MEMORY.md under MAX_ENTRYPOINT_LINES (~25KB)

**Tool Constraints for Dream:** Bash restricted to read-only commands (ls, find, grep, cat, stat, wc, head, tail).

### Assistant-Mode Memory: Daily Logs

- Daily log files: `logs/YYYY/MM/YYYY-MM-DD.md`
- Path: `~/.claude/memory/logs/2026/03/2026-03-31.md`
- Append-only during work
- Dream skill distills logs into topic files nightly
- MEMORY.md becomes synthesized index

### Settings Schema

| Key | Type | Purpose | Gate |
|-----|------|---------|------|
| `assistant` | boolean | Start in assistant mode | KAIROS |
| `assistantName` | string | Display name | KAIROS |
| `defaultView` | 'chat' or 'transcript' | 'chat' activates Brief opt-in | KAIROS or KAIROS_BRIEF |
| `minSleepDurationMs` | number | Minimum sleep duration | PROACTIVE or KAIROS |
| `maxSleepDurationMs` | number (-1=indefinite) | Max sleep | PROACTIVE or KAIROS |
| `autoDreamEnabled` | boolean | Background memory consolidation | always |
| `pushNotificationsEnabled` | boolean | Push notifications | KAIROS or KAIROS_PUSH_NOTIFICATION |

### GrowthBook Kill-Switch Architecture

5-minute caching for incident response:

```typescript
// Brief entitlement
getFeatureValue_CACHED_WITH_REFRESH('tengu_kairos_brief', false, 5*60*1000)

// Cron kill switch -- fleet-wide
getFeatureValue_CACHED_WITH_REFRESH('tengu_kairos_cron', true, 5*60*1000)

// Durable cron kill switch
getFeatureValue_CACHED_WITH_REFRESH('tengu_kairos_cron_durable', true, 5*60*1000)
```

---

## LESSON 4: COST ANALYTICS & OBSERVABILITY

### Two-Pipeline Architecture

1. **First-Party (1P) Pipeline**: OpenTelemetry-backed, proto-serialized events to `/api/event_logging/batch`
2. **Datadog Pipeline**: HTTP-intake fanout for operational monitoring

### Cost Tracking: cost-tracker.ts

```typescript
export function addToTotalSessionCost(
  cost: number,
  usage: Usage,
  model: string,
): number {
  const modelUsage = addToTotalModelUsage(cost, usage, model)
  addToTotalCostState(cost, modelUsage, model)

  const attrs = isFastModeEnabled() && usage.speed === 'fast'
    ? { model, speed: 'fast' }
    : { model }

  getCostCounter()?.add(cost, attrs)
  getTokenCounter()?.add(usage.input_tokens,  { ...attrs, type: 'input' })
  getTokenCounter()?.add(usage.output_tokens, { ...attrs, type: 'output' })
  getTokenCounter()?.add(usage.cache_read_input_tokens ?? 0,
    { ...attrs, type: 'cacheRead' })
  getTokenCounter()?.add(usage.cache_creation_input_tokens ?? 0,
    { ...attrs, type: 'cacheCreation' })

  // Log advisor sub-usage to 1P analytics
  let totalCost = cost
  for (const advisorUsage of getAdvisorUsage(usage)) {
    const advisorCost = calculateUSDCost(advisorUsage.model, advisorUsage)
    logEvent('tengu_advisor_tool_token_usage', {
      advisor_model: advisorUsage.model,
      input_tokens: advisorUsage.input_tokens,
      cost_usd_micros: Math.round(advisorCost * 1_000_000),
    })
    totalCost += addToTotalSessionCost(advisorCost, advisorUsage, advisorUsage.model)
  }
  return totalCost
}
```

**Key detail**: Cost stored in **microdollars** (`cost_usd_micros`) as integers to prevent floating-point accumulation errors.

### Session Persistence

```typescript
export function saveCurrentSessionCosts(fpsMetrics?: FpsMetrics): void {
  saveCurrentProjectConfig(current => ({
    ...current,
    lastCost:                          getTotalCostUSD(),
    lastAPIDuration:                   getTotalAPIDuration(),
    lastTotalInputTokens:              getTotalInputTokens(),
    lastTotalOutputTokens:             getTotalOutputTokens(),
    lastTotalCacheCreationInputTokens: getTotalCacheCreationInputTokens(),
    lastTotalCacheReadInputTokens:     getTotalCacheReadInputTokens(),
    lastTotalWebSearchRequests:        getTotalWebSearchRequests(),
    lastFpsAverage:                    fpsMetrics?.averageFps,
    lastModelUsage:                    Object.fromEntries(...),
    lastSessionId: getSessionId(),
  }))
}
```

Restoration only occurs when `lastSessionId` matches current `getSessionId()`.

### costHook.ts React Bridge

```typescript
export function useCostSummary(
  getFpsMetrics?: () => FpsMetrics | undefined,
): void {
  useEffect(() => {
    const f = () => {
      if (hasConsoleBillingAccess()) {
        process.stdout.write('\n' + formatTotalCost() + '\n')
      }
      saveCurrentSessionCosts(getFpsMetrics?.())
    }
    process.on('exit', f)
    return () => { process.off('exit', f) }
  }, [])
}
```

### Analytics Sink & Queue

```typescript
const eventQueue: QueuedEvent[] = []
let sink: AnalyticsSink | null = null

export function attachAnalyticsSink(newSink: AnalyticsSink): void {
  if (sink !== null) return  // idempotent
  sink = newSink
  if (eventQueue.length > 0) {
    const queuedEvents = [...eventQueue]
    eventQueue.length = 0
    queueMicrotask(() => {
      for (const event of queuedEvents) {
        event.async
          ? void sink!.logEventAsync(event.eventName, event.metadata)
          :       sink!.logEvent(event.eventName, event.metadata)
      }
    })
  }
}
```

### Datadog Pipeline

- **Allowlist**: ~40 curated events; unlisted silently dropped
- **Timer**: 15-second flush interval
- **Threshold**: 100 entries triggers immediate flush
- **Model normalization**: User model names mapped to canonical short names or "other"
- **Tool names**: MCP tool names collapse to "mcp" (cardinality reduction)

**User Buckets -- Privacy Preservation:**

```typescript
const NUM_USER_BUCKETS = 30
const getUserBucket = memoize((): number => {
  const userId = getOrCreateUserID()
  const hash = createHash('sha256').update(userId).digest('hex')
  return parseInt(hash.slice(0, 8), 16) % NUM_USER_BUCKETS
})
```

### PII Segregation -- _PROTO_ Pattern

**Compile-Time Guards:**

```typescript
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never
```

No value can legitimately assign to `never`. Passing string requires explicit `as` cast -- visible code-review signal.

**Runtime Guard:**

```typescript
export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  let result: Record<string, V> | undefined
  for (const key in metadata) {
    if (key.startsWith('_PROTO_')) {
      if (result === undefined) result = { ...metadata }
      delete result[key]
    }
  }
  return result ?? metadata
}
```

### First-Party Pipeline & OpenTelemetry

**Resilience: Disk-Backed Retry:**
Failed events appended to JSONL at:
```
~/.claude/telemetry/1p_failed_events.<sessionId>.<BATCH_UUID>.json
```

**Quadratic Backoff:**

```typescript
const delay = Math.min(
  this.baseBackoffDelayMs * this.attempts * this.attempts,
  this.maxBackoffDelayMs,  // caps at 30,000 ms
)
```

Attempt sequence: 500ms -> 2000ms -> 4500ms -> 8000ms -> 12500ms -> capped at 30s. Max 8 attempts.

### GrowthBook Dynamic Config & Sampling

```typescript
export function shouldSampleEvent(eventName: string): number | null {
  const config = getEventSamplingConfig()
  const eventConfig = config[eventName]
  if (!eventConfig) return null            // not configured -> log 100%
  const sampleRate = eventConfig.sample_rate
  if (sampleRate >= 1) return null
  if (sampleRate <= 0) return 0
  return Math.random() < sampleRate ? sampleRate : 0
}
```

### Policy Limits

```typescript
export function isAnalyticsDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test'                           ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)           ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)            ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)           ||
    isTelemetryDisabled()
  )
}
```

---

## LESSON 5: DESKTOP APP INTEGRATION

### Four Integration Layers

1. **Claude Desktop Handoff** -- `/desktop` command via deep links
2. **IDE Integration** -- Auto-detection of VS Code, Cursor, JetBrains family
3. **Claude in Chrome** -- Native messaging protocol for browser extension
4. **Computer Use MCP** -- OS-level automation (gated by subscription)

### Layer 1: Claude Desktop Handoff

**Platform support:**
```typescript
function isSupportedPlatform(): boolean {
  if (process.platform === 'darwin') return true
  if (process.platform === 'win32' && process.arch === 'x64') return true
  return false
}
```

**Minimum Desktop Version:** `MIN_DESKTOP_VERSION = '1.1.2396'`

**Deep Link URL:**
```typescript
function buildDesktopDeepLink(sessionId: string): string {
  const protocol = isDevMode() ? 'claude-dev' : 'claude'
  const url = new URL(`${protocol}://resume`)
  url.searchParams.set('session', sessionId)
  url.searchParams.set('cwd', getCwd())
  return url.toString()
}
```

Format: `claude://resume?session=<uuid>&cwd=<path>`

**Six-State Handoff Flow:**
```
checking -> (not-installed/old version) -> prompt_download -> [exit]
checking -> (ready) -> flushing -> opening -> success -> [exit after 500ms]
opening -> error -> [exit on keypress]
```

### Layer 2: IDE Integration

**Supported IDEs:**
- VS Code Family: Cursor, Windsurf, VS Code
- JetBrains Family (15): IntelliJ, PyCharm, WebStorm, PhpStorm, RubyMine, CLion, GoLand, Rider, DataGrip, AppCode, DataSpell, Aqua, Gateway, Fleet, Android Studio

**Lockfile-Based Discovery:**

```typescript
type LockfileJsonContent = {
  workspaceFolders?: string[]
  pid?: number
  ideName?: string
  transport?: 'ws' | 'sse'
  runningInWindows?: boolean
  authToken?: string
}
```

Lockfiles at `~/.claude/ide/<port>.lock`, sorted by modification time.

### Layer 3: Claude in Chrome -- Native Messaging

**Host Identifier:** `com.anthropic.claude_code_browser_extension`

**Supported Browsers:** Chrome, Chromium, Brave, Edge, Opera, Vivaldi, Arc

**Activation Conditions Priority:**
1. Disabled by default in non-interactive sessions
2. `--chrome` / `--no-chrome` CLI flags override everything
3. `CLAUDE_CODE_ENABLE_CFC` environment variable
4. `claudeInChromeDefaultEnabled` in `~/.claude/config.json`
5. Auto-enable: interactive + extension installed + GrowthBook flag

### Layer 4: Computer Use MCP (Chicago/Malort)

```typescript
export function getChicagoEnabled(): boolean {
  if (process.env.USER_TYPE === 'ant' && process.env.MONOREPO_ROOT_DIR
      && !isEnvTruthy(process.env.ALLOW_ANT_COMPUTER_USE_MCP)) {
    return false
  }
  return hasRequiredSubscription() && readConfig().enabled
}
```

**Requirements:** Max or Pro subscription, GrowthBook experiment, build-time feature flag

**Configuration:**
```typescript
type ChicagoConfig = CuSubGates & {
  enabled: boolean
  coordinateMode: 'pixels' | 'normalized'
  pixelValidation: boolean
  clipboardPasteMultiline: boolean
  mouseAnimation: boolean
  hideBeforeAction: boolean
  autoTargetDisplay: boolean
  clipboardGuard: boolean
}
```

**Coordinate Mode Freeze:** Frozen at first read to prevent mid-session mismatch.

**Terminal Bundle ID Awareness:**
```typescript
const TERMINAL_BUNDLE_ID_FALLBACK = {
  'iTerm.app':    'com.googlecode.iterm2',
  'Apple_Terminal': 'com.apple.Terminal',
  'ghostty':      'com.mitchellh.ghostty',
  'WarpTerminal': 'dev.warp.Warp-Stable',
  'vscode':       'com.microsoft.VSCode',
}
```

### Native Installer Directory Layout

```
~/.local/share/claude/versions/        # one dir per version
~/.cache/claude/staging/               # download target
~/.local/state/claude/locks/           # PID-based lock files
~/.local/bin/claude                    # symlink -> active version
```

**Retention:** `VERSION_RETENTION_COUNT = 2`

---

## LESSON 6: MODEL SYSTEM

### File Map

| File | Purpose |
|------|---------|
| `configs.ts` | Provider-specific model ID registry |
| `providers.ts` | Active API provider detection |
| `model.ts` | Selection priority chain & alias resolution |
| `aliases.ts` | Canonical alias definitions |
| `modelStrings.ts` | Runtime model-string resolution |
| `modelAllowlist.ts` | Three-tier matching logic |
| `modelOptions.ts` | /model picker options per tier |
| `agent.ts` | Subagent model resolution |
| `check1mAccess.ts` | 1M context gating |
| `deprecation.ts` | Retirement-date warnings |
| `validateModel.ts` | Live API probe validation |
| `fastMode.ts` | Fast mode availability |
| `migrations/*.ts` | Automated settings upgrades |

### Four-Provider Registry

```typescript
export type ModelConfig = Record<APIProvider, ModelName>

export const CLAUDE_OPUS_4_6_CONFIG = {
  firstParty: 'claude-opus-4-6',
  bedrock:     'us.anthropic.claude-opus-4-6-v1',
  vertex:      'claude-opus-4-6',
  foundry:     'claude-opus-4-6',
} as const satisfies ModelConfig

export const ALL_MODEL_CONFIGS = {
  haiku35:  CLAUDE_3_5_HAIKU_CONFIG,
  haiku45:  CLAUDE_HAIKU_4_5_CONFIG,
  sonnet35: CLAUDE_3_5_V2_SONNET_CONFIG,
  sonnet37: CLAUDE_3_7_SONNET_CONFIG,
  sonnet40: CLAUDE_SONNET_4_CONFIG,
  sonnet45: CLAUDE_SONNET_4_5_CONFIG,
  sonnet46: CLAUDE_SONNET_4_6_CONFIG,
  opus40:   CLAUDE_OPUS_4_CONFIG,
  opus41:   CLAUDE_OPUS_4_1_CONFIG,
  opus45:   CLAUDE_OPUS_4_5_CONFIG,
  opus46:   CLAUDE_OPUS_4_6_CONFIG,
} as const satisfies Record<string, ModelConfig>
```

### Provider Detection

```typescript
export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}
```

### Selection Priority Chain (Five Layers)

1. **/model command** -- Session override, highest priority
2. **--model CLI flag** -- Bootstrap override
3. **ANTHROPIC_MODEL env var** -- Accepts full IDs and aliases
4. **settings.json -> model** -- Persisted across sessions
5. **Subscription default** -- Max/Team Premium -> Opus 4.6; others -> Sonnet 4.6

```typescript
export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  const modelOverride = getMainLoopModelOverride()
  if (modelOverride !== undefined) return modelOverride
  const settings = getSettings_DEPRECATED() || {}
  const specifiedModel =
    process.env.ANTHROPIC_MODEL || settings.model || undefined
  if (specifiedModel && !isModelAllowed(specifiedModel)) return undefined
  return specifiedModel
}
```

### Model Aliases & [1m] Suffix

```typescript
export const MODEL_ALIASES = [
  'sonnet', 'opus', 'haiku', 'best',
  'sonnet[1m]', 'opus[1m]',
  'opusplan',
] as const
```

`[1m]` suffix signals 1M token context window. Stripped before resolution, re-appended after:

```typescript
export function parseUserSpecifiedModel(modelInput: ModelName | ModelAlias): ModelName {
  const has1mTag  = has1mContext(normalizedModel)
  const baseModel = has1mTag
    ? normalizedModel.replace(/\[1m]$/i, '').trim()
    : normalizedModel
  if (isModelAlias(baseModel)) {
    switch (baseModel) {
      case 'opus':   return getDefaultOpusModel() + (has1mTag ? '[1m]' : '')
      case 'sonnet': return getDefaultSonnetModel() + (has1mTag ? '[1m]' : '')
      case 'haiku':  return getDefaultHaikuModel() + (has1mTag ? '[1m]' : '')
    }
  }
  return modelInputTrimmed
}
```

### 1M Context Window Access

```typescript
export function checkOpus1mAccess(): boolean {
  if (is1mContextDisabled()) return false
  if (isClaudeAISubscriber()) return isExtraUsageEnabled()
  return true  // API/PAYG: always available
}
```

### Effort Levels

- **auto**: Model default
- **low**: Minimal budget, fast, cheaper
- **medium**: Balanced
- **high**: Extended thinking
- **max**: Opus 4.6 only; session-scoped for non-Ants

Priority: env var > appState > model default.

### Fast Mode

Research-preview latency optimization for Opus 4.6 only on firstParty API.

**Availability Checks:**
1. `CLAUDE_CODE_DISABLE_FAST_MODE=1` hard-disables
2. firstParty provider only
3. Requires paid subscription
4. Extra-usage billing enabled
5. Agent SDK requires explicit `fastMode: true`
6. Statsig kill switch `tengu_penguins_off`

### Three-Tier Allowlist (availableModels)

1. **Family wildcard** -- `"opus"` allows any Opus
2. **Version prefix** -- `"opus-4-5"` matches at segment boundary
3. **Exact ID** -- `"claude-opus-4-5-20251101"` matches exactly

**Narrowing Rule:** `["opus", "opus-4-5"]` -- specific entry narrows family wildcard.

### Subagent Model Inheritance

Precedence:
1. `CLAUDE_CODE_SUBAGENT_MODEL` env var
2. Tool-specified model
3. Agent config model field
4. "inherit" (default) -- same model as parent

### Model Migrations

All idempotent, run on every startup, touch `userSettings` only:
- `migrateFennecToOpus`: Ant-only codename remapping
- `migrateLegacyOpusToCurrent`: Opus 4.0/4.1 -> `opus` alias
- `migrateSonnet1mToSonnet45`: Pin `sonnet[1m]` to explicit 4.5
- `migrateSonnet45ToSonnet46`: Upgrade Sonnet 4.5 -> `sonnet` alias
- `migrateOpusToOpus1m`: Max/Team Premium `opus` -> `opus[1m]`
- `resetProToOpusDefault`: Pro subscribers get Opus default notification

### Validation & Deprecation

Live validation sends real API call with `max_tokens: 1`:
```typescript
await sideQuery({
  model: normalizedModel,
  max_tokens: 1,
  maxRetries: 0,
  querySource: 'model_validation',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
})
```

Deprecation table maps model substrings to retirement dates per provider.

---

## LESSON 7: SANDBOX & SECURITY

### Core Bridge Pattern

Wraps `@anthropic-ai/sandbox-runtime`'s `BaseSandboxManager` through an adapter adding settings integration, worktree awareness, and security rules.

### Platform Backends

| Platform | Backend | Dependencies |
|----------|---------|--------------|
| macOS | Apple Seatbelt (`sandbox-exec`) | Built-in; `ripgrep` required |
| Linux/WSL2 | bubblewrap + seccomp + socat | `apt install bubblewrap socat` |
| WSL1/Windows | Unsupported | -- |

### Three Sandbox Modes

```
type SandboxMode = 'auto-allow' | 'regular' | 'disabled'
```

| Mode | Behavior |
|------|----------|
| Disabled | No sandbox; ask permission for all patterns |
| Regular | Sandboxed; ask before unapproved commands |
| Auto-Allow | Sandboxed; no prompts (sandbox provides safety) |

### Network Control

Allowed domains merge from:
1. `sandbox.network.allowedDomains` (explicit settings)
2. `permissions.allow` rules: `WebFetch(domain:example.com)`

**Enterprise Lockdown:** `allowManagedDomainsOnly: true` -- only policy domains apply; user rules ignored.

### Filesystem Control

**Always-Allowed Write:** `.` (cwd) and `getClaudeTempDir()`

**Always-Denied Write (Security-Hardcoded):**
- All `settings.json` and `settings.local.json` files
- Managed settings drop-in directory
- `.claude/skills` in original and current working directories
- Bare git repo sentinels: `HEAD`, `objects`, `refs`, `hooks`, `config`

### Bare Git Repo Sandbox Escape (Issue #29316)

Git treats any directory with `HEAD + objects/ + refs/` as bare. Sandboxed commands planting those files could enable `core.fsmonitor` hook escape.

**Two-Prong Defense:**
1. Existing sentinels added to `denyWrite`
2. Non-existent sentinels added to `bareGitRepoScrubPaths` for post-command deletion

```
function scrubBareGitRepoFiles(): void {
  for (const p of bareGitRepoScrubPaths) {
    try {
      rmSync(p, { recursive: true })
    } catch { /* ENOENT expected */ }
  }
}
```

### Path Resolution Convention Divergence (Issue #30067)

| Source | `/path` Means | Resolver |
|--------|---------------|----------|
| Permission rules | Settings-relative | `resolvePathPatternForSandbox()` |
| `sandbox.filesystem` | Absolute (as written), `~` expanded | `resolveSandboxFilesystemPath()` |
| Both | `//path` -> absolute `/path` | Both handle `//` prefix |

### Secure Storage

**macOS:** `createFallbackStorage(macOsKeychainStorage, plainTextStorage)`
**Linux:** `plainTextStorage` at `~/.config/claude/.credentials.json` (chmod 0o600)

**macOS Keychain -- Hex Serialization:**
```
const hexValue = Buffer.from(jsonString, 'utf-8').toString('hex')
const command =
  `add-generic-password -U -a "${username}" -s "${serviceName}" -X "${hexValue}"\n`
```

**Stdin Buffer Limit:** Apple's `security -i` has 4096-byte buffer; payloads >~4032 bytes silently corrupt. Falls back to argv.

### Keychain Cache

```typescript
export const KEYCHAIN_CACHE_TTL_MS = 30_000

export const keychainCacheState: {
  cache: { data: SecureStorageData | null; cachedAt: number }
  generation: number
  readInFlight: Promise<SecureStorageData | null> | null
}
```

- **Stale-While-Error:** Failed calls serve cached data
- **Generation Counter:** Prevents stale subprocesses from overwriting fresh data
- **readInFlight Dedup:** Concurrent reads share one subprocess

**Startup Prefetch (~65ms saved):**
```typescript
export function startKeychainPrefetch(): void {
  const oauthSpawn  = spawnSecurity(getMacOsKeychainStorageServiceName(CREDENTIALS_SERVICE_SUFFIX))
  const legacySpawn = spawnSecurity(getMacOsKeychainStorageServiceName())
  prefetchPromise = Promise.all([oauthSpawn, legacySpawn]).then(...)
}
```

### Fallback Storage Combinator

```typescript
update(data: SecureStorageData) {
  const primaryDataBefore = primary.read()
  const result = primary.update(data)
  if (result.success) {
    if (primaryDataBefore === null) secondary.delete()
    return result
  }
  const fallbackResult = secondary.update(data)
  if (fallbackResult.success) {
    if (primaryDataBefore !== null) primary.delete()
    return { success: true, warning: fallbackResult.warning }
  }
  return { success: false }
}
```

**Key Invariant:** `read()` prefers primary when non-null. Stale keychain entries deleted after fallback writes.

---

## LESSON 8: MESSAGE PROCESSING PIPELINE

**Source files:**
- `utils/handlePromptSubmit.ts`
- `utils/processUserInput/processUserInput.ts`
- `utils/processUserInput/processTextPrompt.ts`
- `utils/messages.ts`

### Stage 1: Submit & Route

**Path A -- Queue Processor:**
```typescript
if (queuedCommands?.length) {
  startQueryProfile()
  await executeUserInput({ queuedCommands, ... })
  return
}
```

**Path B -- Direct User Input:**
```typescript
const finalInput = expandPastedTextRefs(input, pastedContents)
const cmd: QueuedCommand = { value: finalInput, mode, pastedContents, ... }
await executeUserInput({ queuedCommands: [cmd], ... })
```

**Paste Reference Expansion:** Orphaned image references filtered.

**Query Guard:** When `queryGuard.isActive`, new input enters `commandQueue`. Guard reserved before `processUserInput` starts.

**Immediate Commands:** `/config`, `/doctor` execute even while queries run.

### Stage 2: Input Classification

**Image Pre-Processing:** Array-form normalized with `maybeResizeAndDownsampleImageBlock`. Pasted images resized in parallel.

**Branching:**
```typescript
if (mode === 'bash') return processBashCommand(...)
if (!effectiveSkipSlash && inputString.startsWith('/')) return processSlashCommand(...)
return processTextPrompt(...)
```

**Hidden fourth branch:** Ultraplan keyword rewrite.

**UserPromptSubmit Hooks:** Execute after `processUserInputBase` returns with `shouldQuery: true`. Capped at 10,000 characters via `applyTruncation()`.

### Stage 3: Message Construction

**createUserMessage key fields:**

| Field | Purpose |
|-------|---------|
| `uuid` | Stable identity for rewind, file history, tool result pairing |
| `isMeta` | Hidden from UI; model-visible |
| `origin` | Provenance tracking |
| `permissionMode` | Safety snapshot at creation time |
| `toolUseResult` | Structured output from tool calls |
| `imagePasteIds` | Ordered list of paste IDs |

**Synthetic Messages:**
```typescript
export const INTERRUPT_MESSAGE = '[Request interrupted by user]'
export const CANCEL_MESSAGE = "The user doesn't want to take this action right now..."
export const REJECT_MESSAGE = "The user doesn't want to proceed with this tool use..."
export const SYNTHETIC_TOOL_RESULT_PLACEHOLDER = '[Tool result missing due to internal error]'
```

### Stage 4: API Normalization

**normalizeMessagesForAPI Passes:**
1. Reorder attachments
2. Strip virtual messages (`isVirtual: true`)
3. Build error-to-strip map
4. Filter system/attachment messages
5. Merge consecutive same-role messages (strict alternating turns)
6. Ensure tool result pairing (orphaned uses get synthetic placeholder)

**UUID Derivation:**
```typescript
export function deriveUUID(parentUUID: UUID, index: number): UUID {
  const hex = index.toString(16).padStart(12, '0')
  return `${parentUUID.slice(0, 24)}${hex}` as UUID
}
```

**Short Message ID (6-char base36):**
```typescript
export function deriveShortMessageId(uuid: string): string {
  const hex = uuid.replace(/-/g, '').slice(0, 10)
  return parseInt(hex, 16).toString(36).slice(0, 6)
}
```

### Message Taxonomy

| Type | Role | Purpose |
|------|------|---------|
| `UserMessage` | "user" | Human input with metadata |
| `AssistantMessage` | "assistant" | Model response with usage metrics |
| `AttachmentMessage` | N/A | Side-channel context; reordered before dispatch |
| `SystemMessage` | N/A | UI-only signals; filtered from API |
| `ProgressMessage` | N/A | Ephemeral streaming state |
| `TombstoneMessage` | N/A | Deletion marker for compact/rewind |

### Memory Correction Hint Pattern

```typescript
const MEMORY_CORRECTION_HINT =
  "\n\nNote: The user's next message may contain a correction or preference. "
  + "Pay close attention -- if they explain what went wrong or how they'd "
  + "prefer you to work, consider saving that to memory for future sessions."
```

Appended when auto-memory enabled and `tengu_amber_prism` feature gate active.

---

## LESSON 9: TASK SYSTEM

### Seven Task Types

```typescript
export type TaskType =
  | 'local_bash'           // LocalShellTask
  | 'local_agent'          // LocalAgentTask + LocalMainSessionTask
  | 'remote_agent'         // RemoteAgentTask
  | 'in_process_teammate'  // InProcessTeammateTask
  | 'local_workflow'       // LocalWorkflowTask
  | 'monitor_mcp'          // MonitorMcpTask
  | 'dream'                // DreamTask
```

### Shared State Base

```typescript
export type TaskStateBase = {
  id: string              // prefix encodes type: b/a/r/t/w/m/d/s
  type: TaskType
  status: TaskStatus      // pending | running | completed | failed | killed
  description: string
  toolUseId?: string
  startTime: number
  endTime?: number
  outputFile: string
  outputOffset: number
  notified: boolean       // one-way latch
}
```

### Lifecycle State Machine

pending -> running -> [completed | failed | killed] -> evicted

**Notified Flag Pattern (compare-and-set):**
```typescript
let shouldEnqueue = false
updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
  if (task.notified) return task
  shouldEnqueue = true
  return { ...task, notified: true }
})
if (!shouldEnqueue) return
```

### LocalShellTask

- Output via OS file descriptors (no JS buffering)
- Polled every 1 second
- Stall watchdog: polls file size every 5s, detects no-growth for 45s
- **Prompt detection:**
  ```typescript
  const PROMPT_PATTERNS = [
    /\(y\/n\)/i, /\[y\/n\]/i, /\(yes\/no\)/i,
    /\b(?:Do you|Would you|Shall I|Are you sure)\b.*\? *$/i,
    /Press (any key|Enter)/i, /Continue\?/i, /Overwrite\?/i
  ]
  ```

### LocalAgentTask

- Input tokens: cumulative (keep latest)
- Output tokens: per-turn (sum across turns)
- `retain: true` blocks eviction; `evictAfter: Date.now() + 30000`

### RemoteAgentTask

- Subtypes: `remote-agent`, `ultraplan`, `ultrareview`, `autofix-pr`, `background-pr`
- Sidecar file stores metadata for `--resume` recovery

### InProcessTeammateTask

- Identity: `agentId` (format: "name@team"), `agentName`, `teamName`, optional `color`
- **UI cap: 50 messages** (production necessity: 292 agents reached 36.8GB RSS)
  ```typescript
  export const TEAMMATE_MESSAGES_UI_CAP = 50
  ```

### DreamTask

- Phases: `'starting'` -> `'updating'`
- Kill calls `rollbackConsolidationLock(priorMtime)`
- No model notification (notified set immediately)

### Notification System

**XML Envelope:**
```xml
<task_notification>
  <task_id>${taskId}</task_id>
  <tool_use_id>${toolUseId}</tool_use_id>
  <output_file>${outputPath}</output_file>
  <status>${status}</status>
  <summary>${summary}</summary>
</task_notification>
```

Priority: `'next'` (delivered at start of next turn) or `'later'` (queued after pending)

### Output Management

| Layer | Responsibility |
|-------|---------------|
| DiskTaskOutput | Write queue flushed to single file handle; 5GB cap |
| TaskOutput | In-memory buffer (8MB default); spills to DiskTaskOutput |

**Security:** `O_NOFOLLOW` flag prevents symlink-based path-traversal attacks.

**Truncation for API:**
```typescript
export function formatTaskOutput(output: string, taskId: string) {
  const maxLen = getMaxTaskOutputLength()  // default 32,000, cap 160,000
  if (output.length <= maxLen) return { content: output, wasTruncated: false }
  const filePath = getTaskOutputPath(taskId)
  const header = `[Truncated. Full output: ${filePath}]\n\n`
  const truncated = output.slice(-(maxLen - header.length))
  return { content: header + truncated, wasTruncated: true }
}
```

### Type Comparison

| Type | ID prefix | Output | Kill |
|------|-----------|--------|------|
| local_bash | b | Direct file via OS fd | SIGKILL |
| local_agent | a | Symlink -> transcript JSONL | abortController |
| remote_agent | r | Polled + written locally | archiveRemoteSession() |
| in_process_teammate | t | Symlink -> transcript JSONL | killInProcessTeammate() |
| local_workflow | w | Task output file | abortController |
| monitor_mcp | m | Task output file | Process kill |
| dream | d | None | abortController + lock rewind |

---

## LESSON 10: REPL & SCREEN

**Location:** `screens/REPL.tsx`
**Size:** ~5,000 lines
**Exports:** Single function `REPL(props)`

### Six Internal Layers

| Layer | Lines | Content |
|-------|-------|---------|
| 1 | ~526-700 | Props, env guards, type definitions, feature flags |
| 2 | ~700-1200 | State declarations (useState, useRef) |
| 3 | ~1200-2700 | Core callbacks: setMessages, onCancel, onQueryEvent, onQuery, onSubmit |
| 4 | ~2700-4100 | Effects: session resume, queue processor, notifications, keyboard handlers |
| 5 | ~4100-4490 | Transcript mode: virtual scroll, search bar, dump mode |
| 6 | ~4490-5005 | Main render: FullscreenLayout, Messages, spinner, dialogs, PromptInput |

### Turn Lifecycle: Three-Function Chain

**onSubmit:**
- Calls `repinScroll()` immediately
- Fast path: immediate local-jsx commands execute during queries
- Idle-return gate: dialog if user absent 75+ minutes
- Awaits `SessionStart` hooks before routing

**onQuery:**
- Wraps `onQueryImpl` with QueryGuard (generation counter, not boolean)
- Enqueues messages if query already running

**onQueryImpl Steps:**
1. Haiku title extraction (first user message only)
2. Write skill-scoped `allowedTools`
3. Build full context via `getToolUseContext()`
4. Parallel async: system prompt + user context + killswitch checks
5. Stream query via `for await (const event of query(...))`

### QueryGuard State Machine

```javascript
const thisGeneration = queryGuard.tryStart();
if (thisGeneration === null) {
  // Already running -- enqueue messages
  return;
}
try {
  await onQueryImpl(...);
} finally {
  if (queryGuard.end(thisGeneration)) {
    resetLoadingState();
    await mrOnTurnComplete(messagesRef.current, aborted);
  }
}
```

### Loading State: Three Independent Sources

| Source | Mechanism |
|--------|-----------|
| `isQueryActive` | `useSyncExternalStore(queryGuard.subscribe, queryGuard.getSnapshot)` |
| `isExternalLoading` | useState + setIsExternalLoading |
| `hasRunningTeammates` | useMemo over tasks AppState |

### Dialog Priority Queue

`getFocusedInputDialog()` returns single winner from priority order:
1. `message-selector` (always)
2. `undefined` if `isPromptInputActive` (suppress while typing)
3. Sandbox permission queue
4. Onboarding dialogs
5. Callouts

**Suppression debounce:** `PROMPT_SUPPRESSION_MS = 1500`

### Messages Array Management

**Storage:** Ref holds live value; React state is render projection.

```javascript
const [messages, rawSetMessages] = useState<MessageType[]>(initialMessages ?? [])
const messagesRef = useRef(messages)

const setMessages = useCallback((action) => {
  const next = typeof action === 'function' ? action(messagesRef.current) : action
  messagesRef.current = next  // sync update
  rawSetMessages(next)
}, [])
```

**Three Mechanisms:**
1. **Ephemeral Progress Replacement:** Sleep/Bash progress ticks replaced in-place (prevents 13,000+ bloat)
2. **Compact Boundary Handling:** Array replaced with post-compact messages only
3. **Deferred Rendering:** `useDeferredValue(messages)` at transition priority

### toolJSX Overlay System

```javascript
const [toolJSX, setToolJSXInternal] = useState<{
  jsx: React.ReactNode | null
  shouldHidePromptInput: boolean
  shouldContinueAnimation?: true
  showSpinner?: boolean
  isLocalJSXCommand?: boolean
  isImmediate?: boolean
} | null>(null)
```

**Invariant:** Local JSX commands cannot be overwritten by tool updates.

### Two Render Paths

- **Transcript Mode:** VirtualMessageList (virtual scroll); search via `/`, navigation `n`/`N`
- **Fullscreen Mode:** AlternateScreen + FullscreenLayout with scrollRef

### Session Resume Flow (15 Steps)

1. Deserialize messages
2. Fire SessionEnd hooks for current session
3. Fire SessionStart hooks for resumed session
4. Copy or reuse plan slug
5. Restore file history snapshots
6. Restore agent definition
7. Restore standalone agent context
8. Save current session costs
9. Reset cost state, restore target costs
10. Atomically switch sessionId + project dir
11. Rename asciicast recording
12. Clear then restore session metadata
13. Exit current worktree, enter resumed session's worktree
14. Reconstruct contentReplacementState
15. setMessages -> setToolJSX(null) -> setInputValue('')

### Auto-Restore on Interrupt

When Escape pressed and query produced no meaningful response:
```javascript
if (
  abortController.signal.reason === 'user-cancel'
  && !queryGuard.isActive
  && inputValueRef.current === ''
  && getCommandQueueLength() === 0
  && !store.getState().viewingAgentTaskId
) {
  const lastUserMsg = msgs.findLast(selectableUserMessagesFilter)
  if (lastUserMsg && messagesAfterAreOnlySynthetic(msgs, idx)) {
    removeLastFromHistory()
    restoreMessageSync(lastUserMsg)
  }
}
```

### Main Render Tree

```javascript
<AlternateScreen mouseTracking>
  <KeybindingSetup>
    <AnimatedTerminalTitle />
    <GlobalKeybindingHandlers />
    <ScrollKeybindingHandler />  // BEFORE CancelRequestHandler (ctrl+c copy > cancel)
    <CancelRequestHandler />
    <MCPConnectionManager>
      <FullscreenLayout scrollRef={scrollRef}
        scrollable={<>
          <TeammateViewHeader />
          <Messages messages={displayedMessages} />
          {placeholderText && <UserTextMessage />}
          {toolJSX && <Box>{toolJSX.jsx}</Box>}
          {showSpinner && <SpinnerWithVerb />}
          <PromptInputQueuedCommands />
        </>}
        bottom={<Box>
          {permissionStickyFooter}
          {dialogs}
          <FeedbackSurvey />
          <PromptInput onSubmit={onSubmit} />
          <SessionBackgroundHint />
          {cursor && <MessageActionsBar />}
        </Box>}
      />
    </MCPConnectionManager>
  </KeybindingSetup>
</AlternateScreen>
```

### Key Design Patterns

**Ref Pattern for Stable Callbacks:**
- Reading `messages` via `messagesRef.current` (not dep array)
- Prevents recreating onSubmit across ~30 setMessages calls per turn
- Without this: ~9 REPL scopes + ~15 message array versions accumulated

**AnimatedTerminalTitle Isolation:**
- Terminal title animates with spinner glyph every 960ms
- Extracted to separate leaf component returning `null`
- Prevents entire REPL re-render on each animation frame

### Local JSX Command Categories

| Category | Slot | Examples |
|----------|------|---------|
| Immediate | bottom, outside ScrollBox | `/btw`, `/sandbox` |
| Non-immediate | scrollable, inside ScrollBox | `/diff`, `/status`, `/theme` |
| Fullscreen modal | modal, absolute-positioned | `/config`, `/model` |

### Important Constants

- `PROMPT_SUPPRESSION_MS = 1500`
- Spinner animation interval: 960ms
- Idle-return gate: 75+ minutes
- Inline message cap: 30 messages
- Teammate UI message cap: 50

---

*Extracted from 10 lessons of the Claude Code Source Deep Dive course at markdown.engineering*
