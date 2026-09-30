
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
