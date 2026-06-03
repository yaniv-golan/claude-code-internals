Updated: 2026-06-04 | Source: Binary extraction from Claude.app (Desktop) `app.asar`, version **1.9659.4** (string + offset analysis; no diff baseline — first capture of the MCP-Apps host bridge surface)

# Chapter 22: Claude Desktop Host Internals — MCP Apps Bridge & Elicitation (app.asar v1.9659.4)

> **Provenance.** Direct inspection of `/Applications/Claude.app/Contents/Resources/app.asar`
> (Desktop **1.9659.4**, 25.5 MB). This chapter is about the **Desktop app as an MCP host**, not
> the CLI bundle — it complements Ch20/L89 (Cowork split execution) and Ch21/L99 (host-delegated
> auth) which also draw on `app.asar`. All claims below are byte-offset-located in the shipped
> binary; offsets are for the 1.9659.4 build and will drift across versions.
>
> **Why this chapter exists.** A common secondhand claim — "MCP App UIs are read-only in Claude
> Desktop" — turns out to be *imprecise*, and the imprecision matters for anyone building an MCP
> server that needs to collect data (e.g. a secret) from the user. The binary settles it: an MCP
> App UI **can** call back to the host, but has **no channel to a server tool**, and its only
> data-return path routes **through the conversation**. **Elicitation** is the only host mechanism
> that returns user input **privately to the requesting server**. That distinction is the lesson.

---

## TABLE OF CONTENTS

