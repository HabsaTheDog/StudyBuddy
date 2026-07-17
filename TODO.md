# Study Buddy TODO

## Cross-platform PDF extraction and visual handling

Study Buddy currently supports Linux directly and should work on macOS when Homebrew binaries are available on `PATH`. WSL follows the Linux path. Native Windows support is not yet verified and must not be described as complete until the items below pass.

### P0 — Native executable discovery

- [ ] Replace the current exact-name executable lookup with a cross-platform resolver.
- [ ] On Windows, honor `PATHEXT` and resolve `.exe`, `.cmd`, and `.bat` executables.
- [ ] Handle executable paths containing spaces, including native Windows Poppler and LibreOffice installations.
- [ ] Add explicit configuration overrides:
  - [ ] `STUDY_BUDDY_PDFTOTEXT_PATH`
  - [ ] `STUDY_BUDDY_PDFTOPPM_PATH`
  - [ ] `STUDY_BUDDY_LIBREOFFICE_PATH`
- [ ] Validate configured executable overrides and report an actionable error when a path is invalid.
- [ ] Add unit tests for Linux/macOS executable names, Windows extensions, `PATHEXT`, spaces in paths, and explicit overrides.

### P1 — Platform-specific setup and diagnostics

- [ ] Keep Debian/Ubuntu, Fedora, and macOS dependency commands documented and tested for obvious syntax errors.
- [ ] Add native Windows installation instructions for Poppler, Typst, Node.js, Playwright, and optional LibreOffice conversion.
- [ ] Add a PowerShell setup/check script; do not require Bash or GNU `sed` for native Windows setup.
- [ ] Document WSL separately from native Windows so users choose the correct installation path.
- [ ] Detect Apple Silicon and Intel Homebrew paths when Homebrew is not initialized in the current shell.
- [ ] Extend `moodle:doctor` to print platform-specific remediation commands for missing executables.
- [ ] Ensure doctor JSON reports the resolved executable path and version for every dependency.

### P1 — Cross-platform integration tests

- [ ] Add CI jobs for current Ubuntu, macOS, and Windows runners.
- [ ] Run typechecking and the complete test suite on every supported operating system.
- [ ] Add a PDF extraction smoke test using a normal text PDF.
- [ ] Add a sparse scanned-PDF smoke test that verifies fast, explicit partial coverage without automatic OCR.
- [ ] Exercise temporary directories and repository paths containing spaces and non-ASCII characters.
- [ ] Verify cancellation, process termination, atomic `.part` cleanup, and command timeouts on every operating system.
- [ ] Verify that spawned Poppler, LibreOffice, and Typst processes do not remain active after cancellation.

### P2 — Distribution and maintenance

- [ ] Decide whether dependencies remain system-managed or whether Study Buddy offers an optional managed tool bundle.
- [ ] If system-managed, document minimum supported versions and known-compatible package sources.
- [ ] If managed, define checksum verification, update policy, licenses, cache location, and an opt-out mechanism.
- [ ] Add a support matrix to the README with explicit statuses: tested, best effort, and unsupported.
- [ ] Record dependency versions and resolved paths in each run's diagnostics for reproducible incident analysis.

## Completion criteria

- [ ] `npm run typecheck` and `npm test` pass on Linux, macOS, and native Windows CI.
- [ ] `npm run moodle:doctor -- --json` discovers Poppler and optional LibreOffice on all three platforms.
- [ ] A text PDF produces usable structured extraction and a scanned PDF produces an explicit bounded partial result on all three platforms.
- [ ] Missing dependencies fail or warn before a Moodle crawl with a command appropriate to the detected operating system.
- [ ] README setup steps have been manually verified on a clean Linux, macOS, and native Windows environment.
- [ ] Native Windows support is only marked complete after all criteria above pass.
