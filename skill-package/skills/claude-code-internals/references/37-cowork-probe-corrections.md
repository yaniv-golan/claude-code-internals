Updated: 2026-08-05 | Source: **four live Cowork probes** run by the operator on this installation (host agent **2.1.221**, Desktop `app.asar` **1.25927.0**), plus first-party reads of each session's own on-disk `audit.jsonl` and host-side session records, plus `app.asar` 1.25927.0 for the plugin-install surface. Sessions: `tender-inspiring-mendel` (`local_33f9bc8e…`, probe 1), `gallant-sleepy-clarke` (`local_01dc2a61…`, probe 2), `busy-eager-bell` (`local_1fdd9e8c…`, probe 3), and one **remote-lane** session (probe 4). Historical corroboration from the on-disk session corpus is cited per claim. **Tier discipline:** every timing, count and exit status below is read from the persisted `tool_use`/`tool_result` pairs on disk, not from the pasted transcript — a distinction that mattered, because the pasted transcript and the record disagreed in at least three places (a mangled org UUID, a truncated sub-agent `pwd`, and a mislabelled path form). Claims that remain inference are marked inline. This chapter is the output of the 2026-08 fact-verification audit, whose remit was to re-check the 52 published author-facts against current artifacts rather than to find new material; L143–L145 are what that re-checking turned up.

**Prior-lesson corrections landed by this chapter:** Ch35/L122's behavioural summary *"rewrites outbound messages only"* is **falsified for `mcp__workspace__bash`** — the observed behaviour is bidirectional (L144). The published author-fact `shell.no-package-installs` is **falsified** (L145). The published author-fact `paths.session-paths-denied` is **materially mis-stated** (L143). Ch31/L117's multiplexing inference is **given a scale** — though not, on this evidence, a concurrency claim (L146).

# Chapter 40: What Four Live Probes Corrected — Read-After-Write, Path Translation, Egress & Multiplexing

---

## TABLE OF CONTENTS

