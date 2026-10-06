# First-attempt identity and approval recovery — 2026-10-05

The actual native Electron owner `41276119…` now passes independently: all ten
answers in the existing first attempt were preserved, saved and freshly reloaded,
with ten valid receipts and whole-quiz completion. `total:10`, `captured:10`,
`verified:10`, `captureComplete:true`, `unresolved:[]`, `complete:true`; final
submission remained false. The native task is terminal and has no owned children.

This accepted workload preserves earlier independently reviewed answers; it is
not a first solve from an empty attempt, an official grade, or a comparable
performance benchmark. Five earlier native rounds remain rejected, and the
root-controlled rescue remains a separate diagnostic. Source checks pass 1,718
tests plus four existing skips. The scoped recovery repair is committed locally;
nothing is pushed, merged, deployed, packaged or release-accepted.

## Concrete causes

Moodle 5 deliberately omits an in-progress attempt ID from its overview card.
The card can prove ordinal 1 and an active attempt while Continue is a POST
containing only the course-module ID. Requiring an ID-bearing overview link
therefore rejects a legitimate first attempt even after its original start
response supplied an exact ID. A card ordinal alone still cannot invent that ID.

The original failed real start predates the new response receipt. Its immutable
debit is preserved. The exact earlier denied request remains unknown; the local
redirect reproduction is a separate proven transport defect, not retrospective
proof of that real request.

The first subsequent native recovery also exposed an approval-order defect:
inspection evaluated the first-only policy before resolving the ID-less card.
Recovery could identify the attempt, but inspection had not produced the native
permission card. The revised inspection performs the permitted identity lookup
before the existing permission decision. Approval remains mandatory under the
selected access policy; identity is never approval.

The next actual approved continuation reached the same bound first attempt and
confirmed ten questions on ten pages, then exposed another concrete transport
defect: a read-only JavaScript loader GET was treated as an unsafe quiz endpoint.
Its sticky guard error discarded the capture operation after original image
bytes had been fetched. Captured-image downloads are not successful tool
delivery or answer acceptance. No answer save was reached. The request-admission
fix remains separate from the proven identity and approval-order repairs.

The following native round captured and solved all ten questions, but rejected
legitimate DOM fills because immutable question identity still included browser
response/rendering state. Subsequent local and read-only counterexamples isolated
these concrete causes; the mathematical source and safety gates are retained:

- MathJax source and generated presentation varied during typesetting. Identity
  now uses original TeX once, including shared stems and option text, rather than
  comparing redundant rendered/assistive mathematics.
- Lazily assigned numeric YUI IDs on non-control nodes, `data-initial-value`,
  answer status classes such as `answersaved`, and selected/checked/live response
  values are mutable transport state. Their canonicalization preserves actual
  control IDs, immutable choice encodings, original givens and image references.
- Image drag/drop creates placed/reusable clones and hides filled targets. Public
  choice identity is bound to its value, group, reuse flag and original
  `image_src`; clones do not create new choices. Hidden targets retain their
  original public bounds instead of adopting the placed image's different size.
- Media identity is ordered by stable original URL/hash, not changing acquisition
  order. Full-size original bytes, completeness and exact per-choice references
  remain required; a changed original still invalidates old answers/receipts.

The next native continuation exposed two remaining identity edges: completion
still bound dynamic drag/drop control geometry, and course-navigation response
text entered shared immutable context. Final completion therefore invalidated
nine previously valid receipts. The narrow repair binds original public target
geometry and removes navigation from the cloned shared-context representation,
while retaining actual shared question givens/descriptions. Receipt invalidation
does not mean previously saved Moodle values were deleted.

A later Q10 prefill stale-packet counterexample showed unchanged normalized
question content, controls and original-media identity but differing raw rendered
bounds in the digest. Packet admission now uses the same immutable control view
as question identity, while binding current answer value/checked/selected state
separately. It still detects changed source mathematics, choice encodings, original
images and actual givens. Fresh-media technical retry is bounded to three tries
and an explicit transient whitelist with static diagnostics; unsafe content,
policy/request-guard failures and permission denials are never retried as media.
The rejected native media failure's exact discarded original category remains
unknown; later successful reads do not retrospectively prove that cause.

