# Adaptive Study Builder vNext — Implementation Plan

Status: cross-course production candidate promoted for MEL, mathematics, dynamics, and Business English; theory/business outside the validated English course remains a contract fixture
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

Status: complete

Deliverables:

- preserve accepted MEL interactive run and metrics as a baseline;
- identify reusable extraction handoffs for MEL and Dynamics;
- add authorized or placeholder fixtures for English and a theory/business
  course without committing credentials or private URLs;
- capture current reliability, quality, wall time, fresh/cached input, output,
  retries, HTML size, and interaction audit.

Gate:

- baseline report is reproducible from persisted runs without new model calls.

Evidence:

- persisted MEL run:
  `study-buddy-data/runs/interactive-mel-optimization-benchmark-final/2026-07-29T13-24-03-467Z`;
- offline replay:
  `output/evals/study-builder-vnext-baseline-mel/report.json`;
- reliability, quality, and efficiency passed;
- 6 topics, 18 exercises, 4 applications, 6 worked examples, 16 sources;
- 115,433 ms wall time, 38,845 fresh input tokens, 39,680 cached input tokens,
  15,899 output tokens, 6 model calls, and 0 retries;
- 872,879-byte artifact.

### WP1 — Shared contracts

Status: complete

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

Status: complete

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

Status: complete

Dependencies: WP1

Deliverables:

- adapter to the existing effective quiz permission;
- action-level permission checks before quiz access;
- structured extraction of authorized visible questions, feedback, patterns,
  and media;
- completed-attempt review only; the Study Builder never starts or continues an
  attempt, including under Quiz Assist;
- content-free permission/action diagnostics;
- fallback when quiz access is disallowed.

Gate:

- every scenario in the benchmark permission matrix passes;
- review-only access reads completed attempts without starting or changing one;
- Quiz Assist configuration does not broaden background Study Builder evidence
  acquisition beyond completed-attempt review;
- no path can submit a final attempt;
- no duplicate broad crawl is introduced.

### WP4 — Adaptive Question Bank

Status: complete

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

Status: complete

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

Status: complete; catalogue redesign browser-validated

Dependencies: WP1, WP4

Deliverables:

- on-demand question rendering from embedded JSON;
- seen, learned, review, and starred controls;
- automatic review after incorrect answers;
- repeated answer evaluation;
- per-question and global reset;
- combinable chapter, course-derived stage, and personal-status filters;
- a visible question index with one on-demand active item;
- no visible unseen category, passive status dashboard, or duplicate route
  cards;
- compact versioned localStorage state.

Gate:

- state transitions match the product spec for every supported question type;
- reload restores only the intended compact state;
- reset removes exactly the intended data;
- no backend, network runtime, or attempt-history tree is introduced.

### WP7 — Assessment composer

Status: complete; separate runtime assessment and correction surfaces browser-validated

Dependencies: WP2, WP4, WP6

Deliverables:

- section construction from Assessment Blueprint;
- objective- and stage-aware item selection;
- documented order, weight, time, and aids where known;
- a separate ephemeral assessment session with section-aware question
  navigation, documented timing where available, answer drafts, Back/Next
  sequencing, a finish action only on the final item, and a finish result;
- a correction sheet that restores each draft beside a complete reviewed
  reference solution, keeps the complete self-assessment collapsed by default,
  exposes quick full/not-fulfilled ratings first when opened, places partial
  points and criteria in a second collapsed detail control, and aggregates only
  documented scoring;
- bounded per-task solution authoring and independent review with task-page
  visual evidence, transparent non-official assumptions, and item-level cache
  reuse;
- clear inferred-simulation labeling.

Gate:

- benchmark fixtures reproduce their different documented section shapes;
- unsupported official rules are never invented;
- the same question bank can serve normal learning and simulation without
  duplicate content.

### WP8 — Media lane

Status: integrated with the existing offline asset pipeline; assessment,
theory, chapter-practice, and ordinary question-bank visuals use a shared
evidence-bound diagram-crop contract

Dependencies: WP1, WP3, WP4

Deliverables:

- authorized extraction and source linkage;
- deduplication, cropping, optimization, and embedding;
- cached assessment visual planning with deterministic per-run recropping;
- bounded PDF source/page ranking plus four-image visual-review batches for
  theory modules and ordinary questions;
- one cached bank-item visual reused by chapter practice and the catalogue;
- deterministic SVG support for suitable diagrams;
- origin labels and validation hooks for future generated media.

Gate:

