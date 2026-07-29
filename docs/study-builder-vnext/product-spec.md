# Adaptive Study Builder vNext — Product Specification

Status: proposed and ready for implementation  
Charter: [`implementation-charter.md`](./implementation-charter.md)

## 1. User outcome

A learner opens one generated HTML file and can:

- follow a familiar course structure;
- learn each topic through suitable theory, examples, and activities;
- choose a minimum, standard, deeper, or assessment-focused route where the
  course supports those distinctions;
- answer questions repeatedly;
- mark questions as learned, for review, or personally important;
- reset one question or the complete guide;
- assemble a session from unseen, review, starred, learned, or depth-filtered
  questions;
- practise an assessment structure that reflects documented course evidence;
- see whether a question is original, adapted, or generated.

The page must remain useful without a network connection after generation.

## 2. Course Blueprint

The Course Blueprint is a validated handoff between source acquisition and
learning-content generation. It preserves the source-course hierarchy rather
than allowing the renderer to invent a new taxonomy.

Required concepts:

- course identity and language;
- ordered modules, chapters, and subtopics;
- learning objectives and prerequisites;
- concepts, procedures, formulas, models, terminology, and skills;
- worked examples and existing question patterns;
- source references and coverage;
- explicit exclusions and scope boundaries;
- topic prominence and likely assessment relevance;
- candidate learning stages with course-appropriate labels;
- uncertainty and unresolved evidence conflicts.

Additional explanation may be nested beneath a course topic, but must not
silently replace, merge, or reorder recognizable modules.

## 3. Assessment Blueprint

The Assessment Blueprint is built from explicit assessment information and
traceable inference.

Each section can describe:

- title and order;
- purpose;
- question or task types;
- approximate number of tasks;
- points or weight when documented;
- time allocation when documented;
- allowed aids when documented;
- required response mode;
- covered objectives;
- source references;
- evidence level: `explicit`, `derived`, or `unknown`;
- confidence and unresolved conflicts.

Examples include:

- theory plus calculation sections;
- vocabulary, reading, grammar, and writing sections;
- definitions plus case analysis;
- data interpretation plus extended response.

The composer must not assume a subject-specific assessment shape. It chooses
sections from the blueprint.

### Naming rule

- Use **exam simulation** when the significant structure is supported by
  explicit or strong course evidence.
- Use **exercise simulation based on course structure** when substantial
  structure is inferred.
- Display a concise evidence note and never present inferred official rules as
  fact.

## 4. Learning-object toolbox

The toolbox may contain:

- explanatory theory;
- concise concept summaries;
- worked examples;
- formula or terminology references;
- flashcards;
- single-choice, multiple-choice, and true/false questions;
- matching, ordering, and fill-in activities;
- short answers;
- numeric and multi-step calculations;
- error diagnosis;
- case analysis;
- source, text, table, graph, or diagram interpretation;
- translation, grammar, vocabulary-in-context, and writing prompts;
- open responses assessed with a self-check rubric;
- assessment-section simulations.

The composer selects blocks from demonstrated learning needs and assessment
demands. Course category may be supporting evidence, never the sole selector.

## 5. Question Bank

Every assessable activity is an atomic question-bank item with a stable ID.
The conceptual contract includes:

- `id`
- `topicId`
- `learningObjectiveIds`
- `type`
- `prompt`
- type-specific inputs and response contract
- accepted answer, solution, or rubric
- feedback and common mistakes
- `stageIndex` and course-facing `stageLabel`
- difficulty and estimated effort
- prerequisites
- `origin`
- `scopeBasis`
- source and media references
- review result and schema version

### Origins

- `course_original`: reproduced from an authorized visible course source;
- `course_variant`: adapted from a course question or example;
- `study_buddy_generated`: newly generated within established scope.

Origin and evidence are different. A generated question displays Study Buddy as
its origin while its scope basis points to the relevant objective and course
evidence.

## 6. Adaptive quantity and coverage

Question count is determined by coverage, not a hard per-topic quota.

For every objective, the coverage evaluator asks whether the bank provides the
forms of retrieval and application required to learn and assess it. It accounts
for:

- objective importance and prerequisite role;
- conceptual or procedural complexity;
- number of distinct subskills;
- documented assessment relevance;
- existing question variety;
- common misconceptions;
- redundancy with other questions;
- available evidence and media.

Generation proceeds in bounded rounds:

1. normalize authorized original questions;
2. establish a minimum route across all objectives;
3. add application and depth where the objective requires it;
4. add assessment-like items where supported;
5. review coverage and fill only meaningful gaps;
6. remove or merge redundant items.

