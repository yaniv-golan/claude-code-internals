---
domain: cowork-architecture
title: Cowork runtime architecture (current)
as_of_cli: 2.1.231
as_of_desktop: 1.30096.1
sources: [89, 90, 107, 108, 109, 114, 116, 117, 119, 121, 122, 124, 125, 126, 132, 134, 138, 139, 140, 149, 151, 175, 176, 177, 178]
updated: 2026-08-30
---

# Cowork runtime architecture (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter).

## Host-loop vs VM-loop

Whether a Cowork session's agent loop runs on the host or inside the VM is
a single server-side decision, not a per-feature toggle. Re-verified at
Desktop 1.20186.1 / host + in-VM agent 2.1.205 (lesson 124); the decision
function is now `Pm()` (successor of the L107-era `f_()`):

```js
const UKe="forceDisableHostLoop";function FM(){return ot.get(UKe,!1)}
function jKe(){return $t("1143815894")}
function vI(){return Oe().workspace.requireFullVmSandbox}
function Pm(){return vI()||FM()?!1:globalThis.isDeveloperApprovedDevUrlOverrideEnabled
  && process.env.CLAUDE_FORCE_HOST_LOOP==="1"?!0:jKe()}
```

- `vI()` = org policy `requireCoworkFullVmSandbox === true` → forces
  **VM-loop**.
- `FM()` = `settings.forceDisableHostLoop` → forces **VM-loop**.
- Dev override `CLAUDE_FORCE_HOST_LOOP=1` → forces **host-loop** — but is
  now **additionally gated** on
  `globalThis.isDeveloperApprovedDevUrlOverrideEnabled` (a change vs the
  L107/L108-era description), making the escape **dead on stock
  installs**.
- Otherwise, GrowthBook gate `1143815894` (`jKe()`) decides.

**Production decodes to host-loop.** The live `fcache` (2026-07-11
recapture) shows gate `1143815894` = `{value:true, on:true, source:"force",
ruleId:"fr_mnqhxsok"}` — default consumer/Pro Cowork is host-loop; only
locked-down orgs with `requireCoworkFullVmSandbox` get VM-loop.

**Resume-sticky, with a policy tripwire.** The gate is consulted only at
fresh session start (`m=a?o.isHostLoopModeEnabled():...`); a *resumed*
session keeps its persisted `hostLoopMode` rather than re-evaluating. If
org policy flips to `requireFullVmSandbox` between a session's creation
and a resume attempt, the resume throws verbatim: *"This session was
created before your organization required the VM sandbox. It cannot be
resumed under the current policy. Please start a new session."* — a hard
stop, not a silent loop switch. `setForceDisableHostLoop` (IPC-settable)
and `isHostLoopDevOverrideActive` are the companion local controls.

**Custom-3p deployments bypass GrowthBook for this gate.** A hardcoded
table (`uOt`/`hardcodedMainGrowthBookFeatures`) force-ONs `1143815894`
(host-loop) unconditionally in custom-3p builds, alongside several other
gates including `2307090146` (cli_plugin) — see "Plugin roots" below and
`credential-channels.md`.

- **Host-loop (the default).** The agent loop runs **on the host** — the
  same `/usr/local/bin/claude` binary process. `Read`/`Edit`/`Write` hit
  the **host** filesystem directly. Only the shell and web tools run in
  the VM: `Bash` is replaced by `mcp__workspace__bash` and `WebFetch` by
  `mcp__workspace__web_fetch`, both executing in the workspace microVM
  where folders mount under `/sessions/<id>/mnt/`.
- **VM-loop (locked-down orgs).** The *whole* agent runs inside the VM via
  a staged Linux/arm64 ELF (`claude-code-vm/<ver>/claude`): `cwd:
  "/sessions/<id>"`, `CLAUDE_CONFIG_DIR=/sessions/<id>/mnt/.claude`. Those
  `/sessions/<id>/…` strings live in the **in-VM** ELF, not the host CLI —
  a host-binary string search for them will always come up empty; that is
  not evidence they're absent, just evidence they're VM-loop-only.

A logged host-loop process is therefore "the host agent," not "the in-VM
CLI" — read "the spawned agent" as host-side unless the org is confirmed
on VM-loop. See `cowork-control-protocol.md` for the spawn contract the
Desktop drives this agent with.

## Filesystem & mounts

**Two tool families, two path forms — the shared-scratch claim is WITHDRAWN
(Ch44/L163).** The host-loop **agent process** has its cwd set to the session
outputs dir, so a **bare filename** from `Read`/`Write`/`Edit` lands there and
is immediately user-visible. `mcp__workspace__bash` is a different case: it
starts at the **session root `/sessions/<id>`**, and that directory (plus
`/tmp`) exists only inside the Linux environment — invisible to the user *and*
to the file tools. So a bare filename in bash does **not** reach the same place
a bare filename in `Write` does. Bash needs the absolute
`/sessions/<id>/mnt/outputs/...` form; the file tools **reject** that form
outright (path-gate, `cowork-permissions.md` layer 4). There is no path form
correct for both.

