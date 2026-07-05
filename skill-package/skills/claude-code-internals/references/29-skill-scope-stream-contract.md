Updated: 2026-07-05 | Source: Cross-artifact first-party binary inspection on this installation — the staged in-VM agent ELF `claude-code-vm/2.1.197/claude` (not stripped) **and** the host CLI binary `~/.local/share/claude/versions/2.1.201` (the live host-loop agent, one build ahead of the CLI content baseline v2.1.198) **and** Claude.app (Desktop) `app.asar` **1.18286.0**. Prompted by the independent `claude-cowork-headless-emulator` project's `docs/internal/2026-07-05-full-scope-implementation-plan.md` (§4.14, §5.1.1, §5.2), then **independently re-derived first-party** against this machine's own binaries before any claim was written here — the same read-external-claim-then-re-verify discipline used for L108's v2.23.0 gate extensions. The **live fork-skill *behavioral* facts** in Part C (Haiku 4.5 vs Sonnet 5 sandboxed runs) are **relayed** from that project's live-lane verification and are labelled as such; every **static/code** fact (symbol names, the sticky-vs-restore control flow, the `attribution` bundle, the `tool_use_meta` schema, the compaction subtypes) was greppable and is confirmed present in **both** our VM ELF 2.1.197 and host CLI 2.1.201.

# Chapter 32: Skill-Scope Attribution & the Per-`tool_use` Stream Contract

---

## TABLE OF CONTENTS

