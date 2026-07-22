---
domain: memory-knowledge-base
title: Auto-memory → knowledge base (current)
as_of_cli: 2.1.217
sources: [90, 108, 109, 113]
updated: 2026-07-03
---

# Auto-memory → knowledge base (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter).

## The transition

The auto-memory pipeline introduced with the L90 memory-write survey
(Approve/Reject confirmation UX for memory-file writes, with a per-write
LLM-generated ≤120-char summary and a 5-second countdown) has grown into
a **periodically-resynced knowledge base** model. As of v2.1.198 the
binary carries a `bulk_inflate` load path and the literal string
`knowledge base`, alongside states like `bulk inflate incomplete` /
`unavailable` — the memory store is no longer just a set of files written
on approval; it is bulk-loaded and kept in sync over time.

## The five memory flags

All five are new relative to the L90 baseline:

| Env var | Effect |
| --- | --- |
| `CLAUDE_CODE_DISABLE_MEMORY_BULK_INFLATE` | Disables the "bulk inflate" load path that hydrates the knowledge base. |
| `CLAUDE_CODE_DISABLE_MEMORY_PERIODIC_RESYNC` | Disables periodic re-sync of the memory store against its source. |
| `CLAUDE_CODE_FORCE_EVALUATE_MEMORY` | Forces the memory-evaluation pass to run. |
| `CLAUDE_CODE_FORCE_MEMORY_SURVEY` | Forces the L90 Approve/Reject write-survey to run. |
| `CLAUDE_CODE_KB_COHESION_FIXES` | Enables knowledge-base cohesion fixes (consistency corrections across stored memory). |

`/pause-memory` (the rename target of the removed `/toggle-memory`, see
`command-surface.md`) pauses automemory for the current session — it sits
downstream of all five flags, not a replacement for them.

## Cowork's memory-guidelines bypass

`CLAUDE_COWORK_MEMORY_GUIDELINES` is Cowork's memory-bypass escape hatch:
it **replaces the entire memory pipeline** described above rather than
adding to it. Its sibling `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` is the
**additive** form — it supplements the normal pipeline instead of
replacing it. A related env var, `CLAUDE_COWORK_MEMORY_INDEX_CONTENT`,
injects the Cowork memory index as a raw string directly (non-empty value
= use it directly; empty string = disable; unset = fall back to a file
path) — the Desktop-side counterpart is Cowork Spaces' per-space
`getAutoMemoryDir` / `readSpaceMemoryIndex` IPC methods (part of the
`CoworkSpaces` interface, L109), which own the per-space memory store and
hand it to the agent.

Do not conflate the three: `GUIDELINES` swaps out the memory system
entirely, `EXTRA_GUIDELINES` supplements it, and `INDEX_CONTENT` is a
content-injection channel for whichever pipeline is active.

## What NOT to assume

- The five bulk-inflate/resync/cohesion flags are **CLI-wide**, not
  Cowork-specific — they apply to the standalone knowledge-base pipeline
  regardless of session kind.
- `CLAUDE_COWORK_MEMORY_GUIDELINES` being set does not disable the five
  flags above; it bypasses the pipeline they configure, which makes them
  moot for that session, not inactive elsewhere.
