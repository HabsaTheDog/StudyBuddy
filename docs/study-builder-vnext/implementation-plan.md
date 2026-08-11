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

## Ambiguous course-scope reliability guard

Status: deterministic fixes verified; fresh live DYN2 retest pending

- A natural artifact request for a generic subject compound such as
  `Dynamikprüfung` may legitimately match more than one enrolled Moodle course.
- When deterministic target extraction reports that ambiguity, a merely
  medium-confidence model preference no longer starts a full extraction and
  render workflow. The resolver fails closed with the concrete alternatives.
- Generic learning goals such as fundamentals, formulas, derivations, and
  calculation practice are explicitly treated as artifact intent rather than
  course-identity evidence.
- Regression coverage reproduces the observed DYN2/PHDYN mis-selection. The
  live reliability gate is a new Study Buddy thread with one natural,
  course-explicit DYN2 request and no follow-up repair prompt.
- The Study Buddy skill and T3 coordinator instructions now require the exact
  prompt as a non-empty quoted literal and explicitly prohibit unassigned
  prompt-variable expansions. The wrapper rejects empty or whitespace-only
  positional prompts before creating a run directory or acquiring a workflow
  lock.
- The render runtime no longer mistakes a transient 45-second compatibility
  canary cancellation for an incompatible model. The canary now uses low
  reasoning with a 90-second bound, while transient queue/network timeouts fall
  through to the normal bounded model-call recovery policy; deterministic
  compatibility failures remain blocking.
- Parallel study-guide generation now settles every already-started batch before
  returning a validation failure, preserving successful chapter chunks for the
  next graph pass and preventing overlapping orphan calls. The first dedicated
  repair pass starts at the repair policy's primary effort and regenerates only
  the missing or explicitly invalid chapter chunks.
- Balanced chapter repair now uses one Terra-high worker first and reserves
  Sol-medium for a second escalation. This follows repeated live evidence that
  isolated Sol-high/xhigh structured repairs exhausted the 180-second leaf
  window, while retaining Sol as a bounded fallback instead of multiplying it
  across concurrent chapter batches.
- Artifact-builder retry numbering is local to artifact generation instead of
  inheriting extraction/content retries. The first HTML repair therefore starts
  at its bounded primary policy rather than escalating immediately to an
  expensive xhigh worker because an unrelated chapter needed repair earlier.
- The DYN2 tablet failure was reduced to two deterministic renderer defects:
  unbroken underscore-heavy source labels widened the page by 28 px, and a
  named-quantity relation such as `Weg = Geschwindigkeit × Zeit` remained plain
  text. Source cards now break unspaced labels, and the inline-equation scanner
  recognizes one title-cased named quantity immediately before a relation
  without absorbing surrounding instructions. Regression tests cover both
  cases as well as preserving existing function, subscript, and overline math.
- A fresh standalone-app retest exposed a pre-source false negative in `codex
  doctor`: provider HTTP reachability failed while the Responses WebSocket
  handshake was healthy. This check is now advisory and proceeds to the
  authenticated model canary plus the existing bounded model-call recovery.
  Authentication, configuration, runtime provenance, search, sandbox, and
  state-path failures remain terminal. A dedicated runtime regression verifies
  that the transient HTTP failure produces a warning and a verified canary
  instead of an empty workflow.

## Open request-contract architecture

Status: implementation and local regression verification complete on
2026-08-09; fresh Balanced desktop acceptance for DYN2 and Business English
pending

- The exact original user request is evaluated once into a typed,
  integrity-protected `RequestContract`. PDF and HTML extraction, recovery,
  semantic caches, planners, reviewers, renderers, and deterministic rerender
  preserve the prompt and contract hashes or fail closed.
- Removed active fixed `wantsWorkedExamples`/`wantsCalculations` flags,
  per-topic question/example recipes, named DYN/MEL formula and topic
  injections, compact-to-cheat-sheet relabelling, and unconditional
  calculation/application repair instructions.