118. [Lesson 118 -- Skill-Scope Attribution & the Per-tool_use Stream Contract](#lesson-118----skill-scope-attribution--the-per-tool_use-stream-contract)

---

# LESSON 118 -- SKILL-SCOPE ATTRIBUTION & THE PER-`tool_use` STREAM CONTRACT

## The question this closes out

When a skill runs and then the model calls `Bash`, `Read`, etc., **does the agent track which skill
"owns" that tool call, and if so, is that attribution visible in the stream-json output** that a
harness (or Cowork's host loop) parses? This matters for anyone building observability over Claude
Code: a per-tool→skill mapping would let a test assert "the market-sizing skill actually ran its
computation script," and a per-message model attribution would let a harness attribute cost. The
answer, verified across three artifacts, is a clean split:

- **Yes, internally.** The agent maintains an `activeSkill` scope and threads a full `attribution`
  bundle onto every outbound Anthropic API request.
- **No, in the local stream.** None of that attribution is serialized into the stream-json objects
  the harness reads. The per-`tool_use` stream contract is a small, fixed field set, and the only
  per-tool metadata in it (`tool_use_meta`) is display-only (MCP tool titles/icons).

So an exact tool→skill attribution genuinely does **not** exist in the stream; a windowing heuristic
is the ceiling for inline skills, while **fork** skills carry an exact `parent_tool_use_id` signal.

## Part A — the internal skill-scope tracker (`activeSkill` / `spawnedBySkill` / `attribution`)

Verbatim from the VM ELF 2.1.197 (identical in host CLI 2.1.201; symbols are the build's minified
names — `W1e` = skill-id normalizer, `Ypm` = fork runner, `c$` = attribution builder, `Mb` = skill
lookup):

```js
// Skill tool's call() path — activeSkill is set to the invoked skill, then:
let l = n.options.activeSkill;              // save the PREVIOUS active skill
n.options.activeSkill = a;                  // set to this skill (raw name)
let c = await yIo(n), u = Mb(a, c);         // resolve the skill definition
if (u) n.options.activeSkill = W1e(u);      // normalize
if (DKn(a), u?.type === "prompt" && u.context === "fork")
  try { return await Ypm(u, a, t, n, r, o, s) }
  finally { n.options.activeSkill = l }     // FORK: restore previous in finally
// ...INLINE path falls through here: activeSkill STAYS SET (never restored)
```

Three load-bearing facts fall straight out of this control flow:

1. **`activeSkill` is set on `Skill.call()` and is a process-global on the agent's `options`.** It is
   not per-turn or per-message state — it's a single mutable slot.

2. **Inline vs fork differ in exactly one way: the `finally` restore.** A **fork** skill
   (`u.type === "prompt" && u.context === "fork"`) runs its body in a forked sub-agent (`Ypm`) and
   **restores** the previous `activeSkill` in a `finally`. An **inline** skill takes the fall-through
   path and **never restores** — so `activeSkill` is a **sticky, most-recent-wins, no-pop scope**: it
   stays set to the last inline skill until the next `Skill` call replaces it. There is no "skill
   exited" event, because internally there is no pop. (This is the ground truth that any harness
   windowing heuristic can at best reproduce — see Part C and cross-ref L116/Ch30.)

3. **Sub-agent dispatches inherit the scope.** Every dispatch computes
   `spawnedBySkill: F.options.spawnedBySkill ?? F.options.activeSkill` (this exact `?? activeSkill`
   fallback appears at ~9 dispatch sites). So a skill that fans out to sub-agents propagates its
   identity into each child's `spawnedBySkill`.

### The `attribution` bundle rides the API request, not the stream

Every model request carries an attribution quintuple, built by `c$`:

```js
attribution: c$(s.querySource, s.spawnedBySkill, s.activeSkill, s.activeMcpServer, s.activeMcpTool)
```

`querySource` (values like `"agent:custom"`, or `OMe(agentType, …)`), `spawnedBySkill`, `activeSkill`,
`activeMcpServer`, `activeMcpTool`. This spread lands on the object sent **to Anthropic** (adjacent to
`requestId` / `serverFallbackHop`), i.e. server-side telemetry. **It is not on any object the agent
`yield`s into the local stream-json output** (Part B). This is the crux: the server knows which skill
and MCP tool were active for each request; the local stream reader does not.

### Fork re-entry guard

A forked skill sub-agent that tries to re-invoke the same skill is caught:

```js
if (a.type === "prompt" && a.context === "fork" && t.options.spawnedBySkill === W1e(a))
  return Oe("skill_invoke", "skill_invoke_fork_recursion"),
         G("tengu_skill_tool_fork_recursion", …)
```

So the recursion guard is gated/telemetered by **`tengu_skill_tool_fork_recursion`** and emits a
`skill_invoke_fork_recursion` event — this is the mechanism behind the user-visible guard error string
(`"…is already executing in this forked context — you are the subagent running it. Execute the
instructions…"`, confirmed present in the ELF), which Part C shows is hit model-dependently.

## Part B — the per-`tool_use` stream-json contract

The locally-`yield`ed stream objects carry a small envelope: a few **always-present** fields plus
several **conditionally-spread** ones. Verbatim from the ELF's assistant/user serializer (the `...x &&
{k:x}` idiom is the conditional-spread; `n` = subagent type, `r` = task description, `s` = tool-use
meta array):

```js
{ type:"assistant", message:o.message, parent_tool_use_id:e.parentToolUseID, session_id:Ot(),
  uuid:o.uuid, error:o.error,
  ...o.requestId !== void 0 && { request_id: o.requestId },
  ...n !== void 0 && { subagent_type: n },        // ← only on dispatch/fork-scoped messages
  ...r !== void 0 && { task_description: r },      // ← only on dispatch/fork-scoped messages
  ...s.length > 0 && { tool_use_meta: s } }
// user/tool-result path also carries: timestamp, isSynthetic, tool_use_result, ...origin, + the same
//   conditional subagent_type / task_description.
```

Always present: `type`, `message`, `parent_tool_use_id`, `session_id`, `uuid`, `error`. Conditional:
`request_id`, `subagent_type`, `task_description`, `tool_use_meta`. **`subagent_type` and
`task_description` were missed by an earlier framing of this envelope as a "fixed small set with nothing
else" — they are real, but appear *only on messages emitted inside a dispatched/forked scope*** (verified
first-party in the serializer; e.g. a fork sub-agent's message carries `subagent_type:"general-purpose"`
and `task_description` = the dispatching skill's frontmatter `description`). They give a coarse "this
message is running inside *some* dispatch" signal — but still **not** skill scope. Critically, **no
`activeSkill`, no `spawnedBySkill`, no `attribution`** appears in any yielded object.

**Two more per-message facts (first-party, both binaries), relevant to cost/model attribution:**
- **`message.model` is populated on every assistant message** (30 threading sites; the plan's live
  capture found it present on every sampled message, *including* the one emitted inside a forked
  sub-agent) — so per-message model attribution is reliable, not best-effort.
- **Each assistant message carries its OWN `usage` object** — `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation`, `service_tier`,
  `inference_geo` — finer than the single cumulative usage on the terminal `result` event. A real
  substrate for per-turn/per-tool-call cost attribution.

**Adjacent — the `init` system message field set** (names first-party in the ELF; the full set below is
from the emulator project's real captured `init` line): `tools`, `mcp_servers` (snake_case; `[]` when
none configured), `cwd`, `skills` (**a bare array of names**, no `when_to_use` — confirming rendered
`when_to_use` is not in the stream), `agents` (available subagent-type names, e.g. `["claude","Explore",
"general-purpose","Plan",…]`), `slash_commands`, `plugins`, `permissionMode`, `output_style`,
`apiKeySource`, `memory_paths`, `fast_mode_state`.

### `tool_use_meta` is display metadata only

The verbatim Zod schema:

```js
tool_use_meta: v.array(v.object({
  id: v.string(),
  display_name: v.string(),
  server_display_name: v.string().optional(),
  icon_url: v.string().optional(),
}))
```

Comment in the binary: *"Display metadata … for tool_use blocks."* It carries MCP tool titles/icons for
rendering — **not** skill scope. A harness that hoped `tool_use_meta` would tell it "this tool ran
under skill X" is looking at the wrong field; that data was stripped before serialization and sent only
to the API.

### Fork inner-tool calls arrive as `skill_progress`

Fork-skill (and sub-agent) inner activity is wrapped: the `progress` branch special-cases
`e.data.type === "agent_progress" || e.data.type === "skill_progress"`, threading `agentType` /
`task_description` and the same conditional `tool_use_meta`. So a fork skill's inner tool calls surface
as `skill_progress`-wrapped assistant messages that **do** carry `parent_tool_use_id` (= the `Skill`
call's id) — the one place an exact tool→skill link *is* in the stream (Part C).

## Part C — fork-skill execution protocol (behavioral)

> **Provenance flag:** the code paths in Parts A/B are first-party (my greps). The
> *runtime behavior* below is **relayed** from the `claude-cowork-headless-emulator` project's live
> sandboxed runs (`cowork-harness run --fidelity container`) against **two** models — I did not re-run
> them here. They are included because they are consistent with the Part A/B code and because the
> protocol-level claim is model-independent (verified across both models in that project).

1. **Inner tool calls carry `parent_tool_use_id` = the OUTER `Skill` tool_use's own id — model-
   independent.** In both a Haiku 4.5 run and a Sonnet 5 run of a real `context: fork` skill, the
   skill's inner `Bash` call's `parent_tool_use_id` equalled the outer `Skill` call's id. This is the
   protocol guarantee that makes fork-skill attribution **exact** (unlike inline's sticky window):
   attribute by `parentToolUseId`, exactly as sub-agent (`Agent`/`Task`) children are attributed.

2. **The re-entrant nested `Skill` call is model-dependent, not a fixed shape.** Haiku's forked
   sub-agent first re-invoked the same `Skill` tool, hit the Part-A recursion guard
   (`tool_use_error: "…already executing in this forked context…"`), then did the real work. Sonnet
   skipped straight to the real `Bash` with no re-entry. Implication for anyone modelling this: treat
   the nested `Skill` re-entry as an **optional, if-it-occurs** case (fold it into the parent window;
   do not open a new child scope), not a guaranteed step.

3. **Consequence — fork-skill inner tools are currently *invisible* to `toolCounts`/`toolsCalled`,
   not merely unattributed.** The dispatch-tool gate only counts a parented `tool_use` when its
   `parentToolUseId` matches an entry populated by `Agent`/`Task`/`subagent_type`-bearing dispatches — a
   `Skill` call never registers there. So a `context: fork` skill's inner calls are dropped from those
   aggregates today (visible only in the raw tool log). This is a genuine **undercount** for fork
   skills, relevant to how anyone reading those fields interprets them.

## Part D — `compact_boundary` vs `microcompact_boundary`

Both are `type:"system"` message subtypes, present in **both** the VM ELF 2.1.197 and host CLI 2.1.201:

```js
{ type:"system", subtype:"compact_boundary", session_id, uuid, compact_metadata, … }  // "Conversation compacted"
```

- **`compact_boundary`** — emitted on an auto/manual compaction, carries `compact_metadata`. This is
  the one Ch26/L109 already lists among the ~90 control-protocol subtypes.
- **`microcompact_boundary`** — a **distinct subtype string** for micro-compaction, **not** previously
  documented here, but with a sharp asymmetry from `compact_boundary` that matters for anyone keying an
  assertion on it. Emit-site counts (first-party, VM ELF 2.1.197; identical on host CLI 2.1.201):
  `compact_boundary` has **8** `subtype:"compact_boundary"` producer sites (real
  `{type:"system", subtype:"compact_boundary", …, compact_metadata}` emissions into the stream);
  `microcompact_boundary` has **0**. Its only two occurrences in the whole binary are (a) a string-table
  constant and (b) **one Ink/React TUI renderer case that renders nothing** —
  `case "system": … if (n.subtype === "microcompact_boundary") return null` (via `Dv.jsx`, beside a
  `read_divider` case). So on this evidence **`microcompact_boundary` is render-only and suppressed —
  it is not serialized into the stream-json output at all**, whereas `compact_boundary` is. A
  `compaction_occurred`-style signal in a **stream/headless** harness should therefore key on
  `compact_boundary` (the emitted one); keying it on `microcompact_boundary` would, on this evidence,
  catch nothing. **Caveat:** `compact_boundary`'s producers use the literal string, so a literal grep is
  the right instrument; a dynamically-assembled micro producer would evade it, but the total count of 2
  (both accounted for) leaves no room for a hidden literal one. Whether a newer build adds a micro
  producer, and whether the stream even reaches a Cowork host-loop harness's stdout, remain live
  checks.

## What this means (for skill authors & harness/observability builders)

- **Don't expect the stream to tell you which skill ran a tool.** The attribution exists server-side
  only. For **inline** skills the best a local reader can do is a sticky "active-skill window" that
  *reproduces* the agent's own `activeSkill` semantics (set-on-call, no-pop) — faithful, but it
  mis-attributes unrelated top-level calls made after a skill finishes, exactly as the agent's own
  scope does.
- **Fork skills are the exception:** their inner tools carry `parent_tool_use_id` = the `Skill` id, so
  attribution is exact — and today they're *undercounted*, so wiring that link is a correctness fix,
  not just precision.
- **`tool_use_meta` ≠ skill scope.** It's MCP display metadata (`{id, display_name,
  server_display_name?, icon_url?}`).
- **Micro-compaction is its own subtype** (`microcompact_boundary`), distinct from `compact_boundary`
  and sometimes silently dropped in rendering.

## Honesty & scope caveats

- **First-party (my greps, both binaries):** every symbol and code path in Parts A/B/D — `activeSkill`
  set/restore flow, `spawnedBySkill ?? activeSkill`, the `c$` attribution quintuple, `W1e`/`Ypm`/`Mb`,
  `tengu_skill_tool_fork_recursion`, the stream envelope field list, the `tool_use_meta` Zod schema,
  `skill_progress`, `compact_boundary`/`microcompact_boundary` (+ the `return null` on the latter).
- **Relayed (emulator project's live runs, not re-run here):** the Part C Haiku-vs-Sonnet runtime
  behavior and the `toolCounts` undercount observation.
- **Presence vs full semantics:** grepping confirms the code exists and its immediate control flow; the
  "attribution goes to the API and *not* the stream" claim rests on the attribution spread appearing on
  the request object while being absent from every `yield`ed stream object I inspected — strong, but a
  negative-by-inspection, not a proof of exhaustive absence.
- **Version note:** the host CLI cross-check used **2.1.201** (one build ahead of this skill's CLI
  content baseline **2.1.198**); it is used only for parity confirmation. The finding is architecturally
  identical across 2.1.197 (VM) and 2.1.201 (host), so it is not a "the pinned VM is just old" artifact.

**Cross-references.** Ch30/L116 (skill runtime detection — the host/VM env split; this chapter is the
"what the agent tracks internally about skills" companion to that "how to detect the runtime") ·
Ch24/L107 (the stream-json control-protocol contract — this chapter pins the exact per-`tool_use`
envelope fields) · Ch26/L109 (the ~90-subtype control protocol — adds `microcompact_boundary` beside
its `compact_boundary`) · Ch19/L87 + Ch29/L115 (`/fork` and `context: fork` dispatch, subagent
continuation — this chapter adds the fork-skill `parent_tool_use_id` attribution + recursion guard) ·
Ch04 (Filesystem hooks `FileChanged`/`CwdChanged` — confirmed by the same emulator plan, via a
producer-site check, to be watcher→hook-callback payloads (`hook_event_name:"FileChanged"`,
`file_path`/`event`), with **zero** stream-message producer sites — so file-change events never reach
the stream envelope this chapter documents).
