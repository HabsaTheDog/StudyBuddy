# Adaptive Study Builder vNext — Implementation Charter

Status: proposed and ready for implementation  
Owner: primary Study Buddy implementation agent  
Scope: interactive Study Buddy HTML workflow

This charter is the short, persistent source of truth for the next interactive
Study Builder architecture. Read it before planning or implementing work in the
interactive Moodle-to-HTML pipeline. The detailed behavior lives in
[`product-spec.md`](./product-spec.md), and execution state lives in
[`implementation-plan.md`](./implementation-plan.md).

## North star

Turn an enrolled course into a reliable, course-faithful, adaptive learning
environment that teaches, tests, and simulates the documented assessment while
remaining one responsive, offline HTML file.

The result is not a fixed STEM, language, or business template. Study Buddy
derives the appropriate learning blocks from the actual course structure,
learning objectives, source material, question patterns, and assessment
evidence.

## Goal order

When goals conflict, use this order:

1. Permission safety
2. Factual and answer correctness
3. Course scope and assessment fidelity
4. Learning-objective coverage
5. Consistent, accessible interaction and responsive presentation
6. Runtime, token, and caching efficiency
7. Additional features

Efficiency improvements may remove redundant work, prompts, crawls, or reviews.
They may not weaken required fact checking or source integrity.

## Product invariants

- Preserve the recognizable Moodle course hierarchy and sequence.
- Allow supplementary explanation and practice only inside the established
  course scope.
- Let course and assessment evidence select learning methods; do not map a
  subject label directly to a fixed template.
- Represent each question as a reusable learning object in a validated question
  bank.
- Support original questions, course-derived variants, and newly generated
  in-scope questions.
- Show the origin and scope basis of every question.
- Review generated questions for scope, correctness, answer quality,
  duplication, difficulty, and rendering before publication.
- Use the existing Moodle quiz permission layer. Do not create a shadow
  permission system.
- Never submit a final Moodle quiz attempt.
- Keep the runtime artifact a single, fully offline HTML file.
- Keep learner state intentionally small and local. Do not add accounts, a
  backend, cloud sync, or a detailed attempt-history database.
- Keep the same interaction model usable on desktop, laptop, tablet, and phone.

## Learner-state invariants

Each question has only the state required by the OnePager:

- `seen`: set when the learner opens or answers the question;
- `learned`: explicitly set by the learner;
- `review`: set automatically after an incorrect answer or explicitly by the
  learner;
- `starred`: independent personal marker;
- the last draft or answer when useful for resuming.

`learned` and `review` are mutually exclusive. `starred` is independent. A
correct answer clears `review` but does not automatically claim mastery.
Resetting one question clears its answer, feedback, and all state. Resetting the
guide clears the complete local namespace. No attempt timeline is retained.

## Assessment invariants

- Search course evidence explicitly for assessment sections, order, weighting,
  timing, question types, aids, and instructions.
- Reproduce a documented assessment structure when evidence is sufficient.
- Call an output an **exam simulation** only when its relevant structure is
  adequately supported.
- Otherwise label it an **exercise simulation based on course structure** and
  expose which parts were inferred.
- Do not invent official scoring, rules, durations, or permitted aids.

## Generated-content invariants

- Model knowledge may fill practice gaps within established learning
  objectives.
- Model knowledge may not add a new syllabus objective merely because it is
  adjacent or generally useful.
- Generated content uses `Study Buddy` as its origin, not a fabricated source.
- Its scope basis references the course chapter, objective, and supporting
  evidence separately.
- Existing images are preferred. Extracted, adapted, and generated media must
  declare their origin.

## Deliberate non-goals

The first implementation does not include:

- a user-authored question or flashcard builder;
- spaced-repetition scheduling;
- long-term attempt analytics;
- user accounts or cross-device synchronization;
- a backend database;
- a drag-and-drop study-page editor;
- unrestricted generative technical imagery.

These non-goals may be reconsidered only through an explicit charter change.

## Architecture boundaries

- Moodle and CIS acquisition remains under `src/custom-skills/moodle/`.
- Interactive analysis, composition, rendering, validation, and evals remain
  under `src/custom-skills/web-layout/`.
- Extraction is performed once and persisted. Render and repair stages consume
  the validated handoff instead of crawling again.
- Stable schemas separate source evidence, course/assessment blueprints,
  question-bank content, review results, and rendered learner state.
- Stable prompts and schemas precede dynamic course evidence to improve cache
  reuse.
- Failed or missing individual learning objects are regenerated selectively;
  a valid bank is not rebuilt wholesale.

## Definition of complete

The vNext implementation is complete only when:

- the four benchmark course profiles pass their quality and interaction gates;
- all quiz-permission scenarios pass with zero unauthorized actions;
- every published question has a learning objective, answer or rubric, origin,
  scope basis, difficulty/depth placement, and passing review;
- assessment simulations distinguish explicit evidence from inference;
- question reset, global reset, learned, review, star, filters, and repeated
  attempts work for every supported question type;
- browser validation passes at all required viewports;
- the artifact is non-empty, offline, and has no blocking validation findings;
- before/after runtime, fresh input, cached input, output, retry, and artifact
  size metrics are reported;
- no quality or reliability gate was traded away to obtain an efficiency gain.

