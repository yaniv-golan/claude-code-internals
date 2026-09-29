# Claude Code Internals

![Claude Code Internals banner](assets/banner.png)

> **Claude Code doesn't know how it works internally. This skill makes it know — read out of the shipping binaries, not the docs (including the parts the docs get wrong).**

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in_Claude_Desktop-D97757?style=for-the-badge&logo=claude&logoColor=white)](https://ccinternals.dev/static/install-claude-desktop.html)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Plugin](https://img.shields.io/badge/Claude_Code-plugin-F97316)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/plugins)
[![Improved with Skill Creator Plus](https://img.shields.io/badge/Improved_with-Skill_Creator_Plus-4ecdc4?style=flat-square)](https://github.com/yaniv-golan/skill-creator-plus)

**Skill Version:** 2.59.2 | **Captured from:** Claude Code v2.1.231 | **Date:** 2026-08-14 | **License:** MIT

This is a **modified fork** of [stuinfla/claude-code-internals](https://github.com/stuinfla/claude-code-internals) that has since diverged into its own thing: **218 lessons across 59 chapters** (upstream shipped ~50) covering Claude Code's core subsystems — the boot sequence, query engine, tool system, permissions, hooks, sub-agents, MCP, memory, compaction, sessions, and OAuth — plus binary-verified command internals (`/effort`, `/rewind`, `/fork`) and CI eval gates. See [Attribution](#attribution) for the full lineage.

---

## What you get

Ask about a subsystem and Claude answers from indexed, source-level lessons instead of guessing. A few real examples (output trimmed, illustrative):

**1. Hooks — `fetch-lesson.js 32`** pulls the exit-code and enforcement contract straight from the binary:

```
# Lesson 32: Hooks System

Exit code 2 = model-visible blocking; other non-zero = user-visible only; exit 0 = silent success.
PreToolUse: 0=proceed silently, 2=block tool + stderr to model, other=proceed + stderr to user.
…
PreToolUse is an independent enforcement point, not gated by canUseTool: it fires on every tool
call — including --allowedTools-pre-approved tools — and a hook `deny` bypasses canUseTool.
```

**2. Commands — `fetch-lesson.js 51`** (`/effort`) gives the binary detail behind a shipped command:

```
# Lesson 51: /effort Command & Reasoning Budget

Binary path: `name:"effort", description:"Set effort level for model usage"`
API beta: `effort-2025-11-24`
Settings key: `effortLevel` (persisted, enum: `low | medium | high | max`)
Env var override: `CLAUDE_CODE_EFFORT_LEVEL` (set to `"unset"` or `"auto"` to clear)
```

**3. Cowork — `fetch-lesson.js 139`** ("why did `rm` fail in Cowork") pulls a measured result you won't find in the docs (excerpt trimmed):

```
# Lesson 139: Delete Semantics: Per-Mount FUSE Policy, unlink and rmdir Only

Every Cowork FUSE mount denies exactly `unlink` and `rmdir` by default —
nothing else. Approval is strictly per-mount, takes effect live in already-open
shells, and involves NO remount. …
```

## Why it's different

- **It's read from the binaries, not the docs.** Every lesson is verified against the shipping artifacts, so it surfaces what the docs omit or leave vague — dark-launched features (Claude Design, Artifacts), exact field and exit-code contracts, gate semantics — and it corrects its own earlier findings as new binaries ship.
- **It goes further than any other resource into the Claude Desktop app and the Cowork runtime** (host-loop vs VM-loop, mounts, delivery, the control protocol). The plain-language rules for skill authors live at **[ccinternals.dev/cowork](https://ccinternals.dev/cowork/)**.
- **Provenance you can check.** Findings are cross-verified across the v2.1.231 CLI Bun SEA and six further artifact classes — the Claude Desktop `app.asar` (through 2.7032.0), the Desktop-managed host agent Mach-O and the Cowork in-VM agent ELF (through 2.1.280), the golden Cowork VM disk image (`rootfs.img`), the live GrowthBook `fcache`, and Desktop's Chromium HTTP cache — several of which no single binary contains.

## Install

### Claude Desktop

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in_Claude_Desktop-D97757?style=for-the-badge&logo=claude&logoColor=white)](https://ccinternals.dev/static/install-claude-desktop.html)

Or manually: **Customize → Plugins → + Add → Add marketplace**, enter `yaniv-golan/claude-code-internals`, then install **claude-code-internals** from it.

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

**Optional PreToolUse hook** — a gentle reminder whenever Claude edits `.claude/` config. Add to `hooks` in `~/.claude/settings.json`, pointing at the manual-install path (stable across releases):

```json
"PreToolUse": [
  {
    "matcher": "(Edit|Write|Bash)",
    "hooks": [
      { "type": "command",
        "command": "~/.claude/skills/claude-code-internals/scripts/config-aware-hook.sh",
        "timeout": 2000 }
    ]
  }
]
```

> If you installed as a plugin instead of copying, the script lives under a per-release cache path (`~/.claude/plugins/cache/claude-code-internals-marketplace/claude-code-internals/<version>/skills/claude-code-internals/scripts/config-aware-hook.sh`) that changes every version — so the hook is easiest to wire for manual installs.

</details>

### Prerequisites

| Requirement | Minimum | Check | Needed for |
|-------------|---------|-------|------------|
| **Node.js** | v18+ | `node --version` | search + `fetch-lesson.js` |
| **jq** | Any | `jq --version` | the standalone `lookup.sh` only |

```bash
brew install node jq   # macOS
```

## How it works

Ask about a subsystem and you get a source-level answer drawn from the indexed lessons, not a guess. A `references/state/` layer tracks version-specific facts (env vars, gates, commands, tools, IPC interfaces) with per-entry provenance, so "is this still true in version X?" has an answer.

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
│       ├── SKILL.md                    Search strategy + lesson index
│       ├── version.json                Version tracking (v2.59.2 / v2.1.231)
│       ├── references/                 Lesson chapters + state/ truth layer
│       └── scripts/                    search.js, fetch-lesson.js, build.js, …
├── scripts/release.js                  Cuts a release, bumps every pin
├── site/                               GitHub Pages (ccinternals.dev)
├── assets/                             banner + diagrams
└── .github/workflows/                  release + Pages deploy
```

</details>

## Version Tracking

```json
{
  "skill_version": "2.59.2",
  "captured_version": "2.1.231",
  "captured_date": "2026-08-14"
}
```

version.json also carries `lessons_count` and `chapters_count`, which `scripts/build.js` derives from the reference files (a README can't track them, so they're omitted above). Per-release history lives in [CHANGELOG.md](CHANGELOG.md).

## Platform Compatibility

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | Fully tested | Primary development platform |
| **Linux** | Expected to work | Standard bash, jq, Node.js |
| **Windows (WSL)** | Expected to work | Run inside WSL |
| **Windows (native)** | Not supported | Bash scripts require a Unix shell |

## Attribution

This repository is a fork of [stuinfla/claude-code-internals](https://github.com/stuinfla/claude-code-internals) (v2.0.0). The foundational work is **stuinfla's**: the 50 original lessons (Chapters 1–8, reverse-engineered from Claude Code v2.1.88), the unified search engine, the topic index and cross-reference/troubleshooting data, the PreToolUse `.claude/` hook and version-check script, and the original README and diagrams.

**What this fork adds** (v2.2.0–v2.59.2, by Yaniv Golan, improved using [Skill Creator Plus](https://github.com/yaniv-golan/skill-creator-plus)): Chapters 9–59 — every binary-verified CLI release delta, the full Claude Desktop + Cowork corpus, the mutable `references/state/` truth layer, the shell-safe script CLIs (`fetch-lesson.js`, `xref.js`, `troubleshoot.js`, `extract-bundle.sh`, `diff-versions.sh`), and the plugin/marketplace/release/Pages infrastructure. See [CHANGELOG.md](CHANGELOG.md) for the item-by-item breakdown.

The architecture lesson content in `references/01–05` is sourced from [markdown.engineering](https://www.markdown.engineering/learn-claude-code/) and used for educational and tooling purposes.

## License

MIT License. See [LICENSE](LICENSE) for full text.