- PDF source architecture, analyzer repair, semantic review, partial
  publication, formatting, and page review now use explicit owner and repair
  assignments. Universal structural, permission, source, mathematics, Typst,
  and compiled-page gates remain deterministic.
- HTML assessment architecture and learning progression are separate
  request/evidence-driven plans. `documented`, `none`, and
  `inferred_practice` assessment modes remain distinct; task types are not
  inferred from course names or list positions.
- Every published Question Bank item requires an independent content-hash- and
  contract-bound approval record. Assessment solutions and visuals are
  reviewed after final semantic content, and stale/tampered records fail
  closed. Repairs remain item- or chapter-local.
- Presentation repair cannot change learning semantics. Missing assessment
  evidence hides the assessment surface instead of inventing one, and compact
  PDFs may omit examples unless the evaluated request contract requires them.
- The detailed active-path audit and regression matrix are recorded in
  [`open-adaptive-pipeline-audit.md`](./open-adaptive-pipeline-audit.md).
- Final acceptance requires two fresh standalone Study Buddy desktop threads,
  Balanced profile, one natural prompt each, no follow-up repair prompts, and
  terminal validated PDF plus HTML outputs with token/retry/runtime accounting.
- DYN2 desktop round `50f85500-ac33-445f-bbb0-e1b446198c53` exposed a
  request-size failure in the learning-progression planner (98,221 request
  characters). The planner now sends every item as a compact, legend-bound row,
  preserves exact item/hash/objective/type/origin/assessment and answer-contract
  bindings, bounds only verbose semantic prose, and fails explicitly only when
  even the complete minimal bank representation cannot fit. A 48-item large-bank
  regression remains below 50,000 prompt characters.
- DYN2 desktop round `8723b5ae-40ff-42b6-97f9-02a11d6c38a9` then exposed the
  same class of issue one stage earlier: layout planning totalled 61,266
  prompt/schema characters against a 60,000 hard limit. Layout planning now
  reserves budget for the exact original prompt, full RequestContract,
  instructions, repair context, and structured-output schema before taking a
  balanced course-evidence excerpt. Replaying the exact 372,245-character live
  handoff produces 50,293 prompt plus 1,000 schema characters, with both the
  exact prompt and contract intact.
- DYN2 desktop round `fc7bf8cf-99c5-4115-af8a-d90b4f58319a` passed both input
  budgets and persisted all 12 content chapters, then exposed that assessment
  architecture validation shared the outer content retry counter. One chapter
  repair therefore left only two architecture attempts, and the model returned
  first `documented` with no sections and then a section with no question type.
  Assessment planning now owns three local semantic attempts, feeds only its
  exact validation finding back to the next attempt, declares non-empty
  question types in the structured-output schema, ignores unrelated chapter
  repair context, and persists only a fully bound valid plan. Direct regression
  reproduces both malformed responses and succeeds on the third local attempt
  without regenerating any chapter.
- DYN2 desktop round `923f6bd5-c8ec-4432-9552-d130ce7a0527` passed layout,
  12-chapter generation, assessment architecture, the formerly 98k learning
  progression, and visual selection before a later Question Bank review batch
  reached 47,478 characters against the 45,000 reviewer limit. Question review
  now greedily groups at most four complete items by actual prompt size, keeps
  every item's full response contract and reference solution, and allocates only
  the remaining budget to compact topic context and localized source evidence.
  Each distinct batch begins at attempt one; malformed/stale/contract-mismatched
  review output receives up to three item-local attempts, while a substantive
  rejected verdict still routes only the named item to content repair. A large
  eight-item regression proves all items are reviewed, calls remain below the
  model budget, and batch ordinal no longer inflates retry accounting.