- required images appear once, remain legible, and do not overflow;
- media access follows the same permission and provenance rules;
- generated technical images are not silently treated as factual originals.

### WP9 — Responsive integration and accessibility

Status: complete

Dependencies: WP6, WP7, WP8

Deliverables:

- coherent desktop and mobile workspace;
- keyboard interaction and accessible state;
- semantic inline mathematics with operator-aware wrapping;
- full control-state browser matrix;
- visual overlap, clipping, table, formula, and media checks.

Gate:

- all required viewports and question states pass deterministic browser
  validation;
- every control remains repeatable after error, success, reset, filter, and
  reload.

### WP10 — Benchmark expansion and promotion decision

Status: complete for MEL promotion and cross-course contract fixtures; live enrolled-course breadth remains opt-in

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
| 2026-07-29 | WP0 | complete | Persisted MEL run replayed into `output/evals/study-builder-vnext-baseline-mel/` without model or Moodle calls |
| 2026-07-29 | WP1–WP7 | complete | Versioned blueprints, stable question bank, compact learner state, assessment composer, review-only completed-quiz adapter, and deterministic renderer implemented |
| 2026-07-29 | WP9 | complete | Chromium matrix passed at 1440, 1024, 768, and 390 px with all 16 learner-state scenarios |
| 2026-07-29 | WP10 | promoted | `output/evals/adaptive-study-builder-vnext-mel-final-posttest/`: all reliability, quality, efficiency, and vNext hard gates passed |
| 2026-07-29 | WP6–WP9 design pass 2 | implemented | Replaced dashboard hero and route cards with a compact orientation and combinable catalogue; widened formula-heavy theory layouts; separated the exam runtime from normal practice |
| 2026-07-29 | WP6–WP10 design pass 2 | promoted | `adaptive-study-builder-vnext-mel-design-pass2/2026-07-29T19-15-00-000Z`: 17 learner/exam scenarios passed at all four viewports; posttest hard gates passed; 654 tests passed, 4 skipped |
| 2026-07-29 | WP6–WP9 three-workspace pass | implemented | Restored a useful visual course header with question totals and a learned-progress ring; separated Themen, Fragenkatalog, and Prüfung into primary tabs; added chapter-local question navigation backed by the same compact state |
| 2026-07-29 | WP6–WP10 three-workspace pass | promoted | `adaptive-study-builder-vnext-mel-three-tabs/2026-07-29T20-03-00-000Z`: 19 learner/navigation/exam scenarios passed at all four viewports; posttest hard gates passed; 655 tests passed, 4 skipped |
| 2026-07-29 | WP3, WP7, WP9 authentic-assessment pass | implemented | Assessment metadata is filtered from the bank and simulation; numbered sample/past-exam tasks become section-bound validated items; documented task counts cap composition; catalogue links return to the primary tab anchor |
| 2026-07-29 | WP3, WP7, WP9–WP10 authentic-assessment pass | promoted | `adaptive-study-builder-vnext-mel-authentic-exam/2026-07-29T22-42-00-000Z`: 21 learner/navigation/authentic-exam scenarios passed at all four viewports; all posttest hard gates passed; 659 tests passed, 4 skipped |
| 2026-07-29 | WP3, WP7, WP9 interactive-correction pass | implemented | Finishing an exam now opens a per-item correction sheet with saved drafts, verified solutions or task-specific rubrics, criterion checklists, quick ratings, bounded points/percent inputs, and a live aggregate result without persistent attempt history |
| 2026-07-29 | WP7–WP10 interactive-correction pass | promoted | `adaptive-study-builder-vnext-mel-exam-scoring/2026-07-29T23-33-00-000Z`: all 23 learner/navigation/exam/correction scenarios passed at four viewports; all posttest hard gates passed; 659 tests passed, 4 skipped |
| 2026-07-30 | WP3, WP5, WP7, WP9 complete-solution pass | implemented | Authentic assessment tasks now require complete independently reviewed solutions; author/review work is split and cached per task; correction keeps user answer and full solution visible, collapses only detailed scoring, and embeds the original task page |
| 2026-07-30 | WP3, WP5, WP7, WP9–WP10 complete-solution pass | promoted | `adaptive-study-builder-vnext-mel-full-solutions/2026-07-29T22-33-18-285Z`: all 24 learner/navigation/exam/solution scenarios passed at four viewports; all posttest hard gates passed; 660 tests passed, 4 skipped |
| 2026-07-30 | WP4, WP7, WP9 assessment-flow correction | implemented | Replaced the persistent finish action with Back/Next sequencing and a final-item-only finish action; removed the publishable missing-solution fallback; added complete reviewed comparison solutions to every reusable bank item; nested detailed scoring beneath a collapsed self-assessment disclosure |
| 2026-07-30 | WP7–WP10 assessment-flow correction | promoted | `adaptive-study-builder-vnext-mel-exam-flow/2026-07-29T23-00-38-555Z`: all 26 learner/navigation/exam/solution scenarios passed at four viewports; all posttest hard gates passed; 660 tests passed, 4 skipped |
| 2026-07-30 | WP7–WP9 readable-math and visual-crop pass | implemented | Replaced raw engineering notation in prose and solutions with semantic MathML, operator-aware line breaking, and responsive solution layout; assessment pages now contribute only diagram crops while the task statement remains HTML |
| 2026-07-30 | WP8–WP10 readable-math and visual-crop pass | promoted | `adaptive-study-builder-vnext-mel-math-visuals/2026-07-30T10-35-00-000Z`: all 28 scenarios and every hard gate passed at four viewports; 665 tests passed, 4 skipped; cached replay used zero model tokens |
| 2026-07-30 | WP8–WP10 general learning-visual pass | promoted | `adaptive-study-builder-vnext-mel-learning-visuals/2026-07-30T12-42-00-000Z`: evidence-bound crops now serve theory, chapter practice, and the shared catalogue bank; all 30 scenarios and every hard gate passed at four viewports; 667 tests passed, 4 skipped; cached replay used zero model tokens |
| 2026-07-30 | WP2, WP7, WP9–WP10 cross-course reliability pass | promoted | Final MEL, MAES2 mathematics, and Dynamics candidates preserve their different course hierarchies, bound inferred assessment sessions, and pass all 32 browser scenarios at four viewports plus every reliability, quality, efficiency, and vNext hard gate |
| 2026-07-30 | WP8–WP10 visual and cache-efficiency pass | promoted | Generic source-type words no longer select unrelated PDFs; extraction figure hints guide bounded page ranking, title/formula-only pages are rejected deterministically, and the Dynamics replay produces a useful diagram crop with zero model calls |

