# Third-party, privacy, and analytics disclosure

## T3 Code

Study Buddy's user interface is a modified fork of the open-source T3 Code project. T3 Code is copyright T3 Tools Inc. and licensed under MIT. Its license and notices remain in `t3code-fork/`. The submission does not claim the base T3 chat, provider, workspace, or desktop shell as original Study Buddy work.

Study Buddy's contribution includes education-specific workflows, settings, execution profiles, permissions, artifact handling, and integration with the canonical Moodle/CIS runtime.

## Open-source dependencies

The root project uses the OpenAI Codex SDK, LangGraph, Playwright, Commander, dotenv, ical.js, Zod, TypeScript, Vitest, Typst, Poppler, and vendored Typst packages. Package versions are recorded in lockfiles. Vendored Typst licenses remain next to their source. See the root `THIRD_PARTY_NOTICES.md`.

## Moodle, CIS, calendars, and course data

Moodle, CIS, and institutional names are used descriptively to explain compatible integrations. Study Buddy is independent and is not affiliated with or endorsed by those services or institutions.

Users are responsible for using accounts and data they are authorized to access. The submission must not redistribute real course files, quiz questions, personal schedules, private portal URLs, or calendar bearer links unless the appropriate rights holder has expressly authorized that use.

Hackathon showcase material should therefore be synthetic, created by Alvaro, openly licensed with attribution, or covered by written permission. Plain-text mention of an integration does not authorize copying its logo, interface, or protected content into the video.

## Credentials and test access

Credentials are never stored in the public repository. Git-ignore is not a security boundary for uploaded ZIP files. A live judge account should be purpose-limited, restricted to safe demo data, permitted by the institution, and rotated after the judging period.

Personal student accounts and long-lived calendar feed URLs should not be used as public demo credentials. A calendar URL containing a private token is a bearer secret and should be revoked if disclosed.

## Local data

Study Buddy stores canonical workflow data under `study-buddy-data/` in request-specific directories. Authenticated screenshots and page contents are disabled by default. Deliverables are published outside the internal run area only when explicitly selected.

## Opt-in analytics

The product contains content-free operational telemetry foundations, but the production tracking setup is not yet complete. Analytics will remain disabled unless a student explicitly opts in. The design permits measurements such as model/provider, reasoning effort, elapsed time, task count, status, categorical task type, and token totals.

The analytics boundary excludes:

- prompts and task descriptions;
- names of courses, institutions, people, or assignments;
- Moodle/CIS/calendar URLs and local paths;
- downloaded source data;
- quiz questions and answers;
- generated study-document content;
- credentials, cookies, tokens, and browser storage state.

Before the September 2026 student alpha, the consent flow, retention period, deletion process, analytics endpoint, production access controls, and end-to-end exclusion of educational content must be completed, documented, and verified.

## Video material

The demo should use Study Buddy-owned branding, a synthetic or authorized course, and narration without copyrighted background music. Third-party logos, private portal screens, student records, and copyrighted course material should be excluded unless permission is documented.
