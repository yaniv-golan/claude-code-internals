# Retrieval eval suite (phase 0b)

Token-free-in-CI retrieval regression suite for `skill-package/skills/claude-code-internals`'s
search stack (`scripts/search.js` + `scripts/state.js`). See
`docs/internal/maintainability-refactor-plan-2026-09-28.md` §4.6(a) and §5 (phase 0b) for the
design this implements.

## Files

- **`lib.js`** — shared helpers, no dependencies: loads topic-index/registry, spawns `search.js`
  (it has no `module.exports`, so it can't be required — it's always spawned with `--json
  --top=N`), slices lesson text the same way `fetch-lesson.js` does, the identifier extractor
  (published rules: inline code spans, `CAPS_ENV_VARS`, 7–10-digit GrowthBook gate ids, slash
  commands, `tengu_*` names, `mcp__x__y` tool names), a seeded PRNG + lesson-holdout/dev split
  (Node has no builtin seeded RNG), and the MRR/nDCG@5 formulas.
- **`gen-registry-top1.js`** — deterministic, no model calls. For every `state/registry.json`
  entry whose `name` has exactly one provenance lesson, searches for that name and records
  whether the expected lesson ranks first. Writes `registry-top1.json`.
- **`skill-package/.../scripts/tests/registry-top1.test.js`** — the CI gate: every case recorded
  `passes_today:true` must still rank first. `passes_today:false` cases are known misses,
  reported in the test log, never asserted. Skips (not fails) when `evals/` is absent, since the
  skill ships as a standalone zip of `skill-package/skills/claude-code-internals/`.
