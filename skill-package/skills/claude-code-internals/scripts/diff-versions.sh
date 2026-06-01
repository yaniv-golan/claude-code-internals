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
#   - New / removed tengu_* identifiers (GB feature flags + telemetry events)
#   - Version strings present in each bundle
#
# Usage:
#   ./diff-versions.sh <old-bundle.js> <new-bundle.js>
#   ./diff-versions.sh <old-bundle.js> <new-bundle.js> --json
#   ./diff-versions.sh <old-bundle.js> <new-bundle.js> --section=envvars
#
# Sections: envvars, commands, hooks, betas, tengu, versions, all (default)
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
      echo "Sections: envvars, commands, hooks, betas, tengu, versions, all (default)"
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
    """Extract CLAUDE_* and ANTHROPIC_* variable names.

    Anchored on JS-code contexts (process.env.X or "X") rather than \\b word
    boundaries. Word-boundary matching slurps adjacent bytes from the binary
    string table when those bytes happen to be in [A-Z0-9_] — string-table
    layout shifts every build, so adjacency is stochastic. Code-context
    matches are stable because they're delimited by . or quote chars.
    """
    # Three JS-context anchors:
    #   1. process.env.X  — runtime read
    #   2. "X" or 'X'     — string literal (read site, registration, etc.)
    #   3. {X:...} or ,X: — object-literal key (env var passed to child process)
    patterns = [
        r'process\.env\.((?:CLAUDE|ANTHROPIC)_[A-Z][A-Z0-9_]{2,})(?![A-Z0-9_])',
        r'["\']((?:CLAUDE|ANTHROPIC)_[A-Z][A-Z0-9_]{2,})["\']',
        r'[\{,]\s*((?:CLAUDE|ANTHROPIC)_[A-Z][A-Z0-9_]{2,})\s*:',
    ]
    out = set()
    for p in patterns:
        out.update(re.findall(p, text))
    return out

def extract_env_reads(text):
    """Subset of extract_envvars that ACTUALLY reads process.env.X.

    Used to flag "string-literal-only" matches — names that appear only as
    quoted strings or object keys but are never read via process.env. Those are
    frequently FALSE POSITIVES: bundled skill/markdown text (ANTHROPIC_ENVIRONMENT_ID),
    module exports (CLAUDE_CODE_SKILL_NAME), allowlist-array entries that are never
    consumed (CLAUDE_CODE_USE_GATEWAY), or string-table dumps (CLAUDE_EFFORT). A
    var with a real read here is a high-confidence behavioral env var.
    """
    return set(re.findall(
        r'process\.env\.((?:CLAUDE|ANTHROPIC)_[A-Z][A-Z0-9_]{2,})(?![A-Z0-9_])', text))

def extract_commands(text):
    """Extract slash command definitions keyed by name:"...".

    A command is recognized when a `description:` key or a `get description()`
    getter appears within the window after name:"...". The description TEXT is
    captured when it's a plain double-quoted or backtick (template-literal)
    string; computed/dynamic descriptions (e.g. get description(){return COND?
    "a":"b"}) are recorded as "(dynamic)" so the command still counts as PRESENT.

    Why the extra forms matter: a string-only matcher silently MISSED commands
    whose description is a template literal (ultraplan/ultrareview/fast/model)
    or a dynamic ternary (remote-control's get description(){return KN()?...}),
    causing FALSE REMOVALS when a command's description form changed between
    builds. (Genuine removals — e.g. /dream, which moved from a name:"dream"
    command to a built-in routine — still surface correctly: there's no
    name:"dream" registration in the new bundle, so it is legitimately absent.)
    """
    cmds = {}
    for m in re.finditer(r'name:"([a-z][a-z0-9+-]{0,59})"', text):
        name = m.group(1)
        window = text[m.start():m.start()+600]
        dm = (re.search(r'description:"([^"]{1,200})"', window)
              or re.search(r'get description\(\)\{return"([^"]{1,200})"', window))
        if dm:
            cmds[name] = dm.group(1); continue
        bm = (re.search(r'description:`([^`]{1,300})`', window)
              or re.search(r'get description\(\)\{return`([^`]{1,300})`', window))
        if bm:
            cmds[name] = bm.group(1); continue
        if re.search(r'get description\(\)\{|[,{]description:', window):
            cmds[name] = "(dynamic)"
    return cmds

