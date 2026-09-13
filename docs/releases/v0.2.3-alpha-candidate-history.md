# `v0.2.3-alpha` release readiness

This is the durable, credential-free handoff for the current corrective Study
Buddy alpha. A green result applies
only to the exact source commits and artifact hashes in the final assembled
bundle. Rebuilding any artifact invalidates its previous packaged acceptance.

The `1.x` version line remains reserved for the future stable release. Earlier
public `v0.1.0-alpha.1` and `v0.1.0-alpha.2` releases are historical technical
previews; unpublished build attempts do not consume additional public versions.

## Release contract

- Version/tag: `0.2.3-alpha` / `v0.2.3-alpha`
- GitHub state: prerelease
- Platforms: Windows 11 x64 and Linux x64
- Windows signing: intentionally unsigned with SmartScreen disclosure
- macOS: not shipped
- Source of downloads and updates: `HabsaTheDog/StudyBuddy` GitHub Release assets
- Website promotion: only after the explicit distribution-ready contract and
  both exact packaged lanes pass
- Decision states: `go`, `no-go`, or `blocked`

The final root commit, UI commit, filenames, sizes, and hashes must come from
the successful workflow's `release-manifest.json` and `SHA256SUMS`; they are not
predicted in this document.

## Security and privacy baseline

- Saved source usernames, passwords, email identities, bearer calendar links,
  and private source links use per-record AES-256-GCM encryption. The random
  master key is protected through Windows DPAPI or Linux Secret Service via
  Electron `safeStorage`; insecure Linux `basic_text` storage fails closed.
- Provider subprocesses receive explicit environment allowlists. Portal
  credentials and arbitrary host secrets are excluded.
- Usage analytics and conversation sharing are independent opt-in categories
  that start disabled. Release builds accept only the public PostHog project
  token, never an administrative credential.
- Root and UI repositories use secret scanning, push protection, Dependabot,
  CodeQL, full-history Gitleaks, and protected default branches.
- Previously disclosed credentials were rotated. GitHub Support confirmation
  for historical pull-request refs and cached personal-data views remains an
  external maintainer item and is not represented as complete without the
  support response.

## Product baseline already established

Earlier exact candidates demonstrated the intended Study Buddy identity,
zero-source onboarding, more-than-three source management, edit/disable/delete,
browser-backed source checks, optional telemetry delivery, restart persistence,
offline recovery, Windows SmartScreen behavior, and Fedora AppImage execution.
Those runs are regression evidence only; they do not approve new
`0.2.3-alpha` bytes.

The release-lab now additionally requires ChatGPT subscription authentication,
a real streamed response in a newly created packaged desktop thread, bounded
synthetic file read/edit/create operations, credential cleanup, and restoration
of the calibrated Windows `clean` and Fedora `clean-wallet` snapshots.

## Required gates

1. Merge the reviewed root release changes through the protected default branch
   with the exact public UI submodule pin.
2. Complete root and UI typecheck, test, lint/format, dependency audit, license,
   SBOM, public-tree, link, submodule, secret-scan, and CodeQL gates.
3. Build the exact `0.2.3-alpha` Windows and Linux bundle from the final tagged
   default-branch commit. Verify all manifest, checksum, updater, SBOM, version,
   platform, and unsigned-state claims.
4. Complete full-setup packaged acceptance in the disposable Windows and Fedora
   VMs, including subscription auth and the representative real thread/file
   workflow. Any mandatory blocked scenario prevents publication.
5. Prove updater no-downgrade behavior and update from an earlier public alpha
   into the exact candidate while preserving intended local state.
6. Stage a complete reviewed GitHub draft with the correct prerelease flag,
   release notes, expected platform assets, checksums, provenance, SBOMs, and
   distribution-ready marker.
7. Verify the website rejects drafts/unpromoted releases, accepts the promoted
   alpha, preserves the Windows warning, and resolves both platform buttons to
   the exact approved GitHub asset URLs.
8. Obtain explicit maintainer approval immediately before making the GitHub
   draft public and deploying/activating website promotion.
9. After publication, download through the public path, compare SHA-256, verify
   updater discovery, and complete a bounded smoke test.

## Current decision

Status (2026-09-08): **blocked for publication: targeted Moodle-to-artifact
acceptance has no recorded successful result**.

- Root commit: `0b039abc16b5feb084c8f8c23ac1edfb9f10755d`.
- UI commit: `24b13681688d3994329ff222759078dd349d812e`.
- Build: [33491078741](https://github.com/HabsaTheDog/StudyBuddy/actions/runs/33491078741), successful.
- Root commit checks: successful, including repository policy, pinned UI,
  Windows/Linux verification, Gitleaks and CodeQL.
- Windows installer SHA-256:
  `3b2f6e1e46046d61e7a2852b69efa399689e69c544e95c2736dfbf5849080ef6`.
- Linux AppImage SHA-256:
  `13f22eeecf3c86da8011eb3378f3c7e4f4c2521e375902b01d301ca159629820`.
- Windows standard packaged acceptance: **pass**, 16 scenarios.
- Fedora standard packaged acceptance: **pass**, 17 scenarios.
- Both lanes exercised subscription-authenticated synthetic file operations,
  packaged source-broker/runtime probes, source lifecycle, telemetry,
  persistence and an upgrade from public `0.2.1-alpha` to these exact bytes.
- Windows was restored to `clean`; Fedora was restored to `clean-wallet` and
  booted to verify app/profile/test-workspace absence. Both VMs are shut down.
- Local evidence: `~/.local/share/study-buddy/release-lab/runs/0.2.3-alpha-run-33491078741/`.
- GitHub has the complete draft and matching asset digests. Authentication is
  working. Publication and website promotion were authorized by the maintainer
  but have not been performed.
- Bundle checksum verification passed for all ten listed assets. The remote
  annotated tag resolves to the root commit above.
- The local website release-selector suite passed (6 tests). The deployed site
  was inspected and still advertises `0.2.1-alpha`; the draft is excluded.
  This is not post-publication acceptance of `0.2.3-alpha`.
- Release-lab helper suite: 41 tests passed. Release-manager skill validation
  passed after documenting the distinction between generic and targeted gates.

### Remaining release-specific gate

The reported defect concerns a Moodle-backed study guide. The successful saved
thread exercised synthetic file read/edit/create; the deterministic broker
probe verifies runtime/environment wiring. Neither proves Moodle acquisition
through generation of a validated artifact. No successful exact-candidate
Moodle-to-artifact record was found in the release evidence.

Run that targeted request with an authorized test course/account through the
exact packaged candidate and record terminal workflow and artifact validation.
Diagnose any failure before publication. Guest tests used synthetic sources;
their temporary subscription credentials have been removed. Institution
credentials were not transferred into the lab.

Afterward, reconcile the draft notes, publish the same accepted bytes, and
verify anonymous downloads/checksums and deployed website links. Do not repeat
passing standard scenarios merely because this regression record was missing.
New development in the dirty checkout is outside this immutable candidate.
