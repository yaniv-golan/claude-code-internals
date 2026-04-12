Updated: 2026-04-12 | Source: Binary extraction from claude v2.1.104

# Chapter 14: Verified New in v2.1.104 (Source-Confirmed)

> **Provenance:** All details come from direct binary extraction of the v2.1.104 bundle
> (2026-04-12) and diffing against v2.1.101. Bundle size increased ~14.7KB (90.0MB to 90.0MB).
>
> **No changes** in environment variables, slash commands, hook event types (19), API beta
> strings (28), model IDs, or feature flags. This is a **streaming reliability patch** with
> one system prompt tweak.

---

## TABLE OF CONTENTS

70. [Lesson 70 -- Streaming Partial Yield Protection](#lesson-70----streaming-partial-yield-protection)
71. [Lesson 71 -- System Prompt Section Rename: "Text output"](#lesson-71----system-prompt-section-rename-text-output)

---

# LESSON 70 -- STREAMING PARTIAL YIELD PROTECTION

## Overview

v2.1.104 fixes a defensive edge case in the streaming fallback pipeline where **partial
content could be silently discarded** during a streaming-to-non-streaming fallback.

Previously, when the stream watchdog detected an idle timeout, the system always attempted
to fall back to non-streaming mode — even if content blocks had already been yielded to the
user. This meant visible partial responses could be thrown away and the request retried
from scratch in non-streaming mode.

v2.1.104 adds a `GH.length > 0` check: if any content blocks have already been yielded,
the system **throws immediately** with `fallback_cause: "partial_yield"` instead of falling
back. This preserves the partial content.

## Before vs After

### v2.1.101 (old behavior)

```javascript
// Watchdog timeout always produced the same error regardless of partial content
U_ = NH ? Error("Stream idle timeout - no chunks received") : v_;
// Then: if fallback_disabled → throw; else fall back to non-streaming
// Problem: partial content already yielded to user gets discarded
```

### v2.1.104 (new behavior)

```javascript
// Error message now distinguishes partial vs empty responses
F_ = NH ? Error(
  GH.length > 0
    ? "Stream idle timeout - partial response received"
    : "Stream idle timeout - no chunks received"
) : v_;

// NEW: If content blocks were already yielded, DON'T fall back
if (GH.length > 0) throw Q("tengu_streaming_fallback_to_non_streaming", {
  model: T.model,
  error: F_.name,
  attemptNumber: JH,
  maxOutputTokens: tH,
  thinkingType: q.type,
  fallback_disabled: N_,
  request_id: o ?? "unknown",
  fallback_cause: "partial_yield"
}), F_;

// Only fall back to non-streaming if NO content has been yielded
if (N_) throw ... // fallback_disabled path (unchanged)
// else: fall back to non-streaming (unchanged)
```

## StreamIdleTimeoutError Enhancement

The `StreamIdleTimeoutError` class now properly exposes an `idleMs` property:

```javascript
class StreamIdleTimeoutError extends Error {
  idleMs;
  constructor(ms) {
    super(`stream idle: no bytes for ${ms}ms`);
    this.name = "StreamIdleTimeoutError";
    this.idleMs = ms;
  }
}
```

This `idleMs` value is consumed by the `tengu_streaming_idle_timeout` telemetry event.

## Telemetry Changes

### New `tier` field on `tengu_streaming_idle_timeout`

The idle timeout telemetry now distinguishes **where** the timeout occurred:

| `tier` value | Meaning |
|-------------|---------|
| `"byte"` | Byte-level timeout — no bytes received from the transport layer |
| `"event"` | Event-level timeout — some bytes received but no complete SSE events for the configured duration |

In v2.1.101, this event did not include a `tier` field.

### New `fallback_cause: "partial_yield"`

The `tengu_streaming_fallback_to_non_streaming` event gains a new cause value:

| `fallback_cause` | Meaning |
|-----------------|---------|
| `"partial_yield"` | **New in v2.1.104.** Stream timed out but content blocks were already yielded. Fallback to non-streaming was **skipped** to preserve partial content. |
| `"watchdog"` | Stream idle timeout with no content yielded (existing) |
| `"other"` | Non-timeout streaming errors (existing) |
| `"404_stream_creation"` | Streaming endpoint returned 404 (existing) |

## Streaming Pipeline Constants (Unchanged)

These constants remain the same as v2.1.101:

| Constant | Value | Purpose |
|----------|-------|---------|
| Default idle timeout | 90000ms (90s) | `CLAUDE_STREAM_IDLE_TIMEOUT_MS` env var override |
| Watchdog half-interval | `kH = MH/2` (45s) | Intermediate warning timer |
| Watchdog stall threshold | 30000ms (30s) | Gap between events before `tengu_streaming_stall` fires |
| Disable fallback env var | `CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK` | When set, never falls back |
| Disable fallback flag | `tengu_disable_streaming_to_non_streaming_fallback` | GrowthBook gate for same |

## Key Identifiers

| Symbol (v2.1.104) | Purpose |
|-------------------|---------|
| `MZ_` | `StreamIdleTimeoutError` class |
| `GH` | Array of yielded content block messages (checked for `length > 0`) |
| `NH` | Boolean flag: true when watchdog timeout triggered |
| `F_` | Error object (new variable name; was `U_` in v2.1.101) |
| `N_` | `fallback_disabled` — true when non-streaming fallback is suppressed |
| `ELH` | `"x-client-request-id"` header constant |

## Non-obvious Behavior

- **The partial yield check is position-sensitive:** The `GH.length > 0` check runs
  *before* the `fallback_disabled` check. This means partial content always takes
  precedence — even if fallback is allowed, the system won't fall back when content
  has been yielded.
- **The error message is cosmetic for telemetry:** The distinct error messages ("partial
  response received" vs "no chunks received") primarily serve the telemetry pipeline.
  Both result in a thrown error; the difference is whether fallback is attempted.
- **`partial_yield` does NOT retry:** Unlike other fallback causes that trigger a
  non-streaming retry, `partial_yield` throws and stops. The partial content already
  yielded is the final response.

## Bundle Size

| Version | Bundle size | Delta |
|---------|------------|-------|
| v2.1.101 | 89,787,416 bytes (87,683 KB) | -- |
| v2.1.104 | 89,801,578 bytes (87,697 KB) | +14.2 KB (+0.016%) |

---

# LESSON 71 -- SYSTEM PROMPT SECTION RENAME: "TEXT OUTPUT"

## Overview

v2.1.104 renames the system prompt section header from `"# Communication style"` to
`"# Text output (does not apply to tool calls)"`. This clarifies that the style
guidelines in this section apply only to Claude's prose responses, not to structured
tool call parameters.

## Gating

The rename is gated behind **two conditions** (both must be true):

1. **Model check:** `L1(H).includes("opus-4-6")` — only active for Opus 4.6 models
2. **Feature flag:** `w_().clientDataCache?.quiet_salted_ember === "true"` — a
   client-data-cache flag (not a standard GrowthBook feature flag)

The gating function is `wJH(H)` where `H` is the model identifier. If either condition
fails, the section is **omitted entirely** from the system prompt (returns `null`, and the
call site spreads an empty array). This gating was **identical in v2.1.101** — only the
header text changed in v2.1.104, not the gating logic.

## Implementation

```javascript
// v2.1.101
function yk5(H) {
  if (!wJH(H)) return null;
  return `# Communication style\n...`;
}

// v2.1.104
function Sk5(H) {
  if (!wJH(H)) return null;
  return `# Text output (does not apply to tool calls)\n...`;
}
```

The section content following the header is unchanged — only the header itself was renamed.

## `quiet_salted_ember` Flag

This is NOT a standard GrowthBook feature flag (not prefixed with `tengu_`). It lives in
`clientDataCache`, which is populated from a different path than the GrowthBook SDK. This
means:

- It cannot be overridden via the cache injection technique documented in L68
- It is not visible in `cachedGrowthBookFeatures` in `~/.claude.json`
- It appears to be a server-side experiment flag delivered through the client data channel

## Internal Section Name

The dynamic system prompt section is registered as `"anti_verbosity"`:

```javascript
...wJH(_) ? [Dv("anti_verbosity", () => Sk5(_))] : []
```

This name reveals the section's purpose: reducing model verbosity by scoping style
guidelines away from tool call outputs.

## Key Identifiers

| Symbol (v2.1.104) | Purpose |
|-------------------|---------|
| `wJH(H)` | Gate function: checks model is opus-4-6 AND `quiet_salted_ember === "true"` |
| `Sk5(H)` | Returns the "Text output" section string (was `yk5` in v2.1.101) |
| `quiet_salted_ember` | Client data cache flag controlling the rename |
| `"anti_verbosity"` | Internal section name in the dynamic system prompt assembly |

## Non-obvious Behavior

- **Model-specific:** This only affects Opus 4.6 sessions. Other models (Sonnet, Haiku)
  never see either version of this section.
- **The rename is semantic, not cosmetic:** "Communication style" could be interpreted as
  applying to all outputs including tool calls. "Text output (does not apply to tool calls)"
  explicitly scopes the guidelines to prose-only, potentially reducing cases where the model
  applies style constraints to structured tool parameters.
- **Double gating:** Both the model check and the flag must pass. Even Opus 4.6 users won't
  see the rename unless `quiet_salted_ember` is enabled server-side for their account/org.
