---
domain: plugins-skills-hooks
title: Plugins, skills & hooks (current)
as_of_cli: 2.1.231
as_of_desktop: 2.7032.0
sources: [5, 88, 89, 106, 109, 118, 123, 124, 129, 131, 147, 155, 181, 183, 187, 188, 194, 197, 199, 200, 201, 202, 203, 204, 205, 206, 207]
updated: 2026-09-23
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

## The MCP server name `memory` is taken in Cowork (L194)

From Desktop 2.2553.1 the Cowork spawn installs an in-process SDK-MCP
server named **`memory`** that relays to the user's cloud memory
(`/v2/ccr-sessions/-/memory/mcp`; tools `memory_read`, `memory_list`,
`memory_write`, `memory_str_replace`, `memory_append`, `memory_delete`).
It is on when gate `946844604` is on (force-ON at the 2026-09-23
capture), the account is first-party and not HIPAA-restricted. When it is
on, a server configured under the same name (e.g. `mcpServers.memory` in
`claude_desktop_config.json`) is **replaced** (only a Desktop-log warning)
and `memory` is added to `deniedMcpServers`. A **plugin**-declared server
named `memory` is **not** affected: plugin servers reach the agent via
`--plugin-dir` and are keyed `plugin:<plugin>:<server>`, and the deny
matcher compares the exact key. The deny entry blocks only a non-SDK
server loaded under the plain key `memory` (`.mcp.json`, `--mcp-config`). Read and list are always pre-approved; all six when the
session has a live memory project binding, and a write still needs a
verified binding that admits writes at call time. Its
guidance is appended to the main and sub-agent prompts, with
`CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT=1` set so the sub-agent
append takes effect. Observed: 30 of 31 recent Cowork runs on one machine
(nearly all one scheduled task) were offered `mcp__memory__memory_list`/
`_read` and no write tool; none called a memory tool.

## Skills in a user's folder (L197)

**Local Cowork:** a connected folder's `.claude/skills` is not loaded as far as
the code shows — the local spawn passes `settingSources:["user"]`, and project
skills load only with `projectSettings` (agent symbols matched by shape).
Ship skills in a plugin.

**Cloud Cowork with a granted local folder** (from Desktop 1.44121.1): the
Desktop scans `<folder>/.claude/skills/*/SKILL.md` and uploads them to
`/mnt/user-data/uploads/cowork-folders/<slug>-<hash>/.claude/skills/`. Mode gate
`2877254163` is **`"stubs"`** at the 2026-09-23 capture: only the frontmatter
survives, and the body becomes a notice to run the skill on the device via
`device_bash`. Limits: 100 skills per folder (the only one surfaced, via
`onFolderSkillsCapped`), `SKILL.md` ≤ 1 MiB, frontmatter ≤ 8 KiB with no
control characters, 32 MiB per folder (that skill and all after it skipped);
`full` mode also drops a whole skill over 4 MiB per asset or 64 files. Blocked
by managed `strictPluginOnlyCustomization` (`true` or including `"skills"`),
failing closed. From 2.7032.0 the folder's `.claude/CLAUDE.md` and
`.claude/rules/**/*.md` are staged too (gate `4018447017`).

## Plugin MCP servers in Cowork (L199)

With no MCP policy, a plugin's **local stdio** MCP server gets its real tools in
local Cowork: the Desktop's `LocalMcpServerManager` runs it host-side and
`localMcpBridge` announces it (observed: `plugin:pdf-viewer:pdf`, through Desktop
2.7032.0). A server is replaced by `createSdkMcpServer({name, tools:[]})` — zero
tools, keyed `plugin:<p>:<s>`, delivered in the SDK map (and, while the gate is
on, in `cowork-plugin-mcp-shadow.json`) — when (a) an MCP
policy applies to a local or `.mcpb` server, or (b) gate `2529235968` is on for a
**remote** (http/sse) server: every remote server in 1.37937.0–1.46388.x, only
one a claude.ai connector (or 3p direct server) already provides from 2.2553.1 —
observed daily from 2026-09-15 ("Replacing plugin … already provides it (matched
by url)" for Slack, Notion, Airtable). Unreplaced remote servers are opened by the
agent itself.