- **`gen-questions.js`** — human-triggered only, never run in CI. Calls a model
  (`claude -p --model <model> --output-format json`, stdin ignored, cwd a fresh temp dir so the
  repo's `CLAUDE.md` can't steer it — see the file header for the one thing that doesn't defeat:
  the user's own `~/.claude/CLAUDE.md`) to generate one identifier question and one leak-masked
  plain question per lesson, plus a sample of current-state questions and a batch of negatives.
  Writes `questions-v<N>.json`. Supports `--dry-run` (prints prompts, no calls), `--limit`,
  `--concurrency`, and resumes automatically from a `.partial` checkpoint (refuses to resume one
  whose seed/model/prompt_version/version header doesn't match; a resumed run keeps the
  checkpoint's lesson split). From v2 on, qids carry the version (`v2-id-0001`); v1's bare qids
  are frozen. A plain question that never stops leaking is dropped, but its lesson's identifier
  question is kept.
- **`run.js`** — the scorer. Loads a `questions-vN.json` (latest by default) plus
  `registry-top1.json`, runs every question through `search.js`, reports MRR/nDCG@5 per
  stratum × split, a state-question reachability report, and a negatives score distribution.
  `--save <file>` writes the report (with the thresholds in effect); `--baseline <file>` compares
  against a saved report and exits 1 on a regression. The gate thresholds (`mrr_ndcg_drop`,
  `rank_drop_k`, `top_k_floor`, `identifier_top1_loss`) are read from the baseline's
  `thresholds`; `--mrr-threshold`, `--rank-drop-k` and `--top-k-floor` override one for a run, and
  each value's source is printed. It fails, never passes vacuously, when the questions file has
  no gated questions, its version differs from the baseline's, or a gated stratum × split or
  question in the baseline is missing from the report; and on any identifier question that
  loses top-1.
- **`questions-v1.json`** + **`baseline-v1.json`** — the committed v1 question set and its
  scored baseline, which CI gates on.

## How to (re)generate

```bash
# 1. Regenerate the registry-derived top-1 baseline (deterministic, run any time):
node evals/retrieval/gen-registry-top1.js

# 2. Run its CI-facing test:
node --test skill-package/skills/claude-code-internals/scripts/tests/registry-top1.test.js

# 3. Generate a NEW question set version (human-triggered, calls a model, costs money):
node evals/retrieval/gen-questions.js --version 2   # v1, v2, ... never overwritten

# 4. Score it and save a baseline:
node evals/retrieval/run.js --questions evals/retrieval/questions-v2.json --save evals/retrieval/baseline-v2.json

# 5. On a later change, check for regressions (always name the question set the baseline scored):
node evals/retrieval/run.js --baseline evals/retrieval/baseline-v1.json --questions evals/retrieval/questions-v1.json
```

## Rules

- **Versions are immutable once written.** `gen-questions.js` refuses to overwrite an existing
  `questions-vN.json`. A new generation is a new version, with a new seed if the lesson split
  should change. Old versions are kept for trend, never deleted.
- **Holdout is never used for tuning.** The seeded lesson split reserves ~1/3 of lessons as
  holdout; `run.js` reports holdout scores on every run, but nothing in this suite (or in
  `prepare-lessons.js`, when phase 3 lands) should special-case or optimize against holdout
  results.
- **Failures stay recorded.** A `passes_today:false` case in `registry-top1.json` or a known gap
  in a question set is not silently dropped or "fixed" by regenerating until it passes — that
  would launder a real ranking gap into a green build. Fix the ranking (a `keyword_map`
  addition, under its own gate per the maintainability plan) or leave the miss recorded.
- **Whole-set replacement only.** `questions-vN.json` is replaced as a whole new version on a
  fixed schedule (the plan says yearly or after 50 new lessons) — never edited piecemeal to drop
  an inconvenient question.
- **CI gates on `baseline-v1.json`** (`validate.yml`, `scripts/check-clean.sh`), scoring
  `questions-v1.json` named explicitly, alongside `registry-top1.test.js`.

## Open decisions (flagged, not resolved here)

1. **Leak-trigger scope.** A raw identifier from a code span only triggers leak-rejection if it's
   "identifier-shaped" (contains `_`, a digit, a camelCase boundary, or normalizes to ≥2 tokens);
   a bare single English word in backticks (`` `hooks` ``, `` `fork` ``) is extracted (for
   inventory / future use) but does not block a plain question from using that word normally.
   Slash commands are checked as a literal `/name` substring against the RAW question text, not
   a normalized-phrase containment, since normalizing `/config` collides with the ordinary word
   "config". See `lib.js`'s `isIdentifierShaped()` / `findLeaks()`.
2. **Negatives have no score threshold.** `search.js`'s `rrf_score` is rank-derived
   (`1/(60+rank)` per layer, summed) — a single-layer top-1 hit and a barely-there hit land at
   nearly the same value (~0.016–0.033) regardless of actual relevance. `run.js` reports the
   score/confidence distribution for negatives but does not gate on it. A real threshold would
   need the raw TF-IDF cosine, which `search.js --json` doesn't expose; extending `search.js` was
   out of this task's scope.
3. **State-question scoring is two separate numbers, not one.** `state.js`'s `lookup()` is a
   substring match on an entry's name/id/renamed_to — a generated sentence essentially never
   matches it directly. `run.js` reports (a) whether `search.js`'s top-N for the *generated
   question* includes any provenance lesson of the target registry entry (the metric that
   feeds MRR/nDCG for the `state` stratum), and, entirely separately, (b) whether `state.js
   lookup()` finds the entry by its *own name* (state-layer reachability, independent of any
   generated question). These are reported side by side and never combined.
4. **Split assignment for state and negative questions.** The lesson holdout/dev split is the
   only split defined by the plan. This suite extends it pragmatically: a state question
   inherits the split of its registry entry's *first* provenance lesson; a negative question is
   assigned holdout/dev via the same seeded RNG family (no natural lesson to inherit from).
   Neither is specified by the plan; both are documented here rather than picked silently.
5. **`questions-v1.json` does not exist yet.** This task's constraints (no model calls, no
   `claude` invocations) mean the real generation was never run. Everything downstream (leak
   masking, resumability, the state/negative prompts) is instead proven against a stub model in
   a throwaway `/tmp` harness and a hand-built fixture question file (also `/tmp`, not
   committed) — see the task's final report for what was exercised.
