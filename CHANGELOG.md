# Changelog

This project follows [Semantic Versioning](https://semver.org/) for tagged
releases. It is currently unreleased and may make breaking changes during alpha.

## Unreleased

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
- Scoped the initial binary matrix to Linux x64 and Windows x64, permitted only
  explicitly acknowledged unsigned Windows Alpha publication, and kept trusted
  signing fail-closed for future stable releases.
- Added explicit Quick Chat workspace, deliverables, and thread environment
  isolation so concurrent builder runs cannot share an output root.
- Bound plain local Markdown source headings and model source aliases to a
  deterministic evidence identity before independent Question Bank review.

### Interface

- Added Fast, Balanced, and Quality execution profiles with direct keyboard
  selection while retaining the existing model-picker shortcut contract.
- Hardened Quick Chat creation, draft promotion, file opening, timeline controls,
  browser startup, and settings persistence regressions.
