# `v0.2.0-alpha` release readiness

This is the durable, credential-free handoff for the first coordinated public
Study Buddy alpha under the current release process. A green result applies
only to the exact source commits and artifact hashes in the final assembled
bundle. Rebuilding any artifact invalidates its previous packaged acceptance.

The `1.x` version line remains reserved for the future stable release. Earlier
public `v0.1.0-alpha.1` and `v0.1.0-alpha.2` releases are historical technical
previews; unpublished build attempts do not consume additional public versions.

## Release contract

- Version/tag: `0.2.0-alpha` / `v0.2.0-alpha`
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
`0.2.0-alpha` bytes.

The release-lab now additionally requires ChatGPT subscription authentication,
a real streamed response in a newly created packaged desktop thread, bounded
synthetic file read/edit/create operations, credential cleanup, and restoration
of the calibrated Windows `clean` and Fedora `clean-wallet` snapshots.

## Required gates

1. Merge the reviewed root release changes through the protected default branch
   with the exact public UI submodule pin.
2. Complete root and UI typecheck, test, lint/format, dependency audit, license,
   SBOM, public-tree, link, submodule, secret-scan, and CodeQL gates.
3. Build the exact `0.2.0-alpha` Windows and Linux bundle from the final tagged
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

Status: **blocked for publication while preparation is in progress**.

The source candidate is being converted to the agreed `0.2.0-alpha` contract.
No final bundle, exact VM pass, reviewed GitHub draft, or deployed website
promotion exists yet. Successful source CI alone will not change this decision.
