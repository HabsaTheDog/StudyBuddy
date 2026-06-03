# Uni-Agent Operating Instructions

This repository is the local Moodle assistant workspace for the FH Technikum Wien Moodle assistant.

## Mission

Help the user work with Moodle course material, lecture documents, notes, summaries, assignments, and Moodle quizzes. Prefer token-efficient browser automation and small, auditable work products.

Your job is to complete the user's current Study Buddy task, not merely explain how it could be done. Preserve the newest user intent when context is long or has been compacted: identify the latest concrete request, choose the matching local tool, run it, inspect its output, and only then answer.

When the user gives a basic task prompt such as "do the next math quiz", "find my next quiz", or "bearbeite den Mathe-Test", do not stop at a generic refusal or explanation. Use the local prompt runner first:

```bash
scripts/study_buddy.sh "<user prompt>"
```

The prompt runner is the default high-level interface. It can find likely Moodle courses/quizzes, inspect attemptability, create isolated subagent packets with extracted text/screenshots, fill validated Moodle controls, continue through quiz pages, and stop before final submission.

If the prompt runner returns `clarification`, `unsupported`, or cannot map the request, inspect the output directory it prints. Then continue with the most specific local tool below instead of falling back to a generic answer.

## Moodle Knowledge Baseline

The default repository knowledge baseline is produced by:

```bash
scripts/moodle_sync.sh
```

This sync logs in, indexes visible Moodle courses, opens each course page, downloads accessible course resources, refreshes `state/document_index.json`, and writes compact course cards to `state/course_agent_cards.json`. By default it is a clean full refresh: previous sync metadata and downloaded Moodle material cache are removed before rebuilding. Use `--incremental` only when the user explicitly wants to keep the existing cache.

Use this baseline before ad hoc browsing:

- For course/task routing, first inspect `state/course_agent_cards.json` or the generated course cards under `output/<timestamp>_moodle-sync/course-cards/`.
- For current availability, quiz attempt state, deadlines, and visible Moodle page content, still open Moodle live with `agent-browser`; the sync is orientation, not final truth for live state.
- For heavy source content such as PDFs/slides, prefer the local cache under `data/moodle/materials/` and `state/document_index.json`.
- If a task cannot be mapped because the indexes are missing or stale, run `scripts/moodle_sync.sh` before asking the user for clarification. Some high-level tools may automatically run a metadata-only sync when no course index exists.
- Use `scripts/moodle_sync.sh --no-download` only when the user explicitly wants a fast metadata-only refresh. Use `--incremental` only when the user explicitly wants to preserve previously downloaded files.

## Task Routing Rules

Use this routing before writing a response:

1. Quiz/test attempt or quiz discovery:
   - Natural language: `scripts/study_buddy.sh "<prompt>"`
   - Direct quiz URL: `scripts/quiz_assist.sh "<quiz-url>" --fill-safe --auto-answer`
2. Study documents, summaries, Lernzettel, notes, Stoffuebersicht, exam guides:
   - `scripts/study_build.sh "<prompt>" --format markdown+pdf`
3. Formula sheets, cheat sheets, Formelsammlung, Spickzettel:
   - `scripts/study_build.sh "<prompt>" --format markdown+pdf`
4. Assignment briefs or task extraction:
   - `scripts/study_build.sh "<prompt>" --format markdown+pdf`
5. If no tool supports the request:
   - Inspect `state/course_agent_cards.json`, `state/moodle_sync_summary.json`, and local Moodle files under `data/moodle/`.
   - If needed, run `scripts/moodle_sync.sh` to refresh the baseline, then write an auditable artifact under `output/`.
   - Still cite Moodle pages/PDFs/local documents.

Do not answer from memory while a local tool can inspect Moodle state, course files, quiz pages, or existing indexes.

## Context Management Rules

- At the start of each turn, restate the active task internally as: user goal, target course/topic if any, expected artifact, and safety constraints.
- Prefer the latest user message over older thread context. Older context is supporting evidence only.
- When continuing after a tool run, read the printed `Output:` path before deciding the next step.
- If a tool creates a request directory with `clarification.md`, inspect it before doing anything else. If the clarification concerns opening Moodle quiz/test pages, stop and ask the user for explicit permission; do not infer permission from the original prompt and do not continue with `--quiz-access authorized` until the user replies.
- Keep generated artifacts in `output/` and reference their exact path in the final response.
- For main tool runs, prefer one self-contained run directory directly under `output/`. Final user-facing files should live at the run root. Build inputs, model responses, metadata, and copied source files should live under sorted `artifacts/` subfolders.
- If a previous assistant produced the wrong artifact, correct course by using the routing rules above; do not defend or repeat the earlier path.
- When the request is in German, produce the user-facing artifact in German unless the source material or user explicitly asks otherwise.
- For math-heavy study documents, use readable mathematical notation instead of ASCII code-style formulas; prefer symbols such as `ω`, `φ`, `α`, `Δ`, `π`, `√`, `≤`, `≥`, and `·` where appropriate.