These are technical identity repairs, not answer-key overrides or permission
relaxations. Existing guarded first-only admission, native approval, final-submit
blocking and complete save/reload verification remain mandatory.

## Implementation and safety boundary

- A new first start reserves known zero-used/no-active state and irreversibly
  debits the sole admitted start POST. The guarded transport supplies its actual
  validated 302/303 response identity before browser continuation. A durable
  `start-response.json` records that exact same-origin attempt URL and ID in the
  trusted account-and-quiz ledger.
- Binding additionally requires the current native unique first-history entry,
  one used attempt and active status. Conflicting IDs, another ordinal, unsafe
  redirects and missing acquisition proof fail closed. The redirect supplies
  identity; it does not manufacture an ordinal. Unbound writes remain blocked.
- Existing ledgers without that original receipt are never retrofitted or reset.
  The separate authenticated Moodle Mobile read helper resolves the configured
  target through course/module/quiz/current-user mappings and accepts only one
  non-preview, in-progress first attempt. Its fixed operations read identity;
  they do not start, continue, save, finish or submit a quiz. Authentication
  can create a Mobile token; it remains in memory, with no quiz
  mutation. Tool errors stay static and redacted.
- A bound legacy attempt without a receipt requires a fresh authenticated read
  proof when its native overview still omits identity. API loss blocks further
  writes. A stale stored binding alone does not enrich the current card.
- The native approval card and broker-staged grant remain separate gates. The
  latest inspection-order repair makes that card reachable after identity proof;
  it does not broaden access mode, bypass approval or permit a second attempt.
- Existing whole-question capture, original-image packets, native per-question
  delegation and fresh save/reload completion checks remain intact. No new
  planner, model worker or solving stage was added.

## Verification: distinguish the evidence surfaces

**Synthetic local fixtures:** 86 affected tests passed across four files in
68.99s at the receipt checkpoint. They include actual guarded Playwright starts
against local HTTP, a Moodle-style ID-less active card with POST Continue,
unbound recovery after initially unreadable native history, immutable one-start
admission and zero final submissions. A subsequent legacy API re-entry
regression proves recover → fresh read → fill → save/reload using the same ID,
with zero starts and no synthetic receipt. API unavailability then blocks
continuation. All 25 direct unit tests passed at that checkpoint; TypeScript and
diff checks passed.

**Actual read-only Moodle proof:** `actual-readonly-identity.json` records the
existing first attempt `2035873`, course `33590`, module `2318134`, quiz `116422`,
ordinal 1, non-preview and in-progress status. The native first-history card and
authenticated API agree. This lookup issued no new start and does not prove any
answer was captured, correct or saved.

**Combined checks and approval-order follow-up:** the root suite passed 1,661
tests with four existing skips in 178 files (96.57s) before the later
inspection-order change. After that change, the focused identity/direct tools
suite passed 30 tests and TypeScript passed. The final combined rerun passed
1,662 tests with four existing skips in 178 files (98.02s), recorded in
`final-root-tests.log`, before the subsequently exposed loader-admission repair.
After the narrow loader repair, the latest root rerun passed **1,689 tests**
with four existing skips in 178 files (94.51s); TypeScript passed. These source
checks remain separate from real answer acceptance and exact packaged release
acceptance.

**Actual real desktop continuation:** the stopped `99ee…` run is a rejected
approval-order diagnostic. Owner `c4602132…` / workflow `c3248939…` approved the
exact native card and reached the bound first ID, but its ten-page inventory
capture failed at the read-only JavaScript loader gate; zero answers were saved.
That failure remains historical evidence, not a successful continuation.

Following the narrow loader repair, fresh owner `0f1b6b85…` / workflow
`a57f9372…` approved the exact card and captured all ten questions on all ten
pages. The native owner delegated all ten question packets, including the
original graph and drag/drop choice images. Saving then failed **DOM answer
verification before safe-next**, including the first-page retry. Durable
`saveReceipts` was empty at rejection (**0/10**). The internal direct state reported
`active`; that persisted field did not establish native success or verified
saves. Answer/save-reload acceptance was still pending at that historical
rejection; the later accepted preservation round does not alter this result.
No second attempt or final submission is authorized.