- DYN2 desktop round `89ea6a72-c89c-4717-9114-d62c3e7fa1f0` reached the
  independent Question Bank review with the bounded payloads, then exposed two
  fail-closed defects: the reviewer was asked to reproduce trusted contract
  hashes and requirement IDs, and an invalid third response was assigned before
  exact item/hash coverage validation. The app agent and exact official worker
  were stopped before publication. Review models now return only item ID,
  content hash, verdict, checks, and item-local findings; the trusted pipeline
  binds and seals the already verified request/prompt hashes and requirement
  ownership. A candidate becomes publishable only after exact batch coverage
  validation, and three stale responses leave no persisted review-set artifact.
- DYN2 desktop round `69fd5789-6bd0-4d4f-addf-802bde801eba` live-verified the
  bounded reviewer payloads and system-bound review seals across the complete
  bank. Independent review rejected eight concrete items and correctly reused
  seven unaffected chapters while repairing five affected chapters, but the
  rebuilt structural course changed `courseHash`; the previous valid run-local
  assessment plan was then mistaken for foreign-request corruption. Resolution
  now distinguishes bindings: a different contract/prompt or corrupt content/
  semantic-key seal remains a hard failure, while the same contract/prompt with
  changed repaired course/evidence semantics invalidates only the local plan,
  checks the correctly keyed shared cache, and otherwise performs one bounded
  replan before overwriting it. A regression reproduces this exact repair drift.
- The same round exposed telemetry-only retry inflation in learning-visual
  review: independent parallel batch 2 used `attempt=2`. Batch ordinal and
  batch-local retry attempt are now separate; every distinct visual batch starts
  at attempt 1 and only an actual retry of that batch increments the metric.
- DYN2 desktop round `69f34702-8a7e-49a0-b260-f31688d4c904` verified the
  repaired assessment-plan binding, but the interactive workflow then reached
  its 20-minute guard after 42 model calls and 788,762 input tokens. The first
  independent pass reviewed 42 items in 12 fixed four-item calls; semantic
  rejects subsequently regenerated complete chapters and repeated assessment,
  progression, visual, and review work. No artifact was published and the PDF
  branch was not started.
- Question review now greedily packs the complete final prompt instead of using
  a fixed item count, with at most three independent batches in flight and a
  batch-local retry counter. The 46-item regression falls from 12 serial calls
  and 377,037 request/schema characters to 3 calls and 99,504 characters while
  preserving every complete item, reference answer, exact request contract,
  and independent review gate.
- Semantic item rejection no longer becomes a chapter error. A sealed
  contract-/bank-/review-bound disposition removes a rejected item only when
  approved survivors preserve its exact objective, response mode, documented
  assessment slot, and explicit contract coverage. Otherwise exactly that item
  receives a bounded `content_repair` call and only its new hash is reviewed.
  Unchanged item and review hashes remain reusable; assessment-owned items that
  cannot be safely rewritten fail closed. Global phrases and shared source
  labels no longer select unrelated chapters for repair.
- DYN2 desktop round `d89c1d08-0e73-4f5c-b4f5-ca895bfd5ed8` live-verified
  reviewer packing on the real 44-item bank: four bounded review calls replaced
  the previous twelve. The run was stopped before timeout after 19 total calls,
  382,841 input tokens, zero retries, and one prematurely started repair when
  the disposition classified 3 rejects as droppable but 9 as required repairs.
  The root cause was not subject quality: ordinary `inferred_practice` items
  incorrectly made every generated objective × renderer type mandatory, and
  their review records included PDF-only requirements while omitting the
  interactive assignment.
- Question-review requirements are now scoped to the interactive deliverable
  and its content/source/interaction owners while the complete RequestContract
  hash remains the trust binding. Ordinary and inferred-practice items preserve
  objectives without turning a technical renderer type into a user mandate;
  exact response types remain binding for documented assessment slots. The
  real 12-reject shape therefore retains 32 independently approved questions,
  drops all 12 unsupported/meta/unanswerable items, and starts no repair or
  downstream replan.
