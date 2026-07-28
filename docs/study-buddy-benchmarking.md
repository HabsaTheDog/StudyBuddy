# Study Buddy benchmarking

The benchmark answers two separate questions:

1. Is the document reliable enough to ship?
2. Did the workflow produce it within an explicit time and token budget?

A profile is recommended only when every repeated run passes both groups. This
keeps fact checking and quality review as hard gates while making orchestration
bloat visible.

## Fixed corpus

`src/custom-skills/moodle/evals/corpus/baseline.json` contains three enabled
cross-course cases plus one opt-in German MAES2 structure regression:

- `maes2-comprehensive-en`
- `maes2-comprehensive-de` (opt-in)
- `mel1-core-de`
- `dyn2-methods-de`

Every case fixes the original prompt, output language, direct Moodle course URL,
minimum content coverage, required terms, and efficiency budgets. Increment the
case `revision` whenever any of those inputs changes. Every report contains an
immutable corpus snapshot and hash.

The deterministic reliability gates check:

- terminal extraction and render stages with empty error logs;
- non-empty standardized Typst and PDF artifacts;
- a successful quality review with no blocking findings;
- minimum topic, formula, worked-example, and source counts;
- required and forbidden terms;
- valid source references on every evidence-bearing topic, formula, and example.

These gates are course-aware rather than STEM-only. A case may require one or
more `requiredContentModes` (`conceptual`, `procedural`, `case_based`,
`quantitative`, or `mixed`), lock `requiredLanguage`, and set both minimum and
maximum formula/example counts. A literature or language course can therefore
fail for invented mathematics just as an engineering course can fail for
missing calculations.

## Portability corpus for unseen courses

`src/custom-skills/moodle/evals/corpus/portability.json` contains opt-in
templates for literature, language learning, and social science. They are
disabled because a benchmark must use a course the student is actually enrolled
in; public placeholder URLs would not test authenticated Moodle behavior.

To benchmark a new institution or discipline:

1. Copy `portability.json` to a local file.
2. Replace one placeholder `moodleUrl` with the direct enrolled-course URL.
3. Add course-specific `requiredTerms`, keep the forbidden institution branding,
   and set that case to `"enabled": true`.
4. Plan the run without network/model calls:

```bash
npm run moodle:benchmark -- \
  --corpus "<local-portability-corpus.json>" \
  --case unseen-literature-en
```

5. Execute controlled trials:

```bash
npm run moodle:benchmark -- \
  --corpus "<local-portability-corpus.json>" \
  --execute \
  --case unseen-literature-en \
  --profile balanced \
  --repeat 3 \
  --original-user-prompt "<exact latest user message>"
```

The Moodle hostname does not need to contain `moodle`. Standard course,
activity, and `pluginfile.php` paths are resolved relative to the configured
installation. Low-confidence course discovery is a terminal reliability
failure; use the visible course title/code or direct URL instead of allowing a
guess.

The efficiency gates check:

- end-to-end wall time and model time;
- fresh input tokens, separate from cached input;
- model calls and retries;
- tool calls by leaf workers and policy violations;
- maximum input amplification;
- selected resources and repeated resource attempts.

`billableProxy` is deliberately `fresh input + output`. Cached input is reported
separately and is not added a second time. Reasoning tokens remain diagnostic
because they may already be represented in output usage. This is a comparative
efficiency measure for subscription-based Codex runs, not an invoice estimate.

## Cheap workflow: plan and replay

Inspect the selected test without contacting Moodle or a model:

```bash
npm run moodle:benchmark -- --case maes2-comprehensive-en
```

Score an existing staged workflow against the fixed case. This is an offline
replay and consumes no new model tokens:

```bash
npm run moodle:benchmark -- \
  --evaluate-run "<workflow-directory>" \
  --case maes2-comprehensive-en
```

To replay several stored workflows, create a local manifest. Relative paths are
resolved from the manifest file:

```json
{
  "schemaVersion": 1,
  "runs": [
    {
      "caseId": "maes2-comprehensive-en",
      "profile": "balanced",
      "trial": 1,
      "workflowDir": "../runs/maes2-balanced-1"
    }
  ]
}
```

```bash
npm run moodle:benchmark -- --runs-manifest "<manifest.json>"
```

Use replay after every orchestration or prompt change. It catches scoring and
artifact regressions at essentially zero marginal cost, but it cannot prove
that a changed prompt or model policy performs better. That requires controlled
live runs.

## Controlled live workflow

Run one balanced smoke test:

```bash
npm run moodle:benchmark -- \
  --execute \
  --case maes2-comprehensive-en \
  --profile balanced \
  --original-user-prompt "<exact latest user message>"
```

Compare two profiles with three trials each:

```bash
npm run moodle:benchmark -- \
  --execute \
  --case maes2-comprehensive-en \
  --profile fast \
  --profile balanced \
  --repeat 3 \
  --original-user-prompt "<exact latest user message>"
```

Trials are sequential and profile order rotates between trials to reduce
cold-cache ordering bias. For a weekly breadth check, run all three enabled cases
once with `balanced`:

```bash
npm run moodle:benchmark -- --execute --profile balanced
```

Do not start with all profiles, all courses, and three repetitions. First use
one representative case to reject bad candidates cheaply. Run the broader suite
only for a candidate that passes.

## Before/after regression check

Keep the `report.json` from the accepted version, then compare a new run:

```bash
npm run moodle:benchmark -- \
  --runs-manifest "<new-runs.json>" \
  --baseline-report "<accepted-report.json>"
```

The report flags a regression when reliability pass rate drops or median wall
time/fresh input grows by more than 15 percent for the same case and profile.

Promotion criteria:

- 100 percent reliability across at least three trials of the representative
  case;
- no failed quality or source-integrity gate;
- no efficiency-budget violation;
- no reliability drop on the three-course breadth run;
- at least 15 percent lower median wall time or fresh input tokens before
  changing the production default.

Keep `balanced` as fallback until the candidate meets those criteria. A single
fast document is evidence for a hypothesis, not enough evidence for promotion.

## Reading the diagnostic table

The per-task table attributes calls, retries, model time, fresh/cached input,
maximum request size, and maximum input amplification to tasks such as
`artifact_planner`, `content_analyzer`, and `quality_reviewer`.

Useful interpretations:

- High request characters: the task payload itself is too large; compact source
  excerpts or split the task.
- Small request plus high input amplification: inherited agent instructions,
  history, skills, or repeated context dominate the prompt.
- High fresh input with low cache hit: stable prompt prefixes are changing or
  large dynamic content appears too early.
- High retry count: validator feedback, schema mismatch, or model choice is the
  main cost.
- Wall time close to model time: crawling is not the bottleneck.
- Many resource attempts with little useful coverage: source selection or
  download deduplication is the bottleneck.

Fact checking should be optimized by giving the reviewer a compact evidence
index and only the claims it must verify. Removing the review gate is not a
valid benchmark improvement.
