#!/usr/bin/env bash
# diff-versions.sh — Structured diff between two Claude Code JS bundles.
#
# Compares two bundle files (extracted via extract-bundle.sh) and produces a
# structured report covering the dimensions most useful for updating Chapter 9:
#
#   - New / removed environment variables (CLAUDE_* and ANTHROPIC_*)
#   - New / removed slash commands (name:"...", description:"...")
#   - New / removed hook event types (the xv1 array)
#   - New / removed API beta strings
#   - Version strings present in each bundle
#
# Usage:
#   ./diff-versions.sh <old-bundle.js> <new-bundle.js>
#   ./diff-versions.sh <old-bundle.js> <new-bundle.js> --json
#   ./diff-versions.sh <old-bundle.js> <new-bundle.js> --section=envvars
#
# Sections: envvars, commands, hooks, betas, versions, all (default)
#
# Requirements: python3 (stdlib only)

set -euo pipefail

# ── Argument parsing ───────────────────────────────────────────────────────────

OLD=""
NEW=""
AS_JSON=false
SECTION="all"

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      echo "Usage: $0 <old-bundle.js> <new-bundle.js> [--json] [--section=SECTION]"
      echo ""
      echo "Sections: envvars, commands, hooks, betas, versions, all (default)"
      echo ""
      echo "Examples:"
      echo "  $0 claude-2.1.88-bundle.js claude-2.1.90-bundle.js"
      echo "  $0 old.js new.js --section=envvars"
      echo "  $0 old.js new.js --json"
      exit 0 ;;
    --json) AS_JSON=true ;;
    --section=*) SECTION="${arg#--section=}" ;;
    *)
      if [[ -z "$OLD" ]]; then OLD="$arg"
      elif [[ -z "$NEW" ]]; then NEW="$arg"
      fi ;;
  esac
done

if [[ -z "$OLD" || -z "$NEW" ]]; then
  echo "Error: provide two bundle files to compare." >&2
  echo "Usage: $0 <old-bundle.js> <new-bundle.js>" >&2
  exit 1
fi

for f in "$OLD" "$NEW"; do
  if [[ ! -f "$f" ]]; then
    echo "Error: file not found: $f" >&2
    exit 1
  fi
done

# ── Python diff engine ─────────────────────────────────────────────────────────

python3 - "$OLD" "$NEW" "$SECTION" "$AS_JSON" << 'PYEOF'
import sys, re, json

old_file, new_file, section, as_json = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == 'true'

