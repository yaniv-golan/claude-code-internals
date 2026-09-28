# Retrieval eval suite (phase 0b)

Token-free-in-CI retrieval regression suite for `skill-package/skills/claude-code-internals`'s
search stack (`scripts/search.js` + `scripts/state.js`). See
`docs/internal/maintainability-refactor-plan-2026-09-28.md` §4.6(a) and §5 (phase 0b) for the
design this implements.

## Files

- **`lib.js`** — shared helpers, no dependencies: loads topic-index/registry, spawns `search.js`
  (always spawned with `--json --top=N`, so the gate runs the real CLI; its exported `search()`
  is for in-process experiments only), slices lesson text the same way `fetch-lesson.js` does, the identifier extractor
  (published rules: inline code spans, `CAPS_ENV_VARS`, 7–10-digit GrowthBook gate ids, slash
  commands, `tengu_*` names, `mcp__x__y` tool names — implemented in the skill package's
  `scripts/lib/identifiers.js`, shared with `prepare-lessons.js`, and re-exported here
  unchanged), a seeded PRNG + lesson-holdout/dev split
  (Node has no builtin seeded RNG), the split rule (`applyHardTestRule`, see **Rules**), and the
  MRR/nDCG@5 formulas.
- **`gen-registry-top1.js`** — deterministic, no model calls. For every `state/registry.json`
  entry whose `name` has exactly one provenance lesson, searches for that name and records
  whether the expected lesson ranks first, and whether that lesson is dev or holdout in
  `questions-v2.json`'s split (per case `split`, plus the file's `split_sha256`). Writes
  `registry-top1.json`. Regenerating moves the gate's reference point, so the file also records
  what changed against the one it replaced (`changes_vs_previous`: lost and gained cases per
  split, by name): the losses a regeneration absorbs stay written down.
- **`skill-package/.../scripts/tests/registry-top1.test.js`** — the CI gate, judged by
  `registry-gate.js`. The cases are provenance labels, not ground truth, so the gate is net and
  follows `questions-v2.json`'s lesson split: on cases whose expected lesson is a dev lesson, no
  net loss against the recorded `passes_today`, and every lost case must be named in
  `registry-top1-losses.json` (case, lesson it now loses to, reason — the shape of a baseline's
  `waivers`; a stale entry fails). Cases whose lesson is a holdout lesson are printed, never gated
  or waived. It also fails when a case's recorded `split` (or the file's `split_sha256`) is not the
  current split's: after a resplit, regenerate. Skips (not fails) only in the shipped package,
  the standalone zip of `skill-package/skills/claude-code-internals/` (see `tests/repo-context.js`);
  in the repository a missing gate file fails.