- Genuine required item repairs are still supported without serial
  amplification: all repairs in one semantic round are greedily packed by the
  complete prompt plus strict schema, at most three batches run concurrently,
  exact item/hash coverage is required before any cache commit, and downstream
  planning runs once after the complete set. A nine-item regression uses two
  calls and 62,157 prompt/schema characters instead of nine calls and 100,384
  characters. Three semantic rounds remain the hard bound.
- Read-only reconstruction of the same live review showed that seven of the
  twelve apparent provenance failures were reviewer false negatives: the
  claims were present in the authorized extraction, but the four packed review
  prompts carried only 683, 761, 623, and 9,832 evidence characters and often
  anchored on the generic resource label `Blöcke`. One further item was
  evidence-backed but bound to only one of several affected objectives; four
  were genuine self-containment or response-contract defects.
- Every generated topic, exercise, retrieval item, and assessment source item
  now carries normalized section/source evidence references and a stable
  evidence hash. Multi-objective items retain all evidenced objectives;
  retrieval items no longer invent generic fallback provenance. Documented
  assessment references resolve only against exact extraction sections and are
  plan-hash sealed; no source item is materialized from a synthetic assessment
  title or array position.
- Question review now builds complete item-local Evidence Capsules by exact
  section index, heading, source IDs, and optional span hash. Batching splits
  before a capsule is truncated, caches and publication records bind the
  capsule/evidence/source-handoff hashes, and missing evidence has the distinct
  `evidence_unavailable` verdict. That verdict triggers one same-ID/hash capsule
  rebuild and re-review, never a content rewrite or deletion; repeated absence
  fails closed with a persisted diagnostic. Meta/extraction-gap and unembedded
  external tasks are excluded through independent reviewer semantics rather
  than subject keywords.
- The full serial Web Layout suite passes with 184 tests and 3 intentional
  skips before disposition scoping and 187 tests with 3 intentional skips
  after it. After Evidence Capsules and updated sealed fixtures, 196 tests pass
  with 3 intentional skips; TypeScript typecheck and diff whitespace checks
  pass. A fresh Balanced desktop acceptance round remains required before this
  architecture can be promoted.
- Fresh Balanced desktop round `d61059b7-6fa1-44a6-a5f0-393cdf6a35e3`
  selected the exact DYN2 course, acquired 10 of 12 selected fach resources,
  and generated all twelve evidence-bounded chapters in nine total model calls
  with zero retries. It then failed closed before publication because chapter
  1 declared three local learning goals but its topic Evidence Capsule used
  aggregate indexes 0 through 5. The failed run is preserved and no PDF branch
  or replacement artifact was started.
- Evidence-reference indexes are now relationally validated while each chapter
  is parsed, including topic, exercise, and retrieval references. Prompts define
  them unambiguously as zero-based indexes into that same topic's local
  `learningGoals` array and forbid aggregate, source, other-topic, and
  other-chapter indexes. The real three-goal/0-through-5 shape now fails with an
  exact field path early enough for bounded chapter-local repair. The complete
  Web Layout suite now passes with 197 tests and 3 intentional skips; global
  TypeScript typecheck and diff whitespace checks pass.
- Bounded desktop iteration 5 removes four publication-path defects without
  relaxing semantic or interaction quality: a repair pass processes every
  actually missing chapter instead of an arbitrary first three; exact source
  IDs referenced by verified extraction sections are restored from the handoff
  registry when a model returns only a source alias; the final page reviewer
  sees the exact request and contract plus bounded validation, canonical
  content, and visible learner HTML while generated CSS and JavaScript are
  omitted; item-local repair can no longer replace orchestrator-owned source or
  Evidence Capsule references. Focused regressions and the global TypeScript
  typecheck pass. A new clean Balanced desktop round is the remaining acceptance
  step; no token, call, chapter, or duration ceiling was introduced.