This skill previously published the opposite, copied from a Desktop prompt
string that was itself wrong; the prompt was corrected at Desktop 1.32885.1,
while our own Ch40 probes had already measured the session root at 1.25927.0.
Verified against `app.asar` 1.37937.1 — **past this page's `as_of_desktop`
baseline**, and deliberately so (targeted correction, not a baseline refresh).

**VM-side mounts are stood up by the VM image, not the client binaries.**
Inside the guest, mounts under `/sessions/<id>/mnt/` are created by the VM
image's own systemd `.mount` units, which live in
`~/Library/Application Support/Claude/vm_bundles/claudevm.bundle/
rootfs.img` (a ~10 GB raw ext4 image) — not in the Desktop `app.asar` or
the agent ELF. The rule for "where does Cowork mount/stage X": grep
`rootfs.img` for the path and for `*.mount` unit names — the agent ELF
only shows how skills are *read*, not how the VM *lays them out*. "Absent
from the client binaries" is not proof of "absent on disk."

**Full mount inventory (L117).** Extending the single `.claude/skills`
example above, a `.mount`-unit grep of `rootfs.img` (plus leftover
`systemd-journald` entries from real historical sessions, still present in
the golden image) surfaces the complete set of host-shared mount points,
each instantiated per session as `sessions-<slug>-mnt-<name>.mount`:
`outputs`, `uploads`, `.claude`, `.claude/skills`, `.claude/projects`, and
one unit per user-connected folder (arbitrary names, e.g. `Downloads`,
`work`, or a custom folder name). **There is no `.mount` unit for the
guest's home directory or for `/tmp`.** That is the structural reason
those two behave differently from `outputs/`: they were never bind-mounted
at all — they're just ordinary paths inside the guest's own private,
non-shared root filesystem, whereas `outputs/`/`uploads/`/`.claude/…`/
connected-folders are independently mounted and unmounted, per session,
as first-class systemd units. "Shared vs. VM-local" is not a permissions
distinction on one filesystem; it's two different kinds of storage,
decided per-path at image-build/session-provisioning time. This also
explains *why* `fileDeleteApprovedMounts` (above) only ever needs to
govern mounted paths — a file in guest-private home has no host-visible
mount to gate in the first place.

**`.host-home` is a reserved mount name that is not a mount at all.** It
never appears in the inventory above, and shouldn't: it's gated by dark
GrowthBook gate `2614807392` (off by default) and, when on, is a synthetic
path-translation index, not a bind mount — the system prompt tells the
model that a path under `/sessions/<id>/mnt/.host-home/<sub>` corresponds
to a real absolute host path, and a resolver pair (`ece()` encode /
`uCe()` decode) converts between the two. This lets the agent *reference*
host paths in tool calls without the guest's home directory ever being
shared, and is a third category alongside "bind-mounted" and
"guest-private": a virtual namespace with no filesystem bridge at all.

Session slugs (`/sessions/<slug>/`) are confirmed, with real historical
examples surviving in the same journald leftovers, to follow a
Docker-style `<adjective>-<adjective>-<noun>` triple format (e.g.
`zealous-vigilant-einstein`, `lucid-awesome-bell`) — not a UUID.

The same leftovers name an in-guest daemon, **`coworkd`**, that manages
session lifecycle: it provisions a dedicated Unix user (uid/gid) per
session slug (idempotently — "user already exists" is logged, not
treated as an error) and spawns work as that user via named
`oneshot-<uuid>` jobs, e.g. a `deck-review` skill script invocation
resolving `SCRIPTS=.../claude-hostloop-plugins/<hash>/skills/deck-review/
scripts` — real corroboration of the host-loop plugin-staging mechanism
below. The idempotent user-exists check, together with an observed empty
`vm_bundles/warm/<hash>/` directory alongside the golden image, is
*suggestive* of session-to-VM multiplexing (a warm pool of booted guests,
each capable of hosting more than one session's worth of per-user
provisioning) — but this is an inference from indirect evidence, not a
directly confirmed fact; no artifact yet states "one guest serves N
sessions" outright. See lesson 117 for the full forensic trace and the
tool-speed methodology note (`rg` over raw multi-GB images vs. `grep -a`
vs. naive scripting-language regex).

## Sub-agent execution (host-loop)

Task/Agent-tool sub-agents are **in-process async-generator loops**, not
separate OS processes and not separately sandboxed (lessons 121–122,
re-verified at Desktop 1.20186.1 / agent 2.1.205):

- **Same process, same containment as the main thread.** A dispatch runs
  the shared `nj({agentDefinition,...})` generator inline (or via the
  in-process task registry for tracked/background ones), scoped through
  AsyncLocalStorage. There is no per-sub-agent env assembly — identity is
  a plain context object (`agentId`, `parentAgentId`, `depth`,
  `parentSessionId`, `agentType:"subagent"`, `subagentName`, …), not
  environment variables.
