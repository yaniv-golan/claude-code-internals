Updated: 2026-06-13 | Source: **First-party binary extraction & adversarial verification.** Extracted and verified against the installed **Claude.app (Desktop) `app.asar` 1.12603.1** (main process `.vite/build/index.js`), the staged **in-VM agent ELF `claude-code-vm/2.1.170/claude`** (Bun-SEA JS bundle), and the **live on-disk `fcache`**. Method: a 14-agent verification workflow (5 finder→skeptic pipelines + discovery), each finder required to paste literal matched bytes, each claim re-greped by an adversarial skeptic. Corrections from that pass are applied inline below and called out where they revised an earlier draft. Minified identifiers (current as of 1.12603.1 / 2.1.170) drift across versions.

# Chapter 24: The Cowork Spawn + stream-json Control-Protocol Contract (app.asar v1.12603.1 / in-VM ELF v2.1.170)

> **Provenance & scope.** The real Desktop Cowork runtime cannot be scripted (no DevTools endpoint;
> `EnableNodeCliInspectArguments` fuse OFF; the session control plane is renderer→main IPC on
> per-build-UUID channels with 660+ `senderFrame` trusted-origin checks; deep links don't create
> sessions; there is no host CLI entry). The observable, stable seam is therefore **not** the app — it is
> the **agent binary's flags + stream-json control protocol + mounts + egress**. This chapter documents
> that contract, first-party verified against the binaries above. It complements Ch20/L89 (host-loop vs
> VM-loop, the split execution model), Ch22/L105 (the control-request dispatcher and elicitation), and
> Ch23/L106 (the CLI-plugin credential broker). Minified identifiers and offsets drift across versions.

---

## TABLE OF CONTENTS

