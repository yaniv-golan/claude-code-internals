#!/usr/bin/env bash
# patch-dream.sh — Force-activate the /dream command in Claude Code
#
# The /dream command is gated behind the server-side GrowthBook flag
# tengu_kairos_dream (default: false). This script injects the flag
# into the local GrowthBook cache (~/.claude.json) and keeps it alive
# by watching for cache overwrites during startup.
#
# Why this works:
#   - The isEnabled check runs LAZILY at invocation time, not at startup
#   - GrowthBook's E_() evaluator checks the in-memory Map (Nb) first,
#     then falls back to ~/.claude.json cachedGrowthBookFeatures
#   - The server does NOT send tengu_kairos_dream in its response, so
#     Nb never contains it — the cache fallback IS consulted
#   - However, the cache writeback (yQq) replaces the entire object with
#     whatever Nb contains, wiping our injected key
#   - Solution: run a background watcher that re-injects the flag whenever
#     the cache writeback wipes it (during the first ~10s of startup)
#
# Usage:
#   bash patch-dream.sh              # inject flag and launch watcher
#   bash patch-dream.sh --restore    # remove flag and stop watcher
#   bash patch-dream.sh --check      # check current status
#   bash patch-dream.sh --inject     # one-shot inject (no watcher)
#   bash patch-dream.sh --help       # show usage
#
# Requirements: node (v18+)

set -euo pipefail

CLAUDE_JSON="$HOME/.claude.json"
FLAG_NAME="tengu_kairos_dream"
WATCHER_PID_FILE="/tmp/patch-dream-watcher.pid"

# --- helpers ----------------------------------------------------------------

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo ":: $*"; }

usage() {
  cat <<'USAGE'
Usage: patch-dream.sh [OPTIONS]

Force-activate the /dream (memory consolidation) command in Claude Code
by injecting the tengu_kairos_dream flag into the local GrowthBook cache.

Options:
  (default)   Inject the flag and start a background watcher that
              re-injects it whenever Claude's SDK overwrites the cache
  --inject    One-shot inject without watcher (may get overwritten)
  --restore   Remove the injected flag and stop any watcher
  --check     Check if the flag is currently injected
  --help      Show this help message

How it works:
  The /dream command checks tengu_kairos_dream lazily on each invocation.
  The GrowthBook SDK evaluates flags server-side; since this flag isn't in
  the server response, it falls through to the local cache in ~/.claude.json.

  The challenge: the SDK overwrites the entire cache object on startup,
  wiping our injected key. The watcher re-injects it within milliseconds,
  before you'd ever type /dream.
USAGE
  exit 0
}

# --- inject/check/restore ---------------------------------------------------

inject_flag() {
  node -e "
    const fs = require('fs');
    const path = process.argv[1];
    const flag = process.argv[2];

    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(path, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }

    if (!cfg.cachedGrowthBookFeatures) cfg.cachedGrowthBookFeatures = {};

    if (cfg.cachedGrowthBookFeatures[flag] === true) {
      process.exit(0); // already set
    }

    cfg.cachedGrowthBookFeatures[flag] = true;
    fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  " "$CLAUDE_JSON" "$FLAG_NAME"
}

check_flag() {
  node -e "
    const fs = require('fs');
    try {
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      const v = cfg.cachedGrowthBookFeatures?.[process.argv[2]];
      console.log(v === undefined ? 'ABSENT' : String(v));
    } catch { console.log('ERROR'); }
  " "$CLAUDE_JSON" "$FLAG_NAME"
}

# --- watcher ----------------------------------------------------------------

