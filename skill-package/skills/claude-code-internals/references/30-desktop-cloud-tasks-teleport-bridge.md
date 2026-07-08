Updated: 2026-07-08 | Source: First-party binary inspection of Claude Desktop `app.asar` **1.19367.0** (the self-updated build the investigation was triggered by) diffed against a **1.18286.2** baseline (one point release ahead of this skill's own last-verified Desktop baseline, 1.18286.0), both extracted with `@electron/asar` into scratch dirs and diffed by **content**, not filename (Vite chunk names are content-hashed per build and change on every rebuild regardless of code delta) — plus the in-VM/host agent ELF `claude.app`/`claude` **2.1.202** (one build ahead of this skill's CLI content baseline 2.1.198, used for parity/negative-result checks). Prompted by the independent `claude-cowork-headless-emulator` project's `docs/internal/2026-07-08-desktop-1.19367.0-cloud-tasks-analysis.md`, which flagged Desktop 1.19367.0 as a possible new "cloud tasks" feature and called out two open questions (bridge call ordering, the `work_type` payload schema) as not statically resolvable. Every claim below was **independently re-derived first-party** against this installation's own binaries before being written — the external doc's grep commands were re-run fresh, its two open questions were re-attempted and substantially resolved, and one of its claims (the "typed-SDK migration" framing) is corrected here with fresh evidence.

# Chapter 33: Desktop Cloud Tasks — Teleport-to-Cloud, Bridge-Session Workers, and the `CLAUDE_CODE_ENVIRONMENT_KIND=bridge` Link

---

## TABLE OF CONTENTS

