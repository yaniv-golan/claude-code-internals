Updated: 2026-08-27 | Source: First-party read of the Desktop-managed host agent Mach-O **2.1.246**, cross-confirmed at **2.1.247** by the `skill-creator-plus` project, with the same constants traced back to that project's own **2.1.222** read. Anchored deliberately to the **code path**, not to either project's prose: this lesson exists because two independent documentation sets — one of them this skill's — described the mechanism in ways the binary does not support, and each was a downstream approximation that drifted in a different direction. **Does NOT move the Desktop or CLI baseline**: a targeted subsystem read, per-fact provenance only. **Extended 2026-08-28** against the standalone CLI **2.1.248** and **2.1.250** plus a corpus of **269 real re-attachment records** on one machine — closing this lesson's one open question (the token estimator), accounting for the three constants it quoted but never explained, and correcting a mistake this lesson's own author made while extending it.

# Chapter 45: What Compaction Re-Attaches — The Skill Budget and Its File-Restore Sibling

---

## TABLE OF CONTENTS

167. [Lesson 167 — Two Caps Govern Skill Content After Compaction, and One of Them Deletes](#lesson-167--two-caps-govern-skill-content-after-compaction)

---

# LESSON 167 — TWO CAPS GOVERN SKILL CONTENT AFTER COMPACTION

**After auto-compaction the agent re-attaches previously-invoked skills under *two* budgets, not one: a per-skill cap of 5,000 tokens that TRUNCATES, and a combined cap of 25,000 tokens across all skills that DROPS a skill outright. Both mutations are written back to the stored copy, so they persist for the rest of the session — but both are conditional in ways neither this skill nor the tooling that teaches skill authors had recorded.**

## The mechanism

Verbatim, agent 2.1.246 (identifiers as they appear in that build):

```js
function oXo(e,t){ if (xc(e) <= t) return e; let n = t*4 - Rge.length; return e.slice(0,n) + Rge }

var W3o=5, q3o=50000, G3o=5000, V3o=5000, K3o=25000, …
var Rge = `[... skill content truncated for compaction; use Read on the skill path if you need the full text]`
```

and the caller that applies them:

```js
let s = Array.from(n.entries()).sort(([,i],[,a]) => a.invokedAt - i.invokedAt);   // most-recent FIRST
for (let [i,a] of s) {
  if (!a.content) continue;                       // (4) already zeroed → skipped forever
  let l = MHe(t, a.content);
  if (l === "attachment") continue;               // (3) already attached → untouched
  let c = (l === "body"), u = oXo(a.content, V3o), d = xc(u);
  if (r + d > K3o) { if (!c) zRt(i,""); continue } // (2) combined cap → ZERO the stored copy
  if (r += d, !c && u !== a.content) zRt(i,u);     // (1) per-skill cap → write truncation back
  o.push({ name:a.skillName, path:a.skillPath, content:u })
}
```

## The two caps

| cap | constant (2.1.246) | unit enforced | what happens |
|---|---|---|---|
| per skill | `V3o = 5000` | tokens | content **truncated** to `t*4 − 100` chars, marker appended |
| all skills combined | `K3o = 25000` | tokens | skill **dropped whole** — stored content set to `""` |

**The character figure is derived arithmetic, not a literal.** `t*4 − Rge.length` = `20000 − 100` = **19,900**. There is no `19900` anywhere in the bundle for a later reader to grep, so any document stating it must show the derivation or it becomes an unsourceable number.

**CORRECTION (2026-08-27, same day).** An earlier version of this lesson gave the marker as 98 characters and the budget as 19,902. **Both were wrong**, and the long-published 19,900 was right all along. Byte-exact from the binary:

```
b' Rge=`\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]'
literal length: 100
```

The template literal **opens with two real newline characters**. The visible text is 98; `Rge.length` is **100**.

The method failure is the reusable part, and it is a new species of the traps this skill already collects. The measurement never touched the binary: the marker text was read out of an extraction cleaned with `re.sub(r'[^\x20-\x7e]','',…)` — which **deletes literal newlines** — and the length was then computed from that reconstruction. A second observer, working independently, reached the same 98 by a different route: `grep -o "\[\.\.\. skill content truncated[^]]*\]"`, a pattern anchored on `[` that **structurally cannot** return a leading newline. Two instruments, one blind spot, the same wrong answer — which is precisely why agreement between two derived measurements is not corroboration.

And the wrong answer was *plausible*: it differed from the established figure by exactly 2, which reads as a satisfying small correction rather than a red flag, and it was used to "correct" a number that was already correct. **When a measurement disagrees with an established value by a suspiciously small amount, suspect the instrument before the value** — and measure the artifact, never a cleaned rendering of it.

**The combined budget is consumed by POST-truncation sizes** — `d = xc(u)`, not `xc(a.content)`. A 40,000-token skill contributes its capped 5,000, not its real size. The intuitive reading is the opposite, and it matters: more skills fit than an author expects, so the combined cap bites later and less predictably than the per-skill one.

**Ordering is most-recently-invoked first**, and the budget is spent in that order. Combined with the point above, this explains the failure shape: **the skill that silently vanishes is rarely the big one** — it is whichever skill was invoked least recently when the budget ran out. An author debugging a missing skill by looking at file sizes is looking in the wrong place.

## Four conditions the naive statement misses

The simple form — *"over-cap skills are truncated, and truncation is permanent"* — is right often enough to be dangerous. The guards:

1. **Write-back is guarded by `!c`.** When `MHe` reports the skill's content is already present in the conversation **body**, the truncated text is *not* stored back; the skill is merely omitted from this pass and the stored copy stays intact.
2. **Zeroing is guarded by the same `!c`.** An over-budget skill whose content is in the body is not zeroed either.
3. **`l === "attachment"` skips entirely.** A skill already present as an `invoked_skills` attachment is neither re-attached, truncated, nor zeroed.
4. **`if (!a.content) continue` is what makes zeroing persistent.** Once a skill's stored content is `""`, every later re-attachment in that session skips it at the top of the loop. The deletion is durable for the session — not re-evaluated per compaction.

So "permanently" and "outright" are true on the not-in-body path and have an exception on the other. The **disk file is never touched**: `Read` on the skill path recovers the full text, which is exactly what the truncation marker tells the model to do.

### Which "path" the model actually recovers from (added 2026-08-28)

That sentence is right, but for a reason worth pinning — the obvious reading of it is wrong, and this lesson's author believed the wrong one long enough to publish it to a peer project.

The `path` field that reaches the model is **not** a file location. The loader stores `` `${source}:${name}` `` (bare `name` when `source` is falsy), the attachment carries it verbatim, and the renderer prints `### Skill: <name>` then `Path: <path>`. Across 269 real attachments every value is a source-qualified identifier — `plugin:superpowers:writing-plans`, `builtin:init`, `projectSettings:cowork-harness` — never a path. `source` is a closed enum set by the loaders (`plugin`, `bundled`, `builtin`, `user`, `project`, `projectSettings`, `userSettings`, `policySettings`, `memoryStore`, `mcp`). Nested command names are colon-joined *relative directory segments*, so a value can be path-**derived** without being a path.

Recovery nevertheless works, through a different channel. The loader prepends

```
Base directory for this skill: <absolute dir>
```

to the stored content. Truncation is **head-preserving** (`e.slice(0,n) + marker`), so that line survives by construction: it is the first thing in the string and the cut is at the far end. Measured — **586/651** attached entries carry it, **99/101 truncated entries** carry it.

**The exception is the operational part**, and it is *three* states rather than two. Each path in the corpus is consistently one of them — no path is ever observed both with and without the line — but the predicate is **directory durability**, not source kind, and a first pass here got that wrong by generalising from a prefix.

1. **A durable directory the skill owns** — an installed `SKILL.md` in its own folder (plugin, user, project). Absolute path, still there later. Recovery works. This is 586/651 entries.
2. **No directory at all** — single-file `commands/*.md` (a plugin's or `.claude/`'s) and some builtins. The recovery instruction cannot fire, but nothing misleads: there is no path to try. The sharpest illustration ships inside one plugin — `superpowers:brainstorming`, a `SKILL.md` owning its folder, carries the line in 81/81 records; `superpowers:brainstorm`, the single-file command beside it, in 0/17.
3. **A directory that can evaporate** — a **bundled** skill, extracted at runtime under

   ```
   <tmp>/bundled-skills/<CLI version>/<16 random bytes as hex>/<skill>
   ```

   built by a root function that memoises `join(tmpdir(), "bundled-skills", VERSION, randomBytes(16).hex)`. The name is **random per run, not a content hash**, and the directory is version-stamped and lives in the temp tree. A real record carries `…/bundled-skills/2.1.181/8543ac…/verify`; on the machine that produced it, that path — and the entire `bundled-skills` root — **no longer exists**.

**State 3 is worse than state 2**, and it is the reason this section is worth its length: the recovery instruction *looks* executable and fails. A model that has just lost 80% of a skill body is handed an absolute path and gets an error, which is a worse position than being handed nothing.

*Inference, flagged as such:* the acute case should be **resume**. Re-attachment inside a live run still resolves, because that run created the directory. But the transcript-replay path re-registers stored content verbatim on resume, and the root is re-randomised per run and stamped with the CLI version — so a resumed session, or one that outlived an upgrade or a temp sweep, should carry a base directory pointing at a directory that is gone. Both halves are verified independently; the failing `Read` has **not** been observed, so this is reasoning from two measurements, not a measurement.

Also unexplained, and left that way: three bundled skills in the corpus (`artifact-design`, `artifact-diagramming`, `fewer-permission-prompts`) carry no base directory at all, while `bundled:verify` does. The prefix does not predict the state, which is precisely the generalisation to avoid.

**So the rule is about durability, not ownership or provenance:** a skill installed in a directory that persists is recoverable; a single-file command has nothing to recover from; a bundled skill's path is valid only for as long as the run that extracted it.

Method note, which is the reusable part: the author checked the `path` field, found an identifier, and concluded the marker's instruction was unexecutable — relaying that to another project before checking it. It was refuted by reading the **content**, a different field entirely. *Verifying that one channel does not carry a thing is not evidence that no channel does.*

## What the budget counts — and what it does not

`tXo` opens with `let n = N3n(e)`, and `N3n` resolves through an import alias (`cqd as N3n`, `Ox as cqd`) to:

```js
function Ox(e){ let t = e ?? null, o = new Map;
  for (let [r,s] of n().invokedSkills.skills()) if (s.agentId === t) o.set(r,s);
  return o }
```

Two facts follow, and neither is guessable from the loop alone.

**Reference files are exempt, verified.** The map is built from a dedicated **`invokedSkills` registry**, populated by *invoking a skill*. It never scans messages and never inspects tool results, so a `references/*.md` you pull in with `Read` is a plain tool result that this budget does not see. Moving prose out of a `SKILL.md` into a reference file therefore genuinely removes it from **both** caps — it does not reappear in the shared budget when the reference is later read. (What it does *not* buy is permanence: reference content sits in ordinary conversation context and is subject to ordinary compaction, with **no marker** when it goes. The skill body announces its own truncation; a compacted-away reference does not. See the observability section below.)

**The budget is PER AGENT, not per session.** The map is filtered by `s.agentId === t`, where `t` is the agent whose attachment is being built and `null` is the main thread. So a sub-agent's invoked skills are budgeted separately from the main thread's, and a fan-out of sub-agents does not spend the main thread's 25,000 tokens. The sibling functions confirm the registry is agent-scoped and pruned on agent exit: `Fx` forgets every entry whose `agentId` is null or absent from the live set, and `Ex` forgets all entries for one agent.

Correcting a natural misreading, which this lesson made before resolving the symbol: `N3n(e)` takes an **agentId**, not a message list. Nothing here walks the transcript.

## ADJACENT MECHANISM: the three constants this lesson quoted but never explained

The constants block above carries `5`, `50000` and a second `5000` alongside the two caps. They are **not** part of the skill budget. They belong to the **post-compaction file restore**, assembled by the same function, and they matter here because they qualify the exemption claimed just above.

- **5** — the restore list is sliced to five files
- **5,000** — a per-file token cap applied while re-reading each one
- **50,000** — a combined cap across the restored files

The backing store is the read-file cache: an LRU of **5,000 entries / 26,214,400 bytes (25 MiB)**, held per tool-use context.

**"The five most recently read files" is wrong as a summary** — the slice runs *last*, over an already-filtered set. Excluded first: memory files (`User`/`Project`/`Local`/`Managed`/`AutoMem`), the agent's own plan file, and any file whose `Read` still survives in the retained messages (those are subtracted, since the content is already present). A fourth exclusion — pinned memory-directory entries — is applied **only when the caller passes the flag that partial compaction passes**, so *microcompaction restores a different file set than full compaction does*. An author predicting which files come back from recency alone will be wrong.

**What this does to the reference-file guidance.** Reference files remain exempt from both skill caps — that is unchanged and was verified through the registry, not inferred. But they are not therefore *outside every budget*: a `references/*.md` you pulled in with `Read` is a candidate for this restore path, competing for five slots against every other file read, truncated at its own 5,000-token cap. Moving prose out of a skill body moves it into a **different, larger, five-slot** budget rather than out of all of them.

**Scoping the per-agent claim honestly.** The cache is per tool-use context, and every dispatch path currently gives a child either a fresh cache or a copy (a genuine dump-and-reload, not a shared handle) — so a fan-out of sub-agents does not spend the main thread's file-restore budget, matching the skill registry's own agent scoping. But that is a property of **today's callers, not of the mechanism**: the dispatch reads an override slot that would pass a shared reference straight through if a caller supplied one, and the forked-skill path uses that slot (safely, because it constructs a fresh cache to hand over). Treat "never shared" as a current-callers observation. One further path — a merge in the SDK layer — was **not traced**, so this lesson does not claim the resume path is the *only* way entries merge back.

## Three callers, all local to the assembler

The re-attachment runs from exactly three call sites, all inside the assembler's own chunk and never exported from it: reactive compaction, full compaction, and **partial compaction**. That third one is microcompaction (Ch32/L118's `microcompact_boundary`), which matters for how often any of this fires: a survey that counts only full-compaction boundaries undercounts the exposure. A whole-binary grep for the assembler's name also returns an unrelated same-named function in a vendored UI module, plus a separate cross-chunk export of the same three letters — homonyms, not call sites.

