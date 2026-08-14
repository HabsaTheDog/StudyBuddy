# GitHub launch checklist

The repository is already public. As of 2026-08-14, private vulnerability
reporting, Dependabot alerts/security updates, secret scanning, push protection,
and automatic merged-branch deletion are enabled. The unused wiki is disabled.
The privacy rewrite and credential rotation are complete, and `master` is
protected by the permanent release ruleset. No tag or release exists. Treat the
next announcement as a controlled alpha launch, not the first moment of source
exposure.

## Completed containment

- The previously disclosed credentials were rotated by the maintainer.
- The confirmed historical health document was removed from every reviewed
  writable public root ref. GitHub Support cache and pull-request-ref cleanup is
  still awaiting confirmation; previous disclosure cannot be undone.
- Confirm `git ls-remote origin 'refs/t3/*'` remains empty.
- Never push `refs/t3/**`, `--all`, or `--mirror`; push only a reviewed branch
  and later an explicit release tag.
- Audit the complete T3-fork history independently and resolve its dirty worktree
  before updating the root gitlink.
- Make release archives from a clean clone, not this working directory.

## Repository flow

1. Review/test the UI change independently, merge it to the public integration
   branch, and pin its immutable commit in the root branch.
2. Open a root pull request and require CI, repository policy, UI submodule,
   CodeQL, and secret scan to pass.
3. Review the complete file manifest and diff from public `master` before merge.
4. Merge all changes through the protected pull-request path. The completed
   privacy rewrite remains a one-time exception and must not become precedent
   for ordinary development.

The reviewed public root history produced no confirmed production-secret match,
but it did expose a real health document containing personal, insurance, and
medical information. This satisfies the documented exception for a coordinated
history rewrite. Rewriting has high coordination cost and cannot undo clones or
previous disclosure. Follow the applicable privacy-incident response and notify
existing clone owners after the force update.

## GitHub settings

- Keep the active `master` ruleset requiring pull requests, CI/security checks,
  conversation resolution, and no force pushes or deletions.
- Private vulnerability reporting and security-alert subscription are enabled.
- Dependabot alerts and security updates are enabled. Keep npm and GitHub
  Actions update configuration in `.github/dependabot.yml`.
- Keep secret scanning and push protection enabled; enable non-provider patterns
  and validity checks if available.
- Discussions remain disabled until Q&A/ideas can be moderated. The wiki is
  disabled so canonical documentation stays versioned in the repository.
- Automatic branch deletion is enabled. Select squash as the primary merge
  strategy after the current release-preparation branches are merged.
- Add the repository homepage/social preview and apply the labels described in
  [CONTRIBUTING.md](../CONTRIBUTING.md).

## First release

- Prepare several bounded `good first issue` and `help wanted` items before the
  announcement.
- Publish desktop binaries for Linux x64 and Windows x64 only. macOS remains
  outside the first alpha matrix.
- Draft `v0.1.0-alpha.1` from the exact verified root and submodule commits.
- Attach release notes, known limitations, checksums, and the reviewed SBOM.
- Verify the draft artifacts on a clean machine and mark the release as a
  prerelease.
- Announce through a GitHub Discussion and project channels only after the
  synthetic demo and recursive-clone instructions succeed.

After launch, triage issues, dependencies, and security notifications weekly and
publish support expectations honestly.
