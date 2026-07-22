Updated: 2026-07-22 | Source: First-party CLI bundle diff **v2.1.198 → v2.1.217** (the v2.1.198 baseline CDN-recovered from `downloads.claude.ai/claude-code-releases/2.1.198`, sha256-verified `ab6f7ee1…`, extracted; 2.1.217 the live staged agent), cross-checked against the official Anthropic CHANGELOG (2.1.199–2.1.217). Full machine diff at `docs/internal/diff-2.1.198-to-2.1.217.txt`. Env-var additions were source-verified (59/69 are real `Z.`/`process.env` reads — the diff tool's "no process.env read" flag is a known false-positive class that misses the `Z.` proxy); the CHANGELOG crosscheck separates announced from dark-launched. This is a **CLI content refresh** chapter (the kind deferred out of Ch37), and it **moves the CLI content baseline to v2.1.217**. Everything is standalone-CLI first-party unless flagged; where a fact bears on Cowork, the Cowork-path applicability is called out as verified or not.

# Chapter 38: CLI content refresh v2.1.198 → v2.1.217

---

## TABLE OF CONTENTS

133. [Lesson 133 — Provider & Auth Landscape: Claude Platform on AWS/GCP, Foundry, and the `An()` Seven](#lesson-133----provider--auth-landscape)
134. [Lesson 134 — Sub-agent Fan-out Caps Now Exist — correcting Ch35/L121 & v2.22.1](#lesson-134----sub-agent-fan-out-caps-now-exist)
135. [Lesson 135 — Command Surface: `/subtask`, the `/fork` Redesign, `/import`, and the Dark `/artifacts`](#lesson-135----command-surface)
136. [Lesson 136 — Feature Surfaces: Artifacts, Auto-Mode Wizard, Agent-Proxy VCS, Workflow Guardrails, `per_message_effort`](#lesson-136----feature-surfaces)
137. [Lesson 137 — Retired Surface, Codename Triage & Confirmed Negatives](#lesson-137----retired-surface-codename-triage--confirmed-negatives)

---

# LESSON 133 — PROVIDER & AUTH LANDSCAPE

**`An()` — the model-provider discriminator — now returns SEVEN values, and two of them are new first-party-on-hyperscaler offerings distinct from the existing BYOC paths.**

Verbatim (2.1.217):

```
function An(){ if(my()) return "gateway";
  return Z.CLAUDE_CODE_USE_BEDROCK ? "bedrock"
    : Z.CLAUDE_CODE_USE_FOUNDRY ? "foundry"
    : Z.CLAUDE_CODE_USE_ANTHROPIC_AWS ? "anthropicAws"
    : Z.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD ? "anthropicGoogleCloud"
    : Z.CLAUDE_CODE_USE_VERTEX ? "vertex"
    : … "firstParty" }
```

- **`anthropicAws` / `anthropicGoogleCloud` are new** (via `CLAUDE_CODE_USE_ANTHROPIC_AWS` / `CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD`, both real `Z.` reads). These are the **CLI side of "Claude Platform on AWS / Google Cloud"** — Anthropic-operated first-party APIs hosted on a hyperscaler, distinct from the customer-BYOC `bedrock`/`vertex` paths (which point at the customer's own AWS/GCP account). The `anthropicGoogleCloud` path carries its own credential quad: `ANTHROPIC_GOOGLE_CLOUD_{BASE_URL, LOCATION, PROJECT, WORKSPACE_ID}` + `CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH`.
- **`foundry`** (Azure AI Foundry) is also present with `ANTHROPIC_FOUNDRY_AUTH_TOKEN` re-added (it had been removed in an earlier pass per the changelog history — a re-add, not net-new).
- **Bedrock credential-chain tuning:** `CLAUDE_CODE_AWS_CHAIN_RESOLVE_TIMEOUT_MS`, `CLAUDE_CODE_SKIP_AWS_CRED_CACHE`, `CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_GUARD` (changelog 2.1.208 "Bedrock `awsCredentialExport` multi-minute startup hang" fix era). Removed: `ANTHROPIC_BEDROCK_MANTLE_API_KEY` (the `L$r()` "mantle" sub-path Ch27/L110 noted — retired).
- **Model-fallback:** `CLAUDE_CODE_NO_MODEL_FALLBACK` + `CLAUDE_CODE_REFUSAL_FALLBACK_CATCH_ALL` extend Ch27/L110's `fallbackModel` 3-chain (opt-out + a catch-all refusal-fallback tier). `CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE` + `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` **removed** (the fast-mode-per-model surface Ch27/L110 documented is gone; fast mode is now model-agnostic).

**Cross-artifact note:** `An()`'s provider set is agent-side; Cowork host-loop runs this binary, so a Cowork deployment on Anthropic-AWS/GCP would resolve through the same switch. Announced surface in the changelog is generic ("Bedrock/Vertex/Foundry" auto-mode at 2.1.207/2.1.210); the `anthropicGoogleCloud`/`anthropicAws` **first-party-platform names are dark** (not in the official changelog by name).

---

# LESSON 134 — SUB-AGENT FAN-OUT CAPS NOW EXIST

**The standalone CLI now enforces real, model-visible sub-agent fan-out caps on the Task dispatch path — CORRECTING Ch35/L121's "NO Task fan-out cap" and v2.22.1's "the Desktop caps Task fan-out nowhere."** The caps live in the shared agent binary (the one host-loop Cowork runs), landed across 2.1.212 (per-session) and 2.1.217 (concurrent + nesting-off).

Four distinct limits, all first-party-verified with concrete defaults and CHANGELOG-corroborated:

| Limit | Accessor | Default | Enforcement | Landed |
|---|---|---|---|---|
| Concurrent running sub-agents | `KEu()` = `Z.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ?? DUg` | **20** | `if(taskRegistry.getConcurrentSubagents() < KEu()) return;` else throws *"Concurrent subagent limit reached. You can run 20 subagents at once. Do not retry."* (telemetry `subagent_concurrency_cap`); **bypass gate `tengu_amber_kestrel`** | 2.1.217 |
| Total sub-agent spawns per session | `YEu()` = `?? HUg` | **200** | `if(taskRegistry.getTotalAgentSpawns() >= YEu()) throw` (telemetry `subagent_count_cap`) | 2.1.212 |
| WebSearch calls per session | `JEu()` = `?? OUg` | **200** | session-wide WebSearch limit | 2.1.212 |
| Sub-agent spawn depth | `Uue()` = env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, else gate `tengu_hazel_trellis`, fallback **`DEu=1`** | **1 (nesting OFF)** | changelog 2.1.217: *"subagents no longer spawn nested subagents by default; set `MAX_SUBAGENT_SPAWN_DEPTH` to allow deeper nesting"* | 2.1.217 |

**Reconciliation with Ch35/L121 (important, not a contradiction):** Ch35 documented a hard depth cap of 5 (`NMr`/`BLr`) and "no fan-out cap." The refresh adds (a) a **default spawn depth of 1** — nesting is now OFF by default, `DEu=1` — while Ch35's 5 remains the *ceiling* you can raise to; and (b) genuine **fan-out caps** (concurrent 20, per-session 200) that did not exist when L121 was written. So L121's "no fan-out cap" was true for its binary and is now false; the depth-5 finding stands as the ceiling.

**`CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP` is NOT one of these** — it governs whether an Explore sub-agent inherits the parent model (`return "inherit"`) vs is capped to a cheaper model; a model-inheritance knob, not a fan-out cap.

**Cowork applicability (partially verified):** the caps run via `taskRegistry` in the agent binary, which host-loop Cowork executes — so they structurally apply there. Not separately traced this pass: whether the Desktop's own `Task` PreToolUse hook (Ch29/L115) or VM-loop interact with these; treat "applies to host-loop Cowork" as mechanism-level, not a live Cowork observation.

**Adjacent, dark:** `CLAUDE_CODE_EXPERIMENTAL_OBSERVER_AGENTS` + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (real reads, absent from the changelog) — a new experimental agent-class surface, undocumented; `--max-budget-usd` now also stops background sub-agents (2.1.217).

---

# LESSON 135 — COMMAND SURFACE

**+10 slash commands, −1, 11 changed descriptions. Hook event types unchanged at 30. The headline is the `/fork`→`/subtask` split; the dark ones are `/import` and `/artifacts`.** All figures are registration-level (per-command `isEnabled` fn identified); reachability is not empirically tested per the three-gate discipline — treat as "registered + gated by X", not "confirmed live in every context".

**The `/fork` → `/subtask` split (announced, 2.1.212).** `/fork` was redesigned to **copy the conversation into a new background session** (its own agent-view row) while the user keeps working; the old *in-session* subagent behavior moved to the new **`/subtask`** ("Send a subagent off with your full context; its result comes back here", `argumentHint:"<task>"`, `isEnabled:()=>!Hb()`). This refines Ch19/L87 (`/fork`) and Ch29/L115 (resume/continuation): `/subtask` is the foreground "delegate and get the result back here" primitive; `/fork` is now the background-session fork.

**New commands + their `isEnabled`:**
- `artifacts` — "Browse your published and shared artifacts", `isEnabled:()=>H2()`. **DARK** (not in changelog) — the CLI face of Ch27/L112's Artifacts dark-launch.
- `import` — "Import config from another AI coding agent", `argumentHint:"[codex|gemini] [--dry-run]"`, `immediate:!0`, `isEnabled:Zxe`. **DARK.**
- `subtask` — see above.
- `workshop` — "Workshop a document through artifact decisions", `isEnabled:v8r`. Artifact-adjacent.
- `design-consent` / `design-revoke` — grant/revoke Claude agent access to Design projects, both `isEnabled:()=>T2e()`. Note: the `CLAUDE_CODE_ENABLE_DESIGN_MCP` env was **removed** and `/design` went dynamic — the Design surface was reshuffled (Ch27/L112), not simply expanded; trace before asserting Design is live.
- `explain-usage` — "See where this session's tokens went, in plain words", `isEnabled:OZe`.
- `bug` — "Report a bug or share your conversation" (registered via a non-standard path — not a plain `name:"bug"` literal; likely a `feedback` alias).
- `workflow-launch-exec` — "Execute a server-launched workflow handoff" (event-driven `workflow_launch` handoff, not a typed user command).
- `setup-cowork` (dynamic).

**Removed:** `cowork-plugin` (1 command). Changelog-confirmed removal from the prior era: the `/agents` wizard (2.1.198 — "subagents spawn directly via the Agent tool now").

**11 changed descriptions** (mostly `(dynamic)`-ization: `/design`, `/doctor`, `/login`, `/navigate`; `/fork` reworded per the redesign; `/feedback` → "Send feedback to Anthropic or report a bug"; `/passes` → "View and update your privacy settings"; `/remote-control` → "Manage background services and routines"; `/auto-mode-setup` gained a full description).

---

# LESSON 136 — FEATURE SURFACES

**Cross-cutting feature work surfaced by the refresh — grouped, with announced/dark status.**

- **Artifacts (dark cluster).** Beyond the `/artifacts` + `workshop` commands: `tengu_artifact_hljs_highlight`, `tengu_artifact_mermaid_diagrams`, `tengu_artifact_disabled_session`, `tengu_artifact_unobserved_connector_warning`. The CLI Artifacts feature (Ch27/L112, `claude.ai/code/artifact/${slug}`) is being built out (syntax highlighting, mermaid, connector-safety warnings) but remains changelog-dark.
- **Auto-mode setup wizard (announced-adjacent).** `tengu_auto_mode_setup_wizard_{shown,answers,resolved}` + `tengu_auto_mode_beta_latch` back the changed `/auto-mode-setup` description ("Set up and customise auto mode — environment context, …") and `claude auto-mode reset` (changelog 2.1.212). Auto mode (Ch21/L91–L104) gains a guided onboarding.
- **Agent-proxy / VCS (ties to Ch37/L130).** `CLAUDE_CODE_AGENT_PROXY_GH_SHIM` + `CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG` (real reads) — the agent proxies `gh`/git config for sub-processes. This is the same fleet/PR territory as Ch37/L130's VCS SDK events (`bindPrFromUrl`, the Managed Agents fleet): the agent increasingly mediates git/PR tooling for the environments it runs in.
- **Workflow guardrails (announced, 2.1.202).** `CLAUDE_CODE_WORKFLOW_SIZE_WARNING_{AGENTS,TOKENS}` back the "Dynamic workflow size" `/config` setting + `workflow.run_id`/`workflow.name` OTel attributes — a guardrail over Ch21's Dynamic Workflows (1000-agent cap). Remote/bridge workflow plumbing: `CLAUDE_REMOTE_WORKFLOW_{SCRIPT,ARGS}`, `CLAUDE_WORKFLOW_NAME_ONLY`, `CLAUDE_CODE_TRIGGER_ID`, `CLAUDE_CODE_BRIDGE_SESSION_ID`.
- **`per_message_effort` beta (announced).** API beta `per-turn-control-2026-07-01` (`QC("per_message_effort", …)`) — the header behind headless/SDK mid-turn `set_model`/effort control (changelog 2.1.200/2.1.212). Betas net: **+`per-turn-control-2026-07-01`, −`summarize-connector-text-2026-03-13`.**
- **Memory / knowledge-base tuning (mixed).** `CLAUDE_CODE_DISABLE_ORG_MEMORY` (**dark** — org-scoped memory, undocumented), `CLAUDE_CODE_DISABLE_MEMORY_STREAM_LIST`, `CLAUDE_CODE_MEMORY_PUSH_DELETE_MODE` — extend Ch27/L113's auto-memory→knowledge-base evolution.
- **Observability/misc (real reads):** `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH` (announced 2.1.214), `CLAUDE_CODE_GZIP_REQUEST_BODIES`, `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF`, `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC`, `CLAUDE_CODE_SEND_FEEDBACK`, `CLAUDE_CODE_FLEETVIEW_SIMPLE`, `CLAUDE_CODE_RESUME_SOURCE_ALIVE`, `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS`, `CLAUDE_CODE_TOTAL_TOKENS_REMINDER_AFTER_USER_TURN`, `CLAUDE_CODE_ENABLE_REFRESH_MCP_TOOLS`, `CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT`, `CLAUDE_CODE_SYNC_SESSION_REFS`, `CLAUDE_AX_STARTUP_QUIET_MS` (screen-reader, 2.1.208), `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT` (announced 2.1.211).

---

# LESSON 137 — RETIRED SURFACE, CODENAME TRIAGE & CONFIRMED NEGATIVES

**Removed env vars (14) — several reconcile prior chapters:**
- `CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE` + `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE` — per-model fast-mode surface retired (reconcile Ch27/L110).
- `CLAUDE_CODE_VERIFY_PROMPT` — **removed** (was Ch21/L90's debugging-discipline injection + `tengu_sparrow_ledger`); the changelog shows `/verify` and `/code-review` skills stopped auto-running at 2.1.215 — the env-injected verify-prompt discipline is gone. A genuine reversal worth flagging.
- `CLAUDE_CODE_ENABLE_DESIGN_MCP` — removed (Design surface reshuffled, see L135).
- `CLAUDE_BRIDGE_USE_CCR_V2` + `CLAUDE_CODE_USE_CCR_V2` — CCR v2 bridge retired.
- `ANTHROPIC_BEDROCK_MANTLE_API_KEY` — mantle sub-path retired (L133).
- `CLAUDE_CODE_MID_CONVERSATION_SYSTEM` (Sonnet 5 mid-conversation system-role removal, changelog 2.1.201), `CLAUDE_CODE_OWNERSHIP_FRAME`, `CLAUDE_CODE_PLAN_MODE_INTERVIEW_PHASE` (plan-interview residue, Ch21), `CLAUDE_CODE_SKILL_DESCRIPTION` + `CLAUDE_CODE_SKILL_DESC_REFRAME`, `CLAUDE_CODE_SHOJI_ENGINE`, `CLAUDE_INTERNAL_WARM_RESUME_QA` — prompt-shaping/experiment vars retired.

**Codename cluster (dark by nature, real reads).** Nine `CLAUDE_CODE_*` adjective/noun codenames — `ALDER_WICKET`, `AMBER_ASTROLABE`, `BASALT_COVE`, `BISON_CAIRN`, `GAULT_KESTREL`, `HERON_TALLOW`, `LANTERN_PRISM`, `LARCH_CISTERN`, `MARL_CORMORANT`, `NANKEEN_KESTREL`, `THISTLE_GREBE`, `WALNUT_SPIRE` — each a single `Z.` read paired with a matching `tengu_*` telemetry id (e.g. `tengu_alder_wicket`, `tengu_amber_astrolabe`). These are dark-launch experiment latches; individual feature resolution is left to a future pass (most are one-line gate reads). The `3P_PROBE_WROTE_{OPUS,SONNET}_DEFAULT` pair relates to third-party-deployment default-model probing.

**247 new `tengu_*` identifiers.** Beyond the clusters named above (artifact, auto-mode-wizard, codenames), notable: `tengu_agent_worktree_cwd_escape_blocked` (worktree cwd-escape guard — reconcile Ch37/L131 `harnessCwd` + Ch35 cwd-gating), `tengu_bg_prewarm_burst*` / `tengu_bg_launcher_*` (background-agent lifecycle), `tengu_advisor_tool_error`, `tengu_ask_user_question_{skipped,timeout_changed}` (AskUserQuestion auto-continue removal, changelog 2.1.200), `tengu_bg_agent_notification`. Full triage-to-gate is deferred; these are telemetry/flag identifiers, not all model-visible surface.

**Confirmed negatives (write these explicitly — the diff verifies non-change):**
- **Hook event types: 30, no add/remove** — L111's count holds through 2.1.217.
- Unchanged counts: 502 env vars, 139 slash commands (base set), 40 API betas (net; +1/−1), 1470 `tengu_*` (base).
- **New tool:** `EndConversation` (changelog 2.1.214 — "Claude can end sessions with highly abusive users or jailbreak attempts") — already surfaced in this repo's deferred-tool inventory; now changelog-confirmed as a real 2.1.214 addition.

---

## The bigger picture — what Anthropic is doing across v2.1.198 → v2.1.217

The individual deltas cohere into four strategic moves. This reads the refresh as a whole, not lesson-by-lesson.

**1. Governance of autonomous parallelism becomes a default, not an opt-in.** Every prior release *enabled* more parallelism (Dynamic Workflows, agent teams, background sessions, Fleet). This window *bounds* it: concurrent cap (20), per-session spawn cap (200), WebSearch cap (200), **nesting off by default**, workflow-size warnings, and `--max-budget-usd` now halting background sub-agents. The trigger is cost and runaway-loop reality — community math puts 10 parallel agents at 10× token burn (~$50–65/dev/day) and agent teams at 3–4× a single session ([CloudZero](https://www.cloudzero.com/blog/claude-code-agents/), [Developers Digest](https://www.developersdigest.tech/blog/what-parallel-claude-agents-actually-cost)). **Implication for authors:** the default posture flipped from "fan out freely" to "fan-out is capped and non-nesting unless you raise the limits" — workflows written against the old unbounded model will now hit hard "Do not retry" errors. (Note a nuance: the new `MAX_CONCURRENT_SUBAGENTS=20` Task cap is distinct from the older `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` ~16 Workflow cap — two mechanisms, both real.)

**2. Enterprise distribution moves into the CLI via hyperscaler-native first-party.** The new `anthropicAws`/`anthropicGoogleCloud` `An()` providers are the CLI side of **Claude Platform on AWS / Google Cloud**: Anthropic operates the inference stack, the hyperscaler provides only IAM/auth, and customers use it **through their existing cloud account with no separate Anthropic account** — explicitly *unlike* Bedrock/Vertex BYOC (where the cloud operates inference and first-party features lag) ([Claude Platform on AWS docs](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws), [cloudcomputing-news](https://www.cloudcomputing-news.net/news/claude-platform-on-aws-anthropic-partnership/)). Combined with the enterprise **Gateway** (the `gateway` `An()` value; [DevOps.com](https://devops.com/anthropic-adds-enterprise-gateway-to-simplify-claude-code-access-on-aws-and-google-cloud/)) and Azure **Foundry**, Claude Code now speaks to the same first-party platform across all three clouds' procurement/IAM rails. **Implication:** enterprises adopt Claude Code through the cloud contract and identity system they already have, with same-day feature/beta parity — a go-to-market lever, not just an auth path. That the `anthropicGoogleCloud` name is still changelog-dark suggests staged rollout.

**3. Multi-agent orchestration primitives are being differentiated and named.** The `/fork` → `/subtask` split is the tell: **`/subtask`** = foreground "delegate with full context, result returns here"; **`/fork`** = background session with its own agent-view row. Add dark `EXPERIMENTAL_OBSERVER_AGENTS` + `EXPERIMENTAL_AGENT_TEAMS` and the workflow guardrails, and the shape is an IDE growing a *vocabulary* for multi-agent work — delegation vs. backgrounding vs. observation vs. teams vs. workflows — each with distinct cost/coordination profiles ([Developers Digest: primitives compared](https://www.developersdigest.tech/blog/claude-code-subagents-vs-agent-teams-vs-workflows)). **Implication:** "spawn a subagent" is no longer one thing; authors must pick the primitive matching the cost and lifecycle they want.

**4. The CLI is becoming the runtime for a supervised cloud fleet (continues Ch37/L130).** The agent-proxy `gh`/git shims, the VCS SDK events, remote/bridge workflow plumbing (`CLAUDE_REMOTE_WORKFLOW_*`, `CLAUDE_CODE_TRIGGER_ID`, `CLAUDE_CODE_BRIDGE_SESSION_ID`), and `per_message_effort` mid-turn control all point the same way: the agent increasingly mediates git/PR tooling and reports structured state for a central orchestrator (Managed Agents). **Implication:** the same governance (caps, budgets, observability) that matters locally is the substrate a fleet supervisor needs — the local guardrails and the cloud-fleet telemetry are two views of one system.

**Net:** this refresh is less a feature drop than a *maturation* pass — Anthropic putting cost/safety rails, enterprise distribution, and orchestration vocabulary around the autonomous-agent capabilities it shipped over the prior year. The direction is consistent with the Ch37 read: autonomous, parallel, cloud-hosted agents whose use has to be *bounded, billable, and supervised* to be enterprise-viable.

*Confidence: the four themes are synthesis/inference over first-party binary facts (§L133–L137) plus public reporting (linked); the Platform-on-hyperscaler and cost figures are public-sourced, not binary-derived; theme 3's observer-agents/agent-teams internals are dark (env-var presence only).*

## What this means for skill and agent authors

- **Sub-agent fan-out is now capped by default** — 20 concurrent, 200/session, and **nesting is off unless you raise `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`**. A skill/workflow that assumed unbounded fan-out (valid under Ch35/L121's binary) will now hit `subagent_concurrency_cap`/`subagent_count_cap` with a "Do not retry" error. Design for the caps or set the env overrides.
- **`/subtask`, not `/fork`, is the "delegate and get the result back inline" primitive** now; `/fork` copies the conversation into a background session. Update any docs/skills that referenced `/fork` for in-session delegation.
- **Provider detection has two new first-party-on-hyperscaler values** (`anthropicAws`/`anthropicGoogleCloud`) distinct from BYOC `bedrock`/`vertex` — code that branches on `An()` must handle seven values.
- **Dark-launched, don't build on yet:** `/import`, `/artifacts`, observer-agents/agent-teams, org-memory, the `anthropicGoogleCloud` path by name — present in the binary, absent from the official changelog.
- **`CLAUDE_CODE_VERIFY_PROMPT` is gone** — if a workflow relied on the injected reproduce→fix→re-observe discipline (Ch21/L90), it no longer exists.

**Cross-references.** Ch35/L121 (sub-agent execution model — L134 corrects its "no fan-out cap") · Ch27/L110–L113 (the prior content baseline v2.1.198 — this chapter supersedes several of its env-var/model facts) · Ch37/L130 (VCS SDK events / Managed Agents fleet — L136's agent-proxy `gh`/git shim is the same territory) · Ch19/L87 + Ch29/L115 (`/fork` + resume — L135's `/fork`→`/subtask` split refines both) · Ch21/L91–L104 (Dynamic Workflows + auto-mode — L136's workflow-size guardrails + auto-mode wizard) · Ch18/L86 (provider/OIDC auth — L133's `An()` expansion).
