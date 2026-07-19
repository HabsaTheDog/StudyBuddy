# Study Buddy

Study Buddy is an open-source AI learning companion that helps students understand their classes, locate information across student portals, answer course questions, and turn source material into structured PDF and interactive HTML study guides.

Built by **Alvaro** for the **Education** track of OpenAI Build Week 2026.

## What it does

- Navigates authenticated Moodle and CIS pages to find courses, activities, schedules, rooms, exams, deadlines, and administrative information.
- Builds source-grounded study guides as polished PDFs or portable offline interactive webpages.
- Answers questions with explicit source coverage instead of pretending an empty search is a complete answer.
- Helps students review quizzes and assignments behind confirmation and safety policies; final Moodle quiz submission remains blocked.
- Routes planning, analysis, artifact building, and quality review through task-specific GPT-5.6 models.
- Keeps generated study artifacts local and is preparing opt-in, content-free usage analytics for the student alpha.

## Product architecture

```text
Student
   |
   v
Study Buddy interface (T3 Code fork)
   |
   v
LangGraph workflows
   |-- Moodle course and activity discovery
   |-- CIS and calendar lookup
   |-- source acquisition and coverage checks
   |-- GPT-5.6 planning, analysis, building, and review
   |-- quiz and assignment safety gates
   |
   +--> Typst -> validated PDF study guide
   +--> Web layout -> validated offline interactive HTML
```

The canonical Moodle/CIS implementation lives under `src/custom-skills/moodle/`. The `t3code-fork/` submodule supplies the local web/desktop interface and delegates study operations to the canonical root runtime.

## OpenAI Build Week 2026

Study Buddy existed before the hackathon. For eligibility and judging, the conservative pre-hackathon baseline is commit `fe3a6fe`, authored before the submission period opened on July 13, 2026 at 9:00 AM Pacific Time. The submission should be evaluated on the meaningful extension beginning with `cb7d1c3` and the later hackathon-period work.

During the submission period, Study Buddy gained a substantially expanded T3 integration, reproducible setup and runtime diagnostics, GPT-5.6 task routing, semantic quality review, safer quiz and assignment workflows, source-grounded PDF and interactive HTML generation, resumable extraction, multilingual artifacts, and student-first learning design.

Detailed evidence and submission materials are in [`docs/hackathon/`](docs/hackathon/README.md).

## How I collaborated with Codex

Codex was my primary engineering collaborator throughout Study Buddy. I used it to inspect the existing system, propose bounded changes, implement and refactor LangGraph workflows, build tests, diagnose live Moodle behavior, improve the T3 interface, and validate generated artifacts. During Build Week I worked across many Codex threads and used GPT-5.6 directly inside the product for task-specific planning, analysis, artifact construction, and quality review.

Codex accelerated implementation and verification, while I retained the key product decisions: Study Buddy should be student-first, source-grounded, local by default, explicit about missing coverage, conservative around quizzes and assignments, and useful without forcing students to understand the underlying agent architecture. I also chose to build on the open-source T3 Code interface rather than invent another chat shell.

See [`CODEX_COLLABORATION.md`](docs/hackathon/CODEX_COLLABORATION.md), [`CODEX_SESSIONS.md`](docs/hackathon/CODEX_SESSIONS.md), and [`NEW_WORK_EVIDENCE.md`](docs/hackathon/NEW_WORK_EVIDENCE.md) for the detailed account.

## Platform support and prerequisites

Dependencies remain system-managed for the student alpha; Study Buddy does not download or silently replace native tools. `moodle:doctor` records their resolved paths and versions in JSON, and every workflow run writes the same information to `runtime-dependencies.json`.

| Environment | Status | Notes |
|---|---|---|
| Ubuntu/Debian x64 | Tested | Primary development and hackathon path. |
| Fedora x64 | Best effort | Uses the same Linux runtime; clean-machine verification remains open. |
| macOS Apple Silicon/Intel | CI verified, best effort | Typecheck, tests, Typst, Poppler, Playwright, and the runtime doctor pass on GitHub's macOS runner; a manual student install is still required before alpha support. |
| Windows 11 x64 (native PowerShell) | CI verified, best effort | Typecheck, tests, Typst, Poppler, Playwright, and the runtime doctor pass on GitHub's native Windows runner; a manual student install is still required before alpha support. |
| WSL 2 | Best effort | Follow the Linux instructions inside WSL, not the native Windows instructions. |
| Node.js below 22, 32-bit OSes, Windows without PowerShell | Unsupported | These targets are outside the alpha support matrix. |

The supported baselines are Node.js 22, the Playwright version locked by `package-lock.json` (currently 1.60.x), Typst 0.15, Poppler 24.08, and LibreOffice 24.2 when Office conversion is needed. Newer versions from the package sources below are expected to work and are reported by the doctor command. The `t3code-fork/` interface additionally uses pnpm 10.24.x.

