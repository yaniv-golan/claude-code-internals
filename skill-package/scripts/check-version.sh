#!/usr/bin/env bash
# check-version.sh — Detect staleness between captured internals and running Claude Code version.
# Runs silently unless a version mismatch is found.

set -euo pipefail

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
VERSION_FILE="${SCRIPT_DIR}/../version.json"

# Bail silently if version.json is missing
[[ -f "$VERSION_FILE" ]] || exit 0

# Read captured_version from version.json (jq preferred, grep/sed fallback)
if command -v jq &>/dev/null; then
  CAPTURED=$(jq -r '.captured_version // empty' "$VERSION_FILE" 2>/dev/null)
else
  CAPTURED=$(grep -o '"captured_version"[[:space:]]*:[[:space:]]*"[^"]*"' "$VERSION_FILE" \
    | sed 's/.*"captured_version"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/')
fi

# Bail silently if we couldn't parse a version
[[ -n "${CAPTURED:-}" ]] || exit 0

# Bail silently if claude CLI is not available
command -v claude &>/dev/null || exit 0

# Get the running version (e.g. "claude 2.1.88" -> "2.1.88")
RAW_VERSION=$(claude --version 2>/dev/null) || exit 0
RUNNING=$(echo "$RAW_VERSION" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

# Bail silently if we couldn't parse the running version
[[ -n "${RUNNING:-}" ]] || exit 0

# Compare
if [[ "$CAPTURED" != "$RUNNING" ]]; then
  echo "Claude Code internals knowledge was captured from v${CAPTURED} but you are running v${RUNNING}. Some internals may have changed. Run /claude-code-internals to check specific topics."
fi

exit 0