105. [Lesson 105 -- Desktop MCP-Apps Bridge Dialect + Elicitation Control Protocol (the UI-can't-return-secrets-privately finding)](#lesson-105----desktop-mcp-apps-bridge--elicitation)

---

# LESSON 105 -- DESKTOP MCP-APPS BRIDGE + ELICITATION

**What it is.** Claude Desktop renders MCP Apps (server-declared `ui://` HTML resources, mime
`text/html;profile=mcp-app`) in a sandboxed iframe, wired to the host over a **postMessage
JSON-RPC bridge that is Claude's own minimal dialect** (`protocolVersion: "2025-11-21"`), *not*
the public `@modelcontextprotocol/ext-apps` SDK. Separately, the embedded Agent-SDK runtime
handles MCP **elicitation** (`elicitation/create`) as a first-class host control-request. The two
are the only ways an MCP server can interact with the user beyond returning tool text — and they
have **opposite data-flow properties**: the App UI's only way to send data back is to inject it
into the chat; elicitation returns it privately to the server. For secrets, use elicitation.

## Part A — the MCP Apps bridge dialect (UI ⇄ host)

**Present, and bidirectional — not "read-only."** `app.asar` ships the host renderer (referenced
in-source as `AppRenderer` / `PostMessageTransport`) and an **injected client** (`src/scripts/
mcp-app-helper.ts`, exposed as `window.app`) that gives every MCP-App iframe a generic
`sendRequest({method, params})` returning a Promise that resolves on the matching reply `id` —
so a UI can issue arbitrary JSON-RPC requests and await results. Verified `window.app` surface:

| `window.app` member | Wire method | Direction / effect |
|---|---|---|
| `sendRequest({method,params})` | any | UI→host request, awaits `{result}`/`{error}` |
| `sendNotification({method,params})` | any | UI→host fire-and-forget |
| `requestDisplayMode({mode})` | `ui/request-display-mode` | inline / fullscreen |
| (download button) | `ui/download-file` | save a file; returns `{isError}` |
| `attachFiles(files)` | `anthropic:attach-files` (raw, non-JSON-RPC) | attach files to conversation; **userActivation-gated host-side** (per in-source "PR #31090") |
| `setupAutoResize()` | `ui/notifications/size-changed` | autoresize |
| `onNotification(m,h)` | (host→UI) | receives `ui/notifications/tool-input(-partial)`, etc. |
| `window.sendPrompt(text)` | `ui/message` | **inject a `role:"user"` message into the chat** |

**The decisive negative.** Searching the entire `app.asar`: **zero** occurrences of `tools/call`,
`callServerTool`, `serverTools`, `hostCapabilities`, `availableDisplayModes`, `ext-apps`, or
`skybridge` **in the bridge cluster** (the 39 `tools/call` hits are normal host↔MCP-server
plumbing at byte 0.6M/7M/8M, far from the bridge at ~13.3M). So **there is no UI→server tool-call
channel** — the official ext-apps "callServerTool" capability simply isn't implemented. The only
UI→host data-return path is `sendPrompt`, which is literally (src/scripts/send-prompt.ts):

```js
window.sendPrompt = (text) => app.sendRequest({
  method: "ui/message",
  params: { role: "user", content: [{ type: "text", text }] }
});
```

i.e. anything a UI "submits" becomes a **user message in the conversation** — model-visible and in
the transcript. Conclusion: the "read-only" shorthand is **false** (the UI has working callbacks:
display-mode, download, attach-files, resize, sendPrompt), but **an App UI cannot privately hand
data to its server** — its only submit path is the chat.

**Reference implementation — the built-in "visualize" widget.** The host ships one MCP App of its
own: `getImagineServerDef()` (serverName `"visualize"`), resource `ui://imagine/show-widget.html`
(mime `text/html;profile=mcp-app`), tools `show_widget` + `read_me` (both `readOnlyHint:!0`), with
`_meta.ui.csp.connectDomains`/`resourceDomains` allowing esm.sh / cdnjs / jsdelivr / unpkg / google
fonts and `permissions.clipboardWrite`. It is gated `isEnabled: Bt("3444158716") && (sessionType
=== "cowork" || (sessionType === "ccd" && Bt("2204227020")))` — i.e. Cowork/CCD only, behind GB
flags. Tellingly, even this widget's own in-iframe **elicitation form** submits its answers via
`window.sendPrompt(payload)` (or a `{type:"submit"}` message) — confirming that an App UI's form
data goes back through the conversation, not to a server tool.

## Part B — elicitation as a host control-request (the private channel)

The embedded Agent-SDK runtime (the `_Wi` class in `app.asar`, the Desktop analogue of the CLI
query engine) routes server-initiated requests through a **control-request dispatcher** keyed on
`subtype`. Alongside `can_use_tool`, `hook_callback`, `mcp_message`, `oauth_token_refresh`, and
`host_auth_token_refresh` (the L99 RPC) sits `elicitation` (offsets ~8.57M):

```js
else if (A.request.subtype === "elicitation") {
  return this.onElicitation
    ? await this.onElicitation({ serverName: i.mcp_server_name, message, mode, url,
        elicitationId, requestedSchema, title, displayName, description }, { signal: t })
    : { action: "decline" };           // auto-declines if the host wired no handler
}
```

The result `{action, content}` is returned **as the response to the server's `elicitation/create`
request** — it does **not** enter the message stream. The bundled MCP SDK confirms the rest:
`elicitInput`/`elicitInputStream` send `{method:"elicitation/create", params}`, support **`form`
and `url`** modes (each gated on the client's advertised `clientCapabilities.elicitation.form` /
`.url`), validate an `accept`ed response's `content` against the request's `requestedSchema`, and
expose `notifications/elicitation/complete` (url mode, via `createElicitationCompletionNotifier`).
The `ElicitResult.action` enum is `accept | decline | cancel`. `elicitation/create` appears 32× and
`onElicitation` 6× — this is a fully wired, supported host capability in 1.9659.4.

## Why it matters (the practical rule)

| Mechanism | UI present? | Returns data **privately to the server**? | Use for |
|---|---|---|---|
| **MCP App UI** (`ui://`, bridge dialect) | rich, sandboxed iframe | ❌ — only callback to chat (`sendPrompt`→`ui/message`) | visualization / display panels; **never secrets** |
| **Elicitation** (`elicitation/create`) | host-native form / url | ✅ — returned as the request response | API keys, OAuth login (url mode), confirms |

For any MCP server (or mcp-bash skill) that must capture a credential or other private input from
the user inside Claude Desktop / Cowork, **elicitation is the only correct channel**; an MCP App
form would leak the value into the conversation/transcript. (Cross-ref: this is *why* the Cowork
credential-broker design routes onboarding through `elicitation`, not an App UI.)

**Cross-references.** Ch20/L89 (Cowork split execution; in-VM shell sealed from host env) ·
Ch21/L99 (host-delegated credential refresh — same control-request dispatcher: `host_auth_token_
refresh`/`oauth_token_refresh` siblings of `elicitation`) · Ch21/L95 (the 30-event hook master
array — a different host-side surface).

| Identifier | Kind | Where | Effect |
|---|---|---|---|
| `text/html;profile=mcp-app` | mime | resource decl | marks an MCP App HTML resource |
| `ui://…` | URI scheme | resource decl | predeclared App UI resource |
| `protocolVersion "2025-11-21"` | bridge handshake | `ui/initialize` | Claude's own MCP-Apps dialect |
| `window.app.sendRequest` | injected client API | iframe | generic UI→host JSON-RPC request |
| `sendPrompt(text)` → `ui/message` | injected client API | iframe | **only** UI data-return path → into chat |
| `ui/request-display-mode` / `ui/download-file` / `anthropic:attach-files` / `ui/notifications/size-changed` | wire methods | bridge | the working UI→host callbacks |
| `tools/call` / `callServerTool` / `serverTools` | — | **absent from bridge** | no UI→server tool channel |
| `getImagineServerDef` / `ui://imagine/show-widget.html` | built-in server | host | reference MCP App (`visualize`), Cowork/CCD-gated |
| `elicitation/create` (subtype `elicitation`) | control RPC | Agent-SDK dispatcher → `onElicitation` | **private** user input → server; `form`+`url` modes; `accept`/`decline`/`cancel` |
| `notifications/elicitation/complete` | notification | url-mode elicitation | completion signal (gated on `elicitation.url`) |