With the 3p managed setting `allowedPluginMcpServers` set (Desktop ≥ 2.2553.0),
no plugin server is bridged or started locally and only remote servers matching
its `{serverUrl}` patterns connect (L207).

In Cowork a claude.ai connector's tools are named `mcp__<org MCP-server uuid>__<tool>`
(differed between two organisations observed, e.g. Slack `mcp__a34d41f6-…__slack_add_reaction`),
not after the service; a replaced plugin server's `mcp__plugin_<p>_<s>__…` names vanish. Skills must
not hard-code either (L199).

## `--plugin-dir` beats the installed copy (L200)

An enabled `--plugin-dir` copy replaces the installed plugin with the **same
exact (case-sensitive) manifest name**, whole plugin, with only a debug-log line
("overrides installed version"). The installed copy wins when the inline copy is
disabled, managed settings lock the name (reported in `plugin_errors`),
`disableSideloadFlags` is set, or the path/name differ. Cowork passes every plugin
as `--plugin-dir` (0 marketplace sources in 3,020 `system/init` records across 916
sessions; 374 records list a plugin twice). Check `init.plugins[].path`, not `source`.

## Skill-list budget (L201)

Budget = context window × chars-per-token (4 for models up to Opus/Sonnet 4.6 and
Haiku 4.5, **3 for newer**) × `skillListingBudgetFraction` (0.01) — about
**30,000** display-width characters on current first-party models (1M context),
6,000 with 1M disabled, 8,000 on Haiku 4.5; `SLASH_COMMAND_TOOL_CHAR_BUDGET` overrides. Over
budget, bundled and name-only skills keep full entries; the rest are ranked by
`usageCount × max(0.5^(days/7), 0.1)` (`skillUsage` in `~/.claude.json`) and packed
first-fit; losers are listed by name only. Per-description cap
`skillListingMaxDescChars` (1,536).

## Hooks for cloud sessions, and hook visibility (L202, L203)

`claude --cloud` can forward the user's hooks to a cloud session and run them
locally (forwarding from 2.1.237). Hook field `cloud` (internal, agent ≥ 2.1.246): omitted = offer only a
hash-pinnable script outside the session's writable reach; `"skip"` = never;
`"device"` = offer anyway, so a session-written script or helper can run here.
Needs per-machine consent in `/hooks`; a pinned script changed after
registration is refused. Account flags `tengu_violin_wood` (master) + `_amati`
(wood off for the capturing account). Separately, stream hook frames are emitted only for
`SessionStart`/`Setup` unless `--include-hook-events` or `CLAUDE_CODE_REMOTE`;
Desktop never sets the former, so local Cowork records show only `SessionStart`
hooks (20,106/20,106 in one machine's audit logs; that others ran unseen is
code-derived).

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

## How a skill reaches its own bundled scripts (the practical question)

Answer first; mechanism in the sections that follow.

| you are | use |
|---|---|
| reading a bundled file with a **file tool** | `${CLAUDE_SKILL_DIR}/…` (a skill) or `${CLAUDE_PLUGIN_ROOT}/…` (plugin-wide), written in the **SKILL.md or command body** — substituted at load, so the model sees a real path |
| running a bundled script from the **shell** | a **launcher in the plugin's `bin/`**, called as a **bare command** |
| the launcher is absent | **discover** the directory shell-side and confirm with a sentinel file |
| any shell context | **never** read `$CLAUDE_SKILL_DIR` or `$CLAUDE_PLUGIN_ROOT` |

**`${CLAUDE_SKILL_DIR}` carries exactly the same three limits as `${CLAUDE_PLUGIN_ROOT}`**, and is the token a skill author reaches for first, so state them together. First-party in CLI 2.1.250, every substitution site is a literal `.replace(/\$\{CLAUDE_SKILL_DIR\}/g, …)` / `.replaceAll("${CLAUDE_SKILL_DIR}", …)`:

1. **Substitution, not environment.** It is replaced into text at load. It is never exported, so in a shell it expands to the empty string — a command built from it silently addresses `/scripts/tool.py` at the filesystem root.
2. **Braced form only.** `${CLAUDE_SKILL_DIR}`. `$CLAUDE_SKILL_DIR` is not a pattern any site matches and passes through untouched.
3. **Definition text only, and only when the skill owns a directory.** The sites are `getPromptForCommand`'s body text and the `allowed-tools` frontmatter, both gated on a resolved skill root (`isSkillMode` / a non-null `baseDir`). A `references/*.md` your skill **reads at run time** is not definition text: the token arrives literally. Where no base directory is attached, it passes through unsubstituted.

