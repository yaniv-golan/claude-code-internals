---
name: claude-code-internals
description: "How Claude Code actually works, read out of the shipping binaries rather than the docs — including the parts the docs get wrong. Use when asked why Claude Code behaved unexpectedly, how one of its subsystems works internally, whether a behavior is really live in a given version, or before editing .claude/ config. Covers hooks, permissions, settings precedence, skills and plugins, sub-agents, MCP, memory, compaction, and sessions. A third of it is Claude Cowork's runtime: host-loop vs VM-loop, sandbox mounts, path resolution, file delivery, and the stream-json control protocol."
user-invocable: true
argument-hint: "[topic - e.g. hooks, permissions, memory, agents, compaction]"
context: fork
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---
Topic requested: $ARGUMENTS

You run **forked**: the parent sees only what you return, so put the whole answer
(and any `Read more:` line) in your final message. If the "Topic requested" line
above is blank, no topic was given — print the menu near the end of this file and
ask which area they want. Otherwise work the topic with the steps below.

## How to run the scripts

Each script takes its **own interpreter**: run the `.js` tools (`search`, `state`,
`xref`, `troubleshoot`, `fetch-lesson`) with **`node`**, and the `.sh` tools
(`check-version`, `lookup`) with **`bash`**. Never run a `.sh` with `node` or a
`.js` with `bash` — that is the one invocation mistake to avoid.

**Preferred — the bundled launcher** (it picks the interpreter for you), whenever
`claude-code-internals` is on your PATH:

```bash
claude-code-internals search "$ARGUMENTS" --top=5   # unified keyword + TF-IDF search
claude-code-internals state <name>                  # is a flag/command/gate live, dark, renamed, removed?
claude-code-internals xref <id> [id...]             # related lessons across subsystems
claude-code-internals troubleshoot "<symptom>"      # problem-shaped queries (short symptom phrase)
claude-code-internals fetch-lesson <id>             # a lesson's full body by id
```

**If `claude-code-internals` is not found** — expect this in Cowork, whose VM
shell does not get the plugin `bin/` on its PATH — locate the scripts directory
first. Do **not** build the path from the CLAUDE_SKILL_DIR / CLAUDE_PLUGIN_ROOT
environment variables: they hold a *host* path the VM shell cannot open. Instead:

```bash
find /sessions -type d -path '*/skills/claude-code-internals/scripts' 2>/dev/null | head -1
```

It prints **one absolute path** (covering both install shapes,
`.remote-plugins/plugin_<id>/skills/…` and
`.local-plugins/marketplaces/…/skill-package/skills/…`). **Paste that whole
absolute path in as the script argument every time.** Do **not** `cd` into the
directory and run a relative name, and do **not** stash it in a shell variable —
both hide the path and make the run look like it consulted nothing. So if `find`
printed `/sessions/S/…/claude-code-internals/scripts`, run
`node /sessions/S/…/claude-code-internals/scripts/state.js <name>` — the full path
inline, with the right interpreter and extension:

```bash
node <scripts-dir>/search.js "$ARGUMENTS" --top=5
node <scripts-dir>/state.js <name>
node <scripts-dir>/xref.js <id> [id...]
node <scripts-dir>/troubleshoot.js "<symptom>"   # a short 2-5 word symptom, not a full sentence
node <scripts-dir>/fetch-lesson.js <id>
bash <scripts-dir>/check-version.sh              # .sh — run with bash, not node (optional; see Step 2)
```

**Last resort**, when no script runs at all: `Read`/`Grep` the reference files
directly (see the routing table at the end) — the whole corpus is plain Markdown.
`references/routing/index-*.md` has one line per lesson with file:range and example
questions (use it for paraphrased questions); `references/routing/sections.md` has
every heading with file:line (grep it for exact terms).

## The procedure

**Step 1 — Current-state layer first (for "how does it behave now" questions).**
`references/state/` is the normalized truth layer: per-domain pages plus
`state/registry.json`, each stamped `as_of` a binary version. Lessons are history
and provenance; the state layer is current behavior, and it **supersedes any
conflicting statement in an older lesson**.

- Is a flag/command/gate live, dark, renamed, or removed? `claude-code-internals state <name>`
  (e.g. `claude-code-internals state toggle-memory`).
- How does a domain work now (Cowork permissions, control protocol, credential
  channels, models, plugins/hooks, memory)? Read the matching
  `references/state/<domain>.md`.
- Fall through to search/fetch only when the state layer has no matching
  domain/entry, or the question is about history, corrections, or how something
  was verified.

