# Retrieval eval suite

Token-free-in-CI retrieval regression suite for `skill-package/skills/claude-code-internals`'s
search stack (`scripts/search.js` + `scripts/state.js`). It scores retrieval quality against a
committed question set and gates against a saved baseline, so a change to the search stack cannot
silently regress ranking.

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
  stratum × split or question in the baseline is missing from the report; and on any dev
  identifier question that loses top-1. The per-question rules (rank drop, top-k floor,
  found → not found, identifier top-1) gate **dev questions only**: on a holdout question they
  are printed as "holdout per-question change(s), reported, not gated" and never fail. The
  per stratum × split aggregates (MRR, nDCG@5) gate both splits, holdout included. A report records its split as `questions_source.split_sha256`; a
  baseline recorded before that field existed is judged by its questions' own `split` labels, so
  a baseline cut under another split is refused with "lesson split mismatch" rather than compared
  over different question populations.
  With `--baseline`, after the verdict, it prints a **drift report** that never fails: per gated
  stratum × split the MRR and nDCG@5 delta against the baseline and the budget left before
  `mrr_ndcg_drop` trips; every gated question that left or reached rank 1; and the **fragile**
  rank-1 questions, whose acceptable lesson leads the best non-acceptable one by less than
  `FRAGILE_MARGIN` (1.0) keyword-score points (`margin1` on each scored question). The threshold is
  about the 10th percentile of rank-1 leads, and covers three of the four plain top-1 losses that
  corpus growth alone caused in the 2.16120.0 chapter. Fragile dev questions are named; holdout
  ones are only counted, so the list cannot become a to-do list of holdout items. Read it before
  and after a content change: a small budget left or a lesson you are editing on the fragile list
  says the next edit may trip the gate.
- **`resplit.js`** — applies the split rule to a committed question set:
  `node evals/retrieval/resplit.js <questions-vN.json> [--check]`. Deterministic, no model calls;
  recovers the file's random split (holdout plus the lessons already moved), so re-running is a
  no-op, and `--check` exits 1 when the file is out of date.