def extract_hook_types(text):
    """Extract hook event type names from the master hook-event array.

    The array is a flat list of quoted PascalCase strings whose first element is
    "PreToolUse" (e.g. ["PreToolUse","PostToolUse",...,"MessageDisplay"]).

    NOTE: a previous version filtered to a fixed suffix allowlist
    (...Start|Stop|Use|Change|...). That silently dropped any event whose name
    ends otherwise — MessageDisplay (ends "Display"), PostToolBatch ("Batch"),
    CwdChanged/FileChanged ("Changed") — and, because the drop happened in BOTH
    bundles, the diff reported "unchanged" while the real array grew. We now
    capture EVERY PascalCase string inside the array literal, so the count tracks
    the live array (30 as of v2.1.159). Anchor on the quoted "PreToolUse" so the
    backward [-scan lands on the array's own opening bracket, not an earlier one.
    """
    idx = text.find('"PreToolUse"')
    if idx == -1:
        return set()
    start = text.rfind('[', max(0, idx-2000), idx)
    end = text.find(']', idx, idx+4000)
    if start == -1 or end == -1:
        return set()
    chunk = text[start:end+1]
    return set(re.findall(r'"([A-Z][a-zA-Z]+)"', chunk))

def extract_betas(text):
    """Extract API beta strings (format: word-YYYY-MM-DD)."""
    return set(re.findall(r'"([a-z][a-z0-9-]+-20\d\d-\d\d-\d\d)"', text))

def extract_tengu(text):
    """Extract tengu_* identifiers (GB feature flags + telemetry events).

    GB flags are accessed via S_("tengu_*", ...) or QK("tengu_*").
    Telemetry events are fired via Q("tengu_*", ...) / E("tengu_*", ...) etc.
    Both namespaces share the tengu_ prefix so we extract all quoted "tengu_*" literals.
    """
    return set(re.findall(r'"(tengu_[a-z0-9_]+)"', text))

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
    # High-confidence subset: names actually read via process.env.X in the new bundle.
    results['envvars']['env_reads_new'] = sorted(extract_env_reads(new_text))

if section in ('commands', 'all'):
    results['commands'] = diff_dicts(extract_commands(old_text), extract_commands(new_text), 'Slash Commands')

if section in ('hooks', 'all'):
    results['hooks'] = diff_sets(extract_hook_types(old_text), extract_hook_types(new_text), 'Hook Event Types')

if section in ('betas', 'all'):
    results['betas'] = diff_sets(extract_betas(old_text), extract_betas(new_text), 'API Beta Strings')

if section in ('tengu', 'all'):
    results['tengu'] = diff_sets(extract_tengu(old_text), extract_tengu(new_text), 'tengu_* Identifiers (GB flags + telemetry)')

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

for key in ('envvars', 'commands', 'hooks', 'betas', 'tengu'):
    if key in results:
        print_diff(results[key])
        # Flag added env vars with no process.env.X read — likely false positives
        # (markdown/exports/allowlist-only/string-table). Verify before documenting.
        if key == 'envvars':
            reads = set(results['envvars'].get('env_reads_new', []))
            suspect = [v for v in results['envvars'].get('added', []) if v not in reads]
            if suspect:
                print(f'   ⚠ Verify ({len(suspect)} added with NO process.env read — may be markdown/export/allowlist-only/dead):')
                for v in suspect:
                    print(f'       ? {v}')

print('\n  NOTE: This is a HEURISTIC diff — verify before documenting. Known gaps:')
print('   • Slash commands moved to the routines table (name+cron+template, e.g. /dream)')
print('     show as "removed" — they are reclassified, not deleted. Grep "/<name>" in both.')
print('   • Env vars flagged "⚠ Verify" lack a process.env read; confirm a real read site.')
print(f'\n{"="*60}\n')
PYEOF