- Combined DYN2 desktop round `224b887f-1e0a-4c3a-89bb-578e3861d7c3`
  produced and browser-validated the interactive HTML, then exposed a
  cross-deliverable review defect: the HTML reviewer treated the separately
  requested, downstream PDF as if it had to be embedded in the HTML and sent
  the otherwise valid page back through content repair. The HTML quality node
  now receives only the contract deliverables and requirements assigned to the
  interactive artifact, deterministically discards findings explicitly bound
  to another known deliverable, and numbers its own attempts from the local
  quality retry counter. The complete RequestContract hash and exact original
  prompt remain bound; PDF requirements continue to be enforced by the PDF
  workflow rather than weakened or silently accepted by the HTML workflow.
- The canonical end-to-end workflow now resolves requested artifact branches
  from the integrity-verified RequestContract after one shared extraction.
  Interactive HTML and standardized PDF rendering use independent run
  directories and execute concurrently through the generic Study Workflow DAG;
  publication joins only after every required branch succeeds. A resume reuses
  a terminal reviewed branch and runs only the missing or failed sibling.
- The shared workflow executor models modules with stable IDs, dependencies,
  required/optional status, and exclusive resource keys. Independent artifact
  or read-only task modules run in parallel; Moodle/quiz modules that claim the
  same mutable browser or quiz resource are serialized. Failed dependencies
  skip only their downstream modules while unrelated validated work is
  preserved. This is the foundation for course-wide quiz inspection followed
  by PDF/HTML synthesis without coupling quiz logic to either renderer.
- Fresh cross-course desktop round `428d5917-bfd5-4742-9ef5-ca7df44e2870`
  validates that shared extraction can publish both artifacts for MEL1: 42
  independently approved interactive items across 12 topics, four responsive
  browser audits with no failures, and an 11-page standardized PDF whose first
  visual finding was routed only to the formatter and whose final all-page
  review passed without findings.
- The first Business-English matrix round returned valid repairs for only part
  of a multi-item repair batch; the orchestrator discarded the entire response
  and aborted before HTML publication. Item-local repair now retains every
  exact, schema-valid result and retries only omitted identities with the
  existing three-attempt semantic bound. A regression proves a three-item
  response can return two items first and request only the missing third item
  next, without chapter regeneration or loss of the accepted repairs.
- Fresh Business-English desktop round
  `b796e2a7-bea2-447d-a62c-1fd471acd812` verifies that fallback end to end from
  a new natural-language prompt: one extraction, concurrent HTML/PDF branches,
  24 published items with 24 exact approved review records, zero browser audit
  failures at four viewports, and a 10-page PDF with a passed all-page visual
  review. Both canonical artifacts are byte-identical to their published
  deliverables; no worker remains active.

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

## Course-resolution budgeting and stalled-run recovery

Status: implemented and repository-verified on 2026-08-06

- Course evidence selection now derives its usable prompt-body budget from the
  analyzer's actual hard limit after subtracting the fixed leaf-worker boundary
  and JSON schema. Four candidate pages can no longer contribute four
  independent 16,000-character bodies to a 60,000-character request.
- Live probes now collect compact course signatures from titles, section
  headings, and Moodle activity/resource names. The remaining evidence is
  distributed fairly across candidates, capped at 10,000 characters each, and
  cleaned of repeated Moodle navigation chrome.
- A locally rejected budget request receives one 24,000-character compact
  retry with at most 4,000 evidence characters per candidate. Only after that
  bounded retry fails does deterministic scoring run.
- Deterministic fallback weights course identity above body text and requires a
  meaningful winner margin. Tied or weak evidence is persisted as ambiguous
  and fails closed instead of assigning `medium` confidence to any positive
  generic-word overlap.
- Known German course compounds such as `Dynamikprüfung` are recognized while
  retaining ambiguity between DYN2 and PHDYN until course evidence actually
  distinguishes them.
- Moodle and CIS Playwright launches now have an explicit 30-second launch
  timeout, participate in graph cancellation, and close a late browser that
  appears after cancellation.
