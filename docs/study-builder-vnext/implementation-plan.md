# Adaptive Study Builder vNext — Implementation Plan

Status: specification prepared; implementation not started  
Charter: [`implementation-charter.md`](./implementation-charter.md)  
Product specification: [`product-spec.md`](./product-spec.md)  
Benchmark contract: [`benchmark-manifest.json`](./benchmark-manifest.json)

## Working protocol

Before each work package:

1. read the charter and relevant product-spec sections;
2. state the package objective and affected invariants;
3. inspect the current diff and persisted handoffs;
4. define the test or metric that will prove improvement;
5. avoid files owned by another active worker.

After each work package:

1. run its targeted tests;
2. update this plan;
3. record changed files and evidence;
4. record assumptions, risks, and metric changes;
5. run the cheapest relevant replay before a new live crawl.

The primary agent owns shared contracts, integration, end-to-end validation,
benchmark comparison, and the final quality decision.

## Agent lanes

After shared contracts are stable, bounded subagents may work in parallel:

| Lane | Ownership | Must not do |
|---|---|---|
| Course, assessment, permissions | Blueprint analysis, evidence, quiz permission adapter | Modify the renderer or broaden permissions |
| Question bank and review | Coverage, generation, provenance, validators | Crawl sources or modify host UI |
| OnePager and evals | Learner state, pools, exam composition, browser validation | Change Moodle permission semantics |

Subagent task packets must contain only the objective, linked spec sections,
allowed files, expected output, invariants, and test commands. Do not paste the
full conversation or generate large one-off prompts.

Each subagent returns:

- result summary;
- changed files;
- tests and measured evidence;
- assumptions;
- remaining risks;
- charter impacts.

## Work packages

### WP0 — Baseline and fixtures

Status: pending

Deliverables:

- preserve accepted MEL interactive run and metrics as a baseline;
- identify reusable extraction handoffs for MEL and Dynamics;
- add authorized or placeholder fixtures for English and a theory/business
  course without committing credentials or private URLs;
- capture current reliability, quality, wall time, fresh/cached input, output,
  retries, HTML size, and interaction audit.

Gate:

- baseline report is reproducible from persisted runs without new model calls.

### WP1 — Shared contracts

Status: pending

Deliverables:

- schemas and TypeScript types for Course Blueprint, Assessment Blueprint,
  question-bank items, origin, scope basis, learning stages, media, review
  status, and compact learner state;
- schema fixtures for quantitative, language, and theory/case-based courses;
- stable IDs and schema-version behavior.

Gate:

- valid cross-course fixtures parse;
- malformed provenance, assessment evidence, answers, and state fail with useful
  diagnostics;
- no renderer or model prompt duplicates these contracts informally.

### WP2 — Course and Assessment Blueprint

Status: pending

Dependencies: WP1

Deliverables:

- analyzer that reconstructs ordered course structure and objectives;
- explicit search for assessment structure, timing, weighting, aids, and task
  modes;
- evidence levels and uncertainty;
- transparent fallback to course-structure exercise simulation;
- compact persisted handoff.

Gate:

- MEL-style theory/calculation, English vocabulary/writing, and theory/case
  fixtures produce different evidence-driven blueprints without subject-name
  templates;
- original chapter order remains traceable.

### WP3 — Permission-gated quiz evidence

Status: pending

Dependencies: WP1

Deliverables:

- adapter to the existing effective quiz permission;
- action-level permission checks before quiz access;
- structured extraction of authorized visible questions, feedback, patterns,
  and media;
- content-free permission/action diagnostics;
- fallback when quiz access is disallowed.

Gate:

- every scenario in the benchmark permission matrix passes;
- disabled access produces zero quiz open/start calls;
- no path can submit a final attempt;
- no duplicate broad crawl is introduced.

### WP4 — Adaptive Question Bank

Status: pending

Dependencies: WP1, WP2; optionally consumes WP3

Deliverables:

