#!/usr/bin/env bash
# Publish (or verify) the GitHub "About" text from the copy checked into the repo.
#
# The About text restates the lesson and chapter counts, and it is the only such
# surface that lives outside the working tree — which is exactly why it drifted,
# sitting at "169 lessons across 46 chapters" through two releases while every
# file in the repo said 174/48. release-consistency.test.js can now assert the
# counts because .github/repo-description.txt is inside the boundary; this script
# is the mechanical half that copies it out, so nobody retypes it.
#
#   sync-repo-description.sh --check   compare live against the file (no writes)
#   sync-repo-description.sh --push    set the live description from the file
#
# `gh` defaults to the upstream fork parent, so -R / the full path is mandatory.
set -euo pipefail

REPO="yaniv-golan/claude-code-internals"
FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.github/repo-description.txt"

[[ -f "$FILE" ]] || { echo "missing $FILE" >&2; exit 2; }
want="$(tr -d '\n' < "$FILE")"
[[ -n "$want" ]] || { echo "$FILE is empty" >&2; exit 2; }

case "${1:---check}" in
  --check)
    have="$(gh api "repos/$REPO" --jq '.description')"
    if [[ "$have" == "$want" ]]; then
      echo "repo description matches .github/repo-description.txt"
    else
      echo "DRIFT — the live About text differs from the repo copy:" >&2
      echo "  live: $have" >&2
      echo "  repo: $want" >&2
      echo "Run: scripts/sync-repo-description.sh --push" >&2
      exit 1
    fi
    ;;
  --push)
    gh api -X PATCH "repos/$REPO" -f description="$want" --jq '.description'
    echo "pushed."
    ;;
  *) echo "usage: $0 [--check|--push]" >&2; exit 2 ;;
esac