- A separate OS-process watchdog now monitors run heartbeat and diagnostic file
  modification times. The installed `study_buddy_task.sh` wrapper starts it for
  Moodle, document, and interactive workflows. Six minutes without observable
  progress produces terminal timeout summaries, an explicit retryable
  `error.log`, and `watchdog-error.json` before terminating the complete child
  process group. A 90-minute total-runtime ceiling remains a secondary
  backstop and is configurable through environment variables.
- Regression coverage includes the original four-long-course budget shape, a
  compact budget retry, ambiguous Dynamics fail-closed behavior, German
  compound targeting, browser launch timeout and late cleanup, terminal stale
  status repair, and termination of a real detached process group.
- Repository verification passed with 719 tests, 4 intentional skips, clean
  TypeScript type checking, and clean diff whitespace checks. No live Moodle
  crawl was required for this deterministic reliability change.

## Resource-scope reconciliation and false-coverage recovery

Status: implemented and replay-verified on 2026-08-07

- Duplicate Moodle navigation links can no longer replace an established
  course parent with a later book, feedback, or activity-page parent. Self-
  parent links are removed, course parents outrank activity parents during
  manifest merging, and the bounded post-resolution resource plan restores the
  target-course parent deterministically.
- Coverage treats explicitly selected plan entries as authoritative target-
  course resources. This prevents successfully acquired PDFs from disappearing
  at the publication gate solely because a later snapshot changed their
  immediate page parent.
- The coverage node reconciles persisted evidence IDs and acquired local files
  before assessment, writes the corrected `source-map.json`, and records a
  `coverage-recovery.json` audit containing repaired IDs and explicit zero-
  network/zero-model flags. A remaining impossible `selected acquired > 0` /
  `acquiredResources = 0` state is reported as an internal consistency failure
  rather than the misleading claim that no downloads succeeded.
- Extraction recovery now accepts a persisted false coverage block only when a
  fresh deterministic assessment of the existing manifest and evidence is no
  longer blocked. It resumes at analysis/review with `--max-pages 0`, downloads
  disabled, and no CIS access; the original Moodle acquisition is not repeated.
  Permission, course identity, source access, contradiction, mathematics,
  units, and citation failures remain hard gates.
- The installed `study_buddy_task.sh` wrapper recognizes this narrowly scoped
  coverage failure as resumable. Other source failures still require the
  existing explicit retry policy.
- Regression coverage reproduces a course snapshot followed by a feedback
  snapshot with repeated navigation links, authoritative-plan filtering,
  deterministic coverage-node repair, and persisted extraction recovery
  without a crawler.
- German course compounds such as `Dynamikprüfung` are recognized by the
  publication-coverage gate as exam-scope requests. Missing official exam
  boundaries therefore produce a transparent `partial` warning without
  discarding otherwise validated course material.
- A filesystem-isolated replay of the failed Dynamics extraction
  `2026-08-06T22-02-44-653Z/extraction` rebuilt the manifest and coverage with
  zero Moodle/model calls: all 18 selected PDFs retained the target-course
  parent, coverage changed from `0/52 blocked` to `18/18 partial` only because
  no complete official exam boundary was confirmed, and all 462 evidence
  records remained available.
- Repository verification passed with 724 tests, 4 intentional skips, clean
  TypeScript type checking, valid wrapper shell syntax, clean Markdown links,
  and clean diff whitespace checks.

## Upstream T3 thread isolation fallback

Status: implemented and targeted-test verified on 2026-08-07

- Regular projects now use the stable `CODEX_THREAD_ID` when an upstream T3
  client does not provide the Study-Buddy-specific
  `STUDY_BUDDY_THREAD_ID` alias. Explicit Study Buddy thread IDs retain
  precedence.
- Quick Chats continue to write runs directly below their workspace-local
  `study-buddy-data/runs/` directory and do not inherit the provider thread ID.
- The installed Study Buddy wrapper performs the compatibility mapping before
  invoking the TypeScript pipeline, preventing shared run histories and
  artifact locks between otherwise independent regular-project threads.