def read(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8', errors='replace')

def extract_envvars(text):
    """Extract CLAUDE_* and ANTHROPIC_* variable names."""
    return set(re.findall(r'\b((?:CLAUDE|ANTHROPIC)_[A-Z][A-Z0-9_]{2,})\b', text))

def extract_commands(text):
    """Extract slash command definitions: name:"...", description:"..." pairs."""
    cmds = {}
    # Match name:"foo" within a few hundred chars of description:"bar"
    for m in re.finditer(r'name:"([^"]{1,60})"', text):
        name = m.group(1)
        # Look for description within 300 chars after name
        window = text[m.start():m.start()+300]
        dm = re.search(r'description:"([^"]{1,200})"', window)
        if dm:
            cmds[name] = dm.group(1)
    return cmds

def extract_hook_types(text):
    """Extract hook event type names from the xv1 array or similar enum."""
    # Hook types appear as quoted strings in an array near "PreToolUse"
    # Find the array containing PreToolUse
    idx = text.find('PreToolUse')
    if idx == -1:
        return set()
    # Search backward for array start, forward for array end
    start = text.rfind('[', max(0, idx-500), idx)
    end = text.find(']', idx, idx+2000)
    if start == -1 or end == -1:
        return set()
    chunk = text[start:end+1]
    return set(re.findall(r'"([A-Z][a-zA-Z]+(?:Start|Stop|Use|Change|Submit|Created|Compact|Request|Denied|Result|Loaded|Idle|Failure|End|Removed|Create))"', chunk))

def extract_betas(text):
    """Extract API beta strings (format: word-YYYY-MM-DD)."""
    return set(re.findall(r'"([a-z][a-z0-9-]+-20\d\d-\d\d-\d\d)"', text))

def extract_versions(text):
    """Extract version strings."""
    return set(re.findall(r'"version":"(\d+\.\d+\.\d+)"', text))

def diff_sets(old_set, new_set, label):
    added   = sorted(new_set - old_set)
    removed = sorted(old_set - new_set)
    return {'label': label, 'added': added, 'removed': removed, 'unchanged': len(old_set & new_set)}

def diff_dicts(old_d, new_d, label):
    added   = {k: v for k, v in new_d.items() if k not in old_d}
    removed = {k: v for k, v in old_d.items() if k not in new_d}
    changed = {k: {'old': old_d[k], 'new': new_d[k]}
               for k in old_d if k in new_d and old_d[k] != new_d[k]}
    return {'label': label, 'added': added, 'removed': removed, 'changed': changed,
            'unchanged': len(set(old_d) & set(new_d)) - len(changed)}

print(f'Reading bundles...', file=sys.stderr)
old_text = read(old_file)
new_text = read(new_file)
print(f'Old: {len(old_text):,} bytes  New: {len(new_text):,} bytes', file=sys.stderr)

results = {}

if section in ('envvars', 'all'):
    results['envvars'] = diff_sets(extract_envvars(old_text), extract_envvars(new_text), 'Environment Variables')

if section in ('commands', 'all'):
    results['commands'] = diff_dicts(extract_commands(old_text), extract_commands(new_text), 'Slash Commands')

if section in ('hooks', 'all'):
    results['hooks'] = diff_sets(extract_hook_types(old_text), extract_hook_types(new_text), 'Hook Event Types')

if section in ('betas', 'all'):
    results['betas'] = diff_sets(extract_betas(old_text), extract_betas(new_text), 'API Beta Strings')

if section in ('versions', 'all'):
    results['versions'] = {
        'old': sorted(extract_versions(old_text)),
        'new': sorted(extract_versions(new_text)),
    }

if as_json:
    print(json.dumps(results, indent=2))
    sys.exit(0)

# ── Human-readable output ──────────────────────────────────────────────────────

import os
print(f'\n{"="*60}')
print(f'  Bundle diff: {os.path.basename(old_file)} → {os.path.basename(new_file)}')
print(f'{"="*60}')

if 'versions' in results:
    v = results['versions']
    print(f'\n  Versions in old: {", ".join(v["old"]) or "(none found)"}')
    print(f'  Versions in new: {", ".join(v["new"]) or "(none found)"}')

def print_diff(d, name_fn=lambda x: x):
    added   = d.get('added', [])
    removed = d.get('removed', [])
    changed = d.get('changed', {})
    unchanged = d.get('unchanged', 0)

    print(f'\n── {d["label"]} ──')
    print(f'   Unchanged: {unchanged}')

    if isinstance(added, list):
        if added:
            print(f'   Added ({len(added)}):')
            for x in added: print(f'     + {name_fn(x)}')
        else:
            print(f'   Added: (none)')

        if removed:
            print(f'   Removed ({len(removed)}):')
            for x in removed: print(f'     - {name_fn(x)}')
        else:
            print(f'   Removed: (none)')

    else:  # dict
        if added:
            print(f'   Added ({len(added)}):')
            for k, v in sorted(added.items()):
                desc = str(v)[:70]
                print(f'     + {k}: {desc}')
        else:
            print(f'   Added: (none)')

        if removed:
            print(f'   Removed ({len(removed)}):')
            for k in sorted(removed): print(f'     - {k}')
        else:
            print(f'   Removed: (none)')

        if changed:
            print(f'   Changed descriptions ({len(changed)}):')
            for k, v in sorted(changed.items()):
                print(f'     ~ {k}')
                print(f'       old: {str(v["old"])[:60]}')
                print(f'       new: {str(v["new"])[:60]}')

for key in ('envvars', 'commands', 'hooks', 'betas'):
    if key in results:
        print_diff(results[key])

print(f'\n{"="*60}\n')
PYEOF
