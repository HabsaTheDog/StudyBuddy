# Study Buddy provider recognition hotfix release contract

Discovery recorded 2026-10-15; integrated into the isolated release worktree.
This contract does not authorize destructive VM actions or claim that a new
candidate is accepted. See [current readiness](release-readiness.md).

## Outcome and scope

Intended next version: **0.2.5-alpha**, GitHub prerelease, Windows 11 x64 and
Fedora x64, unsigned Windows with existing warning/checksum disclosure.
Owner explicitly requested fixing already-installed provider recognition,
pushing the code, opening a PR and publishing the update. Publication is
authorized in that scope; do not ask for the same broad approval again.

Included: detect supported existing Codex/Claude installations consistently in
the packaged desktop, avoid unnecessary reinstall prompts, retain explicit
installation/authentication failure details, and focused provider resolution,
onboarding/refresh/restart regressions. Include required version/release metadata
and any integration repairs necessary for this fix.

Every older development-backlog item is already included as implementation in
the public 0.2.4-alpha batch. Its original evidence and limitations remain in
`docs/release-inventory-0.2.4-alpha.md` on origin/master and must remain preserved.
Do not rerun unrelated expensive Moodle-to-PDF/model-backed feature campaigns
for this provider-only change.

## Exact baseline and isolation

- Verified actual owner remote master: `ad92542d98c80af19f36ce1799e15bd6bbf80a34`.
- Public v0.2.4-alpha resolves to that root commit. The annotated tag object is
  `8d2b345c8c40686b1b1aeec401e881f8300ba3fb`; peel before comparing commits.
- Public UI pin: `8e3d0f7e48f2187adf3d106aa662dd5aed9e10e1`.
- Root owner remote is HabsaTheDog/StudyBuddy. Nested UI owner remote is **fork**,
  HabsaTheDog/t3code; UI **origin** is independent upstream pingdotgg/t3code and
  must not receive Study Buddy changes.
- Canonical root/UI and sibling Website/Server were clean at discovery.
- Canonical root remains feat/provider-support at `8212feb5ccc49c72ec071ecea5b2c1f58db5e3bc`;
  canonical UI remains feat/study-buddy-provider-support at `415e09dac`.
- Cached root origin/feat/provider-support is `39d513d` (ahead28/behind7 against
  canonical); current ls-remote no longer advertises that branch. It is not the
  current public default branch and must not be used as the publication target.
- The selected dedicated root worktree is
  `study-buddy-data/release-worktrees/0.2.5-alpha-root`, based on origin/master,
  with its nested UI worktree based on the public UI pin. Never merge canonical development wholesale: that would
  regress shipped security, Windows portability and release-contract changes.
- Push verified UI dependency to fork before pushing the root pointer; record
  committed, remotely advertised, PR/merged and accepted states separately.

## Explicitly deferred local development

These post-release changes remain preserved on the canonical development
branches and are deferred because the owner requested an urgent provider
recognition hotfix. They are unrelated feature scope, not lost or silently
included work:

| Root commit(s) | Change | UI dependency |
| --- | --- | --- |
| 60eece4 | Embedded Moodle document acquisition/source routing and external helper repair | Root only |
| 651f35a | Official startup logo correction | bdd103ed0 |
| 9e213b4, 3c1ba45, f820b95, 9d902be | Editable/fixed email review card, two-action editing, durable no-expiry approvals | 868be8304, 85c97ce31, f11c820ad, 737413d86 |
| 8212feb | Send-permission opt-in for auto-detected webmail setup | 415e09dac |

Local grounded-email/source branches contain earlier implementation already
reconciled in 0.2.4, not additional provider hotfix scope. Archived release/lab
worktrees and legacy file-viewer work remain excluded and preserved. Global
study-buddy-ui skill changes are local outside Git and are not implicitly
distributed by this app release.

Open root PRs at discovery: #48 old source-broker branch (subsumed by public
batch); #57 Codex SDK0.162 update (pinned UI failure); #58 production dependency
group (green); #59 dev dependency group (Windows/Linux failures); #60 workflow
action group (green); #61 UI submodule dependency update (Windows/Linux/pin
failures). All are deferred to their own reviewed integrations, because blindly
including dependency updates broadens this hotfix and SDK/CLI pairing must stay
coherent. Owner UI repository currently has no open PRs. Do not link unrelated
historical PRs to the active T3 thread.

## Actual 0.2.4 public evidence and retained limits

Tracked readiness prose is stale. The actual final evidence is under
`study-buddy-data/releases/0.2.4-alpha-preparation/final-ad92542/`:

- `publication-complete.json`: GO, PUBLISHED_AND_VERIFIED, 2026-10-07; build
  37608433949, source/UI pins above; Windows16/16 and Fedora17/17, independent
  supplementary source/PDF and T3 coexistence review, public updater and public
  button-download equality; both disposable baselines restored and powered off.
- `current-readiness.json`: final owner-approved public-byte decision, replaces
  earlier pending/blocked collection status without erasing historical failures.
- `owner-final-publication-approval.json`: exact0.2.4 owner approval; this is
  historical proof and does not imply acceptance of new artifact bytes.
- `public-downloads/release-manifest.json`, `public-download-verification.json`,
  `public-promotion-verification.json`, `publication-go-record.json` bind exact
  public assets and approved marker. Public release currently has11assets.
- Windows old installer SHA256
  `03f9dc86c2a9a30f8937a5e6b3dbf2e88b649cc9dff415cb0744fe249ab04def`,254780748bytes.
