# Study Buddy — Devpost project story

## Inspiration

University information is fragmented. Course material lives in Moodle, schedules and administrative details live in other student portals, calendar feeds contain another part of the picture, and students still need to turn all of it into something they can actually learn from. I built Study Buddy because I wanted one learning companion that could guide a student through that environment instead of making the student manually search every system before they could begin studying.

Study Buddy began before OpenAI Build Week as a personal project and a framework for safe Moodle assistance. During Build Week I meaningfully extended it into a much more complete student-facing product: a T3-based local interface, source-grounded PDF and interactive study-guide workflows, GPT-5.6 task routing, quality review, resumable extraction, multilingual artifacts, safer quiz and assignment assistance, and clearer installation and diagnostics.

## What it does

Study Buddy guides students through their classes and student portals. It can locate courses and activities, answer where information can be found, retrieve schedules and administrative details, explain course topics, and transform authorized course sources into structured PDF or offline interactive HTML study guides.

It is designed to be honest about its evidence. A missing result from one portal is not treated as proof that the information does not exist. The workflow records source coverage, uses the appropriate fallback, and distinguishes source-backed statements from incomplete or inferred material.

Study Buddy also supports carefully bounded quiz and assignment workflows. It can help inspect and prepare work, but important actions require visible confirmation and final Moodle quiz submission is blocked by policy.

Students run Study Buddy locally using their own Codex access. Planned usage analytics are consent-based and designed to exclude prompts, course names, URLs, paths, source material, and generated document content; the production tracking setup is not yet complete.

## How I built it

The product combines an MIT-licensed T3 Code fork for the local interface with a canonical TypeScript runtime organized as LangGraph workflows. Moodle, CIS, and calendar acquisition feed a validated evidence package. Task-specific GPT-5.6 models then plan the artifact, analyze source material, build the learning experience, and review quality. A deterministic validation layer produces either a Typst PDF or a self-contained offline HTML learning page.

I used Codex as my primary engineering collaborator. Codex helped inspect the existing architecture, plan bounded improvements, implement and refactor the graphs, write regression tests, diagnose live portal behavior, improve security boundaries, and evaluate generated learning artifacts. I made the product decisions: local-first operation, source transparency, student-centered structure, explicit coverage reporting, conservative quiz behavior, and one canonical runtime rather than duplicated scraping logic.

GPT-5.6 is part of the running product, not only the development process. Study Buddy routes different responsibilities across GPT-5.6 Luna, Terra, and Sol policies, with stronger-model escalation for validation failures and difficult artifact work. This lets fast extraction and planning coexist with deeper building and review while keeping each run observable.

## Challenges I ran into

The hardest part was not simply scraping Moodle. The real challenge was producing a trustworthy learning artifact from inconsistent authenticated sources while respecting time limits, partial coverage, model capacity, user privacy, and the difference between harmless reading and consequential actions.

Long artifact runs exposed model timeouts and unfair concurrency. I added a shared model-call scheduler and resumable extraction checkpoints so a failed model lane does not force another broad Moodle crawl. PDF generation also required strict handoffs and validation because syntactically plausible Typst can still produce a poor study document. Interactive pages introduced another quality dimension: they had to work offline, remain self-contained, avoid network leakage, and teach rather than merely decorate the source material.

Integrating the canonical runtime into a large existing T3 Code application without creating a second implementation required careful ownership boundaries and a large amount of automated testing.

## Accomplishments that I am proud of

- A real, non-trivial LangGraph system that connects authenticated university sources to validated learning artifacts.
- Task-specific GPT-5.6 routing for coordination, analysis, planning, building, and review.
- Source coverage reporting and fallback behavior that avoids confident answers from incomplete searches.
- Both polished Typst PDFs and portable offline interactive HTML learning guides.
- Resumable extraction and fair model-call admission for long-running workflows.
- Safety policies around quiz and assignment actions, including blocked final quiz submission.
- A broad automated test suite covering the canonical runtime and the T3 application integration.
- English and German artifact generation while preserving the language of the student's original request.

## What I learned

I learned that an education agent needs a different quality bar from a generic chat assistant. It is not enough for an answer to sound right: the system must know which sources it covered, expose uncertainty, preserve the student's requested topic and language, and turn information into an effective learning sequence.

I also learned how valuable Codex becomes when it is treated as an engineering collaborator rather than a one-shot code generator. The most productive sessions combined repository inspection, explicit product constraints, implementation, tests, and artifact evaluation. Codex accelerated the work dramatically, but the quality came from maintaining a clear product direction and rejecting changes that weakened source fidelity or student safety.

## What's next for Study Buddy

Study Buddy is designed for Linux, macOS, and Windows, and automated CI covers Ubuntu Linux, macOS, and native Windows. The current build has only been tested manually end to end on Fedora Linux. Before the planned September 2026 student alpha, I want to complete manual validation on Ubuntu, native Windows, and macOS, finish platform-specific setup and packaging, complete the opt-in content-free tracking setup, clean up the remaining rough edges, and add a safe synthetic demo environment. From there, I want to support more institutions and expand the evaluation corpus across more subjects and learning styles.

The long-term goal is a free, open-source companion that students can run with whatever Codex plan fits them, while keeping their academic data under their control.
