Updated: 2026-09-23 | Source: **`app.asar` 2.7032.0** (`60d7d5fc…`) and the backed-up asars back to 1.18286.2 for first-appearance, the **host Mach-O 2.1.241 / 2.1.246 / 2.1.247 / 2.1.260 / 2.1.275 / 2.1.280** and **in-VM ELF 2.1.280**, the live fcache `f82df085d027eff0`, **this machine's Desktop log, 3,020 recorded session starts and the Cowork transcripts**. Leads relayed by the `cowork-harness`, `founder-skills` and sibling sessions, each re-derived first-party. **Does NOT move the CLI content baseline.**

# Chapter 54: Plugin MCP Servers With No Tools, Which Plugin Copy Loads, the Skill-List Budget, and Hooks That Run on Your Machine for a Cloud Session

---

## TABLE OF CONTENTS

199. [Lesson 199 — When a Plugin's MCP Server Gets Zero Tools in Cowork](#lesson-199--when-a-plugins-mcp-server-gets-zero-tools)
200. [Lesson 200 — A `--plugin-dir` Copy Silently Replaces the Installed Plugin](#lesson-200--a---plugin-dir-copy-silently-replaces-the-installed-plugin)
201. [Lesson 201 — The Skill-List Budget: Which Descriptions the Model Actually Sees](#lesson-201--the-skill-list-budget)
202. [Lesson 202 — `claude --cloud` and Hooks That Run on Your Machine for a Cloud Session](#lesson-202--claude---cloud-and-device-hooks)
203. [Lesson 203 — Hook Events in the Stream Are Gated: Local Cowork Shows Only SessionStart](#lesson-203--hook-events-in-the-stream-are-gated)

---

# LESSON 199 — WHEN A PLUGIN'S MCP SERVER GETS ZERO TOOLS

**In local Cowork a plugin's MCP server can be swapped for a stub that lists no tools. Two things do it: an admin MCP policy (local and `.mcpb` servers) and a server-side switch (remote http/sse servers only, and since 2.2553.1 only when a claude.ai connector already provides the same server). With neither, a plugin's local stdio server gets its real tools. Both halves are visible in this machine's Desktop log.**

## The stub

Desktop (chunk `DRgamBlQ`, identical in every build back to 1.18286.2):

```js
function l(e,t){return`plugin:${e}:${t}`}
function u({createSdkMcpServer:e},t){return e({name:t,tools:[]})}
```

A stubbed server is a real SDK server that answers `tools/list` with `[]`, keyed `plugin:<plugin>:<server>` — the same key the agent uses for plugin servers, so it takes the real server's place. Every stub travels in the session's SDK server map. While gate `2529235968` is on, the stubbed keys are also written to `cowork-plugin-mcp-shadow.json`, passed to the agent as `--mcp-config` (every entry `{type:"sdk"}`) "so the CLI does not open its own client"; with the gate off, the file carries only stand-in replacements and policy stubs go in the SDK map alone. Working plugin servers take other paths: a local stdio server is run host-side by the Desktop's `LocalMcpServerManager` and announced by `localMcpBridge`; a remote server that is not replaced is left for the agent to open itself.

## What gets stubbed

**Policy** (since at least 1.18286.2; log "Overriding with no-ops"). A local or `.mcpb` plugin server is stubbed when the admin MCP policy says so:

```
!localMcpEnabled || isMcpb && (!extensionsEnabled || signatureRequired || directoryEnabled && !fromOrgRegistry)
```

**Remote servers, gate `2529235968`** (a server with a `url` and type http, streamable-http or sse):

| Desktop | rule |
|---|---|
| before 1.37937.0 | not stubbed |
| 1.37937.0 – 1.46388.x | **every** remote plugin server stubbed while the gate is on |
| 2.2553.1 on | stubbed only when a **stand-in** already provides it, matched by URL hostname or name: a claude.ai connector in the session with at least one enabled tool (gate on), or a third-party direct MCP server (a stand-in even with the gate off). Some plugins are exempt unless a policy is active. |

In every version, none of this applies in host-loop when `/Library/Application Support/ClaudeCode/managed-mcp.json` exists, or when managed settings disable side-loading.

The gate was served off on 2026-09-05 and force-on on 2026-09-23 on the capturing account; rollout can differ per account. The shadow file first appears in 1.40609.0, the connector stand-in matching in 2.2553.1.

**If the shadow file cannot be written**, the Desktop refuses to start the session only when it is enforcing the stubs *and* an MCP policy is active:

```js
if(o&&i(await r()))throw Error(`Failed to write ${m} while an MCP policy is active; refusing to start session with unenforced plugin MCP servers`)
// o = enforcesPolicy; otherwise it logs a warning and continues
```

With the switch off, policy stubs are not written to the file at all (they travel only in the SDK map), so there is nothing to fail. A second refusal, "Plugin MCP scan failed while an MCP policy is active", covers a failed scan. An admin allow-list of plugin servers (`allowedPluginServers`, which makes the policy check return `"allowlist-set"`) also exists in 2.7032.0; its consumer was not traced.

## Observed

**The working case.** The `pdf-viewer` plugin on the capturing machine declares one local stdio server (`npx @modelcontextprotocol/server-pdf --stdio`). On most days from 2026-08-28 to 2026-09-23, Desktop's `main.log` records it being started and bridged:

```
[LocalMcpServerManager] Connected to plugin:pdf-viewer:pdf (9 tools)
[localMcpBridge] announcing plugin:pdf-viewer:pdf: 3 tool(s)
```

and three of its tools (`mcp__plugin_pdf-viewer_pdf__display_pdf`, `__interact`, `__list_pdfs`) appear in every local Cowork session recorded after Desktop 2.7032.0 started.

**The replaced case.** From 2026-09-15 (Desktop 2.2553.x) the same log records, many times a day, remote plugin servers being replaced because a connected claude.ai connector covers them:

```
Replacing plugin "design" MCP server "slack": "Slack" already provides it (matched by url)
Replacing plugin "airtable" MCP server "airtable": "Airtable" already provides it (matched by url)
```

— and likewise for Notion and for Slack in the `finance` and `legal` plugins. Search Desktop's log for "Overriding with no-ops" and "already provides it" to see which of your plugin's servers were stubbed; stubs never appear as `LocalMcpServerManager` connections.

## For a plugin author

- **A local stdio MCP server in your plugin works in local Cowork** unless the user's organisation enforces an MCP policy.
- **A remote (http/sse) server is replaced when the user already has the same service connected as a claude.ai connector** — observed daily on the capturing machine. That is deliberate: the connector serves it. Earlier Desktop builds (1.37937.0–1.46388.x) replaced every remote plugin server while the switch was on.
- A harness that starts plugin servers itself sees real tools in both cases, so it will not reproduce either stub.

---

# LESSON 200 — A `--PLUGIN-DIR` COPY SILENTLY REPLACES THE INSTALLED PLUGIN

**When the same plugin is both installed and passed with `--plugin-dir`, the `--plugin-dir` copy wins — the whole plugin, not component by component — as long as it is enabled and has exactly the same manifest `name`. Nothing tells the user. And Cowork delivers every plugin through `--plugin-dir`, sometimes the same one twice.**

## The rule

Agent merge function (host Mach-O 2.1.280; the same in 2.1.260 and the in-VM ELF):

```js
M=new Set(w.filter((he)=>he.enabled!==!1).map((he)=>he.name)),
D=e.marketplace.filter((he)=>{if(M.has(he.name))
  return t(`Plugin "${he.name}" from --plugin-dir overrides installed version`),!1;return!0})
```

- The comparison is the manifest `name`, exact and **case-sensitive**; the marketplace id plays no part.
- The installed copy is dropped before anything loads, so skills, hooks, MCP servers and agents all come from the `--plugin-dir` copy.
- The only record is the debug-log line above. Nothing reaches `plugin_errors` in the session's init record.

The installed copy wins instead when:

1. the `--plugin-dir` copy is disabled — `enabledPlugins["<name>@inline"]: false`, or `defaultEnabled: false` in its manifest;
2. managed settings lock that plugin name — this one *is* reported: "--plugin-dir copy of "X" ignored: plugin is locked by managed settings";
3. managed settings set `disableSideloadFlags`, which drops every `--plugin-dir` and `--plugin-url`;
4. the path does not exist, or the names differ — then both copies load.

## Cowork

The Desktop passes Cowork plugins to the agent as `--plugin-dir`, in host-loop from its `claude-hostloop-plugins/<hash>` staging area. Across 3,020 `system/init` records on the capturing machine (901 audit logs, 916 sessions — a session can record several), the plugin sources are 53,572 `@inline` and 45 `@builtin`, and never a marketplace source; most inline paths are host-loop staging paths, some are `/sessions/…` paths from VM-loop runs. In 374 records the same plugin name appears twice, both inline, from two different staging hashes; which copy serves a given skill or hook was not traced.

## For someone testing a plugin they also have installed

- Keep the manifest `name` identical to the installed copy, including case, or both load.
- Do not disable `<name>@inline`, and do not ship `defaultEnabled: false`.
- Check `init.plugins[].path` to see which copy loaded — `source` is `<name>@inline` either way. Or run with `--debug` and look for "overrides installed version".

---

# LESSON 201 — THE SKILL-LIST BUDGET

**The list of skills the model sees has a character budget. When it overflows, only bundled skills keep their description automatically; the rest are ranked by recent use and packed greedily, and the losers are listed by name only. On current first-party models, which run a 1M context, the default budget is about 30,000 characters.**

## The budget

```js
function tUe(e,n=Emt){let r=AH(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET);if(r)return r;
  let s=hVn(),g=(e??mVn)*n*s;return Math.max(1,Math.floor(g))}
// hVn() = skillListingBudgetFraction ?? 0.01 ; mVn = 200000 ; n = xf(model)
function xf(e){if(!e)return 4;…return zF.has(r)?4:3}
// zF lists models up to Opus 4.6, Sonnet 4.6 and Haiku 4.5
```

So the budget is **context window × characters-per-token × 1%**, where characters-per-token is 4 for the older models in `zF` and **3 for everything newer** (Sonnet 5, Fable 5, Opus above 4.6). The context window comes from the model table, and every current first-party model is listed with `window:1e6, native_1m:!0`:

| model | window | chars/token | default budget |
|---|---|---|---|
| Sonnet 5, Opus 4.7+, Fable 5 (first-party) | 1M | 3 | **30,000** |
| the same with 1M disabled (`CLAUDE_CODE_DISABLE_1M_CONTEXT`, the long-context credit block, or a third-party provider without native 1M) | 200k | 3 | 6,000 |
| Haiku 4.5 and older 200k models | 200k | 4 | 8,000 |

Width is measured as display width (`Bun.stringWidth`), so wide characters count double.

Settings: `SLASH_COMMAND_TOOL_CHAR_BUDGET` (env, absolute), `skillListingBudgetFraction` (above 0 up to 1), `skillListingMaxDescChars` (per-description cap, default 1,536; the description is `description - whenToUse`, cut with `…`), and `skillOverrides` to make a skill name-only.

## When it overflows

1. **Protected** skills render in full regardless: bundled prompt skills, and any marked name-only.
2. Everything else is charged as a bare `- name` line, then sorted by score, highest first:
   ```js
   return n.usageCount*Math.max(Math.pow(0.5,daysSinceLastUse/7),0.1)   // 0 if never used
   ```
   — a one-week half-life with a floor of 0.1, from `skillUsage` in `~/.claude.json`. Ties, including every never-used skill, keep their original order.
3. Descriptions are added **first-fit**, without stopping at the first one that does not fit: a long description can lose to a shorter one with a lower score.
4. A skill that does not win space is still listed, by name only.

This ranking has been unconditional since the range 2.1.209–2.1.215; 2.1.260 and 2.1.280 are identical. It shapes the agent's own skill listing, and so applies to the Cowork host-loop agent too; Desktop's separate `list_skills` tool is not built by it.

## For a skill author

- At 30,000 characters most users never hit the limit; users with many plugins, or on 200k models (6,000–8,000), do. When it binds, a new or rarely used skill is the first to lose its description. Put the trigger words in the **name**, and keep `description` plus `when_to_use` short — a long description loses to shorter ones.
- Users who need more can raise `skillListingBudgetFraction`.

---

# LESSON 202 — `CLAUDE --CLOUD` AND DEVICE HOOKS

**`claude --cloud` drives a cloud session from your machine, and can offer that cloud session your local hooks, run here. Which hooks are offered is decided by the hook's `cloud` field (from agent 2.1.246): by default only a script that can be hash-pinned and sits outside everything the cloud session can write. `"device"` widens that, so a cloud session can have a file it wrote run on your machine. It is switched off for the capturing account.**

## The field

Device-hook forwarding (`register_device_hooks`) is present from 2.1.237; the per-hook `cloud` field, marked internal, arrives in 2.1.246 (absent in 2.1.241). In a command hook's settings (host Mach-O and in-VM ELF 2.1.280):

```js
cloud: q(["device","skip"]).optional().catch("skip")
```

- **Omitted:** the default. A command hook whose script can be read and pinned, and lies outside everything the cloud session can write on this machine, is offered; others are not.
- **`"skip"`:** never offered. An unrecognised value also reads as `"skip"`.
- **`"device"`:** offered even when the script sits where the cloud session can write, or cannot be pinned. Its own description: the author accepts that the session may have changed files this hook executes.
- HTTP hooks have their own version of the field; an HTTP hook has no script to pin, so omitted means offered.
- The mark is ignored in `local` settings ("mark it in your user settings instead").

## The mechanism

`claude --cloud [description | session id | url]` is a CLI option, not a Desktop feature (the Desktop asar has none of the strings). The local CLI inventories eligible hooks, asks for consent, and registers them with the cloud worker (`register_device_hooks`, leased and renewed). When one fires in the cloud, the worker calls back (`sendDeviceHookCallback`); the local CLI runs the hook here, against staged copies of the verified bytes, and replies. If the machine does not answer in time the hook is skipped; an oversized or unresolvable `PreToolUse` input is denied. Only command and HTTP hooks, and only certain events, are forwarded; after-edit hooks never are.

**Pinning** records `{path, realPath, sha256}` at registration and re-hashes the script on every run. A pinned script changed while the session could write to it is refused (`pin_refused`, "review the file before trusting it again") — **even with `"device"`**.

## What `"device"` allows

It skips the checks that refuse: a script inside the checkout, the synced directory or a sandbox write inlet (`in_reach`); commands that cannot be pinned — shell one-liners, a `CLAUDE_CODE_SHELL_PREFIX`, private dot-directories (`unverifiable_target`, `unpinned_command`); an unvouched interpreter; and helpers the script loads from the checkout (`loads_from_reach`). So, with `"device"`, a cloud session can get content it wrote run on your machine: by writing an in-reach script before registration (it is then pinned as written), or by changing an unpinnable command or a helper the script loads, which are never hashed.

## Guards

- The hook author must mark the hook `"device"`, in a non-`local` settings file.
- The user must consent per machine, in `/hooks`; without it nothing is offered (`no_consent`). A saved consent is ignored if the cloud session can write the file it is stored in.
- Managed policy disables forwarding when hooks are restricted (plugin-only, customisation disabled, managed-only, or all hooks disabled).
- **Account flags:** the cloud worker needs `tengu_violin_wood` and `tengu_violin_amati` (and, under entrypoint `remote_desktop`, `tengu_violin_pegbox`). `wood` is the master flag for this whole family. On the capturing machine the cached values are `wood=false`, `amati=true`, `pegbox=true`, `strad=true` — so device mode, and with it device hooks, is off for that account.

`claude --cloud` is not in the official CHANGELOG for 2.1.261–2.1.280.

## For a hook author

Do not mark a hook `"device"` unless you mean it: it lets a cloud session you drive from this machine run, on this machine, a script or helper that the session itself could have written. Leaving the field out is the safe default.

---

# LESSON 203 — HOOK EVENTS IN THE STREAM ARE GATED

**The agent's stream-json output reports hook activity (`hook_started`, `hook_progress`, `hook_response`) only for `SessionStart` and `Setup`, unless it is started with `--include-hook-events` or runs with `CLAUDE_CODE_REMOTE` set. Desktop never passes the flag, so a local Cowork session's records show `SessionStart` hooks and nothing else — even when other hooks ran.**

## The gate

Host Mach-O 2.1.280:

```js
var Ehn=["SessionStart","Setup"];
function n3(e){if(Ehn.includes(e))return!0;return e8e().allHookEventsEnabled&&Kf.includes(e)}
…
if(po||a.CLAUDE_CODE_REMOTE)P3r(!0)     // po = includeHookEvents (--include-hook-events)
```

All three frame types go through `n3`. The CLI's help: "Include all hook lifecycle events in the output stream (only works with --output-format=stream-json)". The gate is older than every build on hand (2.1.197 already has it; the class form arrived at 2.1.227 with the same behaviour).

Desktop 2.7032.0 carries `includeHookEvents` only as option plumbing — 3 occurrences, never set to true — and its own handler acts only on `SessionStart` frames. The cloud lane sets `CLAUDE_CODE_REMOTE`, so its stream reports every hook event.

## Observed

Across all 901 local Cowork `audit.jsonl` files on the capturing machine (agent versions up to 2.1.280), every one of the 20,106 hook frames is `"hook_event":"SessionStart"`. That is the gate's signature; that other hooks ran and were hidden is read from the code, not observed — the sessions were not individually checked for other configured hooks.

## Two related details

- **`stop_hook_summary` does not reach the stream.** The agent builds it (`{type:"system", subtype:"stop_hook_summary", hookCount, …}`) when Stop hooks run, and the SDK schema describes it, but no code maps it into stream-json output, and `--include-hook-events` does not change that. 0 occurrences in the audit corpus.
- **A `hook_response` with `outcome:"error"` and no `exit_code`** comes from an HTTP hook whose request failed outright: the runner returns no status code, and the field is omitted. Cancelled hooks also omit it, with `outcome:"cancelled"`. A command hook always has an exit status.

## For anyone reading Cowork records

A local session's audit log or stream showing only `SessionStart` hook frames says nothing about whether your `PreToolUse` or `Stop` hook fired. Check the hook's own side effects, or reproduce outside Cowork with `--include-hook-events`.

