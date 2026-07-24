# Changelog

## v2.32.0 — 2026-07-24 (this fork) — EXTENDS Ch37/L129 + L131: the SDK-MCP discovery surface (full inventory, verbatim schemas, three-state gating, stickiness correction)

No new lesson number — three `### ADDENDUM` blocks inside `references/34-skill-discovery-vcs-events-containment.md` (two under L129, one under L131), because L129 already owns this subject (it carries both gate ids and the `isEnabled` predicate) and a new chapter would fragment one topic across two. Lesson count stays **137 / 38 chapters**. Verbatim schemas and output envelopes go into the state layer (`references/state/plugins-skills-hooks.md`) rather than bloating the chapter — they are mutable "as of 1.24012.1" data.

Prompted by the `claude-cowork-headless-emulator` project's `docs/internal/2026-07-24-a2-sdk-mcp-discovery-confirmation.md` (the recurring lead-source), then **re-derived first-party** against the same `app.asar` **1.24012.1** plus two *upgraded* evidence bases: the **full 427-file `audit.jsonl` corpus** (1678 `system/init` records, agent **2.1.64 → 2.1.217** — vs L129's original 10+ sessions / 2.1.165–2.1.209) and a **fresh gzip-wrapped `fcache` decode** (2026-07-24 11:38).

**Confirmed from the emulator doc** (no changes needed): the 4-server inventory; both gate ids — `245679952` `suggestSkillsEnabled` **on/force** (`ruleId fr_movyeduu`) and `1598976391` `proactiveSkillSuggestEnabled` **off/defaultValue**, the second only evaluated when the first passes; all `isEnabled` predicates verbatim; the `si` registry + `oi()` builder + `InternalMcpServerManager`; `search_plugins`' REQUIRED `userIntent`; the `.slice(0,15)` cap; and `trigger`'s gated injection.

