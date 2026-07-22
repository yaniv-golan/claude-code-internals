---
domain: model-landscape
title: Model landscape (current)
as_of_cli: 2.1.217
sources: [108, 110, 133]
updated: 2026-07-22
---

# Model landscape (current)

One page, current truth. History and correction trail live in the source
lessons (see frontmatter).

## Default model

**Claude Sonnet 5 is the CLI default as of v2.1.197** (`claude-sonnet-5`),
**superseding Opus 4.8** (Ch21/L91's "Opus 4.8 is the new default" is
stale — the default changed twice across this span). Sonnet 5 has a
**native 1M-token context** (`claude-sonnet-5 | 1M`) and shipped with
promotional pricing of $2/$10 per Mtok through 2026-08-31. Opus 4.8 remains
selectable; it is no longer what a fresh install defaults to.

## Fable 5

**Claude Fable 5** (v2.1.170) is a Mythos-class model "made safe for
general use" — `claude-fable-5` and the internal
`claude-fable-5-mythos-5`. Fable 5 is the **live Cowork model** — fcache
gate `3045399524` (`registry.json` id `gate.3045399524`) whitelists
`claude-fable-5[1m]` and `claude-fable-5` with `alwaysLoad: true`. In the
standalone CLI, Fable 5 is one selectable model among the
Claude 5 family, not the default. v2.1.173 fixed normalization of the
`[1m]`-suffixed Fable names.

## Fallback chain

`fallbackModel` (v2.1.166) configures **up to three** fallback models,
tried in order when the primary is overloaded, feeding
`mainLoopModelOverride`. The agent also retries a turn once on the
fallback when the API returns an unexpected non-retryable error. The
server-side half of this machinery is two GB-gated API betas —
`server-side-fallback-2026-06-01` and `fallback-credit-2026-06-01` — plus
the `model_fallback` / `model_consent_fallback` / `model_refusal_fallback`
/ `model_refusal_no_fallback` control-protocol subtype family (L113/L108
respectively). `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK` opts out of the
refusal→fallback path specifically.

## Fast-mode and family-override env vars

- **`CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE`** — opt-in fast mode for Opus
  4.7, complementing the earlier `CLAUDE_CODE_OPUS_4_6_FAST_MODE_OVERRIDE`.
- **`ANTHROPIC_DEFAULT_FABLE_MODEL` quartet** (+ `_NAME`, `_DESCRIPTION`,
  `_SUPPORTED_CAPABILITIES`) — a Fable-5 model-family override set,
  matching the pre-existing OPUS/SONNET/HAIKU override pattern. It is in
  the managed-settings propagation allowlist (`T88`), so an org policy
  setting it reaches subagents too, not just the top-level session.

## Org-managed controls (context, not core to this page)

Org default models (shown as "Org default" / "Role default" in
`/model`), org model **restrictions** applied to the picker / `--model` /
`/model` / `ANTHROPIC_MODEL`, and the `enforceAvailableModels` managed
setting all constrain which of the above a given session can actually
select. Deprecated/auto-updated models now warn instead of silently
swapping.

## What to say if asked "what's the default model"

As of CLI v2.1.198: **Sonnet 5**, not Opus 4.8. If the session is a
Cowork session, the live model is **Fable 5** regardless of the
standalone-CLI default — a separate, fcache-gated selection (`gate.
3045399524` in `registry.json`), not the `/model` default.
