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

### Documentation

- Reworked public onboarding and added contribution, governance, support,
  privacy, roadmap, and release guidance.

### Maintenance

- Added Markdown-link, public-tree, license, CycloneDX SBOM, production
  dependency-audit, and release verification commands.
- Restricted accidental npm tarballs to public policy/license documents; npm is
  not a supported product distribution channel.