- **cwd = the session outputs directory, always — for the AGENT PROCESS.**
  (`mcp__workspace__bash` starts at the session root instead; Ch44/L163.)
  The host agent's `cwd` is set once at spawn to
  `local-agent-mode-sessions/<accountId>/<orgId>/local_<sessionId>/outputs`
  (see "Session storage" below). A sub-agent's cwd is the **parent's
  cwd** — cwd is AsyncLocalStorage-scoped with a process-level fallback,
  and the Task tool's model-facing input schema **strips `cwd`** entirely
  (`.omit({cwd:!0})`); a model cannot set it, only worktree isolation
  changes it. So the canonical "reachable outputs root" for any sub-agent
  IS its cwd, addressed via bare/cwd-relative paths — not a `/sessions/…`
  form.
- **The path-gate hook and the `canUseTool` chain both apply to
  sub-agents identically to the main thread.** SDK-passed PreToolUse hooks
  are registered process-globally with no subagent exclusion, and the
  shared hook-input schema documents `agent_id` explicitly as *"Subagent
  identifier. Present only when the hook fires from within a subagent
  (e.g., a tool called by an AgentTool worker). Absent for the main
  thread."* Hooks are skipped only for `bareFork` dispatches and the
  `EndConversation` tool. See `cowork-permissions.md` layer 4.
- **`/sessions/<id>` paths are DENIED, never translated, for file tools of
  any origin** (main or sub-agent). The VM↔host path-translation index
  (`mapVMPathToHostPath`/`deepTranslateVMPaths`) runs only on **outbound**
  agent messages, `file://`/`computer://` URIs, and the scheduled-task
  file reader — never on file-tool inputs. A sub-agent Write targeting
  `/sessions/<id>/mnt/outputs/...` fails every time; a cwd-relative or
  host-absolute-outputs Write succeeds every time. Apparent
  non-determinism in practice is the *model* choosing which path form to
  construct (e.g. echoing a VM-absolute path captured from bash output),
  not a product-side namespace flip.
- **Depth cap 5, no fan-out cap.** Dispatch throws at nesting depth ≥ 5
  ("Subagent nesting limit reached (depth ${g} of 5)"), and the base
  subagent tool filter hides the `Agent`/`Task` tool itself once
  `agentDepth>=5` — enforced independently in both the host bundle
  (`NMr=5`) and the in-VM ELF (`BLr=5`). No `Task`-specific concurrency or
  fan-out limiter exists anywhere in either binary; the only bound on how
  many sub-agents can be *running* at once is the generic per-turn tool
  scheduler window, `env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default
  10, queues rather than refuses). The 25-agent/1.5M-token "workflow size"
  figure is prompt guidance only, telemetry, not enforcement.
  **CORRECTED as of CLI 2.1.217 (L134):** the "no fan-out cap" clause no
  longer holds — the standalone agent binary now enforces real Task
  fan-out caps via `taskRegistry`: concurrent sub-agents default **20**
  (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, throws `subagent_concurrency_cap`,
  bypass gate `tengu_amber_kestrel`), total spawns/session default **200**
  (`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`, `subagent_count_cap`), WebSearch
  200/session, and **nesting off by default** (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`
  default 1; the depth-5 above is now the *ceiling*, not the default). These
  run in the shared agent binary host-loop Cowork executes, so they apply
  here; the Desktop-hook/VM-loop interaction was not separately traced.
- **Tool composition is a per-dispatch recomputed universe, not
  inheritance-plus-injection.** A sub-agent's frontmatter `tools:` list is
  authoritative, but only over what the *session* itself could ever offer
  — nothing is injected beyond that except via an agent's own
  `mcpServers:` frontmatter (the one sanctioned way a sub-agent gains
  tools its parent session doesn't have) — which is **unavailable to
  plugin-shipped agents**: a plugin agent's `permissionMode`/`hooks`/
  `mcpServers` frontmatter fields are discarded with a warning at load
  time (see `plugins-skills-hooks.md`). A dispatch that omits
  `subagent_type` falls back to the built-in `general-purpose` type with
  `tools:["*"]` — i.e. the FULL wildcard surface, including
  `mcp__workspace__bash` in host-loop. "Shell-free sub-agent" is a real,
  assertable property only when `subagent_type` is pinned to an
  explicit-`tools:` agent; production audit-log evidence on this machine
  shows the type-less fallback firing routinely (113 of 509 real
  dispatches across 39 sessions carried no `subagent_type` at all).
- **Sub-agent system-prompt append.** Host-loop sub-agents get a short
  `## Cowork environment` section appended to their system prompt
  (`subagent_env_hl`, sibling `subagent_env_vm` under VM-loop),
  unconditionally generated and gated for consumption by
  `env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT` — applies to Task
  sub-agents only (not fork/`useExactTools` dispatches) and propagates to
  nested sub-agents. See `cowork-control-protocol.md` for the full
  handshake mechanism and `${CLAUDE_PLUGIN_ROOT}` pre-resolution details.

## Session storage

Host-loop session data (macOS) lives under
`~/Library/Application Support/Claude/`, not `~/.claude/`. Each session is
a self-contained sandbox directory with its own `.claude` config dir,
which under host-loop **is** the host CLI's `CLAUDE_CONFIG_DIR` (the
`/sessions/<id>/mnt/.claude` path from Part A above is the VM-loop path
only). The session config record carries `"hostLoopMode": true`.

