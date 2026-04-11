# Changelog

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
