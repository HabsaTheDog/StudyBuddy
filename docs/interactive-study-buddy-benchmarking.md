# Interactive Study Buddy benchmarking

The interactive benchmark separates three questions:

- **Reliability:** Did the workflow finish with a non-empty, validated, offline HTML file and a passing quality review?
- **Quality:** Does the page preserve course structure, use the standard renderer, and contain the expected number and kind of learning activities?
- **Efficiency:** How long did extraction plus rendering take, how many model calls and retries occurred, how many fresh input tokens were used, and what share of input was cached?

## Plan the cross-course corpus

The included corpus contains disabled templates for a quantitative German course, English literature, and English language learning. Replace each placeholder Moodle URL with a real enrolled course URL before running it.

```bash
npm run web-layout:benchmark
```

This does not access Moodle or call a model. It writes a corpus snapshot and report under `output/evals/`.

## Evaluate an existing run

Pass either the complete interactive workflow directory or its `web-layout/` directory:

```bash
npm run web-layout:benchmark -- \
  --case literature-course-en \
  --evaluate-run "<interactive-workflow-directory>" \
  --out-dir "output/evals/literature-replay"
```

The evaluator reads only persisted artifacts. It combines `run-metrics.json` from extraction, recovery stages, and web rendering, so cached and fresh input tokens are not conflated.

## Measure consistency

Create a replay manifest:

```json
{
  "schemaVersion": 1,
  "runs": [
    { "caseId": "language-course-en", "trial": 1, "runDir": "../../study-buddy-data/runs/example/first" },
    { "caseId": "language-course-en", "trial": 2, "runDir": "../../study-buddy-data/runs/example/second" }
  ]
}
```

Then run:

```bash
npm run web-layout:benchmark -- \
  --runs-manifest "output/evals/language-runs.json" \
  --out-dir "output/evals/language-consistency"
```

The report shows pass rate and the range in topic, exercise, and open-application counts. A reliable optimization should improve efficiency without reducing the reliability or quality pass rate. For cache comparisons, run the same case at least twice with unchanged course evidence and compare `freshInputTokens` and `cacheHitRate`.
