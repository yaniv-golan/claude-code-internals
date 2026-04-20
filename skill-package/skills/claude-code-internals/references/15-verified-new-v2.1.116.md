Updated: 2026-04-21 | Source: Binary extraction from claude v2.1.114/v2.1.116

# Chapter 18: Verified New in v2.1.114–v2.1.116 (Source-Confirmed)

> **Provenance:** Direct binary extraction and structured diffing of v2.1.114 and v2.1.116
> bundles against the v2.1.113 baseline. v2.1.114 produced **zero** additions or removals
> across env vars, slash commands, hook event types, and API beta strings (bugfix-only
> release; bundle size decreased by 5 bytes). v2.1.115 is not inspected directly but is
> bracketed by v2.1.114-no-op and v2.1.116-delta — everything in this chapter is best
> attributed to v2.1.116 unless noted.

> **Narrative for this chapter — v2.1.116 is enterprise plumbing + GB-flagged features.**
> Chapter 17 was a direction correction (Remote Workflow Commands sunset, daemon-mode
> groundwork). v2.1.116 picks up both enterprise auth/network plumbing *and* several
> flagged-off features whose wiring ships in this release:
>
> 1. **OIDC Federation auth.** A new `authentication.type: "oidc_federation"` mode lands
>    in one release: eight new `ANTHROPIC_*` env vars (`FEDERATION_RULE_ID`, `IDENTITY_TOKEN`,
>    `IDENTITY_TOKEN_FILE`, `ORGANIZATION_ID`, `SERVICE_ACCOUNT_ID`, `SCOPE`, `CONFIG_DIR`,
>    `PROFILE`), a new beta header `oidc-federation-2026-04-01`, and a credentials-file
>    path convention (`<config_dir>/configs/<profile>.json`) that sits alongside the
>    existing `user_oauth` flow. Target audience is corporate deployments where identity
>    tokens come from a cloud IdP (AWS STS, GCP Workload Identity, Azure Entra) rather
>    than an interactive login.
> 2. **Proxy plumbing polish.** Two Claude-Code-specific proxy overrides
>    (`CLAUDE_CODE_HTTP_PROXY`, `CLAUDE_CODE_HTTPS_PROXY`) join the existing `HTTP_PROXY` /
>    `HTTPS_PROXY` stack as **lowest-priority fallbacks** — not overrides. Useful for
>    opt-in proxy routing (Claude traffic goes through the corporate proxy, but `curl`
>    doesn't). The resolver propagates the detected proxy config to ~15 downstream
>    toolchains (npm, yarn, docker, Java via `JAVA_TOOL_OPTIONS`, gcloud, Electron, etc.)
>    for spawned child processes.
> 3. **`/model` goes non-interactive.** A second registration of `/model` adds
>    `supportsNonInteractive: true` + `argumentHint: "<model>"` without removing the
>    existing interactive menu. Scripting `claude -p "/model sonnet" "..."` now works.
> 4. **GB-flagged features arriving behind dark launches** (see "Feature Flags & Telemetry"
>    section below): tool-use isolation latches, parallel MCP connection, MCP
>    `resources/templates/list` capability, CCR post-turn summary, closed-issue
>    notifications, `--remote` attach CLI, `/remote-control` upsell toast, ULTRAPLAN
>    plan-ready surface. All ship wired-up but gated off — no functional change for users
>    whose flags resolve to default.
>
> Plus one smaller change: `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` is added as an alias for the
> existing `CLAUDE_CODE_SIMPLE` (slim-prompt debug mode).
>
> **What's NOT in v2.1.116:** no new hooks, no new skill/plugin protocol changes, no
> removed commands. The user-facing slash-command surface is unchanged except for the
> `/model` headless path and a dark-launched `/remote-control`.

---

## TABLE OF CONTENTS

86. [Lesson 86 -- v2.1.114–v2.1.116 OIDC Federation, Config Profiles, Proxy Plumbing, `/model` Headless](#lesson-86----v21114v21116-oidc-federation-config-profiles-proxy-plumbing-model-headless)

---

# LESSON 86 -- v2.1.114–v2.1.116 OIDC FEDERATION, CONFIG PROFILES, PROXY PLUMBING, `/model` HEADLESS

## OIDC Federation Auth

### What it is

A new enterprise authentication mode. Instead of the interactive `user_oauth` flow (browser
redirect, refresh token in `~/.claude/credentials.json`), the CLI accepts a pre-acquired
**identity token** from an external IdP and exchanges it at Anthropic's federation endpoint
for API credentials. The identity token can be inline, a file path (common for rotating
tokens), or loaded from a JSON config file.

The beta header `oidc-federation-2026-04-01` is attached when this mode is active.

### The two supported auth types

`pf_()` / config-loader recognizes exactly two `authentication.type` values:

| Type | How it authenticates | Source |
|---|---|---|
| `oidc_federation` | Exchange identity token → API credentials via federation rule | New in v2.1.116 |
| `user_oauth` | Interactive browser login, refresh token on disk | Pre-existing |

Any other `authentication.type` value throws `authentication.type "<T>" is not a known authentication type`.

### Two ways to configure OIDC federation

**Mode A: env-quad (fully env-driven)** — required env vars:

```
ANTHROPIC_FEDERATION_RULE_ID=<uuid>       # from Anthropic console
ANTHROPIC_ORGANIZATION_ID=<org-uuid>      # target org
ANTHROPIC_IDENTITY_TOKEN=<jwt>            # OR:
ANTHROPIC_IDENTITY_TOKEN_FILE=<path>      # rotating-token file
```

Optional:

```
ANTHROPIC_SERVICE_ACCOUNT_ID=<id>         # service account for the org
ANTHROPIC_SCOPE=<scope>                   # auth scope override
ANTHROPIC_BASE_URL=<url>                  # already existed; respected in this mode
```

`pf_()` resolves to `"env-quad"` when *any* of the four required vars is set (trimmed
non-empty). `Bf_()` — the config-status reporter — returns `"incomplete config (need
FEDERATION_RULE_ID + ORGANIZATION_ID)"` if the quad is partial, or
`"env-quad · org <…tail6> · rule <…tail6>"` if complete. The `su8()` helper masks all but
the last 6 characters of each ID.

**Mode B: credentials file (profile-based)** — a JSON config file at:

```
<config_dir>/configs/<profile>.json
```

Resolver chain:

- `<config_dir>` ← `ANTHROPIC_CONFIG_DIR` → else `$XDG_CONFIG_HOME/anthropic` → else `$HOME/.config/anthropic` → else null
- `<profile>` ← `ANTHROPIC_PROFILE` → else first-line of `<config_dir>/active_config` → else `"default"`

Full path helper (`KgK()`): `path.join(<config_dir>, "configs", "<profile>.json")`.

File format:

```json
{
  "organization_id": "...",
  "base_url": "https://...",
  "authentication": {
    "type": "oidc_federation",
    "federation_rule_id": "...",
    "service_account_id": "...",
    "identity_token": { "source": "file", "path": "/path/to/token" },
    "scope": "..."
  }
}
```

Missing fields fall back to env vars: `organization_id ??= ANTHROPIC_ORGANIZATION_ID`,
`base_url ??= ANTHROPIC_BASE_URL`, `authentication.scope ??= ANTHROPIC_SCOPE`,
`service_account_id ??= ANTHROPIC_SERVICE_ACCOUNT_ID`, identity token falls back to
`ANTHROPIC_IDENTITY_TOKEN_FILE`, and `federation_rule_id ??= ANTHROPIC_FEDERATION_RULE_ID`
(profile wins when both set — error messages note "profile takes precedence").

Mode B takes precedence over Mode A: `pf_()` returns `"credentials-file"` when the config
file exists and contains `authentication.type === "oidc_federation"`, and **only falls back
to `"env-quad"` if the file is absent or lacks a known auth type**. Presence of a config
file with an unknown `authentication.type` actively blocks the env-quad path (`pf_` returns
null), which is protective — it avoids a misconfigured file silently falling through to
environment-sourced credentials.

### Validation errors (verbatim from bundle)

Thrown by `UW4()` (the auth-mode dispatcher) when preconditions are missing:

- `oidc_federation config requires an identity token (set authentication.identity_token, ANTHROPIC_IDENTITY_TOKEN_FILE, or ANTHROPIC_IDENTITY_TOKEN)`
- `oidc_federation config requires 'federation_rule_id'. Set it in authentication.federation_rule_id in your profile, or via ANTHROPIC_FEDERATION_RULE_ID (profile takes precedence).`
- `oidc_federation config requires organization_id (set ANTHROPIC_ORGANIZATION_ID or config.organization_id)`
- `user_oauth config requires authentication.credentials_path (or load via a profile so it defaults to <config_dir>/credentials/<profile>.json)`

The last line confirms a parallel convention for `user_oauth` profiles:
`<config_dir>/credentials/<profile>.json` (note: `credentials/`, not `configs/`).

### Beta header

When OIDC federation is active, the request carries:

```
anthropic-beta: oidc-federation-2026-04-01
```

This is the only API beta string added in v2.1.116.

### Detection & inspection

`AS()` returns true when **any** auth mode is active (`pf_() !== null`). `Bf_()` produces
the human-readable status string used by the status UI and diagnostic commands.

## Config Directory & Profile Conventions

Three new env vars collectively let enterprise deployments use a single binary with
multiple concurrent configurations:

| Env var | Role | Resolver |
|---|---|---|
| `ANTHROPIC_CONFIG_DIR` | Override the config directory root | `Hm8()` |
| `ANTHROPIC_PROFILE` | Select which profile within the config dir | `eu8()` |
| (none) | Fallback when `ANTHROPIC_PROFILE` unset | Read `<config_dir>/active_config` |

Directory layout under `<config_dir>`:

```
<config_dir>/
  active_config              # contains the profile name (one line)
  configs/
    default.json             # OIDC federation / other server-side auth
    <profile>.json
  credentials/
    default.json             # user_oauth credential cache (pre-existing convention)
    <profile>.json
```

**Directory resolution precedence** (`Hm8()`):
1. `ANTHROPIC_CONFIG_DIR` if set/non-empty
2. `$XDG_CONFIG_HOME/anthropic`
3. `$HOME/.config/anthropic`
4. null (no config directory → env-quad only)

**Profile resolution precedence** (`eu8()`):
1. `ANTHROPIC_PROFILE` if set/non-empty
2. First line of `<config_dir>/active_config` if readable
3. Literal `"default"`

### Implication for shell users

`ANTHROPIC_PROFILE=prod claude` switches profile without editing any file. Write
`prod\n` to `<config_dir>/active_config` to make it sticky per-machine. The `active_config`
file is plain text (not JSON) and read as a trimmed string.

## Proxy Overrides

Two env vars added (`CLAUDE_CODE_HTTP_PROXY`, `CLAUDE_CODE_HTTPS_PROXY`). They are
**lowest-priority fallbacks** in the resolver `ZA9()`, not overrides:

```js
// Precedence (first match wins):
let http  = HTTP_PROXY  || http_proxy  || CLAUDE_CODE_HTTP_PROXY
let https = HTTPS_PROXY || https_proxy || CLAUDE_CODE_HTTPS_PROXY
let noProxy = NO_PROXY || no_proxy
```

Intended use: set `CLAUDE_CODE_HTTP_PROXY` when you want Claude Code to use a proxy but
your shell's `HTTP_PROXY` isn't set (or is set to something you don't want Claude Code to
use). The generic env vars still win if set, so this does **not** let you force-route
Claude Code around an existing shell proxy — only to opt-in when one isn't configured.

### Downstream propagation

When a proxy is resolved, `ZA9()` exports the following env vars into the child-process
environment (only if not already set by the parent):

```
YARN_HTTP_PROXY, YARN_HTTPS_PROXY
npm_config_proxy, npm_config_https_proxy, npm_config_noproxy
GLOBAL_AGENT_HTTP_PROXY, GLOBAL_AGENT_HTTPS_PROXY, GLOBAL_AGENT_NO_PROXY
ELECTRON_GET_USE_PROXY=1
DOCKER_HTTP_PROXY, DOCKER_HTTPS_PROXY
CLOUDSDK_PROXY_TYPE=http, CLOUDSDK_PROXY_ADDRESS, CLOUDSDK_PROXY_PORT,
  CLOUDSDK_PROXY_USERNAME, CLOUDSDK_PROXY_PASSWORD
FSSPEC_GCS='{"session_kwargs": {"trust_env": true}}'
JAVA_TOOL_OPTIONS=-Dhttp.proxyHost=... -Dhttp.proxyPort=... -Dhttps.proxyHost=... -Dhttps.proxyPort=... -Dhttp.nonProxyHosts=...
```

So a Bash tool call to `npm install`, `docker build`, or `mvn package` inherits the proxy
automatically. `JAVA_TOOL_OPTIONS` is appended only if it doesn't already contain
`-Dhttps.proxyHost=` (to avoid duplicating settings the user already configured).

The proxy env vars also appear in the spawned-process allowlist (the filter that
determines which env vars survive the sanitize step before exec), meaning
`CLAUDE_CODE_HTTP_PROXY` and `CLAUDE_CODE_HTTPS_PROXY` themselves are passed through to
children.

## `/model` Goes Non-Interactive

The `/model` slash command existed before v2.1.116, but only as an interactive menu
(reads current model from `hK()`, renders a selection UI). v2.1.116 adds a **second
registration** that sits alongside the existing one:

```js
{ name:"model",
  supportsNonInteractive: true,
  description: "Set the AI model for Claude Code",
  argumentHint: "<model>",
  load: () => Promise.resolve().then(() => (Ic7(), bc7)) }
```

The older interactive entry stays (it uses `get description()` for the dynamic label
including the current model name). In headless mode (`claude -p`) the non-interactive
registration is dispatched, consuming the positional argument as the model ID.

Practical result:

```bash
claude -p "/model sonnet" "Plan the migration"
# switches model to sonnet, then runs the follow-up prompt
```

This closes a gap where `--model` was only a launch flag — now the model can be set
mid-script within a single invocation.

## `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` (alias)

Added as an alias for the existing `CLAUDE_CODE_SIMPLE`. Both are checked by `$J8()`:

```js
function $J8(){return NH(process.env.CLAUDE_CODE_SIMPLE)||NH(process.env.CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT)}
```

When either is truthy, `TX()` (the system-prompt assembler) returns a skeletal prompt:

```
You are Claude Code, Anthropic's official CLI for Claude.

CWD: <cwd>
Date: <date>
```

…instead of the full prompt that would normally include anti-verbosity, thinking guidance,
session guidance, memory, env info, language, output style, scratchpad, brief mode,
focus mode, etc. (`K?.excludeDynamicSections` drops CWD and Date too.)

The new name is clearer about what the flag actually does. Both variants coexist — no
deprecation. Use the new one in new scripts.

## `CLAUDE_CODE_RETRY_WATCHDOG`

Enables a retry watchdog on API calls. **Strictly gated**: the watchdog only runs when

- `V6() === "linux"` (platform is Linux), **and**
- `process.env.CLAUDE_CODE_ENTRYPOINT === "remote"` (launched via remote session
  entrypoint, e.g., CCR infrastructure — not local interactive mode), **and**
- `NH(process.env.CLAUDE_CODE_RETRY_WATCHDOG)` is truthy

The gate `V6()==="linux"` and the `remote` entrypoint check mean this is **not for local
developer machines**. The target is the CCR v2 back-end (L73) and daemon-mode workers
(L85) — long-running remote sessions where a stalled retry loop would otherwise hang
indefinitely. Fits the Chapter 17 narrative of instrumentation for unattended operation.

The watchdog itself arms on 429 (rate limit) errors (`KZ7(H) = ...H.status === 429`) and
interacts with the existing `armedAt` reset logic during MCP progress events.

## Diff Artifact: `CLAUDE_CODE_`

The env-var extractor picks up a bare string literal `"CLAUDE_CODE_"` in v2.1.116. This
is **not a usable env var** — it's the prefix string used by the diagnostic env dump
function `F1K()`:

```js
function F1K(H=process.env){
  let _=[];
  for(let q in H)
    if((q.startsWith("CLAUDE_CODE_") || q.startsWith("ANTHROPIC_")) && !nH3...)
      _.push(...);
  return _;
}
```

Collects all env vars starting with `CLAUDE_CODE_` or `ANTHROPIC_` for telemetry/support
dumps (likely minus a denylist in `nH3`). Same mechanism explains why the similar
`"ANTHROPIC_"` string hasn't historically shown up as a "new env var" false positive — it
was already in the bundle before the extractor's baseline.

**Ignore `CLAUDE_CODE_` as a configurable variable.**

## Feature Flags & Telemetry (`tengu_*` Identifiers)

The structural diff-versions.sh script only extracts env vars, slash commands, hook events,
and API beta strings — it misses the GrowthBook feature-flag and telemetry-event namespaces.
v2.1.116 adds **12 new `tengu_*` identifiers**, which split roughly into GB flags gating
dark-launched features (the most interesting), telemetry paired with new feature wiring,
and purely observational telemetry.

### GB flags gating dark-launched features

Accessed via `S_(name, default)` or `QK(name)` — these are feature flags, not telemetry.

| Identifier | Gates | Default when missing | Additional precondition |
|---|---|---|---|
| `tengu_ccr_post_turn_summary` | Post-turn summary surface in remote (CCR) sessions | `false` | `NH(process.env.CLAUDE_CODE_REMOTE)` must be truthy (`TzK()`) |
| `tengu_doorbell_agave` | The `enforce_web_search_mcp_isolation` tool-use isolation latch | — | Uses `aK5="enforce_web_search_mcp_isolation", sK5="tengu_doorbell_agave"`. When on, tools matching classifications `["cowork","workspace","session-info","mcp-registry","plugins","scheduled-tasks","dispatch","ide"]` get blocked by an active latch with `denyMessage` and emit `tengu_tool_use_isolation_latch_denied` telemetry |
| `tengu_gouda_loop` | "Closed-issue notice" notification — fires when one of the user's reported GitHub issues is closed | `false` | — |
| `tengu_mcp_concurrent_connect` | Parallel MCP server connection at boot | `false` | When on: `Promise.all([regularMcpConfigs, claudeaiConnectors])`; when off: serial connect |

`tengu_doorbell_agave` is the most consequential — it introduces a **tool-use isolation
latch** mechanism (new `Pa_()` factory returning `{denyMessage, activeLatch, classifiedAs}`)
that can classify and block tool calls at the dispatch layer. The initial use case enforces
that web-search MCP tools don't bleed into other contexts (cowork sessions, workspace state,
plugin-loaded tools, scheduled tasks, etc.). This is groundwork for more general
classification-based tool gating — worth watching whether more latch identifiers land in
later releases.

### Telemetry paired with new feature wiring

These are `Q(name, data)` telemetry events whose existence implies the feature they
measure has also been wired up (even if flagged off):

| Identifier | Measures | Feature it implies |
|---|---|---|
| `tengu_mcp_resource_templates_fetched` | `{template_count}` per MCP server | New MCP `resources/templates/list` capability being called — MCP servers can now advertise URI templates, not just static resources |
| `tengu_rc_upsell_notification_shown` | `{idleMinutes}` | New idle-time toast: "control this session from your phone · `/remote-control`" at `priority: medium`. Implies `/remote-control` exists as a new slash command, though dark-launched |
| `tengu_remote_attach_session` | Attach-event firing | New `--remote` CLI flag gaining **attach** capability (previously create-only). Error string: `"Attaching to an existing remote session is not enabled for your account."` Paired with `tengu_remote_create_session` and `tengu_remote_create_session_error` |
| `tengu_ultraplan_plan_ready` | `{duration_ms}` | ULTRAPLAN surface gains a plan-ready state, emitting message `"The remote ultraplan session produced a plan and is waiting for approval. Tell the user to open ${q} to review it."` Paired with `tengu_ultraplan_awaiting_input` |
| `tengu_tool_use_isolation_latch_denied` | `{toolName, toolUseID, isMcp, isolationLatch, isolationClassifiedAs, replInnerCall | queryChainId | queryDepth}` | Fires when a tool call is blocked by `tengu_doorbell_agave`'s isolation latch |

### Pure observational telemetry

| Identifier | Measures |
|---|---|
| `tengu_cli_flags` | Which CLI flags the user launched with (invoked once at startup) |
| `tengu_keybinding_fired` | Keybinding-press event (used for UX metrics on Fullscreen TUI / keybinding overrides) |
| `tengu_scroll_arrows_detected` | Terminal arrow-key scroll event (TUI observability) |

### Narrative implication

Reading only the env-var / slash-command / hook / beta diff suggests v2.1.116 is
infrastructure. The `tengu_*` diff tells a different story: **several user-facing features
ship wired-up but GB-gated off** in this release — parallel MCP connect, MCP resource
templates, closed-issue notifications, ULTRAPLAN plan-ready, `/remote-control` upsell,
`--remote` attach, tool-use isolation latching. When these flags flip on (days/weeks later,
per the GrowthBook rollout model), there will be no new *binary* to correlate with —
they'll just appear.

For future diffs: see the refreshed `diff-versions.sh` which now also extracts `tengu_*`
identifiers.

## Surface Summary

| Category | v2.1.113 → v2.1.116 |
|---|---|
| Env vars | +12 real (8 OIDC federation, 2 proxy, 1 slim prompt, 1 retry watchdog) + 1 diff artifact |
| Slash commands | +1 user-visible (`/model` headless registration); +1 dark-launched (`/remote-control`) |
| Hook event types | 0 |
| API beta strings | +1 (`oidc-federation-2026-04-01`) |
| GB feature flags | +4 (`tengu_ccr_post_turn_summary`, `tengu_doorbell_agave`, `tengu_gouda_loop`, `tengu_mcp_concurrent_connect`) |
| Telemetry events (new) | +8 `tengu_*` identifiers |
| CLI flags | +1 dark-launched (`--remote` gaining attach capability; the flag itself may pre-exist — attach path is new) |
| Removed surface | 0 |

## Cross-References

- **L66 (Proxy Auth Helper)** — describes the `claude proxy` credential-helper subcommand.
  The new `CLAUDE_CODE_HTTP_PROXY`/`HTTPS_PROXY` env vars are a different mechanism:
  direct proxy URL routing, not Anthropic-auth proxying.
- **L73 (`/autofix-pr` + CCR v2)** — `CLAUDE_CODE_RETRY_WATCHDOG` gates on
  `CLAUDE_CODE_ENTRYPOINT==="remote"`, and `tengu_ccr_post_turn_summary` gates on
  `CLAUDE_CODE_REMOTE`. Both are CCR v2 plumbing. `tengu_remote_attach_session` /
  `tengu_remote_create_session` extend the `--remote` CLI surface this lesson introduced.
- **L85 (Daemon-mode groundwork)** — the retry watchdog and the new `tengu_ultraplan_*`
  events fit Chapter 17's instrumentation-for-unattended-operation theme. ULTRAPLAN's
  plan-ready state is a remote-session surface consistent with daemon-mode workers.
- **L17 (MCP)** — `tengu_mcp_concurrent_connect` changes boot-time connection from serial
  to parallel when enabled; `tengu_mcp_resource_templates_fetched` implies a new
  `resources/templates/list` capability being exercised.
- **L11 (Skills System)** — unrelated to this release but re-verified in parallel with
  v2.9.0/v2.9.1 of this skill package.

## What to watch for next

The `oidc-federation-2026-04-01` beta header suggests a public launch around that date.
The per-profile credentials directory (`<config_dir>/credentials/<profile>.json`)
convention for `user_oauth` in the error text implies the `user_oauth` flow will also
migrate to the profile system — worth re-diffing the auth module on the next release.
