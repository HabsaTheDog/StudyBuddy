# Pull request integration, 2026-10-06

Scope: repair the existing Study Buddy development PRs and their merge blockers.
This does not freeze, package, publish or accept a release.

## History reconciliation

The published 0.2.2 root/UI changes were squash-merged while the development
branches retained their original history. Merge the published base into the
newer provider branch without discarding subsequent source, quiz or email fixes.
The root source integration retains the published safe external navigation,
bounded acquisition retries, source-task/cache validation, date quotation checks
and preparation/deadline interpretation. Cache proofs use a fresh version.
Current native ownership, original media, first-attempt and final-submission
boundaries remain in force. Historical release notes and unpromoted asset checks
come from the published branch; current development receipts remain intact.

The UI reconciliation retains repository identity caching and the dedicated
runtime-state check. It preserves the current native conversational evidence
contract instead of restoring the older final-message substitution mechanism.

PR #48 has no commits outside #53 and is superseded by that integration. The
repository requires squash merges, linear history and fresh checks against the
current base; resolving history does not permit bypassing those checks.

## Dependency PRs

- Root #36: retain the proposed Codex SDK/runtime pair.
- Root #41: retain workflow updates; replace the Typst prerelease pin with the
  stable v5.3.0 commit in both workflows.
- Root #51: retain the proposed production dependency updates.
- Root #52: retain the proposed development dependency updates.
- All four old root check results predate a high-severity source-map-js advisory;
  refresh only that transitive package to its patched release and rerun checks.
- UI #22/#23 require coherent root/desktop Electron manifests and a regenerated
  frozen lockfile, plus patched dependencies for newly disclosed audit findings.

Public documentation uses redacted example resource links; private captures and
canonical evidence remain under ignored Study Buddy data. Exact pushed commits,
merge state and check results must be verified separately before completion.

## Validation and current handoff

Root integration: TypeScript, package/security contracts, link/privacy/license/SBOM
policies and fresh audit pass. The initial full run exercised 1,801 tests: 1,790
passed, seven failed, four existing skips. Three failures were rendering/wrapper
timeouts on the busy host; three required the coordinated UI checkout; the task
catalogue caught two new navigation calls without operation IDs in one test.
The calls now use existing source-selection/source-verification policies, with
explicit browser assertions. Unchanged serial rendering/wrapper/browser reruns
pass 60/60; coordinated catalogue/navigation reruns pass 18/18. Preserve the
initial failed log rather than describing it as a clean full run.

The newer UI reconciliation passes 123 focused tests, format/lint and all 13
workspace typechecks and the production web/backend build. Its dependency audit and frozen install pass. The native
cache patch was verified with a cold isolated dependency store as well as actual
transitive-package behavioral tests; stale local installed bytes were reimported.

UI PR #23 merged as `8a91a450d4e7db2a2f8d77651ff989eab66524e1` after all required
GitHub checks passed. UI #22 had the identical repaired tree and is closed as
superseded. Its change is integrated, not discarded. Retain the advertised
`67f94a06d6ba572bbbbabc8c8c39158e1589a46e` branch while root dependency PRs pin it.
Root dependency fixes are committed and pushed to their existing PR branches;
fresh required checks and sequential current-base integration remain the gates.
No installation, deployment, release package, tag, release publication or
release acceptance is part of this work. Canonical worktrees may contain unrelated ongoing edits; this
repair is developed and validated in isolated worktrees.

The newer reviewed UI integration is publicly reachable on
`HabsaTheDog/t3code` branch `fix/pr-merge-integration-2026-10-06`, exact commit
`52b87ec6c456be0733eef3d55afcaf7850da70d3`. Push verification precedes the root pin.

## Fresh integration CI repairs

The first fresh #53 run failed on both platforms. Ubuntu exposed missing editor
source in workflow checks and omitted physical PDF pages when montage was
unavailable. Windows also exposed short-name temporary-directory aliases,
Unix-only provider fixtures and paths, and missing `.exe` tool discovery.

Root verification now checks out and installs the exact pinned UI before parity
tests, preserving the explicit Node 22.16 runtime. Profiles use file-URL imports.
PDF review retains every selected page in the existing bounded review, with
adjacent two-image fallback batches; the fixture still asserts all three real
physical pages. Windows tool lookup uses PATHEXT. Portable fixtures retain the
real SDK invocation and account/credential assertions.

Quiz ledger paths normalize ordinary Windows aliases only after explicit
ancestor link checks and directory identity verification. Real links/junctions,
non-directories and replacement during resolution are rejected. Configured and
canonical aliases share the same exclusive reservation and one-time start debit.
Focused helper and guard tests and independent adversarial review pass without
changing first-attempt or final-submission permissions.

Exact CI Typst 0.15.0 PDF/visual regressions pass 19/19; portable fixture suites
pass 51/51; quiz-related suites pass 165/165, with the final helper/guard rerun
23/23. Workflow contracts and coordinated policy parity pass. TypeScript,
repository policies and a zero-vulnerability audit pass. The combined source
suite and fresh platform CI remain separate recorded gates.

Root #52 merged as `22ee81460c77ba5aa9a41cda0d235220cc2f3aad`, and #41 merged as
`23400c2efcdf02412b79b0695477372a94b79f25`, after their fresh required checks.
Both updates are retained in the integration branch; remaining dependency PRs
must receive current-base validation before merging.

