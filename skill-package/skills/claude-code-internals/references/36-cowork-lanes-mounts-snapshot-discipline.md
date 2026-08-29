Updated: 2026-08-05 | Source: Multi-artifact first-party against THIS installation. Artifacts: Desktop `app.asar` **1.25927.0** (live, sha256 `a291ff78…`) diffed against **1.24012.1** (prior skill baseline) and **1.24012.11**; Desktop-managed host agent Mach-O **2.1.221**; the live gzip-wrapped GrowthBook `fcache` (5 decodes across 30 min, content `9d75909785dc344e`); Desktop's **Chromium HTTP cache** (`Cache_Data`, a previously unused artifact class); on-disk `local-agent-mode-sessions/**` session records; `swift_addon.node`; and **two live Cowork probes** run by the operator in real host-loop sessions (`awesome-intelligent-franklin`, `peaceful-hopeful-feynman`), the second with a connected-folder control. **Tier discipline:** L138 is first-party from live API traffic + asar; L139 and L140 are live-probe measurements with an explicit control; L141 is measured (60-sample sampler) plus cross-validated against the `claude-cowork-headless-emulator` project's independent implementation; L142 is first-party asar. Claims that remain inference are marked inline. The mount/delete findings were produced through a multi-round mutual-correction exchange with that project; corrections flowed both directions and are recorded where they bear on a claim.

**Prior-lesson corrections landed by this chapter:** Ch31/L117's session-to-VM multiplexing inference is **confirmed** (L140). Ch26/L109's `scheduledTaskStaleReapEnabled` is **unserved and running on a code default of `true`** (L141). Ch24/L107's forced-ask matcher gains a **behavioural** confirmation (L139). Ch25/L108's Cowork spawn-env catalog is materially out of date (see the L141 addendum pointer).

# Chapter 39: Cowork Execution Lanes, Mount Semantics & Snapshot Discipline

---

## TABLE OF CONTENTS

