# Claude Code Internals

A skill that lets Claude answer questions about how **Claude Code**, the **Claude Desktop** app and **Claude Cowork** actually work, from 221 lessons read out of the shipping binaries rather than guessed from the docs.

This folder is the plugin package. Installation, provenance and the project's history are on the [repository's main page](https://github.com/yaniv-golan/claude-code-internals). For plain-language guidance on writing skills that work in Cowork, see **[ccinternals.dev/cowork](https://ccinternals.dev/cowork/)**.

**License:** MIT | Version and capture details: see [`skills/claude-code-internals/version.json`](skills/claude-code-internals/version.json)

---

## Contents

- [What it does](#what-it-does)
- [An example](#an-example)
- [What you can ask](#what-you-can-ask)
- [Install](#install)
- [How it works](#how-it-works)
- [Getting good answers](#getting-good-answers)
- [Troubleshooting](#troubleshooting)
- [What's in the package](#whats-in-the-package)
- [Version tracking](#version-tracking)
- [License](#license)

## What it does

Claude knows how to *use* Claude Code, but not how it works inside. Ask why a hook didn't fire, where a file your skill wrote actually went, or why the agent can't delete a file in Cowork, and without this skill it guesses. With it, Claude looks up the lessons that cover your question, reads the relevant sections, and answers with the version the fact was measured on and the lane it applies to (terminal CLI, local Cowork, cloud Cowork).

It works in Claude Code (the CLI), in the Claude Desktop app (the Code tab and Cowork), and on claude.ai.

## An example

Ask your question after the skill's name:

```
/claude-code-internals What determines which files are displayed to the user at the end of a response?
```

A real answer, trimmed:

> It depends on which lane the session runs in. The plain terminal CLI has no end-of-response file display at all; it only prints text. The file cards shown at the end of a turn are a Cowork/Desktop feature, and each lane decides them differently.
>
> - **Local Cowork:** the session's `outputs/` directory is itself the delivery channel, and `present_files` shows a file explicitly as a card.
> - **Cloud Cowork:** delivery is an action, not a place. Calling `SendUserFile` produces the file card.
> - **CLI:** nothing is presented. Files just sit in the working directory.
>
> Read more: https://ccinternals.dev/cowork/delivering-outputs/

You don't have to type the skill's name: Claude also uses it on its own when a question is about Claude Code's or Cowork's internals.

## What you can ask

These come from the skill's own index, which lists the questions each lesson answers:

- **Writing skills and plugins:** Why did my skill vanish mid-session? Why does my skill's description get cut off? Why can't Cowork resume a subagent?
- **Hooks, permissions and settings:** What does exit code 2 mean for hooks? How many hook events are there now? Why does the effort level keep resetting?
- **Sessions and context:** What happens when the context window fills up? Can I resume a completed subagent?
- **Claude Desktop and Cowork:** Why can't the agent delete files in my folder? Which folder does the shell start in? Why did a cloud task save the file to the cloud instead of my laptop?

## Install

The easy paths (the Claude Desktop install button, the Claude Code plugin marketplace, claude.ai, Codex, ChatGPT) are on the [repository's main page](https://github.com/yaniv-golan/claude-code-internals#install).

### From the release zip

Download [`claude-code-internals.zip`](https://github.com/yaniv-golan/claude-code-internals/releases/latest/download/claude-code-internals.zip), then:

```bash
mkdir -p ~/.claude/skills/claude-code-internals
cd ~/.claude/skills/claude-code-internals
unzip ~/path/to/claude-code-internals.zip
chmod +x scripts/*.sh scripts/*.js
```

Start a new Claude Code session (skills register at startup) and try the example question above.

The zip holds everything: SKILL.md, all 221 lessons, the indexes, the current-state layer and the scripts. The search index is built in memory on first use. No npm install, no server, no API keys.

### From this repo

```bash
mkdir -p ~/.claude/skills/claude-code-internals
cp -r skill-package/skills/claude-code-internals/. ~/.claude/skills/claude-code-internals/
```

### Prerequisites

| Requirement | Minimum | Check | Needed for |
|-------------|---------|-------|------------|
| **Node.js** | v18+ | `node --version` | `search.js` and the other query scripts |
| **jq** | Any | `jq --version` | `lookup.sh`, the keyword fallback when Node can't run |

Without either, the skill falls back to reading its reference files directly.

### Optional: a reminder hook for `.claude/` edits

This hook reminds Claude to consult the skill whenever it is about to edit files under `.claude/`. It never blocks the edit. It is opt-in for every install type; a plugin install does not register it. Add it to the `hooks` object in `~/.claude/settings.json`:

```json
"PreToolUse": [
  {
    "matcher": "(Edit|Write|Bash)",
    "hooks": [
      {
        "type": "command",
        "command": "~/.claude/skills/claude-code-internals/scripts/config-aware-hook.sh",
        "timeout": 5
      }
    ]
  }
]
```

> If `settings.json` has no `hooks` object yet, wrap it: `{ "hooks": { "PreToolUse": [ ... ] } }`.
>
> The path above is for a manual install and is stable across releases. For a plugin install, point `command` at the plugin's cache copy instead — `~/.claude/plugins/cache/claude-code-internals-marketplace/claude-code-internals/<version>/skills/claude-code-internals/scripts/config-aware-hook.sh` — which changes each release, so re-point it after updating. (`${CLAUDE_PLUGIN_ROOT}` only expands inside a plugin-declared hook, not in `settings.json`.)

## How it works

1. **SKILL.md** tells Claude how to look things up: search first, then read only the matching lesson sections.
2. **`search.js`** ranks the lessons for the question. It combines a keyword layer (exact terms, identifiers, env vars, commands) and a TF-IDF layer (natural-language questions): keyword matches come first, then lessons only TF-IDF found. Each result is labelled `[HIGH]` (both layers), `[MEDIUM]` (keyword only) or `[LOW]` (TF-IDF only).
3. **`fetch-lesson.js`** reads the matched section by exact line range, so Claude loads only what it needs. `xref.js` follows links between related lessons, and `troubleshoot.js` maps symptoms ("hook not firing") to lessons.
4. **The state layer** (`references/state/`) holds what's true now: env vars, gates, commands, settings and tools, each with its status (live, dark, renamed, removed) and the lesson it came from. When a lesson and the state layer disagree, the state layer wins.
5. Claude answers in a few paragraphs, with the version and lane, and a `Read more:` link for Cowork topics.

Without Node, `references/routing/index-*.md` (one line per lesson, with example questions) and `references/routing/sections.md` (every heading with its line) let Claude find lessons with plain file tools.

<details>
<summary>The search scripts, directly</summary>

| Script | Best for | Requires |
|--------|----------|----------|
| `search.js` | **The default.** Keyword and TF-IDF together | Node.js |
| `semantic-search.js` | Natural language only: "how does Claude decide what tools to use" | Node.js |
| `lookup.sh` | Exact terms only: "KAIROS", "CLAUDE_CODE_EFFORT_LEVEL" | `jq` |

```bash
node scripts/search.js "hook events" --top=5
```

The TF-IDF index is not shipped: it is built in memory from `topic-index.json` on first use, then cached under your user cache directory (`CCI_NO_INDEX_CACHE=1` disables the cache).

</details>

## Getting good answers

- **Ask before you configure.** Before editing hooks, permissions or settings under `.claude/`, ask the skill: it knows the exact formats, valid values and edge cases.
- **Ask the question the way you'd ask a colleague.** "Why can't the agent delete files in my folder?" works as well as "FUSE unlink policy".
- **Check the version it names.** The CLI baseline is in `version.json` (`captured_version`); Desktop and Cowork facts carry their own versions. If your Claude Code is newer, `bash scripts/check-version.sh` says so. Some internals may have changed since.

## Troubleshooting

**"Unknown skill" when typing `/claude-code-internals`**
Skills register at startup. Start a new session and try again.

**`lookup.sh` fails with "command not found: jq"**
Install jq: `brew install jq` (macOS) or `apt-get install jq` (Linux). `search.js` does not need it.

**`search.js` fails or returns nothing**
Check Node.js: `node --version` (v18+). If the file isn't executable: `chmod +x scripts/*.js`.

**The reminder hook doesn't fire when editing `.claude/` files**
Hook config is read once at startup, so restart after adding it. Check that the script path is right and executable: `chmod +x scripts/config-aware-hook.sh`.

**Search returns the wrong lesson**
Try more specific wording, or an exact identifier (an env var, command or setting name).

## What's in the package

The `claude-code-internals.zip` release file is exactly `skill-package/skills/claude-code-internals/`:

| File | Purpose |
|------|---------|
| `SKILL.md` | How Claude looks things up and answers |
| `version.json` | Skill version, captured CLI version and date, and the derived lesson and chapter counts |
| `hooks-config.json` | Example PreToolUse hook definition (portable paths) |
| `references/*.md` | The chapter files holding every lesson |
| `references/catalog.md` | One line per chapter and lesson |
| `references/routing/` | The routing index (`index-*.md`) and heading map (`sections.md`) |
| `references/topic-index.json` | Per-lesson bounds and keywords, plus the keyword map (keyword fields derived by `prepare-lessons.js`) |
| `references/hand-keywords.json` | The frozen hand-written keywords that `topic-index.json` projects; never edited, never written by a script |
| `references/cross-references.json` | Lesson-to-lesson links |
| `references/troubleshooting.json` | Symptom entries with lesson pointers and hints |
| `references/state/` | Current-state layer — domain pages, `registry.json`, `author-facts.json` |
| `scripts/` (query) | `search.js` (use this by default), `semantic-search.js`, `lib/tfidf-index.js`, `lookup.sh`, `fetch-lesson.js`, `xref.js`, `troubleshoot.js`, `state.js` |
| `scripts/` (maintenance) | `build.js`, `prepare-lessons.js`, `validate-state.js`, `check-json-format.js`, `check-history-markers.js`, `count-symbol.js`, `check-version.sh`, `extract-bundle.sh`, `diff-versions.sh`, `config-aware-hook.sh` |
| `scripts/tests/` | Tests guarding release consistency, derived fields, JSON canonical format, search and the state layer |

The zip does **not** contain this README or the LICENSE; those live in the repository.

## Version tracking

`version.json` holds five fields:

- `skill_version`: this skill's release version (also in `.claude-plugin/plugin.json`);
- `captured_version`: the Claude Code CLI build the content baseline was read from;
- `captured_date`: when that baseline was captured;
- `lessons_count` and `chapters_count`: derived from the reference files by `scripts/build.js`.

See `version.json` for the current values; per-release history is in the repository's `CHANGELOG.md`.

To update the content: edit or add files in `references/`, run `node scripts/build.js` (lesson bounds and counts), then `node scripts/prepare-lessons.js` (keyword fields; `build.js --check` fails until it has run). A **new** lesson also needs `node scripts/prepare-lessons.js --generate`, the one step that calls a model, to propose its vocabulary. Never edit keywords by hand: the hand-written ones are frozen in `references/hand-keywords.json`.

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | Fully tested | Primary development platform |
| **Linux** | Expected to work | Uses standard bash, jq, Node.js |
| **Windows (WSL)** | Expected to work | Run inside WSL, not native Windows |
| **Windows (native)** | Not supported | Bash scripts require a Unix shell |

## License

MIT License. See [LICENSE](LICENSE) for full text.

The architecture lesson content in `references/01–05` is sourced from [markdown.engineering](https://www.markdown.engineering/learn-claude-code/) and is used for educational and tooling purposes. The skill packaging, indexes, search scripts, and hook integrations are original work.