```
~/Library/Application Support/Claude/local-agent-mode-sessions/
  <accountId>/<orgId>/
    local_<sessionId>.json            # session CONFIG record: model, title,
                                       #   systemPrompt, hostLoopMode,
                                       #   cliSessionId, cwd, enabledMcpTools,
                                       #   egressAllowedDomains, etc.
    local_<sessionId>/                # the session SANDBOX directory
      outputs/                        #   agent process's cwd (NOT bash's — L163)
      uploads/                        #   user-attached files
      audit.jsonl  +  .audit-key      #   signed per-session audit log
      .claude/                        #   per-session CLAUDE_CONFIG_DIR
        projects/<cwd-slug>/<cliSessionId>.jsonl   # THE CHAT TRANSCRIPT
        sessions/
        tasks/<cliSessionId>/1.json,2.json,…       # Tasks-tool state
        session-env/<cliSessionId>
        plugins/  backups/  policy-limits.json  mcp-needs-auth-cache.json
```

The chat log is a standard Claude Code JSONL transcript, keyed by the host
CLI's `cliSessionId` (distinct from the Cowork `<sessionId>`; linked via
the config record's `cliSessionId` field). Runtime/debug logs live
separately in `~/Library/Logs/Claude/` (`cowork_host_loop_debug.log` is
the primary host-loop agent log) and are operational telemetry only — not
conversation content.

A top-level Cowork chat can be silently missing from disk: spawned with
`persistSession:false`/`--no-session-persistence`, a non-force-persisted
background/sub-agent child (ephemeral by default unless
`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE`), or a per-session `.claude` dir
that failed to write (best-effort, fails silently to the debug log).

## Plugin roots

Plugin hooks **do** fire in Cowork; the earlier belief that
`--setting-sources=user` silently excludes plugin-scoped hooks is wrong
(see `cowork-permissions.md`). The real mechanism and gotcha is a
**three-root namespace split**:

1. Regular `~/.claude/plugins/` — normal CLI installs.
2. The standalone-CLI Cowork root `~/.claude/cowork_plugins/` — what
   `claude plugin install --cowork` writes.
3. The **Desktop's** account/org root
   `local-agent-mode-sessions/<acc>/<org>/cowork_plugins/cache` (+`rpm/`)
   — the **only** one a real Desktop Cowork session reads.

A plugin not installed into root #3 is simply never loaded into a Cowork
session — no hooks fire, with no error. Fix: install via the Cowork app UI
(or org-remote/RPM); the standalone CLI `--cowork` path does not reach the
Desktop's namespace.

At session start, the host loop symlinks each enabled plugin into a temp
`claude-hostloop-plugins/<hash>` dir and runs hooks host-side;
`${CLAUDE_PLUGIN_ROOT}` resolves to that staging path (same host-side
value in both skill content and hooks — **one token, two namespaces**):
- **accepted** when handed to host-side `Read`/`Edit`/`Glob`/`Grep` (file
  tools want host paths — keep the token literal there), but
- **useless to in-VM bash** (`mcp__workspace__bash`), which cannot see the
  host path — bash-executed plugin scripts must instead use the
  VM-mounted plugin path, `/sessions/<id>/mnt/.local-plugins/cache/<mp>/
  <plugin>/<version>` (marketplace) or
  `/sessions/<id>/mnt/.remote-plugins/plugin_<id>/…` (org-remote),
  discovered at runtime rather than via the token.

A blanket "always resolve `${CLAUDE_PLUGIN_ROOT}` to the VM path" rule is
therefore wrong for host-side reference `Read`s and right only for
in-VM-bash-executed scripts — the skill has to pick per consumer.

This host-side resolution holds **only under host-loop (production)**. The
Desktop picks the plugin dir in one branch,
`Ei = isHostLoopModeEnabled ? qX(installPath) : sdkPath`, so under
**VM-loop** (`requireCoworkFullVmSandbox` orgs, whole agent in-VM) the same
branch hands the agent `sdkPath` — the VM mount — and the token then
resolves to `/sessions/<id>/mnt/.local-plugins/…` (or `.remote-plugins/…`),
**usable directly from the VM shell**. The string `claude-hostloop-plugins`
is absent from both agent binaries (host CLI, in-VM ELF) and present only in
the Desktop driver, so an in-VM agent cannot resolve to a host path at all.
The invariant is: the token points at the agent's own `--plugin-dir`.

Two mechanics behind the host-loop staging path (`qX`): it is
**space-triggered** — `if (!installPath.includes(" ")) return installPath`,
so the `claude-hostloop-plugins/<hash>` symlink exists only to launder
install paths *containing spaces* past unquoted `${CLAUDE_PLUGIN_ROOT}` in
hook commands (a space-free path resolves to the real host install dir even
under host-loop; Desktop plugins under `~/Library/Application Support/…`
always hit the space case) — and the staged dir is a **deterministic**
`sha256(installPath).slice(0,16)` with no session id / timestamp /
randomness, so it is stable across invocations, sessions, and reboots.