107. [Lesson 107 -- The Cowork Spawn + stream-json Control-Protocol Contract](#lesson-107----the-cowork-spawn--stream-json-control-protocol-contract)

---

# LESSON 107 -- THE COWORK SPAWN + STREAM-JSON CONTROL-PROTOCOL CONTRACT

**What it is.** Whether it runs host-loop (the agent on the host) or VM-loop (the agent in the Linux
VM), the Cowork agent is driven over a **stream-json control protocol**: the desktop ("the driver")
spawns the agent with a fixed set of flags, performs an `initialize` handshake, then exchanges
`control_request` / `control_response` envelopes for permissions, MCP, hooks, and AskUserQuestion. If
you want to *drive* the agent faithfully (a headless harness, an SDK integration, any external driver), this —
not the app's IPC — is the contract to implement.

This is the same Agent-SDK control protocol whose **dispatcher** is documented from the other side in
Ch22/L105 (`subtype:"elicitation"`/`can_use_tool`/`hook_callback`/`mcp_message`/`oauth_token_refresh`/
`host_auth_token_refresh`). This lesson is the **driver's** view of it in Cowork.

## Part A — Cowork mode is env, not a flag

- **`CLAUDE_CODE_IS_COWORK=1` is the activation marker.** `[binary][empirical]` Cowork mode is selected
  by this env var, not by a CLI flag. (Cross-check: Ch20/L89 already noted `CLAUDE_CODE_IS_COWORK`
  exists as a bool detection flag but found *no* branch on it near hook loading/dispatch — consistent:
  it gates *mode*, not hook discovery. Distinguish it from `CLAUDE_CODE_SESSION_KIND="bg"`, which is the
  separate `/background`-fork axis from Ch20/L89.)
- **The `--cowork` *flag* is rejected by the agent invocation.** `[binary][empirical]` `--cowork` is
  plugin-scope only ("can only be used with user scope"; cross-ref L26's plugin-scope caveat). The SDK
  passes **no** `--cowork`. Use the env var.
- **Do NOT set `CLAUDE_CODE_USE_COWORK_PLUGINS`.** `[binary]` Desktop never sets it. Its only effect is
  to flip the agent's user-settings file to `cowork_settings.json` and the plugin cache dir to
  `cowork_plugins/` — files the host never populates, so setting it silently breaks settings + plugin
  reads:

  ```js
  function TSO(q){ if(q.coworkPlugins||K8(process.env.CLAUDE_CODE_USE_COWORK_PLUGINS)) return "cowork_settings.json"; return "settings.json" }
  ```

  (This sharpens the Ch20/L89 three-root-namespace finding: `cowork_settings.json`/`cowork_plugins/` is
  the namespace the *standalone* `--cowork` path uses, distinct from the desktop's account/org root that
  a real Cowork session actually reads. Toggling `USE_COWORK_PLUGINS` to "force cowork mode" is an
  active bug, not a switch.)

## Part B — The spawn flags that matter

`[empirical]` The agent is spawned roughly as:

```
-p --verbose --input-format stream-json --output-format stream-json --permission-prompt-tool stdio
```

- **`--verbose` is required** with `--output-format=stream-json --print` (else: *"requires --verbose"*).
- **`--permission-prompt-tool stdio`** is what routes `can_use_tool` / AskUserQuestion to the driver.
  **Without it, AskUserQuestion is silently auto-dismissed** and scripted answers never fire — a
  high-surprise failure mode for anyone building a headless driver.
- Effort/thinking ride flags + env, **not** `CLAUDE_EFFORT`. **Correction (binary-verified):** the
  desktop *explicitly passes* `--effort medium --max-thinking-tokens 31999`
  on the spawn argv (see the logged argv below) — those are **driver-passed values, not agent defaults**.
  The agent's own defaults differ: effort tiers are `eV = ["low","medium","high","xhigh","max"]` with
  internal default **`high`** (`w46()` returns `high` for `claude-fable-5`/`claude-opus-4-8` and as
  fallback, `xhigh` for `claude-opus-4-7`) — there is no `.default("medium")`; and thinking defaults to
  `{type:"adaptive"}` when `MAX_THINKING_TOKENS` is unset (`{type:"enabled",budgetTokens:N}` for a
  positive value, `{type:"disabled"}` for `0`). The literal `31999` does **not** appear in the in-VM
  bundle at all — it is purely the desktop-passed number. `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1` bypasses
  the per-model effort allowlist. `CLAUDE_EFFORT` as a `process.env` var remains a no-op (consistent with
  Ch17/L90 and the Ch21/L93 `bk()` substituter; no env read of it exists near `eV`/`w46()`).
- The logged real desktop argv (Ch20/L89): `--output-format stream-json --verbose --input-format
  stream-json --max-thinking-tokens 31999 --effort medium --model … --setting-sources=user
  --permission-mode default --allow-dangerously-skip-permissions --plugin-dir …` — i.e. the desktop
  pins effort/thinking explicitly rather than relying on the agent defaults.

## Part C — The stream-json control protocol (the stable seam)

- **Handshake first.** `[empirical]` The driver sends
  `{type:"control_request", request_id, request:{subtype:"initialize"}}` as the **first** message,
  *then* the user turn. The `initialize` request also carries `systemPrompt`,
  `appendSubagentSystemPrompt` (subagent append gated by
  `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT=1`), `hooks`, and `sdkMcpServers`.
- **The `control_response` envelope is doubly nested.** `[binary]`

  ```json
  {"type":"control_response","response":{"subtype":"success","request_id":"…","response":{ /* payload */ }}}
  ```

  The payload sits under an **inner** `response`. Getting this wrong yields
  `ZodError: expected object, received undefined`. (grep anchor for the envelope: `subtype:"success",response:{`.)
- **AskUserQuestion shape.** `[binary]` Question input:
  `input.questions[] = {question, header, options:[{label,description}], multiSelect}`. To **allow**,
  reply with `updatedInput.answers = Record<questionText, chosenLabel>` (the CLI's own schema is
  `answers: z.record(z.string(), z.string())`). The model then proceeds with the chosen answer. (This is
  the same tool documented in the core AskUserQuestion lesson; this is its over-the-wire answer shape in
  the control protocol.)
- **System prompt** can ride the `initialize` request (`systemPrompt`/`appendSubagentSystemPrompt`) or
  `--append-system-prompt`. `[binary]` The base Cowork prompt is assembled from many interpolated
  fragments in the asar — not cleanly extractable; reconstruct the Cowork-specific sections
  (file-handling, skills, outputs, the "Shell access" path-mapping section) and inject via
  `--append-system-prompt`.

## Part C2 — control-protocol request subtypes (newly surfaced in verification)

`[binary]` Beyond the dispatcher subtypes documented in Ch22/L105 (`initialize`, `can_use_tool`,
`hook_callback`, `mcp_message`, `elicitation`, `oauth_token_refresh`, `host_auth_token_refresh`), the
in-VM agent (`vm-bundle.js`) and desktop (`index.js`) handle several more — found while verifying this
chapter, not previously documented:

- **`mcp_call`** (host→VM) — invoke any subprocess MCP tool by fully-qualified name (`mcp__server__tool`)
  through the control channel, **bypassing the model turn**. Its schema doc states *"No permission check
  (control channel is trusted, same as other subtypes)"* — a notable trust boundary. (SDK-type servers
  are excluded; this targets subprocess MCP clients.)
- **`request_user_dialog`** (VM→host) — ask the host to render a tool-driven blocking dialog and return
  the choice (`{dialogKind, payload, toolUseID}` → host returns `{behavior:"cancelled"}` for unknown
  kinds). Replaces the older `setToolJSX`/`onDone` pattern.
- **`register_repo_root`** (host→VM) — add a working-directory root at runtime (must be a subdir of cwd),
  optionally `reload_claude_md`/`reload_plugins`/`reload_skills`. This is the runtime hook behind
  multi-repo workflows.
- **`stage_file`** (host→VM, CCR) — stage a host file into the remote container filestore (`stageFile()`,
  `/worker/files` + `/v1/filestore/fs`, `keep_alive` every 30 s during upload).
- **`end_session`** (host→VM, CCR) — terminate the worker, with an **epoch guard**: an
  `reason:"archived"` signal is ignored when `CLAUDE_CODE_WORKER_EPOCH > 1` (so a prior lifecycle's
  `end_session` can't kill a reattached worker).

## Part D — MCP delivery: the non-obvious one

- **`--mcp-config` is dropped in safe/hermetic mode — not "cowork mode" per se.** **Correction
  (binary-verified; an earlier "cowork ignores `--mcp-config`" framing was overbroad):** `--mcp-config`
  and `--strict-mcp-config` are
  parsed normally (`gU8()` → `mcpConfig[]` / `strictMcpConfig`). The drop happens in a filter `ap5()`
  that keeps only `type:"sdk"` servers and logs *"--mcp-config: N server(s) ignored in [safe/hermetic
  mode]"* — **but it fires only when `I5()` (safe mode) or `xB8()` returns true**, and `xB8()` requires
  **both `CLAUDE_CODE_REMOTE` and `CLAUDE_CODE_REMOTE_HERMETIC_MODE`**. A plain `SESSION_KIND=bg` Cowork
  session does **not** by itself trigger `ap5()`. So an empirical "`mcp_servers:[]` regardless of
  `--mcp-config`" observation reflects a **hermetic-remote** session (and/or the desktop simply
  delivering MCP via SDK servers), not an unconditional cowork-bg behavior. The "ignored in cowork mode"
  shorthand conflated hermetic mode with cowork mode.