**Later browser/runtime rescue — separate diagnostic:** root-controlled browser
work on the rejected `0f1b…` workflow subsequently saved and reloaded nine of ten
answers. Question10 was filled and verified in the DOM but remained unsaved at
that checkpoint because dynamic widget identity differed. This is not native
Electron acceptance and does not rewrite the rejected round's zero-receipt
terminal evidence. The final drag/drop identity fixes are tested separately.

**Fourth rejected native round:** owner `ae321762…` / workflow `2c6e77e6…`
started at13:56:44 Vienna with Balanced; the native card was approved at13:58,
valid until14:27. It recovered first `2035873`, captured all ten questions and
solved all ten through native question workers. Nine answers were initially saved
and reloaded successfully. Q10 then failed control identity verification. Final
`complete` compared course-navigation response text as shared question context
and invalidated the earlier receipts, leaving **0 valid terminal receipts**.
This is a rejected native round, not a nine-of-ten acceptance or deletion of the
previously persisted Moodle values.

Its exact native main-turn duration was **989.797s (16m29.797s)**, from
13:56:44.846 to14:13:14.643 Vienna. The proven owner plus three reused native
question agents recorded162 successful provider responses and8,850,472 total
tokens:8,515,712 cached input,312,777 uncached input,21,983 output. Reasoning
output1,106 is already included in output and is not added twice. Those provider
completion counts are not quiz retry counts. Four owned rollout files remained
hash-identical during the audit; metrics are in
`round-metrics/rejected-ae321-native.json`.

**Fifth rejected native round:** owner `3b315898…` / workflow `0a1e4acf…`
started14:26:45.411 Vienna and ended14:31:25.282, duration279.871s (4m39.871s).
The first fill rejected incomplete fresh media before any native write. No exact
discarded original error code/category is asserted. The owner subsequently read
and reloaded all ten existing values, preserving them; it produced no new native
save receipt and had no question-agent children. Its27 successful provider
responses used1,249,855 total tokens (1,172,224 cached input,73,447 uncached input,
4,184 output;450 reasoning tokens are included in output). The unchanged owned
rollout audit is `round-metrics/rejected-3b315-native.json`. This fifth round remains
rejected despite preserved values.

**Actual all-ten root verification — separate from desktop acceptance:** after
the bounded geometry/context/digest fixes, root re-filled as needed and the
same-first tool's complete operation returned `ok:true`, `total:10`,
`captured:10`, `verified:10`, `captureComplete:true`, `unresolved:[]`,
`complete:true`, `finalSubmitClicked:false`. Evidence is
`1791204269955909779-actual-root-all10-complete.json`. This establishes actual
preserved answer/save-reload verification for the existing first attempt, not a
hidden grading result or successful retrospective desktop round. No second
attempt or final submission occurred.

**Final source and accepted native gate:** the unchanged nine-file checkpoint
is `packet-identity-native-source-freeze.json`. Root source checks pass **1,718
tests**, four existing skips, 178 files, 94.29s; TypeScript passed. Logs:
`packet-identity-complete-root.log`, `packet-identity-final-typecheck.log`.
Earlier 1,701/1,708 checkpoints remain historical evidence.

Native owner `41276119-2c58-46e8-8440-7cc1665e35ad` / workflow
`a5a4aa29-0020-4f07-a069-7e23fcad230e` completed with normal same-first approval
and unchanged source. Its own `preserve-fill-0..9` results are all `ok:true` /
`persisted:true`, ten fresh receipts remain valid, and final whole-quiz reload
matches every preserved initial answer. Completion reports all ten captured and
verified, no unresolved questions, `complete:true` and final submission false.
No repair prompts, manual takeover or retries occurred in this accepted native
round. Parent `task_complete` is 12:55:15.616 UTC; the app is ready at
12:55:15.665 UTC, with no owned child workers. The human UI duration is about
9m24s; this preservation workload is not comparable to earlier full solving.

