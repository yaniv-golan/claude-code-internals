Updated: 2026-08-14 | Source: First-party CLI bundle diff **v2.1.217 → v2.1.231** (the v2.1.217 baseline CDN-recovered from `downloads.claude.ai/claude-code-releases/2.1.217`, sha256-verified `5840c777fd47115e…`, size 250,456,784 b matching the manifest, extracted to a 21.7 MB bundle; 2.1.231 the live installed CLI, 26.5 MB bundle), cross-checked against the official Anthropic CHANGELOG (2.1.218–2.1.231). Full machine diff at `docs/internal/diff-2.1.217-to-2.1.231.txt`. This is a **CLI content refresh** chapter and it **moves the CLI content baseline to v2.1.231** (from Ch38's v2.1.217). Env-var additions were source-verified against real proxy read sites (`Q.VAR`) — the diff tool flagged 55 of 62 additions "no `process.env` read", and a 17-var sample found 14 with genuine reads, so that flag remains a **false-positive class**, not evidence of dead code (Ch38 found the same). Where a fact bears on Cowork, applicability is called out as verified or not.

# Chapter 42: CLI content refresh v2.1.217 → v2.1.231

---

## TABLE OF CONTENTS

153. [Lesson 153 — Self-Hosted Runners: Your Own Machines Become Claude's Compute](#lesson-153----self-hosted-runners)
154. [Lesson 154 — The Device Bridge: the CLI Serves Shell and File Tools to claude.ai](#lesson-154----the-device-bridge)
155. [Lesson 155 — `DirectoryAdded`, the 31st Hook Event — correcting the "30 events" figure](#lesson-155----directoryadded-the-31st-hook-event)
156. [Lesson 156 — Artifacts Grew a Backend: Comments, Autoreact, and an Agent Responder](#lesson-156----artifacts-grew-a-backend)
157. [Lesson 157 — Remote-Session State: Directory Sync, Cross-Session Messaging, and L151's Closed Loop](#lesson-157----remote-session-state)
158. [Lesson 158 — The `UTr()` Codename Resolver, New Betas & Retired Surface](#lesson-158----the-utr-codename-resolver-new-betas--retired-surface)

---

# LESSON 153 — SELF-HOSTED RUNNERS

**`claude self-hosted-runner` turns a customer's own machines or containers into the execution substrate for Claude Code web, mobile, and desktop sessions.** This is the single largest addition in the range: `self_hosted_runner` appears **67 times in 2.1.231 and 0 times in 2.1.217**. It is **announced** (changelog: *"Added self-hosted environments: `claude self-hosted-runner` turns your own machines or containers into a place Claude Code web, mobile, and desktop sessions can run, on **Team and Enterprise plans**"*), with six follow-up fixes across the range.

**The subcommand.** Dispatched from argv, telemetered as `cli_self_hosted_runner_path`:

```
if(t[0]==="self-hosted-runner"){ r("cli_self_hosted_runner_path");
  let m=t[1]; if(m==="orchestrator"){ let{selfHostedRunnerOrchestratorMain:g}=…; await g(t.slice(2)); … } }
```

Runner flags (verbatim from the argv builder): `--environment-secret-file`, `--capacity`, `--base-dir`, `--api-url`, `--health-port`, `--log-file`, plus `--use-anthropic-git-proxy`. Defaults in the module: API `https://api.anthropic.com`, base dir `/workspace`, health port `8080`. `--use-anthropic-git-proxy` **requires `--capacity 1`** (fatal otherwise: *"the proxy URL is per-session"*). Windows requires an explicit `--base-dir` — there is no default checkout directory there (changelog).

**The work-order handoff is the interesting part.** The orchestrator receives a signed **work-order JWT**, validates its charset, writes it to a file, and spawns a customer-supplied **`spawn-runner` hook**, passing everything through the environment:

```
if(!/^[A-Za-z0-9_.-]+$/.test(e.jwt)) throw Error("spawn-hint work_order_jwt: unsafe character (not base64url + dot)");
let n = await i4w(`work-order-${e.claims.jti}`, e.jwt);
let o = {...process.env,
  SELF_HOSTED_RUNNER_POOL_SECRET: void 0, SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET: void 0,
  CLAUDE_RUNNER_WORK_ORDER_FILE:n, CLAUDE_RUNNER_ORDER_ID:e.claims.jti, … }
```

Three design facts worth keeping:

1. **The 16 `CLAUDE_RUNNER_*` variables are written, never read, by this binary.** They are the runner's inbound contract, populated from JWT claims: `WORK_ORDER_FILE`, `ORDER_ID` (= `jti`), `SESSION_ID`, `SESSION_UUID`, `ATTEMPT`, `POOL_ID`, `ACCOUNT_EMAIL`, `ACCOUNT_ID`, `ORDER_SERVER_TIME`, `PRIMARY_REPO_URL`, `PRIMARY_REPO_REVISION`, `REPO_SOURCES`, `CORRELATION_ID`, `CLIENT_PLATFORM`. This is why the diff tool flagged them as having no read site — **correctly, but for a reason that means the opposite of "dead"**. It is the same producer-before-consumer shape as Ch41/L151, and the general lesson is that a producer-side env contract looks identical to dead code under a read-site grep.
2. **Two pool secrets are explicitly scrubbed** (`SELF_HOSTED_RUNNER_POOL_SECRET`/`_ENVIRONMENT_SECRET` set to `void 0`) before the hook inherits `process.env`. The orchestrator's own credentials deliberately do not reach the customer's spawn script.
3. **The JWT goes to a file, not to the environment** — only the *path* is exported.

**Failure handling is a real ladder, not a `kill()`.** The hook is spawned `detached`, `windowsHide`, `stdio:["ignore","pipe","pipe"]`; on timeout the orchestrator sends `SIGTERM` to the process *tree*, then `SIGKILL`, then — if the child still has not exited (*"likely D-state"*) — logs and **abandons** it, resolving as timed out. stdout/stderr are line-split, stripped of control characters, capped at 64 KB rolling buffers, and surfaced as `[runner:hook:spawn-runner] …` status lines; a bounded stderr tail becomes `last_error`.

**`CLIENT_PLATFORM` has an env-export gate.** If `claims.client_platform` fails validation it is sanitized and `CLAUDE_RUNNER_CLIENT_PLATFORM` is **left unset**, with a debug line naming the rejection — an untrusted-claim-to-environment boundary.

**Operator surface.** Eleven `self_hosted_runner_*` names ship: `get_pool`, `list_runners`, `list_secrets`, `list_sessions`, `read_health`, `read_metrics`, `requeue_session`, `spawn_local`, `tail_log`, `path`, `pool_id`. The bundle also embeds an operator troubleshooting table keyed on `"last_error"`, `queue_counts.backing_off`, and per-session `spawn_last_error`, describing exponential-backoff retry per session.

**Cowork/adjacent:** 2.1.229 added *"server-supplied Claude Code hook support for self-hosted runner sessions, matching managed-environment behavior"* — i.e. hooks delivered by the server, the same class of server-delivered configuration Ch41/L149 documented as a gating class invisible to the fcache. Not separately traced this pass.

---

# LESSON 154 — THE DEVICE BRIDGE

**The CLI can register itself as a remote-controlled *device* and serve shell and filesystem tools over a WebSocket to claude.ai. This is the CLI-side counterpart of Ch36/L126's Desktop `remote_devices`/`computer_*` tools, and it is DARK** — the word "device" appears **zero** times in the official changelog across 2.1.218–2.1.231, while `deviceBridge` appears 25 times in the binary and 0 times in 2.1.217.

**This resolves the open question in Ch36/L126,** which found `remote_devices` (`session_type:"cowork-remote"`) Desktop-side but noted *"its own `isEnabled` gating was not traced, so live reachability is unconfirmed."* The other end now exists in the CLI with its gating fully readable.

**Methodology note first, and it cuts both ways.** `diff-versions.sh` reported seven new **slash commands** — `bash`, `edit`, `glob`, `grep`, `read`, `write`, `list-agents`. They are **not slash commands**. They are MCP **tool definitions** (`OUt({name:"bash",description:"Run a bash command in a persistent shell…"})`) registered on a device MCP server. The extractor matches `name`+`description` pairs and cannot tell a command registration from a tool registration. **Never report the command diff without opening the surrounding constructor.**

The same diff reported three commands **removed** — `custom`, `review`, `workshop` — and that is equally wrong. `name:"workshop"` does go 1 → 0, but the bare string `workshop` goes **30 → 314**, and `review` goes 1730 → 2271. They were **reclassified, not deleted**: `workshop` now appears in a skill-name list beside `artifact-design`, `artifact-diagramming`, `artifact-capabilities`, `whiteboard`, `prototype`, `dataviz`, `code-review` and `artifact-pr-review`, with its own `.workshop.md` / `.workshop.html` file conventions and a `workshopBlessedHashes` set. So the slash command became a **bundled skill**. **A count is the check, not the diff** — on both the added and the removed side, and a "removed" command that is 10× more present than before has obviously moved rather than gone.

**Enablement** — three independent conditions plus identity:

```
function Zxt(){ return !ka() && Jn()==="firstParty" && Ms("allow_remote_sessions") }
```

- **first-party provider only** — a Bedrock/Vertex/Foundry/gateway deployment (Ch38/L133's `An()` seven) never gets a device bridge.
- **`allow_remote_sessions` policy setting**, which the compliance table denies under **HIPAA** (`["hipaa","allow_remote_sessions"]`), alongside `allow_remote_control`. A HIPAA-mode org structurally cannot expose a device.
- Requires both `orgUuid` and `accountUuid`; otherwise the attempt is abandoned with `tengu_device_bridge_skipped {missing_org, missing_account}`.

**URL resolution and transport hardening:**

```
function Q8p(){ if(hp.CLAUDE_REMOTE_TOOLS_BRIDGE_URL!==void 0) return hp.CLAUDE_REMOTE_TOOLS_BRIDGE_URL;
  switch(zZe()){ case "": return TpS; case "-staging-oauth": return wpS; default: return } }
```

The bridge URL is an **OAuth-environment-derived constant** (production / staging), overridable by `CLAUDE_REMOTE_TOOLS_BRIDGE_URL`; if the OAuth environment is neither, the function returns `undefined` and the bridge is skipped (*"no device bridge for this OAuth environment"*). A separate validator enforces the socket policy: same origin, **empty username and password**, and `wss:` — permitting plain `ws:` **only** for `localhost`/`127.0.0.1`/`[::1]`. The device path is built from org, account, and a device name derived from hostname + session id.

**What the device exposes.** `createDeviceMcpServer` + `deviceInfoProbeTool` + `parseJsonRpcMessage`. The six file/shell tools are real implementations, not stubs — the `bash` tool is a **persistent shell**: state (cwd, env) survives across calls, `restart` tears it down, per-call `timeout_ms`, and exit codes are recovered by writing a `__ANT_CMD_<uuid>_DONE__` sentinel plus `printf '\n%d\n' $?` into the shell and parsing it back out, with `[output truncated]` prefixing over-long output and a process-group `SIGKILL` on close.

**Read this as a security surface, not a feature list.** A first-party, non-HIPAA, logged-in CLI with `allow_remote_sessions` permitted can be driven to run arbitrary shell commands and read/write files on the host from a remote client. The gating is real and layered, but the capability is exactly as broad as it sounds, and roughly 20 `tengu_device_*` telemetry identifiers (`device_bash_served`/`refused`/`timed_out`/`output_limit`, `device_bind_*`, `device_bridge_*`) indicate an actively instrumented, not vestigial, path.

---

# LESSON 155 — `DirectoryAdded`, THE 31st HOOK EVENT

**The hook event count moved from 30 to 31 — the first change since Ch21/L94. Every "all 30 hook events" statement in this skill (including `SKILL.md` and `CLAUDE.md`) was correct through v2.1.217 and is now stale.** This is **announced** (changelog: *"Added `DirectoryAdded` hook that fires after `/add-dir` or the SDK `register_repo_root` control request registers a new working directory mid-session"*).

Verbatim master arrays, both versions:

| | count | tail of array |
|---|---|---|
| 2.1.217 | **30** | `…,"CwdChanged","FileChanged","MessageDisplay"` |
| 2.1.231 | **31** | `…,"CwdChanged","FileChanged","DirectoryAdded","MessageDisplay"` |

It is wired everywhere a real event is wired — the master array, the plugin `hooksConfig` registry initializer, `HOOK_EVENT_REGISTRY` (`DirectoryAdded:Der`), the exported `executeDirectoryAddedHooks`, and the matcher-dispatch switch.

**Input schema (verbatim Zod):**

```
hook_event_name: It("DirectoryAdded"),
directory: N().describe("Absolute path of the directory that was added."),
source: Mr(["slash_command","register_repo_root"])
  .describe('How the directory was added: "slash_command" for /add-dir, "register_repo_root" for the SDK co…')
```

**The `matcher` matches `source`, not a path** — `matcherMetadata:{fieldToMatch:"source", values:["slash_command","register_repo_root"]}`, confirmed by the dispatch switch (`case "DirectoryAdded": a=n.source`). Writing a matcher expecting a directory path will simply never fire.

**Ordering guarantee, verbatim:** *"Fires **after** the sandbox configuration has been refreshed — so sandboxed tools and permission state already see the new directory (hook commands themselves run unsandboxed)."*

**A real asymmetry between the two sources** — worth knowing before relying on hook output:

> *"Other exit codes - stderr is debug-logged on both paths; for `/add-dir`, a failure count is summarized to Claude and hook `systemMessage` output reaches Claude as bounded context; for `register_repo_root`, everything is debug-logged only"*

So a `DirectoryAdded` hook that returns a `systemMessage` influences the model **only** on the `/add-dir` path; over the SDK control request the same hook is silent to the model. On the `/add-dir` path the messages arrive as `mode:"task-notification"`, `isMeta:!0`, prefixed `DirectoryAdded hook:`, with failures collapsed into *"N DirectoryAdded hooks failed; output is in the debug log, not shown here"*.

**Duplicate registration does not re-fire it,** verbatim: *"A directory that is already a registered working directory (including a duplicate of an earlier request) is denied with an error; the registration pipeline and `DirectoryAdded` hooks do not re-run."*

**Adjacent control-protocol addition:** `register_repo_root` gained a sibling subtype **`set_cwd`** — *"Target directory. Tilde-expanded and realpath-canonicalized by the CLI, exactly like an interactive `/cd` argument"* — with a `trust_accepted` field. This extends the Ch24/L107 + Ch26 control-protocol surface.

---

# LESSON 156 — ARTIFACTS GREW A BACKEND

**Artifacts — dark-launched in Ch27/L112 as a publish target — now carry comments, an assets/live/viewer URL split, and an agent that answers comments. Still dark: "artifact" and "comment" each appear ZERO times in the changelog for this range,** while eight new `CLAUDE_CODE_ARTIFACT*` variables landed.

**The gate, verbatim:**

```
function h$n(){ return Q.CLAUDE_CODE_ARTIFACT_COMMENTS ?? rt("tengu_teal_corbel",!1) }
```

Env override, else GrowthBook gate **`tengu_teal_corbel`**, **default `false`** — comments are off unless flipped server-side.

New variables, with source-verified read status:

| Variable | Real `Q.` read | Note |
|---|---|---|
| `CLAUDE_CODE_ARTIFACT_COMMENTS` | ✅ | master switch, gate `tengu_teal_corbel` |
| `CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT` | ✅ | auto-reaction to comments |
| `CLAUDE_CODE_ARTIFACT_COMMENT_RESPONDER` | ✅ | the agent that replies |
| `CLAUDE_CODE_ARTIFACT_DB` | ✅ | local comment/artifact store |
| `CLAUDE_CODE_ARTIFACTS_API_TOKEN` | ✅ | joins the existing `_ARTIFACTS_API_BASE_URL` |
| `CLAUDE_CODE_ARTIFACT_ASSET_BASE_URL` | ✅ | asset origin |
| `CLAUDE_CODE_ARTIFACT_LIVE_BASE_URL` | ❌ (declaration only) | live/published origin |
| `CLAUDE_CODE_ARTIFACT_VIEWER_BASE_URL` | ❌ (declaration only) | viewer origin |

**The most telling detail is the author-role classifier:**

```
function P7(e){ if(e.role==="degraded") return "unknown";
  return e.role===void 0||e.role==="" ? "human" : "agent" }
```

Comments are explicitly typed **human vs agent**, with a third `"degraded"` → `"unknown"` state for when the role cannot be established. A system that only ever had human commenters would not need this. Combined with `_COMMENT_RESPONDER` and `_AUTOREACT`, the shape is agents reading and answering comments on published artifacts — and `tengu_cobalt_plinth_moss` joins Ch27/L112's `tengu_cobalt_plinth` master flag.

**`CLAUDE_CODE_PLAN_ARTIFACTS`** (real read) is a live variable name for the surface Ch27/L112 recorded as hard-disabled `/plan-artifact` — worth re-tracing before asserting either state.

---

# LESSON 157 — REMOTE-SESSION STATE

Three separate mechanisms landed for keeping a remote session's state coherent with a local one. All three are **dark** (no changelog mention of directory sync or cross-session messaging by name in this range).

**1. Worker directory sync.** `startWorkerDirSync` + ~16 `tengu_dir_sync_*` identifiers (`inventory`, `seed_complete`, `upload_start`/`_complete`, `apply_start`/`_complete`/`_timeout`, `pull`, `push`, `worker_rehome`, `mode_prompt`/`_shown`/`_skipped`, `mode_set`). Gating is **entrypoint-scoped**, with an env kill switch:

```
let b = Ing({entrypoint: Q.CLAUDE_CODE_ENTRYPOINT, disabled: Q.CLAUDE_CODE_DISABLE_DIR_SYNC});
if(S && !b.start && b.reason==="disabled") Tr("info","dir_sync_worker_disabled",{});
```

State lives beside the synced tree at **`.ccr-dir-sync/worker-<remoteSessionId>.json`**, keyed off `CLAUDE_CODE_REMOTE_SESSION_ID`, and the deps object reads `CLAUDE_CODE_WORKER_EPOCH > 1` to detect a **prior worker process** (the same epoch variable catalogued in Ch25/L108). Bounded by `MAX_APPLY_ATTEMPTS`, `MAX_CONSECUTIVE_AUTH_REFUSALS`, `MAX_CONSECUTIVE_PHASE_CRASHES`, and two latency caps (`WORKER_SYNC_BEFORE_TURN_CAP_MS`, `WORKER_SYNC_DEGRADED_CAP_MS`) — it is allowed to degrade rather than block a turn. A sibling `CLAUDE_CODE_DISABLE_WORKING_SYNC` guards `startSyncedFileSyncer(SYNCED_FILE_ROOT)`.

**2. Cross-session messaging.** `CLAUDE_CODE_HARBOR_KITE` resolves a capability whose user-facing refusal string is *"Cross-session messaging is not available in this session."*:

```
function Vb(){ if(Q.CLAUDE_CODE_HARBOR_KITE) return !0;
  if(Kt()==="windows" && !rt("tengu_harbor_kite_win",!1)) return !1;
  return rt("tengu_harbor_kite",!1) }
```

Note the **platform-specific second gate**: Windows requires its own `tengu_harbor_kite_win` flag on top of the general one — an OS-conditioned rollout, a gating shape not previously catalogued here. New `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN` sit alongside it, and the changelog's *"`ListAgents` now marks disconnected Remote Control sessions as `offline` and labels your cloud sessions as `cloud`"* is the visible face of the same area.

**3. Ch41/L151's open loop is now CLOSED.** L151 recorded that the Desktop wrote `CLAUDE_CODE_COWORK_FRAME_ARTIFACTS` with **no consumer** in any agent before 2.1.228. In 2.1.231 the consumer exists — 0 occurrences at 2.1.217, 6 now:

```
function WMc(e){ …; $6e.setCoworkFrameArtifacts(Q.CLAUDE_CODE_COWORK_FRAME_ARTIFACTS) }
function qMc(){ return $6e.coworkFrameArtifacts }
```

It is read in the **same session-identity normalizer** as `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_CHILD_SESSION`, and `CLAUDECODE` — the exact struct Ch30/L116's runtime-detection recipe reads. So `coworkFrameArtifacts` is now a first-class runtime-context bit, and L151's producer-before-consumer gap has closed in the predicted direction. That normalizer also still performs the `local_agent`→`local-agent` and `cli`→`sdk-cli` entrypoint rewrites Ch30/L116 documented.

The consumer is **three** distinct roles across six sites, not just the normalizer — prompted by the `cowork-harness` project's 1.30096.1 pass and then re-derived first-party against this CLI bundle:

1. **Runtime-context bit** — the normalizer setter/getter above (`setCoworkFrameArtifacts`/`qMc`).
2. **Cowork identity grouping** — it joins the two canonical Cowork markers in a three-element set, `RB_ = new Set(["CLAUDE_CODE_ENTRYPOINT","CLAUDE_CODE_IS_COWORK","CLAUDE_CODE_COWORK_FRAME_ARTIFACTS"])`. It is now treated as identity, alongside the marker Ch30/L116's detection recipe keys on.
3. **A case-INSENSITIVE scrub from child environments** — verbatim: `function xOt(e){ for(let t of Object.keys(e)) if(t.toUpperCase()==="CLAUDE_CODE_COWORK_FRAME_ARTIFACTS") delete e[t] }`. Note it uppercases every key before comparing rather than deleting a known key, so a differently-cased variant is stripped too. It also appears in two further child-env name lists.

**Do not carry the occurrence count across artifact classes.** The harness counted **13** occurrences in the Desktop-managed host agent **2.1.229**; this bundle — the **standalone CLI 2.1.231** — has exactly **6**. Those are different artifacts (CLAUDE.md treats standalone CLI, Desktop-managed host agent Mach-O, and in-VM ELF as distinct classes), so neither number is wrong and neither generalises.

---

# LESSON 158 — THE `UTr()` CODENAME RESOLVER, NEW BETAS & RETIRED SURFACE

**Codename flags are not ad-hoc — they share one four-source resolver, and knowing it collapses the whole triage cluster into a single rule.**

```
function UTr(e,t,r){ return e || fPo(r) || Xx()?.[t]===!0 || rt(t,!1) }
```

Resolution order: **(1)** the `CLAUDE_CODE_<CODENAME>` env var → **(2)** `fPo(model)`, which is true when the model carries an **`opus_5_prompt_bundle`** and a kill-flag is not set → **(3)** the session-config object `Xx()[gate]===true` (Ch41/L149's server-delivered class, invisible to the fcache) → **(4)** the GrowthBook gate `rt(gate,false)`. Callers are one-liners over it: `CLAUDE_CODE_GAULT_KESTREL`, `_GORSE_PLOVER`, `_AMBER_ASTROLABE`, `_BISON_CAIRN`, `_LARCH_CISTERN`. This generalises Ch41/L148's `built-*` stickiness pattern into a second named pattern: **a codename env var is an override on a gate, never a feature in itself.**

Two codenames resolve outside that shape and are individually informative:

- **`CLAUDE_CODE_JUNIPER_SUNDIAL`** is **numeric**, not boolean: env → `Xx().tengu_juniper_sundial` → gate `tengu_juniper_sundial` → default `TURNS_BETWEEN_MAINTENANCE`, coerced by `Math.max(1,Math.floor(x))`. A maintenance-cadence knob measured in turns.
- **`CLAUDE_CODE_THRIFTY_SONIC`** short-circuits on an explicit env value, then requires a model-allowlist check `is_()` before consulting `tengu_thrifty_sonic`.

**`CLAUDE_CODE_PARCHMENT_FERN`** sits in the prompt-shaping cluster beside `CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` and `tengu_velvet_tide` (Ch21/L90's `CLAUDE_CODE_LEAN_PROMPT` lineage), and **`CLAUDE_CODE_HARBOR_KITE`** is cross-session messaging (L157) — two codenames now attributed to real features rather than left in triage.

**Five new API betas (+5, none removed; 41 unchanged).** Only one is explicable from the changelog:

| Beta | Status |
|---|---|
| `agent-memory-2026-07-22` | memory-as-a-service; pairs with `CLAUDE_CODE_MEMORY_API_BASE_URL`/`_TOKEN` and ~10 new `tengu_org_memory_*` + 4 `tengu_memdir_*` identifiers |
| `auto-mode-classifier-2026-07-16` | auto-mode classification (Ch36/L128, Ch41/L150 lineage) |
| `server-side-fallback-2026-07-01` | promotes Ch27/L113's GB-gated `server-side-fallback` to a dated beta |
| `mcp-tunnels-2026-06-22` | **DARK** — "tunnel" appears 0 times in the changelog |
| `dreaming-2026-04-21` | **DARK** — "dream" appears 0 times; note the diff tool's own caveat that `/dream` is a routines-table entry, so treat any `/dream` command claim as unverified |

**Retired surface (6 env vars removed).** `CLAUDE_CODE_ALDER_WICKET`, `CLAUDE_CODE_HERON_TALLOW`, `CLAUDE_CODE_MARL_CORMORANT` (three of Ch38/L137's nine-codename triage cluster, retired with their `tengu_*` twins), `CLAUDE_CODE_COMMIT_LOG`, `CLAUDE_CODE_INVESTIGATE_FIRST`, `CLAUDE_CODE_POST_FOR_SESSION_INGRESS_V2`. Among 39 removed `tengu_*` identifiers, note `tengu_sunset_penguin_opus47` (the Opus 4.7 sunset probe) and 24 `tengu_dead_probe_*` entries — Anthropic runs explicit *dead-code probes* and removes what never fires, so a vanished `dead_probe` is evidence the legacy path was confirmed unused, not that a feature was cut.

**+189 `tengu_*` identifiers** (1678 unchanged) — the largest clusters are the device bridge (~20), dir-sync (~16), org-memory (~10), bridge/CCR reconnection (~12), and a new **goal-proposal** family (`tengu_propose_goal`, `tengu_goal_proposed`, `tengu_goal_proposal_available`/`_decided`, `tengu_model_proposed_goals_changed`) that is entirely dark. `tengu_ultrareview_post`/`_awareness` corroborate the `/code-review ultra --post` surface.

## ADDENDUM — what a registry-vs-bundle sweep found

This pass did something no earlier refresh had done: **mechanically checked every CLI-checkable state-layer record against the bundle it claims to describe**, instead of restamping records to the new baseline. That is a cheap check (`name in bundle`) and it caught five stale records that had survived multiple releases:

- **`ANTHROPIC_FOUNDRY_AUTH_TOKEN` was recorded `removed` while being present in both 2.1.217 and 2.1.231.** Ch38/L133's prose had already said it was re-added; the registry record never caught up. **The prose and the registry disagreed, and nothing detected it** — the two are only coupled by author discipline.
- **`CLAUDE_CODE_LEAN_PROMPT`, `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE`, `CLAUDE_CODE_EXPLORE_AGENT_COUNT`, `CLAUDE_CODE_ENABLE_DESIGN_MCP` were recorded live/dark but are absent from *both* bundles** — so they went **before** this range and the records were simply stale. They are now `removed` with `removed_in: "<=2.1.217"`, deliberately not pinned to a version this pass cannot establish.

Two classes of "absent from the CLI bundle" are **expected and must not be read as drift**:

1. **Desktop-written spawn-env vars** (`CLAUDE_CODE_DISABLE_AGENTS_FLEET`, `DISABLE_MICROCOMPACT`, `CLAUDE_PROJECT_TOOL`, `CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL`, `CLAUDE_CODE_SKIP_PRECOMPACT_LOAD`) — the Desktop sets them and the agent binary never reads them. Same producer-without-consumer shape as Ch41/L151 and L153's `CLAUDE_RUNNER_*`.
2. **Desktop SDK-MCP tools** (`mcp__skills__*`, `mcp__plugins__*`, `mcp__cowork__*`, `mcp__mcp-registry__*`, `mcp__cowork-onboarding__*`) — their absence from the CLI binary is a **positive re-confirmation of Ch37/L129**, whose whole point is that the model's skill-discovery surface is delivered Desktop-side over the control protocol and is *never* compiled into the CLI.

**The generalisable rule: `as_of` is a claim, and restamping it is not verification.** A record bumped to a new baseline asserts it was checked against that baseline. For anything name-shaped, that check is one substring test against the bundle — so it should never be skipped, and a record that cannot be checked against the artifact in hand (Desktop gates, IPC interfaces, Desktop-only vars) should be **left at its true stamp** rather than swept forward.

**Confirmed negatives / not-verified this pass:**

- **Hook events: 31, not 30** — and no others were added or removed.
- `CLAUDE_CODE_USE_CCR_V2` is **re-added as a declaration only** (1 occurrence, **no read site**) after Ch38/L137 recorded CCR v2 as retired. Do **not** report CCR v2 as restored on this evidence.
- `CLAUDE_CODE_MEMORY_API_BASE_URL` and the two artifact `*_BASE_URL` vars are declaration/allowlist-only in this bundle — real, named, but with no read site here.
- The device bridge, dir-sync, and org-memory findings are **binary-tier**: read from the bundle, with **no live run observed**. Nothing here was probed at runtime.
- Cowork applicability of L153/L154 was **not** traced; the Desktop asar was not re-diffed this pass (Ch41's 1.28929.0 remains the Desktop baseline).
- **`state.js --audit` deliberately does NOT end clean after this release** (110 records behind baseline). Those are Desktop-scoped records — 51 `desktop_fcache` gates, 6 IPC interfaces, 17 Desktop-only env vars, ~15 Desktop SDK-MCP tools — and no Desktop asar or fcache was captured this pass, so sweeping their stamps forward would assert a verification that did not happen. Every **CLI-checkable** record (env-var, slash-command, api-beta, control-subtype, tool, `cli_growthbook` gate) was checked against the 2.1.231 bundle and stamped only on a match.
