Updated: 2026-07-24 | Source: Multi-artifact first-party, prompted by the `claude-cowork-headless-emulator` project's `docs/internal/desktop-1.24012.0-unmodeled-surfaces-2026-07-21.md` (the recurring lead-source) then independently re-derived against THIS installation's own artifacts before any claim was written. Artifacts: host CLI bundles **2.1.215 / 2.1.216 / 2.1.217** (extracted via `extract-bundle.sh`, greppable) + the Desktop-managed host agent Mach-O **2.1.217** (`~/Library/Application Support/Claude/claude-code/2.1.217/…/claude`, confirmed byte-identical string-tables to the host CLI for the tool surface) + Desktop `app.asar` **1.24012.1** (live) diffed against **1.22209.0** (Ch36 baseline; both extracted with `@electron/asar` v4.2.1, `rg` over `.vite/build/*.js`) + the live GrowthBook `fcache` (2026-07-22 **07:48 boot snapshot**, gzip-wrapped — `tail -c +9 fcache | gunzip`, per Ch35 methodology) + an on-disk `audit.jsonl` corpus from **10+ real Cowork sessions, agent 2.1.165 → 2.1.209** (`local-agent-mode-sessions/**/audit.jsonl` — the load-bearing `system/init` `tools`-array ground truth) + Desktop `main.log`/`cowork_vm_node.log`. **Tier discipline:** L129, L130, L131 are all first-party verified this session (L131's asar diff was run 2026-07-22; every emulator-relayed claim re-derived). L132 is a **flagged lead / negative observation** — a single fresh 1.24012.1 session left no host-side transcript; the host-loop→VM-loop inference is explicitly unconfirmed. The `fcache` is a boot snapshot, so gate on/off states are that-capture, not per-session live reads.

**2026-07-24 addendum pass** (three `### ADDENDUM` blocks below, under L129's ground-truth and gating sections and L131's `allowedTools` section): prompted by the emulator project's `docs/internal/2026-07-24-a2-sdk-mcp-discovery-confirmation.md`, then re-derived first-party against the same `app.asar` **1.24012.1** plus two *upgraded* evidence bases — the **full 427-file `audit.jsonl` corpus (1678 `system/init` records, agent 2.1.64 → 2.1.217**, vs the original pass's 10+ sessions / 2.1.165–2.1.209) and a **fresh gzip-wrapped `fcache` decode (2026-07-24 11:38)**. Net: the emulator doc's inventory, gate pair, `isEnabled` predicates, schemas and envelopes all **confirmed**; it **misses a 5th server** (`cowork-onboarding`, gate `2114777685` force-ON); its 4-server "12 tools" is really **13 across 5**; its version-gating recommendation is **unvalidated by this corpus** (no within-version splits); and L129's own stickiness parenthetical is **corrected** (a model switch re-reads the gates). Full verbatim schemas and output envelopes live in the state layer (`references/state/plugins-skills-hooks.md`), not inlined here.

**Methodology trap hit and recorded this pass:** extracted-asar chunks live under `.vite/build/` — a **dot-directory**, which `rg` skips by default. `rg -g '*.js' <pattern> .` from the extraction root returned **zero hits for strings that are demonstrably present**, briefly producing a false "gate absent from asar" reading. Same failure class as the gzip-wrapped-fcache trap (Ch35/L124). Always `cd` into `.vite/build` or pass `--hidden`, and run a **positive control** (grep a string you know is there) before writing any "absent from artifact X" claim.

# Chapter 37: Skill/Plugin Discovery Tools, VCS SDK Events & Session Containment

---

## TABLE OF CONTENTS

