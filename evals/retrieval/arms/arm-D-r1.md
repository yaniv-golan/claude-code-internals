Topic requested: $ARGUMENTS

You run **forked**: the parent sees only what you return, so put the whole answer
(and any `Read more:` line) in your final message. If the "Topic requested" line
above is blank, no topic was given — print the menu near the end of this file and
ask which area they want.

## What this skill contains

Everything is plain files in the skill folder — the "Base directory for this skill"
shown above (`${CLAUDE_SKILL_DIR}`). Use your own judgement about which files and
tools a question needs. Always give tools **absolute** paths into that folder.

- `references/NN-*.md` — 56 chapter files holding 218 lessons about Claude Code and
  Claude Cowork internals, read out of the shipping binaries. Each lesson starts at a
  `LESSON` heading. Chapters run up to 151 KB; one lesson (id 89) is 107 KB.
- `references/routing/index-*.md` — the table of contents, in two parts (~32k tokens
  together; each part fits in one Read). One line per lesson: id · title · "Lesson N"
  as printed in the file · `file:start-end` · description · example questions the
  lesson answers, in users' own words · a `read-more` URL on some. Lessons too big to
  read in one go list sub-ranges beneath their line. It is the only file that
  matches a question worded differently from the lesson text — many lessons are
  version roll-ups whose titles and headings don't name what a user would ask about.
- `references/routing/sections.md` — every heading of every lesson and state page,
  one per line, with its lesson id (or state page) and `file:line`. ~150 KB, so grep
  it rather than read it. Grep matches literal words only, so it finds exact terms
  and misses paraphrases.
- `references/state/*.md` — the **current-state** view, one page per domain (Cowork
  architecture, permissions, control protocol, credential channels, plugins/skills/
  hooks, models, commands, memory); `state/README.md` lists them. Each page is
  stamped `as_of` a binary version and may carry a `read_more:` URL. Two pages are
  large (59 KB, 46 KB); their sections are in `sections.md`.
- `references/state/registry.json` (328 KB) and `state/author-facts.json` (153 KB) —
  records keyed by exact names (env vars, gates, commands, settings, tools), with
  status (live, dark, renamed via `renamed_to`, removed) and provenance lesson ids.
- `references/troubleshooting.json` — symptom patterns → lesson ids.
  `references/cross-references.json` — lesson id → related lesson ids.

## Facts that bite

- `Read` refuses any result over ~25k tokens (about 48 KB of this text). Big files:
  read a line range, or grep.
- For lessons 1–50 the "Lesson N" in the file headings is **not** the lesson id (the
  Hooks System is id 32, printed "Lesson 10"). The index shows both; cite the id.
- In Cowork, file tools run on the host and can see this folder; the shell runs in a
  VM that cannot, and a Grep or Glob given no absolute path silently searches a
  different folder and finds nothing. Some surfaces have a shell but no Grep tool.
- The corpus baseline is **v2.1.231**. `scripts/check-version.sh` (run with `bash`)
  warns when the running `claude` differs; it is silent where `claude` is not on
  PATH, as in Cowork. Optional.

## Rules

1. For how anything behaves **now**, the state layer overrides any conflicting older
   lesson. Lessons are history, corrections and provenance.
2. Carry a version stamp into the answer and qualify by lane (CLI, Cowork host-loop,
   VM-loop, cloud) where it matters.
3. Cite the ids of lessons you actually read, not ones you only saw listed.

Example (one sensible path, not a required one): "what changed about /cost in
v2.1.118?" → grep `sections.md` for `/cost` → a heading in lesson 88 with its
`file:line` → read that section → answer, citing id 88.

## The answer

- **[Subsystem]** — one line on what it does and why it exists.
- **Architecture** — key components, data flow, state machine; include type
  definitions when they clarify the design.
- **Configuration** — options the user can actually set, and their effects.
- **Non-obvious behavior** — ordering constraints, edge cases, undocumented
  interactions.
- **Example** — only when it illuminates the design.

Keep the answer under 5 KB, and cite lesson ids. If the topic spans more than 3
lessons, ask which aspect matters most before synthesizing everything.

## Read more (Cowork skill-authoring answers only)

If the question is about writing, testing, or debugging a skill or plugin that runs
in Cowork, end your answer with `Read more: <url>`, copying the URL **exactly** from
a `read-more` field on an index line or a `read_more:` field of a state page you used,
including its `?ref=skill` suffix. Keep only the one or two most directly answering
the question. No links for general CLI-internals answers, and never invent a URL.

If no line or page you used carries one **and the answer itself is about running a
skill or plugin in Cowork**, pick the one matching row below and copy its URL
verbatim. Every row is a **Cowork-lane** symptom — for a core Claude Code topic
(hooks, permissions, settings, versions, ids, sessions, MCP) with no Cowork angle,
append **no** `Read more:` line. These are the only URLs that exist:

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
