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

Credentials saved through the desktop interface live in a user-restricted local
secret directory and are excluded from the public source inventory. That store
uses filesystem permissions, not application-level encryption or an operating-
system keychain. Full-disk encryption and a protected OS login remain part of
the security boundary.

Model requests may send prompt and source context to the configured model
provider. Users should review that provider's account terms, retention controls,
and costs before using private course material.

## Analytics

Production analytics are not part of the supported alpha contract and must
remain opt-in and disabled by default. They must not collect credentials,
cookies, private URLs, prompts, course names, source material, generated content,
or student records. Before analytics are enabled for a release, the project must
document the controller/operator, exact event schema, purpose, consent and
withdrawal, retention/deletion, processors, endpoint, access controls, and a
privacy contact.

## Sharing and deletion

Review artifacts before redistribution and confirm that you have the rights to
share included course content. To remove local Study Buddy data, close active
workflows and delete the relevant run directories. Credentials and calendar
URLs must also be revoked or rotated at their source if they were exposed.

Report a privacy or security flaw privately as described in
[SECURITY.md](SECURITY.md).
