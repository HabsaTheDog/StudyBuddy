# Adaptive Study Builder vNext — Product Specification

Status: implemented and benchmark-promoted for the adaptive Study Builder v2
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
- combine chapter, learning-stage, and personal-status filters in one question
  catalogue;
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
When several source chapters are combined into one adaptive module, every
represented chapter or subtopic remains explicitly enumerated in source order.
The learner must still be able to tell where each course topic belongs.

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
sections from the blueprint. Documented duration, aids, points, section titles,
and topic coverage configure the simulation; they are not themselves learner
questions.

When an authorized sample exam or past paper contains actual tasks, those tasks
are preferred as the assessment items. When only the assessment format is
known, Study Buddy creates reviewed tasks inside established course objectives
that match the evidenced response modes. It must never fill an exam with
questions such as “Which topics are on the exam?”, “How long is the exam?”, or
“Which aids are allowed?”.

Every composed assessment section has an explicit task-selection limit. A
documented count takes precedence; otherwise the inferred exercise simulation
uses a conservative bounded count derived from the available sections. It
never loads the entire bank merely because no official task count is known.

Every assessment section also declares a delivery mode:

- `interactive` for responses the offline page can check reliably, such as
  vocabulary recall, selection, identification, matching, grammar, reading,
  or deterministic calculations;
- `self-assessed` for written analyses, cases, and other responses that can be
  compared with a reviewed answer or rubric;
- `external-performance` for presentations, oral examinations, laboratory
  demonstrations, and other performances the one-page runtime cannot
  authenticate.

External performances remain visible with their documented weight and receive
preparation blocks in the relevant course topics. They are never converted into
fake text-field questions merely to make the simulation look complete. If all
other documented sections reduce to a vocabulary test, the interactive
simulation is a vocabulary test and nothing else.

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
The same course label may therefore produce different block combinations when
its source structure, learning objectives, or assessment evidence differ.
Vocabulary decks are selected when terminology or vocabulary retrieval is an
actual learning need; terms must be productive in course context rather than
generic words, chapter labels, or assessment-format labels.
When assessment evidence establishes a course-wide vocabulary requirement,
coverage is derived across every relevant course module instead of being capped
at a small decorative sample. The target remains evidence-adaptive, but each
represented module must receive enough distinct productive terms to be useful.
Deck presentation adapts independently from content selection: up to six terms
may use the compact grid, while denser decks use a horizontally scrollable,
keyboard-, pointer-, and touch-operable carousel that exposes the total count
and contains overflow within the component at desktop and mobile widths.

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

The question catalogue exposes three independent, combinable filters even when
course-facing labels differ:

- chapter or topic;
- course-derived learning stage;
- personal status: all, continue learning, review, starred, or learned.

`unseen` is not a visible category. An unmarked question is simply unmarked.
Filtering changes the active sequence and catalogue index; it does not duplicate
content or create decorative route cards.

## 8. Learner state and reset behavior

State is stored under a stable course/artifact namespace in `localStorage`.
`seen` remains a compact internal resume signal and is never presented as a
learner-facing category or status card.

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

The automatic Study Builder evidence lane is always read-only: it may inspect
authorized completed attempts, but never starts or continues an attempt, even
when the broader interactive Quiz Assist permission is selected. Starting or
editing an attempt belongs only to a separate, explicitly requested Quiz Assist
workflow.

Before every quiz action:

1. read the effective permission;
2. compare it with the requested action;
3. perform only the allowed action;
4. record the decision and action category without storing credentials;
5. stop or use non-quiz evidence when disallowed.

The test matrix must cover:

- review-only inspection of completed attempts as the minimum access mode;
- Study Builder remains read-only when Quiz Assist is configured;
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
- use internally consistent generated values for a clearly identified
  Study Buddy variant when the values are complete, solvable, and are not
  presented as official course facts.

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

Source matching ignores generic document-type words such as “slides” or
“script” and requires topic, task, or figure evidence. Page ranking may use
figure descriptions from the extraction handoff. Title pages, formula-only
pages, and pages without a relevant learning visual are rejected before visual
review.

When an assessment page, ordinary bank question, chapter exercise, or theory
source contains both written content and an indispensable visual, the written
content remains searchable, responsive HTML. Only the diagram, graph, map,
table, or illustration is embedded as a crop. The crop retains dimensions,
axes, legends, and technical labels, but excludes repeated task prose,
headings, page numbers, and page chrome. It must fit without an internal scroll
viewport. Theory and ordinary-question media use the same stable module or bank
item in every view, so chapter practice and the catalogue never drift into
separate copies.

