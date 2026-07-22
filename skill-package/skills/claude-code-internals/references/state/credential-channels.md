---
domain: credential-channels
title: Desktop/Cowork credential channels (current)
as_of_cli: 2.1.217
as_of_desktop: 1.22209.0
sources: [105, 106, 107, 114, 127]
updated: 2026-07-17
---

# Desktop/Cowork credential channels (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter).

## The four Desktop credential channels

| Channel | For | User entry point | Returns value privately? | Status |
|---|---|---|---|---|
| **Elicitation** (`elicitation/create`) | MCP servers | host-native form/url dialog | yes — returned as the `elicitation/create` response | live |
| **`claude_desktop_config.json` host-spawned MCP servers** | MCP-shaped integrations | `mcpServers.<name>.env` in the config file | yes — key never enters the VM | live |
| **CLI-plugin `clis.*.env` broker** | CLI tools run in the in-VM shell | Customize → Plugins UI, entered once | yes — encrypted at rest, injected as env at invocation | **dark behind `gate.2307090146`**, off by default |
| **`grand_prix` partner autofill bridge** | one hardcoded, HMAC-signed trusted partner | the partner's own paired browser-extension/app flow (not a Desktop settings UI) | yes — `list`/`fill` are tab-origin-scoped, injected directly into the live browser tab, never through the transcript | present in code; org-feature-gated; no confirmed live fcache state (Lesson 127) |

1. **Elicitation.** The embedded Agent-SDK runtime routes a server's
   `elicitation/create` request through a control-request dispatcher keyed
   on `subtype:"elicitation"`, alongside `can_use_tool`, `hook_callback`,
   `mcp_message`, `oauth_token_refresh`, and `host_auth_token_refresh`. The
   host handler `onElicitation({serverName, message, mode, url,
   elicitationId, requestedSchema, title, displayName, description})`
   returns `{action, content}` **as the RPC response** — it never enters
   the message stream or the transcript. Supports `form` and `url` modes
   (gated on the client's advertised `clientCapabilities.elicitation.form`/
   `.url`); `ElicitResult.action` is `accept | decline | cancel`; a
   host that wires no handler auto-declines. `notifications/elicitation/
   complete` signals completion in url mode. This is the **only** correct
   channel for a secret collected inside Desktop/Cowork.

2. **`claude_desktop_config.json` → `mcpServers.<name>.env`.** stdio MCP
   servers declared here are spawned by the Desktop (Electron) app through
   a login shell and run **host-side**, then bridged into the Cowork
   session as `mcp__<server>__*` tools. They receive the **full host env**
   (proven empirically: a probe server's `get-env` returned macOS host
   paths, the full host shell `PATH`, and its own `env:`-block marker).
   This is genuinely read by the Desktop app (not just the CLI's
   import-only `claude mcp add-from-claude-desktop` path) and is available
   in every Cowork session after a Desktop restart — the validated route
   for giving an MCP-shaped integration a key without re-supplying it each
   session.

3. **CLI-plugin `clis.*.env` broker.** A plugin's `plugin.json` may carry a
   top-level `clis` object; each CLI entry's `env` map declares secrets
   (`envVar`, `secret:true`, `displayName`, `description`). The user enters
   the value once under Customize → Plugins; it is stored **safeStorage
   -encrypted** in `cowork-plugin-env` (mode 0600, resolver `VKr` reads it
   at invocation via `{env, token, tokenEnvVar}`), with the CLI's declared
   `network[]` merged into the session's egress allowlist. **The whole
   pipeline — UI field, storage, and invocation-time injection — is
   dark-launched behind GrowthBook gate `2307090146` (`cli_plugin`), off
   by default.** Two independent gate checks:
   - Renderer (`pJe`→`GXr`): with the gate off, `clis` never reaches the
     web UI — a correctly-authored manifest shows no credential field,
     with no error.
   - Runtime (`PKr`, ahead of the ungated `VKr`): with the gate off, every
     `classifyCliPlugin` call short-circuits to `{errorCode:
     "oauth_disabled"}` before the store is even read.
   Consequence: **no manual workaround while gated** — a pre-seeded
   `cowork-plugin-env` value is never read, a `secret:false`+`default`
   fallback never injects, and hand-writing the encrypted file needs the
   OS-keyring `safeStorage` key. A manifest that declares `clis.*.env`
   today is forward-compatible: it lights up with no plugin change the
   moment Anthropic flips the gate. Force-on exists only for the `3p`/CCD
   deployment class, not the standard client. Check gate state by decoding
   `~/Library/Application Support/Claude/fcache`.

   **Re-confirmed off at Desktop 1.18286.0 (2026-07-04, lesson 114)** —
   same `defaultValue` source, mechanism structurally unchanged (only
   re-minified identifiers). No prior build was available to diff against
   byte-for-byte (1.17377.2 was pruned by auto-update before this pass and
   Anthropic does not serve historical Desktop `.app` builds), so this was
   a re-verification against the previously-published mechanism, not a
   binary diff.