143. [Lesson 143 — The File Tools Lag the Shell, and the Error Blames Your Path](#lesson-143----the-file-tools-lag-the-shell)
144. [Lesson 144 — `mcp__workspace__bash` Translates Paths in BOTH Directions](#lesson-144----translation-is-bidirectional)
145. [Lesson 145 — Egress Is Filtered by Destination, So Package Installs Work](#lesson-145----egress-is-filtered-by-destination)
146. [Lesson 146 — 529 Sessions in One Namespace, and the Isolation That Holds Them Apart](#lesson-146----529-sessions-in-one-namespace)

---

# LESSON 143 — THE FILE TOOLS LAG THE SHELL

**A file written by the shell is not immediately readable by the file tools. The read fails with a message that blames your path form — while the path is correct and will work seconds later. The published rule "never pass an absolute session path to the file tools, it is denied not translated" describes this symptom wrongly in both directions.**

## The measurement

Session `busy-eager-bell`, agent 2.1.221, host-loop. Both `Read` calls carry **byte-identical `file_path` values, 207 characters**, read from the persisted `tool_use` inputs:

| t (UTC) | tool | result |
|---|---|---|
| 19:35:12.982 | `mcp__workspace__bash` writes the file | **ok** |
| 19:35:14.873 | `Read` | **is_error** — *"is a VM path"* |
| 19:35:19.087 | `Read` — **same 207-char path** | **ok**, content returned |

## The file existed host-side before the failing read — by birthtime, not mtime

The host file reports `birth = mtime = ctime = 19:35:12`, **1.9 s before the failing read**.

The distinction matters. `mtime` alone would not settle this: a write crossing the FUSE bridge can carry the *write* time rather than the moment the host inode appeared, and `utimens` can set it after the fact. **Birthtime cannot be set by userspace on APFS** — it is stamped by the kernel at inode creation. So the host inode demonstrably existed before the read that failed, which excludes plain write-propagation delay as the explanation.

The variable is therefore time on the *reader's* side, not path form and not the write.

## The message is actively harmful

The verbatim failure:

> `` `/Users/…/local_1fdd9e8c…/outputs/k4m2.txt` is a VM path. In this session the Read tool runs on the host filesystem, where `/sessions/...` doesn't exist. Use the host path for this file (connected folders are available at their real locations), or use the `bash` tool — which runs inside the VM — to operate on `/sessions/...` paths. ``

The path it rejects **is already the host path**, and the advice is to use the host path. An agent that believes the message rewrites a correct path; the behaviour that actually recovers is to **retry the identical call**. This is a case where following a tool's own error text is the wrong move.

The identical message also appears for a path that was never created at all (probe 1, separate session). Two distinct situations produce it, which is consistent with a generic fallback rather than a syntax diagnosis — though only those two have been observed.

## What the published fact got wrong, in both directions

| published | actual |
|---|---|
| "Never pass an absolute session path to the file tools" | A host-form absolute path is **accepted**, once the file is visible |
| "It is denied, not translated" | True for a `/sessions/…` path; **not** the reason this failure happens |
| "the error does not point at the path form as the cause" | The error points at path form **as the cause, wrongly** |

**Author rule:** after writing a file with the shell, treat the first file-tool read as retryable. Do not rewrite the path in response to this message.

## Mechanism — INFERENCE, not established

A `file-index-worker` ships in the Desktop build, and a path gate consulting an index that lags the write would produce this. **Not traced.** The behaviour is measured; the cause is not. The window is a **single observation** — failed at +1.9 s, succeeded at +6.1 s — and is not characterised, bounded, or known to be constant.

---

# LESSON 144 — TRANSLATION IS BIDIRECTIONAL

**`mcp__workspace__bash` rewrites paths in both directions: host→VM on the command it receives, and VM→host on the output it returns. Ch35/L122's "outbound only" summary is falsified for this tool. Host paths resolve inside the VM only where they name a mount target.**

## Outbound — proved inside a single record

In the VM, in probes 1 and 3 independently:

```
grep -c .             /proc/mounts  → 55
grep -cF '/Users/'    /proc/mounts  →  0
grep -cF '/sessions/' /proc/mounts  → 28
```

Zero host paths in the raw mount table. Yet probe 2's loop over its own `/proc/mounts` printed host paths, and those are stored **raw in the persisted `tool_result`** — **5 host paths alongside 52 `/sessions/…` in one record**. That within-record mixture is the proof: no unrewritten mount table produces both forms at once. So the rewrite happens **in the tool result before persistence**, not at display time.

The counts survive because a number carries no path to match. **General method: when agent-reported paths are in question, corroborate with a command whose output is a count.**

## Inbound — and it is selective

The same probe-3 shell, in one command block:

| path given to the VM shell | result |
|---|---|
| `/Users/yaniv/…/local_1fdd9e8c…/outputs/k4m2.txt` (**a mount target**) | **write succeeded**, file owned by the session user |
| `/var/folders/…/claude-hostloop-plugins/<hash>/scripts/` (host staging, **not** a mount target) | `No such file or directory` |
| `/tmp/coworkprobe/sentinel.txt` (host `/tmp`) | `No such file or directory` |

One session, three host paths, one resolves. The command string is therefore translated host→VM **on the way in**, and only for paths naming something mounted into the session.

**INFERENCE:** that the matcher works by *mount-path prefix* specifically, and that one mechanism performs both directions, is a model fitted to these observations — the inbound evidence is a single successful write plus two negatives. Nothing traces the inbound rewrite to any named component; **L122's claim is about the K6-cmJAJ index, and whether that index or a separate mechanism does the inbound rewrite is untraced.** What is falsified is the behavioural summary "outbound only".

## The outbound failure mode is mechanical, and it explains a prior contradiction

Outbound (`tool_result`) observations only:

| path | translated? |
|---|---|
| `…/mnt/outputs`, `…/mnt/uploads` | **yes** |
| connected folder **without** spaces (2026-07-23, `siteaware-board`) | **yes** |
| `…/mnt/untitled\040folder\0405` (octal-escaped spaces) | **no** |
| `.claude/*`, `.projects/*`, `.remote-plugins/*`, `.local-plugins/*` | **no** |

The 2026-08-05 capture record recorded a host-path mountpoint, retracted it, then noted the residue was *"the same artifact, twice"* after a zero-count `grep -F` disproved it. Both the observation and the retraction were correct about what they measured: one translator, seen through paths it did and did not match.

**Author consequence.** `paths.relative-filenames` stands, with a better reason. The shell does not "have a different absolute path for the same place" — it **operates** on one form and **reports** another, so any path copied out of shell output has already been rewritten before you see it.

---

# LESSON 145 — EGRESS IS FILTERED BY DESTINATION

**Outbound network access from the shell is filtered by destination, not absent, and runtime package installs succeed. The published inference that they "will fail or hang" is falsified.**

## Installs, live at agent 2.1.221

| command | result |
|---|---|
| `pip install --user cowsay` | **succeeded** — script written to `/sessions/<slug>/.local/bin`; subsequent `import cowsay` succeeded |
| `npm install left-pad` (project-local) | **succeeded** — subsequent `require()` succeeded |
| `pip install cairosvg --break-system-packages` | **succeeded** (2026-07-22, `local_7632df56…`) — the dependent `cairosvg.svg2png()` call then ran |
| `npm install docx` (project-local) | **succeeded** (2026-07-23, `local_bf31dcd9…`) |
| `npm install -g docx` | **failed** — same session, `ls $(npm root -g)/docx` reported the package absent afterwards |

Two rows are live probe results; three are read from persisted `tool_result` records in the named corpus sessions.

## What is and is not established

Reachability, from the same shell:

```
curl --max-time 8 https://example.com      → 000   (no response)
curl --max-time 8 https://pypi.org/simple/ → 200
```

Outbound TCP to an allowed destination connects; one common destination does not answer. The `000` does not discriminate a DNS block from a connect block, and two destinations are a thin basis for the word "allowlist" on their own — the supporting structure is the `webFetchAllowedUrls` collector found in the session-config records, which shows a real per-session URL allowlist exists and governs more than `web_fetch`.

**Not established:** that these installs fetched from the public registry. A warm local cache or a configured mirror would produce identical results, and the `-q` flags suppressed any download lines. **The falsification does not depend on it** — the published fact predicted that the install *step* "will fail or hang", and it visibly succeeded five times, whatever the byte source.

## Why the inference broke

The published fact reasoned: egress is constrained → installs fail. The premise holds and the conclusion does not follow.

> **Method.** An `inference`-tier fact is a hypothesis with a citation. This one survived multiple releases because its premise was repeatedly re-verified while its conclusion never was. When auditing, test the *derived* claim, not the claim it was derived from.

## What replaces it

Preinstalled first — the sandbox ships a substantial stack (Python 3.10.12, **149** packages present; `pandas`, `numpy`, `PIL`, `openpyxl` all import). A user-scoped or project-local install is a working fallback. A **global** install is not. Reachability rests on configuration that can change between releases, so an install belongs in a path that degrades, not in a prerequisite.

---

# LESSON 146 — 529 SESSIONS IN ONE NAMESPACE

**`ls /sessions` returned 529 sibling session directories from inside one guest, and a write into a stranger's outputs was refused. The namespace is shared at a scale of hundreds; the isolation boundary is the per-session Unix user — in the local VM lane. The remote lane has no such boundary.**

## The numbers

| observation | value |
|---|---|
| entries in `/sessions`, including the session's own | **529** (`admiring-cool-carson` … `zen-vibrant-hamilton`) |
| write into a **stranger's** `mnt/outputs` | `Permission denied` |
| own identity | `uid=1539(busy-eager-bell)`, gid identical, **no supplementary groups** |

Session directories are enumerable — the namespace is not hidden — while their contents are not reachable.

**What this does NOT establish.** A directory listing does not show liveness. 529 entries are equally consistent with hundreds of *concurrent* sessions and with accumulated directories from sessions that have long since ended, and nothing here distinguishes them; no process, mount or timestamp check was run against a sibling. Nor does it establish that `/sessions` is guest-local storage rather than a shared view mounted into per-session guests. Ch31/L117's multiplexing inference is **given a scale**; it is not upgraded to confirmed by this. The isolation test is likewise **n=1** — one write, one stranger.

## Lane scope — this is a local-lane fact

Probe 4 observed the remote lane directly and it does not work this way:

| | local VM lane | remote lane |
|---|---|---|
| cwd | `/sessions/<slug>` | `/home/claude` |
| identity | `uid=1539(<slug>)` | **`uid=0(root)`** |
| env vars | 2 `CLAUDE*` | 148 total |
| `/proc/mounts` | 55 | 22 |
| root marker | `sessions`, `smol` | `container_info.json`, `old_root` |

**There is no per-session Unix user in the remote lane — the agent is root.** Every identity and isolation statement in this lesson is scoped to the local VM lane. This is the concrete case for lane-scoping author guidance: a fact published without a lane qualifier was false in the other lane on its first direct observation.

## Three smaller local-lane facts from the same probes

**`$HOME` equals the session root** — `/sessions/<slug>`, not `/home/<user>`. L117 established that home is never bind-mounted; this is what stands in its place.

**A connected project mounts read-only.** `.projects/<uuid>` is `dr-x------`, while a connected folder mounts `rw`. A session with a project attached and no folder attached has 28 fuse mounts and no folder mount; connecting a folder takes it to 29. This is the first observation of the project-only configuration in 474 session records — 107 had folders, exactly one had a project, and that one also had a folder.

**Sub-agents share the containment exactly.** A dispatched `general-purpose` sub-agent reported the **same uid**, the same session root as its cwd, and the identical file-tool denial. There is no separate boundary to escape into.

## Dispatch refusal is real and non-deterministic

In one session an auto-mode classifier refused a `general-purpose` dispatch outright:

> *Permission for this action was denied by the Claude Code auto mode classifier. Reason: Blocked by classifier.*

In another session on the same day, an equivalent dispatch was **accepted**. A refusal is possible and not reliably reproducible — the practical case for writing fan-out that tolerates a dispatch not starting, rather than treating refusal as a bug to diagnose.

## Plugin-install surface (asar 1.25927.0, first-party)

The zip validator `aw()` accepts a manifest at exactly two positions — `.claude-plugin/plugin.json` at the archive root, or one directory deep (`^[^/]+\/\.claude-plugin\/plugin\.json$`) — or a `SKILL.md` at either position, from which a manifest is **synthesised**, capped at 256 KiB.

`RemotePluginSync` refuses three shapes outright: an entry whose normalised path escapes the plugin root, **a symlink anywhere in the plugin directory**, and **a `plugin.json` that declares a `hooks` key** (*"refusing plugin that relocates hooks via manifest"*). It additionally **strips top-level `hooks/`** — `c = new Set(['hooks', '.mcpb-cache'])`, logged as *"Stripping hooks/ … (not synced to remote)"*.

**What was observed, and why it does not settle the route question.** A probe plugin uploaded through the app landed host-side in `rpm/plugin_01C5Ln…/` **with `hooks/hooks.json` intact** (verified on disk), and its `SessionStart` hook fired in a live session. But that same plugin mounts in the VM at `.remote-plugins/plugin_<id>/` — so **mount location does not indicate install route**, and under host-loop the hook runs host-side from the `rpm/` copy regardless of where the VM sees the files. The strip is read from code and has **not** been observed end-to-end; which routes preserve `hooks/` is not yet separated. What is established: a hooks-carrying plugin can fire `SessionStart` in a live Cowork session, confirming Ch17/L89.

> **Method note.** A first pass counted zero `hooks/` directories in the host-loop staging area and nearly recorded it as confirmation. The positive control returned zero for `skills/`, `SKILL.md` and `plugin.json` too: `find` without `-L` does not descend the staging **symlinks** that L89's `qX` mechanism creates. With `-L`: 34 `skills/`, 184 `SKILL.md`, 3 `hooks/`. Same failure class as the hidden `.vite/build` directory and the gzip-wrapped fcache — an absence produced by the tool, caught only by a control.
