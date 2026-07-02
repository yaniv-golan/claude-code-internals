Updated: 2026-07-02 | Source: **First-party binary extraction & diff.** The standalone CLI content baseline advances **v2.1.159 → v2.1.198** (installed/running). Every entry is grepped from the extracted v2.1.198 Bun-SEA bundle and diffed against a checksum-verified v2.1.159 bundle (CDN-recovered, sha256 `5adf7b4d…95f9`), then cross-checked against the official Anthropic CHANGELOG for v2.1.160–v2.1.198. The bundle→CHANGELOG delta is called out explicitly: features present in the binary but **absent from the public changelog are dark-launched** (L112). Diff surface: +135 env vars (117 not previously documented), +12/−4 slash commands, +4 API betas, +288/−32 `tengu_*` identifiers; hook event types unchanged at **30**.

# Chapter 27: The v2.1.160 → v2.1.198 CLI Content Refresh (Sonnet 5 default, announced surface, and the dark-launched Design/Artifacts features)

> **What this chapter is.** The prior content baseline was v2.1.159 (Ch21/L91–L104). This chapter closes the
> 39-version gap to the installed **v2.1.198**, split into: **L110** the model landscape (Sonnet 5 is the new
> default; Fable 5); **L111** the officially-announced CLI surface (new commands, permission/sandbox changes,
> Chrome GA, background-agent notifications, removals); **L112** the **dark-launched** features that ship in
> the binary but not the changelog (Claude Design, Artifacts, Launch Composer, `/skill-doctor`,
> `/pause-memory`); and **L113** the auto-memory→knowledge-base evolution and the new API-beta/fallback surface.

---

## TABLE OF CONTENTS

