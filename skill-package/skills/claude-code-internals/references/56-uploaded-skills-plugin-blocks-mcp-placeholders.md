Updated: 2026-09-28 | Source: **live probes on 2026-09-27/28** with Desktop **2.9939.2** and agent **2.1.281** on the local lane, a cloud Cowork task (`remote_cowork`) on the same account, and this Claude Code CLI session; **`app.asar` 2.9939.2** for the code paths; the Desktop log and the probes' own log files. **Does NOT move the CLI or Desktop baselines.**

Prompted by three open GitHub threads a sibling session was answering: a user who wants a personal skill in Cowork, a plugin whose prompt-blocking hook seemed to do nothing, and plugins whose MCP tools never appeared in Cowork.

# Chapter 59: Uploaded Skills, and Plugin Blocks and MCP Placeholders by Lane

---

## TABLE OF CONTENTS

217. [Lesson 217 — An Uploaded Skill Reaches Every Surface Whole](#lesson-217--an-uploaded-skill-reaches-every-surface-whole)
218. [Lesson 218 — Plugin Blocks and MCP Placeholders, Lane by Lane](#lesson-218--plugin-blocks-and-mcp-placeholders-lane-by-lane)

---

# LESSON 217 — AN UPLOADED SKILL REACHES EVERY SURFACE WHOLE

**A skill uploaded through Customize → Skills → + Add → Upload skill becomes an account skill. Within about a minute it reached the Claude Code CLI, a cloud Cowork session and a local Cowork session, each time with its full body, its scripts and its reference files. That is the simplest way to get a personal skill into Cowork, and unlike a skill from a folder granted to a cloud session (L197) it is not reduced to a stub.**

## The probe

A skill with a body marker, a script and a reference file was zipped with its folder at the top level and uploaded. The uploader requires that layout: it refuses a zip whose files are not inside one top-level folder, a zip without `SKILL.md`, and a zip containing `.claude-plugin/plugin.json` ("upload this content as a plugin instead"). Each surface was then asked to run it.

| | Claude Code CLI | cloud Cowork | local Cowork (host-loop) |
|---|---|---|---|
| listed as | `anthropic-skills:cci-upload-probe` | a synced skill | a synced skill |
| loaded from | `~/.claude/skills/synced/<org>_<account>/<skill>` | `/root/.claude/skills/synced/<org>_<account>/<skill>` | the Desktop's skill store, reached through `/var/folders/…/claude-hostloop-plugins/<hash>/<account>/skills/<skill>`; the shell sees `/sessions/<slug>/mnt/.claude/skills/<skill>` |
| body | whole | whole | whole |
| script | ran (macOS `sh`) | ran as root (`dash`) | ran (`dash`), from a read-only mount (`dr-x------`) |
| reference file | read | read | read through the host path |

The Desktop logged the download (`[SkillsPlugin] Delta: 1 to download … 1 downloaded`) and stored the skill under `local-agent-mode-sessions/skills-plugin/<org>/<account>/skills/`. The host-loop staging is the same symlink mechanism as plugin files (L89). In the local shell, a host path to the skill given to a command was translated to the shell's own `/sessions/…` path.

On this machine the Desktop keeps a skill store for two account/org pairs, and the uploaded skill appeared in both. The CLI used one, local Cowork the other. Why both received it was not determined.

## A conversation that changed runtime

In the cloud run, the session reported that the first invocation, earlier in the same conversation, had given the base directory `/mnt/skills/plugins/cci-upload-probe`. That is the chat runtime's flat skills mount. The second invocation gave the Cowork container path. So that conversation started on the chat runtime and was moved into a Cowork workspace, as L216 describes. This rests on the model's report of its own earlier turn, a single observation.

## For an author

- To give a user a personal skill in Cowork, have them upload it as a skill. Scripts come with it and run on every surface.
- Write the scripts for Linux as well as macOS: in both Cowork lanes they run under `dash`.
- In local Cowork the skill's files are read-only, so write anything to the outputs folder, not next to the skill.

---

# LESSON 218 — PLUGIN BLOCKS AND MCP PLACEHOLDERS, LANE BY LANE

**A plugin's UserPromptSubmit hook can block a prompt in both Cowork lanes. Locally the user sees why. In the cloud the prompt simply disappears: no reply, no notice, and the model never sees it. PreToolUse denies work in both lanes. For a plugin's MCP servers, only a few standard variables are ever filled in: any other `${VAR}` reaches the server as literal text, even when the variable is set, and a plugin-setting placeholder (`${user_config.…}`) stops the server in the cloud.**

## The probe

A plugin uploaded through Customize → Plugins → + Add → Upload plugin carried:

- three UserPromptSubmit hooks, each triggered by its own word in the prompt: a script that prints `{"decision":"block","reason":…}`, the same JSON from an inline `printf` in `hooks.json`, and a script that exits 2 with a message on stderr;
- a PreToolUse hook on `Bash|mcp__workspace__bash` that denies any command containing a trigger word;
- five stdio MCP servers that differ only in their config: no placeholder, `${HOME}`, an unset `${CCI_PROBE_TOKEN}`, `${CCI_PROBE_TOKEN:-fallback-value}`, and `${user_config.api_key}` with a default. Each server's one tool reports the arguments and environment it received.

The local run used a local session (`local_2e888613…`); the cloud run a new composer task whose shell was in `/home/claude`.

## Prompt blocks

| | local (host-loop) | cloud |
|---|---|---|
| JSON `decision:block` from a script | blocked each time (3 tries) | blocked each time (2 tries) |
| the same JSON from an inline `printf` | blocked (2 tries) | blocked |
| exit 2 with stderr | blocked | blocked |
| what the user sees | **"Blocked by your organization's policy"**, the hook's reason, "You can restart the conversation from an earlier message" and **Go back** | **nothing**: the message stays, with no reply and no notice |
| does the model see the prompt | no | no (asked to list every message it could see, it listed none of the four) |

The cloud hook log recorded all four triggers, so the hooks ran; the turns were stopped. Locally, the notice calls a block from the user's own plugin an organization policy, and the Desktop log says the same (`[Result] Prompt stopped by an organization hook`). For an exit 2 it also shows the hook command and "This hook comes from the cci-probe2@inline plugin": an uploaded plugin's marketplace name is `inline`. Two of the local **Go back** rewinds failed in the log ("Cannot tell what precedes … on disk — aborting rewind").

## Tool denies

A PreToolUse deny was honoured on both lanes: "PreToolUse:mcp__workspace__bash hook error: cci-probe2: denied by PreToolUse hook" locally, and "PreToolUse:Bash hook error: …" in the cloud, where the shell is `Bash`. This is the first live deny on a current agent; earlier evidence was from agents 2.1.78 and 2.1.92.

## MCP server placeholders

| config | local (the agent starts the server) | cloud (the Desktop starts it on the Mac and bridges it) |
|---|---|---|
| no placeholder | starts | starts |
| `${HOME}` | expanded to `/Users/<user>` | expanded to `/Users/<user>` |
| `${CCI_PROBE_TOKEN:-fallback-value}` | `fallback-value` | `fallback-value` |
| `${CCI_PROBE_TOKEN}`, unset | starts; receives the literal text `${CCI_PROBE_TOKEN}` | starts; receives the literal text |
| `${CCI_PROBE_TOKEN}`, **set** in the Desktop's environment (`launchctl setenv`, app restarted) | still the literal text | still left as written (Desktop log, below) |
| `${CCI_PROBE_TOKEN:-fallback-value}` with the variable set | `fallback-value` | `fallback-value` (by the code) |
| `${user_config.api_key}` with a default | starts; receives the default | **not started**: `get_device_info` lists it as `not_started`, reason `user_config_unsupported` |
| working directory | `/private/var/empty` | `/` |

In the cloud, each call to a bridged server was approved through the Desktop's own prompt ("Claude wants to use Report default from plugin cci-probe2 cci-default", with Decline / Always allow / Allow once). Locally it went through the session's normal tool approval. The cloud rule matches the code: the Desktop drops any plugin server whose config references plugin settings, and says so only in its log and in `get_device_info` (asar 2.9939.2, `[PluginMcpHostConfig]`).

**Only a safelist is filled in.** In the cloud, the Desktop fills placeholders in a plugin server's command, arguments and environment from a fixed list, by exact name: `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER` on macOS and Linux (a longer list on Windows), plus `CLAUDE_PLUGIN_ROOT`. Anything else is left as written, even when the Desktop's own environment has it, and `${NAME:-default}` then yields the default. `CLAUDE_PROJECT_DIR` and `CLAUDE_PLUGIN_DATA` are also left as written, with their own warning. The server's environment is only those safelisted values plus the config's own `env` block. After a restart with `CCI_PROBE_TOKEN` set, the Desktop still logged:

```
[PluginMcpHostConfig] Plugin "plugin_…" server "cci-unsetvar": config uses environment variables the desktop does not fill in for plugin servers: CCI_PROBE_TOKEN. They were left as written. Only CLAUDE_PLUGIN_ROOT and the variables every local server receives (such as PATH and HOME) are filled in, by exact name.
```

The rule is old. Builds 1.18286.2 to 1.46388.4 log it as "config references environment variables outside the MCP stdio safelist … left unexpanded"; from 2.2553.1 the wording is the one above. On the local lane the set variable also arrived literal. That lane has its own copy of the same six-name list: the local agent runs with the `local-agent` entrypoint, where `CLAUDE_CODE_MCP_ALLOWLIST_ENV` defaults on and a server it spawns gets only `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER` plus its own `env` block (L61). That the placeholder expansion draws on the same restricted set is consistent with the measurement, but was not traced in the agent.

**Where the full environment does reach a server.** A server listed in the Desktop's own `claude_desktop_config.json` is started by the Desktop with the full host environment plus its `env` block, and Cowork sessions see it on both lanes (L89, measured 2026-06-02). So a credential that a plugin server cannot receive can be given to the same server there, in its `env` block.

## For an author

- A blocking prompt hook works in Cowork, but in the cloud the user gets no feedback at all. If the block matters to the user, tell them another way, or block at the tool level, where the model sees and reports the denial.
- Do not pass a credential to a plugin's MCP server through an environment placeholder. Outside the standard variables it arrives as literal text in both Cowork lanes, set or not, so the server starts and then fails to authenticate. A `:-` default only hides this. Have the server read its credential itself, for example from a file under the user's home folder or from the system keychain, and treat a value that still looks like `${…}` as missing. A user can also add the server to `claude_desktop_config.json` with the key in its `env` block.
- Do not use `${user_config.…}` in a plugin MCP server that must work in cloud Cowork: the server is silently left out there.
- To see why a plugin server is missing from a cloud session, ask the session to call `get_device_info`: its `localMcpServers` entries carry each server's state and the reason it did not start.