- Wrapper shell validation and direct output-root checks pass for regular
  projects and Quick Chat isolation. Keeping the fallback at the wrapper
  boundary avoids reinterpreting unrelated direct Codex CLI/test processes as
  Study Buddy threads.

## Quality-review payload budgeting and recovery

Status: implemented and live-failure regression-tested on 2026-08-07

- The extraction quality reviewer now measures its complete prompt against the
  task-specific body budget before the model call. Large multi-chapter handoffs
  first use the normal review view, then a bounded view, and finally a minimal
  structural view that preserves every chapter title and official topic while
  keeping one representative formula and application per chapter.
- The original live DYN2 handoff produced a 50,231-character reviewer request
  against a 45,000-character hard limit. The new regression fixture is larger
  still and verifies that compaction stays below the effective body budget
  without dropping any of eight chapter titles or official topic labels.
- A terminal `Quality reviewer failed:` extraction with persisted
  `extracted-data.json` is now resumable. Recovery starts at study-model
  normalization and review with zero Moodle pages/downloads rather than
  rebuilding validated chapter handoffs.
- Extraction review always receives the complete structured study-model view.
  It no longer reviews a fixed prefix of a preliminary rendered document,
  which had made trailing DYN2 chapters such as Drallsatz and Schwingungen
  appear absent even though their validated handoffs were present.
- Missing applications in procedural and case-based single-pack chapters now
  trigger the same immediate local repair as quantitative chapters instead of
  failing only after the full chapter pass.
- The installed wrapper recognizes both reviewer execution failures and
  localized semantic-review failures as recoverable and reuses the existing
  extraction directory under its bounded zero-crawl recovery policy.
- Typst formula normalization now preserves executable vector styling such as
  `bold(r)` and Greek subscripts such as `_phi`; regression tests compile the
  result instead of accepting visibly quoted math commands.
- Explicit cheat-sheet, short-list, and compact-note requests use a dedicated
  source-grounded two-column renderer. It keeps every confirmed course chapter,
  topic, formula, assessment focus, and citation while omitting long worked
  examples and duplicated global checklists from the PDF.
- Repository verification passes with 730 tests, 4 intentional skips, clean
  TypeScript type checking, valid wrapper shell syntax, and clean diff
  whitespace checks.

## Combined DYN2 semantic-review fallback

Status: semantic fallback live-verified on 2026-08-08; cross-artifact coverage retry pending

- The first clean Balanced app round used thread
  `4be945a6-d921-4059-a3e1-e59b7cf58d67`. Its interactive DYN2 guide passed
  all validation and browser-interaction checks, while the PDF extraction
  exhausted local repairs for Schwingungen and Massengeometrie before the
  formatter could run.
- Exhausted localized learning-depth gaps now route to the existing transparent
  partial finalizer. Course identity, permission, source integrity, citations,
  contradictions, units, and invalid mathematics remain hard publication
  gates.
- The partial finalizer preserves the validated course hierarchy and
  explanations but removes formulas, worked examples, and quiz questions tied
  to each rejected chapter repair. Its audit records exactly which structured
  items were withheld instead of silently publishing unvalidated mathematics.
- Regression coverage reproduces the live German Schwingungen and
  Massengeometrie findings and verifies that the same path still aborts for
  contradictory mathematics or invalid citations.
- A zero-crawl extraction replay reused the validated handoff, performed three
  model calls with 66,241 input and 6,334 output tokens, and reached terminal
  success without Moodle pages or downloads. The official deterministic render
  then produced a 10-page A4 PDF containing all six DYN2 chapters with empty
  error logs and no model calls.
- Fresh Balanced thread `2345a855-8696-4187-81ec-e0c142f60f7b` produced a
  fully validated interactive guide with ten topic blocks and 30 exercises.
  Its PDF recovered an invalid Schwingungen formula without another Moodle
  crawl and rendered successfully, but independent cross-artifact inspection
  found that Massengeometrie had been omitted from the PDF architecture even
  though Moodle names it as a course topic and the interactive guide includes
  it. The app response therefore was not accepted as the final reliability
  result.
