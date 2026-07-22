---
domain: plugins-skills-hooks
title: Plugins, skills & hooks (current)
as_of_cli: 2.1.217
as_of_desktop: 1.24012.1
sources: [5, 88, 89, 106, 109, 118, 123, 124, 129, 131]
updated: 2026-07-22
---

# Plugins, skills & hooks (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter). Cowork's plugin *mounting* mechanics (mount
paths, symlink staging, session storage) are covered in full in
`cowork-architecture.md`'s "Plugin roots" section — this page states the
same facts at summary level plus the generic (non-Cowork) plugin/skill/
hook contract.

## Plugin hooks fire in Cowork — the three-root namespace is the gotcha

Plugin-scoped hooks **do** fire in Cowork sessions; the earlier belief
that `--setting-sources=user` silently excludes them was wrong and has
been retracted. The real determinant is **which of three plugin roots**
a plugin is installed into:

1. Regular `~/.claude/plugins/` — normal CLI installs, not Cowork-visible.
2. Standalone-CLI Cowork root `~/.claude/cowork_plugins/` — what
   `claude plugin install --cowork` writes.
3. **Desktop's** account/org root
   `local-agent-mode-sessions/<acc>/<org>/cowork_plugins/cache` (+`rpm/`)
   — the **only** root a real Desktop Cowork session reads.

A plugin not installed into root #3 is simply never loaded into a Cowork
session — no hooks fire, no error shown. Fix: install via the Cowork app
UI (or org-remote/RPM); the standalone CLI's `--cowork` install path does
**not** reach the Desktop namespace.

Mechanism: the host loop symlinks each enabled plugin into a temp
`claude-hostloop-plugins/<hash>` dir at session start and runs hooks
**host-side**.

## Plugin agent frontmatter restrictions

A **plugin-shipped** agent definition (as opposed to a `.claude/agents/`
project/user-level one) has three frontmatter fields silently discarded
at load time, with a warning (lesson 124, re-verified at 1.20186.1/
2.1.205): `permissionMode`, `hooks`, and `mcpServers` — verbatim: *"Plugin
agent file ${e} sets ${G}, which is ignored for plugin agents. Use
.claude/agents/ for this level of control."* Consequences:

- **The `mcpServers:` frontmatter channel — the one sanctioned way a
  sub-agent can gain tools its parent session doesn't have (its own
  spawned MCP servers, filtered only by that agent's own
  `disallowedTools`) — is `.claude/agents/`-only.** A plugin agent cannot
  use it; a plugin author who wants a sub-agent-scoped MCP server has to
  ship it as a top-level plugin `mcpServers:` entry instead (session-wide,
  not sub-agent-scoped).
- `permissionMode`/`hooks` on a plugin agent are likewise inert — only a
  `.claude/agents/` definition can set per-agent permission mode or hooks.

This sits on top of the standard tool-composition rule: a sub-agent's
`tools:` frontmatter is authoritative only over what the **session**
already offers (built-ins minus session-level deny rules, plus session
MCP tools) — nothing is injected beyond that except via the sanctioned
`mcpServers:` channel above. Omitting `subagent_type` entirely on a
dispatch falls back to the built-in `general-purpose` type with
`tools:["*"]` (full wildcard, not restricted) — a materially different
outcome from pinning any explicit-`tools:` agent, plugin or not. See
`cowork-architecture.md`'s "Sub-agent execution" section.

## `${CLAUDE_PLUGIN_ROOT}` resolves to wherever the agent loaded the plugin from

The token substitutes to **one value per agent** — the directory the
plugin was loaded from (`CLAUDE_PLUGIN_ROOT: t.path`, where `t.path` is the
`--plugin-dir` the agent was spawned with). *Which* directory that is
depends on the execution mode; the Desktop picks it in a single branch,
`Ei = isHostLoopModeEnabled ? qX(installPath) : sdkPath`:

