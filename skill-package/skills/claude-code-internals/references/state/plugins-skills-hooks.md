---
domain: plugins-skills-hooks
title: Plugins, skills & hooks (current)
as_of_cli: 2.1.198
as_of_desktop: 1.18286.0
sources: [5, 88, 89, 106, 109, 118]
updated: 2026-07-05
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

## `${CLAUDE_PLUGIN_ROOT}` resolves host-side everywhere

`${CLAUDE_PLUGIN_ROOT}` resolves to **one value** — the host-side
`claude-hostloop-plugins/<hash>` staging path — in both skill content and
hook invocations. That value is:

- **accepted** by host-side `Read`/`Edit`/`Glob`/`Grep` (they want a host
  path — keep the token literal for those consumers), but
- **useless to in-VM bash** (`mcp__workspace__bash`), which cannot see
  that host path at all.

A plugin script invoked through the VM shell must instead use the
VM-mounted plugin path, discovered at runtime rather than via the token:
`/sessions/<id>/mnt/.local-plugins/cache/<mp>/<plugin>/<version>` for
marketplace installs, or
`/sessions/<id>/mnt/.remote-plugins/plugin_<id>/…` for org-remote
installs. There is no single rule that works for both consumers — pick
the resolution path per where the reference is used.

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
