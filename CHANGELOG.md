# Changelog

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