The process stops when the coverage gate passes or the evidence is insufficient.
It reports uncovered objectives instead of filling them with unsupported
content.

## 7. Learning stages and sessions

The internal model supports a variable number of ordered stages. The analyzer
may produce two to five stages, with labels appropriate to the course. Common
intent values are:

- minimum;
- foundation;
- application;
- depth;
- assessment.

The UI exposes predictable session entry points even when course-facing labels
differ:

- minimum route;
- continue learning;
- review;
- starred;
- assessment preparation;
- all questions.

Filtering changes the active question sequence; it does not duplicate content.

## 8. Learner state and reset behavior

State is stored under a stable course/artifact namespace in `localStorage`.
Unseen is the absence of state.

Per question:

```json
{
  "seen": true,
  "learned": false,
  "review": true,
  "starred": false,
  "draft": "optional last response"
}
```

Behavior:

- opening or answering sets `seen`;
- an incorrect evaluation sets `review` and clears `learned`;
- a correct evaluation clears `review` but does not set `learned`;
- explicitly setting `learned` clears `review`;
- explicitly setting `review` clears `learned`;
- `starred` remains independent;
- reset question removes its response, feedback, and state entry;
- reset all removes the guide's local namespace after confirmation;
- no attempt timeline is retained.

Every question card provides consistent controls for learned, review, star, and
reset. Controls must work after any number of attempts and after reload.

## 9. Moodle quiz permissions

The implementation consumes the existing permission state exposed by Study
Buddy settings and the chat hotbar. It does not infer or broaden permission.

Before every quiz action:

1. read the effective permission;
2. compare it with the requested action;
3. perform only the allowed action;
4. record the decision and action category without storing credentials;
5. stop or use non-quiz evidence when disallowed.

The test matrix must cover:

- quiz access disabled;
- read-only inspection where supported;
- existing Quiz Assist behavior;
- attempted escalation beyond the active permission;
- final submission prevention.

Completed attempts, feedback, images, or question patterns may be used only when
visible under the active authorized session and permission.

## 10. Generated knowledge

Study Buddy may use model knowledge to create explanations and questions when
course evidence establishes the objective but contains too little practice.

It may:

- create easier prerequisite checks for an in-scope objective;
- create parallel examples with safe values;
- create additional applications and misconceptions;
- vary response formats;
- generate assessment-like practice without copying unsupported official
  grading rules.

It may not:

- add adjacent syllabus content without evidence;
- invent official exam structure, values, rules, or standards;
- add unverified numerical constants, legal rules, or factual claims;
- describe generated content as a Moodle original.

## 11. Review pipeline

Each generated or transformed item passes:

1. schema validation;
2. scope and objective validation;
3. answer or rubric validation;
4. source and origin validation;
5. domain checks, including calculations and units when applicable;
6. ambiguity and solvability review;
7. duplication and diversity review;
8. stage/difficulty review;
9. rendering and accessibility validation.

Repairs receive only the failed item, compact evidence, and validator feedback.
A valid bank is not regenerated because one item failed. Retry limits remain
bounded.

## 12. Media

Media priority:

1. use an existing authorized course asset;
2. crop or optimize it without changing meaning;
3. produce a deterministic HTML/CSS/SVG diagram where appropriate;
4. optionally generate a new image in a future media lane.

Assets are deduplicated and embedded once. Each item records whether media is
original, adapted, or generated. Generated technical media requires a
validation method for the relationships it communicates.

## 13. OnePager runtime

The final artifact contains:

- offline CSS and JavaScript;
- the Course and Assessment Blueprints as embedded JSON;
- one embedded Question Bank;
- deduplicated optimized assets;
- static course explanation where useful;
- one dynamic learning workspace that renders the active item sequence.

The runtime makes no network request. It renders questions on demand rather than
keeping the complete bank expanded in the DOM. This keeps mobile interaction
responsive while retaining one portable HTML file.

## 14. Accessibility and responsive behavior

Required:

- keyboard-operable controls;
- visible focus and pressed states;
- semantic buttons, form labels, fieldsets, and live feedback;
- minimum touch target of 44 CSS pixels;
- no clipped controls, formula overflow, marker overlap, or hidden feedback;
- usable layouts at 1440×900, 1024×768, 768×1024, and 390×844;
- reduced-motion support;
- understandable state independent of color.

## 15. Deferred capabilities

Not part of the first implementation:

- user-authored question types;
- a flashcard editor;
- scheduled spaced repetition;
- long-term analytics;
- accounts and synchronization;
- a generic drag-and-drop builder;
- unrestricted AI image generation.

The contracts should permit future media origins and new question renderers
without placing these features in the first delivery.

