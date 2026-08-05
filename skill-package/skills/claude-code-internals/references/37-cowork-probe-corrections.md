Updated: 2026-08-05 | Source: **four live Cowork probes** run by the operator on this installation (host agent **2.1.221**, Desktop `app.asar` **1.25927.0**), the agent's own per-session transcripts under `.claude/projects/`, the Desktop's per-session `audit.jsonl`, and `app.asar` 1.25927.0 (plus 1.24012.1 and 1.22209.0 for the path-gate comparison). Sessions: `tender-inspiring-mendel` (`local_33f9bc8e…`, probe 1), `gallant-sleepy-clarke` (`local_01dc2a61…`, probe 2), `busy-eager-bell` (`local_1fdd9e8c…`, probe 3), and one **remote-lane** session (probe 4).

**Tier discipline, corrected.** v2.36.0 of this chapter claimed its evidence was read *"first-party from each session's own on-disk `audit.jsonl`"* and treated that as authoritative. **It is not, for paths** — `audit.jsonl` is a translated projection (L143), and two published claims were wrong because of it. Both are retracted here. Where this chapter now makes a claim about a path, a command as issued, or a tool result as the model received it, the source is the **agent transcript**, corroborated against the binary that implements the behaviour. Claims that remain inference are marked inline.

**Prior-lesson corrections landed by this chapter:** the published author-fact `shell.no-package-installs` is **falsified** (L145). Ch31/L117's multiplexing inference is **given a scale** — though not, on this evidence, a concurrency claim (L146). **Ch35/L122 is NOT corrected** — v2.36.0 claimed it was, and that claim is withdrawn (L143); L122's "rewrites outbound messages only" stands.

**Retracted from v2.36.0 by v2.36.1:** the read-after-write race (there is none), inbound host→VM path translation (the agent never sent a host path), and the rewrite of `paths.session-paths-denied`, which replaced a correct rule with advice that would have sent an author into an unbounded retry loop. The original rule was right.

# Chapter 40: What Four Live Probes Corrected — Two Records, Egress & Multiplexing

---

## TABLE OF CONTENTS

