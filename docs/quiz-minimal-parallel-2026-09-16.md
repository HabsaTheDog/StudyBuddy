# Quiz capture, parallel solving and verified filling

Development change for `0.2.3-alpha`. Not a release, deployment, or live-Moodle acceptance claim.

## Reported failures and cause

The September 15 Math runs captured only pages 1 and 2 of a ten-page attempt. The second question required graphs that were not attached to the model. A low-confidence answer stopped the complete page loop. Already-selected checkboxes were reported as newly saved, although persistence was inferred from navigation rather than a fresh server response. The two Rechnungswesen Mini-Tests request was routed to an obligation inventory instead of quiz execution. Later attempts stopped at the timed-start dialog. Wrapper `quiz-url --help` incorrectly launched an unrelated workflow.

The main problem was orchestration, not that a model could not click a radio button: serial model waits inside browser traversal, incomplete visual evidence, duplicate context, brittle admission and optimistic completion accounting.

## One execution path

The production LangGraph now resolves targets, admits each exact attempt, then invokes one capture/solve/fill workflow. The old separate serial solver/fill graph nodes are removed. No new service or agent framework is introduced.

1. Resolve the requested quizzes once. Explicit URLs do not trigger broad discovery. Course discovery retains its source scope and filters exhausted/closed attempts; an unavailable second quiz remains an explicit coverage gap.
2. Isolate each quiz in its own browser and child run directory. Native grants remain exact-target grants; a grant for quiz A never enables quiz B. Multiple native approvals can be passed as repeated CLI flags.
3. Capture every navigable page before waiting for a model. Each question gets a compact semantic/control packet, full question screenshot, and authenticated original image files with hashes and dimensions. Original PNG/JPEG/WebP files and the context screenshot reach the model. SVG and other formats remain original evidence; the screenshot supplies their visual representation.
4. Queue independent question threads together, with eight concurrent solver threads per quiz by default (`--quiz-solver-concurrency`, bounded 1–32). The existing global provider scheduler and profile policies still apply. Existing visual answer verification is retained. One failed or uncertain question does not cancel the other questions.
5. Revisit each captured page, fill supported confident answers, save using safe navigation, reopen the same attempt page and compare every response control. Report newly filled, already matching, verified and unresolved separately. A click alone is never proof of storage. Final submission is never clicked.

Progress records capture phase, questions, solver overlap and verified fills. `quiz-metrics.json` records capture/solve/fill durations and workload counters; no token or speed improvement is fabricated from fixture runtime.

## Regression evidence

- A real local HTTP/browser ten-page fixture captures all ten question screenshots before model work; eight fake-model calls overlap. A deliberately uncertain answer stays empty, a discarded POST is detected after reload, and the other eight responses are verified. Final-submit counter remains zero.
- Deterministic tests cover complete capture at an exact page limit, partial coverage, individual solver failure, resumed suffixes, cross-attempt changes, cancellation before work and cancellation during filling.
- Browser tests prove the timed-start modal transition, server persistence comparison, compact MathJax text and no-op recognition.
- Media tests prove original authenticated 1600×1000 image bytes/hashes despite a 160px display, full tall-question screenshots, independent image/screenshot failures, redirect/origin protection, secret redaction and separate browser cookie contexts.
- Batch tests prove overlapping isolated quiz workflows, separate permission files, exact-target grant isolation, preservation of a successful sibling after failure and explicit missing-target status.
- Routing and wrapper tests reproduce the German two-Mini-Tests action, preserve obligation overview routing and ensure help cannot start a run.

The old clean source (`91c374a`, UI `15f3e91`) was restored temporarily after saving the implementation in local commits. The exact same ten-page HTTP/browser benchmark then reproduced the incident, and was rerun after restoring the implementation (`230e83b`, UI `b2eecc505`):

| Controlled fake-model benchmark | Before | After |
| --- | ---: | ---: |
| Captured pages | 2 | 10 |
| Peak concurrent model calls | 1 | 8 |
| Correct answers actually stored by fixture server | 1 | 8 |
| Answers verified after reload | 0 | 8 |
| Original-image attachments to model calls | 0 | 2 |
| Final submissions | 0 | 0 |

Question 2 deliberately has low confidence; question 7 deliberately discards its POST. Thus eight verified answers is the correct candidate outcome, not ten. Model calls rise from 2 to 20 because the old run stops early while the candidate solves all ten questions and performs the existing visual verification. This is a correctness/concurrency comparison, **not** a production speed or token-cost claim. Reproducible local fixture and results are under `study-buddy-data/optimization-campaigns/quiz-pipeline-comparison.mts` and `quiz-controlled-comparison/{baseline,candidate}/comparison.json`.

Checks: final default `npm run verify` passed: 1,220 root tests, 4 skipped (152 files), root typecheck and workflow package check. Also passed: 9 wrapper CLI checks, 7 focused desktop-adapter/packaged-wrapper tests, all 13 UI workspace typechecks and full `vp check`. The first simultaneous root/UI verification hit two test-runner timeouts under contention; both a bounded-worker full rerun and the final default run passed. The new multi-process wrapper regression has a 15-second test timeout; no production timeout was relaxed.

## Explicit limits and remaining acceptance

- Capture-first requires Moodle free question navigation. Sequential quizzes that prohibit returning to previous questions cannot safely be photographed in full before solving. The workflow reports this limitation and does not fill or advance them blindly.
- The new authenticated media path is Playwright. Legacy CLI browser clients can provide screenshots but not this authenticated original-image capture API.
- Original files are unscaled locally. The downstream model may resize its vision input. Playwright buffers responses before the 16 MiB accepted-image size check; the check is not a streaming-memory limit.
- No new production quiz attempt was started during development. Live model accuracy, real Moodle timing, native two-card approval acceptance and final Windows/Fedora packaged acceptance are still unmeasured. These fixture results are development evidence, not desktop end-to-end acceptance.
- The optimization campaign `quiz-minimal-parallel` is local diagnostic state. Its initial unmatched comparison was rejected and the checkpoint restored. The second iteration independently reproduced the two-page baseline at the original commit and used the same fixture for the candidate. Diagnostic acceptance does not substitute for native desktop or real-model acceptance.

Handoff: focused local source changes; no push, merge, release publication or installed-app deployment is authorized by this work. The reviewed UI dependency must be pushed before its parent pointer if a later task authorizes pushing.
