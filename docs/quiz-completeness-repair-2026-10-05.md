# Agent-owned quiz completeness repair — 2026-10-05

Reviewed source and deterministic regressions pass. Two fresh native Electron
fixture runs have independent terminal **PASS** on identical frozen production
bytes. This is local development acceptance, separate from live Moodle and
packaged release acceptance. Earlier reports remain historical evidence.

## Causes and current implementation

The earlier real start consumed its immutable debit before an unrecorded request
guard denial; the exact denied request is still unknown. A separate local browser
reproduction proved a redirected GET could bypass interception and lose provisional
identity. The existing repair admits the original POST once, validates its redirect
before continuation and never retries that start. This is not proof of the exact
cause of the real denial.

The completeness audit found additional local gaps: partial page/media capture,
missing shared descriptions, stale question/context receipts and treating a summary
as completion. Frozen tools now collect the whole known native question inventory
through same-bound-attempt GETs, including description-only pages without saving
or advancing empty pages. Shared text/images accompany every question packet.
The native owner delegates each question; tools add no model-owned solving chain.

Original image bytes, hashes, dimensions and source order are retained; larger
source variants precede screenshots. A safe SVG can have a faithful PNG viewing
copy while retaining its original provenance. Required-media failure blocks fill.
Question identities retain control option values while excluding response state.
Changed questions, original media or shared context invalidate packets and durable
save/reload receipts. Completion requires known full inventory and fresh verified
receipts, not merely reaching the summary. Windows and POSIX image paths use the
same original-before-screenshot ordering.

Desktop fixtures also exposed continuation requests selecting the default Moodle
connection instead of the run’s saved quiz target. The broker now resolves the
source from that owner-bound target and uses the server’s stable document-owner
thread, rather than the temporary broker execution UUID. Native Moodle navigation
contains a hidden “Question” label before its number; inventory parsing now removes
that accessibility prefix and distinguishes actual information items.

Broker source admission and stable owning-thread scope remain authoritative;
forged protocol/query/path inputs fail before credential resolution. First-only
binding, immutable start admission, approval and never-final guards remain intact.

Modern Moodle 5 history cards use a nested `quizreviewsummary` table. Metadata now
reads that actual structure as well as earlier supported forms, exposes only
bounded sanitized identity evidence and requires exact supported URLs/forms for
IDs. A first card ordinal alone cannot invent an active attempt identity. Public
template: [Moodle 5 attempt summary](https://github.com/moodle/moodle/blob/MOODLE_500_STABLE/mod/quiz/templates/attempt_summary_information.mustache).

## Actual real-quiz limitation

The authorized read-only status currently reports two allowed attempts, one used,
one left and an active attempt. The history card proves ordinal 1, but both
`activeAttemptId` and `activeAttemptNumber` remain null and `firstAttemptBound`
is false. No original questions or answer-save success is inferred from that view.
The former zero-used snapshot predates the consumed start debit and is superseded.

There is no actual quiz timer (`timeLimitMinutes:null`, `timeLimitUnlimited:true`).
The closing deadline remains separate: Tuesday 6 October 2026, 23:59 Europe/Vienna
(`2026-10-06T21:59:00Z`). Its effective remaining window is still enforced; absence
of a timer does not remove the deadline. No second start, debit reset or final
submission is authorized. The real inaccessible first attempt remains unresolved.

## Verification and native evidence

- Final frozen root suite: **1,625 passed, four existing skips**, 176 files,
  69.34s; `evidence/root-tests-frozen.log`. Earlier broad checkpoint was 1,624/four
  skips before the narrow Windows image-ordering delta.
- Five direct-browser and six media regressions; 24 direct unit checks
  include the Windows image-ordering regression. 87 UI focused tests, format/lint and all 13
  typechecks pass.
- Independent frozen-source/local-counterexample review passes, including 68
  focused tests. Changed shared context refuses fill before saving and invalidates
  later receipts; supplied local answers are actually saved and reloaded. This
  evidence tests tools, not native mathematical solver quality.
- Native Electron owner `47503def…` reached terminal **PASS** on the isolated
  synthetic fixture at port 41893, 10:49:24–10:54:05 (about 4m41s): five captured,
  five verified, zero unresolved, all five server answers correct, one start,
  three saves and zero final submissions. Original 1600×1000 image viewing and
  three overlapping native workers reused for five questions were observed.
- Independent first-run native review: **PASS 4/4**, all three owned worker
  threads terminal after five tasks. Evidence: `evidence/native-frozen-first-independent-review/`.
- Unchanged fresh repeat `b2ca8522…` on local port 34687 finished at 11:02:48
  after about 5m52s, with all five reference-correct answers saved and freshly
  verified, zero unresolved, one start, three saves and zero final submissions.
  Independent review confirms five overlapping question solvers, actual original
  image access and all five worker turns terminal. These isolated native fixture
  passes are not real Moodle attempt acceptance.

Evidence root: `study-buddy-data/optimization-campaigns/complete-agent-owned-quiz/`.
All three temporary Moodle connections were removed through the native settings
UI; the real source settings remain in place. Synthetic servers are stopped.
The real reservation/start-debit bytes match the recorded snapshot after testing.

Key records: `evidence/actual-readonly-status.json`,
`evidence/independent-integration-review.json`, `evidence/final-result.json`,
`evidence/native-frozen-first-independent-review/review.json`,
`evidence/native-frozen-repeat-independent-review/review.json` and the final
root log above.

UI integration is committed locally as `c73e34b6f`; root source, dependency pin
and this handoff are included in the scoped integration commit. No push, merge,
deployment, packaging, publication or release acceptance occurred. Frozen source
review is distinct from a release freeze; later exact Windows/Fedora packaged
acceptance is still required.

The campaign compares the original browser-diagnostic tool-contract baseline
against the same contract. Both actual desktop runs are additional acceptance
gates; they do not manufacture a comparable unchanged desktop baseline.