The final combined source run uses exact CI Typst 0.15.0 and passes all 181 test
files: 1,808 passed, four existing skips, zero failures (190.85 seconds). The
final package/security contracts pass 4/4. Fresh Ubuntu/Windows GitHub checks
still gate integration; this local result is not packaged release acceptance.

The completed pinned-UI job also exposed missing parent CLI dependencies, an
asynchronous voice test race and a stale quiz instruction assertion. Editor CI
now installs the parent workflow before testing the real broker template route.
The voice test waits for actual provider dispatch before its unchanged transcript
and privacy assertions. The quiz test verifies all seven supported continuation
operations, original grant path/expiry, no replacement start and blocked final
submission. Only UI tests changed: reactor/title suites pass 89/89, instruction
runtime tests 25/25 and the real broker suite 64/64; format/lint and all 13 UI
typechecks pass. Final parent package/provisioning/security contracts pass 5/5.

The reviewed UI test corrections are pushed and advertised as exact commit
`0aae142c9b3948735ba8dd7a40e37f9b2aa264de` on branch
`fix/pr-ci-integration-2026-10-06`, before updating the parent pin. The earlier
52b87 integration branch remains advertised for already-pushed parent heads.
Root #36 merged as `3b1dbed121e6a6a3eb02ceb93cf64b26087dd237`. The integrated SDK
and bundled CLI both verify 0.153.4; all 53 focused SDK/provider tests, TypeScript,
contracts and a zero-vulnerability audit pass after carrying that update forward.
Root #51 preserves both SDK and production upgrades in pushed conflict repair
`ea3d0d5636e21ec7d3244d2850aa1abccca3286a`; its fresh required CI remains pending.

Root #51 merged as `39bcc2baada893a65a692e2569657d1cc5d89e07` after all required
checks passed on its repaired head. The root integration carries all four
merged dependency/workflow PRs forward. Independent final review confirms all
locked dependency identities, executable entrypoints, CI provisioning and the
public UI pin; the staged base merge changes only the manifest and lockfile.

Final combined source validation with the merged production dependencies and
exact CI Typst 0.15.0 passes all 181 files: 1,808 tests passed, four existing
skips, zero failures (228.53 seconds). The real editor/parent CLI broker suite
passes 64/64 with the updated dependencies; final package/provisioning/security
contracts pass 5/5. TypeScript, link/privacy/license/SBOM policies, advertised
UI pin and a zero-vulnerability audit pass. This final integration still needs
fresh current-base GitHub checks before merging #53 and closing superseded #48.

The Windows run on `fb2155f` subsequently exposed 54 quiz failures from retained
operation locks and one catalogue checkout-line-ending mismatch. Node 22.16.0
is the actual runner runtime; the lock symptom matches the upstream
[libuv volume-serial discrepancy](https://github.com/libuv/libuv/pull/4698)
between handle and path metadata APIs. The runner's raw stat values were not
logged, so the upstream mechanism is an inference supported by a controlled
regression, not a captured runner metadata trace.

Quiz lease acquisition/release now compares BigInt path snapshots and binds
ownership to the exact written PID/token. Stale recovery also checks the same
generation before replacement. Exclusive acquisition, live-process protection,
initializing/malformed lock rejection, and link/replacement safeguards remain
enforced. A simulated Windows volume discrepancy fails with the old comparison
and passes with the repair. All 202 affected quiz/browser/permission tests pass
across 11 files (83 seconds); all 16 final portable lease regressions,
TypeScript, repository policies, five package/security contracts and independent
review pass. The catalogue comparison normalizes only CRLF, with five tests preserving rejection
of policy changes, other whitespace and bare carriage returns. Fresh required
GitHub checks still gate the final integration.

Fresh Ubuntu CI on `efd11a0` passes 1,821 tests with seven skips and fails only
the newly added inode-replacement fixture. Its unlink/recreate operation may
reuse the original inode; preallocating a distinct replacement before rename
establishes the intended changed-identity premise. Independent review confirms
this is a fixture correction; all 16 helper tests, 200 repeated replacement
scenarios, TypeScript, policies and diff checks pass. Production lease behavior
is unchanged. Path
snapshots and generation checks do not provide atomic conditional deletion
against arbitrary same-inode mutation or replacement after the final check;
the cooperative exclusive-acquisition/live-process protocol remains enforced.

Windows CI on `efd11a0` passes 1,808 tests with 20 skips; its only failure is
the unsafe 303-final-endpoint redirect browser test reaching the default
five-second test timeout. All earlier lock/catalogue failures are resolved.
The same redirect passed in an earlier Windows run, while neighboring cases
now take up to 2.813 seconds. The log does not identify which browser lifecycle
stage exceeded the budget. Only the two real-browser test groups receive a
bounded 20-second allowance, covering fresh Chromium startup and cleanup as
well as the request checks. Unit budgets, production behavior and all safety
assertions remain unchanged; no automatic test retry is added.

The unchanged local guard baseline passes 59/59 in 6.27 seconds (the formerly
timed-out redirect takes 265 ms). Final browser/safety/client validation passes
105/105 across four files in 8.44 seconds; that redirect takes 295 ms. TypeScript,
repository policies, diff checks and independent review pass. These timings
support intermittent CI lifecycle contention without identifying its exact stage.