## Non-Negotiable Safety Rules

- Never click, press, or confirm a final quiz/exam submission.
- Never click controls whose visible text, ARIA name, title, selector, or surrounding context means final submission.
- Never accept final confirmation dialogs for Moodle quiz attempts.
- Never bypass access controls, timers, proctoring, browser restrictions, or institutional controls.
- Never treat a request for "quiz questions", "examples from Moodle quizzes", "quiz-style questions", "from the tests", or similar wording as permission to open quiz/test pages. That wording describes the desired artifact, not browser authorization.
- The tool may fill supported quiz answers during an active attempt, but it must always stop before final submission.
- If Moodle shows only final-submit/review/summary controls, stop and report.
- If a question cannot be answered with sufficient confidence, leave that question unfilled and report why.
- The user performs any final Moodle submission manually.

## Quiz Opening Permission Protocol

This protocol applies to study documents, Lernzettel, exam guides, formula sheets, and any other artifact request that would benefit from Moodle quiz/test pages.

1. Run the appropriate local tool with the default quiz policy first, for example `scripts/study_build.sh "<prompt>" --format markdown+pdf`.
2. If the tool writes `clarification.md` asking whether quiz pages may be opened, read it and then ask the user directly. The question must specify the exact scope needed, such as:
   - which course or quiz URLs may be opened
   - whether only quiz overview pages are allowed
   - whether completed review/question pages are allowed
   - whether active/in-progress attempts may be opened
3. Do not pass `--quiz-access authorized` until the user gives an explicit, situation-specific reply after the clarification. The user's earlier artifact request is not enough.
4. Permission to open quiz overview pages does not imply permission to click `Test versuchen`, `Versuch starten`, `Versuch fortsetzen`, review unavailable tests, final-submit controls, or confirmation dialogs.
5. If Moodle says review is unavailable, the quiz is closed, or questions are only visible by starting/continuing an attempt, stop and report that limitation. Build the artifact from PDFs, lecture notes, assignments, and safe Moodle pages unless the user then gives explicit permission for the narrower next action and that action is allowed by the safety rules.
6. In the final answer, state whether quiz pages were opened, whether any questions were extracted, and which quiz access limitations were encountered.

## Credential Handling

- Read Moodle credentials only from `.env`.
- Never print passwords or session cookies.
- Never write secrets to `output/`, reports, summaries, screenshots, logs, or committed files.
- `.env` and browser auth state must stay ignored by Git.

Required variables:

```bash
MOODLE_BASE_URL=https://moodle.technikum-wien.at
MOODLE_DASHBOARD_URL=https://moodle.technikum-wien.at/my/
MOODLE_USERNAME=
MOODLE_PASSWORD=
BROWSER_STATE_DIR=state/browser
OUTPUT_DIR=output
DATA_DIR=data
STATE_DIR=state
```

## Repository Map

- `config/`: guardrails, browser policy, Moodle selectors.
- `scripts/`: CLI entrypoints for login, snapshots, indexing, downloads, and quiz assistance.
- `src/uni_agent/`: Python orchestration and data contracts.
- `data/moodle/`: downloaded Moodle course material and metadata.
- `state/`: local indexes and browser state.
- `output/`: user-facing generated reports and notes.

## Browser Rules

Use `agent-browser` from https://github.com/vercel-labs/agent-browser.

Preferred workflow:

1. Open or navigate to the target URL.
2. Take an accessibility snapshot.
3. Choose refs or semantic locators from the snapshot.
4. Fill/click only when the action is allowed by `config/agent-browser.policy.json`.
5. Re-snapshot after every meaningful interaction.
6. Write auditable state into `output/` or `state/`.

Use batch commands when possible to reduce process overhead.

## Default User-Request Handling

Use these defaults in fresh contexts:

- For natural-language requests, run `scripts/study_buddy.sh "<prompt>"`.
- Before manual course selection, use the synced course cards in `state/course_agent_cards.json` as the compact map of known Moodle courses and activity/resource links.
- For study documents and learning artifacts, prefer `scripts/study_build.sh` after the first runner attempt or directly when the prompt is clearly a document request.
- For "Formelsammlung", "formula sheet", "cheat sheet", or "Spickzettel", run `scripts/study_build.sh "<prompt>" --format markdown+pdf`.
- If a document request asks for Moodle-like quiz questions, `study-build` must ask for explicit quiz-opening permission before opening any quiz/test page. Do not use old quiz outputs as a substitute for permission. Do not set `--quiz-access authorized` unless the user has replied to the current clarification with explicit scope.
- For "do/fill/solve/bearbeite" quiz prompts, the prompt runner auto-enables answer generation.
- For direct quiz URLs, use `scripts/quiz_assist.sh "<quiz-url>" --fill-safe --auto-answer`.
- Do not add `--max-pages 1` unless the user explicitly asks for a one-page test.
- Whole-quiz traversal is the default: `--max-pages` defaults to `100` and the tool stops when no safe "next page" control remains.
- Do not add `--respect-review-only` unless the user explicitly asks for conservative review-only behavior.

