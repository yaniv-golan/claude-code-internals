#!/usr/bin/env bash
# extract-bundle.sh — Extract the JS application bundle from a Claude Code Bun SEA binary.
#
# Claude Code is compiled as a Bun Single Executable Application (SEA). The minified
# JS bundle is embedded in the binary after a recognizable marker string. This script
# finds that marker, extracts the bundle to a file, and reports basic stats.
#
# Usage:
#   ./extract-bundle.sh                          Auto-detect installed claude binary
#   ./extract-bundle.sh /path/to/claude          Use a specific binary
#   ./extract-bundle.sh /path/to/claude out.js   Write bundle to out.js
#
# Requirements: python3 (stdlib only)

set -euo pipefail

# ── Argument parsing ───────────────────────────────────────────────────────────

BINARY=""
OUTPUT=""

for arg in "$@"; do
  if [[ "$arg" == "--help" || "$arg" == "-h" ]]; then
    echo "Usage: $0 [binary] [output.js]"
    echo ""
    echo "  binary     Path to claude binary (auto-detected if omitted)"
    echo "  output.js  Output file (default: claude-<version>-bundle.js)"
    echo ""
    echo "Examples:"
    echo "  $0"
    echo "  $0 ~/.local/share/claude/versions/2.1.94"
    echo "  $0 ~/.local/share/claude/versions/2.1.94 bundle.js"
    exit 0
  elif [[ -z "$BINARY" && -f "$arg" ]]; then
    BINARY="$arg"
  elif [[ -z "$OUTPUT" ]]; then
    OUTPUT="$arg"
  fi
done

# ── Auto-detect binary ─────────────────────────────────────────────────────────

if [[ -z "$BINARY" ]]; then
  # Try versioned directory first (most reliable — gets the actual binary, not a wrapper)
  if [[ -d "$HOME/.local/share/claude/versions" ]]; then
    latest=$(ls -t "$HOME/.local/share/claude/versions/" 2>/dev/null | head -1 || true)
    if [[ -n "$latest" && -f "$HOME/.local/share/claude/versions/$latest" ]]; then
      BINARY="$HOME/.local/share/claude/versions/$latest"
    elif [[ -n "$latest" && -f "$HOME/.local/share/claude/versions/$latest/claude" ]]; then
      BINARY="$HOME/.local/share/claude/versions/$latest/claude"
    fi
  fi

  # Fall back to PATH
  if [[ -z "$BINARY" ]]; then
    claude_path=$(command -v claude 2>/dev/null || true)
    if [[ -n "$claude_path" ]]; then
      # Resolve symlinks to get the actual binary
      BINARY=$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$claude_path" 2>/dev/null || echo "$claude_path")
    fi
  fi
fi

if [[ -z "$BINARY" || ! -f "$BINARY" ]]; then
  echo "Error: could not find Claude Code binary. Pass it explicitly:" >&2
  echo "  $0 /path/to/claude [output.js]" >&2
  echo "" >&2
  echo "Common locations:" >&2
  echo "  ~/.local/share/claude/versions/<version>/claude" >&2
  echo "  /usr/local/bin/claude  (may be a wrapper script)" >&2
  exit 1
fi

# ── Get version from binary ────────────────────────────────────────────────────

VERSION=""

if [[ -x "$BINARY" ]]; then
  VERSION=$("$BINARY" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
fi

if [[ -z "$VERSION" ]]; then
  VERSION=$(strings "$BINARY" 2>/dev/null \
    | grep -oE 'VERSION:"[0-9]+\.[0-9]+\.[0-9]+"' \
    | head -1 \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' \
    || true)
fi

if [[ -z "$VERSION" ]]; then
  VERSION=$(strings "$BINARY" 2>/dev/null \
    | grep -oE '"version":"[0-9]+\.[0-9]+\.[0-9]+"' \
    | head -1 \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' \
    || true)
fi

if [[ -z "$VERSION" ]]; then
  base_name=$(basename "$BINARY")
  if [[ "$base_name" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    VERSION="$base_name"
  else
    VERSION="unknown"
  fi
fi

if [[ -z "$OUTPUT" ]]; then
  OUTPUT="claude-${VERSION}-bundle.js"
fi

BINARY_SIZE=$(stat -f%z "$BINARY" 2>/dev/null || stat -c%s "$BINARY" 2>/dev/null || echo "?")
echo "Binary:  $BINARY" >&2
echo "Version: $VERSION" >&2
echo "Size:    $BINARY_SIZE bytes" >&2
echo "Output:  $OUTPUT" >&2
echo "" >&2

# ── Bundle extraction (Python) ─────────────────────────────────────────────────
# The app bundle starts immediately after the marker string:
#   "// Claude Code is a Beta product"
# We scan forward from the marker until we hit a sustained run of null bytes,
# which marks the end of the JS text and the start of Bun's binary metadata.

python3 - "$BINARY" "$OUTPUT" << 'PYEOF'
import sys, os, mmap, re

binary, output = sys.argv[1], sys.argv[2]

MARKER        = b'// Claude Code is a Beta product'
NULL_RUN      = b'\x00' * 512   # consecutive nulls = end of bundle
CHUNK         = 1024 * 1024     # read 1 MB at a time
MIN_BUNDLE_KB = 100             # sanity floor

with open(binary, 'rb') as f:
    mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)

    pos = mm.find(MARKER)
    if pos == -1:
        sys.stderr.write('Error: marker not found in binary.\n')
        sys.stderr.write('The binary may not be a Claude Code Bun SEA, or the marker changed.\n')
        sys.exit(1)

    sys.stderr.write(f'Marker found at offset: {pos:,}\n')
    mm.seek(pos)
    chunks = []

    while True:
        chunk = mm.read(CHUNK)
        if not chunk:
            break
        null_idx = chunk.find(NULL_RUN)
        if null_idx != -1:
            chunks.append(chunk[:null_idx])
            break
        chunks.append(chunk)

    mm.close()

bundle = b''.join(chunks).rstrip(b'\x00\r\n ')
size_kb = len(bundle) // 1024
sys.stderr.write(f'Bundle size: {len(bundle):,} bytes ({size_kb} KB)\n')

if size_kb < MIN_BUNDLE_KB:
    sys.stderr.write(f'Error: bundle too small ({size_kb} KB < {MIN_BUNDLE_KB} KB minimum).\n')
    sys.stderr.write('Extraction likely failed — try a different binary.\n')
    sys.exit(1)

with open(output, 'wb') as f:
    f.write(bundle)

# Sanity: count JS function patterns in first 500KB
fn_count = len(re.findall(rb'function\s+\w+|=>\s*\{', bundle[:500_000]))
sys.stderr.write(f'JS sanity (function patterns in first 500KB): ~{fn_count}\n')

first = bundle[:80].decode('utf-8', errors='replace').split('\n')[0]
sys.stderr.write(f'First 80 chars: {first}\n')
sys.stderr.write(f'\nDone. Bundle written to: {output}\n')
PYEOF
