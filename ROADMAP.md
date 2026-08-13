# Roadmap

Study Buddy is preparing its first public alpha release. Dates are intentionally
not promised; safety and reproducibility gates take priority.

## Release blockers

- Rotate or revoke every credential previously disclosed outside protected
  storage. Automated full-history scans of both repositories are now in place;
  the remaining rotation confirmation is a maintainer action.
- Remove the confirmed historical health document from reachable public Git
  history through a coordinated rewrite. Current-tree deletion alone is not a
  sufficient privacy response.
- Real-looking portal resource IDs in current test fixtures have been replaced
  with synthetic IDs and the public-tree gate enforces this boundary.
- Keep the reviewed public `t3code-fork` commit pinned from the root repository;
  updates must continue through a separately reviewed interface PR first.
- Inherited T3 deployment/release automation is disabled and CI now uses
  GitHub-hosted runners. A dedicated signed Study Buddy artifact workflow is
  still required before binary publication.
- Root CI recursively checks out, audits, formats, typechecks, and tests the
  pinned UI submodule. Final release candidates still require a clean-machine
  artifact installation round in addition to CI.
- License and SBOM generation gates are implemented, and the fork now installs
  from a clean frozen-lockfile checkout without private registry access.
  Complete final SBOM review and clean-machine installation on each claimed
  platform.
- The active publication path no longer uses fixed subject templates and is
  protected by cross-course contract regressions. Complete fresh standalone
  Balanced rounds for DYN2 and Business English before claiming broader generic
  course support.

## Alpha goals

- A safe no-credentials synthetic demo.
- Clear Moodle compatibility boundaries and a maintained FH Technikum adapter.
- Reproducible source and desktop artifacts with checksums and an SBOM.
- Private vulnerability reporting, protected default branch, required checks,
  and a small set of contribution-ready issues.

The concrete repository sequence is tracked in
[docs/github-launch.md](docs/github-launch.md). The current verified state and
remaining owner actions are recorded in
[docs/release-readiness.md](docs/release-readiness.md).

## Later candidates

- Additional institution adapters with synthetic fixtures and clear ownership.
- Better accessibility testing and multilingual onboarding.
- Privacy-preserving, opt-in product feedback only after the privacy contract is
  complete.

Open an issue before proposing a new roadmap item that expands data access,
permissions, network behavior, or long-term state.