## Promotion evidence

- Final full workflow:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-final/2026-07-29T18-32-00-000Z`
- Final benchmark:
  `output/evals/adaptive-study-builder-vnext-mel-final-posttest/report.json`
- 6 modules, 21 objectives, 38 atomic questions, 4 learning stages, and
  3 evidence-backed assessment sections.
- 100% stable-ID, objective, response-contract, origin, scope-basis, and review
  ratios.
- Repeated unchanged-source run: about 6 seconds, zero model calls, zero fresh
  input tokens, zero retries, and 100% deterministic content-cache reuse.
- Cold content generation remains bounded to six chapter calls. An experimental
  two-chapter batching mode reduced fresh input but regressed latency and hit
  the 90-second reliability boundary, so the production default remains one
  chapter per call.
- Full unit/integration suite: 654 passed, 4 skipped.
- Real Chromium validation suite: 13 passed.

## Design pass 2 evidence

- Canonical MEL rerender:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-design-pass2/2026-07-29T19-15-00-000Z`
- Posttest:
  `output/evals/adaptive-study-builder-vnext-mel-design-pass2-final-posttest/report.json`
- 17 required learner-state, combined-filter, repeat-attempt, reset,
  persistence, and separate-exam scenarios passed at 1440×900, 1024×768,
  768×1024, and 390×844.
- The separate exam audit verifies hidden learning feedback/marking controls,
  draft navigation and restoration, finish result, and catalogue independence.
- Deterministic rerender: 2,978 ms, zero model calls, zero input/output tokens,
  zero retries, and no runtime network requests.

## Three-workspace design evidence

- Canonical MEL rerender:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-three-tabs/2026-07-29T20-03-00-000Z`
- Posttest:
  `output/evals/adaptive-study-builder-vnext-mel-three-tabs-final-posttest/report.json`
- The course header shows 38 questions, 6 topics, 4 learning stages, and one
  learned-progress ring instead of a passive four-card status grid.
- Themen, Fragenkatalog, and Prüfung are distinct tab panels. Topic selection
  updates course theory and chapter-local practice together; the catalogue
  retains combined topic, stage, and personal-status filters.
- 19 learner-state, navigation, filter, persistence, reset, and separate-exam
  scenarios passed at 1440×900, 1024×768, 768×1024, and 390×844.
- Manual screenshots verified the course header, catalogue, assessment
  overview, mobile topic navigation, and live progress-ring update.
- Deterministic rerender: 19,046 ms, zero model calls, zero input/output tokens,
  zero retries, 100% cache reuse, and no runtime network requests.
- Full unit/integration suite: 655 passed, 4 skipped.

## Authentic assessment-task evidence

- Canonical MEL rerender:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-authentic-exam/2026-07-29T22-42-00-000Z`
- Posttest:
  `output/evals/adaptive-study-builder-vnext-mel-authentic-exam-final-posttest-v2/report.json`