**Step 2 — Version qualification.** The corpus baseline is **v2.1.231**, and every
`state.js` line and lesson body carries an `as_of` stamp. Carry a version stamp
into your answer; if you know you are on a newer build, say the fast-moving
internals (hooks, permissions) may have changed. A `bash <scripts-dir>/check-version.sh`
prints a drift warning when your running version differs from v2.1.231, but only
when the `claude` CLI is on PATH — it is silent otherwise (as in Cowork), so
treat it as an optional nicety, not a required step.

**Step 3 — Search.** `claude-code-internals search "$ARGUMENTS" --top=5` lists keyword
matches in keyword order, then TF-IDF-only matches. Each result prints the lesson
title, its **id**, file path, line range, and confidence: `[HIGH]` = both layers
matched, `[MEDIUM]` = keyword layer only, `[LOW]` = TF-IDF only. Check the title before loading a section; if it
does not fit the query, try a more specific term. **Note the ids** — every other
script takes the id.

**Step 4 — Cross-references (multi-topic queries only).** For queries spanning
subsystems ("hooks and permissions", "agents and memory"), pass the ids from
Step 3: `claude-code-internals xref 32 25`. Skip for single-concept queries.

**Step 5 — Troubleshooting (problem queries).** If the query describes a problem
("not working", "why", "broken", "keeps", "error", "won't", "fails"):
`claude-code-internals troubleshoot "<symptom>"`. Pass a short 2-5 word symptom
phrase (e.g. `hook not firing`), not the full sentence — it matches on symptom
patterns, so a whole question may return no hints.

**Step 6 — Fetch the matched lessons.** `claude-code-internals fetch-lesson <id>` returns a
lesson's body by id — no need to track file paths or offsets.
`claude-code-internals fetch-lesson --list` lists every lesson; add `--meta` for metadata only. If
`fetch-lesson` is unavailable, `Read` the file at the line range from the search
result, or `Grep` across `references/`.

**Step 7 — Synthesize a focused answer:**

- **[Subsystem]** — one line on what it does and why it exists.
- **Architecture** — key components, data flow, state machine; include type
  definitions when they clarify the design.
- **Configuration** — options the user can actually set, and their effects.
- **Non-obvious behavior** — ordering constraints, edge cases, undocumented
  interactions.
- **Example** — only when it illuminates the design.

Keep the answer under 5 KB. If the topic spans more than 3 lessons, ask which
aspect matters most before synthesizing everything.

## IDs are not the "Lesson N" numbers

Every script keys on the `id` — that is what `search.js` prints (`id 32`) and
what `cross-references.json` and `troubleshooting.json` use. For the legacy
lessons 1–50 the id and the "Lesson N" number in the file headings **disagree**
(the Hooks System is `id 32`, numbered "Lesson 10"), so `search.js` prints, e.g.,
`Hooks System (id 32, numbered "Lesson 10")`. Always pass the **id** to
`fetch-lesson`/`xref` (`claude-code-internals fetch-lesson 32`, `claude-code-internals xref 32 25`), never the
"Lesson N" number.

## Read more (Cowork skill-authoring answers only)

If the question is about writing, testing, or debugging a skill or plugin that
runs in Cowork, and a script printed a `Skill-author page:` line, end your answer
with `Read more: <url>` using that URL **exactly** as printed, including its
`?ref=skill` suffix — never shorten, strip, or rewrite it. If several pages were
printed, keep only the one or two most directly answering the question. You run
forked, so this line must be in the message you return. No links for general
CLI-internals answers, and never invent a URL.

If no script printed a page **and the answer itself is about running a skill or
plugin in Cowork**, pick the one matching row below and copy its URL verbatim
(with `?ref=skill`). Every row is a **Cowork-lane** symptom — so if the answer is
a core Claude Code topic (hooks, permissions, settings, versions, ids, sessions,
MCP) with no Cowork angle, append **no** `Read more:` line at all. Match the row
only when the Cowork wording fits the question; the site is Cowork
skill-authoring pages, and a link on an off-topic answer is wrong. These are the
only URLs that exist:

| Cowork symptom / topic | Page |
|---|---|
| Tool refused the path your shell printed; where to write; attached file "missing" | `https://ccinternals.dev/cowork/files-and-paths/?ref=skill` |
| File exists but the user never saw it; long run goes silent | `https://ccinternals.dev/cowork/delivering-outputs/?ref=skill` |
| `rm`/`rmdir` permission error; moving a file between mounts fails | `https://ccinternals.dev/cowork/deleting-files/?ref=skill` |
| Env var empty inside the Cowork VM shell; global install fails or disappears there | `https://ccinternals.dev/cowork/shell-commands/?ref=skill` |
| Detecting Cowork; skill ran but its scripts/sub-agents didn't | `https://ccinternals.dev/cowork/detecting-cowork/?ref=skill` |
| Plugin hooks, `CLAUDE_PLUGIN_ROOT`, plugin MCP tools missing in cloud | `https://ccinternals.dev/cowork/plugins-and-plugin-root/?ref=skill` |
| Sub-agent dispatch in Cowork | `https://ccinternals.dev/cowork/sub-agents/?ref=skill` |
| Asking the user for missing arguments (elicitation vs AskUserQuestion) | `https://ccinternals.dev/cowork/asking-the-user/?ref=skill` |
| Tool names/behavior that change without a version bump | `https://ccinternals.dev/cowork/what-can-change-under-you/?ref=skill` |
| "Give me all the rules" / pre-flight checklist | `https://ccinternals.dev/cowork/contract/?ref=skill` |
| What build this was verified against | `https://ccinternals.dev/cowork/current-state/?ref=skill` |
| Start / overview | `https://ccinternals.dev/cowork/?ref=skill` |