- **Either way, real delivery is SDK servers over the control protocol** (next bullet), and that does
  **not** contradict Ch20/L89's "`claude_desktop_config.json` → `mcpServers.<name>.env` works": that file
  is read by the **Desktop host**, which spawns the server host-side and bridges it to the agent over the
  same SDK-server channel.
- **SDK MCP servers: declare in `initialize`, handle `mcp_message`.** `[binary][empirical]` Put
  `sdkMcpServers:["workspace"]` in the `initialize` request → the agent connects
  (`mcp_servers:[{name:"workspace",status:"connected"}]`) and surfaces `mcp__workspace__bash`. The agent
  tunnels JSON-RPC out as `control_request{subtype:"mcp_message", server_name, message:<jsonrpc>}`; the
  driver replies `control_response{response:{mcp_response:{jsonrpc:"2.0", id, result}}}`. **The driver
  IS the MCP server** — it handles `initialize` / `tools/list` / `tools/call`. (grep anchor:
  `if(e.request.subtype==="mcp_message"){let i=e.request,r=this.sdkMcpTransports.get(i.server_name)`.)
  This is the mechanism behind the `mcp__workspace__*` tools that Ch20/L89 documents from the agent's
  side.

## Part E — Permission model and tool registry (layered, not blanket-allow)

