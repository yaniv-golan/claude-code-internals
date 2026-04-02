#!/usr/bin/env bash
# lookup.sh — Fast topic lookup from topic-index.json
# Usage: ./lookup.sh <search-term>
# Searches keyword_map for partial, case-insensitive matches and
# prints matching lesson details in machine-readable format.

set -euo pipefail

INDEX="${BASH_SOURCE[0]%/*}/../references/topic-index.json"

if [[ ! -f "$INDEX" ]]; then
  echo "Error: topic-index.json not found at $INDEX" >&2
  exit 1
fi

if [[ $# -lt 1 ]] || [[ -z "$1" ]]; then
  echo "Usage: lookup.sh <search-term>" >&2
  exit 1
fi

TERM=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')

# ─── MULTI-WORD TOKENIZATION ─────────────────────────────────
# Split the search term on whitespace. Search for each token
# independently and return the union of matches, ranked by
# how many tokens matched each lesson.

RESULTS=$(jq -r --arg term "$TERM" '
  . as $root |
  # Split input into tokens
  ($term | split(" ") | map(select(length > 0))) as $tokens |
  # For each token, find matching lesson IDs
  [ $tokens[] as $tok |
    [ $root.keyword_map | to_entries[] | select(.key | ascii_downcase | contains($tok)) | .value[] ]
  ] | flatten |
  # Count how many tokens matched each lesson ID (for ranking)
  group_by(.) | map({id: .[0], hits: length}) |
  sort_by(-.hits) |
  map(. as $match | $root.lessons[] | select(.id == $match.id) |
    "\(.file):\(.startLine):\(.endLine) \"\(.title)\""
  ) | .[] // empty
' "$INDEX")

if [[ -z "$RESULTS" ]]; then
  echo "No matches for \"$1\"" >&2
  exit 1
fi

echo "$RESULTS"