## Caveats

- **Reverse-engineered, not official docs.** Treat as high-quality community
  documentation. When something contradicts your runtime observation, trust what
  you observe.
- **Confidence tiers.** Lessons 1–50 were reverse-engineered from source docs
  (v2.1.88, confirmed unchanged through v2.1.120); everything from lesson 51 on
  was extracted directly from the running binaries and is the highest-confidence
  material. If you run a newer binary, treat the fast-moving subsystems (Cowork,
  plugins, models) with extra scrutiny.
- **Unreleased features are speculative.** `05-unreleased-bigpicture.md` (KAIROS,
  ULTRAPLAN) is inferred from source; those features may never ship or may look
  very different. BUDDY was removed in v2.1.97.

## If no topic was given

Print this and ask what they want to know:

```
Available topics (218 lessons across 59 chapters):
  Boot & Core:    boot sequence, query engine, state management, system prompt, architecture overview
  Tools:          tool system, bash tool, file tools, search tools, MCP system
  Agents & AI:    skills system, agent system, coordinator mode, teams/swarm
  Memory & UI:    memory system, auto-memory, ink renderer, commands system, dialog/UI, notifications
  Interface:      vim mode, keybindings, fullscreen, theme/styling
  Infrastructure: permissions, settings/config, session management, context compaction, analytics, migrations
  Connectivity:   plugin system, hooks system, error handling, bridge/remote, OAuth, git integration,
                  upstream proxy, cron/scheduling, voice system
  Cowork/Desktop: host-loop vs VM-loop, sandbox mounts, path resolution, file delivery, control protocol,
                  credential channels, sub-agent execution, artifacts, device tools
  Released:       ULTRAPLAN (research preview) — remote planning via Claude Code on the web
  Unreleased:     entrypoints/SDK, KAIROS always-on, cost analytics, desktop app, model system,
                  sandbox/security, message processing, task system, REPL screen
```

## Reference routing

The exact `file → chapters → lesson ids → titles` map is generated into
`references/catalog.md` — read it (or `claude-code-internals fetch-lesson --list`) to pick a file by
chapter or lesson. Quick bands:

| Files | Chapters | Lesson ids | Area |
|-------|----------|-----------|------|
| `01`–`05` | 1–8 | 1–50 | Core subsystems: boot, query engine, tools, MCP, skills, agents, memory, UI, permissions, settings, sessions, compaction, plugins, hooks, OAuth, git; plus unreleased/big-picture |
| `06`–`18` | 9–21 | 51–104 | Binary-verified CLI, v2.1.90 → v2.1.159: /effort, /rewind, /fork, /dream, AskUserQuestion, Opus 4.8, Dynamic Workflows, env-var and command churn |
| `19`–`23` | 22–26 | 105–109 | Desktop host + Cowork foundations: MCP-Apps bridge, elicitation, CLI-plugin credential broker, spawn/stream-json control protocol, env vars & gates, Spaces/Tasks/checkpointing |
| `24`–`34` | 27–37 | 110–132 | CLI refresh v2.1.198 + Desktop/Cowork internals: runtime detection, VM rootfs forensics, stream contract, cloud tasks/bridge, reasoning config, sub-agent execution, device/partner bridges, skill discovery |
| `35`–`43` | 38–46 | 133–169 | CLI refresh v2.1.217/v2.1.231 + Cowork lanes & mounts, probe corrections, elicitation classes, auto-memory gates, path resolution, compaction budget, in-app browser |
| `44`–`50` | 47–53 | 170–198 | CLI surface v2.1.250 + plugin `bin/` PATH & cloud lane, narration/silent-turn, Desktop 1.46388/2.7032, artifact host-tools & folder skills |
| `51`–`56` | 54–59 | 199–218 | Plugin MCP stubs & hooks by lane, forked-skill relay & input channels, routine migration, Desktop 2.9939 artifacts/gates/egress, cloud device tools, uploaded skills |