## Only ONE of the two failures is observable, and it decides what advice can work

This is the operational difference between the two caps, and it is easy to miss because both are described as "silent".

| | what the model sees | can it notice? |
|---|---|---|
| per-skill **truncation** | the content, **with the marker appended** — `o.push({…, content: u})` where `u = oXo(a.content, V3o)` ends in `Rge` | **yes** — the marker is in-band and its own text says *"use Read on the skill path if you need the full text"* |
| combined-cap **zeroing** | nothing — the over-budget branch `continue`s before the `o.push`, so the skill is absent from the attachment entirely | **no** — there is no marker, no entry, and no baseline to notice an absence against |

The consequence for anyone writing recovery guidance into a skill: **an instruction of the form "if a later section of this file appears to be missing, say so and re-read it from disk" is sound for truncation and cannot fire for zeroing.** In the truncated case the model has an explicit in-band signal telling it exactly that. In the zeroed case the skill simply is not there that turn — and a model has nothing to compare against, because the missing thing is the very instructions that would have told it to look.

Write the recovery instruction anyway; it is the highest-value line available and it covers the case that actually announces itself. But **do not let it read as covering both**, or it becomes the thing it was meant to prevent: apparent coverage over a silent failure. Note also `if (o.length === 0) return null` — when every skill is dropped there is no `invoked_skills` block at all, so the absence is total rather than partial.