**Correction (binary-verified):** there is **no** "PreToolUse hook that forces ask for ~5 cowork tools
and blocks `Task run_in_background`." That earlier framing conflated several distinct mechanisms. The
actual layers, with current identifiers (app.asar 1.12603.1):

- **`--allowedTools` pre-approval.** `[binary]` `--allowedTools <built-ins>` pre-approves tools — this,
  not a blanket auto-allow, is why "tools just run." `--tools` / `--allowedTools` are real flags.
- **Host-loop tool partition** (the real "5 tools," from Ch20/L89, identifiers now verified). `[binary]`
  - `gre` = `HOST_LOOP_EXCLUDED_BUILTIN_TOOLS` = `["Bash","NotebookEdit","REPL","JavaScript","WebFetch"]`
    — dropped from the host-side allowed set.
  - `PNt` = `HOST_LOOP_SAFE_BUILTIN_TOOLS` (Task + the `TaskCreate/Update/Get/List/Stop` set `_Y` +
    Glob/Grep/Read/Edit/Write/WebSearch/Skill/AskUserQuestion/ToolSearch/SendUserMessage); `Ren(A)` =
    `A.filter(e => e.startsWith("mcp__") || PNt.includes(e))`.
  - `BDt = {Bash:"mcp__workspace__bash", WebFetch:"mcp__workspace__web_fetch"}`; `QDt(A)` adds the
    workspace alias **into the disabled-tools set** when `Bash`/`WebFetch` are disabled (additive
    injection alongside the originals — not a substitution in an allowed list).