- The documented three-part, 60-minute, 100-point sample exam now composes one
  source-backed technical task per documented section: securing-ring sizing,
  a fillet-weld console check, and a preloaded bolted-joint check.
- Questions that merely ask for exam duration, aids, topic lists, task headings,
  material lists, or requested-quantity lists are removed before publication;
  metadata remains available only to the assessment blueprint and interface.
- The primary exam runtime contains exactly the composed section items and
  never expands itself with unrelated assessment-stage leftovers.
- Every “Alle im Fragenkatalog öffnen” action activates the catalogue, applies
  the current topic filter, and aligns the primary tabs directly below the
  sticky header.
- 21 learner-state, filter, navigation, catalogue-anchor, authentic-exam, and
  separate-exam scenarios passed at 1440×900, 1024×768, 768×1024, and 390×844.
- Deterministic rerender: 16,897 ms, zero model calls, zero input/output tokens,
  zero retries, 100% cache reuse, and no runtime network requests.
- Full unit/integration suite: 659 passed, 4 skipped; TypeScript and diff checks
  passed.

## Interactive assessment-correction evidence

- Canonical MEL rerender:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-exam-scoring/2026-07-29T23-33-00-000Z`
- Posttest:
  `output/evals/adaptive-study-builder-vnext-mel-exam-scoring-final-posttest/report.json`
- The finished simulation now retains every saved draft and opens each item's
  solution or evidence-grounded self-check rubric. The MEL source does not
  contain verified final solutions, so the interface discloses that limitation
  instead of synthesizing authoritative answers.
- The three documented sections expose bounded 30, 35, and 35 point inputs.
  Criteria checkboxes and correct/incorrect shortcuts update the same rating;
  the summary recalculates earned points, percentage, open ratings, and the
  documented pass result live.
- Ratings are ephemeral to the exam session. Partial or incorrect ratings add
  the compact `review` marker, full credit clears it, and no rating
  automatically marks an item learned or creates attempt history.
- 23 required scenarios passed at 1440×900, 1024×768, 768×1024, and 390×844,
  including solution visibility and self-assessment scoring. Manual desktop and
  390×844 checks found no horizontal overflow.
- Deterministic rerender: 17,041 ms, zero model calls, zero input/output tokens,
  zero retries, 100% deterministic cache reuse, and no runtime network
  requests.
- Full unit/integration suite: 659 passed, 4 skipped.

## Complete assessment-solution evidence

- Canonical MEL workflow:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-full-solutions/2026-07-29T22-33-18-285Z`
- The three 30/35/35-point sample-assessment tasks each contain an original
  task-page image, a complete reviewed comparison solution, concrete final
  results, disclosed assumptions, and provenance. No scoring rubric substitutes
  for a solution.
- The correction sheet keeps the learner draft and complete solution visible
  together. Only partial points and the concise criteria list are collapsed;
  full/not-fulfilled ratings remain directly available.
- Solution generation is bounded per task. Successful items are cached
  independently, so a failure or repair for one long task does not repeat the
  other solutions or the six cached course chapters.
- All 24 learner, navigation, authentic-assessment, solution-visibility,
  collapsed-detail, scoring, and separate-exam scenarios passed at 1440×900,
  1024×768, 768×1024, and 390×844 with zero runtime network requests.
- Deterministic cached replay: 18,415 ms, zero model calls, zero fresh input
  tokens, zero retries, and 100% cache reuse. The existing-run benchmark in
  `output/evals/adaptive-study-builder-vnext-mel-full-solutions-final-posttest/`
  passed reliability, quality, efficiency, and every vNext hard gate.
- Full unit/integration suite: 660 passed, 4 skipped; the dedicated browser
  validation suite passed all 13 tests.

## Sequential assessment-flow evidence

