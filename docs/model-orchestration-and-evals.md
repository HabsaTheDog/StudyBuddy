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

Use the official wrapper so extraction and rendering use the same model policy:

```bash
/home/alvaroschroll/.agents/skills/study-buddy/scripts/study_buddy_task.sh \
  doc "Create a study guide for <exact topic>" \
  --url "<direct Moodle course or resource URL>" \
  --execution-profile balanced
```

The printed workflow directory contains two stages. A successful run has:

- `extraction/extracted-data.json` and an empty `extraction/error.log`;
- `render/document.typ`, `render/document.pdf`, and an empty `render/error.log`;
- terminal `run-summary.md` files;
- `run-metrics.json` and `run-spans.jsonl` in both stage directories.

The metrics contain model names, reasoning effort, phase/model latency, retry
counts, and token totals. They never contain prompt or document content.

## Override a model or thinking mode

```bash
/home/alvaroschroll/.agents/skills/study-buddy/scripts/study_buddy_task.sh \
  doc "Create a study guide for <exact topic>" \
  --url "<direct Moodle URL>" \
  --execution-profile custom \
  --codex-model gpt-5.6-terra \
  --codex-reasoning-effort medium
```

`none` is accepted at the CLI boundary and maps to the SDK's `minimal` effort.

## Evaluation corpus

The mutable, reviewed corpus is
`src/custom-skills/moodle/evals/corpus/baseline.json`. Increment a case's
`revision` whenever its prompt, URL, tags, or expectations change. Every eval
run copies an immutable corpus snapshot into `output/evals/`.

Plan an evaluation without contacting Moodle or a model:

```bash
npm run moodle:eval -- --profile fast --profile balanced
```

Run an ad-hoc comparison against one reproducible direct URL:

```bash
npm run moodle:eval -- \
  --execute \
  --prompt "Create a study guide for <exact topic>" \
  --url "<direct Moodle URL>" \
  --profile fast \
  --profile balanced
```

Run all enabled reviewed corpus cases:

```bash
npm run moodle:eval -- --execute --profile fast --profile balanced --profile quality
```

Cases execute sequentially because each is an official artifact workflow and
the workspace enforces one artifact lease at a time. Parallelism happens inside
each run where source tasks are independent. The report compares validity,
coverage expectations, required terms, wall time, model time, and token usage.

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
