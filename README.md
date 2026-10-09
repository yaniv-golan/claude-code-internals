# Claude Code Internals

![Claude Code Internals banner](assets/banner.png)

A skill that lets Claude answer questions about how **Claude Code**, the **Claude Desktop** app and **Claude Cowork** actually work, from knowledge read out of the shipping binaries rather than guessed from the docs.

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in_Claude_Desktop-D97757?style=for-the-badge&logo=claude&logoColor=white)](https://ccinternals.dev/static/install-claude-desktop.html)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-plugin-F97316)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/plugins)
[![Improved with Skill Creator Plus](https://img.shields.io/badge/Improved_with-Skill_Creator_Plus-4ecdc4?style=flat-square)](https://github.com/yaniv-golan/skill-creator-plus)

Claude knows how to *use* Claude Code, but not how it works inside: why a hook didn't fire, where a file your skill wrote actually went, why the agent can't delete a file in Cowork. Those answers usually aren't in the docs. This skill gives Claude 225 lessons on those internals, each checked against the released binaries and stamped with the version it was measured on. It works in Claude Code (the CLI), the Claude Desktop app (the Code tab and Cowork), and claude.ai.

## An example

Once it's installed, ask your question after the skill's name:

```
/claude-code-internals What determines which files are displayed to the user at the end of a response?
```

Claude looks up the relevant lessons and answers for your setup. A real answer, trimmed:

> It depends on which lane the session runs in (corpus baseline v2.1.231, with Cowork facts measured up to Desktop 2.9939.4 / agent 2.1.284). The plain terminal CLI has no end-of-response file display at all; it only prints text. The file cards shown at the end of a turn are a Cowork/Desktop feature, and each lane decides them differently.
>
> | Lane | What makes a file show up |
> |---|---|
> | **Local Cowork** (Desktop) | Where the file is: the session's `outputs/` directory is itself the delivery channel. `present_files` shows a file explicitly as a card; it only accepts files under outputs, uploads, or a connected folder. |
> | **Cloud Cowork** | Delivery is an action, not a place. Calling `SendUserFile` produces the file card. |
> | **claude.ai chat** | Writing to `/mnt/user-data/outputs`. |
> | **CLI / Claude Code on the web** | Nothing is presented. Files just sit in the repo or working directory. |
>
> **Path forms (local Cowork).** The file tools need the host-absolute outputs path. Bash starts at `/sessions/<id>` and needs `/sessions/<id>/mnt/outputs/...`. Anything bash writes elsewhere, including `/tmp`, never reaches the user. …
>
> Sources: state page `cowork-architecture`, and lessons 107, 114, 139, 164 and 198.
>
> Read more: https://ccinternals.dev/cowork/delivering-outputs/

You don't have to type the skill's name: Claude also reaches for it on its own when a question is about Claude Code's or Cowork's internals.

## What you can ask

The questions below come from the skill's own index, which lists the questions each lesson answers.

**Writing skills and plugins**
- Why did my skill vanish mid-session? (compaction caps on skill content)
- Skill description gets cut off in the list: why?
- Why can't Cowork resume a subagent?
- Which skill tools does a Cowork session actually see?

**Hooks, permissions and settings**
- What does exit code 2 mean for hooks?
- How many hook events are there now?
- How do I make Claude think harder, and why does the effort level keep resetting?

**Sessions, context and agents**
- What happens when the context window fills up?
- Can I resume a completed subagent?

**Claude Desktop and Cowork**
- Why can't the agent delete files in my folder? ("rm says operation not permitted")
- Which folder does the shell start in, and why don't files the shell saved show up?
- Why did a cloud task save the file to the cloud instead of my laptop?
- Where does the Cowork effort level come from?

Answers name the version they were measured on and say which lane they apply to (terminal CLI, local Cowork, cloud Cowork) when it matters.

**Who it's for:** people writing skills, plugins, hooks or MCP servers for Claude Code and Cowork; teams building on Claude Code headless or through the Agent SDK; anyone debugging behavior the docs don't explain. For plain-language guidance on writing skills that work in Cowork, see **[ccinternals.dev/cowork](https://ccinternals.dev/cowork/)**, a companion site built from the same research.

## Install

### Claude Desktop

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in_Claude_Desktop-D97757?style=for-the-badge&logo=claude&logoColor=white)](https://ccinternals.dev/static/install-claude-desktop.html)

Or manually: **Customize → Plugins → + Add → Add marketplace**, enter `yaniv-golan/claude-code-internals`, then install **claude-code-internals** from it. The skill is then available in the Code tab and in Cowork.

### Claude Code (CLI)

```bash
claude plugin marketplace add https://github.com/yaniv-golan/claude-code-internals
claude plugin install claude-code-internals@claude-code-internals-marketplace
```

<details>
<summary>Other platforms — Claude.ai, Manus, ChatGPT, Codex, manual, optional hook</summary>

Except where noted, each of these uses the release zip: [`claude-code-internals.zip`](https://github.com/yaniv-golan/claude-code-internals/releases/latest/download/claude-code-internals.zip) (built on tag push, attached to the GitHub Release — not checked into the repo).

**Claude.ai (Web)** — **Customize → Skills → + Add → Upload skill**, upload the zip.

**Manus** — **Settings → Skills → + Add → Upload**, upload the zip.

**ChatGPT** — add this repo as a plugin marketplace: in the **Add plugin marketplace** dialog set **Source** to `yaniv-golan/claude-code-internals` and **Git ref** to `main` (leave **Sparse paths** blank), then **Add marketplace** and install **claude-code-internals**. ChatGPT reads the repo's existing `.claude-plugin/marketplace.json` and shares one plugin directory with Codex. Or upload the release zip instead.

**Codex CLI** — `$skill-installer https://github.com/yaniv-golan/claude-code-internals`, or extract the zip to `~/.codex/skills/claude-code-internals/`.

**From this repo (manual copy)**

```bash
mkdir -p ~/.claude/skills/claude-code-internals
cp -r skill-package/skills/claude-code-internals/. ~/.claude/skills/claude-code-internals/
chmod +x ~/.claude/skills/claude-code-internals/scripts/*.sh \
         ~/.claude/skills/claude-code-internals/scripts/*.js
```

**Optional PreToolUse hook** — a gentle reminder whenever Claude edits `.claude/` config. This is opt-in for **every** install type (plugin or manual copy); the plugin does not register it for you. To enable it, add it to the `hooks` object in `~/.claude/settings.json`:

```json
"PreToolUse": [
  {
    "matcher": "(Edit|Write|Bash)",
    "hooks": [
      { "type": "command",
        "command": "~/.claude/skills/claude-code-internals/scripts/config-aware-hook.sh",
        "timeout": 5 }
    ]
  }
]
```

> The `command` path above is for a manual/copy install and is stable across releases. For a plugin install, point `command` at the plugin's cache copy instead — `~/.claude/plugins/cache/claude-code-internals-marketplace/claude-code-internals/<version>/skills/claude-code-internals/scripts/config-aware-hook.sh` — which changes each release, so re-point it after updating. (`${CLAUDE_PLUGIN_ROOT}` only expands inside a plugin-declared hook, not in `settings.json`.)

</details>

### Prerequisites

| Requirement | Minimum | Check | Needed for |
|-------------|---------|-------|------------|
| **Node.js** | v18+ | `node --version` | search + `fetch-lesson.js` |
| **jq** | Any | `jq --version` | the standalone `lookup.sh` only |

```bash
brew install node jq   # macOS
```

Without Node, the skill falls back to reading its reference files directly.

## Why you can trust the answers

- **They come from the binaries, not the docs.** Every lesson is checked against the released artifacts, so it covers what the docs leave out or get wrong: exact hook and exit-code contracts, feature gates, commands that ship switched off, and how Cowork's sandbox really handles paths, mounts and file delivery.
- **What's true now is kept apart from history.** A current-state layer (`references/state/`) records env vars, gates, commands, settings and tools with their status (live, dark, renamed, removed) and the lesson each fact came from, so "is this still true in version X?" has an answer. When a newer binary changes a fact, the state layer is updated and the change is recorded in the [changelog](CHANGELOG.md).
- **Provenance you can check.** Findings are cross-checked across the v2.1.231 CLI Bun SEA and six further artifact classes: the Claude Desktop `app.asar` (through 2.9939.4), the Desktop-managed host agent Mach-O and the Cowork in-VM agent ELF (through 2.1.284), the Cowork VM disk image (`rootfs.img`), the live GrowthBook `fcache`, and Desktop's Chromium HTTP cache. Several facts can only be seen by combining them.
- **It goes deeper into Claude Desktop and Cowork than anything else public**: host-loop vs VM-loop, mounts, delivery, the control protocol, cloud vs local tasks.

Under the hood, `search.js` ranks lessons by keyword and TF-IDF match, and Claude reads the matching sections by exact line range.

## Version Tracking

**Skill Version:** 2.67.0 | **Captured from:** Claude Code v2.1.231 | **Date:** 2026-08-14 | **License:** MIT

The CLI baseline is Claude Code v2.1.231. Claude Desktop and Cowork facts are measured on newer builds, through Desktop 2.9939.4 and agent 2.1.284, and each lesson and state entry names the version it was measured on.

```json
{
  "skill_version": "2.67.0",
  "captured_version": "2.1.231",
  "captured_date": "2026-08-14"
}
```

version.json also carries `lessons_count` and `chapters_count`, which `scripts/build.js` derives from the reference files (a README can't track them, so they're omitted above). Per-release history lives in [CHANGELOG.md](CHANGELOG.md).

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | Fully tested | Primary development platform |
| **Linux** | Expected to work | Standard bash, jq, Node.js |
| **Windows (WSL)** | Expected to work | Run inside WSL |
| **Windows (native)** | Not supported | Bash scripts require a Unix shell |

## Contributing / maintenance

> A dedicated `CONTRIBUTING.md` — including how lessons are searched and ranked — is planned; this is the short version.

- **Update flow:** `build.js` derives lesson bounds and counts; `prepare-lessons.js` derives keyword keys from lesson text (`--generate` for a new lesson — the one step that calls a model). `build.js --check` fails until derivation has run.
- **Keywords are never hand-edited.** Hand-written keys are frozen in `references/hand-keywords.json`; generated keys are pinned/derived. Every keyword field in `topic-index.json` is build output.
- **Releases:** `node scripts/release.js` from the repo root bumps every skill-version pin in one pass. `check-version.sh` warns when you run a Claude Code newer than the captured baseline (reads `captured_version` from version.json — currently v2.1.231).

<details>
<summary>Repository layout</summary>

```
claude-code-internals/
├── .claude-plugin/marketplace.json     Marketplace definition
├── skill-package/                      Plugin package
│   ├── .claude-plugin/plugin.json
│   └── skills/claude-code-internals/   The skill itself
│       ├── SKILL.md                    How Claude looks things up and answers
│       ├── version.json                Version tracking (v2.67.0 / v2.1.231)
│       ├── references/                 Lesson chapters, routing index, state/ layer
│       └── scripts/                    search.js, fetch-lesson.js, build.js, …
├── scripts/release.js                  Cuts a release, bumps every pin
├── evals/                              Retrieval and Cowork evaluations
├── site/                               GitHub Pages (ccinternals.dev)
├── assets/                             banner + diagrams
└── .github/workflows/                  validation, release, Pages deploy
```

</details>

## Attribution

This repository began as a fork of [stuinfla/claude-code-internals](https://github.com/stuinfla/claude-code-internals) (v2.0.0) and has since grown into its own project: 225 lessons across 62 chapters, where upstream shipped about 50. The foundational work is **stuinfla's**: the 50 original lessons (Chapters 1–8, reverse-engineered from Claude Code v2.1.88), the unified search engine, the topic index and cross-reference/troubleshooting data, the PreToolUse `.claude/` hook and version-check script, and the original README and diagrams.

**What this fork adds** (v2.2.0–v2.67.0, by Yaniv Golan, improved using [Skill Creator Plus](https://github.com/yaniv-golan/skill-creator-plus)): Chapters 9–60 — every binary-verified CLI release delta, the full Claude Desktop + Cowork corpus, the mutable `references/state/` truth layer, the shell-safe script CLIs (`fetch-lesson.js`, `xref.js`, `troubleshoot.js`, `extract-bundle.sh`, `diff-versions.sh`), and the plugin/marketplace/release/Pages infrastructure. See [CHANGELOG.md](CHANGELOG.md) for the item-by-item breakdown.

The architecture lesson content in `references/01–05` is sourced from [markdown.engineering](https://www.markdown.engineering/learn-claude-code/) and used for educational and tooling purposes.

## License

MIT License. See [LICENSE](LICENSE) for full text.
