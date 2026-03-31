#!/bin/bash
# CONFIG-AWARE HOOK - PreToolUse
# Detects when tools are about to modify .claude/ configuration files
# and injects a reminder to consult the claude-internals skill first.
#
# Updated: 2026-03-31 20:30:00 EST | Version 1.0.0
# Created: 2026-03-31 20:30:00 EST
#
# INTEGRATION: Bridges Ruflo task orchestration with the claude-internals
# skill. When Ruflo routes a task that touches Claude Code config, this
# hook ensures the deep architectural knowledge is consulted.
#
# EXIT CODE SEMANTICS (PreToolUse):
#   0 = proceed silently (no match or not relevant)
#   2 = block tool + stderr to model (used here for context injection)
#   other = proceed + stderr to user only
#
# STRATEGY: We use exit 0 for both matches and non-matches (proceed
# silently). For matches, we output to STDOUT (not stderr), which
# injects the message as additionalContext into the model's context.
# Exit 1 stderr goes to the USER's terminal, not the model — that's
# why the reminder was invisible. Exit 0 + stdout = model sees it.

# Read the hook JSON input from stdin
INPUT=$(cat)

# ─── TOOL DETECTION ────────────────────────────────────────────
# Extract the tool name from the hook input JSON.
# PreToolUse hooks receive: { "tool_name": "...", "tool_input": { ... } }
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

# ─── PATH EXTRACTION ──────────────────────────────────────────
# For Edit/Write tools: check file_path parameter
# For Bash tool: check command string for .claude/ references
TARGETS_CLAUDE_CONFIG=false

case "$TOOL_NAME" in
  Edit|Write)
    # Extract file_path from tool_input
    FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    if echo "$FILE_PATH" | grep -q '\.claude/'; then
      TARGETS_CLAUDE_CONFIG=true
    fi
    ;;
  Bash)
    # Extract command from tool_input
    COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    # Check if the command modifies .claude/ files (write operations)
    if echo "$COMMAND" | grep -q '\.claude/' ; then
      # Only trigger on write-like operations, not reads
      if echo "$COMMAND" | grep -qE '(>|>>|mv |cp |rm |sed |tee |chmod |mkdir |touch |install |ln ).*\.claude/|\.claude/.*(>|>>)'; then
        TARGETS_CLAUDE_CONFIG=true
      fi
      # Also catch explicit echo/cat redirects into .claude/
      if echo "$COMMAND" | grep -qE '(echo|cat|printf).*>.*\.claude/'; then
        TARGETS_CLAUDE_CONFIG=true
      fi
    fi
    ;;
  *)
    # Not a tool we monitor -- pass through silently
    exit 0
    ;;
esac

# ─── OUTPUT ────────────────────────────────────────────────────
if [ "$TARGETS_CLAUDE_CONFIG" = "true" ]; then
  # Exit 0 + stdout = proceed with tool + stdout injected as additionalContext to model
  echo "⚡ This tool targets .claude/ config. Claude Code internals knowledge is available via /claude-code-internals [topic]. Consider consulting before making changes."
  exit 0
fi

# No match -- proceed silently
exit 0
