Updated: 2026-07-11 | Source: First-party binary inspection, four artifacts, all captured 2026-07-11 from this installation: Desktop `app.asar` **1.20186.1** (`index.chunk-DWHG-WxH.js` Cowork session spawn, `index.chunk-CS-g0Skn.js` host-loop adapter — the export names `configureHostLoopExecution`/`HOST_LOOP_PATH_GATED_BUILTIN_TOOLS` are **unminified and stable across builds**, `index.chunk-zFJ_MSb3.js` shared constants, `index.chunk-CCRuCFON.js` subagent-env prompt generator, `index.chunk-K6-cmJAJ.js` VM↔host path translation); the **Desktop-managed host agent** `~/Library/Application Support/Claude/claude-code/2.1.205/claude.app/Contents/MacOS/claude` (Mach-O arm64) — a **new artifact class** for this skill, distinct from both the standalone CLI in `~/.local/share/claude/versions/` and the in-VM ELF, extending Ch31/L117's "consider a third artifact class" methodology one artifact further; the in-VM ELF `claude-code-vm/2.1.205/claude` (same version as the host agent this capture, enabling a clean host/VM comparison); the live GrowthBook fcache (2026-07-11, 207 gates — format changed, see L124); and the production audit corpus — every `local-agent-mode-sessions/*/*/local_*/audit.jsonl` on the capturing machine, 509 real `Agent`/`Task` dispatches parsed in full. Two additional facts were spot-checked past the dossier's own scope: the `permission_denied`/`decideLocation==="pre-ask"` gate is confirmed identically present (2 occurrences) in the in-VM ELF 2.1.205, and `MCP_DISPATCH_SET_AGENT_NAME` in the agent-session `allowedTools` is gated by a session-level `dispatchAgentNameEnabled` flag threaded from the spawn builder, exposed to the cowork MCP server as `setAgentName` → the sessions-bridge client's `setDispatchAgentName`.

# Chapter 35: Cowork Sub-Agent (Task Tool) Execution Model

---

## Methodology note: a six-round mutual-correction pass with the emulator project

This chapter's source dossier was produced the same day the independent `claude-cowork-headless-emulator` project ran its own four-track subagent-fidelity investigation against the identical binaries (asar 1.20186.1, agent 2.1.205). The two passes cross-checked each other repeatedly rather than one simply consuming the other's output, and the correction traffic ran **both directions**:

- **We disproved, then re-vindicated, their fallback-evidence datum.** Their original claim — that the type-less-`subagent_type` fallback to `general-purpose` fires routinely in production — was first checked against the specific dispatch they cited as evidence, and that dispatch turned out to be an **explicit** `"subagent_type":"general-purpose"` call, not a fallback (a resolved-type sighting can never distinguish the two — see L124). That looked like a retraction. But a **full-corpus JSON parse** of all 509 dispatches (not a substring grep, which undercounts — `subagent_type` can trail a long `prompt`) found 113 genuine type-less dispatches across 39 sessions, vindicating their underlying conclusion even though their cited datum was wrong. A retraction of a retraction, settled by exhaustive parsing rather than either side's first read.
- **They corrected our `permission_denied` scope.** An earlier draft of this dossier's finding was broader than the evidence supported; their round-3 re-check narrowed it to the precise `decideLocation==="pre-ask"` gate condition — confirmed here first-party and re-verified against a second binary (the in-VM ELF 2.1.205) before being written into L124.
- **They corrected our framing of the two `run_in_background`-blocking mechanisms as simple "belt-and-suspenders" redundancy.** Re-tracing the standalone-CLI `SendMessage` path shows `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` now acts as an **awaitCompletion mode-switch** there (resume-and-run-synchronously), not merely a duplicate refusal — so calling the Desktop's Task-hook block and the env var "the same protection twice" understates what the env var does outside Cowork, even though inside Cowork both remain simultaneously present and the net effect (no backgrounding) is unchanged (L124).

The payoff of adversarial cross-review here is structural, not cosmetic: neither project's first draft was fully right, and the errors were on different axes (evidence selection vs. scope precision vs. mechanism framing) — a single-pass verification against one set of binaries would have shipped at least two of the three mistakes.

---

## TABLE OF CONTENTS

