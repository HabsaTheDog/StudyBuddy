# Study Buddy 2.0

AI-powered study assistant that extracts content from Moodle and CIS, generates structured study documents (Typst → PDF), and assists with quiz workflows — all orchestrated through LangGraph.

## Prerequisites

| Dependency | Version | Install |
|---|---|---|
| **Node.js** | ≥ 22 | [nodejs.org](https://nodejs.org/) or via `nvm` / `fnm` |
| **npm** | bundled with Node | — |
| **Typst** | latest | Linux: `sudo snap install typst` · macOS: `brew install typst` · Windows: `winget install typst` |
| **Playwright browsers** | matches `package.json` | `npx playwright install` (run after `npm install`) |
| **Poppler tools** | current | Debian/Ubuntu: `sudo apt install poppler-utils` · Fedora: `sudo dnf install poppler-utils` · macOS: `brew install poppler` |

Tesseract is not a Study Buddy runtime dependency. Text-layer PDFs use Poppler's `pdftotext`; image extraction and selected-page rendering are a separate Poppler-based visual path. Sparse scanned PDFs are reported explicitly instead of triggering an automatic multi-page OCR pass.

## Quick Start

### 1. Clone the repository

```bash
git clone --recursive git@github.com:HabsaTheDog/StudyBuddy.git
cd StudyBuddy
```

> **`--recursive` is important** — it pulls the `t3code-fork` submodule. If you forgot, run:
> ```bash
> git submodule update --init --recursive
> ```

### 2. Install dependencies

```bash
npm install
npx playwright install
```

### 3. Set up environment variables

The repo ships a **`.env.example`** template. Credentials are **never committed** — you must create your own local env files.

**Option A — Interactive setup (recommended):**

```bash
npm run setup
```

This copies `.env.example` → `.env`, prompts for your Moodle/CIS credentials, and creates a minimal `.env.local` for personal overrides.

**Option B — Manual setup:**

```bash
cp .env.example .env
```

Then edit `.env` and fill in at minimum:

```env
MOODLE_USERNAME=your_username
MOODLE_PASSWORD=your_password
```

Optionally create `.env.local` for machine-specific overrides (quiz policies, calendar URL, browser settings, etc.). Values in `.env.local` take priority over `.env`.

### 4. Verify the installation

```bash
npm run typecheck     # TypeScript compilation check
npm test              # Run test suite
```

## Environment Files

| File | Committed? | Purpose |
|---|---|---|
| `.env.example` | ✅ Yes | Template with all supported variables and defaults |
| `.env` | ❌ No | Your primary config (credentials, base URLs, timeouts) |
| `.env.local` | ❌ No | Machine-specific overrides (quiz policy, calendar, browser prefs) |

**Loading order** (first match wins, no overrides):  
`.env.local` → `.env`

See `.env.example` for the full list of supported variables and their defaults.

## Usage

```bash
# Run the Moodle study-document agent
npm run moodle:agent -- --prompt "Create a summary of DC-DC converters" --url "https://moodle.technikum-wien.at/..."

# Run evaluations
npm run moodle:eval

# Type-check the project
npm run typecheck

# Run tests
npm test
```

## Project Structure

```
Study Buddy/
├── src/
│   └── custom-skills/
│       └── moodle/          # Moodle/CIS pipeline (LangGraph)
├── docs/                    # Internal documentation
├── output/                  # Generated artifacts (gitignored)
├── t3code-fork/             # Git submodule — T3 Code integration
├── CI/                      # Corporate identity assets
├── .env.example             # Environment template (committed)
├── .env                     # Your credentials (NOT committed)
├── .env.local               # Local overrides (NOT committed)
└── package.json
```

## Cross-Platform Notes

The codebase is **cross-platform** (Linux, macOS, Windows). A few things to be aware of:

- **Windows**: Node.js, npm, Playwright, and Typst all have native Windows support. No WSL required for core functionality.
- **Shell scripts**: The `npm run setup` script uses `bash`. On Windows, run it via **Git Bash** (included with Git for Windows) or use the manual setup method above.
- **Path handling**: All source code uses `node:path` for OS-aware path resolution — no hardcoded Unix paths.

## Security

- **Never commit `.env` or `.env.local`** — they are gitignored via `.env*` / `!.env.example`.
- See [SECURITY.md](SECURITY.md) for the security policy.

## License

[MIT](LICENSE)