The host-loop mechanics above are **live-confirmed** (2026-07-07): a probe plugin uploaded
via the Cowork app UI resolved `${CLAUDE_PLUGIN_ROOT}` to
`…/T/claude-hostloop-plugins/aa86f0206322553f`, whose `readlink` target's
`sha256(installPath)[:16]` reproduced that basename exactly, and two separate sessions produced
the same hash. VM-loop resolution stays static-derived from the mode branch.

## Runtime detection from a skill (lesson 116)

"In Cowork" names three execution contexts with three different visible envs:
the host-side agent process (`CLAUDE_CODE_IS_COWORK=1`,
`CLAUDE_CODE_ENTRYPOINT=local-agent`), host-side hooks (same env), and the
in-VM shell (`mcp__workspace__bash`, **sealed** — no `CLAUDE_CODE_*` markers
survive; v2.12.2 probe). A skill's shell commands run in the third, so a bare
`$CLAUDE_CODE_IS_COWORK` check false-negatives in production Cowork. Inline
`` !`cmd` `` skill-shell execution is force-disabled under Cowork
(`disableSkillShellExecution` short-circuit), and hook env-exports don't cross
the host/VM bridge — neither can serve as a probe.

Reliable recipe (ordered): `$CLAUDE_CODE_IS_COWORK` set → cowork (host-side or
VM-loop); cwd under `/sessions/<id>` → cowork VM shell (host-loop); `$CLAUDECODE
= 1` → Claude Code CLI (refine via `CLAUDE_CODE_ENTRYPOINT`); else → other
harness. Content-side, branch on the tool surface: plain `Bash` vs
`mcp__workspace__bash`. The old host→VM env allowlist (`MGn`, asar v1.6259.1)
is gone from the 1.18286.0 asar — the sealed-env fact rests on the empirical
probe, not that symbol.

**A new env var joins the identity trio, with a producer/consumer version gap
(L151).** Desktop 1.28929.0 writes `CLAUDE_CODE_COWORK_FRAME_ARTIFACTS` into
the local-agent spawn env whenever the frame-artifacts predicate above holds.
The consumer lands only in standalone CLI **2.1.228+** — it is absorbed into
the session-identity singleton at boot alongside `CLAUDE_CODE_ENTRYPOINT`/
`CLAUDE_CODE_CHILD_SESSION`/`CLAUDECODE` (the same trio this recipe is built
on), with its own case-insensitive strip helper. Every agent binary at or
before 2.1.227 (host Mach-O, in-VM ELF, standalone CLI) has zero occurrences
of the key — Desktop shipped the producer a full agent version before any
consumer existed, the reverse of the usual "the agent already understands
this env var" assumption; a neighboring key's presence (`CLAUDE_CODE_DISABLE_ARTIFACT`,
present since earlier) says nothing about whether *this* key is understood.
Gates a local predicate that **inverts** the `local-agent`/`claude-coworker*`
entrypoint class this page's detection recipe otherwise treats as one group —
the agent-side mirror of this page's Artifact-tool/legacy-mount inversion
above: frame-artifacts on favors the native tool path over the legacy
chat-relay artifact path. Side finding: **`claude-coworker*` is an entrypoint
*prefix* family** (`e?.startsWith("claude-coworker")`), not a value belonging
to any enumerable set — a caveat for anyone trying to express the full
entrypoint space as a fixed list of strings.

## Re-verification at Desktop 1.18286.0 (2026-07-04)