The same load-time pass also substitutes `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}` and `${CLAUDE_EFFORT}`, and prepends `Base directory for this skill: <abs path>` — which is why a skill's own root is legible to the model in body text and to nothing else.

**Commands are excluded too, and that is the easy one to get wrong.** Both replacement sites live in
the `bz` builder guarded on `g.isSkillMode` (default **false**); the two command load sites pass it
explicitly false, skills pass true. So the token arrives literally in a `commands/*.md` exactly as it
does in a reference file. The trap is that the next statement substitutes `${CLAUDE_SESSION_ID}` and
`${CLAUDE_EFFORT}` *outside* that guard — so commands **are** a substituting definition surface, just
not for this token. "Does substitution happen in commands?" answers yes and misleads.

**Observed, not only read.** A peer harness run (container fidelity) put the same token in a skill's
`SKILL.md` and in its `references/paths.md`; the delivered content carried the body line substituted
to an absolute mount path and the reference line untouched. Read from the event stream rather than the
model's answer, which rules out the model expanding it from a path it had already seen.

**The operative rule, stated once:** `${CLAUDE_SKILL_DIR}` is a **SKILL.md-body-text feature**. The moment a path must reach a shell it has to be an absolute path the model already resolved and passes explicitly, or a `bin/` launcher that locates itself from `$0`.

**Why `bin/` is the answer and not a workaround (L173).** Claude Code puts every enabled non-builtin plugin's `<plugin>/bin` on the Bash tool's PATH, and the path is correct for the namespace of the shell that will use it — measured in all three lanes, including Cowork host-loop where the file tools and the shell disagree about every other path. PATH lookup is performed by the shell, in the shell's own namespace, so **no path crosses the boundary and the model derives nothing**. A launcher self-locates in one line:

```bash
#!/usr/bin/env bash
exec python3 "$(cd "$(dirname "$0")/.." && pwd)/scripts/$1.py" "${@:2}"
```

**Why not `$CLAUDE_PLUGIN_ROOT` in a shell.** It is not merely absent — it is frequently **set, to an unrelated plugin's directory**. Hooks can write session environment through `CLAUDE_ENV_FILE` (four events; the loader concatenates their scripts in a fixed order, so the last `export` wins textually and reproducibly), and the hook executor gives each hook *its own* plugin's root. A leaked pair was observed this way, neither being the plugin whose skill was running (one machine; not independently replicated). The failure mode is a **confident wrong answer**, which is worse than an empty one.

**Why not the token in a `references/*.md`.** Substitution happens in the files the runtime **loads** as definitions — a SKILL.md body, a command, a hook. A reference file your skill **reads at run time** is not substituted: the token arrives literally and names nothing.

**Three ways `bin/` fails, all silent.** A PATH entry is **not** evidence the directory exists: the PATH builder performs no existence check, mapping `<path>/bin` for every enabled non-builtin plugin unconditionally, so a count of entries is a fact about the plugin count and says nothing about what is on disk (35 entries on one machine, zero directories). A `bin/` committed in plugin source **does** survive installation; install narrows the mode but the execute bit survives. The Cowork mount is **read-only**, so a launcher cannot write beside itself. And a plugin path containing shell metacharacters is dropped from PATH with no model-visible error. So: **construct, verify, fall back** — and have the step that cannot resolve stop and say so, because a resolution that fails quietly is indistinguishable from a feature that was never shipped.

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

## The hook-event array: 31 at CLI 2.1.231, 33 at agent 2.1.260 (L155, L188)

> **Current count: 33.** `PreModelSwitch` and `PostModelSwitch` were added at CLI **2.1.251**
> (announced) and inserted **mid-array**, between `PostCompact` and `PermissionRequest`, so
> **`MessageDisplay` is the 33rd entry**, not the 31st. Any "all 30" phrasing predates 2.1.219;
> any "all 31" phrasing predates 2.1.251.