110. [Lesson 110 -- Model landscape: Sonnet 5 default, Fable 5, fallback chain](#lesson-110----model-landscape-sonnet-5-default-fable-5-fallback-chain)
111. [Lesson 111 -- Announced CLI surface v2.1.160-198](#lesson-111----announced-cli-surface-v21160-198)
112. [Lesson 112 -- Dark-launched: Claude Design & Artifacts](#lesson-112----dark-launched-claude-design--artifacts)
113. [Lesson 113 -- Auto-memory→knowledge-base + API-beta/fallback surface](#lesson-113----auto-memoryknowledge-base--api-betafallback-surface)

---

# LESSON 110 -- MODEL LANDSCAPE: SONNET 5 DEFAULT, FABLE 5, FALLBACK CHAIN

The model default **changed twice** in this span, superseding Ch21/L91's "Opus 4.8 is the new default":

- **Claude Sonnet 5 is now the CLI default (v2.1.197).** `claude-sonnet-5` `[binary]`, a **native 1M-token
  context** model (`claude-sonnet-5\`   | 1M`), promotional pricing $2/$10 per Mtok through 2026-08-31
  (CHANGELOG). This is the current default model in Claude Code; Opus 4.8 remains selectable.
- **Claude Fable 5 (v2.1.170)** — a Mythos-class model "made safe for general use"; `claude-fable-5` and the
  internal `claude-fable-5-mythos-5` `[binary]`. Fable 5 is the live **Cowork** model (Ch26/L109); in the
  standalone CLI it is one selectable model among the Claude 5 family. v2.1.173 fixed normalization of the
  `[1m]`-suffixed Fable names.
- **`fallbackModel` setting (v2.1.166)** — configure **up to three** fallback models tried in order when the
  primary is overloaded; `fallbackModel:e.fallbackModel` `[binary]` feeds `mainLoopModelOverride`. The agent
  also retries a turn once on the fallback when the API returns an unexpected non-retryable error. Related
  server-side machinery in L113 (`server-side-fallback`/`fallback-credit` betas; `model_fallback` subtypes).
- **`CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE`** `[binary]` (`:()=>MUu`) — opt-in fast mode for Opus 4.7
  (complements the earlier `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE`).
- **Org-managed model controls.** Org default models (v2.1.196 — shows as "Org default"/"Role default" in
  `/model`), org model **restrictions** applied to the picker / `--model` / `/model` / `ANTHROPIC_MODEL`
  (v2.1.187), and the `enforceAvailableModels` managed setting (v2.1.175). Deprecated/auto-updated models now
  warn (v2.1.183).

Methodology note: the skill's model-default facts should track this — as of v2.1.198 the CLI default is
**Sonnet 5**, not Opus 4.8.

---

# LESSON 111 -- ANNOUNCED CLI SURFACE v2.1.160-198

All items here are in **both** the binary and the official CHANGELOG (announced, not dark-launched).

## New / changed slash commands

| Command | Behavior | Anchor / version |
| --- | --- | --- |
| `/cd <path>` | Move the session to a new working directory **without breaking the prompt cache**. | `name:"cd",description:"Move this session to a new working directory",argumentHint:"<path>"` (v2.1.169) |
| `/rewind` | Now also resumes a conversation **from before `/clear`** was run. | `name:"rewind",aliases:["checkpoint","undo"]` (v2.1.191) |
| `/config [key=value]` | Set **any** setting from the prompt. | `name:"config",description:"Open settings",argumentHint:"[key=value]"` (v2.1.181) |
| `/plugin list` | List installed plugins, `--enabled`/`--disabled` filters; a "Skills" section added to the Installed tab; marketplace search bar. | v2.1.163 / v2.1.186 / v2.1.172 |
| `claude mcp login/logout <name>` | Authenticate MCP servers from the CLI. | `mcp login` `[binary]` (v2.1.186) |

## Permissions, sandbox & auto-mode

- **`Tool(param:value)` permission syntax (v2.1.178)** — permission rules can now match a tool's **input
  parameters**, not just the tool name; binary carries `ruleValue`/`ruleValues` in the matcher.
- **`sandbox.credentials` (v2.1.187)** `[binary]` (`sandbox=…extend({credential…`) — block sandboxed commands
  from reading credential files and secret env vars. **`sandbox.allowAppleEvents` (v2.1.181)** — opt-in to let
  sandboxed commands send Apple Events on macOS.
- **`autoMode.classifyAllShell` (v2.1.193)** — route **all** Bash/PowerShell through the auto-mode classifier;
  auto mode also blocks destructive git commands you didn't ask for (v2.1.183). Idle bg-shell memory-pressure
  reaping with `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP` (v2.1.193).
- **`--safe-mode` / `CLAUDE_CODE_SAFE_MODE` (v2.1.169)** `[binary]` — start with **all customizations
  disabled** (the same `I5()` "safe mode" that drops `--mcp-config`, per Ch24/L107).

## Agents, sandboxing depth & Chrome

- **Sub-agents can spawn sub-agents, up to 5 levels deep (v2.1.172)** — binary tracks `agentDepth:s=0` per
  spawn. **`TeamCreate`/`TeamDelete` tools removed (v2.1.178)** — every session now has one implicit team
  (binary: `TeamCreate` 6 hits in v2.1.159 → 1 in v2.1.198).
- **Explore agent inherits the session model (v2.1.198)** — capped at opus, was haiku; subagents + compaction
  inherit the session's extended-thinking config. `CLAUDE_CODE_PLAN_V2_AGENT_COUNT` /
  `CLAUDE_CODE_EXPLORE_AGENT_COUNT` size the Plan/Explore fan-out.
- **Claude in Chrome is GA (v2.1.198).** Background-agent notifications: `claude agents` sessions that need
  input or finish fire the **`Notification` hook** with `agent_needs_input` / `agent_completed` `[binary]`
  (this is why the master hook array stays at 30 — no new *event type*, a new *reason* on an existing one).

## Settings & removals

- New settings: `enforceAvailableModels`, `requiredMinimum/MaximumVersion`, `footerLinksRegexes`,
  `wheelScrollAccelerationEnabled`, `teammateMode:"iterm2"`, `disableBundledSkills` (+
  `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`), `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` (v2.1.195),
  `CLAUDE_CLIENT_PRESENCE_FILE` (suppress mobile push, v2.1.181).
- **Removed env vars** `[binary]`: `ANTHROPIC_FOUNDRY_AUTH_TOKEN`, `CLAUDE_CODE_AGENT_LIST_IN_MESSAGES`,
  `CLAUDE_CODE_TEAM_ONBOARDING` (the L60 `/team-onboarding` machinery). **Removed commands**: `/bridge-kick`,
  `/init-verifiers`, `/simplify`; `/toggle-memory` was **renamed** to `/pause-memory` (kept as an alias, L112),
  not deleted.

---

# LESSON 112 -- DARK-LAUNCHED: CLAUDE DESIGN & ARTIFACTS

These ship in the v2.1.198 binary but are **absent from the official CHANGELOG** — dark-launched. All tokens
are confirmed absent from the v2.1.159 bundle.

## Claude Design (`/design`, `/design-sync`, `/design-login`)

A feature to connect a codebase's **design system** to **claude.ai/design**. `[binary]`:

- `/design` — hub: `menuDescription:"Work with Claude Design (claude.ai/design) — create, import, export,
  sync, login"`; the base command is `description:"Grant or revoke Claude agent access to your Design
  projects", argumentHint:"consent | revoke"`.
- `/design-sync` — `menuDescription:"Push your design system components to claude.ai/design"` (`isEnabled:pNe`).
- `/design-login` — `description:"Authorize design-system access for /design-sync with your claude.ai
  account"`; OAuth flow with telemetry `tengu_design_oauth_login_success`/`_error`/`_manual_entry`.
- Env: `CLAUDE_CODE_ENABLE_DESIGN_MCP` (a design **MCP server**), `CLAUDE_CODE_ENABLE_DESIGN_SYNC`,
  `CLAUDE_CODE_DESIGN_OAUTH_CLIENT_ID`. A **`DesignSync`** tool is present. URLs `claude.ai/design`,
  `claude.ai/design/p/`. Gated (`pNe()` isEnabled + the ENABLE_DESIGN_* env vars) — off by default.

## Artifacts (`/plan-artifact`, the `Artifact` tool)

A first-party **Artifact tool** (`NR="Artifact"`, `ARTIFACT_TOOL_NAME:()=>NR`) that publishes a **shareable
web page** to `https://claude.ai/code/artifact/${slug}` (`zne(\`https://claude.ai/code/artifact/${n.slug}\`)`).
`[binary]`:

- **`/plan-artifact`** — `menuDescription:"Publish a plan as a shareable Artifact"`; **hard-disabled**
  (`isEnabled:v5e`, `function v5e(){return!1}`) — dark-launched behind a slot that reports "plan-artifact slot
  not registered."
- Master gate: GrowthBook flag **`tengu_cobalt_plinth`** (default false) — `Rpa()` = `if(!nt("tengu_cobalt_
  plinth",!1))return!1`. `getArtifactDefaultOn` returns `!0` (default-on *once the flag flips*). This is the
  **CLI's own** flag; Desktop's `coworkArtifacts` (Ch25) is a parallel gate — the string `coworkArtifacts` is
  absent from the CLI bundle.
- Env vars: `CLAUDE_CODE_ARTIFACT` (force enable/disable in excluded entrypoints), `CLAUDE_CODE_DISABLE_ARTIFACT`
  (+ `disableArtifact` setting) kill switch, `CLAUDE_CODE_ARTIFACTS_API_BASE_URL` (upload API; env-stripped from
  child processes), `CLAUDE_CODE_ARTIFACT_DIRECT_UPLOAD` (inline lane vs redeploy; `tengu_cobalt_plinth_direct`),
  `CLAUDE_CODE_ARTIFACT_AUTO_OPEN` (suppress auto-opening the surfaced frame). Availability requires first-party
  auth and excludes `local-agent`/`claude-coworker*` entrypoints.

## Other dark-launched surface

- **Launch Composer** — `CLAUDE_CODE_ENABLE_LAUNCH_COMPOSER` / `CLAUDE_CODE_DISABLE_LAUNCH_COMPOSER` `[binary]`
  (a launch/prompt composer UI; not in the changelog).
- **`/skill-doctor`** — `description:"Show which loaded skills are unused and costing context"`,
  `isEnabled:()=>!0` (**live**) — surfaces unused loaded skills (`skills are unused` / `costing context`).
- **`/pause-memory`** — `aliases:["memory-pause","toggle-memory"]`, `description:"Pause automemory for this
  session"` — this is the rename target of the removed `/toggle-memory`.
- **`/auto-mode-setup`** (`requires:{workspace:!0}`) and **`/cowork-plugin`** (`userInvocable:!1`,
  `isEnabled:()=>…ENTRYPOINT==="remote_cowork"`).

**Reachability caveat:** dark-launched ≠ reachable. Read each gate's live state from GrowthBook/`fcache`
(`tengu_cobalt_plinth`, the design gate) before claiming a UI ships.

---

# LESSON 113 -- AUTO-MEMORY→KNOWLEDGE-BASE + API-BETA/FALLBACK SURFACE

## Auto-memory evolved into a periodically-resynced knowledge base

Building on L90's memory-write survey and `CLAUDE_COWORK_MEMORY_GUIDELINES`, the memory pipeline gained a
**bulk-inflate + periodic-resync knowledge-base** model. `[binary]` env vars (all new since v2.1.159):

- `CLAUDE_CODE_DISABLE_MEMORY_BULK_INFLATE` (`:()=>ZHu`) — the "bulk inflate" load path (`bulk_inflate`,
  `bulk inflate incomplete`/`unavailable` states; `knowledge base` string present).
- `CLAUDE_CODE_DISABLE_MEMORY_PERIODIC_RESYNC` (`:()=>eDu`) — periodic re-sync of the memory store.
- `CLAUDE_CODE_FORCE_EVALUATE_MEMORY` (`:()=>WNu`) / `CLAUDE_CODE_FORCE_MEMORY_SURVEY` (`:()=>KNu`) — force the
  memory-evaluation and the L90 Approve/Reject survey.
- `CLAUDE_CODE_KB_COHESION_FIXES` (`:()=>PDu`) — knowledge-base cohesion fixes.
- `/pause-memory` (L112) pauses automemory for the session.

## New API betas (v2.1.198) — 3 of 4 are GB-gated

`[binary]` beta strings and their wiring:

| Beta | Wiring | Sent by default? |
| --- | --- | --- |
| `code-execution-2025-08-25` | in the default `Betas=[…]` array | **yes** (default beta) |
| `server-side-fallback-2026-06-01` | `sb("server_side_fallback",…)` | GB-gated |
| `fallback-credit-2026-06-01` | `sb("fallback_credit",…)` | GB-gated |
| `prompt-caching-evict-2026-05-12` | `sb("prompt_caching_evict",…)` | GB-gated |

The `server-side-fallback` + `fallback-credit` betas are the server side of L110's fallback chain (they let the
server transparently fall back to another model and account for the credit). `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK`
`[binary]` (`:()=>cDu`) opts out of the refusal→fallback path (the `model_refusal_fallback` subtype family from
Ch26/L109 Part E). `prompt-caching-evict` enables server-side cache-eviction (pairs with the L98
`cache-diagnosis` beta).

---

## Cross-references

- **Ch21 / L91** — the prior default (Opus 4.8) and effort ladder; L110 supersedes the default with Sonnet 5.
- **Ch26 / L109** — Fable 5 as the Cowork model; the `model_fallback` control-protocol subtypes (L113 betas);
  `coworkArtifacts` Desktop gate vs the CLI's `tengu_cobalt_plinth` (L112).
- **Ch1 / L-permissions** — `Tool(param:value)` extends the permission matcher (L111); `--safe-mode` ties to
  Ch24/L107's `I5()`.
- **Ch4 / L10 (Hooks)** — the background-agent `Notification` reasons `agent_needs_input`/`agent_completed`
  (L111) are new *reasons*, not a new event type (still 30).
- **Not yet gate-decoded:** the live state of `tengu_cobalt_plinth` (Artifacts) and the Design gate are
  server-side — decode from GrowthBook/`fcache` before asserting reachability.
