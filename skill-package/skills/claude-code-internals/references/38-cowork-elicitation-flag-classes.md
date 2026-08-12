Updated: 2026-08-13 | Source: Desktop `app.asar` **1.28929.0** diffed against **1.26832.0** and 13 further local asars back to **1.18286.2** (15 builds total, `~/cowork-agent-backup/desktop-asar/<v>/app.asar`) + Desktop-managed host agent Mach-O **2.1.227** + in-VM ELF **2.1.227** + standalone CLI **2.1.228**/**2.1.229** + the live GrowthBook `fcache` decoded 2026-08-13 (`CLF\x01\x00` magic, gzip from byte 8 — Ch35/L124 method — capture stamp 2026-08-13T00:41:12Z, **254 features**, up from 240 at the skill's prior 2026-08-05 capture). Origin: a review of the `cowork-harness` project's `docs/internal/2026-08-12-desktop-1.28929.0-fidelity-impact.md` (a *lead source*, not evidence, per the standing discipline `reference_cowork_emulator_lead_source`) — every claim taken from it was re-derived first-party against this machine's own artifacts before being written down here. Two of the lead source's claims did not survive that re-derivation (L150) and one was answered opposite to its stated direction (L151).

**Corrects a published mischaracterisation.** The auto-mode rubric addition (L150) is not "a client-side harm classifier on the `can_use_tool` path" — that description conflated two unrelated gates. **Extends** Ch22/L105 and Ch24/L107 (L147), Ch37/L129 (L148), Ch25/L108 and Ch35/L124 (L149), Ch21/L109 and Ch31/L117 (L150), Ch30/L116 (L151).

# Chapter 41: Elicitation Routing, Flag-Delivery Classes & Cowork's Auto-Mode Additions

---

## TABLE OF CONTENTS

147. [Lesson 147 — Elicitation Is the Sanctioned Skill-Argument Channel](#lesson-147----elicitation-is-the-sanctioned-skill-argument-channel)
148. [Lesson 148 — The `built-*` Stickiness Pattern](#lesson-148----the-built--stickiness-pattern)
149. [Lesson 149 — Three Gating Classes, and "VM-Loop-Only" as a Feature Class](#lesson-149----three-gating-classes-and-vm-loop-only-as-a-feature-class)
150. [Lesson 150 — Cowork's Additions to the Agent's Auto-Mode Rules](#lesson-150----coworks-additions-to-the-agents-auto-mode-rules)
151. [Lesson 151 — Desktop Shipped an Env Key Its Own Agent Could Not Read](#lesson-151----desktop-shipped-an-env-key-its-own-agent-could-not-read)
152. [Lesson 152 — Four Traps That Fired in One Pass](#lesson-152----four-traps-that-fired-in-one-pass)

---

# LESSON 147 — ELICITATION IS THE SANCTIONED SKILL-ARGUMENT CHANNEL

**Desktop injects a standing instruction into every skill invocation telling the model to collect missing arguments through the elicitation form, not `AskUserQuestion` — and this is live, not dormant surface: gate `286376943` (`imagineElicitationEnabled`) reads force-ON in the 2026-08-13 fcache. The instruction is also byte-stable across all 15 local asars back to 1.18286.2, which reframes it from "a new feature in this release" to a standing gap in the skill's own coverage.**

## The verbatim injected message

From `function Lo(e,t)`, 1.28929.0:

> `[Skill "<name>" was invoked. It expects: <argument-hint>` *(or, when the skill declares no `argument-hint`: "It did not declare an argument-hint, so infer what context to collect from the SKILL.md instructions.")*
>
> First, determine what you can infer from the conversation and any attachments — do not ask for things you already know.
>
> If you need to collect missing context, use the visualize tool's elicitation module — NOT AskUserQuestion. The elicitation form renders richer inline UI (pills, free-text, dates) in one card instead of sequential prompts.
>
> 1. Call `read_me` with `modules: ["elicitation"]` to load form patterns
> 2. Call `show_widget` with the elicitation form
>
> Do not use AskUserQuestion for skill argument collection — reserve that for single ad-hoc clarifications mid-task.
>
> The elicitation form supports pills (single/multi), file upload, date, and free text. If the skill needs data or documents, include a file dropzone — don't ask "do you have it?" with pills.
>
> The user's answers will arrive as your next message as bullet points. If you can proceed without asking anything, do so.]

Two consequences of the last line worth stating explicitly: **answers come back as bullet points in the model's next user-turn message, not as a tool result.** A skill author who scripts or asserts against this flow needs to read the following user message, not a `tool_result` block.

## The `argument-hint` ternary — a dated, single-line edit

The message body is not static across history. Extracting the enclosing template (`was invoked. ` … `If you can proceed without asking anything, do so.`) from all 15 local asars and hashing the segment:

| build | len | sha256₁₆ | delta |
|---|---|---|---|
| 1.18286.2 (oldest local) | 913 | `44e3f97e725837c4` | — |
| 1.19367.0 | 913 | `938822779903801d` | minifier-only: `${t}` → `${r}` |
| 1.20186.1 … 1.24012.11 | 913 | `44e3f97e725837c4` | (id rotated back) |
| **1.25927.0** … 1.28929.0 | **1036** | `635cd46170a5d71e` | **the argument-hint ternary** |

The one substantive edit, landed at **1.25927.0**:

```diff
-was invoked. ${t}
+was invoked. ${t?`It expects: ${t}`
+              :`It did not declare an argument-hint, so infer what context to collect from the SKILL.md instructions.`}
```

Before 1.25927.0 the `argument-hint` frontmatter field was surfaced verbatim with no fallback text; 1.25927.0 added the explicit "infer from SKILL.md" instruction for skills that omit it. **The elicitation-over-AskUserQuestion instruction itself predates the entire local corpus** — present and functioning in the oldest asar on this machine. This is not a missed release; it is a standing gap that has survived roughly nine prior binary-diff passes of this skill.

## Delivery mechanism — two hook events, one resolver

The instruction is not part of the Cowork system prompt. It is injected per invocation through the Desktop-side hook config, by a resolver the build names outright:

```js
let st = c.Ht(`286376943`),                          // → destructured elsewhere as imagineElicitationEnabled
    ct = new Map,                                    // skill name → argumentHint
    lt = (e,i) => {                                  // → resolveElicitationContext
      let a = Io(ct,e);                               // lookup: skill name → {argumentHint}
      if(!a){ r.o.info(`[elicitation] skill not found via=${i}`); return }
      let {argumentHint:o} = a, s = t.getActiveSession(n);
      return s && (s.activeSkillThisTurn = {name:e, argumentHint:o}),
             r.o.info(`[elicitation] hint injected (${o?`with`:`no`} argument-hint) via=${i}`),
             Lo(e,o)                                  // builds the verbatim message above
    }
```

Two call sites, matching the `via=` discriminator in the log line:

```js
// 1 — PreToolUse on the Skill tool. NOTE the sub-agent exclusion.
… t.emit(`event`,{type:`skill_invoked`, …}),
  D && !e.agent_id
    ? (e = O(r,`PreToolUse`)) && {hookSpecificOutput:{hookEventName:`PreToolUse`, additionalContext:e}}
    : {}

// 2 — UserPromptSubmit, when the user types a slash command
if(e.hook_event_name!==`UserPromptSubmit` || !D) return {}
let t = e.prompt.match(/^\/(\S+)/); if(!t) return {}
let r = O(t[1],`UserPromptSubmit`)
return r ? {hookSpecificOutput:{hookEventName:`UserPromptSubmit`, additionalContext:r}} : {}
```

- **`!e.agent_id` excludes sub-agents.** A skill invoked from inside a dispatched sub-agent does not get this injection.
- **Two different hook events deliver the same content.** A direct `Skill` tool call gets it via `PreToolUse`'s `additionalContext`; a user typing `/slashcommand` gets it via `UserPromptSubmit`'s `additionalContext` instead — the tool-invocation path and the slash-command path are structurally different call sites converging on the same resolver.
- **The gate is `286376943` = `imagineElicitationEnabled`**, force-ON in the 2026-08-13 fcache. On this account the instruction fires on every skill invocation, right now.

**This upgrades Ch24/L107.** That lesson's text currently describes the `Skill` `PreToolUse` hook's payload only as `{matcher:"Skill",hooks:[...telemetry+additionalContext...]}` — a black box. The `additionalContext` *is* the message above, gated and delivered exactly as traced here. It also extends Ch22/L105 (elicitation as the private, server-facing channel) with the concrete mechanism that steers skills toward using it.

## Byproduct — a Desktop-side, turn-scoped skill scope

`s.activeSkillThisTurn = {name, argumentHint}`, set by the injector, is cleared in three places: `lam_message_cycle_start` (each new user message), `finishTurnCleanup`, and CU-lock release. This is a direct counterpart to Ch32/L118's **agent-side** `activeSkill` scope, and it behaves oppositely: L118's inline-skill scope is *sticky, most-recent-wins, never popped*; the Desktop's copy is **per-turn and explicitly reset**. Two skill scopes with the same name and opposite lifetimes — documenting only one produces a wrong inference about the other.

Cleared alongside `activeSkillThisTurn`: `cicOnceApproved` (L150) and `teachModeActive`/`teachModeEnteredAt` (a `cu_teach_session` telemetry feature with no coverage in this skill at all, noted here and not pursued further).

---

# LESSON 148 — THE `built-*` STICKINESS PATTERN

**Four distinct flags — `builtSystemPrompt` (Ch37/L129), `frameArtifactsTurnEnabled`, `cicCanUseToolEnabled`, and `cuCanUseToolEnabled` — share one caching shape: evaluate the gate once per built-tools/built-prompt generation, cache the result on the session object, and read the cache on every call thereafter. Ch37/L129's "sticky per session, corrected to model-switch-invalidates" finding was one instance of this mechanism, not a `suggest_skills` quirk.**

## The verbatim shape, three flags at one call site

```js
de = N ? (g?.builtTools===void 0 ? Fo(…)                 : N.frameArtifactsTurnEnabled ?? !1) : !1
P  = N ? (g?.builtTools===void 0 ? c.Ht(`2051942385`)    : N.cicCanUseToolEnabled     ?? !1) : !1
N && (N.frameArtifactsTurnEnabled = de)
N && (N.cicCanUseToolEnabled = P, N._isUnattendedTurn = i.scheduledTaskId!==void 0 || i._isUnattended===!0)
```

and, at the same call site in the L150 material, the third flag:

```js
ue = N ? (g?.builtTools===void 0 ? (i.sessionType!==`radar` && i.sessionType!==`chat` && c.Ht(`2486083521`))
                                 : N.cuCanUseToolEnabled ?? !1) : !1
```

Every one of these follows the identical branch: `g?.builtTools===void 0` selects the **live gate read** (first evaluation of this built-tools generation); the `else` branch reads back `N.<flag> ?? !1` — the **cached value**, never a fresh gate read.

## Two defaults worth naming separately

- **The cached-branch fallback is `?? !1`, never the live gate value.** If the field was never set, the cached branch resolves to `false` regardless of what the gate currently says.
- **The whole expression is `!1` when the session object `N` is absent.** No active session ⇒ every one of these flags reads as off. Both defaults are **fail-closed**.

## The rebuild predicate — what invalidates the cache

```js
fe = !xo(M,ae) || Co(…) || So(…) || wo(M,re)
```

named in the build as the condition that forces a fresh `builtTools`/`builtSystemPrompt` generation — and therefore a fresh read of all four flags. Ch37/L129 identified one term in this family (a model switch invalidating `builtSystemPromptModel`); this pass confirms the shape generalises across model identity, tool-set identity, and at least two other rebuild conditions bundled into `fe`.

**Generalisation.** This is not a `suggest_skills`-specific mechanism. Any flag read through the identical `g?.builtTools===void 0 ? <gate> : N.<field> ?? !1` shape inherits the same session-scoped, once-per-build, fail-closed-cached behaviour — and the same "a mid-session model or tool-set change re-reads it" correction Ch37/L129 already made for one instance.

---

# LESSON 149 — THREE GATING CLASSES, AND "VM-LOOP-ONLY" AS A FEATURE CLASS

**`frameArtifactsEnabled` is delivered in the server-side session-config struct, next to `memoryEnabled`/`skillsEnabled`/`pluginsEnabled`/`documentFunnelEnabled` — never as a GrowthBook gate, so it never appears in the fcache at all. This is a third gating class, structurally invisible to the fcache-reading methodology this skill has used since Ch25/L108. Paired with it: two independent 1.28929.0 features are gated `!isHostLoop`, unreachable on the force-ON host-loop 1p posture — enough to name "VM-loop-only" as a recognisable feature class rather than a one-off.**

## The third class

| class | example | visible in fcache? |
|---|---|---|
| env var | `CLAUDE_CODE_COWORK_FRAME_ARTIFACTS` (L151) | no — process env, never a gate |
| GrowthBook gate | `286376943` (`imagineElicitationEnabled`) | yes — `c.Ht(<id>)` reads it |
| **server-delivered session-config boolean** | **`frameArtifactsEnabled`** | **no — arrives on the session-config struct, not through the gate reader at all** |

Ch25/L108 catalogs env vars and GrowthBook gates. Ch37/L131 established that a gate id *absent* from the fcache is unevaluated rather than off. Neither category covers a flag that is **structurally incapable** of appearing in the fcache in the first place — there is no local signal, live or dark, that reveals this flag's state.

## The `Artifact` tool predicate, and its third reachable state

```js
function Po(e,t){ return e.frameArtifactsEnabled===!0 && e.sessionType===void 0
                     && e.scheduledTaskId===void 0 && !t.isBridgeSession
                     && !t.isDispatchChild && !t.isHostLoop && !A.r() }
function Fo(e,t){ return Po(e,t) && e._isUnattended!==!0 }
```

`A.r()` is the HIPAA restriction check. The tool spread (whether the model sees `Artifact`) uses `Fo`; the legacy per-artifact mount guard uses `Po` directly:

```js
re = c.Ht(`2940196192`) && !Po(i,{isBridgeSession:f,isDispatchChild:p,isHostLoop:h})
```

Note the inversion: mounts are the **suppressed legacy path** — they build only when `Po` is false, i.e. only when the session is *not* eligible for the native `Artifact` tool. Frame-artifacts eligible ⇒ native tool, legacy mounts suppressed; frame-artifacts ineligible ⇒ no native tool, legacy mounts (if gate `2940196192` is on) fill the gap.

Because the unattended term (`_isUnattended`) lives **only** in `Fo`, not in `Po`, there are three reachable states, not two:

| state | `Po` | `Fo` | tool | legacy mount |
|---|---|---|---|---|
| config flag off (any session) | false | false | no | yes (if gate on) |
| config flag on, attended session | true | true | **yes** | no |
| config flag on, **unattended** session | true | **false** | **no** | **no** |

The unattended row is the one worth remembering: a session that is unattended with the config flag on gets **neither** the tool nor the legacy mounts. "Mutually exclusive" undersells it.

## VM-loop-only as a class, not a one-off

`!isHostLoop` is the term in `Po` that matters most for this skill: the `Artifact` tool is **structurally VM-loop-only**. Ch35/L124 frames VM-loop as a set of deltas *from* host-loop; this is the mirror case — a capability host-loop can never reach at all. The auto-mode rubric addition (L150) is gated the identical way: `!hostLoopMode` in its own predicate. With host-loop gate `1143815894` force-ON for 1p accounts, **neither feature is reachable on a standard 1p posture, however the other flags are set.** Two independently-shipped `!isHostLoop`-gated features in one release is enough to treat "VM-loop-only" as a recognisable feature class going forward, the same way Ch35/L124 treats "VM-loop delta."

---

# LESSON 150 — COWORK'S ADDITIONS TO THE AGENT'S AUTO-MODE RULES

**This corrects a mischaracterisation: the feature is not "a client-side harm classifier on the `can_use_tool` path." Desktop appends Cowork-specific entries to the agent's own auto-mode rule set, delivered through the agent's `settings:` spawn option — the judging still happens agent-side. Gate `3424551112` reads OFF (defaultValue) in the 2026-08-13 fcache, and the delivery is additionally `!hostLoopMode`-gated, so on the force-ON host-loop 1p posture this reaches nobody. A second, unrelated gate — `2051942385` = `cicCanUseToolEnabled` — is Claude-in-Chrome's permission mode, not part of this feature; the two were merged into one description by an earlier reading.**

## The `ns()`/`rs()`/`ys()` chain

```js
var Qo = `$defaults`
$o = [ …3 environment strings… ]
es = [ …5 "named+specifics" rules… ]
ts = [ …4 carve-outs… ]
function ns(){ return {autoMode:{ environment:[Qo,...$o], soft_deny:[Qo,...es], allow:[Qo,...ts] }} }
function rs(e,t){ return t ? {...e, ...ns()} : e }
function ys(e){ return rs(I.f(), !e.isChatSession && !e.hostLoopMode && c.Ht(`3424551112`)) }
```

`ys({isChatSession, hostLoopMode})` is passed verbatim as the **`settings:`** spawn option, alongside `settingSources:["user"]`, `permissionMode`, `allowDangerouslySkipPermissions:!isChatSession`, `includePartialMessages:!0`, `extraArgs:{"replay-user-messages":null}`. There is no separate classifier process; this is a settings object handed to the agent at spawn, merged with `I.f()` (a base settings object — cross-chunk import, unresolved).

## The `$defaults` sentinel — extend, not replace

Every one of the three arrays (`environment`, `soft_deny`, `allow`) is `[`$defaults`, …additions]`. The leading sentinel means these entries **extend** the agent's built-in auto-mode rule set rather than replacing it wholesale — a settings-merge convention this skill had no prior record of.

## Reachability — gate OFF, and doubly conditioned besides

`3424551112` reads **OFF (defaultValue)** in the 2026-08-13 fcache. Combined with `!e.isChatSession && !e.hostLoopMode` in `ys()`, delivery requires all three conditions simultaneously — on the force-ON host-loop 1p posture (Lesson 149), the rubric is unreachable on two independent grounds at once, not one. The lead source's characterisation of this as its "highest-value item" should be read against that: on this posture, it is delivered to nobody.

## The rubric category names are the agent's own rule names

The category strings the lead source flagged as "new to the asar" — `PII Data Handling`, `Data Exfiltration`, `Irreversible Local Destruction`, `Unauthorized Persistence`, `Instruction Poisoning`, `Create Unsafe Agents`, `SUB-AGENT DELEGATION`, `Session-Created Job Cleanup`, `Local Operations`, `Self-Modification`, `Memory Directory`, `Claude Code Scheduling` — are **the agent's own auto-mode rule names**, referenced by these Desktop-authored `soft_deny`/`allow`/`environment` entries. They appear in the asar because the new Cowork text cross-references them by name, not because a classifier moved client-side. The distinction is the correction: **judging stays agent-side; Desktop only supplies additional named rules for the agent's existing classifier to apply.**

## The verbatim Cowork environment text

The `environment` array entries are Anthropic's own description of the sandbox to the agent's classifier:

> Filesystem: the agent runs in a sandbox VM under `/sessions/<name>/`. Paths there outside `mnt/` are VM-only scratch. `mnt/outputs/` is this session's deliverables folder and `mnt/uploads/` holds files the user attached. `mnt/.claude/` is the agent's config directory (the Self-Modification surfaces) and **`mnt/.auto-memory/`** is its memory directory (Memory Directory applies). Every other `mnt/<folder>/` is a real folder on the user's computer that they connected: **read-write, not backed up, no undo on delete.**

This corroborates Ch31/L117's mount inventory from an independent artifact and names **`mnt/.auto-memory/`**, a mount L117's rootfs inventory does not list. A second entry states the visibility model for Cowork's own tool set:

> Cowork built-in tools (**you see only name and arguments; assume no human reviews the call**)

— followed by one-line semantics for `request_cowork_directory`, `allow_cowork_file_delete` ("enables permanent deletion for the ENTIRE connected folder containing file_path, for the rest of the session" — first-party confirmation of Ch21/L109's `fileDeleteApprovedMounts` model), `save_skill` ("description enters the system prompt of every future session … equivalent to writing `.claude/skills/`"), and the four `mcp__scheduled-tasks__*` verbs.

## `2051942385` is a different feature — Claude-in-Chrome, not classification

Traced to its consumers, `cic` expands to Claude-in-Chrome:

```js
r.o.debug(`[Chrome MCP] tool=${e} mode=${d??`<unset>`} allowedDomains=[…] cicCanUseTool=${i.cicCanUseToolEnabled}`)
…
if(i.cicCanUseToolEnabled){
  if(d===`skip_all_permission_checks`) return {permissionMode:`skip_all_permission_checks`, sessionScope:m}
  if((p===`auto`||p===`bypassPermissions`) && !i.isUnattendedSession?.())
     return {permissionMode:d??`ask`, allowedDomains:f, onPermissionRequest:u, sessionScope:m}
  …
}
```

It selects the **permission mode for browser tool calls**, paired with `cicOnceApproved` — a per-session `Set` of once-approved hosts (`onceApprovedHosts`, added via `setCicOnceApproved`, drained by `consumeCicOnceApproved`, cleared at `finishTurnCleanup` alongside `activeSkillThisTurn`, Lesson 147). A remote-session path hardcodes `cicCanUseToolEnabled:!0`. It rides along as telemetry field `cic_can_use_tool` on `lam_mcp_tool_call_stalled`.

**Conclusion: `3424551112` gates the auto-mode rubric text; `2051942385` gates Claude-in-Chrome's permission interception. Neither is "a client-side harm classifier on the `can_use_tool` path." Both were described as one feature because both touch permissions and both are new-ish strings in the same build.**

---

# LESSON 151 — DESKTOP SHIPPED AN ENV KEY ITS OWN AGENT COULD NOT READ

**Desktop 1.28929.0 constructs and writes `CLAUDE_CODE_COWORK_FRAME_ARTIFACTS`. No agent binary on this machine at or before 2.1.227 reads it. The consumer lands in standalone CLI 2.1.228 — one agent version after the Desktop build that stages the key. The lead source inferred the opposite ordering from a neighbouring key's presence; that inference does not hold. Lesson: a key being understood cannot be inferred from a different key's presence, even an adjacent one.**

## Occurrence table by artifact

| artifact | version | matching lines |
|---|---|---|
| standalone CLI | 2.1.220, 2.1.225, 2.1.226, 2.1.227 | **0** |
| standalone CLI | **2.1.228** | **9** |
| standalone CLI | **2.1.229** | **12** |
| Desktop-managed host agent (Mach-O) | 2.1.227 | 0 |
| in-VM ELF | 2.1.227 | 0 |
| backup agents | 2.1.219, 2.1.221, 2.1.222, 2.1.227 | 0 |
| Desktop `app.asar` | 1.28929.0 | 1 (the write site) |
| Desktop `app.asar` | 1.26832.0 | 0 |

## The order, and why it matters

**Desktop shipped the producer before any agent shipped the consumer** — the reverse of the usual assumption that a Desktop-side env var is safe to write because "the agent already understands it." The lead source reasoned from `CLAUDE_CODE_DISABLE_ARTIFACT` being present in the agent binaries that this key was too ("the agent has shipped this for a while; 1.28929.0 is Desktop deciding to list it"). `CLAUDE_CODE_DISABLE_ARTIFACT` is a **different key**, and its presence says nothing about this one. The general form of the mistake: inferring one key's understood-ness from a neighbouring key's presence in the same binary.

## What the consumer does (CLI 2.1.229)

```js
class jMc { entrypoint; childSession=!1; claudecode=!1; coworkFrameArtifacts=!1;
            setCoworkFrameArtifacts(e){this.coworkFrameArtifacts=e} … }
function qMc(){ return $6e.coworkFrameArtifacts }
function WMc(e){ WYg(e), $6e.setEntrypoint(Q.CLAUDE_CODE_ENTRYPOINT),
                 $6e.setChildSession(Boolean(Q.CLAUDE_CODE_CHILD_SESSION)),
                 $6e.setClaudecode(Boolean(Q.CLAUDECODE)),
                 $6e.setCoworkFrameArtifacts(Q.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS) }
```

It is absorbed into the **session-identity singleton** at boot, alongside `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_CHILD_SESSION`, and `CLAUDECODE` — the exact trio Ch30/L116's runtime-detection recipe is built on. It also joins them in a dedicated set:

```js
RB_ = new Set(["CLAUDE_CODE_ENTRYPOINT","CLAUDE_CODE_IS_COWORK","CLAUDE_CODE_COWORK_FRAME_ARTIFACTS"])
```

with its own case-insensitive strip helper, sibling to the entrypoint stripper:

```js
function ROt(e){ let t=e.CLAUDE_CODE_ENTRYPOINT; if(t!==void 0 && ksv.has(t)) delete e.CLAUDE_CODE_ENTRYPOINT }
function xOt(e){ for(let t of Object.keys(e)) if(t.toUpperCase()==="CLAUDE_CODE_COWORK_FRAME_ARTIFACTS") delete e[t] }
```

## What it gates

```js
function ule(){ return z3t()==="local-agent" && PAe() && !zMc() && qMc() }
                // entrypoint==="local-agent" && not-a-child && !CLAUDECODE && coworkFrameArtifacts
function Bgd(e){ return e==="local-agent" || e?.startsWith("claude-coworker")===!0 }
function $gd(e){ if(Q.CLAUDE_CODE_ENTRYPOINT==="local-agent" && ule()) return !1; return Bgd(Q.CLAUDE_CODE_ENTRYPOINT) }
function eH_(){ return Bgd(z3t()) && !ule() }
```

`ule()` **inverts** two predicates (`$gd`, `eH_`) that otherwise treat `local-agent` / `claude-coworker*` as one undifferentiated class. Sitting immediately beside these is the legacy artifact-availability logic (`Ugd`, `CLAUDE_CODE_ARTIFACT`, `Fgd`, gate `tengu_retire_chat_relay_artifact_backstop`) — the agent-side mirror of the Desktop-side inversion in Lesson 149: frame-artifacts ON ⇒ native tool path; legacy chat-relay artifact path suppressed.

## Two side findings

- **`claude-coworker*` is an entrypoint *prefix* family** (`e?.startsWith("claude-coworker")`), not a value in a set. Ch30/L116 enumerates the entrypoint value sets as `c2u`/`u2u`/`d2u`; a prefix test cannot be expressed as membership in any of them. L116's ordered detection recipe needs review against this.
- **The CLI baseline on disk is further ahead than the registry records.** `~/.local/share/claude/versions/` holds 2.1.220, 2.1.225, 2.1.226, 2.1.227, **2.1.228, 2.1.229** — the registry pins `cli: 2.1.221`. The real gap for a future CLI-refresh pass is **v2.1.198 → 2.1.229**, not the previously scoped v2.1.198 → 2.1.217, and the two most interesting versions in that gap (2.1.228/2.1.229 — the consumer landing versions) are already on disk.

---

# LESSON 152 — FOUR TRAPS THAT FIRED IN ONE PASS

**Four distinct methodology failure modes surfaced in this investigation; three of them actually fired and produced a wrong intermediate conclusion before being caught. Each is a specific, nameable trap, not a general "be careful" — record them so the next pass recognises the shape immediately.**

## 1. A gate-backed config read carries two numbers

```js
// app.asar 1.28929.0
…,U=3e4, W=9e5, Ae=100, G=new WeakMap;
ttlMs: i.zt(`1978029737`,`coworkWebFetchDedupTtlMs`, W, n.x().int().positive())
```

The fcache's **served value** for `coworkWebFetchDedupTtlMs` had moved 900000 → **3600000**. The **code-literal default** passed as the reader's third argument was still `W = 9e5` (900000). These are two different numbers with two different meanings: the served value governs behaviour when the key is *present*; the default governs behaviour when it is *absent*. A wrong intermediate conclusion — "the code-literal default is stale, restamp it to 3600000" — was drafted and would have introduced a real divergence, since a consumer hard-coding `?? 900000` for the absent-key path is mirroring production *correctly*. **Rule: before calling a constant stale, resolve the reader's default argument, not just the served value from the live config.**

## 2. `|| echo 0` converts a tool failure into a data point

A first pass over the VM guest disk image (`rootfs.img`) reported **zero** mount units and zero hits for `systemd`/`/sessions/` in a 10 GiB Linux disk image — impossible on its face. Cause: the commands were wrapped in `timeout 300 rg … || echo 0`, and **`timeout` is not installed on this machine**, so every command exited 127 without running and the `|| echo 0` fallback silently printed a fabricated zero. The positive control caught it: `rg -ca "systemd"` on the full image, run without the broken wrapper, returned 28664 and worked fine — there was never a large-file limit; the tool itself was never the problem. **Never use a fallback that is indistinguishable from a real measurement; let the command fail loudly instead.** Same failure class as the `.vite/build` hidden-directory trap and the gzip-wrapped `fcache` trap already on record — a third instance of "an absence produced by the tooling, not the artifact."

## 3. `rg -c` counts matching lines, not occurrences

On a minified, near-lineless bundle, a line can contain many matches. `rg -c` reports the count of **lines with at least one match** — a reported `5` can mean 11 real occurrences sitting on 5 "lines." Use `rg -o <pattern> … | wc -l` whenever the occurrence count itself is the claim being made.

## 4. Per-string occurrence locator, not a set diff

On a large release, counting a candidate literal in both builds and splitting the result by chunk family (`index.chunk-*` = Desktop, `index2.chunk-*` = bundled CLI) is required — a **per-family set diff** is noise, because code migrating between chunk families registers as simultaneously added to one family and removed from the other. Relayed measurement from the lead-source pass illustrates the scale of the false signal: per-family set diffs reported `new=3262/gone=860` and `new=1218/gone=3124` on a release whose real delta, once resolved to actual per-string occurrence counts, was **~10 items**.