The master hook-event array carries **31** entries as of CLI **2.1.231**. It was 30
through v2.1.217; `DirectoryAdded` was inserted (announced 2.1.219) between
`FileChanged` and `MessageDisplay`, so `MessageDisplay` is now the 31st entry rather
than the 30th. Any "all 30 hook events" phrasing predates 2.1.219.

`DirectoryAdded` fires after `/add-dir` or the SDK `register_repo_root` control request
registers a new working directory, **after** the sandbox configuration has been refreshed
— so sandboxed tools and permission state already see the directory, while the hook
command itself runs unsandboxed. Two things an author will otherwise get wrong:

- **The `matcher` matches `source`, not a path.** `matcherMetadata.fieldToMatch` is
  `"source"`, values `slash_command` | `register_repo_root`. A path-shaped matcher never
  fires. The input is `{directory (absolute), source}`.
- **Hook output only reaches the model on one of the two paths.** Via `/add-dir`, a
  failure count is summarised to Claude and `systemMessage` output arrives as bounded
  context (`mode:"task-notification"`, `isMeta`). Via `register_repo_root`, everything is
  debug-logged only — the same hook is silent to the model.

A directory that is already registered (including a duplicate request) is denied with an
error, and the registration pipeline and `DirectoryAdded` hooks **do not re-run**.

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

## Elicitation is the sanctioned skill-argument channel (L147)

Desktop injects a standing instruction into **every skill invocation**
directing the model to collect missing arguments through the elicitation
form (`credential-channels.md`'s channel 1), not `AskUserQuestion`. This
is gated by `286376943` (`imagineElicitationEnabled`), **force-ON** in the
2026-08-13 fcache — live behavior on this account, not dormant surface.

Delivery is two hook events converging on one resolver:

- The **`Skill` tool's `PreToolUse` hook**, as `additionalContext` — this
  is what that hook's payload (described only as
  `[...telemetry+additionalContext...]` in the control-protocol page) IS.
  **Excludes sub-agents** (`!e.agent_id`): a skill invoked from inside a
  dispatched sub-agent does not get the injection.
- **`UserPromptSubmit`**, when the user types a `/slashcommand` — a
  structurally different call site delivering the same content.

The message tells the model to call the elicitation form's `read_me`
(`modules:["elicitation"]`) then `show_widget`, to prefer inferring
context from the conversation over asking, and that **answers return as
bullet points in the model's next user-turn message, not as a tool
result** — a skill author scripting or asserting against this flow needs
to read the following user message, not a `tool_result` block. The
`argument-hint` frontmatter field is surfaced verbatim when present; a
skill that omits it gets an explicit "infer from SKILL.md" fallback,
added at Desktop 1.25927.0 (the message body itself is otherwise
byte-stable back to the oldest locally-held asar, 1.18286.2 — this is a
standing gap in prior coverage, not a new feature in this release).

**Byproduct: a Desktop-side, turn-scoped skill scope.** The injector sets
`activeSkillThisTurn = {name, argumentHint}` on the session, cleared at
each new user message, `finishTurnCleanup`, and CU-lock release. This is
the Desktop-side counterpart to this page's `activeSkill` (below), and it
behaves **oppositely**: `activeSkill` is sticky/no-pop, `activeSkillThisTurn`
is per-turn and explicitly reset. Two skill scopes with the same name and
opposite lifetimes — treat them as distinct.

## `save_skill` / `canSaveSkill` (L206)

Gate `3246569822` no longer governs it: it has been absent from Desktop code
since 1.44121.1 (still served, unread). In 2.7032.0 `canSaveSkill` =
org skill creation allowed — not `workspace.skillCreationEnabled:false` (3p
managed setting), not HIPAA-restricted, and `skill_creation` not blocked in the
account's **access list** — AND skills enabled with the org-skills-off check
(gate `3656976882`, off) not tripped; sticky per built system prompt/model.
There is **no account-type check**; the "1p-only" resolver `us()` previously
quoted here belongs to `/setup-writing-style`. The access list is
`GET <claude.ai>/api/bootstrap/<org>/current_user_access` → `{features:[{feature,status}]}`,
refreshed hourly, memory-only — a server-side switch channel outside the fcache
(also covers `skills`, `claude_code_remote_control`, `claude_code_routines`,
`claude_code_web`, `cowork_browser_pane`, …). On the capturing machine
`save_skill` first appeared 2026-07-25 with Desktop 1.24012.9. `save_skill`'s
own description states its effect: the skill description "enters the system
prompt of every future session".