- **`gen-questions.js`** — human-triggered only, never run in CI. Calls a model
  (`claude -p --model <model> --output-format json`, stdin ignored, cwd a fresh temp dir so the
  repo's `CLAUDE.md` can't steer it — see the file header for the one thing that doesn't defeat:
  the user's own `~/.claude/CLAUDE.md`) to generate one identifier question and one leak-masked
  plain question per lesson, plus a sample of current-state questions and a batch of negatives.
  Writes `questions-v<N>.json`. Supports `--dry-run` (prints prompts, no calls), `--limit`,
  `--concurrency`, and resumes automatically from a `.partial` checkpoint (refuses to resume one
  whose seed/model/prompt_version/version header doesn't match; a resumed run keeps the
  checkpoint's lesson split). The split it writes follows the split rule. A version it generates from v2 on carries the version in its qids
  (`v3-id-0001`); v1's bare qids are frozen, and questions-v2 (derived from v1 by
  `gen-relevance.js`, not generated) keeps them. A plain question that never stops leaking is dropped, but its lesson's identifier
  question is kept.
- **`run.js`** — the scorer. Loads a `questions-vN.json` (latest by default) plus
  `registry-top1.json`, runs every question through `search.js`, reports MRR/nDCG@5 per
  stratum × split, a state-question reachability report, and a negatives score distribution.
  `--save <file>` writes the report (with the thresholds in effect); `--baseline <file>` compares
  against a saved report and exits 1 on a regression. The gate thresholds (`mrr_ndcg_drop`,
  `rank_drop_k`, `top_k_floor`, `identifier_top1_loss`) are read from the baseline's
  `thresholds`; `--mrr-threshold`, `--rank-drop-k` and `--top-k-floor` override one for a run, and
  each value's source is printed. It fails, never passes vacuously, when the questions file has
  no gated questions, its version or lesson split differs from the baseline's, or a gated
  stratum × split or question in the baseline is missing from the report; and on any identifier
  question that loses top-1. A report records its split as `questions_source.split_sha256`; a
  baseline recorded before that field existed is judged by its questions' own `split` labels, so
  a baseline cut under another split is refused with "lesson split mismatch" rather than compared
  over different question populations.
- **`resplit.js`** — applies the split rule to a committed question set:
  `node evals/retrieval/resplit.js <questions-vN.json> [--check]`. Deterministic, no model calls;
  recovers the file's random split (holdout plus the lessons already moved), so re-running is a
  no-op, and `--check` exits 1 when the file is out of date.
- **`gen-relevance.js`** — derives a question set with **acceptable-answer sets** from an
  existing one without regenerating questions (§4.7b item 5): `--from questions-v1.json
  --version 2`. Same texts, qids, strata and `dropped` list, and the source's random split with
  the split rule applied (so `--from questions-v1.json --version 2` reproduces today's v2 split);
  each identifier and plain
  question gains `relevant: {lessonId: grade}` (2 = the source lesson, always; 1 = another
  acceptable lesson). Identifier questions: a published deterministic rule (the question's
  identifiers that the source lesson also has, per `scripts/lib/identifiers.js`; a lesson is
  acceptable if one of them is homed there as a `keyword_map` key, hand or generated, or it
  mentions it at least as often as the source, counted with `occurrencePositions`, the
  arithmetic `prepare-lessons.js` homes keys with). Plain questions: a one-time model judgment,
  frozen in the file — the candidate pool is the union of the keyword layer's top 10, the TF-IDF
  top 10 (`semantic-search.js` and `search.js`'s own TF-IDF rank), the fused top 10 and the
  source lesson; one `claude -p --safe-mode --tools ""` call per question judges every
  candidate from its title, summary and a bounded excerpt, blind to which one is the source.
  Judge model, prompt version, date, flags and pool rule are recorded in the file's `relevance`
  header, every verdict and reason per question. Human-triggered only; `--dry-run` prints the
  call estimate and one prompt; resumable from a `.partial` checkpoint (only fully parsed
  judgments count as done); refuses to overwrite an existing version. State and negative
  questions are carried over unchanged, except that a state question from a source without
  `split_lesson_id` (questions-v1) gets it once (see below). See the file header for the exact
  rules.
- **`questions-v2.json`** + **`baseline-v3.json`** — the gated set: v1's questions with
  acceptable-answer sets, under the split rule (lessons 88, 129 and 173 moved to dev: see
  `split.moved_to_dev`), and its baseline (same thresholds as v1 and v2, no `waivers`).
  `baseline-v3.json` also records, in `accepted_vs_previous`, the per-question drops against
  `baseline-v2.json` that the maintainer accepted when the phase 3b ranker landed (qid, stratum,
  label before and after the resplit, rank before and after, and which rule each tripped), and
  that a fusion-method change is deferred. `run.js`
  scores a question carrying `relevant` by its first acceptable lesson (MRR, every per-question
  rule, and the identifier top-1 rule, which reads "an acceptable lesson is first") with graded
  nDCG@5 (linear gain = grade), and reports per stratum × split how often the top-1 is the
  source lesson vs another acceptable one (`top1_breakdown`), plus each question's
  `rank_source`. The pool is bounded by the search stack of the commit it was judged at
  (`relevance.search_head`): a lesson no layer ranked in its top 10 then was never judged, so a
  later ranker gets no credit for surfacing it.
- **`baseline-v2.json`** — questions-v2's baseline under the split before the split rule. Kept
  for trend, **not gated**, and no longer comparable to the current questions-v2.json: `run.js`
  refuses it with "lesson split mismatch" (6 gated questions changed label). To score against
  it, use questions-v2.json as committed with it.
- **`questions-v1.json`** + **`baseline-v1.json`** — the v1 set (source lesson only, binary) and
  its baseline with the one phase-3 waiver. Kept for trend, **not gated**. v1 keeps its original
  random split (88, 129 and 173 are holdout there): it is never tuned against, so it is left as
  recorded and still compares with baseline-v1. A question without `relevant` is scored exactly
  as before (the v1 report differs only in `generated_at` and the added
  `questions_source.split_sha256`).

## How to (re)generate

```bash
# 1. Regenerate the registry-derived top-1 baseline (deterministic, run any time):
node evals/retrieval/gen-registry-top1.js

# 2. Run its CI-facing test:
node --test skill-package/skills/claude-code-internals/scripts/tests/registry-top1.test.js

# 3. Generate a NEW question set version (human-triggered, calls a model, costs money):
node evals/retrieval/gen-questions.js --version 3   # never overwrites an existing version

# 3b. Or derive acceptable-answer sets for an existing one (one judge call per plain question):
node evals/retrieval/gen-relevance.js --from evals/retrieval/questions-v1.json --version 2 --dry-run
node evals/retrieval/gen-relevance.js --from evals/retrieval/questions-v1.json --version 2

# 3c. After adding a hard ranking case whose lesson is holdout (corpus-ranking.test.js fails):
node evals/retrieval/resplit.js evals/retrieval/questions-v2.json
node evals/retrieval/gen-registry-top1.js      # the registry cases record the split too
# ...then cut a new baseline (step 4): the old one can no longer be compared.

# 4. Score it and save a baseline:
node evals/retrieval/run.js --questions evals/retrieval/questions-v2.json --save evals/retrieval/baseline-v3.json

# 5. On a later change, check for regressions (always name the question set the baseline scored):
node evals/retrieval/run.js --baseline evals/retrieval/baseline-v3.json --questions evals/retrieval/questions-v2.json
# v1, for trend (not gated):
node evals/retrieval/run.js --baseline evals/retrieval/baseline-v1.json --questions evals/retrieval/questions-v1.json
```

## Rules

- **Versions are immutable once written.** `gen-questions.js` refuses to overwrite an existing
  `questions-vN.json`. A new generation is a new version, with a new seed if the lesson split
  should change. Old versions are kept for trend, never deleted.
- **Holdout is never used for tuning.** The seeded lesson split reserves ~1/3 of lessons as
  holdout; `run.js` reports holdout scores on every run, but nothing in this suite (or in
  `prepare-lessons.js`) should special-case or optimize against holdout results.
- **The split rule: random split, then every lesson a hard ranking test depends on is moved to
  dev.** A test that pins a lesson's rank is tuning. Every such assertion in the skill package's
  test suite is declared in one table,
  `skill-package/skills/claude-code-internals/scripts/tests/ranking-cases.json` (query, lesson id,
  optional `keyword_map` key), and run from it by `corpus-ranking.test.js`, whose one guard fails
  if any case names a holdout lesson; there is no exception list. The eval tooling reads the same
  table (`lib.applyHardTestRule`): `gen-questions.js` and `gen-relevance.js` apply the rule when
  they write a set, and `resplit.js` applies it to a committed one. The file's `split` records
  `rule`, `hard_tests` and `moved_to_dev` (each moved lesson, why, and the queries that assert
  it), so the random split stays recoverable. A resplit keeps `version`, qids, texts and relevance
  sets, relabels the moved lessons' questions, and makes every earlier baseline incomparable, so it
  lands together with a new baseline and a regenerated `registry-top1.json`. Lesson ids here are
  topic-index `id`s (what `search.js --json` reports), not `lesson_number`.
- **A state question's split lesson is recorded, not looked up.** A state question has no lesson
  of its own; it follows its registry entry's first provenance lesson *as of generation*, stored
  on the question as `split_lesson_id` (null: no provenance, dev, never relabelled).
  `gen-questions.js` writes it for every new state question, `gen-relevance.js` fills it once
  for a source written before the field existed, and `lib.relabelQuestions` (so `resplit.js`)
  reads only the field, never `state/registry.json`: deleting, renaming or re-provenancing a
  registry entry cannot move a question between dev and holdout. A state question without the
  field makes relabelling throw. questions-v2's values were recorded after the fact from the
  registry as it then stood, and a test checks they reproduce v1's generation-time labels under
  v1's random split. Adding the field did not touch qids, texts, relevance sets or the split
  (`split_sha256` hashes only the dev/holdout lists), and nothing records a content hash of a
  questions file (`derived_from.sha256` is of the source, questions-v1, which is unchanged), so
  baseline-v3 and `registry-top1.json` still compare.
- **Failures stay recorded.** A `passes_today:false` case in `registry-top1.json` or a known gap
  in a question set is not silently dropped or "fixed" by regenerating until it passes — that
  would launder a real ranking gap into a green build. Fix the ranking (a rule change in
  `prepare-lessons.js`, which derives the `keyword_map` keys, under its own gate per the
  maintainability plan; keywords are never hand-edited) or leave the miss recorded.
- **Whole-set replacement only.** `questions-vN.json` is replaced as a whole new version on a
  fixed schedule (the plan says yearly or after 50 new lessons) — never edited piecemeal to drop
  an inconvenient question.
- **CI gates on `baseline-v3.json`** (`validate.yml`, `scripts/check-clean.sh`), scoring
  `questions-v2.json` named explicitly, alongside `registry-top1.test.js` and
  `corpus-ranking.test.js`. baseline-v2 and v1 stay for trend. The pair is named once, as
  `CURRENT_QUESTIONS` / `CURRENT_BASELINE` in `lib.js`; `gen-registry-top1.js` and the tests
  read those, and `retrieval-gate.test.js` fails unless `validate.yml` and `check-clean.sh`
  name exactly those two files. `check-clean.sh` fails if either is missing.
- **Accepted drops are recorded, not waived.** When the maintainer accepts per-question drops
  against the previous baseline, the new baseline lists them in `accepted_vs_previous` and starts
  with an empty `waivers` list: waivers cover a known regression against the gated baseline, and
  a new baseline has none.
- **qids.** A generated version from v2 on prefixes its qids with the version (`v3-id-0001`);
  a *derived* version (`gen-relevance.js`) holds the same questions and keeps its source's qids.
  `run.js` keys every comparison by version + qid, so they never collide.
- **Acceptable-answer sets are never hand-edited.** They come from the published identifier rule
  or the frozen judgment; a wrong set is fixed by a rule or prompt change cut as a new version.

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
