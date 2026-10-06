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

## Authorized desktop First-Try — 2026-09-16

After the owner approved restarting only Study Buddy, the official desktop-dev
launcher opened the actual Electron shell with automation enabled. Existing
Study Buddy state was preserved; independent T3 Code was untouched. Native
reactivation and CDP focus emulation were needed for reliable automation input.
This was not a substitute browser tab or packaged-release acceptance.

Fresh Quick Chat `88bc15fc-a911-40a3-ae8c-bd072ccb3aa8` used the base Balanced
profile, unchanged Full access / Help during quizzes settings, and one prompt:

> Please fill both Elektrotechnik 2 self-check quizzes and leave them ready for me to review, without final submission: https://moodle.example.invalid/mod/quiz/view.php?id=REDACTED and https://moodle.example.invalid/mod/quiz/view.php?id=REDACTED.

No follow-up repair prompt was sent. The visible desktop turn completed in
**5m 3s**, from 08:13:01 to 08:18:04 UTC. Both quiz workers overlapped and
completed successfully; there was one workflow run and no model-call retries.

| Self-check | Captured / reload verified | Newly filled / already matching | Peak solvers | Worker duration |
| --- | --- | --- | --- | --- |
| 1 | 13/13 | 0 / 13 | 8 | 124.074 s |
| 2 | 6/6 | 1 / 5 | 6 | 235.668 s |

All 19 responses were persisted, both attempts reached their summaries, and
neither was finally submitted. The native final response reported those exact
counts and linked both quizzes. The previously held three-phase answer passed
the unchanged solver/verifier gate this time (confidence 0.96, no risk flags).
Its rationale still uses the standard positive phase-sequence convention: this
is persistence/integration acceptance, **not proof of mathematical correctness
or reliable uncertainty calibration**. Existing answers were deliberately
reused, so this is not a clean-blank 19-answer test; earlier live evidence covers
new writes and deterministic fixtures cover empty same-page attempts.

Leaf-model telemetry: 38 completed calls, 727,331 input tokens including
302,336 cached tokens, and 28,533 output tokens. These figures exclude the outer
desktop agent; they are not a whole-turn token total. Quiz 2 spent 200.561 s in
solving/verification, versus 29.773 s capture and 5.333 s fill/verify. Parallelism
works, but this does not establish an overall speed or cost improvement.

Canonical run under that fresh thread: `study-buddy-data/runs/`
`please-fill-both-elektrotechnik-2-self-check-quizzes-and-leave-them-ready-for-me/`
`2026-09-16T08-13-28-120Z`. Desktop screenshots are in the campaign's
`evidence/desktop-running.png` and `evidence/desktop-completed.png`.
Worker inspection found no remaining active workflow after completion. The app
was left open. Source repair `7f070f8` and this evidence are local only; no push,
merge, publication, or packaged Windows/Fedora release acceptance is claimed.
