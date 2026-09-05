Updated: 2026-09-05 | Source: **`app.asar` 1.46388.4** (live install, extracted; sha256 `c48a2abd9aeba23843a09f2d5e1ce9207f2bebe9af014ff9ccd70862b136e9d7`) diffed against **`app.asar` 1.46388.3** (sha256 `a7943696d448db842d898f57471f12b6de9f3940041e0d963018d81c171b9d05`), the **in-VM ELF `claude-code-vm/2.1.260/claude`** (sha256 `9811afb5f97224c2c5d3d0ee1e8c316117d298d5ec3e095d5ff0c1dd0e889ca5`), the **Desktop-managed host agent Mach-O 2.1.260** (sha256 `324a7cb441e4f1ce358dcb7107edd8a310e85b8cdaf25fc7087434e7331b5b5b`), and a **live GrowthBook fcache decoded 2026-09-05** (embedded timestamp `1788622324310` = 2026-09-05T15:32:04Z, mode `1p`, 322 features, 176 on / 146 off). **Does NOT move the CLI content baseline.**

Prompted by the `cowork-harness` project's `docs/internal/2026-09-05-desktop-internals-since-3.2.0.md`, then re-derived first-party against this installation's own artifacts. Three of that document's claims are corrected below; its open questions #3, #4 and #6 are closed.

# Chapter 50: Desktop 1.46388.4 — Two Lanes, the Computed-Key Spawn-Env Blind Spot, and Four Flags Named

---

## TABLE OF CONTENTS

