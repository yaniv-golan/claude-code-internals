Updated: 2026-09-23 | Source: **`app.asar` 2.7032.0** (live install, extracted; sha256 `60d7d5fc4dfc772ca22dbb5e4953f98cf3787f6441561b18c53e84cb4ae82a4d`) diffed against **`app.asar` 2.2553.1** (sha256 `57fe19e9f0d7e6cff7423a830674696d826d13f33792fdbaa6bb41637e991cca`) and **1.46388.4** (sha256 `c48a2abd…`), the **in-VM ELF `claude-code-vm/2.1.280/claude`** (sha256 `a1b25d70cbf780b87517e91f0a14ce82c8e1fe46d2d0f3a0cf0bce6f00124f45` — the RC build, see L192) against **ELF 2.1.260** (`9811afb5…`), the **Desktop-managed host Mach-O 2.1.280** (`862db5f3…`) and **2.1.275** (`b926bde3…`), a **live GrowthBook fcache decoded 2026-09-23**, **live probes of the release CDN**, and **this machine's own Desktop log and Cowork transcripts across the 2.2553.13 → 2.7032.0 upgrade**. **Does NOT move the CLI content baseline.**

Prompted by the `cowork-harness` project's 2.7032.0 parity sync, then re-derived first-party. Its headline — "every consumer repointed at the outputs dir" — is half right: the writable roots collapsed onto outputs, but the agent's working directory moved *off* it.

# Chapter 52: Desktop 2.7032.0 — The Working Directory Leaves Outputs, and One Version Number Names Two Builds

---

## TABLE OF CONTENTS

