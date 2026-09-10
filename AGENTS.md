# Study Buddy Agent Rules

- Study Buddy is a universal study agent, not degree-, course-, subject-, or institution-specific. Build reusable modular behavior that adapts to the user's topic, study context, and configured sources; avoid hard-coded curricula, subject templates, or source assumptions.
- Study Buddy must coexist with independently installed T3 Code. Never share or alter its identity, state, ports, protocols, launchers, artifacts, updater, migrations, or processes unless explicitly requested.
- `t3code-fork/` belongs exclusively to Study Buddy. Treat `reference repo Study Buddy 1.0/` as read-only.
- Keep Moodle and CIS pipeline logic under `src/custom-skills/moodle/`; do not couple it to host routing or UI state.
- Use the current Study Buddy 2.0 contracts and LangGraph architecture. Preserve `moodle_raw_text`, `extracted_data`, `final_document`, `error_log`, and `retry_count`; stop after three unsuccessful validation retries.
- Never submit a final Moodle quiz attempt or exceed the existing permission boundary.
- Before changing Study Builder, read its implementation charter and relevant product specification, then update its implementation plan.
- Store workflow state under `study-buddy-data/`. Never place generated artifacts inside forks or reference repositories.
- Use the applicable Study Buddy skill for workflow-specific acquisition, rendering, testing, and delivery procedures.

## Batched Development and Release

- Accumulate compatible fixes and features on the current development version instead of starting or incrementing a release for every change. A batch of roughly 10–20 fixes is a planning heuristic, not a quota or permission to merge unverified work.
- Give every change focused deterministic tests, a scoped commit, and an entry in the development batch backlog. These checks make a change safe to queue; they do not make the accumulated version release-ready.
- Freeze the batch deliberately before release. At that point, run the applicable Study Buddy review and release skills, resolve the holistic review findings, and build one exact candidate from the reviewed commit.
- Because clean packaged acceptance is expensive, reserve full Fedora and Windows VM testing for the exact frozen candidate rather than every small development commit. Any byte change after acceptance invalidates that evidence and requires a rebuilt candidate and fresh affected acceptance.
- Do not tag, publish, promote, or call a build release-ready without explicit owner approval and the required final review, packaged checks, and clean Fedora/Windows VM acceptance. Never move or reuse a public tag for changed bytes.
