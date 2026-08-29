Updated: 2026-08-29 | Source: First-party read of the standalone CLI **2.1.250** against **2.1.246 / 2.1.247 / 2.1.233**, the Desktop-managed host-agent Mach-O **2.1.246 / 2.1.247**, and Desktop `app.asar` **1.40609.0** (installed) with **1.37937.1 / 1.28929.0 / 1.24012.1 / 1.24012.0** from local backups. Counts in this chapter were taken with `scripts/count-symbol.js`, which reports ASCII and UTF-16LE separately and refuses a single total when a null-stripped extract disagrees — three earlier counts in this skill were wrong for exactly those reasons. **Does NOT move the CLI content baseline** (still 2.1.231): a targeted surface pass, per-fact provenance only.

# Chapter 47: CLI Surface v2.1.233 → v2.1.250 — Sub-Agent Limits, Bundled-Skill Suppression, and the Artifact Subsystem

---

## TABLE OF CONTENTS

170. [Lesson 170 — Sub-Agent Limits: There IS a Fan-Out Cap, It Refuses, and the Depth Default Is 3](#lesson-170--sub-agent-limits)
171. [Lesson 171 — Cowork Gets At Most Three Bundled Skills](#lesson-171--cowork-gets-at-most-three-bundled-skills)
172. [Lesson 172 — Artifacts Became a Subsystem: 23 Env Vars and a 21-Flag Gate Family](#lesson-172--artifacts-became-a-subsystem)

---

# LESSON 170 — SUB-AGENT LIMITS: WHAT MOVED SINCE L134

> **This lesson is an EXTENSION of Ch38/L134, not a new finding.** A first draft presented the sub-agent
> caps as a fresh discovery correcting Ch35/L121. They were already documented — correctly, and with a
> better reconciliation — in **L134** ("Sub-Agent Fan-Out Caps Now Exist"), which this skill shipped in
> v2.31.0. The draft was written without searching its own corpus; `search.js "concurrent subagent limit"`
> returns L134. It also **regressed** L134 by calling `tengu_amber_kestrel` telemetry when L134 correctly
> had it as a bypass gate. Read L134 first; this records only what has moved since.

**Three deltas against L134, all in the standalone CLI at 2.1.250: the depth default moved 1 → 3, the
per-session spawn cap was REMOVED, and the concurrency cap has two bypasses that turn "it refuses" into
"it refuses unless".**

## Delta 1 — depth default is now 3, and the history is announced

L134 recorded a fallback of **1** (nesting off by default, `DEu=1`, landed 2.1.217). At 2.1.250:

```js
var o = 3, _ = "tengu_hazel_trellis";
function sb(){
  let n = a.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH;              // env wins
  if (n !== void 0) return n;
  let t = rl();
  if (t.maxSubagentSpawnDepthFromGrowthBook === void 0) { … }  // served flag
  …                                                            // fallback 3
}
```

**This was announced.** The CHANGELOG embedded in the 2.1.246/2.1.247 binaries carries, under 2.1.219:
*"Subagents can now spawn nested subagents up to depth 3 by default (was 1); set
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` to disable nesting."* So the real history is **5 → 1 (2.1.217) →
3 (2.1.219)**, every step announced, and all of it landing **before** this skill's own 2.1.231 baseline.
Ch27/L111's "5 levels deep" was version-stamped to 2.1.172 and was true then. The first draft presented
this as a first-party correction and ran no changelog crosscheck — against this repo's own standing rule
to crosscheck the official changelog last.

Note also that `NMr`/`BLr` — L121's hard ceiling of 5, which L134 said "remains the ceiling" — are **absent
from 2.1.250** (0 occurrences). `sb()` is now the only bound.

## Delta 2 — the per-session spawn cap is GONE

L134's second row was *total spawns per session, default 200, `getTotalAgentSpawns() >= cap` throws,
telemetry `subagent_count_cap`*. At 2.1.250, across 2.1.233/246/247/248/250:

| token | occurrences |
|---|---|
| `subagent_count_cap` | **0** |
| `getTotalAgentSpawns` | **0** |
| `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` | 2 — the settings numeric-env allowlist only, **no accessor** |

**The name outlives its reader**, which is the same shape as Ch45's `CLAUDE_CODE_INVOKED_SKILLS`
(declared-but-unconsumed) and is why a name-presence audit did not catch it. **Audit for an accessor, not
a string** — the rule that would have caught this, and did not, because the audit that found
`CLAUDE_CODE_ARTIFACT_DIRECT_UPLOAD` (L172) tests only for the name.

## Delta 3 — "it refuses" is really "it refuses unless"

The concurrency cap (still `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, still default **20**, `var J=20` in
`hzn()`) has **two** early returns before it ever throws:

```js
vt = () => {
  let Cr = hzn();
  if (E.taskRegistry.getConcurrentSubagents() < Cr) return;              // under the cap
  if (x("tengu_amber_kestrel", !1)) return;                              // ← served flag DISABLES the cap
  let Tn = E.getAppState();
  if (BC(E.rootToolSurface.mainLoopModel, fl(Tn), Tn.ultracode)) return; // ← ultracode sessions exempt
  return f("subagent_launch","subagent_concurrency_cap"),
         Rge.of(E.session).recordRefused("concurrency_limit"),
         new jS(`Concurrent subagent limit reached. You can run ${Cr} subagents at once. Do not retry. …`)
}
function BC(e,o,t){ return t === !0 && Ru() && UC(e,o) === "xhigh" }
```

`tengu_amber_kestrel` is a **bypass gate**, exactly as L134 said — `x(id, !1)` returning true skips the
refusal. The first draft called it telemetry, having read it out of the string table where it sits beside
`subagent_concurrency_cap`; **string-table adjacency is not a call-site relationship**, a trap this skill
already documents and repeated anyway. The ultracode exemption is new since L134.

Practical consequence L134 did not state: with `MAX_TOOL_USE_CONCURRENCY` defaulting to **10** and this cap
to **20**, an ordinary single-turn fan-out **queues** and never reaches the refusal. You need background or
nested agents to hit it — so L121's "treat parallelism as an optimisation" guidance survives further than
the first draft allowed.

## What is NOT a correction of L121

L121's header pins its artifacts to host agent **2.1.205** / in-VM ELF 2.1.205. In those binaries:

| token, host-agent Mach-O | 2.1.205 | 2.1.209 | 2.1.217 |
|---|---|---|---|
| `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | 0 | 0 | 5 |
| `tengu_hazel_trellis` / `tengu_amber_kestrel` | 0 | 0 | 2 |

and 2.1.205's dispatch is a hardcoded `if(g>=NMr)throw …` with no env override and no concurrency check at
all. **L121 was correct for the artifacts it named.** This is drift, not error, and the repo's own rule
covers it: *"not found in the bundle I searched" only disproves a claim for that bundle.* A first draft
asserted L121 had "inferred absence from finding only the queueing mechanism" and built a general
methodology lesson on that — attributing a failure that did not happen.

# LESSON 171 — THE `local-agent` ENTRYPOINT GETS AT MOST THREE BUNDLED SKILLS

**From agent 2.1.247 onward, bundled-skill registration short-circuits on `CLAUDE_CODE_ENTRYPOINT === "local-agent"` — the value Cowork hard-sets — collapsing roughly three dozen registrations to at most three. The three survivors carry *different* enable predicates, so the reachable count is 3, 2 or 0.**

**Scope, stated precisely:** the branch tests the literal string `local-agent`. The same module defines `A(e){return e==="local-agent"||e?.startsWith("claude-coworker")===!0}`, and `claude-coworker` / `claude-coworker-terminal` are registered entrypoints that do **not** take this branch and still get the full set. So this is a property of one entrypoint value, not of "Cowork" as a product.

```js
function vJe(){
  let e = ro(); if (e.bundledSkillsInitialized) return;
  if (e.bundledSkillsInitialized = !0, a.CLAUDE_CODE_ENTRYPOINT === "local-agent"){
    if (gN()) Re(), Le(), Ie();
    return;                                   // ← the full registration list below is skipped
  }
  … the full set …
}
function gN(){ return aF() === "local-agent" && HE() && !Ayt() && tXn() }
```

The three survivors resolve, from their own `menuDescription`, to the artifact trio:

| fn | `menuDescription` | `isEnabled` |
|---|---|---|
| `Re()` | "Design guidance for Artifacts" | `cL` |
| `Le()` | "Diagramming guidance for Artifacts" | `cL` |
| `Ie()` | "Runtime capabilities for published Artifacts" | **`Sn`** |

`Sn(){return O0()&&OA()}` is strictly narrower than `cL`, so **`gN()` true yields 3, 2 or 0** — not "three or zero". And `gN()` gates *registration* while `cL`/`Sn` gate *visibility*: registration is not reachability, which this skill records elsewhere as a standing distinction.

`cL` itself begins `if(u())return!1`, where `u()` is `CLAUDE_CODE_DISABLE_ARTIFACT` / `disableArtifact` — so an env var **can** take all three to zero. It cannot restore the ~32 that were skipped, which is the claim that matters.

`gN()` is not simply "the artifact predicate": it is `aF()==="local-agent" && HE() && !Ayt() && tXn()` — normalised entrypoint, not-a-child-session, not-claudecode, and `coworkFrameArtifacts` (which this skill already carries as `env.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS`). Note the short-circuit reads raw `a.CLAUDE_CODE_ENTRYPOINT` while `gN()` reads normalised `aF()`; if those diverge the result is **zero**, not three.

**Verified first-party in two artifact classes; the third is relayed.** Stated carefully because the two first-party ones are *not independent* — the 2.1.247 standalone CLI and the 2.1.247 host-agent Mach-O carry byte-identical minified text here, which is evidence they ship the same bundle rather than two corroborating observations:

| artifact | 2.1.246 | 2.1.247 |
|---|---|---|
| standalone CLI | no entrypoint check | check present |
| Desktop-managed host-agent Mach-O | no entrypoint check | check present, **same minified names** (`ml`,`Ot`,`Dt`,`Lt`) |
| in-VM ELF | — | **relayed, not verified here** — reported by the `cowork-harness` project; no 2.1.246+ ELF is held on this machine |

**It is current behaviour, not a 2.1.247 quirk** — still present in 2.1.248 and 2.1.250, renamed to `gN()`/`Re()`/`Le()`/`Ie()`. Anyone reasoning from "the CLI ships ~35 bundled skills" is wrong about Cowork specifically, and the env var that *looks* like the control (`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`, Ch27/L111) is not consulted on this path at all — though it is **not inert**: it still disables bundled skills later, at invocation, via `Sy()` and the `override_disabled` branch. It cannot bring back what registration skipped.

*(Surfaced by the `cowork-harness` project's 1.40609.0 fidelity pass; re-derived first-party here and extended forward to 2.1.250.)*

---

# LESSON 172 — ARTIFACTS BECAME A SUBSYSTEM

**Ch27/L112 recorded Artifacts as a dark launch behind one master flag, `tengu_cobalt_plinth`. That flag is now a family of 21, and the environment surface has grown to 23 variables of which this skill documented 4.**

## The gate family

`tengu_cobalt_plinth` plus twenty suffixed siblings: `_alder _aspen _bracken _dataviz _fennel _fern _hazel _larch _laurel _madder _moss _osier _rowan _sedge _sorrel _tansy _teasel _thistle _thrift _yew`. The naming is per-feature rather than per-stage, so **the master flag is no longer a single answer to "are Artifacts on"** — each capability carries its own.

## The environment surface

Nineteen variables that this skill did not carry, grouped by what they reach:

| group | variables |
|---|---|
| endpoints | `_ARTIFACTS_API_TOKEN` · `_ARTIFACT_ASSET_BASE_URL` · `_ARTIFACT_LIVE_BASE_URL` · `_ARTIFACT_SYNC_BASE_URL` · `_ARTIFACT_VIEWER_BASE_URL` |
| comments | `_ARTIFACT_COMMENTS_AUTOREACT` (`tengu_sorrel_trellis`) · `_ARTIFACT_COMMENT_FAST_ACK` (`tengu_gorse_pylon`) · `_ARTIFACT_COMMENT_FAST_ACK_FIXED` (`tengu_gorse_sill`) · `_ARTIFACT_COMMENT_RESPONDER` (`tengu_bracken_sluice`, `responderDispatchOptIn`) |
| types | `_ARTIFACT_TYPES` (`tengu_cobalt_plinth_larch`) · `_ARTIFACT_TYPE_CATALOG` (`_rowan`; `/api/frame/types`) · `_ARTIFACT_TYPE_CLOUD_CREATE` (`_hazel`; `/api/frame/types/<id>/create`) |
| storage | `_ARTIFACT_ASSETS` (`/_blob/`, `/api/frame/blob/`, `/agent-upload`, `/agent-list`, `/agent-delete`) · `_ARTIFACT_DB` (`tengu_umber_lattice`; `write_capacity`/`scan_budget`/`response_budget`, `quota-exceeded`, `custody_403`) · `_ARTIFACT_ROOM` |
| lifecycle | `_ARTIFACT_DELETE` (`tengu_cobalt_plinth_alder`) · `_ARTIFACT_PREVIEW` (`tengu_cobalt_plinth_aspen`) · `_ARTIFACT_VERIFY` (**`tengu_osier_pylon_trace`**) · `_ARTIFACT_MCP` |

Two of these are worth pulling out.

**Two of the nineteen default ON**, and only two: `CLAUDE_CODE_ARTIFACT_MCP`
(`Pt(){return Bn.CLAUDE_CODE_ARTIFACT_MCP ?? !0}`, sitting beside *"Runtime capabilities this page declares,
as {name: config}"*) and `CLAUDE_CODE_ARTIFACT_ASSETS` (`Et(){return a.CLAUDE_CODE_ARTIFACT_ASSETS ?? !0}`).
Of the rest, five are URL/token strings with no boolean default and twelve fall through to a gate
defaulting `!1`. *(A first draft claimed `_MCP` was the only one — `_ASSETS` was missed because the two use
different module-local receivers, `Bn.` and `a.`, so a single-receiver sweep sees one of them.)*

**`CLAUDE_CODE_ARTIFACT_PREVIEW` is not merely absent-able — it is absent from this build.** Its accessor
`Yt()` guards on `En(){return ce !== null && !0}`, and `var ce = null` is the only assignment to `ce` in the
module, so `En()` is unconditionally false and the accessor can never return true in the standalone CLI. The
string *"artifact preview is not compiled into this build"* is not a hypothetical. This is a **fourth state
beyond on / off / dark: compiled out**. It does not contradict the `cowork-harness` project's sighting of a
`preview` action at 2.1.247 — that was the *Artifact tool's* action schema, a different surface.

### The gate↔variable pairings needed re-deriving, and two were wrong

A first draft read three pairings out of the **string table**, where a variable name and a gate name sit
adjacent, and got two of them backwards: `_VERIFY` was paired with `tengu_cobalt_plinth_yew` (its real gate
is `tengu_osier_pylon_trace`; `_yew` is read by an unrelated function) and `_COMMENTS_AUTOREACT` with
`tengu_gorse_pylon` (its real gate is `tengu_sorrel_trellis`; `gorse_pylon` belongs to the *adjacent*
accessor `_COMMENT_FAST_ACK`). **String-table adjacency is not a call-site relationship** — a trap this
skill already records, repeated here, and caught only on adversarial review. Every pairing above is now
read from its own `a.<VAR> ?? x("<gate>", …)` accessor.

## One removal

`CLAUDE_CODE_ARTIFACT_DIRECT_UPLOAD` — present in 2.1.233, **absent from 2.1.246 onward** and from the Desktop asar. The registry carried it as live-dark against a 2.1.231 stamp; it is now recorded as removed. Found by auditing every registry env-var name against the raw binary rather than by a diff, which is the only reason a *removal* surfaced at all — a diff of added names would never have shown it.
