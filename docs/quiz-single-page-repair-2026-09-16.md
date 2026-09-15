# Single-page quiz repair — development evidence

## Reported failure

Thread `bc590ede-79c0-48f4-aed9-b20d895f1e18` started two Rechnungswesen
attempts and produced eight answer specifications, but saved none. Each quiz
showed all four questions on the current page. The capture-first guard required
an actual navigation href and marked the page non-revisitable. The fill stage
then skipped every specification while incorrectly reporting `no-answer-spec`.
Those timed, limited-attempt quizzes were not used for this repair's live tests.

## Change

- Recognize a complete first page when all question-navigation buttons identify
  page zero and their count matches the captured questions. Same-page buttons
  need no href. Capture all questions, solve concurrently, then fill and save
  once before verifying the responses after a real reload.
- Do not mistake a current-page link, a foreign origin, or a different attempt
  for permission to revisit another page. Unknown or sequential navigation is
  still blocked, with no model work, browser reopening, fill, or advance.
- Surface verified counts and concrete failure reasons in both single-quiz and
  batch errors. A navigation defect must not masquerade as absent answers or a
  request for user permission.
- Preserve original-image acquisition, independent question threads, isolated
  quiz batches, cancellation, confidence gates, and the final-submit prohibition.
- Wait for the destination's `DOMContentLoaded` after a browser click: Playwright
  can finish the click at navigation commit while Moodle's next document still
  has no questions. Do not wait for network idle or add fixed page sleeps.
- Exclude Moodle's `.questionflag` controls from extraction and filling. They
  are administrative UI, not answer fields, and Moodle can convert their initial
  checkbox to a hidden input after page initialization.

## Measured regression evidence

An unchanged-workflow HTTP/browser fixture with four questions and href-less
Moodle-style navigation reproduced **0/4** persisted answers. The same fixture
after the repair verifies **4/4**, with four overlapping solvers, exactly one
save, and zero final submissions. A second case discards the server save and
correctly reports **0/4**, never success.

Forty focused tests pass across navigation, workflow, graph and real
browser fixtures. The existing ten-page fixture still captures everything before
solving, reaches eight concurrent solvers, downloads the original authenticated
1600×1000 image byte-for-byte, isolates an uncertain answer, and detects a
discarded server save. Full `npm run verify`: **1,228 passed, 4 skipped**, 153
test files, plus package contract and TypeScript checks.

## Live acceptance

Campaign: `study-buddy-data/optimization-campaigns/quiz-single-page-live`.
The owner authorized repair and testing on unlimited, untimed old Elektrotechnik
self-checks. Read-only discovery through the existing app credential broker
found Elektrotechnik 2, course 32897, self-checks 2246315 and 2246333. Their
landing pages display no attempt/time limits; the first offers another attempt
after thirteen completed attempts, and the second has an attempt open since
July. No live attempt was started during discovery.

The first live diagnostic ran both quizzes concurrently but failed acceptance:
quiz 1 captured only 4 of 13 questions and persisted 2; quiz 2 captured only 2 of
6 and verified 1 existing answer. Both stopped on `capture-page-has-no-questions`.
Two valid answer plans also included a question-flag checkbox that became hidden
before filling. A complex three-phase question was separately blocked by a
model-reported phase-sequence assumption; that safety gate was not bypassed.
Neither attempt was finally submitted. The failed iteration was rolled back to
its verified starting checkpoint before the expanded repair was reapplied.

Both newly discovered defects reproduce in deterministic browser tests before
the repair and pass afterwards. The second live diagnostic used the same two
attempts, Balanced profile and prompt:

| Self-check | Capture | Verified after reload | New / already matching | Solver overlap | Duration |
| --- | --- | --- | --- | --- | --- |
| 1, activity 2246315 | 13/13, complete | 13/13 | 11 / 2 | 8 | 135.180 s |
| 2, activity 2246333 | 6/6, complete | 5/6 | 1 / 4 | 6 | 210.532 s |

Both quizzes ran concurrently. Both have zero navigation/workflow issues and
zero final submissions. The second quiz's remaining question is held by the
existing answer-risk gate because the solver assumes a phase sequence. The
batch truthfully reports that exact reason and does **not** declare both quizzes
complete. The repair passed live navigation/filling/persistence validation;
unconditional full completion of both quizzes did not pass and is not claimed.

Canonical run suffixes under the reported thread's `study-buddy-data/runs/`:
`fill-both-unlimited-untimed-elektrotechnik-2-self-check-quizzes-and-save-the-ans/`
`2026-09-15T23-30-44-426Z` (failed iteration) and
`2026-09-15T23-37-33-040Z` (repaired live diagnostic). The candidate preserves
158 downloaded original image assets. There are still non-fatal render-readiness
warnings and one formula-image download failure; screenshots and extracted TeX
remain available. This repair does not claim those media warnings are resolved.

Desktop First-Try acceptance remains pending: the running Study Buddy Electron
instance has no automation connection,
and permission to restart only that app was requested. Browser/pipeline evidence
is not desktop acceptance. Independent T3 Code and unrelated active work were
not changed. No release, publication, or pushed-source claim is made.