119. [Lesson 119 -- Desktop Cloud Tasks: Teleport-to-Cloud, Bridge-Session Workers, and the CLAUDE_CODE_ENVIRONMENT_KIND=bridge Link](#lesson-119----desktop-cloud-tasks)

---

# LESSON 119 -- DESKTOP CLOUD TASKS: TELEPORT-TO-CLOUD, BRIDGE-SESSION WORKERS, AND THE `CLAUDE_CODE_ENVIRONMENT_KIND=bridge` LINK

## The question this closes out

Desktop self-updated to 1.19367.0 and a user noticed what looked like a new "cloud tasks" feature — sessions that run on Anthropic-hosted infrastructure instead of the local VM. Is this new client plumbing, or a UI surfacing of something that already shipped? And separately: this skill's own Ch25/L108 has long carried an undocumented env var, `CLAUDE_CODE_ENVIRONMENT_KIND=byoc|anthropic_cloud|bridge`, with the `bridge` value described only as "drives the classifier-summary surface map" — no concrete mechanism. Is the Desktop's "bridge session" IPC surface (`WorkPoller`, `onBridgePermissionPreflight`, `getBridgeConsent`, ...) *that* mechanism, or an unrelated code path that happens to share the word "bridge"?

**Headline, confirmed first-party: this is not a new feature.** The entire cloud-task/teleport/bridge surface already existed, byte-similar, in the 1.18286.2 baseline — one point release ahead of this skill's own last-verified 1.18286.0. What changed in 1.19367.0 is a single vendored (and currently unused) SDK helper class, plus a handful of unrelated IPC methods. **And yes: `CLAUDE_CODE_ENVIRONMENT_KIND=bridge` is the same mechanism as the Desktop's bridge-session worker surface** — with a specific, evidenced twist: the Desktop itself never sets that env var; the agent's own `claude remote-control` bridge worker does, when it spawns child sessions to execute claimed cloud work.

## Part A — the IPC surface diff: confirmed zero, first-party

Re-running the load-bearing extraction fresh against both builds:

```
grep -rhoE 'claude\.web_\$_[A-Za-z]+_\$_[A-Za-z]+' <build>/.vite/build/*.js | sort -u
```

- **1.18286.2: 596 methods across 44 interfaces.**
- **1.19367.0: 610 methods across 44 interfaces.**
- **Interface set (`sed -E 's/claude\.web_\$_([A-Za-z]+)_\$_.*/\1/' | sort -u`): byte-identical, 44/44, `diff` empty.**
- **`comm -23` (removed): empty.** **`comm -13` (added): exactly 14 methods**, all non-cloud-task —
  `LocalSessions.{changeCwd, checkRemoteTargetTrust, dequeuePr, listWslDistros, resumePreClearSession, revealRemotePath}`,
  `DocumentFunnel.{ingestSessionDocument, openDownloadExport, workingDocumentsChanged}`,
  `FileSystem.appInfoForExtension`,
  `Launch.{focusPreview, previewCloseShortcut, previewFocusExit, previewNewTabShortcut}` — remote-dev-target/WSL, a document-preview funnel, and preview-window chrome. **Confirms the external doc's headline exactly**: zero interfaces added or removed, +14/-0 methods, none of them cloud-task related.

Every cloud-task primitive named by the trigger investigation is present in **both** builds: `teleportToCloud` (2 files in 1.18286.2, 3 in 1.19367.0 — one additional call site, not a new capability, see Part B), `getTeleportReadiness`, `ccr-byoc-2025-07-29` (2 files in both), and the full `LocalAgentModeSessions` interface — **95 methods, zero diff**, confirmed by a direct sorted-set `diff` of `grep -rhoE 'claude\.web_\$_LocalAgentModeSessions_\$_[A-Za-z]+'` against both builds (Part C enumerates it).

### The one genuine code delta: a newly vendored, currently-unused SDK helper

The external doc's framing — "the cloud work-queue client migrated from hand-rolled HTTP to a typed SDK" — is **directionally right but needs a correction**, confirmed by tracing the call sites, not just the string presence:

- `grep -rl 'environments-work-poller'`: **0 files in 1.18286.2, 1 file in 1.19367.0** (`index.chunk-CeGlUHRK.js`). This string is the `helper:` tag on a real class constructor, not a comment:
  ```js
  class VBe{constructor(t){...this.environmentId=t.environmentId,this.environmentKey=t.environmentKey,
    this.workerId=t.workerId??gCn(),
    Dt(this,cx,Uzt(t.client,{authToken:t.environmentKey,helper:"environments-work-poller"})),
    Dt(this,VV,t.autoStop??!0),Dt(this,GV,t.drain??!1),
    Dt(this,bF,t.blockMs===void 0?fCn:t.blockMs),Dt(this,AF,t.reclaimOlderThanMs??null),...}
    async*[Symbol.asyncIterator](){...
      let o=await Ee(this,cx,"f").beta.environments.work.poll(this.environmentId,
        {"Anthropic-Worker-ID":this.workerId,...{block_ms},...{reclaim_older_than_ms}},...);
      ...await Ee(this,cx,"f").beta.environments.work.ack(o.id,{environment_id:o.environment_id},...)
  ```
  This is the vendored `@anthropic-ai/sdk` `WorkPoller` class (`cce.WorkPoller=VBe`, confirmed at a second call site), beta header `managed-agents-2026-04-01` — **which is itself present in both builds** (`grep -rl 'managed-agents-2026-04-01'` hits `index.js` in 1.18286.2 and `index.chunk-CeGlUHRK.js` in 1.19367.0). So the underlying SDK dependency isn't new; specifically the `WorkPoller`/`EnvironmentWorker` export becoming reachable (tree-shaken in) is what's new.
- **But grepping for an app-level call site — `new VBe(`, `.poller({`, `.worker({` — finds none.** The vendored class is defined but **not instantiated anywhere in the Desktop's own bridge-session code.**
- The Desktop's **actual, production** bridge-worker pipeline is unchanged hand-rolled REST, present **byte-similarly in both builds** (`grep -rl pollForWork` hits `index.js` in 1.18286.2 and `index.chunk-CeGlUHRK.js` in 1.19367.0):
  ```js
  async pollForWork(o,s,a){const c=new URL(`${A.baseUrl}/v1/environments/${o}/work/poll`), ...}
  async handleWork(t){const r=t.data?.type;
    switch(r){
      case"session":await this.handleSessionWork(t);break;
      case"healthcheck":{...let i;try{i=G_e(t.secret).session_ingress_token}catch{}
        i&&this.safeAckWork(t.id,i);break}
      default:v.warn(`${ht} Unknown work type: ${r}`)}}
  ```

**Corrected framing**: 1.19367.0 newly vendors (bundles-and-makes-reachable) the official SDK's `WorkPoller`/`EnvironmentWorker` helper classes, but the Desktop's live bridge-worker code path continues to use its own pre-existing hand-rolled REST client, unchanged. This is a dependency-bundling delta, not a runtime migration — a sharper claim than "migrated to a typed SDK," which implies the call sites moved. They didn't.

## Part B — `teleportToCloud`: confirmed, with three corrections to the external doc

String anchor `[TeleportToCloud]` (log-prefix family) locates the full flow in `index.chunk-JzgmCbvf.js` (chunk hash differs per build; search by string, not filename, per this skill's established methodology). Confirmed sequence: **readiness check → `pushBranch` (progress `pushing_branch`) → stop the local session → `generateTranscriptSummary` (progress `generating_summary`) → `POST ${claudeAiUrl}/v1/sessions` (progress `creating_session`) → return.**

- **Correction 1 — three progress events, not two.** The external doc's summary named `pushing_branch`/`generating_summary`. A third, `creating_session`, fires around the POST itself.
- **Correction 2 — the "reject already-remote session" check lives in `getTeleportReadiness`/`checkReadiness`, not inline in `teleportToCloud`.** `getTeleportReadiness` runs three gated checks: remote-session rejection, OAuth-token presence, and a clean working tree. **This is also the one place NEW differs from OLD**: 1.18286.2's remote-exclusion check only inspects `sshConfig` (SSH remote-dev sessions); 1.19367.0 generalizes it to a broader `remoteTarget` check — consistent with the unrelated `checkRemoteTargetTrust`/`listWslDistros` additions in Part A's +14 list (this build's WSL/remote-dev-target work touched the same exclusion check teleport already relied on).
- **Correction 3 — the returned `url` is absolute, not a bare path.** `{sessionId, title, url, summary}` where `url` resolves to `https://claude.ai/code/<id>` (via `${claudeAiUrl}/code/${id}`), not the external doc's `"/code/<id>"`.

POST body confirmed: `{title?, environment_id, session_context:{sources:[{type:"git_repository", url, revision:"refs/heads/<branch>"}], outcomes?, model?}}`, headers `{"anthropic-beta":"ccr-byoc-2025-07-29","anthropic-client-feature":"ccr","x-organization-uuid":<org>}`. The **`ccr-byoc-2025-07-29`** beta string is present in both builds (`Drr="ccr-byoc-2025-07-29"` as a module-level constant) and used at **two independent** `/v1/sessions`-family POST call sites, confirming it isn't a one-off. `claudeAiUrl` resolves to the literal `https://claude.ai` in production; env/config overrides only apply in dev builds.

`childKind` — values `"cloud"`/`"local"`, identical logic in both builds (`notifyParentOfSpawnedTask(..., {childKind:"local"|"cloud", ...})`). One trust-boundary observation worth flagging: the IPC method signature validates that `childKind` is *a string* (`Argument "childKind" at position 2 ... failed to pass validation` for non-strings) but the literal values `"cloud"`/`"local"` are never validated against an enum client-side — the discriminator is an unvalidated string that happens to always be one of two values in the code paths that set it, not a schema-enforced union.

## Part C — the bridge-session worker model

### Two runtimes, one API family

Both the Desktop and the CLI agent independently implement a worker against the **same** endpoint family — `GET /v1/environments/{id}/work/poll`, `POST /v1/environments/{id}/work/{id}/ack`, `POST /v1/environments/{id}/work/{id}/stop` — confirmed on **both sides**:

- **Desktop** (`index.chunk-CeGlUHRK.js`, both builds): `pollForWork`/`handleWork`/`handleSessionWork` (Part A), logged under `[sessions-api]`/`[bridge:*]` prefixes, telemetry `lam_bridge_session_bound`.
- **Agent ELF** (`claude.app`/`claude` 2.1.202, confirmed **first-party in the agent binary itself**):
  ```js
  async pollForWork(a,l,c,u){...let p=await go.get(`${e.baseUrl}/v1/environments/${a}/work/poll`,
    {headers:await o(l),params:u!==void 0?{reclaim_older_than_ms:u}:void 0,...})...
    t(`[bridge:api] GET .../work/poll -> ${p.status} (no work, ${r} consecutive empty polls)`)}
  async acknowledgeWork(a,l,c){...await go.post(`${e.baseUrl}/v1/environments/${a}/work/${l}/ack`,{},...)}
  async stopWork(a,l,c){...await go.post(`${e.baseUrl}/v1/environments/${a}/work/${l}/stop`,{force:c},...)}
  ```
  This is the `claude remote-control` bridge worker — **the agent CLI binary itself carries a full poll/ack/stop client against the identical endpoints**, tagged with the identical `[bridge:api]` log-prefix family the Desktop uses. This is the single most important structural fact in this chapter (see Part D).

### Call ordering — the external doc's first open question, resolved for the production path

The external doc flagged bridge call ordering as "not statically resolvable (mangled minified code)." **Re-attempted and substantially resolved for the Desktop's production dispatcher** (the vendored `WorkPoller`'s own iterator ordering — `poll → (on item) → ack` — is directly readable from its `async*[Symbol.asyncIterator]` body quoted in Part A, but recall that class is dormant). The **live** path is `handleWork`'s type switch, confirmed verbatim above: **poll → on a claimed item, branch on `t.data.type`: `"session"` → `handleSessionWork` (spawn/attach a real Cowork session); `"healthcheck"` → immediate `safeAckWork`, no session created; unrecognized type → warn and skip (no crash).** Error handling on the poll loop: a transient failure backs off and retries; a `401`/`403`/`404`/`409` triggers a bounded number of re-register attempts, then `startFailedPermanently=!0` and the poller gives up for good — confirmed from the same region of `index.chunk-CeGlUHRK.js`. **Not resolved**: an explicit `heartbeat` call analogous to `poll`/`ack`/`stop` was not found by name inside the `/v1/environments/{id}/work/...` family on either side (a *different*, CCR-era endpoint, `POST /worker/heartbeat` with `{session_id, worker_epoch}`, does exist in the agent ELF — this is the pre-existing CCR worker-liveness mechanism from Ch25/L108, not confirmed as part of this same call chain). Report this as unresolved rather than assumed.

### `work_type` — the external doc's second open question, partially resolved

Not a documented Zod/type schema (none found), but the dispatcher's own `switch` statement is itself the de facto schema: **two concrete values are handled — `"session"` and `"healthcheck"`** — plus a graceful `default` branch that logs and continues rather than throwing. So `work_type` is best described as an open string read directly off the server payload (`t.data.type`) with two currently-meaningful values and forward-compatible unknown-value handling, not a closed client-side enum.

### The vendored `EnvironmentWorker` tool-runner shape

The external doc's claimed shape (`workdir`, `unrestrictedPaths`, `maxFileBytes`, `tools`) is confirmed, in the same vendored-but-dormant SDK code as `WorkPoller`:

```js
class /* Hzt, per cce.EnvironmentWorker=Hzt */ {
  constructor(t){ this.tools=t.tools, this.workdir=t.workdir??process.cwd(),
    this.unrestrictedPaths=t.unrestrictedPaths, this.maxFileBytes=t.maxFileBytes,
    this.maxIdleMs=t.maxIdleMs, this.workerId=t.workerId, this.requestOptions=t.requestOptions, ... }
  async run(t){ const {environmentId, environmentKey} = this; ... }
}
```
`maxFileBytes` is enforced inside the vendored file-tool implementations too (`read`/`edit` both throw `exceeds ${limit}-byte limit` past it). Like `WorkPoller`, no app-level `new` call site was found for this class — vendored, not wired into the Desktop's own execution path.

### Consent/scope and permission-gating IPC (confirmed real, `LocalAgentModeSessions` interface)

Direct from the preload bridge's `ipcRenderer.invoke`/`.send` channel names (verbatim channel-string evidence, not inferred):

- **Consent/scope**: `getBridgeConsent()`, `getSessionsBridgeEnabled()`, `addTrustedFolder(e)`, `grantRemoteSessionFolders(e,a)`, `browseAndGrantRemoteSessionFolder(e)`, `grantRemoteSessionFolder(e,a)`, `clearRemoteSessionFolderGrants(e)`.
- **Permission gating** — a real event+invoke pair, the same shape as the local `onToolPermissionRequest`/`respondToToolPermission`, but remote-initiated:
  ```js
  onBridgePermissionPreflight(n){ if(!Efr(n)) throw new Error('Argument "request" at position 0 to event
    "onBridgePermissionPreflight" in interface "LocalAgentModeSessions" failed to pass validation');
    e.send("...LocalAgentModeSessions_$_onBridgePermissionPreflight", n) }
  respondBridgePermissionPreflight(e,a){ return d.ipcRenderer.invoke("...respondBridgePermissionPreflight", e, a) }
  ```
- **Session linking**: `kickBridgePoll()`, `abandonBridgeEnvironment(e)` (both `LocalAgentModeSessions`), and — on the separate `LocalSessions` interface — `findLocalSessionIdForBridgeId(e)`, implemented as `r.findSessionIdByBridgeSessionId(e)??null`.

## Part D — the `CLAUDE_CODE_ENVIRONMENT_KIND=bridge` cross-reference: CONFIRMED, closing the Ch25/L108 gap

This closes a gap this skill has carried since Ch25/L108: that chapter documented `CLAUDE_CODE_ENVIRONMENT_KIND=byoc|anthropic_cloud|bridge` from the *consuming* side (agent env-var name, "drives the classifier-summary surface map") without ever finding the concrete mechanism behind the `bridge` value. **Verdict: SAME mechanism as this chapter's bridge-session worker — with a specific, evidenced nuance about who sets it.**

**1. The agent ELF is itself a bridge worker.** Part C already showed the agent binary carries its own `pollForWork`/`acknowledgeWork`/`stopWork` against the identical `/v1/environments/{id}/work/...` endpoints, under the identical `[bridge:api]` log-prefix family the Desktop uses. This is `claude remote-control`.

**2. The agent's own bridge worker is what SETS the env var — not the Desktop.** When `claude remote-control`'s poller claims a `"session"`-type work item, it spawns a **child CLI process** to run it, and that spawn's env explicitly includes the var:
```js
let l={...e.env, CLAUDE_CODE_OAUTH_TOKEN:void 0,
  CLAUDE_CODE_ENVIRONMENT_KIND:"bridge",
  ...e.sandbox&&{CLAUDE_CODE_FORCE_SANDBOX:"1"},
  CLAUDE_CODE_SESSION_ACCESS_TOKEN:t.accessToken,
  ...t.useCcrV2&&{CLAUDE_CODE_USE_CCR_V2:"1",CLAUDE_CODE_WORKER_EPOCH:String(t.workerEpoch)}};
[log:] `[bridge:session] Spawning sessionId=${t.sessionId} sdkUrl=${t.sdkUrl} ...`
```
with child argv including `--print --sdk-url <url> --session-id <id> --input-format stream-json --output-format stream-json --replay-user-messages`, and a dedicated worktree named `bridge-<slug>`. `t.accessToken` traces back to `me.session_ingress_token` — the same ingress-token concept the Desktop's SDK-adapter transport (`583857784`, below) uses.

**3. The spawned child reads it right back**, on its own SDK transport: `this.isBridge=process.env.CLAUDE_CODE_ENVIRONMENT_KIND==="bridge"`.

**4. `main()` maps the var to a product identity**: `if(process.env.CLAUDE_CODE_ENVIRONMENT_KIND==="bridge") NRn("remote-control")`, where `NRn(e){Bt.sessionSource=e}` — so a bridge-spawned session self-identifies as `sessionSource="remote-control"` at boot.

**5. The classifier-summary surface map (Ch25/L108's own function) ORs *two* independent signals into the `"bridge"` surface — not just the env var:**
```js
if(process.env.CLAUDE_CODE_ENVIRONMENT_KIND==="bridge"||qR())e.add("bridge");
```
`qR(){return Bt.replBridgeActive??!1}` — a live in-process flag, unrelated to the env var, toggled by the connection-state machine of the **SDK-adapter bridge transport** (see below): `connected`/`ready` → `true`, `failed` → `false`, torn down on a `remote_control_disabled` control request, logged `[bridge:sdk] State change:`. **This is the key structural nuance**: a `claude remote-control`-spawned child reaches the `"bridge"` surface via the env var (set once, at spawn); a **Desktop-hosted** bridge session — one where the Desktop is itself acting as the execution host for cloud-claimed work — never receives that env var at all, and instead reaches the identical `"bridge"` surface via `replBridgeActive`. Two different spawn paths, deliberately unified onto one surface label by design, not by accident.

**6. Confirmed negative: the Desktop never itself assigns `CLAUDE_CODE_ENVIRONMENT_KIND="bridge"` anywhere.** `grep -rc ENVIRONMENT_KIND` on the Desktop bundle: **1.19367.0 → exactly 1 hit** (a vendored env-var *schema table* entry, `CLAUDE_CODE_ENVIRONMENT_KIND:()=>Pii` with `Pii=Z.str()`, sitting in the same alphabetical registry as `CLAUDE_CODE_ENVIRONMENT_RUNNER_VERSION`/`CLAUDE_CODE_ENTRYPOINT` — a type declaration, not a spawn-env assignment); **1.18286.2 → 0 hits**. `grep -c 'ENVIRONMENT_KIND:"bridge"'` in that chunk: **0**. So the hypothesis "the Desktop sets the var when spawning a bridge worker" is **refuted** — the var is minted exclusively by the CLI's own bridge worker (`claude remote-control`), which is a distinct binary/invocation from the Desktop's own local-agent spawner documented in Ch24–Ch29.

**7. `byoc`/`anthropic_cloud` are sibling *environment-provider* kinds of the same environments API** (`POST ${BASE_API_URL}/v1/environment_providers/cloud/create`, `kind:"anthropic_cloud"`), feeding the pre-existing **`ccr`** surface, not `bridge` — worth stating explicitly since the three `ENVIRONMENT_KIND` values are easy to conflate: `byoc`/`anthropic_cloud` describe *where the environment is provisioned*; `bridge` describes *this specific session's role as a claimed-work worker*.

### Gate `583857784` disambiguated: one "bridge," not two

Ch25/L108 already catalogs gate `583857784` as "bridge-SDK-adapter transport... ON." This chapter's investigation could have surfaced a same-named-but-unrelated gate; it doesn't. Confirmed call chain in the 1.19367.0 build (symbol names differ from the 1.18286.0-era `Bfn`/`Rfn` naming in the existing registry entry — expected, since minified names are unstable across builds; the *mechanism* is identical):
```js
const uk="[transport:bridge]", Nhi="583857784";
async function Fhi(e){
  if(tt(Nhi)) return v.info(`${uk} gate on -- using SDK adapter for session ${e.sessionId}`), Thi(e);
  // else: legacy "CCR transport" -- worker registration, SSE at <sessionUrl>/worker/events/stream
}
```
reached from the poll→bind→`connectSessionTransport(t,r)` chain: `const s=r.session_ingress_token, o=await Fhi({workSecret:r, sessionId:t, ...})`. **Confirmed**: this is the identical bridge-session concept as this chapter's `[bridge:*]` worker code, not an unrelated homonym — gate `583857784` selects the transport implementation for exactly the bridge sessions `handleSessionWork` binds. A previously undocumented key on the already-catalogued cowork-runtime-config gate `1978029737` also surfaced here: `sessionsBridgePollIntervalMs` (alongside the already-documented `sessionsBridgePollBlockMs`), plus a live config-change subscription that kicks the sleeping poller when the gate value changes.

## What this means

- **Nothing to update in an emulator or harness's execution model.** This is Desktop-hosted infrastructure orchestration (teleport, bridge workers) that a local skill or CLI session never participates in directly — consistent with this skill's own scope (it documents the mechanism; it does not imply anything here needs emulating).
- **The `CLAUDE_CODE_ENVIRONMENT_KIND=bridge` gap in Ch25/L108 is closed.** It is set by the agent's own `claude remote-control` bridge worker at child-spawn time, not by the Desktop — and a Desktop-hosted bridge session reaches the same downstream surface through an entirely separate signal (`replBridgeActive`), not this env var. Anyone keying detection logic on this var alone will miss Desktop-hosted bridge sessions; anyone building a `claude remote-control`-aware tool should expect the var to be present only in that worker's spawned children.
- **`teleportToCloud` re-hosts via git branch + generated summary, not a state stream** — confirmed, with the three corrections above (three progress events, readiness-check location, absolute return URL).
- **The one real code change in 1.19367.0** is a newly-reachable, currently-dormant vendored SDK helper (`WorkPoller`/`EnvironmentWorker`) — a dependency-bundling delta a future forensic pass should watch for actually being wired up (an app-level `new` call site appearing next to the existing `pollForWork`/`handleWork` chain would be the tell).

## Honesty & scope caveats

- **First-party (my own greps, this pass):** the full IPC surface diff (Part A), the `teleportToCloud` flow and its three corrections (Part B), the dual poll/ack/stop implementations in both Desktop and agent ELF, the `handleWork` type-switch ordering, the consent/permission/session-linking IPC channel names, the `583857784` call-chain disambiguation, and — the chapter's central claim — the full `CLAUDE_CODE_ENVIRONMENT_KIND=bridge` evidence chain (Part D, items 1–7), cross-checked independently against the agent ELF and both Desktop builds.
- **Not resolved, reported honestly rather than assumed:** an explicit `heartbeat` request/response pair analogous to `poll`/`ack`/`stop` inside the `/v1/environments/{id}/work` family was not located by name on either side; a separate, pre-existing `POST /worker/heartbeat` endpoint exists in the agent ELF but its relationship to this specific call chain is not confirmed here. A fully enumerable `work_type` schema (a Zod/type union) was not found — only the dispatcher's own two-value `switch` plus graceful-unknown handling.
- **Version note:** the agent-ELF findings use **2.1.202**, one build ahead of this skill's CLI content baseline (2.1.198); used here only for parity/negative-result checks (the bridge-worker code, `ENVIRONMENT_KIND` consumption, and the absence of Desktop-only IPC symbols), consistent with how Ch32/L118 used 2.1.201 for the same purpose.
- **Corrected, not merely corroborated, vs. the external doc:** the "typed-SDK migration" framing (Part A), the teleport progress-event count and return-URL shape (Part B), and — most importantly — the specific mechanism of the `ENVIRONMENT_KIND=bridge` link, which the external doc did not attempt (it flagged the connection as a lead for this skill to chase, not a claim of its own).

**Cross-references.** Ch25/L108 (`references/22-cowork-env-gates-protocol.md`, the `CLAUDE_CODE_ENVIRONMENT_KIND` entry and gate `583857784`/`1978029737` — both extended here) · Ch24/L107 + Ch26/L109 (the CCR/bridge session-runtime family this chapter's worker code extends: `CLAUDE_CODE_WORKER_EPOCH`, `CLAUDE_BG_*_AUTH` handshake) · Ch32/L118 (the last chapter to cross-check first-party against the 2.1.20x agent ELF alongside a Desktop asar, same discipline reused here) · `cowork-architecture.md` / `cowork-control-protocol.md` state pages (this chapter's findings are folded into both, see below).
