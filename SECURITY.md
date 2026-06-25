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