138. [Lesson 138 — Two Execution Lanes: `bridge` vs `anthropic_cloud`, and Why `cse_` Is Not the Oracle](#lesson-138----two-execution-lanes)
139. [Lesson 139 — Delete Semantics: Per-Mount FUSE Policy, `unlink`+`rmdir` Only](#lesson-139----delete-semantics)
140. [Lesson 140 — VM Multiplexing Confirmed, Isolation Holds, and the Real Mount Inventory](#lesson-140----vm-multiplexing-and-the-real-mount-inventory)
141. [Lesson 141 — Snapshot Discipline: the fcache Is a Moving Target with Two Absence Axes](#lesson-141----snapshot-discipline)
142. [Lesson 142 — `coworkSyspromptMap`: a Server-Driven Prompt REPLACE Channel](#lesson-142----coworksyspromptmap)

---

# LESSON 138 — TWO EXECUTION LANES

**Cowork runs in two structurally different lanes, and the discriminator is `environment_kind` ∈ {`bridge`, `anthropic_cloud`} — never the session-id prefix. Every chapter before this one models the local lane only. Which lane a given session gets is NOT determinable from any local artifact.**

## The oracle

Session records streamed over `claude.ai/v1/code/sessions/watch` carry both fields:

| `environment_kind` | records observed | paired `config.origin` | meaning |
|---|---|---|---|
| `bridge` | 1598 | `claude_code_cli` (471) | a **locally-executing** session registered with the server for cross-device watch / remote control — Ch33/L119's bridge mechanism |
| `anthropic_cloud` | 221 | `desktop_app` (221) | **the remote Cowork lane** — agent loop and code execution on Anthropic's servers |

## ⚠️ `cse_` is NOT a lane oracle

`cse_<ULID>` is the id space for **any** server-registered Claude Code session, local ones included. The newest record in this machine's cache is `cse_01KLVvaSTRgMYYfjym2c5VRV` with `origin:"claude_code_cli"`, `tags:["remote-control-auto"]`, `environment_kind:"bridge"` — **the very CLI session that performed this capture, executing locally on the host.**

Counting `cse_*` ids therefore overstates cloud usage, and an inference built on that count ("cloud sessions predate the probes by weeks") does not survive. **Discriminate on `environment_kind`; the id prefix tells you only that the server knows about the session.**

## A live remote-lane record

```json
{"client_metadata":{"remote_cowork":{"userSelectedFolders":[]}},
 "config":{"effort_level":"high","mcp_connector_ids":[],"model":"claude-fable-5",
           "origin":"desktop_app","outcomes":[],"permission_mode":"auto","sources":[]},
 "connection_status":"connected","created_at":"2026-07-21T04:47:53Z",
 "environment_id":"env_011111111111111111111117","environment_kind":"anthropic_cloud",
 "bound_device_uuid":"789a0a00-…",
 "external_metadata":{"container_cc_version":"2.1.216","last_served_model":"claude-fable-5",
   "permission_mode":"auto","permission_mode_seq":"16",
   "post_turn_summary":{"needs_action":"…","status_category":"review_ready","status_detail":"…"}}}
```

Five things this pins:

1. **`client_metadata.remote_cowork`** — the lane, named by the product.
2. **`environment_id` is the Managed-Agents id space** (`env_…`), tying Ch37/L130's `/v1/environments` directly to Cowork remote. Live endpoints seen: `claude.ai/v1/environments?include_archived=true&limit=1000` and `api.anthropic.com/v1/environments/{id}/work/poll?block_ms=100&ack=true` — the poll loop Ch33/L119 found vendored-but-unused.
3. **`container_cc_version` is a SIXTH artifact/version axis.** Observed: 2.1.204, 2.1.207, 2.1.210, 2.1.211, 2.1.212, **2.1.216**. The cloud container runs its own agent build, independent of the host CLI (2.1.221 here) and the Desktop-managed agent. 2.1.216 is exactly the emit floor Ch37/L130 pinned for VCS SDK events.
4. **`post_turn_summary` live schema** for Ch20/L89's classifier pipeline: `{needs_action, status_category, status_detail}` with `status_category` ∈ `need_input` (804) / `review_ready` (791) / `blocked` (12) / `failed` (4).
5. `bound_device_uuid` (Ch36/L126 device binding) + a sequenced `permission_mode_seq`.

## Lane selection is renderer-side — no fcache gate can answer it

Desktop main has **no lane branch**: `LocalAgentModeSessions.start` unconditionally creates a local VM session. The operative branch ships from claude.ai as server-delivered web content, gated by statsig (`yukon_silver` family), an org/admin bit, and Desktop's own capability probe — **now identified as gate `4116586025`** (`darwin`/`win32` + gate → `{status:"supported"|"unavailable"}`).

**Consequence:** the fcache is Desktop main-process GrowthBook, so *no fcache gate can hold the lane decision*. Ch35/L124's `1143815894` (host-loop vs VM-loop) governs split execution **within** the local lane — a different axis entirely, and the one this skill has been treating as the top-level architecture split.

## What differs across the lanes

| | local (`bridge`) | remote (`anthropic_cloud`) |
|---|---|---|
| cwd | `/sessions/<slug>` | `/home/claude` |
<!-- the local-lane cwd here is the shell's, and it predates the 1.32885.1 prompt fix — see Ch44/L163 -->
| delivery | `mcp__cowork__present_files`; **the `outputs/` directory itself is the channel** | `SendUserFile` → `internal__remote-devices__device_commit_files` — **delivery is an act, not a location** |
| local MCP servers | available | **cannot cross the boundary** |
| filesystem at session end | **hidden, not destroyed** — `archiveSession` deletes only `["uploads","uploads-tmp","doc-export-out"]` and does not fire at ordinary session end | **discarded** |
| host file access | direct (host-loop) | `device_request_folder_access` + `remoteSessionFolderGrants`, **only while the Desktop app is open** |

**Skill-authoring consequence:** a skill that writes to `outputs/` and states the path delivers correctly on local and **silently loses its deliverables on remote**. Anthropic's own **Cowork-staged** `skill-creator` handles this capability-conditionally: *"Check whether you have access to a tool that presents files to the user — `present_files`, or `SendUserFile` in Cowork remote. If you have neither, skip this step."* **Name the artifact, because two ship and they disagree:** the Cowork-staged skill pack (`local-agent-mode-sessions/skills-plugin/**/skills/skill-creator/SKILL.md`, staged 2026-07-25) carries the two-tool lane-aware wording quoted here; the marketplace plugin (`~/.claude/plugins/marketplaces/claude-plugins-official/**/skill-creator/SKILL.md`) names only `present_files` and has no lane clause. An adversarial review reading the marketplace copy concluded this quotation was fabricated — it is verbatim, from the other artifact. **"Anthropic's deployed skill-creator" is ambiguous and must never be used unqualified.** Never name `device_commit_files` in a skill — it is Desktop plumbing behind consent-gated folders.

## ⚠️ CORRECTED — "remote is the default" is withdrawn

An earlier revision of this lesson stated that *"since 2026-07-07 remote is the default for new
sessions on rolled-out accounts."* **Overclaimed; withdrawn.** Provenance is Anthropic's public Help
Center (relayed via the `claude-cowork-headless-emulator` project's lane forensics), not any artifact
on this machine — and **the same source calls remote execution "in beta and rolling out gradually
across plans"**, a qualifier the sentence dropped. It was also stated flat, with no evidence tier,
in a chapter whose header sets tiers for every other claim.

This machine's own data does not support it: the newest **local** session is current (2026-08-05)
while the newest **remote** record is 2026-07-23 — three weeks stale. On this account the local lane
is what runs.

**What is first-party and does hold:** both lanes exist and are distinguishable by `environment_kind`;
lane selection is decided renderer-side by an account-level rollout that cannot be read locally; so
**which lane any given reader is on is unknowable from here.** For anyone writing guidance that is the
load-bearing fact — not which lane is more common.

## Lane usage is per-account and observable

On this machine: remote sessions Jul 8 → Jul 23; **local sessions 465, newest Aug 4 23:59.** Both lanes real and concurrent. Post-hoc oracle: a new `local_*.json` under `local-agent-mode-sessions/<acc>/<org>/` means the local lane ran.

## METHODOLOGY — the Chromium cache is a readable artifact class

Desktop's `Cache_Data` entries are plaintext after a 24-byte simple-cache header (magic `0xfcfb6d1ba7725c30`), so `grep -a` works directly. It splits in two, and the split matters:

- **Frontend JS chunks are stale** — immutable hashed assets, Feb 2026 on this machine. The lane *mechanism* is readable there; the *current UI* is not.
- **API traffic is current.** This is the better evidence and is what produced everything above.

---

# LESSON 139 — DELETE SEMANTICS

**Every Cowork FUSE mount denies exactly `unlink` and `rmdir` by default — nothing else. Approval is strictly per-mount, takes effect live in already-open shells, and involves NO remount. The policy is not specific to `outputs`.**

## The measured matrix

Controlled probe, host-loop session, `outputs` approved and a connected folder deliberately **not** approved. Fresh fixtures per phase.

| operation | OUT before | OUT after | OUT fresh shell | FOLD before | FOLD after | FOLD fresh shell |
|---|---|---|---|---|---|---|
| `unlink` | **EPERM** | SUCCEEDED | SUCCEEDED | **EPERM** | **EPERM** | **EPERM** |
| `unlink` in subdir | **EPERM** | SUCCEEDED | SUCCEEDED | **EPERM** | **EPERM** | **EPERM** |
| `rmdir` | **EPERM** | SUCCEEDED | SUCCEEDED | **EPERM** | **EPERM** | **EPERM** |
| `truncate` / `O_TRUNC` | SUCCEEDED | SUCCEEDED | SUCCEEDED | SUCCEEDED | SUCCEEDED | SUCCEEDED |
| rename within mount | SUCCEEDED | SUCCEEDED | SUCCEEDED | SUCCEEDED | SUCCEEDED | SUCCEEDED |
| rename onto existing (dst destroyed) | SUCCEEDED | SUCCEEDED | SUCCEEDED | SUCCEEDED | SUCCEEDED | SUCCEEDED |

Cross-device rename (`outputs` → `/tmp`) gives **EXDEV** — outputs really is a separate device.

**Four consequences.** (a) `truncate` is **not** a delete; a harness that blocks it is stricter than production. (b) rename-within is legal, so "old path missing ⇒ deletion" is a false detector. (c) rename-onto-existing destroys the destination and is permitted. (d) The connected folder shows the **identical default**, so framing delete-denial around `outputs` is too narrow.

## Approval is per-mount, live, and involves no remount

`FOLD` is the control: it stayed EPERM in the same shell *and* a fresh one while `OUT` flipped. That rules out a session-wide privilege change, a global remount, and timing coincidence — none of which an outputs-only probe can exclude.

**Both mount lines were byte-identical before and after** — same `/proc/self/fd/3`, same options (`rw,nosuid,nodev,relatime,user_id=0,group_id=0,default_permissions,allow_other`).

> **This is also the only verbatim mount line recorded anywhere in this skill, and it carries a second finding captured for a different purpose.** The mount **source** is `/proc/self/fd/3` — a fuse descriptor, *not* a host path. So `/proc/mounts` offers **no host→VM translation**: there is nothing in it to prefix-match a host-side path against. The Cowork architecture state page previously said "the host-path strings visible in `/proc/mounts` are not usable VM paths", which reads as *present but useless* and was taken by a skill author as licence to build a mount-table lookup. Corrected there 2026-08-29. Caveat on this correction: one line, captured while proving that delete-approval involves no remount, is thin evidence for a claim about the whole table — a real dump from a live host-loop session would settle it.

On-disk correlate: `fileDeleteApprovedMounts: ["outputs"]` — one mount name, the connected folder absent.

## The host-loop / VM-loop split

```js
// mcp__cowork__allow_cowork_file_delete handler
if (e.isHostLoopMode) { e.setFileDeleteApprovedForMount(r.name); log("… (host-loop): "+r.name); return ok }
… await o.mountPath(a, r.subpath, r.name, `rwd`), e.setFileDeleteApprovedForMount(r.name), …
```

Under host-loop — **production's default** (`1143815894` force-ON) — the early return fires and `mountPath` never runs, yet enforcement changes. `mountFolderForSession` shows the same shape (logs *"Queued for next resume"*, returns `{ok:true, mode:"host-loop"}`), **but `request_cowork_directory` does NOT defer** — it mounted a folder immediately mid-session. Two mount routes, different host-loop behaviour.

**The other consumer** — the mount-mode resolver: `(name, approvedList, flag) => flag ? "rw" : approvedList?.includes(name) ? "rwd" : "rw"`. `flag` is named, and the "spawn-time" framing corrected, in the addendum below.

## Mechanism: established vs inference

**Established (observable contract):** delete policy is enforced per-mount by the FUSE layer, keyed by mount name; changeable live without touching the kernel mount table; visible immediately to already-open shells.

**INFERENCE, not established:** that the enforcing component reads `fileDeleteApprovedMounts` specifically. A direct test — editing the array on disk mid-session — was **void**: the Desktop rewrote the file from memory ~59 s later and the probe could not be ordered against that rewrite. What the attempt *did* establish is that **the on-disk session JSON is a projection of in-memory state, not a live input**; disk is read at spawn, not continuously.

**Untested by anyone: the VM-loop re-mount path.** `mountPath(…,"rwd")` only runs in VM-loop, which needs a `requireCoworkFullVmSandbox` org. A host-loop observation cannot falsify a VM-loop claim.

Native side: `swift_addon.node` exports `ClaudeSwift.MountConfig{path, mode: String, optional}`; no `rwd` literal (the mode is passed from JS), so `ro`/`rw`/`rwd` is a Swift-side API contract.

## Agent-facing behaviour

The tool's own description instructs the model: *"call this tool whenever a delete operation (such as `rm`) fails with 'Operation not permitted', rather than telling the user it is impossible."* Expect an agent to self-escalate on the first EPERM.

The approval dialog scopes the grant to a **named mount** (*"in your **outputs** folder"*) and warns *"Once allowed, this permission can't be revoked without starting a new task."* It fired under `permissionMode: auto` — a **behavioural confirmation of Ch24/L107's forced-ask matcher**, which lists `allow_cowork_file_delete` and `request_cowork_directory` among the always-ask tools.

## ADDENDUM — mount-mode CONSTRUCTION, and what `isBridgeSession` actually selects

Prompted by the `claude-cowork-headless-emulator` project, then re-derived first-party against the same baseline (`app.asar` **1.25927.0**, inside `.vite/build`, positive control on `fileDeleteApprovedMounts` run first).

The resolver quoted above is real, and its third argument is **`isBridgeSession`**:

```js
function M(e,t,n){return n?`rw`:t?.includes(e)?`rwd`:`rw`}   // index.chunk-BJmJz5fh.js
```

Both mount builders pass it:

- **VM-loop** (`Jo`) destructures `isBridgeSession:h` → `mode:H.l(name, T?.fileDeleteApprovedMounts, h)`
- **host-loop** (`ht`) is called `ht(re(),ie(),S,C,x,k(),A,N,be,P,xe)` — arg 6 `k()` = `getFileDeleteApprovedMounts()`, arg 7 `A` = `isBridgeSession` → `mode:S.l(name,o,s)`

**So in a bridge session `fileDeleteApprovedMounts` is ignored at mount time and every resolver-driven mount gets `rw`** — approval can never yield `rwd` there.

### ⚠️ `isBridgeSession` is NOT L138's `environment_kind:"bridge"`

```js
isBridgeSession(e){ return this.sessions.get(e)?.sessionType === E.mt }   // E.mt === "agent"
```

Two different namespaces that share a word. L138's 1598 `bridge` records are **server-side** records for locally-executing sessions — 471 of them `origin:"claude_code_cli"`, plain CLI runs that never reach this Desktop builder. Using that count to size the bridge-`rw` population is the same error class as counting `cse_` ids to size the cloud lane (L138).

First-party count over **every** persisted Cowork session record on the capturing machine (`local_*.json`, n=469): **375** no `sessionType` · **86** `scheduled` · **8** `dispatch_child` · **0** `agent`.

**Persistence control:** `agent` and `dispatch_child` are both "hidden" session types (`e==="agent"||e==="dispatch_child"`), and `dispatch_child` *does* persist — so the zero is a real absence, not a write-path artifact. **The bridge-`rw` branch has never fired on this machine.** Document it as a condition, not as a common one.

### Only two mounts are resolver-driven — and the two builders differ

| mount | host-loop (`ht`) | VM-loop (`Jo`) |
|---|---|---|
| `outputs`, each connected folder | **resolver** | **resolver** |
| `.claude` (whole dir) | — | **`rwd`** |
| `.claude/projects` | `ro` | — |
| `.claude/skills`, `uploads`, plugin mounts, `.projects/<uuid>` | `ro` | `ro` |
| auto-memory dir | **`ro`** | **`rwd`** |
| `<pluginMount>/.mcpb-cache` (only if it exists) | — | **`rw`** |
| `.artifacts/<id>`, `.scheduled/<id>` | — | `ro` |

Everything outside the first row is a hardcoded literal — no approval state reaches it.

The `.claude` split is structural, and it is why L140's `/proc/mounts` inventory (a host-loop session) shows two `.claude/*` mounts and no bare `.claude`. The **auto-memory dir is the only mount whose hardcoded mode differs by lane**; the likely reason (**inference**) is that under host-loop the agent loop runs host-side and writes memory through the host FS, so the VM only needs to read it — note the VM-loop builder separately grants `Edit(/<memdir>/**)`/`Write(/<memdir>/**)` via `allowedTools`.

### A THIRD construction site — `[VMCLIRunner]`, and it is NOT a session mount

There is a third place that builds a mount set, and it belongs to neither builder above. Relayed by the emulator project with its scope already attached, then verified first-party (`index.chunk-j7zghOJ6.js`):

```js
async function xe(e,n){
  let r=n.timeout??3e4,
      i=`cli-${(0,E.randomUUID)()}`,          // process id
      s=`cli-${i.slice(4,12)}`,               // session slug — cli- + 8 hex
      c=`/sessions/${s}/mnt/.claude`;         // → CLAUDE_CONFIG_DIR
  …
  let o={[a.a(`.claude`)]:{path:r,mode:`rw`},
         [a.a(`.claude/cowork_plugins`)]:{path:y,mode:`rwd`}},
      d={...n.env, CLAUDE_CONFIG_DIR:c,
         CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:`1`,
         CLAUDE_CODE_HOST_PLATFORM:process.platform};
  await l.spawn(i,s,`claude`,e,void 0,d,o,!1,n.allowedDomains,!0);
```

A short-lived `claude <args>` invocation in the VM for **plugin management**, 30 s default timeout, SIGTERM on expiry surfacing as `exitCode 143`. `cowork_plugins` is `rwd` because installs must write there. **These two mounts never appear in a Cowork session's mount set** — do not merge them into the table above. (The emulator project caught the scope itself by reading the enclosing function before writing it up; the mount-mode literal alone would have read as a session fact.)

Two things this pins beyond the mounts:

**A second session-slug namespace.** `cli-<8 hex>` — confirmed by the path-rewrite regex `/\/sessions\/cli-[0-9a-f]{8}\/mnt\/\.claude/g`. **Ch31/L117 and L140's `<adjective>-<adjective>-<noun>` format is the *interactive-session* namespace, not the only one.** A slug parser that assumes the Docker-style form will fail on these.

**Host↔VM path rewriting is a real, bidirectional pass.** `Z(files, hostPath, vmPath, dir)` runs `host-to-vm` before spawn and `vm-to-host` in a `finally`, rewriting `./mnt/.claude`, `mnt/.claude` and the `cli-` path regex through the config files. Config written by the in-VM `claude` comes back with host paths restored — relevant to Ch35/L122's "`/sessions/…` is never translated for file tools", which remains true for *tool* paths; this is a separate, file-content-level rewrite.

Adjacent, from the same function's neighbourhood: gate **`3758515526`** supplies the official plugin marketplace repo (`repo` / `repoCCD`, live value `{displayName:"Anthropic & Partners", repo:"anthropics/knowledge-work-plugins", repoCCD:"anthropics/claude-plugins-official"}`, `on:true` `source:defaultValue` at snapshot `9d75909785dc344e`) — note the code default for `repo` is `null`, so the served value is load-bearing.

### CORRECTION to this lesson's own wording

"Spawn-time restore" was wrong for host-loop. `ht` is wired as **`computeBashMounts`** and runs **per bash call** with a live `k()` — matching Ch35/L122's "recomputed per bash call".

This does **not** close the inference gap flagged above. The probe observed the flip inside an **already-open** shell, which a per-bash-call recompute cannot explain. These are two distinct mechanisms, and the live-flag inference still stands for the observed case.

### METHODOLOGY — an older asar is a Rosetta stone for a newer one

1.25927.0 is fully minified; builds **≤1.24012.1 retain real identifier names** (`guestCompatibleRootPath`, `toGuestCompatibleMountName`, `AUTO_MEMORY_MOUNT*`) and quote strings with `"` rather than backticks. Read the older build to name what the current one hides.

The quote change is a trap in its own right, but **only for plain string literals**. A backtick-anchored pattern silently misses older builds when the literal has no interpolation — `mode:` was the live case here: `` mode:`ro` `` matches 1.25927.0 and returns **zero** on 1.24012.1, where it is `mode:"ro"`.

**Interpolation forces backticks in every build**, minifier preference notwithstanding, so a template literal is quote-stable across the whole version range: `` `.projects/${x.uuid}` `` matched 1.22209.0, 1.24012.1 and 1.25927.0 unchanged. The same grep session demonstrated both halves — one pattern version-fragile, the other not — which is the practical rule: **anchor on an interpolated fragment when you have one, and treat a plain-literal anchor as version-scoped.** (Correction credit: the emulator project, whose `checkMountModeFacts` is anchored on the interpolated form and is therefore unaffected.)

Both facts in this addendum verify identically in 1.22209.0 and 1.24012.1, so **neither is new**.

---

# LESSON 140 — VM MULTIPLEXING AND THE REAL MOUNT INVENTORY

**Multiple Cowork sessions share one VM guest and one mount namespace — Ch31/L117 flagged this as inference; it is now directly observed. Isolation holds: mounts are visible, contents are not.**

## Confirmed

A live session (`peaceful-hopeful-feynman`, uid 1531) sees **28 fuse mounts belonging to a different slug** (`magical-zen-babbage`) in its own `/proc/mounts`. Both are real concurrent sessions of the same account, last activity ~100 s apart, both `hostLoopMode: true`.

## Isolation holds — the per-session uid carries it

Every cross-session read returned `Permission denied`:

```
ls   /sessions/magical-zen-babbage/              → Permission denied
ls   /sessions/magical-zen-babbage/mnt/outputs/  → Permission denied
stat /sessions/magical-zen-babbage/mnt/outputs   → Permission denied
cat  /sessions/magical-zen-babbage/mnt/outputs/* → Permission denied
```

Session dirs are `drwxr-x---` owned by `nobody:nogroup`; each session runs as its own uid/gid with no group overlap. **Ch31/L117's `coworkd` per-session Unix user is what enforces the boundary** — previously known only from leftover journald logs, now confirmed live (`uid=1529(awesome-intelligent-franklin)`, `uid=1531(peaceful-hopeful-feynman)`).

### What 522 means for a skill that searches the session tree

Recorded here because the number is a property of the *tree*, not of anyone's code, and no author would guess it. `/sessions` holds **hundreds of directories and grows** — historical sessions persist, only active ones carry mounts — and from inside any one session **almost all of them are unreadable**. A skill that resolves its own files by walking the session roots is therefore walking a large, mostly-forbidden, monotonically growing tree.

It is nonetheless **cheap**, and the reason matters: session directories are `drwxr-x---` owned by `nobody:nogroup` with no group overlap, so a walker is refused at the *directory* level and never descends. The cost is one refused `stat` per sibling, not a per-file traversal. An author who knows only "search the session roots" will misjudge this in both directions — fearing a cost that is not there, and missing that the tree grows without bound.

The same property is what scopes such a search to your own session **without a filter you have to write**: the kernel refuses the others. A lookup built on the mount table would see every slug's mounts (below) and need a hand-written slug filter to get back to where a plain search already is.

*(Raised by the `creative-problem-solving` project, whose resolver walks this tree and had assumed a handful of directories.)*

**Residual disclosure (minor, not an incident):** `ls -1 /sessions/ | wc -l` → **522**. Every session directory on the guest is enumerable from inside any session. Slugs are not secrets, but session count and naming are visible to any Cowork agent. 522 directories against ~28 mounts for the neighbouring slug also shows `/sessions/` is a **persistent shared volume** — almost certainly `sessiondata.img` (10 GB, alongside `rootfs.img` in `vm_bundles/`): directories persist for all historical sessions, only active ones carry mounts.

## The full per-session mount inventory (29)

| group | count | shape |
|---|---|---|
| `outputs` | 1 | `rw` |
| `uploads` | 1 | **`ro`** |
| connected folder | 1 | `/mnt/<name>` (spaces octal-escaped, `untitled\040folder\0405`) |
| `.claude` | 2 | `.claude/projects`, `.claude/skills` — **separate mounts** |
| `.projects` | 1 | `.projects/<uuid>` |
| `.local-plugins` | 3 | `.local-plugins/<install path relative to the account root>` — in **this** capture `cache/<marketplace>/<plugin>/<version>`; see the correction below, the depth is not fixed |
| `.remote-plugins` | 20 | `.remote-plugins/plugin_<id>` |

**`.projects/<uuid>` vs a connected folder — two different things.** Connecting a *project* creates a `.projects/<uuid>` mount and populates `userSelectedProjectUuids`; connecting a *folder* creates `/mnt/<name>` and populates `userSelectedFolders` + `resolvedFolderKinds: [{display, kind:"local"}]`. A session with a project attached therefore shows an **empty `userSelectedFolders` and no folder mount** — a real source of confusion when reading session state.

The plugin mount shapes confirm Ch17/L89 + v2.12.1 live. `pluginInstallPaths` on the host reads `/var/folders/…/T/claude-hostloop-plugins/<16-hex>` — the L89 staging path with the documented `sha256(installPath).slice(0,16)` hash.

### CORRECTION (2026-08-29): `.local-plugins` has no fixed depth

The table row above once read `.local-plugins/cache/<marketplace>/<plugin>/<version>` — **version-pinned**, stated as *the* shape. It is one instance of a shape, and the generalisation was wrong.

The Desktop builds that path as `` `/sessions/${id}/mnt/${.local-plugins}/${guestCompatibleRelative(accountOrgRoot, installPath)}` `` — the tail is the **install path relative to an account/org root**, so it mirrors whatever the host layout happens to be. `cache/<marketplace>/<plugin>/<version>` is what a marketplace install looks like on disk, not a template. A live counterexample, relayed from a `cowork-harness` `container`-fidelity run:

```
/sessions/<id>/mnt/.local-plugins/marketplaces/local-desktop-app-uploads/creative-problem-solving
```

Three segments, `marketplaces` rather than `cache`, **no version and no plugin id**. Anything keying off the id — including the two-namespace join below — cannot fire on this shape.

The sibling row is different in kind and is safe to rely on: `.remote-plugins/plugin_<id>` is built as `<mnt>/.remote-plugins/<plugin.id>`, so the id **is** the leaf, by construction one directory per id per session.

### Live confirmation from inside a running session (2026-08-29)

Everything above was read from the Desktop application or the guest disk image. This is the first confirmation from **inside a running host-loop session**, relayed by the `creative-problem-solving` project:

```
file tools:  …/local-agent-mode-sessions/<a>/<b>/rpm/plugin_01Xzg…/skills/<skill>/references/pipeline.md
shell:       HOME=/sessions/zealous-gallant-wozniak   PWD=/sessions/zealous-gallant-wozniak
             ls -d "$HOME/.claude/plugins"  ->  absent
             find /sessions -name verify_pipeline.py -path '*/scripts/*'
               /sessions/zealous-gallant-wozniak/mnt/.remote-plugins/plugin_01Xzg…/scripts/verify_pipeline.py
```

Four recorded facts confirmed at once, none previously observed from a live shell: the `.remote-plugins/plugin_<id>` shape; `$HOME` = the session root (Ch37/L146, established there by probe); the adjective-adjective-noun slug format (Ch31/L117); and the namespace split itself — **the plugin id is byte-identical in both paths**, which is what makes a basename join work where a path never can. Note also `~/.claude/plugins` does not exist in the VM, so a search rooted there is inert.

**Method note on the same transcript.** It also reported that an upward directory walk "is what found" the scripts. It is not: the agent had set its start directory to a `/sessions/…` path learned from an earlier `find`, not to the file-tool directory the instruction named. Fed the documented value the walk searches a tree the shell cannot see. A trace showing the right answer does not establish the mechanism that produced it — and this one would have entered a lesson as a working fallback.

## ⚠️ METHODOLOGY — agent-reported paths are not evidence

Two consecutive probes reported `outputs` as mounted at the **host** path (`/Users/yaniv/Library/…/outputs`), which would have contradicted Ch31/L117's `/sessions/<slug>/mnt/outputs` model. **Both reports were wrong.** `/Users` does not exist inside the VM at all, and a `grep -F` for the host-path fragment over `/proc/mounts` returns **zero** fuse lines. All 29 mounts use `/sessions/<slug>/mnt/…`.

The artifact survived one retraction and reappeared in weaker form ("the two mount kinds use different conventions") before being killed.

**The rule: corroborate any agent-reported path with a command whose COUNT cannot be confabulated** — a zero-line `grep -F` on the disputed fragment. Prose describing a path is not evidence that the path exists.

## ADDENDUM — this inventory is the RUNTIME view; the modes come from the builder

The table above is what a live host-loop session shows in `/proc/mounts`. The **construction** side (per-builder mode table) lives in L139's addendum. Three things it adds to this inventory:

**`.projects/<uuid>` is constructed `ro`**, in both builders, hardcoded:

```js
...y.reduce((e,t)=>(t.hostPath&&(e[d.a(`.projects/${t.uuid}`)]={path:d.i(t.hostPath),mode:`ro`}),e),{})
```

So a **project attachment is not writable at all** — it is not "writable but delete-denied", and it sits outside the delete-denied class entirely, since delete-denial is only meaningful on a writable mount.

**Two mount classes are missing from the 29 because only the VM-loop builder emits them:** `.artifacts/<id>` and `.scheduled/<id>`, both `ro`. A host-loop `/proc/mounts` capture can never show them.

**One `rw` sub-mount exists inside a `ro` parent:** `<pluginMount>/.mcpb-cache`, created only when that directory is present on the host — so "plugin mounts are read-only" is true only of the plugin root.

---

# LESSON 141 — SNAPSHOT DISCIPLINE

**The GrowthBook `fcache` is a moving target with TWO independent absence axes. "Absent ⇒ off" is false on both. A gate observation is meaningless without a content hash identifying the snapshot it was made against.**

## Axis 1 — gate-level: membership churns, count-neutrally

Two decodes on one machine, ~9 h apart:

| | earlier | later |
|---|---|---|
| feature count | 241 | 241 |
| `4074604942` | absent | present, `on:false`, `source:force` |
| `2403605075` | present, `on:true` | **absent** |

One in, one out. **Equal feature counts do not imply the same payload** — a trap that caught both this project and the emulator project independently.

**Refetch is irregular, not periodic.** 60 samples over 29.7 min caught five fetches at **20.8 / 3.7 / 9.0 / 4.0 min** — a 5.6× spread, so it is activity-driven. *Do not state a period;* state that membership can change between any two reads.

## Snapshot identity must be a CONTENT hash

Whole-file sha256 tracks the **fetch** (gzip framing + the embedded `timestamp` field) and changes on every refetch even when nothing did — across those five fetches, five file hashes and **one** content hash.

```python
canon     = json.dumps(features, sort_keys=True, separators=(',',':'))
content16 = hashlib.sha256(canon.encode()).hexdigest()[:16]
```

Cross-validated bit-for-bit against the emulator project's independent implementation. The embedded timestamp is **fetch metadata, never identity**.

## Axis 2 — key-level: a served gate can omit keys that default TRUE

The Desktop gate client has **six** accessors, not one:

| accessor | reads | distinct ids | shape |
|---|---|---|---|
| `.ka(id)` | 183 | 112 | boolean |
| **`.Ea(id, key, default, …)`** | **44** | **8** | **one key, per-call default** |
| `.Ta(id, default)` | 18 | 18 | whole config object |
| `.Ma(id, cb)` | 15 | 13 | subscribe (abort callback) |
| `.ja(id, cb)` | 4 | 4 | subscribe |
| `.Fa()` | — | — | settle/ready; **takes no gate id** |

`.Ea` creates the second axis. Measured on `1978029737` (`present`, `source: experiment`, `on: true`): the code requests **21** keys, the served object carries **8**, so **14 resolve to code defaults — and two of those default `!0` (true)**:

- `bashHostOnlyIntercept`
- **`scheduledTaskStaleReapEnabled`** — which **Ch26/L109 documents as a gate**, and which is therefore running *enabled* while invisible in the served config.

**So "key absent ⇒ off" is false, and any inventory built by reading served config keys under-reports enabled behaviour.** `.ja`/`.Ma` additionally mean a gate can flip mid-session and code reacts (`1978029737` is `.Ma`-subscribed) — gate state is not boot-fixed.

## The four-state vocabulary

| state | meaning |
|---|---|
| **gate absent** | not in the payload — unevaluated *in that snapshot* |
| **gate present + `defaultValue`** | evaluated; no server rule matched; coded default applies |
| **gate present + `force`/`experiment`** | a server rule actively matched |
| **key absent within a served value** | the *code's* per-call default applies — **which may be `true`** |

## Extraction: gate ids are always STRING literals

Desktop 1.25927.0 changed minifiers — `At("1143815894")` became `n.ka(\`1143815894\`)`. A double-quote-anchored pattern returns **4** gates where the correct anchor returns 130.

| anchor | ∩ fcache | absent | verdict |
|---|---|---|---|
| quote-agnostic numeric literal | 130 | unusable (1433 candidates) | full recall, no precision |
| **quoted/backticked literal `["'`][0-9]{8,10}["'`]`** | **130** | **50** | **use this — full recall AND precision** |
| accessor + `let X=` binding | 121 | 42 | misses 9 present gates |
| call-site only | 96 | 19 | wrong |

Call-shape anchors fail on comma-continued declarator lists (`var c=\`id\`,l=\`id\``), bare calls (`v(\`id\`)`), and the `.Ma` accessor. Anchoring on the *literal* sidesteps all three by not depending on call shape at all. **Any published count must carry its extraction pattern or it is not reproducible.**

## What this changed in the state layer

`registry.json`'s `as_of.fcache_capture` is now `{content16, embedded_timestamp, feature_count, observed_at}`; gate entries carry `namespace` (`desktop_fcache` | `cli_growthbook` — the two are *not* interchangeable, and a CLI flag is not an fcache key) and structured `observed: {present, source, on, at}`, with `served_keys` on value gates. `validate-state.js` rejects fcache-absence claims written in prose and refuses an `observed.at` that does not match the pinned snapshot.

**Three of our own claims had rotted** under exactly this mechanism (L130's `1311049725`, L131's `1549258603`/`3705360580` — all three now `present`/`defaultValue`/off). See the amended gate-state section in Ch37.

---

# LESSON 142 — `coworkSyspromptMap`

**Cowork carries a server-driven, key-addressed system-prompt patch channel with a `replace` mode that discards the computed prompt entirely. Any model of the Cowork prompt as "preset plus appends" is structurally wrong while a `replace` variant is active.**

Not new — 18 occurrences in 1.24012.1, 1.24012.11 and 1.25927.0 alike. It is carried on the session record (`coworkSyspromptMap`), validated by a type-guard alongside `spSectionPrompts`, `memoryGuidelinesTemplate` and `chromeAllowedDomains`, and forwarded on the `channel:"sessions_api"` path. A live example from disk:

```json
"coworkSyspromptMap": {"keys": {"07_16_2026.replace": {"mode":"replace","text":"Note: The set of available tools may change…"}}}
```

## Two modes, a key grammar, and a startup invariant

```js
function fn(e){ return e===`replace` || e===`append` }                    // the mode validator — a closed set
/^[A-Za-z0-9_-]{1,128}(\.(replace|append))?$/                             // the key-name grammar
```

The mode is encoded in the **key suffix**, which is why the live key reads `07_16_2026.replace`. There is no `prepend` mode (a `prepend` literal exists elsewhere in the bundle and is unrelated — do not model a third mode).

Built-in variants are checked at load and **throw**:

```js
for (let [e,t] of Object.entries(dn))
  if (t.mode===`replace` && !t.text.includes(`{{promptCacheBoundary}}`))
    throw Error(`SP_VARIANTS.${e}: replace-mode text must contain {{promptCacheBoundary}}`)
```

## Server-supplied entries are validated at RESOLUTION, not load

A per-key status machine returns `{status: "hit" | "invalid_entry" | "missing_boundary", key, variant:{mode,text}, source}`. So a malformed server variant — including a `replace` missing the boundary token — **degrades silently rather than crashing**. A second vocabulary (`override | model_default | base | dropped`) carries the resolution source, and variants can be **per-model** (`t.models`). Telemetry: `sp_variant_replace`, `sp_variant_append`, `sp_variant_resolved`.

## Why `replace` matters more than `append`

`replace` does not swap a slot — it **discards the computed default** and emits `[variant.text, ...appends].join("\n\n")`. The `{{promptCacheBoundary}}` requirement exists because the replacement text must still carry the cache boundary the runtime depends on.

**Practical consequence:** anything that reconstructs or asserts on the Cowork system prompt (a harness, a fidelity test, a skill that reasons about its own instructions) can be silently invalidated by a server-side variant flip, with no version bump and no local artifact change. Detect it from the session record, not from the binary.
