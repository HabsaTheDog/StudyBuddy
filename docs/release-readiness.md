# 0.2.4-alpha release contract

Decision: **BLOCKED — preparation in progress; no exact packaged candidate yet.**

- Version/channel: `0.2.4-alpha`, GitHub prerelease; intended website stable
  download promotion only after all exact-byte gates pass.
- Scope: complete accumulated batch plus remote October 6 security/Windows
  integration and local browser pairing; see [inventory](release-inventory-0.2.4-alpha.md).
- Source: isolated `release/0.2.4-alpha`, integrating root remote `24f3c8c`
  and local `b53e2b6`; reviewed merged UI `8e3d0f7e48f2187adf3d106aa662dd5aed9e10e1`.
- Final build must use the reviewed protected `master` commit and reviewed UI pin.
- Supported lanes: Windows 11 x64, Fedora x64. Windows intentionally unsigned;
  warning evidence and disclosure required. macOS excluded.
- User explicitly requested creation/publication and direct website availability.
  Reviewable prepared source merges, build dispatch and website deployment are
  in that scope. Exact candidate-specific disposable snapshot restoration
  approval remains pending under the release lab skill.
- Preserve all public versions and historical `v0.2.3-alpha` tag. Use a new tag.
- Preserve canonical App/UI and Website worktrees and unreviewed legacy work.

## Source validation

Root: 1,825 tests pass/four existing skips after two unchanged-file bounded
retries of broad-run timeouts; TypeScript passes. Initial broad run retained:
1,822 pass, three timeout failures, 158s. Quiz-media retry11/11 (23.65s),
PDF publication retry21/21 (50.69s). Changed web-layout browser checks13/13.
Workflow/security/pairing tools12/12; release contract/assets23/23.
UI: 3,984 pass/five existing skips, all13 typechecks and full format/lint pass;
changed pairing browser20/20. Root licenses/SBOM/public tree/links pass;
root npm10 audit0 vulnerabilities (host npm12 audit has EALLOWSCRIPTS tooling
error), UI audit no high/critical. GitHub open CodeQL/Dependabot/secret alerts0.
Independent App/website review resolves all preparation findings.
Website prepared separately at `404c8b8932023226d7aa10f59d872cfebfdf844f`:
types/build/audit and focused tests pass; synthetic compiled-browser cases pass.
Those local checks do not establish public download acceptance.

## New dependency advisory reconciliation

The final UI pin additionally updates DOMPurify3.4.16, Hono4.13.7 and
ip-address10.7.1. All seven feasible shipped alerts are patched; frozen install,
production audit0 advisories/474 dependencies, workspace security gate,
95 focused tests, seven real-package security assertions, web/server/script
TypeScript and independent lock/advisory review pass. The earlier3984-test UI
result belongs to its parent pin; mandatory exact-head CI must validate this
final dependency graph before packaging.

UI alert245 (`sprintf-js`1.1.3) has no upstream fix and is explicitly deferred:
only the Electron-builder build graph uses it, production dependencies omit it.
Verify absence from the final artifact SBOM and staged production package; do
not dismiss the GitHub default-branch alert or imply it is patched.

## CI fixture correction

Ubuntu CI on `167dd70` failed seven release-contract integration tests because
they requested historical0.2.0-alpha, which the new source/package version guard
correctly rejects. Test fixtures now derive current package version and verify
valid mismatches explicitly; guard behavior remains unchanged. CLI9/9, existing
contract/assets23/23, root TypeScript and independent review pass. The failed
run is retained; fresh exact-head CI remains required.

Windows CI on `9adc95f` passed 1,809 tests with 20 existing platform skips but
timed out the real graph render fixture at 30 seconds. Its log shows concurrent
test files despite the intended shell-forwarded worker limit; Ubuntu and every
other required check passed. Windows file serialization is now enforced in
Vitest configuration. That fixture retains its retry assertions and real
renderer, additionally verifies the PDF signature, and has a 55-second abort
deadline inside a 60-second test budget. Graph33/33 (9.77s), root TypeScript and
five workflow/security tool checks pass locally. Runtime behavior and validation
retry limits are unchanged. Retain the failed run and require fresh Windows CI.

## Gates

Pending: protected-branch CI and security; exact merged
source build; full artifact hashes/manifests; clean Windows/Fedora installed
acceptance including broker/runtime probes, authenticated streamed file thread,
source lifecycle, persistence, failure recovery, identity/coexistence, telemetry,
unsigned warning, updater and cleanup; targeted native PDF/source regression;
scoped changed web-layout regressions; owner testing; website integrity/UX tests
and browser check; public installer download hash equality.

No passing prior source or archived VM result transfers to new artifact bytes.
Dedicated subscription cache is healthy; both calibrated disposable lanes are
powered off and available. Inventory is discovery, not VM acceptance.

## Publication ordering

Assemble unpromoted immutable GitHub bundle, accept exact bytes, publish complete
prerelease, verify public hashes, create reviewed marker bound to manifest and
SHA256SUMS digest, then expose/verify website buttons. Never publish an automatic
pre-acceptance promotion marker. Marker and installer URLs must fail closed on
missing or inconsistent provenance. Website installers remain hosted on GitHub.

## Evidence

Canonical preparation records: `study-buddy-data/releases/0.2.4-alpha-preparation/`.
Historical 0.2.2 public testing record remains in Git history and the immutable
release; archived candidate records retain all earlier failed/blocked evidence.
