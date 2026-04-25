---
name: claude-code-internals
description: "Source-level architecture knowledge for Claude Code v2.1.120, verified against the live binary. Use when asked how Claude Code works internally, why something behaves unexpectedly, how to configure hooks correctly, what permission modes do, or when editing .claude/ config files. Covers 90 lessons: hooks (all 27 event types, exit code semantics), permissions (7-phase pipeline, 23 Bash validators), boot sequence, query engine, agents, MCP, memory, context compaction, plugins, sessions, OAuth, AskUserQuestion, and new binary-verified features through v2.1.120 (Claude Cowork's runtime infrastructure: /background + /bg + /stop forking the current main session into a kind:'fork' subagent with PTY recording + bridge transcript persistence + single-use CLAUDE_BRIDGE_REATTACH_SESSION/SEQ tokens, /daemon Ink TUI managing assistant/scheduled/remoteControl service categories, Fleet view = standalone 'claude agents' CLI subcommand mounting an Ink TUI dashboard with per-agent PR state tracking and tengu_fleetview_pr_batch batched-fetch toggle, /autocompact re-introduced with token-count argumentHint '[auto|<tokens>]' and autoCompactWindow state field, session identity quartet CLAUDE_CODE_SESSION_KIND/ID/NAME/LOG with bg|daemon|daemon-worker discriminator + 5-var BG-context env-strip, worktree-isolation runtime prompt mutation when CLAUDE_BG_ISOLATION='worktree', PTY recording via internal --bg-pty-host argv mode to CLAUDE_PTY_RECORD path, classifier-summary status pipeline pushing notifyMetadataChanged({post_turn_summary}) to Cowork Desktop with surface map bg/watched/ccr/bridge/desktop/cli + heuristic/llm engine selection + three independent kill switches (tengu_classifier_disabled_surfaces / _summary_kill / tengu_cobalt_wren LLM→heuristic cost circuit-breaker), pro-trial conversion screens, persistent daemon install kill-switched in v2.1.120 with CLAUDE_CODE_DAEMON_COLD_START='transient'|'ask' on-demand-only model and daemon hot-upgrade self-restart, AUTO_RELAUNCH_UNFOCUSED_MS / _MIN_INTERVAL_MS rate-limit gates, CLAUDE_CODE_LEAN_PROMPT granular per-section prompt-shaping toggle (Bash/ripgrep gated by tengu_vellum_lantern + Opus-4.7-only, memory-types gated by tengu_ochre_finch) distinct from CLAUDE_CODE_SIMPLE wholesale swap, CLAUDE_EFFORT skill-frontmatter field with template-substitution token ${CLAUDE_EFFORT} resolving to literal English phrases (low|medium|high|xhigh) NOT a process.env var, CLAUDE_COWORK_MEMORY_GUIDELINES bypass form completely replacing memory injection (sibling _EXTRA_GUIDELINES is the additive form), tengu_memory_write_survey_event Approve/Reject confirmation dialog with per-write Sonnet-4.6 LLM-generated summary ≤120 chars and 5-second countdown, CLAUDE_CODE_VERIFY_PROMPT debugging-workflow discipline injection with tengu_sparrow_ledger as its dark-launch flag, tengu_plan_mode_violated observability-only tripwire (no enforcement), tengu_bg_retired idle worker reaper with 6 do-not-retire guards, /schedule description simplified, CLAUDE_CODE_HIDE_CWD privacy knob, CLAUDE_AGENTS_SELECT pre-select var, /fork background subagent inheriting full conversation + 'f' keybinding + implicit fork subagent type not selectable via subagent_type, CLAUDE_CODE_FORK_SUBAGENT env var + tengu_copper_fox GB flag, CLAUDE_BRIDGE_REATTACH_SESSION/SEQ bridge plumbing, skill context:'fork' frontmatter now dispatches to real V75 helper, /cost and /stats folded into /usage as aliases with dual interactive/headless registrations, cache-diagnosis-2026-04-07 prompt cache diagnostics beta with graceful server-reject, frontmatter shadow validator silently emitting tengu_frontmatter_shadow_unknown_key/mismatch telemetry, WIF user-OAuth advisory file-locking preventing refresh-token races between multiple Claude Code processes, dark-launched /pro-trial-expired, CLAUDE_CODE_RATE_LIMIT_TIER/SUBSCRIPTION_TYPE OAuth token overrides, /autocompact and /stop-hook removed outright, /schedule gains one-time scheduling with triggers→routines terminology, /autofix-pr description drops 'remote session' framing, OIDC Federation enterprise auth with credentials-file profiles, CLAUDE_CODE_HTTP(S)_PROXY fallbacks and downstream proxy propagation to npm/yarn/docker/Java/gcloud child processes, /model slash command non-interactive mode for headless scripting, CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT slim-prompt alias, CLAUDE_CODE_RETRY_WATCHDOG gated to Linux+remote entrypoint, server-side Advisor Tool, PushNotification + KAIROS mobile push, Context Hint API server-driven micro-compaction, Fullscreen TUI with /focus /tui and DECSTBM scrolling regions, Proxy Auth Helper, System Prompt GB Override, /fewer-permission-prompts (renamed from /less-permission-prompts), canary channel, slow first-byte watchdog, async-agent stall watchdog, daemon background-stdout backend, Windows backspace mapping, /recap, multi-repo checkout, byte watchdog, REPL mode, managed-agents API beta, streaming partial yield, marble-origami context collapse, Remote Workflow Commands /autopilot /bugfix /dashboard /docs /investigate shipped in v2.1.110 and sunset in v2.1.113). Also use for: 'why did compaction fire', 'hook not triggering', 'permission denied', 'how does agent spawning work', 'what is coordinator mode', 'how does rewind work', 'how to set effort level', 'how does AskUserQuestion work', 'how does /dream work', 'what is Perforce mode', 'what are script caps', 'what is CLAUDE_CODE_CERT_STORE', 'what is away summary', 'how does loop pacing work', 'what is marble origami', 'how does context collapse work', 'streaming fallback', 'partial yield', 'quiet_salted_ember', 'what is /recap', 'byte watchdog', 'REPL mode', 'multi-repo checkout', 'managed agents', 'why is /autopilot gone', 'why was /bugfix removed', 'what is the advisor tool', 'what is PushNotification', 'what is context hint', 'what is fullscreen TUI', 'proxy auth helper', 'system prompt override', '/fewer-permission-prompts', 'tengu_hazel_osprey', 'tengu_sage_compass2', 'tengu_pewter_brook', 'tengu_marlin_porch', 'tengu_copper_fox', 'canary channel', 'slow first byte', 'async agent stall', 'CLAUDE_BG_BACKEND', 'DECSTBM', 'OIDC federation', 'identity token', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_CONFIG_DIR', 'ANTHROPIC_PROFILE', 'env-quad', 'credentials file', 'CLAUDE_CODE_HTTP_PROXY', 'CLAUDE_CODE_HTTPS_PROXY', 'proxy fallback', '/model headless', 'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT', 'CLAUDE_CODE_RETRY_WATCHDOG', 'tool-use isolation latch', 'enforce_web_search_mcp_isolation', 'tengu_doorbell_agave', 'tengu_gouda_loop', 'tengu_mcp_concurrent_connect', 'tengu_mcp_resource_templates_fetched', 'tengu_rc_upsell_notification_shown', 'tengu_remote_attach_session', 'tengu_ultraplan_plan_ready', 'tengu_tool_use_isolation_latch_denied', 'tengu_ccr_post_turn_summary', '--remote attach', '/remote-control upsell', 'ULTRAPLAN plan ready', 'MCP resource templates', 'MCP concurrent connect', 'closed issue notice', 'Pa_ isolation latch', '/fork', 'fork subagent', 'CLAUDE_CODE_FORK_SUBAGENT', 'CLAUDE_BRIDGE_REATTACH_SESSION', 'CLAUDE_BRIDGE_REATTACH_SEQ', 'why is /cost gone', 'why is /stats gone', 'cache-diagnosis', 'frontmatter shadow', 'tengu_frontmatter_shadow_unknown_key', 'tengu_frontmatter_shadow_mismatch', 'WIF OAuth lock', 'tengu_wif_user_oauth_lock_acquired', '/pro-trial-expired', 'CLAUDE_CODE_RATE_LIMIT_TIER', 'CLAUDE_CODE_SUBSCRIPTION_TYPE', 'why is /autocompact gone', 'why is /stop-hook gone', 'forksParentContext', 'Claude Cowork', 'cowork runtime', '/background', '/bg', '/stop background', '/daemon', '/autocompact returned', 'Fleet view', 'claude agents subcommand', 'CLAUDE_CODE_SESSION_KIND', 'CLAUDE_BG_ISOLATION', 'CLAUDE_BG_RENDEZVOUS_SOCK', 'CLAUDE_BG_SOURCE', 'CLAUDE_BG_BACKEND daemon', 'CLAUDE_JOB_DIR', 'CLAUDE_PTY_RECORD', 'CLAUDE_AGENTS_SELECT', 'CLAUDE_AGENT', 'CLAUDE_CODE_AGENT', 'CLAUDE_CODE_HIDE_CWD', 'CLAUDE_CODE_VERIFY_PROMPT', 'CLAUDE_CODE_CLASSIFIER_SUMMARY', 'CLAUDE_INTERNAL_FC_OVERRIDES', 'CLAUDE_CODE_DAEMON_COLD_START', 'CLAUDE_CODE_LEAN_PROMPT', 'CLAUDE_COWORK_MEMORY_GUIDELINES', 'CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES', 'CLAUDE_AGENTS_AUTO_RELAUNCHED_AT', 'CLAUDE_EFFORT', 'effort: high', 'effort frontmatter', '${CLAUDE_EFFORT} template', 'low medium high xhigh effort', '--bg-pty-host', 'claude respawn', 'session kind bg daemon', 'kind fork subagent', 'background fork', 'persistent daemon install', 'transient ask cold-start', 'daemon hot upgrade', 'lean prompt section', 'cowork memory bypass', 'memory write approve reject', 'memory write survey', 'plan mode tripwire', 'plan mode violated observability', 'idle worker reaper', 'tengu_bg_retired', 'classifier summary pipeline', 'cowork desktop status', 'post_turn_summary', 'notifyMetadataChanged', 'tengu_classifier_disabled_surfaces', 'tengu_classifier_summary_kill', 'tengu_cobalt_wren', 'tengu_fleetview', 'tengu_fleetview_pr_batch', 'tengu_open_agents_via_left', 'tengu_fg_left_arrow_agents', 'tengu_pro_trial_start', 'tengu_daemon_lease', 'tengu_daemon_self_restart_on_upgrade', 'tengu_daemon_install', 'tengu_bg_dispatch', 'tengu_bg_worker_spawn', 'tengu_background', 'tengu_sparrow_ledger', 'tengu_vellum_lantern', 'tengu_ochre_finch', 'tengu_amber_anchor', 'tengu_quiet_harbor', 'tengu_slate_siskin', 'tengu_umber_petrel', 'tengu_hazel_osprey_floor', 'tengu_sepia_cormorant', 'tengu_slate_meadow', 'tengu_memory_write_survey_event', 'tengu_plan_mode_violated', 'tengu_bg_daemon_cold_start_ask', 'tengu_daemon_startup_crash', 'AUTO_RELAUNCH_UNFOCUSED_MS', 'AUTO_RELAUNCH_MIN_INTERVAL_MS', 'EnterWorktree first action', 'worktree isolation prompt', 'reproduce verify workflow', 'subagent system prompt', 'focus mode prompt section', 'context management prompt section', '/schedule description simplified'."
user-invocable: true
argument-hint: "[topic - e.g. hooks, permissions, memory, agents, compaction]"
context: fork
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

