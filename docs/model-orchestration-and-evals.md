# Model orchestration and evaluation

Study Buddy routes each model call through a versioned policy instead of using
one model for the entire document workflow. Source reads and downloads retain
their existing bounded parallelism. The staged document contract remains
strictly ordered: extraction must finish and persist a validated handoff before
rendering starts.

## Profiles

| Profile | Coordinator | Analysis + quiz | Planning | Building | Review | Use when |
|---|---|---|---|---|---|---|
| `fast` | Terra / low | Luna / high → Terra / high | Luna / high → Terra / high | Luna / high → Terra / high | Terra / high → Sol / medium | drafts and latency-sensitive runs |
| `balanced` | Terra / medium | Terra / high → Sol / high | Terra / medium → Sol / medium | Sol / medium → Sol / high | Sol / high → Sol / xhigh | normal study documents |
| `quality` | Sol / high | Sol / high → Sol / xhigh | Sol / high → Sol / xhigh | Sol / high → Sol / xhigh | Sol / high → Sol / xhigh | final or difficult documents |
| `auto` | current balanced policy | current balanced policy | current balanced policy | current balanced policy | current balanced policy | default policy alias |
| `custom` | explicit overrides | explicit overrides | explicit overrides | explicit overrides | explicit overrides | controlled experiments |

Validator retries escalate one tier in model or reasoning effort and use a
role-specific retry timeout sized for the stronger model. Planned source-
acquisition rounds remain on the primary planner policy; they are not retries. Global
`--codex-model` and `--codex-reasoning-effort` overrides remain fixed across
retries so a model-specific experiment stays reproducible.

## First document run

Use the canonical CLI so extraction and rendering use the same model policy:

```bash
npm run moodle:agent -- \
  "Create a study guide for <exact topic>" \
  --url "<direct Moodle course or resource URL>" \
  --format pdf \
  --execution-profile balanced
```

The printed workflow directory contains two stages. A successful run has:

- `extraction/extracted-data.json` and an empty `extraction/error.log`;
- `render/document.typ`, `render/document.pdf`, and an empty `render/error.log`;
- terminal `run-summary.md` files;
- `run-metrics.json` and `run-spans.jsonl` in both stage directories.

The metrics contain model names, reasoning effort, phase/model latency, retry
counts, token totals, prompt/schema character counts, and global model-queue
wait time. They never contain prompt or document content.

## Parallel runs and optional admission limits

Independent Study Buddy runs are unthrottled by default. Each T3 workspace has
its own process and run directory, so PDF and interactive HTML workflows can
continue in parallel while the operating system schedules CPU and memory.

Machines that need a resource ceiling can opt into installation-wide,
filesystem-backed FIFO admission. Set
`STUDY_BUDDY_MODEL_CALL_CONCURRENCY=<positive integer>` to limit concurrent
Moodle model turns, and set
`STUDY_BUDDY_INTERACTIVE_WORKFLOW_CONCURRENCY=<positive integer>` to limit
whole interactive workflows. Unset, `0`, `off`, or `unlimited` disables the
corresponding throttle. Practical limits above two are supported.

When the optional model queue is enabled, queue time does not consume the
Moodle run's execution budget, and the per-model timeout starts only after
admission. This prevents a deliberately throttled run from failing merely
because it waited for a configured slot.

The first model timeout without token usage creates a resumable extraction
checkpoint. The wrapper resumes from the persisted source map, evidence,
chapter handoffs, and pending semantic repairs instead of crawling Moodle
again or continuing through more chapters on an unhealthy model lane.

## Override a model or thinking mode

```bash
npm run moodle:agent -- \
  "Create a study guide for <exact topic>" \
  --url "<direct Moodle URL>" \
  --format pdf \
  --execution-profile custom \
  --codex-model gpt-5.6-terra \
  --codex-reasoning-effort medium
```

`none` is accepted at the CLI boundary and maps to the SDK's `minimal` effort.

## Evaluation corpus

The complete reliability/efficiency method, fixed course corpus, replay
workflow, live-run protocol, regression thresholds, and promotion rule are
documented in [study-buddy-benchmarking.md](./study-buddy-benchmarking.md).
Every benchmark copies an immutable corpus snapshot into `output/evals/`.

Plan an evaluation without contacting Moodle or a model:

```bash
npm run moodle:benchmark -- --case maes2-comprehensive-en
```

Run an ad-hoc comparison against one reproducible direct URL:

```bash
npm run moodle:benchmark -- \
  --execute \
  --prompt "Create a study guide for <exact topic>" \
  --url "<direct Moodle URL>" \
  --profile fast \
  --profile balanced
```

Run all enabled reviewed corpus cases:

```bash
npm run moodle:benchmark -- --execute --profile balanced
```

Cases execute sequentially because each is an official artifact workflow and
the workspace enforces one artifact lease at a time. Parallelism happens inside
each run where source tasks are independent. The report separates reliability
from efficiency and reports fresh input separately from cached input.

## Promotion rule

Do not promote a cheaper or faster profile from one anecdotal run. Require all
reviewed quality checks to pass first, then prefer the lowest wall time and
token volume among passing profiles. Keep `balanced` as the production fallback
until the corpus covers the main document types and course shapes.

## App analytics

With ordinary analytics consent, the T3 client emits content-free terminal turn
and delegated-task metrics: model, provider, reasoning effort, elapsed time,
task count, peak parallelism, status, categorical task type, and token totals.
Prompts, task descriptions, course names, URLs, paths, source data, and document
content are excluded. Terraform in the sibling Study Buddy Server repository
defines the `Model & Orchestration Performance` PostHog dashboard.

Local eval reports remain the quality source of truth; PostHog is for aggregate
operational trends after the deployment's privacy and retention gates pass.