- **A FIFTH discovery server, missed by the emulator doc entirely.** `cowork-onboarding` (`serverName qr`, tool `show_onboarding_role_picker`), `isEnabled: sessionType==="cowork" && isFeatureEnabled("2114777685")` — gate **force-ON** live (`ruleId fr_mnj0h9xm`), **1264** real `init.tools` occurrences since agent **2.1.92**. So the real surface is **13 tools across 5 servers**, not 12 across 4. Its `role`/`dismissed` properties are both *"Populated by the permission flow… Do not set this yourself"* — the model calls it with no args.
- **The 9-vs-13 `allowedTools` delta is deliberate, and identified.** The 4 rendered-but-not-pre-approved tools are the **3 mutating `scheduled-tasks` tools** (`create_`/`update_`/`delete_scheduled_task`) plus `show_onboarding_role_picker`; only read-only `list_scheduled_tasks` is pre-approved. This dovetails with **Ch24/L107** — `MCP_CREATE_SCHEDULED_TASK`/`MCP_UPDATE_SCHEDULED_TASK` are two of the eight names in the Desktop `PreToolUse` forced-ask matcher. Posture: **13 declared, 9 pre-approved, 4 routed through a permission prompt.** Corollary: `allowedTools` under-reports by 4 here and over-reports elsewhere (L129) — **never infer the rendered surface from it in either direction.**
- **CORRECTION to L129's stickiness claim.** "Flags are sticky per session (a built system prompt is not rebuilt mid-session)" is wrong in two ways. Stickiness is keyed to the built-system-prompt cache via `ft(r,e) = r?.builtSystemPrompt!==undefined && (e===undefined || r.builtSystemPromptModel===e)` — so **a mid-session model switch invalidates it and both gates are re-read** — and the sticky-branch fallback is **`?? false`, not the gate value** (a session with a `builtSystemPrompt` but unpersisted flags reads them off, regardless of GrowthBook).
- **The three `suggest_skills` states are literal branches** in `oi()`: `Zo()` (gate off — strips the tool **and** rewrites `list_skills`'s description) / `we` (base, live default — **no `trigger` property at all**) / `ti()` (proactive — swaps description to `ei`, injects `trigger: Lr`, `required` stays `[]`). `Lr` is shared with `search_plugins`, where `trigger` is **ungated**.
- **Full version-drift table** — 7 (2.1.64–2.1.87) → 8 (2.1.92) → 10 (2.1.111) → 11 (2.1.121) → 12 (2.1.128, `suggest_skills`) → 13 (2.1.205, `delete_scheduled_task`), with a non-monotonic dip at 2.1.138. **But the corpus shows ZERO within-version splits**, so it *cannot* distinguish version-gating from gate-gating; the emulator doc's version-keyed recommendation is **unvalidated by this evidence** and `suggest_skills` presence is gate-driven. Recorded as an explicit limit rather than smoothed into the table.

**METHODOLOGY (new trap, recorded).** Extracted-asar chunks live under `.vite/build/` — a **dot-directory**, which `rg` skips by default. `rg -g '*.js' <pattern> .` from the extraction root **false-reported both gate ids as absent** mid-verification. Same failure class as the gzip-wrapped-`fcache` trap (Ch35/L124). Always `cd` into `.vite/build` or pass `--hidden`, and run a **positive control** before writing any "absent from artifact X" claim.

State layer: `registry.json` gains **7 tool entries** (`mcp__plugins__*` ×3, `mcp__mcp-registry__*` ×3, `mcp__cowork-onboarding__show_onboarding_role_picker`) + **`gate.2114777685`**; `245679952`/`1598976391`/`mcp__skills__suggest_skills` summaries rewritten with the corrected mechanics; `as_of.fcache_capture` → **2026-07-24** (`as_of.cli` and `desktop_asar` unchanged). `validate-state.js` prints "state layer OK"; `state.js --audit` ends "everything reconciled to baseline".

## v2.31.0 — 2026-07-22 (this fork) — Chapter 38 (L133–L137): CLI content refresh v2.1.198 → v2.1.217

Adds `references/35-verified-new-v2.1.217.md` (Ch38, lessons **133–137**), the standalone-CLI content refresh across the 19-version gap since the v2.1.198 content baseline (Ch27/L110–L113). **This release moves the CLI content baseline from v2.1.198 to v2.1.217.** First-party bundle diff: the v2.1.198 baseline was CDN-recovered from `downloads.claude.ai/claude-code-releases/2.1.198` (manifest commit `b80c4964…`, darwin-arm64 binary sha256-verified `ab6f7ee1…`), 2.1.217 is the live staged agent; full machine diff at `docs/internal/diff-2.1.198-to-2.1.217.txt`. Cross-checked against the official Anthropic CHANGELOG (2.1.199–2.1.217); env-var additions source-verified (**59/69 are real `Z.`/`process.env` reads** — the diff tool's "no process.env read" flag is a known false-positive class that misses the `Z.` proxy).

- **L133 — provider & auth landscape.** `An()` now returns **seven** values: new `anthropicAws`/`anthropicGoogleCloud` (via `CLAUDE_CODE_USE_ANTHROPIC_AWS`/`_GOOGLE_CLOUD`) are the CLI side of **Claude Platform on AWS / Google Cloud** — Anthropic operates the inference stack, the hyperscaler provides IAM, used through the customer's existing cloud account with no separate Anthropic account, distinct from BYOC `bedrock`/`vertex`; plus `gateway`/`foundry`. Carries the `ANTHROPIC_GOOGLE_CLOUD_{BASE_URL,LOCATION,PROJECT,WORKSPACE_ID}` quad, `NO_MODEL_FALLBACK`/`REFUSAL_FALLBACK_CATCH_ALL`, Bedrock cred-chain tuning. Removed: opus-4-7 fast-mode surface, `ANTHROPIC_BEDROCK_MANTLE_API_KEY`, CCR v2.
- **L134 — sub-agent fan-out caps now exist — CORRECTS Ch35/L121's "no fan-out cap" and v2.22.1's "the Desktop caps fan-out nowhere."** Real, enforced, model-visible caps on the Task dispatch path via `taskRegistry`: concurrent default **20** (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, throws *"Concurrent subagent limit reached … Do not retry."*, telemetry `subagent_concurrency_cap`, bypass gate `tengu_amber_kestrel`; landed 2.1.217), total spawns/session default **200** (`MAX_SUBAGENTS_PER_SESSION`, `subagent_count_cap`; 2.1.212), WebSearch **200**/session (2.1.212), and **nesting OFF by default** (`MAX_SUBAGENT_SPAWN_DEPTH` fallback 1; 2.1.217). Reconciliation: Ch35's depth-5 (`NMr`/`BLr`) is now the *ceiling*, the new default is depth 1 — refinement, not contradiction. `DISABLE_EXPLORE_INHERIT_CAP` is a separate Explore-model-inheritance knob. Adjacent dark: `EXPERIMENTAL_OBSERVER_AGENTS`/`_AGENT_TEAMS`.
- **L135 — command surface (+10 / −1, 11 changed; hooks unchanged at 30).** The `/fork`→`/subtask` split (2.1.212): `/fork` redesigned to **copy the conversation into a new background session**, the old in-session subagent moved to new **`/subtask`** ("delegate with full context, result returns here"). New: `artifacts`/`import`/`workshop`/`design-consent`/`design-revoke`/`explain-usage` (per-command `isEnabled` traced). Removed: `cowork-plugin`; `/agents` wizard (2.1.198). **Dark** (in binary, absent from changelog): `/import`, `/artifacts`.
- **L136 — feature surfaces.** Artifacts CLI buildout (`tengu_artifact_{hljs,mermaid,…}`), auto-mode setup wizard, `AGENT_PROXY_{GH_SHIM,GIT_CONFIG}` (same fleet/PR territory as Ch37/L130's VCS SDK events), workflow-size guardrails ("Dynamic workflow size", 2.1.202), `per-turn-control-2026-07-01` = the `per_message_effort` beta (mid-turn `set_model`; betas net +1/−1), org-memory tuning (`DISABLE_ORG_MEMORY`, dark).
- **L137 — retired surface, codename triage & confirmed negatives.** Removed (14): `CLAUDE_CODE_VERIFY_PROMPT` (**reverses Ch21/L90**'s debugging-discipline injection; `/verify`+`/code-review` stopped auto-running at 2.1.215), CCR v2, Design-MCP env, mantle, plan-interview residue. Codename cluster (`ALDER_WICKET`/`AMBER_ASTROLABE`/`WALNUT_SPIRE`/… + 247 new `tengu_*` ids). **Confirmed negatives:** hook event types **30, unchanged** (L111 holds); `EndConversation` tool changelog-confirmed at 2.1.214.

**Meta-view (a dedicated chapter section, per request — the "what is Anthropic doing" read).** Four strategic moves the deltas cohere into: **(1) governance of autonomous parallelism becomes a default** — fan-out caps + nesting-off + `--max-budget-usd` stops, driven by real per-agent cost (community: 10 parallel agents ≈ 10× burn, ~$50–65/dev/day); **(2) enterprise distribution moves into the CLI via hyperscaler-native first-party** — Claude Platform on AWS/GCP + Gateway + Foundry, procured through the customer's own cloud IAM with same-day feature parity, unlike lagging BYOC Bedrock/Vertex; **(3) multi-agent orchestration primitives are differentiated and named** — `/subtask` (foreground delegate) vs `/fork` (background session) vs observer-agents vs teams vs workflows, each a distinct cost/lifecycle profile; **(4) the CLI is becoming the runtime for a supervised cloud fleet** (continues Ch37/L130 — agent-proxy git/PR shims, VCS events, remote/bridge workflow plumbing). Net: a *maturation* pass putting cost/safety rails, enterprise distribution, and orchestration vocabulary around the autonomous-agent capabilities shipped over the prior year. Web-sourced (Claude Platform on AWS docs, InfoQ, DevOps.com, CloudZero, Developers Digest); synthesis/inference flagged as such.

**Files:** `references/35-verified-new-v2.1.217.md` (new, Ch38/L133–L137); `docs/internal/diff-2.1.198-to-2.1.217.txt` (the persisted machine diff, gitignored); state pages `cowork-architecture.md` (the "no fan-out cap" bullet corrected inline for L134 + source 134), `model-landscape.md` (source 133), `command-surface.md` (source 135); **all 8 state pages `as_of_cli` → 2.1.217**; `references/state/registry.json` (**`as_of.cli` 2.1.198 → 2.1.217, a genuine content-refresh re-baseline — all 310 prior entries re-stamped to the new token per the audit's exact-equality convention**; +14 new entries; `env.CLAUDE_CODE_VERIFY_PROMPT` + `env.CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE` flipped to `status:removed`; `as_of.desktop_asar` stays 1.24012.1); `references/topic-index.json` (+5 lessons, total **137**); `references/cross-references.json` (+5 with reciprocal links); `references/troubleshooting.json` (+5 symptoms, total 117); `references/semantic-index.json` (rebuilt, 137 entries); `SKILL.md` (frontmatter version stamp v2.1.198→v2.1.217, Step-2 check-version line, body intro, reference-table row, counts 137/38); `version.json` (2.31.0, **`captured_version` → 2.1.217**, first captured-version bump since Ch27); `plugin.json` (2.31.0, description). `state.js --audit` (everything reconciled to baseline CLI 2.1.217) and `validate-state.js` (state layer OK) both pass clean.

**Scope note:** the 247 new `tengu_*` identifiers and the full per-command `isEnabled` three-gate empirical verification are triaged at the cluster level, not exhaustively resolved (the codename flags in particular are dark-launch latches left for a future pass); this is flagged in the chapter, not silently truncated.

## v2.30.0 — 2026-07-22 (this fork) — Chapter 37 (L129–L132): Skill/plugin discovery tools, VCS SDK events & session containment

Adds `references/34-skill-discovery-vcs-events-containment.md` (Ch37, lessons **129–132**), a multi-artifact first-party investigation: host CLI bundles **2.1.215/2.1.216/2.1.217** (extracted, greppable) + the Desktop-managed host agent Mach-O **2.1.217** + Desktop `app.asar` **1.24012.1** (live) diffed against **1.22209.0** (both extracted with `@electron/asar` v4.2.1) + the live gzip-wrapped GrowthBook `fcache` (2026-07-22 **07:48 boot snapshot**) + an on-disk `audit.jsonl` corpus from **10+ real Cowork sessions, agent 2.1.165–2.1.209**. Prompted by the `claude-cowork-headless-emulator` project's `desktop-1.24012.0-unmodeled-surfaces` doc (the recurring lead-source), then independently re-derived first-party against this installation's own artifacts — and in the process **correcting several of that doc's claims** (corrections relayed back; the exchange also corrected two of this pass's own interim reads, per the report-outcomes-faithfully discipline).

- **L129 — skill/plugin discovery: native agent tools vs Desktop SDK-MCP, and the disk ground truth.** The tools a real Cowork model actually sees for skill/plugin discovery are Desktop's **SDK-MCP** servers (`mcp__skills__list_skills`/`suggest_skills`, `mcp__plugins__*`) delivered over the control protocol — **never** the native `ListSkills`/`SearchSkills`/`SuggestSkills` compiled into the CLI binary. Confirmed against every real session's `system/init` `tools` array across 2.1.165–2.1.209 (SDK-MCP present in all; native CamelCase absent from all). This **inverts** the emulator doc's screenshot-based "model sees native tools" correction — a model self-report of its own tool names is confabulation; the `init` record is authoritative. The `vLt`(2.1.217)/`Vne`(2.1.215) predicate over `CLAUDE_CODE_REMOTE` was reshaped mid-series (necessary at 2.1.215 → sufficient-not-necessary at 2.1.217, fallback via the `ekl={claude-desktop,claude-desktop-3p,local-agent}` entrypoint set + firstParty + `tengu_saddle_lantern`), but it gates only the never-rendered native tools, so it is **moot for the model surface**. `tengu_saddle_lantern` (`pI_`) is a master switch (native-family enable via `fI_` + `SuggestSkills.shouldDefer` + a branching prompt body via `pdd`), default off.
- **L130 — VCS SDK events.** Two new `type:"system"` subtypes `code_change_published` (`izr`, github PR-create URL) and `vcs_state_changed` (`hlo`, commit/push/merge/rebase, strict `kind` enum agent-side) turn git activity into a typed telemetry stream. They **emit from agent 2.1.216** (0 at 2.1.215, 12/12 at 2.1.216/2.1.217 — corrects the emulator's `≥2.1.217` existence tripwire), are **git-operation-driven, not per-run**, and are **ungated agent-side** (`1311049725`/`cliSupportsVcsSdkEvents` are Desktop-only, absent from the CLI); Desktop consumption is separately floored at 2.1.217 (`isPinnedCliAtLeast`), a one-version blind window. They feed `GitHubPrManager.bindPrFromUrl(…,"vcs_sdk_event")`→`git_state_changed`, the per-agent PR-state tracker behind Fleet view. Framing them as merely "a replacement for `gh pr create` scraping" understates them: they are the **git-state observability primitive for the Managed Agents fleet** (`managed-agents-2026-04-01`, 180+ occ + `/v1/environments`), with multi-forge (`provider` gitlab/bitbucket) and more `kind`s scaffolded ahead of support.
- **L131 — Desktop 1.22209.0 → 1.24012.1 asar delta (first-party diff).** Confirms: the `allowedTools` 9-SDK-MCP-tool list is **pre-existing** (present in both builds, not 1.24012.1 drift; and `allowedTools` ≠ the rendered tool list); `getMcpSkillSources` is **dead code** (`0→1`, one definition, zero callers, gate `278625510`, extension `io.modelcontextprotocol/skills` — and the live boot MCP handshake advertises only `io.modelcontextprotocol/ui`, never `…/skills`); bundled skill **`morning` removed** (gate `3214976288` `1→0`; set now `{schedule, setup-cowork}`); `coworkTokens` usage-accounting config key (`0→2`); `harnessCwd` NEW (`0→5`) — a **naming trap** (worktree-move cwd, not a test harness); OAuth-refresh gates `1549258603`(SDK)/`3705360580`(CCD) clear-cache-then-re-resolve. **Correction to the emulator's "dark" label:** the four new gate ids `278625510`/`1311049725`/`1549258603`/`3705360580` are **ABSENT from the live fcache** (unevaluated), which is distinct from evaluated-and-off.
- **L132 — LEAD (unconfirmed): 1.24012.1 may move Cowork session state off the host.** A fresh folder-connected Cowork session under Desktop **1.24012.1 + staged agent 2.1.217** left **no host-side transcript** (both `local-agent-mode-sessions` and `claude-code-sessions` untouched), no host agent process, and its probe string only inside the VM (`main.log` CliGovernor reported 0 local sessions) — unlike the Jul-16 host-loop sessions (agent 2.1.202/209) that wrote host-side `audit.jsonl`. **Unconfirmed** whether this is a host-loop→VM-loop routing flip or a transcript-path change (the fcache host-loop gate `1143815894` is still `true/force` but is a boot snapshot, not a live per-session read; `requireCoworkFullVmSandbox` is not fcache-readable). **Why it matters:** if newer builds keep transcripts in the VM, the host-side disk-recovery path that verified L129 goes dark, and future `init.tools` checks need live `rootfs.img` forensics (Ch31). Ships as a flagged lead, not a confirmed mechanism.

**Strategic framing (folded into L130):** the VCS events are read not as a local convenience but as observability infrastructure for Anthropic's cloud coding-agent direction — Managed Agents (launched 2026-04-08: sandboxed execution, checkpointing, end-to-end tracing) + self-hosted sandboxes (remote executor, central orchestrator). Three intent layers (fleet observability → PR-as-unit-of-work / "Outcomes" success model → event-driven agent handoffs) and three binary roadmap signals (multi-forge scaffolded ahead of support, a deliberately-growable `kind` vocabulary, staged emit-vs-consumption rollout), with explicit confidence tiering (layer 1 + roadmap signals first-party; Managed-Agents linkage inferred from the beta-string match + public capability descriptions; layer 3 directional). Web-sourced from InfoQ, Help Net Security, Cloudflare, Coder, Fleet.

**Files:** `references/34-skill-discovery-vcs-events-containment.md` (new, Ch37/L129–L132); state pages `plugins-skills-hooks.md` (skill-discovery-tools + bundled/MCP-contributed-skills sections), `cowork-control-protocol.md` (VCS-events + SDK-MCP-skill-servers section), `cowork-architecture.md` (session-containment lead) — all three bump `as_of_desktop` → 1.24012.1 and `updated` → 2026-07-22; `references/state/registry.json` (13 new entries — `tool.ListSkills`/`tool.SuggestSkills`/`tool.mcp__skills__list_skills`/`tool.mcp__skills__suggest_skills`, `proto.code_change_published`/`proto.vcs_state_changed`, gates `245679952`/`1598976391`/`278625510`/`1311049725`/`1549258603`/`3705360580`/`3214976288`(removed); `as_of` on all pinned to the CLI baseline `2.1.198` per the registry's audit convention; `as_of.desktop_asar` → 1.24012.1, `fcache_capture` → 2026-07-22, `agent_elf_parity_check` → 2.1.217, `as_of.cli` **unchanged at 2.1.198** — no full CLI content refresh this pass); `references/topic-index.json` (+4 lessons, total **132**, +keyword routes); `references/cross-references.json` (+4 entries with reciprocal links); `references/troubleshooting.json` (+4 symptom entries, total 112); `references/semantic-index.json` (rebuilt, 132 entries); `SKILL.md` (frontmatter description, body intro, reference-table row, counts 132/37); `version.json` (2.30.0, counts, narrative); `plugin.json` (2.30.0, description). `state.js --audit` (everything reconciled to baseline) and `validate-state.js` (state layer OK) both pass clean.

**Scope boundaries, recorded deliberately:** the CLI content baseline stays **v2.1.198** — this pass verified specific CLI facts at 2.1.215/216/217 but did **not** re-baseline all CLI content; the 19-version gap (v2.1.198 → 2.1.217) is deferred to a **separate future chapter (Ch38)**, not folded here (mixing a mechanism deep-dive with a version-refresh has historically made chapters sprawl). L131 was promoted from relayed to first-party by running the asar diff; L132 remains an explicitly flagged lead.

## v2.29.0 — 2026-07-17 (this fork) — Chapter 36 (L125–L128): Desktop device automation, the `grand_prix` partner bridge & permission tuning

Adds `references/33-desktop-device-partner-permission-tuning.md` (Ch36, lessons **125–128**), a first-party binary diff of Claude.app (Desktop) `app.asar` **1.21459.0 → 1.22209.0** (two full asar extractions via `@electron/asar`, file-tree diff + targeted `rg` sweeps over the affected chunks). **No live GrowthBook fcache was captured for this pass** — every gate on/off claim in the new chapter is limited to what the code itself encodes (a literal `default:false`, an `.optional()` schema with no `default:` key), never a fresh production decode; this is a deliberate scope boundary, not an oversight, and is called out explicitly in the chapter, the state pages, and the registry entries it touches. Investigation was delegated to a Fable-5 subagent working against two locally cached asars; findings are relayed as reported by that pass, not independently re-verified line-by-line here.

- **L125 — mobile simulator tool surfaces.** Desktop 1.22209.0 ships two real, fully-specified device-automation MCP tools — `claude_code_ios_simulator` and `claude_code_android_emulator`, each exposing a single `control` tool driving `xcodebuild`/`simctl`/`adb` (verbatim action enums, parameter schemas, and descriptions documented in full) — but they are **structurally impossible for any Cowork agent to receive**: gated first on `sessionType==="ccd"` (a Claude Code Desktop *coding* session, never `"cowork"`/`"cowork-remote"`), then a per-platform GrowthBook gate defaulting `false` (`3577536076` iOS, `1403324732` Android), then org policy `disableMobileSimulatorTools`, then a user app preference. A new Seatbelt sandbox (`claude-ios-sim.sb`, env `CLAUDE_SIM_SANDBOX`) wraps the iOS sidecar.
- **L126 — `remote_devices`: the Cowork-facing device bridge.** Shares a tool-group registry slot with the mobile simulators (12→15 entries; the registry is only a name-collision guard, not an enablement path) but is a different mechanism pointed the opposite direction: a bridge from Cowork to a real, paired remote device via `computer_resolve_access`/`computer_request_access`/`computer_release_lock`/`computer_*` tools, backed by a device-registry endpoint (`GET /api/organizations/{org}/cowork/remote_devices`) with per-device enclave keys. Its own `isEnabled` gating was **not traced** this pass — live reachability is explicitly left unconfirmed, unlike the simulators' proven structural exclusion.
- **L127 — `grand_prix`: the credential/browser-autofill partner bridge.** A signed, single hardcoded HMAC-verified trusted partner (registry keyed on a stable partner id) can inject host tools and system-prompt appends, and service tab-origin-scoped login/address/payment-card autofill requests (`grand_prix_credential_request_outcome` telemetry carries `has_login`/`has_address`/`has_card`). Built out substantially in this release — from a bare skeleton in 1.21459.0 (`buildGrandPrixHostTools`, one `grandPrixRequest`) to a full `list/fill/release/code` role set, a CCR bridge variant, and a remote variant wired into `remote_devices` (L126). This is the **fourth** Desktop credential channel, alongside elicitation, `claude_desktop_config.json` host-spawned MCP servers, and the `clis.*.env` CLI-plugin broker (Ch23/L106) — but not an extensibility point: a skill or third-party integration cannot register itself as a `grand_prix` partner.
- **L128 — auto-mode tuning, scheduled-task approval, OTLP tracing & hardening.** Three new gate ids extend auto-mode in opposite directions at once: `4200321681` (`coworkAutoModeAlwaysAllowOverride`, backing the advertised `tool_approval_default_always_allow` capability) is the **inverse** of its name for destructive connector/MCP tools — it forces a re-prompt rather than a silent allow, and a sibling guard blocks "always allow" from ever persisting for them; `1447478638` lets scheduled-task tools auto-approve under auto mode; `1076115445` auto-resumes sleeping sessions. Alongside: protected-folder-grant hardening (new refusal + telemetry for managed paths and a shell-dotfile set: `.zshrc .zshenv .zprofile .zlogin .bashrc .bash_profile .bash_login .profile .netrc`), mandatory DXT extension signing (RSASSA-PKCS1-v1_5-SHA512, replacing the old unsigned interactive MCPB flow), and a new managed setting `otlpTracesEnabled` — `.optional()` with no `default:` key (so `undefined`, not `false`, until set) driving `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`/`OTEL_TRACES_EXPORTER` — **default OFF**, `@next`/3p-managed-scoped.

**Files:** `references/33-desktop-device-partner-permission-tuning.md` (new, Ch36/L125–L128); state pages `cowork-architecture.md` (new "Device automation surfaces" section), `cowork-permissions.md` (new "Auto-mode tuning" section, explicitly flagged as no-live-fcache), `credential-channels.md` (fourth channel row + `grand_prix` section, "three" → "four" channels); `references/state/registry.json` (`as_of.desktop_asar` → 1.22209.0; new `tool.claude_code_ios_simulator`/`tool.claude_code_android_emulator` entries, `as_of` pinned to the CLI baseline `2.1.198` per the registry's audit convention, `first_seen` pinned to `1.22209.0`); `references/topic-index.json` (+4 lessons, total 128, +51 keyword routes); `references/cross-references.json` (+10 entries incl. reciprocal back-links on 106/108/117/118/121); `references/troubleshooting.json` (+4 symptom entries, total 108); `references/semantic-index.json` (rebuilt, 128 entries, 2009 vocab terms); `SKILL.md` (frontmatter description, body intro, reference-table row, counts 128/36); `version.json` (2.29.0, counts, narrative); `plugin.json` (2.29.0, description); root `CLAUDE.md` (header narrative, binary chain, lesson/chapter counts, repo-structure tree row). `state.js --audit` and `validate-state.js` both pass clean; `search.js`/`fetch-lesson.js`/`xref.js`/`troubleshoot.js`/`state.js` all smoke-tested against the new lessons.

**Scope boundaries, recorded deliberately:** this release captures a Desktop `app.asar` code diff only — no live GrowthBook fcache decode, no in-VM ELF capture, no fresh production audit corpus. `registry.as_of.cli`/`in_vm_elf`/`fcache_capture`/`agent_elf_parity_check` are unchanged; only `desktop_asar` moves. Three new permission-tuning gate ids (`4200321681`, `1447478638`, `1076115445`) and the two new managed-setting flatKeys are documented in the chapter and state pages with their code-level logic/defaults, but were **deliberately not added to `registry.json`** as `gate`-kind entries — the registry's `gate` kind semantics require a decoded fcache on/off read (see `state/README.md`), which this pass does not have; adding them would have overclaimed. `remote_devices` (L126) similarly received no `tool`-kind registry entry, since its own enablement gating was not traced. A future chapter that captures a live fcache against 1.22209.0 or later should backfill these.

## v2.28.1 — 2026-07-15 (this fork) — Ch22/L105 addendum: the no-callback webview boundary generalizes beyond MCP Apps

Adds a short addendum to `references/19-desktop-mcp-apps-elicitation.md` (Ch22, lesson 105), not a new binary capture.

- A plain rendered HTML artifact with a submit/save action shows the same boundary as L105's MCP-App finding: it can work under Claude Code (a local HTTP server backs a `fetch()` call) yet silently fail under Cowork/claude.ai, which renders the artifact with no local server, so a client-side file download never reaches the agent even though the UI shows a "saved" confirmation. The working pattern is a copyable textarea the human pastes back into chat.
- This generalizes L105's binary-derived finding (Desktop `app.asar` 1.9659.4: an MCP-App UI has no `tools/call` channel, only `sendPrompt`→`ui/message` into chat): the no-local-server / no-callback property is a general property of Cowork/claude.ai's artifact rendering, not unique to the MCP-Apps bridge dialect specifically.
- Marked in the addendum as field-observed for this specific case, not binary-verified, consistent with this skill's provenance discipline.

**Files:** `references/19-desktop-mcp-apps-elicitation.md` (new addendum section); `SKILL.md` (description, one sentence); `version.json` (skill_version 2.28.1, description, one sentence); `plugin.json` (version 2.28.1, description, one sentence). No state-layer changes — nothing about current binary/gate state changed, so `references/state/` and its registry are untouched.

## v2.28.0 — 2026-07-11 (this fork) — Chapter 35 (L121–L124): the Cowork sub-agent (Task tool) execution model — tool composition, the type-less fallback trap, the outputs-cwd crux, the `subagent_env_hl`/`vm` prompt append, and the fcache-gzip methodology correction

Adds `references/32-cowork-subagent-execution-model.md` (Ch35, lessons **121–124**), the definitive first-party spec of what a Task-dispatched sub-agent can and cannot do in Cowork — verified against Desktop `app.asar` **1.20186.1** + the **Desktop-managed host agent Mach-O 2.1.205** (`~/Library/Application Support/Claude/claude-code/2.1.205/claude.app/Contents/MacOS/claude` — a **new artifact class** for this skill, distinct from both the standalone CLI and the in-VM ELF, extending Ch31/L117's artifact-class methodology) + in-VM ELF **claude-code-vm/2.1.205** (same version as the host agent this capture — clean host/VM comparison) + the live GrowthBook fcache (2026-07-11, 207 gates) + a **production audit corpus** (every `local-agent-mode-sessions` `audit.jsonl` on the capturing machine — 509 real `Agent`/`Task` dispatches parsed in full). Prompted by two briefs from the `founder-skills` project and produced through a **six-round mutual-correction cross-review** with the independent `claude-cowork-headless-emulator` project's same-day dossier — corrections flowed both directions, and two of this pass's own interim claims were caught and withdrawn along the way (a claimed gate-`434204418` "polarity change" that our own v2.23.0 reference already disproved, and an overcorrected "no production fallback sighting" that a full-corpus parse then reversed).

- **L121 — tool composition.** A sub-agent's tools are **recomputed per dispatch** (`GY` six-step rule): the frontmatter `tools:` list is authoritative, but only over a universe already narrowed by the session's deny rules (`--tools` complement + `--disallowedTools`) and a base sub-agent filter (`rly`: TaskOutput/EnterPlanMode/AskUserQuestion/Workflow/etc. never available; MCP tools exempt from the base/async filters **but must be NAMED** — exact or `mcp__server`/`mcp__server__*` — to survive an explicit list); `disallowedTools` beats an explicit `tools:` list (the frontmatter zod doc claiming otherwise is a doc bug); unbindable names are **silently dropped** (`invalidTools`/`unavailableTools` have zero consumers). **The type-less fallback trap**: a dispatch omitting `subagent_type` resolves to built-in `general-purpose` with `tools:["*"]` (`let Pe=t??G5e.agentType`) — full wildcard including `mcp__workspace__bash` in host-loop — and this **fires routinely in production**: 113/509 dispatches across 39 sessions in the audit corpus. **Plugin-shipped agents get `permissionMode`/`hooks`/`mcpServers` DISCARDED** with a warning ("ignored for plugin agents. Use .claude/agents/ for this level of control") — the frontmatter-`mcpServers` extra-tool channel is `.claude/agents/`-only. Depth cap **5** (`NMr` host / `BLr` VM, hard throw); **no Task fan-out cap anywhere** — the only bound is the generic `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` scheduler window (default 10, queues never refuses); `workflowSize {5,15,50}` is prompt guidance only. `toolAliases {Bash→mcp__workspace__bash, WebFetch→mcp__workspace__web_fetch}` is now a **first-class single-hop SDK option** (resolver `rc()`; deny rules deliberately don't expand across the alias; an alias does not grant a tool); `WORKSPACE_ALLOWED_TOOLS` pre-approves bash only.
- **L122 — file-tool namespace.** Sub-agents are **in-process** async generators (AsyncLocalStorage identity, zero per-sub-agent env); **cwd IS the session outputs directory** (`local-agent-mode-sessions/<acc>/<org>/local_<id>/outputs`) and the Task input schema strips `cwd` — so the canonical sub-agent write is **cwd-relative** (`artifacts/x.md`, the form real production dispatches use), while `/sessions/...` is **always denied, never translated** for file tools of any origin (the `K6-cmJAJ` VM↔host translation index rewrites outbound messages/URIs only). The path-containment hook — re-anchored at 1.20186.1 in `configureHostLoopExecution` (unminified export = stable anchor) with its `xe()` VM-path deny, `qt()` three-category read-only guard (uploads-hardlink / spooled-projects / plugin-content), and conditional canUseTool chain (`Se&&`) — **provably fires inside sub-agents** (the hook-input zod schema documents `agent_id` as "Present only when the hook fires from within a subagent"). Delete stays mount-mode (`rw`→`rwd` via `fileDeleteApprovedMounts`, recomputed per bash call, bridge sessions never `rwd`); VM bash cwd = **first-connected-folder-else-outputs** (`to()`, `h??(h=a)`); `${CLAUDE_PLUGIN_ROOT}` is **pre-resolved into definition text at load** (`PEe`) — file tools never expand the literal token, and the env var never reaches the Bash-tool subprocess env.
- **L123 — the sub-agent prompt append.** Verbatim `subagent_env_hl`/`subagent_env_vm` branch texts (generator `zo`/`buildSubagentEnvironmentPrompt`), selected purely by the session's `hostLoopMode`, delivered via `initialize.appendSubagentSystemPrompt` — but consumption requires **both** the option and `CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT` in the process env: the `YRp` self-set fires **only** on the hidden `--append-subagent-system-prompt` CLI-flag path, never on the initialize path, so an SDK host that sends the option without the env var gets silence (the Desktop sets it unconditionally — required, not belt-and-suspenders). GrowthBook `124685897` gates **only** the server-side ("starling") `spSectionPrompts` text override — OFF live, so the hardcoded texts ship. Fork/`useExactTools` dispatches are excluded (`!E` guard); nested sub-agents inherit the append.
- **L124 — env/model, lifecycle, VM-loop, stream, methodology.** Model chain: `CLAUDE_CODE_SUBAGENT_MODEL` (availableModels-allowlist check; bad value → warn + inherit, **no fall-through**) → Task `model` param → frontmatter → inherit; the Desktop injects the env var only when server-side **YukonSilverConfig**.`defaultSubagentModel` ≠ `"inherit"`; **forks force-inherit** (`model:B?void 0:m`). ToolSearch: unset → mode `tst` = **ON first-party** (`auto`/`auto:N` = 10%-of-context deferral threshold; `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`/HIPAA force mode `"standard"` = **disabled** — naming trap; gate `1129419822` absent from both the live fcache and the agent binary). Ch29/L115 re-verified with two refinements: `run_in_background` **polarity flipped** (background-by-default; the disable var strips the param and turns the CLI SendMessage-resume branch into an awaitCompletion mode-switch), and agent-type sessions gain `mcp__dispatch__send_message` (+ `dispatchAgentNameEnabled`-gated `SET_AGENT_NAME`) — a Desktop-mediated **cross-SESSION** continuation, not sub-agent resume; Cowork still severs sub-agent resume at spawn. Host-loop decision `Pm()` is **resume-sticky** (consulted only at fresh start; an org enabling `requireCoworkFullVmSandbox` mid-lifetime makes resuming a host-loop session throw); `CLAUDE_FORCE_HOST_LOOP` is **dead on stock installs** (now requires `isDeveloperApprovedDevUrlOverrideEnabled`); **custom-3p deployments hardcode-ON** a gate table `uOt` including `1143815894` and `2307090146` — **amending Ch23/L106: the cli_plugin credential broker is LIVE in custom-3p deployments** while still dark on consumer GrowthBook. VM-loop deltas: literal `Bash` binds, no path hook, but WebFetch is aliased in **both** loops (`coworkWebFetchViaApi` live true) — **Bash is the only tool that truly diverges**. Stream observability beyond Ch32/L118: `task_started` carries the **resolved** `subagent_type` (+ emitter family `task_progress`/`task_updated`/`task_notification`/`background_tasks_changed`/`thinking_tokens`); the paired user message's `toolUseResult` envelope carries `[agentId, agentType, content, prompt, resolvedModel, status, toolStats, ...]` (resolved child model wire-observable post-hoc); `permission_denied` carries a schema-documented sub-agent `agent_id` but fires **only for pre-ask denials** (`decideLocation==="pre-ask"`, verified in both agent bundles) — never for PreToolUse-hook denials, so the path-gate never emits it.
- **METHODOLOGY (two corrections).** (a) **The fcache is now gzip-wrapped**: `CLF\x01\x00` + 3 bytes + gzip at byte 8; decode with `tail -c +9 fcache | gunzip`. Raw grep/strings — the technique used for every capture through v2.26.0 — **false-reports gates as absent**. (b) Proving an input field ABSENT requires **full JSON parsing** of every tool_use input, never prefix/substring windows — and resolved-type sightings (`task_started.subagent_type`, per-message `subagent_type`) can never distinguish an explicit `general-purpose` dispatch from the type-less fallback; only the dispatch `input` can.

**Files:** `references/32-cowork-subagent-execution-model.md` (new, Ch35/L121–L124); extension/correction blockquotes in `references/20-desktop-cli-plugin-credential-broker.md` (custom-3p `uOt`), `references/21-cowork-control-protocol.md` (toolAliases + symbol renames, 9-name force-ask set, initialize fields, `Pm()`/resume stickiness), `references/22-cowork-env-gates-protocol.md` (fcache format change, gate states at this capture, new spawn-env vars), `references/26-subagent-resume-semantics.md` (polarity flip, awaitCompletion switch, `mcp__dispatch__send_message`), `references/29-skill-scope-stream-contract.md` (the three sibling wire channels); `references/state/registry.json` (`as_of.desktop_asar`→1.20186.1; new `env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`/`gate.124685897`/`proto.permission_denied`; extended `env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT`/`env.CLAUDE_CODE_SUBAGENT_MODEL`/`env.ENABLE_TOOL_SEARCH`/`gate.2307090146`/`gate.1143815894`/`gate.434204418`/`gate.1129419822`/`proto.task_started`/`tool.Task`); state pages `cowork-architecture.md` (new sub-agent execution section, host-loop gate update), `cowork-control-protocol.md` (sub-agent dispatch wire contract, fcache decode), `cowork-permissions.md` (path-hook re-anchor, `WORKSPACE_ALLOWED_TOOLS`), `plugins-skills-hooks.md` (plugin-agent frontmatter restrictions, `${CLAUDE_PLUGIN_ROOT}` non-expansion); `references/topic-index.json` (+4 lessons, +51 keyword routes, total 124); `references/cross-references.json` (+4 entries, reciprocal back-links on 89/106/107/108/115/118); `references/troubleshooting.json` (+4 symptom entries, total 104); `references/semantic-index.json` (rebuilt, 124 entries); `SKILL.md` (frontmatter description, body intro incl. a backfilled L120 narrative sentence, reference-table row, counts 124/35, artifact list); `version.json` (2.28.0, counts, narrative); `plugin.json` (2.28.0, description); root `CLAUDE.md` (header narrative backfilled 2.26→2.28 — it had been stale at 2.25.0 — plus tree rows for the 30/31/32 reference files). `state.js --audit` and `validate-state.js` both pass clean.

**Scope exclusions, recorded deliberately:** the standalone-CLI content refresh (2.1.198→2.1.207 diff) is NOT in this release — this chapter's agent-side facts cite the Desktop-bundled 2.1.205 artifacts; `captured_version` stays 2.1.198. Evidence dossier and authoring plan: `docs/internal/cowork-subagent-execution-model-2026-07-11.md`, `docs/internal/plan-v2.28.0-cowork-subagent-chapter.md` (both gitignored-or-internal working docs).

Methodology note: this chapter is the strongest case yet for the adversarial cross-review pattern — neither project's first draft was fully right, the errors were on different axes (evidence selection vs scope precision vs mechanism framing), and both of this pass's own interim errors were caught by re-checking against our own earlier captures and by exhaustive parsing rather than sampling. The two reusable lessons are pinned in L124: decode the fcache before trusting gate-absence claims, and never assert field-absence from a substring window.

## v2.27.0 — 2026-07-08 (this fork) — Chapter 34 (L120): Desktop reasoning config — effort & extended thinking fidelity, correcting the `CLAUDE_CODE_EFFORT_LEVEL` backing-store claim

Adds `references/31-desktop-reasoning-config-effort-thinking.md` (Ch34, lesson 120), a first-party binary trace against Claude Desktop `app.asar` **1.19367.0** (the same build already baselined for Ch33/L119 — no new capture needed). Prompted by the independent `claude-cowork-headless-emulator` project's `docs/internal/2026-07-08-reasoning-config-fidelity-plan.md` — a **not-yet-implemented plan document** proposing to make that project's own harness faithfully mirror Cowork's two reasoning knobs — every load-bearing binary claim in its §1 was independently re-derived first-party against this installation's own `app.asar` before being folded in.

- **Extended thinking is a strict boolean.** `maxThinkingTokens = zgi(extendedThinkingEnabled, extendedThinkingOverride, killSwitch)` resolves to **exactly `31999` or `0`, never an arbitrary budget** (`NX=31999`; `killSwitch` = a local settings object's `maxThinkingTokens===0` field, an exact-zero test only). Delivered exclusively as `--max-thinking-tokens <N>` / `--thinking disabled` CLI flags — `MAX_THINKING_TOKENS` never appears as a spawn-env assignment anywhere in the bundle (its 3 occurrences are a settings-constant export, an SDK option-name allowlist entry, and an env-name masking-list string). A live-session toggle (`LocalAgentModeSessions.setExtendedThinking`) calls `query.setMaxThinkingTokens(enabled?31999:0)`, confirming the first concrete payload for the already-named `set_max_thinking_tokens` control-protocol subtype.
- **Effort is a per-model enum with FOUR model-config classes**, confirmed verbatim in the `s1r` map + `o1r`/`i1r` regex-default pair: literal picker models (`opus-4-8`/`4-7`/`4-6`, `sonnet-4-6`), no-picker models (`haiku-4-5`/`sonnet-4-5` — still emit `--effort medium`), a `fable`/`mythos` regex-default class (`disallowThinkingDisabled:true` — "Off" isn't offered for their thinking picker), and unknown models (no config at all). Resolution: `effort = qgi(effortOverride, A1e(model), E2t())`, where both `A1e` (per-model override) and `E2t` (flat default, falling back to a hardcoded `"medium"` string, validated against `BGr={low,medium,high,max}` — notably **excluding `xhigh`** from this particular fallback set) read exclusively from a **local settings-file object** (`Fl()`, fields `effort`/`effortByModel`) — `recommended` never enters spawn resolution at all (UI-only).
- **Further corrects Ch28/L114**: that chapter's claim that the Desktop's effort IPC family is "backed by `CLAUDE_CODE_EFFORT_LEVEL`" doesn't survive a full spawn-path trace. Two distinct `getDefaultEffort()` implementations coexist in the bundle — a thin IPC passthrough and a separate env-var reader that genuinely reads `CLAUDE_CODE_EFFORT_LEVEL` — but the value that actually reaches `--effort <level>` at spawn resolves exclusively from the settings-file object above, **never** touching `CLAUDE_CODE_EFFORT_LEVEL` or `process.env`. The IPC family name and existence documented in L114 are still accurate; only the "backed by that env var" causal link is wrong. Interface naming confirmed correct: `LocalSessions.{getEffort,getDefaultEffort,setFastMode}`, with `setEffort` uniquely dual-wired onto both `LocalSessions` and `LocalAgentModeSessions`.
- **`setEffort`'s live-session branch confirmed calling `applyFlagSettings({effortLevel})`** — the first concrete payload shape for the previously name-only `apply_flag_settings` control-protocol subtype (named without a payload since Ch26/L109).
- **Relayed, not independently re-verified here**: the source plan's own live-spawn-log analysis (the project owner's real `~/Library/Logs/Claude/` history across 1290+ real sessions) empirically confirms the default emitted effort is a flat `"medium"`, never the per-model `recommended` value — using `sonnet-4-6` as the disambiguator (`recommended:"low"`, yet 65/65 real spawns showed `medium`) and noting `setEffort` was only ever called to *raise* the level across that history. This is corroborating evidence for, not independent confirmation of, the static fallback logic above.

**Files:** `references/31-desktop-reasoning-config-effort-thinking.md` (new, Ch34/L120); `references/25-verified-new-v1.18286.0-desktop.md` (Part C gets an inline further-correction blockquote pointing to L120, cross-refs updated); `references/state/registry.json` (new `ipc.LocalSessions_reasoningConfig` entry); `references/state/cowork-control-protocol.md` (spawn-argv section extended with the full effort/thinking resolution mechanism, `sources`+120); `references/topic-index.json` (+lesson 120, +47 keywords, keyword_map routes, total 120); `references/cross-references.json` (+entry 120, reciprocal back-link on 114); `references/troubleshooting.json` (+1 symptom entry); `references/semantic-index.json` (rebuilt, 120 entries); `SKILL.md` (frontmatter description, reference table row + new row, lesson/chapter counts 120/34, L114 row correction note); `version.json` (skill_version 2.27.0, lessons/chapters counts, narrative note); `plugin.json` (version 2.27.0, description narrative). `state.js --audit` and `validate-state.js` both pass clean.

Methodology note: the source document is itself a **plan, not an implementation** — its binary claims stand independent of whether its proposed harness changes ever ship, so verifying them first-party was worthwhile regardless of that project's own next steps. Its live-log analysis (Part E of the new chapter) is a different kind of evidence than a static grep — real historical spawn behavior — and is credited as relayed corroboration rather than re-labeled as this project's own first-party finding, consistent with this skill's standing provenance discipline.

## v2.26.0 — 2026-07-08 (this fork) — Chapter 33 (L119): Desktop cloud tasks — teleport-to-cloud, bridge-session workers, and the `CLAUDE_CODE_ENVIRONMENT_KIND=bridge` link

Adds `references/30-desktop-cloud-tasks-teleport-bridge.md` (Ch33, lesson 119), a first-party binary pass against Claude Desktop `app.asar` **1.19367.0** (the build the investigation's trigger self-updated to) diffed against a **1.18286.2** baseline (one point release ahead of this skill's prior 1.18286.0 pin) + the agent ELF **2.1.202** (parity/negative-result checks). Prompted by the independent `claude-cowork-headless-emulator` project's `docs/internal/2026-07-08-desktop-1.19367.0-cloud-tasks-analysis.md`, which flagged a possible new "cloud tasks" feature and left two questions (bridge call ordering, the `work_type` payload schema) as not statically resolvable — every claim in that doc was independently re-derived first-party before being folded in, per this project's standing discipline, and one framing ("migrated to a typed SDK") is corrected here.

- **Headline, confirmed first-party: cloud tasks are not new.** IPC surface diff between the two Desktop builds: **zero interfaces added/removed**, `claude.web_$_<Interface>_$_<method>` count 596→610 (**+14/-0 methods**), and every added method is unrelated to cloud tasks (remote-dev-target/WSL, a document-preview funnel, preview-window chrome). Every cloud-task primitive (`teleportToCloud`, `getTeleportReadiness`, the bridge-session worker family, the full 95-method `LocalAgentModeSessions` interface with **zero diff**, the `ccr-byoc-2025-07-29` beta) already existed byte-similarly in the 1.18286.2 baseline.
- **The one genuine code delta**: 1.19367.0 newly vendors (bundles-and-makes-reachable) the official `@anthropic-ai/sdk`'s `WorkPoller`/`EnvironmentWorker` helper classes (`helper:"environments-work-poller"`, beta `managed-agents-2026-04-01`) — but **no app-level call site instantiates them**. The Desktop's actual production bridge-worker pipeline (`pollForWork`/`handleWork`/`handleSessionWork`) is unchanged hand-rolled REST, present byte-similarly in both builds. A sharper claim than the external doc's "migrated to a typed SDK": a dependency-bundling delta, not a runtime migration.
- **`teleportToCloud(sessionId, environmentId)` confirmed**, with three corrections to the external doc: **three** progress events, not two (`pushing_branch`/`generating_summary`/`creating_session`); the remote-session-rejection check lives in `getTeleportReadiness`, not inline (and is the one place NEW differs from OLD — a broader `remoteTarget` check replacing an `sshConfig`-only check); the returned `url` is an **absolute** `https://claude.ai/code/<id>`, not a bare path.
- **The chapter's central finding, closing a gap this skill has carried since Ch25/L108**: `CLAUDE_CODE_ENVIRONMENT_KIND=bridge` **is** the bridge-session worker mechanism. Confirmed the **agent CLI binary itself** carries a full `poll`/`ack`/`stop` client against `GET|POST /v1/environments/{id}/work/...` (log-prefix `[bridge:api]`) — this is `claude remote-control`. That worker **sets the env var itself**, at the point it spawns a child CLI process to run a claimed `"session"`-type work item (`CLAUDE_CODE_ENVIRONMENT_KIND:"bridge"` in the child's spawn env, alongside `CLAUDE_CODE_SESSION_ACCESS_TOKEN` and a `bridge-<slug>` worktree). **The Desktop never assigns this value anywhere** (confirmed: 0 spawn-env assignments in either build; the sole Desktop-side hit is a vendored env-schema *type declaration*, not an assignment). The classifier-summary surface map (Ch25/L108) ORs two independent signals into the `"bridge"` surface — the env var (above) **or** `replBridgeActive`, a live in-process flag toggled by the SDK-adapter bridge transport's connection state — which is how a **Desktop-hosted** bridge session reaches the identical surface without ever receiving the env var. `byoc`/`anthropic_cloud` are sibling environment-*provider* kinds of the same environments API, feeding the pre-existing `ccr` surface, not `bridge`.
- **Gate `583857784`** (Ch25/L108, "bridge-SDK-adapter transport") re-confirmed as the identical bridge-session concept under fresh 1.19367.0 minified symbol names, call chain traced to `handleSessionWork`/`connectSessionTransport`. **Gate `1978029737`** gains a previously-undocumented key, `sessionsBridgePollIntervalMs` (alongside the already-known `sessionsBridgePollBlockMs`).
- **Two items honestly reported unresolved, not assumed**: no `heartbeat` request/response pair was located inside the `/v1/environments/{id}/work` family specifically (a separate, pre-existing `POST /worker/heartbeat` endpoint exists in the agent ELF, relationship to this call chain unconfirmed); no fully enumerable `work_type` schema was found (only a two-value `session`/`healthcheck` dispatcher `switch` with graceful unknown-value handling).

**Files:** `references/30-desktop-cloud-tasks-teleport-bridge.md` (new, Ch33/L119); `references/state/registry.json` (`as_of.desktop_asar`→1.19367.0, extends `env.CLAUDE_CODE_ENVIRONMENT_KIND`/`gate.583857784`/`gate.1978029737`, adds `beta.ccr-byoc-2025-07-29`/`ipc.LocalAgentModeSessions`/`ipc.LocalSessions_cloudTeleport`); `references/state/cowork-control-protocol.md` (new "Cloud tasks" section, `as_of_desktop`→1.19367.0, `sources`+119); `references/state/cowork-architecture.md` (re-verification pointer section, `as_of_desktop`→1.19367.0, `sources`+119); `references/topic-index.json` (+lesson 119, +60 keywords, keyword_map routes, total 119); `references/cross-references.json` (+entry 119, reciprocal back-link on 108); `references/semantic-index.json` (rebuilt, 119 entries); `SKILL.md` (frontmatter description, body intro, reference table row, lesson/chapter counts 119/33); `version.json` (skill_version 2.26.0, lessons/chapters counts, narrative note); `plugin.json` (version 2.26.0, description narrative — also notes a pre-existing gap: this field's history had not been synced for v2.24.0/v2.25.0 before this pass; not backfilled here, out of this chapter's scope). `state.js --audit` and `validate-state.js` both pass clean.

Methodology note: the external doc explicitly flagged two questions as "not statically resolvable" — re-attempting them with a wider grep net (chasing the production dispatcher's own `switch` statement instead of only the vendored SDK class) resolved the call-ordering question for the live code path, and partially resolved the schema question (a de facto two-value enum, not a formal schema). Not every "unresolvable" claim from an external source should be accepted at face value — but neither should a genuine negative result be forced into a confirmation; this chapter reports one of each.

## v2.25.0 — 2026-07-07 (this fork) — Ch17/L89 + Ch21/L107 correction: `${CLAUDE_PLUGIN_ROOT}` resolves per execution mode (host-loop vs VM-loop)

Static re-verification against `app.asar` **1.18286.0** + in-VM ELF `claude-code-vm/2.1.197` + host CLI `2.1.201`, prompted by a user question ("`CLAUDE_PLUGIN_ROOT` in Claude Code vs Cowork"), validated first by a Fable sub-agent against the reference docs and then by a static binary probe across all three artifacts. Closes the VM-loop gap the L89/v2.12.1 pass left open and corrects an overbroad claim.

- **CORRECTION — "resolves host-side EVERYWHERE" is host-loop-only.** The token resolves to whatever `--plugin-dir` the agent was spawned with (`CLAUDE_PLUGIN_ROOT: t.path`). The Desktop picks that dir in a single branch, `Ei = isHostLoopModeEnabled ? qX(installPath) : sdkPath`:
  - **host-loop (production):** `qX(installPath)` → the host staging path `claude-hostloop-plugins/<hash>` — accepted by host file tools, useless to in-VM bash (`mcp__workspace__bash`), which must use the VM mount instead.
  - **VM-loop (`requireCoworkFullVmSandbox` orgs, whole agent in-VM):** `sdkPath` → the in-VM mount `/sessions/<id>/mnt/.local-plugins/…` (marketplace/local) or `.remote-plugins/plugin_<id>/…` (org-remote), so `bash ${CLAUDE_PLUGIN_ROOT}/x.sh` **works** there.
  - **Decisive negative:** the string `claude-hostloop-plugins` is **absent from both agent binaries** (host CLI 2.1.201, in-VM ELF 2.1.197) and present only in `app.asar` — staging is a pure Desktop-driver concern, so an in-VM agent structurally cannot resolve the token to a host path.
- **NEW — host-loop staging is space-triggered.** `qX` opens with `if (!installPath.includes(" ")) return installPath` — the `<hash>` symlink exists *only* to launder install paths **containing spaces** past an unquoted `${CLAUDE_PLUGIN_ROOT}` in a hook command. A space-free install path resolves to the **real host install path** even under host-loop (Desktop plugins live under `~/Library/Application Support/…`, which has a space, so the hash path is what you normally see).
- **NEW — the resolved value is deterministic and stable.** The staged dir is `sha256(installPath).slice(0,16)` under `os.tmpdir()` — no session id / timestamp / randomness — idempotent and mutex-guarded, so it is identical across invocations, sessions, and reboots (it falls back to the raw path only if the symlink can't be created).
- **NEW — third substitution site.** The agent also injects `CLAUDE_PLUGIN_ROOT` into an MCP server's `headersHelper` exec env, but only when that server is plugin-owned.
- **LIVE CONFIRMATION (host-loop, 2026-07-07).** The upgraded `docs/internal/cowork-pluginroot-probe` harness was uploaded through the Cowork app UI and run in real sessions. Results: `${CLAUDE_PLUGIN_ROOT}` resolved to `…/T/claude-hostloop-plugins/aa86f0206322553f`; on the host, `readlink` of that path → the install dir `…/local-agent-mode-sessions/<acc>/<org>/rpm/plugin_<ULID>`, and `sha256(installPath)[:16]` reproduced the basename **exactly** — proving the deterministic hash live. **Two separate sessions produced the identical hash**, confirming session-independence empirically. The host token path was unreachable in-VM; hook env-exports and host `/tmp` writes did not cross the boundary; the plugin's scripts were reachable in-VM only under `/sessions/<slug>/mnt/.remote-plugins/plugin_<ULID>/`. New detail: an **uploaded** plugin is treated as an org-remote/RPM install (host `rpm/plugin_<ULID>` → in-VM `.remote-plugins/plugin_<ULID>`, ULID-keyed), distinct from a marketplace install (`.local-plugins/cache/<mp>/<plugin>/<ver>`). **VM-loop** resolution remains static-derived from the mode branch (a live VM-loop run needs a locked-down org or the `forceDisableHostLoop` Dev-Menu toggle; deferred).
- **Files:** `references/17-verified-new-v2.1.120.md` (L89 correction subsection), `references/21-cowork-control-protocol.md` (L107 VM-loop bullet), `references/state/plugins-skills-hooks.md` + `references/state/cowork-architecture.md` (rewritten resolution sections + live-confirmation note), `references/state/registry.json` (new `env.CLAUDE_PLUGIN_ROOT` entry), `references/topic-index.json` (L89/L90/L107 line ranges + keywords), `references/semantic-index.json` (rebuilt), `docs/internal/cowork-pluginroot-probe/plugin/hooks/probe.sh` (sha256/symlink/space-trigger capture added).

## v2.24.0 — 2026-07-05 (this fork) — Chapter 32 (L118): skill-scope attribution & the per-`tool_use` stream contract

Adds `references/29-skill-scope-stream-contract.md` (Ch32, lesson 118), a cross-artifact first-party pass against the in-VM agent ELF `claude-code-vm/2.1.197` + the host CLI binary `2.1.201` (one build ahead of the CLI content baseline v2.1.198, used only for parity) + Claude.app `app.asar` **1.18286.0**. Prompted by reviewing the independent open-source `claude-cowork-headless-emulator` project's `docs/internal/2026-07-05-full-scope-implementation-plan.md` (§4.14, §5.1.1, §5.2) — but every static/code claim below was **independently re-derived first-party** (greps confirming each symbol and its immediate control flow in **both** our own 2.1.197 and 2.1.201 binaries) before being written, per this project's verify-before-trust discipline.

- **The internal `activeSkill` scope.** When a `Skill` tool runs, the agent sets `options.activeSkill` (via the id-normalizer `W1e`). For an **inline** skill this is **sticky, most-recent-wins, no-pop** — it stays set until the next `Skill` call replaces it (there is no "skill exited" signal); for a **fork** skill (`context:fork`) the body runs in a forked sub-agent (`Ypm`) and the previous `activeSkill` is **restored in a `finally`**. Verbatim control flow confirmed: `try{return await Ypm(u,a,...)}finally{n.options.activeSkill=l}` (fork) vs the inline fall-through that never restores. Dispatches inherit it: `spawnedBySkill: options.spawnedBySkill ?? options.activeSkill`.
- **Attribution rides the API request, not the stream.** Every model request carries `attribution: c$(querySource, spawnedBySkill, activeSkill, activeMcpServer, activeMcpTool)`, spread onto the object sent to Anthropic (adjacent to `requestId`/`serverFallbackHop`). This quintuple appears on **zero** locally-`yield`ed stream objects.
- **The fixed per-`tool_use` stream envelope.** Locally-yielded stream-json objects carry a small fixed set: `type`, `message`, `parent_tool_use_id`, `session_id`, `uuid`, `error`, `request_id`, `supersedes?`, `tool_use_meta?`. The only per-tool metadata, `tool_use_meta`, is **display-only** — verbatim Zod `{id, display_name, server_display_name?, icon_url?}[]` (MCP tool titles/icons), **not** skill scope.
- **Consequence — no exact tool→skill attribution in the stream.** Inline skills can at best be tracked by a sticky "active-skill window" (a faithful reproduction of `activeSkill`'s own no-pop semantics). **Fork** skills are the exception: their inner tool calls arrive as `skill_progress`-wrapped messages carrying `parent_tool_use_id` = the outer `Skill` id (exact), and are currently **undercounted** in `toolCounts`/`toolsCalled` because a `Skill` call isn't registered like an `Agent`/`Task` dispatch. Fork re-entry is blocked by a guard gated/telemetered by **`tengu_skill_tool_fork_recursion`** (`skill_invoke_fork_recursion`).
- **`microcompact_boundary` pinned** as a distinct `type:"system"` subtype string for micro-compaction — but with a sharp **asymmetry** vs `compact_boundary` (first-party emit-site counts, 2.1.197 = 2.1.201): `compact_boundary` has **8** `subtype:"compact_boundary"` stream producers; `microcompact_boundary` has **0** — its only two occurrences are a string-table constant and one Ink TUI renderer case that renders nothing (`if(subtype==="microcompact_boundary")return null`). So micro-compaction is **render-only and suppressed, not serialized into the stream** on this evidence; a stream/headless `compaction_occurred` signal should key on `compact_boundary` (keying on `microcompact_boundary` catches nothing). This is a **correction to the emulator plan's §4.14**, which assumed the agent emits `subtype:"microcompact_boundary"` and that a `compaction_occurred` assertion could be keyed on both.
- **Provenance discipline:** the static/code facts are first-party greps; the fork *runtime* behavior (inner-tool `parent_tool_use_id` = outer `Skill` id, verified model-independent across Haiku 4.5 and Sonnet 5; the `toolCounts` undercount) is **relayed** from the emulator project's live sandboxed runs and labelled as such in the chapter.

Second pass (2026-07-05, same uncommitted v2.24.0, from the emulator project's revised plan): folded in and **corrected** the per-`tool_use` stream envelope, all re-verified first-party in the ELF serializer:
- **Correction to L118 Part B:** the envelope is **not** a "fixed small set with nothing else." The serializer conditionally spreads **`subagent_type`** and **`task_description`** as siblings of `parent_tool_use_id` — but **only on messages emitted inside a dispatched/forked scope** (`…n!==void 0&&{subagent_type:n},…r!==void 0&&{task_description:r}…`; e.g. a fork sub-agent's message carries `subagent_type:"general-purpose"` and `task_description` = the dispatching skill's frontmatter description). A coarse "inside some dispatch" signal — still not skill scope. Fixed in the chapter and in the SKILL.md/CLAUDE.md/version.json blurbs.
- **`message.model` is populated on every assistant message** (30 threading sites; present even on the message inside a forked sub-agent) — per-message model attribution is reliable.
- **Each assistant message carries its own `usage` object** (`input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`/`cache_creation`/`service_tier`/`inference_geo`) — finer than the cumulative usage on the terminal `result` event.
- **The `init` system message field set** enumerated (names first-party; full set from the emulator's real captured `init` line): `tools`, `mcp_servers`, `cwd`, `skills` (bare names, no `when_to_use`), `agents`, `slash_commands`, `plugins`, `permissionMode`, `output_style`, `apiKeySource`, `memory_paths`, `fast_mode_state`.
- **Ch26/L109 Tasks-tool wire format pinned:** `TaskCreate` result text `` `Task #${n.id} created successfully: ${n.subject}` `` + the agent's own parse regex `Nom=/^Task #(\S+) created successfully/`; `TaskUpdate` schema `{taskId, status?:"pending"|"in_progress"|"completed"|"deleted", subject?, activeForm?}` — **`deleted` is a real wire status**. All first-party confirmed.

Updated: `topic-index.json` (+lesson 118, +40 keywords, keyword_map routes, source note, total 118), `cross-references.json` (+entry 118 with L116/L107/L109/L87/L115/L11 links, reciprocal back-links), `troubleshooting.json` (+3 symptom entries), `semantic-index.json` (rebuilt, 118 entries), `state/registry.json` (+`proto.microcompact_boundary`), `state/cowork-control-protocol.md` (new "Per-`tool_use` stream envelope" + "Compaction subtypes" sections; `as_of_desktop`→1.18286.0, `sources` +118, date), `state/plugins-skills-hooks.md` (new "`activeSkill` scope & attribution" section; `as_of_desktop`→1.18286.0, `sources` +118, date), `references/23-cowork-spaces-tasks-checkpointing.md` (`microcompact_boundary` one-liner), `SKILL.md` (frontmatter description + triggers, body intro paragraph, chapter/reference table, topic count 118/32), `version.json`, `plugin.json`, `CLAUDE.md`. `state.js --audit` and `validate-state.js` both pass clean.

Methodology note: a rigorous independent project's implementation plan is a legitimate lead for gaps in one's own catalog — but the value is in re-deriving each claim first-party from one's own binary (here, confirming `activeSkill`/`spawnedBySkill`/`c$`/`tool_use_meta`/`microcompact_boundary` in both the 2.1.197 VM ELF and the 2.1.201 host CLI), and in separating what is first-party-verifiable (code/strings) from what is relayed live-runtime behavior.

## v2.23.0 — 2026-07-04 (this fork) — Chapter 25/L108 & Chapter 31/L117 extended: a cluster of spawn-env gates and the `.host-home` skeleton-path index

Adds new binary-verified surface to two existing chapters, prompted by reviewing the independent open-source `claude-cowork-headless-emulator` project's `src/sync/cowork-sync.ts`, whose `PINNED_GATES` table is more complete than this skill's own gate catalog. Every claim below was independently re-derived first-party against **this installation's own `app.asar` 1.18286.0** before being added — the emulator project's table was used only as a lead, never as a source of truth, per this project's own verify-before-trust discipline (the same discipline v2.22.1 applied when accepting a correction from the same project).

- **New Part A table in `22-cowork-env-gates-protocol.md` (L108): gate-conditioned Cowork spawn-env vars.** All confirmed present verbatim in the same Desktop→agent spawn-env object already documented for `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`/`CLAUDE_CODE_TAGS` (Ch29/L115): `MCP_CONNECTION_NONBLOCKING`+`MCP_CONNECT_TIMEOUT_MS` (gate `434204418`, sets `"0"`/`"10000"`), `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES` (gate `66187241`, `"true"` vs `""`), `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING` (gate `714014285`, `"1"` — **force-ON** in this installation's live fcache), `CLAUDE_CODE_OAUTH_SCOPES` (gate `1936081873`, host-derived scope string), `CLAUDE_CODE_SKIP_PRECOMPACT_LOAD` (gate `4153934152`, `"1"`), `ENABLE_TOOL_SEARCH` (gate `1129419822`, `"auto"` — itself **dark**, absent from a standard fcache).
- **Two new Part B gate rows.** `2614807392` — a dark gate governing whether the system prompt tells the agent about the `.host-home` mount name and its path-translation semantics. Cross-referencing this against `28-vm-rootfs-forensics.md`'s (Ch31/L117) mount-unit inventory resolves a loose thread from that chapter: **`.host-home` is not a real bind mount** — there's no `mnt-.host-home.mount` systemd unit — it's a synthetic index (resolver pair `ece()`/`uCe()`) letting the agent *reference* absolute host paths in tool calls without the guest's home directory ever being shared. `2860753854` — a GrowthBook **string**-config gate (not boolean): `IWt()` returns the remote string if non-empty, else a hardcoded `"## Sensitive personal information..."` PII-handling default, and its value becomes `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES`.
- **New addendum in `28-vm-rootfs-forensics.md` (L117), Part B**: "`.host-home` is a reserved mount *name* that was never a mount unit at all" — explains the mount-name reservation structurally and extends the chapter's "shared vs. VM-local" framing with a third category: a virtual namespace resolving to host paths with no filesystem bridge at all.
- **Also fills a pre-existing gap**: the embedded reference-file table in `SKILL.md` was missing its `28-vm-rootfs-forensics.md` (L117) row entirely since v2.22.0 — added now alongside these edits.

Updated: `references/22-cowork-env-gates-protocol.md` (header callout + `Updated:` date, new Part A table, two new Part B rows), `references/28-vm-rootfs-forensics.md` (new addendum subsection, cross-references line), `state/registry.json` (+15 entries: 8 new `gate.*`, 7 new `env.*`, plus an updated `env.CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` summary), `state/cowork-architecture.md` (new `.host-home`-is-not-a-mount paragraph in "Filesystem & mounts", `sources` frontmatter gains lesson 108 — this state-layer domain page is the actual current-truth surface a reader consults, and had been missed in the first pass that only touched `registry.json`), `topic-index.json` (extended `endLine` for lessons 108/117 to cover the new content, ~20 new keywords, `keyword_map` rebuilt to 1773 keys), `troubleshooting.json` (new "is `.host-home` a real mount" symptom entry), `semantic-index.json` (rebuilt, 1818 vocab terms), `SKILL.md` (frontmatter/body description, gate-table row, new L117 chapter-table row), `plugin.json`, `version.json`, `CLAUDE.md`. `state.js --audit` and `validate-state.js` both pass clean.

Also brings the **top-level, repo-facing docs** current for the first time since v2.17.1 — `README.md` and root `.claude-plugin/marketplace.json` were still saying "113 lessons / 27 chapters / v2.17.0", four releases (v2.19.0–v2.22.1) and Chapters 28–31 (L114–L117) behind the actual skill content, because the periodic "docs consistency patch" habit from v2.17.1 had lapsed. Updated: `README.md` (blurb + version banner lesson/chapter counts and binary versions, intro paragraph gains Ch28–31 + the `state/` layer, prerequisites/limits section, file tree gains `references/25–28-*.md` + `references/state/` + `scripts/state.js`/`validate-state.js`, lessons table gains 4 new rows + heading count, Version Tracking JSON block, Attribution section gains 8 new bullets for the `state/` layer / Ch28 / Ch29 / Ch30 / Ch31 / the v2.22.1 correction / the v2.23.0 extension), `.claude-plugin/marketplace.json` (both `description` fields). No skill content changed by this addendum — pure documentation-drift reconciliation, surfaced by asking "did we forget to update anything outside the skill package itself".

Methodology note: reviewing a rigorous independent project's own binary-verification *artifacts* (not just its prose conclusions) is a legitimate lead-generation source for gaps in one's own catalog — provided every claim is independently re-derived from one's own binary before being trusted, exactly as v2.22.1 did when accepting a correction from the same project.

## v2.22.1 — 2026-07-04 (this fork) — Chapter 25/26 correction: gate `1648655587` is the scheduled-task session limiter, not a Task-tool dispatch cap

Corrects a factual error carried since v2.15.0's introduction of Ch25/L108. Prompted by reading the independent open-source `claude-cowork-headless-emulator` project's 2026-07-04 pre-1.0 readiness plan, which cites its own forensic pass (`docs/internal/2026-07-04-d4-dispatch-limiter-forensic.md`, one adversarial review round, ~95% confidence) concluding gate `1648655587` is mislabeled everywhere it appears in that project's docs. Before touching anything here, independently re-verified against **this installation's own `app.asar` 1.18286.0** — same offsets, same `class L9t`, same `shouldSkipDispatchForActiveSession`/`recordSkipAndEmit` code, same `CoworkScheduledTasks` IPC interface — confirming the correction first-party rather than trusting the external doc.

- **What was wrong:** the gate table entry (and every place it was echoed) described `1648655587` as a **"Task dispatch rate-limiter"** — `{perTask:1, global:3}` throttling `Task`-tool sub-agent fan-out within a conversation (e.g. "a dispatch session launches ≤1 sub-task; ≤3 concurrent globally").
- **What the binary actually shows:** the gate is read only inside `class L9t` (`logPrefix:"[ScheduledTasks]"`/`"[CCDScheduledTasks]"`). Its counter (`_countActiveSessionsForTask`) counts only **sessions carrying a `scheduledTaskId`** — i.e. sessions launched by Cowork's cron/scheduled-task feature (Ch26/L109), not `Task`-tool dispatches inside a running conversation. `perTask:1` ⇒ a given scheduled task never has more than 1 live session at once; `global:3` ⇒ at most 3 scheduled-task sessions run concurrently across the desktop. Exceeding either **skips** the dispatch (`recordSkipAndEmit`) and emits host-side telemetry only — no in-agent-run hook, no model-visible effect.
- **The stronger negative result:** grepping the same asar for `maxConcurrentSubagents`/`subagentLimit`/`concurrentTaskLimit`/`dispatchLimit` finds nothing else. **The Desktop imposes no cap on in-conversation `Task`-tool sub-agent fan-out anywhere.**

Corrected: `references/22-cowork-env-gates-protocol.md` (gate table row + chapter header callout), `references/23-cowork-spaces-tasks-checkpointing.md` (fcache-posture mention), `state/registry.json` (`gate.1648655587` renamed + resummarized + provenance extended to L109), `topic-index.json` (new `scheduled-task-session-limiter` keyword; legacy `task-dispatch-limiter` kept mapped for discoverability), `troubleshooting.json` (pattern + hint rewritten), `SKILL.md`, `plugin.json`. `version.json` note records the full evidence trail. Methodology note: a correction can come from re-reading an *already-held* binary more carefully, prompted by an independent third party's forensic pass over the same artifact — always independently re-verify before folding an external claim in, per this project's own binary-verify-don't-infer ethos.

## v2.22.0 — 2026-07-04 (this fork) — Chapter 31 (L117): VM rootfs forensics (mount inventory, session-slug format, coworkd)

Adds `references/28-vm-rootfs-forensics.md` (Ch31, lesson 117): triggered by verifying a set of claims about Cowork's host/VM filesystem split (produced by a separate investigation session), which led to fact-checking against a **third artifact class** neither previously used: the golden VM guest disk image itself, `~/Library/Application Support/Claude/vm_bundles/claudevm.bundle/rootfs.img` (a raw, unencrypted ~10 GB ext4 image). Unlike `app.asar` and the in-VM ELF, this image is directly greppable on the host with no VM boot required, and — on a machine with real Cowork usage history — retains leftover `systemd-journald` binary logs from actual past sessions.

- **Full mount inventory.** Extends Ch21/L104's single verified `.claude/skills` mount-unit example to the complete set: `outputs`, `uploads`, `.claude`, `.claude/skills`, `.claude/projects`, and one unit per user-connected folder — each independently mounted/unmounted per session as `sessions-<slug>-mnt-<name>.mount`.
- **The decisive negative result:** there is **no `.mount` unit for home or `/tmp`**. This is the structural (not just behavioral) reason those two paths are never host-shared: they were never bind-mounted at all, a categorically different kind of storage from `outputs/` — which is also why `fileDeleteApprovedMounts` (L109) only ever needs to gate mounted paths.
- **Session-slug format confirmed** with real historical examples surviving in the journald leftovers: Docker-style `<adjective>-<adjective>-<noun>` triples (`zealous-vigilant-einstein`, `lucid-awesome-bell`, `affectionate-serene-gates`, `fervent-determined-gauss`), not UUIDs.
- **`coworkd`** — a previously undocumented in-guest daemon that provisions a dedicated Unix user (uid/gid) per session slug (idempotently — "user already exists" is logged, not an error) and spawns work as that user via named `oneshot-<uuid>` jobs. One captured spawn line is a real, concrete example of the L89 host-loop plugin-staging mechanism (`claude-hostloop-plugins/<hash>`) executing an actual `deck-review` skill's scripts.
- **Flagged inference, not fact:** the idempotent user-exists check, together with an observed empty `vm_bundles/warm/<hash>/` directory, is *suggestive* of session-to-VM multiplexing (a warm pool of guests each capable of hosting more than one session), but no artifact directly confirms "one guest serves N sessions" — documented explicitly as an inference pending stronger evidence.
- **Methodology:** when a feature isn't in either "obvious" binary, consider a third, non-binary artifact class — a raw disk/container image is as greppable as any file, and if un-wiped it can carry forensic evidence of real historical activity that a code-read of shipping binaries alone can never show. Tool choice matters at multi-GB scale: a naive Python `mmap`+`re` scan didn't finish in minutes; `grep -a -c` took ~80s; `rg` found the same pattern in 3–7s.

Updated: `topic-index.json` (+lesson 117, +10 keyword_map keys, source note), `cross-references.json` (+entry 117, L104/L89/L107/L109/L116 back-links), `troubleshooting.json` (+1 symptom entry), `semantic-index.json` (rebuilt, 117 entries / 1800 vocab), `state/cowork-architecture.md` (Filesystem & mounts section rewritten with the full inventory, no-home/tmp-mount fact, session-slug format, `coworkd`; sources +117), `version.json`, `SKILL.md` (frontmatter description, body intro, chapter table, topic count), `plugin.json`, `CLAUDE.md`.

## v2.21.0 — 2026-07-04 (this fork) — Chapter 30 (L116): detecting the runtime from a skill (CLI vs Cowork vs elsewhere)

Adds `references/27-skill-runtime-detection.md` (Ch30, lesson 116): the companion question to L115 — not "what can a skill do per surface" but "how does a skill find out which surface it is on". Cross-artifact (CLI **2.1.198** bundle + Claude.app app.asar **1.18286.0**), reusing the v2.12.1 `coworkroot-probe` and v2.12.2 split-execution probes as empirical ground truth.

- **The trap:** host-loop Cowork splits a skill across a host-side agent process (env carries `CLAUDE_CODE_IS_COWORK=1` + `CLAUDE_CODE_ENTRYPOINT=local-agent`, from the same asar spawn env block as L115 Part D) and a **sealed-env VM shell** (`mcp__workspace__bash`) where no `CLAUDE_CODE_*` marker survives — so the obvious `$CLAUDE_CODE_IS_COWORK` check false-negatives exactly in production Cowork. Two other probe channels are also closed: inline `` !`cmd` `` skill-shell execution is force-disabled in Cowork (`q5n` short-circuits `disableSkillShellExecution` on `CLAUDE_CODE_IS_COWORK` before any policy/setting), and hook env-exports/host writes don't cross the host/VM bridge (v2.12.1 probe).
- **The signal inventory:** `CLAUDECODE=1` + `CLAUDE_CODE_SESSION_ID` + `CLAUDE_CODE_CHILD_SESSION` (+`AI_AGENT`) injected into every CLI Bash subprocess by `bmt`; the `CLAUDE_CODE_ENTRYPOINT` classifier (boot normalizer `cvs`; full recognizer set `c2u` — 23 values incl. `cli`/`sdk-*`/`claude-vscode`/`claude-desktop`/`local-agent`/`remote_cowork`/`claude-in-slack`/`ssh-remote`; Desktop family `u2u`; chat-remote family `d2u`); the CLI's own helpers `jX`/`Xga`/`avs`; and — for the sealed VM shell — the structural `/sessions/<id>` path signature.
- **The recipe:** script-side ordered checks (`$CLAUDE_CODE_IS_COWORK` → cowork; cwd under `/sessions/<id>` → cowork VM shell; `CLAUDECODE=1` → CLI, refined via ENTRYPOINT; else other), robust to the host-loop/VM-loop gate flip; content-side, branch on the tool surface (`Bash` vs `mcp__workspace__bash`), which degrades gracefully outside Claude entirely. Anti-pattern table (bare env check, inline-shell probe, hook sentinel, `${CLAUDE_PLUGIN_ROOT}`, `uname`, stale-symbol grep).
- **Artifact-drift finding:** the host→VM env allowlist documented from asar v1.6259.1 (the `MGn` ~30-key set in `docs/internal/cowork-vm-env-injection.md`) is **no longer present in asar 1.18286.0** — the only surviving `PYTHONDONTWRITEBYTECODE` occurrence is an unrelated SSH-MCP env-forward filter (`jBo`). The sealed-VM-env *fact* stands on the v2.12.2 empirical probe; the allowlist *implementation* moved out of the Desktop main bundle. Methodology: when a documented implementation symbol vanishes from its artifact, re-anchor the fact to its strongest surviving evidence rather than re-asserting the stale symbol or wrongly retracting the fact (the L114 pruned-baseline lesson, applied to a live claim).

Updated: `topic-index.json` (+lesson 116, +10 keyword_map keys, source note), `cross-references.json` (+entry 116, L115↔L116 back-link), `troubleshooting.json` (+1 symptom entry), `semantic-index.json` (rebuilt, 116 entries / 1770 vocab), `references/22-cowork-env-gates-protocol.md` (Ch25/L108 Part A gains a per-context visibility pointer to L116), `references/25-verified-new-v1.18286.0-desktop.md` (the Ch28/L114 Part E rows for `CLAUDE_CODE_DISABLE_AGENTS_FLEET` now carry the L115 correction inline — main-spawn siting, not a Tasks-tool-child path; v2.20.0 had corrected the registry but left the chapter text stale), `state/registry.json` (+`env.CLAUDECODE`, +`env.CLAUDE_CODE_ENTRYPOINT`; `env.CLAUDE_CODE_IS_COWORK` summary gains the visibility caveat with L116 provenance), `state/cowork-architecture.md` (new "Runtime detection from a skill" section, sources +116), `version.json`, `SKILL.md` (frontmatter description, body intro, chapter table), `plugin.json`, `CLAUDE.md`.

## v2.20.0 — 2026-07-04 (this fork) — Chapter 29 (L115): subagent resume semantics (Task vs SendMessage, CLI vs Cowork)

Adds `references/26-subagent-resume-semantics.md` (Ch29, lesson 115): a cross-artifact chapter (CLI **2.1.198** bundle + Claude.app (Desktop) app.asar **1.18286.0**) settling whether a completed subagent can be continued — triggered by fact-checking a skill-design claim that "the Task tool in both Claude Code and Cowork is one-shot, so a completed subagent can't be continued."

**Verdict: wrong for the standalone CLI, essentially right for Cowork — and the split is a Desktop spawn decision, not a Task-tool property.**

- **Task is one-shot per call everywhere.** The input-schema chain `THm`/`SHm`/`fLo` has no resume/continue/agentId parameter; every dispatch fires `tengu_agent_tool_selected` with `is_resume: false`. `fLo` omits `run_in_background` when `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` is set or the fork experiment (`PX()`, `CLAUDE_CODE_FORK_SUBAGENT`/GB rollout) is active.
- **The CLI has a first-class resume path: SendMessage.** The Task tool's own prompt text tells the model: "To continue a previously spawned agent, use SendMessage with the agent's ID or name as the `to` field — that resumes it with full context." The `agent-stopped`/`agent-evicted` resolution branches call `dfe` (logged `resumeAgentBackground`): disk-transcript reload (in-memory fallback; `No transcript found for agent ID` otherwise), `stoppedByUser` refusal ("treat its work as cancelled") unless user-initiated, fork-system-prompt reconstruction, and a `resumedAgentId` field in the tool result (consumed by session rehydration to mark agents `redispatched`). SendMessage is default-enabled (no `isEnabled` of its own; the `il()` agent-teams gate only shapes its structured-message schema). Sibling continuation primitives: `subagent_type: "fork"` (inherits full conversation context) and `Workflow resumeFromRunId` (L91).
- **Cowork severs the path at spawn.** The Desktop's local-agent spawn passes an explicit `tools:` array (and `allowedTools:`) that omits `SendMessage` (don't confuse with `SendUserMessage`), sets `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1"` in the spawn env (stripping `run_in_background` from the Task schema → synchronous subagents), and installs the `Task` PreToolUse hook blocking `run_in_background` ("Background agents disabled"). With no model-facing entry point, the resume machinery is present in the host CLI binary but dead in the session — redo/repair dispatch with a fresh agent genuinely is Cowork's only continuation primitive.
- **Correction to Ch28/L114:** `CLAUDE_CODE_DISABLE_AGENTS_FLEET` and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` each appear **exactly once** in the 1.18286.0 asar — in the **main** local-agent spawn env builder (the block setting `CLAUDE_CODE_IS_COWORK:"1"`), not "a Tasks-tool-child spawn path" as L114 stated. Backgrounding and Fleet/agent-view are suppressed for every Cowork session. Note the adjacent `CLAUDE_CODE_ENABLE_TASKS:"true"`: the Tasks *tool family* (L109) is ON in Cowork while *background* tasks are off — independent knobs.
- **Methodology:** a capability claim about "Claude Code and Cowork" is three claims (CLI mechanism, Desktop spawn config, the intersection the model sees). Testing only in Cowork yields a false universal one way; grepping only the CLI yields the opposite one — the same artifact-scoping trap as L107's forced-ask hook, in the other direction. Also: "appears exactly once in the bundle" is a cheap decisive check against distinct-spawn-path claims.

Updated: `topic-index.json` (+lesson 115, +10 keyword_map keys), `cross-references.json` (+entry 115), `troubleshooting.json` (+1 symptom entry), `semantic-index.json` (rebuilt, 115 entries), `state/registry.json` (+`tool.SendMessage`, +`tool.Task`; `env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` and `env.CLAUDE_CODE_DISABLE_AGENTS_FLEET` summaries corrected/extended with L115 provenance), `state/cowork-permissions.md` (new layer 8: spawn tools-list omission; `as_of_desktop` → 1.18286.0), `version.json`, `SKILL.md` (frontmatter description, body intro, chapter table), `plugin.json`, `CLAUDE.md`.

## v2.19.0 — 2026-07-04 (this fork) — Chapter 28 (L114): Desktop v1.18286.0 re-verification

Adds `references/25-verified-new-v1.18286.0-desktop.md` (Ch28, lesson 114): a first-party binary re-verification pass against Claude.app (Desktop) app.asar **1.18286.0**, triggered by re-checking whether the `cli_plugin` dark-launch gate (`2307090146`, Ch23/L106) was still off. It was — re-confirmed via the live `fcache` (`defaultValue`, unchanged mechanism).

**No byte-diff baseline available.** The prior captured build, 1.17377.2, was pruned by Desktop's own auto-updater before this pass began. Investigated whether Anthropic's official distribution channel could recover it (cross-checked directly against the `claude-cowork-headless-emulator` project's own binary-recovery research): the CDN only re-serves the standalone CLI SEA binary by version (`downloads.claude.ai/claude-code-releases/<ver>/`), not historical Desktop `.app` Electron bundles. So this chapter is a re-verification against the previously-published Ch23–Ch26 identifiers as the textual baseline, not a byte-level diff — documented explicitly as a methodology constraint, not silently glossed over.

**Findings:**
- Every mechanism from Ch23/L106 (`cli_plugin` gate), Ch24/L107 (control-protocol contract), Ch25/L108 (env vars & gates), and Ch26/L109 (Spaces/Scheduled Tasks/Tasks tool) re-confirmed structurally unchanged — only re-minified identifiers.
- **Correction:** Ch24/L107's "`--effort medium` passed explicitly" claim is wrong — it's a real per-session `LocalSessions.setEffort/getEffort/getDefaultEffort/setFastMode` IPC family backed by `CLAUDE_CODE_EFFORT_LEVEL`, not a hardcoded literal.
- **Promotion:** `CLAUDE_CODE_SUBAGENT_MODEL`, previously catalogued as speculative/unreleased (lesson 46), is now confirmed genuinely wired via a real `defaultSubagentModel` Desktop settings field.
- **New surface:** `CLAUDE_CODE_QUESTION_PREVIEW_FORMAT`, `CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL`, `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`/`_DISABLE_AUTO_MEMORY` (completes Ch26's `CoworkSpaces.getAutoMemoryDir` wiring), a second Desktop-scoped meaning of `CLAUDE_CODE_DISABLE_CRON` (distinct from lesson 38's CLI-level `AGENT_TRIGGERS` sense — same name, two contexts), `MCP_LIST_SCHEDULED_TASKS` (a 5th, list-only scheduled-tasks tool excluded from the 8-tool forced-ask matcher), three new `mcp__cowork__*` tools (`propose_skills`/`send_user_message`/`present_files`), and three new force-table gate IDs (`2976814254`/`3246569822`/`1696890383`).
- Every new-candidate identifier was cross-checked against `state/registry.json` before being called new — two initial candidates (`CLAUDE_CODE_CLASSIFIER_SUMMARY`, `CLAUDE_CODE_DISABLE_AGENTS_FLEET`) turned out to already have registry entries and were excluded/refined accordingly.

Updated: `topic-index.json` (+lesson 114), `cross-references.json` (+entry 114), `semantic-index.json` (rebuilt, 114 entries), `state/registry.json` (+14 entries, `as_of.desktop_asar` → 1.18286.0, `fcache_capture` → 2026-07-04), `state/credential-channels.md` and `state/cowork-architecture.md` (`as_of_desktop` bumped + reconfirmation notes), `version.json`, `SKILL.md` (frontmatter description, body intro, Step 2 warning line corrected from a stale v2.1.159 reference to v2.1.198, chapter table), `plugin.json`. `validate-state.js` and `state.js --audit` both pass clean.

## v2.18.1 — 2026-07-04 (this fork) — Follow-up hardening for the current-state layer

Resolves every follow-up deferred from the v2.18.0 review. Tooling: `validate-state.js` now reports `entries must be an array` as a clean validation error instead of throwing on a malformed registry; `state.js` guards against a malformed/unvalidated `registry.json` (missing `as_of.cli`, non-array `entries`) with a descriptive error and a friendly CLI message ("state layer unreadable … run validate-state.js"); both test suites clean up their temp fixture dirs via `test.after` (no more orphaned tmpdirs) and gain two new tests (14 total). Content: `cmd.toggle-memory` no longer overloads `removed_in` for a rename (now `null`; the rename window lives in the summary); `references/state/README.md` codifies the per-kind status semantics (reachability for commands/env-vars/tools, fcache on/off for gates, contract presence for IPC interfaces — deliberate, not an inconsistency); one awkward cross-reference sentence in `command-surface.md` reworded. Index fix: `topic-index.json` lesson 107 `endLine` 273 → 340 — the L107 chapter's Part F (auth/env handoff: `rtA()`/`itA()`, `CLAUDE_CODE_OAUTH_TOKEN`) was outside the indexed range even though L107's own keywords referenced it; `fetch-lesson.js 107` now returns the full chapter, and `semantic-index.json` was rebuilt accordingly (113 entries). No lesson content changes; binary baseline unchanged (CLI 2.1.198 / app.asar 1.17377.2 / in-VM ELF 2.1.197).

## v2.18.0 — 2026-07-03 (this fork) — Current-state layer

Adds `references/state/`: a normalized "as of CLI 2.1.198" truth layer over the
append-only lesson chapters — 8 domain pages (Cowork permissions/architecture/
control-protocol/credential-channels, model landscape, command surface,
memory/KB, plugins-skills-hooks) + `state/registry.json` (env vars, slash
commands, gates, API betas, control subtypes, IPC interfaces, each with
status/version/lesson-provenance). New scripts `state.js` (lookup + `--audit`
reconciliation view) and `validate-state.js` (integrity: every provenance
pointer must resolve in topic-index.json), with `node:test` coverage and a
new `validate.yml` CI workflow. SKILL.md now directs current-behavior
questions to the state layer first; the CLAUDE.md update workflow gains a
mandatory reconcile step. Lessons remain immutable provenance. No lesson
content changes; binary baseline unchanged (CLI 2.1.198 / app.asar 1.17377.2
/ in-VM ELF 2.1.197).

## v2.17.2 — 2026-07-03 (this fork) — Chapter 24 re-correction: the "5-tool forced-ask + Task block" claim was real

Corrects a factual error introduced by v2.15.0's own adversarial re-verification. Ch24/L107's Part E previously stated there was **no** "PreToolUse hook that forces ask for ~5 cowork tools and blocks `Task run_in_background`" — that this was an earlier framing that conflated distinct mechanisms. That retraction was itself wrong.

**What happened:** while reviewing a third-party project (`claude-cowork-headless-emulator`, a Cowork-runtime testing harness with its own independent binary captures across app.asar 1.11847.5→1.17377.2) for anything worth learning, its docs asserted the original claim as binary-verified fact — directly contradicting our "overturned" framing on the same underlying binary (1.12603.1). Rather than trust either side, re-grepped the **currently-installed** `Claude.app/Contents/Resources/app.asar` (v1.17377.2) directly.

**Finding:** the claim was correct. The Desktop builds a literal `hooks:{PreToolUse:[...]}` object at local-agent spawn time — four matchers: `Task` (blocks any call with `run_in_background` truthy, `reason:"Background agents disabled"`), `Skill` (telemetry + additionalContext), a joined-name matcher forcing `permissionDecision:"ask"` for `mcp__cowork__*` tools (now **8**: `allow_cowork_file_delete`/`request_cowork_directory`/`launch_code_session`/`save_skill`/`create_scheduled_task`/`update_scheduled_task`/`start_watching`/`stop_watching` — grown from 5 at the emulator's pre-Ch26 1.12603.1 capture), and `mcp__.*` (generic gate via `wjt()`).

**Root cause of the original error:** the L107 re-verification pass grepped only the CLI and in-VM agent ELF. This `hooks` config is built **Desktop-side**, in `app.asar`'s session-spawn code — a third artifact neither of those two searches would ever surface. "Not found in the bundle I searched" was mistaken for "doesn't exist."

Also newly confirmed live and folded into the same section: `fileDeleteApprovedMounts` is a real per-session array gating outputs/connected-folder mounts `rw`→`rwd` on `allow_cowork_file_delete` approval, and `mcp__workspace__web_fetch` host-routes to `POST /api/organizations/<org>/cowork/web_fetch`.

Updated: `CLAUDE.md` header clause, `references/21-cowork-control-protocol.md` (Part E rewrite + `run_in_background` bullet + Methodology point 5), `SKILL.md` frontmatter description, `version.json`, `skill-package/.claude-plugin/plugin.json`. No new lessons/chapters; content-baseline binaries unchanged (still app.asar 1.17377.2 / in-VM ELF 2.1.197 / CLI 2.1.198).

## v2.17.1 — 2026-07-02 (this fork) — Docs consistency patch

Documentation-only patch. No lesson content, index, or search changes — the skill payload is identical to v2.17.0. Fixes three human-facing description blocks that still referenced the pre-Chapter-27 baseline:

- **`README.md`** — the body had drifted well behind the headline: version-tracking block, ASCII file tree, the collapsible chapter table, the "What this fork adds" chapter list, the "Know its limits" line, and the `check-version.sh` example all still said **v2.1.159** and stopped at **Chapter 21**. Extended all of them through **Chapter 27 / v2.1.198 / 113 lessons**, and added reference-file rows 19–24 to the tree.
- **`.claude-plugin/marketplace.json`** — the plugin description said internals were verified "through v2.1.159"; now "through the v2.1.198 CLI" with Chapter 27 (Sonnet 5 default, Claude Design & Artifacts) called out.
- **`skill-package/.claude-plugin/plugin.json`** — the long description opened "through v2.1.120" and enumerated only up to Chapter 26; bumped to v2.1.198 and appended the Chapter 27 (L110–L113) summary.

## v2.17.0 — 2026-07-02 (this fork) — Chapter 27 (L110–L113): the v2.1.159 → v2.1.198 CLI content refresh

Closes the standalone-CLI content-baseline gap. The prior baseline was **v2.1.159** (Ch21) while the installed CLI is **v2.1.198** — 39 patch versions behind, and `check-version.sh` was warning. This chapter diffs the two (CDN-recovered v2.1.159 binary, sha256 `5adf7b4d…95f9` verified) and cross-checks the official Anthropic CHANGELOG for v2.1.160–2.1.198. New chapter `references/24-verified-new-v2.1.198.md`, four lessons. Diff surface: +135 env vars (117 not previously documented), +12/−4 slash commands, +4 API betas, +288/−32 `tengu_*`; hook event types unchanged at **30**.

### L110 — Model landscape
- **Claude Sonnet 5 is the new CLI default (v2.1.197)** — native 1M-token context; supersedes "Opus 4.8 is the default" from Ch21/L91. `claude-sonnet-5` `[binary]`. Opus 4.8 stays selectable.
- Claude Fable 5 (v2.1.170, Mythos-class); `fallbackModel` 3-model chain (v2.1.166); `CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE`; org default models + `enforceAvailableModels`.

### L111 — Announced CLI surface (in binary AND changelog)
`/cd` (move session cwd without breaking the prompt cache), `--safe-mode`/`CLAUDE_CODE_SAFE_MODE`, `/config key=value`, `/rewind` from before `/clear`, `Tool(param:value)` permission-rule syntax (`ruleValue`), `sandbox.credentials` + `sandbox.allowAppleEvents`, `autoMode.classifyAllShell`, sub-agents spawn sub-agents 5-deep (`agentDepth`), `claude mcp login/logout`, Claude-in-Chrome GA + background-agent `Notification`-hook reasons `agent_needs_input`/`agent_completed` (a new *reason*, not a new event type — still 30), `TeamCreate`/`TeamDelete` removed (one implicit team), `disableBundledSkills`, `CLAUDE_CODE_DISABLE_MOUSE_CLICKS`. Removed env vars: `ANTHROPIC_FOUNDRY_AUTH_TOKEN`, `CLAUDE_CODE_AGENT_LIST_IN_MESSAGES`, `CLAUDE_CODE_TEAM_ONBOARDING`.

### L112 — Dark-launched (in the binary but ABSENT from the official changelog)
- **Claude Design** — `/design` (grant/revoke agent access to Design projects), `/design-sync` (push design-system components to claude.ai/design), `/design-login` (OAuth, telemetry `tengu_design_oauth_*`), `DesignSync` tool, `CLAUDE_CODE_ENABLE_DESIGN_MCP`/`_ENABLE_DESIGN_SYNC`/`_DESIGN_OAUTH_CLIENT_ID`; gate `pNe()`, off by default.
- **Artifacts** — Artifact tool (`NR="Artifact"`) publishing a shareable page to `claude.ai/code/artifact/${slug}`; `/plan-artifact` **hard-disabled** (`v5e(){return!1}`); master GB flag **`tengu_cobalt_plinth`** (default false), `getArtifactDefaultOn` returns true once flipped; env `CLAUDE_CODE_ARTIFACT`/`_DISABLE_ARTIFACT`/`_ARTIFACTS_API_BASE_URL`/`_DIRECT_UPLOAD`/`_AUTO_OPEN`. This is the CLI's own flag — Desktop's `coworkArtifacts` (Ch25) is absent from the CLI bundle.
- Launch Composer (`CLAUDE_CODE_ENABLE/DISABLE_LAUNCH_COMPOSER`); `/skill-doctor` (live, "skills unused and costing context"); `/pause-memory` (rename of the removed `/toggle-memory`, kept as an alias).

### L113 — Auto-memory→knowledge-base + API betas
Memory gained a bulk-inflate + periodic-resync knowledge-base model: `CLAUDE_CODE_DISABLE_MEMORY_BULK_INFLATE`/`_PERIODIC_RESYNC`, `_FORCE_EVALUATE_MEMORY`, `_FORCE_MEMORY_SURVEY`, `_KB_COHESION_FIXES`. Four new API betas: `code-execution-2025-08-25` (in the default `Betas` array), and `server-side-fallback-2026-06-01` / `fallback-credit-2026-06-01` / `prompt-caching-evict-2026-05-12` (GB-gated via `sb(...)`); `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK` opts out of the refusal→fallback path.

Metadata: `skill_version` 2.16.0→**2.17.0**, `captured_version` 2.1.159→**2.1.198**, lessons 109→**113**, chapters 26→**27**, `keywords_indexed`→**1718**; `topic-index.json` (L110–L113 + `total_lessons`→113), semantic index rebuilt; `SKILL.md`/`plugin.json`/`marketplace.json`/`README.md`/`CLAUDE.md` (version + counts + content-baseline v2.1.159→v2.1.198). `check-version.sh` now matches the installed CLI.

## v2.16.0 — 2026-07-02 (this fork) — Chapter 26 (L109) + host-loop file-I/O, hook-enforcement, and index-integrity findings

Headline: Chapter 26 (L109) — Cowork Spaces, Scheduled Tasks, the Tasks tool & SDK file-checkpointing. Plus a round of follow-on corrections/additions from live Cowork/skill debugging (host-loop shared-scratch model, `${CLAUDE_PLUGIN_ROOT}` per-consumer resolution, PreToolUse-bypasses-canUseTool + hook input contract) and a pre-existing `topic-index` line-range drift fix (65 corrections). All first-party binary-verified.

New chapter, **first-party binary-verified** against **Claude.app (Desktop) `app.asar` 1.17377.2** (main process `.vite/build/index.js`), the staged **in-VM agent ELF `claude-code-vm/2.1.197/claude`** (Linux/arm64 Bun-SEA, extracted to JS via `extract-bundle.sh`), and the **live on-disk `fcache`** (snapshot 2026-07-02). Both key binaries moved since the Ch24/25 baseline: Desktop app.asar **1.12603.1 → 1.17377.2** (bundled Agent SDK `0.3.197`), in-VM agent **`claude-code-vm/2.1.170` → `2.1.197`**. The exact prior binaries were pruned from disk (only 2.1.197 remained), so this is a **diff against the documented Ch24/25 baseline** — the authoritative prior record; every `[binary]` claim was re-grepped first-party in-session.

### Chapter 26 / L109 — Cowork's shift toward a workspace product (`references/23-cowork-spaces-tasks-checkpointing.md`)

- **Cowork Spaces (new Desktop IPC).** A `CoworkSpaces` Electron IPC interface (absent at the Ch24 baseline) with **24 validated methods**. A **Space** groups **projects** (`addProjectToSpace`/`removeProjectFromSpace`), **folders** (`addFolderToSpace`/`removeFolderFromSpace`/`createSpaceFolder`/`copyFilesToSpaceFolder`/`listFolderContents`, keyed by `folderPath`), **links** (`addLinkToSpace`/`removeLinkFromSpace`), and **remote sessions** (`setRemoteSessionSpace`/`removeRemoteSessionSpace`/`getRemoteSessionSpaces`), with per-space **auto-memory** (`getAutoMemoryDir`/`getAutoMemoryDirForSession`/`readSpaceMemoryIndex`) and auto-organization (`classifySessions`/`setAutoDescription`/`summarizeSpace`). A Space's `folderPath` set is the host-side source of `CLAUDE_CODE_WORKSPACE_HOST_PATHS` (Ch25) — what the desktop injects into an agent session.
- **Cowork Scheduled & Watched Tasks (new Desktop IPC).** `CoworkScheduledTasks` (aliased `CCDScheduledTasks`): `createScheduledTask`/`updateScheduledTask`/`getAllScheduledTasks`/`updateScheduledTaskStatus`/`getScheduledTaskFileContent`/`updateScheduledTaskFileContent`/`getWatcherHistory`/`clearChromePermissions`/`removeApprovedPermission`. A task is `{prompt, cronExpression, enabled}`; a `watcher` marks the trigger-driven variant with `getWatcherHistory`; tasks carry Chrome site-permissions. Scheduler flags: `scheduledTasksWakeEnabled`, `scheduledTaskStaleReapEnabled`, `coworkScheduledTasksEnabled`, `ccdScheduledTasksEnabled`. The scheduling/watching lives host-side; the agent only **receives and surfaces the fire event** as a `type:"system"` `subtype:"scheduled_task_fire"` message (`function Vmc`), rendered as a dim status line. This is the Cowork-Desktop first-class UI over L90's `/schedule`→routines.
- **Tasks tool family (agent-side).** The deferred `TaskCreate`/`TaskList`/`TaskGet`/`TaskUpdate`/`TaskStop`/`TaskOutput` tools are gated by `CLAUDE_CODE_ENABLE_TASKS` (`function vv(){if(yl(process.env.CLAUDE_CODE_ENABLE_TASKS))return!1;return!0}`) + `CLAUDE_CODE_TASK_LIST_ID` (`function D$()` persistent list id). Background-task tuning: `CLAUDE_AUTO_BACKGROUND_TASKS` (`Rbm()` → 120000 ms auto-background), `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` (suppresses the `run_in_background: true` tool-description hint), `CLAUDE_CODE_BG_TASKS_REPORT_RUNNING` (keeps status live while bg tasks run). This is the runtime behind the **force-ON `tasks_tab` insider experiment** in gate `364911507` (`insiderForce:"treatment"`).
- **SDK file-checkpointing / rewind.** `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` (`function Drm(){return ct(process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING)&&!Fe.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING}`); control-protocol request `rewind_files` (`user_message_id`, `dry_run`) rolls files back to a prior user-message checkpoint; system message `file_snapshot` records one. Plus `CLAUDE_CODE_ENABLE_REMOTE_RECAP` (`away_summary` subtype; extends L101's proactive away-summary to the remote/Cowork surface).
- **~90-subtype control protocol.** The 2.1.197 agent's full `subtype` set is enumerated verbatim. New vs the documented `Bv1`/`Uv1` + L108 sets: session control (`apply_flag_settings`, `set_permission_mode`, `set_model`, `set_max_thinking_tokens`, `set_mcp_permission_mode_override`, `get_context_usage`, `get_settings`, `get_usage`, `session_state_changed`, `channel_enable`, `cancel_async_message`); runtime reloads (`reload_plugins`, `reload_skills`, `read_file`, `commands_changed`, `plugin_install`, `mcp_set_servers`, `mcp_reconnect`; `register_repo_root` now confirmed to carry `reload_claude_md`/`reload_plugins`/`reload_skills`); tasks (`background_tasks`, `task_started`/`_progress`/`_updated`/`_summary`/`_notification`, `stop_task`); checkpointing (`rewind_files`, `file_snapshot`, `away_summary`); `scheduled_task_fire`; memory (`memory_recall`, `memory_saved`); the model-fallback family (`model_fallback`, `model_consent_fallback`, `model_refusal_fallback`, `model_refusal_no_fallback`); lifecycle (`turn_starting`, `turn_duration`, `worker_shutting_down`, `stop_hook_summary`, `submit_feedback`, `api_retry`, `thinking_tokens`, `compact_boundary`).
- **fcache gate posture (snapshot 2026-07-02, 200 gates / 98 ON).** The **11 gates documented in Ch25/L108 are all unchanged in on/off state** (host-loop/Fable/bridge-SDK-adapter/cowork-config/task-limiter/auto-retry/sparkplug//rc-alias/coworkArtifacts ON; **`coworkKappa` `123929380` and `cli_plugin` `2307090146` still OFF**). Value deltas: Fable-model gate `3045399524` now enables `["claude-fable-5[1m]","claude-fable-5"]` (Fable 5 is the live Cowork model); cowork-runtime-config `1978029737` carries `coworkWebFetchViaApi`/`coworkWebFetchPrompt`/`workspaceBashWaitLonger`/`coworkNativeFilePreview` (web_fetch routes via the API, and the **in-VM agent itself reads this gate**: `xi("1978029737","coworkWebFetchViaApi",…)`); new force-ON experiment `364911507` → `tasks_tab` (insider treatment).
- **Session & log storage layout (Part G, on-disk verified macOS 2026-07-02).** Cowork persists under `~/Library/Application Support/Claude/` + `~/Library/Logs/Claude/`, **not** `~/.claude/`. Each session is a self-contained sandbox `local-agent-mode-sessions/<accountId>/<orgId>/local_<sessionId>/` with its own `.claude` config dir; the **chat transcript** is a standard Claude Code JSONL at `.claude/projects/<cwd-slug>/<cliSessionId>.jsonl` (keyed by the host CLI's `cliSessionId`, distinct from the Cowork `<sessionId>`), the session **config record** is the sibling `local_<sessionId>.json` (`hostLoopMode:true`, model, systemPrompt, MCP config, memory guidelines), and runtime/debug logs are `cowork_host_loop_debug.log` (+`latest` symlink), `cowork_vm_node/swift.log`, `coworkd.log`, `main.log`/`mcp.log`/`ssh.log`. This reconciles the host-loop/VM-loop split: under host-loop the per-session host-side `.claude` IS `CLAUDE_CONFIG_DIR` (`/sessions/<id>/mnt/.claude` is the VM-loop path). Part G also documents **when a transcript is *not* written** — `--no-session-persistence`/SDK `persistSession:false` (only with `--print`, which Cowork uses), ephemeral child/sub-agent sessions (`CLAUDE_CODE_CHILD_SESSION` + `Xje()` gate, overridable via `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE`), best-effort writes that fail silently if the per-session `.claude` is unwritable, `--no-create-session-in-dir`, and after-the-fact `cleanupPeriodDays` retention (default 30). Recorded in the `reference-cowork-session-log-storage` memory.
- **Honesty caveats.** `ANTHROPIC_WORKSPACE_ID` appears in the 2.1.197 agent's telemetry but was already documented (Ch21/L86, OIDC env-quad) — it is **not** the Spaces id; dropped from "new." Presence of an IPC interface (Spaces, Scheduled Tasks) is a **contract, not a shipped ungated UI** — reachability depends on server-side gates (`coworkTabEnabled`, `tasks_tab`). No exact old-binary diff was possible (2.1.170 pruned); the diff is against the documented Ch24/25 record.

### Follow-on findings from live Cowork/skill debugging (same release)

A round of debugging a Cowork skill-harness surfaced several corrections and additions, each first-party binary-verified against app.asar 1.17377.2 + in-VM ELF 2.1.197 (+ the real VM `rootfs.img` and a tested plugin-root probe):

- **VM mounts are stood up by the VM image, not the client binaries (Ch26 Part G).** Guest mounts under `/sessions/<id>/mnt/` come from the VM image's **systemd `.mount` units** in `vm_bundles/claudevm.bundle/rootfs.img` — not the asar or agent ELF. Verified: skills mount at `/sessions/<id>/mnt/.claude/skills` via `sessions-<name>-mnt-.claude-skills.mount` (verbatim in `rootfs.img`). **Verification rule** added: grep `rootfs.img` for mount questions; "absent from the client binaries" ≠ "absent on disk." (This corrected a live-session report that mislabeled a **claude.ai chat** skills-container path — `/mnt/skills/plugins/<plugin:skill>/`, colon-form on squashfs `public`/`examples` — as "production Cowork"; it is **zero hits** in the asar, agent ELF, and real `rootfs.img`, and belongs to a different product.)
- **Host-loop is one shared scratch space, two path namespaces — not two filesystems (Ch24/L107).** Verbatim asar host-loop prompt: *"the same scratch space the Read/Write/Edit tools use … The sandbox sees this directory at a different path than the file tools do, so use bare filenames with both."* `mcp__workspace__bash` (in-VM, `/mnt/outputs`) and host-side Read/Edit operate on the **same files**; the `/sessions/…`-deny PreToolUse path-gate (`IeA`) catches VM-absolute paths handed to host file tools. Fix for skills: relative/bare filenames. Corrects the "artifacts live in the VM, host can't see them" framing.
- **`${CLAUDE_PLUGIN_ROOT}` under host-loop: one token, two namespaces (Ch24/L107).** Resolves **host-side** (`claude-hostloop-plugins/<hash>`) — **accepted** by host Read/Edit (keep it literal for references), **useless** for in-VM bash (scripts must use the VM mount `/sessions/<id>/mnt/.local-plugins/…` or `.remote-plugins/plugin_<id>/…`); outputs → relative. So "always resolve the token to the VM path" is right for scripts, wrong for reference Reads. Tested v2.1.120 (`cowork-pluginroot-probe`), string-corroborated 1.17377.2/2.1.197; per-tool acceptance flagged for live reconfirm.
- **PreToolUse is an independent enforcement point that bypasses `canUseTool` (01-core L50 + 04-connectivity L10 + Ch26 Part E).** `[binary 2.1.197]` PreToolUse hooks fire on every tool call including `--allowedTools`-pre-approved ones; a hook `deny` (modern `hookSpecificOutput.permissionDecision:"deny"` or legacy `{decision:"block"}` → `permissionBehavior:"deny"`) **bypasses `canUseTool`** (verbatim: *"PreToolUse hook denies bypass canUseTool and are not covered here"*) and surfaces as an `is_error` tool_result while the turn frame stays `subtype:"success"` (tool-level, not run-level, failure). Also documents the **hook input contract** (shared `Ad()` builder: `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `agent_id`, `agent_type`, `effort:{level}` + per-event `hook_event_name`/`tool_name`/`tool_input`/`tool_use_id`) and the `hook_callback` control-protocol envelope (`{callback_id, input, tool_use_id?}`, `{async:true}` deferral). Extends an external session's transcript findings (which had missed `agent_id`/`agent_type`).
- **Troubleshooting entry** added for the bash-vs-Read/Edit file-path symptom, plus the `${CLAUDE_PLUGIN_ROOT}` per-consumer guidance.
- **Index-integrity fix (pre-existing bug).** Discovered the `topic-index.json` lesson line-ranges were **systematically drifted** — all of `04-connectivity` was ~370 lines off, so `fetch-lesson` returned the wrong lesson's content and the semantic vectors were built from mis-aligned text. Recomputed **every** lesson's `startLine`/`endLine` from its actual `# LESSON` header (65 corrections) and rebuilt the semantic index against correct content; `fetch-lesson 32` now returns the real Hooks System lesson.

Edits: new `references/23-cowork-spaces-tasks-checkpointing.md` (Chapter 26, L109, incl. Part G storage layout + "when a transcript is not written"); `references/21-cowork-control-protocol.md` (host-loop shared-scratch model, `/sessions/`-deny path-gate rationale, `${CLAUDE_PLUGIN_ROOT}` per-consumer resolution); `references/01-core-architecture-tools.md` (PreToolUse-bypasses-canUseTool + hook input contract); `references/04-connectivity-plugins.md` (Hooks System pointer to the above); `references/22-cowork-env-gates-protocol.md` (`hook_callback` wire shape); `references/troubleshooting.json` (file-I/O symptom); `references/topic-index.json` (L109 entry + `total_lessons` 108→**109** + keyword_map + **65 line-range corrections**); `version.json` (`skill_version` 2.15.0→**2.16.0**, lessons 108→**109**, chapters 25→**26**, `keywords_indexed`→**1679**); `plugin.json`, `SKILL.md`, `CLAUDE.md`, `README.md`. Semantic index rebuilt. New memories: `reference-cowork-session-log-storage`, `feedback-cowork-mount-verification-layer`, `reference-cowork-hostloop-shared-scratch`, `reference-pretooluse-bypasses-canusetool`.

## v2.15.0 — 2026-06-13 (this fork) — Chapters 24 & 25 (L107–L108): the Cowork spawn + control-protocol contract, a host-loop/VM-loop correction to Chapter 20, and a binary-verified env-var / gate / control-protocol reference catalog

New chapter plus a correction, **first-party binary-verified** against **Claude.app (Desktop) `app.asar` 1.12603.1** (main process `.vite/build/index.js`), the staged **in-VM agent ELF `claude-code-vm/2.1.170/claude`** (a Linux/arm64 Bun-SEA bundle), and the **live on-disk `fcache`**. Verification was run as a **14-agent workflow** — 5 finder→skeptic pipelines (each finder pasting literal matched bytes, each claim adversarially re-greped) plus a discovery pass. That pass **overturned two plausible claims** from the initial draft and **sharpened several more** (detailed below); corrections are applied across the chapter and metadata.

### Chapter 24 / L107 — the spawn + control-protocol seam (`references/21-cowork-control-protocol.md`)

The real Desktop Cowork runtime **cannot be scripted** (no DevTools endpoint; `EnableNodeCliInspectArguments` fuse OFF; renderer→main IPC on per-build-UUID channels with 660+ `senderFrame` trusted-origin checks; deep links don't create sessions; no host CLI entry). The stable, observable seam is therefore the **agent's flags + stream-json control protocol + mounts + egress** — documented here from the *driver's* side (the dispatcher side is Ch22/L105).

- **Cowork mode is env, not a flag.** `CLAUDE_CODE_IS_COWORK=1` activates it (distinct from `CLAUDE_CODE_SESSION_KIND="bg"`, the `/background`-fork axis from L89). The `--cowork` *flag* is rejected ("can only be used with user scope"). Do **not** set `CLAUDE_CODE_USE_COWORK_PLUGINS` — `function TSO(q){…}` flips the user-settings file to `cowork_settings.json` and the cache dir to `cowork_plugins/`, files the host never populates, so it silently breaks settings + plugin reads (sharpens the L89 three-root-namespace finding).
- **Spawn flags.** `-p --verbose --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`. `--verbose` is required with stream-json `--print`; **without `--permission-prompt-tool stdio`, AskUserQuestion is silently auto-dismissed**. **Overturned:** `--effort` is **not** "default `medium`" and `MAX_THINKING_TOKENS` is **not** "default `31999`." The desktop *passes* `--effort medium --max-thinking-tokens 31999` explicitly (driver-passed values); the agent's own default effort is **`high`** (`w46()` over `eV=["low","medium","high","xhigh","max"]`; `xhigh` for opus-4-7), and thinking defaults to `{type:"adaptive"}` when `MAX_THINKING_TOKENS` is unset (`31999` does not appear in the in-VM bundle). `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` bypasses the per-model allowlist; `CLAUDE_EFFORT` as a `process.env` var remains a no-op (L90/L93).
- **The control protocol.** The `initialize` request is the **first** message (carries `systemPrompt`/`appendSubagentSystemPrompt`/`hooks`/`sdkMcpServers`). The `control_response` envelope is **doubly nested** (`response.response.<payload>`; wrong nesting → `ZodError`). AskUserQuestion allow shape: `updatedInput.answers = Record<questionText, chosenLabel>` (schema `answers: z.record(z.string(), z.string())`).
- **Newly surfaced control-protocol subtypes** (beyond the seven in Ch22/L105): **`mcp_call`** (host→VM, invoke any subprocess MCP tool through the control channel, bypassing the model turn — schema doc says *"No permission check (control channel is trusted)"*), **`request_user_dialog`** (VM→host blocking dialog), **`register_repo_root`** (runtime cwd-root add + optional `reload_claude_md`/`reload_plugins`/`reload_skills`), **`stage_file`** (CCR host→container staging), **`end_session`** (epoch-guarded via `CLAUDE_CODE_WORKER_EPOCH`).
- **MCP delivery.** Servers arrive as **SDK servers over the control protocol**: declare `sdkMcpServers` in `initialize`; the agent tunnels JSON-RPC out as `control_request{subtype:"mcp_message", server_name, message}` and the driver replies `control_response{response:{mcp_response:…}}` — **the driver is the MCP server**. This does *not* contradict L89's `claude_desktop_config.json` → `mcpServers.<name>.env` route: that file is read by the Desktop **host**, which spawns the server host-side and bridges it over exactly this SDK channel. **Sharpened (was overbroad):** `--mcp-config`/`--strict-mcp-config` are parsed (`gU8`) and dropped by `ap5()` *only* in **safe mode** (`I5()`) or **hermetic-remote mode** (`xB8()` = `CLAUDE_CODE_REMOTE` && `CLAUDE_CODE_REMOTE_HERMETIC_MODE`), logging *"--mcp-config: N server(s) ignored in [safe/hermetic mode]"* — **plain `SESSION_KIND=bg` cowork does not trigger it**. The earlier "cowork ignores `--mcp-config`" shorthand conflated hermetic mode with cowork mode.
- **Layered permissions — overturned & rebuilt.** There is **no** PreToolUse hook that "forces ask for 5 cowork tools and blocks `Task run_in_background`." The real layers: `--allowedTools` pre-approval; the **host-loop tool partition** (`gre` = `HOST_LOOP_EXCLUDED_BUILTIN_TOOLS` = `[Bash,NotebookEdit,REPL,JavaScript,WebFetch]`, `PNt` = `HOST_LOOP_SAFE_BUILTIN_TOOLS`, `Ren` = filter `mcp__`||`PNt`; `BDt`/`QDt` inject `mcp__workspace__bash`/`web_fetch` into the **disabled** set); the **real PreToolUse hook path-gates** `IeA` = `[Read,Write,Edit,Glob,Grep]`+`MultiEdit`, denying `/sessions/…` VM paths host-side (`vZe`/`Nen`); the `run_in_background` block is a **speculation-engine abort for `Ih`=[Bash,PowerShell] only** (not `Task`); session rules come from `CLAUDE_BG_SESSION_PERMISSION_RULES` (`eXY`), with `alwaysAskRules` defaulting to `{}` (no static set). `--allow-dangerously-skip-permissions` is a **capability grant**; the mode stays `default`.
- **Auth & runtime.** `CLAUDE_CODE_OAUTH_TOKEN` via env; `rtA()` empties `ANTHROPIC_API_KEY`/`AUTH_TOKEN`/`CUSTOM_HEADERS` and `itA()` then **`delete`s** them (removed, not blanked). A fresh `CLAUDE_CONFIG_DIR` *alone* yields "Not logged in". `setup-token` mints a long-lived OAuth token (UI: *"valid for 1 year"*, value = `accessToken`) — the **`sk-ant-oat01` prefix is not binary-verifiable here** (only in unrelated `ANTHROPIC_ENVIRONMENT_KEY` docs); treat as in-practice format. `CLAUDE_CODE_EXECPATH` (`ZUK`) is set by the agent to its **own** `process.execPath` (so don't blind-forward host `CLAUDE_*`). Guest is **Ubuntu 22** + `--break-system-packages` (system prompt `i$r`); pypi is off the egress allowlist. (node v12 is a runtime image property, not stated in the prompt/binary.)

### Correction — Chapter 20 (L89) host-loop vs VM-loop

The chapter's "split execution" finding now has a name and a switch. Whether Cowork runs **host-loop** or **VM-loop** is GrowthBook gate `1143815894` (decision fn `f_()`: `requireCoworkFullVmSandbox`/`forceDisableHostLoop` → VM-loop; `CLAUDE_FORCE_HOST_LOOP=1` → host-loop; else the gate). The live `fcache` decodes `{value:true, on:true, source:"force"}`, so **production consumer/Pro Cowork is host-loop**: the agent loop runs on the **host** (`/usr/local/bin/claude`), Read/Edit/Write hit the host FS, and **only `mcp__workspace__bash`/`web_fetch` run in the VM**. Locked-down orgs (`requireCoworkFullVmSandbox`) get **VM-loop** (the whole agent runs in the in-VM Linux ELF; `cwd:/sessions/<id>`, `CLAUDE_CONFIG_DIR=/sessions/<id>/mnt/.claude` — strings that live in the *in-VM ELF*, not the host CLI, which reconciles the earlier "`/sessions/<id>/mnt` not in the binary" note). The chapter's prior "in-VM CLI" wording for the logged `/usr/local/bin/claude` process is now flagged as **host-side** under host-loop. This unifies the previously scattered empirical findings (host env reaching MCP servers, sealed VM shell, the split-execution table) under one mechanism.

### Chapter 25 / L108 — env-var, gate & control-protocol reference catalog (`references/22-cowork-env-gates-protocol.md`)

The discovery half of the verification workflow surfaced a large body of adjacent, undocumented surface; each item was **re-grep-confirmed first-party** before inclusion. Three parts:

- **(A) ~33 Cowork/Desktop environment variables.** Model/effort (`CLAUDE_CODE_ALWAYS_ENABLE_EFFORT`, `_DISABLE_1M_CONTEXT`, `_DISABLE_ADAPTIVE_THINKING`, `_DISABLE_LEGACY_MODEL_REMAP`, `_BG_CLASSIFIER_MODEL`, `_AUTO_MODE_MODEL`, the `ANTHROPIC_DEFAULT_FABLE_MODEL` quartet); cowork/bg runtime (`CLAUDE_CODE_ENVIRONMENT_KIND`=`byoc|anthropic_cloud|bridge` + `_BYOC_ENABLE_DATADOG`, `_WORKER_EPOCH`, `_WORKSPACE_HOST_PATHS`, the single-use `CLAUDE_BG_{CLAIM,SOCKET_TOKENS_PATH,RV,PTY}_AUTH` handshake, `_STARTUP_WEDGE_MS`, `CLAUDE_COWORK_MEMORY_INDEX_CONTENT`); auth/security (`CLAUDE_CODE_ENABLE_XAA` = XAA / SEP-990 cross-app auth for MCP OAuth, `CLAUDE_TRUSTED_DEVICE_TOKEN`, `CLAUDE_CODE_DONT_INHERIT_ENV` hermetic shell); Agent SDK (`CLAUDE_AGENT_SDK_{CLIENT_APP,VERSION,MCP_NO_PREFIX,DISABLE_BUILTIN_AGENTS}`); workflow/misc (`CLAUDE_CODE_PLAN_V2_AGENT_COUNT`/`_EXPLORE_AGENT_COUNT`, `_COLD_COMPACT`, `CLAUDE_AFTER_LAST_COMPACT`, `_DISABLE_GIT_INSTRUCTIONS`); Desktop-only (`CLAUDE_AI_URL`, `CLAUDE_EXTRA_HEADERS_TOKEN`, `CLAUDE_UPDATER_TOKEN`, `CLAUDE_DESKTOP_LOCAL_FRAME_SHELL`).
- **(B) Production GrowthBook gates** decoded from this installation's live `fcache` (all `source:"force"` unless noted): `1143815894` host-loop **ON**, `3045399524` Fable-model-allow **ON** (`claude-fable-5[1m]`), `583857784` bridge-transport SDK-adapter **ON** (current production transport), `1978029737` cowork-runtime config **ON** (`coworkWebFetchViaApi`/`coworkWebFetchPrompt`/`workspaceBashWaitLonger`/`coworkNativeFilePreview`), `1648655587` task-dispatch limiter **ON** `{perTask:1, global:3}`, `1893165035` auto-retry categories **ON** (incl. `api_model_not_found`), `2340532315` sparkplug plugin-sync **ON**, `2392971184` `/rc`-alias + replay **ON**, `2940196192` coworkArtifacts **ON**; `123929380` coworkKappa **OFF** (default), `2307090146` cli_plugin **OFF** (default).
- **(C) Extended control-protocol surface** beyond Ch22/L105 and Ch24/L107: request subtypes `get_session_cost`, `get_binary_version` (embeds `version:"2.1.170"`, `buildTime:"2026-06-09T15:09:09Z"`), `generate_session_title`, `ultrareview_launch`, `side_question`; new `type:"system"` message subtypes `elicitation_complete`, `files_persisted`, `local_command_output`, `api_metrics`, `thinking`; and the verbatim dispatcher sets `Bv1` (blocking: `interrupt`/`set_permission_mode`/`set_model`/`set_max_thinking_tokens`/`set_color`/`mcp_toggle`/`message_rated`) and `Uv1` (async-park: `can_use_tool`/`request_user_dialog`/`elicitation`).

**Verification also confirmed Ch23/L106 stands.** A discovery agent claimed the `cli_plugin` gate (`2307090146`) is force-on for interactive Anthropic users via the `Vdr` hardcoded-feature map; first-party re-grep showed `Vdr` belongs to the **custom-3p** provider class (adjacent `[custom-3p]` log; `type==="3p"` branch), and this machine's interactive account takes the server-fetch path with `fcache` reading the gate **off** — so L106's "dark-launched, off by default for the standard client" is correct, unchanged.

Edits: new `references/21-cowork-control-protocol.md` (Chapter 24, L107) and `references/22-cowork-env-gates-protocol.md` (Chapter 25, L108); reworked the host-loop/VM-loop subsection + a forward pointer in `references/17-verified-new-v2.1.120.md`; `version.json` (`skill_version` 2.14.0→**2.15.0**, lessons 106→**108**, chapters 23→**25**, keywords 1455→**1562**); `plugin.json`, `SKILL.md` (description, intro, index, chapter table), `CLAUDE.md` (header, repo-structure list — also backfilled the missing Ch23 row, key facts); `README.md`; the `feedback_cowork_settings_env_not_inherited` memory (host-loop naming + in-VM-ELF reconciliation). Topic + semantic indexes rebuilt (semantic vocab 1540→**1614**). Cross-refs Ch20 L89 (host-loop/split execution), Ch22 L105 (control-request dispatcher + elicitation), Ch23 L106 (CLI-plugin credential broker), Ch21 L99 (host-delegated auth). All `[binary]` claims were extracted and adversarially re-greped against `app.asar` 1.12603.1 + in-VM ELF `claude-code-vm/2.1.170` + the live `fcache` in this session.

## v2.14.0 — 2026-06-10 (this fork) — Chapter 23 (L106): Desktop CLI-plugin credential broker & the `cli_plugin` dark-launch gate (app.asar 1.11847.5)

New chapter from binary inspection of **Claude.app (Desktop) `app.asar` version 1.11847.5** (main process `.vite/build/index.js`, preload `.vite/build/mainView.js`), corroborated against the live on-disk `fcache` feature store. It documents how a plugin-declared **command-line tool** receives a set-once secret in a sandboxed Cowork session — the **third** Desktop credential channel, complementing Chapter 22 (L105)'s MCP App UI vs elicitation. It also captures *why* a correctly-authored manifest can render **nothing, with no error**.

- **The `clis.*.env` broker.** A `plugin.json` top-level **`clis`** object declares the plugin's CLI tools (keyed by kebab-case binary name). Each entry's **`env{}`** map declares secrets — key snake_case; fields `envVar` (UPPERCASE-validated, reserved names rejected), `secret:bool`, `default` (honored only when `!secret`), `displayName`/`description`. The user enters the value **once** under **Customize → Plugins**; it is stored **safeStorage-encrypted** in config file **`cowork-plugin-env`** (mode 0600, partitioned by `accountId/orgId/pluginId/cliName/envKey/envVar`; getter `qXA`; sibling `cowork-plugin-oauth` for the OAuth variant). At each CLI invocation resolver **`VKr`** injects `{env,token,tokenEnvVar}` (`E = stored.value ?? l.default`; missing → `missing credential: <displayName>. Set it in Settings.`) and merges the CLI's `network[]` into the session egress allowlist (`$Kr`). The shim bridge `gw` (`[cliPluginBridge]`, registered by `maybeRegisterCliPluginBridge`→`GKr` with **no** gate) routes `classifyCliPlugin` guest-requests `OKr`→`PKr` (`classifyInner`). The manifest parses/validates leniently (normalizer `O0`, zod `DUA` `clis:…optional()`, validator `wNi`/`mNi` allow-keys `{displayName,icon,oauth,commands,env,network}`); **env-only entries are valid** — `commands`/`oauth`/`icon` are not required; `secret:true`+`default` is forbidden.
- **The whole pipeline is dark-launched behind one gate.** GrowthBook feature **`2307090146`** (internal name `cli_plugin`), checked by `Xd()` = `isFeatureEnabled("2307090146")` (catch→false), store `zd` from `/api/desktop/features` (`NRi`), disk-cached at `userData/fcache` (8-byte `CLF…` magic + gzip, TTL 1440 min). It is gated in **two** independent places: (1) **renderer** — `pJe()`→`GXr()` begins `if(!await Xd())return{}`, so `clis` is stripped before the claude.ai web UI (the detail page is the web app in the desktop webview) ever sees it; the page then renders only the keys it has (Skills, Hooks). When *on*, `GXr`'s push condition `(I||c.length>0||E!==void 0||u)` includes env-only entries. (2) **runtime** — `VKr` itself is **ungated**, but its only caller `PKr` begins `if(!await Xd())return{errorCode:"oauth_disabled"}`, short-circuiting **before** the `O0` normalizer loads `clis`, before the store read, and before `VKr`.
- **No manual workaround while gated.** A pre-seeded `cowork-plugin-env` value is never read (PKr short-circuits ahead of it); a `secret:false`+`default` never injects (same reason); hand-writing the encrypted file is infeasible (needs the app's OS-keyring `safeStorage` key; `qXA` swallows a bad-decrypt into `[]`). The write IPC `setPluginEnvVars` returns `"Plugin OAuth is not enabled for this account."` when gated. The force-on table `yKi`/`hardcodedMainGrowthBookFeatures` enables `2307090146` **only** for the `type:"3p"` (CCD/custom-gateway) class `cT`, not the standard claude.ai client; CCD separately blocks `setPluginEnvVars` via `xE()` (`"Not available in CCD mode."`). The live `fcache` (2026-06-10) reads `{value:false, off:true, source:"defaultValue"}`.

**Conclusion (the lesson):** the three Desktop credential channels are **MCP App UI form** (L105 — leaks to chat, never for secrets), **elicitation** (L105 — private to the requesting MCP server), and the **`clis.*.env` broker** (L106 — private to a CLI tool, encrypted, injected at invocation, **gated off**). MCP servers collect secrets via elicitation; CLI tools are *meant* to use the broker, but until Anthropic flips `2307090146` an in-VM Cowork CLI must use project `.env` / a key-file on a mounted folder (Ch20/L89). **Methodology:** a server-side GrowthBook gate can strip a `plugin.json` block before render (empty UI, no error) — when a plugin feature "doesn't appear," suspect the **gate** (decode `fcache`), not the manifest, and trace both the renderer build (`pJe`/`GXr`) and the runtime chokepoint (`PKr` ahead of `VKr`).

Edits: new `references/20-desktop-cli-plugin-credential-broker.md` (Chapter 23, L106); `version.json` (`skill_version` 2.13.0→**2.14.0**, lessons 105→**106**, chapters 22→**23**, keywords 1417→**1455**); `plugin.json`, `SKILL.md` (description, intro, index, chapter table); cross-references (L106↔L105/L89/L99/L104, reverse links into L105/L89) + troubleshooting symptom; topic + semantic indexes rebuilt (semantic vocab 1540). Cross-refs Ch22 L105 (sibling credential channels), Ch20 L89 (Cowork split execution), Ch21 L99 (host-delegated auth / OAuth refresh), Ch21 L104 (codename GB-flag triage).

## v2.13.0 — 2026-06-04 (this fork) — Chapter 22 (L105): Desktop MCP-Apps bridge & elicitation (app.asar 1.9659.4)

New chapter from binary inspection of **Claude.app (Desktop) `app.asar` version 1.9659.4** — the first capture of the Desktop **MCP-Apps host bridge** surface. Validates/invalidates a secondhand claim that *"the MCP App UI is read-only in current Claude Desktop."* The binary verdict: **imprecise — half right.**

- **MCP Apps are present and bidirectional, not read-only.** They render in a sandboxed iframe over **Claude's own minimal postMessage/JSON-RPC dialect** (`protocolVersion "2025-11-21"`, host `AppRenderer`/`PostMessageTransport`, injected client `window.app` from `src/scripts/mcp-app-helper.ts`) — **not** the public `@modelcontextprotocol/ext-apps` SDK (`callServerTool`/`serverTools`/`hostCapabilities`/`availableDisplayModes`/`ext-apps`/`skybridge` are **absent from the entire asar**). `window.app` exposes a generic `sendRequest({method,params})` plus working callbacks: `ui/request-display-mode`, `ui/download-file`, `anthropic:attach-files` (userActivation-gated host-side, in-source "PR #31090"), `ui/notifications/size-changed`, and `sendPrompt`.
- **But there is no UI→server tool-call channel, and the only data-return path goes through the chat.** The bridge cluster (~byte 13.3M) contains **zero** `tools/call` (the 39 `tools/call` hits are normal host↔MCP-server plumbing at 0.6M/7M/8M). The sole UI data-return path is `window.sendPrompt(text)` = `app.sendRequest({method:"ui/message", params:{role:"user", content:[{type:"text",text}]}})` (`src/scripts/send-prompt.ts`) — it **injects the text as a user message into the conversation** (model-visible, in the transcript). The built-in reference MCP App (`getImagineServerDef()`, serverName `visualize`, `ui://imagine/show-widget.html`, tools `show_widget`/`read_me`, Cowork/CCD-gated) even submits its own in-iframe elicitation form via `sendPrompt`.
- **Elicitation is the private channel.** The embedded Agent-SDK runtime (`_Wi`) control-request dispatcher handles `subtype:"elicitation"` → `onElicitation({serverName,message,mode,url,elicitationId,requestedSchema,title,displayName,description})` → `{action,content}` returned **as the response to the server's `elicitation/create` request** (auto-`{action:"decline"}` if the host wired no handler), sitting beside `can_use_tool`/`hook_callback`/`mcp_message`/`oauth_token_refresh`/`host_auth_token_refresh` (L99). The bundled MCP SDK supports **`form` and `url`** modes (gated on `clientCapabilities.elicitation.form`/`.url`), validates accepted `content` against `requestedSchema`, and exposes `notifications/elicitation/complete` (url mode); `ElicitResult.action` = `accept|decline|cancel`. (`elicitation/create` ×32, `onElicitation` ×6.)

**Conclusion (the lesson):** an MCP App UI returns data **only via the chat**; **elicitation** is the only host mechanism that returns user input **privately to the requesting server**. Any MCP server or `mcp-bash` skill collecting a secret in Desktop/Cowork must use **elicitation**, never an MCP App UI form.

Edits: new `references/19-desktop-mcp-apps-elicitation.md` (Chapter 22, L105); `version.json` (`skill_version` 2.12.2→**2.13.0**, lessons 104→**105**, chapters 21→**22**, keywords 1373→**1417**); `plugin.json`, `SKILL.md` (description, intro, index, chapter table); cross-references (L105↔L89/L99/L95) + troubleshooting symptom; topic + semantic indexes rebuilt (semantic vocab 1518). Cross-refs Ch20 L89 (Cowork split execution), Ch21 L99 (same control-request dispatcher), Ch21 L95 (hook master array).

## v2.12.2 — 2026-06-03 (this fork) — Cowork credential/filesystem propagation: split execution model

Empirically tested in a real desktop Cowork session, cross-checked against CLI v2.1.160 + `Claude.app` app.asar. Answers "how do I get an API key (Airtable/Affinity, a non-MCP CLI) into Cowork sessions" — and corrects an earlier claim of this skill's in the process.

**Cowork has a split execution model:**

- **The in-VM agent shell (`mcp__workspace__bash`) is sealed from all host env.** Tested empty in-VM: the `env` field of `~/.claude/settings.json` (user scope) *and* `/Library/Application Support/ClaudeCode/managed-settings.json` (managed scope) — even though the standalone CLI reads both. Hooks `export` and host shell env are likewise blocked (prior finding). The host→session env is built by `Ucr({oauthToken, apiHost, shellPath, subscriptionType})` (`sessionEnv`) — **Anthropic-auth-only, not user-controllable**; the local-agent session-config schema `{skills, mcpServers, hooks, agents, clis}` has no `env` field.
- **stdio MCP servers in `~/Library/Application Support/Claude/claude_desktop_config.json` run HOST-side** — spawned by the Desktop (Electron) app via a login shell, bridged into Cowork as `mcp__<server>__*` tools, and they receive the **full host env**. Proven with a `cowork-probe` (`@modelcontextprotocol/server-everything`) entry whose `get-env` in a Cowork session returned macOS host paths (`/opt/homebrew/.../node`, `darwin arm64`, full host shell `PATH`) plus the per-server `PROBE_MARKER` from its `env:` block. **This corrects the v2.12.1-era "import-only" read of `claude_desktop_config.json`** — that was true only for the CLI binary; the Desktop app genuinely reads `mcpServers` from it.
- **MCP env-allowlist mechanism resolved** (`CLAUDE_CODE_MCP_ALLOWLIST_ENV` → `RW8` gate → `{...oG8(), ...ilH()}` vs `dk()`): `oG8()` copies only `LU5 = {HOME, LOGNAME, PATH, SHELL, TERM, USER}`; the per-server `env:` block (`ilH()`) is always merged; `dk()` is the full passthrough when off. It governs **CLI-spawned** servers only, **not** the Desktop-host-spawned `claude_desktop_config.json` ones.

**"Always-mounted path" = a Cowork Project (= the code's `CoworkSpace`)** — proven by the binary string `Space "${n}" not found. Use list_projects to see available spaces`. There is no free-form "always mount path X" config key; per-spawn mounts derive from `userSelectedFolders` + app dirs (the auto-mounted `.claude` is a per-session synthesized dir from `getClaudeConfigDir()`, *not* `~/.claude` — why settings `env` never reaches the VM). A folder-bound Project (`ProjectLocal`, `ccdFolderPath` + `autoMountFolders`, stored server-side) auto-mounts its folder for every session started in it — the channel for handing a secrets file to a **non-MCP in-VM CLI**. `localAgentModeTrustedFolders` is trust/auto-approval, not auto-mount.

Edits: **lesson 17** (new "Split execution: host-side MCP servers vs the sealed in-VM shell" subsection + credential-routes table + Project=Space note; two `settings.json env` rows added to the `coworkroot-probe` table; a v2.1.160 version note correcting the v2.1.120 "5-var" BG-context strip to the current **12-var** delete-chain), **L61** (filled in the previously-undocumented allowlist mechanism), **L99** (added the `sessionEnv = Ucr(...)` desktop-side corroboration). Search indexes rebuilt.

## v2.12.1 — 2026-06-01 (this fork) — L89: in-VM `${CLAUDE_PLUGIN_ROOT}` resolution + host↔VM boundary tested

Closes the verification gap the v2.11.18 L89 correction left open. The v2.11.18 canary proved only that a plugin's `SessionStart` hook **executes host-side** and that its `additionalContext` **reaches the model** — it said nothing about whether a hook's *side effects* reach the in-VM agent shell (`mcp__workspace__bash`). A dedicated probe (`coworkroot-probe`, installed via the Cowork app UI, run in a real desktop session) settled the rest:

- **`${CLAUDE_PLUGIN_ROOT}` is host-side everywhere** — it substitutes to the same `claude-hostloop-plugins/<hash>` host staging path in *skill content* as in *hook commands*. It is **not** context-dependent, and is therefore **useless for in-VM script invocation** (the path doesn't exist in the sandbox).
- **Plugin files are mounted in-VM at a remapped path:** `/sessions/<id>/mnt/.remote-plugins/plugin_<id>/…` (org-remote/RPM installs) or `.local-plugins/cache/<mp>/<plugin>/<ver>` (marketplace). `plugin_<id>` is install-specific — discover at runtime, don't hardcode.
- **Neither a hook's `export` nor its host `/tmp` writes cross into the VM.** Any skill relying on a `SessionStart` hook to export an env var or stage a file for the in-VM agent silently breaks in Cowork (same bug class as a host-injected `$VAR` contract that works in single-process CCD).

Added as a new L89 subsection ("What the hook-firing test did NOT prove…") with a results table and skill-author guidance. Probe harness + runbook live in `docs/internal/cowork-pluginroot-probe/` (not shipped in the skill package).

## v2.12.0 — 2026-06-01 (this fork) — Chapter 21 (L91–L104): the v2.1.139→v2.1.159 gap

New chapter (`references/18-verified-new-v2.1.159.md`) covering 14 lessons from the v2.1.138→v2.1.159 binary delta, CHANGELOG-crosschecked: Dynamic Workflows (Workflow tool, 1000-agent cap, journal-resume, workflow-keyword trigger) + coordinator mode; Opus 4.8 launch (new default; low|medium|high|xhigh|max effort ladder; 4.8 defaults high); streaming-tool-execution GA (gate deleted); **MessageDisplay as the 30th master-array hook event** (correcting the old 27/19 counts); auto-mode promotion to default + repo-spoof guard; Cloud gateway OAuth provider; org-managed skills/plugins sync from Console + CLI-as-skill; host-delegated credential refresh; background binary-takeover self-upgrade + Fleet→agent-view rename; `/loop` keepalive; plan-interview removal + `CLAUDE_MEMORY_STORES` team-memory multistore + command churn (`/commit` + `/commit-push-pr` removed, `/usage-credits`, dark `/wellbeing`); `PEWTER_OWL` gate over the internal `SendUserMessage` tool; ~30 new codename GB-flag triage. Lesson count 90→104, chapters 20→21. Search/xref/troubleshoot/topic+semantic indexes rebuilt for the new lessons; README brought current (v2.12.0 / 104 lessons / v2.1.159). Authoring basis: `docs/internal/{deep-dive,update-plan}-2.1.159.md`.

## v2.11.18 — 2026-06-01 (this fork) — L89: retract + RESOLVE the Cowork plugin-hook mechanism

**Retracts** the v2.11.16 claim that plugin hooks "never fire in Cowork *because* `--setting-sources=user` excludes plugin scope." Tested directly against CLI 2.1.159: `claude --plugin-dir <p> --setting-sources=user -p "hi"` **fires** the plugin's `SessionStart` hook and resolves `${CLAUDE_PLUGIN_ROOT}` — plugin hooks flow through the plugin-enablement pipeline (`loadPluginHooks`), not settings-source resolution. **RESOLVED** via a real-Cowork test: a canary installed through the **Cowork app UI** fired its hook in a live desktop session. The true determinant is the **three-root plugin namespace** — a desktop Cowork session reads only `local-agent-mode-sessions/<acc>/<org>/cowork_plugins/cache` (+`rpm/`), which the standalone-CLI `--cowork` install does not reach; the desktop **host loop** symlinks each enabled plugin into a temp `claude-hostloop-plugins/<hash>` dir and runs hooks host-side. The original "zero hook lines" observation was real but its mechanism explanation was wrong: the hook-bearing plugins simply weren't in the desktop namespace. (Companion gist `303b6213` carries the same correction.)

## v2.11.17 — 2026-06-01 (this fork) — Correction pass + `diff-versions.sh` hardening

Correction pass reconciling earlier chapters against the v2.1.159 binary: Streaming Tool Execution noted as **unconditional GA** (gate deleted upstream); fixed the "19 hook event types" diff-tool artifact (the master array has **30** events, MessageDisplay being the 30th); `CLAUDE_CODE_LEAN_PROMPT` noted as the lean-prompt default with `tengu_vellum_lantern` removed. Hardened `scripts/diff-versions.sh` against four artifact classes discovered while diffing 2.1.138→2.1.159: hook-event undercount (dropped the suffix allowlist → match all PascalCase anchored on `"PreToolUse"`), slash-command misses (added backtick + dynamic `get description(){…}` matching), env-var false positives (added `extract_env_reads` + a ⚠-verify advisory and a routine-reclassification note). See the `feedback_diff_tool_false_positives` methodology memory.

## v2.11.16 — 2026-05-10 (this fork) — Documents Cowork plugin-hook exclusion via `--setting-sources=user` — ⚠️ SUPERSEDED by v2.11.18 (mechanism retracted)

A separate Cowork-runtime behavior worth documenting alongside the L89 tool-architecture story, because it surprises plugin authors the same way: **plugin hooks declared in a plugin's `hooks/hooks.json` never fire in Cowork sessions**, while plugin skills/commands/MCP servers do still load. Surfaced from a userconfig-probe SessionStart hook that empirically didn't fire (verified by `find` on host + VM, plus zero hook references in 8MB of recent `cowork_vm_node.log` activity).

### Mechanism

The desktop launches the in-VM CLI with `--setting-sources=user`, restricting settings resolution to user scope (`~/.claude/settings.json`). Plugin-scoped hooks live in plugin scope and are silently excluded. Verified empirically by inspecting the `[Spawn:create]` line in `~/Library/Logs/Claude/cowork_vm_node.log` — `--setting-sources=user` is in the args. Per-plugin `--plugin-dir` args are also passed, which is why skills/commands/MCP still load.

### Upstream tracking

- [#16288](https://github.com/anthropics/claude-code/issues/16288) — general CLI race condition: hook dispatchers in `runAgent` (and elsewhere) call hook execution without `await loadPluginHooks()` first. Affects CCD intermittently.
- [#27398](https://github.com/anthropics/claude-code/issues/27398) — Cowork-specific scope exclusion, closed as dup of #16288. Even when #16288's race is fixed, Cowork plugin hooks won't fire because the `--setting-sources=user` flag excludes them at scope-resolution time.

Two distinct bugs that interact. Cowork hits both — fixing the CLI race wouldn't help Cowork until the launch flag is changed too.

### Reported impact (from issue thread)

- `Stop` and `SubagentStop` hooks for telemetry / cleanup never fire in Cowork.
- `PostToolUse` matchers on `Skill` (e.g., for org-level skill-adoption tracking) silently no-op in Cowork.
- `UserPromptSubmit` works in some configs (CCD with the race not biting) but not in Cowork.

### Workaround

Move hooks from the plugin's `hooks/hooks.json` to `~/.claude/settings.json` (user scope). Loads in both Cowork and CCD. Breaks plugin-author UX (users have to manually add hook declarations) but it's the only path that fires hooks in Cowork today.

### What changed in the lesson

- New L89 subsection "Plugin hooks don't fire in Cowork sessions" inserted between "What the CLI's async sub-agent filter actually does" and the v2.11.3 archaeology block.
- New Risks Worth Flagging entry #9 (concise version of the subsection).
- Cross-references the `userconfig-probe` plugin from earlier in this conversation as a concrete example: the probe's SessionStart hook was correctly designed but doesn't fire in Cowork — not because of the plugin, but because of the platform's launch flag.

### Companion gist

Same content added to gist 303b6213, framed generically (no project-specific references). Pairs with the existing "Sub-agent tool-grant filtering" section as a second Cowork-platform-quirk skill authors should know about.

---

## v2.11.15 — 2026-05-10 (this fork) — L89 third pass: clean-lead framing replaces accreted corrections

The v2.11.3 → v2.11.13 → v2.11.14 chain accreted layered correction callouts that left the L89 section harder to read than the underlying facts warranted. v2.11.15 replaces the section's lead with the clean simple story.

### What changed

The section's narrative now leads with: **"Cowork has no built-in `Bash` tool. At any dispatch level. Period."** — and explains derivatively. Old "two-layer gate" framing carried sub-agent-centric structure inherited from the original incident. New structure starts with the user-visible fact, explains why `SKILL.md` works without `allowed-tools` (main thread has `ToolSearch` immediate + `mcp__workspace__bash` deferred, the model figures out the dispatch), explains why a narrow sub-agent tools-list declaration fails (literal `Bash` name doesn't resolve, `Task` canonicalizes to `Agent` which is in the sub-agent drop set, `mcp__workspace__bash` isn't declared), then dives into mechanism for readers who want it.

### New subsection: "What the founder-skills v0.3.0 incident actually was"

Documents the actual mechanism the original investigation hit, in the project's own terms: the sub-agent declared `tools: ["Read", "Bash", "Task", "Glob", "Grep"]`. Bash and Task are no-op names in Cowork. Resolution to `{Read, Glob, Grep}` was correctly observed empirically; the attribution ("Cowork strips Bash from sub-agents") was wrong. The fix (`Write`/`Edit`) was correct for the use case but unrelated to "Bash filtering." Cross-references the team's v0.4.x architecture writeup with a note that the rationale documented there needs updating: the v0.4.1 architecture is right, but for slightly different reasons than the team thought.

### Removed: layered correction callouts

The v2.11.13 + v2.11.14 callouts at the top of the section are replaced with a single short "History — corrected three times" paragraph. The mechanically wrong v2.11.3 trace text is no longer mixed into the corrected lead — it's marked as archaeology and structurally separated.

### Operational contract: unchanged

The five-constraint `mcp__workspace__bash` operational contract section (introduced v2.11.14) is preserved verbatim — those constraints didn't change with the framing rewrite.

### Companion gist (303b6213): same clean-lead pass

Top-of-gist correction callout simplified. "Sub-agent tool-grant filtering" section reorganized to lead with the simple story rather than incrementally correcting prior framing. The deferred-tool-tier and operational-contract subsections preserved from v2.11.14.

---

## v2.11.14 — 2026-05-10 (this fork) — L89 scope-corrected: Cowork-wide, not sub-agent-specific + `mcp__workspace__bash` operational contract documented

A second-round correction to v2.11.13's L89 update. v2.11.13 fixed the mechanism (host-loop substitution in the desktop bundle is the gate, not the CLI's async sub-agent filter). v2.11.14 fixes the scope: the gate is **Cowork-wide**, not sub-agent-specific. Plus: documents `mcp__workspace__bash`'s operational contract (the five constraints skill authors hit when moving CCD skills into Cowork) — none of which the prior versions captured.

### Corrected — scope was wrong in v2.11.13

v2.11.13 said sub-agents in Cowork have no built-in `Bash` and pointed to the desktop's `HOST_LOOP_EXCLUDED_BUILTIN_TOOLS = [Bash, NotebookEdit, REPL, JavaScript, WebFetch]` as the gate. That's correct — but v2.11.13 implied (via the section title "Sub-Agent Tool-Grant Filtering" and several subsections framed around sub-agent dispatch) that top-level Cowork sessions still have built-in Bash and only sub-agents lose it. Empirically that's wrong: a top-level Cowork main session probed in v2.1.121-bundled CLI also has no built-in Bash in either tier.

The actual asymmetry between top-level and sub-agent is exactly **one tool**: top-level has `Agent` (so the model can dispatch sub-agents); sub-agents don't have `Agent` (no nested dispatch). Both have:
- The same ~10-name immediate tier: `Edit, Glob, Grep, Read, Skill, ToolSearch, Write` + visualize-MCP tools (top-level adds `Agent`).
- The same broad deferred tier: `WebSearch`, `AskUserQuestion`, all `mcp__cowork__*`, all `mcp__workspace__*` (including `mcp__workspace__bash`), all `mcp__skills__*`, all connector tools (Slack, Notion, Gmail, etc.).

The CLI's async sub-agent filter (`Tw8`/`LW8`) does still apply differential drops to sub-agents — `AskUserQuestion`, `Agent`, `ExitPlanMode`, `EnterPlanMode`, `TaskOutput`, `WaitForMcpServers` are dropped at async dispatch. But none of those are Bash. The Bash question is settled by Layer 1 (host-loop registration) for both dispatch levels.

### New — `mcp__workspace__bash` operational contract subsection

The actual constraints skill authors hit (none of these were in v2.11.3 or v2.11.13):

1. **No cwd or env carryover between calls.** Each `mcp__workspace__bash` invocation is independent. Multi-step pipelines must chain (`&&` / `;`) into one command or use absolute paths in every step. Skills with `cd foo` followed by another call expecting cwd=`foo` are broken in Cowork.

2. **Skill files mount under `/sessions/<id>/mnt/`, not at host paths.** A SKILL.md saying `python3 scripts/foo.py` doesn't work as written — `scripts/foo.py` doesn't exist in the VM's filesystem. The skill needs `cd /sessions/<id>/mnt/.claude/skills/<skill>/ && python3 scripts/foo.py` (chained into one call) or absolute mount path. Hard-coded host paths (`/Users/yaniv/...`) fail in the VM.

3. **`/sessions/<id>/mnt/outputs/` is the only persistence boundary.** Maps to host's `~/Library/Application Support/.../outputs/`. Files written elsewhere in the sandbox (`/tmp/`, `~`, scratch dirs) vanish at session end and aren't visible to the user during the session either.

4. **`pip install` requires `--break-system-packages`** (PEP 668).

5. **Linux aarch64 Ubuntu inside the VM, regardless of host OS.** Platform-specific shell idioms — `pbpaste`, BSD `sed -i ''` vs GNU `sed -i`, `open` vs `xdg-open` — don't translate. CCD-mode skills using macOS-specific tooling break in Cowork.

6. **Out of scope: native-Mac driving.** Skills opening native macOS apps, controlling the desktop, driving Adobe apps go through *different* MCP servers, not `mcp__workspace__bash`.

7. **VM dependency.** When the platform VM service fails, this MCP tool dies with `Workspace unavailable. The isolated Linux environment failed to start.` File-op tools (Read/Write/Edit/Glob/Grep) keep working — they don't depend on the VM. See [GH#56772](https://github.com/anthropics/claude-code/issues/56772) for the Windows-specific autostart failure.

### Section reorganization

L89 was renamed from "Sub-Agent Tool-Grant Filtering: How Cowork-Async Dispatch Silently Strips Bash" to "Cowork's Tool Architecture: Why `Bash` Isn't Where You Expect It (And Where It Is)" — both for accuracy and because the original title primed readers to look for sub-agent-specific mechanisms. The two correction-callouts at the top (v2.11.13 round 1 + round 2) are consolidated into one paragraph documenting the full timeline. The Two-layer-gate section is rewritten as Cowork-wide. The Layer 1 (desktop) and Layer 2 (CLI) subsections are absorbed into the new structure. The `mcp__workspace__bash` operational contract is a new section right after Layer 1, before the historical-archaeology Layer 2 trace.

Implications section rewritten: three working paths (declare `mcp__workspace__bash` and use ToolSearch; persist via `Write`/`Edit`; move shell-bound work to top session) but with the v2.11.13 framing corrected — top session also lacks built-in Bash, so "move to top" doesn't give you Bash, it just absorbs work into parent context. Risks Worth Flagging items 6-7 split into 6 (no-built-in-Bash, Cowork-wide), 7 (operational contract), 8 (deferred-tier discovery via ToolSearch).

### Companion gist (303b6213)

Same scope correction applied. The "Sub-agent tool-grant filtering" section reframed as Cowork-wide. New subsection on the deferred-tool tier with the actual immediate-set list. New subsection on the operational contract. Mermaid diagram revised to show host-loop registration applying to top-level + sub-agent symmetrically.

---

## v2.11.13 — 2026-05-09 (this fork) — L89 sub-agent-tool-grant trace corrected (mechanism was wrong, empirical was right) + new MCP-bash deferred-tool path

A round of fresh probing across two Claude Code CLI versions and a real Cowork session surfaced a load-bearing error in the v2.11.3 trace, which v2.11.4 through v2.11.12 carried forward. The empirical claim ("Bash unavailable in Cowork sub-agents") stays correct. The mechanism explanation gets replaced.

### Corrected — L89 "Sub-Agent Tool-Grant Filtering"

**What v2.11.3 said:** the `Tw8` async filter strips `Bash` because `Dq = "Bash"` is not in the `Jl_` allowlist. **What's actually true:** `Dq` was the wrong symbol to grep for. Bash's symbol is `wq` (v2.1.119) / `Vq` (v2.1.138), and it reaches `Jl_`/`Ys_` indirectly via the spread member `VW = [wq, D9]` / `$2 = [Vq, h9]` (which the original trace marked as "spread, contents not enumerated"). Re-extraction:

```
v2.1.119: VW = [wq="Bash", D9="PowerShell"];   jQ_ = new Set([..., ...VW, ...])
v2.1.138: $2 = [Vq="Bash", h9="PowerShell"];   Ys_ = new Set([..., ...$2, ...])
```

`Bash` IS in the async allowlist in both versions. The async filter is not the gate.

**The actual gate is one layer up, in the desktop bundle** (`/Applications/Claude.app/Contents/Resources/app.asar` → `.vite/build/index.js`):

```js
HOST_LOOP_EXCLUDED_BUILTIN_TOOLS = jie = ["Bash", "NotebookEdit", "REPL", "JavaScript", "WebFetch"]
HOST_LOOP_SAFE_BUILTIN_TOOLS     = zvt = ["Task", "Glob", "Grep", "Read", "Edit", "Write", ..., "Skill", "AskUserQuestion", "ToolSearch", "SendUserMessage"]
PTi(tools) = tools.filter(t => t.startsWith("mcp__") || zvt.includes(t))
```

In Cowork mode, the desktop applies `PTi` to the registered built-in tool set before handing it to the SDK. `Bash` is in `jie` and not in `zvt`, so it's stripped at registration time. The CLI's `LW8`/`Ys_` filter never sees a Bash tool object — the question of whether `Ys_.has("Bash")` is true is moot.

The desktop's `workspace` MCP server registers replacements:

```
psi = `mcp__${WB="workspace"}__${Qy="bash"}`         // "mcp__workspace__bash"
msi = `mcp__${WB="workspace"}__${Kv="web_fetch"}`    // "mcp__workspace__web_fetch"
```

This filtering is **Cowork-mode only**. CCD mode (host CLI without `--cowork`) does NOT apply `jie`/`PTi`/`zvt`. Empirically re-confirmed: Task-dispatched async sub-agent on host CLI v2.1.138 (parent set to `CLAUDE_CODE_SESSION_KIND=bg`, response carries SendMessage continuation token confirming async dispatch) sees Bash and runs `echo PROBE_MARKER_<uuid>` successfully. Cowork's filtering is desktop-side and platform-bound.

### New — `mcp__workspace__bash` deferred-tool path

A finding the v2.11.3 documentation missed entirely. Cowork sub-agent tool availability has two tiers:

- **Immediate** — schema loaded, callable directly.
- **Deferred** — name visible in the registry, schema loaded on demand via `ToolSearch`. Direct invocation fails with `InputValidationError` until ToolSearch loads the schema.

Empirical re-probe in actual Cowork: a Task-dispatched general-purpose sub-agent reports `[Edit, Glob, Grep, Read, Skill, ToolSearch, Write]` immediate plus `mcp__workspace__bash` and `mcp__workspace__web_fetch` deferred. The original v2.11.3 probe didn't enumerate the deferred tier and concluded "shell unreachable from sub-agents" — it isn't, just deferred.

This means **a third working path exists** for shell in Cowork sub-agents, on top of the two v2.11.3 documented:

1. **Use `mcp__workspace__bash` from the sub-agent itself.** Declare it in the agent's `tools:` frontmatter (literal exact match — agent declarations don't accept `mcp__server__*` wildcards), invoke `ToolSearch` from inside the sub-agent to load its schema, then call. Runs in the workspace VM with user folders mounted under `/sessions/<vmProcessName>/mnt/`.

2. **Persist via `Write` / `Edit`** (v2.11.3 path). Reaches user's real filesystem; portable across Cowork and CCD without VM dependency.

3. **Move shell-bound work to the top Cowork session** (v2.11.3 path). Cost: parent context absorbs intermediate work.

### VM dependency caveat

`mcp__workspace__bash` is backed by the platform VM (Apple Hypervisor on macOS, Hyper-V via `CoworkVMService` on Windows). When the VM service fails to start, this MCP tool dies with `Workspace unavailable. The isolated Linux environment failed to start.` File-op tools (Read/Write/Edit/Glob/Grep) keep working because they don't depend on the VM. See [GH#56772](https://github.com/anthropics/claude-code/issues/56772) for the Windows-specific autostart failure mode.

### Companion gist (303b6213)

Same corrections applied to the public-facing gist:
- Mermaid diagram of `Jl_` allowlist contents was technically a correct subset but mislabeled — it's "what survives the async filter," not "what the sub-agent sees in Cowork." Two-layer model added.
- "Cowork caveat" reworded — `Bash` isn't a registered tool name in Cowork (Layer 1 strips it + substitutes `mcp__workspace__bash`), not "filtered by the async filter."
- Workarounds section gains the `mcp__workspace__bash` + ToolSearch path as a peer to Write/Edit and top-session-shell.
- Symbol-trace verification line pins to behavioral anchors and includes both bundles' identifiers (desktop: `jie`/`zvt`/`PTi`; CLI: `LW8`/`Ys_` v2.1.138, `gz8`/`jQ_` v2.1.119).
- New "Cowork's deferred-tool tier" subsection.

### Risks Worth Flagging — added entry

When probing a sub-agent's tool availability, enumerate BOTH the immediate set AND the deferred tier (via `ToolSearch`). Tools absent from the immediate list may still be callable. `mcp__workspace__bash` is the canonical example.

### Verified-against-binary bumped

`verified_against_binary` field in `version.json` now reads `CLI 2.1.138 + Claude.app 1.6259.1 (cross-checked against CLI 2.1.119 + Claude.app 1.5354.0)`. The two-version cross-check is what allowed identifying the spread member as the wrong-trace root cause.

---

## v2.11.12 — 2026-05-02 (this fork) — Cowork+scope rejection caveat; toggle-off/on guidance tightened

External Codex round caught two real issues that the previous rounds missed:

### Added — Cowork-specific scope rejection caveat (L26)

The CLI rejects `--cowork` combined with any non-`user` scope. Verified in both v2.1.121 (Desktop-pinned) and v2.1.126 (standalone): `--cowork can only be used with user scope` aborts the command. Found 6+ call sites (install, uninstall, update, enable, disable, prune all carry the same check).

So while the CLI nominally supports `-s, --scope <user|project|local|managed>` on `plugin update`, manually running `claude plugin update <id> --scope project --cowork` is NOT a valid workaround for keeping a project / local / managed Cowork install fresh. The org-level (user-scope) install in the active Cowork root is what `claude plugin update` and Desktop's Update button actually advance; project / local / managed-scoped Cowork installs are difficult to keep up to date through any standard path. Documented as a caveat in L26 v2.11.12 under the existing `--scope` discussion.

### Companion gist tightens

Three more gist passages tightened that the v2.11.11 round didn't catch:

1. **"Practical consequence" paragraph in the live-updates section** said Settings UI Refresh / Update / Enable / Disable / Install / Uninstall buttons "remain useful for advancing on-disk state and refreshing the org-plugin MCP layer." Misleading: only enable/disable, uninstall/delete, and the local-upload install path fire `refreshPluginMcps`. Refresh marketplace, Update plugin, and the main Install IPC do not. Reworded.

2. **Short-version playbook recipes** (classic and backend) suggested toggling the plugin off/on as a recovery for "still shows old content." This implies toggle off/on fixes general staleness — it doesn't. Toggle off/on does fire `refreshPluginMcps`, but that only reconciles org-plugin MCP connections, not skills/commands/agents/hooks. Reworded both recipes to recommend `+ New task` directly and de-emphasize toggle off/on with the explicit MCP-only caveat.

3. **Added Anthropic-managed-skills caveat to the "new task" guidance** — even a fresh Cowork task can stay stale until the `skills-plugin` cache is repaired (per v2.11.8's silent-stale failure mode for built-in skills like `pdf` / `xlsx`). Worth flagging at the recovery-recommendation level so users don't assume "+ New task" universally fixes staleness.

### Files changed

- `skill-package/skills/claude-code-internals/references/04-connectivity-plugins.md` — Cowork+scope rejection caveat added under the existing `--scope` discussion in the Desktop-side cross-check
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `note`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `CLAUDE.md` — pinned skill version updated
- `CHANGELOG.md` — this entry

### Methodology takeaway

The `--cowork` + scope-rejection finding is a small but operationally significant fact that the bundle makes very explicit (literal abort message, 6+ call sites). It would have been visible in any earlier round if the question "what happens if I combine --cowork with --scope project?" had been asked. The lesson here is the same as several earlier rounds: when documenting a flag's accepted values, don't just list the schema — also enumerate which combinations the CLI actively rejects at runtime. Rejection paths are part of the API surface.

---

## v2.11.11 — 2026-05-02 (this fork) — refreshWarning precision + gist guidance cleanup

External Codex round on v1.5354.0 + v2.1.121 + v2.1.126 caught one residual L26 imprecision and two gist regressions.

### Corrected (L26)

L26 v2.11.10 said the CLI "captures this internally as a `refreshWarning` field on its update result." More precise per Codex: the warning text is captured in a local variable and **concatenated into the update-result message string**, not exposed as a structured field. Desktop's stdout parser only extracts the `from X to Y` version pattern and discards the rest. The practical conclusion is unchanged — Desktop hides marketplace refresh failures during update — but the mechanism description was off.

### Companion gist updates

Same `refreshWarning` precision fix applied to the public gist, plus two more issues fixed:

1. **Two passages still implied Settings → Refresh and Settings → Update fire `refreshPluginMcps`.** v2.11.10 corrected the L26 enumeration but missed two equivalent claims in the gist's "Why Claude keeps using an old plugin" item #15 and the "Practical stale-update checks" decision tree step 7. Both rewrote to: "Refresh and Update do NOT fire `refreshPluginMcps()`; only enable/disable, uninstall/delete, and local-upload variants do. For org-plugin MCP reconnect, toggle the plugin off/on. For skills/commands/agents/hooks freshness, no IPC op refreshes a running task — start `+ New task`."

2. **Duplicate H1 lines at the top of the gist.** Regression from `gh gist edit` operations that occasionally re-prepend the description line. Re-stripped — gist now opens directly with the H1.

### Files changed

- `skill-package/skills/claude-code-internals/references/04-connectivity-plugins.md` — `refreshWarning` paragraph tightened
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `note`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `CLAUDE.md` — pinned skill version updated
- `CHANGELOG.md` — this entry

### Methodology takeaway

When an external review surfaces "X overstates Y" and you fix it in one location, grep for the exact phrasing across every artifact. v2.11.10 fixed the `refreshPluginMcps` enumeration in the L26 cross-check section but two earlier-written paragraphs in the gist's troubleshooting table and decision tree carried the same claim under different wording. "Settings UI op fires the refresh" appeared in three distinct places; one fix didn't propagate. For any future correction, run a cross-document `grep` for the wrong claim's various paraphrases before declaring the fix complete.

---

## v2.11.10 — 2026-05-02 (this fork) — refreshPluginMcps() call-site enumeration corrected

External Codex review against v1.5354.0 + v2.1.126 caught a real overstatement in v2.11.8: the L26 lesson (and the public gist) said `refreshPluginMcps()` is invoked from "every state-mutating plugin op (~10 call sites: install / update / uninstall / setPluginEnabled / deletePlugin / etc.)". Bundle re-trace by enumerating all 7 `refreshPluginMcps()` call sites under their containing dispatcher operations shows that's wrong.

### Corrected

`refreshPluginMcps()` is invoked from a **specific subset** of dispatcher operations:

- `installPluginFromZip` (local-upload install path — different from the main `installPlugin` IPC handler)
- `deletePlugin` (custom delete)
- `setPluginEnabled` (local enable/disable)
- `setRemotePluginEnabled` (RPM enable/disable)
- `uninstallPlugin` (both the RPM remote-API path and the non-git fallback)
- `installLocalOrgPlugin` (local org-plugin install)

**Notably absent: the main `installPlugin` IPC handler and `updatePlugin`.** Neither calls `refreshPluginMcps()` after the operation completes — not on the RPM/remote-API path, not on the classic CLI fallback. Clicking Settings → Install or Settings → Update does NOT fire the org-plugin MCP refresh; only enable/disable, delete, uninstall, and the local-upload variants do.

This matters operationally: a user (or a downstream debugging tool) who runs Settings → Update expecting an MCP-connection refresh against the newly-installed plugin version will not get one. The Cowork task's MCP connections to that plugin will keep using whatever they had before the update. Toggle the plugin off/on (which DOES call `refreshPluginMcps`) to force the reconnect, or — for skill / command / agent / hook content, where MCP refresh wouldn't help anyway — open `+ New task` for a fresh `local_<UUID>/` session.

### Files changed

- `skill-package/skills/claude-code-internals/references/04-connectivity-plugins.md` — `refreshPluginMcps` subsection rewritten with the actual call-site list and the explicit "absent from install/update" call-out
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `note`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `CLAUDE.md` — pinned skill version updated
- `CHANGELOG.md` — this entry

### Methodology takeaway

The original v2.11.8 framing came from counting `refreshPluginMcps()` call sites in the bundle (10 hits) without grouping them by dispatcher op. Several hits were inside the `refreshPluginMcps` definition + `doRefreshPluginMcps` body itself, not call sites. Of the 7 actual call sites, 0 are in `installPlugin` or `updatePlugin`. "Number of grep matches" is not the same as "number of distinct dispatcher operations that fire the function" — for any future bundle-trace claim of "this is called from N places," enumerate the containing functions, don't just count regex hits.

---

## v2.11.9 — 2026-05-02 (this fork) — Cowork uses Desktop-pinned VM binary, not standalone CLI on PATH

Methodology correction surfaced by external Codex round comparing v2.1.121 (Desktop-pinned) and v2.1.126 (standalone on PATH). Earlier rounds of the Desktop trace had implicitly conflated "the Cowork CLI" with "the standalone CLI on PATH" — that's wrong any time Desktop is pinned to a different version.

### Added — Cowork-binary methodology callout

Claude Desktop pins and manages its own VM-side Claude Code binary at:

```text
~/Library/Application Support/Claude/claude-code-vm/<sdk-version>/claude
~/Library/Application Support/Claude/claude-code-vm/.sdk-version    # records the pinned version
```

At audit time Desktop is pinned to **v2.1.121** while standalone `claude` on PATH is **v2.1.126**. They diverge because Desktop pins SDK versions on its own release cadence and doesn't auto-bump when the user updates the standalone CLI.

For tracing:

- **Cowork-internal behavior** (in-VM `claude plugin <op>`, `skipIfRecent`, the per-source-type badge resolution invoked via VM CLI runners, the `_syncSkills` flow if it runs in-VM) → trace against the Desktop-pinned binary.
- **Standalone-CLI behavior** (`claude plugin <op>` from a regular terminal outside Cowork) → trace against the binary on PATH.
- **Desktop main-process behavior** (IPC handlers, native engine, badge computation, sync orchestration) → trace against `app.asar`'s `.vite/build/index.js`.

For most claims in the lesson and trace doc, v2.1.121 and v2.1.126 behavior matches — the codepaths haven't materially diverged for plugin management between those two patch versions. But anyone tracking down a Cowork-specific behavior that doesn't reproduce against the standalone CLI should extract the pinned binary directly.

### Corrected

**L26 `refreshWarning` claim was wrong.** v2.11.8 said the CLI's `refreshWarning` field "propagates back to Desktop, but Desktop's UI doesn't typically surface it prominently." Bundle re-trace shows Desktop's `updatePlugin` IPC wrapper does NOT propagate `refreshWarning` at all — it returns only `{ success, pluginId, oldVersion, newVersion, alreadyUpToDate }`. The refresh warning is captured by the CLI internally and appears only in the CLI's own log output; nothing calling Desktop's IPC sees it.

### Files changed

- `skill-package/skills/claude-code-internals/references/04-connectivity-plugins.md` — Cowork-binary methodology callout added to "Desktop-side cross-check (v1.5354.0)"; `refreshWarning` propagation claim corrected
- `docs/internal/desktop-bundle-trace-v1.5354.0.md` — new "Methodology note" section at the top covering the Cowork-pinned-binary distinction with extraction snippet
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `note`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `CLAUDE.md` — pinned skill version updated; added Cowork-VM v2.1.121 to the binary list
- `CHANGELOG.md` — this entry

### Methodology takeaway

The pinned-VM-binary distinction is a real Claude Cowork architectural fact that Anthropic's docs don't emphasise: the binary that runs inside Cowork's microVM is NOT necessarily the same as the binary on the user's PATH. Anyone reverse-engineering Cowork's behavior who doesn't know this could spend hours tracing the wrong binary against bugs that only reproduce in the pinned version. Worth surfacing as the first methodology rule in any future Cowork-internals trace.

---

## v2.11.8 — 2026-05-02 (this fork) — Desktop trace extended; Anthropic-managed skills cache documented

Six findings accumulated in the public Desktop-plugins gist across multiple Codex review rounds, none of which were yet reflected in the L26 lesson or the internal trace note. v2.11.8 extends both with bundle-verified evidence.

### Added — six L26 subsections under "Desktop-side cross-check"

1. **CLI's `claude plugin update` `skipIfRecent` 30s short-circuit + cached-data fallback.** Refresh is silently skipped if `lastUpdated` is within the last 30 seconds; if refresh fails, exception is caught and the worker proceeds against the cached clone with a warn log "using cached data". So `claude plugin update` reports can be against stale clone data. Reliable update sequence: `claude plugin marketplace update <mp>` → verify clone HEAD advanced → `claude plugin update`.

2. **Desktop `updatePlugin` has two paths: RPM remote-API or classic CLI fallback.** RPM-managed plugins go through `Hrt(r, marketplaceScope)` (remote API). Non-RPM plugins fall through to `A(s, "git").updatePlugin(r, n)` — the classic CLI shell-out without `--scope`. v2.11.6's "Desktop omits --scope" applies only to the classic fallback.

3. **Per-source-type badge path correction.** v2.11.6 said the badge reads `<marketplace-clone>/<plugin-name>/.claude-plugin/plugin.json` for both source types. Corrected: string sources read at `<marketplace-clone>/<plugin.source>/...` (path resolver does `path.join(clone, entry.source)`); object sources fall through to the `<plugin-name>/` fallback path which usually doesn't exist for object sources, then falls back to `marketplace.json#plugins[].version`.

4. **`installed_plugins.json` v1→v2 migration is CLI-only.** Desktop's native reader `V_(e)` parses JSON and returns it as-is — no migration. Downstream code accesses `plugins[id][0]` which is `undefined` on a v1 single-object value; plugins silently invisible in Desktop UI until CLI runs and migrates the file. Hand-written `installed_plugins.json` files should be written as v2.

5. **Per-session `known_marketplaces.json` files.** Found at `<userData>/local-agent-mode-sessions/<acc>/<org>/local_<UUID>/.claude/plugins/`, written by the in-VM CLI (giveaway: VM-relative `installLocation` paths like `/sessions/<vm-name>/mnt/...`). Desktop IPC handlers do NOT read these files; they consult `<acc>/<org>/cowork_plugins/known_marketplaces.json` instead.

6. **Settings UI's marketplace listing is single-`(accountId, orgId)` per IPC call.** Native `listMarketplaces` reads exactly one `known_marketplaces.json` per call, resolved from the passed `pluginContext`. No aggregation at IPC layer. The empirical observation that the "Personal" tab shows CCD-host entries from a Cowork session implies renderer-side merging (renderer is partially served from `claude.ai` web origin, outside the local-bundle audit).

### Added — high-impact new section: "Anthropic-managed skills cache (`skills-plugin/`)"

This is operationally the most important new finding. Cowork ships with a set of Anthropic-curated built-in skills (`pdf`, `xlsx`, `theme-factory`, `consolidate-memory`, `schedule`, `setup-cowork`, `doc-coauthoring`, `algorithmic-art`, `internal-comms`, `skill-creator`, `fiction-studio`) that are NOT user-installed plugins. They live in their own cache:

```text
<userData>/local-agent-mode-sessions/skills-plugin/<orgId>/<accountId>/
  .claude-plugin/plugin.json
  skills/<skill-name>/SKILL.md
```

Note `<orgId>/<accountId>` order — opposite of the Cowork plugin roots which use `<accountId>/<orgId>`.

Sync model:
- 10-minute background timer; also runs on app focus
- `_syncSkills` calls org skills API, computes delta against local manifest
- Downloads run with concurrency 10 via `downloadSkills`
- Per-skill download failures are CAUGHT, LOGGED, and NOT propagated
- After downloads complete, `writeManifest` runs UNCONDITIONALLY with the full remote skill list (including new `updatedAt` for any failed skill)

**Silent-stale failure mode**: download fails → manifest written with new `updatedAt` → next sync sees matching `updatedAt` + existing-on-disk SKILL.md → skips redownload → stale skill content persists indefinitely. Desktop restart does NOT fix it. The 10-minute sync timer cannot recover from this state on its own.

Recovery: `rm` the stale SKILL.md (or whole skill directory) under `skills-plugin/<orgId>/<accountId>/skills/<skill-name>/`. Next sync's third condition (`!SKILL.md exists`) re-fires and the skill is redownloaded.

This cache is invisible to every other staleness check covered in the lesson — `installed_plugins.json` doesn't list these skills, no `marketplace.json` does, RPM doesn't track them, `refreshPluginMcps` doesn't touch them. If a Cowork session is using stale `pdf`/`xlsx`/etc. content, the cause is here. Tools that diagnose Cowork plugin staleness should include this cache in their checks.

### Files changed

- `skill-package/skills/claude-code-internals/references/04-connectivity-plugins.md` — six new subsections + Anthropic-managed-skills-cache section under L26 Desktop cross-check
- `docs/internal/desktop-bundle-trace-v1.5354.0.md` — extended with bundle excerpts (offsets, function bodies, `_syncSkills` failure trace) for all six findings; corrected the v2.11.6 install-snapshot framing left over from earlier
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `note`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `CLAUDE.md` — pinned skill version updated
- `CHANGELOG.md` — this entry

### Methodology takeaway

The Anthropic-managed skills cache is the kind of finding that only an external user with disk access to the right paths would surface — none of the standard plugin-staleness checks would point at `skills-plugin/`, and the silent failure mode means the bug is invisible to every Anthropic-side telemetry signal that doesn't track per-skill download success rates. Multiple rounds of external Codex review on the public gist over 24 hours surfaced 14+ corrections, of which this was the most operationally significant. Worth treating "external bundle review on a dense doc, in series, with cross-checks against on-disk state" as a high-yield methodology for catching architectural surface that Anthropic-internal documentation doesn't cover.

---

## v2.11.7 — 2026-05-02 (this fork) — Six corrections to v2.11.6 Desktop-side trace

External bundle review (Codex, against Claude Desktop v1.5354.0 and standalone Claude Code v2.1.126) caught six material errors in v2.11.6's Desktop trace. All six were independently verified against the local Desktop bundle and CLI binaries before applying corrections.

### Errors corrected

1. **Desktop's "Update available" badge does NOT read plugin.json from the install snapshot.** v2.11.6 claimed object-source plugins read `installed_plugins.json[id][0].installPath/.claude-plugin/plugin.json`, frozen at install time. Bundle re-trace shows `i_t` is called with only 3 args (`marketplacesDir`, `marketplace`, `plugin`); `t_t`'s object-source branch is gated on a 4th `options` arg that the badge call does not supply. So `t_t` returns the fallback path `<marketplace-clone>/<plugin-name>/`. For object-source plugins, that directory doesn't contain plugin.json (the install lives in the cache dir). `i_t`'s readFile fails, falls through to `fte`, which returns the marketplace.json plugin entry. **The badge is keyed on `marketplace.json#plugins[<plugin>].version`, not on `plugin.json#version`, for object-source plugins.** Bumping both fields is the reliable release pattern.

2. **`refreshPluginMcps` is org-plugin MCP-only, not a general skill/command/agent/hook refresher.** `doRefreshPluginMcps` filters `source === "org-plugin"` and operates on the direct-MCP connections list. Settings-UI plugin ops do NOT trigger a skill or command re-scan in the running Cowork task. The reliable boundary for skill/command/agent/hook freshness is a new task ("+ New task"), which spawns a fresh `local_<UUID>/` session that scans disk from scratch.

3. **Desktop's `updatePlugin` shells out without `--scope`.** The CLI has supported `-s, --scope <user|project|local|managed>` on `plugin update` since v2.1.120 (default `user`), but Desktop's `buildArgs` is `["plugin","update", pluginId]` — no scope flag. Desktop-driven updates can leave project / local / managed installs untouched. Desktop's `installPlugin` and `uninstallPlugin` DO forward scope; only update doesn't.

4. **`installed_plugins.json` schema v2 includes `managed` scope, `resolvedVersion`, and `auto`.** v2.11.6's lesson and the gist undersold the schema. Verified in v2.1.126: `scope: enum(["managed","user","project","local"])`, `resolvedVersion` (tag-derived semver from version-constraint installs, used by `verifyAndDemote`), `auto` (true when pulled in as a transitive dependency, eligible for orphan sweep).

5. **Plugin-entry source variants miscatalogued.** Verified in v2.1.126: plugin-entry `npm` source accepts `package` (broader than name — URL or local path also valid), optional `version`, optional `registry`. There is no `directory` plugin-entry variant (that's marketplace-level only). New `unsupported` placeholder exists for forward-compatible source rewrites by older clients.

6. **Desktop parses for `"already up to date"` but CLI emits `"already at the latest version"`.** Pre-existing string mismatch in both v2.1.120 and v2.1.126. The actual update operation succeeds; only Desktop's `alreadyUpToDate: boolean` field returned to the renderer reads `false` on no-op success. Minor metadata bug, not a functional one.

### Files changed

- `skill-package/skills/claude-code-internals/references/04-connectivity-plugins.md` — L26 "Desktop-side cross-check" subsection rewritten with the corrected trace
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `note`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `CHANGELOG.md` — this entry

### Companion gist updates (separate artifact, not in this plugin)

The public gist at `claude-desktop-plugins-architecture.md` was rewritten to reflect all six corrections: cache-table row, plugins[].source variants table (npm fields, no directory variant, unsupported placeholder), installed_plugins.json schema (managed/resolvedVersion/auto + v1/v2 distinction), Update Detection section (correct read-location table), listAvailablePlugins flow, "Why Claude keeps using an old plugin" item #3, the practical playbook step 1, and the live-update / new-task guidance.

### Methodology takeaway

The v2.11.6 trace got `i_t` and `t_t` correct as functions, but failed to check **how they're actually called from the badge code path**. The 4th-arg-gated branch in `t_t` is the kind of detail that requires reading the call site, not just the function definition. "Read the function's body" is necessary; "read every distinct call site of that function" is what catches branch-pruning behaviors like this.

The other five corrections follow a similar pattern: schema fields and source variants are simple field-presence checks that the original trace skipped because the gist's earlier list "looked complete enough." Bundle reviews catch what you weren't looking for. External cross-check is load-bearing for any artifact this dense.

---

## v2.11.6 — 2026-05-02 (this fork) — Desktop-side bundle trace; corrects v2.11.5 Desktop framing

Extracted `/Applications/Claude.app/Contents/Resources/app.asar` (Claude Desktop v1.5354.0) and traced its plugin-management code paths against the v2.1.120 standalone CLI. The trace corrected two material errors carried in earlier artifacts.

### Errors corrected

1. **v2.11.5's "Desktop UI vs CLI: two different version resolvers" framing was wrong.** Bundle evidence shows Desktop and the CLI use the **same priority chain** (plugin.json#version primary, marketplace.json#plugins[].version fallback). The asymmetry is real but is at a different layer: it's about *what plugin.json file gets read*, not about the priority order.

2. **claude-plugin-doctor's reading of `agent/local_ditto_<uuid>/` as per-subagent state was wrong.** Bundle confirms these are per-org-generation directories: `Bm = "local_"`, `juA(orgUuid, gen) = local_ditto_<orgUuid>` plus `_g<N>` for `gen > 0`. The generation counter increments when the bridge force-rotates the local session (transport recovery, `resetModel`, clean-state restart) — historical bridge state, not subagent fan-out.

### Added

1. **L26 — new "Desktop-side cross-check (v1.5354.0)" subsection** under the existing Version Resolution Priority section. Shows the `i_t` / `t_t` / `hte` helpers from the Desktop bundle and explains the per-source-type read location:
   - Desktop's `updatePlugin` IPC handler is a thin wrapper that shells out to `claude plugin update <id>` and parses stdout. Same K6H resolver end-to-end.
   - Desktop's "Update available" badge in `listAvailablePlugins` uses K6H-equivalent priority but reads plugin.json from a per-source-type-resolved location.
   - **String sources** (`"./plugin-name"`): read from `<marketplace-clone>/<source>/.claude-plugin/plugin.json` — live, badge surfaces after refresh.
   - **Object sources** (`github` / `url` / `git-subdir` / `directory` — the majority of public marketplaces): read from `installed_plugins.json[id][0].installPath/.claude-plugin/plugin.json` — frozen at install time, so `pluginJson.version === installedVersion` and the badge effectively does not fire from this code path.
   - The CLI's `claude plugin update` still detects bumps because it operates on a freshly-fetched marketplace-clone view, not the install snapshot. This explains the operationally-observed asymmetry.

2. **Internal investigation note**: `docs/internal/desktop-bundle-trace-v1.5354.0.md` captures the full Desktop trace with bundle excerpts, including `local_<UUID>` and `local_ditto_<orgUuid>_g<N>` lifecycle.

### Companion gist updates (separate artifact, not in this plugin)

The public Skills/Plugins/Marketplaces reference at `claude-desktop-plugins-architecture.md`:

- Replaced the wrong "Desktop UI vs CLI: two different version resolvers" section with a corrected "Update detection: same priority on Desktop and the CLI, but different read sources" section that documents the per-source-type badge behavior.
- Updated the cache-table row to point at the corrected explanation.
- Corrected the per-conversation overlay subsection: `local_<UUID>/` is per-session; `local_ditto_<orgUuid>_g<N>/` is per-org-generation (not per-subagent). The `_g<N>` accumulation is bridge-rotation history.
- Updated the `listAvailablePlugins` operation flow to spell out the source-type-dependent read location.
- Tightened the "Short version" recipe: bumping `marketplace.json#plugins[].version` is no longer described as a way to make the Desktop badge appear (it isn't, for object-source plugins). Users are pointed at `claude plugin update` (or Desktop's Update button, which shells out to it) instead of waiting on the badge.

### Files changed

- `skill-package/skills/claude-code-internals/references/04-connectivity-plugins.md` — new Desktop-side cross-check subsection in L26
- `docs/internal/desktop-bundle-trace-v1.5354.0.md` — new internal note
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `note`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `CHANGELOG.md` — this entry

### Methodology takeaway

The Desktop bundle was previously unverified — both the original gist's "Desktop reads marketplace.json only" claim and v2.11.5's "two different resolvers" correction were inferred from observed behavior, not source-traced. Extracting `app.asar` and grepping the main process bundle took ~10 minutes and revealed the actual mechanism. When two artifacts disagree about a binary's behavior and neither has been traced, the resolution is not to pick the more popular framing — it's to extract and read the binary. Both had been wrong.

The shape of the fix shows why this matters operationally: the "asymmetry" plugin authors hit isn't between Desktop and the CLI as separate version resolvers — they share a resolver. It's between **a freshly-fetched marketplace-clone view (CLI on update)** and **a frozen install snapshot (Desktop badge for object-source plugins)**. The two surfaces converge for string-source plugins, diverge for object-source. Knowing which surface is reading from which location is what lets a downstream tool like claude-plugin-doctor implement correct detection.

---

## v2.11.5 — 2026-05-02 (this fork) — `claude plugin update` version-resolution priority

Bundle trace through `K6H` (offset 4,388,116) — the resolver `claude plugin update` uses on both the installed-snapshot side and the freshly-fetched-candidate side of its comparison. Motivated by an external bug report (claude-plugin-doctor) that proposed an inverted priority chain where `marketplace.json#plugins[].version` is primary; bundle evidence shows `plugin.json#version` is primary, with `marketplace.json#plugins[].version` only firing when the manifest is absent or missing the field.

The mistake matters because: under the inverted read, github-source marketplaces (which usually leave `plugins[].version` unset) would be no-op for `claude plugin update`. Empirically they're not. The K6H trace explains why.

### Added

1. **L26 (`04-connectivity-plugins.md`) — new section "`claude plugin update` — Version Resolution Priority"** placed after Background Autoupdate and before the Lesson 10 boundary. Documents:
   - The K6H signature and full body, with bundle offset
   - The five-level resolution priority: (1) plugin.json#version PRIMARY, (2) marketplace.json#plugins[].version FALLBACK, (3) pre-resolved git SHA, (4) computed git SHA, (5) "unknown" sentinel
   - The `git-subdir` variant: 12-char SHA + 8-char hash of the subpath
   - The comparison shape (`O.version === R || O.installPath === v || O.installPath === N`) — both sides go through K6H, no drift
   - The "marketplace.json is the source of truth" misreading and why it produces the wrong empirical prediction (no-op for most github-source marketplaces)
   - Implications for plugin authors: bump `plugin.json#version` for releases; treat `marketplace.json#plugins[].version` as a curator-pin override only

### Files changed

- `skill-package/skills/claude-code-internals/references/04-connectivity-plugins.md` — new "Version Resolution Priority" section
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `note`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `CHANGELOG.md` — this entry

### Methodology takeaway

When a downstream tool reports a "version trap" or contradiction, three questions to ask in order: (1) is the contradiction in *this* gist or another artifact (grep verbatim), (2) does the proposed fix have the right *direction* or just the right *idea*, (3) what does the binary actually do at the comparison site? The agent's instinct ("the gist conflates sources") was right. The fix priority they proposed was inverted because they hadn't traced K6H. The five-minute trace (find the resolver, read its body) settles it definitively. Negative findings — "no, marketplace.json#plugins[].version is *not* primary" — close out the misreading and prevent it from propagating into downstream documentation.

---

## v2.11.4 — 2026-04-30 (this fork) — MCP path through the Cowork-async filter

Extension to the L90 "Sub-Agent Tool-Grant Filtering" section. v2.11.3 documented how `Tw8` strips `Bash` from forked agents in Cowork-async dispatch. This pass traces the **other** half of the filter — what happens to MCP tools, how the parent's MCP state reaches the fork, and what runtime registration paths exist (none that are skill-callable).

Motivated by a real question: "if a skill spawns an MCP server at runtime via `mcp-bash-framework`, can a forked sub-agent use it?" Bundle trace says: the bypass works, but the registration step has nowhere to land — the working pattern is static declaration with a behaviorally dynamic launcher.

### Added

1. **L90 — new sub-section "MCP path: the same filter, the other direction"** under the existing Sub-Agent Tool-Grant Filtering heading. Documents:
   - The `yJ` MCP fast-path in `Tw8` (offset 5,036,218): `function yJ(H){return H.name?.startsWith("mcp__") || H.isMcp === true}` runs as the **first** branch and returns true unconditionally. MCP tools bypass `Jl_` (async allowlist), `F_8` (non-built-in drop set), and `r3H` (universal drop set) regardless of `isAsync`/`isBuiltIn`/`permissionMode`. This is the runtime mechanism behind "expose the work as MCP tools" as the documented Cowork-async escape hatch.
   - The parent→fork MCP-state inheritance flow at the dispatch site (offset ~8,001,500): `availableTools = Ja(perm, w.getAppState().mcp.tools.concat(w.options.tools.filter(yJ)), {skipReplFilter: true})` for non-`/fork` paths. `Ja` (offset 8,711,381) returns `tR(perm, opts) + r8H(mcpTools, perm)` deduped by name. Forks inherit the parent's live MCP connections **by reference**, not by re-resolving `.mcp.json`.
   - The `requiredMcpServers` 30-second poll against `state.mcp.clients` (500ms interval, throws on `failed`/missing). This is the runtime contract for the agent-frontmatter field — documented as a field elsewhere but not as a behavior.
   - Negative finding: **no skill-callable runtime MCP registration.** `claude mcp add --scope dynamic` rejected at offset 7,368,245. `PW3()` chokidar setup at offset ~12,533,956 watches only skill/command directories — `.mcp.json` is not watched. `/mcp` slash command exposes only reconnect/toggle on already-known servers. `--mcp-config` and SDK `io({extraServers})` callbacks are out-of-band for skill bodies. The connection-manager set is fixed at session boot.
   - The working pattern: static MCP declaration with a behaviorally dynamic launcher. The launcher reads runtime state — env vars, `${CLAUDE_PLUGIN_DATA}/runtime.json`, stdin — to vary tool listing across turns. Skills mutate the launcher's input state; the registration itself stays static.
   - Agent `tools:` exact-match constraint: `Sz`/`n0` chain does literal `f.get(name)` lookup. `tools: ["mcp__server__*"]` falls into `invalidTools` silently. The `mcp__server__*` prefix form works in **permission rules** (validator at offset ~1,111,367 explicitly accepts it) but NOT in agent declarations. Authors copying the form from a permission rule into an agent's frontmatter get the same "agent has no tools" symptom as the Bash-strip case.

2. **Internal investigation note** at `docs/internal/mcp-from-skill-to-subagent.md`. Captures the trace and the working/failing patterns. Not part of the published skill, but referenced from the L90 update for source provenance.

### Companion gist updates (separate artifact, not in this plugin)

The public Skills/Plugins/Marketplaces reference gist (https://gist.github.com/yaniv-golan/303b6213b7a33167b3f98b076a5f81ad) gained three Mermaid diagrams in an earlier pass: containment hierarchy (Marketplace → Plugin → component dirs), loading-order chain (10-stage chain → dedup gate → model listing), and Cowork-async dispatch sequence (showing the `Tw8` filter dropping Bash silently). The gist's recommendation to "expose the work as MCP tools" as the Cowork escape hatch is now verified at the bundle level and tied to the specific bypass mechanism.

### Files changed

- `skill-package/skills/claude-code-internals/references/17-verified-new-v2.1.120.md` — new "MCP path: the same filter, the other direction" sub-section under Sub-Agent Tool-Grant Filtering
- `skill-package/skills/claude-code-internals/version.json` — `skill_version` and `note`
- `skill-package/.claude-plugin/plugin.json` — `version`
- `docs/internal/mcp-from-skill-to-subagent.md` — new investigation note
- `CHANGELOG.md` — this entry

### Methodology takeaway

The bundle answer to "can a runtime-spawned MCP server be used from a fork?" was a clean composition of three traces — filter chain (`Tw8` first-branch `yJ`), state inheritance (`Ja` reading `state.mcp.tools`), and registration paths (rejected `dynamic` scope + missing watcher). Each was a 5-minute grep. The combined picture inverts the user's question: instead of "register at runtime, use from fork", the answer is "register at boot with a launcher that varies its output, mutate state from the skill, call from anywhere." Negative findings (no `.mcp.json` watcher, no `dynamic` scope) are as load-bearing as positive ones — they're what makes the working pattern unique.

---

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
