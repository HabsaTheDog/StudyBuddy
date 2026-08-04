# Roadmap

Study Buddy is preparing its first public alpha release. Dates are intentionally
not promised; safety and reproducibility gates take priority.

## Release blockers

- Rotate or revoke every credential previously disclosed outside protected
  storage and complete automated full-history scans of both repositories.
- Replace real portal/course/attempt fixtures with synthetic examples.
- Review, split, test, commit, and publish the current `t3code-fork` work; then
  pin its public commit from the root repository.
- Replace the inherited T3 CI/release automation with Study Buddy-owned,
  GitHub-hosted workflows.
- Add an integrated clean-clone test for the pinned UI submodule.
- Complete license/SBOM review and a clean-machine install on each claimed
  platform.
- Remove the course-specific production template shortcut or convert it to
  validated evidence-derived bank content.

## Alpha goals

- A safe no-credentials synthetic demo.
- Clear Moodle compatibility boundaries and a maintained FH Technikum adapter.
- Reproducible source and desktop artifacts with checksums and an SBOM.
- Private vulnerability reporting, protected default branch, required checks,
  and a small set of contribution-ready issues.

The concrete repository sequence is tracked in
[docs/github-launch.md](docs/github-launch.md).

## Later candidates

- Additional institution adapters with synthetic fixtures and clear ownership.
- Better accessibility testing and multilingual onboarding.
- Privacy-preserving, opt-in product feedback only after the privacy contract is
  complete.

Open an issue before proposing a new roadmap item that expands data access,
permissions, network behavior, or long-term state.
