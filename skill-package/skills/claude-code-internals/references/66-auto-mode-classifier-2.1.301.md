Updated: 2026-10-17 (L239; checked against the official CLI changelog through 2.1.302) | Source: a code read of the standalone **Claude Code CLI 2.1.301** binary (`~/.local/share/claude/versions/2.1.301`, a Bun executable read raw, since `extract-bundle.sh` truncates), traced end to end by a subagent and checked here first-hand for: the classifier-model choice (`n3e`, `KL`, `hKn`, `IL`), the server-or-local switch (`Ev`, `H9`) and its gates, the denial limits, the settings-source refusal and the failure messages. The rest is from that one read and marked so. Identifier counts are equal in CLI 2.1.294, 2.1.296, 2.1.299, 2.1.300 and 2.1.301.

# Chapter 69: How Auto Mode Decides

---

## TABLE OF CONTENTS

239. [Lesson 239 — How Auto Mode Decides Whether a Tool Call Runs, and Which Model Decides](#lesson-239--how-auto-mode-decides-whether-a-tool-call-runs-and-which-model-decides)

---

# LESSON 239 — HOW AUTO MODE DECIDES WHETHER A TOOL CALL RUNS, AND WHICH MODEL DECIDES

**In auto mode (`permissionMode: "auto"`) Claude Code first applies its ordinary rules and about ten shortcuts. Only a call that would otherwise ask you goes to a classifier, and the classifier answers block or don't block; it never asks you itself. On a claude.ai or Anthropic API account the decision is made by default on Anthropic's servers, as a safeguard attached to the main model request, so the deciding model can't be seen from the client. Otherwise, or when the server gives no verdict, the CLI asks a model itself: by default Sonnet 5, or a server-configured model, or the session's own model. Every failure blocks. After 3 blocks in a row or 20 in a session, an interactive session goes back to asking you, and a headless (`-p`) run stops.**

## Which model decides (CODE-READ)

**Who judges.** `Ev(mode)` picks one of three arrangements per call:

| account | default | when |
|---|---|---|
| claude.ai or Anthropic API (first party) | **server** (`arbiter`) | unless `CLAUDE_CODE_AUTO_MODE_SERVER=false`, or server switch `tengu_smooth_chipmunk` (default on) is off, or kill switch `tengu_iridescent_crystal` (default off) is on |
| Bedrock, Vertex, Foundry, a gateway or a custom endpoint (third party) | **server with local fallback** | unless `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` is set (and the host doesn't manage the provider) |
| either, with the server path off | **local** | as above |

**The server path.** The CLI adds the beta `dangerous-tool-use-2026-09-03` and a `dangerous_tool_use` safeguard to the main model request. The safeguard carries a context object: the permission mode, the session's rules, your `autoMode` lists, trusted folders, git state, prior-turn context and system reminders, halved to fit 256 KB and withheld above about 1 MB. Verdicts come back in the response stream (`safeguard_results`): flagged or not flagged per tool use, with an explanation. The client never names a model for this, so **which model judges on the server can't be determined from the code.** On the first-party path, if the server returns no result, the CLI falls back to its local classifier (switch `tengu_quiet_lantern`, default on) and stays local for the rest of the session.

**The local classifier's model** (`n3e`), in order:

1. **A server-configured model.** GrowthBook config `tengu_auto_mode_config` can name one per main model (`modelByMainModel`) or one for all (`model`). It is used only if the organization's model policy allows it; otherwise the CLI logs that it skipped it.
2. **Sonnet 5 (`KL`).** `ANTHROPIC_DEFAULT_SONNET_MODEL` if set and usable, otherwise the provider's own Sonnet 5 id (`_w().sonnet5`). So Bedrock, Vertex and Foundry each use their own Sonnet 5 id. Sonnet 5.5 and Opus 5.5 are refused here, with a log line saying the variable can't serve as the classifier. This step is skipped when the main model is Sonnet 4.5 or 4.6, and after a failed Sonnet 5 probe on a third-party provider (`externalSonnet5Probe: "demoted"`).
3. **The session's own model,** or the Opus default (`ANTHROPIC_DEFAULT_OPUS_MODEL`, else Opus 5) when the session runs Fable or Mythos.

CLI 2.1.302, which was not read here, adds `CLAUDE_CODE_AUTO_MODE_MODEL` to choose the local classifier's model. Per its changelog it doesn't change the server-side judge. Where it sits in this order is not established.

The request is a side query (`querySource: "auto_mode"`) through the session's own provider connection, so it is authenticated like the session and counts toward its usage. Per the changelog the server-side classifier is not charged for classifier overhead (2.1.278), and opting out of it makes the local one count (2.1.281). A 1M-context main model gives the classifier the `[1m]` variant.

## Before the classifier: the shortcuts (CODE-READ by the subagent; the messages checked here)

The ordinary evaluation runs first: deny rules, the tool's own permission check, ask rules, safety checks, then allow rules. In auto mode some allow rules are **ignored while auto mode is on** (not removed from your settings):
- Bash rules for interpreters and shells: `python`, `node`, `npx`, `npm run` and the other runners, `bash`, `sh`, `ssh`, `eval`, `exec`, `env`, `xargs`, `sudo` and similar;
- `curl`, `wget`, `kubectl`, `aws`, `gcloud` and `gsutil` rules with risky subcommands;
- risky PowerShell rules;
- some MCP tools.

`autoMode.classifyAllShell` suspends every shell allow rule.

Only a call that comes out as "ask" reaches the auto-mode branch. There, in order:
1. **`dontAsk` mode** denies; a headless run that must not prompt keeps the original answer.
2. **Always asks:** a hard safety check (protected paths and similar), a sandbox override, an ask rule, an MCP server's "ask" ceiling, and plan mode's floor. Telemetry `tengu_auto_mode_fallback_to_ask` names the reason.
3. **Allowed without the classifier:**
   - a call that would be allowed in Accept-edits mode (the dangerous allow rules still excluded);
   - tools on a safe allowlist (read-only tools and read-only Chrome actions, computer-use screenshots without `save_to_disk`);
   - a tool with no input the classifier cares about.
4. **Special cases:** Chrome grants, Desktop's SendMessage forwarding, and calls from plugins or synthesized by the harness have their own paths.
5. **The classifier.**

## What the local classifier sees (one code read)

- **A transcript.** Your messages and the agent's tool calls go inside `<transcript>`. Assistant prose goes in only when `priorAssistantContext` is on (env `CLAUDE_CODE_AUTO_MODE_PRIOR_ASSISTANT_CONTEXT` or the server config). Tool results appear to be left out (INFERRED).
- **The rest of the input:** other tool calls from the same turn, the pending call last, and repository visibility and git status.
- **A system prompt** of about 44 KB, compiled into the binary (sha256 `5c68972259c448f4…` in 2.1.301; the hash covers minified names, so it changes between builds). Its sections cover context, the threat model, the input, the default rule, scope, a user-intent rule, evaluation rules, the classification process and the output format.
- **The rule template**, a bundled asset (`permissions_external-df98b90a.txt.zst`, 96,102 bytes decompressed, sha256 `377ce3cba7577de2…`), whose defaults are 21 environment lines, 1 hard block (data exfiltration), 72 soft blocks and 17 allow exceptions. Your permission deny rules are included too, with an instruction to block the same effect done through another tool.
- **Two stages by default.** A fast pass (up to 64 tokens) answers `<block>yes</block>` or `no`. A "yes" goes to a second pass with thinking (up to 8,192 tokens) that gives the final answer and a `<reason>`. Temperature defaults to 1 (`CLAUDE_CODE_AUTO_MODE_TEMPERATURE`). The per-attempt timeout is 60 s, plus 10 s per 50k tokens above 50k, up to 120 s.

## Your own rules (CODE-READ)

`autoMode` in settings takes four lists: `allow`, `soft_deny`, `hard_deny` and `environment`. A list you set **replaces** the built-in one unless it contains the entry `"$defaults"`, which splices the built-in entries in at that point. These lists, and `classifyAllShell`, are read **only from user settings, `--settings` and managed settings**. Project and local settings are ignored with the warning "only user/flag/managed settings may set classifier rules (projectSettings and localSettings are repo-controllable)", so a repository can't loosen auto mode for whoever opens it. `permissions.disableAutoMode` turns the mode off.

## When it blocks, and when it fails (CODE-READ)

- **A block** becomes a denied tool call. The model gets the reason plus "If you have other tasks that don't depend on this action, continue working on those", sometimes with a hint that the user can add a permission rule. The model never gets an "ask" from the classifier.
- **Failures block.**
  - **Unavailable** (API error, timeout): logged "Auto mode classifier unavailable, denying with retry guidance (fail closed)". The model is told this is not a judgment that the action is unsafe, and when to retry.
  - **Retries:** up to 4 inner retries by default; outer retries default to 0 (server-configurable).
  - **An unreadable answer** blocks with a "transient, try again" message, and doesn't count toward the limits below. Neither does a refusal by the request's own safety safeguard.
  - **Transcript too long:** by default the call is denied and the conversation compacted, so the next call fits (`tengu_auto_mode_classifier_overflow_compact`, switch `tengu_merry_popcorn`, default on). Only with that switch off does an interactive session fall back to asking and a headless run stop ("Agent aborted: auto mode classifier transcript exceeded context window in headless mode").
- **Denial limits:** `maxConsecutive: 3`, `maxTotal: 20`. Any allow resets the consecutive count.
  - Interactive: at a limit the CLI goes back to asking you, saying how many actions were blocked and which was the latest. Reaching the total resets both counts.
  - Headless (`-p`): the run stops with "Agent aborted: too many classifier denials in headless mode".

## For a skill or plugin author

- **Don't rely on an allow rule for an interpreter.** `Bash(python:*)`, `Bash(npm run:*)` and similar don't pre-approve anything in auto mode; those calls go to the classifier.
- **Project settings can't tune it.** A repository's `.claude/settings.json` can't change `autoMode` rules; only the user's, `--settings` or managed settings can.
- **Headless runs stop rather than ask.** A `-p` job in auto mode ends after 3 blocks in a row or 20 in total. Design steps that a reviewer would read as clearly intended by the user's request.
- **The judge depends on the account.** On a claude.ai or API account the default judge is server-side and unknown; on Bedrock or Vertex it is also server-side by default, falling back to the provider's Sonnet 5. Behavior can differ between them for the same call.

## In the official changelog (checked 2026-10-17, through 2.1.302)

**Announced:**
- **Server-side by default:** for Claude API and Enterprise users and on Bedrock, Vertex, Foundry and gateways (2.1.278), on a direct API connection with telemetry off (2.1.282), and `CLAUDE_CODE_AUTO_MODE_SERVER=0`/`1` to opt out or in (2.1.281).
- **The local model:** Sonnet 5 by default for external sessions (2.1.210); an `ANTHROPIC_DEFAULT_SONNET_MODEL` pin naming Sonnet 5.5 or Opus 5.5 is ignored (2.1.288); the best available Opus for Fable sessions (2.1.176); `CLAUDE_CODE_AUTO_MODE_MODEL` (2.1.302).
- **Rules:** `"$defaults"` (2.1.118), `hard_deny` (2.1.136), `classifyAllShell` (2.1.193), and `autoMode` no longer read from `.claude/settings.local.json` (2.1.207).
- **Too long:** compaction instead of asking or failing, client-side (2.1.288) and server-side (2.1.302).
- **Failures:** the safety-check deadline scales with prompt size (2.1.246); a safety-filter refusal no longer counts toward the block limit (2.1.225).
- **Denials:** the message names the blocking rule and tells Claude to finish unrelated work (2.1.268).
- **Allow rules set aside:** `Monitor` allow rules are reviewed like Bash (2.1.236), and shell commands outside the risky patterns are classified only with `classifyAllShell` (2.1.193).
- **Headless:** `claude -p` starts in auto mode when no mode is configured, on third-party providers or with telemetry off (2.1.285).

**Not in the changelog:**
- **The server-side mechanism:** the `dangerous_tool_use` safeguard, its beta and the context it sends.
- **The model choice's details:** the server-configured model (`tengu_auto_mode_config`), the switches that choose server or local, and skipping Sonnet 5 when the main model is Sonnet 4.5 or 4.6.
- **How it judges:** the two-stage fast-then-thinking check, temperature 1, the timeout formula, the prompt's structure and the default rule counts.
- **Rule handling:** the list of interpreter and shell allow rules ignored in auto mode, and that project settings, not only local settings, are refused for `autoMode`.
- **Limits:** the 3-in-a-row and 20-per-session numbers, and the headless abort messages.
- **Order:** the order of the shortcuts.

Earlier lessons cover parts of this: auto mode becoming the default (L96), `classifyAllShell` (L111), Cowork's additions to the rule lists (L150), and Desktop's forced re-prompt for destructive connector tools (L128).

## Not established

- The server-side judge's model and rules.
- Whether the server path is on for a given account today: it depends on GrowthBook values the CLI receives at run time.
- When the server path first appeared: it is present unchanged from 2.1.294 to 2.1.301, and its beta name is dated 2026-09-03.