## Forked skills are relayed, not passed through (L204)

A `context: fork` skill's tool result is `Skill "<name>" completed (forked
execution).` + `Result:` + the fork's **last** assistant message; the main
model then writes its own answer. Measured (129 relayed runs, CLI 2.1.280): a
Sonnet 5 main model passed the fork's link 0/51 times; a parent-addressed note
raised it to 6/9 but 2 runs flagged it as prompt injection; Opus 5.5 kept the
link 24/27 and dropped `?ref=` in 23. Inline skills have no relay step.

## Two input channels (L205)

The "collect input with a form" instruction (gate `286376943`) and the
`visualize` server that provides the form (`mcp__visualize__read_me` /
`show_widget`, gate `3444158716`) are independent; AskUserQuestion stays
available and the model chooses — 31 form / 27 AskUserQuestion / 13 both in
71 sessions that asked anything. The instruction is invisible in `audit.jsonl`.

## Server attribution reaches the agent by a computed env key (L181)

Desktop describes sync-managed skills and remote plugins to the agent through two env vars whose
names are **computed properties**, so they do not appear beside their values:

```js
let $e=o.n(Ge); $e&&(K.env={...K.env,[o.t]:$e});   // CLAUDE_CODE_SKILL_ATTRIBUTION
let J=await Ie;  J&&(K.env={...K.env,[s.t]:J});     // CLAUDE_CODE_PLUGIN_ATTRIBUTION
```

Set on **both** the Cowork local-agent and the CCD spawn path.

- `CLAUDE_CODE_SKILL_ATTRIBUTION` — `{ <path>: { skill_id, server_plugin_id? } }`, built **only** for
  `creatorType === "user" && syncManaged !== false` skills with ids matching
  `skill_(staging_|local_)?…`. Desktop **drops the whole payload past 98,304 bytes**
  (`[SkillsPlugin] … omitted: N skills exceed its 98304-byte cap`); the agent accepts up to 262,144,
  so Desktop is the stricter half and a large enough skill set silently loses all attribution.
- `CLAUDE_CODE_PLUGIN_ATTRIBUTION` — the same for `source === "remote"` plugins, carrying
  `server_plugin_id`, `marketplace_name`, `installation_preference`.

Agent-side both are **telemetry-only**: parsed into a `path → {skillId, pluginId}` lookup, attached
to each loaded skill as `serverAttribution`, and read only by a property-bag builder whose call sites
are all `tengu_*` emits. Their other reader is the child-process env-scrub allowlist, which deletes
them. Setting either by hand changes telemetry attribution and nothing the model sees.

## Hooks as function modules — `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` (L183)

A second hook-authoring surface exists in agent 2.1.260 and is **off by default**: plugin hooks
written as JavaScript **function modules** rather than shell commands (`hooks/register.ts`,
`builtin-hooks-module:`). Resolution is
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS ?? GrowthBook("tengu_plugin_hooks_modules") ?? false` — the env
var wins outright. A reference linter rejects a hook function that is "bound to a name", "assigned",
"returned", "put in an object", "put in an array", "optionally chained", or "put in a template". The
Cowork spawn does not set it. Nothing here changes the shell-command hook contract documented above.

**The module contract (L187).** `hooks/register.ts` exporting `export function register(on, options)`;
registration is `on("<event>", hook)` or `on("<event>", matcher, hook)`. The event name **must be a string
literal** and must be `"*"` or a recognised event. A static analyser (`ScanRefusal`) permits `on` to be
**called and nothing else** — binding it to a name, assigning, spreading, returning, putting it in an object
or array, optional-chaining or interpolating it are all refused, so the hook graph is statically enumerable
without running the module. Built-ins use `builtin:<name>/hooks/register.ts`, resolved by an esbuild plugin
that bundles via a spawned subprocess. **Whether a function hook can override a Desktop-injected forced ask
(see cowork-permissions) is NOT traced** — establish it before enabling this on a Cowork-adjacent surface.

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
  absent from the `system/init` `tools` array of **all 427 real sessions**
  (1678 `init` records, agent 2.1.64–2.1.217; zero occurrences).
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