You are a Claude Code architecture expert with access to 90 lessons covering Claude Code
internals — verified against live binaries through v2.1.120. Lessons 1–50 were reverse-engineered
from source docs (v2.1.88, confirmed unchanged through v2.1.120). Lessons 51–90 were extracted
directly from the v2.1.90/v2.1.92/v2.1.94/v2.1.100/v2.1.101/v2.1.104/v2.1.107/v2.1.108/v2.1.109/v2.1.110/v2.1.111/v2.1.112/v2.1.113/v2.1.114/v2.1.116/v2.1.117/v2.1.118/v2.1.119/v2.1.120 binaries. L11 (Skills System) was re-verified against the v2.1.116 bundle in v2.9.0 and extended with a `progressMessage` deep-dive in v2.9.1. L86 (OIDC Federation + proxy plumbing + `/model` headless) was added in v2.9.1. L87 (/fork background subagent, rate-limit/subscription overrides, /autocompact + /stop-hook removal) and L88 (/cost + /stats → /usage aliases, cache-diagnosis-2026-04-07, frontmatter shadow validator, WIF OAuth locking) were added in v2.10.0. **L89 (v2.1.119 Cowork-runtime GA: /background, /daemon, Fleet view, classifier-summary, session identity taxonomy) and L90 (v2.1.120 daemon on-demand model, CLAUDE_CODE_LEAN_PROMPT, CLAUDE_COWORK_MEMORY_GUIDELINES, memory-write Approve/Reject UX, plan-mode tripwire) were added in v2.11.0.** v2.11.1 corrected L89: most of the new user-facing surface is **dark-launched** in v2.1.119/v2.1.120 — `/daemon` is hardcoded off (`OqH() = return false`), `/background` and Fleet view are gated by the `tengu_slate_meadow` GB flag (default false; flipped for Claude Max/Cowork users), `/stop` is conditional on bg session. Only `/autocompact` and `/fork` from this surface are universally live. The runtime *code* shipped; the user *surface* is gated. Methodology note: when verifying a new slash command, always trace the master command-resolver-array inclusion (`...VAR && fn() ? [VAR] : []`), not just per-command `isEnabled` — registration in the bundle ≠ reachable command.