- **The actual PreToolUse hook is path-gating, not a forced-ask list.** `[binary]` `IeA` =
  `HOST_LOOP_PATH_GATED` = `["Read","Write","Edit","Glob","Grep"]` (+`MultiEdit`) get a PreToolUse hook
  (`vZe`/`Nen`) that **denies `/sessions/…` (VM) paths on the host-side file tools** ("VM path on host —
  use the bash tool for `/sessions/` paths") and enforces working-directory scoping.
- **The `run_in_background` block is speculation-engine, Bash/PowerShell only.** `[binary]` Not a cowork
  PreToolUse hook and **not `Task`**: the speculation engine's `canUseTool` aborts a backgrounded shell
  (`"run_in_background" in M && M.run_in_background===true` → "Speculation paused: backgrounded shell")
  and applies only to `Ih = ["Bash","PowerShell"]`.
- **Session rules are user-configured, not a hardcoded always-ask set.** `[binary]`
  `CLAUDE_BG_SESSION_PERMISSION_RULES` (parsed by `eXY()`) injects `{allow[],deny[]}` as
  `alwaysAllowRules.session` / `alwaysDenyRules.session`. The default `alwaysAskRules` is `{}` (populated
  dynamically via `addRules`/`replaceRules` control messages) — there is no static always-ask tool list.
- **`--allow-dangerously-skip-permissions` is a capability grant.** `[binary]` It *permits* bypass
  switching; the mode itself stays `default`.

## Part F — Auth & runtime gotchas (for a faithful driver)

- **Auth: token via env; API-key vars are removed, not blanked.** `[binary]` The desktop's VM-env
  builder `rtA()` (ASAR) sets `CLAUDE_CODE_OAUTH_TOKEN` to the session OAuth token and sets
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_CUSTOM_HEADERS` to `""` — then `itA()`
  **`delete`s** each of those three when empty (`for(const e of [...]) A[e]===""&&delete A[e]`). So the
  final env has the OAuth token and **no** API-key vars at all (not blanked, deleted). For the
  claude-desktop (non-3p) path `sessionEnvVars()` returns `{}` (no override). (Relates to Ch21/L99
  host-delegated credential refresh.)
- **A fresh config dir breaks OAuth.** `[binary]` A fresh `CLAUDE_CONFIG_DIR` *alone* yields "Not logged
  in" — local OAuth state is config-dir-bound; for a headless driver, pass the token via env.
- **`setup-token` mints a long-lived OAuth token.** `[binary]` The flow exists (`inferenceOnly` +
  `expiresIn` set when the arg is `setup-token`; the UI shows *"Your OAuth token (valid for 1 year)"*,
  value = `accessToken` from the OAuth exchange). The output is verbose; extract the token from it.
  (Note: the `sk-ant-oat01…` prefix often quoted for these tokens is **not** verifiable from this binary —
  the only `sk-ant-oat01` strings in the bundle are in unrelated `ANTHROPIC_ENVIRONMENT_KEY` docs — so
  treat the prefix as an in-practice format, not a binary fact.) Never write the token into a launcher
  script on a host-mounted dir (leaks to disk + transcripts) — pass it as argv/env.
- **`CLAUDE_CODE_EXECPATH` is the agent's own exec path — don't blind-forward host `CLAUDE_*`.** `[binary]`
  In the VM bundle `CLAUDE_CODE_EXECPATH` (const `ZUK`) is set by the agent to its **own**
  `process.execPath`; the desktop never passes a host value for it into the VM (absent from `rtA`/ASAR).
  Construct the spawn env from the explicit contract rather than forwarding the host environment minus a
  strip-list — a host `CLAUDE_CODE_EXECPATH` would be a non-existent path inside the guest.
- **The guest is Ubuntu 22.** `[binary]` The Cowork system prompt (`i$r`) states the guest is "a
  lightweight Linux VM (Ubuntu 22)" and that pip must "ALWAYS use `--break-system-packages`" (PEP-668);
  pypi is off the egress allowlist. (The running guest image has been observed at runtime to ship node
  v12 — keep in-container helpers node-12-safe — but that node version is **not** stated in the system
  prompt or either binary, so it's a runtime property of the image, not a documented contract.) Container
  egress is default-deny.

## Methodology

`[methodology]` (1) **The binary is ground truth.** Adversarial re-verification of this chapter against
app.asar 1.12603.1 + the in-VM ELF 2.1.170 overturned two plausible-sounding claims (the `--effort`
default and the "PreToolUse forced-ask for 5 cowork tools / `Task run_in_background` block") and
sharpened several more (`--mcp-config` drop is safe/hermetic-mode, not cowork-bg; API-key vars are
deleted not blanked) — paste literal matched bytes, don't trust a tidy story. (2) **Don't trust a single
finder.** A discovery pass claimed the `cli_plugin` gate (`2307090146`) is force-on for interactive
Anthropic users via the `Vdr` map; re-grep showed `Vdr` belongs to the **custom-3p** provider class
(adjacent `[custom-3p]` log; this machine's interactive account takes the server-fetch path and its
`fcache` reads the gate OFF) — Ch23/L106's "off by default" stands. (3) **A server-side gate can change
the entire architecture** — host-loop vs VM-loop is gate `1143815894` (Ch20/L89); pin the gate state per
release (decode `fcache`) and reproduce the decision logic, not one branch. (4) **Two binaries, two
truths** — host-loop runtime lives in the desktop `app.asar`; the in-VM agent flags/protocol live in the
`claude-code-vm` ELF, so a string absent from one is often present in the other.
