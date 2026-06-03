# Uni-Agent

Local Moodle assistant workspace for FH Technikum Wien.

The assistant is designed to:

- log in to Moodle through `agent-browser`
- index visible courses from `https://moodle.technikum-wien.at/my/`
- collect allowed course material
- generate summaries and study notes with citations
- assist with quizzes under strict no-final-submit guardrails

The agent must never perform a final Moodle submission. It can ask isolated subagents to answer visible quiz questions, fill validated answers, traverse the quiz pages, and then stop before final submission.

## Setup

```bash
npm install
npm run browser:install
python -m pip install -r requirements.txt
```

Typst is optional but required for PDF compilation. Without it, study document
generation still writes Markdown and Typst source.

```bash
# Fedora example
sudo dnf install typst

# Or install from https://typst.app/docs/
```

Create a local `.env` from `.env.example`. `.env` is ignored by Git.

Windows-specific setup and PowerShell examples are documented in
[docs/windows.md](docs/windows.md).

macOS-specific setup notes are documented in
[docs/macos.md](docs/macos.md).

## Common Commands

```bash
npm run moodle:login
npm run moodle:snapshot -- https://moodle.technikum-wien.at/my/
npm run moodle:courses
npm run moodle:sync
npm run moodle:sync -- --no-download
npm run moodle:materials -- --course-limit 3 --download-limit 5
npm run providers
npm run study:buddy -- "find the next math quiz"
npm run study:buddy -- "do the next math quiz"
npm run study:buddy -- "do the next math quiz" --auto-answer
npm run study:buddy -- "do the next math quiz" --answers answers.json
npm run study:buddy -- "generate a study guide for Integralrechnung 2"
npm run study:build -- "DYN2 exam study guide" --format markdown+pdf
npm run study:build -- "summarize MAES2 definite integrals as a PDF" --format markdown+pdf
npm run study:build -- "make a formula sheet for DYN2" --format markdown+pdf
npm run quiz:assist -- <quiz-url>
npm run quiz:assist -- <quiz-url> --fill-safe --auto-answer
npm run quiz:assist -- <quiz-url> --fill-safe --answers answers.json
```

The npm commands are the cross-platform entrypoints for Windows, Linux, and
macOS. The `scripts/*.sh` wrappers are kept for Unix shells and call the same
Python modules.

## Prompt Runner

`npm run study:buddy -- "<prompt>"` accepts natural-language prompts and maps
them to Moodle actions. It can identify likely courses and quizzes from prompts
like `next math quiz`, inspect a selected quiz, create an answer template, ask
subagents to answer questions from extracted text/screenshots, or fill a quiz
from a provided answer JSON.

The prompt runner prefers the synced course cards in
`state/course_agent_cards.json` when routing a prompt to a Moodle course or
known quiz/activity URL. If no sync exists, it falls back to the older course
indexing path and can trigger a fast metadata-only sync when no course index is
available.

`--auto-answer` creates one isolated packet per visible question inside the current quiz run folder. Each packet contains extracted question text, visible controls/options, Moodle page metadata, local source excerpts, and a page screenshot. The runner asks a configured agent provider to answer the packet. Auto provider selection prefers Codex when installed, then a configured custom command. Set `SUBAGENT_SOLVER_COMMAND` to a custom command, or set it to `off` to only generate packets and leave questions unfilled.

Quiz filling defaults to a `--max-pages` cap of 100, so it attempts the whole quiz until Moodle has no safe next-page navigation left. Lower this value only for testing.

If the prompt is ambiguous, it writes one clarification folder directly under `output/` with the likely course/quiz choices and exact next commands.

## Moodle Sync

`npm run moodle:sync` is the one-command live Moodle refresh. It logs in,
indexes all visible Moodle courses, opens each course page, extracts compact
activity/resource links, downloads accessible course files, refreshes the local
document index, and writes agent course cards.

Default sync is a clean full refresh: it removes previous sync metadata, clears
the downloaded Moodle material cache, downloads accessible files/resources again,
and rebuilds the document index from the fresh cache. Moodle remains the source
of truth for live state such as current quizzes, deadlines, assignments, and
visible page content. Use `--no-download` for a fast metadata-only refresh, or
`--incremental` to keep the existing material cache.

Other tools consume the sync output as their compact course map:

- `npm run study:buddy -- ...` uses course cards for course/quiz routing.
- `npm run study:build -- ...` uses course cards and the local document index to plan resources, build a source bundle, render Markdown/Typst/PDF, and review the result.
- Quiz subagent packets include the matching course card context when available.

Outputs are written under:

```text
output/<timestamp>_moodle-sync/
state/moodle_sync_summary.json
state/course_agent_cards.json
state/course_index.json
state/material_links.json
state/document_index.json
```

Useful commands:

```bash
npm run moodle:sync
npm run moodle:sync -- --course-limit 3
npm run moodle:sync -- --no-download
npm run moodle:sync -- --incremental
npm run moodle:sync -- --download-limit-per-course 20
npm run py -- -m uni_agent.orchestrator sync
```

## Agent Providers

LLM-backed work is routed through provider adapters instead of hard-coding one
CLI. The Python orchestrator remains responsible for Moodle login, browser
control, safety checks, packet creation, validation, and final no-submit
guardrails. Providers receive only local packet JSON, optional screenshot paths,
an optional schema path, and an output path.

Provider diagnostics:

```bash
npm run providers
npm run py -- -m uni_agent.orchestrator providers
```

Configuration lives in `config/agent_providers.json` and `.env`:

```bash
STUDY_BUDDY_AGENT_PROVIDER=auto
STUDY_BUDDY_AGENT_COMMAND='... {packet} ... {output} ... {schema} ... {screenshot} ... {prompt_file} ...'

SUBAGENT_SOLVER_PROVIDER=
SUBAGENT_SOLVER_COMMAND=
DOCUMENT_BUILD_SECTION_PROVIDER=
DOCUMENT_BUILD_SECTION_COMMAND=
STUDY_BUILD_BUILDER_PROVIDER=
STUDY_BUILD_BUILDER_COMMAND=
STUDY_BUILD_REVIEWER_PROVIDER=
STUDY_BUILD_REVIEWER_COMMAND=
```

Selection order is task command hook, task provider, global provider, auto
detection, then disabled. Existing command hooks remain compatible and take
precedence.

## Adaptive Document Build Documents and PDFs

Study-guide, summary, Lernzettel, formula-sheet, assignment-brief, and notes
prompts are routed through the `study-build` command into the adaptive
`document-build` pipeline. The orchestrator selects a template, syncs current
Moodle sources by default, plans only the relevant resources, renders
Markdown/PDF only after review passes, and never falls back to old `output/`
artifacts as sources. If a request asks for Moodle-like quiz questions, the
pipeline stops and asks for explicit permission before opening any quiz/test
page.

Direct commands:

```bash
npm run study:build -- "DYN2 exam study guide" --format markdown+pdf
npm run study:build -- "Integralrechnung Zusammenfassung" --format markdown+pdf
npm run study:build -- "DYN2 Formelsammlung" --format markdown+pdf
npm run study:build -- "Löse alle Übungen mit Kreuzerl" --format markdown+pdf --template math_worked_solutions
npm run py -- -m uni_agent.orchestrator study-build "DYN2 exam study guide" --format markdown+pdf
```

Quiz access policy for document generation:

- `--quiz-access ask` is the default. The run stops with
  `needs-quiz-authorization` before opening any quiz/test page.
- `--quiz-access none` ignores quiz pages and builds self-check questions only
  from theory sources.
- `--quiz-access authorized` is reserved for a current user instruction naming
  exactly which quiz views may be opened. Final submission remains forbidden.

Outputs are written under:

```text
output/<timestamp>_study-build_<slug>/
```

Expected files include:

```text
study-build.md
document-build.pdf       # only after source preflight and review pass
document-build.md
study-build.pdf          # compatibility copy when rendering succeeds
REVIEW.md
SOURCES.md               # human-readable source list
artifacts/               # build inputs, model responses, metadata, copied sources
```

Adaptive document-build section hooks are optional. Math worked-solution
sections require a model-backed builder; without one the review fails and no PDF
is rendered. General summaries can still use the local deterministic builder for
auditable drafts.

Useful adaptive document-build settings:

```bash
DOCUMENT_BUILD_SECTION_PROVIDER=custom
DOCUMENT_BUILD_SECTION_COMMAND='... {packet} ... {output} ... {schema} ... {prompt_file} ...'
```

## Guarded Quiz Filling

`--fill-safe` fills from the provided answer file by default, even if the review-only classifier would mark the page ambiguous. It still requires confidence and citations, and it never clicks final submission controls.

`--respect-review-only` exists only as an opt-in conservative diagnostic mode. Do not use it for normal quiz work.

Answer file shape:

```json
{
  "answers": [
    {
      "question_index": 1,
      "answer": "4 cm^2",
      "confidence": 1.0,
      "citations": [
        {
          "title": "Moodle Beispielkurs visible question",
          "kind": "moodle_page"
        }
      ]
    }
  ]
}
```

Generated user-facing artifacts are written to `output/`.