**Topic:** $argument

## If no topic was given

If `$argument` is empty or just whitespace, print this index and ask what the user wants to know:

```
Available topics (90 lessons across 20 chapters):
  Boot & Core:    boot sequence, query engine, state management, system prompt, architecture overview
  Tools:          tool system, bash tool, file tools, search tools, MCP system
  Agents & AI:    skills system, agent system, coordinator mode, teams/swarm
  Memory & UI:    memory system, auto-memory, ink renderer, commands system, dialog/UI, notifications
  Interface:      vim mode, keybindings, fullscreen, theme/styling
  Infrastructure: permissions, settings/config, session management, context compaction, analytics, migrations
  Connectivity:   plugin system, hooks system, error handling, bridge/remote, OAuth, git integration,
                  upstream proxy, cron/scheduling, voice system, BUDDY companion
  Released:       ULTRAPLAN (research preview) — remote planning via Claude Code on the web
  Unreleased:     entrypoints/SDK, KAIROS always-on, cost analytics, desktop app,
                  model system, sandbox/security, message processing, task system, REPL screen
  New (v2.1.90):  /effort reasoning budget [now documented incl. max/auto], /rewind file checkpointing,
                  /teleport session transfer, /branch conversation fork, session resume,
                  new env vars [binary-verified],
                  /autocompact /toggle-memory [undocumented], /powerup [documented],
                  /buddy [removed in v2.1.97]
  New (v2.1.92):  /setup-bedrock [now documented], /stop-hook (disabled), CLAUDE_CODE_EXECPATH,
                  CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX [now documented], removed /tag+/vim,
                  AskUserQuestionTool (full schema, preview, permissions, Plan Mode rules)
  New (v2.1.94):  /autofix-pr remote PR autofix, /team-onboarding usage-derived onboarding guide,
                  Mantle provider support, CLAUDE_CODE_MCP_ALLOWLIST_ENV,
                  CLAUDE_CODE_SANDBOXED, CLAUDE_CODE_TEAM_ONBOARDING
  New (v2.1.97-v2.1.100):  /dream memory consolidation (4-phase, fork, sandboxed),
                  /setup-vertex [now documented], Perforce mode [now documented],
                  Script Caps [now documented], custom model capabilities,
                  /buddy removed, REPL env vars removed
  New (v2.1.101): proactive away summary (recap on terminal refocus), CLAUDE_CODE_CERT_STORE,
                  dynamic loop pacing with aging, cloud-first loop offering,
                  /loops management UI (disabled), /update in-place upgrade (disabled),
                  SDK OAuth refresh, SDK observability telemetry, MCP registry BFF,
                  marble-origami reversible context collapse persistence
  New (v2.1.104): streaming partial yield protection (preserves partial content on timeout),
                  system prompt "Communication style" → "Text output (does not apply to tool calls)"
                  rename (gated: quiet_salted_ember + opus-4-6 model only)
  New (v2.1.107-v2.1.109): /recap on-demand session recap, multi-repo checkout (REPO_CHECKOUTS,
                  BASE_REFS), byte-level stream watchdog, REPL mode, managed-agents-2026-04-01
                  API beta, /think-back+/thinkback-play removed, /clear description change,
                  Session recap settings toggle, rate limit upgrade paths
  New (v2.1.110-v2.1.111): Remote Workflow Commands (/autopilot, /bugfix, /dashboard, /docs,
                  /investigate — all spawn CCR v2 sessions; SUNSET in v2.1.113 — see L85),
                  server-side Advisor Tool (reviewer model for primary model's tool calls),
                  PushNotification tool + KAIROS mobile push, Context Hint API (server-driven
                  micro-compaction via beta header context-hint-2026-04-09), Fullscreen TUI +
                  /focus + /tui (alt-screen mode), Proxy Auth Helper (rotating proxy credentials
                  via shell command), System Prompt GB Override (server can replace system prompt
                  in CCR contexts), /less-permission-prompts built-in (RENAMED to
                  /fewer-permission-prompts in v2.1.113 — see L85), append-subagent-prompt,
                  canary channel, slow first-byte watchdog, external editor context,
                  PR status footer
  New (v2.1.112-v2.1.113): Remote Workflow Commands sunset (/autopilot, /bugfix, /dashboard,
                  /docs, /investigate removed outright), /less-permission-prompts renamed to
                  /fewer-permission-prompts, async-agent stall watchdog
                  (CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS default 10min), daemon background-stdout
                  backend (CLAUDE_BG_BACKEND=daemon), Windows backspace mapping
                  (CLAUDE_CODE_BS_AS_CTRL_BACKSPACE), fullscreen DECSTBM scrolling regions
                  (CLAUDE_CODE_DECSTBM + tengu_marlin_porch), /compact and /exit description
                  tweaks. v2.1.112 was a no-op release for public surface.
  New (v2.1.114-v2.1.116): OIDC Federation enterprise auth (authentication.type:
                  "oidc_federation", beta header oidc-federation-2026-04-01, 8 new
                  ANTHROPIC_* env vars: FEDERATION_RULE_ID, IDENTITY_TOKEN,
                  IDENTITY_TOKEN_FILE, ORGANIZATION_ID, SERVICE_ACCOUNT_ID, SCOPE,
                  CONFIG_DIR, PROFILE), env-quad vs credentials-file profile resolution
                  at <config_dir>/configs/<profile>.json, /model slash command
                  supportsNonInteractive for headless use, CLAUDE_CODE_HTTP(S)_PROXY
                  fallbacks with downstream propagation to npm/yarn/docker/Java/gcloud,
                  CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT alias, CLAUDE_CODE_RETRY_WATCHDOG
                  (Linux + remote entrypoint only), 12 new tengu_* identifiers incl.
                  4 GB flags gating dark-launched features: tengu_doorbell_agave
                  (enforce_web_search_mcp_isolation tool-use isolation latch via Pa_()),
                  tengu_mcp_concurrent_connect (parallel MCP boot), tengu_gouda_loop
                  (closed-issue notice), tengu_ccr_post_turn_summary (remote post-turn
                  summary); plus telemetry implying wired-up /remote-control upsell,
                  --remote attach capability, ULTRAPLAN plan-ready, and MCP
                  resources/templates/list capability. v2.1.114 was a no-op release.
  New (v2.1.117-v2.1.118): /fork background subagent command inheriting full
                  conversation (interactive-only, 'f' keybinding, three-layer gating
                  via CLAUDE_CODE_FORK_SUBAGENT env + tengu_copper_fox GB flag, new
                  implicit 'fork' subagent type not selectable via subagent_type,
                  CLAUDE_BRIDGE_REATTACH_SESSION/SEQ bridge plumbing, skill
                  context:'fork' now dispatches to real V75 fork helper),
                  CLAUDE_CODE_RATE_LIMIT_TIER/SUBSCRIPTION_TYPE OAuth token
                  overrides, /schedule one-time scheduling (triggers→routines),
                  /autocompact and /stop-hook removed outright (L87);
                  /cost and /stats folded into /usage aliases with dual
                  interactive/headless registrations, /autofix-pr description
                  drops 'remote session' framing, dark-launched /pro-trial-expired,
                  cache-diagnosis-2026-04-07 prompt cache diagnostics beta with
                  graceful server-reject degradation, frontmatter shadow validator
                  (tengu_frontmatter_shadow_unknown_key/mismatch — groundwork for
                  future strict mode), WIF user-OAuth advisory file-locking (4
                  telemetry events preventing refresh-token races between multiple
                  Claude Code processes), CLAUDE_CODE_AGENT_NAME/TEAM_NAME removed,
                  plus observability additions for byte watchdog late firing,
                  advisor tool retry, terminal probing, DOM keybindings (L88).
  New (v2.1.119-v2.1.120): Claude Cowork's runtime infrastructure goes live.
                  v2.1.119: /background (alias /bg) forks current main session into
                  a kind:'fork' background subagent reusing L87 fork infrastructure,
                  /stop dual-registered (only enabled when SESSION_KIND==='bg'),
                  /daemon Ink TUI managing assistant/scheduled/remoteControl service
                  categories, /autocompact re-introduced with token-count
                  argumentHint '[auto|<tokens>]', Fleet view = standalone
                  'claude agents' CLI subcommand mounting Ink TUI with per-agent PR
                  state tracking, CLAUDE_CODE_SESSION_KIND quartet
                  (bg|daemon|daemon-worker) + 5-var BG-context env-strip,
                  CLAUDE_BG_ISOLATION='worktree' triggers runtime prompt rewrite
                  forcing EnterWorktree first, CLAUDE_PTY_RECORD via internal
                  --bg-pty-host argv mode, classifier-summary status pipeline
                  pushing notifyMetadataChanged({post_turn_summary}) to Cowork
                  Desktop with surface map bg/watched/ccr/bridge/desktop/cli,
                  heuristic/llm engine selection, three independent kill switches
                  (tengu_classifier_disabled_surfaces, _summary_kill,
                  tengu_cobalt_wren cost circuit-breaker), pro-trial conversion
                  telemetry (L89). v2.1.120: persistent daemon install
                  kill-switched (xQH() aborts) — only on-demand modes available
                  via CLAUDE_CODE_DAEMON_COLD_START='transient'|'ask', daemon
                  hot-upgrades itself, AUTO_RELAUNCH_UNFOCUSED_MS/MIN_INTERVAL_MS
                  rate-limit gates, CLAUDE_CODE_LEAN_PROMPT granular per-section
                  prompt-shaping toggle (Bash/ripgrep gated by tengu_vellum_lantern
                  Opus-4.7-only, memory-types gated by tengu_ochre_finch) distinct
                  from L86 wholesale CLAUDE_CODE_SIMPLE swap, CLAUDE_EFFORT is NOT
                  an env var — it's a skill-frontmatter field 'effort:' + template
                  token ${CLAUDE_EFFORT} resolving to literal English phrases
                  (low|medium|high|xhigh), CLAUDE_COWORK_MEMORY_GUIDELINES bypass
                  form completely replaces memory injection (sibling
                  _EXTRA_GUIDELINES is additive form), tengu_memory_write_survey_event
                  Approve/Reject confirmation dialog with Sonnet-4.6 LLM summary
                  and 5-second countdown, CLAUDE_CODE_VERIFY_PROMPT injects 3-step
                  reproduce→fix→re-observe debugging discipline
                  (tengu_sparrow_ledger is its dark-launch flag),
                  tengu_plan_mode_violated observability-only tripwire (NOT
                  enforcement), tengu_bg_retired idle worker reaper with 6
                  do-not-retire guards, /schedule description simplified (NOT a
                  new registration), CLAUDE_CODE_HIDE_CWD privacy knob,
                  CLAUDE_AGENTS_SELECT pre-selects agent across left-arrow→child
                  spawn (L90).
```

