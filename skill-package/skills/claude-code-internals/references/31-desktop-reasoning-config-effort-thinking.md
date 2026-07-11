Updated: 2026-07-08 | Source: First-party binary inspection of Claude Desktop `app.asar` **1.19367.0** (the same installed build used for Ch33/L119), extracted with `@electron/asar` and grepped directly (no diff baseline needed — every load-bearing symbol was re-derived fresh from this one build, then cross-checked against the pre-existing 1.18286.0-era Ch28/L114 prose as the textual baseline for what changed). Prompted by the independent `claude-cowork-headless-emulator` project's `docs/internal/2026-07-08-reasoning-config-fidelity-plan.md` — a not-yet-implemented plan document (its own two Fable-asar forensics passes plus the project owner's live UI screenshots and real `~/Library/Logs/Claude/` spawn-log history) proposing to make that project's harness faithfully mirror Cowork's effort/thinking knobs. Every load-bearing binary claim in that plan's §1 was **independently re-derived first-party** against this installation's own `app.asar` before being folded in here — every quoted function body below (`zgi`, `qgi`, `E2t`, `A2t`, `A1e`, the `s1r`/`o1r`/`i1r` model-config map, `BGr`) was grepped fresh from this machine's own binary, not copied from the external doc.

# Chapter 34: Desktop Reasoning Config — Effort & Extended Thinking Are Settings-File-Driven, Not `CLAUDE_CODE_EFFORT_LEVEL`-Backed

---

## TABLE OF CONTENTS

