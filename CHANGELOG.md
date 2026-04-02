# Changelog

## v2.2.0 — 2026-04-03 (this fork)

Forked from [stuinfla/claude-code-internals](https://github.com/stuinfla/claude-code-internals) (v2.0.0, 50 lessons, v2.1.88).

### Added

**Chapter 9 — Binary-verified new features in v2.1.90** (Lessons 51–56)

The v2.1.90 Claude Code binary was extracted and diffed against v2.1.88 using the new `extract-bundle.sh` and `diff-versions.sh` scripts. Six new lessons document the findings:

- **L51 — `/effort` & reasoning budget**: `effortLevel` setting, `effort-2025-11-24` API beta, `ultrathink_effort` message type, `effortValue` in the query pipeline. API beta and `max`/`auto` levels not in official docs.
- **L52 — `/rewind` & file checkpointing**: `FileHistoryState` type, message-keyed snapshots, `--rewind-files` CLI flag (not in official CLI reference), `TombstoneMessage` type, dry-run preview on `Esc Esc`.
- **L53 — `/teleport` session transfer**: `teleportFromSessionsAPI()` function, `GET /v1/code/sessions/{id}/teleport-events` API, git repo validation logic, pagination, distinction from ULTRAPLAN's `teleportToRemote()`.
- **L54 — `/branch` conversation forking**: `agentType: "fork"`, `forkContextMessages` context inheritance, `immediate: true` flag.
- **L55 — Session resume & new env vars**: `tengu_gleaming_fair` feature gate (default off), 70min/100k token thresholds, advisor model (`advisorModel` setting, `advisor-tool-2026-03-01` beta), 8 new env vars (7 undocumented), 2 removed env vars, 18 active API betas.
- **L56 — New commands**: `/autocompact` (compaction window setter, undocumented), `/buddy` (companion system, date-gated April 2026+, base command documented in v2.1.89 changelog), `/powerup` (interactive lessons, documented), `/toggle-memory` (per-session memory toggle, disabled in binary).

All documentation status claims verified against official docs (code.claude.com/docs) and the v2.1.89/v2.1.90 changelogs on 2026-04-03.

**New runtime scripts** (reduce LLM offset math and shell-injection risk):
- `scripts/fetch-lesson.js` — fetch lesson content by ID; no file path or line offset tracking needed; replaces `Read` calls in the skill workflow
- `scripts/xref.js` — cross-reference lookup CLI; replaces the fragile inline `node -e` in SKILL.md Step 3; shell-safe (query is argv, not interpolated)
- `scripts/troubleshoot.js` — troubleshooting index CLI; replaces inline `node -e` in Step 4; shell-safe

**New maintenance scripts** (make future binary updates repeatable):
- `scripts/extract-bundle.sh` — extracts the JS bundle from any Claude Code Bun SEA binary; auto-detects the installed version; uses Python stdlib only
- `scripts/diff-versions.sh` — structured diff of env vars, slash commands, hook types, and API betas between two bundle files; what was used to find the Chapter 9 content

**Plugin marketplace infrastructure** (installable without manual zip):
- `.claude-plugin/marketplace.json` — root marketplace definition; enables `yaniv-golan/claude-code-internals` shorthand in Claude Desktop and Claude Code CLI
- `skill-package/.claude-plugin/plugin.json` — plugin definition consumed by the marketplace resolver
- `site/static/install-claude-desktop.html` — "Add to Claude" button page using `claude://` deep link with 5-second fallback to manual instructions
- `.github/workflows/release.yml` — auto-builds and attaches zip on git tag push
- `.github/workflows/deploy-site.yml` — deploys `site/` to GitHub Pages

### Changed

- **`SKILL.md`**: Steps 3–5 now use the new script CLIs (`xref.js`, `troubleshoot.js`, `fetch-lesson.js`) instead of fragile inline `node -e` blocks. Added empty-topic handling (prints available topics index). Added version check step. Added Gotchas section. Updated lesson table to include Chapter 9.
- **`version.json`**: `skill_version` 2.0.0 → 2.2.0, `captured_version` 2.1.88 → 2.1.90, `lessons_count` 50 → 56, added `verified_against_binary` field.
- **`README.md`**: Rewritten installation section with per-platform instructions (Claude Desktop, Claude Code CLI, Claude.ai web, Manus, ChatGPT, Codex), "Add to Claude" badge, updated version numbers, updated lesson counts and chapter table.

### Removed

Nothing from the original was removed. All 50 original lessons, scripts, and indexes are intact.

---

## v2.0.0 — 2026-03-31 (original, [stuinfla/claude-code-internals](https://github.com/stuinfla/claude-code-internals))

Original release by **stuinfla**. All credit for the foundational work:

- 50 lessons across 8 chapters reverse-engineered from Claude Code v2.1.88 source docs (markdown.engineering)
- Unified RRF search combining keyword lookup (`lookup.sh`) and TF-IDF cosine similarity (`semantic-search.js`) via `search.js`
- 494-keyword topic index (`topic-index.json`)
- Pre-built TF-IDF vectors for all 50 lessons (`semantic-index.json`)
- 200 lesson-to-lesson cross-references (`cross-references.json`)
- 25 troubleshooting symptom patterns (`troubleshooting.json`)
- PreToolUse hook for `.claude/` config awareness (`config-aware-hook.sh`)
- Version staleness detection (`check-version.sh`)
- RuFlo/RuVector integration support (`build-rvf-index.js`)
- Architecture diagrams and full README documentation