All of the above — the host-loop/VM-loop split, the shared-scratch-space
filesystem model, session storage layout, and the three-root plugin
namespace — is structurally unchanged in Desktop 1.18286.0 (lesson 114).
One piece of prior underspecification is now resolved: the env var
carrying a Space's per-space auto-memory directory (`CoworkSpaces.
getAutoMemoryDir`, documented above via lesson 109) into the agent's spawn
env is `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`, with `CLAUDE_CODE_
DISABLE_AUTO_MEMORY=1` as the fallback when no memory path resolves.

## Re-verification at Desktop 1.19367.0 (2026-07-08): cloud tasks are not new

A self-updated Desktop build (1.19367.0) prompted a check for a "cloud
tasks" feature. First-party IPC-surface diff against a 1.18286.2 baseline
(one point release ahead of this page's prior 1.18286.0 pin): **zero
interfaces added/removed, +14/-0 methods, none cloud-task related** — every
cloud-task primitive (`teleportToCloud`, the bridge-session worker family,
`LocalAgentModeSessions`, the `ccr-byoc-2025-07-29` beta) was already
present, byte-similarly, in the older baseline. This is a UI/rollout change,
not new client plumbing. Full mechanism (teleport-to-cloud flow, the
bridge-session worker's poll/ack/stop client, and the confirmed
`CLAUDE_CODE_ENVIRONMENT_KIND=bridge` link) is documented in
`cowork-control-protocol.md`'s "Cloud tasks" section and lesson 119 — not
duplicated here since it is a protocol/control-plane topic, not a
filesystem/mount/plugin-namespace one like the rest of this page.

## Device automation surfaces (Desktop 1.22209.0, lessons 125-126)

Desktop 1.22209.0 added a tool-group registry entry (12→15) for three
device-facing MCP servers. They split into two structurally unrelated
mechanisms that happen to share one registry slot:

- **Mobile simulators** (`claude_code_ios_simulator`, `claude_code_android_
  emulator` — one `control` tool each, driving iOS Simulator/Android
  Emulator via xcodebuild/simctl/adb) are gated `sessionType==="ccd"` —
  a **Claude Code Desktop coding session**, never `"cowork"`/
  `"cowork-remote"` — plus a per-platform gate defaulting `false`
  (`3577536076` iOS, `1403324732` Android) plus an org policy
  (`disableMobileSimulatorTools`) plus a user app preference. **These
  tools are structurally impossible for any Cowork agent to receive**,
  VM-sandboxed or not — the session-type check alone rules it out before
  any gate is consulted.
- **`remote_devices`** (server `"remote-devices"`, `session_type:
  "cowork-remote"`) is the actual Cowork-facing device story: a bridge to
  a real, paired remote device via a `computer_resolve_access`/
  `computer_request_access`/`computer_release_lock`/`computer_*` tool
  surface, backed by a device registry
  (`GET /api/organizations/{org}/cowork/remote_devices`,
  enclave-key/safeStorage-bound). Its own `isEnabled` gating was not
  traced (unlike the simulators' fully-read chain above) — treat its
  live reachability as unconfirmed, not as "live" by analogy with the
  simulators' documented exclusion.

No live GrowthBook fcache was captured for this 1.21459.0→1.22209.0 diff
pass — the "structurally excluded" verdict for the simulators rests on
session-type discrimination in code, not a fresh gate-state read. Full
tool schemas, gating code, and the `grand_prix` partner-credential bridge
found in the same diff are in `references/33-desktop-device-partner-
permission-tuning.md` (Chapter 36, lessons 125-128); the fourth-channel
`grand_prix` summary lives in `credential-channels.md`.

## LEAD (unconfirmed): 1.24012.1 may move session state off the host (L132)

A fresh folder-connected Cowork session under **Desktop 1.24012.1 + staged
agent 2.1.217** left **no host-side transcript** (both
`local-agent-mode-sessions` and `claude-code-sessions` untouched), no
`claude-code/2.1.217` host process, and its probe string only inside the VM;
`main.log`'s CliGovernor reported 0 local sessions. By contrast the Jul-16
sessions (agent 2.1.202/209) were host-loop and wrote host-side `audit.jsonl`
with a host `cwd`. **Unconfirmed** whether this is a host-loop→VM-loop routing
flip or just a transcript-path change — the fcache host-loop gate `1143815894`
is still `true/force` but that is a boot snapshot, not a live per-session read,
and `requireCoworkFullVmSandbox` (the `f_()` override) is not fcache-readable.
**Why it matters:** if newer builds keep transcripts in the VM, the host-side
`audit.jsonl` disk-recovery path that verified the L129 tool surface goes dark,
and future `init.tools` checks need live `rootfs.img` forensics (Ch31). Verify
where a build writes before relying on the recovery path. Full detail: Chapter
37, L132, `references/34-skill-discovery-vcs-events-containment.md`.

## Execution lanes (L138)

Cowork runs in **two structurally different lanes**. The discriminator on a session record is
`environment_kind`, never the id prefix:

| `environment_kind` | `config.origin` | lane |
|---|---|---|
| `bridge` | `claude_code_cli` | locally-executing session registered for watch/remote-control (Ch33/L119) |
| `anthropic_cloud` | `desktop_app` | **remote Cowork** — agent loop + execution on Anthropic servers |

**`cse_<ULID>` is NOT a lane oracle** — it is the id space for any server-registered Claude Code
session, local ones included.

Lane *selection* happens in claude.ai renderer code (statsig `yukon_silver` family + org bit +
Desktop's capability probe, **gate `4116586025`**). Desktop main has no lane branch, so **no fcache
gate can hold the decision**. `1143815894` (host-loop vs VM-loop) is a *within-local-lane* axis.

Remote lane specifics: cwd `/home/claude`; delivery via `SendUserFile` →
`internal__remote-devices__device_commit_files` (**delivery is an act, not a location**); local MCP
servers cannot cross the boundary; the filesystem **is discarded** at session end (local only *hides*
it — `archiveSession` deletes just `["uploads","uploads-tmp","doc-export-out"]` and does not fire at
ordinary session end); host files reachable only via `device_request_folder_access` +
`remoteSessionFolderGrants`, and only while the Desktop app is open. `container_cc_version` (observed
2.1.204–2.1.216) is a **separate version axis** from the host CLI and the Desktop-managed agent.

## Mount model and delete policy (L139, L140)

All mounts appear at `/sessions/<slug>/mnt/…`. A typical session carries **29** fuse mounts:

`outputs` (rw) · `uploads` (**ro**) · each connected folder · `.claude/projects` · `.claude/skills`
(separate mounts) · `.projects/<uuid>` (**ro**) · `.local-plugins/<install path relative to the account
root>` · `.remote-plugins/plugin_<id>`

**The mount table carries no host→VM mapping** (corrected 2026-08-29). An earlier version of this
page said "the host-path strings visible in `/proc/mounts` are not usable VM paths", which reads as
*host paths are present but useless*. The only verbatim mount line on record shows the source field is
**`/proc/self/fd/3`** — a fuse descriptor — with the mount point carrying the `/sessions/<slug>/mnt/…`
path. There is nothing in it to prefix-match a host path against, so a shell cannot use the table to
translate a host-side path the file tools reported into a VM path. That earlier sentence was read by a
skill author as licence to build exactly that lookup; it was withdrawn before they shipped it. **Open:**
no full `/proc/mounts` dump from a live host-loop session has been read here, so this rests on one line
captured for another purpose. A real dump would settle it in either direction.

`.local-plugins` has **no fixed depth** — the tail mirrors the host install layout, so
`cache/<marketplace>/<plugin>/<version>` is one instance, not a template; a live capture shows
`marketplaces/<marketplace>/<plugin>` with no version and no id. `.remote-plugins` is the opposite: the
plugin id **is** the leaf, one directory per id, so only that shape supports keying off the id.

That is the **host-loop runtime** view. The VM-loop builder additionally emits `.artifacts/<id>` and
`.scheduled/<id>` (both `ro`), which no host-loop `/proc/mounts` capture can show.

**Project-connect ≠ folder-connect**: a project produces a `.projects/<uuid>` mount and populates
`userSelectedProjectUuids`; a folder produces `/mnt/<name>` and populates `userSelectedFolders` +
`resolvedFolderKinds`. A project-only session shows an **empty `userSelectedFolders`**.

**Delete policy — every mount, not just `outputs`:** `unlink` and `rmdir` are denied (EPERM);
`truncate`/`O_TRUNC`, rename-within and rename-onto-existing are **permitted**; cross-device rename
gives EXDEV. Approval via `mcp__cowork__allow_cowork_file_delete` is **strictly per-mount**, takes
effect live in already-open shells, and involves **no remount**. Persisted as
`fileDeleteApprovedMounts`; under host-loop the handler early-returns without
calling `mountPath`. The VM-loop `mountPath(…,"rwd")` path is **untested**.

**Mount MODE construction (L139 addendum).** Only **two** mounts get their mode from the resolver
`(name, approvedList, isBridgeSession) => isBridgeSession ? "rw" : approvedList?.includes(name) ? "rwd" : "rw"`
— `outputs` and each connected folder. Everything else is a hardcoded literal that no approval state
reaches: `uploads`, `.claude/skills`, plugin mounts and **`.projects/<uuid>`** are `ro` in both
builders; host-loop adds `.claude/projects` `ro` and auto-memory `ro`; VM-loop instead mounts
`.claude` whole as `rwd`, auto-memory as `rwd`, and adds `.artifacts/<id>` / `.scheduled/<id>` (`ro`)
plus a `rw` `<pluginMount>/.mcpb-cache`. A **project attachment is therefore not writable at all**,
not merely delete-denied. Host-loop modes are recomputed **per bash call** (`computeBashMounts`), not
only at spawn.

**A third construction site, which is NOT a session mount.** `[VMCLIRunner]` spawns a short-lived
in-VM `claude <args>` for **plugin management** (30 s default timeout, SIGTERM → `exitCode 143`) with
its own two-mount set: `.claude` `rw` + **`.claude/cowork_plugins` `rwd`** (installs must write), env
`CLAUDE_CONFIG_DIR=/sessions/cli-<8hex>/mnt/.claude` + `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` +
`CLAUDE_CODE_HOST_PLATFORM`. Never merge these into a session mount table. Two consequences:
**`cli-<8 hex>` is a second session-slug namespace** — Ch31/L117's `<adjective>-<adjective>-<noun>`
is the *interactive* namespace, not the only one — and this path does a **bidirectional host↔VM
rewrite of config file contents** (`host-to-vm` before spawn, `vm-to-host` in a `finally`), which is
distinct from tool-path translation (Ch35/L122's "`/sessions/…` is never translated" still holds for
file tools). Marketplace source comes from gate `3758515526`.

**Artifact mounts are the suppressed LEGACY path, and host-loop never builds them at all (L149).**
The native `Artifact` tool and a legacy per-artifact mount set are mutually exclusive, gated by the
same eligibility predicate `Po(session, {isBridgeSession, isDispatchChild, isHostLoop})` (roughly:
the server-delivered `frameArtifactsEnabled` session-config boolean is true, and the session is not
a bridge/dispatch-child/host-loop session and not HIPAA-restricted):

```js
re = c.Ht(`2940196192`) && !Po(i, {isBridgeSession:f, isDispatchChild:p, isHostLoop:h})
```

The `CoworkArtifacts` mount collection (gate `2940196192`, one host bind-mount per artifact dir via
`getArtifactDir(id)`, artifacts with a disk status other than `local`/`cloud-sync` skipped with a
warning) builds only when `Po` is **false** — i.e. only when the session is *not* eligible for the
native tool. Frame-artifacts-eligible sessions get the tool and no legacy mounts; ineligible sessions
get the mounts (if the gate is on) to fill the gap. Because the tool's own eligibility check (`Fo`)
additionally excludes unattended sessions (`_isUnattended`) while `Po` does not, there are **three**
reachable states, not two: config-flag-off gets mounts only; config-flag-on + attended gets the tool
only; config-flag-on + **unattended** gets **neither**.

`frameArtifactsEnabled` itself is a third gating class this skill's fcache-reading methodology
cannot see at all: it arrives in the server-delivered session-config struct next to `memoryEnabled`/
`skillsEnabled`/`pluginsEnabled`, never as a GrowthBook gate — there is no local signal, live or
dark, that reveals its state. `Po`'s `!isHostLoop` term also makes the `Artifact` tool structurally
**VM-loop-only**: with the host-loop gate (`1143815894`) force-ON for 1p accounts, it is unreachable
on a standard 1p posture regardless of how the config flag or `2940196192` are set — the same
"VM-loop-only feature class" as `cowork-permissions.md`'s auto-mode rubric addition (gate
`3424551112`), which is gated the identical `!hostLoopMode` way.

**Host-loop's own artifact-access mechanism is not a mount at all.** `grantArtifactDirReadAccess()`
short-circuits for non-host-loop/`chat` sessions; under host-loop it instead appends the artifact
dir to a per-session `midSessionReadOnlyPaths` list and pushes the change live via
`applyFlagSettings({permissions:{additionalDirectories, allow}})` — a **second** `applyFlagSettings`
payload shape alongside `cowork-control-protocol.md`'s `{effortLevel}` one, used here for a
mid-session read-only grant rather than a settings toggle. No `mnt-artifact*`/`CoworkArtifacts`
mount unit exists anywhere in the current VM rootfs image (0 occurrences), consistent with
production being host-loop.

**⚠️ `isBridgeSession` ≠ `environment_kind:"bridge"`.** It is `sessionType === "agent"` on the
Desktop session record — a different namespace from L138's lane oracle. When true, approvals are
**inert at mount time** (everything resolver-driven becomes `rw`). Observed frequency on the
capturing machine: **0 of 469** persisted session records (375 no type, 86 `scheduled`,
8 `dispatch_child`); `dispatch_child` is also a hidden type and does persist, so the zero is real.

**Multiplexing:** multiple sessions share one VM guest and one mount namespace (a session sees other
slugs' mounts in `/proc/mounts`), but **isolation holds** — cross-session reads return EACCES; session
dirs are `drwxr-x---` `nobody:nogroup` and each session runs as its own `coworkd` uid. `/sessions/` is
a persistent shared volume (522 dirs enumerable from any session).

## How narration reaches the user (L175–L178, agent 2.1.247 / asar 1.40609.0)

**Plain assistant text between tool calls is the narration channel.** No
runtime mechanism emits progress narration; the Desktop renders assistant text
blocks as they stream, and the build says so itself — the PEWTER_OWL prompt
body attached to `mcp__cowork__send_user_message` reads *"Don't use it for
routine narration of what you're about to do, or for your final answer —
normal text reaches them for those."*

Consequences:

- **Cowork is not in brief mode.** Brief mode (where plain text is hidden and
  every user-facing word must go through `SendUserMessage`, enforced by a stop
  hook) is a different surface's contract — the Dispatch orchestrator states it
  outright. Cowork runs the opposite variant.
- **What makes the model talk is a prompt section**, `SUs()`, registered as the
  dynamic `communication` block. Three bodies, chosen by
  `U0(cap, env, modelFamily)` — env, then a per-family table, then a
  **server-delivered client-data capability map**. Which body a session gets is
  therefore not determinable from the binaries alone.
- **One runtime backstop exists and was not observed working.** The
  `silent_turn_reminder` attachment (agent ≥ 2.1.237) injects a nudge after 5
  consecutive silent assistant turns, capped at 3 per stretch, main thread and
  non-user-prompt turns only. Across 399 qualifying stretches in this machine's
  Cowork and CLI corpora on feature-carrying versions, it fired zero times.
- **Cowork narrates about half as often as the CLI** — 31.0% of main-thread
  assistant turns carry text or a speaking tool, against 54.1% in the CLI on the
  same agent versions, with observed silent runs up to 146 turns. A long skill
  pipeline can and does run for dozens of turns with nothing reaching the user.
  Phase-boundary narration has to be written into the skill body.
- **The dark lane is CLI-only.** `thinking.display` (API beta
  `thinking-display-updates-2026-08-18`) can return the model's between-tool
  connector text as narration-tagged thinking blocks, but `sable_thrush`,
  `connector_text` and the `AssistantNarrationSummaryMessage` renderer are all
  absent from `app.asar` 1.40609.0.
