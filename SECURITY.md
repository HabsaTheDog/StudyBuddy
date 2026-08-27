# Security Policy

## Supported versions

Security fixes are applied to the current default branch and the newest public
release. During the 1.0 release-candidate period, the newest prerelease is the
only supported binary. Older releases, commits, and untagged snapshots are not
supported.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or include credentials,
student data, private portal URLs, or exploit details in public discussions.

Use GitHub's **Report a vulnerability** form on the repository Security page.
If the form is unavailable, open a minimal public issue asking the maintainer to
enable a private channel, without disclosing technical details.

Include the affected commit/version, impact, reproduction steps using synthetic
data, and a suggested remediation if known. Remove live secrets, cookies,
authenticated screenshots, course content, and student records from evidence.

The maintainer will acknowledge reports when practical, investigate privately,
coordinate a fix and advisory, and credit reporters who want attribution. No
fixed response SLA is promised. Please allow reasonable remediation time before
public disclosure.

## Credential and data incidents

Treat portal passwords, storage state, cookies, API tokens, private calendar
feeds, cloud-link URLs, and local key pairs as secrets. If one is exposed:

1. revoke or rotate it at the source immediately;
2. preserve only the minimum evidence needed for investigation;
3. determine whether it entered Git history, checkpoint refs, logs, archives,
   screenshots, releases, or third-party systems;
4. remove or rewrite affected published history where appropriate, recognizing
   that history rewriting does not undo prior disclosure;
5. notify affected operators or users when required.

Never distribute a ZIP of a working directory. Create releases from a clean
clone or reviewed `git archive`; ignored local files are not safe merely because
Git does not track them.

## Security boundaries

- Real `.env` files, browser state, diagnostics, `study-buddy-data/`, downloads,
  and generated artifacts are local-only.
- Credential entry is restricted to the in-process browser broker; URL-embedded
  credentials are rejected.
- Authenticated page content and screenshots are not persisted by default.
- Quiz confirmation cards are cooperative local safeguards, not cryptographic
  isolation from a process that already controls the machine.
- Final Moodle quiz submission is blocked by policy in every access mode.
- Users must access only accounts and material they are authorized to use.

See [PRIVACY.md](PRIVACY.md) for local data and analytics policy and
[docs/security-and-data-handling.md](docs/security-and-data-handling.md) for
operational guidance.