143. [Lesson 143 — `audit.jsonl` Is a Translated Projection](#lesson-143----auditjsonl-is-a-translated-projection)
144. [Lesson 144 — What the Two Records Are For](#lesson-144----what-the-two-records-are-for)
145. [Lesson 145 — Egress Is Filtered by Destination, So Package Installs Work](#lesson-145----egress-is-filtered-by-destination)
146. [Lesson 146 — 529 Sessions in One Namespace, and the Isolation That Holds Them Apart](#lesson-146----529-sessions-in-one-namespace)

---

# LESSON 143 — `audit.jsonl` IS A TRANSLATED PROJECTION

**The Desktop's per-session `audit.jsonl` rewrites VM paths to their host equivalents, in both tool inputs and tool results. The agent's own transcript under `.claude/projects/` is the faithful record. Reading `audit.jsonl` for any question about path form produces confident, wrong answers — this lesson exists because it produced two of them, published in v2.36.0 and retracted here.**

## The measurement

Every `tool_use` id present in both records, across the whole on-disk corpus:

| | count |
|---|---|
| ids in both records | **16,640** |
| inputs identical | 15,883 |
| inputs **differ** | **757** |
| differences that are audit `/Users/…` vs transcript `/sessions/…` | **757 — all of them** |

There is no other kind of difference. The same `tool_use` id, side by side:

```
AUDIT : {"command":"cd /Users/yaniv/Library/Application Support/Claude/local-agent-mode-sessions/4…
CLI   : {"command":"cd /sessions/brave-exciting-gates/mnt/outputs && pip install cairosvg --break-…
```

## What this retracts

**v2.36.0's L143 claimed a read-after-write race.** Two `Read` calls appeared in `audit.jsonl` with byte-identical 207-character host paths, the first failing *"is a VM path"* and the second succeeding 4.2 s later. The agent's own transcript shows what was actually sent:

| call | path the agent actually sent | result |
|---|---|---|
| 1 | `/sessions/busy-eager-bell/mnt/outputs/k4m2.txt` | **denied** |
| 2 | `/Users/…/local_1fdd9e8c…/outputs/k4m2.txt` | **succeeded** |

Two different path forms, behaving exactly as documented. **There is no race, no index lag, and no retry to perform.** The elapsed 4.2 s was the agent composing a second, different call.

**v2.36.0's L144 claimed inbound host→VM translation** on the strength of a host-form write succeeding inside the VM. The transcript shows the agent sent `echo hello-K4M2 > /sessions/busy-eager-bell/mnt/outputs/k4m2.txt` — the VM form. It never sent a host path. **The inbound claim is withdrawn.**

**Ch35/L122 stands.** Its *"the K6-cmJAJ VM↔host index rewrites outbound messages only"* was correct; v2.36.0's correction of it was the error. What the index rewrites is the **host-facing** surface — the audit record and what the user sees — not what the agent sends or receives. The agent works in `/sessions/…` throughout.

## Why the binary settles it and the record could not

The Desktop's path gate is a **pure string prefix test** — one site, identical across `app.asar` 1.22209.0, 1.24012.1 and 1.25927.0, and absent from the agent bundles entirely:

```js
var Q = ['file_path', 'path'];
function ut(e, n) {
  if (m.E.includes(e))                                    // HOST_LOOP_PATH_GATED_BUILTIN_TOOLS
    for (let r of Q) {
      let i = n[r];
      if (typeof i === 'string' && (i === '/sessions' || i.startsWith('/sessions/')))
        return { behavior: 'deny', message: `\`${i}\` is a VM path. …` };
    }
}
```

Both call sites — a `PreToolUse` hook and `canUseTool` — pass the **raw** tool input. A path beginning `/Users/` cannot reach this branch. So the moment the record showed a host path producing this message, the record had to be wrong; no amount of re-reading it would have revealed that.

> **Method, the hard way.** The v2.36.0 pass stated, repeatedly and prominently, that its evidence was read *"first-party from each session's own on-disk `audit.jsonl` rather than from the pasted transcript."* For path questions that is exactly backwards. A record maintained by the component under study is not a neutral observer, and "first-party" is not a synonym for "authoritative" — **ask what the artifact is for**. The audit log exists to show a human what happened in terms they can act on, so it speaks in host paths by design. Corroborate any path claim against the agent's own transcript, or against the binary that implements the check.

---

# LESSON 144 — WHAT THE TWO RECORDS ARE FOR

**A Cowork session writes two independent logs. They disagree by design, and which one is authoritative depends on the question.**

| | `audit.jsonl` | `.claude/projects/<slug>/<id>.jsonl` |
|---|---|---|
| written by | the Desktop | the agent |
| location | session root | under the session's `.claude/` |
| paths | **translated to host form** | as the agent sent and saw them |
| carries | `system/init` (tool surface, plugins, skills, model, `permissionMode`), `_audit_hmac` | the conversation, sub-agent transcripts under `…/subagents/` |
| authoritative for | what the session was *configured* with | what actually *happened*, including every path |

Both are first-party. Neither is a substitute for the other.

**Use `audit.jsonl`** for the `system/init` record — the authoritative tool surface (Ch37/L129), the plugin list with staging paths, the resolved model and permission mode. None of that is path-form-sensitive.

**Use the agent transcript** for anything about paths, commands as issued, tool results as the model received them, and sub-agent behaviour.

## The one place the translation is visible without a second record

The translation maps the **current session's** mounts only. Paths belonging to another session have no mapping and pass through unchanged — which is why a listing of a stranger's directory appears identically in both records while the session's own `outputs` path does not. A mixture of both forms inside a single `audit.jsonl` record is therefore not evidence about the shell; it is the translator's coverage showing through.

**Author consequence.** `paths.relative-filenames` stands, on its original reasoning: the shell and the file tools name the same place differently, and a relative filename is correct for both. The shell operates and reports in `/sessions/…`; the file tools require the host form and **deny** `/sessions/…` outright, exactly as Ch35/L122 documented.

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