- normalization of authorized originals;
- course-derived variants;
- Study Buddy-generated in-scope practice;
- variable learning stages;
- coverage evaluator and bounded gap-filling;
- deduplication and stable question IDs;
- persisted bank independent of rendering.

Gate:

- every published item has objective, response contract, answer or rubric,
  origin, scope basis, stage, and review status;
- every required objective has a minimum route or an explicit evidence-gap
  finding;
- no fixed per-topic question quota or subject template is present.

### WP5 — Selective review and repair

Status: pending

Dependencies: WP4

Deliverables:

- scope, answer, domain, ambiguity, provenance, diversity, difficulty, and
  rendering checks;
- item-level repair prompts with compact evidence;
- bounded retries and discard behavior;
- metrics for generated, accepted, repaired, rejected, and duplicate items.

Gate:

- invalid items are repaired or removed without regenerating valid items;
- reviewer input contains only needed evidence;
- critical quality failure remains a hard stop.

### WP6 — OnePager learner state and question workspace

Status: pending

Dependencies: WP1, WP4

Deliverables:

- on-demand question rendering from embedded JSON;
- seen, learned, review, and starred controls;
- automatic review after incorrect answers;
- repeated answer evaluation;
- per-question and global reset;
- filters and minimum/depth/assessment sessions;
- compact versioned localStorage state.

Gate:

- state transitions match the product spec for every supported question type;
- reload restores only the intended compact state;
- reset removes exactly the intended data;
- no backend, network runtime, or attempt-history tree is introduced.

### WP7 — Assessment composer

Status: pending

Dependencies: WP2, WP4, WP6

Deliverables:

- section construction from Assessment Blueprint;
- objective- and stage-aware item selection;
- documented order, weight, time, and aids where known;
- section results and overall practice result;
- clear inferred-simulation labeling.

Gate:

- benchmark fixtures reproduce their different documented section shapes;
- unsupported official rules are never invented;
- the same question bank can serve normal learning and simulation without
  duplicate content.

### WP8 — Media lane

Status: pending

Dependencies: WP1, WP3, WP4

Deliverables:

- authorized extraction and source linkage;
- deduplication, cropping, optimization, and embedding;
- deterministic SVG support for suitable diagrams;
- origin labels and validation hooks for future generated media.

Gate:

- required images appear once, remain legible, and do not overflow;
- media access follows the same permission and provenance rules;
- generated technical images are not silently treated as factual originals.

### WP9 — Responsive integration and accessibility

Status: pending

Dependencies: WP6, WP7, WP8

Deliverables:

- coherent desktop and mobile workspace;
- keyboard interaction and accessible state;
- full control-state browser matrix;
- visual overlap, clipping, table, formula, and media checks.

Gate:

- all required viewports and question states pass deterministic browser
  validation;
- every control remains repeatable after error, success, reset, filter, and
  reload.

### WP10 — Benchmark expansion and promotion decision

Status: pending

Dependencies: all prior packages

Deliverables:

- evaluator support for the new manifest gates;
- persisted before/after reports;
- cross-course and permission-matrix results;
- consistency trials for the production candidate;
- metric and quality summary.

Gate:

- all hard quality, permission, and interaction gates pass;
- no reliability regression;
- significant runtime or fresh-input improvement is required before changing
  the production default;
- caching changes are reported separately from fresh input;
- the primary agent explicitly signs off against the charter definition of
  complete.

## Integration order

1. WP0 and WP1 are sequential foundations.
2. After WP1, WP2, WP3, and benchmark-fixture preparation can run in parallel
   with disjoint ownership.
3. WP4 consumes the blueprint and authorized quiz evidence.
4. WP5 validates the bank before UI publication.
5. WP6 and WP7 build normal learning and assessment use of the same bank.
6. WP8 joins only where media is required.
7. WP9 and WP10 are mandatory before promotion.

## Change log

| Date | Package | Status | Evidence |
|---|---|---|---|
| 2026-07-29 | Specification | complete | Charter, product spec, implementation plan, and benchmark manifest created |