- Fedora old AppImage SHA256
  `ad1fbb12bcf3fd6158f23229345befd7c208b46e947fb4df2633347aceb6f0c7`,328483539bytes.
- Prior website source85576c1175b6d53e1a66518a2db32b81882a26f3; website selector
  already consumes the promotion contract, so a new website deployment may not
  be needed if the new trusted release marker is automatically discovered.

Retain published limitations: unsigned Windows; external Typst/full Poppler
prerequisites and doctor omission of pdfinfo; authenticated current-package
email deferred; no live Claude account acceptance; dormant Swagger DOMPurify and
build-only sprintf advisories explicitly scoped/deferred; helper-driven stop
SIGTRAP cause remains unresolved despite normal close/restart acceptance.

## Required source, package and release gates

1. Review the focused provider fix against Linux desktop PATH environments,
   Windows official/native and npm installation paths, explicit command paths,
   version/auth parsing, refresh after install and restart. Preserve account
   isolation and independent T3 identity/state/processes.
2. Run focused deterministic tests; UI formatting/lint and workspace types at
   the narrow useful scope. Root/UI PR CI runs full required source gates once.
3. Required root checks are Windows Verify, Ubuntu Verify, Pinned UI submodule,
   Repository policy, Gitleaks and CodeQL Analyze TypeScript. Existing source
   public baseline runs CI37607103474, CodeQL37607103515, secrets37607103476.
4. Update root/package-lock metadata, UI release metadata, workflow default,
   changelog and docs/releases/v0.2.5-alpha.md together. Search intentional old
   version contracts before committing. Preserve historical release prose.
5. Merge reviewed source to protected master before final packaging. Bind exact
   merged root/UI pins and dispatch one candidate build from master.
6. Package using alpha-release.yml with version0.2.5-alpha, signedfalse,
   acknowledge_unsigned_windowstrue, publish_draftfalse. Exact command pattern:
   `gh workflow run alpha-release.yml --repo HabsaTheDog/StudyBuddy --ref master -f version=0.2.5-alpha -f signed=false -f acknowledge_unsigned_windows=true -f publish_draft=false`.
   Workflow installs exact UI before root parity preflight, builds Windows2025
   NSIS and Ubuntu24 AppImage, and assembles immutable unpromoted evidence.
7. Download only complete artifact `study-buddy-0.2.5-alpha`; verify installer
   hashes/sizes, root/UI commit, unsigned state, updater manifests, root/platform
   SBOMs, release-manifest.json and SHA256SUMS. Use root
   `scripts/check-desktop-release-assets.mjs BUNDLE 0.2.5-alpha alpha --final --unpromoted`.
   Never generate distribution-ready.json before acceptance.
8. Run exact new bytes on clean Windows/Fedora disposable lanes, including
   provider install/detect/connect/refresh/restart and already-installed scenarios.
   Preserve mandatory broker/runtime probes, real streamed bounded file thread,
   lifecycle/persistence/telemetry/identity/updater/cleanup and SmartScreen
   warning. No old hash-bound evidence transfers to the hotfix.
9. After recorded GO, publish prerelease with immutable new v0.2.5-alpha tag;
   verify public assets before marker. Use reviewed
   scripts/create-desktop-release-promotion.mjs with exact acceptance receipt,
   verify marker and website buttons/public downloads/update discovery. Do not
   overwrite v0.2.4 assets, change old tags, or force prerelease flags for website.

## Available lab automation and real remaining boundary

Release lab helper:
`$CODEX_HOME/skills/study-buddy-release-lab/scripts/release_lab.py`.
Read its current lane-runbook/evidence/subscription refs before execution.
Read-only inventory succeeded2026-10-15T09:00:37Z:

| Lane | Domain/UUID | State | Snapshot evidence |
| --- | --- | --- | --- |
| Windows | sb-lab-windows-11 / dc4ae7bb-3b55-4a85-9e58-bfe06a3249a9 | shut off | clean |
| Fedora | sb-lab-fedora / 7efa18d0-942e-4869-b3db-293039d2fc31 | shut off | clean-wallet (configured calibrated baseline; clean also exists but is not selected) |

Both lanes explicitly declare disposabletrue in the local release-lab config.
Personal win11 is excluded. Subscription helper status reports dedicated
systemd-creds-user vault healthy; do not print/decrypt its content. Both lanes
are available; no infrastructure blocker established.

Existing exact0.2.4 helper examples in final-ad92542 include windows-lifecycle.py,
fedora-lifecycle.py, windows-retry1-tools.py, windows-retry1-ui-state.py,
windows-retry1-telemetry-receipt.py and validate_bundle.py. They are historical
identity-bound scripts: inspect/adapt into new evidence scope rather than execute
unchanged or reuse recorded pass. Generic release_lab.py supports inventory,
preflight/init-run/vm-action/windows-ui/fedora-ui/workflow-probe/runtime-probe,
record-guest/record-redaction/finalize-run.

The release-lab skill explicitly requires matching approval immediately before
snapshot revert, bound to new source/version/artifact SHA/domain/calibrated
snapshot. Historical0.2.4 receipts do not cover0.2.5. Prepare and validate exact
candidate first, then seek only this genuinely required destructive-reset
authorization if the active session has not already granted it. Broad publish
permission is already present. All other preparation continues autonomously.

Current terminal decision: **PENDING IMPLEMENTATION/CI/EXACT-CANDIDATE ACCEPTANCE**.
Version metadata and preparation documentation are being updated in the isolated
release worktree. No remote push, merge, package, VM pass, tag or publication is
claimed by this record. Preserve the canonical development worktrees.