---

## Step 1: Check version staleness

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/check-version.sh 2>/dev/null
```

Silent if versions match. Prints a warning if the Claude Code version you're running differs from v2.1.120.
If there's a mismatch, note it in your answer — hooks and permission details change frequently.

## Step 2: Search with unified RRF

Run the Reciprocal Rank Fusion search (keyword + TF-IDF combined):

```bash
node ${CLAUDE_SKILL_DIR}/scripts/search.js "$argument" --top=5
```

Fallback if search.js is unavailable:
```bash
bash ${CLAUDE_SKILL_DIR}/scripts/lookup.sh "$argument"
node ${CLAUDE_SKILL_DIR}/scripts/semantic-search.js "$argument"
```

Results include lesson title, **lesson ID**, file path, line range, and confidence.
`[HIGH]` = matched both search layers — strongly prefer these.
Note the lesson IDs; you'll use them in Step 3.

## Step 3: Check cross-references for multi-topic queries

Skip for single-concept queries. For queries spanning subsystems (e.g. "hooks and permissions",
"agents and memory"), use the lesson IDs from Step 2 to surface related lessons you'd otherwise miss.

```bash
node ${CLAUDE_SKILL_DIR}/scripts/xref.js <id1> [id2] [id3]
# Example: node ${CLAUDE_SKILL_DIR}/scripts/xref.js 10 29
```

## Step 4: Check troubleshooting index for problem queries

If the query describes a problem ("not working", "why", "broken", "keeps", "error", "won't", "fails"):

```bash
node ${CLAUDE_SKILL_DIR}/scripts/troubleshoot.js "$argument"
```

## Step 5: Fetch matched lesson content

Use `fetch-lesson.js` to retrieve lesson content by ID — no need to track file paths or line offsets:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/fetch-lesson.js <id>
# List all lessons: node ${CLAUDE_SKILL_DIR}/scripts/fetch-lesson.js --list
```

