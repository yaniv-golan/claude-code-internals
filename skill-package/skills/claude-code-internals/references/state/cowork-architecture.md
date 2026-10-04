---
domain: cowork-architecture
title: Cowork runtime architecture (current)
as_of_cli: 2.1.231
as_of_desktop: 2.7032.0
sources: [89, 90, 107, 108, 109, 114, 116, 117, 119, 120, 121, 122, 124, 125, 126, 132, 134, 138, 139, 140, 149, 151, 175, 176, 177, 178, 180, 182, 190, 193, 194, 198, 207, 208, 210, 211, 212, 213, 214, 215, 216]
updated: 2026-10-02
read_more: ["https://ccinternals.dev/cowork/?ref=skill"]
---

# Cowork runtime architecture (current)

Terms: Cowork is now part of Claude ("Claude Cowork is now just Claude", Anthropic's support
articles, modified 2026-09-30); a Cowork task runs in a **cloud session** (a `cse_` code session,
`CLAUDE_CODE_ENTRYPOINT=remote_cowork`) or, while the "Only on this computer" option exists, a
**local session** (host-loop or VM-loop on the user's computer). "Cowork" here names the product,
the Chat/Cowork choice where it still exists, and identifiers such as `remote_cowork`.

One page, current truth. History and correction trail live in the source
lessons (see frontmatter).

## Host-loop vs VM-loop

Whether a local session's agent loop runs on the host or inside the VM is
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

**Two tool families, two path forms — there is no shared scratch space
(Ch44/L163).** The file tools (`Read`/`Write`/`Edit`) take the **host-absolute
outputs path**, which the model is given in its system prompt. **From Desktop
2.7032.0 (Ch52/L190) the host-loop agent process's cwd is `/var/empty`** (when
that is a root-owned directory that is not group- or world-writable, as on stock
macOS; otherwise a private `<sessionDir>/host-cwd`), and that cwd is
write- and read-denied. A **bare filename** is therefore refused: the agent
expands it against `/var/empty` and its own validation rejects a Read, Write
or Edit there ("File is in a directory that is denied by your permission
settings."), while a relative Grep/Glob reaches Desktop's hook and is
re-anchored to outputs (`cowork-permissions.md` layer 4) — both observed in
local probe sessions on 2026-09-23. Before
2.7032.0 the cwd **was** the outputs dir and a bare filename landed there,
user-visible (measured under 2.2553.13 with the same agent 2.1.280 build).
`mcp__workspace__bash` is a different case: it
starts at the **session root `/sessions/<id>`**, and that directory (plus
`/tmp`) exists only inside the Linux environment — invisible to the user *and*
to the file tools. So a bare filename in bash never reaches outputs. Bash needs the absolute
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
below. The idempotent user-exists check is *suggestive* of session-to-VM
multiplexing (one booted guest hosting more than one session's worth of
per-user provisioning) — an inference from indirect evidence, not a
directly confirmed fact; no artifact yet states "one guest serves N
sessions" outright. The `vm_bundles/warm/<sha>/` directories once cited
as corroboration are a **download cache** for VM images fetched ahead of
an update, one per image sha (Ch52/L193), and say nothing about
multiplexing. **The Desktop pins its VM image by sha** in an embedded
manifest; the on-disk `claudevm.bundle/.rootfs.img.origin` names the
image actually installed (`882518393…`, published 2026-09-11, pinned by
both Desktop 2.2553.1 and 2.7032.0). A Desktop update does not imply a
VM update. See lesson 117 for the full forensic trace and the
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
- **cwd = the parent's cwd; a sub-agent cannot set it.** The host agent's
  `cwd` is set once at spawn: from Desktop 2.7032.0 to `/var/empty` (or
  `<sessionDir>/host-cwd`), a deliberately empty, write-denied directory
  (Ch52/L190); before 2.7032.0 to the session outputs dir. (`mcp__workspace__bash`
  starts at the session root instead; Ch44/L163.) A sub-agent's cwd is the
  **parent's cwd** — cwd is AsyncLocalStorage-scoped with a process-level
  fallback, and the Task tool's model-facing input schema **strips `cwd`**
  entirely (`.omit({cwd:!0})`); a model cannot set it, only worktree isolation
  changes it. So the reachable outputs root for any sub-agent is the
  **host-absolute outputs path** — not its cwd (from 2.7032.0) and never a
  `/sessions/…` form. From 2.7032.0 the sub-agent's own environment text says
  to pass absolute paths to the file tools.
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
  `/sessions/<id>/mnt/outputs/...` fails every time; a host-absolute-outputs
  Write succeeds every time (a cwd-relative one did too before Desktop
  2.7032.0, and is refused from it). Apparent
  non-determinism in practice is the *model* choosing which path form to
  construct (e.g. echoing a VM-absolute path captured from bash output),
  not a product-side namespace flip.
- **Depth ceiling 5; Task fan-out caps from CLI 2.1.217.** Dispatch throws at nesting depth ≥ 5
  ("Subagent nesting limit reached (depth ${g} of 5)"), and the base
  subagent tool filter hides the `Agent`/`Task` tool itself once
  `agentDepth>=5` — enforced independently in both the host bundle
  (`NMr=5`) and the in-VM ELF (`BLr=5`). Through the 2.1.205-era binaries no
  `Task`-specific concurrency or fan-out limiter existed in either binary;
  the only bound on how many sub-agents could be *running* at once was the
  generic per-turn tool scheduler window, `env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`
  (default 10, queues rather than refuses). The 25-agent/1.5M-token "workflow size"
  figure is prompt guidance only, telemetry, not enforcement.
  **As of CLI 2.1.217 (L134)** the standalone agent binary enforces real Task
  fan-out caps via `taskRegistry`: concurrent sub-agents default **20**
  (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, throws `subagent_concurrency_cap`,
  bypass gate `tengu_amber_kestrel`), total spawns/session default **200**
  (`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`, `subagent_count_cap`), WebSearch
  200/session, and **nesting off by default** (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`
  default 1; the depth-5 above is now the *ceiling*, not the default). These
  run in the shared agent binary a host-loop local session executes, so they apply
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
`~/Library/Application Support/Claude/`, not `~/.claude/`. Each session has
its own data directory with its own `.claude` config dir, which under
host-loop **is** the host CLI's `CLAUDE_CONFIG_DIR` (the
`/sessions/<id>/mnt/.claude` path from Part A above is the VM-loop path
only). The session config record carries `"hostLoopMode": true`.

Layout of a session created on Desktop 2.110.0 or later (first such
directory on this machine 2026-09-15 21:05, right after the update to
2.110.0; re-verified on a live local session, Desktop 2.19675.0 + agent
2.1.286, 2026-10-02):

```
~/Library/Application Support/Claude/local-agent-mode-sessions/
  <accountId>/<orgId>/
    local_<sessionId>.json            # session CONFIG record: model, title,
                                       #   systemPrompt, hostLoopMode,
                                       #   cliSessionId, cwd, enabledMcpTools,
                                       #   egressAllowedDomains, etc.
    <first 8 hex of sessionId>/       # the session DATA directory
      outputs/                        #   user-visible deliverables
      host-cwd/                       #   agent cwd ONLY when /var/empty is
                                       #   unusable (L190; code, none on disk)
      uploads/                        #   user-attached files
      audit.jsonl  +  .audit-key      #   signed per-session audit log
      .claude/                        #   per-session CLAUDE_CONFIG_DIR
        projects/session/<cliSessionId>.jsonl      # THE CHAT TRANSCRIPT
        projects/session/<cliSessionId>/subagents/agent-<id>.jsonl + .meta.json
        sessions/  session-env/<cliSessionId>/
        plugins/data/<plugin>-inline/              # ${CLAUDE_PLUGIN_DATA}
        backups/  cache/  policy-limits.json  .claude.json
```

- **Directory name.** The Desktop shortens `local_<uuid>` to the uuid's first
  8 hex digits (regex `^local_([0-9a-f]{8})-…$`) when it creates a session,
  unless that name is taken; a session whose full-name directory already
  exists keeps it. So older sessions stay in `local_<sessionId>/` beside the
  new 8-hex ones. Gate `2375401243` (code default on; absent from the served cache on
  2026-10-03, so the default applies) selects the short form (asar 2.19675.0). Only the config record keeps the `local_` prefix.
- **Project directory.** All 178 short-name directories on this machine use
  `projects/session/`. The Desktop sets `CLAUDE_CODE_PROJECT_DIR_NAME` to
  `session` (asar 2.19675.0). Sessions from before 2.110.0 have a slug of
  their working directory there instead.
- **How the agent reaches it.** `CLAUDE_CONFIG_DIR` is not the data directory
  itself but a staging link, `$TMPDIR/claude-hostloop-plugins/<hash>` →
  `<8 hex>/.claude` (main.log: `[HostLoop] Staged plugin: <staging> -> …/.claude`),
  the same mechanism that stages plugins (L89). `${CLAUDE_PLUGIN_DATA}`
  therefore expands under that staging path.
- **From the VM.** The bash shell sees the transcripts read-only at
  `/sessions/<slug>/mnt/.claude/projects` and can grep the live transcript.
- **Config record.** `cwd` is `<8 hex>/outputs`; `processName` and
  `vmProcessName` are the VM slug; there is no `fileDeleteApprovedMounts` key
  until a delete is first approved (see "Mount model and delete policy").

The chat log is a standard Claude Code JSONL transcript, keyed by the host
CLI's `cliSessionId` (distinct from the Cowork `<sessionId>`; linked via
the config record's `cliSessionId` field).

**Logs.** The `vmCwd=` in the `[workspaceMcpServer] bash` line is not the shell's working
directory: the shell starts in `/sessions/<slug>` (L163; one run, 2026-10-03).
Host-loop lines go to the rotating `~/Library/Logs/Claude/main*.log`
(`[HostLoop]`, `[canUseTool:HostLoop]`, `[workspaceMcpServer] bash: … vmCwd=…,
mounts=<name>:<mode>,…`, and `Starting local session local_<uuid> in
/home/<slug>`). `cowork_host_loop_debug.log` (with the `latest` link pointing
at it) was last written on 2026-06-04 on this machine; which build stopped
writing it is not known. Logs are operational telemetry, not conversation
content.

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
   — the **only** one a real local session started by the Desktop reads.

A plugin not installed into root #3 is simply never loaded into a local
session — no hooks fire, with no error. Fix: install or upload it in the Desktop app
(Customize → Plugins; or org-remote/RPM); the standalone CLI `--cowork` path does not reach the
Desktop's namespace.

At session start, the host loop symlinks each enabled plugin into a temp
`claude-hostloop-plugins/<hash>` dir and runs hooks host-side;
`${CLAUDE_PLUGIN_ROOT}` resolves to that staging path (same host-side
value in both skill content and hooks — **one token, two namespaces**):
- **accepted** when handed to host-side `Read`/`Edit`/`Glob`/`Grep` (file
  tools want host paths — keep the token literal there), and
- **rewritten for in-VM bash** (`mcp__workspace__bash`): before a command
  reaches the VM, the Desktop replaces each plugin's staging and install
  path in its text with the plugin's VM mount: for an org-remote plugin
  `/sessions/<slug>/mnt/.remote-plugins/plugin_<id>`, for a marketplace
  plugin `/sessions/<slug>/mnt/.local-plugins/cache/<marketplace>/<plugin>/<version>`
  (both seen live 2026-10-02, Desktop 2.19675.0; an organization skill goes
  to `.claude/skills/<skill>`). So `${CLAUDE_PLUGIN_ROOT}` in a shell command from
  skill text reaches the VM as the mount path (the rewrite was measured on a
  `printf` and an `ls`; running a script through it was not tried). The
  table is in asars from 1.40609.0 on, not in 1.37937.3, and local
  transcripts show the first rewrite on 2026-09-06 (L122). Not rewritten: the config-dir staging path behind
  `${CLAUDE_PLUGIN_DATA}` and the host outputs path. The trap runs the
  other way now: a root the shell *prints* is the VM path, which the file
  tools refuse. Hook commands run on the Mac and need no rewrite.

So the skill has to pick per consumer: the host path for file tools, either
form for the shell.

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
`` !`cmd` `` skill-shell execution is force-disabled in a local session
(`disableSkillShellExecution` short-circuit on `CLAUDE_CODE_IS_COWORK`; elsewhere each command
goes through the shell tool's permission check (CLI 2.1.286 `Cle`): allowed → run and substituted; needs
approval in auto mode → rewritten to `[run this first, exactly as written, and use its output: …]` for the
model to run or not; otherwise the skill fails to load. In the cloud
a skill invoked before the conversation's session exists (it is set up lazily by the first turn needing a shell or file
tool) is expanded outside the agent (most likely the chat backend): `!cmd` raw and never run, plugin tokens literal, base `/mnt/skills/plugins/<p>:<s>`
(2026-10-02, Desktop 2.19675.0 + web, agent 2.1.287); after setup Claude Code's loader expands it, and a `!cmd` the skill allows in `allowed-tools`
that then fails leaves a typed slash command with no reply or error (L217; unlisted commands not tested). After setup, an allowed read inside `/home/claude` ran and a write or a read outside it was handed
off (relayed 2026-10-01, agent 2.1.286); an uploaded skill's is left raw in the CLI — L217), and hook env-exports don't cross
the host/VM bridge — neither can serve as a probe.

Reliable recipe (ordered): `$CLAUDE_CODE_IS_COWORK` set → cowork (host-side or
VM-loop); cwd under `/sessions/<id>` → cowork VM shell (host-loop); `$CLAUDECODE
= 1` → Claude Code, refined via `CLAUDE_CODE_ENTRYPOINT` — **measured
2026-09-23 (L198):** `remote_cowork` = a cloud session (its shell has
`CLAUDECODE=1` but **no** `CLAUDE_CODE_IS_COWORK` and no `/sessions`, so
without this refinement the recipe calls it the CLI), `remote` = Claude Code
on the web, `local-agent` = a local session's agent context, otherwise the CLI;
no `CLAUDECODE` and no `claude` binary → e.g. a claude.ai chat; else → other
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

**On Desktop 2.19675.0 (2026-10-02) the host-side path works.** A local
session (agent 2.1.286, `hostLoopMode: true`) wrote its transcript, sub-agent
transcript and `audit.jsonl` on the Mac, in the short-name session directory
(see "Session storage"), and its `init.tools` array could be read from there.
Look in `<org>/<8 hex>/.claude/projects/session/`, not only in `local_<id>/`
directories. Why the 1.24012.1 session left nothing is still unexplained.

## Execution lanes (L138)

Cowork runs in **two structurally different lanes**. The discriminator on a session record is
`environment_kind`, never the id prefix:

| `environment_kind` | `config.origin` | lane |
|---|---|---|
| `bridge` | `claude_code_cli` | locally-executing session registered for watch/remote-control (Ch33/L119) |
| `anthropic_cloud` | `desktop_app` | **cloud session** — agent loop + execution on Anthropic servers |

**`cse_<ULID>` is NOT a lane oracle** — it is the id space for any server-registered Claude Code
session, local ones included.

Lane *selection* happens in claude.ai renderer code (statsig `yukon_silver` family + org bit +
Desktop's capability probe, **gate `4116586025`**). Desktop main has no lane branch, so **no fcache
gate can hold the decision**. `1143815894` (host-loop vs VM-loop) is a *within-local-lane* axis.

Remote lane specifics: cwd `/home/claude`; delivery via `SendUserFile` →
`mcp__remote-devices__device_commit_files` (**delivery is an act, not a location**; `internal__remote-devices__…` is
only the Desktop's telemetry name for the same tools, asar 2.19675.0); host-side
**stdio** MCP servers — both `claude_desktop_config.json` and Cowork **plugin** servers — DO reach the
session, run on the Mac by the Desktop and bridged in as `<server>__<tool>` tools while the Desktop is
open (see "Local MCP bridge" below; corrects L138's "cannot cross the boundary", 2026-09-22); the
filesystem **is discarded** at session end (local only *hides*
it — `archiveSession` deletes just `["uploads","uploads-tmp","doc-export-out"]` and does not fire at
ordinary session end); host files reachable only via `device_request_folder_access` +
`remoteSessionFolderGrants`, and only while the Desktop app is open. `container_cc_version` (observed
2.1.204–2.1.216 in session API traffic) is a **separate version axis** from the host CLI and the
Desktop-managed agent — and **`CLAUDE_CODE_VERSION` in the cloud shell/hook env is NOT that axis**:
it is runner-set (`2.1.42` on both 2026-08-29 and 2026-09-21, across a staging→release runner change),
never read by the agent (0 read sites in 2.1.275/2.1.278), and the cloud agent is dated **≥ 2.1.248**
by the hook-payload fields it emits (`scratchpad_dir`, `prompt_cache_likely_expired`, …: 0 through
2.1.247, present from 2.1.255). Read the real build from the transcript's per-record `"version"`
field (`transcript_path` is in every hook payload) or `$CLAUDE_CODE_EXECPATH --version` (L174,
corrected 2026-09-22).

Cloud-lane facts from the 2026-09-21 canary (relayed; semantics verified first-party, L174):
uploads land at **`/root/.claude/uploads/<session-id>/<8-hex>-<name>`** (`HOME=/root`; the
`/mnt/user-data/uploads` the lane's own prompt names does not exist; `.claude/uploads` is 0 in every
agent binary, so it is runner-placed); the container agent **does not start plugin `mcpServers`**
(`CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1`, `…_EXCEPT=documents`) — because the Desktop does, see
"Local MCP bridge" below; `CLAUDE_CODE_DESKTOP_APP_VERSION` is
unset and would be ignored under `remote_cowork` anyway (agent reads it only under
`claude-desktop`/`local-agent`); Cowork ships its own Stop/UserPromptSubmit hooks under
`/home/claude/.claude/`; a `computer://` link renders as a link only when it names a file the conversation's own
tools produced (L215, measured 2026-09-29), and a bare path becomes a
broken `claude.ai` URL — the presented file card is the only delivery, and it works from
`/home/claude`, outside `outputs/`.

### Lane facts re-derived at Desktop 1.46388.4 / agent 2.1.260 (L180)

**The remote lane's environment prompt is server-authored.** Its heading and markers
(`pw-browsers`) are **0 occurrences** in `app.asar` 1.46388.4, the in-VM ELF 2.1.260 and the
Desktop-managed Mach-O 2.1.260 alike. Nothing local composes it, so nothing local can be read to
predict it.

**Desktop constructs one entrypoint literal; the agent knows two.**
`CLAUDE_CODE_ENTRYPOINT:"local-agent"` is assigned at exactly 2 sites (the Cowork local-agent spawn
and a one-shot inference helper). The agent's own table maps **both `local-agent` and
`remote_cowork`** to the display name "Cowork" — `remote_cowork` appears 8× in `.vite/build` for
recognition only, never construction, because the remote lane's agent is spawned server-side.

**Remote-lane features are inert locally for a transport reason, not an entrypoint check.**
`cowork_memory_context` (0 in the asar, 26 in the agent) and the `/worker/skill-manifest` fetch both
route through `host:"ccr-session"`, which throws `"ccr-session host requires --sdk-url"` when that
flag is absent and otherwise validates the URL against an allowlist. **`--sdk-url` occurs 0 times in
the entire `app.asar` and 41 times in the agent**, so no Desktop-spawned session can resolve the
host. This is structural, not a toggle.

**Counting scope is part of every asar claim.** `.vite/build` (main process), `.vite/renderer`, and
the remainder (`node_modules`, `compile-cache`, and the Agent SDK bundled inside the asar) answer
differently — `isRemote` is 60 in build and 87 whole-file. 1.46388.3 → 1.46388.4 moves **no** tracked
identifier (`localAgentMode` 20 → 20, `isRemote` 60 → 60, `remoteSession` 59 → 59, `deviceLink`
6 → 6, `device_bash` 34 → 34); the real delta is three build chunks and −859 bytes.

## A cloud session's outputs contract is switched per session (L198; formerly "Cloud Cowork's outputs contract")

Two independent client features: `ccr_outputs_filestore_mount` (is `/mnt/user-data/outputs` →
`/mnt/attach/outputs` mounted) and `ccr_outputs_path_delivery` (is a Write/Edit there the delivery, named in
the instructions). Seen live: both on (2026-09-23); mount on + delivery off, and mount off (2026-09-28,
relayed) — in both of those the instructions name the working directory (`/home/claude`) and `SendUserFile`.
The mount's presence says nothing about delivery. The session prompt itself is server-side.
Delivery follows the file tool, not the folder (2026-10-04, n=1): a shell write into the mount never
appeared, a file-tool write in the same session did.

## A THIRD surface Desktop calls "cloud" — the claude.ai code-execution container (relayed, 2026-09-22)

A Desktop "cloud session" served, on 2026-09-22, a runtime that is **not Claude Code at all**, one day
after the same Desktop gave the `remote_cowork` lane. Measured in-session by the `founder-skills`
project (relayed; the artifact half is first-party below):

| | cloud session | this third surface |
|---|---|---|
| `CLAUDE_CODE_ENTRYPOINT` / `_REMOTE` / `_VERSION` | `remote_cowork` / `true` / `2.1.42` (the variable's value — **runner-set metadata, NOT the agent's build**, which is ≥ 2.1.248; see above) | **all empty** |
| cwd | `/home/claude` | `/` |
| outputs | `/mnt/user-data/outputs` → `/mnt/attach/outputs` (symlink) | `/mnt/user-data/outputs` |
| skills | plugin at `/root/.claude/plugins/synced/<org>_<acct>/` | **flat, read-only, `/mnt/skills/plugins/<plugin>:<skill>/`, ~150 of them** — every account-enabled skill, no plugin root |
| transcript | `/root/.claude/projects/-home-claude/<sid>.jsonl` | no `/root/.claude` |
| sub-agents | depth pinned to 1 | **no `Task` dispatch at all** |

**First-party check (CLI 2.1.278, Desktop-managed agent 2.1.275, `app.asar` 2.2553.1):** `/mnt/skills`
and `/mnt/attach` are **0 in all three**; positive control `/mnt/user-data` 5/5/3 and
`CLAUDE_CODE_ENTRYPOINT` 91/93/16. So the flat skills mount is not a Claude Code concept — consistent
with a different runtime rather than a Cowork variant.

**`/mnt/skills` is NOT a discriminator either:** a cloud session also lists `skills` under `/mnt` (L198's table, and a relayed session on 2026-09-28). Use `CLAUDE_CODE_ENTRYPOINT` and whether a `claude` binary exists (cloud session: `/opt/node22/bin/claude`).

**`/mnt/user-data` is NOT a discriminator.** The CLI hardcodes it: `UKr="/mnt/user-data/uploads"` is
the stage-file root (overridable by `CLAUDE_STAGE_FILE_ROOT`) and `/mnt/user-data/working` is the
directory-sync root. The outputs directory therefore has the same name on both surfaces. The only
reliable signal is **the absence of the plugin**: `${SCRIPTS%/skills/*}` yields the shared mount root,
and the plugin's `scripts/`, `agents/` and `plugin.json` hooks do not exist.

**Why it matters:** a skill whose checks live in its plugin runs anyway and degrades *silently* — the
observed case hand-wrote every sub-agent hand-off, graded its own checklist, dispatched no adversary,
ran no gates, and shipped a report indistinguishable from a checked one. Published as the site rules
`detect.plugin-may-be-absent` and `change.refuse-rather-than-degrade`.

## Four surfaces, one probe (L198, 2026-09-23, first-party)

The same probe on each surface an agent can receive a skill on:

| | local session | cloud session | Claude Code on the web | claude.ai chat |
|---|---|---|---|---|
| `CLAUDE_CODE_ENTRYPOINT` (shell) | not visible (sealed) | `remote_cowork` | `remote` | unset |
| shell `pwd` / `$HOME` | `/sessions/<slug>` / same | `/home/claude` / `/root` | `/home/user/<repo>` / `/root` | `/` / `/root` |
| `claude` binary | 2.1.280 | 2.1.280 | 2.1.280 | absent |
| relative `Write` | **refused** | written to `/home/claude` (not shown to the user) | written to the repo | **refused** by `create_file` |
| `Write /var/empty/x` | refused | written | written | written |
| pathless Glob/Grep | re-anchored to outputs | walks `/home/claude`, incl. `.claude/remote/` token files | the repo | no search tools |
| outputs location named in the prompt | host outputs path | `/mnt/user-data/outputs` | none (the repo) | `/mnt/user-data/outputs` |

Discriminators: `CLAUDE_CODE_ENTRYPOINT` (`remote_cowork` vs `remote` vs unset) and whether a
`claude` binary exists. `/mnt/user-data` is on all three cloud surfaces.

Later runs (Desktop 2.19675.0, 2026-10-02/03): in a cloud session `claude` is
`/opt/node22/bin/claude`, 2.1.288, and `env -u CLAUDECODE claude -p …` answered (from the UI); in a
local session's VM shell it is `/usr/local/bin/claude` (transcript); in the classic chat sandbox
`command -v claude` failed with exit 127 (UI). Outbound `curl` from a cloud session reached pypi,
api.github.com, example.org, httpbin and wikipedia (HTTP 200), all but pypi through a CONNECT proxy;
from the classic chat sandbox the same hosts answered directly, with api.github.com returning 403
(UI, one run each; causes not captured).

## Scheduled tasks migrate themselves to the cloud (L208)

Desktop's `[RemoteMigrationSweep]` (from 1.44121.1; config gate `2974609625`, force-on)
converts a local scheduled task into a cloud routine after ≥2 runs over ≥0.5 days
(among other conditions), disables the local copy and stamps `migratedToRemote`;
tasks attached to a Space, sub-hourly, custom-cron or with attachments are held back;
device-tied tasks move as bound routines; a reverted task is never moved again. Observed on the capturing machine 2026-09-24 ("Remote migration completed;
local copy disabled"). Desktop decides only whether lanes are **allowed**
(`placementRules`: device / SSH host / cloud; for Cowork only self-hosted-only and the
`cowork-local-tasks-off` latch from gate `3634338308`, off by default, can deny local); the web UI picks the lane per task. The task-header
laptop+chevron is a device picker for a cloud session (see L210 for how the lane is picked). A local start logs
`LocalAgentModeSessions.start` then `Starting local session local_<uuid>`.

## Where a new task runs (L210)

The claude.ai interface picks the lane per new task. Its router returns the first of
`local_ungated`, `local_override_forced`, **`local_opted_out`** (account setting
`dramatic_shrimp_enabled` false; unset means cloud), folder/Space-forced,
Auto/Bypass-forced, Chrome/options/computer-use/plugin-stdio, else `remote`. The account
setting is what "Only on this computer" (row `cowork-backend`; 2026-10-02, Desktop 2.19675.0:
Settings → General → Tasks on the merged interface, Settings → Cowork on the older one) and,
per the code, the task-header Cloud popover (not seen on 2026-10-02: the older header's popup showed
only "Connected" and "Manage computers") both write (announced for Pro and Max plans, not yet observed: from 2026-10-06
new tasks run in the cloud and the option, "Only on your computer" in Settings > General per
Anthropic's support article read 2026-10-02, is removed; tasks already started locally stay local;
scheduled tasks move to the cloud; other plans to follow; L210); switching to local saves only after the
feedback dialog's main button. A scheduled task's own "Only on this computer" switch is a
separate, per-task setting. Measured 2026-09-25 on Desktop 2.9939.2: with the account
setting saved and the app restarted, new tasks still ran in the cloud (`/home/claude`,
`CLAUDE_CODE_ENTRYPOINT=remote_cowork`), in Auto mode too; a local-only scheduled task
did run locally. The bundled interface and three builds fetched from
`assets-proxy.anthropic.com` route identically, so the cause lies outside that code.
On Desktop 2.16120.0 (from 2026-09-30) plain new tasks have run locally again: four local
sessions on disk with no scheduled task, parent or bridge, and a relayed run on 2026-10-01
(`/sessions/<slug>`, entrypoint unset) with the setting on; the user reports it is honoured
only some of the time. The Desktop's main process (`app.asar`, 2.9939.4 and 2.16120.0) has
no lane choice of its own: its only veto is the organization local-tasks-off setting (gate
`3634338308`, off here), unchanged. The interface, switch and router included, ships separately in
`Contents/Resources/ion-dist/` (2.19675.0), not in `app.asar`: search both before calling a string
absent from the app. Check `pwd`/`CLAUDE_CODE_ENTRYPOINT` per run.
On Desktop 2.19675.0 (2026-10-02) the composer New opened decided: the Chat/Cowork selector
(Cowork) gave a local session 2 of 2, the merged composer the cloud 2 of 2, with the account setting
on throughout (composer shapes from the UI; L210).

## Desktop 2.9939.2 additions (L212–L214)

- **Artifact tools by session kind.** One predicate (`frameArtifactsEnabled`,
  not scheduled/bridge/dispatch child/HIPAA) picks the family: eligible
  sessions get the native `Artifact` tool; every other session, including every
  scheduled task through 2.9939.x (from 2.16120.0 scheduled runs are eligible, L219),
  gets `mcp__cowork__create_artifact` / `update_artifact` /
  `list_artifacts` (+ `verify_artifact` under `3229517805`) when `2940196192`
  is on. `read_widget_context` is always present. Desktop calls the family
  legacy (L212).
- **`--settings` as a file.** Host-loop spawns write agent settings to
  `<userData>/cowork-spawn-settings/<id>-<hex>.json` (gate `822840158`, default
  on); the argv hop is inferred (L213).
- **Minimum CLI per model.** `minCliVersion`; a prewarmed session below it is
  discarded (`cli_below_model_floor`) (L213).
- **HIPAA egress.** For an org whose `compliance_taints` include `hipaa`, a `*`
  in the VM egress allowlist becomes `*.anthropic.com`, `anthropic.com`,
  `claude.com`, `*.claude.com` (`lam_hipaa_gate_blocked`, surface
  `vm_egress_allowlist`) (L214).
- **Fast mode on 3p.** `CLAUDE_CODE_DISABLE_FAST_MODE` is set for every
  third-party deployment; it changes behaviour only for a gateway with a static
  credential (L214).


## Desktop 2.16120.0 additions (L219–L221)

- **Scheduled runs get native `Artifact`.** The family predicate admits
  `sessionType` "scheduled"; session start clears `frameArtifactsEnabled` for a
  scheduled run unless `1978029737.scheduledRunFrameArtifacts` (default true,
  unserved 2026-10-01). An always-allow on a scheduled publish prompt is stored per
  task (`scheduled-task-grants/…/artifact-publish-grants.json`, keyed task id +
  creation time) and auto-approves later runs (L219).
- **Sweep carries attached files.** `local_folders` for attached files only when
  `!(boundEnabled && boundFilesEnabled)` (`2974609625`, both true 2026-10-01);
  bound mode only, at most 16 files, shareable parents (L219).
- **Host-loop file permissions.** An approved file-tool call runs on the judged
  input; an org per-call-approval policy reaches the prompt (side chats still
  refuse); `allow_cowork_file_delete` refuses invalid requests before the prompt;
  `PYTHONDONTWRITEBYTECODE=1` in every spawn env (L220).
- **Screenshot tools.** `screenshot_file_preview` (`verifyToolsEnabled` +
  `coworkNativeFilePreview`, not bridge/dispatch child) and `screenshot_artifact`
  (artifact family); `canVerifyArtifacts` = `3229517805.verifyToolsEnabled` alone.
  Imagine availability = `3444158716`, not HIPAA, not org-blocked (`2742800629`) (L221).
- **Sharing local artifacts.** `3229517805.sharingEnabled` (true 2026-10-01) gates
  the Desktop's share/unshare/auto-publish calls on the local Artifacts store, the
  store the `mcp__cowork__` tools write: a user can share a legacy-made artifact
  (`share_from_content`; refused under HIPAA or over 1M characters), and with
  auto-publish on (`autoPublishEnabled`) an `update_artifact` call republishes it.
  No model tool shares (L212).

## `computer://` links by lane (L215)

Measured 2026-09-29 (Desktop 2.9939.4, agent 2.1.284). **Cloud conversation** (Desktop and web
alike): a link is rendered only for a file the conversation's own Write / `SendUserFile` calls
produced (any turn); writes under `/mnt/user-data/working/`, never-written existing files and host
paths (even granted) render as plain text. **Local session**: any real file links and opens and gets a
file card; `/sessions/<name>/mnt/…` paths are rewritten to host paths (spaces URL-encoded) before
display. The client's path-based cloud rule does not match what renders. Archived sessions: untested.

## A cloud session and the user's computer (L215)

Measured 2026-09-27 (Desktop 2.9939.2, `remote_cowork`): a cloud session reaches the
Mac only through `mcp__remote-devices__*` tools the running Desktop serves (deferred,
loaded via ToolSearch). `get_device_info` shows platform, Desktop build, every top-level
home-folder name (Desktop/Documents/Downloads flagged `requiresGrantBeforeListing`) and
local MCP server states before any grant. `device_request_folder_access` → "Allow once",
session-scoped; a protected location (`~/.claude` and `~/.claude/skills` tried) still gets the prompt and is refused
only after Allow once (2026-10-02, Desktop 2.19675.0; L215). `device_stage_files` copies files into `/mnt/user-data/uploads/<folder>/…`
(byte-identical, via the Files API); `device_commit_files` writes a file from the outputs
folder (or a `SendUserFile` id) to an absolute path inside a granted folder, with an mtime
guard (`force` overrides), no per-write prompt. `device_bash` runs in the **Mac's Cowork VM**
(Ubuntu 22.04.5 aarch64, per-session user `rcw-<id>`, `$HOME=/sessions/rcw-<id>`, folder
at `$HOME/mnt/<folder>`, `/bin/sh` → dash); deleting needs
`device_request_delete_permission` (mount `rw` → `rwd`). The session's own Write to a
`/Users/…` path succeeds silently **inside the container**. The cloud container's
`/bin/sh` is dash too. A folder connected from the composer before sending takes two consents, the
Desktop's "Allow Claude to change files in <folder>" and then a native prompt that the files leave
the Mac (UI, one run, 2026-10-03, Desktop 2.19675.0); saving delivered files into it rendered as one
"Saved files to your computer" row with Written/Rejected lists, and the files landed on the Mac.

## What Anthropic's help center says (relayed, read 2026-10-02 and 2026-10-03)

"Claude Cowork architecture overview" (support article 14479288, read 2026-10-03): "Cowork sessions
run in the cloud by default"; "Local execution remains available for existing desktop deployments: the
agent loop and code execution run on the member's device", with code execution in an isolated VM.

"Get started with Claude Cowork" (support article 13345190, modified 2026-09-30) describes the
cloud model this page measures: "Cowork runs your tasks in the cloud (in beta). Claude's work runs
on Anthropic's servers, in an isolated environment … When a task needs something on your computer,
like a local file or your browser, Claude reaches it through the Claude Desktop app on that
computer" (the device bridge, L215). "Scheduled tasks run in the cloud, with no device online."
"Network egress permissions don't apply to the web fetch or web search tools or MCPs, including
Claude in Chrome. Web fetch runs server-side". Permission modes are Manual, Auto and Skip; "If you
have the new Claude experience, the permission setting in the message box offers Auto and Manual
(default)." Article 15520349 adds, for Pro and Max: from 2026-10-06 new tasks run in the cloud and
"Only on your computer" is removed, and "Tasks that use files on your computer need the desktop app
open" (L210). Its title is "Use Claude Cowork on web, desktop, and mobile"; on 2026-10-03 it also says that
each task already started on the computer "shows a note at the top with a button to download its
transcript". The note seen on 2026-10-02 ("Tasks on this computer are being deprecated", L210) had
Learn more and Dismiss. Articles 13345190 and 15520349 both open with the per-plan note that matches the merged interface seen in a Personal
organization and the Chat/Cowork choice still seen in a Team organization on 2026-10-02 (L216, L217).

## One conversation, two runtimes (L216)

Code-level (claude.ai client + its embedded `bard_api.proto`/`conversation.proto`); seen live
on 2026-10-02 (Desktop 2.19675.0 + web, merged composer): a new conversation is `/chat/<uuid>`,
the first shell/file turn shows "Getting set up for this session  Ns ›" (~5 s), then the header
reads "Claude Desktop (macOS), Connected"; the URL stays `/chat/`. The composer sends to `session` / `hub` / `rest` by mount point and
conversation record, not by message. A hub conversation has a work mode
(`CHAT` / `WORKSPACE_PROXY` / `TOOL_FAULT_PROXY` / `FULL_PROXY`) and can be upgraded into
a cloud session, a Cowork workspace (`WorkspaceUpgrade`, lane `COWORK_REMOTE`; triggers incl.
`INTERCEPTED_TOOL`, `ATTACHMENT`, `MEDIA_LIMIT`, `DEVICE_ELECTION`), by the client
(`workModeOverride:"workspace_proxy"` on folder+device pick), the model
(`hub_workspace_setup` tool) or presumably the server. A cloud session can be continued
or shown as a chat (`continuation`, `cowork_session_presented_as_chat`, flag
`cai_serene_pine`). Unrelated to the Desktop's local Chat mode.

## Credential delivery and build identity (L207)

Host-loop on macOS/Linux: Desktop removes `CLAUDE_CODE_OAUTH_TOKEN` and passes the
token as fd 3 (`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3`, a 0600 temp file opened
then unlinked; env fallback on failure); the agent reads `/dev/fd/3` and deletes the
variable. Present since ≤ 1.18286.2. Desktop updates come from a per-device endpoint
on `api.anthropic.com`, which can serve builds the public `RELEASES.json` never lists
(2.2553.13 on 2026-09-22); the running build is visible only as `appVersion` in
`main.log`. Desktop 2.19675.0 runs the host agent from
`~/Library/Application Support/Claude/claude-code/<version>/<12-hex build id>/claude.app`
(through `Contents/Helpers/disclaimer`), and agent 2.1.286's `init` lists three built-in plugins,
`cc-plugin-sec-default`, `cc-plugin-agents-md` and `cc-plugin-telemetry` (`@builtin`), seen 2026-10-02.

## Local MCP bridge into the remote lane (asar 2.2553.1; present since 1.20186.0)

`buildLocalMcpBridgeTools` (`[localMcpBridge]`) announces host-side stdio MCP servers into a
`cowork-remote` session from **two pools**, each tool named `<server>__<tool>` (telemetry
`mcp__<server>__<tool>`, `server_type:"bridge-stdio"`, `session_type:"cowork-remote"`):

| pool | source | `server_source` | `_meta["anthropic/kind"]` |
|---|---|---|---|
| `LocalMcpServerManager.getSharedInstance()` | `claude_desktop_config.json` `mcpServers` | `user_config` | `local` |
| `getPluginMcpInstance()` | the account's Cowork plugins (remote `getHostPluginPaths` + local `getEnabledLocalPlugins`), collected by `[PluginBridgeMcp]` | `plugin` | `plugin` |

- **Gates/policy (plugin pool):** gate **`3555657854`** (force-ON, `fr_mqzam1o7`, fcache 2026-09-22,
  367 features — not yet a registry gate entry: pinning it requires restamping `fcache_capture` and
  re-observing all pinned gates); org `localMcpEnabled` (off → "local MCP disabled by policy");
  `allowedPluginMcpServers` set → "no plugin servers bridged". Exclusion list = served config
  **`227459766`** (absent from the fcache → shipped default **`["documents"]`**) — excluded plugins
  are "not bridging its MCP servers; the session-side copies serve instead". This is the Desktop half
  of the agent's `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1` / `_EXCEPT=documents`: the container agent
  skips plugin MCP discovery because the Mac runs the servers, and `documents` is the one plugin
  whose server runs container-side.
- **Per-server rules** (`[PluginMcpHostConfig]`, logged skip reasons): must be a **valid stdio spawn
  config** (`invalid_config` — an HTTP `url` declaration is not bridged; use an `mcp-remote` stdio
  shim); no `${user_config.*}` references (`user_config_unsupported`); MCPB manifests must resolve
  to stdio with no un-defaulted required config (`could_not_prepare`); `blocked_by_policy`.
- **Timing:** plugin config apply bounded to **15 s** (then bridge what registered; a late differing
  result fires `reloadRemoteToolsDevice("plugin_mcp_change")`, debounce 2 s); connect race **10 s**
  (partial/empty set announced on timeout, grown later via `prepareGrowth`); plugin request timeout
  120 s; tool call timeout **180 s**. Name collisions drop the later arrival.
- **Gating of calls:** the Desktop's own tool-approval prompt keyed on `anthropic/approvalHash` —
  not the agent's permission rules.
- **Transport:** the remote-tools device (Ch36/L126 `remote_devices`), so **the Desktop must stay
  open**; a normal Desktop chat does not see bridged servers (`[localMcpBridge]` lines in
  `~/Library/Logs/Claude/main.log` are the confirmation).
- **Live evidence:** `user_config` pool confirmed 2026-09-18 by `stackchan-mcp-mod` (LAN robot
  driven from a cloud session through `npx mcp-remote … --allow-http`). `plugin` pool: code-verified
  only.

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

**`outputs` allows deletes from the start, from Desktop 2.16120.0.** Its mode no longer comes from the
approval list: it is `rwd` unless the session is a bridge (`agent`) session, while each connected
folder stays `rw` until approved (asar 2.16120.0 and 2.19675.0; in 2.9939.4 `outputs` still went
through the approval list). Live on 2.19675.0 (2026-10-02): `main.log` showed `outputs:rwd` on the
first shell call with no approval on record, and `rm` in `outputs` worked. In the same session a
connected folder was `rw`; `rm` there failed with "Operation not permitted"; the model called
`mcp__cowork__allow_cowork_file_delete` (`file_path` of the file); `main.log` logged the permission
request and, after the user allowed it, "Received permission response … once"; the config record
went from no `fileDeleteApprovedMounts` key to `["<folder>"]`; the next shell call showed
`<folder>:rwd` and the same `rm` worked. A 2026-10-03 run also renamed a file and moved it into a
new subfolder in outputs, with no card (one run).

**Delete policy for the other resolver mounts (measured before 2.16120.0, when it covered `outputs` too):** `unlink` and `rmdir` are denied (EPERM);
`truncate`/`O_TRUNC`, rename-within and rename-onto-existing are **permitted**; cross-device rename
gives EXDEV. Approval via `mcp__cowork__allow_cowork_file_delete` is **strictly per-mount**, takes
effect live in already-open shells, and involves **no remount**. Persisted as
`fileDeleteApprovedMounts`; under host-loop the handler early-returns without
calling `mountPath`. The VM-loop `mountPath(…,"rwd")` path is **untested**.

**Mount MODE construction (L139 addendum).** Up to 2.9939.4, **two** mounts got their mode from the resolver
`(name, approvedList, isBridgeSession) => isBridgeSession ? "rw" : approvedList?.includes(name) ? "rwd" : "rw"`
— `outputs` and each connected folder; from 2.16120.0 only connected folders do, and `outputs` is
`isBridgeSession ? "rw" : "rwd"`. Everything else is a hardcoded literal that no approval state
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
dark, that reveals its state. `Po` no longer carries an `!isHostLoop` term (dropped at Desktop
1.32352.0; present in 1.28929.0), so the native `Artifact` tool reaches host-loop sessions: all 50
frame-artifact sessions on the capturing machine are host-loop and made real calls (L149, L212). A
session `Po` excludes (scheduled, bridge, dispatch child, HIPAA, or frame artifacts off) gets the
`mcp__cowork__` artifact tools instead when `2940196192` is on (L212).

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
- **The model reaches the agent as a sentinel, not a choice.** The Desktop LAM
  spawn sets `model: i.model || "default"` and `effort: i.effort`. `"default"` is
  truthy and nothing in the asar strips it, so `--model default` ships on every
  Cowork spawn with no explicit model, and the agent resolves `"default"` to its own
  configured default. Consequences: `claude-opus-5` appears exactly **once** in
  `app.asar` 1.40609.0 — inside the per-model *effort* table, never as a spawn
  default — so **no client can re-derive which model a Cowork task will run** by
  reading the Desktop build; and the effective model can change with no local
  artifact changing, which is what makes the L175 capability tier unknowable. The
  only model-keyed remote config, `coworkModelAutoFallbackByAccount`, is an
  account-keyed boolean whose sole use is `=== false` →
  `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: "1"` — refusal-fallback, not routing.
- **`--model` and `--effort` are asymmetric, and not in the direction an emulator
  guesses.** In the vendored SDK transport both flags are conditional; the asymmetry
  is introduced upstream in the LAM options, where `model` has a sentinel fallback
  (always sent) and `effort` has none (sent only when the session sets one). Effort
  itself is per-model in the product — `recommended` is `low` for sonnet-4-6,
  `medium` for sonnet-5, `high` for opus-4-8 and opus-5, `xhigh` for opus-4-7 — so
  pinning one effort value across models applies a setting the product varies.
- **The dark lane is CLI-only.** `thinking.display` (API beta
  `thinking-display-updates-2026-08-18`) can return the model's between-tool
  connector text as narration-tagged thinking blocks, but `sable_thrush`,
  `connector_text` and the `AssistantNarrationSummaryMessage` renderer are all
  absent from `app.asar` 1.40609.0.
