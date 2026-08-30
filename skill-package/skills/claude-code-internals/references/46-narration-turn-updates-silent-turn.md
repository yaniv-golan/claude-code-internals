Updated: 2026-08-30 | Source: **Desktop-managed Cowork host agent Mach-O 2.1.247** (`~/Library/Application Support/Claude/claude-code/2.1.247/claude.app/Contents/MacOS/claude`, the only staged version; sha256 `8d1dfe53f41d78b44770be04fd5d62fdd434a9414e791c933fbbc18a29883795`), **`app.asar` 1.40609.0** (live install, extracted), the **16 staged agent binaries 2.1.197 → 2.1.247** for introduction boundaries, a **live GrowthBook fcache decoded 2026-08-30** (305 features), and a **behavioural corpus** of 2,250 Cowork session transcripts plus 3,010 recent CLI transcripts on this machine. **Does NOT move the CLI content baseline.**

# Chapter 49: Why the Model Talks — Narration, Turn Updates, and the Silent-Turn Reminder

---

## TABLE OF CONTENTS

175. [Lesson 175 — Narration Is a Prompt Section, Not a Feature](#lesson-175--narration-is-a-prompt-section)
176. [Lesson 176 — The Silent-Turn Reminder, and 399 Chances It Did Not Take](#lesson-176--the-silent-turn-reminder)
177. [Lesson 177 — Brief Mode, PEWTER_OWL, and Why Cowork Renders Plain Text](#lesson-177--brief-mode-pewter-owl-and-cowork)
178. [Lesson 178 — The Dark Narration Lane: `thinking.display` and Sable Thrush](#lesson-178--the-dark-narration-lane)
179. [Lesson 179 — Reading Model Behaviour Out of the Transcript Corpus](#lesson-179--reading-behaviour-out-of-the-corpus)

---

# LESSON 175 — NARRATION IS A PROMPT SECTION

**Nothing in the runtime emits progress narration. Plain assistant text between tool calls *is* the narration channel in Cowork, and the only thing that makes the model write it is a dynamic system-prompt section whose wording is chosen per model family by a server-supplied capability map.**

## The mechanism

The section is registered like any other dynamic block, in the same array as `pronouns`, `scratchpad` and `output_style`:

```js
g=[ku(`communication${a}${m?":send_user_msg":""}`,()=>SUs(o)), ku("pronouns",()=>EUs), ...]
```

`SUs()` picks one of three bodies:

```js
function SUs(e){
  let t=nr(e);
  if(U0("turn_updates",V.CLAUDE_CODE_TURN_UPDATES,t))return bUs;
  if(yUs(t)||yqr(t)){ let n=_Us(t); return `# Communicating with the user …`; }
  if(uu(e))return "Write code that reads like the surrounding code: …";
  return `# Text output (does not apply to tool calls)…`;
}
```

**Variant A — the `turn_updates` capability.** The whole section collapses to one sentence (`bUs`, verbatim):

> Before you start, say in a line what you're about to do; brief updates while you work help the user follow along. Close with a short recap that stands on its own — what you found, what you did, and what's next — so a reader who only sees the last message has the full picture.

**Variant B — `# Communicating with the user`.** The load-bearing clause, verbatim:

> Your text output is what the user reads between tool calls; they usually can't see your thinking or the raw tool results. … **Before your first tool call, say in a sentence what you're about to do; while working, give brief updates when you find something load-bearing or change direction.**

**Variant C — `# Text output (does not apply to tool calls)`.** The most explicit of the three:

> Assume users can't see most tool calls or thinking — only your text output. Before your first tool call, state in one sentence what you're about to do. While working, give short updates at key moments: when you find something, when you change direction, or when you hit a blocker. **Brief is good — silent is not.** One sentence per update is almost always enough.
>
> Don't narrate your internal deliberation. User-facing text should be relevant communication to the user, not a running commentary on your thought process.

## The selector is not a gate you can read

`U0` is a three-tier capability resolver, and only the first tier is inspectable from disk:

```js
function U0(cap,envOverride,modelFamily){
  if(envOverride!==void 0)return envOverride;      // env
  if(IG(modelFamily,cap))return!0;                 // per-family table
  if(Ag()?.[cap]!==!0)return!1;                    // server-delivered client data
  …D("tengu_model_capability_from_client_data",{capability:X(cap)});
  return!0;
}
```

The third tier arrives with the account, not the build. **Which of the three bodies a session gets is a server decision per model**, so two sessions on the same binary can be given different narration instructions. The telemetry event `tengu_model_capability_from_client_data` exists precisely because that tier is invisible locally.

## `CLAUDE_CODE_TURN_UPDATES` — closing a lead

Ch40/L161 recorded `CLAUDE_CODE_TURN_UPDATES` as one of four names in a `+4 / −1` asar env-var delta at Desktop 1.30096.1, with no consumer traced. The consumer is `SUs()`, and the symbol first appears in the agent at exactly **2.1.229** — the same agent version L161 paired with that asar. Two artifacts, diffed independently across different ranges, landing on the same version.

## Cowork does not suppress it

`excludeDynamicSections` would drop the section. It occurs **4 times in `app.asar` 1.40609.0, all four inside vendored Agent-SDK plumbing** (the `initialize` payload builder and the `preset` system-prompt destructure). No Cowork call site sets it, so a Cowork session gets whichever variant its model resolves to.

---

# LESSON 176 — THE SILENT-TURN REMINDER

**The agent carries one mechanism that actively pushes the model to speak mid-turn — a `silent_turn_reminder` attachment injected after five consecutive silent assistant turns. It shipped at 2.1.237. Across 399 qualifying stretches in this machine's own Cowork and CLI corpora on versions that carry it, it fired zero times.**

## The mechanism

`k0s()` walks the transcript backwards to the last real user message and returns two counters:

```js
function v0s(e){
  let{turnsSinceLastReminder:t,remindersInStretch:n}=k0s(e);
  if(n>=eHr||t<rHr())return[];
  ce("silent_turn_reminder",{turns:t});
  return[{type:"silent_turn_reminder",text:tHr()}];
}
var Jzr=5,eHr=3,
Qzr="The user hasn't heard from you in a while. As you continue, keep them updated when there's something to tell — a finding, a change of plan.";
```

An assistant turn (grouped by `message.id`) counts as **speaking** if it carries a non-empty text block, or a `tool_use` whose name is in a five-element set:

```js
w0s=new Set([Mi,dke,u0s,Jm,J2]);   // Mi="AskUserQuestion", dke=BRIEF_TOOL_NAME, u0s=LEGACY_BRIEF_TOOL_NAME
```

Three of the five resolve to `AskUserQuestion`, `SendUserMessage`, `Brief`. Two (`Jm`, `J2`) are unresolved minified constants — see *Honest scope*.

| Knob | Env | Gate | Default |
|---|---|---|---|
| Turns before firing | `CLAUDE_CODE_SILENT_TURN_REMINDER_TURNS` | `tengu_hushed_lark` | **5** |
| Reminders per stretch | — | — | **3** (`eHr`, hard) |
| Reminder text | `CLAUDE_CODE_SILENT_TURN_REMINDER_TEXT` | `tengu_hushed_lark_text` | `Qzr` above |
| Enabled | `CLAUDE_CODE_SILENT_TURN_REMINDER` | — | `U0("silent_turn_reminder", …)` |

Call-site guard — **main thread, and only on non-user-prompt turns**, i.e. exactly the mid-turn continuations a long pipeline is made of:

```js
...p&&e===null&&!i?.isRegularUserPrompt&&!sQ()&&nHr(t.options.mainLoopModel)
  ?[fi("silent_turn_reminder",()=>Promise.resolve(v0s(o??[])))]:[]
```

## What the corpus shows

Silent stretches reconstructed from transcripts, main thread only, grouped by `message.id`:

| Corpus | sessions | main assistant turns | turns that spoke | stretches ≥5 | reminders fired |
|---|---|---|---|---|---|
| Cowork, all versions | 2,250 | 47,013 | 33.9% | 1,766 | 0 |
| Cowork, agent ≥ 2.1.237 | 224 | 1,601 | 31.0% | **73** | **0** |
| CLI, agent ≥ 2.1.237 | 2,847 | 19,031 | 54.1% | **326** | **0** |

**399 opportunities on feature-carrying versions, zero fires.** The attachment channel is positive-controlled: the Cowork corpus persists 21 distinct `attachment.type` values, including two list-siblings of the reminder — `total_tokens_reminder` (1,946) and `task_reminder` (1,519). Absence here is a measurement, not a gap in the instrument.

The reading: **the `silent_turn_reminder` capability is off for this account.** It is not off in the binary — the code is complete and reachable — and `tengu_hushed_lark` is a CLI-side gate absent from the Desktop fcache, so this is behavioural evidence, not a decoded gate state.

## The secondary finding is the more useful one

**Cowork narrates about half as often as the CLI.** 31.0% of main-thread assistant turns carry text or a speaking tool in Cowork, against 54.1% in the CLI on the same agent versions — and Cowork's silent runs are both more common and longer: roughly 24% of its stretches reach five turns or more, against about 9% in the CLI, with observed maxima of **146** (Cowork) and **103** (CLI) consecutive silent turns.

Same binary, same `SUs()` section. A long skill pipeline under Cowork can and does run for dozens of turns with nothing reaching the user, and the one runtime backstop designed to interrupt that is not enabled.

**Consequence for skill authors:** phase-boundary narration has to be written into the skill body. Nothing in the runtime will supply it, and the prompt section alone measurably does not hold across a long tool loop.

## Introduction boundaries

Counted across the 16 staged agent binaries. Clean introductions, no within-version ambiguity:

| Symbol | First present | Absent through |
|---|---|---|
| `turn_updates` | **2.1.229** | 2.1.227 |
| `silent_turn_reminder`, `tengu_hushed_lark` | **2.1.237** | 2.1.234 |
| `sable_thrush` | **2.1.241** | 2.1.237 |

This boundary is what makes the corpus result meaningful and nearly made it meaningless: **every one of the 1,766 all-version Cowork stretches ≥5 occurred on an agent older than 2.1.237**, before the feature existed. Only the 73-stretch and 326-stretch slices are evidence at all. A version-unaware reading of the same corpus returns a confident, wrong answer.

## Honest scope

One machine, one account. The Cowork post-2.1.237 slice is small — 224 sessions, 1,601 main-thread turns. The stretch reconstruction approximates `k0s` rather than reproducing it: it does not model the `Gj()` skip predicate or `S0s`'s two sentinel-string exclusions, and it resolves three of the five names in `w0s`. Both gaps push the same way — they can only **over**-count silent turns, so the true opportunity count is at most 399, never more.

---

# LESSON 177 — BRIEF MODE, PEWTER_OWL, AND COWORK

**The agent ships two opposite communication contracts. Under brief mode plain assistant text is never shown and every user-facing word must go through a tool; under the PEWTER_OWL variant plain text *is* what the user reads and the tool is for verbatim payloads only. Cowork runs the second. That is why narration in Cowork is ordinary text and needs no tool at all.**

## One namespace, two prompts

```js
var Sp="SendUserMessage", pN="Brief",
    gN="You ended the turn without calling SendUserMessage.",
    mN="Send a message to the user";
```

Ch21/L103 documented the `pewter_owl` gate layer over this tool at 2.1.159 and it re-verifies clean at 2.1.247 (`KY8`/`GH_` are now `S7n`/`jj`). What L103 did not carry is the two prompt bodies, or their consequence for Cowork.

**Brief prompt (`hN`)** — the tool is the only channel:

> Send a message the user will read. Text outside this tool is visible in the detail view, but most won't open it — the answer lives here.

**PEWTER_OWL prompt (`_N`)** — the tool is a *supplement*:

> Send a message the user will read verbatim. Use this for content they need to see exactly as written between tool calls — a generated code snippet, a specific value, a direct reply to something they asked mid-task. **Don't use it for routine narration of what you're about to do, or for your final answer — normal text reaches them for those.**

That last clause is the load-bearing one. `_N` is byte-identical to the description `app.asar` 1.40609.0 attaches to `mcp__cowork__send_user_message`, so **the Cowork build itself asserts that plain assistant text reaches the Cowork user.**

## The brief-mode enforcement loop

Brief mode is not advice; it has a stop hook. If a turn ends without a `SendUserMessage` call, the agent injects a meta user message:

```js
Dts=`In brief mode, plain assistant text is hidden from the user — only ${PE} reaches them. Call it now with your substantive reply for this turn. Do not mention this reminder; the message should read as if you wrote it unprompted…`
```

Guarded by `isBriefEnabled() && !DISABLE_BRIEF_MODE_STOP_HOOK && !agentId` and by the tool actually being present. `isBriefEnabled()` is `w7n()&&fye()||sIt()`, where `fye()` reads `CLAUDE_CODE_BRIEF` or `tengu_kairos_brief`, and `sIt()` is the `pewter_owl_brief` variant.

## `BRIEF_PROACTIVE_SECTION` — the checkpoint pattern, stated outright

When brief mode is on, a system-prompt section (`yN`) prescribes the exact cadence a long pipeline needs:

> If you can answer right away, send the answer. If you need to go look — run a command, read files, check something — ack first in one line ("On it — checking the test output"), then work, then send the result. Without the ack they're staring at a spinner.
>
> **For longer work: ack → work → result. Between those, send a checkpoint when something useful happened — a decision you made, a surprise you hit, a phase boundary. Skip the filler ("running tests…") — a checkpoint earns its place by carrying information.**

Cowork never receives this section, because Cowork is not in brief mode. The cadence is worth borrowing verbatim into skill bodies for exactly that reason.

## The contrast case

The same asar carries a surface where the brief contract is absolute — the Dispatch orchestrator, for remote clients:

> You are the Dispatch orchestrator. The ONLY way to communicate with the user is the `SendUserMessage` tool. **Plain text assistant replies are not rendered — the user will never see them.** … If you are about to emit plain text, stop and call `SendUserMessage` instead.

Two surfaces in one build, opposite defaults. **"Does plain text reach the user" is a per-surface property, not a property of Claude Code**, and a claim about one lane transfers to the other only by accident.

---

# LESSON 178 — THE DARK NARRATION LANE

**A first-class API path for progress narration shipped in August 2026 — `thinking.display`, which asks the server to return the model's between-tool connector text as tagged thinking blocks. The agent can request it and render it. The Cowork UI has no renderer for it at all.**

## The API surface

```js
YD=G("thinking_display_updates","thinking-display-updates-2026-08-18")
```

A real beta header, dated twelve days before this capture, with its own server-rejection path (`retry:thinking-display-updates`, telemetry `tengu_thinking_display_rejected_retry`) that drops the value and the header for the rest of the conversation.

The request value is resolved by:

```js
function iGr(e,t,n){
  if(e==="summarized")return"thinking_and_connector_text";
  if(e==="omitted"&&!n)return"none";
  if(e!=="omitted"&&sGr())return"thinking_and_connector_text";
  return gBs(t)&&wze()?"connector_text":"none";
}
```

**"Connector text" is the model's between-tool-call narration as an API output category** — the same thing L175's prompt section asks for in prose, promoted to a protocol field.

## The client half: narration-tagged thinking blocks

```js
var q2n="narration", Dol="(summarized)";
function Y2n(e){ if(e.type!=="thinking"||!e.signature)return!1; … return G2n(e.signature)===q2n; }
function kYo(e){ if(!e.thinking?.trim())return!1; return Y2n(e)&&wze(); }
function wze(){ let e=V.CLAUDE_CODE_SABLE_THRUSH; return e===!0||e!==!1&&(K2n??=we("tengu_sable_thrush",!1)); }
```

`G2n` base64-decodes a thinking block's `signature` and walks a varint structure (fields 2 → 1 → 8) to a string; if it reads `"narration"`, the block is narration rather than reasoning. Such blocks render through a dedicated `AssistantNarrationSummaryMessage` component with `"(summarized)"` as placeholder. **A thinking block's signature is not opaque to the client** — it carries a routing tag the client reads on every block, memoised in a `WeakMap`.

## Why it cannot reach a Cowork user today

`SABLE_THRUSH`, `sable_thrush`, `narration_summary`, `NarrationSummary`, `connector_text` and `(summarized)` are **all absent from `app.asar` 1.40609.0** — checked from inside `.vite/build`, with a positive control on a string known present in the same files. The renderer is CLI-side only. `sable_thrush` first appears in the agent at 2.1.241, and `tengu_sable_thrush` defaults false.

## A naming collision worth knowing

Ch34/L120 documents a `thinking_display` field on the `set_max_thinking_tokens` control-protocol request — the Desktop's extended-thinking toggle. **That is a different thing at a different layer** from the `thinking.display` API request field above. Same name, one on the Desktop↔agent control channel, one on the agent↔Anthropic wire, with unrelated value sets. Same class as Ch37/L131's `harnessCwd`.

## Not this: the spinner's narration pipeline

`CLAUDE_CODE_ENABLE_NARRATION` / `tengu_pewter_kite_ms` is a **third, unrelated** thing that shares the word:

```js
function nOs(){
  let e=V.CLAUDE_CODE_ENABLE_NARRATION;
  if(e===!1)return null;
  if(e===void 0&&(xt()||Hl()))return null;
  let t=we("tengu_pewter_kite_ms",0);
  if(t>0)return t;
  return e?tOs:null;      // tOs = 30000
}
```

A side model call (`querySource:"narration"`, alongside `prompt_suggestion` / `away_summary` / `agent_summary`), debounced 30 s, fired per tool round, skipped for sub-agents, producing a `{now, next}` pair for the **interactive spinner's status line**. It is not a transcript message and it returns `null` by default in the non-interactive contexts Cowork runs in. Three mechanisms, one word: the prompt section writes narration, `thinking.display` transports it, and this one fabricates a status line that never enters the conversation.

---

# LESSON 179 — READING BEHAVIOUR OUT OF THE CORPUS

**A local machine holds tens of thousands of session transcripts, and they answer questions no binary read can: not what the code would do, but what the model actually did. Three traps in this pass each produced a confidently wrong number before being caught.**

## Where they are

| Lane | Path | Count here |
|---|---|---|
| CLI | `~/.claude/projects/<slug>/<sessionId>.jsonl` | 23,695 |
| Cowork | `…/Claude/local-agent-mode-sessions/<acc>/<org>/local_<id>/.claude/projects/<slug>/<cliSessionId>.jsonl` | 2,250 |

Each record carries `type` (`assistant` / `user` / `attachment`), `isSidechain`, `isMeta`, and a `version` field naming the agent build — which is what makes per-version slicing possible.

## Trap 1 — the glob that skipped 75% of the corpus

`glob.glob(base+"/**/*.jsonl", recursive=True)` returned **553** of 2,250 Cowork transcripts. Python's `glob` does not match path components beginning with a dot, and the Cowork transcript path contains `.claude/projects`. `os.walk` returns all 2,250.

Same class as the `rg`-skips-`.vite/build` trap: **a hidden path component silently truncates the corpus and reports the remainder as the total.** Any tool that hides dotfiles by default will do this. Count the files two ways before trusting either.

## Trap 2 — `type:"user"` is mostly not a user

Tool results are persisted as `type:"user"` records with a `tool_result` content block. Treating every non-meta `user` record as a conversational turn resets any per-turn counter after *every single assistant turn* — which is why a first pass reported a maximum silent stretch of **1** across 19,031 turns. The real maxima are 146 and 103.

The binary agrees; `k0s`'s own boundary test is `a?.type==="user"&&!a.isMeta&&!O1t(a.message.content)`, and `O1t` is the tool-result predicate the naive version omits. A real user turn requires all three: `type==="user"`, not `isMeta`, and no `tool_result` block.

**A structurally impossible result is a bug report about the instrument.** "No session ever went two turns without speaking" was not a finding; one transcript printed by hand showed a 21-turn opening silence.

## Trap 3 — a string hit is not an event

Grepping the corpus for `silent_turn_reminder` returned three files. All three were contamination: two were sessions investigating this very feature, and the third was a **binary string-table dump pasted into a tool result** by an earlier session. Zero were fired events.

Search for the structured record — `attachment.type` — not the name. And date-filter against your own investigation.

## The discipline that made the negative usable

1. **Positive-control the channel.** Before claiming an attachment type never appears, confirm attachment records are persisted at all and that *siblings from the same construction site* appear. 21 types in the Cowork corpus, `total_tokens_reminder` ×1,946.
2. **Version-slice against the introduction boundary.** Establish when the symbol entered the binary, then discard every session older than that. Here it removed 1,766 of 1,839 apparent opportunities and changed the conclusion from "22 misses, feature off" to "zero opportunities, uninformative" to — once the instrument was fixed — "399 misses, feature off."
3. **Prefer an over-counting approximation.** Where the reconstruction cannot match the binary exactly, choose the direction that inflates the opportunity count, so the negative result survives the gap.
