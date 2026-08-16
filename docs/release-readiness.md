# Release readiness

This is the durable handoff for the first public alpha. It records verified
repository state without containing credentials, private portal identifiers, or
local artifact paths. Update it when a gate changes; do not treat an old green
result as proof for a later commit.

## Current release-branch verification on 2026-08-16

- The interface release branch integrates the governed source/email feature,
  rejects private or loopback IMAP destinations, schema-validates persisted
  source records, and keeps local source secrets owner-readable only. The
  documented security boundary is operating-system account isolation plus
  full-disk encryption; the project does not claim fake application encryption
  with an adjacent key.
- The desktop updater uses `HabsaTheDog/StudyBuddy` GitHub Releases for Stable,
  Alpha, Beta, and Nightly tracks. It checks after startup, then every six hours,
  and on demand; it notifies before download and requires an explicit restart.
  Electron updater metadata binds downloads with SHA-512.
- Real Electron first-run/settings acceptance passed. The Alpha track round-trip
  reached the main-process updater state, and development builds correctly
  disable install actions.
- A full Node 22.16 Linux alpha build produced the branded AppImage and
  `alpha-linux.yml`; the manifest SHA-512 matched the executable. The packaged
  app started its bundled backend, created its main window, selected Alpha, and
  performed the delayed GitHub check.
- An isolated packaged `0.1.0-alpha.1` to `0.1.0-alpha.2` simulation fetched the
  local Alpha manifest, detected the newer release, and remained notify-first
  without auto-downloading.
- The interface workspace passes all typechecks and tests: server 1,259 passing
  (5 skipped), web 1,155 passing, desktop 118 passing, and all supporting
  packages green. Release smoke, formatting/lint, Gitleaks, and local dependency
  audits pass.
- The public interface tree removes 3,438 tracked external reference files
  (about 52 MB and 899,812 lines) that were never built or shipped. Optional
  local clones are ignored. The remaining vulnerable development-only routing
  dependency is overridden to patched `path-to-regexp` 6.3.0.
- The root release branch removes generated promotional media, caches, bundled
  binaries/fonts, and the foreign file-viewer gitlink. The root now passes
  TypeScript and 123 test files: 902 tests pass and 4 are skipped.
- The final evidence-adaptive pipeline review is integrated: finite authorized
  source selections drain across operational batches, verified request
  contracts remain immutable, evidence summaries allocate space across sources,
  safe adapted practice is reviewed honestly, course hierarchy labels are
  preserved, and mobile/math regressions are covered.
- Interface pull request `HabsaTheDog/t3code#10` passed its build/typecheck,
  dependency audit, Gitleaks, unit, and browser gates and was squash-merged as
  `94d975a45d48cded9ef23cebf36dc48f4cd15583`. The root release branch pins that
  exact public commit as the `t3code-fork` gitlink.

## Verified locally and on GitHub on 2026-08-14

- The public root history was rewritten, every reviewed writable branch and tag
  now points only to the cleaned history, and the old local root object database
  was removed after a verified fresh migration. GitHub Support has been asked to
  dereference the affected pull-request refs and purge cached views.
- The maintainer confirmed rotation of the previously disclosed credentials.
  No signing credentials are currently stored in the release environment.
- The permanent `master` ruleset requires pull requests, the seven release and
  security checks, resolved review conversations, CodeQL high/critical blocking,
  and prevents deletion and non-fast-forward updates without a bypass.

- Root history: all 798 reachable commits/refs scanned with Gitleaks, with no
  findings. Exact configured local secret values were not present in the public
  branch histories.
- Interface-fork history: all 6,182 reachable upstream/fork commits scanned.
  Eighty-nine findings in 18 already-public upstream commits were classified as
  fixtures/audit material and captured as exact fingerprints; the reviewed
  baseline leaves every new or changed finding blocking.
- Root and fork child-process environments now use explicit allowlists. Moodle,
  CIS, source-secret, arbitrary host, and provider secrets do not enter Codex
  shells or provider subprocesses.
