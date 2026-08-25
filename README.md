# Study Buddy

Study Buddy is a local-first AI learning companion that finds authorized course
evidence and turns it into source-grounded answers, PDF study guides, and
single-file offline learning webpages.

> **Release-candidate status:** version 1.0 is undergoing clean-machine release
> acceptance. Until a `v1.0.0` GitHub Release is published, the existing
> prereleases remain evaluation builds. Read the [security](SECURITY.md) and
> [privacy](PRIVACY.md) guidance before connecting an account.

[MIT licensed](LICENSE) · [Roadmap](ROADMAP.md) ·
[Contributing](CONTRIBUTING.md) · [Support](SUPPORT.md)

## Downloads

Official downloads are published only through
[GitHub Releases](https://github.com/HabsaTheDog/StudyBuddy/releases). The
Windows x64 installer is currently unsigned and can trigger Windows
SmartScreen or `Unknown publisher` warnings. Verify its SHA-256 value against
the attached `SHA256SUMS` before running it; never disable SmartScreen globally
or install a copy obtained from a mirror. Linux x64 AppImages are included in
the same release bundle. macOS binaries are not currently supported.

The desktop app includes its JavaScript/Codex runtime and does not need a
developer checkout, system Node.js, Git Bash, or WSL. Browser-backed sources use
an installed Edge, Chrome, or Chromium. Typst is required only for PDF output;
Poppler enables complete PDF extraction, and LibreOffice enables optional
Office-document conversion. Offline HTML output does not need those document
tools.

## Current scope

- Generic Moodle navigation and evidence acquisition for accounts the user is
  authorized to access.
- An FH Technikum Wien-specific CIS/calendar adapter. Other student portals are
  not generically supported yet.
- Source-grounded answers with explicit coverage and failure reporting.
- Validated Typst PDF study guides and portable offline HTML learning pages.
- Conservative quiz and assignment workflows. Review-only quiz access is the
  default, consequential actions require explicit permission, and final Moodle
  quiz submission is always blocked.

Study Buddy is not affiliated with or endorsed by Moodle, FH Technikum Wien, or
the operators of any connected portal. Users remain responsible for portal
terms, academic-integrity rules, and redistribution rights for course content.

## Try it without portal credentials

Requirements: Node.js 22.16 or newer. Typst and Poppler are only needed for PDF
workflows.

```bash
git clone --recurse-submodules https://github.com/HabsaTheDog/StudyBuddy.git
cd StudyBuddy
npm ci
npx playwright install chromium
npm run web-layout:agent -- \
  "Create an interactive study guide from these synthetic notes" \
  --source-file examples/synthetic-notes.md \
  --kind study-guide
```

Generated course data and artifacts are local and ignored by Git. Review every
output before sharing it.

## Connect an authorized Moodle account

```bash
cp .env.example .env
# Edit .env locally. Never commit or upload it.
npm run moodle:doctor -- --version-only --json
npm run moodle:agent -- \
  "Create a study guide for the configured course" \
  --url "https://your-moodle.example/course/view.php?id=123" \
  --format pdf \
  --format html
```

The runtime uses the Codex executable paired with the pinned OpenAI Codex SDK.
Authenticated model checks may require a Codex login and model access; model use
may incur costs under the user's provider account. See
[configuration](docs/configuration.md) for portal, browser, and runtime settings.

## Local interface

The interface is maintained as the pinned `t3code-fork` submodule. GitHub source
archives do not bundle submodule contents, so clone recursively or initialize it
after cloning.

```bash
git submodule update --init t3code-fork
corepack enable
corepack prepare pnpm@10.24.0 --activate
cd t3code-fork
pnpm install --frozen-lockfile
pnpm study-buddy:ports
pnpm study-buddy:dev
```

The browser UI defaults to `http://localhost:5853` and its local server to
`http://localhost:13893`. The root repository pins the reviewed public interface
commit. Release builds must preserve that exact gitlink; see the
[release process](docs/releasing.md).

## Development

```bash
npm ci
npx playwright install chromium
npm run verify
npm run check:links
npm run check:public-tree
npm run check:licenses
npm run check:sbom
npm run audit:production
```

The canonical Moodle/CIS runtime lives under `src/custom-skills/moodle/` and is
governed by LangGraph. Offline webpage generation lives under
`src/custom-skills/web-layout/`. Repository structure, tests, and design-change
rules are documented in [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/](docs/README.md).

## Data and security boundary

Real `.env` files, browser state, cookies, calendar feed URLs, downloaded course
material, diagnostics, and `study-buddy-data/` runs must remain local. Build any
release artifact from a clean clone or `git archive`—never from a ZIP of a
working directory. Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## License and attribution

Study Buddy code is available under the [MIT License](LICENSE). The interface is
based on the MIT-licensed [T3 Code](https://github.com/pingdotgg/t3code), whose
copyright and license remain intact. Vendored packages keep their own licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The software license does not grant permission to redistribute Moodle course
materials, quiz content, student records, generated artifacts containing
third-party content, or third-party trademarks.
