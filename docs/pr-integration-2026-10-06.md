# Pull request integration, 2026-10-06

Scope: repair the existing Study Buddy development PRs and their merge blockers.
This does not freeze, package, publish or accept a release.

## History reconciliation

The published 0.2.2 root/UI changes were squash-merged while the development
branches retained their original history. Merge the published base into the
newer provider branch without discarding subsequent source, quiz or email fixes.
The root source integration retains the published safe external navigation,
bounded acquisition retries, source-task/cache validation, date quotation checks
and preparation/deadline interpretation. Cache proofs use a fresh version.
Current native ownership, original media, first-attempt and final-submission
boundaries remain in force. Historical release notes and unpromoted asset checks
come from the published branch; current development receipts remain intact.

The UI reconciliation retains repository identity caching and the dedicated
runtime-state check. It preserves the current native conversational evidence
contract instead of restoring the older final-message substitution mechanism.

PR #48 has no commits outside #53 and is superseded by that integration. The
repository requires squash merges, linear history and fresh checks against the
current base; resolving history does not permit bypassing those checks.

## Dependency PRs

- Root #36: retain the proposed Codex SDK/runtime pair.
- Root #41: retain workflow updates; replace the Typst prerelease pin with the
  stable v5.3.0 commit in both workflows.
- Root #51: retain the proposed production dependency updates.
- Root #52: retain the proposed development dependency updates.
- All four old root check results predate a high-severity source-map-js advisory;
  refresh only that transitive package to its patched release and rerun checks.
- UI #22/#23 require coherent root/desktop Electron manifests and a regenerated
  frozen lockfile, plus patched dependencies for newly disclosed audit findings.

Public documentation uses redacted example resource links; private captures and
canonical evidence remain under ignored Study Buddy data. Exact pushed commits,
merge state and check results must be verified separately before completion.

## Validation and current handoff

Root integration: TypeScript, package/security contracts, link/privacy/license/SBOM
policies and fresh audit pass. The initial full run exercised 1,801 tests: 1,790
passed, seven failed, four existing skips. Three failures were rendering/wrapper
timeouts on the busy host; three required the coordinated UI checkout; the task
catalogue caught two new navigation calls without operation IDs in one test.
The calls now use existing source-selection/source-verification policies, with
explicit browser assertions. Unchanged serial rendering/wrapper/browser reruns
pass 60/60; coordinated catalogue/navigation reruns pass 18/18. Preserve the
initial failed log rather than describing it as a clean full run.

The newer UI reconciliation passes 123 focused tests, format/lint and all 13
workspace typechecks and the production web/backend build. Its dependency audit and frozen install pass. The native
cache patch was verified with a cold isolated dependency store as well as actual
transitive-package behavioral tests; stale local installed bytes were reimported.

UI PR #23 merged as `8a91a450d4e7db2a2f8d77651ff989eab66524e1` after all required
GitHub checks passed. UI #22 had the identical repaired tree and is closed as
superseded. Its change is integrated, not discarded. Retain the advertised
`67f94a06d6ba572bbbbabc8c8c39158e1589a46e` branch while root dependency PRs pin it.
Root dependency fixes are committed and pushed to their existing PR branches;
fresh required checks and sequential current-base integration remain the gates.
No installation, deployment, release package, tag, release publication or
release acceptance is part of this work. Canonical worktrees may contain unrelated ongoing edits; this
repair is developed and validated in isolated worktrees.

The newer reviewed UI integration is publicly reachable on
`HabsaTheDog/t3code` branch `fix/pr-merge-integration-2026-10-06`, exact commit
`52b87ec6c456be0733eef3d55afcaf7850da70d3`. Push verification precedes the root pin.