### Complete rendered surface — 13 tools / 5 servers (as of asar 1.24012.1, agent 2.1.217)

Verified against all 427 `audit.jsonl` files (1678 `init` records, agent
2.1.64 → 2.1.217). Model-visible names are `mcp__<serverName>__<toolName>`.

| Server | `isEnabled` | Tools |
|---|---|---|
| `skills` | `sessionType==="cowork" && skillsEnabled!==false` | `list_skills`, `suggest_skills` |
| `plugins` | `sessionType==="cowork" && pluginsEnabled!==false` | `list_plugins`, `search_plugins`, `suggest_plugin_install` |
| `mcp-registry` | `getDeploymentMode().type!=="3p"` | `list_connectors`, `search_mcp_registry`, `suggest_connectors` |
| `scheduled-tasks` | (registration in an unextracted chunk) | `create_`/`list_`/`update_`/`delete_scheduled_task` |
| `cowork-onboarding` | `sessionType==="cowork" && isFeatureEnabled("2114777685")` (force-ON) | `show_onboarding_role_picker` |

Server objects are `{serverName, tools, handleToolCall, isEnabled,
getDynamicTools?}` in array `si`, filtered by `oi(model, suggestSkillsEnabled,
sessionType, proactiveSkillSuggestEnabled)`, managed by
`InternalMcpServerManager`. **9 of the 13 are in `allowedTools`** — the 3
mutating `scheduled-tasks` tools and `show_onboarding_role_picker` are
deliberately left to a permission prompt (see Chapter 37 L131 addendum).

Drift: 7 tools at 2.1.64–2.1.87 → 8 (2.1.92) → 10 (2.1.111) → 11 (2.1.121) →
12 (2.1.128, `suggest_skills`) → 13 (2.1.205, `delete_scheduled_task`).
**Do not model `suggest_skills` presence as version-keyed** — it is gate-driven,
and the corpus shows zero within-version splits, so it cannot validate a
version boundary.

### `when_to_use` does not reach the Cowork listing

A skill's `when_to_use` frontmatter is documented CLI-side as *"Guidance for when the model
should reach for this skill. **Becomes part of the tool description**"* (schema, CLI 2.1.250),
mapped as `whenToUse: H.when_to_use != null ? String(H.when_to_use) : void 0` (Ch19/L88).

**It has no counterpart on the Desktop side.** In `app.asar` **1.40609.0**, `whenToUse` and
`when_to_use` occur **zero** times, against positive controls `list_skills` (17) and
`suggest_skills` (14) in the same file. The Desktop's `mcp__skills__list_skills` handler
therefore cannot surface the field — it has no code that reads it.

Consequence for skill authors: under Cowork a skill is advertised through a listing that
carries `name`/`description` and not `when_to_use`, so **trigger information placed only in
`when_to_use` is invisible on that path**. Keep `description` self-sufficient and treat
`when_to_use` as reinforcement for the CLI surface, never as the sole carrier of a trigger.
Non-Claude hosts ignore the field entirely, so the same rule serves portability.

Scope: one asar version (1.40609.0, the newest held here); not checked against older builds,
and the agent-side rendering path was not re-traced this pass.

### `paths:` silently suppresses a skill

Sibling field, same schema, and the more dangerous of the two because it *removes* a skill
rather than failing to promote it:

```
paths: "Glob patterns this skill applies to. The skill only loads when the model touches matching files."
```

A skill carrying `paths:` does not load for a question that touches no matching file — a
mechanics question, a "how do I…", anything conversational. There is no message. When a skill
does not trigger, check `paths:` **before** rewriting the description: a narrowing set there
cannot be fixed by better prose.

**The three frontmatter fields that decide whether a skill is reachable at all**, in the order
worth checking: `paths:` (loads only on matching files), `disable-model-invocation` (the model
is told to ask the user to run it instead), and `description`/`when_to_use` (what selection is
judged on). Only `description` reaches every host and both Cowork listings.

### Input schemas (verbatim, 1.24012.1)

All `type:"object"`. Required fields in **bold**; everything else optional.

