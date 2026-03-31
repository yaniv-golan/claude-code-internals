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

# 1. Find keyword_map keys that partially match the search term (case-insensitive).
# 2. Collect the unique lesson IDs from those matches.
# 3. Look up each lesson's file, startLine, endLine, title.
# 4. Output one line per lesson: file:startLine:endLine "title"

RESULTS=$(jq -r --arg term "$TERM" '
  . as $root |
  [ $root.keyword_map | to_entries[] | select(.key | ascii_downcase | contains($term)) | .value[] ] | unique |
  map(. as $id | $root.lessons[] | select(.id == $id)) |
  .[] |
  "\(.file):\(.startLine):\(.endLine) \"\(.title)\""
' "$INDEX")

if [[ -z "$RESULTS" ]]; then
  echo "No matches for \"$1\"" >&2
  exit 1
fi

echo "$RESULTS"
