# How I collaborated with Codex

## The working relationship

I built Study Buddy with Codex as my primary coding collaborator. The project started before OpenAI Build Week, and Codex was already central to the way I worked: I described product goals and constraints, asked Codex to inspect the repository, evaluated its proposed approach, and then used it to implement, test, diagnose, and refine the result.

I began on the roughly USD 20 Codex subscription tier and regularly reached my usage limits because Study Buddy and my other side projects consumed nearly all of the available capacity. For Build Week I upgraded to the roughly EUR 100 Pro 5x tier. I also used a limited number of reset tokens—a new feature that restores the weekly usage allowance—to sustain much longer implementation and verification sessions. That increased capacity is one reason a large share of the project's visible progress happened during the submission week, even though a useful framework already existed.

This is not a claim that Codex made the product decisions for me. I decided what Study Buddy should be and what risks it should avoid. Codex made it possible to explore and implement those decisions at a pace I could not have reached alone.

## Where Codex accelerated the work

### Architecture and refactoring

Codex helped separate the canonical Moodle/CIS runtime from the T3 interface, migrate the workflow to stricter LangGraph state and handoff contracts, and prevent duplicated scraping implementations. It was especially useful for tracing data shapes through a large TypeScript codebase before changing them.

### Reliability and testing

Codex wrote and updated regression tests alongside implementation changes. It helped turn observed failures—invalid analyzer JSON, model timeouts, incomplete sources, invalid Typst, unsafe URLs, and browser edge cases—into explicit test cases and bounded recovery paths.

### Student-first artifact design

I used Codex to iterate on study-document structure, interactive learning patterns, chapter navigation, responsive layouts, and source displays. I made the decision that artifacts should teach through explanations, worked examples, retrieval practice, and transparent evidence rather than simply summarize scraped pages.

### Security and safety

Codex helped review URL boundaries, diagnostic redaction, credential handling, quiz and assignment permissions, process cancellation, and offline HTML content-security policy. I chose the conservative product rules: no final quiz submission, visible confirmation for consequential actions, and no authenticated page capture by default.

### Live debugging and evaluation

Codex was used to run the product, inspect terminal artifacts and failure reports, compare generated documents, and feed concrete diagnostics back into implementation. The workflow's evaluation and telemetry layers came from treating live output as engineering evidence instead of relying only on unit tests.

## Decisions I retained

- Study Buddy must be source-grounded and explicit about incomplete coverage.
- It must not reinterpret a requested topic as a neighboring topic.
- Moodle, CIS, and calendar sources should be selected according to the kind of information requested.
- Student data and generated artifacts should remain local by default.
- Analytics must be opt-in and exclude educational content and identifying course context.
- Quiz and assignment assistance needs stronger boundaries than ordinary read-only help.
- The public product should build on T3 Code with attribution instead of presenting that interface as original work.
- One canonical runtime should serve the CLI and interface.

## How GPT-5.6 is used in the product

Study Buddy uses GPT-5.6 through the Codex SDK as part of its running workflows. A versioned policy assigns different model/reasoning combinations to coordination, source analysis, artifact planning, building, quiz assistance, and semantic review.

- Luna is used where speed and bounded analysis are valuable.
- Terra balances reasoning quality and cost for coordination, planning, and analysis.
- Sol is used for difficult artifact construction and high-quality review.
- Validation failures may escalate model strength or reasoning effort within bounded retry limits.

The runtime can produce content-free operational metrics such as model, effort, latency, retry, token, and queue measurements. The production opt-in tracking setup is still pre-alpha work; it must be completed and validated without collecting prompts or document contents before students begin testing the product.

## Evidence

The repository contains dated commits, explicit GPT-5.6 policy code and tests, runtime diagnostics, evaluation tools, and many timestamped Codex workspace sessions. [`CODEX_SESSIONS.md`](CODEX_SESSIONS.md) records the session metadata relevant to the submission.

The Devpost form still requires exactly one `/feedback` Session ID from the primary build thread. The strongest candidate from local metadata is `019f7106-3623-75b1-8e0e-e4ec493c71d4`, a long-running core-development thread spanning July 17–18 with delegated architecture work. Alvaro must reopen that thread, run `/feedback`, and use the ID returned by the command. The metadata identifier alone should not be treated as a substitute for that step.

## T3 Code acknowledgement

Study Buddy's interface builds on the open-source T3 Code project. T3 Code provided the base chat, provider, workspace, and local application experience. Study Buddy adds education-specific settings, profiles, permissions, workflows, artifact handling, and the canonical Moodle/CIS integration. The upstream copyright and MIT license remain intact, and the submission should clearly credit the T3 team.
