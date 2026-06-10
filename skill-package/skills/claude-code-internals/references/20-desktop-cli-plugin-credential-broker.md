Updated: 2026-06-10 | Source: Binary extraction from Claude.app (Desktop) `app.asar`, version **1.11847.5** (string + byte-offset analysis; verified against the live `fcache` feature store; no diff baseline — first capture of the CLI-plugin credential-broker surface)

# Chapter 23: Claude Desktop Host Internals — CLI-Plugin Credential Broker & the `cli_plugin` Feature Gate (app.asar v1.11847.5)

> **Provenance.** Direct inspection of `/Applications/Claude.app/Contents/Resources/app.asar`
> (Desktop **1.11847.5**), main process `.vite/build/index.js` and preload `.vite/build/mainView.js`.
> This chapter is about the **Desktop app as a Cowork CLI host** — how a plugin-declared command-line
> tool receives a set-once secret in a sandboxed Cowork session. It complements Ch22/L105 (the *other*
> two Desktop credential channels — MCP App UI vs elicitation) and Ch20/L89 (Cowork split execution:
> the in-VM shell is sealed from host env, which is the exact problem this broker solves). All claims
> are byte-offset-located in the shipped binary and corroborated against the on-disk `fcache`; minified
> identifiers and offsets drift across versions.
>
> **Why this chapter exists.** A correctly-authored plugin manifest can declare a credential field that
> **renders nothing in the UI, with no error**, because a *server-side feature gate* strips the entire
> block before it reaches the renderer — and the same gate independently kills the runtime injection
> path. The lesson is twofold: (1) the `clis.*.env` broker is the purpose-built set-once credential
> channel for CLI tools (the third Desktop credential channel, after L105's two); and (2) when a plugin
> feature "doesn't appear," suspect the **GrowthBook gate**, not the manifest — and know how to read the
> gate's state from the local cache.

---

## TABLE OF CONTENTS

106. [Lesson 106 -- Desktop CLI-Plugin Credential Broker (`clis.*.env`) + the `cli_plugin` Dark-Launch Gate `2307090146`](#lesson-106----desktop-cli-plugin-credential-broker--the-cli_plugin-gate)

---

# LESSON 106 -- DESKTOP CLI-PLUGIN CREDENTIAL BROKER + THE `cli_plugin` GATE

**What it is.** A Claude Code plugin's `plugin.json` may carry a top-level **`clis`** object that
declares command-line tools the plugin ships. Each CLI entry can declare an **`env`** map of secrets
(e.g. an API key). In Claude Desktop / Cowork the user enters the value **once** under **Customize →
Plugins**; it is stored **encrypted** (Electron `safeStorage`) in a `cowork-plugin-env` config file and
**injected as an environment variable at every CLI invocation**, with the CLI's declared egress domains
merged into the session allowlist. This is the *purpose-built* answer to "how does an in-VM Cowork CLI
get a secret without the user re-supplying it each session" (Ch20/L89: the VM shell sees no host env).

**The catch (the whole reason this lesson exists).** In v1.11847.5 the entire feature — UI field,
storage, *and* invocation-time injection — is **dark-launched behind a single server-side GrowthBook
gate, `2307090146` (internal name `cli_plugin`)**, which is **off by default**. When off, the manifest
still parses and validates perfectly, but **nothing renders and nothing injects**, with no error shown
to the user.

## Part A — the `clis` manifest surface

A lenient runtime normalizer `O0(A)` reads top-level `clis`; the renderer zod schema `DUA` carries
`clis: gt(poi).optional()`; the manifest validator `wNi`/`mNi` accepts the block. Per-CLI allowed keys
are exactly `new Set(["displayName","icon","oauth","commands","env","network"])`.

```jsonc
"clis": {
  "xaffinity": {                       // key = kebab-case CLI binary name
    "displayName": "Affinity CRM",
    "network": ["api.affinity.co"],    // per-CLI egress allowlist (merged into egressAllowedDomains)
    "env": {
      "api_key": {                     // snake_case key
        "envVar": "AFFINITY_API_KEY",  // UPPERCASE, validated (regex bx), reserved names rejected
        "secret": true,                // true => safeStorage-encrypted, no `default` allowed
        "displayName": "Affinity API Key",
        "description": "From Affinity Settings → API Keys"
      }
    }
  }
}
```

| Field | Notes |
|---|---|
| `displayName`, `icon` | shown in the Customize → Plugins UI |
| `oauth{envVar,displayName,clientId,clientSecret}` | OAuth variant (stored in sibling `cowork-plugin-oauth`, auto-refresh) |
| `commands[]{op,match,flag,unless_flag}` | per-op permission classification for the CLI shim |
| `network[]` | per-CLI egress-domain allowlist |
| `env{}` | the secret/config map (below) |
| `env.<key>.envVar` | UPPERCASE, validated, reserved names rejected |
| `env.<key>.secret` | boolean; `secret:true` + `default` is **forbidden** by the validator |
| `env.<key>.default` | honored **only** when `secret !== true` |
| `env.<key>.description`, `.displayName` | UI strings |

**Validation is permissive about shape.** `mNi` requires ≥1 CLI entry but does **not** require
`commands`/`oauth`/`icon` — an **env-only** entry (just `displayName`+`network`+`env`) is fully valid.
So a manifest that shows no credential field is **not** failing validation; see Part C.

**Storage (`PluginEnvStorage`).** Tag `"[PluginEnvStorage]"`; store `new Nh({name:"cowork-plugin-env",
configFileMode:384})` → config file mode **0600**, value safeStorage-encrypted base64 under key `"env"`,
entries partitioned by `{accountId, orgId, pluginId, cliName, envKey, envVar}`. The getter `qXA()` guards
on `safeStorage.isEncryptionAvailable()` and `safeStorage.decryptString(Buffer.from(value,"base64"))`
inside a try/catch (decrypt failure → `[]`). Sibling `"[PluginOAuthStorage]"` → `cowork-plugin-oauth`.

**IPC surface (preload `mainView.js`, namespace `LocalPlugins`):** `setPluginEnvVars`,
`getPluginCliStatus`, `getPluginOAuthStatus`, `setPluginOAuthClient`, `startPluginOAuthFlow`,
`revokePluginOAuth`, `getPluginShimOps`, `getPluginCliBatch`.

## Part B — the invocation-time resolver and bridge

At each CLI invocation a host-side broker resolves the env and injects it. Resolver
`async function VKr(A,e,t,i)` returns `{env, token, tokenEnvVar}`:

```js
const g = clA(r.accountId, r.orgId);                 // → qXA() reads the encrypted store
for (const [c, l] of Object.entries(e.env ?? {})) {
  const I = g.get(i, t, c, l.envVar),
        E = (I == null ? void 0 : I.value) ?? l.default;   // stored value, else manifest default
  if (E === void 0) return { error: `missing credential: ${l.displayName ?? c}. Set it in Settings.` };
  n[l.envVar] = E;
}
```

Egress is merged via `$Kr(s.egressAllowedDomains, C.network)`. The CLI shim runs through a bridge
tagged `"[cliPluginBridge]"` (identifier `gw`): `maybeRegisterCliPluginBridge()` → `GKr(...)` registers
the `classifyCliPlugin` / `reportCliExit` guest-request handlers (gated only on VMAPI presence, **no**
feature check — so the shim path is *wired* even when the feature is off). A `classifyCliPlugin`
guest-request routes `OKr → PKr` (= `classifyInner`, which fronts both permission classification **and**
env resolution).

## Part C — the dark-launch gate `2307090146` (`cli_plugin`)

The wrapper `async function Xd(){ try { const {isFeatureEnabled:A} = await ...; return A("2307090146") } catch { return !1 } }`
gates the whole pipeline. `isFeatureEnabled` = `lt(A)` reads store `zd`, populated from
`GET /api/desktop/features` (constant `NRi = "/api/desktop/features"`) with disk cache **`fcache`**
(`ntt()` = `path.join(app.getPath("userData"), "fcache")`; 8-byte magic `CLF\x01…` + gzip; TTL 1440 min).

**Two independent gate checks — UI *and* runtime:**

1. **Renderer / UI (data-strip).** The renderer plugin object is built by `pJe()` whose `clis` portion
   comes from `GXr()`, which begins `if (!await Xd()) return {}`. With the gate off, the `clis` key
   **never reaches the web UI** (the plugin detail page is the claude.ai web app in the desktop webview,
   not in the asar), so the sidebar renders only the keys it does have (Skills, Hooks). When the gate is
   *on*, `GXr`'s push condition `(I || c.length > 0 || E !== void 0 || u)` includes env-only entries
   (`u` = env map, `E` = network), so `commands`/`oauth` are **not** required to surface a field.
2. **Runtime (injection-strip).** `VKr` itself is **ungated**, but its only caller `PKr` begins
   `if (!await Xd()) return { errorCode:"oauth_disabled", error:"plugin oauth disabled" }` — so when the
   gate is off, `PKr` short-circuits **before** the `O0` normalizer loads `clis`, **before** the store
   read, and **before** `VKr`. Every `classifyCliPlugin` call dies on the gate.

**Consequence: no manual workaround while gated.** (a) A value already in `cowork-plugin-env` is never
read (`PKr` short-circuits ahead of the store read); (b) a `secret:false` + `default` fallback never
injects (same reason); (c) hand-writing the encrypted file is infeasible (it needs the app's OS-keyring
`safeStorage` key, and `qXA` swallows a bad-decrypt into `[]`) and moot anyway. The write IPC
`setPluginEnvVars` returns `"Plugin OAuth is not enabled for this account."` when gated.

**Force-on exists but not for the standard client.** `hardcodedMainGrowthBookFeatures()` (table `yKi`,
each `{value:!0, on:!0, source:"force"}`) force-enables `2307090146` — but only on the class `cT`
(`type:"3p"`, the custom-gateway / CCD deployment). The standard claude.ai desktop client fetches the
gate server-side and returns `null` from the hardcoded table. (In CCD mode, `setPluginEnvVars` is
separately blocked with `"Not available in CCD mode."` via `xE()`.)

**Reading the gate state.** Decode `~/Library/Application Support/Claude/fcache` (strip the 8-byte
`CLF…` magic, gunzip). A standard account today shows:
`"2307090146": { "value": false, "on": false, "off": true, "source": "defaultValue", "ruleId": null }`
— off by default, no targeting rule matched. There is **no** local override file or env hook
(`initGrowthBook` / `tVA` has none).

## The three Desktop credential channels (L105 + L106 unified)

| Channel | For | User entry point | Returns value **privately**? | Status in current builds |
|---|---|---|---|---|
| **MCP App UI form** (Ch22/L105) | — | sandboxed `ui://` iframe | ❌ — only `sendPrompt`→`ui/message` into chat | live, but **wrong for secrets** |
| **Elicitation** (Ch22/L105) | MCP servers | host-native form / url | ✅ — returned as the `elicitation/create` response | live (1.9659.4) |
| **`clis.*.env` broker** (this lesson) | **CLI tools** | **Customize → Plugins** | ✅ — encrypted at rest, injected as env at invocation | **gated off** (`2307090146`, 1.11847.5) |

So: MCP servers collect secrets via **elicitation**; CLI tools are *meant* to use the **`clis.*.env`
broker** — but until Anthropic flips `2307090146`, an in-VM Cowork CLI must still receive its key the
old ways (project `.env`, a key-file path on a mounted folder, etc.; see Ch20/L89 on what the VM can
reach). A manifest that declares `clis.*.env` today is **forward-compatible**: it lights up with no
plugin change the moment the gate enables.

## Methodology note (the transferable lesson)

A server-side GrowthBook gate can **strip a `plugin.json` block before the renderer ever sees it**, so a
correctly-authored manifest produces an empty UI with no error. This is the same failure-shape class as
Ch20/L89's hook/`$VAR` contracts that work in single-process CCD but silently no-op in Cowork: the
artifact is valid, the *delivery path* is gated. When a plugin feature "doesn't appear": (1) confirm the
manifest parses (it usually does), then (2) **decode `fcache` and check the gate**, and (3) trace both
the renderer build (`pJe`/`GXr`) and the runtime chokepoint (`PKr` ahead of `VKr`) — a feature can be
gated in one path, both, or neither.

**Cross-references.** Ch22/L105 (the other two Desktop credential channels — MCP App UI vs elicitation;
same `app.asar` host) · Ch20/L89 (Cowork split execution — the in-VM shell is sealed from host env, the
problem this broker solves; three-root plugin namespace) · Ch21/L99 (host-delegated credential refresh —
the `cowork-plugin-oauth` sibling + `oauth_token_refresh`/`host_auth_token_refresh` control-requests) ·
Ch21/L104 (codename GB-flag triage — `2307090146` is another dark-launch gate of the same family).

| Identifier | Kind | Where | Effect |
|---|---|---|---|
| `clis` | manifest key | `plugin.json` (top-level) | declares plugin's CLI tools |
| `clis.<cli>.env.<key>` | manifest field | `plugin.json` | a secret/config var (`envVar`, `secret`, `default`, …) |
| `O0` / `DUA` / `wNi` / `mNi` | normalizer / zod schema / validators | main process | parse + validate `clis` (env-only entries valid) |
| `cowork-plugin-env` | config file (0600) | `userData` | safeStorage-encrypted env store (`PluginEnvStorage`) |
| `cowork-plugin-oauth` | config file | `userData` | sibling OAuth-token store (`PluginOAuthStorage`) |
| `qXA` / `clA` | store getter | main process | decrypt + read `cowork-plugin-env` (ungated) |
| `VKr` | resolver | main process | `{env,token,tokenEnvVar}`; `stored.value ?? default`; **ungated but only called by `PKr`** |
| `PKr` (`classifyInner`) | bridge chokepoint | main process | **gated** (`if(!await Xd()) return oauth_disabled`) — fronts classification + `VKr` |
| `gw` / `GKr` / `maybeRegisterCliPluginBridge` | `[cliPluginBridge]` | main process | registers `classifyCliPlugin`/`reportCliExit` (no gate on registration) |
| `setPluginEnvVars` (+ `getPluginCliStatus`, …) | IPC | preload `LocalPlugins` | UI write/read; returns `"Plugin OAuth is not enabled for this account."` when gated |
| `Xd` = `isFeatureEnabled("2307090146")` | gate wrapper | main process | the `cli_plugin` dark-launch gate (catch→false) |
| `pJe` → `GXr` | renderer plugin-data builder | main process | `GXr` strips `clis` (`if(!await Xd()) return {}`) when gated |
| `fcache` / `ntt` / `NRi` | feature cache / path / endpoint | `userData/fcache` | GrowthBook cache (magic `CLF…`+gzip, TTL 1440m); fetched from `/api/desktop/features` |
| `yKi` / `hardcodedMainGrowthBookFeatures` | force-on table | main process | force-enables `2307090146` **only** on `type:"3p"` (CCD/custom-gateway), not standard client |
| `xE()` | mode check | main process | CCD mode → `setPluginEnvVars` "Not available in CCD mode." |
