Updated: 2026-10-09 (L224–L225) | Source: the installed **Claude Desktop `app.asar` 2.31226.0** and its UI bundle (`ion-dist`), read but **not diffed** against 2.26454.2, so nothing here is claimed as new in 2.31226.0; the **Desktop-bundled agent 2.1.293**; the **live GrowthBook cache decoded on 2026-10-09**; and one live run with a real MCPB extension (xaffinity MCP 1.24.0, Team org, local chat). Windows behaviour is read from shared code in the macOS build and is marked INFERRED.

# Chapter 62: Desktop Extensions (MCPB) — How a Bundle's Server Is Launched, and Prompt Completions

---

## TABLE OF CONTENTS

224. [Lesson 224 — How Desktop Launches an MCPB Extension's Server](#lesson-224--how-desktop-launches-an-mcpb-extensions-server)
225. [Lesson 225 — Desktop Never Asks an MCP Server for Prompt Completions](#lesson-225--desktop-never-asks-an-mcp-server-for-prompt-completions)

---

# LESSON 224 — HOW DESKTOP LAUNCHES AN MCPB EXTENSION'S SERVER

**For an installed extension (`.mcpb`, formerly `.dxt`), Desktop picks the platform override first, then fills in placeholders, then starts the server with a short allowlist of its own environment plus the manifest's `env`. A platform override's `env` replaces the base `env` instead of merging with it. An optional setting that is unset and has no default reaches the server as the literal text `${user_config.<key>}`. A value containing `$$` or `$&` is changed on the way.**

## Resolving `mcp_config` (CODE-READ)

The resolver (`ert`, Desktop's copy of `@anthropic-ai/mcpb`'s config builder) does, in order:

1. **Platform override.** `c={...mcp_config}`; if `platform_overrides[process.platform]` exists, `c.command=o.command||c.command`, `c.args=o.args||c.args`, `c.env=o.env||c.env`. Each of the three fields is replaced whole. An override that sets `env` must repeat every variable the base sets. The same line, under other minified names, is in 1.18286.2.
2. **Required check.** If a `required` setting is missing, `""`, an empty array or an array with an empty item, the log says `Extension <name> has missing required configuration, skipping MCP config` and the server is not started.
3. **Substitution** over the whole of `c` (command, args and env, override included). Available keys:

| placeholder | value |
|---|---|
| `${__dirname}` | the extension's install directory |
| `${pathSeparator}`, `${/}` | the path separator (`/` for plugin-shipped MCPB sources) |
| `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}`, `${DOWNLOADS}` | Electron's paths for these folders |
| `${user_config.<key>}` | the saved value, else the manifest `default` |

Values are converted with `String()`. Booleans become `"true"`/`"false"`, numbers become decimal text, and arrays are spread into args when the placeholder is a whole argument.

Three things follow from how substitution is written:

- **Unset optional setting, no default:** the key is not in the substitution table, so `${user_config.<key>}` stays in the string literally.
- **Whole-argument placeholder with an empty value:** the args branch tests `if(e&&t[e])`, so `""` also leaves the literal placeholder in place. In env strings, `""` is substituted as an empty string.
- **`$` in a value:** each placeholder is replaced with `String.prototype.replace(regex, value)`, which treats `$$`, `$&`, `` $` `` and `$'` in the value as replacement patterns. An API key containing `$$` reaches the server with `$`. Placeholder names go into the regex unescaped, so `.` in a key matches any character.

`${PATH}` is not a substitution key; it survives to launch (below).

## The environment the server gets (CODE-READ; PATH MEASURED)

Launch goes through `fBt` (exported as `sq`), which both chat and Cowork use: `LocalMcpServerManager`, the shared host-side manager behind `localMcpBridge` (L199), reads the same server table (`getMcpServersConfig`: extensions merged with `claude_desktop_config.json`, the config file winning on a name clash) and starts each server through the same function.

| runtime (chosen by `bIt`) | environment |
|---|---|
| **exec** (binary, python, shell; also node when built-in Node isn't used) | `sm(R7e(), mcp_config.env, {PATH})`, under which the MCP SDK's `StdioClientTransport` again puts its allowlist (`L7e`) |
| **built-in Node** (`utilityProcess.fork` of Desktop's Node host) | the same, plus `NODE_USE_SYSTEM_CA="1"`, `NODE_EXTRA_CA_CERTS` when Desktop has it, and Desktop's proxy variables |
| **uv** | as exec; working directory is the extension directory |

- **Allowlist** (`L7e`, taken from Desktop's own environment; values starting `()` are dropped): on macOS and Linux `HOME LOGNAME PATH SHELL TERM USER`. On Windows `APPDATA HOMEDRIVE HOMEPATH LOCALAPPDATA PATH PROCESSOR_ARCHITECTURE SYSTEMDRIVE SYSTEMROOT TEMP USERNAME USERPROFILE PROGRAMFILES` (INFERRED for the Windows build): **no `TMP`, `PATHEXT`, `COMSPEC` or `windir`**. Nothing else of Desktop's environment passes, and Desktop adds no `CLAUDE_*` variables to an extension's server.
- **PATH:** if the manifest's env sets `PATH`, that value is used with every `${PATH}` replaced by Desktop's computed path. Otherwise the computed path is used: the login shell's PATH (read by Desktop's shell-path worker), then a fixed list (`m7e`: nvm `*/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.cargo/bin`, `~/go/bin`, `~/.bun/bin`, `~/.deno/bin`, `~/Library/pnpm`, `~/.local/bin`, volta, asdf, pyenv, rbenv, orbstack, nix …), then Desktop's own PATH, with duplicates removed. Built-in Node keeps the manifest PATH first and appends the computed directories. MEASURED: on 2026-10-09 the extension's log recorded a 24-entry path list with `.cargo/bin`, three nvm `bin` directories and `Library/pnpm`.
- **Runtime choice** (`bIt`) reads the **base** `mcp_config.command`/`args`, never the override. Node bundles use built-in Node when `isUsingBuiltInNodeForMcp` is not false and `compatibility.runtimes.node` is absent or satisfied by Desktop's Node. A node entry that is not the literal `node <script>` qualifies only while gate `4282876673` is true; it was absent from the live cache on 2026-10-09, so its code default `true` applies.
- **Exec bit:** an exec command containing `/` that is not an executable file is refused (`uBt`). Install kept the scripts' execute bit (MEASURED: `0755` in the zip became `0700` on disk).

On Windows (CODE-READ from shared code), a command without an extension is tried with `.exe`, `.bat`, `.cmd` and `.ps1`. `.ps1` runs through PowerShell with `-ExecutionPolicy Unrestricted`, `.bat`/`.cmd` through `cmd.exe /C`, and `.js` through `node`.

This is a different launch path from the MCP servers a **plugin** declares in a local Cowork session. Those are started by the local agent and receive the user's full PATH plus `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PLUGIN_*` (L218, Chapter 59).

## Sensitive settings (CODE-READ)

A `sensitive: true` setting is encrypted with Electron `safeStorage` and stored as `__encrypted__:…` in the extension's settings JSON (`tXr`), and decrypted on load (`nXr`). If `safeStorage` is unavailable, the log warns and the value is stored in plaintext. If decryption fails, the settings are marked `configDegraded`, and a required field then stops the server. The value reaches the server only through `${user_config.*}` substitution. There is no length limit in this path, but the `$` patterns above apply.

## Plugin-shipped MCPB sources (CODE-READ)

An MCPB source referenced from a plugin is resolved with `userConfig: {}` and separator `/` (`Psn`). Only manifest defaults apply, and a required setting without a default keeps the server from starting.

## Observed with a real bundle (MEASURED, n=1, 2026-10-09)

xaffinity MCP 1.24.0 declares its API key as a sensitive, required setting and maps it through a `darwin` override's env. With the real key it worked. With the key set to `invalid-test-key` and the extension restarted, the server's CLI failed with an authentication error, although the CLI's own config file held a valid key: the setting reached the server and took precedence. Each disable/enable in the settings panel stopped and started the server twice within about a second, with a brief "unable to connect to extension server" notice that cleared by itself. Errors from a tool reached the model only as the tool's own text ("CLI exited with code 3"); Desktop's per-server log records `error(code=-32603)` without a body.

## For a bundle author

- Repeat the full `env` in every platform override, or don't put `env` in the override at all.
- Treat both `""` and any value beginning `${user_config.` as unset, or give optional settings a `default`.
- Accept `"true"`/`"false"` for booleans.
- Don't rely on Desktop's environment beyond the allowlist. On Windows set `TMP` yourself if a tool needs it.
- Use `${PATH}` inside your own `PATH` to keep Desktop's computed directories.
- Warn users that secrets containing `$` sequences may arrive altered, or read them through a file.
- Keep the base `command` and `args` the ones that decide the runtime; the override doesn't.

---

# LESSON 225 — DESKTOP NEVER ASKS AN MCP SERVER FOR PROMPT COMPLETIONS

**A server can advertise `completions` and implement `completion/complete` for its prompt arguments, but Claude Desktop never sends that request. Its prompt form is plain text inputs with no suggestions. The Claude Code agent bundled with Desktop does send completion requests, but only for resource-template arguments.**

## Observed (MEASURED, n=1 server)

With xaffinity MCP 1.24.0 installed (its `initialize` result advertises `capabilities.completions: {}`), the prompt form (composer **+ → Connectors → xaffinity MCP → pipeline-review**) showed plain inputs. Typing `deal` into the list-name field produced no suggestions, and the other prompt's fields didn't either. Over the run, Desktop sent the server `initialize`, `tools/list`, `prompts/list`, `resources/list` and `tools/call`. The extension's log, which goes back to 2026-02 across many sessions, contains **no** `completion/complete` request.

## In the code (CODE-READ, Desktop 2.31226.0)

- The MCP SDK's client method `complete()` (`request({method:"completion/complete"})`) is bundled in the main process (`index.chunk-CmH6WbFz.js`) and in the UI bundle (`ion-dist`, `c2a6d07ee-*.js`), and a UI wrapper forwards it (`shared-150-*.js`: `complete(e,t){return this.useClient(n=>n.complete(e,t))}`).
- Nothing in the main-process chunks or in `ion-dist` calls it. There is no `.complete({ref` call, no request object built with `argument:{name:…}`, and `ref/prompt` appears only in the SDK's schemas and its server-side handler. Every other `.complete(` call site in `ion-dist` belongs to the code editor, the clipboard or the animation library.
- Positive control: the same search finds the calls Desktop does make: `.getPrompt({name` (2 in `ion-dist`), `.listPrompts(` and `.callTool({`.

## The agent (CODE-READ, Desktop-bundled 2.1.293)

The agent's one completion caller (`Kd`) sends `complete({ref:{type:"ref/resource",uri},argument:{name,value},context})` for resource-template arguments when the server advertises completions, with telemetry `mcp_complete_resource_template`. There is no `ref/prompt` request in the binary (`prompts/get` is sent, the control). Whether that resource-template path is reachable from a Cowork session wasn't traced.

## For a server author

Implement `completion/complete` for prompt arguments only for other clients: in Claude Desktop it is never called. Say in a prompt argument's `description` which values are valid, because that text is all a Desktop user sees. If completion handlers live in files next to the prompts, make sure the server doesn't register them as prompts too: the bundle tested here listed `pipeline-review.completion` and `change-status.completion` as prompts, and they appeared in Desktop's prompt menu.
