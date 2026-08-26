# Stable release readiness

This is the durable handoff for Study Buddy 1.0. It records evidence without
credentials, private source identifiers, or machine-specific paths. A green
result applies only to the commit and artifact hash that produced it.

## Candidate status on 2026-08-26

The current alpha candidate is root commit
`07e57c30fa31ab62802f70d3d966d2dfda684223`, pinning interface commit
`dd1e7662305d002f8bcf56d232bea6f55d3231b4`. GitHub Actions run
`32957438007` passed preflight, Windows and Linux builds, and immutable bundle
assembly for `0.1.0-alpha.3`. All nine checksum entries in that assembled bundle
were verified.

The exact unsigned Windows installer was accepted on the disposable clean
Windows 11 lane with SHA-256
`7a5b8990a47e7ee2c15ab72a6b59b34918057bcfc218cbe6b3b7e88e268e1d5d`.
Eleven of thirteen blocking scenarios passed. Previous-version in-app update is
blocked until this exact candidate is available on the public prerelease
channel, and the representative generated workflow remains blocked until the
maintainer supplies a real authorized Codex session. Neither blocked gate is
reported as a pass.

## Security and privacy evidence

- Saved source usernames, passwords, email identities, bearer calendar links,
  and private source links use per-record AES-256-GCM encryption. A random
  master key is protected with Windows DPAPI or a secure Linux Secret
  Service/keyring through Electron `safeStorage`; insecure Linux `basic_text`
  storage fails closed.
- Legacy plaintext source data migrates through a retry-safe, readback-verified
  path before plaintext cleanup. The key envelope and state directory use
  owner-only permissions. Bootstrap secrets cross the process boundary once on
  a dedicated file descriptor, not in arguments, environment values, or logs.
- Root and interface child-process environments use explicit allowlists. Portal
  credentials, source secrets, arbitrary host values, and provider secrets do
  not enter Codex or provider subprocesses.
- Usage analytics and conversation sharing remain separate opt-in categories
  that start disabled. Release builds require a public `phc_` PostHog project
  token and reject `phx_` administrative tokens.
- The maintainer confirmed rotation of previously disclosed credentials. The
  rewritten public root history and writable refs were rescanned without a new
  production-secret finding. GitHub Support confirmation for historical pull
  request refs/cached personal-data views remains external and unresolved.

## Desktop and updater evidence

- Stable builds use Study Buddy-only app identity, state paths, protocol,
  executable names, icons, updater cache, and artifact names. Stable branding
  no longer inherits the Alpha suffix.
- Onboarding starts with zero sources. The source inventory supports unlimited
  add/edit/disable/delete behavior, including the Windows stale-state edit path
  reported during Alpha testing.
- Release artifacts bundle the canonical workflow tree, byte-identical root
  `package.json`/`package-lock.json`, production `tsx`, the platform-specific
  esbuild package, native Codex 0.147.0, and cross-platform task/watchdog shims.
  Windows does not require a developer checkout, Node.js, Git Bash, or WSL.
- Browser-backed sources resolve an explicit browser, Edge, Chrome, or Chromium
  and fail with an actionable `browser-runtime-missing` diagnostic. Typst,
  Poppler, and LibreOffice are accurately documented as capability-specific
  external document tools; offline HTML output does not depend on them.
- The in-app updater and download website use the same
  `HabsaTheDog/StudyBuddy` GitHub Release assets. Stable builds use `latest.yml`
  and `latest-linux.yml`, notify before download, and require an explicit
  restart.
- Windows 1.0 is intentionally unsigned and must disclose SmartScreen/Unknown
  publisher warnings. Trusted signing remains fail-closed. macOS is outside the
  1.0 support matrix.

## Local verification

Root `npm run check:release` passes on the candidate lineage:

- TypeScript typecheck;
- 126 test files, 920 passing tests and 4 intentional skips;
- 44 Markdown files with valid local links;
- 441 public-tree paths;
- production license policy;
- a 31-component root CycloneDX SBOM;
- 13 release-contract/asset tests; and
- zero npm audit findings.

The interface candidate passes formatting/lint, all 13 workspace typechecks,
the Study Buddy dependency audit, and the complete workspace test suite:

- desktop: 124 tests;
- web: 1,158 tests;
- server: 1,273 passing and 5 skipped tests; and
- all supporting package suites green.

A merged-code Linux 1.0.0 AppImage dry run also passed extraction and runtime
smoke checks: root package and lock files were byte-identical, native Codex and
esbuild were present, the bundled doctor reported Codex 0.147.0, the desktop
SBOM contained 291 components, the PostHog admin-token scan was empty, the
updater SHA-512 matched, and the embedded AppImage block map parsed as version 2
with 15,072 chunks. This dry run proves the packaging path, but it does not
replace acceptance of the exact GitHub draft hashes.

The Windows-only `study-buddy-release-lab` skill passes Python compilation,
Ruff, the Codex skill validator, 26 tests, and read-only libvirt inventory. It
binds every run to the exact artifact, `release-manifest.json`, `SHA256SUMS`,
root/UI commits, disposable VM baseline, blocking scenarios, and reviewed
redacted evidence. Linux acceptance runs directly on the Fedora host and does
not require a duplicate Fedora VM.

## Remaining blocking gates

1. Review and merge the current interface and root release branches through the
   protected repository rules from a recursive checkout.
2. Run the exact Linux AppImage from the assembled `0.1.0-alpha.3` bundle on the
   Fedora host, including launch, identity, updater, and package/runtime smoke
   checks. Host-native Linux evidence must remain bound to the same manifest and
   checksums as the Windows run.
3. Make the reviewed alpha candidate available through the prerelease channel,
   then test the real alpha.2-to-alpha.3 in-app update while preserving local
   state. The already-tested alpha.3 build must continue to refuse an alpha.2
   downgrade.
4. Run one representative generated workflow on Windows with the maintainer's
   real authorized Codex session. Keep the disposable VM free of FH credentials
   and production course data.
5. Obtain GitHub Support confirmation that affected historical pull-request refs
   were dereferenced and cached personal-data views were purged.
6. Perform the maintainer-only acceptance that uses real authorized FH accounts;
   never place those credentials or content in VM evidence.

## Release decision

The exact Windows alpha candidate has passed every credential-independent gate
that can be completed before publication. Public `v1.0.0` remains blocked until
the host-native Linux lane, real update path, authorized representative workflow,
and historical GitHub cache ticket are complete. Unsigned Windows publication
is an accepted disclosed limitation, not a claim of publisher identity.
