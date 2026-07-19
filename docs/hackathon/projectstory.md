## Inspiration

When I started university, I was already deeply excited about AI agents and building with new technology. I always had side projects running—including a Willhaben scraper, other automation experiments, and projects for earlier OpenAI hackathons—and I was using AI constantly to help with university workflows.

The difference it made was enormous. Work that could have taken days, such as organizing research, understanding a difficult technical topic, structuring a professional lab report, or turning rough notes into a clear document, could often be completed in hours. The value was not that the AI did the learning for me. The value was that it removed so much friction around finding information, managing context, checking structure, and turning what I knew into a useful result.

Naturally, I started showing other students how I worked. I taught friends how to set up agents, how to give them the right context, how to break down a task, and how to get a result that was actually useful rather than merely impressive-looking. But that approach did not scale. It required a lot of person-to-person explanation, and there were countless details that I had learned so gradually that they felt intuitive to me.

Trying to automate the process made me realize how much hidden judgment was involved. An agent does not automatically know which student portal contains a date, which Moodle page is relevant, whether a source is complete, what makes a good study guide, or when an answer only sounds convincing. All of that intuition has to be encoded into the workflow: how agents gather evidence, how they preserve context, how they decide whether an output is good, and how they recover when something is missing or wrong.

The earliest version of this idea was just a Moodle scraper. It was a skill I could call from my normal Codex workflow whenever I needed information from Moodle. Over time, that scraper grew into Study Buddy 1.0: still mainly a collection of skills and agent instructions that worked well for me because I understood how to supervise it.

Eventually I ran into the limits of that approach. Asking the skill set to build a complete study document or support a complex university workflow from the beginning exposed too many fragile assumptions. At the same time, I wanted to help more students—not only the friends I could personally teach. That motivated me to move beyond a personal skill collection and build an actual open-source product.

I had already been using and modifying T3 Code for my own workflows. Its open-source MIT-licensed local agent interface was a natural foundation: instead of building another generic chat shell, I could focus on the education-specific parts that did not exist yet. That became the Study Buddy project I am presenting today.

## What it does

Study Buddy is a local, open-source AI learning companion that guides students through their classes and student portals.

It can navigate authorized Moodle and CIS pages, locate courses and activities, find schedules and administrative information, explain where a student can find something, answer course questions, and transform source material into structured PDF or offline interactive HTML study guides.

The goal is not simply to place a chatbot next to Moodle. Study Buddy orchestrates the full workflow that an experienced student would otherwise have to manage manually. It chooses an appropriate information source, gathers evidence, records which sources it actually covered, identifies gaps, creates a learning structure, builds the artifact, and reviews the result.

That source transparency matters. If one portal returns no result, Study Buddy does not automatically claim that the information does not exist. If a course page is reachable but the requested topic is not present, it reports the mismatch instead of quietly substituting a neighboring topic. The system is designed to say what it knows, how it knows it, and what remains incomplete.

Study Buddy also supports bounded quiz and assignment assistance. It can inspect, explain, and prepare work, but consequential actions require visible permission and final Moodle quiz submission is blocked by policy.

Students run the project locally using their own Codex access. Their source data and generated artifacts stay in their workspace by default. The planned usage analytics are opt-in and designed to exclude prompts, course names, URLs, paths, source material, and generated document content; the production tracking setup still needs to be completed and validated before the student alpha.

## How I built it

Study Buddy combines a modified T3 Code interface with a canonical TypeScript runtime built around LangGraph.

The T3 fork provides the local chat, workspace, provider, and desktop/web experience. Study Buddy adds education-specific settings, execution profiles, permission cards, artifact handling, and a connection to the canonical Moodle/CIS pipeline in the root repository. Keeping one canonical runtime was an important decision: the interface delegates to it instead of carrying a second scraper that would drift over time.

The runtime organizes Moodle, CIS, calendar, source download, analysis, artifact generation, and review as explicit graph workflows. Each run persists its evidence and state so failures can be diagnosed and expensive extraction work can be resumed without crawling the same sources again.

GPT-5.6 is integrated directly into the running product. Study Buddy uses task-specific policies for coordination, source analysis, artifact planning, artifact construction, quiz assistance, and semantic quality review. Faster GPT-5.6 configurations handle bounded tasks, while stronger models and reasoning levels are used for difficult building and validation recovery.

For study documents, the pipeline validates an extraction handoff before rendering a standardized Typst PDF. For interactive learning experiences, it produces a self-contained offline HTML page, extracts and optimizes assets, applies a restrictive content-security policy, and validates the result in Chromium.

I built this with Codex as my primary engineering collaborator. I used Codex to inspect the repository, plan changes, implement and refactor workflows, write regression tests, diagnose live failures, review security boundaries, and evaluate generated artifacts. Codex accelerated the engineering work, while I made the key product decisions about student experience, source fidelity, privacy, learning design, and safety.