- Canonical deterministic MEL rerender:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-exam-flow/2026-07-29T23-00-38-555Z`
- Posttest:
  `output/evals/adaptive-study-builder-vnext-mel-exam-flow-final-posttest/`
- The first and intermediate assessment items expose only Back and Next. On
  the final item, Next is replaced by Finish; the validator checks every
  transition rather than only the initial state.
- Every composed item displays the learner answer beside a complete reviewed
  reference solution. The renderer aborts publication if any composed item has
  no complete approved solution, and the former learner-facing missing-solution
  fallback is no longer emitted.
- Self-assessment is collapsed by default with an explicit disclosure arrow.
  Opening it reveals full/not-fulfilled shortcuts; partial points and criteria
  remain in a second collapsed disclosure.
- All 26 required scenarios passed at 1440×900, 1024×768, 768×1024, and
  390×844 with zero blocking issues, runtime network requests, permission
  violations, or quiz submissions.
- Deterministic replay: 18,473 ms, zero model calls, zero fresh input tokens,
  zero retries, and 100% cache reuse. Reliability, quality, efficiency, and
  every vNext hard gate passed.
- Full unit/integration suite: 660 passed, 4 skipped; the dedicated browser
  validation suite passed all 13 tests.

## Readable mathematics and diagram-crop evidence

- Canonical MEL workflow:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-math-visuals/2026-07-30T10-35-00-000Z`
- Existing-run benchmark:
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-mel-math-visuals-2026-07-30/`
- Prose and comparison solutions render engineering variables, Greek symbols,
  subscripts, superscripts, relations, and units as semantic MathML. Long
  calculation chains break at mathematical operators; solution-list items have
  bounded intrinsic width rather than widening the page.
- The assessment visual planner keeps the written prompt as accessible HTML and
  extracts only the indispensable diagram. Deterministic per-run recropping
  preserves drawing labels and dimensions while excluding task prose and page
  chrome; the completed solution cache is reused without preserving stale crop
  geometry.
- All 28 learner, navigation, assessment, solution, crop, and formula-overflow
  scenarios passed at 1440×900, 1024×768, 768×1024, and 390×844 with zero
  blocking issues, runtime network requests, permission violations, or quiz
  submissions.
- Cached workflow: 17,130 ms, zero model calls, zero input/output tokens, zero
  retries, and 100% deterministic cache reuse. Reliability, quality,
  efficiency, and every configured vNext hard gate passed.
- Full unit/integration suite: 665 passed, 4 skipped; TypeScript type checking
  passed.

## General theory and question-bank learning visuals

- Canonical cached MEL workflow:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-learning-visuals/2026-07-30T12-42-00-000Z`
- Existing-run benchmark:
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-mel-learning-visuals-2026-07-30/`
- Authorized PDF sources are matched to stable modules and ordinary bank
  items. Concrete example numbers take precedence over a conflicting generated
  source label, and a lexical relevance gate rejects mismatched task pages.
- Page ranking is deterministic and favors sparse, diagram-bearing lecture
  pages. The visual reviewer sees at most four ordered page images per call,
  matching the client attachment limit; batches run in parallel and cache
  independently.
- Published visuals carry source task, source label, original/adapted origin,
  alt text, and intrinsic dimensions. The same bank item supplies both chapter
  practice and catalogue views. Task statements and theory remain HTML; page
  prose, headings, footers, and decorative images are excluded.
- The MEL result contains three theory visuals and three ordinary-question
  visuals in addition to the assessment crops. All 30 learner, navigation,
  assessment, formula, evidence, and responsive-media scenarios passed at
  1440×900, 1024×768, 768×1024, and 390×844 with zero blocking issues,
  runtime network requests, permission violations, or quiz submissions.
- Optimized cold media review: 41,889 ms, three parallel bounded calls,
  46,306 input tokens of which 9,984 were cached (36,322 fresh), 1,799 output
  tokens, and zero retries. This is 28.4% fewer fresh visual input tokens than
  the initial full-resolution batched measurement.
- Cached workflow: 18,479 ms, zero model calls, zero model tokens, zero retries,
  and 100% visual-plan reuse. The existing-run benchmark passed reliability,
  quality, efficiency, and every configured vNext hard gate.
- Full unit/integration suite: 667 passed, 4 skipped; TypeScript type checking
  passed.

## Cross-course reliability and efficiency evidence

- Final MEL candidate:
  `study-buddy-data/runs/adaptive-study-builder-vnext-mel-final-verified/2026-07-30T17-00-00-000Z`
  with 6 modules, 21 objectives, 36 questions, and 4 learning stages.
- Final MAES2 mathematics candidate:
  `study-buddy-data/runs/adaptive-study-builder-vnext-maes2-final-verified/2026-07-30T16-30-00-000Z`
  with 4 adaptive modules, 24 objectives, 87 questions, and all 11 official
  topic groups visibly retained as ordered subtopics.
- Final Dynamics candidate:
  `study-buddy-data/runs/adaptive-study-builder-vnext-dynamics-production-candidate/2026-07-30T16-40-00-000Z`
  with 5 modules, 23 objectives, 55 questions, and an evidence-matched,
  tightly cropped damper diagram.
- All three candidates passed all 32 deterministic learner, assessment,
  hierarchy, formula, media, and responsive scenarios at 1440×900, 1024×768,
  768×1024, and 390×844. Reliability, quality, efficiency, and every vNext
  hard gate passed in:
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-mel-final-verified-2026-07-30/`,
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-maes2-final-verified-2026-07-30/`,
  and
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-dynamics-production-candidate-2026-07-30/`.
- Deterministic replay took 17.260 seconds for MEL, 18.005 seconds for MAES2,
  and 19.189 seconds for Dynamics. Each used zero model calls, zero model
  tokens, and zero retries.