180. [Lesson 180 — Two Cowork Lanes, and the Scope That Decides What a Count Means](#lesson-180--two-cowork-lanes-and-counting-scope)
181. [Lesson 181 — The Computed-Key Spawn-Env Blind Spot: Five Keys, Three Sites, Two Shapes](#lesson-181--the-computed-key-spawn-env-blind-spot)
182. [Lesson 182 — `QUESTION_EXTENDED`, Two Writer Sites, and Served-and-Off vs Dark](#lesson-182--question-extended-and-served-and-off)
183. [Lesson 183 — Four Flags Named: `ENABLE_FUNCTION_HOOKS`, `COZY_TEAPOT`, `WISE_COMET`, `MODEL_CATALOG`](#lesson-183--four-flags-named)

---

# LESSON 180 — TWO COWORK LANES, AND COUNTING SCOPE

**A Cowork session runs either desktop-local or remote. The Desktop builds the local lane's environment prompt itself and knows nothing about the remote one's — the remote prompt is authored server-side. And every identifier count you take on an asar is meaningless until you say which of its three trees you counted.**

## The remote prompt is not in any artifact we hold

The `cowork-harness` document reports a remote session describing a per-session disk allowance, preinstalled Chromium/Playwright at `/opt/pw-browsers`, and a two-browser split. First-party, on this installation:

| marker | `app.asar` 1.46388.4 | ELF 2.1.260 | Mach-O 2.1.260 |
|---|---|---|---|
| `pw-browsers` | 0 | 0 | 0 |
| `Your current remote execution` | 0 | 0 | 0 |

Zero in all three. A prompt the model demonstrably received, absent from every binary that could have composed it, is a **server-authored** prompt. This is the same shape as Ch35/L123's starling override, except there the Desktop shipped a fallback text and the server merely *could* replace it; here there is no local text at all.

## Desktop constructs one entrypoint literal, and the agent knows two

`CLAUDE_CODE_ENTRYPOINT:"local-agent"` is assigned at exactly **2 sites**, in two chunks:

- `index.chunk-BinSjUJ8.js` — the main Cowork local-agent spawn (the same object that carries `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:"1"`);
- `index.chunk-BGC9bBBd.js` — a one-shot inference helper (`{...t.cd({oauthToken,apiHost,disableCron:!0,localAgent:!0}), CLAUDE_CODE_ENTRYPOINT:"local-agent", CLAUDE_CODE_TAGS:…, NODE_USE_SYSTEM_CA:"1"}`).

The agent's own entrypoint table carries a **second Cowork entrypoint the Desktop never constructs**:

```js
function Xrr(){switch(rf()){
  case"claude-desktop":case"claude-desktop-3p":case"remote_desktop":return"Claude Desktop";
  case"remote_mobile":return"Mobile";
  case"local-agent":case"remote_cowork":return"Cowork";
  …}}
```

`local-agent` and `remote_cowork` both display as **"Cowork"**. `remote_cowork` appears 8× in `.vite/build` (recognition and classification, never construction) and 21× in the agent. The remote lane's agent is spawned server-side; that is why Desktop has no literal for it and no prompt for it.

## The structural reason remote-lane features are inert locally

`cowork_memory_context` is 0 in the asar and 26 in the agent (`cowork_memory_context_gated` / `_fetched` / `_unchanged` / `_malformed`, plus `cowork_memory_context_notice_failed`). It is fetched here:

```js
let r=await yt.get(gVo,{host:"ccr-session",auth:"session-jwt",
  headers:{"anthropic-version":"2023-06-01",...n&&{"If-None-Match":`"${n}"`}},…});
if(!r.ok){G("warn","cowork_memory_context_gated",{reason:r.reason});return}
```

The gate is not an entrypoint string test. It is the **transport host**:

```js
case"ccr-session":return vz(e).href.replace(/\/$/,"");
function vz(e){let n=kUe();switch(n.status){
  case"absent":throw e==="ccr-session"?Error("ccr-session host requires --sdk-url"):…
  case"rejected":throw …"ccr-session --sdk-url rejected by allowlist"…
  case"ok":return xX(new URL(n.url))}}
```

**`--sdk-url` occurs 0 times in the entire `app.asar` and 41 times in the agent.** So no Desktop-spawned session can resolve the `ccr-session` host, and every feature routed through it — `cowork_memory_context`, and the `/worker/skill-manifest` fetch that shares the host — is structurally unreachable in the desktop-local lane. That is a stronger and more durable statement than "entrypoint-gated": an entrypoint check can be relaxed in one release, a missing flag cannot be worked around from the agent side at all.

## The lane selector is not in the artifact — and that is already explained

The Cowork setting "Only on this computer" chooses the lane. Searching the **entire extracted tree**, case-insensitively, including `.vite/renderer` and `node_modules`:

- `Only on this computer` — **0**; `only on this computer` — **0**
- `onlyOnThisComputer`, `runLocally`, `forceLocal`, `localExecution`, `executeLocally`, `computeLocation`, `runOnDevice` — all **0**
- `on this computer` — 44, none of them the toggle (folder pickers, import dialogs, SSH failures, Remote Control copy)

Neither the copy nor a persisted key is a literal anywhere in the bundle. Read alone this looks like an open question; it is not. **Ch40/L138 already located the decision**: lane selection happens in **claude.ai renderer code** (the `yukon_silver` statsig family, an org bit, and Desktop's capability probe, gate `4116586025`), and Desktop main carries no lane branch at all — which is exactly why no fcache gate can hold the decision and no asar literal can name it. Gate `4116586025` is *absent* from the 2026-09-05 payload, and it was only ever an input to lane **availability**, never the choice.

So the exhaustive negative here is not a new mystery. It is independent corroboration, taken on a bundle sixteen Desktop releases newer than the one L138 was written against, that the selector was never Desktop-side to begin with. The discriminator that *is* readable, per L138, is the session record's `environment_kind` (`anthropic_cloud` = remote, `bridge` = locally executing) — never an id prefix, and never a Desktop setting key.

**Do not re-open a question a negative result has already closed once.** A second exhaustive search of the wrong artifact produces the same zero and feels like new evidence.

Desktop's remote machinery is nonetheless substantial (`.vite/build` scope): `isRemote` 60, `remoteSession` 59, `device_bash` 34, `SendUserFile` 12, `deviceLink` 6, `localAgentMode` 20, plus persisted keys `remoteFolderConsentMemory`, `remoteSessionFolderGrants`, `grantRemoteSessionFolder`.

## The trap: an asar has three trees, and they disagree

Every count above is qualified by `.vite/build`. That qualification is load-bearing:

| identifier | `.vite/build` | `.vite/renderer` | whole `app.asar` |
|---|---|---|---|
| `isRemote` | 60 | 5 | **87** |
| `remoteSession` | 59 | 0 | **61** |
| `device_bash` | 34 | 0 | **36** |
| `deviceLink` | 6 | 0 | **13** |
| `localAgentMode` | 20 | 0 | **22** |
| `SendUserFile` | 12 | 0 | 12 |

`isRemote` differs by 45%. The residue between build+renderer and the whole file is the asar header, `compile-cache`, and `node_modules` — including the **Agent SDK bundled inside the asar** (see L182).

**A correction this produces.** The lead-source reports that 1.46388.4 moved `localAgentMode` 20 → 22 and concludes "it is not a no-op release generally." Measured in one scope across both versions, it did not move:

| identifier | 1.46388.3 `.vite/build` | 1.46388.4 `.vite/build` |
|---|---|---|
| `localAgentMode` | 20 | **20** |
| `isRemote` | 60 | **60** |
| `remoteSession` | 59 | **59** |
| `deviceLink` | 6 | **6** |
| `device_bash` | 34 | **34** |

The "20 → 22" is the build-scope-vs-whole-asar gap of L180's own table, not a version delta. The real 1.46388.3 → 1.46388.4 change is **three build chunks changing size, net −859 bytes** (17,931,404 → 17,930,545 total build bytes); the chunk-name hashes all rotate, so a filename diff reports the whole tree as changed and is useless here. 1.46388.4 is a genuine 0-delta patch for everything tracked.

**Two numbers taken with the same instrument in different scopes are not a time series.** Pin the scope before the version.

---

# LESSON 181 — THE COMPUTED-KEY SPAWN-ENV BLIND SPOT

**Desktop sets five spawn-env keys through a computed property whose name never appears next to the value. Any spawn-env model built by scanning env object literals for ALL-CAPS names misses all five, in three separate code paths, in two different syntactic shapes.**

## Shape A — `[module.const]`, the attribution keys

Two modules each export a name constant as `t`. The `CLAUDE_CODE_SKILL_ATTRIBUTION` producer, in full:

```js
var i="CLAUDE_CODE_SKILL_ATTRIBUTION",a=98304;
function o(e,n){return e.flatMap(e=>{
  if(e.creatorType!=="user"||e.syncManaged===!1||!t.test(e.skillId))return[];
  let r=n(e.name);return r===void 0?[]:[{path:r,skillId:e.skillId,...e.backingPluginId&&{backingPluginId:e.backingPluginId}}]})}
function s(t){if(t.length===0)return;
  let n={};for(let{path:e,skillId:r,backingPluginId:i}of t)n[e]={skill_id:r,...i&&{server_plugin_id:i}};
  let r=JSON.stringify(n);
  if(Buffer.byteLength(r)>98304){e.aN.warn(`[SkillsPlugin] ${i} omitted: ${t.length} skills exceed its ${a}-byte cap`);return}
  return r}
Object.defineProperty(exports,"t",{…get:function(){return i}});
```

Only **user-created, sync-managed** skills are described (`creatorType==="user" && syncManaged!==false`, ids matching the `skill_(staging_|local_)?…` pattern), and the whole payload is **dropped past 98,304 bytes** with a warning — the agent accepts up to 262,144, so Desktop is the stricter half. `CLAUDE_CODE_PLUGIN_ATTRIBUTION` is the symmetric producer for `source==="remote"` plugins, carrying `server_plugin_id`, `marketplace_name`, `installation_preference`.

Because the name is an export, the assignment reads:

```js
// index.chunk-BinSjUJ8.js — the Cowork local-agent spawn
let $e=o.n(Ge); $e&&(K.env={...K.env,[o.t]:$e});
let J=await Ie;  J&&(K.env={...K.env,[s.t]:J});

// index.chunk-B-ezFD8O.js — the CCD spawn path
N&&(e.env={...e.env,[p.t]:N}), d&&(e.env={...e.env,[m.t]:d});
```

Four assignments, **two spawn paths**. The same two keys are set twice over, once for Cowork and once for CCD, so a literal-scanner's miss is duplicated across both of Desktop's agent-spawn code paths.

## Shape B — `[identifier]`, the terminal keys

The lead-source asks whether the pattern goes beyond the attribution keys. It does, in a harder-to-see form. `index.chunk-CmsiOYDG.js` builds the login-shell environment for Desktop's terminal:

```js
var N="CLAUDE_DESKTOP_USER_ZDOTDIR",
    P="CLAUDE_DESKTOP_TERMINAL_NONCE_FILE",
    F="CLAUDE_DESKTOP_TERMINAL_HEADLESS",…
case"zsh":return{kind:s,args:[...t],
  env:{ZDOTDIR:i.default.join(n,"zsh"),[N]:r??"",[P]:a,...o?{[F]:"1"}:{}}};
```

Three more keys, keyed by **bare identifiers** — no module qualifier to grep for. Each of the three occurs **exactly once as a literal in the whole asar**: the `var` line that defines it. They exist to carry a nonce file and a headless marker into a wrapper `.zshrc`/`.zshenv` that runs the user's own dotfiles unchanged and then emits OSC 133 prompt markers.

## The full inventory

| key | shape | site | chunk |
|---|---|---|---|
| `CLAUDE_CODE_SKILL_ATTRIBUTION` | `[o.t]` | Cowork local-agent spawn | `BinSjUJ8` |
| `CLAUDE_CODE_PLUGIN_ATTRIBUTION` | `[s.t]` | Cowork local-agent spawn | `BinSjUJ8` |
| `CLAUDE_CODE_SKILL_ATTRIBUTION` | `[p.t]` | CCD spawn | `B-ezFD8O` |
| `CLAUDE_CODE_PLUGIN_ATTRIBUTION` | `[m.t]` | CCD spawn | `B-ezFD8O` |
| `CLAUDE_DESKTOP_USER_ZDOTDIR` | `[N]` | terminal login shell | `CmsiOYDG` |
| `CLAUDE_DESKTOP_TERMINAL_NONCE_FILE` | `[P]` | terminal login shell | `CmsiOYDG` |
| `CLAUDE_DESKTOP_TERMINAL_HEADLESS` | `[F]` | terminal login shell | `CmsiOYDG` |

**Five distinct keys, seven assignments, three sites, two shapes.** The answer to "curiosity or systematic gap" is *systematic*: it is Desktop's normal way of setting an env key whose name is owned by another module, and it appears in every kind of process Desktop spawns — Cowork agent, CCD agent, and user shell.

## Finding them

The scan that finds all seven, and nothing else, is a computed-key property within 300 characters of the token `env`:

```
\[[A-Za-z0-9_$]{1,4}(?:\.[A-Za-z0-9_$]{1,4})?\]\s*:
```

Run it over `.vite/build` and resolve each key expression to its definition. The only other hits are MCP server-label maps and a proxy-var lookup, both trivially excluded by reading the definition.

## What the keys do

Traced through agent 2.1.260, both attribution keys are **telemetry-only**: parsed into a `path → {skillId, pluginId}` lookup, attached to each loaded skill as `serverAttribution`, and read by a property-bag builder whose call sites are all `tengu_*` emits (`tengu_skill_loaded`, `tengu_skill_tool_invocation`, `tengu_slash_command_forked`, sub-agent dispatch). Their second reader is the child-process env scrubber's allowlist set, which *deletes* them — the same set that carries `CLAUDE_CODE_MODEL_CATALOG_URL`, `CLAUDE_CODE_SYNC_SKILLS`, `CLAUDE_CODE_PLUGIN_CACHE_DIR` and `CLAUDE_CODE_SAFE_MODE`. Setting either by hand changes telemetry attribution and nothing the model sees.

---

# LESSON 182 — `QUESTION_EXTENDED` AND SERVED-AND-OFF

**`CLAUDE_CODE_QUESTION_EXTENDED` is a live AskUserQuestion feature that Desktop and the agent shipped in the same release, gated by a gate that is evaluated and off. And "evaluated and off" is a different fact from "absent" — a distinction that costs a wrong claim in both directions.**

## The Cowork spawn env, verbatim

```js
…MCP_CONNECT_TIMEOUT_MS:"10000"},
...t.RD("1129419822")&&{ENABLE_TOOL_SEARCH:"auto"},
CLAUDE_PREVIEW_CLASSIFIER_FLOOR:"1",
CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:t.RD("66187241")?"true":"",
...t.RD("1595132361")&&{CLAUDE_CODE_QUESTION_EXTENDED:"1"},
CLAUDE_CODE_TAGS:`lam_session_type:${a.sessionType??"chat"}`,
CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:"1",
CLAUDE_CODE_DISABLE_AGENTS_FLEET:"1",…
```

Agent-side the feature is real, not an inert key: `CLAUDE_CODE_QUESTION_EXTENDED` occurs 11× and `extendedQuestions` 5× in 2.1.260 (both the VM ELF and the Mach-O, identically).

## Two writer sites, one of which can delete the key

The second writer is the **Agent SDK bundled inside the asar** (`index.chunk-C8S6RHQs.js`) — which is why L180's whole-asar counts run high, and why "present in the asar" is not the same as "Desktop does this":

```js
de?.askUserQuestion?.previewFormat&&(Ke.CLAUDE_CODE_QUESTION_PREVIEW_FORMAT=de.askUserQuestion.previewFormat),
de?.askUserQuestion?.extendedQuestions ? Ke.CLAUDE_CODE_QUESTION_EXTENDED="1"
  : !se && (for each key of Ke: if key.toUpperCase()==="CLAUDE_CODE_QUESTION_EXTENDED" delete Ke[key])
```

The delete branch runs only when `se` — the caller-supplied `env` — is absent. Cowork's own `query()` call passes `toolConfig:{askUserQuestion:{previewFormat:…}}` with no `extendedQuestions`, **and supplies `env`**, so the delete cannot fire on the Cowork path. An SDK integrator who omits `env` gets the opposite behaviour.

## Served-and-off is not dark

Live fcache, decoded 2026-09-05 (322 features):

| gate | state | reading |
|---|---|---|
| `1595132361` (`QUESTION_EXTENDED`) | `{value:false, on:false, source:"defaultValue"}` | **served-and-off** |
| `2529235968` (plugin-MCP shadow) | `{value:false, on:false, source:"defaultValue"}` | **served-and-off** |
| `124685897` (sub-agent section override) | `{value:true, on:true, source:"defaultValue"}` | on by its own default, no rule matched |
| `1143815894` (host-loop) | `{value:true, on:true, source:"force", ruleId:"fr_mnqhxsok"}` | forced on |
| `4200321681` (auto-mode always-allow override) | `{on:true, source:"force", ruleId:"fr_mrtgqsjd"}` | forced on |
| `1447478638` (scheduled-task auto-approve) | `{on:true, source:"force", ruleId:"fr_mshkzjly"}` | forced on |
| `2307090146` (`cli_plugin`) | `{on:false, source:"defaultValue"}` | still served-and-off |
| `1129419822` (`ENABLE_TOOL_SEARCH`) | **absent from the payload** | genuinely dark |
| `96101707` (multi-account) | **absent from the payload** | genuinely dark |

**A correction this produces.** The lead-source labels `2529235968` — the gate on the plugin-declared-MCP shadow file — **DARK**. It is not dark: it is present in the payload and evaluated to false by its own `defaultValue`. Dark means *absent*, and in this capture only `1129419822` and `96101707` qualify. The two states need opposite handling: a served-and-off gate has a server-side rule surface that can flip it for a cohort tomorrow; a dark gate has no rule surface at all and can only change with a client release. Calling one the other mispredicts which way a feature can arrive.

`source:"defaultValue"` carries a third fact worth reading: `124685897` is ON, but ON *by the gate's own default* with no rule matched — which is consistent with the harness's live probe finding the section text byte-identical to the asar's fallback. The gate enables a lookup; nothing was served into it.

## A key each side does not share

| identifier | `.vite/build` | agent 2.1.260 |
|---|---|---|
| `CLAUDE_CODE_DISABLE_AGENTS_FLEET` | 1 | **0** |
| `CLAUDE_CODE_DISABLE_AGENT_VIEW` | 7 | 8 |
| `disableAgentView` | 3 | 6 |

Desktop sends `DISABLE_AGENTS_FLEET` in every Cowork spawn to an agent that never reads it, while the agent's actual switch is `DISABLE_AGENT_VIEW` — a name Desktop knows (7 build-scope occurrences) but does not use in the 1p spawn. **A spawn-env key present on the producer side proves intent, never effect.** Check the consumer before recording a key as live; Ch29/L115's reading of the fleet vars was written from the Desktop side alone.

---

# LESSON 183 — FOUR FLAGS NAMED

**Agent 2.1.260 exports 600 `CLAUDE_*` env flags. Four that arrived unexplained in the 2.1.246 → 2.1.260 window resolve cleanly, and none of them is what its name suggests.**

Counted from the export table (`CLAUDE_[A-Z0-9_]+:\(\)=>`), which is authoritative — a `strings | grep` over a Bun SEA binary mints fakes by swallowing the next identifier's capitals.

## `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` — hooks as JavaScript modules

```js
var cyt="tengu_plugin_hooks_modules";
var M=()=>!1;
var LWt=()=>a.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS??I(cyt,M());
var le="overridden by the CLAUDE_CODE_ENABLE_FUNCTION_HOOKS environment variable";
var ce={override:"from a local override",
        payload:"from GrowthBook (this session's payload)",
        disk:"from GrowthBook (the disk cache of an earlier session)",
        disabled:"from the default (GrowthBook is off for this session: a third-party provider, or telemetry opted out)",
        fallback:"from the default (a cold GrowthBook cache, no payload yet)"};
```

Default **false**; env wins outright over the flag. The feature is plugin hooks written as **functions in a registered module** rather than shell commands — the binary carries `hooks/register.ts`, `builtin-hooks-module:` and `builtin-hooks-module`, plus a reference linter whose diagnostics enumerate how a hook function may *not* be referenced: "bound to a name", "assigned", "returned", "put in an object", "put in an array", "optionally chained", "put in a template". It also appears in the settings-disable allowlist alongside `CLAUDE_CODE_ENABLE_TASKS` and `CLAUDE_CODE_FORK_SUBAGENT`. This is a real second hook-authoring surface, off by default, and the only new 2.1.260 flag besides `SKILL_ATTRIBUTION` with more than export-table presence in the asar.

## `CLAUDE_CODE_COZY_TEAPOT` — not a boolean

```js
var ba="tengu_cozy_teapot";
function wa(e){return e==="strict"||e==="relaxed"?e:void 0}
function YXn(){return a.CLAUDE_CODE_COZY_TEAPOT??wa(Fl()?.[ba])??wa(EK(ba,null))??"strict"}
```

A **string enum `"strict" | "relaxed"`**, defaulting to `"strict"`. Setting it to `1` or `true` does nothing — `wa()` only admits the two words, and an unrecognised env value is passed through verbatim by the `??` chain rather than validated.

It surfaces as `bashFirstSteer` on the `auto_mode` attachment, and only when bash-first is already on:

```js
return [{type:"auto_mode", autoModeConsentFlow:…, bashFirst:y, ...y&&{bashFirstSteer:YXn()}, steerOnly:d, bypass:o}]
```

`bashFirst` (`y`) is `CLAUDE_CODE_THRIFTY_SONIC` / `tengu_thrifty_sonic`, itself resolved through a cohort assignment (`forced` / `cohort` / `none`) and conditioned on the session's tool set. So `COZY_TEAPOT` is **the strictness of auto-mode's bash-first steer**, inert unless `THRIFTY_SONIC` is on. A sibling, `CLAUDE_CODE_GORSE_PLOVER` / `tengu_gorse_plover`, carries `bashActFirstEnabled`.

## `CLAUDE_CODE_WISE_COMET` — strips thinking from the compaction tail

```js
var j7r="tengu_wise_comet";
function Cen(e){let n=a.CLAUDE_CODE_WISE_COMET;
  if(n!==void 0)return{strip:n,source:"env"};
  if(e!=="adaptive")return{strip:!1,source:"thinking_type"};
  return{strip:I(j7r,!1),source:"flag"}}
```

Three-tier, and the middle tier is the interesting one: **when the thinking type is not `adaptive`, the answer is a hard `false` regardless of the flag**. Only the env var can override that. The consumer counts thinking blocks in the tail compaction preserves:

```js
let y=Cen(f);
t(`compact: kept tail holds ${r} thinking block(s); strip=${y.strip?"on":"off"} (decided by ${y.source}; model=${o}, thinking=${f})`,{level:"info"});
return {marker:y.strip?cn({type:"thinking_stripped",scope:"all"}):void 0, thinkingBlockCount:r, decidedBy:y.source}
```

So `WISE_COMET` **strips thinking blocks from the compaction-preserved tail**, emitting a `{type:"thinking_stripped", scope:"all"}` marker. Default off. Note the minifier reuses the name `Cen` for the `/clear` implementation in a different chunk — resolve by chunk, not by symbol.

## The `MODEL_CATALOG` cluster — a signed, versioned catalog

`CLAUDE_CODE_MODEL_CATALOG` and `CLAUDE_CODE_MODEL_CATALOG_URL` belong to a `[publishedCatalog]` subsystem: the agent fetches a **signed model catalog** carrying `publicKey`, `fetchedAt`, `staleAt` and a `cacheKey`, with replay and rollback guards (`replayed_version`, `catalog_version_rollback`).

`CLAUDE_CODE_MODEL_CATALOG` is the **kill switch**, first in the enable predicate's rejection ladder:

```js
function fs({skipEssentialTrafficGate:P=!1}={}){
  if(co(a.CLAUDE_CODE_MODEL_CATALOG))return"env_off";
  if(lo())return"bare";
  if(!P&&St())return"essential_traffic";
  if(a.ANTHROPIC_UNIX_SOCKET)return"unix_socket";
  if(!bd())return"not_first_party";
  if(!gt())return"not_claude_ai_auth";
  if(Zp()===null)return"no_org";
  let T=tf(); if(T.accountUuid===null)return T.reason;
  if(!Ot("allow_model_catalog"))return"policy";
  return null}
```

`CLAUDE_CODE_MODEL_CATALOG_URL` overrides the source, validated hard: a non-URL is refused (`invalid_url`, "configured catalog URL is not a URL; published path off"), so is an unsupported scheme, and so is a **loopback or metadata host** ("names a loopback or metadata host; published path off") — an SSRF guard on a value the user controls. A `file:` scheme has its own branch. Managed source settings are honoured only from an admin policy origin: "ignoring managed model-catalog source settings from a non-admin policy origin". The whole subsystem sits behind `tengu_delegated_quail`, default `{mode:"off"}`.

`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` and `CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL` sit in the same export group as `CLAUDE_CODE_SUBAGENT_MODEL` (Ch35/L124's model chain). **Their behaviour was not traced in this pass** — the names suggest an override that defeats the frontmatter/Task-param tiers, but that is a guess and is recorded here as one.

## None of these is set by the Cowork spawn

Of the eleven flags added 2.1.258 → 2.1.260, the Cowork local-agent spawn sets exactly one — `CLAUDE_CODE_QUESTION_EXTENDED`, and only when gate `1595132361` flips (L182). The rest are reachable from a terminal session's environment or a GrowthBook rule, and nowhere else.
