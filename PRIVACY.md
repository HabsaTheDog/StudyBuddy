# Privacy

Study Buddy is designed to run locally. Moodle/CIS credentials, browser state,
calendar feeds, downloaded sources, prompts, diagnostics, and generated study
artifacts may contain personal or institution-restricted data and must remain on
the user's machine unless the user deliberately shares them.

## Local data

Workflow state is stored below `study-buddy-data/`; reviewed deliverables are
published separately. Real `.env` files and browser artifacts are ignored by
Git, but Git ignore is not encryption. Protect the operating-system account,
restrict file access, and delete obsolete run data with an appropriate local
retention policy.

Credentials saved through the desktop interface are encrypted per source with
AES-256-GCM. A random master key is protected with the operating system's
credential service: Windows DPAPI or a secure Linux Secret Service/keyring.
Study Buddy refuses to open the credential store if Linux falls back to
Electron's insecure `basic_text` backend. The protected key envelope and
encrypted records remain local and user-restricted. Full-disk encryption and a
protected OS login remain part of the security boundary because credentials
must exist briefly in process memory while Study Buddy uses them.

Model requests may send prompt and source context to the configured model
provider. Users should review that provider's account terms, retention controls,
and costs before using private course material.

## Analytics

Study Buddy provides two independent, optional sharing controls. Both start off,
and neither option sends activity created before the user enables it. The legal
basis for either transfer is the user's consent. Consent can be withdrawn at any
time in **Settings > Privacy & Data**.

**Usage analytics** may include the Study Buddy version, operating system,
feature and screen outcomes, coarse click coordinates, and identifiers assigned
to explicitly marked interface controls. It excludes session replay, exact page
addresses, text input, page or course content, mouse movement, scrolling, voice
transcripts, passwords, file contents or paths, names, email addresses, and
sign-in details.

**Conversation sharing** may include user messages, final assistant replies,
explicit response feedback, model/provider identifiers, timing and outcome,
redacted run-log summaries, and the names, relative paths, extensions, and
change counts of files reported as created or changed. It excludes credentials,
private instructions, hidden reasoning, raw tool or terminal output, file and
attachment contents, and absolute paths. Text and metadata pass through a
privacy filter, but users should still avoid sharing secrets or material they
are not allowed to disclose.

Shared data is sent to the project's private PostHog-compatible service at
`https://studybuddyanalytics.habsa.at`. Session replay is disabled. The
controller is Alvaro Schroll (`dev.habsa@gmail.com`). Shared usage and
conversation records are retained for up to one year. Failed transfers wait in
a size-limited local outbox for at most 30 days; disabling a category deletes
unsent records in that category. The public project token embedded in release
builds is an ingestion identifier, not an administrative credential.

## Sharing and deletion

Review artifacts before redistribution and confirm that you have the rights to
share included course content. To remove local Study Buddy data, close active
workflows and delete the relevant run directories. Credentials and calendar
URLs must also be revoked or rotated at their source if they were exposed.

For access, correction, restriction, portability, objection, or deletion
requests concerning shared analytics, email `dev.habsa@gmail.com` and include
the Study Buddy installation ID shown in Privacy & Data settings when available.
Never include passwords or sign-in codes in the request.

Report a privacy or security flaw privately as described in
[SECURITY.md](SECURITY.md).
