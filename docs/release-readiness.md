# Release readiness

This is the durable handoff for the first public alpha. It records verified
repository state without containing credentials, private portal identifiers, or
local artifact paths. Update it when a gate changes; do not treat an old green
result as proof for a later commit.

## Verified locally on 2026-08-10

- Root history: all 798 reachable commits/refs scanned with Gitleaks, with no
  findings. Exact configured local secret values were not present in the public
  branch histories.
- Interface-fork history: all 6,182 reachable upstream/fork commits scanned.
  Eighty-nine findings in 18 already-public upstream commits were classified as
  fixtures/audit material and captured as exact fingerprints; the reviewed
  baseline leaves every new or changed finding blocking.
- Root and fork child-process environments now use explicit allowlists. Moodle,
  CIS, source-secret, arbitrary host, and provider secrets do not enter Codex
  shells or provider subprocesses.
- Generated shell snapshots/provider logs containing the locally configured
  portal password were securely removed. Canonical study runs and deliverables
  were not deleted. Local data, cache, and browser-state roots are restricted to
  the operating-system user.
- Root release policy covers type checking, the full test suite, Markdown links,
  public-tree policy, production licenses, CycloneDX SBOM generation, and the
  production npm audit.
- The interface fork passes formatting/lint, all workspace typechecks, all
  package test tasks, the shipped-workspace dependency audit, and a production
  web/server/desktop build. The generated main, server, and preload bundles are
  non-empty and the preload bridge contract is present.
- Electron is pinned to 41.10.3, electron-updater to 6.8.9, and vulnerable
  shipped Undici/fast-uri versions are overridden to patched releases. No
  high/critical advisory remains in the Study Buddy desktop/server release
  path.
- Upstream T3 release, relay deployment, mobile-preview, issue-label, PR-size,
  and vouch workflows are inert in the fork. Fork CI uses GitHub-hosted runners;
  checkout/setup/secret-scan actions used by active Study Buddy automation are
  commit-pinned.

## Remaining release blockers

1. The maintainer must confirm rotation/revocation of any password, token,
   cookie, or calendar feed ever shared outside protected local storage.
2. Review and split the dirty interface-fork work into auditable commits, push
   the chosen commit to the public fork, then update the root gitlink to that
   exact reachable SHA. Do not push local checkpoint refs.
3. Run the root CI/security gates from a clean recursive clone of those exact
   commits. Repeat manual synthetic smoke tests on every platform claimed in the
   prerelease notes.
4. Create a dedicated Study Buddy artifact workflow with Study Buddy identity,
   signing/notarization, checksums, SBOM attachment, draft-prerelease review, and
   no upstream T3 publication endpoints.
5. Enable the GitHub ruleset, required checks, private vulnerability reporting,
   Dependabot/security updates, secret scanning/push protection, and automatic
   branch cleanup described in [github-launch.md](github-launch.md).
6. The disabled upstream mobile, marketing, and relay workspaces still have
   high-severity dependency advisories. They are excluded from Study Buddy
   artifacts and deployments; either update/remove them before claiming those
   surfaces as supported, or continue enforcing the explicit shipped-workspace
   audit boundary.
7. Resolve the remaining course-specific production-template shortcut before
   claiming generic production readiness for all course domains.

## Release decision

The source tree is suitable for continued public alpha hardening, but a binary
release is **not yet authorized**. Publication requires the public fork pin,
clean-clone verification, owner-controlled GitHub settings, credential-rotation
confirmation, and a Study Buddy-specific signed artifact path.