- **Host-loop (production).** Resolves **host-side** to the staging path
  `claude-hostloop-plugins/<hash>` (or the raw host install path — see
  space-triggering below). Host-side `Read`/`Edit`/`Glob`/`Grep` **accept**
  it (they want a host path — keep the token literal there), but in-VM bash
  (`mcp__workspace__bash`) **cannot see** it. A script run through the VM
  shell must instead use the VM mount, discovered at runtime rather than via
  the token: `/sessions/<id>/mnt/.local-plugins/cache/<mp>/<plugin>/<version>`
  (marketplace/local) or `/sessions/<id>/mnt/.remote-plugins/plugin_<id>/…`
  (org-remote). This is the **"one token, two namespaces"** split — no single
  rule works for both consumers; pick per where the reference is used.
- **VM-loop (`requireCoworkFullVmSandbox` orgs).** The whole agent runs
  in-VM, so the same branch hands it `sdkPath` — the token resolves to the
  **in-VM mount** (`/sessions/<id>/mnt/.local-plugins/…` or
  `.remote-plugins/plugin_<id>/…`) and `bash ${CLAUDE_PLUGIN_ROOT}/x.sh`
  **works**. Decisive: the string `claude-hostloop-plugins` is **absent from
  both agent binaries** (host CLI, in-VM ELF) and present only in the Desktop
  driver — an in-VM agent structurally cannot resolve to a host path.

So L89's "resolves host-side **everywhere**" holds **only under host-loop**.
The real invariant: the token points at the agent's own `--plugin-dir` —
host-side under host-loop, VM-side under VM-loop.

