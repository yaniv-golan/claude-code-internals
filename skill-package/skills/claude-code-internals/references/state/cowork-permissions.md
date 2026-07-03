---
domain: cowork-permissions
title: Cowork permission stack (current)
as_of_cli: 2.1.198
as_of_desktop: 1.17377.2
sources: [89, 107, 108, 109]
updated: 2026-07-03
---

# Cowork permission stack (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter).

## The layers (all simultaneously active, host-loop production)

1. **`--allowedTools` pre-approval** at spawn. `--allowedTools <built-ins>`
   pre-approves specific tools at process start — this, not a blanket
   auto-allow, is why some tools "just run" even under `default` permission
   mode.

2. **Host-loop tool partition** — a set of constants that shape which
   built-in tools the host-side agent even offers:
   - `gre` = `HOST_LOOP_EXCLUDED_BUILTIN_TOOLS` = `[Bash, NotebookEdit, REPL,
     JavaScript, WebFetch]` — dropped from the host-side allowed set entirely.
   - `PNt` = `HOST_LOOP_SAFE_BUILTIN_TOOLS` (Task + the `TaskCreate/Update/
     Get/List/Stop` family + Glob/Grep/Read/Edit/Write/WebSearch/Skill/
     AskUserQuestion/ToolSearch/SendUserMessage); `Ren(A)` filters a tool
     list down to `mcp__*` names plus this safe set.
   - `BDt = {Bash:"mcp__workspace__bash", WebFetch:"mcp__workspace__web_fetch"}`;
     `QDt(A)` **adds** the workspace-tool alias into the *disabled* set
     whenever `Bash`/`WebFetch` are disabled — additive injection, not a
     substitution in an allow-list.

3. **Desktop-side PreToolUse `hooks` option** built in app.asar at spawn
   time (REAL — re-confirmed v2.17.2 after being wrongly overturned once).
   Passed as the `hooks` option when the local-agent session is spawned, so
   it is invisible to any grep of the CLI/in-VM agent bundle — it never
   lived there. Four matchers:
   - **`Task` matcher** blocks any call whose `tool_input.run_in_background`
     is truthy (`decision:"block", reason:"Background agents disabled"`);
     otherwise it emits `subagent_invoked` telemetry. This is a *second*,
     independent block from layer 5 below — Desktop-injected, `Task`-only,
     unconditional.
   - **`Skill` matcher** fires `skill_invoked` telemetry (plugin/marketplace
     attribution), can inject `additionalContext`, and fires
     `cowork_consolidate_memory_called` for the memory-consolidation skill.
   - **Joined-name matcher forces `permissionDecision:"ask"`** for 8
     `mcp__cowork__*`/scheduled-task tools, unconditionally — even under
     `--allow-dangerously-skip-permissions` — with reason *"This tool
     requires explicit approval regardless of permission mode."* The set:
     `Abt = [RrA, AQ, l0A, hv]` →
     `mcp__cowork__allow_cowork_file_delete`,
     `mcp__cowork__request_cowork_directory`,
     `mcp__cowork__launch_code_session`,
     `mcp__cowork__save_skill`; plus `EV`/`dV`/`Oue`/`xue` →
     `MCP_CREATE_SCHEDULED_TASK`/`MCP_UPDATE_SCHEDULED_TASK`/
     `MCP_START_WATCHING`/`MCP_STOP_WATCHING` (the scheduled-tasks server).
     The set has grown with Cowork's feature surface: a pre-scheduled-tasks
     capture (app.asar 1.12603.1) recorded 5 names; the live 1.17377.2
     binary has 8.
   - **`mcp__.*` matcher** — a generic MCP-tool gate via `wjt(session,
     tool_name)`; a `"block"` decision short-circuits before the tool runs.

4. **Path-gating PreToolUse hook `IeA`** = `[Read, Write, Edit, Glob, Grep]`
   + `MultiEdit` — hook `vZe`/`Nen` denies `/sessions/…` (VM-absolute)
   paths on the host-side file tools ("VM path on host — use the bash tool
   for `/sessions/` paths") and enforces working-directory scoping. This
   exists because host-loop Cowork is **one shared scratch space with two
   path namespaces, not two filesystems**: the host-loop system prompt
   tells the model every call starts in "the same scratch space the
   Read/Write/Edit tools use," just seen at a different absolute path from
   the VM shell (`mcp__workspace__bash` sees it at `/mnt/outputs`). The fix
   for a denied path is the prompt's own guidance — bare/relative
   filenames — not routing everything through bash.

5. **CLI speculation-engine `run_in_background` abort** for `Ih` = [Bash,
   PowerShell] only — independent of layer 3's `Task` block. Two separate
   mechanisms, both real, both currently active.

6. **Session rules** via `CLAUDE_BG_SESSION_PERMISSION_RULES`.

7. **Per-mount delete approval** — `fileDeleteApprovedMounts` is a real
   per-mount set on the session object. Mounts default to `rw` (write, no
   delete) and become `rwd` only once their path is added to that set,
   which happens when the user approves an `allow_cowork_file_delete`
   request (one of the 8 tools forced to `ask` in layer 3).

`--allow-dangerously-skip-permissions` is a **capability grant**; mode
stays `default` (auth is layered on top, not replaced). Without
`--permission-prompt-tool stdio` at spawn, `AskUserQuestion` is silently
auto-dismissed and scripted answers never fire.

## Not part of the stack (adjacent, don't conflate)

- The host↔VM MCP-server split is a **credential/execution** boundary, not
  a permission layer: stdio servers in `claude_desktop_config.json` run
  host-side with full host env; `mcp__workspace__bash`/`web_fetch` run
  sealed in the VM. `mcp__workspace__web_fetch` genuinely routes host-side
  to `POST /api/organizations/<org>/cowork/web_fetch`.
- `${CLAUDE_PLUGIN_ROOT}` resolves to one value host-side
  (`claude-hostloop-plugins/<hash>`) — accepted by host file tools, but
  useless to in-VM bash, which must use the VM-mounted plugin path instead.

## Known past errors (do not re-introduce)

- **"No 5-tool forced-ask hook" (v2.15.0)** — WRONG. A re-verification pass
  grepped only the CLI/in-VM agent bundle and wrongly retracted the claim;
  the config is Desktop-side (app.asar), passed as the `hooks` spawn
  option, and was never going to appear in that bundle. Re-confirmed live
  against 1.17377.2, independently cross-checked against a third-party
  binary capture. See L107 methodology note.
- **"`--setting-sources=user` excludes plugin-scoped hooks in Cowork"** —
  WRONG. Plugin hooks DO fire in Cowork (host-loop symlink staging); the
  real determinant is the **three-root plugin namespace** — a desktop
  Cowork session reads only
  `local-agent-mode-sessions/<acc>/<org>/cowork_plugins/cache` (+`rpm/`),
  which the standalone-CLI `--cowork` install does not reach. Install via
  the Cowork app UI (or org-remote/RPM) to land in the namespace a real
  session reads.
- **"Cowork ignores `--mcp-config` outright"** — overbroad. The drop only
  fires under `I5()` (safe mode) or `xB8()` (hermetic-remote: both
  `CLAUDE_CODE_REMOTE` and `CLAUDE_CODE_REMOTE_HERMETIC_MODE`). A plain
  `SESSION_KIND=bg` Cowork session does not by itself trigger the drop.
