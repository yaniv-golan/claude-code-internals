---
domain: cowork-architecture
title: Cowork runtime architecture (current)
as_of_cli: 2.1.198
as_of_desktop: 1.18286.0
sources: [89, 90, 107, 109, 114]
updated: 2026-07-04
---

# Cowork runtime architecture (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter).

## Host-loop vs VM-loop

Whether a Cowork session's agent loop runs on the host or inside the VM is
a single server-side decision, not a per-feature toggle:

```js
function f_(){return HeA()||iX()?!1:(isDeveloperApprovedDevUrlOverrideEnabled
  && process.env.CLAUDE_FORCE_HOST_LOOP==="1")?!0:cPt()}
```

- `HeA()` = org policy `requireCoworkFullVmSandbox === true` → forces
  **VM-loop**.
- `iX()` = `settings.forceDisableHostLoop` → forces **VM-loop**.
- Dev override `CLAUDE_FORCE_HOST_LOOP=1` (behind an approved dev-URL flag)
  → forces **host-loop**.
- Otherwise, GrowthBook gate `1143815894` (`cPt()`) decides.

**Production decodes to host-loop.** The live `fcache` shows gate
`1143815894` = `{value:true, on:true, source:"force"}` — default
consumer/Pro Cowork is host-loop; only locked-down orgs with
`requireCoworkFullVmSandbox` get VM-loop.

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

**One shared scratch space, two path namespaces — not two filesystems.**
Under host-loop, the host-loop system prompt (injected host-side, verbatim
in app.asar) tells the model: every call starts in the sandbox's outputs
directory, "the same scratch space the Read/Write/Edit tools use." The
in-VM shell sees that directory at a different absolute path
(`/mnt/outputs`) than the host file tools do. A file `mcp__workspace__bash`
writes is readable by `Read`/`Edit` in the same session — it is the same
file, just addressed by two different absolute prefixes. The prompt's own
guidance is to use bare/relative filenames with both tool families, not to
route everything through bash. Capturing a VM-absolute path
(`/sessions/<id>/mnt/outputs/x`) from bash output and feeding it to a host
file tool is the common failure mode — it is denied by the path-gating
PreToolUse hook (`IeA`/`vZe`/`Nen`; see `cowork-permissions.md` layer 4).

**VM-side mounts are stood up by the VM image, not the client binaries.**
Inside the guest, mounts under `/sessions/<id>/mnt/` are created by the VM
image's own systemd `.mount` units, which live in
`~/Library/Application Support/Claude/vm_bundles/claudevm.bundle/
rootfs.img` (a ~10 GB raw ext4 image) — not in the Desktop `app.asar` or
the agent ELF. Verified: skills mount at
`/sessions/<id>/mnt/.claude/skills` via a systemd unit named
`sessions-<name>-mnt-.claude-skills.mount`, found verbatim in `rootfs.img`.
The rule for "where does Cowork mount/stage X": grep `rootfs.img` for the
path and for `*.mount` unit names — the agent ELF only shows how skills
are *read*, not how the VM *lays them out*. "Absent from the client
binaries" is not proof of "absent on disk."

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
      outputs/                        #   agent's working directory (its cwd)
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

## Re-verification at Desktop 1.18286.0 (2026-07-04)

All of the above — the host-loop/VM-loop split, the shared-scratch-space
filesystem model, session storage layout, and the three-root plugin
namespace — is structurally unchanged in Desktop 1.18286.0 (lesson 114).
One piece of prior underspecification is now resolved: the env var
carrying a Space's per-space auto-memory directory (`CoworkSpaces.
getAutoMemoryDir`, documented above via lesson 109) into the agent's spawn
env is `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`, with `CLAUDE_CODE_
DISABLE_AUTO_MEMORY=1` as the fallback when no memory path resolves.
