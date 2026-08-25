# Stable release readiness

This is the durable handoff for Study Buddy 1.0. It records evidence without
credentials, private source identifiers, or machine-specific paths. A green
result applies only to the commit and artifact hash that produced it.

## Candidate status on 2026-08-25

The source candidate is locally green. Interface PR `HabsaTheDog/t3code#14`
passed Check, Gitleaks, the full test suite, and browser tests, then merged as
`fd2382bad4e2e0dc6b1668f409763d5f944b2ad4`. The root candidate pins that exact
public commit.

This is not yet a completed stable release. Exact draft artifacts still require
GitHub workflow assembly and installed-artifact acceptance on clean Windows 11
and Fedora Workstation lanes.

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

The reusable `study-buddy-release-lab` skill passes Python compilation, Ruff,
the Codex skill validator, 20 tests, and read-only libvirt inventory. It binds
every run to the exact artifact, `release-manifest.json`, `SHA256SUMS`, root/UI
commits, disposable VM baseline, blocking scenarios, and reviewed redacted
evidence.

## Remaining blocking gates

1. Open the root stable PR, pass the protected root CI/security ruleset from a
   recursive checkout, review the final manifest/diff, and merge it.
2. Create the reviewed `v1.0.0` tag and let the protected release workflow build
   and assemble the exact unsigned Windows x64 and Linux x64 draft assets,
   updater manifests, Windows blockmap, embedded Linux blockmap, platform/root
   SBOMs, provenance manifest, and checksums.
3. Provision the disposable Fedora and Windows lanes only after explicit VM
   authorization. Current inventory has one powered-off `win11` guest with no
   guest agent or snapshots, no Fedora guest, and no installer ISO inventory.
4. Run every blocking clean-machine scenario against the exact draft hashes:
   install/launch, identity/icons, zero-source onboarding, unlimited source
   lifecycle, browser source, synthetic calendar/email coverage, opt-in
   telemetry delivery, restart/persistence, offline errors, previous-version
   update, uninstall behavior, and a representative offline HTML request.
   Verify document-tool absence messaging and exercise PDF output separately
   with the documented tools installed.
5. Obtain GitHub Support confirmation that affected historical pull-request refs
   were dereferenced and cached personal-data views were purged.
6. Perform the maintainer-only acceptance that uses real authorized FH accounts;
   never place those credentials or content in VM evidence.

## Release decision

The repository is suitable for stable pull-request review and exact draft
creation after the source PRs merge. Public `v1.0.0` publication is blocked until
the exact Windows/Fedora draft lanes pass and the historical GitHub cache ticket
is confirmed. Unsigned Windows publication is an accepted disclosed limitation,
not a claim of publisher identity.
