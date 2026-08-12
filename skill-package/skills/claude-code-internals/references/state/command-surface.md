---
domain: command-surface
title: Command surface (current)
as_of_cli: 2.1.229
sources: [111, 112, 135]
updated: 2026-07-22
---

# Command surface (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter). This page is the **narrative** three-part
split; `registry.json`'s `cmd.*` entries are the exhaustive, per-command
inventory — check there for any command not named below.

## The three-gate reachability rule

A command appearing in the binary's registration table does not mean a
user can reach it. Before claiming a command is live, trace all three
gates:

1. **Per-command `isEnabled`.** Many registrations carry a function that
   can hardcode `false` (e.g. `/plan-artifact`'s `isEnabled:v5e` returns
   `!1` unconditionally) or gate on a GrowthBook flag.
2. **Master command-array inclusion.** Registration in a sub-array is not
   sufficient if the top-level command list that the UI/parser consults
   doesn't include it.
3. **Empirical test.** Registration + enablement can still be undercut by
   entrypoint checks (e.g. `isEnabled:()=>…ENTRYPOINT==="remote_cowork"`)
   that only resolve at runtime. Confirm behavior against a real session
   before asserting reachability.

Registration ≠ reachable. Apply all three gates per command, not just the
first one that resolves in your favor.

## Live (announced — in both binary and official CHANGELOG)

Notable additions/changes in this span:

- **`/cd <path>`** — move the session to a new working directory without
  breaking the prompt cache.
- **`/rewind`** — now also resumes a conversation from **before
  `/clear`** was run (aliases `checkpoint`, `undo`).
- **`/config [key=value]`** — set any setting directly from the prompt,
  not just open the settings UI.
- **`/plugin list`** — `--enabled`/`--disabled` filters, a "Skills"
  section in the Installed tab, and a marketplace search bar.
- **`claude mcp login` / `claude mcp logout <name>`** — authenticate MCP
  servers from the CLI.
- **`/skill-doctor`** — `isEnabled:()=>!0`, genuinely live; shows which
  loaded skills are unused and costing context.
- **`/pause-memory`** — live rename target of `/toggle-memory` (see
  Removed/renamed below and `memory-knowledge-base.md`).

Also live in this span but not command surface per se: the
`Tool(param:value)` permission-rule syntax, `sandbox.credentials` /
`sandbox.allowAppleEvents`, `autoMode.classifyAllShell`, `--safe-mode` /
`CLAUDE_CODE_SAFE_MODE`, sub-agents spawning sub-agents up to 5 deep
(`agentDepth`), Claude-in-Chrome GA, and background-agent `Notification`
reasons `agent_needs_input` / `agent_completed` (a new *reason* on the
existing event, not a new hook event type — still 30).

## Dark-launched (in the binary, absent from the official CHANGELOG)

- **`/design`, `/design-sync`, `/design-login`** — Claude Design: connect
  a codebase's design system to `claude.ai/design`. Gated by `pNe()` +
  `CLAUDE_CODE_ENABLE_DESIGN_MCP` / `CLAUDE_CODE_ENABLE_DESIGN_SYNC`; off
  by default. A `DesignSync` tool backs `/design-sync`.
  `/design-login` handles the OAuth handshake.
- **`Artifact` tool / `/plan-artifact`** — publishes a shareable page to
  `claude.ai/code/artifact/${slug}`. `/plan-artifact` itself is
  **hard-disabled** (`isEnabled` returns `false` unconditionally — a
  registered slot that reports "not registered"). The tool is gated by
  the CLI's own master flag `tengu_cobalt_plinth` (default false; this is
  a **different** gate from Desktop's `coworkArtifacts` — the string
  `coworkArtifacts` does not appear in the CLI bundle at all).
- **Launch Composer** — `CLAUDE_CODE_ENABLE_LAUNCH_COMPOSER` /
  `CLAUDE_CODE_DISABLE_LAUNCH_COMPOSER`; not in the changelog.
- **`/auto-mode-setup`** (`requires:{workspace:!0}`) and
  **`/cowork-plugin`** (`userInvocable:!1`,
  `isEnabled:()=>…ENTRYPOINT==="remote_cowork"`) — both registered, both
  gated to specific entrypoints.

Reachability caveat applies here more than anywhere: dark-launched ≠
reachable. Read the live gate state (GrowthBook/`fcache`) before telling
a user a dark-launched command is available to them.

## Removed / renamed

- **Removed:** `/bridge-kick`, `/init-verifiers`, `/simplify`.
- **Removed tools:** `TeamCreate` / `TeamDelete` — every session now has
  one implicit team (binary hit count for `TeamCreate` dropped from 6 in
  v2.1.159 to 1 in v2.1.198).
- **Removed env vars:** `ANTHROPIC_FOUNDRY_AUTH_TOKEN`,
  `CLAUDE_CODE_AGENT_LIST_IN_MESSAGES`, `CLAUDE_CODE_TEAM_ONBOARDING`.
- **Renamed:** `/toggle-memory` → `/pause-memory` (kept as an alias, not
  deleted — `aliases:["memory-pause","toggle-memory"]`). See
  `memory-knowledge-base.md` for the memory-pipeline context this sits
  in.

## Where to look next

- Exhaustive command list with per-command status: `registry.json`,
  `cmd.*` entries (`node scripts/state.js <name>`).
- Permission-syntax and sandbox detail: not yet a dedicated state page —
  see L111 directly via `fetch-lesson.js 111` for anchors.
- Cowork-specific command/tool gating (host-loop tool partition,
  `--allowedTools`, Desktop PreToolUse forced-ask): `cowork-permissions.md`.
  `/background`/`/daemon`/`/stop`/Fleet-view gating is documented in
  L89–L90, which predate this page's sources (L111–L112) — check
  `registry.json`'s `cmd.*` entries for their current status.