121. [Lesson 121 -- Task Sub-Agent Tool Composition: the `GY` Algorithm and the Type-less Fallback Trap](#lesson-121----task-sub-agent-tool-composition)
122. [Lesson 122 -- Sub-Agent File-Tool Namespace: the Outputs `cwd`, Write/Delete, and the Path-Containment Hook](#lesson-122----sub-agent-file-tool-namespace)
123. [Lesson 123 -- The Sub-Agent Prompt Append: `subagent_env_hl` / `subagent_env_vm`](#lesson-123----the-sub-agent-prompt-append)
124. [Lesson 124 -- Sub-Agent Env/Model, Lifecycle Re-Verification, VM-Loop Deltas, Stream Observability & Methodology](#lesson-124----sub-agent-env-model-lifecycle)

---

# LESSON 121 -- TASK SUB-AGENT TOOL COMPOSITION

**A sub-agent's tool set is not assigned — it is recomputed per dispatch from a universe that structurally can never exceed what the parent session was spawned with, then narrowed by five more filters, with the frontmatter `tools:` list authoritative only over what survives; the one silent trap is that a dispatch omitting `subagent_type` doesn't fail closed, it falls back to a built-in agent with `tools:["*"]` — full wildcard access, including `mcp__workspace__bash` in Cowork host-loop — and this fires in real production traffic, not just in theory.**

## The composer and its identifier key

The tool-composition function is `GY(agentDef, availableTools, isAsync, skipBaseFilter, isTeammate, agentDepth)`, host bundle 2.1.205, ~offset 10.56 MB. Resolved via this capture's `X="Name"` assignments: `fi="Agent"` (the dispatch tool, `aliases:["Task"]`), `Xo="Bash"`, `rs="Read"`, `Xa="Edit"`, `tu="Write"`, `Xd="Glob"`, `ud="Grep"`, `rC="WebFetch"`, `QZ="WebSearch"`, `SS="ToolSearch"`, `Xy="Skill"`, `Gg="SendMessage"`, `OB="ExitPlanMode"`, `vm="AskUserQuestion"`, `aA="Workflow"`.

## Frontmatter normalization, and a doc bug

`Pst`/`uwp` run before `GY` ever sees the frontmatter `tools:` value. Omitted → `undefined`; any list containing `"*"` → collapses to `undefined` (inherit-all):

```js
function uwp(e){if(e===void 0||e===null)return null;if(!e)return[];let t=[];if(typeof e==="string")t=[e];
  else if(Array.isArray(e))t=e.filter((n)=>typeof n==="string");if(t.length===0)return[];
  let r=tj(t);if(r.includes("*"))return["*"];return r}
function Pst(e){let t=uwp(e);if(t===null)return e===void 0?void 0:[];if(t.includes("*"))return;return t}
```

Frontmatter zod self-docs read: `tools: "Tools available to this agent. Replaces the default set."`, `disallowedTools: "Tools removed from the default set. Ignored if tools is set."` — **the "ignored if tools is set" doc is wrong versus the code**: `GY` subtracts `disallowedTools` even from an explicit `tools` list (step 3 below). Agents carrying `memory:` frontmatter get Write/Edit/Read force-appended, gated `Lp()`.

## The six-step algorithm

For a dispatch of agent definition A, in a session with permission context PC and MCP tools M:

1. **Universe U.** Fork subagents (`useExactTools:!0`) get the parent's exact tool objects — `GY` bypassed entirely. Everyone else gets `zY(PC', mcp.tools ∪ parent's mcp tools)`: the **full built-in registry `pV()` minus every tool matching a bare deny rule in PC** (including `--disallowedTools` and the complement of `--tools`, both built at session boot: `X=(u?GAs():pV().map(...)).filter((Q)=>!V.has(Q))`), plus MCP/skill tools minus denied/blocked (`aAe`/`kPe`). PC' mode = spawn mode ?? A.permissionMode ?? `"acceptEdits"`. Verbatim dispatch call: `ue=zY(ie,KOe(de.mcp.tools.concat(G)),{skipReplFilter:!0,skillTools:de.skillTools})`.
2. **Base subagent filter `rly`** (skipped only for main-thread `--agent`/observer paths, never for Task dispatch):

```js
function rly({tools:e,isBuiltIn:t,isAsync:r=!1,isTeammate:n=!1,permissionMode:o,agentDepth:i=0}){
 let s=e.filter((a)=>{if(qI(a))return!0;              // MCP tools ALWAYS pass every exclusion
  if(_l(a,OB)&&o==="plan")return!0;
  if(sZe.has(a.name))return!1;                         // subagent exclusion set
  if(!t&&P$i.has(a.name))return!1;
  if(_l(a,fi))return i<NMr;                            // Agent tool only when depth<5 (NMr=5)
  if(r&&!MMr.has(a.name)){...return!1}return!0});      // async whitelist
 if(o==="plan"&&!s.some((a)=>_l(a,OB)))s.push(Gq);return s}
```

   `sZe` (never available to sub-agents): TaskOutput, ExitPlanMode (except plan mode), EnterPlanMode, AskUserQuestion, ConnectGitHub, WaitForMcpServers, Workflow, ScheduleWakeup, EndConversation. Async (background) sub-agents are further restricted to `MMr` = {Read, WebSearch, TodoWrite, Grep, WebFetch, Glob, Bash, PowerShell, Edit, Write, NotebookEdit, Skill, StructuredOutput, ToolSearch, EnterWorktree, ExitWorktree, REPL, Monitor, TaskStop, SendMessage, Artifact} — **MCP tools are exempt from both filters**: `qI(e){return e.name?.startsWith("mcp__")||e.isMcp===!0}`.
3. **Minus A.disallowedTools** (`F_s`: names plus `mcp__server` / `mcp__server__*` / `mcp__*` server-level specs) — applied even when `tools:` is explicit, per the doc bug above.
4. **A.tools undefined or wildcard → inherit.** Result = everything surviving steps 1–3. `q_s` handles `["*", "Agent(x,y)"]` (inherit-all plus `allowedAgentTypes`) — but for **sub-agents** `allowedAgentTypes` is **discarded**: `nj` destructures only `.resolvedTools`; the field is honored solely on main-thread `--agent` paths.
5. **A.tools explicit → authoritative.** Exact-name lookup against the filtered universe; `mcp__server`/`mcp__server__*` binds that server's surviving tools; `Agent(x,…)` accumulates type restrictions; REPL-mode substitution for Read/Glob/Grep/Bash/PowerShell/NotebookEdit under `wO()`. **Names that can't bind are silently dropped** — `invalidTools`/`unavailableTools` appear only in `GY`'s return objects and have **zero consumers** anywhere in the bundle. No alias resolution happens here (raw `.name` map lookups only — see step 8 below for where alias resolution actually lives).
6. **Plus the agent definition's own frontmatter `mcpServers:`** (spawned per dispatch by `jay`, filtered only by A.disallowedTools; blocked under `--strict-mcp-config` / safe mode / remote mode / enterprise MCP config) — **the one sanctioned way a non-plugin sub-agent gains tools its parent session doesn't have.** Minus {TodoWrite, TaskCreate/Update/Get/List} for non-teammates under gate `tengu_shale_finch`.

## Depth cap and the absence of a fan-out cap

> **SUPERSEDED BY LATER BUILDS — see Ch38/L134 first, then Ch47/L170.** This section is correct for the
> artifacts it names (host agent 2.1.205 / in-VM ELF 2.1.205), where no concurrency cap exists and the depth
> bound is a hardcoded `NMr`. Fan-out caps **arrived later** (2.1.212/2.1.217) and are documented in L134;
> L170 records what has moved since (depth default now 3, the per-session cap removed, two bypasses on the
> concurrency cap). Nothing below was wrong when written — *"not found in the bundle I searched" only
> disproves a claim for that bundle.*

Depth: the dispatch throws at `Q3(ctx)>=5` ("Subagent nesting limit reached (depth ${g} of 5)"), `NMr=5` on the host; the in-VM ELF carries the identical guard, `BLr=5`:

```js
BLr=5, if(g>=BLr)throw Ee("subagent_launch","subagent_depth_cap"),new jit(`Subagent nesting limit reached (depth ${g} of ${BLr})...`)
```

There is **no fan-out/concurrency cap on Task dispatches anywhere** in the asar or host bundle. The only real bound is generic and per-turn, not Task-specific:

```js
function CQg(){let e=parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY||"",10);return e>0?e:10}
```

Default **10**, keyed on each tool's `isConcurrencySafe` — it **queues, never refuses**. The only other "cap"-shaped thing is prompt guidance only: `mfo={small:5,medium:15,large:50}` (a `workflowSize` settings enum), rendered as `"${e} — keep workflows under ${mfo[e]} agents. This is a guideline, not a hard limit — follow it unless the user's prompt calls for a different scale."` No enforcement path exists for it.

## The type-less fallback trap

A dispatch that omits `subagent_type` does not error — it resolves to a built-in definition with the widest possible tool grant:

```js
G5e={agentType:"general-purpose",whenToUse:"General-purpose agent for researching complex questions...",
     tools:["*"],source:"built-in",baseDir:"built-in",getSystemPrompt:iay}
```

and at the Task call site: `let Pe=t??G5e.agentType`. So a type-less dispatch inherits `tools:["*"]` — **the full session universe, including `mcp__workspace__bash` in Cowork host-loop.** This directly undermines any "shell-free sub-agent" assumption made from an agent's normal `tools:` frontmatter alone (see L121's practical section and L122).

Production evidence, from the full 509-dispatch audit corpus (exhaustive JSON parse, not substring grep): **113 of 509 dispatches, across 39 distinct sessions, carry no `subagent_type` in the input at all** — the fallback fires routinely, including inside `founder-skills` flows specifically ("Research and enrich competitors" ×5, "Checklist scoring (Sub-agent A)", "Metrics and runway sub-agent", "Extract financial model data"). The one specific dispatch originally cited as fallback evidence (`toolu_01QFu3XtsYaihDoj4iCSDQ4g`) turned out on inspection to carry `"subagent_type":"general-purpose"` **explicitly** — not a fallback — which is the load-bearing methodological point: **resolved-type sightings (per-message `subagent_type`, `task_description`, or the stream's `task_started.subagent_type` field — see L124) can never distinguish an explicit `general-purpose` dispatch from the type-less fallback. Only the dispatch's own `input` object can**, and only a full-corpus parse (not a prefix window) reliably finds it, since `subagent_type` can trail a long `prompt` string.

## Plugin agents: a narrower channel than non-plugin agents

Correction to step 6 above: **plugin-shipped agents cannot use the frontmatter `mcpServers:` channel at all.** The plugin agent loader discards it with a warning, verbatim:

```js
for(let G of["permissionMode","hooks","mcpServers"])if(c[G]!==void 0)C(`Plugin agent file ${e} sets ${G}, which is ignored for plugin agents. Use .claude/agents/ for this level of control.`,{level:"warn"})
```

So the "one sanctioned extra-tool channel" (step 6) exists only for non-plugin (`.claude/agents/`) definitions — plugin agents also lose `permissionMode` and `hooks` overrides the same way.

## Cowork host-loop application

The Desktop's spawn `tools:` array (asar `index.chunk-DWHG-WxH.js`):

```js
tools:["Task","Bash","Glob","Grep","Read","Edit","Write","NotebookEdit","WebFetch",...o.TASK_TOOL_NAMES,
 "WebSearch","Skill","REPL","JavaScript","AskUserQuestion","ToolSearch",
 ...s.sessionType===o.SESSION_TYPE_AGENT?["SendUserMessage"]:[],...A?[o.PROJECTS_TOOL_NAME]:[]]
```

then `configureHostLoopExecution` (`et(e,o)` in `index.chunk-CS-g0Skn.js`) mutates it before it ever reaches `GY`'s Universe step:

- `e.tools=zt(e.tools)` narrows to `HOST_LOOP_SAFE_BUILTIN_TOOLS` (unminified export `h5e`) = `["Task","Glob","Grep","Read","Edit","Write","TaskCreate","TaskUpdate","TaskGet","TaskList","TaskStop","WebSearch","Skill","AskUserQuestion","ToolSearch","SendUserMessage","Projects"]` plus all `mcp__*`.
- `e.disallowedTools=[...e.disallowedTools??[],...HOST_LOOP_EXCLUDED_BUILTIN_TOOLS]`, `p5e=["Bash","NotebookEdit","REPL","JavaScript","WebFetch"]` — the successor of the L107-era `gre`.
- **New, first-class SDK option**: `e.toolAliases={Bash:t.MCP_WORKSPACE_BASH,WebFetch:t.MCP_WORKSPACE_WEB_FETCH}`. Agent-side schema doc: *"Map of tool-name aliases applied before name resolution. When the model emits a tool_use whose name is a key in this map, the tool execution path resolves the mapped name instead. Single-hop (no chains)."* Resolver `rc(tools,name,toolAliases)`. Deliberate non-expansion: `tXn(e){return e.source!=="cliArg"&&e.source!=="toolsNarrowing"}` — a deny rule on `Bash` does **not** propagate to deny `mcp__workspace__bash`.
- `WORKSPACE_ALLOWED_TOOLS=[mcp__workspace__bash]` only (`w5e=[lae]`) — host-loop pre-approves workspace **bash** alone; `mcp__workspace__web_fetch` is aliased but *not* pre-approved, so it still flows through the Desktop's `canUseTool`.

**Practical reading:** `tools: [Read, Edit, Glob, Grep]` in frontmatter yields **exactly those four** — `mcp__workspace__bash`/`mcp__workspace__web_fetch` are MCP tools that must be inherited (wildcard) or explicitly named, never auto-injected. `tools:` omitted or `"*"` inherits the full session universe, which in Cowork host-loop includes the workspace MCP tools. A literal `Bash` in frontmatter never binds in host-loop (absent from the recomputed universe, lands in the silently-dropped `invalidTools`) — but a model that *emits* a `tool_use` named `Bash` at runtime is alias-routed to `mcp__workspace__bash` by `rc()`, **iff** that tool is in the sub-agent's already-bound set. No Desktop-side per-sub-agent tool override exists — no `agents:` SDK option is passed at spawn (zero hits across the relevant chunks); the only Task-specific Desktop control is the PreToolUse "Task" hook (telemetry + `run_in_background` block, discussed in L124 — it never touches tools).

## Corrections to earlier lessons

- **Ch24/L107 partition symbols renamed, and now exported unminified.** `gre→p5e` (`HOST_LOOP_EXCLUDED_BUILTIN_TOOLS`), `PNt→h5e` (`HOST_LOOP_SAFE_BUILTIN_TOOLS`), path-gated set now `g5e` (L122); `BDt`/`QDt` injection is superseded by the first-class SDK option **`toolAliases`** described above.
- **Ch24/L107's force-ask matcher set grew again**: now 9 joined tool names (adds `MCP_DELETE_SCHEDULED_TASK` to the previously-documented set of 8).

---

# LESSON 122 -- SUB-AGENT FILE-TOOL NAMESPACE

**Sub-agents are in-process async generators sharing the parent's OS process, filesystem containment, and hooks — there is no per-sub-agent sandbox and no per-sub-agent env; the one fact worth internalizing is that the host agent's `cwd` *is* the session outputs directory (the **agent process** — `mcp__workspace__bash` starts at the session root instead, Ch44/L163), so a canonical write is cwd-relative, and `/sessions/...` paths are always denied (never translated) for file tools regardless of whether the caller is the main thread or a sub-agent.**

## In-process execution, zero per-sub-agent env

Every dispatch path iterates `async function*nj({agentDefinition,...})` (host bundle ~10544400) inline, or hands `makeStream:(...)=>nj(...)` to the in-process task registry `z5e`, wrapped in `Sz(ue,()=>...)` where `Sz` = `g0r.run` (AsyncLocalStorage). There is **no per-sub-agent env assembly anywhere** in the bundle — identity is a plain context object: `{agentId, parentAgentId, depth, parentSessionId, agentType:"subagent", subagentName, ...}`.

## cwd inheritance and the Task schema

**Sub-agent cwd = parent cwd**, scoped via the same AsyncLocalStorage with a process fallback (`vt()`/`FFe`, host bundle 1079437): dispatch runs `Sz(Ue,()=>FFe(be,...))` where `be` = internal cwd override ?? worktreePath ?? undefined — undefined re-enters the parent's cwd. The Task tool's exposed input schema **strips `cwd`**: `kgy().omit({cwd:!0})` (11196689) — a model cannot set it directly; only worktree isolation changes it.

## The path-containment hook, re-anchored at 1.20186.1

Now lives in `index.chunk-CS-g0Skn.js` (`configureHostLoopExecution`, offset ~40385), appended to the Desktop's PreToolUse hooks. **Matcher**: `[...HOST_LOOP_PATH_GATED_BUILTIN_TOOLS,"MultiEdit"].join("|")` = `Read|Write|Edit|Glob|Grep|MultiEdit` (`g5e=["Read","Write","Edit","Glob","Grep"]`, zFJ_MSb3 offset 2353747); path keys probed: `pe=["file_path","path"]`.

**VM-path deny** (`xe()`, offset 34220) — `/sessions` exact or `/sessions/` prefix is **denied, not translated**:

```js
if(typeof n=="string"&&(n==="/sessions"||n.startsWith("/sessions/")))return ... {behavior:"deny",
 message:`\`${n}\` is a VM path. In this session the ${e} tool runs on the host filesystem, where
 \`/sessions/...\` doesn't exist. Use the host path for this file (connected folders are available at
 their real locations), or use the \`bash\` tool — which runs inside the VM — to operate on \`/sessions/...\` paths.`}
```

Nuance: `xe` checks membership in `g5e` (no MultiEdit in that set), so a `/sessions/...` MultiEdit skips this specific message but is still blocked by containment.

**Resolution**: tilde-expand → `path.resolve(hostCwd, p)` for relative paths → `resolveFilePath(p, true)` symlink resolution (ENOENT tolerated for new files; other errors block).

**Allowed roots** (offset ~40300): hostCwd (`c`), hostOutputsDir (`u`), hostUploadsDir (`h`, read-only for mutating tools), `.claude/projects` + staged-config `projects` (spooled tool results, read-only), autoMemoryHostDir, skillsPluginPath, readOnlyPluginPaths (read-only), `e.additionalDirectories` (connected folders), plus live connected folders `T()` and — for **non-mutating tools only** — `getMidSessionReadOnlyPaths()`.

**Mutating special-casing** (`Jt=["Write","Edit","MultiEdit"]`, `qt()` offset 31711): writes into uploads → blocked (*"it is a hardlink to the user's original file, so writing here would overwrite it on their disk"*); spooled projects → *"read-only in this session (spooled tool results)"*; plugin paths → *"read-only in this session (plugin, skill, or knowledge content)"*. Outside all roots → block with *"...is outside this session's connected folders, so ${tool} can't reach it. If this is a user project or working folder, request it with the `request_cowork_directory` tool..."*.

**Second enforcement layer**: the `canUseTool` wrapper composes the same deny ahead of everything else — `e.canUseTool=async(g,S,k)=>xe(g,S)??Qt(g,S,...)??Se(g,S,k)` — so even a hook-bypass hits the same `/sessions/` deny.

## Hooks fire inside sub-agents — first-party proof

SDK-passed hooks are registered **process-globally**: the initialize handler (host bundle 18620434) → `J2e(g)` appends into `registeredHooks` on global session state; the gate `c$` (12222753) has **no subagent exclusion**; `executePreToolHooks` (`JVr`, 12196439) is invoked from the single shared tool executor both loops use. Decisive: the hook-input zod schema (18314820) documents `agent_id` as *"Subagent identifier. Present only when the hook fires from within a subagent (e.g., a tool called by an AgentTool worker). Absent for the main thread"* — and the Desktop's own Skill hook branches on `!z.agent_id`, its WebSearch PostToolUse logs `"seeded ... URL(s) from subagent WebSearch"`. Caveats: hooks are skipped only for `bareFork` dispatches and the EndConversation tool.

## The crux: `cwd` IS the outputs directory

Host path: `getStorageDir` (zFJ_MSb3 2360204) + `sessionDirPaths` (DWHG 233156) →

**`~/Library/Application Support/Claude/local-agent-mode-sessions/<accountId>/<orgId>/local_<sessionId>/outputs`**

(`M_="local-agent-mode-sessions"`, `k0="local_"`; an `agent` subdir variant exists for `SESSION_TYPE_AGENT`; a hashed-short-path variant sits behind flag `I5e`). Verified against real on-disk layout (`local_fe16d580-.../{outputs, uploads, .claude/{projects,plugins,sessions}, audit.jsonl}`). Spawn cwd: `const f=m?this.getOutputsDir(e):null` (DWHG 264967) → `configureHostLoopExecution(W,{hostCwd:f, hostOutputsDir:..., hostUploadsDir:y.join(y.dirname(f),"uploads"),...})` → `e.cwd=c`. Uploads is a sibling of outputs.

So a host-native Write lands in outputs via a **bare/cwd-relative path** (`artifacts/report.md`) or the host-absolute staged path. `/sessions/<id>/mnt/outputs/...` is **always denied, never translated**: the VM↔host translation module (`index.chunk-K6-cmJAJ.js`: `mapVMPathToHostPath`/`mapHostPathToVMPath`/`deepTranslateVMPaths`) is applied only to **outbound** agent messages (`translateMessagePaths`, DWHG 172353), `file://`/`computer://` URIs, and the scheduled-task file reader — **never** to file-tool inputs. (This also resolves the `.host-home` question from Ch23/v2.23.0 in the same direction: it is a synthetic path-translation index, not a mount, and not an input-side rewrite.)

Production corroboration: real dispatches in the audit corpus carry **relative** `OUTPUT_PATH: artifacts/...` values — live confirmation of the cwd-relative canonical form. One host/agent asymmetry worth modeling: the Desktop-side hook closure captures `c` (session hostCwd) at spawn, while agent-side tools resolve relative paths against the ALS cwd — these diverge only under worktree isolation, which is moot in Cowork (outputs is not a git repo).

## Write/delete policy under `outputs/` and `uploads/`

**Delete gating is mount-mode, not per-agent.** `resolveWorkspaceMountMode` (`K6-cmJAJ`): `s?"rw":t?.includes(e)?"rwd":"rw"` — mounts default **rw**, become **rwd** only when the mount name is in the session's `fileDeleteApprovedMounts` (populated via `mcp__cowork__allow_cowork_file_delete`, persisted on the session; **bridge sessions never get rwd**). Applied to host-loop bash mounts (recomputed per bash call, `computeBashMounts`) and VM-loop mounts alike. **Host-native file tools have no delete verb at all**, so no host-side delete gate exists; deletes only happen through `mcp__workspace__bash`, which every agent — main or sub — reaches through the same process-wide `toolAliases`/mount state, so **sub-agents inherit the delete policy identically**. The force-ask hook on `allow_cowork_file_delete` fires for sub-agents too (same proof as the hooks section above).

**`uploads/` is read-only twice over**: in-VM mount `mode:"ro"` and host-side `qt()` blocking Write/Edit/MultiEdit (the hardlink warning). Read is allowed (uploads is in the allow-roots). **`outputs/`** is read-write for host file tools (it's cwd + an allow-root); rw (rwd after approval) for VM bash.

**VM bash cwd — CORRECTED, see Ch44/L163.** `vmCwd = /sessions/<id>/mnt/<vmCwdMountName>` is still
computed and still passed to the guest spawn (`to()` picks the mount name: first connected folder, else the
outputs mount, via an `h??(h=a)` fallback) — but **it is not what the shell observes.** `mcp__workspace__bash`
starts at the **session root `/sessions/<id>`**, with and without a connected folder, which falsifies the
former "first-folder-else-outputs" rule in *both* branches. This skill's own Ch40 probes measured the session
root at Desktop 1.25927.0, and from 1.32885.1 the shipped prompt says so outright. Only the `chat` branch
prepends an explicit `cd ${vmCwd}`, which is the tell that the spawn argument is not load-bearing. The
downstream consequence originally recorded here still holds, for a different reason: a cwd-derived "artifacts
root" computed inside bash yields a `/sessions/...`-absolute path that the host-side file tools then deny.

## `${CLAUDE_PLUGIN_ROOT}` in sub-agents

All occurrences in the host bundle are classified. The substitution primitive `PEe(e,t)` (5239784) replaces `${CLAUDE_PLUGIN_ROOT}` → `t.path` (plus `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_DATA}`) in **text**, and only there:

- **Plugin agent system prompts are pre-resolved at definition load** (loader ~12380427: `x=PEe(u.trim(),{path:o,source:n})`), before any dispatch — so a plugin sub-agent's prompt already contains the literal resolved host path, and its host-native `Read` of a `references/*.md` file works (plugin paths are in the allow-roots, read-only). Skill/command bodies and `allowed-tools` frontmatter are likewise pre-resolved (`getPromptForCommand` ~7272673).
- **As a process env var**, it is injected only into hook subprocesses, plugin MCP stdio servers, `headersHelper`, and plugin LSP servers — **not** into the Bash-tool subprocess env (`sEt()` at 5044379 injects only `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, optional `AI_AGENT`/`CLAUDE_EFFORT`/`TRACEPARENT`). A model-typed `${CLAUDE_PLUGIN_ROOT}` inside a Bash command expands to empty — consistent with the earlier v2.25.0 lesson, and moot anyway in host-loop since the resolved path is a host staging path useless inside `mcp__workspace__bash`.
- **File tools do not expand the token at all**: zero occurrences in Read/Write/Edit/Glob/Grep path handling; a literal `Read("${CLAUDE_PLUGIN_ROOT}/…")` fails. It only ever works because the surrounding *text* was pre-resolved before the model ever saw it.

**Sub-agent answer:** yes, a Cowork host-loop plugin sub-agent can `Read` its plugin's staged reference files — because the path arrives pre-resolved in its own system prompt, not because any env/expansion exists at call time.

---

# LESSON 123 -- THE SUB-AGENT PROMPT APPEND

**Every Cowork sub-agent gets a short, hardcoded environment-orientation paragraph appended to its system prompt — which branch it gets (host-loop vs VM-loop wording) is a single boolean, delivery depends on an env var the Desktop sets unconditionally, and a subtle wiring gap means the same option delivered via the `initialize` control request alone — without that env var — is silently inert.**

## The two verbatim branches

Generator `zo` = `exports.buildSubagentEnvironmentPrompt` (`index.chunk-CCRuCFON.js` 130118), called as `zo({vmProcessName:e,hostLoopMode:r,hostCwd:t,spSectionPrompts:o})`, with `i = "/sessions/"+e`.

**Host-loop branch (`subagent_env_hl`):**

> ## Cowork environment
>
> [as shipped through Desktop 1.32352.0 — from **1.32885.1** this branch gains a closing sentence: *"Each command starts in `${a}`; anything written outside `${a}/mnt/` (including `/tmp`) stays in that environment and never reaches the user or your file tools."* — Ch44/L163]
> You are running as a subagent inside a Cowork session on the user's machine. File operations reach the user's real filesystem (working directory `${t??i}`), so only read or write inside folders the user has attached to this session. Shell commands run via `mcp__workspace__bash` in an isolated Linux environment where those folders are mounted under `${i}/mnt/`.

**VM-loop branch (`subagent_env_vm`):**

> ## Cowork environment
>
> You are running as a subagent inside a Cowork session. Shell commands execute in an isolated Linux sandbox rooted at `${i}` — files created there (or under `/tmp`) exist only in the sandbox, not on the user's real computer. User-attached folders are mounted under `${i}/mnt/`.

## Selection, delivery, and consumption

- **Selection** is the session's `hostLoopMode` boolean (from `isHostLoopModeEnabled()`, i.e. the gate-`1143815894` decision documented in L124 below) — no separate condition. Section keys live in a broader `SP_SECTION_KEYS` table (`Ert`, zFJ_MSb3 3789393): `subagentEnvHostLoop:"subagent_env_hl"`, `subagentEnvVm:"subagent_env_vm"`, siblings `dispatch_child_fs_hl`/`_vm`, `skeleton_home`, `computer_use` — evidence of a broader remote-overridable prompt-section system beyond just this one append.
- **Delivery**: the Desktop sets `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT:"1"` **unconditionally** in every Cowork spawn env (DWHG ~147531) and passes the generated text as `appendSubagentSystemPrompt` in sdkOptions (148922) → the `initialize` control-protocol request (CvbeGVMj 554866). Template vars available for remote overrides: `{{vmCwd}}`, `{{hostCwd}}`, `{{workspaceBash}}` (non-nesting `{{#if}}` only).
- **Consumption** (host bundle 10546804, inside `nj`): `Nt=!E&&pt(process.env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT)&&r.options.appendSubagentSystemPrompt?qu([...At, r.options.appendSubagentSystemPrompt]):At` — applies to **Task sub-agents only, not fork/`useExactTools` dispatches** (the `!E` guard), and **propagates to nested sub-agents** (child options carry `appendSubagentSystemPrompt`). Initialize zod self-doc: *"@internal Additional system prompt appended to every Task-tool subagent (and propagated to nested subagents). Gated by CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT."*
- A hidden print-mode CLI flag, `--append-subagent-system-prompt <prompt>` (hideHelp, implies the env var), exists in both 2.1.205 bundles.

## The gate that does *not* gate this, and the one env-var gap that does

GrowthBook `124685897` does **not** gate the append feature — that was the emulator brief's half-right premise. It gates only whether server-supplied ("starling") section text, via the renderer's `spSectionPrompts` record, may **override** the hardcoded prompts above: `resolveSection`/`krt`: `if(!$t("124685897"))return r` (hardcoded fallback). Live fcache: `"124685897":{"on":false,"source":"defaultValue"}` → **off** — the hardcoded texts quoted above are what ships today.

**Sharper env-gate finding**, verifying the emulator's `F7e`: the self-set `YRp(e,t=process.env){if(e)t.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT="1"}` has exactly **one** call site in the whole bundle — CLI-boot flag parsing (`YRp(a.appendSubagentSystemPrompt)`, i.e. the hidden `--append-subagent-system-prompt` path). **The `initialize` handler does not call it** — it only sets `c.appendSubagentSystemPrompt`. Since consumption requires *both* `pt(process.env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT)` **and** `r.options.appendSubagentSystemPrompt`, an `appendSubagentSystemPrompt` delivered purely via the `initialize` control request is **inert unless the env var is independently present in the agent process env**. The Desktop's unconditional spawn-env `"1"` is *required* for its own `initialize`-delivered append to actually work — an SDK integrator who sends the option without also setting the env var gets silence, not an error. This is the concrete gotcha for anyone building an SDK host that wants this feature.

---

# LESSON 124 -- SUB-AGENT ENV/MODEL, LIFECYCLE RE-VERIFICATION, VM-LOOP DELTAS, STREAM OBSERVABILITY & METHODOLOGY

**Four Ch29/L115 conclusions hold at 1.20186.1/2.1.205 with two real refinements (background-by-default polarity flip; a new cross-session continuation channel that is not sub-agent resume); model resolution and ToolSearch enablement are both env/settings-driven chains with documented, warn-don't-fail-through fallback behavior; the host-loop/VM-loop split now has one true divergence (Bash) once WebFetch's aliasing in both loops is accounted for; and the local stream carries more sub-agent observability than Ch32/L118 catalogued, plus one methodology change (fcache is now gzip-wrapped) that invalidates the raw-grep technique used through v2.26.0.**

## Sub-agent env & model resolution

In-process, **zero per-sub-agent env** (Lesson 122) — identity is context fields, surfaced to hooks as JSON input (`agent_id`, `agent_type`); Bash subprocesses see only the generic `AI_AGENT` marker. `spawnedBySkill: options.spawnedBySkill ?? options.activeSkill` persists unchanged in 2.1.205 (the Ch32/L118 mechanism is intact).

**Model resolution chain** (`Fae`/`JYu`, host bundle ~10166687–10167214), verbatim precedence: `CLAUDE_CODE_SUBAGENT_MODEL` env (unless `"inherit"`) → Agent-tool `model` param → frontmatter `model:` → inherit main-loop model (default). Built-in **Explore** inherits, except on first-party when the main model is outside the haiku/sonnet/opus families → pinned `"opus"` (`w4e`/`m7c`); teammates use their own resolver (`teammateDefaultModel` setting, default opus48).

**Unrecognized `CLAUDE_CODE_SUBAGENT_MODEL` warns and inherits — it does not fall through to the tool param or frontmatter.** In `Fae`: `if(a&&a!=="inherit"){let p=oi(a);if(!yl(p))return s(a);return p}`, where `s` calls `DJg`: *"Subagent model \"${e}\" is not in the availableModels allowlist; inheriting the parent model instead"* (level warn), returning the inherit resolution `i()`. It is precisely an **availableModels-allowlist** check (`yl`); a failing env value short-circuits straight to inherit. Telemetry: `subagent_model_resolve`/`override_dropped`.

**Fork dispatches force-inherit the model.** The Agent-tool dispatch options pass `model:B?void 0:m` (B = fork) — a fork never forwards the tool-call `model` param, so `Fae` resolves via frontmatter/inherit instead. Two adjacent fork guards, verbatim: *"Fork cannot use isolation: \"remote\" — a remote session cannot inherit the conversation context"* and *"Fork is not available inside a forked worker. Complete your task directly using your tools."* (telemetry `subagent_fork_remote_isolation` / `subagent_recursive_fork`).

**Desktop injection of `CLAUDE_CODE_SUBAGENT_MODEL` is conditional**: `...o.getDefaultSubagentModel()!==void 0&&{CLAUDE_CODE_SUBAGENT_MODEL:o.getDefaultSubagentModel()}` — `getDefaultSubagentModel` (`lVe`, zFJ_MSb3 2583812) reads the server-delivered **YukonSilverConfig** `defaultSubagentModel` (IPC `ClaudeVM_$_setYukonSilverConfig`); the `"inherit"` sentinel means "don't set." So by default a Cowork Task sub-agent runs the **same model as the main loop**, overridable server-side.

## ToolSearch enablement

`M4()`/`IMr()` default: env unset → mode `"tst"` — **on for first-party** (off-host/Vertex excluded; model support via `tme` minus `tengu_tool_search_unsupported_models`). `"auto"`/`"auto:N"` = percentage-of-context deferral: `Z0s()` returns `Q0s=10` for unset/`"auto"` (or the parsed N), `wxd = Math.floor(contextTokens * Z0s()/100)` — **default 10% of context**, char-count fallback ×`p0y=2.5`; debug string `"${o} tokens (threshold: ${a}, ${Z0s()}% of context)"`.

Kill switches: `IMr(){if(F_t())return"standard";...}` where `F_t()=pt(CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS)||qoe("hipaa")` — `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` or a HIPAA workspace forces mode `"standard"`, **which means tool search disabled** — a real naming trap for anyone reading `"standard"` as "the standard/default behavior." **Gate `1129419822`** — the one that would surface as `ENABLE_TOOL_SEARCH:"auto"` if it existed as a live spawn-conditioned env var — is **absent from both the live fcache and the agent bundle itself**, so the Desktop's `...isFeatureEnabled("1129419822")&&{ENABLE_TOOL_SEARCH:"auto"}` injects nothing today; ToolSearch's actual on/off state is agent-default-driven, not gate-driven.

Related gate-conditioned spawn env (live states, this capture): `434204418` off → `MCP_CONNECTION_NONBLOCKING:"0"`, `MCP_CONNECT_TIMEOUT_MS:"10000"` not injected (values match the prior v2.23.0 capture — an earlier draft's claim of a polarity change here was wrong and is withdrawn); `66187241` off → `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:""`; `714014285` force-on → `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING:"1"`; `1936081873` force-on → `CLAUDE_CODE_OAUTH_SCOPES`; `4153934152` off.

## Lifecycle re-verification and the two new correction points

All Ch29/L115 conclusions **re-verified at 1.20186.1/2.1.205**: Task remains one-shot per call (schema `xgy`: `description`, `prompt`, `subagent_type?`, `model?`, `run_in_background?`, `isolation?` — no resume/agentId param; with `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, `run_in_background` is dropped from the schema entirely via `NVr||ime()?e.omit({run_in_background:!0}):e`).

**Polarity flip vs. the L115-era capture**: backgrounding is now the *default* ("Agents run in the background by default; you will be notified when one completes. Set to false to run this agent synchronously"). And the standalone CLI's `agent-stopped` `SendMessage` branch now treats `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` as an **awaitCompletion mode switch** (resume-and-run-synchronously), not a refusal.

Both refinements are moot in Cowork, which **still severs resume at spawn**: `SendMessage` remains absent from both `tools:` and `allowedTools:` (only `SendUserMessage` appears — 25 occurrences, zero `SendMessage`); `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:"1"` + `CLAUDE_CODE_DISABLE_AGENTS_FLEET:"1"` remain unconditional in the main spawn env; the PreToolUse `"Task"` hook still blocks `run_in_background` (*"Background agents disabled"*) and emits `subagent_invoked` telemetry (with `resolvePluginContext(G.subagent_type,...)` — plugin sub-agent types are resolved Desktop-side for the event).

**New continuation primitive, and it is not sub-agent resume.** Agent-type sessions (`SESSION_TYPE_AGENT`) get `mcp__dispatch__send_message` (`i5e`), plus `MCP_DISPATCH_LIST_PROJECTS` and gate-`3723845789` `LIST_CODE_WORKSPACES` — a **Desktop-mediated cross-SESSION continuation** (*"Send a user message to a local session... Use this when the user's message is a continuation of an existing session"*, handler routes via `e.sendMessage`, logs `lam_dispatch_send_message`). It is session-level, not sub-agent resume. `MCP_DISPATCH_SET_AGENT_NAME` is gated by a session-level `dispatchAgentNameEnabled` flag (destructured as `k` from the spawn-builder params `{...,dispatchAgentNameEnabled:k,...}=r`, threaded from an upstream `dispatchAgentNameEnabled:c`); when enabled the cowork MCP server exposes `setAgentName`, which calls the sessions-bridge client's `setDispatchAgentName`.

**No Task fan-out/concurrency cap exists anywhere** — reaffirmed exhaustively (asar + host bundle): `maxConcurrentPerSession/Total` belongs to the dormant device-CLI queue (gate `1544796833`, null in fcache); gate `1648655587` remains the scheduled-task session limiter (`{"global":3,"perTask":1}`, force-on, confirming v2.22.1); the only "cap"-shaped thing is the workflow-size prompt guidance (Lesson 121). Depth limit: 5 (`NMr` host / `BLr` VM).

## Host-loop vs VM-loop: the decision function and its deltas

**Decision function** (successor of L107's `f_()`; zFJ_MSb3, verbatim):

```js
const UKe="forceDisableHostLoop";function FM(){return ot.get(UKe,!1)}
function jKe(){return $t("1143815894")}function vI(){return Oe().workspace.requireFullVmSandbox}
function Pm(){return vI()||FM()?!1:globalThis.isDeveloperApprovedDevUrlOverrideEnabled&&process.env.CLAUDE_FORCE_HOST_LOOP==="1"?!0:jKe()}
```

Precedence: MDM `requireCoworkFullVmSandbox` or `forceDisableHostLoop` → VM-loop; else `CLAUDE_FORCE_HOST_LOOP=1` **now additionally gated on `globalThis.isDeveloperApprovedDevUrlOverrideEnabled`, so dead on stock installs** (a change vs. Ch24/L107 and Ch25/L108); else gate `1143815894`. Live fcache: `{"value":true,"on":true,"source":"force","ruleId":"fr_mnqhxsok"}` → **host-loop is still production**. Custom-3p deployments additionally hardcode a gate table `uOt` (`hardcodedMainGrowthBookFeatures`) force-ONing `1143815894` — and, notably, `2307090146` (`cli_plugin`, Ch23/L106) — without GrowthBook, plus `123929380` (coworkKappa), `2976814254`, `3246569822`, `1696890383`, `2940196192`, and `1978029737={coworkNativeFilePreview:true}`. **This amends Ch23/L106**: the cli_plugin credential broker is dark on consumer GrowthBook but **live in custom-3p deployments**.

**Resume stickiness with a policy tripwire**: the host-loop decision is consulted only on first turn (`m=a?o.isHostLoopModeEnabled():...`); resumed sessions keep the persisted `hostLoopMode`, and — verbatim — `if(!a&&(p?.hostLoopMode)===!0&&o.requireFullVmSandbox())throw new Error("This session was created before your organization required the VM sandbox. It cannot be resumed under the current policy. Please start a new session.")`. Also exports `setForceDisableHostLoop` (an IPC-settable local kill switch) and `isHostLoopDevOverrideActive`.

**Deltas table**, built from a shared VM-loop-shaped base config (`q={cwd:"/sessions/"+n, pathToClaudeCodeExecutable:"/usr/local/bin/claude", ...}`, env `CLAUDE_CONFIG_DIR="/sessions/"+n+"/mnt/.claude"`), then branched:

| Property | Host-loop (`configureHostLoopExecution`) | VM-loop (`nl(...)`) |
|---|---|---|
| Agent process | Host Mach-O (`claude-code/2.1.205/...`), `e.cwd=` host outputs dir, staged host `CLAUDE_CONFIG_DIR` | In-VM ELF `/usr/local/bin/claude`, cwd `/sessions/<id>`, guest config dir; wired via `getVMSpawnFunction` (mounts: `.claude` rwd, `.claude/skills` ro, uploads ro, projects/artifacts/scheduled ro) |
| Bash | Excluded + aliased: `toolAliases={Bash:mcp__workspace__bash}` | **Literal `Bash` binds natively** — `nl` never touches tools/disallowedTools/toolAliases; the base `tools:` includes "Bash"; the VM bundle carries the full Bash tool |
| WebFetch | Excluded + aliased to `mcp__workspace__web_fetch` | **Also aliased**, at a different site: the MCP-server builder disallows builtin WebFetch and routes to a host-side SDK MCP `web_fetch` when `1978029737.coworkWebFetchViaApi` (live: true) — **Bash is the only tool that truly diverges between loops** |
| File tools | Host-native, path-gate hook + `/sessions/` deny | In-VM native, **no path-containment hook** (structurally unnecessary — the whole agent is inside the guest); only tool edit is `allowedTools += Edit(/<memory>/**) / Write(/<memory>/**)` |
| Task/Skill/force-ask/mcp-deny hooks | Present | **Present too** — built in the shared config before the branch |
| Sub-agent composition | Same `GY` rule over the host-loop universe | Same `GY` rule over a Bash-inclusive universe → VM-loop sub-agents can bind literal Bash (inherit or by name) |
| Sub-agent prompt append | `subagent_env_hl` text | `subagent_env_vm` text |
| `additionalDirectories` | Host connected-folder paths | `/sessions/<id>/mnt/<name>` guest paths |

## Stream observability

**`task_started` carries the resolved sub-agent type on the wire**, a sibling `type:"system"` channel to the per-`tool_use` envelope Ch32/L118 pinned:

```js
r0({type:"system",subtype:"task_started",task_id:e.id,tool_use_id:e.toolUseId,description:e.description,
    subagent_type:"agentType"in e?e.agentType:void 0,task_type:e.type,workflow_name:...,prompt:...})
```

A stream consumer can read exact resolved agent types — including the general-purpose fallback of Lesson 121 — without parsing dispatch inputs. Sibling subtypes in the same emitter family: `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`, `thinking_tokens`.

**The on-wire `toolUseResult` envelope carries more than the completion object.** The Agent-dispatch completion object is `{agentId, agentType, content, resolvedModel, totalDurationMs, totalTokens, totalToolUseCount, usage, toolStats}` (zod `bcd`), but the wrapper on the paired user message's `toolUseResult` field carries two more fields, confirmed against production audit logs — exactly: `[agentId, agentType, content, prompt, resolvedModel, status, toolStats, totalDurationMs, totalTokens, totalToolUseCount, usage]`. `status` and `prompt` are wrapper-level additions a completion-object-only grep would miss. `agent_progress` progress messages also carry `resolvedModel` — so the model a sub-agent actually ran on is wire-observable post-hoc; read `toolUseResult.resolvedModel`, not the dispatching assistant message's `model`.

**`permission_denied` is native wire-level denial attribution — pre-ask denials only.** On a deny the agent emits `{type:"system",subtype:"permission_denied",tool_name,tool_use_id,agent_id:it.agentId,decision_reason_type:Dr.decisionReason?.type,decision_reason:WVr(Dr.decisionReason),message}`, whose schema documents `agent_id` as *"Subagent ID when the denied tool call originated inside a subagent. Mirrors can_use_tool for host-side routing."* The emission is gated by `IQo(e){return e.decideLocation==="pre-ask"}` — verified identically present in the in-VM ELF 2.1.205 (2 occurrences), so this is not a host-only artifact. **Scope**: this fires for automatic rule/mode/classifier denials only — **not** for interactive `can_use_tool` asks answered deny by the host, and **not** for PreToolUse-hook denials (hook denies never reach `canUseTool`; they surface as `is_error` tool_results). It carries no `tool_input` path. Consequence for Cowork: the host-loop **path-gate hook** (Lesson 122) never produces `permission_denied` — this channel corroborates pre-ask denials, never replaces path-denial observability. The `can_use_tool` control request itself carries `decision_reason`/`decision_reason_type` (*"Structured discriminator for why auto-mode escalated..."*) — the exact field the host-loop rewriter keys on.

## ADDENDUM (2026-08-13) — the full `sessionType` enum, and a new sticky-cached gate that excludes two of its members

First-party against Claude.app (Desktop) `app.asar` **1.28929.0**. This chapter's Deltas table above
discriminates host-loop from VM-loop, and Lesson 125 (Ch36) already keys a structural argument on
`sessionType==="ccd"` vs `"cowork"`/`"cowork-remote"` — but no lesson anywhere in the skill enumerates
the type itself. Harvested from every `sessionType===` comparison site across the asar, the full set is:

**`agent`, `ccd`, `chat`, `cowork`, `dispatch_child`, `radar`, `scheduled`.**

Five of these already appear somewhere in the skill (`ccd` — Ch36/L125; `cowork`/`cowork-remote` — Ch36/L126;
`chat`/`agent`/`scheduled` — scattered spawn-env and IPC references). **`radar` and `dispatch_child` have
zero coverage anywhere in the skill** — neither has ever been named in a lesson. Anyone extending
Ch36/L125's `"ccd"`-only structural argument, or reasoning about session-type-gated surface generally,
should treat this as the reference enum going forward and re-check any future `sessionType===` claim
against the full seven, not just the ones already documented.

**A new gate rides the same sticky-cache shape as this lesson's `built-*` pattern, and it's session-type
excluded.** Read two lines below the `frameArtifactsTurnEnabled` site quoted for context:

```js
P  = N ? (g?.builtTools===void 0 ? c.Ht(`2051942385`) : N.cicCanUseToolEnabled ?? !1) : !1
ue = N ? (g?.builtTools===void 0 ? (i.sessionType!==`radar` && i.sessionType!==`chat` && c.Ht(`2486083521`))
                                 : N.cuCanUseToolEnabled ?? !1) : !1
```

`2486083521` = `cuCanUseToolEnabled` (Computer Use) — **on/force** in the 2026-08-13 fcache (254
features). It follows the identical per-turn evaluate-once/cache-on-session/`?? !1`-fallback shape as
`frameArtifactsTurnEnabled` and `cicCanUseToolEnabled` (both new gates from the same 1.28929.0 pass) and
this lesson's own model/ToolSearch resolution chains — a third confirmed instance of that mechanism,
not a one-off. Distinct from the two: it is **explicitly excluded for `radar` and `chat` sessions**
before the gate is even read — the only one of the three with a session-type carve-out baked into the
predicate itself. Full mechanism, plus the sibling `frameArtifactsTurnEnabled`/`cicCanUseToolEnabled`
gates and the fail-closed default they share, at Ch38/L148.

## Methodology

**(a) The fcache is no longer raw JSON.** It is a container with magic `CLF\x01\x00` + 3 bytes + a gzip stream starting at byte 8 (24,863 bytes on disk → 86,779 decompressed in this capture; 207 gates). Decode with `tail -c +9 fcache | gunzip`. Raw `grep`/`strings` — the technique this skill used for every capture through v2.26.0 — **no longer works and will falsely report gates as absent.**

**(b) Proving an input field is absent requires full JSON parsing, never a prefix/substring window.** The type-less-fallback investigation (Lesson 121) went through exactly this correction cycle: a substring grep on `audit.jsonl` missed genuine type-less dispatches because `subagent_type` can trail a long `prompt` field, and a single cited example turned out on full-object inspection to be an *explicit* `general-purpose` call, not a fallback. Resolved-type sightings — a message's own `subagent_type`, `task_description`, or `task_started.subagent_type` — can never distinguish "explicitly typed" from "fell back to the default," because both produce an identical resolved-type signal downstream. Only the dispatch tool_use's own `input` object, parsed in full, settles the question.

---

## Identifier table

| Identifier | Kind | Artifact | Effect |
|---|---|---|---|
| `GY(agentDef, availableTools, isAsync, skipBaseFilter, isTeammate, agentDepth)` | fn | host bundle | The six-step tool-composition algorithm (Lesson 121) |
| `Pst`/`uwp` | fns | host bundle | Frontmatter `tools:` normalization; `"*"` collapses to inherit-all |
| `rly` | fn | host bundle | Base subagent filter; MCP tools exempt from every exclusion (`qI`) |
| `sZe` / `MMr` | sets | host bundle | Never-available-to-subagents set / async-subagent whitelist |
| `NMr` (host) / `BLr` (VM) | const = 5 | host bundle / VM ELF | Subagent nesting depth cap, both loops |
| `G5e` | agent def | host bundle | Type-less `subagent_type` fallback: `general-purpose`, `tools:["*"]` |
| `CQg()` | fn, default 10 | host bundle | `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` — the only real fan-out bound (queues, never refuses) |
| `mfo={small:5,medium:15,large:50}` | data | host bundle | `workflowSize` — prompt guidance only, no enforcement |
| `HOST_LOOP_SAFE_BUILTIN_TOOLS` (`h5e`) / `HOST_LOOP_EXCLUDED_BUILTIN_TOOLS` (`p5e`) | exported consts | asar `index.chunk-zFJ_MSb3.js` | Host-loop tool narrow/exclude sets (renamed from Ch24/L107's `PNt`/`gre`) |
| `toolAliases:{Bash:mcp__workspace__bash, WebFetch:mcp__workspace__web_fetch}` | SDK option | asar `index.chunk-CS-g0Skn.js` | First-class single-hop alias resolution (`rc()`), supersedes `BDt`/`QDt` |
| `WORKSPACE_ALLOWED_TOOLS=[mcp__workspace__bash]` (`w5e`) | const | asar | Host-loop pre-approves bash only, not web_fetch |
| `xe()` | fn | asar `index.chunk-CS-g0Skn.js` | `/sessions/...` deny (not translate) for path-gated file tools |
| `qt()` | fn | asar | Mutating-tool read-only-root denial (uploads/spooled/plugin) |
| `getStorageDir`/`sessionDirPaths` | fns | asar | Resolves host outputs dir = sub-agent `cwd` |
| `mapVMPathToHostPath`/`deepTranslateVMPaths` | fns | asar `index.chunk-K6-cmJAJ.js` | Outbound-only path translation; never applied to file-tool inputs |
| `resolveWorkspaceMountMode` | fn | asar `index.chunk-K6-cmJAJ.js` | rw→rwd delete-approval mount logic |
| `zo` (`buildSubagentEnvironmentPrompt`) | fn | asar `index.chunk-CCRuCFON.js` | Generates `subagent_env_hl`/`subagent_env_vm` |
| `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT` / `YRp()` | env var / fn | asar + host bundle | Gates append consumption; `YRp` self-set fires only on the hidden CLI flag path, not `initialize` |
| `Fae`/`JYu` | fns | host bundle | Model resolution chain: env → tool param → frontmatter → inherit |
| `getDefaultSubagentModel`/YukonSilverConfig | IPC + fn | asar | Conditional `CLAUDE_CODE_SUBAGENT_MODEL` injection, `"inherit"` sentinel |
| `IMr()`/`M4()`/`Z0s()` | fns | host bundle | ToolSearch mode resolution; `"standard"` = disabled |
| `Pm()`/`jKe()`/`FM()` | fns | asar `index.chunk-zFJ_MSb3.js` | Host-loop vs VM-loop decision function (successor of L107's `f_()`) |
| `uOt` (`hardcodedMainGrowthBookFeatures`) | data | asar | Custom-3p gate table force-ONing `1143815894` + `2307090146` (amends Ch23/L106) |
| `task_started`/`toolUseResult` envelope/`permission_denied` | stream messages | both agent bundles | Sub-agent observability beyond Ch32/L118's per-`tool_use` contract |
| `IQo()` | fn | host bundle + VM ELF | `permission_denied` emission gate: `decideLocation==="pre-ask"` only |
| `sessionType` enum: `agent`,`ccd`,`chat`,`cowork`,`dispatch_child`,`radar`,`scheduled` | data | asar 1.28929.0 | Full set harvested from `sessionType===` sites (2026-08-13); `radar`/`dispatch_child` uncovered elsewhere in the skill |
| `2486083521` (`cuCanUseToolEnabled`) | gate id, on/force | asar 1.28929.0 | Computer Use permission-mode gate; sticky per-turn cached like `frameArtifactsTurnEnabled`/`cicCanUseToolEnabled`; excluded for `radar`/`chat` sessions (Ch38/L148) |

## What this means for skill and agent authors

- **Pin `subagent_type:` literally in every dispatch.** Omitting it does not fail closed — it silently grants `tools:["*"]` via the `general-purpose` fallback, and this fires routinely in real traffic (113/509 dispatches in this machine's own audit corpus). A skill that assumes its sub-agents are scoped down should never rely on "I didn't specify a type" as scoping.
- **"Shell-free sub-agent" is a real, assertable property — but only when the agent declares an explicit `tools:` list.** Workspace/bash tools are never auto-injected; a runtime `Bash` call alias-resolves to `mcp__workspace__bash`, which then simply isn't in the bound set and fails. The canonical assertion is **absence of `mcp__workspace__bash` (host-loop) and `Bash` (VM-loop)** from the composed toolset — checkable from the dossier's Q1 algorithm or from `task_started.subagent_type` plus the agent definition's own `tools:` frontmatter. For wildcard or omitted `tools:`, the property does not hold by construction.
- **Write cwd-relative, never `/sessions/...`, from any file tool — main thread or sub-agent.** (This rule is about the **file tools**. `mcp__workspace__bash` is the opposite case: it starts at the session root and needs the absolute `/sessions/<id>/mnt/outputs/` form — Ch44/L164.) The agent's `cwd` already *is* the session outputs directory in host-loop; `artifacts/report.md` is both correct and the form real production traffic actually uses. A `/sessions/<id>/mnt/outputs/...` path is denied deterministically, every time, regardless of which agent constructs it — it is never a race or a namespace flip, so a skill or script that resolves an "artifacts root" should return the agent's own cwd, not a VM-side path.
- **Plugin agents lose more than non-plugin agents.** `permissionMode`, `hooks`, and `mcpServers` are all discarded from plugin-shipped `.claude/agents/`-style definitions with a warning — the extra-tool `mcpServers:` channel (Lesson 121, step 6) only works for non-plugin agent definitions.
- **A sub-agent's plugin-reference reads work via prompt pre-resolution, not env expansion.** `${CLAUDE_PLUGIN_ROOT}` is baked into the plugin agent's system prompt text at definition-load time; it is never expanded inside a Bash command or a file-tool path argument at call time.
- **Don't build resume logic around Task.** Detect the capability (presence of `SendMessage` in the tool list, per Ch29/L115) rather than the product name; in Cowork the only continuation primitives are redo-dispatch and repair-dispatch, plus the new session-level (not sub-agent-level) `mcp__dispatch__send_message`.
- **For stream-based observability, read `task_started.subagent_type` and `toolUseResult.resolvedModel`/`status`/`prompt`** rather than trying to infer sub-agent identity or model from the dispatching assistant message — those fields are wire-carried specifically for this purpose. Treat `permission_denied` as a corroborating signal for automatic pre-ask denials only, never as a complete path-denial log — the host-loop path-gate hook never emits it.

**Cross-references.** Ch17/L89 + the v2.25.0 lesson (`${CLAUDE_PLUGIN_ROOT}` host-loop vs VM-loop resolution — Lesson 122 confirms file tools never expand the token regardless of loop) · Ch20 (host-loop/VM-loop framing — Lesson 124's `Pm()` is the successor of that chapter's `f_()`) · Ch23/L106 (cli_plugin credential broker — amended by Lesson 124's custom-3p `uOt` finding) · Ch24/L107 (host-loop tool partition, forced-ask hook set — symbols renamed and the set grew, Lesson 121) · Ch25/L108 (gate catalog — several gate values re-confirmed unchanged, Lesson 124) · Ch29/L115 (Task one-shot, `SendMessage` resume, Cowork severing — re-verified with two refinements, Lesson 124) · Ch31/L117 (third-artifact-class methodology — extended here to the Desktop-managed host Mach-O) · Ch32/L118 (per-`tool_use` stream contract — Lesson 124 adds the sibling `task_started`/`toolUseResult`/`permission_denied` channels) · Ch36/L125 (2026-08-13 addendum — the full `sessionType` enum this chapter now records supersets Ch36's `"ccd"`-only structural argument; that argument still holds, `radar`/`dispatch_child` are simply outside its scope) · Ch38/L148 (the `built-*` sticky-cache mechanism generalized, with `cuCanUseToolEnabled`'s session-type exclusion as a concrete instance).