129. [Lesson 129 — Skill/Plugin Discovery: Native Agent Tools vs Desktop SDK-MCP, and the Disk Ground Truth](#lesson-129----skillplugin-discovery-native-agent-tools-vs-desktop-sdk-mcp)
130. [Lesson 130 — VCS SDK Events: Emit Floor 2.1.216, Git-Operation-Driven, Ungated Agent-Side](#lesson-130----vcs-sdk-events)
131. [Lesson 131 — Desktop 1.22209.0 → 1.24012.1 asar Delta](#lesson-131----desktop-1222090--1240121-asar-delta)
132. [Lesson 132 — LEAD: 1.24012.1 May Move Cowork Session State Off the Host](#lesson-132----lead-1240121-may-move-cowork-session-state-off-the-host)

---

# LESSON 129 — SKILL/PLUGIN DISCOVERY: NATIVE AGENT TOOLS vs DESKTOP SDK-MCP

**The tools a real Cowork model actually sees for skill/plugin discovery are Desktop's SDK-MCP servers (`mcp__skills__list_skills`/`suggest_skills`, `mcp__plugins__*`), delivered over the control protocol — NOT the native agent tools (`ListSkills`/`SearchSkills`/`SuggestSkills`) compiled into the CLI binary. The two are separate components that share a concept. A model self-report to the contrary is confabulation; the `system/init` record's `tools` array is authoritative.**

## Two components, one concept

The CLI agent binary carries **native** discovery tools; the Desktop asar carries **SDK-MCP** discovery tools. They are unrelated code paths that happen to name the same capability.

- **Native (agent binary, CamelCase):** six tools via two factories (`hRs`/`mRs` list `ListSkills`/`ListPlugins`; the search/suggest twins `SearchSkills`/`SearchPlugins`, `SuggestSkills`/`SuggestPluginInstall`). All `shouldDefer:!0`; all fetch from claude.ai org endpoints (`/api/oauth/organizations/:orgUUID/skills/{list-skills,search}`, `auth:"teleport-org"`). String counts in 2.1.217: `ListSkills` 9 / `SearchSkills` 4 / `SuggestSkills` 7; **`mcp__skills__` = 0** in the binary.
- **SDK-MCP (Desktop asar, snake_case):** `mcp__skills__list_skills`/`suggest_skills`, `mcp__plugins__*`, delivered as SDK MCP servers over the control protocol (`createSdkMcpServer` → `sdkMcpServers` in `initialize`, JSON-RPC tunneled as `control_request{subtype:"mcp_message"}` — the exact channel Ch24/L107 documents). String counts: CamelCase natives **= 0** in the asar.

The two are not the same tool under two names — they are two implementations, and only one reaches the model.

## The `vLt`/`Vne` predicate was reshaped mid-series

The native tools' `isEnabled` predicate changed name and shape across the 2.1.215→2.1.217 window (the version split was caught by the emulator project; confirmed here):

| | `function Vne(` | `function vLt(` |
|---|---|---|
| CLI 2.1.215 | 1 | 0 |
| CLI 2.1.216 | 1 (both — transition) | 1 |
| CLI 2.1.217 | 0 | 1 |

- **2.1.215** (`Vne`): `return Wt(process.env.CLAUDE_CODE_REMOTE)&&ru()` — terminates there, no fallback. `CLAUDE_CODE_REMOTE` is **necessary**.
- **2.1.217** (`vLt`): `if(Lz("hipaa"))return!1; if(Rut())return!0; return LZe()&&qc()&&(ndd?.()??!1)` where `Rut()=Kt(process.env.CLAUDE_CODE_REMOTE)&&qc()` — `CLAUDE_CODE_REMOTE` is **sufficient, not necessary**; the fallback branch can enable without it.
  - `Kt` = truthiness parser (`["1","true","yes","on"]`), so polarity is set-truthy = enabled.
  - `LZe()=vth()&&!CLAUDE_CODE_CHILD_SESSION`; `vth()` tests entrypoint ∈ `ekl={"claude-desktop","claude-desktop-3p","local-agent"}` (extends Ch30/L116's `c2u`/`u2u`/`d2u` taxonomy — `local-agent` is Cowork's host-side entrypoint).
  - `qc()=An()==="firstParty"`.

**Methodology note recorded from the exchange:** the emulator's first read of `Vne` quoted only `Rut`'s body (an ellipsis elided the two later branches), which inverted the polarity conclusion. Resolve a minified predicate to its **terminal branches** before drawing a conclusion; never quote one with an ellipsis.

## `tengu_saddle_lantern` is the master switch, not just a deferral gate

One cached feature read (`gcr`, key `pI_="tengu_saddle_lantern"`) drives **three** consumers off two readers:

- `fI_` → `vLt`'s enable branch (`ndd`) — governs whether the **whole 6-tool native family** exists;
- `pdd` → `SuggestSkills.shouldDefer` (`get shouldDefer(){return !pdd()}`) — gate on ⇒ non-deferred / always-loaded;
- `pdd` → `SuggestSkills.prompt` (`async()=>pdd()? <proactive text> : <reactive text>`) — a **branching prompt body**.

The two readers differ deliberately: `fI_` refuses to cache when `source==="fallback"`; `pdd` caches unconditionally. Default **false** (absent from this machine's `~/.claude/statsig/` — never evaluated on a non-Cowork CLI session).

## THE LOAD-BEARING FINDING — disk ground truth

Every real Cowork session writes a `system/init` record to `audit.jsonl` carrying the **rendered `tools` array** — ground truth, not a model self-report. Across **10+ host-loop sessions, agent 2.1.165 → 2.1.209**, unanimous:

- `mcp__skills__list_skills` + `mcp__skills__suggest_skills` (and `mcp__plugins__list_plugins`) — **present in every session**;
- native CamelCase `ListSkills`/`SearchSkills`/`SuggestSkills` — **absent from every session**;
- `cwd` in the record = a host path (`/Users/…/local-agent-mode-sessions/…`) → host-loop confirmed **from the transcript itself**, not just the gate;
- rendered tool count per session: **133–370** (varies with the number of connected MCP servers). For comparison the emulator harness models ~17–20 — a real, separate divergence in the exact domain a skill harness exists to test.

The one exception in the corpus was a `local_ditto_*` sub-agent (narrowed toolset, and one instance with `cwd:/sessions/…` = VM-side) — expected, and it does not carry the skills servers.

### ADDENDUM (2026-07-24) — full-corpus sweep: the surface is 13 tools across 5 servers

The original pass sampled 10+ sessions. A **full sweep of all 427 `audit.jsonl` files (1678 `system/init` records, agent 2.1.64 → 2.1.217)** re-confirms every claim above (native CamelCase: **0 occurrences, all 427 files**) and enumerates the complete surface. It is **13 model-facing tools across 5 SDK-MCP servers**, not the 4-server set L129 originally sketched:

| Server | Tools | Occurrences in `init.tools` |
|---|---|---|
| `skills` | `list_skills`, `suggest_skills` | 1180 / 1082 |
| `plugins` | `list_plugins`, `search_plugins`, `suggest_plugin_install` | 1165 / 1698 / 1688 |
| `mcp-registry` | `list_connectors`, `search_mcp_registry`, `suggest_connectors` | 1175 / 1693 / 1688 |
| `scheduled-tasks` | `create_`, `list_`, `update_`, `delete_scheduled_task` | 1727 / 1691 / 1689 / **66** |
| **`cowork-onboarding`** (NEW to this skill) | `show_onboarding_role_picker` | **1264** |

`cowork-onboarding` was missed by both the original L129 pass and the emulator project's own confirmation doc. It is real and renders: `serverName: qr="cowork-onboarding"`, gated `sessionType==="cowork" && isFeatureEnabled("2114777685")` — and that gate is **`on`/`force`** live (`ruleId fr_mnj0h9xm`, 2026-07-24 fcache). Its two schema properties (`role`, `dismissed`) are both marked *"Populated by the permission flow… Do not set this yourself"* — i.e. the model calls it with no args and the answer arrives through the permission channel.

### Version drift — and why it must NOT be modeled as version-gated

Distinct discovery tools per `claude_code_version` across the sweep:

| Agent version | Tools | Change |
|---|---|---|
| 2.1.64 – 2.1.87 | 7 | pre-`mcp-registry` floor |
| 2.1.92 – 2.1.101 | 8 | + `cowork-onboarding` |
| 2.1.111 – 2.1.119 | 10 | |
| 2.1.121 | 11 | |
| 2.1.128 | 12 | + `suggest_skills` |
| **2.1.138** | **11** | **`suggest_skills` absent — non-monotonic** |
| 2.1.142 – 2.1.202 | 12 | |
| 2.1.205 – 2.1.217 | 13 | + `delete_scheduled_task` |

`delete_scheduled_task` first appears at exactly **2.1.205** (66 occurrences vs ~1690 for its three siblings — a late arrival, consistent across versions).

**The load-bearing caveat:** the 2.1.138 dip is **not** evidence of a version boundary. Checking `suggest_skills` presence per version shows **zero within-version splits** — every one of the 30 versions is all-or-nothing across its inits. So on this account the gate never varied, and this corpus therefore **cannot distinguish version-gating from gate-gating** for `suggest_skills`. The 2.1.138 anomaly is n=5 and is equally explained by a transient `245679952` flip. A harness that hard-codes a version→tool-count table (as the emulator doc's §2 recommends) would be encoding an unvalidated inference; `suggest_skills` in particular is **gate**-driven (see below), and its presence must be modeled that way.

## This inverts the "model sees native tools" claim

A real Cowork session's model self-report ("Deferred tools `ListSkills`/`SearchSkills`/`SuggestSkills`, no `mcp__skills__*` server") — which an earlier framing took as ground truth — is **confabulation**. The on-disk `init.tools` shows the exact opposite. **Tool-name self-reports are unreliable; the `init` record is authoritative. Key any tool-surface question on the `system/init` `tools` array, never on what the agent says it has.**

## The `CLAUDE_CODE_REMOTE`/`vLt` puzzle is moot for the model surface

The native tools (gated by `vLt`, i.e. `CLAUDE_CODE_REMOTE`) simply **never render** in real Cowork — their absence needs no explanation. The tools the model uses arrive via SDK-MCP, which never touches `vLt`. So `Wt(CLAUDE_CODE_REMOTE)` polarity is irrelevant to what reaches the model. Even if the `vLt` fallback fired (requires `tengu_saddle_lantern` on, default off), the native tools would be **additive** to the SDK-MCP pair — a state no real session has ever shown.

## Gating & live state

The SDK-MCP `skills` server appears iff `sessionType==="cowork"` (absent in chat/`ccd`), `skillsEnabled !== false`, and `suggestSkillsEnabled === true` — the last from gate **`245679952`, live `on/force`** on this machine (2026-07-22 fcache; re-confirmed `on/force`, `ruleId fr_movyeduu`, in a fresh 2026-07-24 decode). When `suggestSkillsEnabled` is false the server still ships but `suggest_skills` is filtered out and scrubbed from `list_skills`'s description, so `list_skills` renders independently. `1598976391` (`proactiveSkillSuggestEnabled`, NEW — the SDK-MCP twin of the agent-side `tengu_saddle_lantern` proactive mode) is `off/default`, so the proactive `trigger:["user_asked","proactive"]` plumbing is inert today. `3246569822` (`canSaveSkill`) `off/default`.

### ADDENDUM (2026-07-24) — verbatim `isEnabled` predicates, the three-state builder, and a stickiness CORRECTION

**Registry and builder.** Servers are plain objects `{serverName, tools, handleToolCall, isEnabled, getDynamicTools?}` (the 5th field is easy to miss) collected in array `si`, filtered per session by async builder `oi(model, suggestSkillsEnabled, sessionType, proactiveSkillSuggestEnabled)`, managed by class `InternalMcpServerManager` (it `logger.debug`s `Server ${serverName} not enabled, skipping`). The `serverName` constants: `$e="mcp-registry"`, `Fr="plugins"`, `kt="skills"`, `qr="cowork-onboarding"`, `jr="dev-debug"`, plus `ccd_session_mgmt`/`ccd_directory`/`ccd_session`.

**`isEnabled` predicates, verbatim:**

| Server | Predicate |
|---|---|
| `skills` | `t=>t.sessionType==="cowork"&&t.skillsEnabled!==!1` |
| `plugins` | `t=>t.sessionType==="cowork"&&t.pluginsEnabled!==!1` |
| `cowork-onboarding` | `t=>t.sessionType==="cowork"&&n.isFeatureEnabled("2114777685")` |
| `mcp-registry` | `()=>n.getDeploymentMode().type!=="3p"` |

So `skills`/`plugins` are scoped to the **`cowork` lane**, not to a protocol tier — a harness must declare them only there.

**Three states for `suggest_skills`, as literal branches** inside `oi`: `if(a.serverName===kt){ if(!e) return Zo(); if(s) return ti(); }` → otherwise the base object `we`.

- `Zo()` = **gate off**: `{...we, tools: we.tools.filter(t=>t.name!=="suggest_skills").map(t=>t.name==="list_skills"?{...t, description: t.description.replace(" — fall back to suggest_skills","")…})}` — strips the tool *and* rewrites `list_skills`'s description.
- `we` = **base**: `suggest_skills` inputSchema is `{keywords, context_label}`, `required:[]` — **no `trigger` property at all**.
- `ti()` = **proactive**: `{...we, tools: …name==="suggest_skills" ? {...t, description: ei, inputSchema:{...t.inputSchema, properties:{...t.inputSchema.properties, trigger: Lr}}} : t}` — swaps the description to `ei` and **injects** `trigger`. `required` stays `[]`.

`Lr` is a shared schema constant `{type:"string", enum:["user_asked","proactive"], description:"How this started…"}`, normalized by `Ur(t)` (returns the value only if it is one of the two literals, else `undefined`). `search_plugins` references the same `Lr` **ungated** — so `trigger` is permanently present there but conditional on `skills`.

**CORRECTION to the stickiness claim above.** "Flags are sticky per session (a built system prompt is not rebuilt mid-session)" is directionally right but wrong in two ways that matter. The real code:

```js
ht = ft(K,U)
pt = ht ? (pe?.suggestSkillsEnabled ?? !1) : o.isFeatureEnabled("245679952");  pe && (pe.suggestSkillsEnabled = pt)
Se = ht ? (pe?.proactiveSkillSuggestEnabled ?? !1) : pt && o.isFeatureEnabled("1598976391");  pe && (pe.proactiveSkillSuggestEnabled = Se)
```

with `function ft(r,e){return r?.builtSystemPrompt!==void 0 && (e===void 0 || r.builtSystemPromptModel===e)}`.

1. Stickiness is keyed to the **built-system-prompt cache**, and `ft`'s second conjunct compares `builtSystemPromptModel` to the current model — so **a mid-session model switch invalidates it and the gates are re-read**. "Not rebuilt mid-session" is false in that case.
2. The sticky-branch fallback is `?? !1` — **false, not the gate value**. A session that has a `builtSystemPrompt` but never persisted the flags reads them as off, *not* as whatever GrowthBook says.

Also confirmed here: `1598976391` is only consulted when the first gate passed (`pt && …`), so the two gates are a conjunction, never independent.

---

# LESSON 130 — VCS SDK EVENTS

**Two new `type:"system"` subtypes — `code_change_published` and `vcs_state_changed` — turn an agent's git activity into a typed telemetry stream. They EMIT from agent 2.1.216 onward (not 2.1.217), are git-operation-driven (NOT per-run), and are ungated on the agent side. Desktop consumption is separately version-floored at 2.1.217 plus a dark gate, producing a one-version blind window. Framing them as merely "an SDK-native replacement for `gh pr create` regex-scraping" understates them: they are the git-state observability primitive for a multi-agent, multi-environment coding fleet (see "Why this exists" below).**

## Emit floor is 2.1.216, not 2.1.217

String counts for `code_change_published`/`vcs_state_changed`: **0 at 2.1.215, 12/12 at both 2.1.216 and 2.1.217.** The agent *emits* from 2.1.216. This corrects a tripwire that keyed on `agentVersion ≥ 2.1.217` — that floor is correct for Desktop *consumption* (below), wrong for *existence*.

## Agent-side emit is ungated

Gate `1311049725` and the capability string `cliSupportsVcsSdkEvents` are **absent from the CLI bundle entirely** — both are Desktop-side (consumption) constructs. No statsig check wraps either emitter. `cliSupportsVcsSdkEvents` is `isPinnedCliAtLeast("2.1.217")` — a host-side version *floor*, stricter than the agent's 2.1.216 emit capability. Net: a **one-version blind window** where a 2.1.216 agent emits and a paired Desktop still drops the events.

## Emission is git-operation-driven, NOT per-run

Neither event fires on an arbitrary turn — each is triggered by observing the corresponding VCS operation in Bash output:

- **`code_change_published`** — emitted by `izr(e)`, called only when a PR action is observed (`gh pr create` → `M("tengu_git_operation",{operation:"pr_create"})` → `if(tjg(e.prUrl))` github-URL prefix match → `UE({type:"system",subtype:"code_change_published",provider,url:e.prUrl,repo,identifier})`). No PR ⇒ no event. Non-github/malformed URLs are dropped.
- **`vcs_state_changed`** — emitted by `hlo(e)`, once per observed mutation: `if(e.commit)…push("commit"); if(e.push)…"push"; if(e.branch){merged→"merge",rebased→"rebase"}` then `for(let r of t) UE({type:"system",subtype:"vcs_state_changed",kind:r,cwd:Ct()})`. `kind ∈ {commit,push,merge,rebase}` is a strict enum **agent-side**; the host consumer's open-ended `"unknown"` default is the defensive counterpart. No commit/push/merge/rebase ⇒ no event.

**Consequence for anyone testing this (e.g. a harness):** an assertion that these degrade gracefully must run a **real git action** or it is a silent no-op — nothing gets emitted to observe. It is the "prompt must require the tool / empty `toolCounts`" trap one layer up.

## Full `type:"system"` subtype set (2.1.217)

`init`, `status`, `hook_started`, `hook_progress`, `hook_response`, `post_turn_summary`, `task_summary`, `background_tasks_changed`, **`code_change_published`**, **`vcs_state_changed`**, `commands_changed`, `elicitation_complete`, `files_persisted`, `mirror_error`, `model_refusal_fallback`, plus nested `bridge_state`. (Cross-check against the Ch23/L106 and Ch35/L124 stream-subtype inventories; the VCS pair is the only addition, nothing removed.)

## Consumer wiring (Desktop, first-party)

Both events flow into the same per-session PR tracker the old scraper fed:
`GitHubPrManager.bindPrFromUrl(sessionId, url, …, source)` takes a `source` tag
of either `"bash_output"` (the legacy `gh pr create` regex path) or
**`"vcs_sdk_event"`** (the new path), and on a successful bind emits
`{type:"git_state_changed", sessionId}`. That session event is what drives
per-agent PR-state tracking (Fleet view / dashboard, Ch21/L89, Ch33/L119). So
the VCS events are not a new consumer — they are a **more robust source** for an
existing one: the scraper only caught PRs opened via that exact command and saw
no commits/pushes/merges at all; the SDK events fire on the operation however it
happened.

## Why this exists — the Managed Agents fleet (mechanism → intent)

Scraping stdout is fine for a local terminal and unworkable the moment the agent
runs somewhere the supervisor cannot see the terminal — which is exactly where
Anthropic is going. Public timeline: **Claude Managed Agents** launched
2026-04-08 (cloud-hosted agents: sandboxed execution, checkpointing, credential
management, scoped permissions, end-to-end tracing), with self-hosted sandboxes
+ MCP tunnels following 2026-05-19 (execution on customer infra, **orchestration
on Anthropic's**). The beta header baked into the Desktop asar is literally
`managed-agents-2026-04-01` (180+ occurrences across three chunks, alongside
`/v1/environments`). That remote-executor / central-orchestrator topology is
precisely the one where stdout-scraping fails and a typed VCS event is required.

Three layers of intent, in descending confidence:

1. **Fleet observability (first-party + public).** A dashboard supervising many
   concurrent agents (Fleet view, claude.ai/code, cloud tasks, teleport L119,
   bridge sessions) needs "which agent opened which PR, what is its CI state, did
   it push" without a terminal. The VCS events make git activity a first-class,
   per-session signal for that.
2. **PR-as-unit-of-work for the platform (inference from strong evidence).**
   Managed Agents shipped an "Outcomes" capability (measurable success
   conditions); for a coding agent the canonical success signal is a PR
   opened/merged or code pushed — exactly `code_change_published`. The events
   being SDK-native (not Claude-Code-specific) means any Agent-SDK agent emits
   standardized git telemetry the orchestrator can gate workflows/outcomes on.
3. **Event-driven orchestration (directional).** Typed "PR published" / "pushed"
   events enable reactive handoffs (dev agent opens PR → reviewer agent → release
   agent merges) — the Fleet pattern, made first-party, composing with scheduled
   tasks/watchers (Ch26/L109) and the `agent_completed`/`agent_needs_input`
   notifications (L111).

**Roadmap signals in the binary (first-party):**

- **Multi-forge is scaffolded ahead of support.** `code_change_published`'s
  parser classifies `provider` as github / github-enterprise / gitlab / bitbucket,
  yet today it only *binds* well-formed github.com PR URLs (others are parsed then
  dropped). The taxonomy predates the support — GitLab/Bitbucket PR tracking is
  coming.
- **The vocabulary is built to grow.** `vcs_state_changed`'s `kind` is a strict
  enum agent-side but **open-ended on the consumer**, with an explicit "new kinds
  may be added — treat unknown as unknown" contract. More VCS event kinds are
  pre-committed.
- **Staged, decoupled rollout.** Decoupling the agent emit floor (2.1.216) from
  the Desktop consumption floor (2.1.217 + dark gate) is how a contract ships
  across independently-versioned executors and orchestrators — itself evidence
  this is cross-product infrastructure, not a local convenience.

**Net:** the endgame is autonomous, long-running, cloud-hosted coding agents
whose atomic unit of work is a pull request, orchestrated and observed centrally,
with git state as the spine of both the dashboard and the success/outcome model.
The `gh pr create` scraper was the local-first stopgap; the VCS SDK events are
the version that survives the move to the cloud. *(Confidence: layer 1 and the
roadmap signals are first-party binary; the Managed-Agents linkage and
"Outcomes keys on VCS state" are inference from the `managed-agents-2026-04-01`
beta-string match plus public capability descriptions — the orchestrator code is
not on this machine; layer 3 is directional.)*

---

# LESSON 131 — DESKTOP 1.22209.0 → 1.24012.1 asar DELTA

**A first-party diff of the two on-disk asars (extracted with `@electron/asar`, `rg` over `.vite/build/*.js`). Every emulator-relayed claim below was re-derived here; symbol-count deltas (OLD 1.22209.0 → NEW 1.24012.1) in parentheses.**

## The `allowedTools` spawn list — CONFIRMED, and PRE-EXISTING (not 1.24012.1 drift)

Present in both builds (`2→1`, a chunk-dedup artifact, not a removal). Verbatim shape:

```
allowedTools:["Task","Bash","Glob","Grep","Read","Edit","Write","NotebookEdit","WebFetch",
...o.TASK_TOOL_NAMES,"WebSearch","Skill","REPL","JavaScript","ToolSearch",
"mcp__mcp-registry__search_mcp_registry","mcp__mcp-registry__suggest_connectors",
"mcp__mcp-registry__list_connectors","mcp__plugins__search_plugins",
"mcp__plugins__suggest_plugin_install","mcp__plugins__list_plugins",
"mcp__skills__list_skills","mcp__skills__suggest_skills",
"mcp__scheduled-tasks__list_scheduled_tasks",...]
```

The nine `mcp__{mcp-registry,plugins,skills,scheduled-tasks}__*` tools are the SDK-server delivery channel, distinct from the built-in `tools:` array. **Caveat proven in L129: `allowedTools` ≠ the rendered tool list** — allowlist membership never proved a tool renders (`NotebookEdit`/`REPL`/`JavaScript` are allowlisted but were not rendered in live runs; Bash/WebFetch render as their `mcp__workspace__*` aliases at host-loop). The load-bearing evidence is the `sdkMcpServers` registration + the `<skills_instructions>` system-prompt instruction, not `allowedTools`.

### ADDENDUM (2026-07-24) — the 9-vs-13 delta is deliberate, and it is the mutating scheduled-task tools

L129's addendum establishes the rendered discovery surface as **13** tools. This list pre-approves **9**. The two numbers are not in tension and the delta is not arbitrary — the **4** rendered-but-not-pre-approved tools are:

| Rendered but absent from `allowedTools` | Why |
|---|---|
| `mcp__scheduled-tasks__create_scheduled_task` | mutating |
| `mcp__scheduled-tasks__update_scheduled_task` | mutating |
| `mcp__scheduled-tasks__delete_scheduled_task` | mutating (and 2.1.205+ only) |
| `mcp__cowork-onboarding__show_onboarding_role_picker` | answered *through* the permission flow by design |

Only the read-only `mcp__scheduled-tasks__list_scheduled_tasks` is pre-approved. This dovetails exactly with **Ch24/L107**: `MCP_CREATE_SCHEDULED_TASK` and `MCP_UPDATE_SCHEDULED_TASK` are two of the eight names in the Desktop `PreToolUse` forced-ask matcher. So the posture is coherent and intentional: **13 declared to the model, 9 pre-approved, 4 routed through a permission prompt.** The same 9 appear in a second, independent allow-list (`sl`, the host-loop spawn set alongside `mcp__workspace__bash`/`web_fetch` and the `mcp__cowork__*` family), so this is a consistent policy, not one site's quirk.

Corollary for anyone counting tools: **never infer the rendered surface from `allowedTools` in either direction.** It under-reports by 4 here, and L129 already showed it over-reports elsewhere.

## `getMcpSkillSources()` — dead code (`0→1`, NEW)

Single occurrence, a definition only: `getMcpSkillSources(){const e=[...this.localMcpManager.getSkillSources()];if(!n.isFeatureEnabled("278625510")…}`. Occurrence count = 1 ⇒ **zero callers ⇒ dead code**. The gate id `278625510` (`0→2`, NEW) is confirmed inline. The MCP-skills extension handshake string `io.modelcontextprotocol/skills` is also new (`0→1`). **A tripwire better than pinning the gate: watch for `getMcpSkillSources` occurrence count rising above 1.** LIVE NEGATIVE also confirmed this session: the boot MCP handshake in `main.log` advertises only `extensions:{"io.modelcontextprotocol/ui":…}`, never `…/skills` — independent wire-level corroboration the feature is dark.

## Bundled skill `morning` — REMOVED

Bundled skills ship at `resources/bundled-skills` under a `bundled:` scheme. The set went from OLD `{morning, schedule, setup-cowork}` → NEW `{schedule, setup-cowork}`; `"morning"` is gone and its `isEnabled` gate `3214976288` (`1→0`) with it. Bundled skills are modeled nowhere in this skill (nor in the emulator), so a real Cowork session's pre-installed skill set is not reproduced anywhere, and it just changed silently.

## `coworkTokens` — usage accounting (`0→2`, NEW)

A new `cowork*` config key. Shape: `{…, chatTokens:o.chat, coworkTokens:o.cowork, codeTokens:o.code}` inside a `{windowDays, generatedAtMs, turns…}` report. Desktop usage UI; no runtime behaviour reaching the agent. (Do not confuse with `ANTHROPIC_WORKSPACE_ID` (the L86 OIDC quad var) or Spaces ids.)

## `harnessCwd` — NEW (`0→5`) and a naming trap

Appears amid `harnessCwdGen`, `clearHarnessMoveState`, `pendingWorktreeMoveIds`, `worktreePath`/`worktreeName`. It is Anthropic's term for **where the CLI agent runtime sits after `EnterWorktree`/`ExitWorktree` moves** — nothing to do with any test "harness." Recorded so no future reader is misled by the name. (The emulator counted 21 occurrences; the `5` here is a chunking difference, both agree it is new.)

## OAuth-refresh gates (both `0→1`, NEW)

Both swap a refresher-object for a clear-cache-then-re-resolve path; live-lane auth only:

- `3705360580` (CCD): `isFeatureEnabled("3705360580")?(await n.expireForConfig(n.getCcdOauthConfig()), …readCc…)`.
- `1549258603` (SDK): `isFeatureEnabled("1549258603")?(await o.clearTokenCache(), i=await this.resolveSdkOauthToken(e))`.

## Gate-state correction from the live fcache

Four of the new gate ids — `278625510`, `1311049725` (L130), `1549258603`, `3705360580` — are **ABSENT from the fcache** (never evaluated), even though all four are newly *present in the asar*. Absent ≠ evaluated-and-off; "dark" conflates the two, and the precise state here is "present in code, unevaluated in this capture." `1598976391` (`0→1` in asar) evaluates `off/default`; `245679952` (`1→1`, pre-existing) `on/force`.

---

# LESSON 132 — LEAD: 1.24012.1 MAY MOVE COWORK SESSION STATE OFF THE HOST

**Status: negative observation plus an explicitly UNCONFIRMED inference. This ships as a flagged lead, not a confirmed mechanism (same discipline as Ch31/L117's VM-multiplexing inference).**

## What was observed (first-party)

A fresh folder-connected Cowork session started under **Desktop 1.24012.1 + staged agent 2.1.217** (connected folder `claude-lamore`; it ran an `echo` command successfully, shown in-UI):

- wrote **zero** host-side transcript — the newest write to **both** `local-agent-mode-sessions/**/audit.jsonl` and `claude-code-sessions/**` predated the session by hours-to-a-day;
- left **no** `claude-code/2.1.217` host agent process at any sampling;
- its probe string `hello-probe-2117` appears in **no** host file or log — only the VM and the UI;
- `cowork_vm_node.log` shows the in-VM SDK agent staged at **2.1.217, 07:51:14** ("VM already connected" / "Installing SDK claude-code-vm").
- `main.log`'s CliGovernor reported **"would evict 0 idle session(s), 0 effective"** across the window — the Desktop saw zero local CLI/agent sessions.

**Contrast:** the Jul-16 sessions (agent 2.1.202/209) in the same corpus were host-loop and DID write host-side `audit.jsonl` with a host `cwd` (that is exactly the corpus L129 rests on).

## Why the obvious explanation is wrong

A bare greeting ("hello") does not spawn the agent at all — the first probe produced no local footprint because a trivial turn requires no local tool (the "prompt must require the tool" trap). But even the **tool-requiring** `echo` probe left no host trace, which rules that out.

## What is NOT confirmed

Whether this is a genuine host-loop → VM-loop routing flip in 1.24012.x, or merely a host-loop transcript-path change. Evidence against a naive "gate flipped" read: the live fcache host-loop gate `1143815894` is still `true/force` — **but that is a 07:48 boot snapshot, not a live per-session read**, and org-policy `requireCoworkFullVmSandbox` (which overrides the gate per Ch24/L107's `f_()` decision) is not a boolean recoverable from the fcache. Note also that the in-VM SDK is staged for *every* Cowork session regardless of loop mode (bash-in-VM needs it), so `cowork_vm_node.log` alone does not decide loop mode.

## Why it matters (the payload of this lesson)

If 1.24012.x moves real Desktop sessions' transcripts into the VM, **the host-side `audit.jsonl` disk-recovery path that settled L129 goes dark on newer builds.** Future `init.tools` verification would then require live VM `rootfs.img` forensics (Ch31 method) — which needs the image at rest, impossible while a session is live. This is a **methodology tripwire for the next Desktop lesson**: confirm where a given build writes its transcript before assuming the L129 recovery path still works.

---

## Identifier table

| Identifier | Kind | Artifact | Effect |
|---|---|---|---|
| `ListSkills`/`SearchSkills`/`SuggestSkills` (+ `ListPlugins`/`SearchPlugins`/`SuggestPluginInstall`) | native tools | CLI 2.1.215–217 | Compiled-in discovery tools; gated by `vLt`, **never rendered in real Cowork** (L129) |
| `vLt` (2.1.217) / `Vne` (2.1.215) | isEnabled fn | CLI bundle | `CLAUDE_CODE_REMOTE` necessary at 2.1.215 → sufficient-not-necessary at 2.1.217 (fallback via `ekl` entrypoint + firstParty + `tengu_saddle_lantern`) |
| `tengu_saddle_lantern` (`pI_`) | feature flag | CLI bundle | One cached read drives native-family enable (`fI_`) + `SuggestSkills.shouldDefer` + branching prompt (`pdd`); default off |
| `ekl` = `{claude-desktop, claude-desktop-3p, local-agent}` | entrypoint set | CLI bundle | `vth()`/`LZe()` allowlist; extends Ch30/L116 taxonomy |
| `mcp__skills__list_skills`/`suggest_skills`, `mcp__plugins__*` | SDK-MCP tools | asar | The discovery tools the model **actually** sees, via `sdkMcpServers`/`mcp_message` (L129) |
| `system/init` `tools` array | stream record | `audit.jsonl` | Authoritative rendered tool list; beats any model self-report |
| `code_change_published` | control-subtype | CLI 2.1.216+ | PR-publish event (`izr`, github-URL prefix); SDK-native replacement for `gh pr create` scraping (L130) |
| `vcs_state_changed` | control-subtype | CLI 2.1.216+ | commit/push/merge/rebase event (`hlo`); strict `kind` enum agent-side |
| `cliSupportsVcsSdkEvents` = `isPinnedCliAtLeast("2.1.217")` | capability | asar only | Desktop consumption floor (one-version blind window vs the 2.1.216 emit floor) |
| `getMcpSkillSources` | fn | asar (NEW) | Dead code (1 occurrence, 0 callers); gate `278625510`; MCP-skills extension `io.modelcontextprotocol/skills` (L131) |
| `278625510` / `1311049725` / `1549258603` / `3705360580` | gate ids | asar (NEW) | MCP-skills ext / VCS-events consumption / SDK & CCD OAuth-refresh; all **absent from fcache** (unevaluated, not confirmed-off) |
| `1598976391` (`proactiveSkillSuggestEnabled`) / `245679952` (`suggestSkillsEnabled`) | gate ids | asar + fcache | proactive off/default; suggest on/force (L129) |
| `3214976288` | gate id | asar (REMOVED) | Was the `morning` bundled-skill `isEnabled`; skill removed this release (L131) |
| `coworkTokens` | config key | asar (NEW) | Usage accounting `{chatTokens,coworkTokens,codeTokens}`; Desktop UI only |
| `harnessCwd` / `clearHarnessMoveState` | fields | asar (NEW) | CLI runtime cwd after `EnterWorktree`/`ExitWorktree` — **not** a test "harness" (naming trap) |
| `1143815894` | gate id | fcache | Host-loop, `true/force` at 07:48 boot; L132 lead flags this as a boot snapshot, not a live per-session read |

## What this means for skill and agent authors

- **To reason about which skill-discovery tools a Cowork model has, read the `system/init` `tools` array — never the model's self-description.** The model confabulates tool names; the init record is ground truth. On host-loop builds this record is recoverable from `local-agent-mode-sessions/**/audit.jsonl`.
- **The discovery capability the model uses is SDK-MCP (`mcp__skills__*`), not the native `ListSkills`/etc.** Anything that models "what tools does a Cowork skill-discovery flow have" must model the SDK-MCP servers arriving over the control protocol (Ch24/L107), not the native agent tools — those are `vLt`-gated and never render.
- **VCS SDK events exist from agent 2.1.216, but only fire on real git operations.** Don't expect `code_change_published`/`vcs_state_changed` on a turn that does no PR-create/commit/push/merge/rebase, and don't gate their existence on 2.1.217 (that's the Desktop *consumption* floor).
- **Don't build on `getMcpSkillSources` / MCP-contributed skills — it's dead code today** (zero callers, gate unevaluated, extension not advertised on the wire).
- **On Desktop 1.24012.x, do not assume a Cowork session leaves a host-side transcript.** A fresh 1.24012.1 session here left none; whether that's a VM-loop shift or a path change is unconfirmed, but the L129 disk-recovery path may not hold on newer builds — verify where a build writes before relying on it.

**Cross-references.** Ch24/L107 (SDK servers over the control protocol; `f_()` host-loop/VM-loop decision) — L129's delivery channel and L132's loop-mode question · Ch30/L116 (entrypoint taxonomy `c2u`/`u2u`/`d2u`) — L129's `ekl`/`vth`/`LZe` · Ch31/L117 (VM rootfs forensics) — L132's fallback verification path if host transcripts go dark · Ch23/L106 + Ch35/L124 (stream-subtype inventories) — L130's `system`-subtype set · Ch36/L128 (scheduled-task auto-approve gates) — L131's `mcp__scheduled-tasks__*` allowlist entry · Ch27/L110 (model landscape) — the CLI content gap v2.1.198→2.1.217 is deferred to a separate future chapter, not folded here.
