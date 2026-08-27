Updated: 2026-08-27 | Source: First-party read of the Desktop-managed host agent Mach-O **2.1.246**, cross-confirmed at **2.1.247** by the `skill-creator-plus` project, with the same constants traced back to that project's own **2.1.222** read. Anchored deliberately to the **code path**, not to either project's prose: this lesson exists because two independent documentation sets — one of them this skill's — described the mechanism in ways the binary does not support, and each was a downstream approximation that drifted in a different direction. **Does NOT move the Desktop or CLI baseline**: a targeted subsystem read, per-fact provenance only.

# Chapter 45: The Skill Re-Attachment Budget — Two Caps, and What Survives Them

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
| per skill | `V3o = 5000` | tokens | content **truncated** to `t*4 − 98` chars, marker appended |
| all skills combined | `K3o = 25000` | tokens | skill **dropped whole** — stored content set to `""` |

**The character figure is derived arithmetic, not a literal.** `t*4 − Rge.length` = `20000 − 98` = **19,902**. There is no `19902` (or `19900`) anywhere in the bundle for a later reader to grep, so any document stating it must show the derivation or it becomes an unsourceable number. The marker is **98** characters; a widely-repeated 19,900 comes from assuming 100.

**The combined budget is consumed by POST-truncation sizes** — `d = xc(u)`, not `xc(a.content)`. A 40,000-token skill contributes its capped 5,000, not its real size. The intuitive reading is the opposite, and it matters: more skills fit than an author expects, so the combined cap bites later and less predictably than the per-skill one.

**Ordering is most-recently-invoked first**, and the budget is spent in that order. Combined with the point above, this explains the failure shape: **the skill that silently vanishes is rarely the big one** — it is whichever skill was invoked least recently when the budget ran out. An author debugging a missing skill by looking at file sizes is looking in the wrong place.

## Four conditions the naive statement misses

The simple form — *"over-cap skills are truncated, and truncation is permanent"* — is right often enough to be dangerous. The guards:

1. **Write-back is guarded by `!c`.** When `MHe` reports the skill's content is already present in the conversation **body**, the truncated text is *not* stored back; the skill is merely omitted from this pass and the stored copy stays intact.
2. **Zeroing is guarded by the same `!c`.** An over-budget skill whose content is in the body is not zeroed either.
3. **`l === "attachment"` skips entirely.** A skill already present as an `invoked_skills` attachment is neither re-attached, truncated, nor zeroed.
4. **`if (!a.content) continue` is what makes zeroing persistent.** Once a skill's stored content is `""`, every later re-attachment in that session skips it at the top of the loop. The deletion is durable for the session — not re-evaluated per compaction.

So "permanently" and "outright" are true on the not-in-body path and have an exception on the other. The **disk file is never touched**: `Read` on the skill path recovers the full text, which is exactly what the truncation marker tells the model to do.

## Pin values, not names — three builds, three namings

| build | per-skill | combined | source |
|---|---|---|---|
| 2.1.222 | `Nvy = 5000` | `$vy = 25000` | `skill-creator-plus`, 2026-08 |
| 2.1.246 | `V3o = 5000` | `K3o = 25000` | this lesson, first-party |
| 2.1.247 | `XJo = 5000` | `ZJo = 25000` | `skill-creator-plus`, cross-confirmed |

The minified identifiers rotated at **every** build; the values did not move across 25 versions. A note pinned to `Nvy`/`$vy` reads as stale on sight and is unverifiable a build later, while the same note pinned to *"5,000 per skill / 25,000 combined, in the re-attachment loop"* survives. Same discipline as Ch35/L124's `_y` and Ch43's resolve-aliases-within-their-own-chunk.

## Deliberately NOT claimed: the token estimator

`xc` (`Lc` at 2.1.247) computes the token size, and **it is not resolved here.** Three different `function xc(` definitions exist in that JS region — a shell-AST walker, a port-range mapper, and a Windows drive-letter test — none a counter, so it is a cross-chunk import and proximity resolution returns the wrong answer. A `Math.round(chars/4)` model is widely documented and the `t*4` in the truncator is consistent with it, **but this lesson does not assert it**, and any document calling that estimator "binary-verified" is over-claiming. Nothing operational depends on it: the character budget is what tooling gates on, and `t*4` is load-bearing there regardless of what computes `tokens()`.

## Why this lesson is anchored to code rather than to documentation

Two independent projects documented this mechanism before this skill had any lesson on it, and **both overstated it in the same place** — asserting the write-back and the zeroing unconditionally, because the `!c` guards are easy to miss and the common path behaves as described. One of the two also carried the overstatement into a **lint rule's message**, which is the highest-leverage place to be wrong: it reaches an author at the moment they are deciding what to change, and it propagates into every skill written with that tool.

The finding did not come from a binary diff. It came from two documents agreeing with each other and disagreeing with the artifact — and was only caught because someone re-read the loop instead of reconciling the prose. **Agreement between two derived sources is not corroboration; it is frequently the moment before the first check.** Cross-project consensus should raise the priority of verification, not substitute for it.

*(Both projects' texts are recorded here as of 2026-08-27 and were being corrected as this shipped; the observation above is about the class of error, not a standing claim on either repo's current wording.)*