*(Question posed by the `creative-problem-solving` session, which asked whether the precondition held before building on it rather than after — the answer changed the shape of its plan.)*

## What it looks like in practice (corpus, 2026-08-28)

This lesson was a pure code read until now. One machine's transcripts, parsed structurally:

| | |
|---|---|
| re-attachment records | **269** |
| skill entries across them | **651** |
| entries carrying the truncation marker | **101** |
| length of every truncated entry | **exactly 20,000 characters** |
| most skills in one record | **7** |
| largest combined estimated size observed | **17,207** — never near the 25,000 cap |

Two things follow. **Co-invocation of six or seven skills is ordinary**, not exotic — so the combined cap is not protected by rarity, it is protected by typical skills being small. The zeroing branch is reached only when enough *large* skills are live at once; every one of the 101 truncations, by contrast, is a routine event. And **truncation is the common failure, zeroing the rare one** — which is the opposite of the emphasis a reader takes from the caps alone.

Also visible: the registry accumulates entries nobody chose, including an auto-loading bundled skill and `builtin:` commands, so an author does not control the whole occupancy of the shared budget.

**Counting trap, recorded because this lesson's author fell into it while writing this section.** A first pass reported 271 records. That count came from grepping the marker/type string across a whole directory tree, which swept in a peer project's notes and a stored tool-result dump alongside the transcripts. **A text grep cannot distinguish a re-attachment from a document that discusses re-attachment** — and this file is now itself such a document, so the trap gets worse over time. Parse the structured record; state the predicate and the capture date, as above, or the number is unverifiable a week later.