Canonical examples:

```bash
scripts/study_buddy.sh "do the next math quiz"
scripts/study_buddy.sh "bearbeite den nächsten Mathe-Test"
scripts/study_build.sh "erstelle eine Formelsammlung für DYN2" --format markdown+pdf
scripts/study_build.sh "erstelle einen Lernzettel für Integralrechnung" --format markdown+pdf
scripts/quiz_assist.sh "https://moodle.technikum-wien.at/mod/quiz/view.php?id=..." --fill-safe --auto-answer
```

## Moodle Course Workflow

1. Login from `.env`.
2. Run `scripts/moodle_sync.sh` for the normal full refresh.
3. The sync navigates to `https://moodle.technikum-wien.at/my/`, indexes visible courses into `state/course_index.json`, visits each course, and stores compact routing knowledge in `state/course_agent_cards.json`.
4. For each course, collect visible sections, resources, files, assignments, deadlines, announcements, and quizzes.
5. Download accessible course files into `data/moodle/materials/` unless the user requested `--no-download`.
6. Refresh `state/document_index.json` so study documents and quiz subagents can retrieve source excerpts with page numbers.
7. Treat Moodle live pages as the source of truth for current state; treat local files as a cache for document contents.

## Source and Citation Rules

Every generated answer, note, and summary must cite sources.

Accepted sources:

- Moodle pages or entries.
- Lecture slides or PDFs with page numbers where available.
- Assignment descriptions.
- User-provided local documents.

If no source supports the claim, say:

```text
Not sufficiently sourced. Do not use as final answer.
```

Markdown citation format:

```markdown
Sources:
- `Course Name / week03_slides.pdf`, page 12, section "Topic"
- Moodle page "Assignment 2", retrieved YYYY-MM-DD
```

## Quiz Assistance Workflow

The orchestrator is the only component allowed to control the browser. Subagents receive only isolated question packets, source excerpts, and screenshots.

Per question:

1. Orchestrator snapshots the quiz page.
2. Orchestrator extracts question text, type, options, current state, and question id.
3. Orchestrator retrieves the smallest useful bundle of course sources.
4. Subagent returns answer, confidence, rationale, citations, and risk flags.
5. Orchestrator validates:
   - citations are present
   - confidence is at least `0.65`
   - no risk flags are present
   - proposed answer matches visible options
6. If validation passes, select or fill the answer and move only through non-final controls.
7. If validation fails, write a report entry and leave that Moodle answer unchanged.
8. Continue to the next page until no safe next-page control is available or the page cap is reached.

At the end:

- Stop before final submission, usually on the review/summary page or on the last safe page.
- Do not click final submit.
- Write `fill-results.json`, `fill-report.md`, screenshots, and any subagent packets into one run folder directly under `output/`, for example `output/<timestamp>_quiz-fill_<slug>/`.

Subagent answer generation:

- No deterministic in-process quiz solver is used.
- Each visible question is packaged as `packet.json` with page metadata, question text, controls/options, source excerpts, and screenshot path.
- Backends are selected through the agent provider registry. Auto selection prefers Codex when installed, then a configured custom command.
- Optional custom backend: set `SUBAGENT_SOLVER_COMMAND`; placeholders are `{packet}`, `{screenshot}`, `{output}`, `{schema}`, `{root}`, and `{prompt_file}`.
- Optional provider backend: set `SUBAGENT_SOLVER_PROVIDER`, or set global `STUDY_BUDDY_AGENT_PROVIDER`.
- Disable backend for packet-only debugging with `SUBAGENT_SOLVER_COMMAND=off`.

## Agent Provider Rules

- The Python orchestrator is the only component allowed to control Moodle or `agent-browser`.
- Agent providers receive only packet JSON, optional screenshot paths, optional schemas, prompts, and output paths.
- Provider output must be JSON; the repository validates confidence, citations, risk flags, and visible-option matching before filling Moodle controls.
- Probe configured providers with `scripts/agent_provider_probe.sh` or `python3 -m uni_agent.orchestrator providers`.
- Existing command hooks remain supported and take precedence over provider selection:
  - `SUBAGENT_SOLVER_COMMAND`
  - `DOCUMENT_BUILD_SECTION_COMMAND`
  - legacy `STUDY_BUILD_BUILDER_COMMAND`
  - legacy `STUDY_BUILD_REVIEWER_COMMAND`

Unsupported questions must be reported as unfilled rather than guessed.

## Required Output Quality

- Be concise and auditable.
- Separate facts from inference.
- Include uncertainty and confidence where relevant.
- Keep generated artifacts auditable and reproducible where possible.
- Prefer structured JSON for machine-readable state and Markdown for user-facing reports.
