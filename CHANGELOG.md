# Changelog

## v2.11.3 — 2026-04-29 (this fork) — Sub-agent tool-grant filtering documented + topic-index gap closed

Empirical-and-source pass on a real Cowork failure: forked sub-agents from `founder-skills:*` skills couldn't persist artifacts despite declaring `Bash` in `tools:`. Trace went through the v2.1.120 bundle, identified the `Tw8` base-tool filter and `Jl_` allowlist as the mechanism, ruled out a "Task-as-poison" pattern-match hypothesis, and confirmed empirically that adding `Write` and `Edit` to the agent's `tools:` array restores artifact persistence (probe lands `done`, byte-exact content match).

### Added

1. **L89 — new section: "Sub-Agent Tool-Grant Filtering: How Cowork-Async Dispatch Silently Strips Bash."** Documents:
   - The async-mode flag derivation (`isAsync = (O === true || v.background === true) && !lFH`)
   - The `Tw8` base-tool filter sequence (yJ pass-through → r3H drop → F_8 non-builtin drop → Jl_ async allowlist → V9/_X experimental fallback)
   - Resolved `Jl_` symbols (`Bq=Read, dV=WebSearch, _v=TodoWrite, A4=Grep, NY=WebFetch, h1=Glob, L9=Edit, s7=Write, Af=NotebookEdit, Xf=Skill, cN=TaskStop`); `Dq="Bash"` confirmed absent from the allowlist
   - The `vc()` user-tools classifier with its `validTools` / `invalidTools` / `unavailableTools` / `resolvedTools` buckets
   - The `Sz()` → `n0()` parse/canonicalize chain via the `ev6` legacy-name rename map (`Task → Agent`, `KillShell → cN`, `AgentOutputTool → BashOutput`, `BashOutputTool → BashOutput`)
   - The Agent special-case: `if (N === Z9) { ... if (!K) { P.push(v); continue } }` — with default `K = false`, declaring `"Task"` is a no-op (pushed to `validTools` but not `resolvedTools`)
   - Why `general-purpose` (`tools: ["*"]`, `source: "built-in"`) inherits the full filtered base via the wildcard branch, while plugin fork-skills with narrow `tools:` declarations get only the intersection
   - The empirical probe table (before-fix `fail`, after-fix `done`, control `general-purpose` `done` via Write)
   - Cross-references to L11 (Skills), L87 (fork plumbing), L37 (Bridge), L88 (settings)

2. **Risks Worth Flagging entry #6** points authors at the new section with the practical fix shape ("declare Write/Edit in the agent's tools:; move shell work to the top session").

3. **Scope-clarification callout** under the L89 section, distinguishing the runtime tool filter (governs forked-agent post-dispatch tool calls) from the body-time shell-substitution kill switch (governs `` !`cmd` `` substitutions before fork dispatch, via `CLAUDE_CODE_IS_COWORK` policy logic). Earlier drafts conflated the two; both gist and lesson now distinguish them clearly.

### Fixed

4. **`topic-index.json` had no L89 / L90 entries.** Preexisting gap: the index claimed `total_lessons: 88` while ch20 contained both lessons, so semantic search couldn't find Cowork-runtime / daemon / lean-prompt / sub-agent-tool-grant content. Added 275 new keywords across the two new entries; `keyword_map` grew from 985 to 1287 entries. Rebuilt `semantic-index.json` (90 lessons, 1363 vocab terms, 279 KB). Search for `Bash-stripped`, `CLAUDE_CODE_LEAN_PROMPT`, `sub-agent-tool-grant-filter`, `daemon-on-demand`, `tengu_memory_write_survey_event`, etc. now resolves.

### Companion gist updates (separate artifact, not in this plugin)

