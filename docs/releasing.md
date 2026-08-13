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
with `publish_draft=false` produces review-only unsigned artifacts. Publishing
is accepted only when all of the following are true:

- the workflow runs from an existing `v<version>` tag;
- `signed=true` is selected;
- the `alpha-release` environment controls artifact builds, signing secrets,
  and publication approval;
- Apple notarization and Windows signing secrets are complete;
- every platform build and the release-evidence assembly succeeds.

The assembled bundle contains the platform artifacts, `SHA256SUMS`, the root
CycloneDX SBOM, and `release-manifest.json` with the exact root and interface
commits. Do not repurpose the disabled upstream T3 release workflow.

Store signing material only as `alpha-release` environment secrets. macOS needs
`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (the private `.p8` contents),
`APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. Windows needs `AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
`AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`,
`AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`, and
`AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`. Restrict the environment to reviewed
tags and required maintainers before adding these values.

## 5. Publish a draft prerelease

- Create an annotated, preferably signed tag.
- Draft release notes from `CHANGELOG.md`, including known limitations.
- Attach artifacts, checksums, and SBOM before publication.
- Mark alpha/RC releases as prereleases.
- Perform one final install from the exact draft artifacts, then publish.

After release, monitor security/dependency alerts and triage issues on a regular
cadence. Do not promise support timelines that the maintainer cannot sustain.
