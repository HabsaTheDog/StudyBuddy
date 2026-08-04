# Contributing to Study Buddy

Thanks for helping make Study Buddy safer and more useful. The project welcomes
focused bug fixes, reliability and accessibility improvements, documentation,
synthetic test fixtures, and well-bounded portal-adapter work.

## Before opening a change

- Search existing issues and open a proposal before large or architectural work.
- Discuss changes to authentication, permissions, quiz or assignment behavior,
  analytics, privacy, network access, data retention, or the Study Builder
  charter before implementation.
- Report security vulnerabilities privately through GitHub, not in a public
  issue. See [SECURITY.md](SECURITY.md).

## Development setup

```bash
git clone --recurse-submodules https://github.com/HabsaTheDog/StudyBuddy.git
cd StudyBuddy
npm ci
npx playwright install chromium
npm run verify
```

Node.js 22.16 or newer is required. PDF tests additionally need Typst 0.15 and
Poppler. The UI submodule uses pnpm 10.24.0 and has its own upstream-derived
toolchain; root issues remain the single contribution intake for now.

## Pull requests

Keep changes small enough to review and include:

- a linked issue or concise problem statement;
- tests for behavior changes and documentation for user-visible changes;
- the commands you ran and their results;
- a security/privacy/data-flow assessment;
- screenshots or recordings for UI changes;
- provenance and license details for new fixtures, assets, or dependencies.

Do not add real credentials, cookies, storage state, private calendar URLs,
authenticated captures, student records, real quiz attempts, or course material
that you cannot redistribute. Use reserved example domains and synthetic IDs in
tests. Redact diagnostics before attaching them to an issue.

For submodule changes, the fork commit must be reviewed, tested, pushed, and
publicly reachable before the parent gitlink is updated.

## Project rules

- Final Moodle quiz submission is always blocked.
- Review-only quiz access is the default. Capability expansion requires an
  explicit user request and the established permission path.
- Generated practice must remain grounded in authorized course evidence.
- Moodle/CIS pipeline code stays under `src/custom-skills/moodle/`.
- The adaptive learner remains a single offline HTML file unless its charter is
  deliberately changed.

Read [AGENTS.md](AGENTS.md) before agent-assisted implementation and the Study
Builder charter/spec before changing that subsystem.

## Licensing

Contributions are accepted under the project's MIT License (inbound equals
outbound). By submitting a contribution, you confirm that you have the right to
license it and that third-party material is identified with compatible terms.

All contributors must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Issue labels

The initial taxonomy uses `type:bug`, `type:feature`, `type:docs`, and
`type:security`; `area:runtime`, `area:ui`, `area:artifacts`,
`area:portal-adapter`, and `area:privacy`; `good first issue`, `help wanted`,
`status:needs-reproduction`, `status:needs-design`, and `status:blocked`; plus
`priority:p0` through `priority:p3`. Security reports themselves remain private.