For multi-lesson topics, fetch each in turn. For a quick lookup without full content:
```bash
node ${CLAUDE_SKILL_DIR}/scripts/fetch-lesson.js <id> --meta
```

If `fetch-lesson.js` is unavailable, fall back to `Read` with the file/offset from search results.
All reference files are in `${CLAUDE_SKILL_DIR}/references/`.

| File | Chapters | Lessons |
|------|----------|---------|
| `01-core-architecture-tools.md` | 1-2 | Boot Sequence (L1), Query Engine (L4), State Management (L12), System Prompt (L39), Architecture Overview (L50), Tool System (L2), Bash Tool (L17), File Tools (L18), Search Tools (L19), MCP System (L7) |
| `02-agents-intelligence-interface.md` | 3-4 | Skills System (L11), Agent System (L6), Coordinator Mode (L13), Teams/Swarm (L14), Memory System (L15), Auto-Memory (L16), Ink Renderer (L21), Commands System (L22), Dialog/UI (L23), Notifications (L24) |
| `03-interface-infrastructure.md` | 4-5 | Vim Mode (L25), Keybindings (L26), Fullscreen (L27), Theme/Styling (L28), Permissions (L29), Settings/Config (L30), Session Management (L31), Context Compaction (L32), Analytics (L33), Migrations (L34) |
| `04-connectivity-plugins.md` | 5-6 | Plugin System (L35), Hooks System (L10), Error Handling (L36), Bridge/Remote (L37), OAuth (L38), Git Integration (L40), Upstream Proxy (L41), Cron/Scheduling (L43), Voice System (L44), BUDDY Companion (L45) |
| `05-unreleased-bigpicture.md` | 7-8 | ULTRAPLAN (L41), Entrypoints/SDK (L42), KAIROS Always-On (L46), Cost Analytics (L47), Desktop App (L48), Model System (L49), Sandbox/Security (L47), Message Processing (L48), Task System (L49), REPL Screen (L50) |
| `06-verified-new-v2.1.90.md` | 9 | **Binary-verified.** /effort & reasoning budget (L51), /rewind & file checkpointing (L52), /teleport session transfer (L53), /branch conversation fork (L54), Session resume & new env vars (L55), New commands: /autocompact /buddy /powerup /toggle-memory (L56) |
| `07-verified-new-v2.1.92.md` | 10 | **Binary-verified v2.1.92.** Command changes: /setup-bedrock, /stop-hook (disabled), /teleport confirmed, /tag+/vim removed (L57). New env vars: CLAUDE_CODE_EXECPATH, CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX, CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK (L58). AskUserQuestionTool (L59) |
| `08-verified-new-v2.1.94.md` | 11 | **Binary-verified v2.1.94.** Command changes: /autofix-pr, /team-onboarding, /loop still present (L60). New env vars: CLAUDE_CODE_USE_MANTLE, CLAUDE_CODE_MCP_ALLOWLIST_ENV, CLAUDE_CODE_SANDBOXED, CLAUDE_CODE_TEAM_ONBOARDING (L61). |
| `09-verified-new-v2.1.100.md` | 12 | **Binary-verified v2.1.97–v2.1.100.** /dream user-facing memory consolidation with 4-phase prompt, gate chain, sandboxing, team memory, tiny mode (L62). Perforce mode & Script Caps (L63). /setup-vertex, custom model capabilities, /buddy removal, REPL env var cleanup (L64). |
| `10-verified-new-v2.1.101.md` | 13 | **Binary-verified v2.1.101.** Proactive away summary (L65). CA Certificate Store (L66). Dynamic loop pacing & cloud-first offering (L67). v2.1.101 command & env var changes (L68). Marble Origami reversible context collapse (L69). |
| `11-verified-new-v2.1.104.md` | 14 | **Binary-verified v2.1.104.** Streaming partial yield protection (L70). System prompt section rename: "Text output" (L71). |
| `12-verified-new-v2.1.109.md` | 15 | **Binary-verified v2.1.107–v2.1.109.** /recap on-demand session recap (L72). Multi-repo checkout & base refs (L73). Byte-level stream watchdog (L74). REPL mode (L75). v2.1.107–v2.1.109 command & env var changes (L76). |
| `13-verified-new-v2.1.111.md` | 16 | **Binary-verified v2.1.110–v2.1.111.** Remote Workflow Commands /autopilot /bugfix /dashboard /docs /investigate (L77 — sunset in v2.1.113, see L85). Advisor Tool server-side reviewer model (L78). PushNotification + KAIROS mobile push (L79). Context Hint API server-driven micro-compaction (L80). Fullscreen TUI + /focus + /tui (L81). Proxy Auth Helper (L82). System Prompt GB Override, append-subagent, verified-vs-assumed (L83). v2.1.110–v2.1.111 command & env var changes incl. /less-permission-prompts (renamed in v2.1.113), canary channel, slow first-byte watchdog (L84). |
| `14-verified-new-v2.1.113.md` | 17 | **Binary-verified v2.1.112–v2.1.113.** v2.1.112 no-op. v2.1.113: Remote Workflow Commands sunset (all 5 deleted), /less-permission-prompts → /fewer-permission-prompts rename, 4 new env vars (CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS async-agent stall watchdog, CLAUDE_BG_BACKEND daemon stdout backend, CLAUDE_CODE_BS_AS_CTRL_BACKSPACE Windows backspace mapping, CLAUDE_CODE_DECSTBM fullscreen margin support), tengu_marlin_porch GrowthBook flag, /compact and /exit description tweaks (L85). |
| `15-verified-new-v2.1.116.md` | 18 | **Binary-verified v2.1.114–v2.1.116.** v2.1.114 no-op. v2.1.116: OIDC Federation enterprise auth (authentication.type "oidc_federation", 8 new ANTHROPIC_* env vars, beta header oidc-federation-2026-04-01, credentials-file profile system at `<config_dir>/configs/<profile>.json` vs env-quad mode), CLAUDE_CODE_HTTP(S)_PROXY fallbacks with downstream propagation to npm/yarn/docker/Java/gcloud, /model supportsNonInteractive for headless scripting, CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT alias, CLAUDE_CODE_RETRY_WATCHDOG (Linux + remote entrypoint), and 12 new tengu_* identifiers: 4 GB flags gating dark-launched features (tengu_doorbell_agave tool-use isolation latch via Pa_() + enforce_web_search_mcp_isolation, tengu_mcp_concurrent_connect parallel MCP boot, tengu_gouda_loop closed-issue notice, tengu_ccr_post_turn_summary), 5 telemetry implying wired-up features (MCP resources/templates/list, /remote-control upsell toast, --remote attach capability, ULTRAPLAN plan-ready, isolation-latch-denied), 3 observational telemetry (tengu_cli_flags, tengu_keybinding_fired, tengu_scroll_arrows_detected) (L86). |
| `16-verified-new-v2.1.118.md` | 19 | **Binary-verified v2.1.117–v2.1.118.** v2.1.117: /fork slash command (background subagent inheriting full conversation, 'f' keybinding, interactive-only, gated by CLAUDE_CODE_FORK_SUBAGENT env + tengu_copper_fox GB flag), new implicit 'fork' subagent type (tools ['*'], maxTurns 200, model 'inherit', permissionMode 'bubble' — not user-selectable via subagent_type), skills context:'fork' frontmatter now dispatches to real V75 fork helper, CLAUDE_BRIDGE_REATTACH_SESSION/SEQ bridge plumbing, CLAUDE_CODE_RATE_LIMIT_TIER/SUBSCRIPTION_TYPE OAuth token overrides, /schedule one-time scheduling (triggers→routines), /autocompact and /stop-hook removed outright (L87). v2.1.118: /cost and /stats folded into /usage aliases (dual interactive/headless registrations), /autofix-pr description drops 'remote session' framing, dark-launched /pro-trial-expired, cache-diagnosis-2026-04-07 API beta with graceful server-reject, frontmatter shadow validator (tengu_frontmatter_shadow_unknown_key/mismatch — groundwork for future strict mode), WIF user-OAuth advisory file-locking (4 telemetry events preventing refresh-token races across multiple Claude Code processes + tengu_oauth_401_recovered_from_disk), CLAUDE_CODE_AGENT_NAME/TEAM_NAME removed, plus observability for tengu_byte_watchdog_fired_late, tengu_advisor_strip_retry, tengu_terminal_probe, tengu_keybindings_dom (L88). |
| `17-verified-new-v2.1.120.md` | 20 | **Binary-verified v2.1.119–v2.1.120 (Claude Cowork's runtime release).** v2.1.119: Cowork is the product label for sessions running with CLAUDE_CODE_SESSION_KIND='bg' (no 'cowork' string in bundle — detection is via the BG family). New /background (alias /bg) forks current main session into a kind:'fork' subagent reusing L87 fork-subagent infrastructure unchanged. /stop dual-registered (interactive Ink modal + non-interactive headless), only enabled when SESSION_KIND='bg', UI text "Stop this background session? — Restart it from agents anytime." /daemon Ink TUI manages three service categories (assistant, scheduled, remoteControl — the 'remote-control server' is the Cowork Desktop bridge channel), CLI form `claude daemon -a <kind> <dir>` / `--remove`. /autocompact re-introduced with argumentHint '[auto|<tokens>]' (default ~100k, max ~1M, state field autoCompactWindow). Fleet view = standalone `claude agents` CLI subcommand (NOT a panel) mounting its own Ink TUI dashboard, tracks per-agent PR state (state, title, review, mergeable, mergeStateStatus, checks.passed/failed/pending, additions, deletions), gated on isAgentsFleetEnabled(), batched-fetch toggle tengu_fleetview_pr_batch. Session identity quartet (CLAUDE_CODE_SESSION_KIND/ID/NAME/LOG) plus 5-var BG-context check (T1H/vK/uC_) — all 5 vars stripped from env before subprocess spawn. Worktree-isolation runtime prompt mutation (bA3) when CLAUDE_BG_ISOLATION='worktree'. PTY recording via internal `--bg-pty-host <sock> <cols> <rows> -- <file> [args...]` argv mode to CLAUDE_PTY_RECORD path. CLAUDE_BRIDGE_REATTACH_SESSION/SEQ tokens (L87) consumed exactly once. Classifier-summary system (the Cowork Desktop status pipeline): surface map (bg/watched/ccr/bridge/desktop/cli) → capabilities (state/summary) → engine (heuristic/llm); three independent kill switches (tengu_classifier_disabled_surfaces, tengu_classifier_summary_kill, tengu_cobalt_wren LLM→heuristic cost circuit-breaker); output schema {status_category, status_detail, needs_action} pushed via notifyMetadataChanged({post_turn_summary}). Pro-trial conversion screens (4 telemetry events). 16 new env vars, 62 new tengu_* identifiers (36 background+daemon, 4 fleet, 4 pro-trial, 4 classifier, 5 codename flags, 9 other). /exit description acknowledges bg detach/stop (L89). v2.1.120: persistent daemon install kill-switched — xQH() aborts with "daemon service is not installed (service install is disabled in this version; the daemon runs on demand)". Only on-demand modes available via new CLAUDE_CODE_DAEMON_COLD_START env var: 'transient' (default, silent on-demand) or 'ask' (prompted). Daemon hot-upgrades itself (tengu_daemon_self_restart_on_upgrade). CLAUDE_CODE_LEAN_PROMPT introduces granular per-section prompt-shaping toggle distinct from L86 wholesale CLAUDE_CODE_SIMPLE swap — two leanable sections (Bash/ripgrep gated by tengu_vellum_lantern + Opus-4.7-only; memory-types gated by tengu_ochre_finch). CLAUDE_EFFORT is NOT an env var (the v2.1.120 diff regex was misreading a binary string-table dump): it's a skill-frontmatter field 'effort:' AND a template-substitution token ${CLAUDE_EFFORT} with values low|medium|high(default)|xhigh resolving to literal English phrases injected by _I(model, effort). CLAUDE_COWORK_MEMORY_GUIDELINES = Cowork's memory-bypass escape hatch — when set, completely replaces the entire memory-injection pipeline (sibling pre-existing _EXTRA_GUIDELINES is the additive form). tengu_memory_write_survey_event = Approve/Reject confirmation dialog for memory file writes with per-write Sonnet-4.6 LLM-generated summary (≤120 chars) and 5-second countdown. CLAUDE_CODE_VERIFY_PROMPT is debugging-workflow discipline (NOT safety) — injects 3-step reproduce→fix→re-observe instruction; identifies tengu_sparrow_ledger as its dark-launch flag. tengu_plan_mode_violated is observability-only tripwire (no enforcement, no early return). tengu_bg_retired = idle worker reaper with 6 do-not-retire guards. CLAUDE_AGENTS_AUTO_RELAUNCHED_AT (env key Ih8) plus AUTO_RELAUNCH_UNFOCUSED_MS (oz6 = 1h) and AUTO_RELAUNCH_MIN_INTERVAL_MS (sYK = 6h) rate-limit gates. CLAUDE_CODE_HIDE_CWD blanks cwd in status header for screensharing. CLAUDE_AGENTS_SELECT pre-selects an agent ID across left-arrow→child boundary. /schedule's description simplified (template-literal conditional → static string), no new registration. _FORK_SUBAGENTM 'env var' was a diff-tool string-table-adjacency artifact — NEVER a real var, fixed by rewriting extract_envvars in scripts/diff-versions.sh to use JS-context anchors. Bundle now embeds VERSION/BUILD_TIME/GIT_SHA literally (L90). |

If unsure which file, use Grep across all references:
```
Grep pattern="<keyword>" path="${CLAUDE_SKILL_DIR}/references/"
```

For topics spanning multiple lessons, read all matching sections and synthesize using the
cross-reference map.

## Step 6: Synthesize a focused answer

Structure your answer like this:

**[Subsystem]** — one-line summary of what it does and why it exists.

**Architecture:** Key components, data flow, or state machine. Include type definitions or
interfaces when they clarify the design.

**Configuration:** Options the user can actually set, and their effects.

**Non-obvious behavior:** Things that surprise people — ordering constraints, edge cases,
undocumented interactions.

**Example** (only when it illuminates the design):
```typescript
// concrete code example from the lesson
```

Keep it under 5KB. If the topic spans more than 3 lessons, ask which aspect matters most
before synthesizing everything.

---

## Gotchas

- **Reverse-engineered, not official docs.** Treat as high-quality community documentation.
  When something contradicts your runtime observation, trust what you observe.

- **[MEDIUM] search results can be noisy.** Check the lesson title before loading the full
  section. If it doesn't look right for the query, try a more specific search term.

- **Lesson IDs ≠ lesson numbers.** The `id` field in search output maps to cross-references.json
  keys. Use the file path + line range from search output to navigate directly — don't guess IDs.

- **Unreleased features are speculative.** Content in `05-unreleased-bigpicture.md` (KAIROS,
  ULTRAPLAN) is inferred from source code. These features may never ship or may look
  very different in final form. BUDDY was removed in v2.1.97.

- **Lessons 1–50 verified against v2.1.100 binary.** Core subsystems (hooks, permissions, boot,
  compaction) are unchanged between v2.1.88 and v2.1.100. If running a newer version, treat
  Ch.9–12 (new features) with extra scrutiny — those subsystems evolve fastest.
- **Lessons 51–88 are binary-extracted, not from third-party docs.** These are the highest-
  confidence claims in the skill — extracted directly from the running binary you have installed.