120. [Lesson 120 -- Desktop Reasoning Config: Effort & Extended Thinking Fidelity](#lesson-120----desktop-reasoning-config)

---

# LESSON 120 -- DESKTOP REASONING CONFIG: EFFORT & EXTENDED THINKING FIDELITY

## The question this closes out

Ch28/L114 corrected Ch24/L107's "`--effort medium` is a driver-passed literal" claim, replacing it with "a real per-session `LocalSessions.setEffort/getEffort/getDefaultEffort/setFastMode` IPC family backed by `CLAUDE_CODE_EFFORT_LEVEL`." That correction was **half right**: the IPC family is real, but re-tracing the actual spawn-time resolver in 1.19367.0 shows the value that reaches `--effort <level>` at spawn does **not** come from `CLAUDE_CODE_EFFORT_LEVEL` at all — it comes from a **local settings-file object**, with `CLAUDE_CODE_EFFORT_LEVEL` living on a *different, non-spawn-path* `getDefaultEffort()` implementation elsewhere in the same bundle. Separately: what governs extended thinking, and is the `31999` thinking-token figure (first noted as a bare "driver-passed number" in `cowork-control-protocol.md`) an arbitrary tunable or a fixed constant?

**Headline, confirmed first-party against this installation's own 1.19367.0 `app.asar`:** extended thinking is a **strict boolean** (budget is always exactly `31999` or `0`, never an arbitrary N), and effort is a **per-model enum** resolved from a settings object, with a hardcoded `"medium"` fallback — **both delivered exclusively as CLI flags** (`--effort <level>`, `--max-thinking-tokens <N>` / `--thinking disabled`), never as env vars. `CLAUDE_CODE_EFFORT_LEVEL` is real, but it backs a sibling, non-spawn-path getter, not the value that ships in the Cowork spawn argv.

## Part A — extended thinking: a boolean, budget strictly 31999-or-0

Direct from this build's main-process bundle:

```js
function zgi(e,t,r){return e??t??!r?NX:0}
function A2t(){var e;return((e=Fl())==null?void 0:e.maxThinkingTokens)===0}
```
called at spawn as `maxThinkingTokens:zgi(n.extendedThinkingEnabled, O?.extendedThinkingOverride, A2t())`, where `NX=31999` (also exported as `DEFAULT_MAX_THINKING_TOKENS:NX` in a settings-constant table). `Fl()` is a local settings-object accessor — call sites confirm it backs a Zod-validated settings record with fields including `effort` (string), `effortByModel` (`Record<string,string>`), and `maxThinkingTokens` (used here *only* as an exact-zero kill switch, not a budget value — `A2t()` is a boolean test, `===0`).

**No code path in this build produces a thinking budget other than 31999 or 0.** There is no arbitrary-N path and no per-model thinking-budget map. The UI's "Extended thinking" control is a single on/off toggle, wired through `LocalAgentModeSessions.setExtendedThinking(sessionId, enabled: boolean)` (both args schema-validated — a non-boolean `enabled` throws a validation error naming the argument), which for a **live** session pushes the change immediately:

```js
async setExtendedThinking(t,r){const n=this.sessions.get(t);if(!n)throw new Error(`Session "${t}" not found`);
  if(n.extendedThinkingOverride=r,!!n.query) await n.query.setMaxThinkingTokens(r?NX:0)}
```

`n.query.setMaxThinkingTokens` is the SDK-side wrapper around the **already-catalogued** `set_max_thinking_tokens` control-protocol subtype (`cowork-control-protocol.md`'s `Bv1` blocking dispatcher set) — `async setMaxThinkingTokens(t,r){await this.request({subtype:"set_max_thinking_tokens",max_thinking_tokens:t,thinking_display:r})}`. So the mid-session override path this skill already knew about (`set_max_thinking_tokens`) is confirmed as exactly the mechanism the Desktop's toggle uses, not a separate/parallel one.

**Delivery is a CLI flag pair, never an env var.** `grep -c MAX_THINKING_TOKENS` across the whole bundle turns up exactly 3 hits, and none of them assign it into a spawn `env:` object: (1) the `DEFAULT_MAX_THINKING_TOKENS:NX` settings-constant export quoted above, (2) an SDK-option-name allowlist entry (`MAX_THINKING_TOKENS:()=>Cci`), and (3) an env-var-name string sitting in a masking list (`"MAX_MCP_OUTPUT_TOKENS","MAX_THINKING_TOKENS","MCP_TIMEOUT",...`) that reads/reports env vars rather than setting one at spawn. This matches and extends `cowork-control-protocol.md`'s existing note that "the literal `31999` does not appear anywhere in the in-VM bundle" — it's confirmed here to be a **Desktop-side constant** (`NX`), carried to the agent purely via `--max-thinking-tokens 31999` / `--thinking disabled` argv, on/off per the boolean above.

## Part B — effort: a per-model enum, four model-config classes, hardcoded `"medium"` fallback

The UI exposes five levels — `low / medium / high / extra / max` — where **"Extra" is the display label for the internal value `xhigh`**. The per-model configuration is a single map plus a regex-matched default class, confirmed verbatim from this build's string table:

```js
s1r={
  "claude-haiku-4-5":{modes:["extended"]},
  "claude-sonnet-4-5":{modes:["extended"]},
  "claude-sonnet-4-6":{effortLevels:["low","medium","high","max"],recommended:"low",modes:["auto"]},
  "claude-opus-4-6":{effortLevels:["low","medium","high","max"],recommended:"medium",modes:["extended"]},
  "claude-opus-4-7":{effortLevels:["low","medium","high","xhigh","max"],recommended:"xhigh",modes:["auto"]},
  "claude-opus-4-8":{effortLevels:["low","medium","high","xhigh","max"],recommended:"high",modes:["auto"]}
},
o1r=/^(?:claude-)?(?:fable|mythos)(?:-|$)/,
i1r={effortLevels:["low","medium","high","xhigh","max"],recommended:"high",modes:["auto"],disallowThinkingDisabled:!0}
```

This is **four distinct model-config classes**, not one:
1. **Literal per-model entries with an effort picker** — `opus-4-8`/`4-7`/`4-6`, `sonnet-4-6` (the `s1r` rows with `effortLevels`).
2. **No-effort literal entries** — `haiku-4-5`, `sonnet-4-5`: `{modes:["extended"]}`, **no `effortLevels` key** (no picker shown in the UI).
3. **Regex-default class** — models matching `o1r` (any `claude-`-or-bare `fable`/`mythos` name) fall through to `i1r`'s config when not literally in `s1r`: lookup is effectively `s1r[modelId] ?? (o1r.test(modelId) ? i1r : void 0)`. Note `disallowThinkingDisabled:!0` here — for these models the "Off" option is removed from the thinking picker entirely, so an explicit `extended_thinking:false` for a fable/mythos-class model is off-distribution relative to what the real UI can even produce.
4. **Unknown model id** — no config at all; the picker has nothing to constrain against.

Spawn-time resolution:
```js
effort: qgi(O?.effortOverride, A1e(n.model), E2t())
function qgi(e,t,r){if(e!==void 0)return e; if(t!=="unset")return t??r}
function A1e(e){var r; if(!e)return; const t=(r=Fl())==null?void 0:r.effortByModel; if(t)return jGr(UGr(t,e))}
function E2t(){var t; const e=(t=Fl())==null?void 0:t.effort; return e!=null&&BGr.has(e)?e:"medium"}
BGr=new Set(["low","medium","high","max"])   // note: no "xhigh" in this particular fallback-validation set
```
`A1e(model)` looks up a **per-model override** in the same `Fl()` settings object's `effortByModel` record (keyed by model id, matched via a normalization helper); if that record has no entry, `qgi` falls through to `E2t()`, which reads a **flat** `effort` field off the same settings object, validates it's one of `{low,medium,high,max}` (`BGr`, notably **excluding `xhigh`** — a request for `xhigh` as the *flat* default falls back to `"medium"`, though `xhigh`/`extra` is still reachable as an explicit per-model override or live `setEffort` call), and otherwise falls back to the literal string `"medium"`. **`recommended` (the per-model suggested value in `s1r`/`i1r`) never enters this resolution chain at all** — it is UI-only, used to pre-select a value in the picker, not read by the spawn resolver.

**Delivery is a CLI flag, never an env var**: `effort: qgi(...)` is a JS-level object field consumed by argv construction (`--effort <level>`), and `CLAUDE_EFFORT` as a `process.env` var is confirmed (both here and in `cowork-control-protocol.md`) to be a no-op on the agent side.

## Part C — correcting Ch28/L114 Part C: `CLAUDE_CODE_EFFORT_LEVEL` does not back this spawn value

Ch28/L114 stated the `--effort` value is backed by `getDefaultEffort()`, quoting:
```js
async getDefaultEffort() { return await Uq(), RT().CLAUDE_CODE_EFFORT_LEVEL ?? process.env.CLAUDE_CODE_EFFORT_LEVEL ?? null }
```
and concluded "Desktop has its own per-session UI/IPC layer on top of that same env var." Re-tracing the actual spawn path in 1.19367.0 shows **this framing conflates two separate `getDefaultEffort()` implementations that coexist in the same bundle**:

```js
async getDefaultEffort(){return r.getDefaultEffort()}                                          // thin IPC passthrough
async getDefaultEffort(){return await n.getShellPath(), n.loadUserEnvVars().CLAUDE_CODE_EFFORT_LEVEL ?? process.env.CLAUDE_CODE_EFFORT_LEVEL ?? null}  // env-var reader
```
The **second** one (env-var-backed, same shape as Ch28/L114's quote, only re-minified — `Uq`/`RT` there vs `getShellPath`/`loadUserEnvVars` here, same mechanism) is a **standalone getter**, not proven to feed the Cowork per-session spawn's `effort:` field. The **actual** value that reaches the agent's `--effort` argv comes from `qgi(effortOverride, A1e(model), E2t())` (Part B) — and `E2t()`/`A1e()` both read exclusively from `Fl()`, the **local settings object** (`effort`/`effortByModel` fields, confirmed by the same object's schema validator: `typeof e.effort<"u"&&typeof e.effort!="string"||typeof e.effortByModel<"u"&&!Sgr(e.effortByModel)`, i.e. a Zod-style shape check on exactly those two keys), **never** touching `CLAUDE_CODE_EFFORT_LEVEL` or `process.env` anywhere in that chain.

So: `CLAUDE_CODE_EFFORT_LEVEL` is real (lesson 93's CLI-side global effort-tier pin) and `getDefaultEffort()`-the-env-reader genuinely reads it — but that IPC method is a sibling accessor, not the thing that resolves a Cowork session's actual spawn-time effort. **Anyone citing Ch28/L114's "backed by `CLAUDE_CODE_EFFORT_LEVEL`" claim going forward should read it as: real env var, real getter, but not proven (and now shown not to be) the source of the per-session spawn value** — that source is the settings-file `effort`/`effortByModel` pair, with hardcoded `"medium"` as the final fallback, not the env var.

One naming note in the other direction, confirmed correct: the interface name **is** `LocalSessions` for `getEffort`/`getDefaultEffort`/`setFastMode` (verbatim `ipcRenderer` channel strings: `LocalSessions_$_getEffort`, `LocalSessions_$_getDefaultEffort`, `LocalSessions_$_setFastMode`) — Ch28/L114's naming holds. `setEffort` is unusual in being wired onto **both** `LocalSessions_$_setEffort` and `LocalAgentModeSessions_$_setEffort` channel strings — two interfaces exposing the same operation name, plausibly for the local-vs-bridge session variants Ch33/L119 documents; `setExtendedThinking` by contrast has only ever been found on `LocalAgentModeSessions`.

## Part D — the live-update path also drives `apply_flag_settings`

`setEffort`'s live-session branch (confirmed alongside the `setExtendedThinking` body quoted in Part A) is:
```js
async setEffort(t,r){...this.saveSession(n), n.query && await n.query.applyFlagSettings({effortLevel:r})}
```
`applyFlagSettings` is the SDK wrapper for the **`apply_flag_settings`** control-protocol subtype (already named, without a concrete payload, in Ch26/L109's ~90-subtype inventory and `cowork-spaces-tasks-checkpointing.md`). This confirms its payload shape for the effort case: `{subtype:"apply_flag_settings", settings:{effortLevel:<level>}}`. Combined with Part A's `set_max_thinking_tokens` confirmation, both of this skill's two previously-named-but-unconfirmed mid-session reasoning-override subtypes are now tied to a concrete Desktop call site and payload shape.

## Part E — externally-sourced, not independently re-derived here: the default-effort live-log confirmation

The source plan document ran a **live-log analysis** (not a static grep) against this same owner's real `~/Library/Logs/Claude/cowork_vm_node.log`/`main.log` spawn history across 1290+ real sessions, and concluded the **default emitted effort when nothing is set is a flat `"medium"`**, not the per-model `recommended` value — using `sonnet-4-6` as the disambiguator (its `recommended` is `"low"`, yet 65/65 real spawns showed `medium`) and noting `setEffort` in that history was **only ever called to raise** the level (326× `→high`, 1× `→xhigh`, zero `→medium`/`→low`), consistent with `"medium"` being an untouched fallback rather than an initialized default. **This is relayed from the external project's log analysis, not independently re-verified here** (this installation's own `~/Library/Logs/Claude/` history was not inspected for this lesson) — but it is fully consistent with, and predicted by, the static `E2t()`/`BGr` fallback logic confirmed first-party in Part B.

## Identifier table

| Identifier | Kind | Where | Effect |
|---|---|---|---|
| `zgi(enabled, override, killSwitch)` / `NX=31999` | spawn resolver | main process | Extended thinking is boolean-in, `31999`-or-`0`-out — no arbitrary budget (Part A) |
| `A2t()` | settings read | main process | `Fl().maxThinkingTokens === 0` used purely as an exact-zero kill switch, not a budget |
| `LocalAgentModeSessions.setExtendedThinking(sessionId, enabled:boolean)` | IPC method | main process | Live-session path calls `query.setMaxThinkingTokens(enabled?31999:0)` → `set_max_thinking_tokens` control request (Part A/D) |
| `qgi(override, perModel, flatDefault)` | spawn resolver | main process | Effort precedence: explicit override → per-model settings entry → flat settings default → `"medium"` (Part B) |
| `A1e(model)` / `Fl().effortByModel` | settings read | main process | Per-model effort override, settings-file-sourced, **not** env-backed |
| `E2t()` / `BGr={low,medium,high,max}` | settings read + fallback | main process | Flat default effort; `"medium"` if unset or not in `BGr` (note: `xhigh` excluded from this particular set) |
| `s1r` (4-class model-config map) / `o1r` (fable/mythos regex) / `i1r` (regex-default config) | data | main process | Four model-config classes: picker models, no-picker models, regex-default (fable/mythos, `disallowThinkingDisabled:!0`), unknown (Part B) |
| `CLAUDE_CODE_EFFORT_LEVEL` | env var (cross-ref, corrected relationship) | a **sibling** `getDefaultEffort()` impl | Real, but **not** the source of the Cowork per-session spawn `effort:` value — corrects Ch28/L114 Part C |
| `LocalSessions.{getEffort,getDefaultEffort,setFastMode}` / `LocalSessions`+`LocalAgentModeSessions`.`setEffort` | IPC interfaces | main process | Confirms Ch28/L114's interface naming; `setEffort` uniquely dual-wired onto both interfaces |
| `applyFlagSettings({effortLevel})` → `apply_flag_settings` | control-protocol subtype | live-session update | First concrete payload shape confirmed for this previously name-only subtype (Part D) |

## What this means

- **If you're modeling Cowork's reasoning config faithfully** (a harness, an SDK integration, a headless emulator): extended thinking is a boolean with exactly two possible resulting budgets, never an arbitrary number; effort is a per-model-validated enum with a hardcoded `"medium"` ultimate fallback, not the per-model `recommended`. Both travel exclusively as CLI flags — an env-var-based implementation of either knob does not match production.
- **Ch28/L114's effort correction needs a further correction, not a full reversal.** The IPC family name and existence were right; the "backed by `CLAUDE_CODE_EFFORT_LEVEL`" causal claim was wrong — that env var backs an unrelated sibling getter, not the spawn path.
- **The two previously name-only control-protocol subtypes `set_max_thinking_tokens` and `apply_flag_settings` now have concrete, source-confirmed payload shapes** for the reasoning-config case specifically.

## Honesty & scope caveats

- **First-party (my own greps, this pass, against this installation's own 1.19367.0 `app.asar`):** every quoted function body in Parts A–D, the four-class model-config map, the `LocalSessions`/`LocalAgentModeSessions` interface-naming disambiguation, and the correction to Ch28/L114 Part C.
- **Not independently re-derived here, relayed from the external plan document's live-log analysis:** Part E's flat-`"medium"`-not-`recommended` empirical confirmation. It is corroborated by, and consistent with, the static fallback logic in Part B, but this pass did not itself inspect a live spawn-log history to confirm it.
- **Scope not covered:** the global settings kill-switch UI surface, and the fenced numeric escape-hatch pattern the source plan proposes for a harness's own debug affordance — both are harness-design questions for that project, not Cowork mechanism facts, and are out of scope for this skill.

**Cross-references.** Ch28/L114 (`25-verified-new-v1.18286.0-desktop.md`, Part C — the `--effort` backing-store claim corrected here) · Lesson 93 (`CLAUDE_CODE_EFFORT_LEVEL`, the CLI-side global effort-tier pin this chapter confirms is real but not the Cowork spawn-path source) · `cowork-control-protocol.md` state page (the `--effort medium --max-thinking-tokens 31999` spawn-argv line and the `Bv1`/`set_max_thinking_tokens` dispatcher entry, both extended here with the full resolution mechanism) · Ch23/`23-cowork-spaces-tasks-checkpointing.md` (Ch26/L109 — first named `apply_flag_settings` without a payload; Part D supplies one) · Ch33/L119 (same first-party discipline against the same 1.19367.0 binary, and the `LocalAgentModeSessions`/`LocalSessions` interface-naming precedent this chapter extends).
