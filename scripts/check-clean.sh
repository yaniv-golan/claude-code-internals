#!/usr/bin/env bash
# Run the CI checks against tracked files only, the way a fresh clone sees them.
#
# CI already runs on a clean checkout. This is the local counterpart: it catches a
# test that passes here only because of a gitignored file (CLAUDE.md, docs/internal/)
# or an untracked one, before it reaches CI.
#
# Usage:
#   scripts/check-clean.sh          # tracked files, with their working-tree content
#   scripts/check-clean.sh --head   # tracked files as committed at HEAD
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/cci-clean.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

cd "$root"
if [[ "${1:-}" == "--head" ]]; then
  git archive HEAD | tar -xf - -C "$tmp"
else
  # Tracked files that still exist on disk (a tracked file deleted in the
  # working tree is simply absent, as it would be after committing).
  git ls-files -z | while IFS= read -r -d '' f; do
    [[ -e "$f" ]] && printf '%s\0' "$f"
  done | tar --null -T - -cf - | tar -xf - -C "$tmp"
fi

cd "$tmp"
skill=skill-package/skills/claude-code-internals
step() { printf '\n== %s\n' "$1"; }

step "Script tests"
node --test "$skill/scripts/tests/"*.test.js
step "Repository script tests (release.js, offline sandboxes)"
node --test scripts/tests/*.test.js
step "JSON index format"
node "$skill/scripts/check-json-format.js"
step "History markers"
node "$skill/scripts/check-history-markers.js"
step "State-layer integrity"
node "$skill/scripts/validate-state.js"
step "State-layer reconciliation"
out="$(node "$skill/scripts/state.js" --audit)"
echo "$out" | tail -1
grep -q "everything reconciled to baseline" <<<"$out"
if [[ -f "$skill/scripts/build.js" ]]; then
  step "Derived fields"
  node "$skill/scripts/build.js" --check
fi
# The gated question set and baseline (evals/retrieval/lib.js CURRENT_QUESTIONS /
# CURRENT_BASELINE; retrieval-gate.test.js checks this file names exactly those).
# A missing one fails: it must not silently turn the retrieval gate off.
step "Retrieval baseline"
for f in evals/retrieval/baseline-v4.json evals/retrieval/questions-v2.json; do
  if [[ ! -f "$f" ]]; then
    echo "missing $f (not tracked?): the retrieval gate cannot run" >&2
    exit 1
  fi
done
node evals/retrieval/run.js --baseline evals/retrieval/baseline-v4.json --questions evals/retrieval/questions-v2.json | tail -2
test "${PIPESTATUS[0]}" -eq 0
step "Site generator tests"
node --test site/generator/tests/*.test.js
step "Site build + disclosure lint"
node site/generator/build.js --out "$tmp/.site-dist" >/dev/null
node site/generator/lint-disclosure.js "$tmp/.site-dist"

printf '\nclean-checkout checks passed\n'