- **`gen-relevance.js`** — derives a question set with **acceptable-answer sets** from an
  existing one without regenerating questions: `--from questions-v1.json
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
  top 10 (`semantic-search.js` and `search.js`'s own TF-IDF rank), `search.js`'s own top 10
  (its RRF order at the time; keyword-first now) and the source lesson; one `claude -p --safe-mode --tools ""` call per question judges every
  candidate from its title, summary and a bounded excerpt, blind to which one is the source.
  Judge model, prompt version, date, flags and pool rule are recorded in the file's `relevance`
  header, every verdict and reason per question. Human-triggered only; `--dry-run` prints the
  call estimate and one prompt; resumable from a `.partial` checkpoint (only fully parsed
  judgments count as done); refuses to overwrite an existing version. State and negative
  questions are carried over unchanged, except that a state question from a source without
  `split_lesson_id` (questions-v1) gets it once (see below). See the file header for the exact
  rules.
- **`questions-v2.json`** + **`baseline-v5.json`** — the gated pair since the Desktop 2.16120.0
  content change (lessons 219–221). Same questions and thresholds as baseline-v4, no `waivers`;
  `accepted_vs_previous` (vs baseline-v4) accepts pl-0418 (holdout, lesson 212, 1 → 5, lost to a
  vocabulary regeneration) and records the sub-threshold drift it absorbed.
- **`questions-v2.json`** + **`baseline-v4.json`** — the gated pair, until baseline-v5, since
  `search.js`'s default ranking became keyword-first (the keyword layer's results in keyword
  order, then TF-IDF-only results in TF-IDF order). The RRF order and its `--fused` flag have since
  been removed from `search.js`. Same
  thresholds, no `waivers`; `accepted_vs_previous` lists every question that fails
  baseline-v4 against baseline-v3 (qid, stratum, lesson, split, rank before and after, rules
  tripped), the losses accepted with that change. The registry gate's losses from the same
  change are named in `registry-top1-losses.json`.
- **`questions-v2.json`** + **`baseline-v3.json`** — the gated set under RRF fusion, kept as a record
  since baseline-v4 (no longer reproducible: `search.js` has no RRF order now): v1's questions with
  acceptable-answer sets, under the split rule (lessons 88, 129 and 173 moved to dev: see
  `split.moved_to_dev`), and its baseline (same thresholds as v1 and v2, no `waivers`).
  `baseline-v3.json` also records, in `accepted_vs_previous`, the per-question drops against
  `baseline-v2.json` that the maintainer accepted when the weighted keyword ranker
  (`scripts/lib/keyword-match.js`) landed (qid, stratum,
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
  its baseline with its one waiver. Kept for trend, **not gated**. v1 keeps its original
  random split (88, 129 and 173 are holdout there): it is never tuned against, so it is left as
  recorded and still compares with baseline-v1. A question without `relevant` is scored exactly
  as before (the v1 report differs only in `generated_at` and the added
  `questions_source.split_sha256`).

### The agentic eval (v3/v4)

These files compare the search stack with model-driven file lookup (the model reading the routing
index and lesson files with its own tools). None of them is gated in CI.

- **`claude-call.js`**: the one way these scripts call `claude -p`. The prompt goes on stdin from a
  file, and cwd is an empty temp dir. The `--setting-sources project` flag is added by callers, so
  user settings such as an advisor model can't join the call. Each call's cost goes to a ledger
  when `CCI_EVAL_LEDGER` is set, and `CCI_EVAL_BUDGET_USD` refuses new calls once the ledger total
  reaches it.
- **`gen-questions.js` options**:
  - `--split-from <questions file>` copies that file's lesson split instead of deriving one from
    `--seed`. The split rule is re-applied, which is a no-op unless a hard test changed. The source
    is recorded as top-level `split_source`, and `split` keeps the shape `resplit.js --check`
    expects.
  - `--strata` chooses what to generate.
  - `--holdout-per-lesson N` makes N independent calls of the same prompt per holdout lesson.
  - The `terse` stratum is a question of 12 words or fewer, written from the lesson title (plus
    its description when there is one) and never from the lesson text. It is leak-masked like
    plain questions. The prompt was frozen before any output; the file records the prompt version,
    template and sha256 under `generation.terse_prompt`.
- **`questions-v3.json`**: new questions under v2's exact split, from
  `--split-from questions-v2.json --strata identifier,plain,terse,state --holdout-per-lesson 2`.
  No relevance sets.
- **`index-picks.js`** + **`index-picks-v3.json`**: the router experiment's C arm, run offline.
  For each question the model picks 3 lessons from the full routing index. The index and prompt
  are identified by sha256. The picks only widen the judge pool.
- **`gen-relevance.js` options**:
  - `--strata` (an entry may name one split, e.g. `terse:holdout`).
  - `--index-picks` switches to pool-v3: source ∪ state provenance ∪ keyword top 10 ∪ `search.js`
    top 10 ∪ index picks. (The pool layer was named `fused` in files judged under the RRF order.)
  - `--append-judged <qid→ids json>` does append-only judging after an agentic run. It uses the same
    judge; `relevant` stays strict and `relevant_pooled` is added. It is implemented but has not
    been run yet.
  - See the file header for how each stratum is graded.
- **`questions-v4.json`**: v3 judged under pool-v3. See `relevance.judge` for the judge model and
  which strata were judged. Unjudged strata carry no `relevant`, and the scorers below then use the
  source lesson alone.
- **`baseline-search.js`** + **`baseline-v3-search.json`** / **`baseline-v5-search.json`**: keyword-only
  and `search.js`-order any@1/3/5 per stratum × split, with Wilson intervals and per-question top 10s.
  The two committed files carry a `fused` (RRF) arm instead of `search`: they were cut before
  `--fused` was removed.
- **`agentic-run.js`** (+ `agentic-run.test.js`, offline): runs a SKILL body (`arms/arm-*.md`) one
  question per `claude -p` call, against a staged copy of the skill.
  - Tools: Read, Grep, Glob and plain Bash, as the shipped SKILL.md grants. Permission prompts are
    denied rather than asked.
  - It scores the frozen read@ rule (≥50% of a lesson's range or one of its sub-ranges; a Read with
    no limit counts only lessons wholly inside its first 2000 lines; only the first 4 lessons read
    count) and cited@ (the `IDS:` line).
  - It reports Read-limit errors, permission denials, tokens, cost and latency, with Wilson
    intervals.
  - With `--baseline` it adds a paired McNemar comparison against each search arm the baseline
    carries (`keyword`, and `search` — `fused` in older baselines).
  - It also scores **what the model saw**, with `content-score.js` (+ `content-score.test.js`):
    tool-result text is matched to unique corpus lines, so Grep with context, piped or multi-line
    `sed`, `$VAR` paths and `fetch-lesson.js` output all count, whatever the command. Per stratum:
    lesson@ (>= 20 lines of an acceptable lesson in one result), grounded@ (an acceptable lesson both
    cited and seen), lesson|registry@ (or, for a registry-sourced question, its registry entry), and
    an unjudged +any-state-section@, whose state-section-only questions need a correctness judge.
  - `--plugin-bin <plugin>/bin` stages the plugin layout (`skills/<name>` beside `bin/`) and puts
    `bin/` on PATH, as a CLI plugin install does, so a SKILL.md that calls the bundled launcher runs as
    it would for a user. A SKILL.md passed as `--arm-file` has its frontmatter stripped.
  - `--rescore` recomputes the content fields from stored transcripts without model calls; pass the
    `--skill-dir` the run was staged from. Copy the run dir first: the summary is rewritten.
  - Results are cached per question, so a rerun resumes.
- Real-invocation samples are local transcripts. They stay outside the repository.

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
node evals/retrieval/run.js --questions evals/retrieval/questions-v2.json --save evals/retrieval/baseline-v5.json

# 5. On a later change, check for regressions (always name the question set the baseline scored):
node evals/retrieval/run.js --baseline evals/retrieval/baseline-v5.json --questions evals/retrieval/questions-v2.json
# v1, for trend (not gated):
node evals/retrieval/run.js --baseline evals/retrieval/baseline-v1.json --questions evals/retrieval/questions-v1.json

# Agentic eval (model calls; set CCI_EVAL_LEDGER / CCI_EVAL_BUDGET_USD):
node evals/retrieval/gen-questions.js --version 3 --split-from evals/retrieval/questions-v2.json \
  --strata identifier,plain,terse,state --holdout-per-lesson 2
node evals/retrieval/index-picks.js --questions evals/retrieval/questions-v3.json --index <index.txt> \
  --prompt <prompt.txt> --out evals/retrieval/index-picks-v3.json
node evals/retrieval/gen-relevance.js --from evals/retrieval/questions-v3.json --version 4 \
  --strata plain,state --index-picks evals/retrieval/index-picks-v3.json --judge-model claude-sonnet-5
node evals/retrieval/baseline-search.js --questions evals/retrieval/questions-v4.json --out evals/retrieval/baseline-v3-search.json
node evals/retrieval/agentic-run.js --arm-file evals/retrieval/arms/arm-D.md \
  --skill-dir skill-package/skills/claude-code-internals --questions evals/retrieval/questions-v4.json \
  --split dev --strata plain,identifier,terse --baseline evals/retrieval/baseline-v3-search.json --out <run dir>
node --test evals/retrieval/agentic-run.test.js
```