Study Buddy existed before Build Week, and I disclose that clearly in the repository. The conservative pre-hackathon baseline is commit `fe3a6fe`. During the submission period I meaningfully extended the project with the deeper T3 integration, reproducible setup and runtime diagnostics, GPT-5.6 task routing, semantic quality review, interactive quiz and assignment workflows, source-grounded PDF and HTML generation, resumable extraction, multilingual artifacts, and student-first learning design.

## Challenges I ran into

The biggest challenge was translating intuition into a reliable agent system.

As a human, I might immediately know that an exam date is more likely to be in a calendar or administrative portal than in a Moodle resource. I might recognize that a reachable dashboard is not evidence for a specific topic, or that a document is technically valid but still a poor learning resource. Agents need those distinctions to be explicit.

Source coverage was therefore much harder than scraping. The system has to distinguish “the page loaded” from “the requested information was found,” use the correct fallback source, avoid wandering into unrelated courses, and preserve a traceable evidence package for the final answer or artifact.

Long-running artifact generation created another class of problems. Model capacity, timeouts, and concurrent calls could waste minutes without producing useful tokens. I added a filesystem-backed fair scheduler, bounded model concurrency, structured diagnostics, and resumable extraction checkpoints so the workflow can continue from persisted evidence instead of repeating a broad crawl.

Generating trustworthy artifacts was also difficult. Valid Typst can still produce a weak or poorly structured study guide. A visually attractive webpage can still teach nothing. Study Buddy therefore separates analysis, learning architecture, building, deterministic validation, and semantic review. The quality reviewer checks whether the result actually supports the requested learning goal rather than merely satisfying a file format.

Finally, quiz and assignment features required careful boundaries. Helpful automation can become consequential very quickly. The product makes targets and actions visible, requires explicit permission, avoids claiming stronger security guarantees than it has, and blocks final quiz submission.

## Accomplishments that I'm proud of

I am proud that Study Buddy has grown from a personal Moodle skill into a real, non-trivial education product.

- It connects authenticated university sources to validated learning artifacts through explicit LangGraph workflows.
- It uses GPT-5.6 meaningfully across planning, analysis, building, and review.
- It produces both standardized Typst PDFs and portable offline interactive study guides.
- It reports source coverage and does not turn one empty search into a confident answer.
- It can resume expensive extraction work and fairly schedule model calls across concurrent runs.
- It preserves German and English requests throughout the workflow.
- It has conservative quiz and assignment policies, including blocked final quiz submission.
- It builds on T3 Code transparently and keeps the upstream license and attribution intact.
- It has a broad automated test suite spanning the canonical runtime and the T3 integration.

Most of all, I am proud that the difficult lessons I used to explain to friends one by one—how to provide context, how to verify sources, how to judge output quality, and how to structure an agent workflow—are becoming reusable product behavior.

## What I learned

I learned that building an agent for education is fundamentally different from adding a chatbot to a website.

The hard part is not generating text. It is maintaining trustworthy context across a long workflow, deciding which evidence matters, admitting when coverage is incomplete, and turning information into something that helps a student learn.

I also learned that good agent orchestration is an exercise in encoding judgment. Retry rules, source selection, permissions, validation, learning structure, and recovery paths are not implementation details around the model—they are a large part of the product.

Working intensively with Codex reinforced the same lesson. My best results did not come from asking for a large feature in one sentence. They came from treating Codex as a collaborator: giving it the repository and constraints, inspecting evidence together, making a clear product decision, implementing it, and then verifying the result through tests and real artifacts.

Before Build Week I was using the roughly USD 20 Codex subscription tier and regularly exhausting my available usage across Study Buddy and other side projects. During the hackathon I upgraded to the roughly EUR 100 Pro 5x tier. I also used a limited number of reset tokens—a new feature that restores the weekly usage allowance—to keep working when I reached the limit. The extra capacity allowed me to sustain much longer cycles of implementation, testing, and artifact review. A useful framework existed before the event, but much of the product's depth and polish arrived during this week.

## What's next for Study Buddy

The immediate next step is to make Study Buddy easy to evaluate without access to a real student's university account. I want to add a safe synthetic demo portal and a curated showcase of example outputs.

Study Buddy is architected to be cross-platform across Linux, macOS, and Windows, but I have only tested it end to end on Linux so far. Before the first student alpha, planned for September 2026 when the next semester begins, I want to finish native Windows and macOS validation, platform-specific setup instructions, packaging, and the remaining repository cleanup.

I also need to complete and validate the opt-in tracking setup. Its purpose is to show which workflows students actually use, where they abandon a run, and which artifact types are most valuable—without collecting their prompts or course content. After that, I want to expand the evaluation corpus across more subjects, institutions, and learning styles. Upgrading to Pro 5x gives me enough Codex capacity to work through this pre-alpha reliability and compatibility backlog properly before university starts again.

The long-term goal is simple: Study Buddy should be a free, open-source learning companion that lets more students benefit from powerful agent workflows without first having to become experts in context management, prompting, orchestration, and university portal navigation.