stop_watcher() {
  if [[ -f "$WATCHER_PID_FILE" ]]; then
    local pid
    pid=$(cat "$WATCHER_PID_FILE" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      info "Stopped watcher (pid $pid)"
    fi
    rm -f "$WATCHER_PID_FILE"
  fi
}

start_watcher() {
  stop_watcher  # clean up any existing watcher

  # The watcher runs for 30 seconds (enough to survive SDK init + cache writeback)
  # It polls every 500ms and re-injects if the flag gets wiped
  node -e "
    const fs = require('fs');
    const path = process.argv[1];
    const flag = process.argv[2];
    const duration = 30000; // 30 seconds
    const interval = 500;   // check every 500ms
    const start = Date.now();

    function inject() {
      try {
        const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
        if (cfg.cachedGrowthBookFeatures?.[flag] !== true) {
          if (!cfg.cachedGrowthBookFeatures) cfg.cachedGrowthBookFeatures = {};
          cfg.cachedGrowthBookFeatures[flag] = true;
          fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
        }
      } catch {}
    }

    const timer = setInterval(() => {
      if (Date.now() - start > duration) {
        clearInterval(timer);
        // Final inject before exiting
        inject();
        process.exit(0);
      }
      inject();
    }, interval);

    // Don't keep the event loop alive if parent dies
    timer.unref?.();
    // But we DO want to stay alive for 30s
    setTimeout(() => {}, duration + 1000);
  " "$CLAUDE_JSON" "$FLAG_NAME" &

  local watcher_pid=$!
  echo "$watcher_pid" > "$WATCHER_PID_FILE"
  disown "$watcher_pid" 2>/dev/null
  info "Watcher started (pid $watcher_pid, runs for 30s)"
}

# --- main operations --------------------------------------------------------

do_check() {
  local value
  value=$(check_flag)

  case "$value" in
    true)
      info "Status: INJECTED ($FLAG_NAME = true in cache)"
      ;;
    false)
      info "Status: OVERWRITTEN ($FLAG_NAME = false — server sent explicit value)"
      ;;
    ABSENT)
      info "Status: NOT PRESENT ($FLAG_NAME not in cache)"
      ;;
    *)
      info "Status: UNKNOWN ($value)"
      ;;
  esac

  # Check watcher
  if [[ -f "$WATCHER_PID_FILE" ]]; then
    local pid
    pid=$(cat "$WATCHER_PID_FILE" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      info "Watcher: running (pid $pid)"
    else
      info "Watcher: not running (stale pid file)"
    fi
  else
    info "Watcher: not running"
  fi
}

do_inject_only() {
  inject_flag
  info "Flag injected ($FLAG_NAME = true)"
  info "Note: this may get overwritten when Claude starts. Use without --inject for persistent mode."
}

do_inject_and_watch() {
  inject_flag
  info "Flag injected ($FLAG_NAME = true)"
  start_watcher
  echo ""
  info "Ready. Start Claude Code now and /dream should be available."
  info "The watcher will keep the flag alive for 30 seconds."
}

do_restore() {
  stop_watcher

  if [[ ! -f "$CLAUDE_JSON" ]]; then
    info "No ~/.claude.json — nothing to restore."
    return
  fi

  node -e "
    const fs = require('fs');
    const path = process.argv[1];
    const flag = process.argv[2];
    const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));

    if (cfg.cachedGrowthBookFeatures && flag in cfg.cachedGrowthBookFeatures) {
      delete cfg.cachedGrowthBookFeatures[flag];
      fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
      console.log('Flag removed.');
    } else {
      console.log('Flag not present — nothing to remove.');
    }
  " "$CLAUDE_JSON" "$FLAG_NAME"

  info "Restored. /dream will use server-side flag value."
}

# --- entry point ------------------------------------------------------------

main() {
  local mode="watch"

  for arg in "$@"; do
    case "$arg" in
      --restore) mode="restore" ;;
      --check)   mode="check" ;;
      --inject)  mode="inject" ;;
      --help|-h) usage ;;
      *) die "Unknown option: $arg" ;;
    esac
  done

  case "$mode" in
    watch)   do_inject_and_watch ;;
    inject)  do_inject_only ;;
    restore) do_restore ;;
    check)   do_check ;;
  esac
}

main "$@"
