# Release process

Study Buddy uses Semantic Versioning. Stable, alpha, and beta desktop releases
share one evidence-producing workflow. Linux x64 and Windows x64 are the only
supported binary lanes for version 1.0; macOS is not currently shipped.

## 1. Freeze and contain

- Rotate every known exposed credential or bearer URL.
- Scan the current trees and complete histories of both repositories.
- Confirm no local checkpoint refs will be pushed. Never use `git push --mirror`.
- Replace real portal/course/attempt fixtures with synthetic data.
- Resolve every release-scope P0/P1 issue rather than documenting it away.
- Freeze features before creating the candidate branch.

Review, test, and publish the UI-fork commit first. Update the root gitlink only
after that exact commit is available to a recursive clone. A release is one root
commit plus its immutable `t3code-fork` gitlink; testing either repository at a
different commit is not release evidence.

## 2. Verify a clean recursive checkout

```bash
git clone --recurse-submodules https://github.com/HabsaTheDog/StudyBuddy.git
cd StudyBuddy
npm ci
npx playwright install chromium
npm run check:release
```

The root gate covers type checking, tests, Markdown links, public-tree policy,
production licenses, CycloneDX SBOM generation, the desktop-release contract,
and dependency audit. The pinned UI workspace must separately pass its frozen
install, formatting/lint, type checks, tests, production build, release audit,
and secret scan.

Run the synthetic no-credentials example and representative PDF/HTML workflows.
Source-only checks do not replace installation of the exact packaged artifacts.

## 3. Build immutable desktop evidence

Dispatch **Desktop release artifacts** from GitHub Actions with a SemVer value
without the `v` prefix. A branch run with `publish_draft=false` creates review
artifacts only. Draft publication is accepted only when:

- the run starts from an existing `v<version>` tag;
- immediately before draft creation, the workflow peels the remote tag and
  proves it still resolves to the exact commit that built the artifacts;
- the public `VITE_POSTHOG_PROJECT_TOKEN` repository variable is configured;
- `signed=false` is selected while trusted Windows signing is unavailable;
- `acknowledge_unsigned_windows=true` explicitly accepts the Windows trust
  warning and the release notes disclose it prominently;
- the protected `desktop-release` environment grants publication approval;
- the Windows job proves the installer is actually unsigned; and
- every build and evidence-assembly job succeeds.

The bundle must contain exactly one Windows x64 NSIS installer, one Linux x64
AppImage, both blockmaps, the matching updater manifests, platform and root
CycloneDX SBOMs, `release-manifest.json`, and `SHA256SUMS`. The release gate
rejects empty, missing, unexpected, or debug artifacts; mismatched versions;
incorrect updater SHA-512 values; malformed provenance; and incorrect SHA-256
checksums.

Stable releases use `latest.yml` and `latest-linux.yml`; alpha and beta releases
use their matching channels. The website and in-app updater both consume the
same GitHub Release assets.

## 4. Installed-artifact acceptance

Use the `study-buddy-release-lab` skill and bind each lane to the exact artifact
hash, release manifest, checksums, root/UI commits, disposable VM, and calibrated
clean snapshot. Version 1.0 requires Fedora Workstation and Windows 11 lanes.

On both lanes verify installation/launch, product identity and icons, zero-source
onboarding, unlimited add/edit/disable/delete, a browser-backed source, optional
telemetry delivery, restart/persistence, previous-version update, offline errors,
uninstall behavior, and one representative end-to-end request. Windows must
show the documented unsigned-publisher warning; never tell users to disable
SmartScreen globally. Fedora must exercise the AppImage on Wayland.

Missing infrastructure or user-owned account checks are `blocked`, never
`pass`. Preserve redacted evidence for the exact hashes tested.

## 5. Review and publish

1. Draft release notes from `CHANGELOG.md`, including supported systems and
   known limitations.
2. Create an annotated tag only at the reviewed root commit.
3. Run the workflow with draft publication and inspect the allowlisted assets.
4. Install the exact draft downloads in both clean VM lanes and complete the
   evidence verdicts.
5. Confirm repository security checks and release-environment approval.
6. Publish the already reviewed draft without replacing any asset.
7. Verify the public updater manifests and website resolve to that release.

After publication, monitor update telemetry, issues, dependency/security alerts,
and failed release workflows. Do not promise a support SLA the maintainer cannot
sustain.

## Windows signing roadmap

Unsigned Windows distribution is an explicit current limitation, not a claim of
publisher identity. The signed workflow option remains fail-closed until a
trusted signing service is integrated, its returned binary is independently
verified with Authenticode, and only the verified signed payload reaches release
assembly. SignPath Foundation may be reconsidered after the project satisfies
its current eligibility requirements; no guessed token, project slug, or
certificate configuration belongs in the repository.
