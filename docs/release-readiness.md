# 0.2.5-alpha provider recognition hotfix contract

Decision: **PENDING — implementation, exact-source CI and packaged acceptance.**
This is a preparation record, not a release approval.

- Intended version/channel: `0.2.5-alpha`, GitHub prerelease; website stable
  download eligibility only after exact-byte acceptance and promotion.
- Scope: supported existing Codex/Claude installation recognition, consistent
  provider executable resolution and focused setup/refresh/restart regressions.
  Full scope and explicit deferrals are in the [inventory](release-inventory-0.2.5-alpha.md).
- Baseline: public root `ad92542d98c80af19f36ce1799e15bd6bbf80a34`, UI
  `8e3d0f7e48f2187adf3d106aa662dd5aed9e10e1`; dedicated `0.2.5-alpha` worktrees
  preserve the canonical development branches and unrelated work.
- Final source: pending reviewed UI pin, root PR and protected-default merge.
  Build the immutable final candidate from the merged default-branch commit.
- Supported platforms: Windows 11 x64 and Fedora x64. Windows remains unsigned
  with disclosed SmartScreen warning and exact checksums. macOS is unsupported.
- The owner explicitly requested the fix, push, PR and publication. That broad
  publication instruction is recorded; no automatic publication or stable
  promotion occurs before required gates pass.
- Scope-bound disposable snapshot restoration authorization must match the
  eventual version, source commit, artifact SHA, domain and calibrated snapshot.
  Historical 0.2.4 approvals and passing evidence do not certify new bytes.

## Baseline evidence and historical limitations

Public 0.2.4-alpha was published and verified on 2026-10-07 after source/security,
Windows 16/16 and Fedora 17/17 packaged checks plus the required supplements.
Canonical evidence is `study-buddy-data/releases/0.2.4-alpha-preparation/final-ad92542/publication-complete.json`
and `current-readiness.json`. The [archived tracked readiness document](release-readiness-0.2.4-alpha-history.md)
is preserved byte-for-byte; its older pending claims are historical checkpoints,
not the actual final release state.

Retain existing disclosures: unsigned Windows; external PDF tooling and doctor
omission of `pdfinfo`; authenticated packaged email and live Claude subscription
coverage limits; scoped dormant/build-only advisory deferrals; helper-driven
stop diagnostics despite passing normal native close/restart. This hotfix does
not silently close those unrelated findings.

## Gates and recorded status

| Gate | Status | Required evidence |
| --- | --- | --- |
| Focused provider regressions and independent review | Pass (source) | Initial 84 focused cases; review follow-ups pass 101 backend/Claude runtime cases and 15 onboarding browser cases. Independent review cleared custom HOME discovery and legacy metadata compatibility; installed restart remains packaged acceptance |
| Root/UI deterministic source checks | Pass (local) | 23 release cases; 82 Markdown local links, public-tree, licenses, SBOM, root types/audit; UI full check, 13 typechecks and dependency audit pass |
| Protected source CI and security | Pending | Windows/Ubuntu Verify, pinned UI, policy, Gitleaks and CodeQL; reviewed audit dispositions |
| Reviewed UI pushed before root pin | UI pass; root pending | UI `681e38434b1f6873219c06f8c6ede5ac5f6f6e0a` remotely verified; [PR #24](https://github.com/HabsaTheDog/t3code/pull/24); root PR follows |
| Protected default-branch merge | Pending | Final root/UI commits identical to reviewed source |
| Immutable unpromoted package | Pending | Exact build run, manifest, SBOMs, updater payloads and SHA256SUMS |
| Clean Windows installed acceptance | Pending | Exact artifact identity, mandatory scenarios and targeted preinstalled provider regression |
| Clean Fedora installed acceptance | Pending | Exact artifact identity, mandatory scenarios and targeted preinstalled provider regression |
| Owner/publication contract and GO | Pending | Exact-byte decision and required authorization; broad publication instruction already recorded |
| Public release, marker and website verification | Pending | Complete prerelease assets, approved marker, anonymous installer hashes and updater discovery |

No package or installed-app pass is claimed from source tests. The runtime/broker
probes and a real streamed packaged thread remain mandatory on both lanes.
Select expensive model-backed workflows from the actual diff: unrelated
Moodle-to-PDF or HTML campaigns are outside this provider-only regression scope.

## Packaging and publication order

Update every intentional version contract; pass reviewed source checks and merge.
Dispatch `alpha-release.yml` from the final default-branch commit with version
`0.2.5-alpha`, signing false, unsigned acknowledgement true and draft publication
false. Verify artifact `study-buddy-0.2.5-alpha` using the final unpromoted asset
checker. Record exact root/UI provenance, manifest/checksum digests and both
installer hashes before clean Windows/Fedora acceptance.

After a recorded GO, publish complete immutable `v0.2.5-alpha` prerelease assets,
verify the public downloads, then create the reviewed `distribution-ready.json`
marker and verify website selection and updater discovery. Never alter public
0.2.4 bytes or tags. A website source/deployment change is required only if the
existing selector cannot expose the newly accepted promotion contract.
