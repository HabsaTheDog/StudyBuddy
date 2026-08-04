# GitHub launch checklist

The repository is already public. As of 2026-08-04, `master` is unprotected,
private vulnerability reporting and Dependabot alerts/security updates are
disabled, Discussions are disabled, the wiki is enabled, and no tag or release
exists. Treat the next announcement as a controlled alpha launch, not the first
moment of source exposure.

## Containment before announcement

- Rotate or revoke the previously disclosed portal password/calendar feed and
  the credential-like Cloudflare browser session material found in local-only
  checkpoint refs.
- Confirm `git ls-remote origin 'refs/t3/*'` remains empty.
- Never push `refs/t3/**`, `--all`, or `--mirror`; push only a reviewed branch
  and later an explicit release tag.
- Audit the complete T3-fork history independently and resolve its dirty worktree
  before updating the root gitlink.
- Make release archives from a clean clone, not this working directory.

## Repository flow

1. Create a branch such as `release/open-source-hardening` from reviewed
   `master` and commit only the root cleanup.
2. Separately review/split/test the UI changes, push an immutable public fork
   commit, and update the root gitlink in a focused follow-up commit.
3. Open a pull request and require CI, repository policy, UI submodule, CodeQL,
   and secret scan to pass.
4. Review the complete file manifest and diff from public `master` before merge.
5. Merge through the protected path; do not force-push the default branch.

The reviewed public root history produced no confirmed production-secret match.
It did contain operational metadata and real-looking portal fixture IDs, which
the current tree removes. Preserve history unless a legal/privacy review or a
confirmed published secret requires rewriting it; rewriting public history has
high coordination cost and cannot undo previous disclosure.

## GitHub settings after the workflows are pushed

- Add a `master` ruleset requiring pull requests, the new CI/security checks,
  conversation resolution, and no force pushes or deletions. Include the
  maintainer rather than creating an unreviewed bypass.
- Enable private vulnerability reporting and subscribe to security alerts.
- Enable Dependabot alerts and security updates. Keep npm and GitHub Actions
  update configuration in `.github/dependabot.yml`.
- Keep secret scanning and push protection enabled; enable non-provider patterns
  and validity checks if available.
- Enable Discussions only if Q&A/ideas will be moderated. Disable the wiki so
  canonical documentation stays versioned in the repository.
- Enable automatic branch deletion after merge and choose one primary merge
  strategy (squash is the simplest initial policy).
- Add the repository homepage/social preview and apply the labels described in
  [CONTRIBUTING.md](../CONTRIBUTING.md).

## First release

- Prepare several bounded `good first issue` and `help wanted` items before the
  announcement.
- Draft `v0.1.0-alpha.1` from the exact verified root and submodule commits.
- Attach release notes, known limitations, checksums, and the reviewed SBOM.
- Verify the draft artifacts on a clean machine and mark the release as a
  prerelease.
- Announce through a GitHub Discussion and project channels only after the
  synthetic demo and recursive-clone instructions succeed.

After launch, triage issues, dependencies, and security notifications weekly and
publish support expectations honestly.
