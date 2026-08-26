# Stable release readiness

This is the durable, credential-free release handoff for Study Buddy 1.0. A
green result applies only to the exact source commits and artifact hashes in an
assembled release bundle. Earlier candidates are diagnostic evidence, never a
substitute for retesting a changed artifact.

## Current candidate status on 2026-08-26

The active alpha.5 source candidate pins the merged interface commit
`6f53d083ff38429518312d396bd37b95fe48b34a`. The final root commit and both
artifact hashes must be taken from the successful workflow's
`release-manifest.json` and `SHA256SUMS`; they are deliberately not predicted in
this document.

GitHub Actions experienced a major service outage while the candidate was being
prepared. Failed or stuck runs from that incident are not release evidence. A
new exact bundle must complete before clean-VM acceptance resumes.

The preceding alpha.4 Windows artifact passed installation, Study Buddy
identity, official Codex installation, zero-source onboarding, adding four
sources, edit/disable/delete, onboarding completion, configuration persistence,
and restart checks. It failed release acceptance because first launch displayed
an unexpected Windows Defender Firewall prompt. The cause was traced to a
wildcard-interface availability probe; local-only startup now probes
`127.0.0.1` only. That source fix and its tests pass, but the result remains
unverified on Windows until the exact replacement installer is tested.

## Security and privacy evidence

- Saved source usernames, passwords, email identities, bearer calendar links,
  and private source links use per-record AES-256-GCM encryption. A random
  master key is protected with Windows DPAPI or a secure Linux Secret Service
  through Electron `safeStorage`; insecure Linux `basic_text` storage fails
  closed.
- Legacy plaintext source data migrates through a retry-safe, readback-verified
  path before plaintext cleanup. Bootstrap secrets cross the process boundary
  on a dedicated file descriptor rather than arguments, environment values, or
  logs.
- Provider subprocesses receive explicit environment allowlists. Portal
  credentials, arbitrary host secrets, and source credentials are excluded.
- Usage analytics and conversation sharing are separate opt-in categories that
  start disabled. Release builds accept only the public PostHog project token,
  never an administrative token.
- Both public repositories have secret scanning, push protection, Dependabot
  security updates, full-history Gitleaks workflows, and private vulnerability
  reporting. The parent repository has an active default-branch ruleset; the
  interface repository now has an equivalent active default-branch ruleset.
- GitHub currently reports zero open secret-scanning, Dependabot, or CodeQL
  alerts in either repository. The interface CodeQL analysis completed before
  its release PR was merged.
- Previously disclosed credentials were rotated. GitHub Support confirmation
  for historical pull-request refs and cached personal-data views remains an
  external manual item.

## Desktop and updater evidence

- Study Buddy uses its own app identity, state paths, protocol, executable,
  icons, updater cache, and artifact names.
- Onboarding starts with zero sources and supports unlimited
  add/edit/disable/delete behavior.
- Packaged Windows and Linux builds install the official standalone Codex
  runtime without requiring Node.js, Git Bash, WSL, or a developer checkout.
- Browser-backed sources resolve a packaged or installed browser and return an
  actionable `browser-runtime-missing` diagnostic when none is available.
- The updater and download site use the same `HabsaTheDog/StudyBuddy` GitHub
  Release assets. Update checks notify before download, require an explicit
  restart, and reject same-version or older-prerelease offers.
- Windows is intentionally unsigned and must disclose SmartScreen/Unknown
  publisher behavior. Trusted signing remains fail-closed. macOS is outside the
  1.0 support matrix.

## Local verification

The current root candidate passes `npm run check:release`:

- TypeScript typecheck;
- 126 test files, 935 passing tests and 4 intentional skips;
- all local Markdown links and public-tree policy;
- production dependency-license policy and a 31-component CycloneDX SBOM;
- exact public UI-pin verification;
- 13 release-contract and artifact tests; and
- zero high/critical npm audit findings.

The interface candidate passes:

- formatting across 1,647 files and lint across 1,542 files;
- all 13 workspace typechecks;
- the Study Buddy high/critical dependency audit;
- 1,158 tests across the non-server workspaces; and
- 1,274 passing server tests with 5 intentional skips.

The release-lab helper enforces disposable lane identity, clean snapshot
restoration approval, exact in-guest hashes, provenance records, an 8 GiB host
memory floor, and content-bound redaction review. The personal `win11` VM is
never used. Inactive Windows and Fedora lanes remain shut down.

## Remaining blocking gates

1. Complete the exact alpha.5 GitHub bundle and verify every `SHA256SUMS` entry,
   root/UI commit, version, platform, and unsigned state.
2. Restore the disposable Windows 11 baseline and verify the replacement has no
   unexpected firewall prompt, then cover SmartScreen with Mark-of-the-Web,
   identity, source lifecycle, packaged browser runtime, persistence, updater
   no-downgrade behavior, offline messaging, and uninstall retention.
3. Bind Linux acceptance to the exact replacement AppImage in the disposable
   Fedora lane. Earlier Fedora evidence does not prove a new hash.
4. Publish the reviewed prerelease and test the real previous-version in-app
   update while preserving local state.
5. Run one representative generated workflow with the maintainer's authorized
   Codex session and perform the maintainer-only authenticated source checks.
6. Pass the protected parent checks and merge the parent release PR.
7. Obtain GitHub Support confirmation that affected historical pull-request
   refs were dereferenced and cached personal-data views were purged.

## Release decision

The current source candidate is locally clean but is **not yet approved for
publication**. Public v1.0.0 remains blocked until the exact packaged candidates
and the credential-dependent manual gates above are complete. Unsigned Windows
distribution is an explicitly disclosed limitation, not a claim of publisher
identity.