4. **`grand_prix` partner autofill bridge.** A single hardcoded, HMAC-verified
   trusted partner (registry `Pm()`/`D4e`, keyed on stable partner id
   `d2291431f58d728c`) supplies a signed config whose `protocolServices`
   carry both tool definitions (`tool.manifest.{list,fill,release,code}`)
   and system-prompt appends (`prompt.code_session_append`/
   `prompt.cowork_session_append`) — the Desktop relays the partner's own
   payload rather than authoring the tool surface itself. `list`/`fill`
   are scoped to the active browser tab's origin
   (`getActiveTabOrigin`/`$expectedOrigin`), and telemetry
   (`grand_prix_credential_request_outcome` carrying `entry_count`,
   `has_login`, `has_address`, `has_card`) confirms this is a
   **login/address/payment-card autofill** channel, not a general secret
   store — it fills values directly into a live tab, it does not return
   them to the model or the transcript. Gated by an org feature flag;
   this is **not** an extensibility point — a skill or integration cannot
   register itself as a `grand_prix` partner. See Ch36/Lesson 127 for the
   full mechanics; no live fcache decode confirms this channel's
   production on/off state as of 1.22209.0.

## Auth at spawn

- The desktop's VM-env builder `rtA()` sets `CLAUDE_CODE_OAUTH_TOKEN` to
  the session OAuth token and sets `ANTHROPIC_API_KEY` /
  `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_CUSTOM_HEADERS` to `""` — then
  `itA()` **deletes** each of those three from the env object when empty
  (`for(const e of […]) A[e]===""&&delete A[e]`). The final spawn env
  therefore carries the OAuth token and **no** API-key vars at all — not
  blanked, deleted.
- **A fresh `CLAUDE_CONFIG_DIR` alone breaks OAuth** ("Not logged in") —
  local OAuth state is config-dir-bound. A headless driver must pass the
  token via env rather than relying on a config-dir copy.
- The host→Cowork-session env for the agent itself is Anthropic-auth-only,
  built by `Ucr({oauthToken, apiHost, shellPath, subscriptionType})` — the
  local-agent session-config schema (`{skills, mcpServers, hooks, agents,
  clis}`) has no general-purpose `env` field. This is why the in-VM shell
  is sealed from arbitrary host secrets while host-spawned MCP servers
  (channel 2 above) are not: they are two different processes with two
  different env-construction paths.

## What NOT to use

**An MCP App UI form.** Claude Desktop renders MCP Apps (`ui://` HTML
resources) in a sandboxed iframe over Claude's own postMessage dialect
(`protocolVersion "2025-11-21"`, injected `window.app`). The UI is
bidirectional — it has working callbacks for display mode, file download,
file attach, resize — but its **only** way to return data is
`window.sendPrompt(text)` → `ui/message`, which injects a
`role:"user"` message **into the chat**. There is no `tools/call`/
`callServerTool` channel anywhere in the bridge; searching the whole
`app.asar` bridge cluster turns up zero occurrences of it. Even the host's
own built-in "visualize" MCP App widget submits its in-iframe elicitation
form via `sendPrompt`, confirming the UI form path always goes back
through the conversation transcript — never privately to a server. Using
an MCP App form to collect a secret leaks the value into the chat and
transcript; use elicitation (channel 1) instead.
