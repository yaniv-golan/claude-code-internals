Updated: 2026-07-04 | Source: Binary extraction from the standalone CLI bundle **v2.1.198** (SEA-extracted) + Claude.app (Desktop) `app.asar` **1.18286.0** (`.vite/build/index.js`), plus two prior empirical probes reused as ground truth: the v2.12.2 Cowork split-execution env probe and the v2.12.1 `coworkroot-probe` (host/VM boundary). Companion chapter to Ch29/L115: that one is about what a skill *can do* per surface; this one is about how a skill *finds out which surface it is on*.

# Chapter 30: Detecting the Runtime from a Skill — CLI vs Cowork vs Elsewhere

> **Provenance.** Direct inspection of the v2.1.198 CLI bundle (shell-env injector `bmt`,
> the entrypoint classifier sets `c2u`/`u2u`/`d2u` and normalizer `cvs`, the Cowork
> helpers `jX`/`Xga`, the skill-shell kill switch `q5n`) and of app.asar 1.18286.0 (the
> local-agent spawn env block). Minified identifiers are per-build and drift release to
> release; match by mechanism, not symbol.

---

## TABLE OF CONTENTS

116. [Lesson 116 -- Detecting the Runtime from a Skill: CLI vs Cowork vs Elsewhere](#lesson-116----detecting-the-runtime-from-a-skill)

---

# LESSON 116 -- DETECTING THE RUNTIME FROM A SKILL: CLI VS COWORK VS ELSEWHERE

## The question, and why the obvious answer is wrong

"How does a skill reliably tell whether it's running in the Claude Code CLI, in Claude
Cowork, or somewhere else (Cursor, another harness, a bare terminal)?"

The obvious answer — "check `$CLAUDE_CODE_IS_COWORK`" — is wrong in exactly the case it
matters, because in production Cowork (host-loop, L107/state page) a skill is **split
across two environments**:

- The skill's *content* is read by the agent loop running **host-side**, in a process
  whose env does carry `CLAUDE_CODE_IS_COWORK=1` and `CLAUDE_CODE_ENTRYPOINT=local-agent`
  (both set in the app.asar local-agent spawn env block — the same object literal
  documented in L115 Part D).
- The skill's *shell commands* run in the **workspace microVM** via
  `mcp__workspace__bash` (the `Bash` tool is excluded from the host loop, L107). The VM
  shell is **sealed from host env**: the v2.12.2 probe showed user-level and managed
  `settings.json` `env` blocks are both empty in-VM, and the session env builder
  (`Ucr`-family) injects Anthropic-auth material only. None of the `CLAUDE_CODE_*`
  markers survive.

So a shell probe that checks `$CLAUDE_CODE_IS_COWORK` concludes "not Cowork" precisely
when it *is* Cowork. Two more Cowork-specific channels a detection scheme might reach
for are also closed:

- **Inline dynamic-context execution is force-disabled.** The CLI's
  `disableSkillShellExecution` resolver short-circuits on Cowork before consulting any
  policy or setting:

  ```js
  function q5n(){if(Oe.CLAUDE_CODE_IS_COWORK)return!0;
    if(_n("policySettings")?.disableSkillShellExecution===!0)return!0;
    return Qo().disableSkillShellExecution===!0}
  ```

  A skill's `` !`cmd` `` preprocessing blocks simply never execute in a Cowork session —
  they can't be used as a probe (or for anything else).
- **Hook env-exports and host file writes do not cross into the VM** (the v2.12.1
  `coworkroot-probe`, L89). A `SessionStart` hook cannot hand the script side a
  "you are in Cowork" flag.

## Part A — the signal inventory (what is actually set, where)

### CLI shell subprocesses: `CLAUDECODE=1` and friends

Every Bash-tool subprocess in the standalone CLI gets a small marker set injected by
`bmt` (and the shell-snapshot spawner independently sets the first):

```js
function bmt(e){let t={CLAUDECODE:"1",CLAUDE_CODE_SESSION_ID:e.sessionId,
  CLAUDE_CODE_CHILD_SESSION:"1"};if(e.source==="agent")t.AI_AGENT=...}
```

So in a CLI session, a skill's script reliably sees `CLAUDECODE=1` plus
`CLAUDE_CODE_SESSION_ID` (and `AI_AGENT` when spawned from an agent context). These are
also on the env-strip/allowlist arrays (`tHp` etc.) the CLI itself maintains, i.e. they
are deliberate contract markers, not incidental leakage.

### The agent process: `CLAUDE_CODE_ENTRYPOINT`

The CLI classifies its own surface via `CLAUDE_CODE_ENTRYPOINT`, normalized at boot by
`cvs()` (`local_agent`→`local-agent`; `mcp serve`→`mcp`; `CLAUDE_CODE_ACTION` set →
`claude-code-github-action`; default `cli` or `sdk-cli`). The v2.1.198 recognizer set
(`c2u`) is:

```
cli, mcp, sdk-cli, sdk-ts, sdk-py, bench, claude-vscode,
claude-code-github-action, local-agent, local_agent, claude-desktop,
remote, remote_baku, remote_cowork, remote_trigger, remote_desktop,
remote_mobile, claude_in_slack, claude-in-slack, claude-in-teams,
claude-desktop-3p, claude-security, ssh-remote
```

Two useful subsets: `u2u = {claude-desktop, claude-desktop-3p, local-agent}` (the
Desktop family, consumed by `B8()`) and `d2u = {claude_in_slack, claude-in-slack,
claude-in-teams, remote_trigger, remote_cowork, remote_baku}` (chat-surface/remote
family). The CLI's own "am I Desktop/Cowork" helper is:

```js
function jX(){if(Oe.CLAUDE_CODE_IS_COWORK)return!0;
  return process.env.CLAUDE_CODE_ENTRYPOINT==="claude-desktop"}
```

Desktop Cowork spawns with `CLAUDE_CODE_ENTRYPOINT:"local-agent"` +
`CLAUDE_CODE_IS_COWORK:"1"` (asar env block, L115 Part D); cloud Cowork workers use the
`remote_cowork` value (`avs()`). Treat unknown values as "Claude Code, unspecified
surface" — the set grows release to release.

### ADDENDUM (2026-08-13) — `claude-coworker*` is an entrypoint PREFIX family, and a new env key joins the identity trio

Re-derived first-party against standalone-CLI agent **2.1.229** (the CLI baseline this skill pins,
2.1.221, is now several versions stale — held locally on this machine up to 2.1.229). Two findings that
bear directly on this lesson's `c2u`/`u2u`/`d2u` entrypoint taxonomy and its detection recipe.

**1. A prefix-matched entrypoint class the value-set model can't express.** Agent 2.1.229 contains:

```js
function Bgd(e){ return e==="local-agent" || e?.startsWith("claude-coworker")===!0 }
```

`claude-coworker*` is matched by **prefix**, not by membership in a fixed set. This lesson's `c2u` /
`u2u` / `d2u` groupings are all enumerated value sets (`{claude-desktop, claude-desktop-3p,
local-agent}`, etc.) — a prefix family is structurally something a value set cannot express, so any
detection logic built purely on "is `$CLAUDE_CODE_ENTRYPOINT` a member of this set" will silently
miss every `claude-coworker*` variant. **This lesson's ordered detection recipe (Part B) needs review**
against this prefix class before being treated as exhaustive.

**2. `CLAUDE_CODE_COWORK_FRAME_ARTIFACTS` joins the identity trio this recipe is built on.** A new
session-identity env key, written by Desktop **1.28929.0** and consumed starting at agent **2.1.228**,
is absorbed into the same boot-time session-identity singleton as `CLAUDE_CODE_ENTRYPOINT` and
`CLAUDECODE`:

```js
class jMc { entrypoint; childSession=!1; claudecode=!1; coworkFrameArtifacts=!1;
            setCoworkFrameArtifacts(e){this.coworkFrameArtifacts=e} … }
function WMc(e){ WYg(e), $6e.setEntrypoint(Q.CLAUDE_CODE_ENTRYPOINT),
                 $6e.setChildSession(Boolean(Q.CLAUDE_CODE_CHILD_SESSION)),
                 $6e.setClaudecode(Boolean(Q.CLAUDECODE)),
                 $6e.setCoworkFrameArtifacts(Q.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS) }
RB_ = new Set(["CLAUDE_CODE_ENTRYPOINT","CLAUDE_CODE_IS_COWORK","CLAUDE_CODE_COWORK_FRAME_ARTIFACTS"])
```

It joins `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_IS_COWORK` in the agent's own `RB_` set and is set on
the boot identity singleton alongside `CLAUDECODE` and `CLAUDE_CODE_CHILD_SESSION` — **the exact trio
this lesson's Part A/B recipe is already keyed on.** A future revision of the recipe should account for
it as a fourth signal in that same family, not as an unrelated flag. Full derivation (the producer
shipping one agent version ahead of its consumer, the `ule()`/`Bgd()` predicate chain, and the
case-insensitive strip helper) is in the new **L151**.

### The Cowork VM shell: filesystem signature, not env

With the env scrubbed, the VM shell's unmistakable signals are structural:

- cwd and mounts live under `/sessions/<id>/…` (`/sessions/<id>/mnt/outputs`,
  `mnt/.claude/skills`, `mnt/.local-plugins/…` — L89 probe + the `rootfs.img` systemd
  `.mount` units, state page `cowork-architecture.md`);
- the guest is Linux (Ubuntu 22) even when the host is macOS — but use the `/sessions`
  path signature as the discriminator, not `uname` (Linux-host CLI is ambiguous).

**Artifact-drift caveat (why this lesson does not cite the old allowlist):** the
host→VM env allowlist previously documented from app.asar v1.6259.1 (the `MGn` ~30-key
set: HOME/PATH/TERM/proxies/`PYTHONDONTWRITEBYTECODE`/…, in
`docs/internal/cowork-vm-env-injection.md`) is **no longer present in asar 1.18286.0**
— the only `PYTHONDONTWRITEBYTECODE` occurrence left is an unrelated SSH-MCP env-forward
filter (`jBo`, `[SshMcpServerManager] dropped env keys not forwarded to remote`). The
sealed-VM-env *fact* stands on the v2.12.2 empirical probe and the current
architecture; the allowlist *implementation* has moved out of the Desktop main bundle
(presumably into the VM stack). Do not "verify" the seal by grepping the asar for the
old symbol — that's the L114 pruned-baseline lesson again: absence from the artifact
you searched is not absence from the system.

## Part B — the recipe

### Script-side (the skill runs a shell probe)

Order matters — strongest signal first:

```bash
detect_runtime() {
  if [ -n "$CLAUDE_CODE_IS_COWORK" ]; then
    # Host-side Cowork process (hooks run here; and under VM-loop orgs the whole
    # agent — including its shell — runs in the VM with this env intact)
    echo cowork
  elif [ -d /sessions ] && [ "${PWD#/sessions/}" != "$PWD" ]; then
    # Cowork VM shell (host-loop): env is sealed, but the /sessions/<id> filesystem
    # signature is structural and cannot be hidden
    echo cowork
  elif [ "$CLAUDECODE" = "1" ]; then
    echo claude-code   # refine via $CLAUDE_CODE_ENTRYPOINT (Part A table)
  else
    echo other         # Cursor, plain terminal, other harnesses
  fi
}
```

This is deliberately robust to the host-loop/VM-loop gate flip (`1143815894`, L107): a
VM-loop org's agent carries `CLAUDE_CODE_IS_COWORK` into its own Bash (branch 1); a
host-loop session's VM shell hits branch 2.

### Content-side (the model decides before any script runs)

The strongest discriminator the model can observe directly is the **tool surface**:
instruct it to branch on whether it has a plain `Bash` tool versus
`mcp__workspace__bash` (and the `mcp__cowork__*` family). The tool substitution *is*
the Cowork architecture (L107's host-loop partition) — it cannot be absent. This also
degrades gracefully outside Claude entirely: a harness with neither tool name falls
into the "elsewhere" branch.

### What not to rely on

| Anti-pattern | Why it fails |
|---|---|
| Bare `$CLAUDE_CODE_IS_COWORK` in a script | False negative in the host-loop VM shell (the common production case) |
| `` !`cmd` `` inline probe in skill content | `q5n` force-disables skill shell execution in Cowork — never runs |
| `SessionStart` hook exporting a sentinel var / writing a host file | Host/VM bridge is closed (v2.12.1 probe) |
| `${CLAUDE_PLUGIN_ROOT}` as a location signal | Resolves host-side everywhere (L89); useless in-VM |
| `uname` alone | Linux-in-VM vs Linux host is ambiguous; use the `/sessions/<id>` path signature |
| Grepping the current asar for the old `MGn` allowlist | Implementation moved out of the Desktop bundle (Part A caveat) |

## Identifier table

| Identifier | Kind | Artifact | Effect |
|---|---|---|---|
| `bmt` | fn | CLI 2.1.198 | Injects `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION` (+`AI_AGENT`) into Bash subprocesses |
| `cvs` | fn | CLI 2.1.198 | Boot-time `CLAUDE_CODE_ENTRYPOINT` normalizer (`local_agent`→`local-agent`, `mcp serve`→`mcp`, action→`claude-code-github-action`, default `cli`/`sdk-cli`) |
| `c2u` / `u2u` / `d2u` | Sets | CLI 2.1.198 | Recognized entrypoint values / Desktop family (`B8()`) / chat-surface-remote family |
| `jX` / `Xga` / `avs` | fns | CLI 2.1.198 | `IS_COWORK \|\| ENTRYPOINT==="claude-desktop"` / bare `IS_COWORK` / `ENTRYPOINT==="remote_cowork"` |
| `q5n` | fn | CLI 2.1.198 | `disableSkillShellExecution` forced true under `CLAUDE_CODE_IS_COWORK` — inline `` !`cmd` `` never runs in Cowork |
| local-agent spawn env block | spawn config | asar 1.18286.0 | Sets `CLAUDE_CODE_IS_COWORK:"1"` + `CLAUDE_CODE_ENTRYPOINT:"local-agent"` on the **host-side agent process only** |
| `jBo` | regex allowlist | asar 1.18286.0 | SSH-MCP env-forward filter — the only surviving `PYTHONDONTWRITEBYTECODE` hit; **not** the old VM allowlist |
| `/sessions/<id>/mnt/…` | path signature | VM image / in-VM ELF | The structural, env-independent Cowork-VM discriminator |

## Methodology note (the transferable lesson)

Detection guidance must be written per *execution context*, not per *product*: "in
Cowork" names at least three distinct places code can run (host-side agent process,
host-side hooks, in-VM shell) with three different visible envs. And when a previously
documented implementation symbol vanishes from the artifact it was found in, re-anchor
the *fact* to its strongest surviving evidence (here: an empirical probe) instead of
either silently re-asserting the stale symbol or wrongly retracting the fact.

**Cross-references.** Ch24/L107 (host-loop tool partition, spawn contract — why the
shell is `mcp__workspace__bash`) · Ch25/L108 (env-var catalog; this lesson answers
"which of those are *visible where*") · L89 + v2.12.1/v2.12.2 probes (host/VM boundary,
sealed VM env, plugin mounts) · Ch28/L114 (pruned-baseline methodology this lesson's
allowlist caveat reuses) · Ch29/L115 (the spawn env block these markers come from;
capability-per-surface companion).
