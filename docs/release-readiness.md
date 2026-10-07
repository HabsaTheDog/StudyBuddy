# 0.2.4-alpha release contract

Decision: **BLOCKED — source CI fixture follow-up required; existing packaged bundle is unaccepted.**

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

On `b514412`, Windows serialization and all graph tests passed; Ubuntu and other
required checks passed again. The sole Windows failure was the conflicting
reusable drag/drop clone fixture exceeding the default five-second timeout
(1,809 pass/20 existing skips, 458.45s). Production intentionally spends up to
four seconds checking incomplete or ambiguous widgets; sibling rejection cases
took about 4.24s including Chromium overhead. Only those four negative cases now
have a ten-second test budget. Production readiness and safety stay unchanged;
conflicting-clone tests additionally verify no controls, refusal to fill,
unchanged hidden responses and no final submission. Fresh exact-head CI remains
required. Local drag/drop17/17 (19.70s), root TypeScript and independent review
pass.

On protected `master` commit `0021a20c607bc684d0b884dcadd03303b0504eff`,
[CI run 37549930023](https://github.com/HabsaTheDog/StudyBuddy/actions/runs/37549930023)
passed Ubuntu 1,823/7 existing skips, pinned UI and repository policy, but Windows
passed 1,809/20 existing skips and timed out the real screenshot/keyboard-swap
fixture at its default five-second budget (5,002ms). The same unchanged fixture
passed in 582ms on the preceding PR54 Windows run37548732674. The failure has no
behavioral assertion failure or stage timing, so fixture/resource overhead is the
supported diagnosis, not a proven runtime regression. Only this positive
screenshot test now receives a bounded ten-second allowance; the actual PNG
signature is additionally checked. Existing keyboard response, permission and
no-submission checks remain intact. Focused drag/drop tests pass 17/17 locally
(19.83 seconds), and root TypeScript passes. Independent review and fresh
protected-head Windows CI remain required.

PR55 merged the reviewed screenshot repair at
`f87eaa6f023183c50d35127311085037e5936267`.
[CI run 37601685518](https://github.com/HabsaTheDog/StudyBuddy/actions/runs/37601685518)
passed every other required check but timed out a different drag/drop fixture:
the asynchronous visible-zone test still had the default five-second budget
(5,004ms; Windows 1,809 pass/20 existing skips, 517.55 seconds total). The repaired
real screenshot case passed in 2,430ms; the explicitly bounded readiness
rejection passed in 5,049ms. This demonstrates that per-positive-test budget
repairs did not cover the common real-Chromium fixture lifecycle. The suite now
inherits one finite ten-second budget while retaining the explicit negative
readiness budgets and all image, swap, permission and no-submission assertions.
Every browser fixture starts a loopback server and Chromium, then awaits browser
and server closure in its cleanup path. There is no stage trace proving a runtime
defect or resource leak; Vitest deadlines themselves do not cancel an unfinished
fixture. Production readiness remains bounded at four seconds, and runtime code,
test serialization, assertions, retries and test inclusion are unchanged.
Focused tests pass 17/17 (20.11 seconds), root TypeScript passes, and the test
process exits normally with no new Chromium processes in a before/after process
inventory. This local observation does not establish leak absence in Windows CI.
Independent review, fresh protected-head CI and a rebuilt candidate remain required.

PR56's first
[CI run 37603824007](https://github.com/HabsaTheDog/StudyBuddy/actions/runs/37603824007)
passed drag/drop 17/17 and every other required check, but the real native
attempt-metadata fixture in `quizAttemptGuard.test.ts` timed out at 5,006ms
(Windows 1,809 pass/20 existing skips, 515.25 seconds). This different fixture
starts Chromium, makes five localhost navigations with actual metadata
assertions, then awaits browser/server cleanup. Discovery finds 13 root test
files invoking real browser clients or Chromium, so isolated file allowances
do not cover the shared Windows runner overhead. Root Vitest now uses one
finite ten-second Windows default while Linux retains five seconds and its
existing parallelism. Windows file serialization, explicit test/suite budgets,
all assertions, test selection, retries and production safety deadlines remain
unchanged. This is a test failure deadline, not browser cancellation or proof
that the untraced CI stage is harmless. Local guard+drag/drop tests pass 33/33
serially (20.91 seconds), TypeScript passes, and platform config readback verifies
Windows ten-second/serial versus Linux five-second/parallel policies with
identical inclusion/exclusion and unset retries. The focused process exits
normally with the same before/after Chromium PID inventory. Fresh full Windows
CI, independent review, protected merge and a new merged-source build remain
required; no installer acceptance or promotion follows from these local checks.

## Gates

PR53 merged through protected `master` at
`e449e78b91d5da9315fbf4379f2a739f30abe190`, with a tree identical to reviewed
`39d513d`. All required CI passed: Windows1,810/20 skips, Ubuntu1,823/7 skips,
and pinned UI checks/audit. Packaging run37548167424 failed before building any
installer: root parity tests imported UI modules before the release preflight
installed their workspace dependencies. Move the existing frozen UI install
and audit before `check:release`, preserving every gate, and add a focused
preflight ordering contract. This source follow-up needs protected CI/merge;
the final candidate must be rebuilt from that new merged SHA. No packaged
acceptance or publication has occurred.

PR54 fixed that preflight dependency ordering and merged at `0021a20c`.
[Packaging run37549939939](https://github.com/HabsaTheDog/StudyBuddy/actions/runs/37549939939)
then passed preflight, both installer builds, updater completeness and immutable
unpromoted bundle assembly. Draft publication was skipped. These bytes have no
packaged acceptance, and the failed exact-head Windows CI above prevents their
promotion. The screenshot fixture follow-up needs reviewed protected CI/merge
and a rebuilt candidate from the new merged SHA; retain this existing bundle and
all earlier failed runs as historical evidence.

[Packaging run 37601707996](https://github.com/HabsaTheDog/StudyBuddy/actions/runs/37601707996)
also succeeded on `f87eaa6f`, including preflight, Windows/Linux installers and
the immutable unpromoted bundle; draft publication was skipped. Its failed
exact-head Windows CI prevents acceptance/promotion. Retain both successful
build records and their failed CI evidence. The shared fixture-budget repair
must be reviewed, merged through protected CI and rebuilt from its new merged
SHA before exact-byte Windows/Fedora acceptance; prior bundle checks never
transfer to the new artifact bytes.

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
