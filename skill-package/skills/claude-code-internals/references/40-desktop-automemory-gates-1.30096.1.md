Updated: 2026-08-14 | Source: First-party Desktop `app.asar` diff **1.28929.0 → 1.30096.1** (both extracted from local backups with a purpose-written extractor, each reconciling to within the archive header against its on-disk size), plus the Desktop-managed host agent Mach-O **2.1.227 → 2.1.229**, the live gzip-wrapped `fcache` decoded **2026-08-14** (254 features), and the standalone CLI **2.1.231** bundle from Ch42 for the cross-artifact checks. **Moves the Desktop baseline to 1.30096.1** (from Ch41's 1.28929.0). Prompted by the `cowork-harness` project's 1.30096.1 pass, then re-derived first-party; its two headline claims both survived, one of its counts differs by method, and this pass adds two gates and a structural change it did not report. Everything here is binary-tier — no live run was observed.

# Chapter 43: The Auto-Memory Carve-Out, Three New Gates & a Bundle Reshuffle (Desktop 1.30096.1)

---

## TABLE OF CONTENTS

159. [Lesson 159 — The First ALLOW in the Host-Loop `canUseTool` Chain](#lesson-159----the-first-allow-in-the-host-loop-canusetool-chain)
160. [Lesson 160 — Three New Gates, and a Third Gate State: Declared-but-Unconsumed](#lesson-160----three-new-gates-and-a-third-gate-state)
161. [Lesson 161 — The Frame-Artifacts Consumer Landed Agent-Side](#lesson-161----the-frame-artifacts-consumer-landed-agent-side)
162. [Lesson 162 — Bundle Consolidation, and How to Diff Two Minified asars](#lesson-162----bundle-consolidation-and-how-to-diff-two-minified-asars)

---

# LESSON 159 — THE FIRST ALLOW IN THE HOST-LOOP `canUseTool` CHAIN

**The Desktop's host-loop `canUseTool` wrapper gained a fourth link, and it is the first one that can return `allow`.** Every previous link only denied or fell through.

Verbatim, both builds:

```js
// 1.28929.0
e.canUseTool = async (e,t,n) => ft(e,t) ?? pt(e,t,n.decisionReason,a) ?? q(e,t,n)
// 1.30096.1
e.canUseTool = async (e,t,n) => Ke(e,t) ?? await Xe(e,t,n.decisionReason,j,f) ?? qe(e,t,n.decisionReason,o) ?? K(e,t,n)
```

`Ke` ≡ `ft` and `qe` ≡ `pt` — re-verified term-for-term, only minified names rotated (`t.pp`≡`m.D`, `Z`≡`ut`, `Ge`≡`dt`, `t.ex`≡`t.o`). `Ke` is still Ch35/L122's `/sessions`-is-a-VM-path deny. The new link is `Xe`, and note it is the only **awaited** one.

**What `Xe` does.** It is an auto-memory-directory carve-out that converts a would-be denial into an allow, substituting realpath-resolved paths into the tool input:

```js
async function Xe(e,n,r,i,a){
  if (i===null || !Je.includes(e) || r!==Ge || ($.includes(e) && typeof n.file_path!=="string")) return;
  …
  if (s) return { behavior:"allow", updatedInput:o }
}
```

Four guards, all of which must pass:

| Guard | Meaning |
|---|---|
| `i===null` | a memory directory must be configured, else the link short-circuits — **dormant when unset** |
| `Je.includes(e)` | `Je = [...t.pp.filter(e=>e!=="Grep"&&e!=="Glob"), "MultiEdit"]` → **Read/Write/Edit/MultiEdit**. Derived from the path-gated set (Ch35/L122's `IeA`), with the two multi-path search tools deliberately excluded |
| `r!==Ge` | `Ge = "Path is outside allowed working directories"` — it fires **only** on that exact `decisionReason` |
| `$.includes(e) && typeof n.file_path!=="string"` | writes must carry a string `file_path`; `$ = ["Write","Edit","MultiEdit"]` |

Then per path key (`Z = ["file_path","path"]`): resolve, require containment inside the memory dir (`t.Po(d,[i])`), and **reject any relative component beginning with `.`** — a traversal guard that blocks both `..` escapes and dotfiles. For the three write tools it additionally requires the *parent* to be contained, creates it, and re-checks containment.

**It is not purely an allow.** If a path is genuinely inside the memory dir but the parent cannot be prepared for writing, `Xe` returns a **deny** with its own message (*"…is inside the session memory directory but could not be prepared for writing… this is an app-managed location, not a folder to request"*). So the link introduces a new allow **and** a new deny.

**The cross-layer fact worth more than the feature.** `qe` — the link `Xe` pre-empts — returns `{behavior:"deny"}` when `r===Ge`. But in the **CLI** bundle (Ch42's 2.1.231), that same reason is produced attached to an **`ask`**:

```js
{behavior:"ask", …, decisionReason:{type:"workingDir", reason:"Path is outside allowed working directories"}}
```

So **the agent says *ask* and the Desktop turns it into *deny***, and the reason string is the handoff token between the two layers. That is why `Xe` can intercept it at all: it matches on the token the agent emitted, before the Desktop's own converter runs. Anyone reasoning about Cowork permissions from one artifact alone will get this wrong in whichever direction they looked.

**`autoMemoryHostDir` is present in BOTH asars** (5 occurrences each). The configuration predates this release; only the chain link is new. And because production leaves it unset, the link is **dormant today** — which also means an SDK integrator reimplementing this chain with the old two links diverges from production only once auto-memory activates.

---

# LESSON 160 — THREE NEW GATES, AND A THIRD GATE STATE

**Three gate ids are new at 1.30096.1 and none were removed** — but only one of them is a gate in any operational sense, and the other two occupy a state this skill has not previously named.

| Gate | In live fcache | Occurrences (old→new) | Read site? |
|---|---|---|---|
| `1942337209` | **yes**, `{on:false, source:"defaultValue"}` | 0 → 1 | yes — `un()` |
| `3671534883` | **absent** | 0 → 1 | **no** |
| `942840715` | **absent** | 0 → 1 | **no** |

**`1942337209` is an MCP version-negotiation kill switch with inverted sense.** Verbatim:

```js
function un(){ return t.ld(`1942337209`) }
…
new Qt({name:`local-agent-mode-${e}`, version:`1.0.0`},
  { capabilities:l, ...(u && !un()) ? {versionNegotiation:{mode:`auto`, probe:{timeoutMs:pn}}} : {} })
```

with `pn = 500` and `u = !(i instanceof t.W_)` (a transport-class condition). **The predicate is `!un()`** — so with the gate OFF, as it is live, automatic version negotiation with a 500 ms probe **is active**; flipping the gate ON *removes* it. Read the `!` carefully: dropping it inverts the conclusion.

**Polarity of `t.ld` is provable in place, not assumed.** The only other `t.ld` call in the same chunk is `getSkillSources(){ if(!t.ld("278625510")) return []; … }`. Ch37/L131 established that `getMcpSkillSources` is dead code — and `278625510` is **absent from the live fcache**, hence false, hence the early `return []`. The behaviour we already documented is what an `isEnabled` reading predicts, so **`ld` = isEnabled**. The same site also re-confirms L131's handshake finding at this newer build: `extensions` advertises `io.modelcontextprotocol/ui` unconditionally and the skills extension only behind that dead gate.

**The two others are declared but unconsumed — a third state.** Both appear **exactly once**, inside a client-side defaults table, and nowhere else:

```js
return { 574905726:tk(!0), 1101873029:tk(!1), …, 942840715:tk(!1), "3671534883":tk(!1), … }
```

`tk(x)` is `{defaultValue:x}`. So each is registered with a local default of `false`, has **no read site anywhere in the asar**, and has **no fcache entry**. That is neither "live" nor "dark-launched" in this skill's existing vocabulary — dark-launched implies code exists behind an off switch. Here the switch is declared before any consumer ships. Call it **declared-but-unconsumed**: the mirror image of Ch41/L151's producer-before-consumer env key, and a signal of what is *about* to be built rather than what is hidden.

**Two previously-documented gates have quietly gone.** Reconciling the state layer against these artifacts (rather than restamping it) showed that **`1311049725`** — Ch37/L130's Desktop-side consumption gate for the VCS SDK events — and **`2678393595`** (session watcher pool) are absent from **both** 1.28929.0 and 1.30096.1, and absent from the live fcache, with `278625510` present 3/3 in both as a positive control. So they went **before** this range, and Desktop-side consumption of the VCS SDK events is no longer gate-conditioned in current builds. Both records are now `removed` with `removed_in: "<=1.28929.0"`; the exact build is not pinned by this pass. A gate that vanishes is easy to miss precisely because nothing queries it any more — only a record-by-record sweep surfaces it.

**Methodology, and why two of these were nearly missed:** a numeric-gate regex restricted to *quoted* strings finds `1942337209` and `3671534883` but **not** `942840715`, because the minifier leaves some numeric object keys unquoted (`942840715:` vs `"3671534883":`) depending on whether the literal round-trips. Match both `["'\`](\d{9,10})["'\`]` **and** `[{,]\s*(\d{9,10})\s*:`. Then filter candidates through the live fcache to separate real features from numeric noise — a naive 9–10-digit scan over the tree returns ~1,945 "common" ids, almost all of them coincidental literals.

---

# LESSON 161 — THE FRAME-ARTIFACTS CONSUMER LANDED AGENT-SIDE

**Ch41/L151 recorded that the Desktop wrote `CLAUDE_CODE_COWORK_FRAME_ARTIFACTS` with no consumer in any agent. The consumer has now shipped, and it is visible on both agent artifact classes.**

| Artifact | Count |
|---|---|
| Desktop-managed host agent Mach-O **2.1.227** | **0** |
| Desktop-managed host agent Mach-O **2.1.229** | **14** |
| Standalone CLI **2.1.231** (Ch42/L157) | **6** |
| Desktop `app.asar` 1.28929.0 → 1.30096.1 | 1 → 3 |

**Do not carry a count across artifact classes, or across counting methods.** The `cowork-harness` pass reported **13** on the host agent where this pass counts **14** on the same single `claude.app/Contents/MacOS/claude` binary — a method difference, not a disagreement about the world. And the standalone CLI's **6** is a different binary again. The number is evidence *for the artifact it was taken from* and nothing else; the durable claim is "0 before 2.1.229, non-zero after".

The CLI-side roles are enumerated in Ch42/L157 (runtime-context bit, Cowork identity grouping, case-insensitive child-env scrub). The point this lesson adds is the **timing**: the consumer appears in the host agent at exactly **2.1.229**, one version after L151's "no consumer before 2.1.228" boundary, closing that lead on the axis L151 actually cared about.

**Desktop and CLI moved together this cycle.** The asar's env-var delta is tiny — **+4 / −1** — and every one of them also appears in Ch42's independent CLI diff: `CLAUDE_CODE_ARTIFACT_VIEWER_BASE_URL`, `CLAUDE_CODE_DISABLE_DIR_SYNC`, `CLAUDE_CODE_TURN_UPDATES`, `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS` added, `CLAUDE_CODE_HERON_TALLOW` removed. Two artifacts diffed independently, across different version ranges, agreeing on the same five names is a useful corroboration signal — and a reminder that a "Desktop finding" and a "CLI finding" are often one change seen twice.

---

# LESSON 162 — BUNDLE CONSOLIDATION, AND HOW TO DIFF TWO MINIFIED asars

**1.30096.1 consolidated the bundle: the `.vite/build` chunk count dropped from 368 to 128 while total bytes stayed flat.**

| | 1.28929.0 | 1.30096.1 |
|---|---|---|
| archive size | 40,114,787 | 40,012,751 |
| extracted bytes | 39,983,815 | 39,945,783 |
| files extracted | 473 | 233 |
| `.vite/build` entries | 368 | **128** |
| JS characters | 31,121,040 | 31,087,965 |

Same code, ~240 fewer files. **Any heuristic that maps a chunk filename to a role is now invalid** — the Desktop's own MCP/`LocalMcpServerManager` code in this build lives in `index2.chunk-D18xFq2s.js`, so a rule of the form "`index.chunk-*` is Desktop, `index2.chunk-*` is CLI" produces confident nonsense. Locate code by content, never by chunk name.

**Extraction trap — a partial extract looks like a clean diff.** `@electron/asar extract` run against a *bare backed-up* `app.asar` (no `app.asar.unpacked` sibling, which is what a backup directory holds) throws partway through on the missing native modules — **after** writing some files. It left 413 JS files for one build and 173 for the other, and nothing about the output says it stopped early. Diffing those two trees would have reported a large fabricated "removed" set.

Two defences, both cheap:

1. **Extract with something that tolerates the gap.** A ~20-line reader is enough: parse the 16-byte header, read the JSON index, and for each entry either copy `[8 + headerSize + offset, size)` or skip it when `meta.unpacked` is true (10 such entries per build here, all native).
2. **Reconcile bytes against the archive before believing any diff.** Sum the extracted files and compare to the on-disk asar; both builds here land within the header size. This is the same discipline as the positive control for an absence claim, applied to the corpus instead of the query — and it is what proved the 368→128 drop was a real consolidation rather than a truncated extract.

**Two further traps hit in this pass**, both of the same family — a minified name is meaningful only inside its own chunk:

- Grepping `function qe(` across the whole tree returns vendored Vue/Sentry definitions, not the host-loop link. Scope by signature (`function qe(e,n,r,i)`) or by chunk.
- Resolving an alias like `t.ld` through a tree-wide search for `ld:()=>…` yields five different answers. Resolve it **within the chunk that uses it** — or, better, prove the semantics behaviourally, as L160 does by pairing the unknown call with a second call whose real-world outcome is already documented.
