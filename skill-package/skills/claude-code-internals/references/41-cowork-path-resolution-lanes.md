Updated: 2026-08-27 | Source: A **withdrawal**. First-party re-derivation against Desktop `app.asar` **1.37937.1** (raw-`grep -a` enumeration; see the extraction warning in L166) plus the Desktop-managed host agent Mach-O **2.1.246**, a `grep -a` bisection across all **21** archived asars (1.18286.2 → 1.37937.1), and — decisively — **this skill's own Ch40 live probes** (Desktop 1.25927.0 / agent 2.1.221, 2026-08-05). Prompted by the `cowork-harness` project's path-resolution investigation, whose live probes at 1.37937.1 corroborate but are **relayed, not first-party here**. **Does NOT move the Desktop baseline** (still 1.30096.1, Ch43): this is a targeted subsystem correction, not a refresh — per-fact provenance carries 1.37937.1, the global stamp does not. This chapter retracts a claim this skill published and repeated across four chapters, the state layer, and its author-facing guidance.

# Chapter 44: Path Resolution in Cowork — A Withdrawal, and the Two Path Forms

---

## TABLE OF CONTENTS

163. [Lesson 163 — The Bash cwd Was Never the Outputs Directory](#lesson-163--the-bash-cwd-was-never-the-outputs-directory)
164. [Lesson 164 — Two Tool Families, Two Path Forms](#lesson-164--two-tool-families-two-path-forms)
165. [Lesson 165 — `Write`'s Result Carries the Raw Input](#lesson-165--writes-result-carries-the-raw-input)
166. [Lesson 166 — Surface Separation, and Two Greps That Lie](#lesson-166--surface-separation-and-two-greps-that-lie)

---

# LESSON 163 — THE BASH cwd WAS NEVER THE OUTPUTS DIRECTORY

**`mcp__workspace__bash` starts at the session root `/sessions/<id>` under host-loop — with and without a connected folder, and it always did. The Desktop's shipped system prompt claimed it started in the outputs directory until Desktop 1.32885.1 corrected the text. This skill copied that prompt and published it as behaviour. The behaviour never changed; the claim was simply wrong, and it is withdrawn here.**

## What was published, and where it came from

Ch24/L107 quoted the Desktop-injected prompt verbatim and drew the wrong conclusion from it: *"one shared scratch space, two path namespaces"*, with the guidance *"use bare filenames with both"*. That framing propagated to Ch35/L124's `first-folder-else-outputs` rule, to `state/cowork-architecture.md`, to `state/cowork-permissions.md`, to `troubleshooting.json`, and — worst — into `state/author-facts.json`, which is direct instruction to skill authors.

## The measurement that settles it

This skill already held the disproof. Ch40's four live Cowork probes (Desktop **1.25927.0**, host agent **2.1.221**, 2026-08-05) recorded, for the local lane:

| | local VM lane | remote lane |
|---|---|---|
| cwd | `/sessions/<slug>` | `/home/claude` |

1.25927.0 is **before** 1.32885.1, and that build still shipped the old prompt text. So the shell was already starting at the session root while the prompt said outputs. `37-cowork-probe-corrections.md:178` adds *"`$HOME` equals the session root — `/sessions/<slug>`"* from the same probes.

**Corroboration — UPGRADED to first-party (2026-08-27).** Initially recorded here as relayed. The probe sessions turned out to live on this machine, so the measurements were re-read directly from the **agent transcripts** under `.claude/projects/` — the faithful record per Ch40/L143, *not* the translated `audit.jsonl`. Every exact-`pwd` tool call found across all 1589 stored transcripts:

| session | tool | `pwd` result |
|---|---|---|
| `magical-epic-mccarthy` | `mcp__workspace__bash` | `/sessions/magical-epic-mccarthy` |
| `friendly-cool-goldberg` (folder connected) | `mcp__workspace__bash` | `/sessions/friendly-cool-goldberg` |
| `elegant-vibrant-rubin` | `mcp__workspace__bash` | `/sessions/elegant-vibrant-rubin` |
| `serene-dreamy-wozniak` | built-in `Bash` | `/sessions/serene-dreamy-wozniak` |
| `compassionate-trusting-dirac` (**sub-agent**) | built-in `Bash` | `/sessions/compassionate-trusting-dirac/proof-engine` |

Six exact `pwd` calls exist in the corpus; the sixth is a duplicate of the first session. **Every one resolves under the session root, none under `outputs`** — including the folder-connected case, which falsifies the `first-folder-else-outputs` rule in *both* of its branches.

## What actually changed at 1.32885.1: the text

Bisected across all 21 archived asars with `grep -a` on the raw archive:

| build | host-loop shell section |
|---|---|
| ≤ 1.32352.0 | `` `- ${n} → ${e}/  (your outputs directory${n===M?` — cwd`:``})` `` |
| ≥ 1.32885.1 | *"Each bash call starts in `/sessions/<id>`; that directory and `/tmp` exist only inside the Linux environment — fine for scratch, but **invisible to the user and to the file tools**. Only the `/sessions/<id>/mnt/` paths above reach the user's computer."* |

There is **no transitional build** — see L166 for the grep that appeared to show one.

## The annotation never described bash

The `— cwd` marker was over-read. The mapping row is `` `- ${n} → ${e}/` `` where `n = xe ?? j` is the **host** path and `e` is the VM path, and the annotation fires on `n === j`, where `j` is the `{{cwd}}` value:

```js
let A=`/sessions/${e}`, j=C&&ue?ue:A;  …  k=k.replaceAll(`{{cwd}}`,()=>j)
```

It annotated the **agent's** cwd on the host side of a host→VM mapping row. That statement was true then and is true now. The error was reading a fact about the agent process as a fact about the shell.

## What is unchanged (re-verified, not restamped)

The host-loop **agent-process** cwd **is** the session outputs directory. In the host-loop spawn patch, `e.cwd = d` where `d = hostCwd`, and `hostCwd` resolves to `getOutputsDir(session)`. Independent proof of that identity at the same call site, requiring no assumption about the resolver:

```js
hostUploadsDir: (0,D.join)((0,D.dirname)(h), `uploads`)   // h === hostCwd
```

which holds only if `hostCwd` is `uploads`' sibling — i.e. the session's `outputs` dir. Ch35/L122 stands.

## Two questions this lesson opened, both now closed

Both were published as open and were resolved the same day from the on-disk transcript corpus:

- **"Are Ch40's cwd rows bash observations?"** — **Yes.** The table above pins the tool name on every `pwd` call: four are `mcp__workspace__bash`, two are the built-in `Bash` (VM-loop, where it is not disallowed — L166). No `pwd` in the corpus was ever answered by a file tool, which cannot report one.
- **"Does `37-…:184`'s sub-agent cwd contradict the agent-cwd fact?"** — **No.** The one sub-agent `pwd` in the corpus is a **`Bash`** call returning `/sessions/compassionate-trusting-dirac/proof-engine` — a shell observation under the session root, exactly as this lesson predicts. It says nothing about the agent process's cwd, so Ch35/L122 is untouched.

---

# LESSON 164 — TWO TOOL FAMILIES, TWO PATH FORMS

**There is no single path form that is correct for both `mcp__workspace__bash` and the file tools. A bare filename is correct for Read/Write/Edit and lands in the user-visible outputs directory; a bare filename in bash lands in VM-only scratch the user never sees. Bash needs an absolute `/sessions/<id>/mnt/outputs/...` path — the same form the file tools reject outright.**

This is the practical replacement for the withdrawn "use bare filenames with both".

| | correct form | why |
|---|---|---|
| `Read`/`Write`/`Edit` | **bare name** (`report.md`) | cwd is the host outputs dir → immediately user-visible |
| `mcp__workspace__bash` | **absolute** `/sessions/<id>/mnt/outputs/x` | cwd is the session root; the prompt itself says *"Use absolute paths"* |
| file tool given `/sessions/...` | **denied**, never translated | the path-gate PreToolUse hook (Ch24/L107) |

### ADDENDUM (2026-08-27) — a THIRD correct form, and why no skill needs to derive a host path

The table above gives bash the **absolute** form because that is what the tool's own description advises. It is not the only correct one, and the omission matters in practice: bash's cwd is deterministically `/sessions/<id>` and `mnt/` sits directly in it, so a **relative** `mnt/outputs/report.md` resolves to the same place and **contains no session id**. First-party support: a real session's bash `ls -a .` lists `.bashrc .config mnt tmp …`, and a relative bash write (`printf > probe-b1.md`) lands at `/sessions/<id>/probe-b1.md` — relative resolution from the session root is exactly how the scratchpad failure happens in the first place.

That turns the two-forms rule into **two constant prefixes**, neither of which is a path anyone has to discover:

| runtime | file-tool prefix | bash prefix |
|---|---|---|
| Claude Code CLI | `outputs/` | `outputs/` (one cwd, shared) |
| Cowork, host-loop | *(bare)* | `mnt/outputs/` |

**The consequence is worth more than the form.** A skill that must run on more than one surface needs **runtime discrimination, not host-path derivation** — it never needs `/Users/…/local_<id>/outputs`, the session id, or `CLAUDE_CODE_*`. That principle stands. **The one-line probe first published here to implement it does not, and is withdrawn.**

**WITHDRAWN (2026-08-27, same day) — `BASE="$([ -d mnt/outputs ] && echo mnt/outputs || echo outputs)"`.** It reintroduces the doubling bug on Chat mode, silently, and **the refutation was already in this chapter** — L166's own surface table, two lessons below:

| surface | bash cwd | `[ -d mnt/outputs ]` | `BASE` resolves to |
|---|---|---|---|
| Cowork host-loop | `/sessions/<id>` | true | `…/mnt/outputs` ✓ |
| **Chat mode** | **the outputs dir** (explicit `cd`) | **false** | **`<outputs>/outputs/…`** ✗ doubled |
| remote / cloud | `/home/claude` | false | `/home/claude/outputs` (discarded anyway) |
| Claude Code CLI | the project dir | false | invents `outputs/` in the user's repo |

On Chat mode the shell is *already inside* the outputs directory, finds no `mnt/outputs` beneath it, and the fallback appends `outputs/` — the exact failure L164 exists to prevent. **The root cause is that the probe has one bit of evidence and three or more surfaces to separate**, and it tests for *the Cowork mount* while assuming everything else is CLI-shaped. Its failure is silent, which by this chapter's own standard is disqualifying. *(Caught by the `skill-creator-plus` session, against this chapter's own table.)*

**The better default is that a script should not self-locate at all.** Taken to its conclusion, "test for the thing you need, not who you are talking to" says the thing a script needs is **a destination**, and the component that knows it is the **caller** — which holds the file tools, has already resolved the workspace, and is the only party that can name a path the user will actually see. So: the caller resolves the destination once and passes it as an absolute argument to every shell command and every dispatch prompt; the script accepts it and **echoes back the resolved path it actually wrote**. No probe, no identity check, and nothing to revise when a lane moves.

Where a script genuinely must run standalone with no caller, make the destination a **required argument and fail loudly when it is absent** — erroring with the reason rather than inventing a directory. That keeps the fail-safe property and drops the silent-wrong branch, which was the probe's real defect.

*(Untested sketch, recorded only because it is the shape a correct probe would have to take: rather than inferring the destination from directory layout, establish it — have the agent write a sentinel with a **file tool**, whose placement is ground truth for where the file tools are rooted, then have one shell call locate that sentinel among a small candidate set. That tests for the actual destination instead of guessing from shape. Not verified on any surface; do not ship it on this lesson's authority.)*

Whatever the mechanism, a script should still **print the destination it resolved**, which converts the silent-misfire property of this whole failure class into a visible one — the single most useful thing an author can do here, because every bug in this chapter is silent by construction.

**On the residual assumption, and why narrowing it was not enough.** The withdrawn probe inferred *"the file tools are rooted at outputs"* from *"bash can see a `mnt/outputs`"* — two different facts. That risk was correctly identified and narrowed by the adopting project as "no such runtime is known", and **that framing was itself too generous**: the counterexample was not an unknown future runtime but Chat mode, already documented two lessons below. A narrowed assumption still fails where it fails; stating an assumption is not the same as checking it against the cases you already hold. Recorded because two sessions reviewed this idiom, one of them sharpened its risk statement, and neither checked it against the table in the same file.

**The trade-off, stated so a reader can choose.** The relative form depends on bash's cwd remaining the session root — and L163 is the record of that value being mis-described for months, so it is not immutable. The absolute form depends on obtaining `<id>`, which costs a `pwd`. Prefer relative for portability, absolute when a path must survive being passed between calls or written into a file, and never assume either is correct for the *other* tool family.

## Why the prompt reads as self-contradictory: the tokens collapse

```js
let M  = hostLoopMode && hostCwd ? hostCwd : `/sessions/${id}`;   // {{cwd}}
let Ie = hostLoopMode ? (firstFolder ?? hostCwd ?? M)
                      : (firstMounted ? `${j}/mnt/${name}` : `${j}/mnt/outputs`);  // {{workspaceFolder}}
```

In **host-loop with no folder connected**, `{{cwd}}` and `{{workspaceFolder}}` render to the *same path*. The shipped template then calls that one directory *"a temporary scratchpad"* users *"are not able to see"* in clause 1, and the place *"to save all final outputs and deliverables"* in clause 2. The ambiguity is not the model's; it is two roles resolving onto one value.

## Measured consequences

**First-party — the artifacts are still on disk.** Initially recorded as relayed; the probe sessions are on this machine and the resulting files were inspected directly (stronger than any transcript, since the filesystem cannot be a translated projection):

| written as | lands at | visible? |
|---|---|---|
| `d1.md` | `<session>/outputs/d1.md` | yes |
| `outputs/d2.md` | `<session>/outputs/**outputs**/d2.md` | **no — doubled** |
| `./d3.md` | `<session>/outputs/d3.md` | yes (normalised) |
| `<folder>/e3.md` | `<session>/outputs/<folder>/e3.md` | **no — decoy dir inside outputs** |

Verbatim, from the two probe sessions' own `outputs/` trees as they sit on disk today:

```
local_bcbaba81…/outputs/d1.md          local_1e451b75…/outputs/e2.md
local_bcbaba81…/outputs/d3.md          local_1e451b75…/outputs/cwtest/e3.md   <- DECOY
local_bcbaba81…/outputs/outputs/d2.md  local_1e451b75…/outputs/outputs/e1.md  <- DOUBLED
```

The second session had `~/Downloads/cwtest` connected. That real folder is **empty** — `e3.md` never reached it. The file-tool root already *is* `outputs`, so a relative `outputs/` prefix nests a second one, and addressing a connected folder by its own name builds a same-named directory inside outputs: the write succeeds, the tool reports success, and the file is nowhere near the folder the user connected. **Only an absolute host path reaches a connected folder.**

### ADDENDUM (2026-08-27) — a live sub-agent probe: two confirmations, two new facts

A probe of a **sub-agent inside a real host-loop Cowork session** (`tender-ecstatic-ride`, Desktop 1.37937.1 / agent 2.1.246) confirmed this lesson's two path forms from the product's own text, and surfaced two facts the chapter did not have.

**Confirmations — now live-rendered, not code-read.** The sub-agent's `<env>` block reports its working directory as the session `outputs` directory, confirming both this chapter's agent-cwd fact and Ch35/L122's "a sub-agent's cwd is the parent's cwd" **at runtime, in one observation**. Its Cowork-environment append renders the post-1.32885.1 text with the session resolved — *"Each command starts in `/sessions/tender-ecstatic-ride`; anything written outside `/sessions/tender-ecstatic-ride/mnt/` (including `/tmp`) stays in that environment and never reaches the user or your file tools"* — stating **both** values side by side: file tools at `…/outputs`, bash at the session root. Two further surfaces say the same independently: `mcp__workspace__bash`'s own description instructs *"Use absolute paths"*, and `present_files` states *"Only files under your outputs folder, the uploads folder, or a connected folder can be presented — if a shell command wrote a file elsewhere in its Linux environment, copy it into one of those first"* (the host-loop pass-through of L163).

**NEW — a sub-agent is pointed at a section it structurally cannot have.** The `mcp__workspace__bash` tool description reads:

> *"Your connected folders are mounted under `/sessions/<session>/mnt/` — **the Shell access section of your system prompt** lists the exact path for each folder."*

That section does not exist in a sub-agent's prompt. Three-part proof, first-party:

- the **sub-agent append** (`gs()`) emits only the `${a}/mnt/` **prefix**: *"…those folders are mounted under `${a}/mnt/`"* — no per-folder table;
- the `host_loop_shell` section carrying the actual `- <host path> → /sessions/<id>/mnt/<name>/` mappings is built in **`ms()`**, the *main* system prompt;
- nothing appends it for sub-agents — `appendSubagentSystemPrompt` is `gs()`'s output alone.

**Consequence, and it compounds with L164:** only an absolute path reaches a connected folder, and a sub-agent **cannot resolve that folder's mount name from its own prompt**. It must `ls /sessions/<slug>/mnt/`, ask the parent, or guess the basename — and a guess is exactly the silent decoy failure above. A dispatching skill that expects a sub-agent to write into a connected folder must **pass the resolved mount path in the dispatch prompt**. Extends Ch35/L123.

**NEW — a third scratch location, injected by the agent rather than the Desktop.** The probe's prompt carries a `# Scratchpad Directory` block naming `/private/tmp/claude-501/-<slugified-cwd>/<uuid>/scratchpad` and instructing *"Always use this scratchpad directory for temporary files instead of `/tmp`"*. Cross-artifact: that block occurs **4 times in the agent Mach-O 2.1.246 and zero times in the Desktop `app.asar`** — it is a Claude Code harness feature that Cowork inherits because the Cowork agent *is* Claude Code. It is not Cowork-aware, and its path is derived by slugifying the agent's cwd (the outputs dir).

So host-loop has **three** distinct not-user-visible write locations, failing in different ways:

| location | side | survives session end | user sees it |
|---|---|---|---|
| `/sessions/<id>`, `/tmp` (the bash cwd) | VM | no | no |
| `/private/tmp/claude-501/…/scratchpad` | **host** | yes | **no** |
| `CLAUDE_CODE_TMPDIR` / `CLAUDE_TMPDIR` | **not a third place** — a temp-dir *override*, default `/tmp` (so: row 1) | no | no |

The authoring consequence: *"don't write the deliverable to the scratchpad"* is **under-specified guidance**, because there is more than one scratchpad and the agent is actively *instructed* to prefer the host-side one. A `/sessions/`-prefix heuristic does not catch it — that path is a host path, and it persists, so nothing fails loudly. The durable rule remains L164's: a deliverable goes to a **bare filename** (file tools) or an **absolute outputs path** (bash), and anywhere else is a temporary file by definition.

**The third row, RESOLVED (2026-08-27, agent Mach-O 2.1.246).** An earlier version of this table listed `CLAUDE_CODE_TMPDIR` as *unverified* on the grounds that the identification came from another project's guidance. That hedge was unnecessary — the answer is one `strings` away, and leaving it open let a downstream project reason from *absence in this skill* to "no independent source exists", which is the same secondary-source fallacy L166 warns about. **20 occurrences of `CLAUDE_CODE_TMPDIR` and 4 of `CLAUDE_TMPDIR`** in agent 2.1.246:

```js
function k(){ let e = process.env.CLAUDE_CODE_TMPDIR; if (e) return e; return `/tmp` }
TMPDIR=${CLAUDE_CODE_TMPDIR || CLAUDE_TMPDIR || `/tmp/claude`}   // sandbox runtime env
"Free up space or set CLAUDE_CODE_TMPDIR to a directory on a filesystem with room."
```

So it is an **override for the agent's temp directory, defaulting to `/tmp`** — used for the sandbox's `TMPDIR` and for command-output spooling. It is **not** the Cowork session scratchpad, and **not** the host-side `/private/tmp/claude-501/…` block: it is a knob pointing at row 1 by default, not a fourth location.

**The consequence is the part worth carrying:** because it defaults to `/tmp`, anything a skill writes through it under host-loop bash lands in VM-only scratch — invisible to the user *and* to the file tools, exactly as row 1. Guidance that names this variable as "the session scratchpad" is wrong twice over: wrong about what it is, and wrong about implying a fourth failure mode when it collapses into the first.

---

# LESSON 165 — `Write`'s RESULT CARRIES THE RAW INPUT

**The `Write` tool's result echoes the `file_path` it was given, not a resolved absolute path. Anything that reads an absolute path out of a Write result — a harness assertion, a skill that captures the path for a later step, a doc that promises it — is reading something the agent does not emit.**

First-party in the Desktop-managed host agent Mach-O **2.1.246**. The handler derives a path for filesystem work but returns the raw input in the result record, and the renderer interpolates that field:

```js
function VHo({file_path:e,content:t},n,r){ … let d=Dn(e), p=jHo(d) …
  T = {type:"create", filePath: e, …}          // e — the RAW input
  PR({operation:"write", tool:"FileWriteTool", filePath: d, …})   // d — the derived path
}
case "create": return { …, content:`File created successfully at: ${e}` }
case "update": return { …, content:`The file ${e} has been updated successfully.` }
```

Both branches carry `e`. The derived path `d` goes only to telemetry.

**Deliberately not claimed:** that `Dn` absolutizes. `grep -a 'function Dn('` returns **three** different `Dn` definitions in this binary — a File/Blob helper, a redaction predicate, and a Windows shell-quote helper — none a path resolver, and the collision was not resolved in this pass. The proven statement is the raw-vs-derived split above, which does not depend on knowing what `Dn` is. (Same minifier-collision class as Ch35/L124's tar-Symbol `_y`.)

Corroborating product bug: Chat mode's own prompt asserts *"Write's result shows the file's full path"* — which this falsifies for that surface too.

---

# LESSON 166 — SURFACE SEPARATION, AND TWO GREPS THAT LIE

**The "same scratch space / bare filenames with both" text is real — it just belongs to Chat mode, a different surface, where it is true and enforced by an explicit `cd`. Reading asar prompt strings without separating surfaces is how a true statement about one product became a false published claim about another.**

## Three surfaces, three contracts

| surface | builder | bash cwd | shared with file tools? |
|---|---|---|---|
| Cowork agent task (host-loop) | `host_loop_shell` section | `/sessions/<id>` | **no** |
| Chat mode | `Zo()` | outputs dir, via an explicit `cd ${vmCwd} 2>/dev/null \|\| { … exit 96; }` | **yes** |
| remote/cloud lane | — | `/home/claude` | yes (Ch40) |

The `cd` is prepended **only** on the `chat` branch. That the chat path needs an explicit `cd` while `cwd: c.vmCwd` is *also* passed to the guest spawn is the tell that the spawn argument is not load-bearing — and therefore that the pre-1.32885.1 Cowork prompt was wrong rather than describing a since-changed runtime.

## Lane facts, re-derived extraction-free

Enumerating **all 11** `disallowedTools=[` assignment sites by `grep -a` on the raw `.asar`:

- The six-tool disallow + alias pair lives in the **host-loop** patch: `` e.disallowedTools=[...e.disallowedTools??[],...t._y], e.toolAliases={Bash:t.Jy,WebFetch:t.Yy} `` with `_y = ["Bash","PowerShell","NotebookEdit","REPL","JavaScript","WebFetch"]`, `Jy = mcp__workspace__bash`, `Yy = mcp__workspace__web_fetch`.
- **VM-loop keeps built-in `Bash`, `NotebookEdit`, `REPL`, `JavaScript`** — no other site disallows them.
- `WebFetch` is aliased in **both** loops; VM-loop reaches it by a separate site gated on `!hostLoopMode && Jx("1978029737","coworkWebFetchViaApi")`.

## The two greps that lie

**1. The `\uXXXX` re-encoding at 1.32352.0.** The bundle switched its non-ASCII output from literal characters to escapes at that build. A raw em-dash grep therefore reports the annotation as *absent* at 1.32352.0 and *present* on both sides of it — manufacturing a "transitional build" that does not exist:

```
1.30096.1   raw_emdash_lines=987   escaped_u2014_lines=41
1.32352.0   raw_emdash_lines=7     escaped_u2014_lines=101
```

Verbatim at 1.32352.0: `` (your outputs directory${n===M?` — cwd`:``}) ``. Grep for **both** encodings, or for an ASCII-only anchor, and run a positive control before any "absent at version X" claim.

**2. Extraction-completeness checks false-alarm — and this lesson's first draft was the false alarm.** It claimed `@electron/asar extract` "leaves a partial tree (265 of 292 entries)". **Withdrawn.** Reading the archive header directly:

```
archive FILE entries : 275   (45 directory entries, not files)
extracted on disk    : 265
missing              :  10   — exactly the 10 entries flagged `unpacked: true`
```

The ten are native binaries (`*.node`, `spawn-helper`, `github-mcp-server`, `libmsalruntime_arm64.dylib`) which by design live **outside** the archive in a sibling `app.asar.unpacked/` directory. 265 + 10 = 275: the extraction was **complete**. The "292" was a bad count — `asar list | grep -c '\.'` counts dot-containing *directories* too.

**Three variants survive, all producing the same symptom** — an extraction that looks truncated when it is not:

1. **`unpacked: true` entries are never inside the archive.** Any "archive entries vs files on disk" reconciliation must subtract them, or it under-counts by exactly that many.
2. **The extraction SOURCE decides whether they appear at all**, and this is the sharp one. `@electron/asar extract` copies unpacked natives in from the archive's `app.asar.unpacked/` **sibling directory** — so extracting a *live* `Contents/Resources/app.asar` yields them, while extracting a **bare backed-up `app.asar`** with no sibling cannot. Verified on this machine: `/Applications/Claude.app/Contents/Resources/app.asar.unpacked/` holds exactly the ten natives that the header read reports "missing" from a bare-backup extraction. **The same extractor on the same archive therefore disagrees in *opposite directions* purely by source** — a bare-backup extraction under-counts by 10, a live extraction over-counts against a naive archive listing by the same 10. (Both directions were measured, independently, by this project and by `cowork-harness`, which is how the discrepancy surfaced at all.)
3. **Desktop self-updates mid-investigation.** Listing a *live* archive against a *stored* extraction compares two different builds — reported by `cowork-harness` when 1.37937.1 became 1.37937.3 underneath them: identical `.js` counts, 143 differing names, indistinguishable from truncation at a glance.

The durable rule is unchanged and is what this chapter actually relied on: **enumerate from the raw archive with `grep -a`**, which needs no extraction and cannot be partial. Ch35/L124's gzip-wrapped fcache and the hidden `.vite/build` directory are the genuine members of the silent-under-return family; this one was operator error, recorded because the false alarm is as instructive as the trap.
