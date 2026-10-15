Updated: 2026-10-13 (L233–L234) | Source: **Claude Desktop `app.asar` 2.31226.1** (the installed build, byte-identical to the archived copy), Desktop's own logs on the capturing Mac (`main.log`, `mcp-server-<name>.log`), and **four decoded GrowthBook caches** taken around organization switches on 2026-10-12 and 2026-10-13. L233 is a code read with log evidence; no server that speaks MCP 2026-07-28 was run. L234 is measured. Minified names are given with their chunk file, because the same short name is reused across chunks.

# Chapter 65: Desktop 2.31226 — MCP Version Negotiation, and a Flag Cache That Follows the Organization

---

## TABLE OF CONTENTS

233. [Lesson 233 — Which Local MCP Servers Desktop Probes for MCP 2026-07-28, and When the Probe Breaks a Server](#lesson-233--which-local-mcp-servers-desktop-probes-for-mcp-2026-07-28-and-when-the-probe-breaks-a-server)
234. [Lesson 234 — Desktop's Flag Cache Follows the Selected Organization](#lesson-234--desktops-flag-cache-follows-the-selected-organization)

---

# LESSON 233 — WHICH LOCAL MCP SERVERS DESKTOP PROBES FOR MCP 2026-07-28, AND WHEN THE PROBE BREAKS A SERVER

**Desktop's bundled MCP client still defaults to the 2025 handshake (`initialize`). Desktop turns on 2026-07-28 negotiation per call site, and whether a local server is probed with `server/discover` depends on how Desktop launches it, not on whether chat, Cowork or Code uses it. Servers launched as ordinary processes (plain `claude_desktop_config.json` entries, Python, uv and binary bundles) are never probed. Node bundles that run on Desktop's built-in Node are. Chat probes a throwaway second copy of such a server; Cowork and Code sessions, and the bridge to cloud Cowork, probe the real process. A server that answers the probe with an error falls back to `initialize`; a server that closes the connection during the probe fails for Cowork and Code.**

## The client's rules (CODE-READ, `index.chunk-Cyt2WTko.js`)

- **Default.** The negotiation plan (`K8e`) reads `versionNegotiation.mode` and defaults to `"legacy"`: plain `initialize`, no probe. `{mode:"auto"}` probes; `{pin:"<rev>"}` probes and has no fallback.
- **Versions.** The only modern revision offered is `2026-07-28` (`c1e=[s1e]`). The legacy list is `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`; fallback runs `initialize` with `2025-11-25`.
- **The probe.** A JSON-RPC request `server/discover`, id `server-discover-probe-<n>`, whose `params._meta` carries `protocolVersion`, `clientInfo` and `clientCapabilities`. No retries unless configured (Desktop never configures them).
- **How the answer is read** (`F8e`):

| answer | result |
|---|---|
| a result that validates and lists `2026-07-28` | modern: no `initialize`; capabilities, server info and instructions come from the result, and every later request carries a `_meta` envelope |
| a result that fails validation, or doesn't list `2026-07-28` | legacy fallback |
| error `-32022` with `data.supported` | one corrective retry if that list includes `2026-07-28`, else legacy |
| any other error code (for example `-32601` method not found) | legacy fallback |
| no answer within the probe timeout, stdio | legacy fallback |
| connection closed during the probe, stdio | legacy **only if the probe ran on a disposable copy**; otherwise an error (below) |

- **In place vs disposable.** The SDK can probe a throwaway copy of the server itself (`n5e`), but only when the transport is its own base `StdioClientTransport` (the prototype carries `_dispose` and `_serverParams.command`, checked by `t5e`). Any other transport is probed over the real connection. On that path a close during the probe throws *"Version negotiation failed: the connection closed during the server/discover probe (this transport probed in place — the disposable sibling probe requires the SDK's base StdioClientTransport)"*. An error answer or a timeout leaves the same process usable.

## Who probes (CODE-READ)

Every opt-in is behind gate **`1942337209`** (`zx()`): when it is on, no call site probes. It was served off (`defaultValue`) in every capture through 2026-10-13, so probing is live.

| path | launches the server as | probe |
|---|---|---|
| any lane chosen by `bIt` as **exec**: plain config entries, servers that aren't installed extensions, Python, uv (`dynamic-uv`) and binary bundles, and Node bundles that fall back to the system's Node | the base `StdioClientTransport` | **never**. The chat path logs *"Era probe verdict: legacy (exec lane pinned — no sibling probe)"*; Cowork's pool and the custom-3P stdio path skip negotiation for that transport (`!(l instanceof Tm)`) |
| **chat**, built-in-Node bundle (`IJr`, `index.chunk-Cyt2WTko.js`) | Desktop spawns a second copy just for the probe (2 s probe, 4 s deadline), then starts the real one without a probe | yes, on the copy. The verdict goes to the renderer as `prior` with `McpServerConnected`. Every failure, including a close, becomes *legacy* |
| **Cowork and Code sessions**, built-in-Node bundle (`LocalMcpServerManager`, `index.chunk-BlHozUGN.js`, client name `local-agent-mode-<name>`) | Desktop's utility-process transport | yes, **in place**, 2 s timeout |
| **plugin MCP servers** in the same manager (`getPluginMcpInstance`) | always forced to exec | never |
| **bridge to cloud Cowork** (`[localMcpBridge]`, `index.chunk-BJdEh6JY.js`) | reuses the two manager instances above | as above; the bridge adds no probe of its own |
| **custom 3P** (admin MCP servers) | remote HTTP: probed, 10 s, directly and through the "Custom 3P MCP Host" utility process. stdio: forced to exec | HTTP yes; stdio never |

The runtime choice itself (`bIt`) is L224's: a Node bundle runs on built-in Node when `isUsingBuiltInNodeForMcp` isn't false and `compatibility.runtimes.node` is absent or satisfied by Desktop's Node.

The bridge's limits in this build are unchanged: 180 s per tool call (`a=18e4`), 10 s for `ensureAllConfiguredConnected` before it announces whatever connected (`o=1e4`), and a third constant of 120 s (`s=12e4`) whose use wasn't traced here. These are Desktop's bridge constants. The agent's own MCP tool timeout is a different setting, which a third-party administrator can set with `mcpToolTimeoutSec` (Ch67/L237).

## What it looks like (MEASURED, one Mac, logs from 2026-08-25 to 2026-10-12)

- No installed server answered with a modern result; no log line on this Mac says *modern*.
- A Node bundle on built-in Node (`@beeper/mcp-remote` 0.0.1, "Beeper Desktop") closes the connection on the unknown method. In chat it worked: its log has 253 *"Era probe verdict: legacy"* and 176 *"legacy (sibling did not complete the exchange)"*. For Cowork and Code it failed: 854 *"Couldn't start for Cowork and Code sessions"* lines with the in-place error above (context `shared-pool`), retried about every 3 s, from 2026-08-25 to 2026-10-12. So the same server can work in chat and be missing in Cowork.
- The pool's failures are written to the server's own `mcp-server-<name>.log`, not to `main.log`.

## Not verified

- The modern path (no `initialize`, `_meta` on every request) is read from the SDK code only.
- What the renderer does with `prior` is not in the asar (the chat page is claude.ai's web code). INFERRED: it connects with `prior`, so a modern verdict skips `initialize` there too.

## For a server author

- On a method you don't know, answer with a JSON-RPC error. Never exit or close stdin/stdout: in Cowork and Code that is fatal for a built-in-Node bundle.
- Don't rely on getting `initialize` from every client, and don't rely on getting `server/discover` either: which one arrives depends on how Desktop launched you.
- A server that supports 2026-07-28 has to answer `server/discover` within 2 s on stdio, or it is treated as legacy.
- If your server works in chat but is missing in Cowork, read `mcp-server-<name>.log` for *Couldn't start for Cowork and Code sessions*.

Desktop 2.37337 adds a dark path (gate `3184956269`) that routes MCP-Apps widget calls to plugin MCP servers the agent itself spawned in host-loop; see L236.

---

# LESSON 234 — DESKTOP'S FLAG CACHE FOLLOWS THE SELECTED ORGANIZATION

**Desktop rewrites its GrowthBook cache (`fcache`) when the user switches organization, and the served values differ between organizations. Between a Team organization and a Personal account on one Mac, the same 8 gates changed on every switch, including three this skill pins. A capture is only comparable with one taken under the same organization; a gate that "flips between captures" may only mean the captures were taken under different organizations.**

## What was measured (MEASURED, Desktop 2.31226.1, 417 features each)

Four decoded captures on one Mac, account and Desktop build unchanged:

| capture (UTC) | organization |
|---|---|
| 2026-10-12 05:15 | Team |
| 2026-10-12 05:36 | Personal (right after a switch) |
| 2026-10-13 16:16 | Team (the switch back happened unobserved) |
| 2026-10-13 17:05 | Personal (the fcache was rewritten at 17:05:25, during the switch; the runner's note that it had landed came at 17:05:42) |

The same 8 gates differ between Team and Personal in both pairs, with identical values on each side across the two days:

| gate | Team | Personal | what it is (CODE-READ) |
|---|---|---|---|
| `2486083521` | off (`defaultValue`) | on (`force`) | `cuCanUseToolEnabled`, Computer Use permission gate |
| `946844604` | off (`defaultValue`) | on (`force`) | the cloud memory relay |
| `3229517805` | `force`: sharing, auto-publish, debug log, verify tools | `defaultValue`: debug log, verify tools | local-artifact sharing config |
| `1291166712` | `force`, config without `appScopedEnabled` | `force`, with `appScopedEnabled` and `batchOnly:true` | Computer Use config |
| `40173473` | off | on | Computer Use on Windows |
| `2229805612` | off (`defaultValue`) | off (`force`) | default for remote control at startup |
| `445885797` | off | on | no consumer found by id in `app.asar` |
| `2947058150` | on | off | no consumer found by id in `app.asar` |

A ninth gate, `582101327`, changed between the two days in both organizations alike (`force` to `defaultValue`, value `true` throughout): that is a change over time, not the organization.

Before these captures, `2486083521`, `946844604` and `3229517805` had been recorded as flipping at almost every capture since 2026-10-07. The captures behind that record were taken without noting the organization.

## Consequences

- The skill's pinned record (`data/fcache-pinned.json`, captured 2026-10-11) matches Team for all three pinned org-linked gates.
- `scripts/fcache-restamp.js` compares the live cache with that record. Run under Personal, it reports those gates as moved although nothing changed server-side; the tool now prints a note when they move together.
- Lessons that state a served value of one of these gates state the Team value unless they say otherwise.

## For anyone reading the fcache

- Record which organization Desktop had selected when a capture was taken, and compare captures only within one organization.
- Before treating a gate change as a rollout, check whether Desktop's organization changed between the two captures.
- A user's session behaves according to the organization selected when the session reads the gate. A feature that works in Personal and not in Team (or the reverse) on the same Mac can be this, not a bug.
