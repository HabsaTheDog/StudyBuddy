# Judge guide

## What to evaluate

Study Buddy is a local student-facing application built on a T3 Code interface and a canonical TypeScript/LangGraph runtime. It is designed to be cross-platform, and automated CI covers Ubuntu Linux, macOS, and native Windows. The complete product workflow has only been tested manually end to end on Fedora Linux, so Fedora with Node.js 22 is the primary judge path. Other environments remain CI-verified or best effort until manual validation is complete. The interface delegates Moodle, CIS, calendar, artifact, quiz, and assignment work to the root runtime.

## Path A: inspect the showcase without credentials

Open the selected files in [`showcase/`](showcase/README.md). A PDF opens in any standard PDF viewer, and each interactive guide is a self-contained HTML file that runs by opening it in a modern desktop browser. The HTML does not require a server or network connection.

The showcase directory is intentionally empty until Alvaro selects outputs that contain no private student data, unauthorized course material, personal URLs, or third-party marks.

## Path B: verify the canonical runtime

Tested target:

- A current Fedora Linux release
- Node.js 22+
- npm bundled with Node
- Chromium installed through Playwright
- Typst and Poppler for PDF generation/extraction
- an authenticated Codex installation/account with access to GPT-5.6

Install:

```bash
git clone https://github.com/HabsaTheDog/StudyBuddy.git
cd StudyBuddy
git submodule update --init t3code-fork
npm ci
npx playwright install chromium
cp .env.example .env
```

Install the Fedora system prerequisites listed in the root `README.md` before running these commands. Platform-specific Ubuntu, macOS, Windows, and WSL instructions are also available there, but those paths have not been manually tested end to end.

Verify without accessing a student portal:

```bash
npm run moodle:doctor -- --version-only --json
npm run typecheck
npm test
```

Run an offline interactive artifact from authorized local notes:

```bash
npm run web-layout:agent -- \
  "Create an interactive study guide from the supplied notes" \
  --source-file ./notes.txt \
  --kind study-guide
```

## Path C: run the local Study Buddy interface

The T3 application uses pnpm 10.24.x:

```bash
cd t3code-fork
pnpm install
pnpm study-buddy:ports
pnpm study-buddy:dev
```

Open `http://localhost:5853`. The companion local server runs at `http://localhost:13893`.

## Live Moodle/CIS testing

Live portal testing requires a purpose-limited account that the account owner and institution authorize the judges to use. Credentials must be placed only in Devpost's private testing instructions, never in the public repository, source archive, video, screenshots, or committed environment files.

Before final submission, Alvaro must choose one of these testing paths:

1. obtain a dedicated restricted test account from the institution;
2. obtain explicit permission to share a temporary account and rotate it before and after judging; or
3. provide a synthetic/demo portal that does not expose personal academic data.

Do not use a normal personal student account as a public or long-lived demo account. Do not distribute a private calendar URL; it functions as a bearer secret.

If a permitted live account is supplied privately, copy `.env.example` to `.env` and add only the authorized values. Then run:

```bash
npm run moodle:agent -- \
  "Create a study guide for the selected demo course" \
  --url "<AUTHORIZED_DEMO_COURSE_URL>" \
  --format pdf \
  --format html
```

## Expected behavior

A successful artifact run creates an isolated canonical workflow directory under `study-buddy-data/`, records source coverage and diagnostics, and publishes only explicitly selected user-facing files. Successful PDF generation requires a terminal run summary, an empty error log, and non-empty Typst and PDF artifacts. Interactive output must pass static and Chromium validation and remain self-contained.

## Safety boundaries

- Final Moodle quiz submission is blocked.
- Consequential quiz and assignment actions require explicit permission.
- Authenticated screenshots and page content are not persisted by default.
- Production analytics collection is not yet enabled for the student alpha; the planned system is opt-in and excludes credentials, prompts, course names, URLs, source material, and generated content.
- Judges should use only accounts and course data they are authorized to access.
