Updated: 2026-10-02 | Source: **first-hand probe runs on 2026-10-01/02** (Desktop 2.19675.0 and claude.ai web, cloud agent 2.1.287) for which loader expands a skill in the cloud; **live probes on 2026-09-27/28** with Desktop **2.9939.2** and agent **2.1.281** on the local lane, a cloud Cowork task (`remote_cowork`) on the same account, and this Claude Code CLI session; **`app.asar` 2.9939.2** for the code paths; the Desktop log and the probes' own log files; and **relayed live runs in cloud Cowork on 2026-10-01** (Desktop 2.16120.0, cloud agent 2.1.286, a peer session's probes) for the `.skill` card, and **CLI 2.1.286** (the same version string the cloud agent reported) for the inline-command expander. **Does NOT move the CLI or Desktop baselines.**

Prompted by three open GitHub threads a sibling session was answering: a user who wants a personal skill in Cowork, a plugin whose prompt-blocking hook seemed to do nothing, and plugins whose MCP tools never appeared in Cowork.

# Chapter 59: Uploaded Skills, and Plugin Blocks and MCP Placeholders by Lane

---

## TABLE OF CONTENTS

217. [Lesson 217 — An Uploaded Skill Reaches Every Surface Whole](#lesson-217--an-uploaded-skill-reaches-every-surface-whole)
218. [Lesson 218 — Plugin Blocks and MCP Placeholders, Lane by Lane](#lesson-218--plugin-blocks-and-mcp-placeholders-lane-by-lane)

---

# LESSON 217 — AN UPLOADED SKILL REACHES EVERY SURFACE WHOLE

**A skill uploaded through Customize → Skills → Add skill → Upload skill becomes an account skill. Within about a minute it reached the Claude Code CLI, a cloud session and a local session, each time with its full body, its scripts and its reference files. That is the simplest way to get a personal skill into Cowork, and unlike a skill from a folder granted to a cloud session (L197) it is not reduced to a stub.**

## The probe

A skill with a body marker, a script and a reference file was zipped with its folder at the top level and uploaded. The uploader requires that layout: it refuses a zip whose files are not inside one top-level folder, a zip without `SKILL.md`, and a zip containing `.claude-plugin/plugin.json` ("upload this content as a plugin instead"). Each surface was then asked to run it.

| | Claude Code CLI | cloud session | local session (host-loop) |
|---|---|---|---|
| listed as | `anthropic-skills:cci-upload-probe` | a synced skill | a synced skill |
| loaded from | `~/.claude/skills/synced/<org>_<account>/<skill>` | `/root/.claude/skills/synced/<org>_<account>/<skill>` | the Desktop's skill store, reached through `/var/folders/…/claude-hostloop-plugins/<hash>/<account>/skills/<skill>`; the shell sees `/sessions/<slug>/mnt/.claude/skills/<skill>` |
| body | whole | whole | whole |
| script | ran (macOS `sh`) | ran as root (`dash`) | ran (`dash`), from a read-only mount (`dr-x------`) |
| reference file | read | read | read through the host path |

The Desktop logged the download (`[SkillsPlugin] Delta: 1 to download … 1 downloaded`) and stored the skill under `local-agent-mode-sessions/skills-plugin/<org>/<account>/skills/`. The host-loop staging is the same symlink mechanism as plugin files (L89). In the local shell, a host path to the skill given to a command was translated to the shell's own `/sessions/…` path.

On this machine the Desktop keeps a skill store per organization/account pair. The uploaded skill appeared in two of them, and the CLI used one while a local session used the other: each surface reads the store of the organization it is in (see below).

## What the agent does with a skill's text, by how it was installed

Read from agent 2.1.281. Uploaded skills load with `loadedFrom: "syncedSkills"`, and the agent treats them differently from plugin skills and skills in `.claude/skills`:

```js
function BHe(e){if(e.loadedFrom==="syncedSkills")return!eSr();return r(e)}
function eSr(){return Boolean(a.CLAUDE_CODE_REMOTE)||Boolean(a.CLAUDE_CODE_IS_COWORK)||Bj()}
// standalone skill: if (MMo(loadedFrom, source) && Z4()) disable; else if (!BHe(...)) run the !`cmd` blocks
// plugin skill:     if (Z4()) disable; else run
```

`Z4()` is the switch-off: it is true when the agent process has `CLAUDE_CODE_IS_COWORK`, or when managed or user settings set `disableSkillShellExecution`. A disabled block is replaced by the literal text `[shell command execution disabled by policy]`, not removed.

| surface | plugin skill's `` !`cmd` `` | uploaded skill's `` !`cmd` `` |
|---|---|---|
| Claude Code CLI | expanded (below) | **not run, left as raw text** (a synced skill is untrusted there) |
| cloud session (`CLAUDE_CODE_REMOTE` set, `CLAUDE_CODE_IS_COWORK` absent) | expanded (below) | expanded (below) |
| local session (`CLAUDE_CODE_IS_COWORK` set) | replaced by the marker (seen live: Desktop 2.19675.0, agent 2.1.286, 2026-10-02, with the command allowed) | replaced by the marker |

The cloud rows assume the runner sets no managed `disableSkillShellExecution`; that was not checked live. The same trust check decides `${CLAUDE_PROJECT_DIR}` and `${CLAUDE_SESSION_ID}` in an uploaded skill: substituted in the cloud, left as written in the CLI. In the agent's code (CLI 2.1.286), `${CLAUDE_SKILL_DIR}` is substituted with the skill's own folder for every kind of skill that gets a "Base directory for this skill:" line. The line and the substitution hang on the same condition in each loader, and a plugin skill also always gets `${CLAUDE_PLUGIN_DATA}` substituted. A cloud session does not always match this (see below). An uploaded skill is registered under a qualified name (`anthropic-skills:<name>` in the CLI) with the bare name as an alias.

**What "expanded" means: each command goes through the shell tool's permission check.** Read from CLI 2.1.286, and the same in 2.1.287; there is no exception for any path, `/proc` included. The 2026-10-02 cloud probe runs below all declared their command in `allowed-tools`, so they took the first branch. Standalone and plugin skills both reach one expander (`Cle`), which runs every `` !`cmd` `` through the shell tool's permission check, with the skill's `allowed-tools` added as allow rules for that check, when the agent honours them for the skill's source. The per-source test (`ipn`) passes for every source unless managed settings set `allowManagedPermissionRulesOnly`. Under that policy only skills from managed settings, built-in and bundled skills, and plugins from Anthropic's own or a managed marketplace keep their `allowed-tools`. For any other skill the list is dropped, with the warning "Ignoring allowed-tools … permission rules are restricted to managed settings (allowManagedPermissionRulesOnly)". Three outcomes:

- **Allowed:** the command is executed and its output replaces the block.
- **Needs approval, and the session is in auto mode:** the command is not run. The block is rewritten into an instruction to the model, `` [run this first, exactly as written, and use its output: `<cmd>`] `` (a fenced block instead when the command contains a backtick or a newline; the PowerShell form names the tool). Several such commands become one header, `[Run these N commands first, exactly as written, …]`, with `[output of command N, …]` placeholders where each output belongs. The command runs only if the model then runs it with a tool call; the agent logs `skill_inline_command_handoff`, and `not_run` at the turn's end if it never did. The handoff is behind two flags, `tengu_iterative_falcon` and `tengu_glowing_orbit`, both default on in the binary (no gate state was captured for the cloud agent).
- **Anything else** (needs approval outside auto mode, or denied): the skill fails to load with "Shell command permission check failed for pattern …".

Measured in the CLI 2.1.286 (`claude -p` with `--plugin-dir`, default permission mode, 2026-10-01): a plugin skill's `` !`cat secret.txt` `` on a file in the working directory ran, and its random contents appeared in the injected skill text with no tool call but `Skill`; a command writing a `uuidgen` value to a file failed the load with "Shell command permission check failed for pattern …: Contains shell syntax … that cannot be statically analyzed", and no file was written. A sibling session's runs on the same build agree, and add that the write ran under `--permission-mode bypassPermissions` and that a `cat` outside the working directory also failed the load. The CLI never showed the bracketed rewrite, as expected outside auto mode. In one of the sibling's failed loads the model then tried to invoke a settings skill to widen its permissions (denied under `-p`).

The expander marks the check as being for a prompt shell command (CLI 2.1.286, whenever `tengu_iterative_falcon` is on). In auto mode that check runs as if the session were in default mode, so the auto-mode classifier never approves a skill's `` !`cmd` ``: only allow rules, the skill's own `allowed-tools` and what default mode allows without asking let it run. Which commands default mode allows in general was not traced. A coordinator's read-only skill load is a fourth case, with its own marker: `[shell command not executed: read-only skill load on the coordinator — delegate to a worker to run it]`.

In cloud Cowork, a run on 2026-10-01 (Desktop 2.16120.0, cloud agent 2.1.286, relayed from a peer session) showed the rewrite: a plugin skill whose command wrote a random value to `/tmp` came back as the bracketed instruction, the model was told not to run anything, and the file did not exist afterwards. A read, `` !`cat /proc/sys/kernel/random/boot_id` ``, was rewritten the same way; the model's own `cat` in the next turn returned the value, so nothing had run it. That read is outside the working directory (`/home/claude`), which is also what made a read fail the load in the CLI. A read inside the working directory ran: the model wrote a random value to `/home/claude/v.txt` without printing it, a plugin skill's `` !`cat v.txt` `` came back with that value and no tool call, and the model's own `cat` in the next turn matched. So the cloud session follows the same three outcomes as the code: an allowed command runs, one that needs approval is handed to the model. These cloud runs are relayed from a peer session (cloud Cowork, agent 2.1.286); only the CLI runs above were made here. The handoff branch requires auto mode, so the code path implies those sessions were in auto mode; the mode itself was not recorded.

## Creating and changing a skill by asking in chat

A Cowork task with `save_skill` (granted as described in L206) can create a skill and change an existing one. Measured on 2026-09-29 (Desktop 2.9939.4) and read from its code:

- **The user confirms each save.** Asked to create a skill, the model showed a **Save skill** card (name, description, the content behind a disclosure, **Dismiss** / **Save**); nothing was saved until the user clicked Save. Asked in a later, separate task to change it, it showed an **Update skill** card reading "Replaces your current /cci-chat-skill", with **Update**.
- **It goes through the same upload as Customize.** The Desktop writes one `SKILL.md` from the name, description and content, zips it and posts it to the account's `/skills/upload-skill` endpoint, tagged `upload_source=cowork_save_skill`. The result is an ordinary account skill.
- **A new skill is body-only.** The tool takes a name, a description and the instructions; it has no way to add scripts or reference files.
- **An update replaces `SKILL.md` and keeps everything else.** With `overwrite`, the Desktop first asks the server to carry the other files forward; if that fails, it downloads the existing skill and re-uploads it with the new `SKILL.md`. Measured: an uploaded skill with a script and a reference file was changed in chat; its `SKILL.md` gained the new line and both other files were still there. Only the user's own skills can be updated, not Anthropic's or a plugin's.
- **It propagates like an upload.** The Desktop pulled the new skill 50 seconds after the create and the new version under a minute after the update, and the CLI received the updated body.
- **The tool says it is the only way to change a saved skill:** editing the skill's files on disk does not persist.
- **A sent `.skill` file has its own Save skill button, and it installs the whole package.** In a cloud session, a `.skill` file sent with `SendUserFile` renders as a card with **Download** and **Save skill**; the preview pane has another **Save skill**. Clicking it created the skill in Customize → Skills with its script included ("Contents · 2"). That session had no `save_skill`, only `propose_skills`, so this route does not depend on the L206 grant. On the chat runtime, `present_files` renders the same card for a `.skill`. Relayed from a peer session's runs on 2026-10-01 (Desktop 2.16120.0), one observation each.

**Skills belong to an organization.** Asked to change `cci-upload-probe`, a session in one organization answered that no such skill existed: it had been uploaded while the Desktop was in a different organization. After it was uploaded again in the session's organization, the update worked. This is also why the same skill had appeared in two stores above: each is one organization/account pair.

## In the cloud, which loader expands a skill depends on whether the session exists yet

A cloud conversation reaches a skill by one of two paths, and the path is set by one thing: whether the conversation's cloud code session (`cse_…`) exists when the skill is invoked. Measured on 2026-10-01 and 2026-10-02 in this project's own probe runs (Desktop 2.19675.0 and claude.ai on the web, cloud agent 2.1.287, two accounts and three organizations, a plugin skill that reports its own text and runs one `` !`cmd` ``). The web and Desktop runs on one account used the same machine and Chrome, so their agreement shows the client does not change the result; it is not replication on separate hardware.

**The session starts lazily.** On the merged composer (a "New" conversation with no Chat/Cowork choice, `claude.ai/chat/…`), a conversation has no session at first. The first turn that needs a shell or a file tool creates it: a transient "Getting set up for this session" notice with an elapsed-seconds counter appears for about 5 to 7 seconds, the client then fetches `/v1/code/sessions/cse_…` (seen in the web client's network log), and the header shows the computer as connected. In another session, relayed, the notice appeared while a sub-agent dispatched by the first message was running, so it is the first work that needs the container, not only a shell call by the main conversation. In the web log of a first-message skill run the skill was loading 2 seconds after the send, the setup notice came at 12 seconds and the first session fetch at 14. Tools that act on the user's computer through the device bridge, such as Chrome, do not create a session. Where the older composer still offers a Chat/Cowork choice, a Cowork conversation (`claude.ai/cowork/cse_…`) has its session from the first turn. On 2026-10-02 the Personal organization had the merged composer and the Team organization the older one, which looks like a rollout by organization or account. Right after switching organizations the app can show the previous composer until a refresh (one Personal run started on the older composer that way).

| | session not there yet: expanded outside the agent | session there: Claude Code's loader in the container expands it |
|---|---|---|
| when | a skill typed or invoked as a merged-composer conversation's first message, before any shell or file work | after a shell or file turn in the same conversation; any turn of an older-composer Cowork conversation |
| UI, typed invocation | a "Loaded skill <plugin> (<skill>)" row | no such row (a model invocation shows "Loaded a skill" / "Running skill: …" on this path too) |
| base-directory line | `/mnt/skills/plugins/<plugin>:<skill>`, which does not exist in the container | the synced plugin's real folder under `/root/.claude/plugins/synced/<organization>_<account>/<plugin>/` |
| `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_DATA}` | left as written | filled (data under `/root/.claude/plugins/data/<plugin>-synced`) |
| `$ARGUMENTS` (the text after the slash command) | left as written | replaced with the typed argument |
| `` !`cmd` `` | left as raw text, never run, no marker | run, through the permission check above (in every probe run the command was in the skill's `allowed-tools`) |
| an allowed `` !`cmd` `` that then fails | shown raw; the turn goes on | see below |
| runs | 5 (web and Desktop, two accounts) | 2 on the merged composer after a shell turn, 6 on the older composer |

Claude Code's loader is the plugin loader described above (CLI 2.1.286, read here): it replaces `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_DATA}` when the plugin has a source, and `${CLAUDE_SKILL_DIR}` in skill mode. The other path is not in Claude Code: `/mnt/skills` occurs in neither the CLI nor Desktop 2.16120.0, and in the web log the skill was expanded before any session existed, so something outside the container expands it, most likely the claude.ai chat backend (inferred, not traced). The probe skill's text matched the copy on disk on both paths, so neither serves a stale version. A new version uploaded through Customize → Plugins (replacing the user's own upload, not published to the organization) was already in the first cloud session started after it: the upload was confirmed at 12:14:30Z and the session's skill ran at 12:16:18Z, so it arrived in under 2 minutes (one run, one Team organization). In a container started by the older composer, `/mnt/skills/plugins` did not exist at all (one run).

**Only the skill's own text differs between the paths.** In the same turn as a skill expanded outside the agent (2026-10-02, Desktop 2.19675.0 and the web, a Personal organization on the merged composer; two runs on one machine, so not independent; the other path checked once), the rest of the plugin worked as on Claude Code's path:

- the plugin's sub-agent (`subagent_type` `<plugin>:<agent>`) resolved and ran, and its body's `${CLAUDE_PLUGIN_ROOT}` was filled with the synced plugin root (found in the session transcript next to a value only that agent could have written);
- `Read` on the synced plugin's absolute path worked (a line only that file held came back);
- a file the sub-agent wrote under `/home/claude` was visible to the main conversation;
- the plugin's `PreToolUse` hook (matcher `Agent|Task`) and `Stop` hook fired, and `Stop` also fired on turns that did not use the skill;
- `AskUserQuestion` rendered its form on the first turn.

The Desktop and web interfaces do not expand `Read` or agent rows, so those were checked through values the model could not have guessed.

**Every first-turn route takes the outside path (Desktop 2.19675.0, Personal organization, merged composer, 2026-10-03; one run each, from the tool rows the interface rendered, since cloud transcripts are not on the Mac).** Each of these, as a conversation's first message, showed "Loading skill", then "Loaded skill <skill> (<plugin>)", with the tokens and `$ARGUMENTS` left as written, and "Getting set up" only afterwards:

- the skill typed as a slash command;
- a plain-language request that names what the skill does ("Please run the path report diagnostic…"), with no Skill tool row, so the skill was attached before the session existed rather than called by the model (inferred from the missing row);
- a skill with `user-invocable: false`, which is not in the slash menu, asked for in plain language;
- a file attached with "review my deck", which loaded the probe's own `deck-probe` skill although another enabled plugin also has a deck-review skill (why that one was picked is unknown); the attachment did not start the session first.

A turn with no tool use does not start the session either: a skill typed after a plain chat turn still took the outside path, and the next skill typed after that turn's tool use took Claude Code's path. The skill text expanded outside the agent is still recorded in the session transcript: the container's transcript held a line with "Base directory for this skill: /mnt/skills/plugins/path-report:path-report" and the literal `$ARGUMENTS`. A plugin sub-agent read files through its own body's `${CLAUDE_PLUGIN_ROOT}` and through an absolute synced path given in its prompt on both paths. The cloud composer's slash menu has no `/compact`.

## Two plugins with the same name

What happens when a user installs a private copy of a plugin the organization already provides (Desktop 2.19675.0, Team organization, 2026-10-03; from the UI unless marked):

- **Uploading.** When the organization library already has a plugin of that name, the upload form proposes a new name (`<name>-2`) and says "Give yours a different name to keep both, or use the org’s version above", with a button to keep the original name. Uploading a private copy of a plugin the organization has from somewhere else (most likely a marketplace, not confirmed) showed no such prompt.
- **Both are delivered.** In a local session both copies were staged and listed in the config record's `pluginInstallPaths` (read on disk).
- **The slash menu shows two identical entries**, with nothing to tell them apart. In a cloud session the first entry loaded the private copy, and only that copy was found on disk in the container (one run). In a local session both entries loaded the marketplace copy (0.11.1, not the private 0.14.1 build; read from the skill's "Base directory" line in two sessions). So the menu position does not pick a copy, and the private copy could not be reached by slash command locally.
- **A typed name can be refused before anything runs.** With the two copies installed, the bare `/<skill>` and the qualified `/<plugin>:<skill>` gave "Unknown skill: …". The interface raises that message itself (`outcome:"unknown_skill"` in the claude.ai bundle in `ion-dist`), so no session starts. With a single plugin whose name differs from its skill's (`cci-probe4`, skill `probe4`), the bare `/probe4` was also "Unknown skill", while the menu entry sent `/cci-probe4:probe4` and worked; with a plugin named like its skill the bare form works. Whether a bare name needs that match or only needs to be unambiguous is not known.
- **Removing the organization's copy does not remove a member's installation.** After the plugin was deleted from the organization library, the member's own enabled installation of it was still listed and had to be removed separately (one run).


**A `` !`cmd` `` the skill allows that then fails in the container.** Every probe declared its command in the skill's `allowed-tools`, so the permission check let it run and it then failed: one probe used `uuidgen`, which the cloud container does not have, another a command that does not exist. A failing command the skill does not list was not tested; under the rule above it is handed to the model or fails the load at the permission check, before it runs. For an allowed command, what the user sees depends on how the skill was invoked:

- **Typed as a slash command, with the session up:** the turn never gets a reply and shows no error (eight runs, web and Desktop, both composers; seven were watched for five minutes or more). On the merged composer the turn looks dead: no "Loading skill", no Stop button, and in the one recorded run the typing dots went within a second. On the older Cowork composer it shows "Working on it…" with a running timer and a Stop button, and never resolves. A plain request in a control conversation was answered within 30 seconds.
- **Invoked by the model:** the skill fails to load with `` Shell command failed for pattern "!`uuidgen`": [stderr] /bin/bash: line 3: uuidgen: command not found ``, and the model went on by reading `SKILL.md` from disk, where the tokens are unfilled (one run).
- **Before the session exists:** the command is never run, so nothing fails.
- **In a local session:** the command is never run either; the text gets the disabled-by-policy marker (table above), so the turn goes on normally.

## A conversation that changed runtime

In the cloud run, the session reported that the first invocation, earlier in the same conversation, had given the base directory `/mnt/skills/plugins/cci-upload-probe`. That is the chat runtime's flat skills mount. The second invocation gave the cloud session's container path. So that conversation's first invocation took the path outside the agent and the second Claude Code's loader, which fits the rule above if the session was created between them (not recorded for that run). This rests on the model's report of its own earlier turn, a single observation.

## For an author

- To give a user a personal skill in Cowork, have them upload it as a skill. Scripts come with it and run on every surface.
- Write the scripts for Linux as well as macOS: in both local and cloud sessions they run under `dash`.
- In a local session the skill's files are read-only, so write anything to the outputs folder, not next to the skill.
- A skill that may be the first message of a cloud conversation cannot rely on `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `$ARGUMENTS` or `` !`cmd` `` in its `SKILL.md`: before the session exists they arrive as written and the command is never run. Give a script path a fallback that finds the skill's folder, for example by searching `/root/.claude/plugins` for it, and have the skill read its argument from the user's message when `$ARGUMENTS` comes through literally. Only `SKILL.md` needs this: the plugin's agent bodies, hooks and files work on both paths.
- To hand a user a skill with scripts in a cloud session, package it as a `.skill` file and send it: the card's Save skill installs every file. `save_skill` saves the instructions only.
- Do not depend on `` !`cmd` `` in a skill: whether it runs depends on the lane, on how the skill was installed, on the permission check for that command and, in the cloud, on whether the conversation's session exists yet. A command that needs approval is handed to the model in auto mode, which may or may not run it, and makes the skill fail to load in any other mode. Tested only in the CLI with an uploaded skill, it looks broken when it is not.
- A `` !`cmd` `` that fails the check turns the skill load into a permission error the model sees, and a model can respond by trying to widen its own permissions. Keep inline commands to reads inside the working directory, or declare them in `allowed-tools`.
- A `` !`cmd` `` the skill allows in `allowed-tools` that then fails in the cloud container leaves a typed slash command with no reply and no error, and makes a model invocation fail to load (an unlisted failing command was not tested). Use only tools every lane has: the cloud container has no `uuidgen`.
- A value the model "reports" for a `` !`cmd` `` with no tool call in the transcript is the model filling in a handed-off command, not output. To test whether a block ran, have the command leave something the model cannot guess (a random value written to a file, or a stable unguessable value such as `/proc/sys/kernel/random/boot_id`) and check it independently afterwards.

---

# LESSON 218 — PLUGIN BLOCKS AND MCP PLACEHOLDERS, LANE BY LANE

**A plugin's UserPromptSubmit hook can block a prompt in both local and cloud sessions. Locally the user sees why. In the cloud the prompt simply disappears: no reply, no notice, and the model never sees it. PreToolUse denies work in both lanes. For a plugin's MCP servers, only a few standard variables are ever filled in: any other `${VAR}` reaches the server as literal text, even when the variable is set, and a plugin-setting placeholder (`${user_config.…}`) stops the server in the cloud.**

## The probe

A plugin uploaded through Customize → Plugins → Add plugin → Upload plugin (the labels as seen on 2026-10-02) carried:

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
| what the user sees | **"Blocked by your organization's policy"**, the hook's reason, "You can edit your message and send it again." and **Go back**, which removes the message and puts its text back in the composer (Desktop 2.19675.0, 2026-10-02, from the UI) | **nothing**: the message stays, with no reply and no notice |
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
| `${CLAUDE_PLUGIN_ROOT}` | the host staging path, `$TMPDIR/claude-hostloop-plugins/<hash>/plugin_<id>` | filled (the safelist below) |
| `${CLAUDE_PLUGIN_DATA}` | filled: `$TMPDIR/claude-hostloop-plugins/<hash>/plugins/data/<plugin>-inline` | left as written |

In the cloud, each call to a bridged server was approved through the Desktop's own prompt ("Claude wants to use Report default from plugin cci-probe2 cci-default", with Decline / Always allow / Allow once). Locally, on Desktop 2.19675.0, each tool's first call showed a card "Claude wants to use report_userconf from cci-probe3:cci3-userconf" with Deny / Allow for this task / Allow once (from the UI). Uploading a plugin that has stdio MCP servers showed, after a delay, "This plugin includes local MCP servers" with the servers listed, "Installing will grant access to everything available to Cowork", and Disable plugin / Continue (UI, Team organization).

**Local rows on Desktop 2.19675.0 (2026-10-02, a second probe plugin).** Two servers declared `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and, in one, `${user_config.api_key}` (with a default) in their arguments and `env`. All three arrived filled, the plugin setting with its default and no settings form shown first. The servers ran on the Mac with `HOME` the user's home and the user's full `PATH`; besides the basic login variables (no `TERM`) their environment held `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and `CLAUDE_PROJECT_DIR` (the probe used `/usr/bin/python3`, which can add Xcode variables such as `SDKROOT` itself). The cloud rule matches the code: the Desktop drops any plugin server whose config references plugin settings, and says so only in its log and in `get_device_info` (asar 2.9939.2, `[PluginMcpHostConfig]`). That code is the Desktop's plugin-MCP host bridge, which serves only the cloud device bridge (gate `3555657854`, served force-on on 2026-10-03). It does not start the servers of a local session, which the local agent starts itself, so the two columns follow different code.

**Only a safelist is filled in.** In the cloud, the Desktop fills placeholders in a plugin server's command, arguments and environment from a fixed list, by exact name: `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER` on macOS and Linux (a longer list on Windows), plus `CLAUDE_PLUGIN_ROOT`. Anything else is left as written, even when the Desktop's own environment has it, and `${NAME:-default}` then yields the default. `CLAUDE_PROJECT_DIR` and `CLAUDE_PLUGIN_DATA` are also left as written, with their own warning. The server's environment is only those safelisted values plus the config's own `env` block. After a restart with `CCI_PROBE_TOKEN` set, the Desktop still logged:

```
[PluginMcpHostConfig] Plugin "plugin_…" server "cci-unsetvar": config uses environment variables the desktop does not fill in for plugin servers: CCI_PROBE_TOKEN. They were left as written. Only CLAUDE_PLUGIN_ROOT and the variables every local server receives (such as PATH and HOME) are filled in, by exact name.
```

The rule is old. Builds 1.18286.2 to 1.46388.4 log it as "config references environment variables outside the MCP stdio safelist … left unexpanded"; from 2.2553.1 the wording is the one above. On the local lane the set variable also arrived literal. The agent's code (L61) gives a server it spawns under the `local-agent` entrypoint only `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER` plus its own `env` block (`CLAUDE_CODE_MCP_ALLOWLIST_ENV` defaults on there), but the 2026-10-02 local servers also received the plugin and session variables listed above, so that list is not the whole story locally; where the extra variables come from was not traced.

**Where the full environment does reach a server.** A server listed in the Desktop's own `claude_desktop_config.json` is started by the Desktop with the full host environment plus its `env` block, and Cowork tasks see it in both local and cloud sessions (L89, measured 2026-06-02). So a credential that a plugin server cannot receive can be given to the same server there, in its `env` block.

## For an author

- A blocking prompt hook works in Cowork, but in the cloud the user gets no feedback at all. If the block matters to the user, tell them another way, or block at the tool level, where the model sees and reports the denial.
- Do not pass a credential to a plugin's MCP server through an environment placeholder. Outside the standard variables it arrives as literal text in both local and cloud sessions, set or not, so the server starts and then fails to authenticate. A `:-` default only hides this. Have the server read its credential itself, for example from a file under the user's home folder or from the system keychain, and treat a value that still looks like `${…}` as missing. A user can also add the server to `claude_desktop_config.json` with the key in its `env` block.
- Do not use `${user_config.…}` in a plugin MCP server that must work in a cloud session: the server is silently left out there.
- To see why a plugin server is missing from a cloud session, ask the session to call `get_device_info`: its `localMcpServers` entries carry each server's state and the reason it did not start.