- Before source-ranking repair, the Dynamics workflow took 193.797 seconds,
  used 96,614 fresh input tokens across 7 model calls, and retried once.
  Generic “slides” matching selected five irrelevant visual candidates and
  produced no usable visual. The corrected useful visual pass needs one
  candidate and one visual call with 13,322 fresh input tokens, 58.4% fewer
  fresh visual tokens than the former 31,992-token visual path.
- Final repository verification: 676 tests passed, 4 skipped; TypeScript type
  checking and whitespace/error diff checks passed.

## Answer-math and cross-course visual-crop hardening

- Final Dynamics candidate:
  `study-buddy-data/runs/adaptive-study-builder-vnext-dynamics-format-visual-fix/2026-07-30T19-40-00-000Z`
  with four evidence-bound module visuals: a polar hodograph, an isolated
  pulley diagram, the complete viscous-damper figure, and a rigid-body motion
  sequence.
- Final MAES2 candidate:
  `study-buddy-data/runs/adaptive-study-builder-vnext-maes2-format-fix/2026-07-30T18-15-00-000Z`.
- Answer-option CSS now targets only the direct A/B/C/D marker. Nested semantic
  MathML remains inline instead of inheriting the fixed square marker layout.
  The browser validator includes the dedicated
  `answer-option-math-readable` hard scenario.
- Learning visuals consume only image assets declared by the validated Moodle
  extraction handoff or matched authorized PDFs. A paired original-plus-preview
  crop review corrects clipped diagrams and removes prose, derivations, task
  statements, and neighboring visual fragments. Review decisions are cached
  independently in two attachment-safe batches.
- The strict Dynamics media review completed in 43.852 seconds with two bounded
  model calls, 27,093 fresh input tokens, 2,009 output tokens, and zero retries.
  Its fully cached replay completed in 20.464 seconds with zero model calls,
  zero model tokens, and zero retries.
- Dynamics and MAES2 each passed all 33 interaction, formula, evidence, media,
  assessment, permission, hierarchy, and responsive scenarios at 1440×900,
  1024×768, 768×1024, and 390×844. Their existing-run benchmarks passed
  reliability, quality, efficiency, and every configured vNext hard gate in:
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-dynamics-format-visual-fix-2026-07-30/`
  and
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-maes2-format-fix-2026-07-30/`.
- Final repository verification: 680 tests passed, 4 skipped; TypeScript type
  checking and whitespace/error diff checks passed.

## Business English production candidate

- Final BMR Business English candidate:
  `study-buddy-data/runs/erstelle-für-meinen-moodle-kurs-englisch-einen-vollständigen-adaptiven-study-bud/2026-07-30T14-28-32-451Z`
  with 6 course-faithful Self-Study/Class modules, 23 objectives, 35 validated
  questions, 4 learning stages, and 3 explicit assessment sections.
- Generic hierarchy recovery now uses the visible Moodle section sequence and
  pairs recognizable preparation/class units without an English-specific
  chapter template. Explicit learning modules remain separate even when every
  section cites the same Moodle course-page source.
- Interactive-artifact intent takes precedence over schedule words and short
  wording in the original request. The exact user request remains available
  for language and audit context while the operational generation prompt is
  passed separately.
