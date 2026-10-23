Updated: 2026-10-23 (L244) | Source: **Claude Desktop `app.asar` 3.1623.4** and the bundled agent **2.1.308** (the Desktop-managed host Mach-O), read on 2026-10-23; in **Desktop 3.6556.1** (installed the same day) about 20 of the code fragments quoted here were still found, but the two builds were not compared in full; the `skills-plugin` folders of one Mac (4 organization folders, one account each). Code-read except where a measurement is named. Minified names are given with their chunk file, because the same short name is reused across chunks.

# Chapter 74: Desktop's `anthropic-skills` Plugin

---

## TABLE OF CONTENTS

244. [Lesson 244 — How Desktop's `anthropic-skills` Plugin Is Built, Handed to the Agent and Shown to the Model](#lesson-244--how-desktops-anthropic-skills-plugin-is-built-handed-to-the-agent-and-shown-to-the-model)

---

# LESSON 244 — HOW DESKTOP'S `ANTHROPIC-SKILLS` PLUGIN IS BUILT, HANDED TO THE AGENT AND SHOWN TO THE MODEL

**Desktop keeps one plugin per organization and account, named `anthropic-skills`, that holds Anthropic's skills and the user's own together. That is by design: three sources are merged into it. Desktop hands it to a Mac-side agent as an ordinary `--plugin-dir` plugin, and the agent recognises it by its name. In VM-loop it is not a plugin at all. The model sees its skills twice: in a list Desktop writes into the system prompt, and in the agent's own skill listing, which does not know Desktop's hide and enable rules.**

## Where it lives

`<userData>/local-agent-mode-sessions/skills-plugin/<orgId>/<accountId>/` (organization first, the reverse of the Cowork plugin roots), with `.claude-plugin/plugin.json` (name `anthropic-skills`), `manifest.json` and `skills/<name>/SKILL.md`. Two siblings can appear next to `<accountId>`:

- `<accountId>-builtins`: a plugin holding only the skills shipped in the app, used when the organization has Skills turned off.
- a `.held` folder: user-made skills waiting for their security scan (L242).

Neither existed on the Mac read here.

## Three sources, one manifest (`_syncSkills`, `index.chunk-CyZGni4N.js`)

| source | manifest entry | how it gets there |
|---|---|---|
| skills defined in Desktop's code: `schedule`, `setup-cowork` (and its former name, hidden), `consolidate-memory`, the usage explainer | `creatorType:"anthropic"`, `skillId` = name, `updatedAt: null` (this shape is how Desktop recognises them) | written on every sync as one `SKILL.md`: name, description, `disable-model-invocation: true` only when hidden, then the prompt. Other files in that folder are removed. |
| the account's skills from claude.ai | the server's `creator_type`, `source` (kept only when `anthropic` or `anthropic-example`), `updated_at`, `enabled`, and `backing_plugin_id` when it looks like `plugin_…` | `GET /api/organizations/<org>/skills/list-skills?include_wiggle_skills=true&entrypoint=local-agent`, enabled entries only; content from `…/skills/download-dot-skill-file?skill_id=…` |
| skills saved on this computer | `creatorType:"user"`, `syncManaged:false` | `save_skill` and local saving |

- **Name clashes:** the app's own skill wins, then the local one, then the claude.ai one, each with a `[SkillsPlugin] … takes precedence` log line.
- **Third-party deployments** never call `list-skills`. They read a local store and seed the skill archives shipped in the app (`resources/bundled-skills/*.skill`), each enabled unless its tier is `default_false`. First-party accounts get those skills (docx, pdf, pptx, xlsx and others) from the server, except when Desktop serves only the app's own skills (below), when they too are seeded from the app.
- **A failed download** keeps the skill's previous manifest entry, or none if it is new, and schedules another sync. So the next round retries it.
- **The skills Desktop serves** follow the organization (`resolveServedSkills`):
  - `synced`: the normal mixed plugin.
  - `app_shipped`: Skills are off under the organization's policy, or a HIPAA block applies (`lam_hipaa_gate_blocked`, surface `skills_sync`). Desktop serves the `-builtins` plugin, limited to the names the organization serves.
  - `none`: that list of served names is empty, so no plugin is served.

## What the type and flags change in Desktop

- **`creatorType`:**
  - Only `user` entries can be listed as the user's, edited, renamed, deleted, revealed in Finder or re-scanned.
  - When the session's `skillsEnabled` is false, every entry that is not `anthropic` is left out of the skills list in the system prompt.
  - Attribution covers only user-made, sync-managed skills (L181).
  - The `skill_invoked` event marks Anthropic's skills with `skill_creator_type:"anthropic"`.
- **`source`:** the always-on skills are those with `creatorType` `anthropic` **and** `source` `anthropic`, so `anthropic-example` entries are excluded.
- **`held`** is set by Desktop, never by the server. It marks a user-made skill whose new version is waiting for its scan, kept in `.held`. A held skill is left out of the prompt list, and turning it on or renaming it is refused with "has not passed its security scan".
- **`backingPluginId`** becomes `server_plugin_id` in the attribution data.

## How Desktop hands it to the agent

| session | what is passed |
|---|---|
| Cowork, host-loop | the staged folder (`claude-hostloop-plugins/<hash>`) as the **first** `{type:"local"}` plugin, ahead of remote and local plugins (`index.chunk-DbIevS2k.js`), plus `CLAUDE_CODE_DESKTOP_SKILLS_PLUGIN_DIR` set to the same path |
| Cowork, VM-loop | no plugin and no variable. The path rewrite maps `<plugin>/skills` to the session's `.claude/skills`, so the in-VM agent sees ordinary project skills |
| Cowork, managed setting `disableSideloadFlags` | nothing (no `--plugin-dir` at all); Desktop logs that its prompt keeps the `SKILL.md` locations |
| Code tab and temporary queries | the folder as the first plugin (`[CCD] Using skills plugin at:`, `index.chunk-WpC68JQw.js`) |

The SDK turns each `{type:"local"}` plugin into `--plugin-dir`, or `--plugin-dir-no-mcp` (`index.chunk-B0WFoI_A.js`). The agent gives such plugins the source `inline`.

## What the agent does with it (agent 2.1.308)

- **The variable only marks the plugin; it loads nothing.**
  - The agent stores `CLAUDE_CODE_DESKTOP_SKILLS_PLUGIN_DIR` only when its entrypoint is `claude-desktop`, `claude-desktop-3p` or `local-agent` and it is not a child session. It then removes the variable from its own environment, so tools and children never see it.
  - A plugin named `anthropic-skills` with source `inline`, under such an entrypoint, is marked `accountSkillsWrapper`.
  - It is also marked `hostNamedSkillsFolder` when its path matches the variable.
  - With the variable missing, the plugin still loads, just unmarked: the `skill_reserved_namespace` event then reports `not_sent`.
- **`manifest.json` is read only in third-party deployments.**
  - The agent reads the manifest when the plugin is marked and `CLAUDE_CODE_DESKTOP_SKILL_SWITCHES` is set. Desktop sets that variable only when the deployment uses local skill storage.
  - It reads only `{skills:[{name, enabled}]}` and skips the skills that are off.
  - A manifest that can't be read or has the wrong shape loads **no** skills from the plugin.
  - Otherwise the agent loads every skill folder on disk, which works because Desktop syncs only enabled skills and keeps held versions outside `skills/`.
- **A marked plugin is treated like the account's synced skills:**
  - Other plugins' skills that collide with its names, or use a name reserved for synced skills, are dropped.
  - When two commands share a name, a marked skill is never replaced by an unmarked one.
  - A Skill-tool "ask" rule for a reserved name the plugin does not hold comes back without an "always allow" choice (gate `tengu_plaid_harbor`, on by default).
  - The plugin's server id and marks are copied onto each skill for attribution.

## Where the model sees the skills

1. **Desktop's system prompt** (`generateSkillsSystemPrompt`) writes `<skills_instructions>` and `<available_skills>`, sorted by name.
   - In host-loop each skill is listed under its Claude Code name, `anthropic-skills:<name>`, with "invoke with the Skill tool". In VM-loop the bare name is used, since there the skills are project skills.
   - A skill is listed with a `<location>` for the model to read when skills are not loaded through the Skill tool, or when its name can't be a Claude Code name or collides with another after conversion.
   - This list applies `skillsEnabled`, the served names, each in-code skill's hidden and enabled flags, and drops leftover entries for skills no longer served.
2. **The agent's own `skill_listing` attachment**, sent with a turn rather than in the system prompt.
   - It is sent whenever the Skill tool is present and slash commands aren't disabled.
   - It lists every skill the model may invoke, this plugin's included.
   - It knows only what each `SKILL.md`'s frontmatter says, not Desktop's flags.

So a skill Desktop hides only through an enabled check can still reach the model through the agent's listing. `consolidate-memory` is gated that way (gate `123929380`) and its `SKILL.md` carries no `disable-model-invocation`. Whether the listing really offers it in a live session wasn't checked.

## What the in-code skills need

| skill | needs |
|---|---|
| `schedule` | the scheduled-task tools (`create_scheduled_task`, `update_scheduled_task`, `list_scheduled_tasks`). Where scheduled tasks are unavailable, Desktop writes a placeholder that tells Claude to say so, marked not model-invocable |
| `setup-cowork` | the onboarding role picker, the plugin-marketplace search and suggestion card, the connector-registry search and suggestion card. Where the organization blocks suggestions, Desktop writes a placeholder instead |
| `consolidate-memory` | the auto-memory section of Desktop's system prompt (the memory folder and `MEMORY.md`) |
| the usage explainer | shell access to the session's transcripts under `$HOME/mnt/.claude/projects/` (the VM layout) |

## For a skill or test author

- **Reproduce the host-loop case:**
  - pass the folder first with `--plugin-dir`;
  - run with `CLAUDE_CODE_ENTRYPOINT=local-agent`;
  - set `CLAUDE_CODE_DESKTOP_SKILLS_PLUGIN_DIR` to the same path.

  Add `CLAUDE_CODE_DESKTOP_SKILL_SWITCHES=1` only to mimic a third-party deployment. Under any other entrypoint the folder is an ordinary plugin.
- **Reproduce the VM-loop case:** put the skills under the project's `.claude/skills` instead.
- **Without Desktop's prompt list**, the model sees these skills only through the agent's listing. Choose which in-code skills to stage from the manifest entries and Desktop's rules, not from the folders on disk.
- **Naming a skill:** a skill in your own plugin whose name collides with one of the account's synced skills, or uses the reserved prefix, is dropped from a Desktop session.

## Not traced

- How the `-builtins` plugin is picked up on a running session when an organization turns Skills off mid-session.
- Whether the agent's `skill_listing` offers a gated in-code skill such as `consolidate-memory` in a live session.
- The server's rule for `include_wiggle_skills`.