## Pin values, not names — three builds, three namings

| build | per-skill | combined | source |
|---|---|---|---|
| 2.1.222 | `Nvy = 5000` | `$vy = 25000` | `skill-creator-plus`, 2026-08 |
| 2.1.246 | `V3o = 5000` | `K3o = 25000` | this lesson, first-party |
| 2.1.247 | `XJo = 5000` | `ZJo = 25000` | `skill-creator-plus`, cross-confirmed |
| 2.1.248 | `yOn = 5000` | `_On = 25000` | this lesson, first-party (standalone CLI) |
| 2.1.250 | `_On = 5000` | `bOn = 25000` | this lesson, first-party (standalone CLI) |

The minified identifiers rotated at **every** build; the values did not move across 25 versions.

**The last two rows are the strongest form of the argument.** `_On` is the *combined* 25,000 cap at 2.1.248 and the *per-skill* 5,000 cap at 2.1.250 — one release apart. A note pinned to that symbol is not merely stale a build later, it is **inverted**, and it will still parse as plausible to whoever reads it. Rotation makes a name useless; reuse makes it actively misleading.

*Artifact-class note:* the 2.1.222/2.1.246/2.1.247 rows were read from the Desktop-managed host agent, the 2.1.248/2.1.250 rows from the standalone CLI. The symbols were checked to match in both artifacts at 2.1.246 (`oXo`, `W3o`, `Rge` are present in each), so the two carry the same bundle here and no claim in this lesson depends on the distinction — but the column is headed "build", and elsewhere in this skill that assumption does not hold. A note pinned to `Nvy`/`$vy` reads as stale on sight and is unverifiable a build later, while the same note pinned to *"5,000 per skill / 25,000 combined, in the re-attachment loop"* survives. Same discipline as Ch35/L124's `_y` and Ch43's resolve-aliases-within-their-own-chunk.