The public Skills/Plugins/Marketplaces reference gist (https://gist.github.com/yaniv-golan/303b6213b7a33167b3f98b076a5f81ad) was updated through four rounds of external fact-check, ending with: corrected `arguments` / `${CLAUDE_EFFORT}` / `channels` / `${CLAUDE_PLUGIN_ROOT}` documentation status to current docs, deleted nonexistent `pip` plugin source, fixed marketplace CLI commands (`claude plugin marketplace update`, no `refresh`/`auto-update`), corrected SDK section (default loads user/project skills, `allowed-tools` is CLI-only), corrected PowerShell gating, removed claims about `${CLAUDE_PROJECT_DIR}` and `${CLAUDE_PLUGIN_ROOT}` being injected as Bash-tool env vars, distinguished body-time shell-sub kill switch from runtime async filter, distinguished agent `tools:` (actual availability) from skill `allowed-tools:` (permission preapproval), warned that `CLAUDE_CODE_SESSION_KIND` and `CLAUDE_CODE_SESSION_NAME` are stripped from shell subprocess env. Final fact-check pass: "no remaining hard factual errors."

### Files changed

- `skill-package/skills/claude-code-internals/references/17-verified-new-v2.1.120.md` — new L89 section + scope clarification
- `skill-package/skills/claude-code-internals/references/topic-index.json` — L89/L90 entries + keyword_map
- `skill-package/skills/claude-code-internals/references/semantic-index.json` — rebuilt
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `keywords_indexed`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `CHANGELOG.md` — this entry

### Methodology takeaway

When debugging a Cowork-specific behavior, do not pattern-match the only-novel-token in user-supplied frontmatter as the cause. Source-trace first: the bundle's filter chain may strip tools at a stage upstream of any user declaration. The "Task-as-poison" hypothesis was empirically falsifiable in a single probe; a 5-minute trace through `Tw8`/`vc` would have ruled it out without needing the probe.

---

## v2.11.2 — 2026-04-25 (this fork) — L89 cross-checked against official changelog

External fact-check of L89 against the [official Anthropic v2.1.119 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). Three corrections, two additions, one bonus validation.

### Corrections (things I had wrong or missed)

1. **`/background` reuses an *updated* `/fork` mechanism, not the L87 form.** Per the official v2.1.119 changelog: *"`/fork` now writes a pointer and hydrates on read instead of full conversation copies."* L89 originally claimed `/background` reused the L87 fork-subagent infrastructure *unchanged*. Corrected: the subagent type and gating are unchanged, but the parent-conversation-inheritance mechanism switched from full-duplication to pointer-based hydration in v2.1.119. /background is built on the *new* form.

2. **Disambiguated `/agents` (slash command, public) vs `claude agents` (CLI subcommand, dark-launched Fleet view).** These are two different surfaces with confusingly-similar names. The original L89 conflated them.
   - `/agents` slash command: `{type:"local-jsx", name:"agents", description:"Manage agent configurations"}` — pre-existed v2.1.118, always enabled, opens an agent-config Ink panel. **Not** Fleet view.
   - `claude agents` CLI subcommand: dual code-path (Fleet view if `tengu_slate_meadow` is on; legacy agent-listing utility if not). The dark-launch documented in v2.11.1 still applies.

3. **Cross-referenced the public `/tasks` (alias `/bashes`) slash command.** Pre-existed v2.1.118; described as "List and manage background tasks" — handles the **Ctrl+B** background bash tasks. Distinct from the dark-launched `/background` (which forks the *session*, not a bash command). L89 should have called this out as the answer to "how do I manage background tasks" for default users.

### Additions (the changelog had things my diff missed)

4. **`prUrlTemplate` setting added in v2.1.119.** Settings keys are not extracted by `scripts/diff-versions.sh` (env vars yes, settings no), so this slipped through. URL template for PR links in footer badge and inline messages, with placeholders `{host} {owner} {repo} {number} {url}`. Used by `JA_(H)` PR-link rendering helper. Supports the Fleet view's per-PR display when that surface eventually opens, plus existing PR-badge rendering today.

   Tooling-gap note added to L89: future skill versions should add settings extraction to the diff script (look for Zod schemas / settings-key string sets).

### Bonus validation

5. **The complete absence of `/background`, `/bg`, `/stop`, `/daemon`, `/autocompact`, Fleet view, `CLAUDE_CODE_SESSION_KIND`, classifier-summary, and `tengu_*` flags from the official v2.1.119 changelog is strong external corroboration of v2.11.1's dark-launch framing.** Anthropic publicly documented the supporting infrastructure (`prUrlTemplate`, `CLAUDE_CODE_HIDE_CWD`, `/fork` mechanics) but said nothing about the user surfaces those things support. New "Source-of-Truth Cross-Check" section in L89 documents this explicitly.

### Hallucinated AI-source claim invalidated

The fact-check source (an unreliable AI) referenced an internal "Chyros" codename for a planned background daemon. **Bundle check: 0 occurrences of "Chyros" in v2.1.118/119/120; 34 occurrences of "kairos/Kairos/KAIROS".** The actual codename is **KAIROS** (Greek god of opportunity), as documented in L43. The AI almost certainly hallucinated a near-Greek-time-word.

### Methodology takeaway (added to feedback memory)

When reverse-engineering the bundle, **always cross-check findings against the official Anthropic CHANGELOG** at `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`. The two are complementary:
- Official changelog = source of truth for documented user surface
- Bundle excavation = source of truth for what code exists
- The DELTA between them = dark-launched surface (most useful for this skill)

Settings keys (`prUrlTemplate`-style) are NOT extracted by `diff-versions.sh` — known tool gap.

### Files changed

- `references/17-verified-new-v2.1.120.md` — `/background` section corrected for v2.1.119 fork-mechanism change; Fleet view section gets disambiguation block; new "Pre-Existing Public Surface Worth Cross-Referencing" section for `/agents` + `/tasks`; new "Public Settings Added in v2.1.119" section for `prUrlTemplate`; new "Source-of-Truth Cross-Check" section validates the dark-launch framing against official changelog.
- `version.json`, `plugin.json`: 2.11.1 → 2.11.2.

## v2.11.1 — 2026-04-25 (this fork) — L89 dark-launch correction

**Methodology error fix in L89.** The v2.11.0 release of L89 (and the companion deep-dive material) treated `/background`, `/stop`, `/daemon`, and `claude agents` Fleet view as user-facing GA surfaces. **They are not.** The runtime *code* shipped in v2.1.119, but the *user-facing surfaces* are dark-launched behind GrowthBook flags or hardcoded kill-switches. Verified empirically (`claude /daemon` → "Unknown command", `claude agents` → legacy listing utility, not the dashboard).

### Corrected gating map (v2.1.119 / v2.1.120)

| Surface | Status | Gate |
|---------|--------|------|
| `/daemon` | ❌ DARK-LAUNCHED for everyone | `function OqH() { return false }` — hardcoded literal, no flag override |
| `claude agents` Ink TUI (Fleet view) | ❌ DARK-LAUNCHED by default | `isAgentsFleetEnabled() = C0H() = v_("tengu_slate_meadow", false)`. When off, `claude agents` falls through to a **legacy agent-listing utility** (just dumps installed plugin agents + built-ins). |
| `/background` (alias `/bg`) | ⚠ GATED | Same `tengu_slate_meadow` GB flag. Flipped on for Claude Max / Cowork-product users; off for default. The `isEnabled: () => true` per-command field is misleading — gating is at the **command-resolver-array inclusion** level: `...Q3K && C0H() ? [Q3K] : []`. |
| `/stop` | ⚠ CONDITIONAL | `isEnabled: () => SESSION_KIND === "bg"`. Invisible outside a bg session, transitively gated by `tengu_slate_meadow`. |
| `/autocompact` | ✅ LIVE | Unconditional in master command-list array `SN8` |
| `/fork` (L87) | ✅ LIVE since v2.1.117 | No gate |

### Methodology lesson — registration vs. registry

When a new slash command appears in the bundle diff, **three distinct gates** exist:

1. **Per-command `isEnabled`** field (visible in the command spec): controls slash-menu visibility.
2. **Master command-resolver-array inclusion** (the `...VAR && fn() ? [VAR] : []` spread expression): controls whether the resolver finds it. **If excluded here, user gets "Unknown command" even with `isEnabled: () => true`.**
3. **Per-command `isHidden`** field: controls did-you-mean suggestions.

The original L89 traced registration (gate 1) but missed gate 2. **Always trace the array-inclusion expression.** Three documented dark-launch cases now in this skill follow the same pattern: `/update` (L68/L85, hardcoded `isEnabled: () => false`), KAIROS daemon (L43, ant-only flags), and now `/daemon` (L89, hardcoded `OqH() = false`) plus `/background`/Fleet view (L89, GB-flag gated).

### Files changed

- `references/17-verified-new-v2.1.120.md` — chapter intro now leads with a dark-launch callout table and a methodology note. `/background`, `/daemon`, Fleet view, `/stop` sections each prefixed with surface-status quotes flagging gating. Summary table updated to count "live for default users" separately from "registrations in bundle."
- `version.json`, `plugin.json` — `2.11.0 → 2.11.1`.
- `SKILL.md` description amended with corrected dark-launch reality.

### Audit log

Reproducible audit at `/tmp/cowork-surface-audit.log` documents the 9-phase verification (bundle gate analysis + empirical tests) that surfaced the error.

## v2.11.0 — 2026-04-25 (this fork)

Adds **Chapter 20** (`references/17-verified-new-v2.1.120.md`) with two new lessons covering the v2.1.119 and v2.1.120 binaries — the **Claude Cowork runtime release**. Lesson count goes from 88 → 90, chapter count from 19 → 20. Verified against the v2.1.120 binary (`BUILD_TIME: "2026-04-24T19:00:49Z"`, `GIT_SHA: "080f07fb4224786b965b9ea0a35f0cff594f2eb6"`).

### Framing: Cowork is the product, Claude Code is the runtime

v2.1.119–v2.1.120 are the runtime infrastructure for [Claude Cowork](https://www.anthropic.com/product/claude-cowork) (Anthropic's desktop task-automation product, research preview late January 2026, recently GA on paid plans). **There is no "cowork" string in the bundle** — Cowork is the product label for sessions running with `CLAUDE_CODE_SESSION_KIND="bg"`; detection is via the BG family. The lessons explicitly position the daemon/background-session GA as Cowork's runtime going live, citing [anthropic.com/product/claude-cowork](https://www.anthropic.com/product/claude-cowork) and [claude.com/blog/cowork-research-preview](https://claude.com/blog/cowork-research-preview).

### L89 — v2.1.119 Cowork Runtime Goes Live

**Slash commands (4 added, 1 description-changed):** `/background` (alias `/bg`) forks the *current main session* into a `kind:"fork"` background subagent reusing L87 fork-subagent infrastructure unchanged; `/stop` dual-registered (interactive Ink modal + non-interactive headless), only enabled when `SESSION_KIND==='bg'`; `/daemon` Ink TUI manages three service categories (`assistant`, `scheduled`, `remoteControl` — the "remote-control server" entry is the channel Cowork Desktop talks to); `/autocompact` re-introduced (token-count parameterized via `argumentHint: "[auto|<tokens>]"`, default ~100k, max ~1M, app-state field `autoCompactWindow`); `/exit` description acknowledges bg detach/stop semantics.

**Fleet view = `claude agents` CLI subcommand (NOT a panel):** standalone Ink TUI dashboard mounted via `mountFleetView(rootInk)`, gated on `isAgentsFleetEnabled()`. Tracks per-agent **PR state** (`state`, `title`, `review`, `mergeable`, `mergeStateStatus`, `checks.passed/failed/pending`, `additions`, `deletions`). `tengu_fleetview_pr_batch` GB toggle = single batched GitHub API call vs. one-per-PR fallback. Confirms the Cowork **Dispatch** product pattern: many parallel agents, each owning a worktree+branch+PR; Fleet view is the CI-board.

**Session identity taxonomy:** `CLAUDE_CODE_SESSION_KIND` accepts exactly `"bg"` | `"daemon"` | `"daemon-worker"` (helpers `T1H()` validates, `vK()` = "is bg?", `uC_()` reads `CLAUDE_BG_BACKEND`). 5-var BG-context check (`SESSION_KIND || BG_SOURCE || BG_ISOLATION || BG_BACKEND || SESSION_NAME`) gates env-stripping in `bV()` — all 5 deleted from env before subprocess spawn so daemon plumbing doesn't leak.

**Worktree isolation = runtime prompt mutation:** when `SESSION_KIND === "bg"` and `CLAUDE_BG_ISOLATION === "worktree"`, the agent's system prompt is rewritten by `bA3()` to insert "Call the EnterWorktree tool as your first action — before reading files or running commands…" Confirms the worktree-based isolation model.

**Persistence model** (`/background` + `/stop` lifecycle): PTY stream recorded to `CLAUDE_PTY_RECORD` file via internal `--bg-pty-host <sock> <cols> <rows> -- <file> [args...]` argv mode (verbatim from bad-argv error message); transcript persisted by bridge transport (log: `[bridge:repl] Session persistence enabled — transcript writer + hydrate readers registered`); single-use `CLAUDE_BRIDGE_REATTACH_SESSION/SEQ` tokens (L87) consumed exactly once for reattach, deleted from `process.env` immediately after read.

**Classifier-summary system (the Cowork Desktop status pipeline):** surface map (`bg`/`watched`/`ccr`/`bridge`/`desktop`/`cli`) → capabilities (`state`/`summary`) → engine (`heuristic`/`llm`). Three independent kill switches: `tengu_classifier_disabled_surfaces` (skip-list), `tengu_classifier_summary_kill` (master kill), `tengu_cobalt_wren` (LLM→heuristic cost circuit-breaker). Output schema `{status_category: "blocked"|"review_ready", status_detail, needs_action}` pushed via `notifyMetadataChanged({post_turn_summary})` — this is the API Cowork Desktop's "what's the agent doing" UI subscribes to. `CLAUDE_CODE_CLASSIFIER_SUMMARY` env var is the manual override.

**`/daemon` lease + supervisor model:** `tengu_daemon_lease` (single-daemon-per-config-dir invariant), `tengu_daemon_self_restart_on_upgrade` (binary-identity polling for hot-upgrade), `tengu_daemon_idle_exit`, `tengu_daemon_worker_crash`, `tengu_daemon_worker_permanent_exit`, plus full bg-worker lifecycle telemetry (~30 events).

**Pro-trial conversion screens** (4 telemetry events) — Cowork is paid-only, so the upsell funnel lives at the Claude Code surface where users hit the gate.

**16 new env vars** (corrected count after diff-tool fix): `CLAUDE_CODE_SESSION_KIND/ID/NAME/LOG`, `CLAUDE_BG_ISOLATION`, `CLAUDE_BG_RENDEZVOUS_SOCK`, `CLAUDE_BG_SOURCE`, `CLAUDE_JOB_DIR`, `CLAUDE_PTY_RECORD`, `CLAUDE_AGENT`, `CLAUDE_AGENTS_SELECT`, `CLAUDE_CODE_AGENT`, `CLAUDE_CODE_HIDE_CWD`, `CLAUDE_CODE_VERIFY_PROMPT`, `CLAUDE_CODE_CLASSIFIER_SUMMARY`, `CLAUDE_INTERNAL_FC_OVERRIDES`. Stealth promotions: `CLAUDE_BG_BACKEND` (3→7 occurrences) and `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` (3→4) became load-bearing without being newly added.

**62 new tengu_* identifiers**: 36 background+daemon, 4 fleet view, 4 pro-trial, 4 classifier, 5 codename flags, 9 other.

### L90 — v2.1.120 Daemon On-Demand Model + Lean Prompt + Memory-Write UX + Plan-Mode Tripwire

**Major architectural reveal: persistent daemon install is kill-switched.** `xQH()` aborts with verbatim text *"daemon service is not installed (service install is disabled in this version; the daemon runs on demand)"*. Despite all v2.1.119's `tengu_daemon_install` / `_auto_uninstall` telemetry being live, the user-facing daemon is **strictly on-demand** in v2.1.120. New `CLAUDE_CODE_DAEMON_COLD_START` env var accepts only `"transient"` (default, silent on-demand) or `"ask"` (prompted with `tengu_bg_daemon_cold_start_ask`/`_answer` UX). Function `Ci6()` resolution order: env → `settings.json daemonColdStart` → GB default `daemonColdStartGbDefault()`.

**`CLAUDE_CODE_LEAN_PROMPT` is per-section, not wholesale.** Distinct from L86's `CLAUDE_CODE_SIMPLE` / `_SYSTEM_PROMPT` (total prompt swap). Each leanable section has its own gate: `LEAN_PROMPT env || <codename GB flag>`. Two leanable sections in v2.1.120: Bash/ripgrep description (`Fz` gate, `tengu_vellum_lantern`, **Opus-4.7-only**) and memory-types section (`cK8` gate, `tengu_ochre_finch`).

**`CLAUDE_EFFORT` is NOT an env var** — the v2.1.120 diff regex was misreading a binary string-table dump. Actual semantics: (1) skill/command frontmatter field `effort:` (in the `_X5` skill-frontmatter key set), (2) template substitution token `${CLAUDE_EFFORT}` resolved by `_I(model, effort)`. Value space `low | medium | high (default) | xhigh` resolves to literal English phrases (`"Comprehensive implementation with extensive testing and documentation"` etc.) — prompt-shaping mechanism, not a model API parameter.

**`CLAUDE_COWORK_MEMORY_GUIDELINES` = Cowork's memory-bypass escape hatch.** When set + non-empty + auto-memory enabled, function `Bf_(H)` short-circuits and returns `\`# auto memory\\n${q.trim()}\`` — completely replacing the entire memory-injection pipeline. Sibling `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` (pre-existed since v2.1.118) is the additive form.

**`tengu_memory_write_survey_event` = Approve/Reject confirmation dialog for memory file writes.** Per-write summary generated via fast Sonnet-4.6 LLM call (`maxOutputTokensOverride: 150`, no caching, querySource `"memory_write_survey_summarize"`). System prompt: *"You write one-sentence confirmation summaries for an Approve/Reject dialog."* User prompt: *"Summarize this memory file update in one short sentence (≤120 chars) for a confirmation dialog…"* Dialog state machine has a 5-second countdown (`T03 = 5`) and a `summaryLineThreshold` for bypassing the prompt on small writes. Directly relevant to anyone running auto-memory pipelines.

**`CLAUDE_CODE_VERIFY_PROMPT` is debugging-workflow discipline, NOT safety.** Hypothesis disproved. The injected text is a 3-step *"reproduce → fix → re-observe"* instruction. Identifies `tengu_sparrow_ledger` as its dark-launch GB flag.

**`tengu_plan_mode_violated` is observability-only.** No early return, no thrown error. Tripwire for "plan mode should have held this but didn't" — real enforcement lives upstream at the permission layer.

**`tengu_bg_retired` = idle worker reaper, NOT feature sunset.** Six "do not retire" guards: `no-state`, `not-settled`, `inflight`, `session-cron`, `routine`, `grace`. Codename misled the original investigation.

**Daemon hot-upgrade** via binary-identity polling — `setInterval(L, A)` detects when binary on disk differs from running, sets `W = true`, emits `tengu_daemon_self_restart_on_upgrade`, gracefully shuts down (`v.manager?.killAll("SIGTERM")`). Standard hot-upgrade pattern. Pairs with the v2.1.113 (L85) `/update` refusal-path work.

**Auto-relaunch rate-limit gates** confirmed by accessor names: `AUTO_RELAUNCH_UNFOCUSED_MS:()=>oz6` (1h minimum focus-loss before eligible) and `AUTO_RELAUNCH_MIN_INTERVAL_MS:()=>sYK` (6h minimum interval between relaunches). `CLAUDE_AGENTS_AUTO_RELAUNCHED_AT` is the env-key timestamp.

**`/schedule` description simplified, NOT a new registration.** Both v2.1.119 and v2.1.120 have only one `name:"schedule"` registration. v2.1.119 had a conditional template-literal description with `${H?...}` for one-time-vs-recurring; v2.1.120 collapsed it to a single static cron-only string.

**4 new env vars**: `CLAUDE_CODE_DAEMON_COLD_START`, `CLAUDE_CODE_LEAN_PROMPT`, `CLAUDE_COWORK_MEMORY_GUIDELINES`, `CLAUDE_AGENTS_AUTO_RELAUNCHED_AT`. **6 new GB flags** (5 codenames + `tengu_ochre_finch`). **11 GB flags removed** (routine cleanup of dark-launched-and-graduated). **6 new telemetry events**.

### Bonus prompt-section literals discovered (citations)

In the same code region as `yA3` (the verify-prompt content), three additional system-prompt section literals were captured verbatim and added as citations:

- **`ZE7`** = subagent system prompt: *"You are an agent for Claude Code, Anthropic's official CLI for Claude. Given the user's message, you should use the tools available to complete the task. Complete the task fully — don't gold-plate, but don't leave it half-done. When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials."*
- **`uA3`** = "Context management" prompt section
- **`pA3`** = "Focus mode" prompt section

### Tooling fix: `scripts/diff-versions.sh` env-var extractor

The `\b...\b` regex picked up adjacent bytes from the binary string table when those bytes happened to be in `[A-Z0-9_]`, producing false positives like `CLAUDE_CODE_FORK_SUBAGENTM` (real var: `CLAUDE_CODE_FORK_SUBAGENT`). It also missed env vars that only appear in object-literal key position (e.g. `CLAUDE_PROJECT_DIR`, set for child processes via `{...env, CLAUDE_PROJECT_DIR: x}`). Replaced with three JS-context anchors: `process.env.X` (with negative-lookahead `(?![A-Z0-9_])` to avoid the `||null`-style following-char bug), `"X"`/`'X'`, and `{X:...}`/`,X:`. Both the v2.1.119 false-add and v2.1.120 false-remove of `_FORK_SUBAGENTM` are gone; `CLAUDE_PROJECT_DIR` now extracts correctly. Verified on v2.1.118/119/120 bundles.

### Cross-reference cluster — Cowork's runtime stack

Read as a group: **L37** (Bridge / Remote Control transport that persists transcripts) → **L43** (KAIROS daemon characterization from ant-only feature flags) → **L77/L85** (Remote Workflow Commands sunset + first `CLAUDE_BG_BACKEND` public surface) → **L86** (OIDC Federation auth, dual-registration pattern) → **L87** (`/fork` + `CLAUDE_BRIDGE_REATTACH_SESSION/SEQ` plumbing reused unchanged) → **L88** (dual-registration pattern adopters `/usage`/`/cost`/`/stats`) → **L89/L90** (this chapter — where the runtime becomes a coherent user-facing product surface).

## v2.10.0 — 2026-04-23 (this fork)

Adds **Chapter 19** (`references/16-verified-new-v2.1.118.md`) with two new lessons covering the v2.1.117 and v2.1.118 binaries — plus three source-traced deep dives: `/fork` execution mechanics, WIF OAuth lock internals, and the previously-undocumented AI verification hook. Lesson count goes from 86 → 88, chapter count from 18 → 19. Verified against the v2.1.118 binary.

### Deep dive: `/fork` execution mechanics (in L87)

Traced `_a7`, `V75`, `C75`, `Id5`, `bd5`, `_d_`, `GuH`, `quH`, `GC` to reveal **three distinct fork paths** that had been conflated in my initial write-up:

1. **User-typed `/fork <directive>`** (`_a7` → `quH` → `xy` with `isAsync: true`) — **backgrounded**, parent NOT blocked, uses `ph` fork subagent type, full parent messages + REPL replay log inheritance, `useExactTools: true`, registers with parent's task registry. System confirmation: `<emoji> forked <name> (<id4>)`.
2. **Slash command with `context: "fork"` frontmatter** (`V75` with `isAsync: false`) — **synchronous, parent blocks**, uses `H.agent` from frontmatter or general-purpose fallback, returns `<local-command-stdout>`.
3. **Skill invoked via Skill tool with `context: "fork"`** (`C75` with `isAsync: false`) — **synchronous, parent blocks**, same semantics as V75 but reached via Skill tool path. **New in v2.1.118** — `_a7`/`V75` both existed dark-launched in v2.1.116.

Critical correction: the `ph` fork subagent type (tools:`["*"]`, maxTurns:200, model:`"inherit"`, permissionMode:`"bubble"`) is used **only** by path 1. Paths 2-3 use whatever agent is specified. The `whenToUse` comment about "omitting subagent_type" refers to a hypothetical Task dispatcher fallback that is not yet wired up.

Also documents: `bd5` name generation (first 3 tokens, lowercased, alphanumeric-only, ≤24 chars, `"fork"` fallback), the "Cannot fork before the first conversation turn" guard (new in v2.1.117), and the dark-launch note that v2.1.117's "new" `/fork` is a visibility flip, not a code-add.

### Deep dive: WIF OAuth lock internals (in L88)

Traced `Vk4`, `Gv_`, `RY`, `tvq`, `e5` to document the concrete lock mechanism — and corrected the attribution: the **mechanism** landed in v2.1.117, the **telemetry** in v2.1.118.

- **Lock type**: `proper-lockfile` npm package, directory-level `mkdir` mutex (not file-level `fcntl`). Locks the **containing directory** of the credentials file via `evq.dirname(credPath)` — serializes all operations across profiles in that dir.
- **Retry budget**: `tvq = 5` max retries with 1000–2000ms jittered backoff (`1000 + Math.random() * 1000`). Total wait: 5–10 seconds worst case.
- **Only `ELOCKED` is retried** — any other error (filesystem, permission) bubbles immediately.
- **Final error**: typed `e5` class with verbatim message `"Could not acquire credentials lock at <path> after 5 retries"`.
- **`onCompromised: wH`** — logs but continues; lock compromise does NOT trigger release.
- **`Symbol.asyncDispose`** attached for ES2022 `using` support.
- **Debug steps** for `tengu_wif_user_oauth_lock_retry_limit` added: `lsof <config_dir>/credentials/.lock`; `rmdir` the stale lockfile only after confirming no live holder.
- **`tengu_oauth_401_recovered_from_disk`** documented as a separate belt-and-suspenders path — catches cases where a sibling process refreshes the token between in-memory cache load and the outbound request (lock isn't contested but cache is stale).

### Deep dive: AI verification hook (new L88 section — `bs7`)

`tengu_agent_stop_hook_blocking` telemetry led to discovering an **entire previously-undocumented hook TYPE**: an AI verification hook that spawns its own sub-conversation to return a structured verdict `{ok: true}` or `{ok: false, reason}`. The mechanism (`bs7`) shipped silently in v2.1.116; only the `_blocking` outcome telemetry is new in v2.1.118.

Key mechanics documented:
- **Max 50 turns** (constant `B = 50`), **60 s default timeout** (overridable via `hookConfig.timeout` in seconds).
- **System prompt** for Stop/SubagentStop: `"You are verifying a stop condition in Claude Code. Your task is to verify that the agent completed the given plan."` Other events get `"You are evaluating a <eventName> hook…"`. Full verbatim prompt included in the lesson.
- **Permission mode**: `"dontAsk"` — hook never prompts the user.
- **Transcript auto-allow**: `Read(/<transcript-path>)` added to session rules so the hook agent can read the conversation history without triggering a permission dialog.
- **Thinking disabled** (`thinkingConfig: {type: "disabled"}`).
- **Tool set**: parent's tools minus pre-existing structured-output tool minus denylist, plus a fresh structured-output tool for the hook's verdict.
- **Five outcomes** mapped to their telemetry events — `success`, `blocking` (NEW), `cancelled (max_turns)`, `cancelled (no structured output)`, `non_blocking_error`.

Reconstructed hook config shape: `{type: "agent"?, event, prompt, timeout?, model?}`. Substantially extends the L10 hooks-system surface with a second execution model beyond shell commands. Added `L88 → L10` cross-reference.

### Added: L87 — v2.1.117 `/fork` Subagent Command, Rate-Limit/Subscription Overrides, `/autocompact` + `/stop-hook` Removal

New slash command **`/fork <directive>`** spawns a **background subagent that inherits the full conversation context** of the parent session.

- **Three-layer gating.** Slash-command `isEnabled: iv` → `sJ9() !== "disabled"`; fork-enable helper `GR()` requires interactive mode (`!S8()`), then either `CLAUDE_CODE_FORK_SUBAGENT` env truthy or GB flag `tengu_copper_fox` (default false).
- **New implicit `fork` subagent type.** `tools:["*"]`, `maxTurns:200`, `model:"inherit"`, `permissionMode:"bubble"`. Not user-selectable via `Task({ subagent_type: "fork" })` — triggered by **omitting** `subagent_type` when the experiment is active.
- **Parent-context inheritance modes** (`forksParentContext`): `"turn"` → slice from `turnStartIndex`; `true` → full history; absent → fresh start. REPL hydration uses `{kind:"fork", log:[...replayLog]}` to resume mid-stream.
- **Skill `context: "fork"` frontmatter now dispatches** to real fork helper `V75` instead of inline `H$7` (the field was schema-accepted in v2.1.116 but dispatch was a no-op).
- **Bridge reattach env vars** `CLAUDE_BRIDGE_REATTACH_SESSION` / `CLAUDE_BRIDGE_REATTACH_SEQ` passed once-and-consumed for TUI reattach flow; explicitly dropped from child env in `preSpawn`.
- **`f` keybinding chord** registered in query-ready shortcut table.
- Paired telemetry: `tengu_fork_subagent_enabled`, `tengu_remote_attach_session_rejected`. UI string: `"Fork started — processing in background"`.

**Rate-limit / subscription overrides** — two new env vars feed directly into the OAuth token object:

- `CLAUDE_CODE_SUBSCRIPTION_TYPE` overrides reported subscription type (default `null`).
- `CLAUDE_CODE_RATE_LIMIT_TIER` overrides reported rate-limit tier (default `null`).

Client-side test hooks (not a security boundary — server still authoritative). Pair with v2.1.118's dark-launched `/pro-trial-expired` for Pro plan trial UI testing.

**`/schedule` gains one-time scheduling.** Description shifts from static string to template literal with runtime capability check; terminology changes from "triggers" to "routines"; adds `"on a cron schedule or once at a specific time"` when capability enabled.

**Removed outright:**

- `/autocompact` (interactive auto-compact-window command — gone alongside `tengu_autocompact_command` and `tengu_autocompact_dialog_opened` telemetry). Replacement: `/config` settings UI.
- `/stop-hook` (was `isEnabled:()=>false` since v2.1.92 — now fully removed). Replacement: edit `.claude/settings.json` directly.

**Other observability adds:** `tengu_advisor_strip_retry` (Advisor Tool retry path on server-rejection markers), `tengu_byte_watchdog_fired_late` (`{idle_ms, late_ms, readable_errored}` when watchdog fires ≥1000ms late), `tengu_team_artifact_tip_shown`, `tengu_tussock_oriole` (opaque codename), `tengu_amber_redwood` → `tengu_amber_redwood2` version bump. Notable removal: `tengu_mcp_concurrent_connect` (parallel MCP boot either became default or rolled back).

### Added: L88 — v2.1.118 `/cost` + `/stats` → `/usage` Aliases, `cache-diagnosis-2026-04-07`, Frontmatter Shadow Validator, WIF OAuth Locking

**`/cost` and `/stats` folded into `/usage` aliases.** The standalone registrations are deleted. `/usage` now has **two registrations**:

- **Interactive** (TUI): `requires:{ink:true}`, `thinClientDispatch:"control-request"`, description `"Show session cost, plan usage, and activity stats"` (unified dashboard — what `/stats` used to show).
- **Non-interactive** (headless): `supportsNonInteractive:true`, `isEnabled:()=>S8()`, description `"Show the total cost and duration of the current session"` (what `/cost` used to show).

Aliases `["cost", "stats"]` on both registrations — typing `/cost` or `/stats` still works but they're no longer distinct commands in `/help` or autocomplete.

**`/autofix-pr` deremoted.** Description drops `"remote session"` framing — now `"Monitor and autofix any issues with the current PR"`. Continues L85's Remote Workflow sunset direction.

**`/pro-trial-expired` dark-launched.** New command with `isEnabled:()=>false`. When enabled (date-gate or GB flag), shows upsell/renewal UI for users whose Pro plan trial has ended. Paired telemetry `tengu_pro_trial_expired_choice`. Combined with L87's env-var overrides, forms a full test surface for Pro plan rollout.

**New API beta `cache-diagnosis-2026-04-07`** for prompt cache diagnostics. Client sends opt-in; if server rejects (`sj9(lH)` matches rejection marker), the in-memory flag `r=false`, `UD_(false)` persists the decision, and `"[cache-diagnosis] server rejected beta — dropping"` logs. Single rejection disables the beta for the remainder of the session.

**Frontmatter shadow validator** (deep-dived in L88):

- **`pjH(kind, frontmatter)`** runs `qT1[kind]().strict().safeParse(_)` and emits `tengu_frontmatter_shadow_unknown_key` (per unknown key) or `tengu_frontmatter_shadow_mismatch` (per Zod issue) on failure. Wrapped in `try {} catch {}` — validator failure can't break skill loading.
- **Dispatch table `qT1 = { skill: eO1, agent: HT1, "output-style": _T1 }`** — three entries only; no `"command"`. Custom slash commands validate as `"skill"` (the `eO1` schema is a superset of the pure command schema `tO1`).
- **Per-session dedup** via `Gj9 = new Set()`: each unique `(event, surface, detail)` tuple emits once. A skills dir with 50 copies of the same bad key fires once, not 50×.
- **Key correction:** there is **no formal primary schema** — the primary path is imperative (`Cz8` reads properties directly and coerces with JS, silently ignoring unknown keys). The Zod schemas added in v2.1.118 are the **only** formal frontmatter validation in the codebase.
- **Full schema tables** documented in L88: `tO1` (11 command keys), `eO1 = tO1.extend(...)` (25 skill keys; `context` is the only typed enum `inline`/`fork`), `HT1` (16 agent keys; `name` + `description` required; camelCase divergence from skill kebab-case), `_T1` (4 output-style keys).
- **Notable drift point:** `progressMessage` — documented in L11 as an object-level field on command/skill descriptors (not a YAML-sourced field today) — is absent from `eO1`. Skills adding it aspirationally get no behavior AND fire unknown-key telemetry.

**WIF user-OAuth advisory file-locking** prevents refresh-token races between multiple Claude Code processes sharing `<config_dir>/credentials/<profile>.json`:

- `tengu_wif_user_oauth_lock_acquired` / `..._released` — normal path.
- `tengu_wif_user_oauth_lock_retry` — lock contention; `..._retry_limit` — budget exhausted.
- `tengu_oauth_token_refresh_lock_release_error` — release path error.
- `tengu_oauth_401_recovered_from_disk` — post-hoc recovery when 401 despite valid in-memory token triggers a disk re-read.

**Removed env vars:** `CLAUDE_CODE_AGENT_NAME`, `CLAUDE_CODE_TEAM_NAME` (derived from session state now via `YY_()` / `standaloneAgentContext`).

**Other observability:** `tengu_agent_stop_hook_blocking`, `tengu_auto_mode_opt_in_dialog_decline_dont_ask`, `tengu_keybindings_dom` (Desktop App), `tengu_terminal_probe`, `tengu_warm_resume_hint_eligible`, `tengu_push_notif_upsell_notification_shown`, plus four codename GB flags (`tengu_ember_trail`, `tengu_mocha_barista`, `tengu_orchid_mantis`, `tengu_slate_kestrel`). Removed: `tengu_ccr_post_turn_summary` (feature shipped default-on or rolled back), `tengu_config_tool_changed`, `tengu_vscode_cc_auth`.

### Changed

- **`SKILL.md`** frontmatter description, body intro, Step 1 version warning, references table, and available-topics listing all updated for 88 lessons / 19 chapters / v2.1.118.
- **`topic-index.json`**: L87 and L88 entries added with keywords; `keyword_map` extended with ~70 new entries (fork, usage aliases, shadow validator, WIF OAuth, etc.); `generated` → `2026-04-23`.
- **`cross-references.json`**: L87 wired to L11 (skill `context:"fork"` dispatch), L6 (agent system), L29 (permissions bubble), L85 (release-catch-all continuity), L74 (byte watchdog telemetry), L78 (advisor retry), L69 (marble-origami replay log), L88 (paired chapter). L88 wired to L87, L11 (shadow validator), L38 (OAuth), L86 (credentials file), L73 / L85 (Remote Workflow sunset direction), L22 (commands system dispatch), L35 (plugin frontmatter).
- **`troubleshooting.json`**: seven new problem patterns — `/fork not available`, `why is /cost|/stats|/autocompact|/stop-hook gone`, OAuth refresh races, frontmatter unknown keys, `/pro-trial-expired`.
- **`semantic-index.json`** rebuilt (88 entries, vocab 1098 terms, 220.3 KB).
- **`version.json`**: `skill_version` 2.9.2 → 2.10.0; `captured_version` 2.1.116 → 2.1.118; `verified_against_binary` 2.1.116 → 2.1.118; `lessons_count` 86 → 88; `chapters_count` 18 → 19.
- **`plugin.json`**: version 2.9.2 → 2.10.0; description updated with v2.1.117–v2.1.118 highlights.

### Verification

All deltas confirmed by bundle diff:

```bash
bash skill-package/skills/claude-code-internals/scripts/diff-versions.sh \
  /tmp/claude-2.1.116-bundle.js /tmp/claude-2.1.118-bundle.js
```

v2.1.116 → v2.1.118: +5 env vars, −2 env vars, +2 slash commands, −5 standalone registrations (2 genuine removals + 2 folded-to-aliases + 1 false-positive `/schedule` due to template-literal desc), +1 API beta, +28 `tengu_*`, −9 `tengu_*`.

## v2.9.2 — 2026-04-21 (this fork)

Amends **L43** (`references/04-connectivity-plugins.md`) to reflect the full set of `source` literals present in the v2.1.116 zod schema. No new lessons; patch bump only.

### Changed

- **Sources table restructured into two distinct unions.** The single "Marketplace Sources" table conflated plugin-sources (inside a marketplace catalog's `plugins[].source`) with marketplace-sources (how the catalog itself is fetched). These are separate zod unions in the binary — a plugin-source type like `pip` is invalid as a marketplace source, and marketplace-only allowlist types like `hostPattern` are invalid inside a plugin entry. Section now titled "Sources: two distinct schema unions" with separate tables and a lead paragraph explaining the distinction.

### Added

- **`pip` plugin source** *(undocumented)* — PyPI-backed mechanism paralleling `npm` for Python-packaged plugins. Schema `{package, version?, registry?}` with pip-style specifiers (`==1.0.0`, `>=2.0.0`) and optional custom index URL. Not mentioned in Anthropic's public plugin-source docs.
- **`hostPattern` / `pathPattern` / `settings` marketplace sources** — allowlist/sentinel source types used in policy-driven marketplace resolution; previously missing from the internals table.
- **Bare-string plugin source** noted explicitly ("relative path from the marketplace directory").

### Verification

All 11 source literals confirmed by exhaustive grep of the v2.1.116 bundle:

```
grep -ao 'source:h\.literal("[^"]*")' /tmp/claude-2.1.116-bundle.js | sort | uniq -c
```

Result: `directory` ×1, `file` ×1, `git` ×1, `git-subdir` ×1, `github` ×2 (plugin + marketplace), `hostPattern` ×1, `npm` ×2, `pathPattern` ×1, `pip` ×1, `settings` ×1, `url` ×2. No `"zip"` source type. Prior narrower grep had missed `git` and `pip` because the alternation list didn't include them.

### Version metadata

- `version.json`: `skill_version` 2.9.1 → 2.9.2; note extended with the source-union restructure rationale.
- `plugin.json`: version 2.9.1 → 2.9.2.

## v2.9.1 — 2026-04-21 (this fork)

Adds a new lesson **L86** (Chapter 18) covering v2.1.114–v2.1.116 binary changes, and extends L11 with a `progressMessage` deep-dive. Lesson count goes from 85 → 86, chapter count from 17 → 18.

### Added: L86 — v2.1.114–v2.1.116 (OIDC Federation + Proxy + `/model` Headless)

New reference file `15-verified-new-v2.1.116.md`, verified by direct bundle extraction/diff of v2.1.113 → v2.1.114 (confirmed no-op) → v2.1.116. Covers:

- **OIDC Federation enterprise auth.** New `authentication.type: "oidc_federation"` joins existing `user_oauth`. Eight new `ANTHROPIC_*` env vars (`FEDERATION_RULE_ID`, `IDENTITY_TOKEN`, `IDENTITY_TOKEN_FILE`, `ORGANIZATION_ID`, `SERVICE_ACCOUNT_ID`, `SCOPE`, `CONFIG_DIR`, `PROFILE`). New API beta header `oidc-federation-2026-04-01`. Two configuration modes: **env-quad** (fully env-driven, `pf_()` returns `"env-quad"` when any of the four core vars set) and **credentials-file** (profile-based at `<config_dir>/configs/<profile>.json`, wins over env-quad when present with `authentication.type: "oidc_federation"`). Directory resolution precedence `ANTHROPIC_CONFIG_DIR → $XDG_CONFIG_HOME/anthropic → $HOME/.config/anthropic`. Profile resolution `ANTHROPIC_PROFILE → <config_dir>/active_config → "default"`. Parallel `<config_dir>/credentials/<profile>.json` convention noted for `user_oauth` profiles.
- **Proxy fallbacks.** `CLAUDE_CODE_HTTP_PROXY` and `CLAUDE_CODE_HTTPS_PROXY` added as **lowest-priority** entries in `ZA9()` resolver (`HTTP_PROXY → http_proxy → CLAUDE_CODE_HTTP_PROXY`). Downstream propagation to npm (`npm_config_proxy`), yarn, docker, `JAVA_TOOL_OPTIONS` (only appended if not already containing `-Dhttps.proxyHost=`), `GLOBAL_AGENT_*`, Google Cloud SDK (`CLOUDSDK_PROXY_*`), Electron, and `FSSPEC_GCS` for child processes. Both vars also added to the spawned-env allowlist so children inherit them.
- **`/model` non-interactive mode.** Second registration with `supportsNonInteractive: true` and `argumentHint: "<model>"` sits alongside the existing interactive menu. `claude -p "/model sonnet" "..."` now works for scripting.
- **`CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT`.** Alias for existing `CLAUDE_CODE_SIMPLE`. Both checked by `$J8()`; when true, `TX()` returns a skeletal system prompt.
- **`CLAUDE_CODE_RETRY_WATCHDOG`.** Enables retry watchdog only on `V6()==="linux"` AND `CLAUDE_CODE_ENTRYPOINT === "remote"`. Not for local developer use — targets CCR v2 (L73) and daemon-mode (L85) long-lived sessions.
- **Diff artifact note.** The bundle diff reports `CLAUDE_CODE_` as a bare env var. Actually a string literal used by the diagnostic env-dump function `F1K()` for `.startsWith("CLAUDE_CODE_")` filtering — not a configurable variable. Documented to prevent future confusion.
- **12 new `tengu_*` identifiers (GB flags + telemetry).** Deep-dived after discovering the structural diff script missed this namespace entirely. Split into three buckets:
  - **GB flags gating dark-launched features:** `tengu_ccr_post_turn_summary` (post-turn summary in remote sessions, additionally gated on `CLAUDE_CODE_REMOTE`), `tengu_doorbell_agave` (the `enforce_web_search_mcp_isolation` tool-use isolation latch, introducing `Pa_()` with `denyMessage`/`activeLatch`/`classifiedAs` and classifications for `cowork`/`workspace`/`session-info`/`mcp-registry`/`plugins`/`scheduled-tasks`/`dispatch`/`ide`), `tengu_gouda_loop` (closed-issue notification for reported GitHub issues), `tengu_mcp_concurrent_connect` (parallel MCP connection at boot vs serial).
  - **Telemetry implying new wired-up features:** `tengu_mcp_resource_templates_fetched` (new `resources/templates/list` MCP capability), `tengu_rc_upsell_notification_shown` (new `/remote-control` idle-upsell toast at `priority: medium`), `tengu_remote_attach_session` (new `--remote` attach capability — error `"Attaching to an existing remote session is not enabled for your account."`), `tengu_ultraplan_plan_ready` (ULTRAPLAN plan-ready surface, paired with `tengu_ultraplan_awaiting_input`), `tengu_tool_use_isolation_latch_denied` (telemetry when tool blocked by the Agave latch).
  - **Pure observational telemetry:** `tengu_cli_flags`, `tengu_keybinding_fired`, `tengu_scroll_arrows_detected`.
  - Narrative: v2.1.116 is **not** pure infrastructure — it ships several flagged-off features whose wiring is already in the binary. When the flags flip on, there will be no binary change to correlate.
- **`diff-versions.sh` enhancement.** Script now also extracts `tengu_*` identifiers (`--section=tengu` or in the `all` default). Prior runs missed these 12 additions; re-ran v2.1.113 → v2.1.116 to confirm the new extractor catches all 12.

L86 cross-referenced in `cross-references.json` to L85 (sequential catch-all + instrumentation-for-unattended-operation theme + ULTRAPLAN), L66 (Proxy Auth Helper, distinct mechanism), L73 (CCR v2 entrypoint + `--remote` CLI), L37 (Remote Control), L84 (prior catch-all), L17 (MCP, for concurrent-connect + resource-templates), L11 (parallel v2.9.x verification).

### Added: `progressMessage` section in L11

Verified in the v2.1.116 bundle (2 read sites, both feeding `c47` / `formatSkillLoadingMetadata`). Documents:

- Defaults per source (user-slash `"running"`, skills `"loading"`, MCP prompts `"running"`).
- Built-in hardcoded strings for `/commit`, `/commit-push-pr`, `/init`, `/init-verifiers`, `/statusline`, `/security-review`, `/team-onboarding`, `/insights`.
- **`c47` accepts the progressMessage as its second argument but never references it in the output** — plumbed end-to-end and dropped at the leaf. Plumbed but unrendered in v2.1.116.
- No frontmatter parse path writes `progressMessage`; only bundled builtins supply custom values.
- Distinguished from the separately active tool-use progress stream (`progressMessagesByToolUseID`, `bash_progress`, `mcp_progress`).

### Indexing

- `topic-index.json`: bumped `total_lessons` to 86, `generated` to 2026-04-21; added L86 entry now with **86 keywords** (original 56 + 30 tengu/GB-flag/feature-flag terms); extended L86 endLine to 449 after tengu section added; extended L11 endLine to cover the new `progressMessage` section and added `progress-message` + `skill-overrides` keywords.
- `cross-references.json`: added L86 reference block; linked to L17 (MCP) for concurrent-connect and resource-templates; updated `generated` date.
- `semantic-index.json`: rebuilt twice — final run produces 86 entries with 1017-term vocabulary (was 988 before tengu additions; 946 in v2.9.0 baseline).
- `diff-versions.sh`: added `extract_tengu()` function and new `tengu` section, ensuring future diffs don't miss the feature-flag/telemetry namespace.

### Version metadata

- `version.json`: `skill_version` 2.9.1, `captured_version` 2.1.116, `lessons_count` 86, `chapters_count` 18, `captured_date` 2026-04-21, note rewritten.
- `plugin.json`: version 2.9.1, description updated for L86 coverage and 86-lesson count.
- `SKILL.md`: frontmatter description updated (v2.1.113 → v2.1.116, added 14 new search keywords for the new surface), body intro updated, topic index section gains a `New (v2.1.114-v2.1.116)` bullet.
- `CLAUDE.md`: header `86 lessons`; repo-structure diagram adds `15-verified-new-v2.1.116.md`; Key-facts lesson-ID line updated to reflect v2.1.114 no-op and v2.1.116 deltas.

## v2.9.0 — 2026-04-21 (this fork)

Re-verified the Skills System lesson (L11 in `02-agents-intelligence-interface.md`) directly against the v2.1.116 bundle. Six corrections and six additions — this lesson had carried paraphrased claims since the original markdown.engineering capture that turned out to be wrong in non-trivial ways when checked against the live code. No new lessons, no version-gap coverage change; count stays at 85.

### Changed (corrections)

- **Listing budget unit** — was described as tokens ("1% of the context window"). Actual: **characters**. Formula (`X6_`): `budget = ctxWindowTokens × 4 × skillListingBudgetFraction`; default fraction `0.01`; fallback `8000` chars when ctx unknown; env override `SLASH_COMMAND_TOOL_CHAR_BUDGET`.
- **Over-budget behavior** — was described as eviction ("skills get dropped from the listing"). Actual (`kr6`): **description truncation** with graceful degradation. Bundled skills stay full. Per-skill budget `f = remaining / truncatableCount`; each description truncated to `f` chars. If `f < 20` (`Zr6`), **all** truncatable skills collapse to `- ${name}` globally. Skills never disappear from the listing — the real failure mode is silent global collapse to name-only. Added per-skill hard cap `skillListingMaxDescChars = 1536` (`gP1`) and the listing header + entry format literals (`- ${name}: ${description} - ${whenToUse}`).
- **Conditional skill activation** — was described as triggered when the model "opens" a matching file. Actual (`QIH`): triggered on file **edits/touches**, matched via the `ignore` npm package (gitignore-style), not glob. Storage in `Pf.conditionalSkills`; once activated, moved to `Pf.dynamicSkills` and added to `activatedConditionalSkillNames` for the session. Emits `tengu_dynamic_skills_changed` with `source: "conditional_paths"`.
- **`user-invocable: false` semantics** — was described as "hides from `/skills` menu." Actual (`q_5`): **blocks user `/name` invocation** with message *"This skill can only be invoked by Claude, not directly by users."* Menu hiding is a side-effect via `isHidden: !userInvocable`. The two knobs are symmetric opposites: `disable-model-invocation: true` → user-only; `user-invocable: false` → model-only.
- **Safe-properties auto-allow set** — was described as "no allowed-tools, model override, hooks, paths." Actual (`Y_5` + set `z_5`): `model`, `effort`, `paths`, `disableModelInvocation`, `userInvocable`, `context`, `agent`, `version`, and others are **safe** (no prompt). The fields that flip to "ask" are `allowedTools` (non-empty), `hooks` (non-empty), `shell`, and any custom field outside the safe set. Full safe set now listed verbatim in the lesson.
- **MCP shell "silently stripped"** — imprecise. Actual (`dO8`): the shell-processing pass `on(E, ..., shell)` is **skipped entirely** when `loadedFrom === "mcp"`. `` !`cmd` `` and ``` ```! ``` blocks remain as **literal text** in the prompt — not executed, not removed. `${CLAUDE_SKILL_DIR}` stays inert (no baseDir on MCP skills). `${CLAUDE_SESSION_ID}` still substitutes.
- **Symlink dedup wording** — "can shadow real ones" replaced with actual behavior: dedup by `realpath(SKILL.md)`; second-encountered is skipped with log `"Skipping duplicate skill 'X' from Y (same file already loaded from Z)"`.

### Added

- **`skillOverrides` setting section** — the `skillOverrides: { [skillName]: "on" | "name-only" | "user-invocable-only" | "off" }` setting exists in the schema and feeds the `/skills` menu UI (`kS5`/`vS5` precedence: policy → flag → author → plugin → project → user). But runtime enforcement via `E4H(skill)` is hardcoded `return "on"` in v2.1.116, so the setting has no effect on the model-facing listing or the Skill tool. Documented as "UI-only dead code" with a pointer to the working alternatives (`disable-model-invocation`, `user-invocable`).
- **Live-reload watcher constants** — `Io5 = 1000` (stabilityThreshold), `xo5 = 500` (pollInterval), `uo5 = 300` (reload debounce), `mo5 = 2000` (Bun stat-polling).
- **Skill source priority expanded** — now 6 levels: policy → user → project → additional (`--add-dir`) → legacy `commands_DEPRECATED` → bundled. Bundled registered separately, doesn't participate in realpath dedup.
- **Full safe set `z_5`** — listed verbatim in the permission section.

### Version metadata

- `verified_against_binary: 2.1.116` (was 2.1.113). Re-extracted the bundle and re-read the skills module directly; lesson constants and algorithms reflect v2.1.116.
- Bumped version to 2.9.0 in `version.json`, `plugin.json`, `SKILL.md`, `CLAUDE.md`.

## v2.8.1 — 2026-04-18 (this fork)

Post-v2.8.0 correction: the Daemon-Mode Thread cluster in L85 originally characterized L43 as "KAIROS / Cron" and described daemon mode as assembling *new* daemon infrastructure. L43 is actually titled "KAIROS — Always-On Autonomous Daemon" and documents the full daemon architecture (feature flags, `kairosActive` state pivot, `<tengu_tick>` wake-up loop, queue priorities). Corrected framing: v2.1.113's `CLAUDE_BG_BACKEND=daemon` env var is plausibly the first *binary-reachable public surface* of the KAIROS daemon subsystem that has been ant-only since v2.1.88 — not a new system.

### Changed

- **L85 Daemon-Mode Thread cluster** — rewrote the L43 row to make explicit that L43 is the architectural home of daemon mode and L85 is its first public binary surfacing; the v2.1.113 env var and KAIROS are the same feature at different stages of rollout.
- **L43 (KAIROS)** — added a "Public surfacing update" blockquote at lesson top pointing readers forward to L85 for the v2.1.113 env var surface, and noting the April 2026 npm source-map leak as external corroboration that KAIROS = "autonomous always-on daemon mode."
- **L85 Unresolved section** — added an "External corroboration (April 2026 source-map leak)" bullet citing public reports that independently described KAIROS as autonomous always-on daemon mode, matching L43's characterization; this shifts daemon mode from "plausible future direction" to "confirmed staged-for-launch feature."
- **cross-references.json** — strengthened L43 ↔ L85 relevance from 0.65 to 0.95 bidirectional, reflecting architectural parent-child rather than thematic neighbor.
- Regenerated `semantic-index.json`.

## v2.8.0 — 2026-04-18 (this fork)

Adds Chapter 17 covering v2.1.112–v2.1.113: one new lesson (L85) documenting the first **sunset event** in the post-v2.1.90 binary-extraction era. Anthropic removed all five Remote Workflow Commands (`/autopilot`, `/bugfix`, `/dashboard`, `/docs`, `/investigate`) that shipped in v2.1.110 — less than three release cycles after their introduction — while keeping the CCR v2 back-end infrastructure intact. L77 is now historical documentation with a prominent sunset banner. v2.1.112 produced zero material bundle changes.

### Added

- **L85 — v2.1.112–v2.1.113 Command & Env Var Changes (Remote Workflow Sunset + deep-dive)**: Catch-all lesson for v2.1.112 (no-op) and v2.1.113. Covers:
  - **Remote Workflow Commands sunset**: `/autopilot`, `/bugfix`, `/dashboard`, `/docs`, `/investigate` all removed from the bundle with zero residual occurrences — no feature flag, no deprecation shim, code deleted. L77 retained as historical documentation.
  - **Command rename**: `/less-permission-prompts` → `/fewer-permission-prompts` (body byte-identical; only command name changed).
  - **Cosmetic description tweaks**: `/compact` ("Free up context by summarizing the conversation so far") and `/exit` ("Exit the CLI").
  - **Four new env vars**: `CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS` (default 600000ms async-agent stall watchdog); `CLAUDE_BG_BACKEND=daemon` (full daemon-mode support: SIGHUP ignored, stdout EIO/EPIPE latched, orphan-detector bypassed — process designed to survive parent detachment); `CLAUDE_CODE_BS_AS_CTRL_BACKSPACE` (Windows backspace→Ctrl+Backspace mapping, auto-on for win32 except mintty/cygwin); `CLAUDE_CODE_DECSTBM` (opt-in ANSI Set-Top-Bottom-Margin for fullscreen TUI scrolling regions).
  - **Three new GrowthBook flags**: `tengu_marlin_porch` (DECSTBM rollout), `tengu_silk_hinge` (gates new Show-message-timestamps setting), `tengu_amber_lynx` (gates a code path inside the Submit Feedback / Bug Report dialog — exact variant partially resolved).
  - **Two new user settings**: `showMessageTimestamps` (default false, gated by `tengu_silk_hinge`, toggle in `/config`, fires `tengu_show_message_timestamps_setting_changed`); `autoAddRemoteControlDaemonWorker` (config surface added, no consumer found in binary — likely server-side or forthcoming, conceptually pairs with `CLAUDE_BG_BACKEND=daemon` to sketch a "Claude Code as daemon worker under Remote Control" architecture).
  - **Async-agent stall-watchdog machinery depth**: full reset semantics (`resetStallWatchdog()` new in v2.1.113), three-tier watchdog hierarchy (stream byte watchdog L74 → SDK session `tengu_sdk_stall` → async-agent `tengu_async_agent_stall_timeout`), failure path (abort signal, task registry marks `failed`, no resume).
  - **New MCP call watchdog**: `activeCallWatchdogs` set on MCP transport state; 30s progress log ("Tool X still running"); 90s abort after transport error ("MCP server X transport dropped mid-call; response for tool Y was lost"). Closes long-standing hole where MCP tool calls could hang indefinitely after transport errors.
  - **Five new observational telemetry events**: `tengu_async_agent_stall_timeout`, `tengu_unclean_exit` (prior session crash detection at startup), `tengu_update_refused` (new /update refusal logic for active-tasks and transcript-path-drift), `tengu_image_resize_degraded` (image block substitution), `tengu_show_message_timestamps_setting_changed`.
  - **Two telemetry events removed** (consistent with L77 sunset): `tengu_remote_workflow_spawner_started`, `tengu_remote_workflow_spawner_result`.
  - **`/update` command iteration note**: still `isEnabled:()=>false` and `isHidden:true` (not user-visible) but implementation body is being actively edited — refusal paths added in v2.1.113 suggest staged launch of in-place native-installer upgrade is being prepared.

### Changed

- **L77 (Remote Workflow Commands) — sunset banner added**: Prominent warning at lesson top noting all five commands were removed in v2.1.113. Lesson retained as historical documentation for what v2.1.110 actually shipped.
- **L84 (v2.1.110–v2.1.111 command table)**: Marked `/autopilot`, `/bugfix`, `/dashboard`, `/docs`, `/investigate` as removed-in-v2.1.113 with pointer to L85; marked `/less-permission-prompts` as renamed-in-v2.1.113.
- **`CLAUDE_CODE_USE_CCR_V2` + `allow_remote_sessions` + `$X4()` gates still present**: Only the user-facing slash commands were removed; the back-end CCR v2 infrastructure (L73 multi-repo checkout, L60 `/autofix-pr`) survives.
- Updated `topic-index.json` (+1 lesson, +80 keyword_map entries, 865 total; L85 now has 61 keywords).
- Updated `cross-references.json` with L85 entries (85 total) and wired the **Daemon-Mode Thread cross-reference cluster** connecting L85 ↔ L37 (Remote Control bridge) ↔ L43 (KAIROS cron) ↔ L68 (hidden `/update`) ↔ L79 (PushNotification) — surfacing the "persistent local Claude Code worker" architecture as a first-class concept.
- **Chapter 16 (`13-verified-new-v2.1.111.md`) intro** — prepended a ⚠ "Direction correction in v2.1.113" blockquote pointing readers to Chapter 17 before treating L77's Remote Workflow Commands as the current state.
- **Chapter 17 (L85) intro + body** — expanded narrative to frame v2.1.113 as four parallel threads (Remote Workflow sunset, reliability hardening, fullscreen/UX polish, daemon-mode groundwork) rather than a grab-bag, and added an explicit "Daemon-Mode Thread (Cross-Reference Cluster)" table + "Risks Worth Flagging to Skill Users" section.
- Updated `troubleshooting.json` (+12 symptom patterns, 71 total), covering "autopilot gone", "less-permission-prompts not found", "async agent stall", "Windows backspace", "DECSTBM/marlin_porch", "CLAUDE_BG_BACKEND daemon", "show message timestamps", "claude survived SIGHUP", "MCP tool hung transport dropped", "prior session crashed", "/update command hidden", "image could not be processed".
- Regenerated `semantic-index.json` (85 lessons, 945 vocabulary terms, 182.9 KB).
- Bumped version to 2.8.0 in `version.json`, `plugin.json`, `SKILL.md`, `CLAUDE.md`.

### Not changed in v2.1.113

- Hook event types: still 19, identical set.
- API beta strings: still 30, identical set (`context-hint-2026-04-09`, `ccr-byoc-2025-07-29`, `managed-agents-2026-04-01` all retained).
- All L78–L84 machinery (Advisor Tool, PushNotification/KAIROS, Context Hint API, Fullscreen TUI, Proxy Auth Helper, System Prompt GB Override, catch-all items) unchanged.

## v2.7.0 — 2026-04-17 (this fork)

Adds Chapter 16 covering v2.1.110–v2.1.111: eight new lessons (L77–L84) documenting the largest behavioral shift since the v2.1.90 extraction — **server-driven behavior**. Context Hint API lets the server compact your context mid-flight; Advisor Tool routes primary-model tool calls through a server-side reviewer model; System Prompt GB Override lets the server replace the prompt wholesale in CCR-hosted sessions. Two users on the same binary can now experience materially different behavior depending on GrowthBook flag state.

### Added

- **L77 — Remote Workflow Commands (`/autopilot`, `/bugfix`, `/dashboard`, `/docs`, `/investigate`)**: Five new slash commands registered from a shared array `jA5` and dispatched through spawner `YA5()`. All five delegate to a remote CCR v2 session via `POST /v1/sessions` with beta header `anthropic-beta: ccr-byoc-2025-07-29`. CLI becomes a thin client; behavior lives server-side. Hidden entirely unless CCR v2 is enabled (`$X4()`).
- **L78 — Advisor Tool (Server-Side Reviewer Model)**: Second model critiques the primary model's tool calls in real time via `server_tool_use` / `advisor_tool_result` content blocks. Four-gate enablement: `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` hard-off, first-party API only (`gq()==="firstParty"`), entitlement check (`co()`), and a strict model allow-list (`byH()`: opus-4-6 / opus-4-7 / sonnet-4-6 only). Master gate: `tengu_sage_compass2`. Experimental bypass: `CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL`. Agent-on-agent as a shipped runtime primitive.
- **L79 — PushNotification Tool + KAIROS**: New tool with `status: "proactive"` as the only accepted input. Routes through local Remote Control bridge → KAIROS push infrastructure → user's registered mobile device. 6 output variants keyed on `disabledReason` × `localSent` × `hasFocus`. Distinct from Brief despite shared "proactive" vocabulary.
- **L80 — Context Hint API (`context-hint-2026-04-09`)**: Server-driven micro-compaction signaling. Controller `YE5` advertises `context_hint: {enabled: true}` only when first-party + `repl_main_thread*` + `tengu_hazel_osprey` on. Server may reject with HTTP 422/424/409/529 or SSE `invalid_request` with `type: "context_hint_rejection"`; client responds with `sT9()` keep-recent compaction (`keepRecent=5`) and retries. No env var disables it.
- **L81 — Fullscreen TUI + `/focus` + `/tui`**: Alt-screen terminal rendering with 5-tier activation precedence (`Qq()`): `CLAUDE_CODE_NO_FLICKER=1` disables > `CLAUDE_CODE_FULLSCREEN=1` enables > tmux-CC auto-disables > `userSettings.tui` > `tengu_pewter_brook` rollout. `/tui` respawns the entire process via `child_process.spawn()` — cheapest way to cleanly enter/exit alt-screen. Upsell gated separately by `tengu_ochre_hollow`.
- **L82 — Proxy Auth Helper**: User-defined shell command produces the `Proxy-Authorization` header for rotating corporate-proxy credentials. Pairs with `apiKeyHelper` and `awsAuthRefresh` as the "user-command-produces-credential" pattern. Strict `CLAUDE_CODE_PROXY_AUTHENTICATE="1"` env gate. Workspace-trust-protected at project and local scopes. 30s exec timeout with stale-cache fallback on failure.
- **L83 — System Prompt Modifications (GB Override + Append-Subagent + Verified-vs-Assumed)**: (a) Server can replace the system prompt entirely via a user-supplied GB feature name (`CLAUDE_CODE_SYSTEM_PROMPT_GB_FEATURE`), gated on `CLAUDE_CODE_REMOTE`. (b) Per-call subagent prompt augmentation via `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT` + `appendSubagentSystemPrompt` option. (c) New verified-vs-assumed safety rubric in the default prompt to reduce hallucination-via-confidence.
- **L84 — v2.1.110–v2.1.111 Command & Env Var Changes**: Catch-all covering `/less-permission-prompts` (3.5KB methodology prompt doubling as auto-allow source-of-truth), canary channel (`rp1()` reading `tengu_canary` for rolling native-installer canary), slow first-byte watchdog (`CLAUDE_SLOW_FIRST_BYTE_MS` default 30s, purely observational), background plugin refresh (`CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH`), unknown-command did-you-mean (`_a5()` via Fuse-style fuzzy match), external-editor context, PR status footer, and 9 new telemetry-only events (`tengu_slash_link_clicked`, `tengu_review_remote_stopped`, `tengu_vscode_sdk_stream_ended_no_result`, `tengu_relay_chain_v`, `tengu_tool_search_unsupported_model`, `tengu_thinking_clear_latched`, etc.).

### Changed

- **CCR v2 (L73) ↔ Remote Workflows (L77)**: Multi-repo checkout infrastructure documented in L73 now has user-facing commands in L77.
- **KAIROS (L43) ↔ PushNotification (L79)**: L43's always-on daemon speculation now has a shipped tool interface.
- **Compaction (L28) ↔ Context Hint (L80)**: Client-initiated compaction is now joined by server-driven compaction — read together to understand all triggers.
- Updated `topic-index.json` (+8 lessons, +89 keyword_map entries, 785 total).
- Updated `cross-references.json` with L77–L84 entries (84 total).
- Updated `troubleshooting.json` (+11 symptom patterns, 59 total), including a dedicated "server-driven behavior" entry pointing at L78/L80/L83/L84 for users asking why their Claude Code behaves differently from a colleague's.
- Regenerated `semantic-index.json` (84 lessons, 889 vocabulary terms, 169.6 KB).
- Bumped version to 2.7.0 in `version.json`, `plugin.json`, `SKILL.md`, `CLAUDE.md`.

### Observed but unresolved

Codenames appearing in v2.1.110–v2.1.111 bundles whose mechanism was not confirmed: `tengu_cobalt_ridge`, `tengu_crimson_vector`, `tengu_loud_sugary_rock`, `tengu_slate_ribbon`, `tengu_velvet_moth`. Reported as observed rather than speculated about.

## v2.6.0 — 2026-04-16 (this fork)

Adds Chapter 15 covering v2.1.107–v2.1.109: five new lessons (L72–L76) verified against live binaries. Headline additions: `/recap` on-demand session recap, multi-repo checkout infrastructure for CCR v2 remote agents, byte-level stream watchdog, REPL mode, and the managed-agents-2026-04-01 API beta with 33 embedded SDK docs.

### Added

- **L72 — `/recap` On-Demand Session Recap**: New slash command complementing the passive away-summary system (L65). Gated by `tengu_sedge_lantern` flag. Setting toggle `awaySummaryEnabled` appears in `/config` when the flag is on. `CLAUDE_CODE_ENABLE_AWAY_SUMMARY` env var can force-enable/disable. `supportsNonInteractive: false`. Updated v2.1.107 prompt leads with "overall goal and current task" instead of "name the task".
- **L73 — Multi-Repo Checkout & Base Refs**: `CLAUDE_CODE_REPO_CHECKOUTS` (JSON `{label:path}`) and `CLAUDE_CODE_BASE_REFS` (JSON `{label:ref}`) set by external CCR v2 orchestrator. Branch monitoring via `fs.watchFile` on `.git/HEAD` at 1s intervals reports `current_branches` as `external_metadata` to the CCR server. `TQ1()` provides 3-tier merge-base resolution (per-repo ref → global ref → git default) for Write/Edit diffs. Entire feature gated by `CLAUDE_CODE_USE_CCR_V2` — not local CLI functionality.
- **L74 — Byte-Level Stream Watchdog**: Transport-layer counterpart to L70's event-level watchdog. `CLAUDE_ENABLE_BYTE_WATCHDOG` env var + `tengu_stream_watchdog_default_on` flag (default `true`). Fires when no bytes arrive on the socket for the timeout window — complements L70 which fires when no SSE events are parsed.
- **L75 — REPL Mode**: Sealed VM context with `CLAUDE_CODE_REPL` + `CLAUDE_REPL_VARIANT`. Gated by `tengu_slate_harbor` (default false). `repl_main_thread*` thread type. `import`/`require` blocked. 12+ helper shortcuts (`haiku()`, `opus()`, `sonnet()`, etc.). Bun.Transpiler for TypeScript. 3 hydration modes (fresh, replay, snapshot). Tool restriction via `OkH` set + `G47()`/`U4H()` re-injection. Compaction-aware — warns when VM state clears.
- **L76 — v2.1.107–v2.1.109 Command & Env Var Changes**: 8 new slash commands, 6 new env vars in v2.1.107 (`CLAUDE_CODE_ENABLE_AWAY_SUMMARY`, `CLAUDE_ENABLE_BYTE_WATCHDOG`, `CLAUDE_CODE_REPO_CHECKOUTS`, `CLAUDE_CODE_BASE_REFS`, `CLAUDE_CODE_RESUME_FROM_SESSION`, `CLAUDE_CODE_ULTRAREVIEW_PREFLIGHT_FIXTURE`), 4 new in v2.1.108 (`CLAUDE_API_SKILL_DESCRIPTION`, `CLAUDE_CODE_REPL`, `CLAUDE_REPL_VARIANT`, `CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME`). New beta `managed-agents-2026-04-01` with 33 embedded SDK docs (~324KB, Python/TypeScript/Go/Java/Ruby/PHP/C#) selected by `ZU5()` language detection. 3-layer rate limit upgrade paths: server `upgrade-paths` header, client lever hints `oV9()` (pro + seven_day only, `tengu_garnet_plover`), interactive options menu (`tengu_jade_anvil_4`, `tengu_coral_beacon`). Early warning thresholds. `/think-back` + `/thinkback-play` removed. `/clear` description changed.

### Changed

- Fixed pre-existing `troubleshooting.json` bug (pipe-delimited pattern strings converted to arrays).
- Updated `topic-index.json` with L72–L76 entries and keyword_map.
- Updated `cross-references.json` with L72–L76 cross-refs.
- Regenerated `semantic-index.json` (76 lessons).
- Bumped to v2.6.0 in `version.json`, `plugin.json`, `SKILL.md`, `CLAUDE.md`.

## v2.5.0 — 2026-04-12 (this fork)

Adds two lessons from v2.1.104: streaming partial-yield protection (a behavioral fix to the streaming fallback pipeline) and a gated system-prompt section rename. Both binary-verified.

### Added

- **L70 — Streaming Partial Yield Protection**: Before v2.1.104, if a streaming request idle-timed-out, Claude Code would fall back to a non-streaming retry and **discard** any content already received. v2.1.104 adds a `GH.length > 0` guard that preserves partial content and emits `fallback_cause: "partial_yield"` telemetry. Related flags: `tengu_streaming_fallback_to_non_streaming`, `tengu_streaming_idle_timeout`. Disable non-streaming fallback entirely with `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK`. Raises `StreamIdleTimeoutError` rather than swallowing it.
- **L71 — System Prompt Section Rename (Text Output)**: The system-prompt section previously titled "Communication style" was renamed to "Text output (does not apply to tool calls)" to more precisely scope what the guidance covers. Gated on **both** the `quiet_salted_ember` `clientDataCache` flag AND the model being `opus-4-6`. Narrow gate = low-risk A/B of prompt wording.

### Changed

- Updated `topic-index.json` with L70/L71 keywords.
- Updated `cross-references.json` with L70/L71 cross-refs.
- Regenerated `semantic-index.json` (71 lessons).
- Bumped to v2.5.0 in `version.json`, `plugin.json`, `SKILL.md`, `CLAUDE.md`.

## v2.4.4 — 2026-04-11 (this fork)

Adds Lesson 69: Marble Origami — the reversible context collapse persistence system. Binary-verified against v2.1.101. Also documents the UI survey priority system (frustration detection).

### Added

- **L69 — Marble Origami: Reversible Context Collapse Persistence**: Context collapse (step 4 in the compaction pipeline) persists its state to session JSONL via two entry types: `marble-origami-snapshot` (last-writer-wins collapse state) and `marble-origami-commit` (array of finalized collapses). This makes it the only reversible compaction strategy — original messages are retained and collapse is restored on session resume. Documents `recordContextCollapseCommit()` (`sL5`), `recordContextCollapseSnapshot()` (`tL5`), JSONL hydration pipeline, and the UI survey priority system (`postCompactSurvey` > `memorySurvey` > `feedbackSurvey` > `frustrationDetection`).

### Changed

- **L2 / L4 — compaction pipeline**: Expanded contextCollapse one-liner with marble-origami persistence details and cross-reference to L69.
- Updated `topic-index.json` with new keywords: `marble-origami`, `context-collapse`, `contextCollapse`, `reversible`, `recordContextCollapseCommit`, `recordContextCollapseSnapshot`, `frustration-detection`, `survey`.
- Updated `cross-references.json` with L69 cross-refs (→ L2, L28, L3, L65).
- Updated `troubleshooting.json`: added L69 to compaction troubleshooting entry.
- Regenerated `semantic-index.json` (69 lessons, 710 vocabulary terms).
- Bumped version to 2.4.4 in `version.json`, `plugin.json`, `SKILL.md`, `CLAUDE.md`.

## v2.4.3 — 2026-04-11 (this fork)

Refreshed all "undocumented" and "not in official docs" claims against the live official documentation at code.claude.com/docs (changelog, commands page, env-vars page, CLI reference). No new lessons; this is a documentation-accuracy pass.

### Changed

- **L51 — `/effort`**: Updated status: `max` and `auto` effort levels are now officially documented in the commands page and CLI reference. Removed outdated "not mentioned in official docs" claim.
- **L55 — env vars table**: Added note that `CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH` may be superseded by `CLAUDE_CODE_SKIP_BEDROCK_AUTH` (now official). Noted `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` are now in the official env-vars page.
- **L56 — command docs table**: Updated `/buddy` from "Documented (base only)" to "Removed" (v2.1.97). Added note that `/autocompact` env var is documented even though the command isn't. Added note that `/memory` (documented) is related to `/toggle-memory` (undocumented).
- **L57 — `/setup-bedrock`**: Added status update noting it is now officially documented with its exact official description. Changed summary table from "hidden" to "conditionally visible, now officially documented".
- **L58 — env vars**: Updated `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` from "CLI help only" to "Official (env-vars page + CLI reference)".
- **L63 — Perforce mode**: Added "now officially documented" note with env-vars page reference.
- **L63 — Script Caps**: Added "now officially documented" note with env-vars page reference.
- **L64 — `/setup-vertex`**: Added "now officially documented" note. Changed wording from "hidden" to "conditionally visible".
- **SKILL.md**: Updated summary annotations with `[now documented]` markers for features whose official docs status changed.
- Updated `Updated:` date headers in chapters 9, 10, and 12 to 2026-04-11.

### Confirmed still undocumented

`/dream`, `/toggle-memory`, `/autocompact` (command), `/stop-hook`, `/loops` (management UI), `/update` (slash command), `advisor-tool-2026-03-01` API beta, GrowthBook internals, and 9+ env vars (`CLAUDE_CODE_RESUME_THRESHOLD_MINUTES`, `CLAUDE_CODE_AGENT_COST_STEER`, `CLAUDE_BASE`, `CLAUDE_CODE_EXECPATH`, etc.).

## v2.4.2 — 2026-04-11 (this fork)

Adds verified findings from attempting to force-activate `/dream`: Bun SEA code signing, GrowthBook cache writeback mechanics, lazy command dispatch, and the working cache injection workaround.

### Added

- **`scripts/patch-dream.sh`**: Utility to force-activate `/dream` via GrowthBook cache injection with a filesystem watcher. Injects `tengu_kairos_dream=true` into `~/.claude.json` and polls for 30s to survive the SDK cache writeback during startup.

### Changed

- **L62 — `/dream`**: Added section on lazy `isEnabled` dispatch — commands are always registered; `isEnabled` is a function reference checked at dispatch time via `Ve()`, not at startup. Flag changes take effect immediately without restart.
- **L68 — GrowthBook internals**: Added lazy SDK init (`QS6` memoized thunk), destructive cache writeback (`yQq()` replaces entire object with `Object.fromEntries(Nb)`), flag absence vs explicit false semantics, Bun SEA code signing (macOS SIGKILL on modified binary), cache injection + watcher workaround, and 5 new bundle symbols (`yQq`, `QS6`, `Nb`, `Pj`, `mS4`).
- Updated troubleshooting entries for "dream not recognized" and "feature flag override" with workaround details.
- Updated `topic-index.json` with new keywords: `code-signing`, `bun-sea`, `SIGKILL`, `cache-writeback`, `cache-injection`, `lazy-dispatch`, `command-registration`.
- Regenerated `semantic-index.json` (68 lessons, 699 vocabulary terms).

## v2.4.1 — 2026-04-11 (this fork)

Deep dive into `/dream` command gating and GrowthBook feature flag evaluation internals.

### Changed

- **L62 — `/dream`**: Added detailed `isEnabled` gate chain analysis (`IF5` in v2.1.101), the 3-gate breakdown (`!kairosActive`, memory enabled, `tengu_kairos_dream`), memory-enabled cascade (`l4()` 5-level check), comparison table of `/dream` vs auto-dream gates, and updated bundle symbol table with v2.1.101 identifiers.
- **L68 — v2.1.101 Changes**: Added full GrowthBook Feature Flag Internals section: `E_()` evaluation chain (5 steps), SDK configuration (remote-eval mode, Anthropic API proxy, client key, per-user/org keying), cache persistence (`~/.claude.json`), local override feasibility analysis (all 3 override paths dead/stubbed in production), wrapper function symbol table, and non-obvious behavior notes (Bedrock/Vertex bypass, ignored TTL parameter).
- Updated `topic-index.json` with new keywords: `isEnabled`, `gating`, `tengu-kairos-dream`, `growthbook`, `feature-flag`, `remote-eval`, `flag-override`, `NQq`, `E_`. Updated keyword_map entries.
- Updated `cross-references.json` with L62↔L68 bidirectional references for GrowthBook gating.
- Added 2 new troubleshooting entries: "dream not recognized" and "feature flag not working/override".
- Regenerated `semantic-index.json` (68 lessons, 691 vocabulary terms).

## v2.4.0 — 2026-04-11 (this fork)

Verified against Claude Code **v2.1.101** (binary extraction 2026-04-11). Adds Chapter 13 (Lessons 65–68) covering all changes in v2.1.101. Bundle size increased ~670KB (89.4MB to 90.0MB).

### Added

**Chapter 13 — Binary-verified changes in v2.1.101** (Lessons 65–68)

- **L65 — Proactive Recap: Away Summary System**: entirely new feature gated behind `tengu_sedge_lantern` (default: false). When the user switches away from the terminal for 5+ minutes, generates a brief recap via a constrained forked API call (no tools, 1 turn, no cache write, no transcript). Renders as `※ recap: <dim italic text>`. Covers the React hook (`nr7`), focus/blur detection via xterm escape sequences, conversation thresholds (3 total user messages, 2 since last summary), the prompt text (under 40 words, task + next action), message injection format (`{type: "system", subtype: "away_summary"}`), three-level cancellation, and CacheSafeParams reuse. The rendering code was pre-wired in v2.1.100 but all generation logic is new.
- **L66 — CA Certificate Store Configuration**: new `CLAUDE_CODE_CERT_STORE` env var for enterprise TLS control. Accepts comma-separated `"bundled"` and/or `"system"` (default: both). Full resolution chain: env var → `NODE_OPTIONS` flags → default. Memoized loader (`fm`) with `NODE_EXTRA_CA_CERTS` integration, deduplication, and three consumer functions (WebSocket `MN()`, undici `CD_()`, axios `ED_()`). Applied globally via `tdH()` at init and on settings reload. Cache invalidation via `Zx8()` on `fi()`. Replaces the now-removed `applyExtraCACertsFromConfig()`.
- **L67 — Dynamic Loop Pacing & Cloud-First Offering**: `tengu_kairos_loop_dynamic` (default: false) enables model-chosen wakeup delays via `ScheduleWakeup`, clamped to [60, 3600] seconds, with minute-boundary snapping and cache lead optimization. Loop aging: auto-stops after `recurringMaxAgeMs` (default 7 days, max 30 days). `tengu_cinder_almanac` (default: false, new) offers cloud scheduling when interval >= 60min or daily phrasing detected, via `AskUserQuestion` dialog. Also covers the disabled `/loops` JSX management UI (list/create/delete crons and stop-hooks) and interval parsing.
- **L68 — v2.1.101 Command & Env Var Changes**: `/update` (hidden, disabled) — in-place relaunch with `--resume <sessionId>`, no actual update step. `CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH` — SDK token refresh callback on 401. 5 new feature flags, 7 new SDK observability telemetry events, MCP registry BFF endpoint switch.

### Changed

- `README.md`, `SKILL.md`, `version.json`, `plugin.json`, and `CLAUDE.md` now point to Claude Code **v2.1.101**, skill version **2.4.0**, and **68 lessons across 13 chapters**.
- Regenerated `semantic-index.json` (68 lessons, 687 vocabulary terms).
- Updated `topic-index.json` with L65–L68 entries and 20+ new keywords; updated existing keyword entries for `proactive`, `tls`, `enterprise`, `cron`, `scheduling`, `recurring-tasks`, `oauth`, `env-vars`, `sdk`.
- Updated `cross-references.json` with L65–L68 cross-reference entries.
- Updated `troubleshooting.json` with 4 new symptom entries (TLS/cert errors, loop aging, cloud scheduling, SDK OAuth refresh).

## v2.3.0 — 2026-04-10 (this fork)

Verified against Claude Code **v2.1.100** (binary extraction 2026-04-10). Adds Chapter 12 (Lessons 62–64) covering changes across v2.1.97, v2.1.98, and v2.1.100. v2.1.100 itself is bugfix-only relative to v2.1.98.

### Added

**Chapter 12 — Binary-verified changes in v2.1.97–v2.1.100** (Lessons 62–64)

- **L62 — `/dream`: User-Facing Memory Consolidation**: the full `/dream` command (alias `/learn`), promoted to user-facing in v2.1.97. Covers all 3 invocation modes (manual, auto-dream background, `/dream nightly` scheduled), the 11-gate chain, 4-phase consolidation prompt with template variables, tool sandboxing rules, lock mechanism with PID-based acquire and mtime-based rollback, team memory handling, tiny memory mode (`tengu_billiard_aviary`), DreamTask lifecycle tracking, 6 telemetry events, memory path resolution and worktree sharing, and 20 bundle symbol identifiers.
- **L63 — Perforce Mode & Script Caps**: `CLAUDE_CODE_PERFORCE_MODE` (v2.1.98) adds Perforce workspace support with system context injection, read-only file guards on Edit/Write/NotebookEdit (error codes, `UXH` message), VCS detection via `.p4config`, and the guard+prompt architecture. `CLAUDE_CODE_SCRIPT_CAPS` (v2.1.98) adds per-command Bash call-count limiting for anti-exfiltration in script mode, with JSON format, substring matching, cumulative counting, and relationship to other script-mode hardening features.
- **L64 — v2.1.97–v2.1.100 Command & Env Var Changes**: `/setup-vertex` (v2.1.98, hidden unless `CLAUDE_CODE_USE_VERTEX`), `/buddy` fully removed (v2.1.97), `ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES` (v2.1.97, 5 recognized capabilities with fallback heuristics, `BG4` model config array), `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (v2.1.98), removed `CLAUDE_CODE_REPL`, `CLAUDE_REPL_MODE`, `CLAUDE_CODE_SAVE_HOOK_ADDITIONAL_CONTEXT`, and bundle size tracking across all 4 versions.

### Changed

- Added removal notice to `/buddy` section in L56 (`06-verified-new-v2.1.90.md`) pointing to L64.
- Added promotion notice to AutoDream section in `05-unreleased-bigpicture.md` pointing to L62.
- `README.md`, `SKILL.md`, `version.json`, `plugin.json`, `marketplace.json`, and `CLAUDE.md` now point to Claude Code **v2.1.100**, skill version **2.3.0**, and **64 lessons across 12 chapters**.
- Regenerated `semantic-index.json` (64 lessons, 658 vocabulary terms).
- Updated `topic-index.json` with L62–L64 entries and 20+ new keywords.
- Updated `cross-references.json` with L62–L64 cross-reference entries.

## v2.2.5 — 2026-04-08 (this fork)

Verified against Claude Code **v2.1.96** (built `2026-04-08T03:13:57Z`). No new lessons were needed because `v2.1.96` is bugfix-only relative to the `v2.1.94` command and env-var surface already documented in Chapter 11.

### Changed

- `README.md`, `SKILL.md`, `version.json`, and the plugin manifests now point to Claude Code **v2.1.96**, skill version **2.2.5**, and still **61 lessons across 11 chapters**.
- Clarified that Chapter 11 remains the latest net-new lesson content, while `v2.1.96` is a re-verification pass rather than a new reference chapter.

### Notes

- Official upstream `2.1.96` changelog entry: fixed Bedrock requests failing with `403 "Authorization header is missing"` when using `AWS_BEARER_TOKEN_BEDROCK` or `CLAUDE_CODE_SKIP_BEDROCK_AUTH` (regression in `2.1.94`).

## v2.2.4 — 2026-04-08 (this fork)

Verified against Claude Code **v2.1.94** (built `2026-04-07T20:25:46Z`). Adds Chapter 11 (Lessons 60–61) for the new command and env-var surface introduced since the previous v2.1.92 baseline.

### Added

**Chapter 11 — Binary-verified changes in v2.1.94** (Lessons 60–61)

- **L60 — v2.1.94 command changes**: documents `/autofix-pr` (remote PR autofix session) and `/team-onboarding` (usage-derived teammate onboarding guide), plus notes that `/loop` is still present and only changed its metadata shape.
- **L61 — New env vars in v2.1.94**: documents Mantle provider support (`CLAUDE_CODE_USE_MANTLE`, `ANTHROPIC_BEDROCK_MANTLE_BASE_URL`, `CLAUDE_CODE_SKIP_MANTLE_AUTH`, `ANTHROPIC_BEDROCK_MANTLE_API_KEY`), `CLAUDE_CODE_MCP_ALLOWLIST_ENV`, `CLAUDE_CODE_SANDBOXED`, and `CLAUDE_CODE_TEAM_ONBOARDING`.

### Changed

- `README.md`, `SKILL.md`, `version.json`, and the plugin manifests now point to Claude Code **v2.1.94**, skill version **2.2.4**, and **61 lessons across 11 chapters**.
- Regenerated `semantic-index.json` for the new lessons and keyword set.

### Fixed

- `diff-versions.sh` now recognizes both `description:"..."` and `get description(){return"..."}` command metadata, preventing false "removed command" reports for `/loop`.
- `diff-versions.sh` now ignores non-command schema labels like `String`, `Number`, `File`, and `Directory`.
- `extract-bundle.sh` now works with the current `~/.local/share/claude/versions/<version>` file layout, prefers `binary --version` for version detection, and shows correct usage examples.
- `fetch-lesson.js` now de-duplicates fallback lessons so `--list` stays accurate once binary-verified lessons are present in `topic-index.json`.

## v2.2.3 — 2026-04-07 (this fork)

### Added

- **L59 — AskUserQuestionTool**: Full documentation extracted from v2.1.92 binary. Covers input/output schemas (questions, options, multiSelect, preview), permission logic (always requires human interaction), Plan Mode restrictions, HTML/markdown preview validation, isEnabled() guard against overlapping prompts, and rendering methods.

### Changed

- **L41 — ULTRAPLAN**: Marked as **released (research preview)** per official docs at https://code.claude.com/docs/en/ultraplan. Added status note confirming our implementation details match the official documentation. Noted browser-only features (emoji reactions, outline sidebar) not visible in CLI binary.

### Fixed

- Lesson count corrected from 56 to 59 in CLAUDE.md (was undercounting since v2.2.2).

---

## v2.2.2 — 2026-04-04 (this fork)

Verified against Claude Code **v2.1.92** (built 2026-04-03T23:25:51Z). Adds Chapter 10 (Lessons 57–58) and backfills the search index with Lessons 51–56 (previously undiscoverable via search).

### Added

**Chapter 10 — Binary-verified changes in v2.1.92** (Lessons 57–58)

- **L57 — Command changes**: `/setup-bedrock` (Bedrock only, hidden otherwise); `/stop-hook` (session-only Stop hook prompt, `isEnabled: false` — disabled); `/teleport` confirmed present; `/tag` and `/vim` removed; `/advisor` description updated.
- **L58 — New env vars**: `CLAUDE_CODE_EXECPATH` (auto-injected path to claude binary in all spawned shells); `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` (remote control session naming); `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK`; `CLAUDE_CODE_SIMULATE_PROXY_USAGE`; `CLAUDE_BASE` (internal constant).

### Fixed

- Added Lessons 51–56 to `topic-index.json` — they were present in reference docs but missing from the search index, making them unsearchable. All 58 lessons now indexed (605 vocabulary terms).
- Added cross-references, troubleshooting entries, and keyword map entries for all new lessons.

---

## v2.2.1 — 2026-04-03 (this fork)

Verified against Claude Code v2.1.91. No new lessons needed — v2.1.91 is removal-only:

- `/pr-comments` command removed (was undocumented built-in "Get comments from a GitHub pull request")
- `/output-style` command removed (`output-styles/` plugin directory support still present)
- `CLAUDE_CODE_MCP_INSTR_DELTA` env var removed
- `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTIONJ` env var removed (typo-named, likely dead code)

None of these appeared in our lessons. Updated version references throughout.

---

## v2.2.0 — 2026-04-03 (this fork)

Forked from [stuinfla/claude-code-internals](https://github.com/stuinfla/claude-code-internals) (v2.0.0, 50 lessons, v2.1.88).

### Added

**Chapter 9 — Binary-verified new features in v2.1.90** (Lessons 51–56)

The v2.1.90 Claude Code binary was extracted and diffed against v2.1.88 using the new `extract-bundle.sh` and `diff-versions.sh` scripts. Six new lessons document the findings:

- **L51 — `/effort` & reasoning budget**: `effortLevel` setting, `effort-2025-11-24` API beta, `ultrathink_effort` message type, `effortValue` in the query pipeline. API beta and `max`/`auto` levels not in official docs.
- **L52 — `/rewind` & file checkpointing**: `FileHistoryState` type, message-keyed snapshots, `--rewind-files` CLI flag (not in official CLI reference), `TombstoneMessage` type, dry-run preview on `Esc Esc`.
- **L53 — `/teleport` session transfer**: `teleportFromSessionsAPI()` function, `GET /v1/code/sessions/{id}/teleport-events` API, git repo validation logic, pagination, distinction from ULTRAPLAN's `teleportToRemote()`.
- **L54 — `/branch` conversation forking**: `agentType: "fork"`, `forkContextMessages` context inheritance, `immediate: true` flag.
- **L55 — Session resume & new env vars**: `tengu_gleaming_fair` feature gate (default off), 70min/100k token thresholds, advisor model (`advisorModel` setting, `advisor-tool-2026-03-01` beta), 8 new env vars (7 undocumented), 2 removed env vars, 18 active API betas.
- **L56 — New commands**: `/autocompact` (compaction window setter, undocumented), `/buddy` (companion system, date-gated April 2026+, base command documented in v2.1.89 changelog), `/powerup` (interactive lessons, documented), `/toggle-memory` (per-session memory toggle, disabled in binary).

All documentation status claims verified against official docs (code.claude.com/docs) and the v2.1.89/v2.1.90 changelogs on 2026-04-03.

**New runtime scripts** (reduce LLM offset math and shell-injection risk):
- `scripts/fetch-lesson.js` — fetch lesson content by ID; no file path or line offset tracking needed; replaces `Read` calls in the skill workflow
- `scripts/xref.js` — cross-reference lookup CLI; replaces the fragile inline `node -e` in SKILL.md Step 3; shell-safe (query is argv, not interpolated)
- `scripts/troubleshoot.js` — troubleshooting index CLI; replaces inline `node -e` in Step 4; shell-safe

**New maintenance scripts** (make future binary updates repeatable):
- `scripts/extract-bundle.sh` — extracts the JS bundle from any Claude Code Bun SEA binary; auto-detects the installed version; uses Python stdlib only
- `scripts/diff-versions.sh` — structured diff of env vars, slash commands, hook types, and API betas between two bundle files; what was used to find the Chapter 9 content

**Plugin marketplace infrastructure** (installable without manual zip):
- `.claude-plugin/marketplace.json` — root marketplace definition; enables `yaniv-golan/claude-code-internals` shorthand in Claude Desktop and Claude Code CLI
- `skill-package/.claude-plugin/plugin.json` — plugin definition consumed by the marketplace resolver
- `site/static/install-claude-desktop.html` — "Add to Claude" button page using `claude://` deep link with 5-second fallback to manual instructions
- `.github/workflows/release.yml` — auto-builds and attaches zip on git tag push
- `.github/workflows/deploy-site.yml` — deploys `site/` to GitHub Pages

### Changed

- **`SKILL.md`**: Steps 3–5 now use the new script CLIs (`xref.js`, `troubleshoot.js`, `fetch-lesson.js`) instead of fragile inline `node -e` blocks. Added empty-topic handling (prints available topics index). Added version check step. Added Gotchas section. Updated lesson table to include Chapter 9.
- **`version.json`**: `skill_version` 2.0.0 → 2.2.0, `captured_version` 2.1.88 → 2.1.90, `lessons_count` 50 → 56, added `verified_against_binary` field.
- **`README.md`**: Rewritten installation section with per-platform instructions (Claude Desktop, Claude Code CLI, Claude.ai web, Manus, ChatGPT, Codex), "Add to Claude" badge, updated version numbers, updated lesson counts and chapter table.

### Removed

Nothing from the original was removed. All 50 original lessons, scripts, and indexes are intact.

---

## v2.0.0 — 2026-03-31 (original, [stuinfla/claude-code-internals](https://github.com/stuinfla/claude-code-internals))

Original release by **stuinfla**. All credit for the foundational work:

- 50 lessons across 8 chapters reverse-engineered from Claude Code v2.1.88 source docs (markdown.engineering)
- Unified RRF search combining keyword lookup (`lookup.sh`) and TF-IDF cosine similarity (`semantic-search.js`) via `search.js`
- 494-keyword topic index (`topic-index.json`)
- Pre-built TF-IDF vectors for all 50 lessons (`semantic-index.json`)
- 200 lesson-to-lesson cross-references (`cross-references.json`)
- 25 troubleshooting symptom patterns (`troubleshooting.json`)
- PreToolUse hook for `.claude/` config awareness (`config-aware-hook.sh`)
- Version staleness detection (`check-version.sh`)
- RuFlo/RuVector integration support (`build-rvf-index.js`)
- Architecture diagrams and full README documentation