- Non-quantitative mixed courses no longer receive fabricated calculations
  from URL parameters, dates, percentages, or ordinary words such as
  “moment”. The final English bank contains 11 selection/understanding and 7
  speaking, writing, meeting, marketing, presentation, or case applications,
  with zero artificial calculation tasks.
- The explicit repeat-exam evidence is reconstructed as PechaKucha
  presentation (60%), oral content questions (30%), and vocabulary test
  (10%). The offline session uses a transparent representative 4/2/1 task
  composition because Moodle gives weights but no official task count.
- All 33 learner, navigation, assessment, hierarchy, formula, evidence, media,
  permission, and responsive scenarios passed at 1440×900, 1024×768,
  768×1024, and 390×844 with zero blocking browser issues, runtime network
  requests, permission violations, or quiz submissions.
- The existing-run benchmark passed reliability, quality, efficiency, and all
  configured vNext hard gates with 6 modules, 23 objectives, 35 questions,
  and 3 assessment sections:
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-business-english-2026-07-30/`.
  Deterministic cached replay took 17.5 seconds with zero fresh input tokens,
  zero model calls, and 100% cache reuse.

## Evidence-driven toolbox and honest assessment delivery modes

- Final Business English workflow:
  `study-buddy-data/runs/erstelle-für-meinen-moodle-kurs-englisch-einen-vollständigen-adaptiven-study-bud/2026-07-30T14-28-32-451Z`.
  The six recognizable Self-Study/Class modules now contain 24 reviewed,
  contextual vocabulary-recall items in addition to 11 selection and 7
  application activities. Generic words and assessment labels are rejected by
  the content quality gate.
- The documented Business English assessment is classified by delivery mode:
  Pecha Kucha presentation and oral content questions remain visible as
  external performances, while the offline session contains only ten
  vocabulary tasks. Presentation preparation remains in the topic route and is
  not represented as four artificial text fields.
- Business English passed reliability, quality, efficiency, all 33 responsive
  browser scenarios, `vnext:evidenceDrivenToolboxSelection`, and
  `vnext:honestAssessmentComposition` in:
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-business-english-flexible-toolbox-2026-07-31/`.
  Its exact cached replay completed in 16.085 seconds with zero model calls,
  zero model tokens, and zero retries.
- A fresh Dynamics generation used the same generic pipeline and selected
  calculation, open-response, understanding, worked-example, and visual
  interpretation blocks without vocabulary. Five chapters were generated in
  three content batches rather than five separate calls; the resulting bank
  contains 49 reviewed items (16 calculation, 25 application, 8 selection) and
  four evidence-matched module visuals.
- Final fresh Dynamics candidate:
  `study-buddy-data/runs/adaptive-study-builder-vnext-cross-course-2026-07-31/dynamics-fresh-final`.
  It passed reliability, quality, efficiency, every vNext hard gate, and all 33
  desktop/laptop/tablet/mobile scenarios with zero failures in:
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-dynamics-fresh-flexible-toolbox-2026-07-31/`.
- Generic weighted assessment extraction is covered by an unseen biology
  example that separates written identification, a laboratory specimen
  demonstration, and case analysis into interactive, external-performance, and
  self-assessed modes. A separate unseen biology profile selects terminology,
  case/application, understanding, and visual blocks without fabricated
  calculations.
- The interaction validator now resets catalogue filters before selecting its
  cross-type retry target and uses real input click events. This removes an
  order-dependent false failure when the first bank item is a calculation or
  open response.

## Dense adaptive vocabulary coverage

- The Business English profile now derives a course-wide vocabulary budget
  from assessment evidence and course breadth. The production candidate has
  60 distinct productive terms across all six recognizable modules, exactly
  10 per module, inside a 78-exercise content bank and a 105-item normalized
  question bank.
- Vocabulary quantity remains generic and evidence-adaptive: a documented
  vocabulary assessment raises the per-module floor, while courses without
  that need retain a smaller terminology allowance. No language-course label
  or fixed English template selects the block.
- Deck rendering is density-aware. Six or fewer cards keep the compact grid;
  seven or more become a scroll-snap carousel with previous/next controls,
  touch and trackpad scrolling, three visible cards on desktop, two on tablet,
  and one readable card on mobile.
- `dense-vocabulary-deck-responsive` is now a hard browser scenario. The final
  artifact passed all 34 learner-state, assessment, permission, hierarchy,
  formula, media, and responsive scenarios at desktop, laptop, tablet, and
  mobile widths with zero failures or runtime network requests.
- Content repair now reloads valid chapter caches first and regenerates only
  chapters named by validation diagnostics. Dense-vocabulary repairs use
  atomic one-chapter batches; a regression test verifies that a four-chapter
  run with one invalid chapter makes exactly one repair model call and
  preserves chapter order.
- The exact cached replay completed in 17.623 seconds with zero model calls,
  zero input or output tokens, zero retries, and full chapter and visual reuse.
  The existing-run benchmark passed reliability, quality, efficiency, and all
  configured vNext hard gates in:
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-business-english-dense-vocabulary-2026-07-31/`.

