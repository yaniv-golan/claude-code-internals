Updated: 2026-07-04 | Source: Binary extraction from Claude.app (Desktop) `app.asar`, version **1.18286.0** (string + byte-offset analysis; cross-checked against the live `fcache` feature store). **Methodology note: no byte-diff baseline.** The prior captured build, 1.17377.2, was pruned by Desktop's own auto-updater before this pass began, and Anthropic's official distribution channel does not serve historical Desktop `.app` builds (only the standalone CLI SEA binary is re-downloadable by version, from `downloads.claude.ai/claude-code-releases/<ver>/`; verified directly against the `claude-cowork-headless-emulator` project's own binary-recovery research, which reached the same conclusion independently). This chapter is therefore a **first-party re-verification pass** against the identifiers and mechanisms already published in Ch23/L106 through Ch26/L109 (used as the textual baseline in place of a binary diff), plus a fresh sweep for previously uncatalogued surface.

# Chapter 28: Claude Desktop v1.18286.0 — Re-Verification, an Effort-Spawn Correction, and New Cowork Surface

> **Provenance.** Direct inspection of `/Applications/Claude.app/Contents/Resources/app.asar`
> (Desktop **1.18286.0**), main process `.vite/build/index.js`, cross-checked against the
> account's live `fcache` (decoded 2026-07-04). This chapter re-verifies every mechanism
> published in Ch23/L106 (CLI-plugin credential broker), Ch24/L107 (control-protocol contract),
> Ch25/L108 (env vars & gates), and Ch26/L109 (Spaces/Scheduled Tasks/Tasks tool) against this
> newer build, corrects one claim, promotes one previously-speculative finding to confirmed, and
> catalogues genuinely new Cowork/Desktop surface. Minified identifiers below are the *current*
> build's names; per usual, they drift release to release, so cross-references match by mechanism,
> not by minified symbol.

---

## TABLE OF CONTENTS

114. [Lesson 114 -- Desktop v1.18286.0 Re-Verification, Effort-Spawn Correction & New Cowork Surface](#lesson-114----desktop-v1182860-re-verification)

---

# LESSON 114 -- DESKTOP v1.18286.0 RE-VERIFICATION, EFFORT-SPAWN CORRECTION & NEW COWORK SURFACE

## Part A — the `cli_plugin` gate, re-checked

The original trigger for this pass: is GrowthBook gate `2307090146` (`cli_plugin`, Ch23/L106 — the
CLI-plugin credential broker's dark-launch gate) still off? Decoding the live `fcache` on
2026-07-04 gives:

```json
"2307090146": { "value": false, "on": false, "off": true, "source": "defaultValue", "ruleId": null }
```

Still off, via `defaultValue` (not an experiment/targeting rule) — the same posture as every prior
check. Updated timeline:

| Desktop version | Date checked | Gate state | Source |
|---|---|---|---|
| 1.11847.5 | 2026-06-10 | Off | Ch23/L106 (first capture) |
| 1.12603.1 | 2026-06-13 | Off | Ch24/L107 |
| 1.17377.2 | 2026-07-02 | Off | Ch26/L109 |
| **1.18286.0** | **2026-07-04** | **Off** | **This lesson** |

The mechanism itself is structurally unchanged, only re-minified: the gate wrapper (previously
`Xd`, now a differently-named function with the identical body) still reads
`isFeatureEnabled("2307090146")` inside a try/catch defaulting to `false`; the runtime chokepoint
(previously `PKr`) still short-circuits with `errorCode:"oauth_disabled"` / `"plugin oauth disabled"`
*before* touching the encrypted store, and the same short-circuit now additionally guards three
more `LocalPlugins` write paths with the literal message `"Plugin OAuth is not enabled for this
account."`. The `hardcodedMainGrowthBookFeatures()` force-on table (previously `yKi`) is present
verbatim as an unminified method name in this build, still scoped to the `3p`/CCD deployment class
only — the standard client is unaffected. No change in kind, only in degree: see Part E for the
table's other members.

## Part B — broader re-verification: Ch24–26 mechanisms unchanged

Every other cross-checked mechanism from the prior three chapters is present and structurally
identical in 1.18286.0:

- **The 8-tool Desktop forced-ask matcher** (Ch24/L107, Ch26/L109's extension to 8) — same
  composition: `allow_cowork_file_delete`, `request_cowork_directory`, `launch_code_session`,
  `save_skill`, `MCP_CREATE_SCHEDULED_TASK`, `MCP_UPDATE_SCHEDULED_TASK`, `MCP_START_WATCHING`,
  `MCP_STOP_WATCHING`. (`save_skill`'s literal tool name — `mcp__cowork__save_skill` — is built via
  template-literal concatenation in this build, `` `mcp__${server}__${op}` ``, so a plain substring
  grep for the literal string misses it; confirmed present by resolving the concatenation.)
- **The `Task` PreToolUse hook blocking `run_in_background`** — verbatim:
  `if(j?.run_in_background) return {decision:"block", reason:"Background agents disabled"}`.
- **The host-loop tool partition** (`Bash`/`NotebookEdit`/`REPL`/`JavaScript`/`WebFetch` excluded,
  `mcp__workspace__bash`/`mcp__workspace__web_fetch` substituted) — unchanged.
- **`CoworkSpaces`** — all 24 documented IPC methods present, exact 1:1 match, no additions or
  removals.
- **`CoworkScheduledTasks`/`CCDScheduledTasks`** — all 9 documented methods present, exact 1:1
  match.
- **All 11 previously-catalogued GrowthBook gate IDs** (Ch25/L108's table) are present in the
  bundle's compiled string table.

In short: nothing in the four prior Desktop chapters has been walked back by this build. The rest
of this lesson covers what's actually new or corrected.

## Part C — correction to Ch24/L107: the `--effort` spawn value is not a hardcoded literal

Ch24/L107 states that the desktop "passes `--effort medium` explicitly" as if it were a fixed,
driver-supplied literal distinct from the agent's own default. Re-reading the spawn path in
1.18286.0 shows this framing is wrong: the value is a **variable**, not a constant —

```js
this.options.effort && Y.push("--effort", this.options.effort)
```

— backed by a genuine settings-driven resolver:

```js
async getDefaultEffort() {
  return await Uq(), RT().CLAUDE_CODE_EFFORT_LEVEL ?? process.env.CLAUDE_CODE_EFFORT_LEVEL ?? null
}
```

and a previously undocumented **`LocalSessions` IPC family**: `setEffort(sessionId, effort)`,
`getEffort(sessionId)`, `getDefaultEffort()`, `setFastMode(sessionId, fastMode)`. This ties directly
into the CLI-side effort mechanism already documented at lesson 93 (`CLAUDE_CODE_EFFORT_LEVEL`,
the global effort-tier pin) — Desktop has its own per-session UI/IPC layer on top of that same
env var and a managed-settings key, letting a user (or org policy) set a Cowork session's effort
level directly rather than it being baked into the spawn call. **"medium" was simply the observed
value of that setting at the time of the original capture, not a compiled-in constant.** Anyone
citing Ch24/L107's "passes `--effort medium` explicitly" claim going forward should read it as "the
setting happened to be `medium`," not "Desktop hardcodes medium."

## Part D — promotion: `CLAUDE_CODE_SUBAGENT_MODEL` is now confirmed wired, not speculative

Lesson 46 (`05-unreleased-bigpicture.md`, "Model System") previously catalogued
`CLAUDE_CODE_SUBAGENT_MODEL` as an **unreleased/speculative** precedence-order entry (env var →
tool-specified model → agent config field), without evidence it was actually being set anywhere.
In 1.18286.0 it's genuinely wired into the Desktop spawn path:

```js
cpA() !== void 0 && { CLAUDE_CODE_SUBAGENT_MODEL: cpA() }
```

where `cpA()` reads `eC()?.defaultSubagentModel` — a real Desktop settings field, not a
placeholder. This is a **promotion**, not a new discovery: the identifier was already known, but
its status moves from "described as a precedence rule, unconfirmed whether anything sets it" to
"confirmed set by a live Desktop settings field."

## Part E — new Cowork/Desktop surface (not in any of the four prior chapters or `registry.json`)

Checked against the full `state/registry.json` before inclusion here — none of the following were
already tracked as their own entries (as opposed to being mentioned only as an old/renamed name in
passing, which two initial candidates turned out to be — see the note on
`CLAUDE_CODE_DISABLE_AGENTS_FLEET` below).

| Identifier | Kind | Context | Notes |
|---|---|---|---|
| `CLAUDE_CODE_DISABLE_CRON` (Desktop/Cowork sense) | env var | `CLAUDE_CODE_DISABLE_CRON: A.disableCron ? "1" : ""` at main Cowork-session spawn; forced `disableCron:!0` in background/ephemeral spawn helpers | **Same env-var name, second meaning.** Lesson 38 already documents `CLAUDE_CODE_DISABLE_CRON=1` as the CLI's own `AGENT_TRIGGERS`/`tengu_kairos_cron` kill switch. This Desktop usage is a distinct, session-scoped `disableCron` setting wired at spawn time — plausibly the mechanism that keeps Ch26/L109's Scheduled Tasks from firing inside ephemeral/non-interactive Cowork spawns. Both meanings are real; don't conflate them. |
| `CLAUDE_CODE_SUBAGENT_MODEL` | env var | See Part D | Promotion, not new — see above. |
| `CLAUDE_CODE_QUESTION_PREVIEW_FORMAT` | env var | Set from `P?.askUserQuestion?.previewFormat` at spawn | The settings→env wiring behind Ch24/L107's `AskUserQuestion` documentation; the tool's reachability mechanism was documented, this specific formatting knob wasn't. |
| `CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL` | env var | Set unconditionally to `"true"` in the main Cowork spawn env | Not previously named as its own enable-flag; Ch24/L107 only documented `--permission-prompt-tool stdio` as the mechanism that keeps `AskUserQuestion` from being silently auto-dismissed. |
| `CLAUDE_CODE_DISABLE_AGENTS_FLEET` (Desktop sense) | env var | ~~Set to `"1"` alongside `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:"1"` in a Tasks-tool-child spawn path~~ **CORRECTED in L115 Part D:** each of the two vars appears **exactly once** in this same 1.18286.0 asar, and the site is the **main** local-agent spawn env builder — the object literal that also sets `CLAUDE_CODE_IS_COWORK:"1"` and `CLAUDE_CODE_ENTRYPOINT:"local-agent"`. There is no separate Tasks-tool-child spawn site in this build; backgrounding and Fleet/agent-view are suppressed for **every** Cowork session. | Lesson 100 documents this name only as the *old*, renamed-away name for `CLAUDE_CODE_DISABLE_AGENT_VIEW` (Fleet view → agent view rename). The old name is still live in the Cowork spawn env — but session-wide, not (as this row originally claimed) in a narrower nested-task path. See Ch29/L115 Part D for the re-grep. |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | env var | Fallback set to `"1"` when no memory path is resolvable | Companion to the next entry. |
| `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` | env var | The concrete env-var wiring between Ch26/L109's `CoworkSpaces.getAutoMemoryDir` (Space-scoped auto-memory directory) and the agent's spawn env | L109 documented the Desktop IPC method; this is the actual variable that carries its result to the agent process. |
| `MCP_LIST_SCHEDULED_TASKS` | MCP tool | A 5th scheduled-tasks tool, alongside the four (`CREATE`/`UPDATE`/`START_WATCHING`/`STOP_WATCHING`) in Ch26/L109's forced-ask matcher | List-only, lower-privilege — confirmed **not** part of the 8-tool forced-ask set, plausibly an intentional exclusion (read-only ops don't need the same explicit-approval gate as create/update/watch ops). |
| `mcp__cowork__propose_skills`, `mcp__cowork__send_user_message`, `mcp__cowork__present_files` | MCP tools | Found in the same string-table region as the already-documented `save_skill`/`launch_code_session` | Three more `cowork`-namespaced MCP tools not in the prior chapters. `present_files` has a visible log line, `[present_files] Promoted scratchpad file...`, suggesting it moves a file from the session's scratch space into the outputs/artifacts area. None of the three are in the 8-tool forced-ask matcher. |
| Gate `2976814254` | GrowthBook gate ID | In the same force-on table as `2307090146`; guard reads `gate(2976814254) && sessionType==="ccd" && !isSSH...` | Gates a browser-preview-related feature, CCD-session-scoped. New to the corpus. |
| Gate `3246569822` | GrowthBook gate ID | Same force-on table | Gates `canSaveSkill`. New to the corpus. |
| Gate `1696890383` | GrowthBook gate ID | Same force-on table | Gates whether `CLAUDE_COWORK_MEMORY_GUIDELINES` (lesson 90) is constructed at all at spawn time. New to the corpus. |

**Scope caveat, explicitly flagged (not asserted as removals):** a handful of `[VM]`/`[ASAR]`-tagged
env vars from Ch25/L108 (`CLAUDE_CODE_BG_CLASSIFIER_MODEL`, `CLAUDE_CODE_AUTO_MODE_MODEL`,
`CLAUDE_CODE_ENVIRONMENT_KIND`) did not turn up in this Desktop-only bundle sweep. This is **not**
evidence of removal — this pass did not have access to the in-VM ELF, and these strings may simply
live in a code path that tree-shook differently in this build. Treat as inconclusive, not
confirmed-removed, pending a future in-VM-ELF-inclusive pass. Likewise, `364911507` (the
`tasks_tab` experiment key from Ch26/L109) is absent from the static string table — expected, since
live GrowthBook experiment keys aren't necessarily compiled in as literals, so its absence here is
uninformative rather than a regression.

## Identifier table

| Identifier | Kind | Where | Effect |
|---|---|---|---|
| `2307090146` (`cli_plugin`) | GrowthBook gate | main process | Re-confirmed off, `defaultValue`, at v1.18286.0; mechanism unchanged (see Part A) |
| `getDefaultEffort` / `LocalSessions.{setEffort,getEffort,getDefaultEffort,setFastMode}` | IPC family | main process | Backs the `--effort` spawn arg with a real per-session settings value, not a hardcoded literal (Part C) |
| `CLAUDE_CODE_EFFORT_LEVEL` | env var (cross-ref) | resolver fallback | Global effort pin read by `getDefaultEffort()`; already documented at lesson 93 |
| `cpA()` / `defaultSubagentModel` | settings resolver | main process | Confirms `CLAUDE_CODE_SUBAGENT_MODEL` is genuinely wired (Part D), promoting lesson 46's speculative entry |
| `CLAUDE_CODE_DISABLE_CRON` (Desktop sense) | env var | Cowork session spawn | Session-scoped `disableCron` setting, distinct from lesson 38's CLI-level `AGENT_TRIGGERS` kill switch of the same name |
| `CLAUDE_CODE_QUESTION_PREVIEW_FORMAT` | env var | Cowork session spawn | `askUserQuestion.previewFormat` settings wiring |
| `CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL` | env var | Cowork session spawn | Explicit enable-flag, set unconditionally |
| `CLAUDE_CODE_DISABLE_AGENTS_FLEET` (Desktop sense) | env var | Main Cowork spawn env (corrected in L115 — not a Tasks-tool-child path) | Old Fleet-view name, still live: session-wide Fleet/background suppression |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` / `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` | env vars | Cowork session spawn | Concrete wiring for lesson 109's `CoworkSpaces.getAutoMemoryDir` |
| `MCP_LIST_SCHEDULED_TASKS` | MCP tool | Scheduled Tasks module | List-only 5th tool, excluded from the 8-tool forced-ask matcher |
| `mcp__cowork__propose_skills` / `send_user_message` / `present_files` | MCP tools | `cowork`-namespaced tool set | New tools, none in the forced-ask matcher |
| `2976814254` / `3246569822` / `1696890383` | GrowthBook gate IDs | force-on table | CCD browser-preview gate / `canSaveSkill` / `CLAUDE_COWORK_MEMORY_GUIDELINES`-construction gate |

## Methodology note (the transferable lesson)

Two things worth carrying forward. First: when the prior baseline binary is gone (pruned by
auto-update, no official recovery channel for that artifact class — see the provenance note up
top), a re-verification pass against **previously published identifiers as the textual baseline**
is a legitimate substitute for a byte-diff, provided every claim is still independently re-checked
against the *current* binary rather than assumed to still hold. Second: a "new candidate" found by
grepping a fresh bundle must be checked against the **existing structured registry**
(`state/registry.json`), not just prose chapters, before being called new — two initial candidates
here (`CLAUDE_CODE_CLASSIFIER_SUMMARY`, `CLAUDE_CODE_DISABLE_AGENTS_FLEET`) turned out to already
have registry entries (the latter only as a "renamed from" mention, which is why it was worth a
closer look rather than a blanket dismissal — it turned out to still be live for a narrower
purpose). Skipping that cross-check would have published false "new discovery" claims for things
already on record.

**Cross-references.** Ch23/L106 (`cli_plugin` gate, re-confirmed off in Part A) · Ch24/L107
(control-protocol contract; corrected in Part C) · Ch25/L108 (env vars & gates; re-confirmed intact
in Part B, `[VM]`-tagged absences noted as inconclusive in Part E) · Ch26/L109 (Spaces/Scheduled
Tasks; IPC surfaces re-confirmed byte-for-byte in Part B, `CoworkSpaces.getAutoMemoryDir` wiring
completed in Part E) · Lesson 38 (`04-connectivity-plugins.md`, Cron and Task Scheduling — the
CLI-side meaning of `CLAUDE_CODE_DISABLE_CRON`) · Lesson 46 (`05-unreleased-bigpicture.md`, Model
System — the speculative entry promoted in Part D) · Lesson 93 (`CLAUDE_CODE_EFFORT_LEVEL`,
corrected relationship to the Desktop spawn arg in Part C) · Lesson 100 (Fleet view →
agent view rename — the narrower surviving usage found in Part E).
