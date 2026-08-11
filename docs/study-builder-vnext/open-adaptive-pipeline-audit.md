# Open/adaptive pipeline audit

Stand: 2026-08-09. Scope: active production paths under
`src/custom-skills/moodle/`, `src/custom-skills/web-layout/`, their persisted
handoffs, recovery paths, publication gates, and deterministic rerender path.

Status: implementation and regression verification complete; fresh standalone
Study Buddy desktop acceptance for DYN2 and Business English remains pending.

## Required architecture

The original request is an immutable input. A dedicated evaluator converts it
into a typed `RequestContract` containing deliverables, explicit requirements,
optional or not-required elements, forbidden elements, and owner assignments.
The contract is persisted with a SHA-256 integrity record and remains bound to
the exact original prompt through extraction, recovery, content generation,
review, rendering, and deterministic rerender.

Semantic decisions belong to model-evaluated plans and independent reviewers:

- the source architect decides which authorized evidence represents the course;
- the content owner creates course-faithful learning objects;
- the assessment planner preserves documented, absent, or inferred-practice
  structure without subject-name templates;
- the progression planner assigns course-facing stages from the request,
  evidence, objectives, and final bank items;
- the question reviewer approves every item independently and binds approval to
  the exact item content, request, contract, and assigned requirements;
- visual and presentation reviewers receive only their assigned contract scope.

Deterministic code is limited to measurable integrity and safety properties:
schema validity, hashes, IDs, source provenance, mathematical executability,
permission boundaries, retry/size/time bounds, compiled-PDF structure, page
geometry, offline behavior, accessibility, responsive layout, and publication
state. It does not decide that a named subject must contain a particular topic,
question type, example count, or document recipe.

## Resolved findings

### Request contract and recovery

- PDF extraction writes canonical `request-contract.json` and integrity data.
  Recovery and render verify and preserve the exact hash; missing or altered
  contracts fail closed instead of receiving a default interpretation.
- HTML state carries the typed contract. Semantic content, assessment solution,
  learning-visual, progression, and item-review caches include the contract and
  original-prompt identity.
- The deterministic HTML rerender consumes the persisted reviewed Course
  Blueprint, Assessment Blueprint, Question Bank, assessment plan, progression
  plan, and item reviews. It no longer reconstructs semantics through the old
  `buildAdaptiveStudyModel` fallback.

### PDF pipeline

- Removed MEL/DYN topic recipes, H7/k6/Roloff injections, per-topic example
  quotas, `wantsWorkedExamples`/`wantsCalculations`, and deterministic rewriting
  of technical content.
- A compact request controls layout density only. It no longer relabels every
  compact PDF as a cheat sheet or silently makes examples mandatory.
- Analyzer repair receives the exact prompt, localized finding, owner-scoped
  requirements, and explicit `notRequired`/`forbidden` elements. It does not
  inject a mathematical application or numeric worked example by default.
- Partial publication consumes typed owner and repair-target tags. Correctness,
  source, citation, mathematics, permission, and explicit-must failures remain
  blocking; optional omissions can be disclosed without suppressing unrelated
  validated chapters.
- The post-render gate validates the compiled PDF, bounding boxes, every
  rendered page, blank pages, edge contact, tiny text, and duplicate boxes. An
  independent visual review can return page-local formatter repairs. Only that
  typed formatter failure retries the formatter; it never recrawls Moodle.

### Interactive HTML pipeline

- Assessment architecture is model-planned from the exact request, verified
  contract, structural Course Blueprint, and evidence. It preserves
  `documented`, `none`, and `inferred_practice`; absence of assessment evidence
  no longer creates a fake exam tab.
- Evidence-backed calculation and open-response tasks retain their declared
  response contract. Oral presentations, essays, cases, and laboratory work are
  not converted into calculations or fake text-field exams.
- Assessment solution prompts apply the governing-relation/value/unit recipe
  only to an exact declared calculation. Other tasks receive an appropriate
  complete model answer or rubric without quantitative leakage.
- Learning progression is independently planned and bound to exact item hashes.
  Type and list position no longer impose Foundation/Application/Depth stages.
- Every question starts pending. Approval requires a matching independent
  review record, stable item ID, recomputed content hash, exact prompt/contract
  hashes, all checks passing, no blocking finding, and a verified record ID.
  Changed items are reviewed again and local findings repair only the affected
  chapter.
- The assessment composer uses documented counts when present and otherwise
  consumes evaluator-authored response types and objective gaps. It does not
  impose a subject quota, a 12-item cap, or duration/weight-based suppression.
- Final visual crop coordinates are those approved by the visual review; the
  renderer no longer expands or shifts crops afterward.
- The semantic visual owner routes back to content repair. Presentation-only
  model repair is forbidden from adding, deleting, or rewriting learning
  content, sources, answers, IDs, or assessment rules.

### Source architecture

- The deterministic fallback is structurally neutral (`mixed`) and does not
  infer calculation, case, vocabulary, or procedure needs from titles or
  subject labels. Assessment signals require explicit source roles.
- Wide courses are not semantically merged into slash-labelled umbrella
  modules. Bounded truncation produces an audit manifest with every omitted
  module and URL, and blocks publication whenever essential or explicit-must
  coverage would be lost.

## Regression evidence

The targeted matrix covers:

1. calculation, oral/external performance, essay/open response, vocabulary,
   case, and laboratory task contracts;
2. contract and original-prompt cache isolation, including visual prohibitions;
3. theory-only and compact documents without invented example obligations;
4. typed partial-publication versus hard correctness/source failures;
5. non-quantitative localized repair without calculation instructions;
6. renderer contract propagation and presentation-only repair boundaries;
7. same-sized banks with different request/evidence-driven progression plans;
8. stale item, plan, prompt, contract, and content hashes failing closed;
9. compiled PDF page geometry plus independent page-local visual review;
10. static guards against named-course recipes and reintroduction of fixed
    example/question intent flags in active generic pipeline files.

The repository-wide typecheck and full test suite are the final local gate.
The release gate additionally requires two fresh `Balanced` First-Try rounds in
the standalone Study Buddy desktop app: the exact DYN2 request and an English
cross-discipline request. Both requested artifacts, terminal summaries, empty
error logs, attachment publication, token totals, retries, and app-agent
completion must be verified before this work is called complete.

## Deliberately retained technical bounds

Retry limits, model payload budgets, concurrency, module/page/image bounds,
viewport matrices, minimum executable answer fields, and finite UI stage counts
remain. They protect reliability or make one selected interaction executable;
they do not prescribe course content. Course aliases used only for Moodle/CIS
resolution and source-retrieval ranking are likewise not output templates.

`standardStudyGuideRenderer.ts`, `practiceCorpusContent.ts`, and the old
fragment-quality helpers remain legacy/test compatibility code with no active
production caller in the adaptive publication path. Static architecture tests
guard the active path; removing those legacy modules is a separate cleanup and
is not used as evidence for the desktop acceptance result.
