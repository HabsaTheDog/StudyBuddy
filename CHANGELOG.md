# Changelog

This project follows [Semantic Versioning](https://semver.org/) for tagged
releases. Version `0.2.3-alpha` is currently undergoing release-candidate
validation; the `1.x` line remains reserved for the first full release.

## Unreleased

## 0.2.3-alpha — 2026-08-31

### Fixed

- Restored the packaged Study Buddy source broker so installed desktop requests
  can use configured Moodle, CIS, calendar, website, and email sources.
- Bound every broker run to a server-generated scope and rejected disabled,
  deleted, unconfigured, or mismatched source targets before credentials can be
  resolved.
- Added bounded Windows and Unix process-tree termination and request
  cancellation so failed source runs do not leave provider children behind.

### Security

- Restricted packaged Codex network access to the authenticated loopback broker
  and kept public outbound networking denied for source-backed workflows.
- Redacted raw, JSON-escaped, and URL-encoded source credentials from broker
  diagnostics and provider output.
- Enforced quiz approval in the native broker: fabricated, skipped, changed,
  declined, or expired approvals fail closed, while final quiz submission
  remains blocked.

### Testing

- Added deterministic packaged source probes for exact configured targets,
  public CIS access, credential injection, cancellation, and fail-closed source
  lifecycle behavior.
- Extended the clean Windows and Fedora release gates with the repaired
  source-runtime path and a targeted Moodle-to-artifact acceptance round.

## 0.2.2-alpha — 2026-08-29

### Fixed

- Repaired the packaged Codex runtime preflight on clean Windows and Linux
  installations so real desktop requests can start without a system Node.js.
- Preferred an explicit password-login plan over optional passkey prompts and
  hardened origin-scoped portal authentication.
- Preserved settings and other menu actions invoked while the lightweight
  startup screen is visible.
- Replaced the startup card and text with the centered Study Buddy mark and a
  compact gold activity spinner.
- Added release probes for the packaged Codex runtime and desktop source broker
  so the failures corrected here block future candidate acceptance.

### Security

- Changed generated setup defaults to review-only quiz access with automatic
  answering disabled.
- Expanded ignored sensitive-file patterns and release-tree checks.
- Added URL credential rejection and diagnostic prompt/URL redaction.
- Restricted Codex/provider child processes to explicit runtime environment
  allowlists so portal credentials cannot enter model shells, snapshots, or
  provider logs.
- Added full-history secret scanning for both repositories, with an exact
  reviewed baseline for findings inherited from the public T3 Code history.
- Disabled inherited upstream release, relay, mobile-preview, and repository
  mutation workflows in the Study Buddy interface fork.
- Updated Electron and provider dependencies and added a high/critical audit
  gate for the desktop/server workspaces included in Study Buddy releases.
- Limited the fork workspace and frozen lockfile to shipped Study Buddy packages,
  removing the disabled relay's private tarball from default clean installs.
- Added CodeQL coverage for the separately versioned desktop/interface fork and
  expanded its ignored certificate, key, and browser-auth-state patterns.

### Documentation

- Reworked public onboarding and added contribution, governance, support,
  privacy, roadmap, and release guidance.

### Maintenance

- Added Markdown-link, public-tree, license, CycloneDX SBOM, production
  dependency-audit, and release verification commands.
- Restricted accidental npm tarballs to public policy/license documents; npm is
  not a supported product distribution channel.
- Added a dedicated, manually dispatched Study Buddy desktop artifact workflow
  with immutable root/UI metadata, checksums, SBOM evidence, signing gates, and
  draft-prerelease publication.
- Scoped the initial binary matrix to Linux x64 and Windows x64, requires an
  explicit acknowledgement for unsigned Windows publication, and keeps a
  future trusted-signing path fail-closed until it is implemented and reviewed.
- Added explicit Quick Chat workspace, deliverables, and thread environment
  isolation so concurrent builder runs cannot share an output root.
- Bound plain local Markdown source headings and model source aliases to a
  deterministic evidence identity before independent Question Bank review.
- Added a release gate that rejects a UI submodule pin unless the exact full
  commit is reachable from a public remote ref.

### Interface

- Added Fast, Balanced, and Quality execution profiles with direct keyboard
  selection while retaining the existing model-picker shortcut contract.
- Hardened Quick Chat creation, draft promotion, file opening, timeline controls,
  browser startup, and settings persistence regressions.
- Changed source onboarding to start empty with an unlimited add-source flow,
  repaired source editing after connection checks, and preserved edit support
  for configured legacy Alpha sources.
- Restored Study Buddy icons and executable metadata in intentionally unsigned
  Windows builds without enabling or implying Authenticode signing.
- Corrected prerelease build identity and prevented newer alpha builds from
  offering an older published alpha as an automatic downgrade.
- Restricted local-only desktop port selection to loopback probing so normal
  Windows startup does not request public-network firewall access.