190. [Lesson 190 — The Host-Loop Agent Now Runs in an Empty, Denied Directory](#lesson-190--the-host-loop-agent-now-runs-in-an-empty-denied-directory)
191. [Lesson 191 — `TaskOutput` Is Removed, and Removed Tools Now Have a List](#lesson-191--taskoutput-is-removed)
192. [Lesson 192 — One Version Number, Two Builds: Desktop Can Pin a Release Candidate](#lesson-192--one-version-number-two-builds)
193. [Lesson 193 — The 2026-09-23 fcache, and What the VM Bundle Directories Really Are](#lesson-193--the-2026-09-23-fcache-and-the-vm-bundle)
194. [Lesson 194 — What Else Changed in the Cowork Spawn: a Cloud Memory Server, Env Stripping, and Smaller Changes](#lesson-194--what-else-changed-in-the-cowork-spawn)

---

# LESSON 190 — THE HOST-LOOP AGENT NOW RUNS IN AN EMPTY, DENIED DIRECTORY

**From Desktop 2.7032.0, the host-loop Cowork agent's working directory is `/var/empty` — not the session outputs folder. The file tools can no longer be given a bare filename: a relative path is refused, or for a search, re-anchored to outputs. Give the file tools the outputs folder's absolute path; it is correct on every release.**

## Measured, with the agent held constant

An hourly scheduled Cowork task on the capturing machine ran across the upgrade. Desktop's own log (`~/Library/Logs/Claude/main.log`) records the app version and, for every host-loop spawn, the options it passed:

```
2026-09-22 20:12:05   appVersion: '2.2553.13'
2026-09-23 00:23:02   appVersion: '2.7032.0'

[HostLoop] sdkOptions after patch: { cwd: '<…>/local-agent-mode-sessions/<acc>/<org>/<session>/outputs', … }   ← through 09-23 00:05
[HostLoop] sdkOptions after patch: { cwd: '/var/empty', … }                                                  ← from 09-23 01:05
```

Each run's transcript records the agent build and the working directory it saw:

| Desktop | agent | recorded `cwd` | runs |
|---|---|---|---|
| 2.2553.1 | 2.1.275 | `<session>/outputs` | every run 09-21 → 09-22 20:01 |
| 2.2553.13 | **2.1.280** | `<session>/outputs` | 4 of 4 |
| 2.7032.0 | **2.1.280** | `/private/var/empty` | 9 of 9 |

The same agent install ran both ways — not merely the same version string (see L192): Desktop 2.2553.13 downloaded agent 2.1.280 at 20:12–20:14 and 2.7032.0 reused those files unchanged. So the change is on the Desktop side, and it arrived at 2.7032.0 — 2.2553.13 still used outputs. (9 of 9 was the count at capture; the task keeps running.) The agent records the resolved spelling (`/private/var/empty`); Desktop logs the literal one.

## The mechanism

`index.chunk-Cpo4PQ3e.js` (2.7032.0):

```js
sessionDirPaths(e){return{outputsDir:join(e,"outputs"),claudeDir:join(e,".claude"),
  hostProcessCwd:t.SM()??join(e,"host-cwd")}}
getHostProcessCwd(e){…let{hostProcessCwd:n}=this.sessionDirPaths(t);
  return n!=="/var/empty"&&this.ensureDirSyncOnce(n),n}
```

`t` is `require("./index.chunk-D3OyLXgG.js")`, whose export table binds `SM` to `_1t`:

```js
HZt="host-cwd", UZt="/var/empty", WZt=`{"private": true}\n`
function _1t(){ if(g1t===void 0){ g1t=null;
  let e=h1t(()=>statSync(UZt));        // null unless: a directory, owned by root, not group- or world-writable
  e===null ? g1t=UZt
           : N.info(`[HostLoop] system empty cwd ${UZt} not used (${e}); the per-session dir is the CLI's cwd`) }
  return g1t }
```

So the cwd is `/var/empty` wherever that directory is sound — which it is on a stock Mac (`root drwxr-xr-x`) — and otherwise a new per-session folder `<session>/host-cwd`, seeded with a `{"private": true}` `package.json`. The spawn assigns it directly (`e.cwd=d`, where `d` is `hostProcessCwd`) and reports which one it used: `lam_host_loop_session_started{process_cwd_kind: d==="/var/empty" ? "system_empty" : "host_cwd"}`.

2.2553.1 had no such split. Its spawn took `hostCwd:h??r.getOutputsDir(i)` and assigned that. Across the three builds (`.vite/build` only):

| identifier | 1.46388.4 | 2.2553.1 | 2.7032.0 |
|---|---|---|---|
| `hostLoopCwd` | 6 | 6 | 0 |
| `hostCwd` | 9 | 9 | 1 |
| `getHostProcessCwd` | 0 | 0 | 2 |
| `process_cwd_kind` | 0 | 0 | 2 |

The one surviving `hostCwd` is a template-substitution key, now filled from the outputs dir.

## The directory is denied, not just empty

The spawn computes the cwd's spellings and turns them into deny rules:

```js
async function Wvr(e){let[t,n]=await Promise.all([Vvr(),Bvr(e)]),r=[...t,...n];
  return{roots:r,cwdSpellings:n,rules:[...Hvr(r),...Uvr(n)]}}
// Hvr: Edit/Write/MultiEdit(<root>/**) for every root; Uvr: Read(<spelling>/**)
// Vvr(): Bvr(<userData>/local-agent-mode-sessions/plugin-cache)
// Bvr(p): p, its realpath, NFC forms, and the macOS firmlink (/System/Volumes/Data) spellings
```

In the host-loop setup those rules go straight into `e.disallowedTools` and the `deny` list. Every spelling of the working directory is closed to reading and writing, and the shared plugin cache to writing.

## What changed in the path gate

The path-gating PreToolUse hook (matcher `Read|Write|Edit|Glob|Grep|MultiEdit`) used to resolve a relative path against the old cwd:

```js
// 2.2553.1
function dd(e,n){let r=t.cP(e.trim());return t._j(r)?null:isAbsolute(r)?r:resolve(n,r)}   // called dd(path, hostCwd)
```

In 2.7032.0 there is no cwd to resolve against, and a relative path meets two checks in sequence.

**First, the agent.** Agent 2.1.280 expands `file_path` against its own cwd (`et(file_path)`) and runs each tool's `validateInput` *before* any PreToolUse hook. For `Read`, `Write` and `Edit`, that validation checks the path against the deny rules above:

```js
// Read.validateInput (Write and Edit check "edit" the same way)
let y=et(g);if(Ea(y,s.permissions(),"read","deny")!==null)
  return{result:!1,message:FRt,errorCode:1,deniedByPermissionRule:!0};
// FRt = "File is in a directory that is denied by your permission settings."
```

A bare `report.md` becomes `/private/var/empty/report.md`, matches the deny rule, and is refused there as a tool error. Desktop's hook never sees it.

**Second, Desktop's hook.** The path-gating hook treats a path as relative if it is relative **or** absolute under any spelling of the cwd (`cwdSpellings`), with `zd=["Write","Edit","MultiEdit"]` and `Bd=["Grep","Glob"]`:

| tool | what happens to a relative path |
|---|---|
| `Read`, `Write`, `Edit` | refused by the agent at validation (above), before the hook: "File is in a directory that is denied by your permission settings." |
| `Grep`, `Glob` | no deny check in their validation, so they reach the hook, which **rewrites** the path to `resolve(outputs, x)` via `updatedInput` if that lands inside an allowed root (no path means `.` → outputs), and otherwise blocks |
| `MultiEdit`, or a relative path reaching the hook unexpanded | the hook's own blocks: "`<Tool>` needs an absolute path here — use `<outputs>/x` for `x`." for a still-relative path, and for a write under the cwd "`<path>` is plugin content or the app's private working directory and cannot be written; use the outputs directory." |

This is a static reading; no run on the capturing machine exercised a relative path, and neither message appears in its transcripts. The outcome for the file tools is not in doubt: a relative path is refused, at the agent, at the hook, or both. "needs an absolute path here" appears 0 times in 1.46388.4 and 2.2553.1 and 2 times in 2.7032.0, but on agent 2.1.280 the agent's own validation fires first for `Read`, `Write` and `Edit`.

The writable roots collapsed with it. `writablePaths` was `[hostCwd, hostOutputsDir]` — the same directory twice — and is now `[hostOutputsDir]`.

## What the model is told

All three places the model learns about paths were updated together:

- **The Desktop system prompt's host-loop shell section** gains one sentence (0/0/1): *"The file tools' own process working directory is a private app folder you cannot read or write, so always pass them absolute paths under `<outputs>` or a connected folder."* Template variables that name a working directory (`{{cwd}}`) are filled from the outputs dir (`Le=w&&Ee?Ee:O`, `Ee` = `hostOutputsDir`), as before.
- **The agent's own environment block** reports the real cwd: `Primary working directory: /private/var/empty`. The outputs dir appears under "Additional working directories", because the spawn now sets `permissions.additionalDirectories` to `[outputs]` (0/0/1). This is recorded in every post-upgrade transcript on the capturing machine.
- **The sub-agent environment text** used to say *"Relative paths in these tools start at `<outputs>`."* It now says *"Pass absolute paths to these tools."* (1/1/0 and 0/0/1 across the three builds.) Every other line of that folder list is unchanged apart from minifier renames.

Chat-mode sessions changed the same way: their prompt drops the line that bare filenames resolve into the scratch directory, and gains a `<scratch_directory_path>` block naming the absolute path to use.

## For a skill author

- **Write the outputs folder's absolute path** in file-tool calls, and in any path you put in a sub-agent's prompt. It is correct before and after 2.7032.0, and a user may be on either.
- A bare filename that worked on an older Desktop now fails **loudly**: the call is refused with a message. Before, the classic failures were silent (a doubled `outputs/outputs/x`, a decoy folder). A skill that relied on a bare filename breaks visibly, not quietly.
- Nothing about the shell changed. `mcp__workspace__bash` still starts at `/sessions/<id>` and still needs `/sessions/<id>/mnt/outputs/...` (L163).

The measured runs above are one scheduled task on one machine. They establish the working directory; they did not exercise a relative path, so the refusal messages are read from the shipped code, not observed.

---

# LESSON 191 — `TASKOUTPUT` IS REMOVED

**The `TaskOutput` tool is gone from agent 2.1.277 on. A background task's output is read from its output file with `Read`. The old name and its four aliases are now on a list of removed tools, and 2.1.280 warns when a permission rule or `--tools` entry still names one. Between 2.1.260 and 2.1.275 the `REPL` tool was removed too, without a changelog line, and three tools arrived unannounced.**

## Timing

| | Mach-O 2.1.260 | Mach-O 2.1.275 | Mach-O / ELF 2.1.280 |
|---|---|---|---|
| `TaskOutput` tool definition (searchHint "read output/logs from a background task") | 2 | 2 | 0 |
| canonicalizer entries | 12 | 12 | 8 |
| removed-tools set | 6 names | 6 names | 11 names |
| "names a removed tool" warnings | 0 | 0 | present |

The official CHANGELOG puts it under **2.1.277**: *"Removed the deprecated TaskOutput tool; Claude reads a background task's output file with Read instead, and the `taskOutputMaxChars` setting and `TASK_MAX_OUTPUT_LENGTH` no longer have any effect."* No 2.1.276–2.1.278 binary was on hand, so the version comes from the changelog and the bracket from the binaries. In 2.1.280, task notifications tell the model to "Read the output file to retrieve the result", and the `taskOutputMaxChars` setting description says it has no effect.

## The name map and the removed list

The canonicalizer rewrites legacy tool names before resolution. In 2.1.260 it was:

```js
var i={Task:"Agent",KillShell:"TaskStop",KillBash:"TaskStop",
  AgentOutputTool:"TaskOutput",BashOutputTool:"TaskOutput",AgentOutput:"TaskOutput",BashOutput:"TaskOutput",
  ListPeers:"ListAgents",Brief:"SendUserMessage",
  ListMcpResources:"ListMcpResourcesTool",ReadMcpResource:"ReadMcpResourceTool",ReadMcpResourceDir:"ReadMcpResourceDirTool"};
```

2.1.280 drops the four `*Output*` rows. They, and `TaskOutput` itself, join a set that already held six retired names:

```js
new Set(["Frame","FrameRead","TeamCreate","TeamDelete","SuggestBackgroundPR","AutofixPr",
         "TaskOutput","AgentOutputTool","BashOutputTool","AgentOutput","BashOutput"])
```

A name on that list is skipped rather than treated as a typo, in four places: a permission rule naming it (with the warning "Permission … rule names a removed tool"), a `--tools` exclusion naming it (with "--tools exclusion names a removed tool"), the deferred-tool added-names delta, and the wire-consistency check that would otherwise warn about a tool with no loaded definition.

For a skill or plugin author: an `allowed-tools` or permission rule that still says `TaskOutput` or `BashOutput` does nothing on 2.1.280 and logs a warning. A skill that told the model to poll a background task with `TaskOutput` needs to say "read the task's output file" instead.

## Not the same thing as `toolAliases`

`toolAliases` (Ch35/L121) is a separate, single-hop SDK `initialize` option that the host sets: in Cowork host-loop, `{Bash: mcp__workspace__bash, WebFetch: mcp__workspace__web_fetch}`. It remaps what the *model* emits to what *runs*. The canonicalizer is built into the agent and rewrites *legacy* names. A tool's own `aliases:[…]` list is a third mechanism. The TaskOutput removal touched only the canonicalizer and the tool's own list.

One interaction worth knowing, unchanged since at least 2.1.227: the Workflow `agent()` option **`bashCommandClamp`** (a list of `Bash(<prefix>)` rules that limits a spawned agent's shell to those command forms, fail-closed, and that also disallows `REPL`, `mcp__*` and PowerShell for it) **refuses to spawn** when the host remaps Bash or PowerShell through `toolAliases`, because the clamp cannot be guaranteed to apply to the alias target. Under host-loop Cowork, Bash is always remapped, so a clamped `agent()` fails at spawn there.

## Other tool-surface changes, 2.1.260 → 2.1.280

- **`REPL` removed**, between 2.1.260 and 2.1.275 (its searchHint "execute JavaScript with programmatic tool access": 2 → 0). `CLAUDE_REPL_VARIANT` and `CLAUDE_REPL_VERBOSE` went with it. Not in the changelog.
- **New, unannounced, all present from 2.1.275:** `SubagentHandback` (a sub-agent delivers its final report through a tool call; gated by `CLAUDE_CODE_SENDMESSAGE_HANDBACK`, else the flag `tengu_lively_waffle` defaulting on, and only in auto mode), `FetchInboxMessage`, and `AppifactRepl`.
- **Control protocol:** about twenty subtype strings new since 2.1.260 by a string-set diff, none removed (apparent removals were comparisons moved into `switch` statements). Four confirmed individually, each 0 in 2.1.260: `turn_handoff_available`, `turn_preempted`, `dev_intent`, `peer_message_hold`.
- **Hook events:** unchanged at 33.

A method note from this diff: each agent binary embeds the last ten or so versions of its own changelog as a string. A raw string-set diff between two builds reports that changelog churn as code changes unless the embedded changelog is excluded first.

---

# LESSON 192 — ONE VERSION NUMBER, TWO BUILDS

**A Desktop release can pin its bundled agent to a release-candidate build. An RC has three possible fates, and in one of them the stable channel later serves a *different* binary under the same version number. A version string does not identify an agent build; a checksum or a manifest commit does.**

Probed live, 2026-09-23, against `https://downloads.claude.ai/claude-code-releases`.

## Where the pin lives

A Desktop `app.asar` embeds the base URL it downloads its agent from. 1.46388.4 and 2.2553.1 embed the stable base, `…/claude-code-releases`. 2.7032.0 embeds an RC base (and so did 2.2553.13, which this machine's Desktop log shows downloading both agent builds from it at 2026-09-22 20:12–20:14; 2.7032.0 reused them):

```
"baseUrl":"https://downloads.claude.ai/claude-code-releases/rc/bddba3abd5da53d0c540cfc76a8d18b44633d568"
```

This is not new. Across the Desktop builds on hand, 1.24012.9 and 1.24012.11 pinned `rc/7006c4c3…` and 1.40609.1 pinned `rc/aa8f2d98…`.

## Each RC base serves one version

Scanning `2.1.200`–`2.1.285` under each RC base returns exactly one hit per base. What happened next differs every time:

| RC base | serves | stable path for that version | fate |
|---|---|---|---|
| `rc/7006c4c3…` | 2.1.219 | same `commit` 7006c4c3, same `buildDate` 2026-07-24T03:34:26Z | **promoted unchanged** |
| `rc/aa8f2d98…` | 2.1.255 | **404** on `manifest.json` and `manifest.zst.json` | **never promoted** |
| `rc/bddba3ab…` | 2.1.280 | 200, but `commit` 80abbfe7, `modsCommit` 8187baaa, `buildDate` 2026-09-21T20:55:27Z | **superseded by a different build** |

For 2.1.280 the two manifests disagree on everything that identifies a build:

| | RC | stable |
|---|---|---|
| `commit` | bddba3ab… | 80abbfe7… |
| `modsCommit` | 7974a707… | 8187baaa… |
| `buildDate` | 2026-09-21T02:02:16Z | 2026-09-21T20:55:27Z |
| linux-arm64 size | 233,037,816 | 233,103,352 |
| linux-arm64 checksum | a1b25d70… | 92f2b4fd… |

The in-VM agent on this machine (`claude-code-vm/2.1.280/claude`) is 233,037,816 bytes with sha256 `a1b25d70…` — the RC — and the host Mach-O (217,221,744 bytes) matches the RC's darwin-arm64 size, not stable's 217,254,576. Controls: `2.1.281` returns 404 under both bases, so the 200s are real; the `stable` pointer returned `2.1.267` and `latest` returned `2.1.280`.

## What this changes

- **L189's "not every version is served" has a cause.** 2.1.255 is not missing; it only ever existed as an RC. A version that 404s on the stable path may still be recoverable from an RC base — if you know the base, which a Desktop asar of that era carries.
- **"Same version" is not "same binary".** Two people reporting agent 2.1.280 may be running different builds: the one a Desktop staged, and the one the CLI installer fetched. When a behaviour differs between two installs that claim the same version, compare checksums before looking for a cause.
- **Pin evidence by checksum.** A lesson, a bug report, or a regression baseline that records only a version number cannot be reproduced exactly when the version has two builds. This skill records sha256 for every artifact for that reason.

---

# LESSON 193 — THE 2026-09-23 FCACHE AND THE VM BUNDLE

**The live gate snapshot moved little: one documented gate flipped on, Opus 5.5 joined the Cowork model allow-list, and one runtime key was added. The Desktop upgrade did not replace the VM image. And the `vm_bundles/warm/` directory is a download cache, not a pool of running VMs.**

## The snapshot

| | 2026-09-05 | 2026-09-23 |
|---|---|---|
| content16 | `5c4ad148aca13387` | `f82df085d027eff0` |
| embedded timestamp | 1788622324310 | 1790144587775 (2026-09-23T06:23:07Z) |
| features | 322 (176 on) | 371 (203 on) |
| served by | Desktop 1.46388.4 | Desktop 2.7032.0 |

`content16` is the sha256 of the canonical feature map (L141); it was reproduced independently by two decoders on this capture.

**The file header changed, the recipe did not.** The 8-byte magic is `CLF` + a version byte + 4 bytes. The writer emits version `\x01` through Desktop 1.32885.1 and `\x02` (`CLF\x02\x00\x9a\xb7\xe2`) from 1.34493.1 on. The gzip stream still starts at byte 8, so `tail -c +9 fcache | gunzip` still works. A decoder that checks for the literal `CLF\x01` rejects every current file.

## What moved

Of the 57 gates this skill pinned from the fcache before this pass, 56 are unchanged in state. The movements:

- **`2529235968`** (plugin-declared MCP shadow file, L182) — `defaultValue`/off → **`force`/on** (rule `fr_mt94q5rk`). L182 called it served-and-off, which meant a server rule could turn it on without a client release. One did.
- **`3045399524`** (model allow-list) — `enabled` now lists `claude-fable-5[1m]`, `claude-fable-5`, `claude-fable-5-1[1m]`, `claude-fable-5-1`, **`claude-opus-5-5[1m]`, `claude-opus-5-5`**.
- **`1978029737`** (Cowork runtime config) — a twelfth key, **`remoteBashVmStartHandling: true`**. Its consumer appears first in 2.2553.1 (0 in 1.46388.4, 1 in 2.2553.1 and 2.7032.0) and belongs to the remote-devices bridge's `device_bash` (L126), not to local workspace bash. Read with a `false` default, it lets the first call in a session wait longer for a booting VM, distinguishes a VM that is still starting (`workspace_starting`) from one that failed to start (`workspace_failed`), and refuses to run a command when the VM became ready too late in the call to leave it enough time (`workspace_ready_late`, "Nothing was executed … run it again").

Five pinned gates are still served but have no consumer in any of the three asars on hand — `1598976391`, `2039376689`, `2976814254`, `3246569822`, `364911507`. "No consumer in the asar" is as far as this goes: the Desktop also renders claude.ai web code that is not in the asar, and `364911507` is an experiments map. Also unchanged: `3577536076` (iOS simulator, L125) is still force-on and still cannot reach Cowork.

## The VM image did not change

The Desktop pins its VM image by sha in an embedded manifest ("Written by the update-manifest step … do not hand-edit"):

| Desktop | pinned image sha | published |
|---|---|---|
| 1.46388.4 | `2a762adf…` | 2026-08-13 |
| 2.2553.1 | `882518393ed4ce89020bd48d99d5daf114999773` | 2026-09-11 |
| 2.7032.0 | `882518393ed4ce89020bd48d99d5daf114999773` | 2026-09-11 |

On disk, `vm_bundles/claudevm.bundle/.rootfs.img.origin` and its siblings all read `882518393…`, written 2026-09-15 — a week before 2.7032.0 was installed. A Desktop release is not a VM release; to know which guest a session ran, read the `.origin` files, not the app version.

## `vm_bundles/warm/` is a download cache

`vm_bundles/warm/<sha>/` directories are where VM images are fetched ahead of an update, keyed by image sha; once an image is promoted the downloaded file is deleted, so the directory is left empty:

```js
N.info(`[warm] YukonSilverConfig received, autoDownloadInBackground=${i}`) …
let{maybeWarmDownloadForUpdate:a}=await …require("./index.chunk-B7jCsIXh.js") …
t.RA.info(`[warm] Starting warm download for VM SHA: ${e} (${c.length} files, arch=${s})`),
t.MA("lam_vm_warm_download_started",{bundle_version:e,app_version:r,file_count:c.length})
```

On the capturing machine there are two, one per image sha above, both empty. L117 read an empty `warm/<hash>/` directory as a hint that several sessions share one warm guest. That reading does not follow: the directory is a prefetch location, and it says nothing about how sessions map to VMs.

---

# LESSON 194 — WHAT ELSE CHANGED IN THE COWORK SPAWN

**Between Desktop 1.46388.4 and 2.7032.0 the Cowork spawn gained a cloud-backed `memory` MCP server that takes over any server of that name, stopped passing host-only paths into a VM-loop agent, and picked up a handful of smaller settings. None of these changed the tool list or the forced-ask hooks.**

Counts are `.vite/build` only, as 1.46388.4 / 2.2553.1 / 2.7032.0.

## A cloud memory server named `memory` (from 2.2553.1)

```js
var Vi="/v2/ccr-sessions/-/memory/mcp",
    Hi=new Set(["memory_read","memory_list","memory_write","memory_str_replace","memory_append","memory_delete"]),
    Ui=new Set(["memory_read","memory_list"]), Wi="anthropic.com/memoryGuidance";
function ia(){return t.tz("946844604")&&t.kW().canSyncCoworkMemoryRemotely()&&!t.wz()}
async function Da(e,n,r){!ia()||r.memoryEnabled===!1||(
  n.memory&&t.mK.warn("[memoryMcpServer] replacing a configured MCP server named %s with the cloud memory relay",t.RN),
  …, n[t.RN]=Pa(r),
  e.allowedTools=[...e.allowedTools??[],...Zi(r.getBinding())?Ea:Ta])}
```

- The Desktop registers an in-process SDK-MCP server named **`memory`** (`t.RN`) that relays to a cloud endpoint. It is on when gate **`946844604`** is on (force-ON at the 2026-09-23 capture), the account is first-party, and the account is not HIPAA-restricted (`t.wz()`, refusal code `hipaa_restricted`). The endpoint string is 0/1/1.
- **An MCP server configured under the name `memory` is replaced** — for example `mcpServers.memory` in `claude_desktop_config.json`, a common name for the reference memory server — with only a warning in the Desktop log, and `memory` is added to `deniedMcpServers`. Whether a *plugin*-declared server is affected is not established: the agent names plugin servers `plugin:<plugin>:<server>`, which an exact-name deny on `memory` would not obviously match, and the replacement keys on the Desktop's own server map.
- `memory_read` and `memory_list` are always pre-approved. All six are pre-approved when the session has a live memory project binding (verified, or not yet settled). Even then, a write is refused at call time unless the binding is verified, the server admits writes, and its guidance was applied.
- When the server supplies guidance, the Desktop appends it to both the main system prompt and the sub-agent prompt, and sets `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT=1` so the sub-agent append actually takes effect (Ch35/L123).

**Observed.** On the capturing machine, 30 of the 31 Cowork runs since 2026-09-21 — nearly all of them one hourly scheduled task — were offered `mcp__memory__memory_list` and `mcp__memory__memory_read` in their tool list, and none a write tool. None of them called a memory tool.

## A VM-loop agent no longer gets host paths (from 2.2553.1)

The spawn env used to be assembled as `...t.cd({…}),...m.env,...h`. From 2.2553.1 it passes through a filter keyed on where the agent runs:

```js
function P1n(e,t,n){let r=n.cliRunsOnThisHost?e=>e:N1n;return{...r(e),...t.secrets.env,...r(t.overrides)}}
```

With `cliRunsOnThisHost` false (VM-loop), the filter drops variables that only make sense on the host: `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_TMPDIR`, `HOST_CREDS_FILE`, the proxy variables, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_*`, OTLP certificate paths, cloud credential-file paths, and any `*_FILE_DESCRIPTOR`. Secrets pass through unfiltered. The filter existed in 1.46388.4 but was not applied to the Cowork spawn. (`cliRunsOnThisHost` 10/17/18.)

## Smaller changes

| change | from | detail |
|---|---|---|
| `CLAUDE_CODE_DESKTOP_APP_VERSION` | 2.2553.1 | the Desktop version, passed to the agent (empty in third-party builds). 0/4/4 |
| `CLAUDE_CODE_DISABLE_CRON` from policy | 2.2553.1 | set when the admin policy `scheduledTasksEnabled` is `false`, which also disallows `CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup` |
| shared plugin cache | 2.2553.1 | `CLAUDE_CODE_PLUGIN_CACHE_DIR` + `FORCE_AUTOUPDATE_PLUGINS=1`, only when gate `1978029737`'s `sharedPluginCache.enabled` is set, managed settings declare marketplaces, the agent is ≥ 2.1.232 and the path has no spaces. 0/7/7 |
| `CLAUDE_ARTIFACT_HOST_GRANT` | 2.2553.1 | JSON `{v:1,servers:[{server:"host:<name>",tools}]}` granting frame artifacts access to named host tools, capped at 50 servers × 200 tools. How the agent consumes it was not traced. 0/4/4 |
| transcript folder `projects/session/` | 2.7032.0 always | `CLAUDE_CODE_PROJECT_DIR_NAME="session"`: 1.46388.4 set it for third-party builds only, 2.2553.1 under a condition, 2.7032.0 always. A Cowork transcript is at `…/.claude/projects/session/<cliSessionId>.jsonl`, no longer under a folder named after the cwd |
| path gate on `Artifact*` tools | 2.2553.1 | a PreToolUse hook on `/^Artifact[A-Za-z]*$/` checks `file_path`, `out_dir`, `root` and `files`; from 2.7032.0 relative `root`/`out_dir` are re-anchored to outputs |
| OTLP egress allowlist | 2.7032.0 | still appends exactly one host, and still skips when the list holds `*`. New: a wildcard, dotless (except `localhost`), IPv6 or trailing-dot host is refused with a one-time warning instead of appended. 0/0/2 |
| remote-folder `.claude` staging | 2.7032.0 | a connected remote folder's `.claude/CLAUDE.md` and `.claude/rules/**/*.md` are staged (up to 50 files, 8 MiB), behind gate `4018447017` on top of `144158705` |

## Unchanged across all three builds

The resolved `tools`/`allowedTools` list apart from the memory additions, the four PreToolUse matchers (Task, Skill, the forced-ask set, `mcp__.*`), the sub-agent prompt templates, and the spawn-env gate set.