**Substitution happens once, at definition load — not at call time**
(lesson 123). The primitive `PEe(e,t)` replaces `${CLAUDE_PLUGIN_ROOT}`
(and `${CLAUDE_PROJECT_DIR}`/`${CLAUDE_PLUGIN_DATA}`) directly in TEXT
when a plugin agent/skill/command definition is loaded — so a plugin
sub-agent's system prompt, and a skill's or command's body/
`allowed-tools` frontmatter, already contain the literal resolved path by
the time the model ever sees them. This is *why* a plugin sub-agent's
`Read` of its own `references/*.md` works under host-loop (the
pre-resolved host path is in its prompt, and plugin paths are in the file
tools' allow-roots, read-only) — not because of any runtime expansion.

**File tools never expand the literal token.** There are zero occurrences
of `${CLAUDE_PLUGIN_ROOT}` substitution in Read/Write/Edit/Glob/Grep path
handling — a literal, un-pre-resolved `Read("${CLAUDE_PLUGIN_ROOT}/…")`
call fails. **As a process env var**, `CLAUDE_PLUGIN_ROOT` is injected
only into hook subprocesses, plugin MCP stdio servers (+
`headersHelper`), and plugin LSP servers — it is **absent from the
Bash-tool subprocess env** (`sEt()` injects only `CLAUDECODE`,
`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, and optionally
`AI_AGENT`/`CLAUDE_EFFORT`/`TRACEPARENT`) — a model-typed
`${CLAUDE_PLUGIN_ROOT}` inside a Bash command expands to empty.

Two mechanics behind the host-loop value (`qX`):

- **Staging is space-triggered.** `qX` is `if (!installPath.includes(" "))
  return installPath` — the `claude-hostloop-plugins/<hash>` symlink exists
  *only* to launder install paths **containing spaces** past an unquoted
  `${CLAUDE_PLUGIN_ROOT}` in a hook command. A space-free install path
  resolves to the **real host install path** even under host-loop. Desktop
  plugins live under `~/Library/Application Support/…` (has a space), so the
  hash path is what you normally see.
- **The value is stable, not per-invocation.** The staged dir is a
  deterministic pure function of the install path —
  `sha256(installPath).slice(0,16)`, no session id / timestamp / randomness —
  idempotent and mutex-guarded, so it is identical across invocations,
  sessions, and reboots (it differs only if the symlink can't be created,
  when it falls back to the raw path).

(There is also a third, minor substitution site: the agent injects
`CLAUDE_PLUGIN_ROOT` into an MCP server's `headersHelper` exec env, but only
when that server is plugin-owned.)

**Host-loop mechanics live-confirmed** (2026-07-07, via `docs/internal/cowork-pluginroot-probe`
uploaded through the Cowork app UI): a real session echoed
`CONTENT_PLUGIN_ROOT=…/T/claude-hostloop-plugins/aa86f0206322553f`; on the host,
`readlink` of that path pointed at the plugin's install dir under
`…/local-agent-mode-sessions/<acc>/<org>/rpm/plugin_<ULID>`, and
`printf '%s' "$installPath" | shasum -a 256 | cut -c1-16` reproduced the basename
**exactly** — and two *separate* sessions yielded the **same** hash, confirming the
deterministic, session-independent staging live. An **uploaded** plugin lands under host
`rpm/plugin_<ULID>` and mounts in-VM as `.remote-plugins/plugin_<ULID>` (org-remote class,
ULID-keyed), while a marketplace install mounts as `.local-plugins/cache/<mp>/<plugin>/<ver>`.
**VM-loop** resolution remains **static-derived from the branch** (a live VM-loop run needs a
locked-down org or the `forceDisableHostLoop` Dev-Menu toggle).

## PreToolUse is a second, independent enforcement point

PreToolUse hooks fire on **every** tool call, including tools already
pre-approved via `--allowedTools`. They are not downstream of the
permission decision — `canUseTool()` is not the only choke point. A
PreToolUse hook's `deny` **bypasses `canUseTool` entirely**: it surfaces
to the model as an `is_error` tool_result carrying the hook's reason, not
as a `can_use_tool`/`permission_denied` control event, and the run-level
result still returns `subtype:"success"` — only that one tool call fails.
Live-verified: an `--allowedTools`-pre-approved `Read` still emits
`hook_callback` on every call, with zero `can_use_tool` frames anywhere
in the transcript.

Every hook's input is built by one shared constructor with base fields
`session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`,
`agent_id`, `agent_type`, `effort:{level}` (present only for
effort-capable models); PreToolUse/PostToolUse add `hook_event_name`,
`tool_name`, `tool_input`, `tool_use_id`. Delivery is classic stdin JSON
for `settings.json` hooks, or `control_request{subtype:"hook_callback",
callback_id, input, tool_use_id}` for SDK/headless/Cowork hosts — where
`tool_use_id` is also a top-level sibling of `input`, not only nested
inside it.

## Frontmatter shadow validator (skills/agents/output-styles)

There is **no formal primary schema** for skill/agent/output-style
frontmatter — the primary loader is imperative field extraction that
silently ignores unknown keys and coerces most type mismatches. A
separate Zod-based **shadow validator** runs after YAML parse, purely for
observability: it `.strict().safeParse()`s the frontmatter against one of
three schemas (`skill`, `agent`, `output-style` — custom slash commands
are validated against the skill schema, a superset, so skill-only fields
on a command never shadow-fail), and on failure fires
`tengu_frontmatter_shadow_unknown_key` or `tengu_frontmatter_shadow_mismatch`
telemetry, deduplicated per session so N skills sharing one drift pattern
fire once, not N times. It **fails open** — a validator exception is
swallowed and never blocks loading. This is groundwork for a possible
future strict mode: today's unknown-key telemetry is the signal Anthropic
would use to decide what to promote to a documented alias versus reject
outright. Not covered: `plugin.json`, `mcp.json`, `settings.json`, memory
files — each has its own dedicated, non-shadow parser.

## `activeSkill` scope & attribution (internal, not in the stream)

When a `Skill` tool runs, the agent sets `options.activeSkill` to the
invoked skill. For an **inline** skill this is **sticky, most-recent-wins,
no-pop** — it stays set until the next `Skill` call replaces it (there is no
"skill exited" signal). For a **fork** skill (`context: fork`), the body runs
in a forked sub-agent and the previous `activeSkill` is **restored** in a
`finally`. Sub-agent dispatches inherit it via
`spawnedBySkill: options.spawnedBySkill ?? options.activeSkill`, and a
recursion guard (`tengu_skill_tool_fork_recursion`) blocks a fork sub-agent
re-invoking its own skill.

This scope is threaded onto every **outbound API request** as
`attribution: c$(querySource, spawnedBySkill, activeSkill, activeMcpServer,
activeMcpTool)` — but it is **absent from the local stream-json output**, whose
only per-tool metadata (`tool_use_meta`) is display-only. So no exact tool→skill
attribution exists in the stream; **fork**-skill inner tools are the exception
(they carry `parent_tool_use_id` = the `Skill` id, so they're exactly
attributable — and are currently *undercounted* in `toolCounts` because a `Skill`
call isn't registered like an `Agent`/`Task` dispatch). See Ch32/L118.

## CLI-plugin credential broker

A plugin's `plugin.json` can declare a top-level `clis` object naming CLI
tools it ships, each with an `env` map of secrets the user enters once
under Customize → Plugins. This is the intended way to give an in-VM
Cowork CLI a credential without re-supplying it every session — but the
whole pipeline (UI field, encrypted storage, invocation-time injection)
is dark-launched behind a gate that is off by default for the standard
client. Full mechanism, gate ID, and the two independent gate checks
(renderer + runtime): `credential-channels.md`.

## Skill/plugin discovery tools — what the Cowork model actually sees (L129/L131)

Two distinct components share the "skill discovery" concept:

- **Native agent tools** (`ListSkills`/`SearchSkills`/`SuggestSkills`, + plugin
  twins), compiled into the CLI binary, gated by `vLt` (2.1.217) / `Vne`
  (2.1.215) over `CLAUDE_CODE_REMOTE` + the `ekl` entrypoint set + feature
  `tengu_saddle_lantern`. These are **never rendered in real Cowork** — verified
  absent from the `system/init` `tools` array of 10+ real sessions (agent
  2.1.165–2.1.209).
- **Desktop SDK-MCP tools** (`mcp__skills__list_skills`/`suggest_skills`,
  `mcp__plugins__*`), delivered over the control protocol
  (`sdkMcpServers`/`mcp_message`). These **are** what the model sees — present
  in every real session's `init.tools`. Gated by `suggestSkillsEnabled`
  (`245679952`, on/force); the NEW `proactiveSkillSuggestEnabled` (`1598976391`,
  off/default) adds an inert proactive-`trigger` mode. `suggest_skills` is
  advisory/zero-side-effect.

**Rule: read the `system/init` `tools` array to know a Cowork model's tool
surface — never the model's self-description (it confabulates tool names).**
`tengu_saddle_lantern` is a master switch, not just a deferral gate: one cached
read drives the native family's enable branch, `SuggestSkills.shouldDefer`, and
a branching prompt body.

## Bundled skills & MCP-contributed skills (L131)

Desktop ships **bundled skills** at `resources/bundled-skills` under a
`bundled:` scheme; the set is `{schedule, setup-cowork}` as of 1.24012.1
(`morning` was removed this release, gate `3214976288` gone). MCP-contributed
skills (`getMcpSkillSources`, gate `278625510`, extension
`io.modelcontextprotocol/skills`) are **dead code** today: one occurrence, zero
callers, gate absent from fcache, and the boot MCP handshake advertises only
`io.modelcontextprotocol/ui`. Tripwire: `getMcpSkillSources` occurrence count
rising above 1. Full trace: `references/34-skill-discovery-vcs-events-
containment.md` (Chapter 37, L129/L131).
