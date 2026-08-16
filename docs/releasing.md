# Release process

Study Buddy uses SemVer prereleases while the product is in alpha. The first
candidate should be tagged `v0.1.0-alpha.1`; do not publish a stable `v0.1.0`
until clean-machine validation and the security gates are complete.

## 1. Contain and review

- Revoke every known exposed credential or bearer URL.
- Scan the current trees and complete histories of both repositories.
- Confirm no local checkpoint refs will be pushed. Never use `git push --mirror`.
- Replace real portal/course/attempt fixtures with synthetic data.
- Resolve or explicitly defer every P0/P1 item in `ROADMAP.md`.

## 2. Freeze the source contract

- Review, test, commit, and push the UI-fork changes first.
- Update the root gitlink only after the exact submodule commit is public.
- Confirm `git clone --recurse-submodules` obtains that commit.
- Run root and UI checks on GitHub-hosted clean runners.

## 3. Verify from a clean clone

```bash
npm ci
npx playwright install chromium
npm run check:release
```

Run the no-credentials example, a synthetic PDF/HTML artifact, and approved
manual smoke tests on every claimed platform. `npm run check:release` verifies
that a production-only CycloneDX SBOM can be generated. Generate the final SBOM
from the exact clean release checkout and attach it to the draft release.

## 4. Build artifacts

Build from a clean CI checkout, never the maintainer working tree. Record the
root and submodule SHAs, toolchain versions, checksums, and SBOM. GitHub source
archives omit submodule contents, so release notes must explain recursive clone
setup and attach deliberate binaries separately.

Use the manually dispatched **Alpha desktop artifacts** workflow. A branch run
with `publish_draft=false` produces review-only unsigned Linux x64 and Windows
x64 artifacts. macOS binaries are outside the current release matrix. Publishing
is accepted only when all of the following are true:

- the workflow runs from an existing `v<version>` tag;
- `signed=true` is selected;
- the `alpha-release` environment controls signing secrets and publication
  approval;
- the Windows artifact has been signed through the reviewed SignPath path;
- every platform build and the release-evidence assembly succeeds.

The assembled bundle contains the platform artifacts, Electron updater channel
metadata (`alpha.yml` and `alpha-linux.yml`, plus available blockmaps),
`SHA256SUMS`, the root CycloneDX SBOM, and `release-manifest.json` with the exact
root and interface commits. The YAML metadata binds each download with SHA-512;
the website and in-app updater both use these GitHub Release assets. Do not
repurpose the disabled upstream T3 release workflow.

The workflow fails closed when `signed=true` until SignPath Foundation
onboarding, origin verification, signing policy, and the pinned integration are
complete. Store any eventual SignPath token only as an `alpha-release`
environment secret, restrict that environment to reviewed tags and required
maintainers, and require a separate signing approval. Do not add Apple or Azure
signing credentials to this release path.

### SignPath Foundation owner handoff

SignPath Foundation provides free code-signing certificates for accepted open
source projects without requiring the maintainer to buy or personally hold a
certificate. Apply at <https://signpath.org/>. After acceptance:

1. install the SignPath GitHub App for this repository and link SignPath's
   predefined GitHub.com trusted build system to the Study Buddy project;
2. create or confirm the SignPath organization ID, project slug, signing policy
   slug, and artifact configuration for the Windows NSIS payload;
3. add the submitter token only as the `SIGNPATH_API_TOKEN` secret in the
   protected `alpha-release` environment; keep the non-secret IDs/slugs as
   environment variables;
4. return those identifiers for the final workflow patch. The reviewed
   integration must upload the unsigned workflow artifact first, submit its
   GitHub artifact ID through
   `signpath/github-action-submit-signing-request@v2`, wait for completion,
   verify the returned executable's Authenticode signature, and pass only that
   signed payload to release assembly;
5. keep every build job leading to the signing request on GitHub-hosted runners,
   as required for SignPath Foundation OSS origin verification.

The current fail-closed workflow is intentional: SignPath project and artifact
configuration are server-side contracts, so inserting guessed slugs or an
unverified signing step would create a misleading release path.

## 5. Publish a draft prerelease

- Create an annotated, preferably signed tag.
- Draft release notes from `CHANGELOG.md`, including known limitations.
- Attach artifacts, checksums, and SBOM before publication.
- Mark alpha/RC releases as prereleases.
- Perform one final install from the exact draft artifacts, then publish.

After release, monitor security/dependency alerts and triage issues on a regular
cadence. Do not promise support timelines that the maintainer cannot sustain.