## RESOLVED (2026-08-28): the token estimator is `Math.round(chars / 4)`

An earlier version of this lesson declined to claim this, and was right to at the time. It is now resolved, **identically in all four builds checked**:

```js
function sc(e,t=4){ if (typeof e!=="string") return 0; return Math.round(e.length/t) }   // 2.1.248, 2.1.250
function  m(e,n=4){ if (typeof e!=="string") return 0; return Math.round(e.length/n) }   // 2.1.246, via alias
```

It is a character heuristic, not a tokenizer. The sibling `ept(e,ext)` passes a divisor of 2 for `json`/`jsonl`/`jsonc` and 4 otherwise; the re-attachment truncator calls the bare form, so **4**.

**The consequence is that the "token" gate is exactly a character gate**, with no conversion error at all. `Math.round(20002/4) = 5001 > 5000` truncates; `Math.round(20001/4) = 5000` does not. So the thresholds are exact: **truncation triggers at 20,002 characters, the last safe length is 20,001, and the survivor is always exactly 20,000** (19,900 + the 100-character marker). All 101 truncated entries in the corpus are exactly 20,000 characters. A char-based lint over a skill body is therefore measuring the *right* unit — the common claim that it overstates overage because prose runs above four characters per token is wrong, because nothing here ever counts tokens. (Two residual imprecisions, both negligible at these sizes: `.length` and `.slice` count UTF-16 code units, so `wc -m` differs on astral characters and a cut can land mid-surrogate; and what is measured is the rendered skill prompt, not the file on disk.)

### The method that resolved it — and the one that did not

Proximity fails outright: nine `function sc(` definitions exist in the 2.1.248 JS, several inside module closures.

What appeared to work was **export uniqueness** — exactly one chunk in 2.1.248 exports a bare `sc`, and the re-attachment chunk imports it alongside `ept`/`M_e`. Applying the same scan to 2.1.246 returned **zero** chunks exporting a bare `xc`, which this lesson briefly read as "not resolvable in that build". That conclusion was an artifact of the instrument. 2.1.246 predates the chunk consolidation of Ch43/L162 and uses **mangled cross-chunk aliases**; the truncator's chunk imports `nNb as xc`, and `nNb` is exported as `m as nNb`, reaching the definition above.

So the technique that works in **both** layouts is: **read the consuming chunk's own `import` statement, then follow the alias through the exporting chunk's `export` block.** A bare-name export grep silently false-negatives on an alias-mangled bundle — the same family as this skill's other instrument traps (a hidden dot-directory `rg` skips, a gzip-wrapped cache a raw grep reports as empty). Each one produced a confident *absence*, and an absence is exactly what a broken instrument returns.

## Why this lesson is anchored to code rather than to documentation

Two independent projects documented this mechanism before this skill had any lesson on it, and **both overstated it in the same place** — asserting the write-back and the zeroing unconditionally, because the `!c` guards are easy to miss and the common path behaves as described. One of the two also carried the overstatement into a **lint rule's message**, which is the highest-leverage place to be wrong: it reaches an author at the moment they are deciding what to change, and it propagates into every skill written with that tool.

The finding did not come from a binary diff. It came from two documents agreeing with each other and disagreeing with the artifact — and was only caught because someone re-read the loop instead of reconciling the prose. **Agreement between two derived sources is not corroboration; it is frequently the moment before the first check.** Cross-project consensus should raise the priority of verification, not substitute for it.

*(Both projects' texts are recorded here as of 2026-08-27 and were being corrected as this shipped; the observation above is about the class of error, not a standing claim on either repo's current wording.)*