### Linux (Debian or Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils libreoffice
sudo snap install typst
npm ci
npx playwright install --with-deps chromium
bash scripts/setup.sh
```

### Linux (Fedora)

```bash
sudo dnf install poppler-utils libreoffice
# Install Typst from https://github.com/typst/typst/releases if it is not in your enabled repositories.
npm ci
npx playwright install --with-deps chromium
bash scripts/setup.sh
```

### macOS

```bash
brew install node@22 poppler typst
brew install --cask libreoffice  # optional Office conversion
npm ci
npx playwright install chromium
bash scripts/setup.sh
```

### Native Windows (PowerShell)

Run these commands from PowerShell, not WSL or Git Bash:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Typst.Typst --exact
winget install --id oschwartz10612.Poppler --exact
winget install --id TheDocumentFoundation.LibreOffice --exact  # optional Office conversion
npm ci
npx playwright install chromium
npm run setup:windows
```

Restart PowerShell after installing native tools so `PATH` changes take effect. If Poppler, Typst, or LibreOffice is installed somewhere unusual, set `STUDY_BUDDY_PDFTOTEXT_PATH`, `STUDY_BUDDY_PDFTOPPM_PATH`, `STUDY_BUDDY_TYPST_PATH`, or `STUDY_BUDDY_LIBREOFFICE_PATH` in `.env.local` to the full executable path.

### WSL 2

Clone and run Study Buddy inside the WSL filesystem and follow the Debian/Ubuntu instructions above. Do not mix native Windows executables or PowerShell setup with the WSL Node.js installation.

After any installation, verify the resolved versions and paths:

```bash
npm run moodle:doctor -- --version-only --json
```

The first student alpha is planned for September 2026. Remaining manual clean-machine validation and release work is tracked in [`TODO.md`](TODO.md).

## Quick start: canonical runtime

```bash
git clone https://github.com/HabsaTheDog/StudyBuddy.git
cd StudyBuddy
git submodule update --init t3code-fork
npm ci
npx playwright install chromium
cp .env.example .env
```

Add credentials for accounts you are authorized to use to `.env`, then verify the installation:

```bash
npm run moodle:doctor -- --version-only --json
npm run typecheck
npm test
```

Run a source-grounded document request. The prompt is a positional argument:

```bash
npm run moodle:agent -- \
  "Create a study guide for DC-DC converters" \
  --url "https://your-moodle.example/course/view.php?id=123" \
  --format pdf \
  --format html
```

Generate an offline interactive learning page from user-supplied source text:

```bash
npm run web-layout:agent -- \
  "Create an interactive study guide from the supplied notes" \
  --source-file ./notes.txt \
  --kind study-guide
```

The integrated extraction-to-interactive workflow is exposed as:

```bash
npm run interactive-study-guide -- \
  "Create an interactive study guide for this course" \
  --url "https://your-moodle.example/course/view.php?id=123"
```

Separate T3 workspaces run independently by default, so multiple PDF and
interactive workflows can make progress in parallel as hardware permits. To
apply an optional machine-wide resource ceiling, set
`STUDY_BUDDY_MODEL_CALL_CONCURRENCY` and/or
`STUDY_BUDDY_INTERACTIVE_WORKFLOW_CONCURRENCY` to a positive integer; unset or
`0` means unlimited.

## Local web/desktop interface

```bash
cd t3code-fork
pnpm install
pnpm study-buddy:ports
pnpm study-buddy:dev
```

The browser development interface uses `http://localhost:5853` and the local server uses `http://localhost:13893`. See [`t3code-fork/STUDY_BUDDY_T3.md`](t3code-fork/STUDY_BUDDY_T3.md) for the integration details.

## Judge and showcase materials

- [`JUDGE_GUIDE.md`](docs/hackathon/JUDGE_GUIDE.md) contains the safe installation and testing path.
- [`showcase/`](docs/hackathon/showcase/README.md) is the committed location for non-sensitive example outputs selected for the video.
- A local ignored `hackathon-submission-private/` folder can hold Devpost copy, private upload notes, and additional showcase files. It must never contain personal production credentials or long-lived private calendar URLs.

## Environment and data safety

The repository ships `.env.example`; real `.env` and `.env.local` files are ignored. Never commit credentials, session state, private calendar URLs, downloaded course materials, or authenticated browser diagnostics.

Study Buddy stores pipeline data under `study-buddy-data/` and publishes only explicitly selected deliverables outside that internal run area. See [`SECURITY.md`](SECURITY.md) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

By default, published files are written to the ignored `study-buddy-deliverables/` directory so generated course material does not appear as an accidental Git candidate. Use `--deliver-to` when a different reviewed destination is required.

## Development commands

```bash
npm run typecheck
npm test
npm run moodle:doctor -- --version-only --json
npm run moodle:eval
```

## Project structure

```text
Study Buddy/
|-- src/custom-skills/moodle/             Moodle, CIS, calendar and study workflows
|-- src/custom-skills/web-layout/         Offline interactive learning artifacts
|-- src/custom-skills/interactive-study-guide/
|-- src/custom-skills/shared/             Shared policies, data paths and leases
|-- t3code-fork/                          T3 Code UI/server integration submodule
|-- docs/hackathon/                       Build Week submission documentation
|-- study-buddy-data/                     Local workflow data (ignored)
|-- CI/                                   Study Buddy-owned identity assets
`-- package.json
```

## License and attribution

Study Buddy is available under the [MIT License](LICENSE). The interface builds on the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code) project; its copyright and license remain intact in the submodule. Vendored Typst package notices are retained beside their source. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for details.

Study Buddy is an independent student project and is not affiliated with or endorsed by Moodle, FH Technikum Wien, or the operators of any connected student portal.
