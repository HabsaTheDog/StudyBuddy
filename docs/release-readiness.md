# Consolidated `v0.2.2-alpha` test release

## Contract — 2026-09-10

The owner requested **one installable Windows/Fedora test alpha**, including
the other agent's completed work and this thread's fixes. Both previous
`v0.2.2-alpha` and `v0.2.3-alpha` releases are unpublished drafts; consolidate
them into `v0.2.2-alpha` without altering any public release.

The latest owner instruction explicitly reduces acceptance for this publication:
run relevant deterministic checks, CI/security and exact-artifact integrity,
then publish for hands-on testing. Do not claim full clean-VM, real-account
Moodle-to-guide, or production readiness. **No stable website promotion.**
The owner has authorized the GitHub publication; no new VM reset is authorized.

## Included source

Desktop PR #21 is merged after all required GitHub checks passed:
`6b6d811264cd896fc2abac48810edf9abac81246`.
The owner refreshed GitHub authorization and the release branch push succeeded.
Root CI/merge and the exact packaging run are the next gates. No new release
or stable website promotion has occurred.

Work happens in isolated `release/consolidated-0.2.2-alpha` worktrees. Original
dirty checkouts remain untouched.

- Root: combine `bcd1aba` parallel quiz work, `e2285fa` completed semantic
  source reliability and dependency work, and the local Moodle server fixes.
- UI: combine `382f4f1b3` completed workflow/reconnection/dependency work
  with the owner's finished desktop/runtime changes (checkpoint `adc3fd0c4`).
- Preserve source-origin validation, credential redaction, native quiz approval
  and the prohibition on final quiz submission.
- Fix Windows cache-test assertions to use platform-native paths and apply
  POSIX permission assertions only where those bits represent permissions.

## Current evidence

- [x] Root TypeScript and 1,146 tests pass; 4 optional tests skipped.
- [x] UI formatting/lint and all 13 workspace typechecks pass.
- [x] UI release dependency audit has no high/critical findings.
- [x] Root dependency audit has no findings; links, public-tree and license checks pass.
- [x] Release contract/asset tests pass, including unpromoted-alpha integrity.
- [x] Real local Moodle server: 19 checks and 16 tooling tests pass; see
  [Moodle lab](moodle-test-service.md).
- [x] UI tests: 3,325 pass; 5 skipped.
- [x] Desktop PR #21: required CI, tests, CodeQL and Gitleaks pass; merged.
- [ ] Complete root remote CI/security checks.
- [ ] Merge root/UI source and record exact default-branch commits.
- [ ] Build the exact Windows NSIS and Linux AppImage bundle in GitHub Actions.
- [ ] Verify manifest, hashes, updater payloads, signing disclosure and package contents.
- [ ] Replace the unpublished draft deliberately; retain old provenance.
- [ ] Publish one GitHub prerelease, verify public downloads and retire redundant draft.

## Explicit limitations

Windows is intentionally unsigned. macOS is unsupported. No claim is made that
all application defects are fixed. Owner testing, full clean Windows/Fedora VM
acceptance, updater installation and real-account Moodle-to-guide acceptance
remain pending for these new bytes.

The local Moodle **server** is verified and stopped when unused. Safe guest
transport and automated credential entry for the unchanged desktop package are
not finished; do not weaken normal HTTPS/private-network protections to claim
a test pass. This is tracked separately from the test-alpha publication.

Publication must omit `distribution-ready.json`; the website's previously
approved download remains unchanged. Build automation must not create a
stable-channel approval simply because compilation passed.

The root ruleset's obsolete required macOS check was removed to match the
Windows/Linux source matrix; all security checks, review/merge restrictions
and bypass settings are unchanged. Prior ruleset JSON is retained in ignored
local release evidence. The matching workflow change is included in this branch.

Historical candidate evidence remains in
[the archived candidate record](releases/v0.2.3-alpha-candidate-history.md).
Old hashes/passes do not certify this rebuilt version.
