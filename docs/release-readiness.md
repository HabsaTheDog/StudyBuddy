# Consolidated `v0.2.2-alpha` release readiness

## Current decision — 2026-09-10

**BLOCKED for publication; preparation continues.** The owner requested one
combined release after the remaining fixes and acceptance, not separate
`0.2.2-alpha` and `0.2.3-alpha` publications.

GitHub inspection confirmed:
- `v0.2.1-alpha` is the newest public release (2026-08-29).
- `v0.2.2-alpha` and `v0.2.3-alpha` are both unpublished drafts.
- Both prior sets of fixes are already in the root commit history.
- Existing source metadata still says `0.2.3-alpha`; change all version contracts
  together in an isolated release worktree after the included source is frozen.

## One release contract

- Intended version/tag: `0.2.2-alpha` / `v0.2.2-alpha`.
- Preserve every existing public release and its immutable bytes.
- Combine the prior draft fixes; retain older candidate provenance as history,
  not acceptance of a renamed/rebuilt artifact.
- Support Windows 11 x64 (intentionally unsigned, with warning) and Fedora x64.
  No macOS or unrelated browser-only acceptance matrix.
- Complete local Moodle test connectivity and synthetic credential automation,
  then prove real installed-app source acquisition in both disposable lanes.
- Run the targeted Moodle-to-study-guide regression selected for this corrective
  release; do not make model-backed generation mandatory for unrelated patches.
- Require reviewed default-branch root/UI commits, CI/security gates, exact
  artifact manifests/checksums, full-setup VM acceptance and updater checks.
- Keep alpha maturity separate from the tested stable download channel.
  Promote through matching `distribution-ready.json`, not by clearing prerelease.
- Publish/promote one complete accepted bundle. Retire the redundant unpublished
  draft only when its replacement is ready and its provenance has been retained.
- No new public version is consumed by an internal failed or superseded build.

## Source-freeze decision needed

Current root branch: `fix/dev-source-broker-v0.2.3`, HEAD `bcd1aba`.
PR #48 contains newer Moodle obligation-discovery work. The UI submodule has
uncommitted desktop environment, backend configuration, provider and
source-workflow/broker changes belonging to another workstream.

The owner has been asked whether to include that work once finalized or exclude
it from this release. Do not commit, overwrite, discard or implicitly certify
another agent's dirty changes. Once the scope is settled, create an isolated
release branch/worktree and record full root/UI commits here.

## Remaining work

- [x] Confirm publication state and choose one intended public version.
- [x] Real local Moodle server: 19 acceptance checks, 16 tooling tests, live
  status/probe/reset/stop and cleanup passed; see [Moodle lab](moodle-test-service.md).
- [ ] Settle source inclusion and freeze full root/UI commits.
- [ ] Finish safe local guest connectivity without weakening normal HTTPS/DNS
  protections, and automate synthetic credential entry without logs/argv exposure.
- [ ] Verify actual course discovery and protected downloads in the installed
  Windows/Fedora apps. Server HTTP results cannot replace this evidence.
- [ ] Combine release notes and version metadata; run relevant deterministic
  source/security/OSS checks and merge reviewed changes.
- [ ] Build one exact `0.2.2-alpha` Windows/Linux bundle from the final source.
- [ ] Complete clean packaged acceptance and the selected regression, recording
  exact hashes. Never relabel prior `0.2.3-alpha` passes as new-artifact passes.
- [ ] Reconcile owner acceptance and exact-candidate snapshot permissions, then
  confirm the publication scope immediately before the external operation.
- [ ] Replace the unpublished candidate assets/provenance deliberately, retire
  the redundant draft, publish once, and verify public downloads/updater/website.
- [ ] Record the final public version, hashes, run and residual limitations.

Historical standard Windows/Fedora passes and unresolved regression evidence for
the previous candidate are retained in
[the archived candidate record](releases/v0.2.3-alpha-candidate-history.md).
They do not establish a GO for this consolidated release. No new build,
snapshot restore, release deletion, publication or website promotion has been
performed as part of this consolidation checkpoint.