## Adaptive module-title layout

- Course modules now keep both the complete Moodle title and a concise
  learner-facing `displayTitle`. Fresh content generation is instructed to
  produce a 2–7 word, maximum-64-character navigation label; cached and legacy
  content receives the same deterministic fallback without a model call.
- The chapter-strip component chooses its layout from real content density.
  Short labels remain equal compact tabs; source titles longer than 72
  characters, display labels longer than 42 characters, or more than six
  modules select a 220–270 px scroll-snap rail. Mobile uses a 78vw card with a
  visible next-card edge rather than compressing every module into one row.
- Full Moodle titles remain available in tab metadata and a small topic-level
  disclosure. Sequence context such as `Self-Study A · Class 1` remains visible
  above the concise topic heading, while topic practice and catalogue filters
  reuse the exact same short label.
- Explicit extraction `learning_modules` now take precedence over grouping
  unrelated sections by a shared course-page source. This removed the English
  defect where module A incorrectly listed all six course modules as its own
  subtopics.
- `adaptive-module-title-layout` is a new hard browser scenario. It verifies
  maximum label length, full-title recovery, heading consistency, horizontal
  text fit, and the correct compact/rail choice at 1440×900, 1024×768,
  768×1024, and 390×844. The Business English candidate passed all 35 browser
  scenarios with zero failures and zero runtime network requests.
- The cached production replay completed in 16.451 seconds with zero model
  calls, zero tokens, and zero retries. Reliability, quality, efficiency, and
  all configured vNext gates passed in:
  `study-buddy-data/benchmarks/adaptive-study-builder-vnext-adaptive-module-titles-2026-07-31/`.

## Targeted repair workers and graceful partial publication

- Normal synthesis and repair now use distinct model-policy tasks.
  `content_repair` is a read-only, offline leaf worker that receives only the
  failed chapter/item, compact evidence, and validator feedback;
  `artifact_repair` is a network-disabled workspace worker restricted by its
  prompt to the staged HTML/Typst artifact. Balanced and quality repairs use
  GPT-5.6 Sol, while the normal-path model mix remains unchanged.
- Standardized adaptive guides no longer bypass artifact repair after browser
  failure. Their bounded strategy is now: one known deterministic responsive
  correction, one isolated Sol repair, and one conservative responsive
  fallback, with complete validation after every candidate.
- Validator candidates receive SHA-256 identities and scores. Every candidate
  and report is retained below `.repair/candidates/`; the best candidate is
  preserved, an improved failed candidate becomes the next repair base, and an
  unchanged failed hash terminates blind retries.
- Browser overflow findings now include the viewport, measured page overflow,
  leading DOM selectors, bounding boxes, element/client/scroll widths, and
  relevant computed CSS. Adaptive matrix failures carry the same offender list
  plus clipped controls and short targets.
- PDF extraction still treats permission, course identity, citations,
  contradictions, mathematics, units, and source access as hard gates. After
  three targeted attempts, only a localized depth or representative-
  application gap may be downgraded to transparent `partial` coverage. The
  validated chapter material remains, the unresolved example is omitted, and
  the exact chapter warning is persisted into the extraction handoff so render
  recovery does not rediscover or hide the gap.
- Regression coverage verifies role selection, deterministic-before-model
  routing, in-place artifact repair, hard-versus-degradable extraction
  failures, chapter-preserving partial finalization, and selector-level browser
  overflow diagnostics.
- Repository verification passed with 708 tests, 4 intentional skips, clean
  TypeScript type checking, and clean diff whitespace checks. The persisted
  Dynamics production candidate also passed reliability, quality, efficiency,
  and every vNext hard gate with 5 modules, 20 objectives, 49 bank items, zero
  permission violations, zero runtime network requests, and zero blocking
  browser issues in
  `study-buddy-data/benchmarks/targeted-repair-regression-2026-08-06/`.
