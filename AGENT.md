# Study Buddy 2.0 Agent Rules

- Keep all Moodle/CIS pipeline logic isolated under `src/custom-skills/moodle/`.
- Do not modify host routing, state, or UI files for the Moodle skill.
- Treat `reference repo Study Buddy 1.0/` as read-only domain reference only.
- Use V1 for Moodle data shapes, study-document expectations, and Typst conventions; do not copy its Python architecture or execution flow.
- Govern the Moodle pipeline with LangGraph, not a linear script.
- Preserve the strict graph state fields: `moodle_raw_text`, `extracted_data`, `final_document`, `error_log`, and `retry_count`.
- Route invalid analyzer JSON back to the analyzer with `error_log` repair context.
- Route invalid Typst back to the formatter with validator diagnostics.
- Abort retry loops after three retries.
- Expose both a reusable TypeScript API and a CLI wrapper.
- Prefer live Moodle reads for current information; download linked files only as per-run artifacts when they add usable source text.
- Prefer live CIS reads for timetable, exam, administrative, and study-program information that Moodle does not expose.
- For any question about tomorrow, today, schedules, rooms, attendance, exams, deadlines, Fachlabor/lab sessions, or "what are we doing in class", use both Moodle and CIS before answering.
- Do not conclude that information is unavailable just because Moodle has no dated entry; check CIS and report source coverage.
- Never submit final Moodle quiz attempts.