Independent acceptance is
`independent-review/native-41276119/final-acceptance.json`; root evidence is
`actual-native-all10-acceptance.json`. All ten original media URL/hash pairs and
all nine frozen source hashes match the independently reviewed originals. The
three ledger files are unchanged: no second start, debit reset or final submission.
The campaign is completed and accepted for this native preservation/save-reload
workload. The repair is committed locally; packaged release acceptance is separate.

| Native round | Terminal outcome | Duration | Successful provider responses | Total tokens |
| --- | --- | --- | --- | --- |
| `99ee…` | Rejected: approval ordering, no saves | 98.453s | 14 | 410,398 |
| `c460…` | Rejected: static-loader admission, no saves | 145.685s | 14 | 431,463 |
| `0f1b…` | Rejected: DOM verification, zero receipts | 678.683s | 111 | 5,459,059 |
| `ae321…` | Rejected: nine initial saves, zero terminal valid receipts | 989.797s | 162 | 8,850,472 |
| `3b315…` | Rejected: media admission before writes; existing values preserved | 279.871s | 27 | 1,249,855 |
| `41276119…` | Accepted: preserve/save/reload all ten, whole complete | About 9m24s, human UI | Not aggregated | Not aggregated |

Provider counts include proven native child responses where present and are not
quiz retry counts. Earlier failed-round metric files remain unchanged. The last
row deliberately avoids an unmeasured provider/performance comparison.

**Deferred follow-up:** an isolated dependency admission probe externally changed
DOM responses while media acquisition was awaiting completion; the page snapshot
could miss that concurrent edit. This timing edge predates the current changes.
No new permission bypass or actual browser write was proved. It is deferred
outside this nonconcurrent first-attempt acceptance; this acceptance is not a
packaged release claim.

**Independent mathematics:** the original ten-question capture, full-size Q1
graph, Q10 backdrop and all eight original choice images were personally read.
The independent report records mathematical results, not a hidden answer key or
Moodle grading. A later normal source-broker lookup read the assigned course
studienbrief's Definition22.23, PDF page18/printed17, which requires both
one-sided improper integrals to exist. The specifically cited Goebbels/Ritter
Definition2.35 redirects outside configured portal origins and was not accessed.
Native Q5 answers F/T/T explicitly qualify the third statement as a defining
splitting rule with both limits convergent; this is a defensible mathematical
reading. A literal unconditional reading yields F/T/F. Neither reading is an
established official-key result; preserve the question's interpretive limitation
rather than marking the qualified native rationale as a proven mathematical
contradiction. Q6's displayed `a∈R` excludes `−∞`; the strict answer is only0.

## Evidence and handoff

Evidence root:
`study-buddy-data/optimization-campaigns/actual-first-attempt-recovery/evidence/`.
Carry forward `actual-readonly-identity.json`, `actual-status-after-api.json`,
`local-source-receipt/source-freeze.json`, the read API helper checks,
`independent-review/final-source-review.json`, `full-root-tests.log`,
`approval-order-unit-tests.log`, `approval-order-typecheck.log` and the final
combined/native records when available. Include
`independent-math-review/math-review.json`, the primary-source supplement and
Q5 reconciliation; their read-only checks are separate from native saves. Keep
`round-metrics/rejected-native-rounds.json` and
`round-metrics/rejected-ae321-native.json` and
`round-metrics/rejected-3b315-native.json`, the immutable historical failed-round
metrics, the separate browser diagnostic evidence and
`final-drag-native-source-freeze.json`. Source hashes in earlier checkpoint
records are historical and must be reconciled against the final commit.

The earlier two complete native synthetic quiz fixtures remain separate evidence
in [the completeness report](quiz-completeness-repair-2026-10-05.md). The earlier
fixture and read-only identity checks are separate from the later actual native
preservation/save-reload acceptance above; none establishes official grading. The release agent must reconcile local commits and dirty work, then
perform the required exact frozen Windows/Fedora packaged acceptance.
