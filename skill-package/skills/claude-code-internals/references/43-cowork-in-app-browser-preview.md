Updated: 2026-08-27 | Source: First-party read of Desktop `app.asar` **1.37937.1** (extracted; every claim below re-checked against a full-array extraction after a truncated sampling window produced one wrong absence claim mid-investigation — see L168's method note). **Binary tier PLUS live confirmation (added same day): both gates decoded force-ON from the live `fcache` (2026-08-27, 299 features), and the served tool list read from real sessions' own `system/init` records — which corrected the static read by one tool. See the two ADDENDA.** Does NOT move the Desktop baseline (still 1.30096.1, Ch43) — targeted subsystem read, per-fact provenance only.

# Chapter 46: The In-App Browser, and the Tool That Means Two Different Things

---

## TABLE OF CONTENTS

168. [Lesson 168 — Cowork Has Its Own Browser, With a Persistent Signed-In Profile](#lesson-168--cowork-has-its-own-browser)
169. [Lesson 169 — `preview_start` Has Two Incompatible Contracts, Chosen by Session Kind](#lesson-169--preview_start-has-two-incompatible-contracts)

---

# LESSON 168 — COWORK HAS ITS OWN BROWSER

**Cowork ships an in-app browser exposed as `mcp__Claude_Browser__*` — 14 tools whose names are identical to Claude-in-Chrome's, on a browser pane inside the app with its own persistent profile that carries the user's existing logins across sessions. It is a third browser surface, distinct from Claude-in-Chrome and from computer-use, and it is gated by two GrowthBook gates plus a setting plus a session-kind test.**

## The surface

Prefix, first-party: `G5 = "Claude Browser"`, `agr = mcp__${G5.replace(/ /g,"_")}__` → **`mcp__Claude_Browser__`**.

The 14 tools in the definition array (`W5`): `read_page`, `computer`, `form_input`, `navigate`, `find`, `get_page_text`, `javascript_tool`, `read_console_messages`, `read_network_requests`, `resize_window`, `tabs_context`, `tabs_create`, `tabs_select`, `tabs_close`.

**ADDENDUM — what is actually served is SIXTEEN, and the static read undercounted.** Read from three real Cowork sessions' own `system/init` tool arrays (2026-08-27), the authoritative source per Ch37/L129:

```
browser_batch  computer  find  form_input  get_page_text  javascript_tool  navigate
preview_start  read_console_messages  read_network_requests  read_page  resize_window
tabs_close  tabs_context  tabs_create  tabs_select
```

That is `preview_start` + **15**, not the `preview_start` + 14 predicted by reading `Xhr`'s Cowork branch as `[Uhr(preview_start), ...Ghr]` where `Ghr` derives from `W5`. **`browser_batch` is served and is not in `W5`** — it appears in the `Qhr` tab-targeting map but not in the array this lesson traced, so it is appended by a path the static read did not follow.

The correction is small; the methodological point is not. This lesson predicted a rendered surface from a builder function, and the builder was not the whole story — exactly what Ch37/L129 says about `system/init` being authoritative over any reconstruction. **Read the init record when one exists.** Here ten sessions already carried it on disk, so the check cost nothing and no probe was needed. (`audit.jsonl` is a translated projection for *paths* per Ch40/L143 — tool names are unaffected, so it is a sound source for this particular question.)

**Every one of those names is also a Claude-in-Chrome tool name.** The two surfaces are distinguished *only* by MCP prefix. A skill written against `mcp__claude-in-chrome__*` is a prefix swap from running in the in-app browser — and, less happily, any logic that recognises browser tools by bare name can no longer tell which browser it is driving.

A tab-targeting classification (`Qhr`) tags each tool `reads-tab`, `mutates-tab`, or `no-tab-target` — `computer`, `form_input`, `navigate`, `javascript_tool`, `resize_window`, `tabs_select` and `tabs_close` mutate; the readers and `tabs_context` read; `tabs_create`, `browser_batch` and `preview_start` target no tab. This is the shape a permission or concurrency layer would key on.

## Gating — two gates, a setting, and a session-kind test

```js
xS(id)            = Zx[id]?.on ?? false          // GrowthBook gate read
kL()              = !CL || SL                     // unresolved — see below
jL()              = !kL() && xS(`17519066`)
ML()              = jL() ? xS(`3990395613`) : false
NL()              = ML() && Vx(`coworkBrowserToolsEnabled`) !== false
hasInAppBrowser   = NL() && sessionType !== `chat`
```

So it needs **gate `17519066` AND gate `3990395613`**, `!kL()`, a user setting that is on unless explicitly `false`, and a session that is **not Chat mode**. Both gate ids are new to this skill's registry. **Their live state is unknown** — no fcache was decoded this pass, and a named gate is not an enabled gate (Ch37/L131's "absent from the fcache ≠ off" applies in the other direction here too).

`kL() = !CL || SL` is **not resolved**; `CL`/`SL` read as build- or platform-level constants and were not traced. Flagged rather than guessed.

## The part with a security shape: a persistent, signed-in profile

From the shipped `in_app_browser` prompt section, verbatim:

> *"The in-app browser keeps its own persistent profile shared across this app's sessions, so the person (or an earlier session) may already be signed in to sites there, and sign-ins Claude completes persist. Claude treats existing sessions as the person's and never signs out, changes credentials, or acts on an account beyond what the task needs."*

A durable, cross-session **authenticated** browsing context, reachable by an agent, where the boundary is stated as an instruction rather than enforced by a mechanism. Read alongside Ch36/L127's inventory, this is a further credential-adjacent channel: not a credential *store*, but standing access to whatever those cookies authenticate. The prompt also notes that per-site approval may be required and some sites are blocked outright — the enforcement that does exist lives there, not in the tool surface.

## Surface arbitration, and the limits

A second prompt section (`browser_surfaces`) picks the default when both browsers exist:

```js
ot = shouldEnableChromeExtensionBridge() && !(isDisabled?.() ?? false)   // hasChromeBrowserSurface
st = ot && cS(`coworkPreferredBrowser`) === `chrome`                     // prefer Chrome
```

With `st`, Claude defaults to the user's real Chrome and treats the in-app browser as fallback; without it, the in-app browser is *"already loaded, so Claude defaults to it."*

Two stated limits worth carrying: the in-app browser **cannot open `file://` URLs or a `localhost` server Claude started itself** — *"those run where Claude's shell runs, not where the browser is"* — and the prompt directs Claude to publish generated HTML as an Artifact instead. It also prefers `get_page_text`/`read_page` over screenshots, reserving `computer {action:"screenshot"}` for when layout is the point.

## Method note — a truncated window nearly produced a false absence claim

Mid-investigation a fixed-size sample of the tool array returned its first ten entries, and the Cowork branch appeared to serve **no `tabs_*` tools** — which, against a prompt that instructs the model to call `tabs_context` and `tabs_create`, looked exactly like Ch44/L164's dangling-reference defect. It was wrong: `W5` has 14 entries and the sample cut at 10. The tell was a description-override map carrying a `tabs_context` key that the "absent" list could not explain. **Extract whole arrays by bracket-matching before asserting what is not in one** — a fixed character window is a sampling instrument, not an inventory, and this is the same family as Ch43/L162's partial extraction and Ch44/L166's encoding trap.

---

# LESSON 169 — `preview_start` HAS TWO INCOMPATIBLE CONTRACTS

**The tool named `preview_start` takes `{name}` and starts a dev server from `.claude/launch.json` on one surface, and takes `{url}` and opens a browser tab on another. Same name, different input schema, different semantics — selected by session kind at tool-list construction time. Reading either description and writing for the other produces a call that cannot succeed.**

## The branch

```js
function Xhr(e, t=`ccd`){
  if (t === `cowork`) {
    let t = e.find(e => e.name === `preview_start`);
    return [...t ? [Uhr(t)] : [], ...Ghr]
  }
  return jL() ? [...e.filter(e => U5.has(e.name)).map(Hhr), ...W5] : e
}
```

Three different surfaces fall out of it:

| session kind | what is served |
|---|---|
| `cowork` | `Uhr(preview_start)` — the **URL** form — plus all 14 browser tools (`Ghr` = `W5` with Cowork-specific descriptions) |
| default (`ccd`), gate on | 4 dev-server tools (`U5` = `preview_start/stop/list/logs`, remapped) plus the 14 browser tools |
| default (`ccd`), gate off | the **full 13-tool** `preview_*` dev-server family, and **no browser** |

## The two contracts

Base definition (`pgr`), which is what an unqualified read of the tool table shows:

> **`preview_start`** — *"Start a dev server by name from `.claude/launch.json`. If `.claude/launch.json` doesn't exist, create it first… Reuses the server if already running. **ALWAYS use this instead of Bash for running servers.** If the deliverable is already published as an Artifact, update the Artifact instead of starting a server to show it."* — input `{ name }`.

The Cowork rewrite (`Uhr`) replaces both description and schema:

> *"Open the Browser pane at a URL (**a fresh browser tab; no dev server on this surface**). Returns a `tabId` — pass it to read_page / computer / navigate / etc. to target that tab; omitting tabId acts on the fronted tab."* — input `{ url }`.

**So `.claude/launch.json` and the dev-server family are not a Cowork feature.** The full 13-tool set — `preview_stop/list/logs/console_logs/screenshot/snapshot/inspect/click/fill/eval/network/resize`, a Playwright-shaped surface bound to a locally started server — belongs to the other session kind. Cowork keeps only the name.

The `launch.json` format the model is told to author, verbatim:

```json
{ "version": "0.0.1",
  "configurations": [
    { "name": "<unique-name>", "runtimeExecutable": "<command>",
      "runtimeArgs": ["<args>"], "port": <port> } ] }
```

**ADDENDUM — `.claude/launch.json` is a cross-artifact config surface, and the CLI has a permission carve-out for it.** The standalone CLI **2.1.247** knows the file by its own name — *"Preview launch config is allowed for writing"* — a write-permission exception in the same class as `CLAUDE.md`, and it enumerates the file alongside `scheduled_tasks.json`, `CLAUDE.md`, `daemon.json` and `policy-limits.json`. So this is not a Desktop-only artifact; the CLI recognises, registers and deliberately permits writes to it.

The identification with Ch27/L112's **Launch Composer** nevertheless stays **inferred**. `CLAUDE_CODE_ENABLE_LAUNCH_COMPOSER` / `_DISABLE_` are both still present at 2.1.247, but only in the env-var export table, with no co-occurrence with `launch.json` found — adjacency in a binary is not a link. The CLI's own name for the file is *"Preview launch config"*, which is the name to use until something ties the two together.

## Why this is worth a lesson rather than a footnote

The two contracts are consistent with each other in intent — "get something on screen" — and mutually exclusive in practice. Nothing in the name warns you, the schemas share no field, and the description an author is most likely to encounter first is the one that does not apply to Cowork. The general rule this instance argues for: **a tool's contract is a property of the surface that served it, not of its name.** Ch44/L166 made the same point about prompt text belonging to a surface; this is the tool-schema form of it, and it is sharper, because a wrong prompt merely misleads while a wrong schema cannot execute.

Corollary for anyone reading a tool table out of a binary: the raw definition array is the **pre-transform** list. `Xhr`, `Uhr` and `Hhr` all rewrite entries on the way out, exactly as Ch37/L129's `disallowedTools`/`toolAliases` rewrite the spawn's declared `tools[]`. **A declaration is not a rendered surface** — in either direction.
