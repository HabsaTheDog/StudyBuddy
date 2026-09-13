# Published `v0.2.2-alpha` owner-testing release

## Decision — 2026-09-10

**Published for hands-on testing; not promoted to the stable website channel.**
The owner explicitly requested focused automated checks and one installable
Windows/Fedora alpha instead of exhaustive clean-VM acceptance.

Release: https://github.com/HabsaTheDog/StudyBuddy/releases/tag/v0.2.2-alpha

- Root commit: `77b8730a4b1166fdccad3fa4942a11c2930f0445` (PR #49).
- UI commit: `6b6d811264cd896fc2abac48810edf9abac81246` (desktop PR #21).
- Build: https://github.com/HabsaTheDog/StudyBuddy/actions/runs/34491919586
- Root CI: https://github.com/HabsaTheDog/StudyBuddy/actions/runs/34491183059
- Windows: `Study-Buddy-0.2.2-alpha-x64.exe`, intentionally unsigned.
- Fedora: `Study-Buddy-0.2.2-alpha-x86_64.AppImage`.
- macOS remains unsupported.

## Completed

- Combined both unpublished candidates, completed semantic-source work,
  parallel quiz and desktop/runtime fixes, and local Moodle server fixes.
- Fixed Windows path assertions and bounded cold-start integration test
  timeouts without cleanup racing a child process.
- Reproduced and fixed review findings for script-only source navigation,
  generic prepare/complete intent routing and deadline/authorship confusion.
- Local root: 1,161 tests pass, 4 optional tests skipped; TypeScript passes.
- Local UI: 3,325 tests pass, 5 skipped; all 13 workspace typechecks and lint pass.
- Required root/UI GitHub CI, Windows/Linux tests, CodeQL, secret scan,
  repository policy and release dependency audits pass.
- GitHub built both installers and assembled manifests, SBOMs and updater files.
- All local checksums match. All ten GitHub asset hashes and sizes match local
  bytes; anonymous release API and both public download URLs succeed (HTTP 200).
- Static package inspection confirms the Windows x64 payload, Linux x86-64
  identity, version and Study Buddy-specific GitHub updater configuration.
- The replaced 0.2.2 draft and removed 0.2.3 draft have verified local backups.
  Existing public releases are unchanged; the historical 0.2.3 tag is retained.
- No `distribution-ready.json` was published; no website promotion/deployment.
- Original dirty source checkouts and the personal installed app are preserved.

## Exact installer hashes

```text
4bb664fd105f47dc67809bb2921a01b330f28552618d48365944f2b55aaa010e  Study-Buddy-0.2.2-alpha-x64.exe
0dcc4fad61368c0dbf3f495faaedfcc0b60db33bf1d06a139cdabce61ce3bc66  Study-Buddy-0.2.2-alpha-x86_64.AppImage
```

## Explicitly remaining

This is not a claim that all application defects are fixed. Owner testing,
full clean Windows/Fedora VM acceptance, installed update-cycle testing and
real-account Moodle-to-guide acceptance remain pending for these exact bytes.
No new VM snapshot was reverted for this reduced-acceptance publication.

The local Moodle server passes 19 real checks and 16 tooling tests. Safe guest
transport and automated credentials for the unchanged desktop package are still
unfinished; see [Moodle lab](moodle-test-service.md). Keep normal HTTPS/private
network protections intact. Script-only external navigation fails closed.

No further version is published automatically. A public fix must increment the
patch; never overwrite these published assets or retag this version.

The detailed local receipt and superseded draft backups are under
`study-buddy-data/releases/0.2.2-alpha-consolidated/`.
Historical prior-candidate evidence remains in
[the archived candidate record](releases/v0.2.3-alpha-candidate-history.md).
