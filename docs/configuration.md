# Configuration

Copy `.env.example` to `.env` and keep real values local. Optional machine-only
overrides go in `.env.local`; it takes precedence. Both files contain plaintext
secrets and must never be committed, attached to an issue, or included in an
archive.

## Portal connection

- `MOODLE_BASE_URL`, `MOODLE_DASHBOARD_URL`: authorized Moodle origin/pages.
- `MOODLE_USERNAME`, `MOODLE_PASSWORD`: optional local login credentials.
- `MOODLE_STORAGE_STATE`: optional local browser state file; protect it as a
  credential.
- `MOODLE_LOGIN_ALLOWED_ORIGINS`: explicit extra login/SSO origins.
- `CIS_*`: FH Technikum CIS adapter equivalents.
- `CIS_CALENDAR_URL`: private iCalendar bearer URL; revoke it if disclosed.

The application treats a configured calendar URL as write-only: the server
returns only whether one is configured. The plaintext environment value remains
a legacy local configuration path pending migration to the source credential
broker.

The shipped portal URLs describe the initial FH Technikum adapter. Other Moodle
sites should replace them and may require selectors or adapter work. CIS is not a
generic student-information-system interface.

## Safe quiz defaults

`MOODLE_QUIZ_ACCESS_MODE=review-only` and
`MOODLE_QUIZ_AUTO_ANSWER=false` are the supported defaults. More capable modes
must be chosen deliberately for an explicit quiz-assistance request. Final
submission is blocked in all modes and must not be made configurable.

## Browser and diagnostics

- `MOODLE_HEADLESS`: use `false` to show the browser.
- `MOODLE_STORAGE_STATE`, `CIS_STORAGE_STATE`: local credential-bearing files.
- `STUDY_BUDDY_DIAGNOSTICS_INCLUDE_PAGE_CONTENT` and
  `STUDY_BUDDY_DIAGNOSTICS_INCLUDE_SCREENSHOTS`: keep `false` unless a short,
  controlled diagnostic explicitly needs them.

Authenticated page text and screenshots may expose student and course data even
after credential strings are redacted.

## Runtime and artifacts

The runtime-limit, concurrency, rendering, visual, and native-tool overrides in
`.env.example` are optional. Unset or zero concurrency limits allow independent
workspaces to progress; positive values impose a machine-wide ceiling.

Use `npm run moodle:doctor -- --version-only --json` to inspect resolved native
tools without accessing Moodle or CIS. Full authenticated preflight may contact
the configured model provider and require a Codex login.
