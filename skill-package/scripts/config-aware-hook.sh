#!/bin/bash
# CONFIG-AWARE HOOK - PreToolUse
# Detects when tools are about to modify .claude/ configuration files
# and injects a reminder to consult the claude-code-internals skill first.
#
# Updated: 2026-03-31 22:00:00 EST | Version 1.1.0
# Created: 2026-03-31 20:30:00 EST
#
# INTEGRATION: Bridges Ruflo task orchestration with the claude-code-internals
# skill. When Ruflo routes a task that touches Claude Code config, this
# hook ensures the deep architectural knowledge is consulted.
#
# EXIT CODE SEMANTICS (PreToolUse):
#   0 + stdout = proceed with tool + stdout injected as additionalContext to model
#   0 (no output) = proceed silently (no match or not relevant)
#   1 + stderr = proceed + stderr shown to user terminal only (NOT the model)
#   2 + stderr = block tool + stderr sent to model
#
# STRATEGY: We use exit 0 for both matches and non-matches. For matches,
# we output to STDOUT which gets injected as additionalContext into the
# model's context. This is non-blocking by design.

# Read the hook JSON input from stdin
INPUT=$(cat)

# ─── TOOL DETECTION (using jq for robust JSON parsing) ────────
# PreToolUse hooks receive: { "tool_name": "...", "tool_input": { ... } }

# Check if jq is available; fall back to grep if not
if command -v jq &>/dev/null; then
  TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
else
  TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

# ─── PATH EXTRACTION ──────────────────────────────────────────
TARGETS_CLAUDE_CONFIG=false

case "$TOOL_NAME" in
  Edit|Write)
    if command -v jq &>/dev/null; then
      FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
    else
      FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    fi
    if echo "$FILE_PATH" | grep -q '\.claude/'; then
      TARGETS_CLAUDE_CONFIG=true
    fi
    ;;
  Bash)
    if command -v jq &>/dev/null; then
      COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
    else
      COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    fi
    if echo "$COMMAND" | grep -q '\.claude/' ; then
      # Shell write operators
      if echo "$COMMAND" | grep -qE '(>|>>|mv |cp |rm |sed |tee |chmod |mkdir |touch |install |ln ).*\.claude/|\.claude/.*(>|>>)'; then
        TARGETS_CLAUDE_CONFIG=true
      fi
      # Redirect writes
      if echo "$COMMAND" | grep -qE '(echo|cat|printf).*>.*\.claude/'; then
        TARGETS_CLAUDE_CONFIG=true
      fi
      # Scripting interpreter writes
      if echo "$COMMAND" | grep -qE '(python|node|ruby|perl).*\.claude/'; then
        TARGETS_CLAUDE_CONFIG=true
      fi
    fi
    ;;
  *)
    exit 0
    ;;
esac

# ─── OUTPUT ────────────────────────────────────────────────────
if [ "$TARGETS_CLAUDE_CONFIG" = "true" ]; then
  echo "This tool targets .claude/ config. Claude Code internals knowledge is available via /claude-code-internals [topic]. Consider consulting before making changes."
  exit 0
fi

# No match -- proceed silently
exit 0
