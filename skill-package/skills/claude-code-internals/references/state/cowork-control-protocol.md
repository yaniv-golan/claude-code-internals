---
domain: cowork-control-protocol
title: Cowork spawn + stream-json control protocol (current)
as_of_cli: 2.1.198
as_of_desktop: 1.17377.2
sources: [105, 107, 108, 109]
updated: 2026-07-03
---

# Cowork spawn + stream-json control protocol (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter). This is the contract to implement if you want to
*drive* the agent faithfully (a headless harness, an SDK integration, any
external driver) — not the Desktop app's internal IPC.

## Spawn contract

- **`CLAUDE_CODE_IS_COWORK=1` is the activation marker** — Cowork mode is
  selected by this env var, not a CLI flag. It gates *mode*, not hook
  discovery; distinguish it from `CLAUDE_CODE_SESSION_KIND="bg"`, the
  separate `/background`-fork axis.
- **The `--cowork` flag is rejected** by the agent invocation
  ("can only be used with user scope") — the SDK passes no `--cowork`.
- **Do not set `CLAUDE_CODE_USE_COWORK_PLUGINS`.** The Desktop never sets
  it. Its only effect is to flip user-settings to `cowork_settings.json`
  and the plugin cache dir to `cowork_plugins/` — files the host never
  populates in a real Cowork session, so setting it silently breaks
  settings + plugin reads. That namespace belongs to the *standalone*
  `--cowork` path, not the Desktop's account/org root (see
  `cowork-architecture.md`).
- **Argv, roughly:**
  `-p --verbose --input-format stream-json --output-format stream-json
  --permission-prompt-tool stdio`
  - `--verbose` is required with `--output-format=stream-json --print`.
  - **`--permission-prompt-tool stdio`** routes `can_use_tool` /
    AskUserQuestion to the driver. Without it, AskUserQuestion is silently
    auto-dismissed and scripted answers never fire.
  - **`--effort medium --max-thinking-tokens 31999`** are explicitly
    **driver-passed** by the Desktop, not agent defaults. The agent's own
    defaults: effort tiers `["low","medium","high","xhigh","max"]` with
    internal default `high` (`xhigh` for opus-4-7); thinking defaults to
    `{type:"adaptive"}` when `MAX_THINKING_TOKENS` is unset. The literal
    `31999` does not appear anywhere in the in-VM bundle — it is purely a
    desktop-passed number. `CLAUDE_EFFORT` as a `process.env` var is a
    no-op.
  - Full logged argv also carries `--model …`, `--setting-sources=user`,
    `--permission-mode default`, `--allow-dangerously-skip-permissions`,
    and one `--plugin-dir` per enabled plugin.

## Handshake

- **`initialize` is the first message.** The driver sends
  `{type:"control_request", request_id, request:{subtype:"initialize"}}`
  before the user turn. It also carries `systemPrompt`,
  `appendSubagentSystemPrompt` (gated by
  `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT=1`), `hooks`, and
  `sdkMcpServers`.
- **The `control_response` envelope is doubly nested:**

  ```json
  {"type":"control_response","response":{"subtype":"success","request_id":"…","response":{ /* payload */ }}}
  ```

  The payload sits under an **inner** `response`. Getting this wrong
  yields `ZodError: expected object, received undefined`.

## Subtype inventory pointer

The registry's `proto.*` entries are the canonical, versioned list of
control-protocol subtypes — do not duplicate that enumeration here. As of
the in-VM ELF 2.1.197, there are roughly 90 `subtype` tokens on the
combined control/transcript protocol, spanning session control, runtime
reloads, tasks/background, checkpointing/recap, scheduled tasks, memory,
model-fallback, and lifecycle/telemetry families. Consult the registry for
the full, current set. The load-bearing ones worth knowing by name:

- **`mcp_message`** (agent→driver) — the agent tunnels JSON-RPC for an SDK
  MCP server out as `control_request{subtype:"mcp_message", server_name,
  message:<jsonrpc>}`; the driver replies
  `control_response{response:{mcp_response:{jsonrpc:"2.0", id, result}}}`.
  The driver **is** the MCP server — it handles `initialize`/`tools/list`/
  `tools/call`. Declare `sdkMcpServers:["workspace"]` in `initialize` to
  connect one (surfaces as `mcp__workspace__bash` etc.).
- **`mcp_call`** (host→VM) — invoke any subprocess MCP tool by
  fully-qualified name (`mcp__server__tool`) through the control channel,
  bypassing the model turn entirely. Its own schema doc states *"No
  permission check (control channel is trusted, same as other
  subtypes)"* — a real trust boundary; SDK-type servers are excluded, this
  targets subprocess MCP clients only.
- **`rewind_files`** (host→VM) — roll files back to a prior user-message
  checkpoint: `{subtype:"rewind_files", user_message_id, dry_run?}`;
  `dry_run` previews without writing. Paired system message
  `file_snapshot` records each checkpoint. Gated by
  `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`
  (killable via `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING`).
- **`register_repo_root`** (host→VM) — add a working-directory root at
  runtime (must be a subdir of cwd), optionally carrying
  `reload_claude_md`/`reload_plugins`/`reload_skills` sub-flags. The
  runtime hook behind multi-repo workflows.
- **`scheduled_task_fire`** (VM→transcript, `type:"system"`) — emitted
  when a Desktop-scheduled cron/watcher task fires a session:
  `{type:"system", subtype:"scheduled_task_fire", content, isMeta:false,
  timestamp, uuid}`. The scheduling and watching itself live entirely in
  the Desktop host (`CoworkScheduledTasks`/`CCDScheduledTasks` IPC); the
  agent only receives and surfaces the fire event, rendered as a dim
  status line in the transcript.

Two dispatcher classification sets are worth knowing verbatim:
- **Blocking** (block message processing while in-flight): `Bv1 = {
  interrupt, set_permission_mode, set_model, set_max_thinking_tokens,
  set_color, mcp_toggle, message_rated }`.
- **Async-park** (handled out-of-band): `Uv1 = { can_use_tool,
  request_user_dialog, elicitation }` — `request_user_dialog` has a ~6s
  auto-cancel.

## AskUserQuestion answer shape

Question input: `input.questions[] = {question, header, options:
[{label, description}], multiSelect}`. To **allow**, reply with
`updatedInput.answers = Record<questionText, chosenLabel>` (schema:
`answers: z.record(z.string(), z.string())`). The model then proceeds with
the chosen answer. This is the over-the-wire answer shape for the same
AskUserQuestion tool documented elsewhere in this skill.