## Rules

- **Versions are immutable once written.** `gen-questions.js` refuses to overwrite an existing
  `questions-vN.json`. A new generation is a new version, with a new seed if the lesson split
  should change. Old versions are kept for trend, never deleted.
- **Holdout is never used for tuning.** The seeded lesson split reserves ~1/3 of lessons as
  holdout; `run.js` reports holdout scores on every run, but nothing in this suite (or in
  `prepare-lessons.js`) should special-case or optimize against holdout results. For the same
  reason no single holdout question can fail the gate: a build that turns red on one holdout
  question invites a fix aimed at that question. Holdout moves only the gated aggregates.
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
  `prepare-lessons.js`, which derives the `keyword_map` keys; keywords are never hand-edited) or
  leave the miss recorded.
- **Vocabulary changes are made by rule, never to pass the gate.** `prepare-lessons.js --generate`
  updates a stale lesson's model-written terms from its previous ones (it keeps every term still
  true, verbatim) and withholds new terms that together would make their lesson first on another
  lesson's **dev** question (`scripts/lib/vocab-collision.js`; holdout questions are never read).
  A gate trip after a regeneration is accepted with a new baseline or fixed by a rule change;
  re-rolling or rewording one lesson's terms until a question ranks again is tuning.
- **Whole-set replacement only.** `questions-vN.json` is replaced as a whole new version on a
  fixed schedule (yearly, or after 50 new lessons) — never edited piecemeal to drop an
  inconvenient question.
- **The gate runs on `baseline-v5.json`**, scoring `questions-v2.json` named explicitly, alongside
  `registry-top1.test.js` and `corpus-ranking.test.js`. `validate.yml` runs the gate in CI;
  `scripts/check-clean.sh` is the local/release-time counterpart, run by `release.js` as its
  consistency-check step. baseline-v4, baseline-v3, baseline-v2 and v1 stay for trend. The pair is named once, as
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
2. **Negatives have no score threshold.** `search.js` returns results for almost any query. `run.js`
   reports, for negatives, the best raw TF-IDF cosine among the results (`tfidf_score` in
   `search.js --json`) and the confidence distribution, but does not gate on either. Baselines cut
   before this change record a rank-derived RRF score there instead.
3. **State-question scoring is two separate numbers, not one.** `state.js`'s `lookup()` is a
   substring match on an entry's name/id/renamed_to — a generated sentence essentially never
   matches it directly. `run.js` reports (a) whether `search.js`'s top-N for the *generated
   question* includes any provenance lesson of the target registry entry (the metric that
   feeds MRR/nDCG for the `state` stratum), and, entirely separately, (b) whether `state.js
   lookup()` finds the entry by its *own name* (state-layer reachability, independent of any
   generated question). These are reported side by side and never combined.
4. **Split assignment for state and negative questions.** The lesson holdout/dev split is the
   only split the suite defines directly. It extends that split pragmatically: a state question
   inherits the split of its registry entry's *first* provenance lesson; a negative question is
   assigned holdout/dev via the same seeded RNG family (no natural lesson to inherit from).
   Neither extension is forced by the split rule; both are documented here rather than picked
   silently.