## 13. OnePager runtime

The final artifact contains:

- offline CSS and JavaScript;
- the Course and Assessment Blueprints as embedded JSON;
- one embedded Question Bank;
- deduplicated optimized assets;
- static course explanation where useful;
- three explicit learner workspaces: course topics, question catalogue, and
  assessment;
- chapter-local practice that reuses the Question Bank and renders the active
  item for the selected course topic;
- one dynamic question catalogue that renders a filtered active item sequence;
- one separate, ephemeral assessment surface with its own navigation, timer
  when documented, answer drafts, and correction phase.

The runtime makes no network request. It renders questions on demand rather than
keeping the complete bank expanded in the DOM. This keeps mobile interaction
responsive while retaining one portable HTML file. The assessment session is
not stored as attempt history and does not replace or mutate the catalogue
selection. Topic practice and the catalogue may display the same bank item, but
they share one compact learner state and keep independent navigation positions.
Inside the assessment session, Back and Next are the only sequential controls.
Next is replaced by Finish only on the final item; an early finish action is not
shown on preceding items.

After finishing, the assessment surface renders a correction sheet for every
composed item. It shows the learner's saved draft directly beside a complete,
reviewed reference answer or solution; the solution is visible by default.
Question-specific criteria and partial-point controls are secondary scoring
details and remain collapsed until requested. If no official answer key exists,
Study Buddy may create a clearly labelled non-official comparison solution
from the task, course evidence, and stable in-scope disciplinary knowledge.
Every handbook value or assumption must be disclosed, independently reviewed,
and the item must be withheld if any requested subtask remains unresolved.
Exact response contracts can be graded automatically. Open responses require
an explicit self-rating. The complete self-assessment area is collapsed by
default. Opening it exposes full/not-fulfilled shortcuts first; partial points,
question-specific criteria, and the bounded points/percentage input remain in
a second nested disclosure. The live summary shows earned points, maximum
documented points, percentage, remaining ratings, and a pass result only when
the underlying threshold is documented. These correction ratings are
session-only; they may set or clear `review`, never retain an attempt timeline,
and never automatically mark an item `learned`.

### Visual hierarchy

- The course header is an orienting course identity with one useful progress
  summary: total questions, topics, learning stages, and a learned-progress
  ring. It contains no passive status-card grid or unseen counter.
- Detailed source limitations live in a disclosure adjacent to the header,
  while the source catalogue remains available at the end.
- Three primary tabs separate topic learning, the complete question catalogue,
  and assessment without duplicating those surfaces.
- Inside the topic workspace, the recognizable chapter strip remains the
  primary course-navigation signature. Selecting a chapter updates its theory,
  examples, and chapter-local questions together.
- Course-faithful source titles and learner-facing navigation titles are
  separate fields. The source title remains recoverable for hierarchy and
  provenance; the navigation title contains the distinguishing concepts in at
  most 64 characters and omits scheduling wrappers such as week, class, or
  part labels. Short title sets use equal compact tabs. Long source titles,
  long navigation labels, or more than six modules switch the same chapter
  strip to a wider horizontally scrollable rail instead of squeezing text into
  narrow cards. The selected module heading, chapter practice heading, and
  catalogue filter use the same navigation title.
- Theory density follows the evidence available for a chapter. Formula-heavy
  chapters receive a wider reference region rather than forcing long notation
  into narrow two-column cards.
- Catalogue filters remain combinable by chapter, learning stage, and personal
  status.

## 14. Accessibility and responsive behavior

Required:

- keyboard-operable controls;
- visible focus and pressed states;
- semantic buttons, form labels, fieldsets, and live feedback;
- minimum touch target of 44 CSS pixels;
- no clipped controls, formula overflow, marker overlap, or hidden feedback;
- no clipped, horizontally overflowing, or silently truncated module labels;
  the validator checks title length, full-title recovery, selected-heading
  consistency, and compact-versus-rail selection at every required viewport;
- semantic inline mathematics preserves subscripts, superscripts, symbols, and
  units; long calculation chains wrap at mathematical operators, and worked
  solution equations receive their own readable line where necessary;
  typographic scripts attach to the correct mathematical atom before fraction
  construction, so sequences, recurrences, and indexed variables remain
  semantically correct rather than merely fitting the viewport;
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