- Generated shell snapshots/provider logs containing the locally configured
  portal password were securely removed. Canonical study runs and deliverables
  were not deleted. Local data, cache, and browser-state roots are restricted to
  the operating-system user.
- Root release policy covers type checking, the full test suite, Markdown links,
  public-tree policy, production licenses, CycloneDX SBOM generation, and the
  production npm audit.
- The interface fork passes a clean detached-checkout install from its frozen
  lockfile without private registry credentials. It also passes formatting/lint,
  all shipped-workspace typechecks and tests, the dependency audit, and a
  production web/server/desktop build. The generated main, server, and preload
  bundles are non-empty and the preload bridge contract is present.
- Electron is pinned to 41.10.3, electron-updater to 6.8.9, and vulnerable
  shipped Undici/fast-uri versions are overridden to patched releases. No
  high/critical advisory remains in the Study Buddy desktop/server release
  path.
- Upstream T3 release, relay deployment, mobile-preview, issue-label, PR-size,
  and vouch workflows are inert in the fork. Fork CI uses GitHub-hosted runners;
  checkout/setup/secret-scan actions used by active Study Buddy automation are
  commit-pinned.
- Root `master` pins the reviewed public interface commit. Root CI revalidated
  repository policy, the interface workspace, CodeQL, and secret scanning on
  Linux, macOS, and Windows after that pin was merged.
- The source-tree desktop app starts with Study Buddy identity and dedicated
  state, and binds its development frontend and backend to loopback only.
- Quick Chats use unique thread-named workspaces, unique deliverables roots, and
  thread-scoped provider environment values. A concurrent-workspace regression
  test protects this output-isolation boundary.
- The root release gate passes 886 tests (four skipped), 420 public-path policy
  checks, Markdown-link validation, production-license policy, a 31-component
  CycloneDX SBOM check, and a zero-finding npm audit.
- The interface fork now exposes the reviewed `study-buddy` branch as its
  default, uses squash-only merges with automatic branch cleanup, disables its
  unused wiki, and has private vulnerability reporting, secret scanning/push
  protection, and Dependabot alerts/security updates enabled.
- An unsigned Linux x64 AppImage was built from the pinned interface workspace,
  started with the Alpha identity, bound its backend to loopback, reached
  `backend ready`, and created its main window. Signed and clean-machine
  platform installation remain separate gates.
- A clean recursive clone of root `18e3acda86209a63e6f00e57465e01b114a9f761`
  and interface `0637829b60ba4d425184a72032431604249158be` passed the
  full root release gate. The README synthetic no-portal workflow then exposed
  and verified a fix for local-source evidence identity: its repeated run
  finished successfully with an empty error log, 817,857-byte offline HTML,
  semantic review, and all four required browser viewports passing.

## Remaining release blockers

1. Confirm that GitHub Support has dereferenced the affected pull-request refs
   and removed cached views containing the historical personal data.
2. Let all root GitHub security/release checks pass from a recursive checkout.
3. Complete SignPath Foundation onboarding and provide the organization ID,
   project slug, signing-policy slug, artifact configuration, and protected
   submitter token so the reviewed Windows signing job can replace the current
   fail-closed gate. macOS is not part of this alpha.
4. Build and inspect the unsigned Windows x64 alpha artifact, then repeat manual
   synthetic smoke tests on every platform claimed in the
   prerelease notes and install the exact draft artifacts on clean machines.
5. The disabled upstream mobile, marketing, and relay directories are excluded
   from the default pnpm workspace, frozen lockfile, audits, artifacts, and
   deployments. Reintroduce them only with an explicit product decision, public
   dependency resolution, and their own clean security review.
6. The active adaptive path is free of fixed subject-template decisions and its
   contract/portability regressions pass. Complete the two documented fresh
   standalone Balanced rounds for DYN2 and Business English before claiming
   broader generic course support.

## Release decision

The source tree is suitable for continued public alpha hardening. A binary
release is **not yet authorized**. Publication requires GitHub Support cache
closure, clean-machine Linux/Windows validation, and the signed Windows artifact
path.