| Tool | Properties |
|---|---|
| `list_skills` | `skill_names: string[]`, `keywords: string[]` (ignored if `skill_names` set), `context_label: string` — `required:[]` |
| `suggest_skills` | `keywords: string[]`, `context_label: string` — `required:[]`; **no `trigger` in the base state** |
| `list_plugins` | `keywords: string[]` (the filter), `context_label: string` (display-only) — `required:[]` |
| `search_plugins` | **`userIntent: string`** (verbatim/lightly paraphrased, *not* pre-tokenized), `keywords: string[]`, `includeInstalled: boolean`, `trigger` (ungated here) |
| `suggest_plugin_install` | **`contextLabel: string`** (3–5 words), **`plugins: object[]`** each **`pluginName`**/**`pluginId`**/**`description`** + `backendId`, `skills:[{**name**, description}]` |
| `search_mcp_registry` | `keywords: string[]` |
| `suggest_connectors` | **`uuids: string[]`** (directoryUuid, or the UUID portion of `mcp__{uuid}__{tool}`), `keywords: string[]` (single lowercase noun, brand-stripped) |
| `list_connectors` | `keywords: string[]` — `required:[]` |
| `show_onboarding_role_picker` | `role: string`, `dismissed: boolean` — both *"Populated by the permission flow… Do not set this yourself"*; call with no args |

`trigger` is the shared constant `Lr = {type:"string",
enum:["user_asked","proactive"], …}`, normalized by `Ur()` (non-matching →
`undefined`).

### `suggest_skills` has three states (literal branches in `oi`)

`if(serverName===kt){ if(!suggestSkillsEnabled) return Zo(); if(proactive) return ti(); }` → else base `we`.

| State | Gates | Shape |
|---|---|---|
| **absent** | `245679952` off | `Zo()` filters `suggest_skills` out **and** rewrites `list_skills`'s description (strips `" — fall back to suggest_skills"`) |
| **base** (live default) | `245679952` on, `1598976391` off | `we` — no `trigger` property |
| **proactive** | both on | `ti()` swaps description → `ei` and injects `trigger: Lr`; `required` stays `[]` |

Gate evaluation is a **conjunction**: `1598976391` is only read when the first
gate passed. Stickiness is keyed to the built-system-prompt cache via
`ft(r,e) = r?.builtSystemPrompt!==undefined && (e===undefined ||
r.builtSystemPromptModel===e)` — so **a mid-session model switch invalidates it
and re-reads the gates**, and the sticky-branch fallback is `?? false`, *not*
the gate value.

### Output envelopes

Standard MCP `{content:[{type:"text", text: JSON.stringify(inner)}]}`. Both
`skills` tools share one `handleToolCall`.

- `list_skills` inner: `resolved_skills` (from
  `resolveSlashMenuSkills(sessionId, skill_names, keywords)`),
  `installed_plugins` (plugin **name** strings; `[]` on parse failure),
  `context_label`, `request_skill_names`, `request_keywords`, `note` — 3 `note`
  variants (matched / no-match-but-plugins-exist / fully-empty, the last saying
  the widget did not render).
- `suggest_skills` inner: `resolved_skills` = `searchAddableSkills(sessionId,
  keywords)` filtered on truthy `name`, **`.slice(0,15)`**, mapped to
  `{name, description, skill_id, is_user_created}`; plus `context_label`,
  `trigger` (only when proactive), `note`.

The `.slice(0,15)` cap and the `note` wording are the fidelity-load-bearing
bits for anyone stubbing this surface.

## Bundled skills & MCP-contributed skills (L131)

Desktop ships **bundled skills** at `resources/bundled-skills` under a
`bundled:` scheme; the set is `{schedule, setup-cowork}` as of 1.24012.1
(`morning` was removed this release, gate `3214976288` gone). MCP-contributed
skills (`getMcpSkillSources`, gate `278625510`, extension
`io.modelcontextprotocol/skills`) are **dead code** today: one occurrence, zero
callers, still not present in the 2026-08-13 fcache re-decode (254 features, same
as the original capture), and the boot MCP handshake advertises only
`io.modelcontextprotocol/ui`. Tripwire: `getMcpSkillSources` occurrence count
rising above 1. Full trace: `references/34-skill-discovery-vcs-events-
containment.md` (Chapter 37, L129/L131).
