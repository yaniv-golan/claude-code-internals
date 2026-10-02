Updated: 2026-09-27 | Source: **`app.asar` 2.9939.2** (the live install) and 2.7032.0, backed-up asars back to 1.18286.2, **agent 2.1.280 / 2.1.281** and **CLI 2.1.283**, the live fcache **`d21cd40b42abe59d`** (embedded 2026-09-26 20:56:51 UTC, 382 features), 912 local Cowork `audit.jsonl` files (3,032 `system/init` frames) and 911 session records, the local VM `rootfs.img`, and **a live probe on 2026-09-27** (a local MCP server, an Artifact published from two accounts and opened inside Claude Desktop). **Does NOT move the CLI or Desktop baselines.**

Prompted by a review of the cowork-harness project's commits from 2026-09-16 to 2026-09-26. Every claim here was re-derived from our own artifacts before it was written.

# Chapter 57: Artifacts and Local MCP Servers, Cowork's Other Artifact Tools, and What Desktop 2.9939.2 Added

---

## TABLE OF CONTENTS

211. [Lesson 211 — Can an Artifact Call My Local MCP Server? Three Layers, Measured](#lesson-211--can-an-artifact-call-my-local-mcp-server)
212. [Lesson 212 — Cowork's Other Artifact Tools: `create_artifact` and Its Siblings](#lesson-212--coworks-other-artifact-tools)
213. [Lesson 213 — What Desktop 2.9939.2's New Gates Do](#lesson-213--what-desktop-29939s-new-gates-do)
214. [Lesson 214 — HIPAA Egress and Fast Mode on Third-Party Providers](#lesson-214--hipaa-egress-and-fast-mode-on-third-party-providers)

---

# LESSON 211 — CAN AN ARTIFACT CALL MY LOCAL MCP SERVER?

**No, not today. Desktop's half of the channel was switched on between 2026-09-25 and 2026-09-26 (gate `2864556627`), but two claude.ai layers still close it. The Artifacts service refuses to publish a page that declares a local server, and the claude.ai viewer refuses any local-server call the page did not declare, before Desktop is involved. Both were measured live on two accounts. When it does open, Desktop itself will not limit a page to what it declared.**

## The three layers

A page reaches a local server as `host:<name>` through the `mcp` capability (`callTool("host:<name>", tool, input)`, runtime contract 0.2.60). The call passes three owners in turn:

| Layer | Owner | What it checks | State on 2026-09-27 |
|---|---|---|---|
| Publish | Artifacts service + the agent's `Artifact` tool | the account's contract roster must carry `features.mcp.host` | **refuses** `host:` (two accounts) |
| Viewer | the claude.ai frame shell | the call must be in the page's published manifest | **refuses** an undeclared `host:` call |
| Run | Claude Desktop, `ArtifactHostTools` | gate `2864556627`, the pane is visible, per-tool consent | **on** |

## Layer 1: publishing refuses `host:`

A `host:` declaration is checked in the agent's manifest validator (CLI 2.1.283; the same check is in 2.1.281):

```js
else if(C!==void 0&&r.hostServers===!1)a.push({kind:"host_unavailable",server:d})
// hostServers = XXt(roster,"mcp","host") = Object.hasOwn(roster.features.mcp,"host")
// roster = E8(): GET /api/frame/contract with the account's credentials
```

The refusal the author sees:

> mcp manifest rejected: "host:ccinternals-probe" names a locally-configured MCP server, and host servers aren't available in this session — declare only claude.ai connectors …

The roster is read once per session, when the artifact-capabilities section loads, and cached (`KXt(session,…)`, read back by `Glo(session)`). A retry therefore needs a **new** session. On 2026-09-27 the roster carried no `features.mcp.host` for either account tested: a personal org published from the CLI, and a team org published from a Desktop conversation. The refusal text was identical word for word.

## Layer 2: the viewer enforces the manifest

The probe page was published declaring only a claude.ai connector, and it called `host:ccinternals-probe` anyway, from inside Desktop 2.9939.2 (UA `Claude/2.9939.2 … Electron/44.4.3`, page framed at `<uuid>.frame.claudeusercontent.com`):

| Probe | Result |
|---|---|
| `use("mcp")` | resolved |
| `permissions.state("mcp:host:ccinternals-probe")` | `unavailable` |
| `listTools()` | only the declared connector |
| `callTool("host:ccinternals-probe","probe_read")` (read-only tool) | `not_in_manifest` in **8 ms**, "outside the scope you consented to. Reload to review." |
| `callTool(…,"probe_write")` | `not_in_manifest` in **3 ms**; no dialog |
| Desktop `main.log` | no `[ArtifactHostTools]` line: no hello, no bridge, no call |
| the local server | no `tools/call`, no marker file |

A refusal in single-digit milliseconds with nothing on Desktop's side means the viewer decides it locally, from the published manifest. With no `host:` entry in the manifest, the viewer also sent Desktop no host-tools hello. What the viewer does with a *declared* `host:` server cannot be tested until layer 1 opens. The contract says `host:` calls fail with `server_not_connected` "once the shell routes `host:` calls to the app", and that "only the Artifact's owner can use host servers for now".

## Layer 3: Desktop is on, and does not scope the page

Gate `2864556627` (`YH(){return Ox("2864556627")}` in 2.9939.2) was served off through the 2026-09-24 capture. From the 2026-09-26 capture it is `{value:true, source:"force", ruleId:null}`. It flipped between 2026-09-25 15:56 and 2026-09-26 16:56 UTC, at one of four GrowthBook refreshes whose log lines don't name the gate. It is the only one of 105 forced entries in that capture with no rule id, so from one account a general rollout cannot be told from a targeted rule. The mechanism is L195. Four facts matter for what comes next:

- **It offers everything.** A claude.ai artifact frame that sends the hello receives every connected `claude_desktop_config.json` server, minus reserved names and tools the user switched off. The list is not narrowed to the page's declaration.
- **The grant is not checked.** The call's `grant` field is only pattern-checked and logged: `a=EEr.test(e.grant)?e.grant:"invalid"`.
- **Read-only tools run without asking.** A tool annotated `readOnlyHint:true` (and not destructive) runs with no dialog. Anything else needs a click in the page and a native "Allow this artifact to run …" dialog. 2.9939.2 adds "Don't ask again" to that dialog, under the org setting `coworkMcpWriteToolsAlwaysAllowEnabled`.
- **Frames in the chat qualify too.** It attaches to the Cowork preview pane and to artifact frames embedded in the main claude.ai window (at most 8), not only the pane.

So once layers 1 and 2 open, whatever keeps a page to its declared tools, and to its owner, is claude.ai's.

The agent's allow-list for publishing, `CLAUDE_ARTIFACT_HOST_GRANT` (L195), narrows nothing in practice. None of 911 session records on the capturing machine carries an `artifactHostGrant` value, although the claude.ai client sends the key.

## One local server, two processes

The probe server logged its own starts. At Desktop launch it was started three times:
- One copy never connected.
- One connected as client `claude-ai` 0.1.0, the app's chat side.
- One connected as `local-agent-mode-<server>` 1.0.0, Cowork's `LocalMcpServerManager`, the manager `ArtifactHostTools` calls.

Both live copies negotiated protocol `2025-11-25` with the MCP-Apps extension (`io.modelcontextprotocol/ui`, `text/html;profile=mcp-app`). A server listed in `claude_desktop_config.json` therefore runs as two processes, with separate memory.

## For an author

- Don't build an Artifact that calls local MCP servers yet. Publishing refuses it, and the viewer would refuse the calls.
- Reach the user's machine through a skill, or through a plugin's own server. Collect secrets through elicitation, not a page form (L105).
- If you write a local server, keep shared state on disk: chat and Cowork each run their own copy.
- To see when this opens, watch three things:
  1. a fresh session's publish of a `host:` declaration;
  2. `2864556627` in the fcache;
  3. `[ArtifactHostTools] bridge offered` in `~/Library/Logs/Claude/main.log` when a page loads.

---

# LESSON 212 — COWORK'S OTHER ARTIFACT TOOLS

**Desktop's own `cowork` server has five artifact tools: `create_artifact`, `update_artifact`, `list_artifacts`, `verify_artifact` and `read_widget_context`. The first four are the other side of the native `Artifact` tool's switch: a session gets one family or the other. Through Desktop 2.9939.x every scheduled task gets these; from 2.16120.0 a scheduled run gets the native tool (L219). Desktop calls them legacy. `system/init` lists an MCP tool even when it is disallowed, so listed does not mean callable.**

## One switch, two families

Session setup (2.9939.2, chunk `Cb2x-E4A`) computes one predicate and uses it both ways. From 2.16120.0 the predicate admits `sessionType` "scheduled" and drops the scheduled-task term (L219):

```
vu = frameArtifactsEnabled && !scheduled && !bridge && !dispatchChild && !HIPAA
native Artifact tool, CLAUDE_CODE_COWORK_FRAME_ARTIFACTS, host grant:  vu && !unattended && !HIPAA
mcp__cowork__ artifact family (hasHtmlArtifacts):                      gate 2940196192 && !vu
```

| Session | Gets |
|---|---|
| interactive, frame artifacts on | native `Artifact` |
| scheduled task, through 2.9939.x (never satisfies `vu`) | `create_artifact`, `list_artifacts`, `update_artifact` (+ `verify_artifact` when enabled) |
| scheduled task, from 2.16120.0 | native `Artifact` when frame artifacts are on (L219) |
| frame artifacts off | the `mcp__cowork__` family |
| interactive, frame artifacts on, **unattended** | **neither** |
| bridge or dispatch child | the family, with `create`/`update`/`verify` in `disallowedTools`: only `list` and `read_widget_context` usable |

`read_widget_context` is pushed in every session; a second copy lives on the `ccd_session` server for Code sessions. `verify_artifact` also needs gate `3229517805`'s `verifyToolsEnabled` and `debugLogEnabled` (both default false; both true at the capture) and a session type other than `chat`.

Across 912 `audit.jsonl` files (3,032 init frames, all before 2.16120.0) there are no exceptions to three statements:
- a frame-artifact session never carries the `mcp__cowork__` artifact tools;
- the native `Artifact` tool appears exactly when `frameArtifactsEnabled` is true;
- scheduled sessions always carry `create`, `list` and `update`.

## What the tools do

They work on the local Artifacts store, a Claude/Artifacts folder on disk, and make no network call of their own. On 2026-10-02 (Desktop 2.19675.0) the sidebar's Artifacts entry opened a gallery with All, Pinned, Yours and Shared with you, not a folder view; whether items these tools make appear there was not checked. Sharing from that store (`POST …/artifacts/share_from_content`) is a user action in the Desktop behind `3229517805.sharingEnabled`, served true on 2026-10-01; it covers artifacts these tools made, and once a shared artifact has auto-publish on, an `update_artifact` call republishes it (below). Permissions:
- `list_artifacts`, `verify_artifact` and `read_widget_context` are pre-approved in `allowedTools`.
- `create_artifact` and `update_artifact` get the normal permission prompt, which shows the call's `update_summary`. They are not in the forced-ask hook set, so bypass mode skips it.

Desktop treats them as the old path. The separate `remote-devices` bridge (the Mac as a device for cloud sessions) carries its own `create_artifact`, `update_artifact` and `list_artifacts` (gate `1947305033`). From 2.2553.1 it also carries `list_legacy_live_artifacts` (gate `1847129881`), whose description calls these "legacy live artifacts", tells the model to use the native `Artifact` tool for new ones, and gives a migration recipe. On 2026-09-27 `main.log` shows that bridge connecting with all four.

All five names are in the oldest backed-up asar, 1.18286.2. The predicate was the gate alone through 1.26832.0. 1.28929.0 added the `frameArtifactsEnabled` exclusion and an `!isHostLoop` term, and 1.32352.0 dropped `!isHostLoop` again. The native `Artifact` tool has reached host-loop sessions since then (L149's "VM-loop-only" reading applies only to the builds in between). The code is identical between 2.7032.0 and 2.9939.2.

Calls recorded on the capturing machine: `update_artifact` 31, `verify_artifact` 17, `create_artifact` 8, `list_artifacts` 2, `read_widget_context` 1, all in interactive sessions between April and August. There are 30 native `Artifact` calls.

## Sharing a local artifact

`3229517805.sharingEnabled` (default false) is served true on 2026-10-01, so the Desktop's sharing calls are live; the code is the same in 2.9939.4 and 2.16120.0. They act on the local Artifacts store, the one these tools write (their module imports it), so an artifact made by `create_artifact` can be shared like any other. No model tool shares; the calls are the interface's: share, unshare, auto-publish on or off, and refresh of an imported artifact. While `sharingEnabled` is off, share answers "Sharing is not enabled." and the others do nothing.

- **Share** reads the artifact's HTML and posts it to `/api/organizations/<org>/artifacts/share_from_content` as `{filename, content, operation: "share", anchor: {kind: "synthetic_stub", client_session_ref: "cowork-artifact:<id>#shareCounter=<n>", source_kind, display_name}}`. It is refused under the Cowork HIPAA restriction (surface `artifact_share`), for an artifact over 1M characters, and without an organization.
- **Auto-publish** needs `sharingEnabled` and `autoPublishEnabled` and an artifact that is already shared with auto-publish turned on. Every later write through the store's update, an `update_artifact` call included, then republishes it without asking.
- An artifact shared WITH the user is read-only to `update_artifact`, which says so and suggests `create_artifact` under a new id.

## Listed is not callable

`disallowedTools` removes a disallowed **native** tool from the `system/init` `tools` array: `AskUserQuestion` is absent from 421 of 457 scheduled-session frames. It leaves a disallowed **MCP** tool listed: the onboarding role picker is in 457 of 457. So `init.tools` is authoritative for what was rendered (L129), but an `mcp__…` name in it may still be refused. Read `disallowedTools` alongside it. This rests on name counts over the corpus, not a trace of the agent's code.

## For an author or tester

- A skill that saves an HTML page from a scheduled task gets `mcp__cowork__create_artifact` on Desktop builds through 2.9939.x and the `Artifact` tool from 2.16120.0 (L219). Name neither in instructions; describe the outcome.
- Don't assert a tool's availability from `init.tools` alone when it is an MCP tool.

---

# LESSON 213 — WHAT DESKTOP 2.9939.2'S NEW GATES DO

**2.9939.2 references 28 gate ids that 2.7032.0 did not, and drops one. Four of the changes touch Cowork directly:**
- **host-loop spawns pass `--settings` as a file;**
- **a local permission answer is marked `approvalSurface:"host_dialog"`;**
- **auto mode stands down in more places;**
- **a model can require a minimum CLI version.**

**24 of the 28 ids are absent from the fcache, and half of those default to on in code.**

## Reading them

The asar's gate accessors (main chunk `DzZc-q0x`) differ in what an unserved id means:

| Accessor | Unserved id |
|---|---|
| `Ox` / `gV(id)` | off |
| `kx` / `_V(id, default)` | the code's default, which is often `true` |
| `Dx` / `pU` | reads the gate's value object |
| `WH` | stored to a preference and read at the next boot |

Twelve of the 24 absent ids are `kx(id, true)`, so they are **on in practice**. Examples:
- the httpOnly-cookie check on a supplied sessionKey (`4175551826`) is live;
- the nested-zip ban for org plugin downloads (`3778108436`) is **not** live;
- the project-upload-folder kill switch (`958249077`) is **not** engaged.

Absent from the fcache means unevaluated, never "off".

A diff of string literals finds 23 of the 28. The other five (`1093656152`, `1997501558`, `1658632017`, `1709592054`, `3112015973`) appear only as keys in the custom-3p bootstrap table that Desktop serves to the claude.ai interface, so what they do cannot be read from the asar. A gate diff must include table keys and dotted `new Set("…".split("."))` lists.

## The ones that matter

| Gate | Served | What it does |
|---|---|---|
| `822840158` | on | Host-loop Cowork writes its agent settings to `<userData>/cowork-spawn-settings/<sessionId-suffix>-<hex>.json` (created exclusively) instead of passing them inline; `lam_host_loop_spawn_settings` records a fallback to inline. The directory exists on the capturing machine from the 2.9939.2 install and is empty between spawns. The last step, to a `--settings <path>` argv, is inferred |
| `3067718716` | on | Permission answers from Desktop's local card carry `approvalSurface:"host_dialog"`. The agent recognises it (`oPo`: an allow whose `approvalSurface` is `"host_dialog"`, in 2.1.281 and later); 2.1.283 adds a `hostDialogAttestations` map. What the agent does with the attestation is not traced |
| `1169442571`, `1453979703` | on | Auto mode defers to the classifier instead of prompting for adopted remote/SSH sessions and for `mcp__ccd_session__move_to_cloud` |
| `4288313598`, `1835121223` | on | A minimum CLI version per model: session option `minCliVersion`; a prewarmed session on an older CLI is discarded (`cli_below_model_floor`); a warm respawn waits for an in-flight CLI install |
| `1753075645` | off | Carries the Artifacts capability roster across sessions: `cachedArtifactRoster` saved to `cowork-session-seed/…/artifact-roster.json` at teardown and seeded into new sessions; the CLI reads that key |

The rest are smaller:
- a simulator consent waiver;
- a refusal to adopt some CLI sessions;
- trusted-device Remote Control cleanup;
- a teleport snapshot;
- side sessions;
- terminal tabs;
- Spaces store recovery;
- a helper-CLI serialization kill switch;
- UsageProbe backoff;
- a plugin-link kill switch;
- the prompt-suggestions setting;
- a "New Session in New Window" menu item;
- a Sentry kill switch.

None touches scheduled tasks or egress.

The dropped id, `4217215889`, gated the macOS entry points: dock menu, Spotlight entries, OS Services, code deep links and folder drop. In 2.9939.2 they are on whenever the user is logged in. The fcache still serves the old id, and nothing reads it.

---

# LESSON 214 — HIPAA EGRESS AND FAST MODE ON THIRD-PARTY PROVIDERS

**For an organization marked HIPAA, 2.9939.2 replaces a `*` in the Cowork VM's egress allowlist with four Anthropic and Claude domains. A new spawn variable turns fast mode off for every third-party Cowork deployment. That changes nothing on Bedrock or Vertex, where fast mode was already off. It fixes gateways with a static credential, which the agent took for first-party.**

## The egress filter

`resolveVmAllowedDomains` (chunk `Cb2x-E4A`) now passes its result through:

```js
function Jan(e){if(!e?.includes("*")||!Jb())return e;
  let t=e.filter(e=>e!=="*");
  eA("lam_hipaa_gate_blocked",{surface:"vm_egress_allowlist"});
  return[...new Set([...t,...jSe])]}
// jSe = ["*.anthropic.com","anthropic.com","claude.com","*.claude.com"]
```

`Jb()` is the HIPAA test, fed by the organization's `compliance_taints` including `"hipaa"` (a second, local-preference path exists; its writer was not traced). Any list without `*`, or any organization not marked, passes through unchanged. The same filter is applied directly on each VM spawn call. 2.7032.0 has no filter, and `vm_egress_allowlist` is the only new one of the seven `lam_hipaa_gate_blocked` surfaces.

A skill on a HIPAA organization whose egress was "everything" gets only those four domains in the VM. There is no message beyond the telemetry event.

## Fast mode on third-party

2.9939.2 adds `CLAUDE_CODE_DISABLE_FAST_MODE` to the spawn environment for `type==="3p"` deployments (absent in 2.7032.0). In the agent (2.1.281):

```js
ro(){if(He()!=="firstParty")return!1;return!a.CLAUDE_CODE_DISABLE_FAST_MODE}
```

The fast-mode setting appears only when `ro()` is true. The effect depends on what `He()` returns:

| Deployment | Before 2.9939.2 | Effect of the new variable |
|---|---|---|
| Bedrock, Vertex (Desktop sets `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`) | `He()` not first-party, fast mode already off | none |
| Foundry and the other providers Desktop names | same pattern (inferred) | none |
| Gateway with a static credential (no `CLAUDE_CODE_USE_*`, no gateway credential slot) | `He()` fell through to `"firstParty"`, so the fast-mode setting was reachable | **turns it off**: a real fix |
| Gateway with interactive sign-in | not settled | not settled |

`Va()`'s direct `fastModeEnabled` read feeds the per-turn request, but its input can only become true through the same `ro()`-gated setting, so it follows the table.
