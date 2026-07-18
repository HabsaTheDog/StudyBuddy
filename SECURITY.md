# Security

## Credentials

Do not commit credentials, API keys, passwords, session storage, Moodle/CIS
cookies, or local-only access tokens.

Use local `.env` files for real values. The repository keeps `.env.example`
files as placeholder templates only.

The root `.gitignore` ignores `.env*` and re-allows `.env.example`. The
`t3code-fork/.gitignore` follows the same pattern.

## Moodle and CIS Access

Moodle and CIS credentials are personal account credentials. Keep them local,
rotate them if they are exposed, and prefer browser storage state files only as
local runtime artifacts.

Never commit downloaded private course material outside the intended
request-specific `output/<request-name>/` artifact directories.

## Local Quiz And Assignment Confirmations

Quiz and assignment confirmation cards are cooperative local UX guardrails.
They make the exact target and requested action visible and reduce accidental
execution. They are not a deterministic security boundary against an agent or
process that already has unrestricted access to the same computer and files.

Study Buddy must not describe these confirmations as cryptographically
enforced, server-verified, or tamper-proof. Final Moodle quiz submission remains
blocked by the workflow policy; users should still review Moodle state and any
assignment files before allowing an action.

## Authenticated Browser Diagnostics

Failure diagnostics redact configured secrets and credential-like URL
parameters. Authenticated page text, HTML, snapshots, and screenshots are not
persisted by default. They can be enabled temporarily with
`STUDY_BUDDY_DIAGNOSTICS_INCLUDE_PAGE_CONTENT=true` or
`STUDY_BUDDY_DIAGNOSTICS_INCLUDE_SCREENSHOTS=true`; those artifacts may contain
personal course data and should be deleted after troubleshooting.