- Named Massengeometrie, mass-moment, and inertia-tensor course resources are
  now classified as an explicit primary topic instead of generic supplementary
  reading. Architecture reconciliation restores every classified primary topic
  even when the bounded initial probe did not select that exact resource and a
  planning model omitted it.
- Regression coverage reproduces the live unselected 890-priority
  `Wiederholung_Massengeometrie` catalog entry and verifies both resource-plan
  classification and deterministic architecture restoration.

## Sparse-source visual recovery and chapter-context validation

Status: implemented and regression-tested on 2026-08-09; clean app round in progress

- PDF extraction now evaluates native text density per page. A multi-page PDF
  with only titles or a few isolated labels is marked partial and
  `visual-required` instead of being accepted because its combined character
  count crosses a small global threshold.
- Rendered page candidates from selected sparse PDFs receive the normal visual
  confidence floor and remain available to chapter analysis. This ensures that
  handwritten derivations and image-based lecture slides are actually attached
  to the model call instead of being discarded before analysis.
- Quantitative application fragments are validated in their accumulated
  chapter context. A central formula in the immediately preceding theory
  fragment satisfies the application gate, avoiding futile retries that asked
  a practice-only fragment to duplicate already validated theory.
- Generated time-polynomial examples must carry dimensionally consistent
  coefficients, and oscillator equations must retain the required second time
  derivative. These checks prevent plausible-looking invented examples and
  first-derivative substitutions from surviving the chapter cache.
- Balanced and Quality acquisition now include every still-available resource
  that the architecture assigns to an essential learning module. The previous
  nine-resource Balanced cap could retain all lecture chapters while dropping
  the final named assessment examples, as happened for Bandbremse and
  physikalisches Pendel; the bounded cap is now 12 for Balanced and 16 for
  Quality.
- Essential modules with cataloged worked examples now receive one
  deterministic representative archetype even when a planning-model response
  lists only lecture sources. The compact-archetype ranking avoids composite
  duplicates and, in the live DYN2 catalog, selects Bandbremse for Drallsatz
  and the physical pendulum for Schwingungen within the existing Balanced
  12-resource expansion cap.
- The interactive content merger normalizes chapter-title source shorthand to
  a concrete source from that chapter before provenance validation. This
  removes a false repair cycle where headings such as `Eigenstudium 1A:
  Punktkinematik` were treated as missing source-register entries, while truly
  unknown source labels still fail validation.
- Visible prose normalization converts un-delimited derivative, vector, Greek,
  summation, and subscript notation into readable Unicode. Explanatory text can
  no longer expose raw strings such as `ddot(x)`, `omega_0`, or
  `dot(bold(L)_O)` even when the structured formula block itself is valid.
- Targeted extraction, visual-selection, analyzer, source-architecture, and
  Typst-inline regression suites pass, and TypeScript type checking is clean.

## Open-source process containment and review integrity

Status: implemented and release-gate verified on 2026-08-10

- Codex SDK clients and runtime preflights receive a minimal allowlisted process
  environment plus a shell policy that inherits no host variables. Portal and
  arbitrary host secrets are excluded while the required Codex home, path, and
  locale remain available.
- The interface provider boundary applies the same denial policy before Codex,
  ACP, PTY, and ordinary child-process creation. Study Buddy portal variables
  cannot be reintroduced through a provider override.
- A model-authored `evidence_unavailable` verdict is rejected as malformed;
  evidence availability remains owned by the deterministic local capsule
  resolver. Regression coverage also proves that an explicit same-item
  re-review bypasses only that item's cache and preserves approved siblings.
- Root release verification passes the complete question-bank and Moodle graph
  suites after the evidence-review regression repair and an explicit integration
  timeout for the I/O-heavy analyzer-retry/Typst graph case.
