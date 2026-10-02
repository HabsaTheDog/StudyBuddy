# Latest failed runs: source development repair

This work repairs the two latest user runs of October 2. It is source-tree
development evidence, not packaged release acceptance. No release, push,
permission change or final quiz submission is authorized by this work.

## Causes and changes

The preparation PDF failed in extraction review because a Safe Exam Browser
`sebs:` launch control was classified as a Moodle quiz and copied into the
citable source manifest. Discovery now accepts HTTP(S) reference URLs only.
The surrounding source text and the SEB requirement remain available; the
strict source validator and HTTPS download restrictions remain unchanged.

Native output review also found that the source architect restored later
course chapters after correctly identifying the first assessment's narrower
scope. Initial acquisition probes and their priority were being mistaken for
required syllabus coverage. The deterministic repair no longer creates
learning modules or attaches primary sources by title overlap. Explicit
semantic architecture assignments remain authoritative, and stale architecture
caches are invalidated.

The quiz failed before discovery because Codex's core-only shell policy lost
the app wrapper routing. The standalone fallback then ran without the
credential broker. Only nonsecret runtime routing paths are now persisted into
that policy. The repository wrapper honors the authoritative app wrapper,
fails before standalone execution if that configured wrapper is unavailable,
and avoids direct/inode/broker recursion. Portal credentials remain private.

A fresh quiz exposed two further faults: the worker used bundled Codex 0.147.0
while the coordinator used configured Codex 0.160.0, and omitted profile flags
defaulted the worker to Quality despite the desktop's Balanced selection. The
broker now binds the owning thread's actual catalog-resolved profile and worker
assignments, removes stale caller model/profile overrides, and supplies the
configured Codex executable with the same managed PATH precedence as the
coordinator. The SDK retains its isolated account home, read-only model workers,
tool restrictions and actual token accounting.

The first technically valid PDF exposed a further output defect: its derived
exercises displayed invented point allocations. The shared Typst helper example
suggested supplying `points` without a scoring provenance contract. Initial and
repair authoring now omit points by default and share the review policy: only
exact source-documented official task points are allowed, derived tasks must be
identified locally, and optional self-rating is explicitly non-official. No
extra model call, lexical output gate or generated-PDF patch was introduced.

A subsequent exact-prompt repetition exposed unstable course resolution: a
generic subject word in an older course's reading displaced the explicitly
named current course. The failed selection itself acknowledged the direct
course-title match as an alternative. The existing unique literal-title matcher
had unnecessarily depended on a legacy subject-alias match. Removing that
dependency makes a unique directly named course authoritative with one
canonical page probe and no model call. The semantic path also prioritizes
direct identity and observed course/assessment timing without assuming semester
boundaries or overriding an explicit historical request. Independent review
found code/title conflicts and excluded-title cases that must prevent the fast
path. Existing positive-code and local-negation helpers now guard direct
selection and final semantic persistence. Conflict/exclusion recovery disables
only its literal shortcut, with a distinct cache key; ordinary search callers
retain their defaults and no broken-reference review is added. All 63 targeted
tests and independent review passed. No course-specific titles or IDs are added.

The next full run confirmed correct course and assessment scope, then failed at
the existing three-validation ceiling. A chapter-local warning from reference
systems was promoted to the aggregate model's `scopeNote` through a first
negative-keyword heuristic. That disclaimer claimed formulas and source
references were absent even though subsequent chapters contained them. A global
review finding (`chapterTitle=null`) was then assigned to the acceleration
chapter by textual overlap; selective repair retained the original cached
warning from another chapter. The global note/provenance and repair ownership
are repaired in `ed0eedb`. Local warnings carry their exact chapter, the global
note uses aggregate coverage, and an explicit global review finding remains
global through cache invalidation, focused fragments and resumed repairs. Old
chapter caches are invalidated. Offline replay preserved all 13 formulas,
eight examples, 18 sources and 11 warnings, with unchanged canonical hashes.
The strict reviewer correctly blocked the contradictory document; neither its
gate nor its retry ceiling is weakened.

A further full original-prompt run produced a technically valid 13-page PDF,
but independent output review rejected it. The decision rule said two nonzero
vector operands suffice to decide whether their cross product is nonzero,
omitting parallel operands. The isolated “only if” wording states a necessary
condition correctly; the error is presenting that necessary condition as the
complete decision procedure. The schedule helper also received two-cell rows
for its four-column shell, silently flattening adjacent rows into each other.
Universal mathematical assumption/counterexample prompts and compiler-enforced
table arity are committed as `2b651d9`. No subject-specific rule or artifact patch is used.

This run exposed another review contract issue: every finding associated with
an optional `should` requirement was automatically downgraded, including
concrete factual or mathematical defects. Structured defect classification (`ce7cfae`)
preserves genuine content errors as blocking while keeping missing optional
breadth advisory. A fresh unchanged repetition then demonstrated this distinction: a chapter
claimed the assessment duration was undocumented despite the explicit
30-minute announcement. Its structured factual-error finding remained
blocking despite the linked `should` requirement; one automatic local repair
corrected it and semantic review passed. Missing optional multipart-description
breadth stayed advisory. The particular raw cross-product complaints in round 6 were
false positives: Typst `times` correctly rendered the cross-product glyph; the
new prompt explicitly respects the formula language. Raw and normalized review
results remain distinguishable in the evidence.

The next independently checked PDF fixed the mathematical and table defects,
but still denied a documented date/topic. Moodle explicitly announces the
first test on October 5, 2026, covering relative kinematics in Block 2; the final
PDF instead claimed the date was unconfirmed because the calendar had no entry.
The chapter-packet builder admitted supplementary sources only when they had
`localPath`, discarding the freshly read HTML test page. The course announcement
was outside those packets. Later `study_model.sources` recovered its full title,
but the author consumes `extracted_data`, whose generic title and local warnings
had already lost the positive statement. A bounded server-owned
`document_context` now carries exact selected source records independently of
chapter coverage, with provenance and visible truncation. Prompt contracts
separate confirmed source attributes, full-syllabus uncertainty and absence in
one source role. Initial authoring, repair and review all receive the same
context. No additional model stage or generated-artifact patch is used.

The bounded request evaluator also used alphabetical representatives that could
retain a generic unavailability message while losing the fresh opening/closing
records. Metadata-based priority now reserves at most 48 records round-robin
within the existing 180-record and character caps. Explicit source exclusion,
selection, status and course ancestry govern that priority; dates and subject
words are not interpreted deterministically. Versioned disk caches include the
priority set, reversed-input prompts stay identical and same-input evaluation
uses one model call. Previously verified checkpoint contracts keep their
existing frozen semantics; direct document evidence is reconciled downstream.
Read-only replay preserves the exact announcement, opening/closing and duration
in 7,896/8,000 characters, with untouched canonical-state hash. Dense chapter
IDs, cache reuse, changed-source invalidation and deselected/skipped/unauthorized
vetos have focused and independent tests.

The next 17-page PDF correctly confirmed the announcement, distinguished the
older conflicting course grouping and used the current givens in its numerical
subtasks. Independent all-page review verified every numerical solution. One
qualitative exercise, however, stipulated rotation and nonzero relative velocity,
then offered zero rotation/velocity as answers without identifying changed
assumptions. Another checklist did not distinguish instantaneous zero angular
velocity from an identically nonrotating frame when suppressing derivative terms.
This output remains unaccepted. The shared universal mathematical contract is
refined in `ac6ed8b` for feasible task demands, unchanged givens and explicit
hypothetical variations; generated artifacts are retained unchanged.

A 16-page repetition then verified the task-consistency fix: all eight derived
examples/tasks had correct solutions under unchanged feasible givens. It still
failed independent output acceptance because one reproduced illustration showed
old incorrect values. The actual source PDF page was already corrected: the
visible composition shows 90 degrees = pi/2 and 0.034 m/s², while an underlying
embedded raster retains 2pi and 0.003 m/s². `pdfimages` extracted that underlying
object without the covering text/graphics. Discovery, analyzer ranking and
Auto/Focused hydration favored the raw object over a correctly rendered page.
This is lost source composition, not a wrong original slide. The generic visual
fix `151c94b` preserves fully rendered PDF composition, including overlays, before
any safe cropping; direct standalone image files remain usable. Original
source PDFs, rejected outputs and both visual comparison proofs remain intact.

The next repetition correctly discovered composed source images, but exposed a
producer-budget defect. Dense packing measured compact evidence JSON while the
fragment prompt serialized that evidence with indentation and added contract,
policies, document context, resource metadata and schema. The resulting
assessment-context chapter used 61,796 characters against its existing 60,000
cap. The preflight correctly blocked the call; there was no model transport
failure, no final PDF and no accepted answer. The producer correction is committed as `10b2f7e`. It budgets the complete
request envelope and uses lossless compact serialization first. Independent
read-only replay reproduces 61,796 characters before and 56,629 afterward,
including schema and leaf boundary, with all 55 evidence records, the exact
original request and complete document context unchanged. Five canonical
hashes are unchanged. Assigned fragments never drop or chop source content;
impossible protected payloads fail before model dispatch. Source URLs and
locators survive bounded manifests. The cap remains unchanged.

A fresh unchanged round then passed source and PDF-stage contracts, but remained
unaccepted after independent all-page review (2/4). One semantic architecture
module bypassed targeted chapter processing and used the bounded whole-request
path. Only one practice task reached the handoff; a source component formula
transcribed distinct xi/zeta basis directions to the same e_z despite a correct
composed source image. An excluded source image also reached that whole call.
The formatter reached its 240-second limit and the existing deterministic
fallback compiled a nine-page PDF with literal bare-bold notation and duplicated
framework sections wherever learning modules shared course-source citations.
The fallback did not cause the one-task reduction or axis error; these existed
upstream. The duplicate projection fix is `378b102`: each validated object is rendered
once using the existing module order/source association, preserving unmatched
material. The notation fix `9d54a61` normalizes only unambiguous unary symbols;
31 tests cover 50 named Greek symbols with real compilation and preserve
ordinary prose, explicit calls and escaped strings. Unknown operands receive
a diagnostic. Unchanged-handoff replay removes all 17 bare-bold literals.

Source repair `bcfcf04` gives an explicit single module the existing focused
chapter/fragment path, retains assigned native HTML records, and applies source
vetos to direct assignments, practice and image paths, including URL-only legacy
metadata. Acquisition diagnostics and sparse/unusable extractions are exposed
to the existing source architect round rather than automatically sufficient.
The semantic request contract preserves plural/multipart practice intent without
a subject template or fixed task quota. Known source IDs bind titles/URLs/paths
to the native manifest after analyzer responses. Assigned native test/page
context is preserved under the existing 8,000-character context gate.
The same content-review call receives at most two existing cited PNG/JPEG
source compositions and ordered source/page metadata, including namespaced
figure mappings; no additional review stage or call is required.

Independent unchanged-state replay replaces the 45 course-only records with a
first focused pack of 41 complete assigned records, preserves the original
request and direct quiz announcement/URL, and stays at 52,685/60,000 characters.
Its reviewer receives cited Q3 pages 9 and 2 at 29,791/43,651 body characters.
Five canonical hashes remain unchanged. The earlier Run10 envelope remains
56,658/60,000 with all 55 records unchanged under the combined source policy.
All 141 affected checks and independent integration review pass; the single-module
HTML regression fails before its correction and preserves the deselection veto.
No original prompt, original source or rejected generated output was patched.

## Acquired reading handoff follow-up

Native round12 retained a correct one-module architecture after targeted source
acquisition, but rejected `request_more` because every requested URL was already
acquired. The validator treated reading original pages as an invalid request for
another download and discarded the valid semantic decision. Newly downloaded
PDFs also missed the existing visual catalog.

Commit `b850384` separates genuine acquisition from server-owned pending reads.
Valid local PDFs and native snapshots retain their source identity, module and
exclusions, and reach the existing page index, chapter slices and analyzer.
Missing, excluded and merely diagnostic targets remain blocked. A wrapper URL
never proves its target content has been inspected. Reading debt participates
in consumer/cache identity and debt-bearing architect decisions require fresh
planning. No model stage, tool permission or budget was added.

Six API cases failed before the fix; all 16 new source/consumer/cache regressions
pass, with 129 affected and 54 independent tests. Independent replay of the
actual round12 model response preserves one Relativkinematik module, four
exclusions and nine reading tasks. All eight PDFs are indexed and attachable as
composed original pages, the existing producer uses 53,679/60,000 characters,
and all 14 canonical/source hashes are unchanged.

## Exploratory native reading follow-up

Native round13 requests eight new practice downloads plus an already captured
native Winkelhebel wrapper page. The page has the same trusted URL/content
provenance as round12, but the round-one architecture has not yet assigned it
to a learning module. The new validator required that assignment before even
allowing exploratory reading, blocking acquisition of the other eight sources.
Independent inspection confirms a planning-order fault, not missing credentials
or a missing native page. Unknown, excluded or deselected targets must remain
inadmissible; exploration cannot silently become required curriculum coverage.
Commit `d8abac0` retains trusted acquired exploration separately from curriculum
assignment while genuine downloads remain. Explicitly empty planned modules
survive until the existing semantic reassessment; unfilled essential modules
cannot become sufficient. Exploration limitations persist across both sufficient
and acquired-only request_more follow-ups until evidenced or excluded.

All six new transition/negative regressions and 122 affected tests pass. The
unchanged real round13 R1 answer now requests precisely eight new downloads
and retains all five original plan modules, without injecting the wrapper into
a module. The explicitly labeled read-only controlflow replay uses actual saved
round12 sources/R2 response to verify the existing reassessment and consumers;
it is not a new live R2 model call. Original request and announcement survive,
the first producer is 53,839/60,000 characters, and all 18 original/source hashes
are unchanged. The next native original-prompt repetition is pending.

## Signed direction and physical interpretation follow-up

Native round14 passes acquisition and source reading, resolves the exact test
announcement, and publishes a 13-page PDF after two content-repair rounds and
one formatter repair. Existing gates correctly catch concatenated acceleration
equations, a source citation error and raw LaTeX control text. Final model PDF
review reports all 13 pages reviewed and no findings, but independent source and
mathematics review catches a remaining conceptual error: the inward term in the
absolute acceleration decomposition is repeatedly named a centrifugal term,
without explaining another frame or convention. Correct numerical calculations
do not make that physical interpretation correct.

The final PDF has two worked examples plus five further formatter exercises.
Independent arithmetic checks pass for the two final handoff examples, the
full velocity/acceleration relationships and four further numerical exercises.
The all-page review catches an additional underdetermined formatter exercise:
zero reference-point acceleration is given, but no reference-point velocity or
stationary-reference condition. The supplied absolute-velocity answer silently
sets that unconstrained velocity to zero. A derivative cannot determine a
function value/integration constant without initial or boundary conditions.
The shared policy correction also requires a claimed unique result to follow
from complete givens; otherwise retain parameters or disclose missing data. Source/test scope and limitations are
transparent. This output is retained and rejected; it is never patched for
acceptance. Shared mathematical direction/naming/reference-frame consistency
is strengthened in shared policy1.7 before another exact-prompt native repetition.
The existing chapter/fragment cache fingerprints already include this version,
so old results are invalidated without altering a canonical artifact. Seven
existing consumer-contract tests fail before each new requirement and pass
with both; all 53 affected checks pass. Actual saved handoff/repair inputs fit
all five complete prompt envelopes: fragment producer 50,320/60,000 and
reviewer 33,613/45,000. All 22 original/source hashes are unchanged. No new
review stage, tool permission or subject-specific rule was added.

This round records 19 successful model calls and no unknown usage: 813,637 input
(396,160 cached; 417,477 fresh) and 44,355 output tokens across source/render
workers. Coordinator usage is not included. Render succeeds at07:08:00 UTC;
the native coordinator is ready and all three owned PIDs have exited. The
canonical and published PDFs agree at2,235,849 bytes and SHA256
`fd6be50e15be654cd59555aa8f7992e9c83ff38faabf4ef2dac1f0553d8e5c27`.

The initial complete suite catches the existing 8,000-character selected-visual
fragment regression at 8,654 characters. The final correction condenses only
fixed prompt prose, preserving the full rules, evidence, IDs, schema and caps.
That exact unchanged test passes at 7,988 characters. All 98 affected checks,
76 independent checks, full root 1,429 tests and typecheck pass; four existing
skips remain. The code is committed locally as `42f26a9`. Independent replay
confirms all five actual producers fit; all 22 original/source hashes remain
unchanged. The original user prompt and profile are retained for round15.

## Post-acquisition exploratory reading follow-up

Native round15 has a successful source model response requesting original-page
reading for Q3 and seven already acquired practice PDFs. The current architecture
assigns Q3 but deliberately leaves the unread practice sources unassigned, and
excludes the Rotor and external Winkelhebel resources. The validator only permits
new unassigned exploration while there are further downloads or a previous
scope-assessment marker. It misses the preserved exact previous acquisition
intent, so reading fails as soon as the download list drains.

All seven sources are selected and nonempty (230,143–1,212,196 bytes). Three
model calls succeed, recording 76,208 input and 4,273 output tokens with no
unknown usage or retries. There is no PDF. The native coordinator is ready and
both owned workers have exited; the original failed run remains unchanged.

The narrow correction admits a current explicit reading request backed by the
previous exact acquisition intent, only for a genuinely acquired admissible
source. Existing document-level exploration slices inspect these sources within
the already selected learning goals; they do not add curriculum modules or
mandatory methods. Source/exclusion/selection vetoes and image limits remain.
The consumer proof must demonstrate actual packed image attachments for all
seven sources, rather than only indexed or hypothetically attachable candidates.
Independent replay uses the unchanged real round15 R2 response and exact prior
R1 acquisition intent. The architecture is byte-identical and exclusions remain.
Seven PDFs become only scope-assessment reads. Five actual analyzer API packages
reach all seven original first pages using the unchanged two-image limit:
one Q3 pack and four exploration packs with 2+2+2+1 sources. Their complete
producer envelopes are 36,460, 30,800, 30,786, 30,835 and 28,560 / 60,000.
Unprovided later pages (2 or 2–3) remain exact server-owned per-source warnings.
This API-testdouble proves consumer reachability, not a new semantic model
review. Original prompt/announcement and canonical/source hashes are unchanged.
Focused/type/full verification and the next native repetition follow.

## Verification

- Root final TypeScript check passed; 1,452 tests passed, four existing skips, across
  169 files using four test workers (43.65 seconds).
- An initial full-suite run hit the existing five-second web-layout CLI test
  timeout under high concurrency. The unchanged test passed in isolation and
  the complete suite passed with bounded concurrency.
- Fork formatting/lint passed; all 13 workspace typecheck packages passed.
- Focused protocol/architecture tests cover selected high-priority probes,
  excluded sources and preservation of explicit full-course modules.
- Runtime, broker and shell tests cover credential canaries, managed executable
  precedence, custom role assignments, arguments, exit codes and recursion.
- Six image-composition regressions reproduce the old failure. All 71 affected
  checks and independent review passed. A genuine PDF overlay fixture and
  original Run9 replay preserve corrected source values in all four crop modes,
  with five unchanged canonical hashes. No new required ImageMagick dependency:
  when absent, only its three explicit trim tests skip; all run on this host.
- Three scoring prompt regressions failed before the fix and passed afterward;
  they cover initial and repair authoring plus review, preserving documented
  official points. The scoring changes also passed independent code review.
- Independent review examined the source filtering, curriculum scope, account
  isolation and authoritative profile behavior. Its CLI PATH and stale global
  model override findings were addressed before the second native round.

## Desktop rounds

All rounds use actual Study Buddy Electron (`desktop-dev`), its dedicated state
root and fresh Quick Chats. Original messages, language and profile are
preserved. No repair follow-up is used.

| Round | Thread | Profile | Result |
| --- | --- | --- | --- |
| Original preparation PDF | `84f8e76e-01eb-4e8d-8a3f-f57b9749381b` | Balanced copy | Failed: SEB launcher source URL; no published PDF |
| Original math mini-test | `aa7965a5-5e32-45c1-bb2b-c24cabfbf8dd` | Balanced | Failed: local fallback missing broker credentials |
| Math retry 1 | `92f472d4-bd91-4b5f-b39c-60af1e0a7b8e` | Balanced | Credential path repaired; unsupported bundled-worker models, three failed source-selection calls; no questions entered |
| PDF retry 1 | `f2a2f502-a131-49ed-9a5b-a3a29da9a915` | Balanced copy | Stopped after observed off-scope architecture; exact worker group terminated, no output accepted |
| PDF retry 2 | `873360e3-f48f-4c1c-8aa2-6c39e9d73eb2` | Balanced copy | Published 14-page PDF, correct scope and verified calculations; rejected for unsupported exercise point allocations |
| Math retry 2 | `43701856-a768-47fb-8c3d-57aa7d8d3e85` | Balanced | Accepted: correct Minitest 4, two unused attempts, deadline October 6 at 23:59, permission request; no attempt started |
| Math repeat canceled for tooling audit | `cf4368ea-629a-42b5-b4bd-0d0a9e20ae2f` | Balanced | Owned worker canceled before any attempt; guard mistook a historical reused PID for live work. Scheduling diagnostic, excluded from product acceptance |
| Math accepted repeat | `6bcf1332-dd1c-4d0e-84cf-8e2a9980ff0c` | Balanced | Same exact prompt again resolves the same correct target and permission contract, with no attempt started |
| PDF retry 3 | `fab7de42-0d4d-4c96-99a3-77b534f0ffce` | Balanced copy | Stopped: selected older Anwendungen der Dynamik instead of directly named Höhere Kinetik; no PDF accepted, owned group canceled |
| PDF round canceled for source review | `0dc416d3-f2f9-4231-adea-f1a680c5133d` | Balanced copy | Stopped early during source planning after independent code review found alias/title conflicts and negated-title edge cases; avoids mixing revisions, not a completed output test |
| PDF retry 5 | `eeed8286-66a3-472a-b199-231b10896fff` | Balanced copy | Failed at the existing validation ceiling: a chapter-local warning became a false global scope disclaimer; cached warning survived repairs to a different chapter, no PDF published |
| PDF retry 6 | `0c8ff377-0e89-45a7-8144-930aff680441` | Balanced copy | Published 13-page PDF; rejected by independent review (2/4) for an incomplete nonzero-vector decision rule and shifted schedule cells |
| PDF retry 7 | `9b291192-ee0a-4be3-9c20-f93f1356a9bc` | Balanced copy | Published 15-page PDF after one factual and one format repair; math/table fixed but independent review rejected an explicit denial of the documented date/topic (2/4) |
| PDF retry 8 | `feea46d7-a1c8-4899-8c11-12b68f2b7890` | Balanced copy | Published 17-page PDF after one format repair; source and all numeric solutions correct, independent review 3/4: one derived solution changes fixed task assumptions; not accepted |
| PDF retry 9 | `49fb8638-a2ab-482a-bd59-dcc6a601cbda` | Balanced copy | Published 16-page PDF after two format repairs; eight derived tasks correct and feasible, but rejected (2/4) because a raw embedded source image loses corrected PDF overlays |
| PDF retry 10 | `02bcbf22-26ef-4766-8228-c905d4f47b0e` | Balanced copy | Failed before PDF rendering: dense assessment-context chapter produces 61,796 prompt/schema characters against the fixed 60,000 cap; other three handoffs are not a final PDF |
| PDF retry 11 | `d5a934dc-e518-4cd5-8738-a36e5058a8c4` | Balanced copy | Published nine-page deterministic fallback after author timeout; independent rejection 2/4 for collapsed basis directions, visible bare-bold notation, duplicated framework content and inadequate practice coverage |
| Math final-freeze repeat | `b31c2532-f37c-4de1-9fad-398ce894a131` | Balanced | Third correct permission-required result on bcfcf04; 11/11 independent checks pass, same Minitest 4, no quiz action |
| PDF retry 12 | `d2f12490-433f-4e9f-ab51-36adf55a2f80` | Balanced copy | No PDF: reassessment after targeted download returns request_more without another valid catalog URL; semantic transition rejected before analyzer dispatch |
| PDF retry 13 | `c9e1a641-a3da-4f61-b632-d54ddefaa7e3` | Balanced copy | Failed before publication: URL wrapper `2345342` rejected as an acquired reading target; two successful calls, no PDF, coordinator ready and owned workers exited |
| PDF retry 14 | `40045423-8d8e-4a55-ba56-9feb5134bf99` | Balanced copy | Published 13-page PDF after two content-repair rounds and one formatter repair; independent rejection 2/4 for centrifugal naming of an inward absolute term and an underdetermined generated velocity task |
| PDF retry 15 | `b97f7002-8a29-400f-a93e-30411370882b` | Balanced copy | No PDF: post-acquisition original-page requests for previously acquired, currently unassigned practice PDFs reject after the new-download list drains; three successful calls, existing exclusions retained |
| PDF retry 16 | `6cfc9418-3d66-48db-98b2-63500faee871` | Balanced copy | No PDF: R2 requests original-page reading through its exact assigned architecture, but leaves the download list empty; validator incorrectly reports no valid reading target |
| PDF retry 17 | `21b503ae-fb32-4256-a361-c91ad6433002` | Balanced copy | Technical success/17-page PDF, but independent2/4 rejection: inward absolute term named centrifugal without convention explanation; physical page12 only orphan application divider. All generated calculations/conditions/source/test facts pass |
| PDF retry 18 | `c5a10a53-a869-45f8-b607-8c1e859bad4f` | Balanced copy | Technical success/15-page PDF without format repairs; prior Handoff flaws corrected/omitted, all numbers/assumptions/source/layout pass. Independent2/4: omega=0 alone wrongly removes the Euler term in a null-case table |

The accepted quiz outputs identify **Minitest 4 (Fouriertransformation 1)**,
consistent with the next lesson rather than a closed/exhausted earlier test or
a later lesson. All three accepted official `interaction-result.json` files report `ok=true`
and `workflowStatus=permission_required`, with all three required review and
permission artifacts present and empty error logs. All three desktop sessions are
terminal, workers exited, and `finalSubmitClicked=false`. Independent output
review scored this permission-aware answer 4/4. Solving, filling and correctness
of the actual limited-attempt quiz answers are not claimed or tested here.

The two accepted quiz workflows took approximately 64 and 36 seconds, with
three and two successful source-model calls, respectively, and zero retries.
Their recorded source-worker usage was 98,033/867 and 31,443/510 input/output
tokens. These are diagnostics, not a measured general efficiency improvement
or complete coordinator-plus-worker token accounting.

The third final-freeze repeat on `bcfcf04` independently passes 11/11 checks,
including exact original prompt/profile, all required artifacts, no attempt or
question interaction, and correct final native response. It takes approximately
52 seconds in the source worker and 1m20s to desktop completion, with three
successful calls recording 49,828 input and 579 output tokens. Its evidence is
`latest-math-quiz-contract/evidence/final-freeze-repeat.json`. The completed
quiz campaign is unchanged. Later fixes affect PDF planning only, without
changing quiz runtime, profile routing or permissions.

Durable contracts and redacted checkpoints are retained under
`study-buddy-data/optimization-campaigns/latest-kinetik-pdf/`,
`study-buddy-data/optimization-campaigns/latest-kinetik-pdf-contract/` and
`study-buddy-data/optimization-campaigns/latest-math-quiz-contract/`.
The original campaigns are retained as superseded measurement history:
the `sbtest` reporter assumes a parent `workflow-summary.json` and misses both
interaction contracts and split extraction/render publication. Acceptance uses
directly inspected official stage/interaction contracts and desktop output;
canonical run artifacts are never changed to make the reporter pass. The quiz
contract campaign is accepted and complete; the PDF contract campaign remains
in progress.
Unknown usage is never inferred from duration or represented as measured zero.

The guard's historical PID false positives were verified through terminal
desktop state and actual `/proc` command identity. The old August dynamics PID
had been reused by independent T3 Code; an old September math PID had been
reused by the current PDF workflow. Those unrelated processes and historical
run files were left untouched. Only owned test groups were canceled.


## Run15 bounded exploration repair

The successful raw second architect answer requests seven practice PDFs that
were acquired after its exact first-round requests, without assigning them to
curriculum yet. Admission had lost that prior acquisition intent once the
new-download list drained. The narrow correction recognizes a current explicit
reading request for the same previously requested, admissible original only;
all unknown, unrequested, excluded, deselected, failed and missing-source vetoes
remain. These sources retain document-level `scope_assessment` uncertainty.

Existing chapter fragments now carry the exploratory originals in source-diverse
two-image packets, keep current learning goals and prohibit automatic curriculum
assignment. Provided and unprovided original pages are explicitly distinguished.
No stage or budget is added. Actual saved R2/R1 client replay produces five
complete model packets (36,460 /30,800 /30,786 /30,835 /28,560 characters within
60,000), carries all seven original PDFs and all 19 selected records with exact
content, URL and locator, and preserves 19 canonical/source hashes. This is
consumer-reachability evidence with deterministic model test doubles, not a
fresh semantic source reading.

An independent counterexample then found exploratory checksums absent from
chapter/fragment cache identity. With ID/URL/reading debt unchanged, altered
source checksum reused the old reading. Both existing fingerprints now include
the actual consumed sources; changed input triggers a new affected fragment,
while unchanged input retains cache hits. Independent final PASS includes 137
focused tests and real replay. Root final full-suite passes 1,439 tests with four
existing skips across 168 files (45.25s); typecheck/diffcheck pass. Frozen source
is local commit `553fb16a`. Fresh native Run16
`6cfc9418-3d66-48db-98b2-63500faee871` starts with the exact original prompt,
profile and model. This next round is independently rejected 0/4: the model
correctly assigns nine acquired PDF sources and requests visual reading, but
leaves requested_urls empty because no further downloads are needed. The
validator requires explicit URLs and reports no valid reading target despite
its exact assigned architecture. All three source calls complete without
transport failure; 76,168 input, 8,960 cached, 67,208 fresh and 4,858 output
tokens are measured, with zero unknown calls and 140.22s source duration.
The coordinator becomes ready and owned PIDs1031295/1031378 have exited.
The failed native final response additionally asserts exclusively Relativkinematik
without proving complete/exclusive syllabus coverage. No PDF or substitute
answer is accepted; this reading-intent transition is
under correction before the next exact native round.


Run16 consumer counterexample: after deriving the nine exact assigned pending
PDF reads, the old selection/packing path sends only two model packets
(43,179/26,927 complete characters). It attaches original pages from only Q3,
Rotor and DS; six other assigned originals are not supplied, and exact unread
page boundaries are absent. The existing two-source reading bundle, image
diversity and provided/unprovided-page rules must therefore cover all validated
pending PDF reads while retaining separate scope_assessment semantics. This is
a replayed consumer defect, not a new native or semantic model result; all19
canonical/source hashes remain unchanged. No cap or module change is required.


## Run16 assigned-original reading correction

A current request_more answer with no explicit reading URLs and no remaining
assigned downloads can derive reading debt only for its own explicitly assigned,
acquired PDF sources whose extraction is partial/unusable. Existing stat,
selection, provenance, exclusion and failure vetoes validate those originals.
The architect prompt clarifies that requested_urls can also name already
acquired reading targets. No model status is used to claim verified coverage.

All server-validated pending PDF reads now reuse the existing source-diverse,
two-image reading bundles and exact provided/unprovided-page boundaries. Sparse
assigned-only chapters enter that same existing reader path; exploration retains
its separate scope assessment and cannot become curriculum by availability.
Fragment caches retain original supplied-page provenance so a partial checksum
invalidation reruns exactly the affected packet without false unread boundaries.

Nine new regressions and147 affected tests, typecheck and diffcheck pass. Actual
saved RawR16/R1 client replay preserves architecture and original request/test
announcement, reaches nine originals in five actual packets (1+2+2+2+2 image
attachments), and keeps all23 selected records with exact content/URL/locator.
Complete architect envelope55,519/60,000; analyzer35,119/31,051/29,252/29,356/
29,272 under60,000. All19 canonical/source hashes remain unchanged. This is a
real consumer replay with test doubles, not a newly accepted native PDF. Source
is frozen as local commit `7d3e2ef`. Independent final PASS includes147 affected
tests and actual consumer/cache replays. Root full-suite passes1,448 tests with
four existing skips across168 files (45.23s), typecheck and diffcheck. Fresh native
Run17 `21b503ae-fb32-4256-a361-c91ad6433002` uses the exact original prompt,
profile and model. It completes technically with17 pages after two format repairs,
but independent full-page review rejects2/4 for the same physical naming error
and a divider-only application page12. All eight Handoff worked examples, final
practice tasks1–6 and multipart simulation are correct under unchanged feasible
givens. Test facts, source conflict, changing values per subquestion, SEB, origin
labels and absence of invented points pass. The existing content review received
the exact wrong formula context and still returned ok:true/findings[]; no
projection or budget loss explains this miss. Measured worker usage is15
calls, 798,583 input, 428,416 cached, 370,167 fresh, 45,636 output
tokens, 0 unknown calls. Source389.91s/render616.003s; coordinator ready and owned
workers1551005/1551127/1719672 exited. Canonical rejected output stays unchanged.


## Run17 existing-review corrections and real counterexample checks

The original content-review body contains the complete bad term name, its
absolute-frame equation and the shared mathematical policy1.7; no projection or
capacity loss caused the false pass. The formula source itself supplies the
correct equation without the added term name. The existing reviewer now audits
semantic meaning separately from algebra/citation. Where included quantitative
terms imply sign/direction and existing assumptions permit a case, it derives a
simple allowed case and checks the claimed meaning in the stated frame. A
concrete contradiction is a blocking factual/mathematical defect even for should
requirements; nonquantitative topics gain no numeric/frame obligation. Source
convention differences require explicit reconciliation. No new review stage,
profile override, subject matcher or output cache is introduced.

Two existing initial/repair prompt regressions fail before the fix and pass
afterward;38 affected checks and typecheck/diffcheck pass. In a real isolated
Terra/medium content_review replay, the final generic prompt detects the unchanged
bad handoff as localized blocking mathematical_error/content_analyzer with the
actual -12e_x direction as evidence. Complete envelope42,202/45,000,30.574s,
same two original images. Removing only the added paragraph makes the old40,087
character body byte-identical to its actual captured native call; all249 canonical
hashes stay unchanged. Evidence: run17-semantic-review-diagnostic/replay.json.

The existing visual reviewer had seen all17 original pages but permitted ordinary
page breaks/whitespace broadly and blocked only unreadable/broken output. It now
checks accidental small heading/divider-only intermediate pages against the next
visible physical page, ignores recurring headers/footers, and routes keep-with-
following-content to the formatter. Clearly deliberate covers/section openers
remain valid, uncertain cases warn, and no ink/wordcount heuristic is added.
Two real-PDF regressions reproduce the omission before the fix;10 focused tests,
typecheck and diffcheck pass. A real configured Terra/medium review of the exact
unchanged17-page PDF now identifies physical page12 as heading_divider_only_page,
error/formatter. It additionally flags small source-list text on page17 through
the existing readability check. PDF/Typst/original review/config hashes remain
identical; durable review images/evidence are under run17-divider-review.

Both source deltas are frozen. Root full-suite passes1,452 tests with four existing
skips across169 files (43.65s), typecheck and diffcheck pass. Independent final PASS includes46 focused tests and the two real unchanged
counterexample replays. Source is local commit `6d75190`; fresh native Run18
`c5a10a53-a869-45f8-b607-8c1e859bad4f` starts with the unchanged original prompt,
profile and model. The resulting15-page PDF is technically successful, but
independent final review rejects2/4 for one remaining null-case error: physical
page7 table says omega=0 removes all rotational leadership terms. At an instant,
angular acceleration may still be nonzero; omega(t)=t e_z at t=0 with r=e_x leaves
Euler acceleration +e_y. The global value/derivative caution below the table does
not correct its categorical row. All other actual final examples, five exercises,
solutions, source/test facts and layout pass; earlier Handoff source-axis/number/
term/psi-derivative flaws are omitted or explicitly corrected by the formatter.
No source images appear in this final PDF, so no image-fidelity success is claimed
for that output. Canonical PDF SHA256f60c8eea25a0b7b11267e4c671755a23fdb655939143c6f2c871d93ca93fb08a
remains unchanged. Worker measurements:12 known calls,418,991 input,145,152 cached,
273,839 fresh,30,315 output tokens; zero unknown. Both owned stages exited,
coordinator ready, no automatic formatter repair. Local temporal scope and actual
review-claim preservation are being corrected before the next exact native run.

Run18 reviewer consumer evidence: the final handoff contains18 sections,19 formulas
and8 examples, but the standard per-chapter view sends only2 topics (both test
administration),3 formulas and2 complete examples. This is initial projection,
not a late hard-budget fallback. The inclusion ledger preserves coverage titles
and short step openings; it cannot prove mathematical accuracy of omitted steps.
The wrong motor arithmetic, full psi-derivative null conclusion and Huelesection11
physical label are absent; the erroneous Earth velocity is present without its
original axis definition (sourcepage8). Two supplied reviewer images are Q3page9
and Bolzenpage1. Actual complete envelope38,906/45,000;17 canonical/source hashes
unchanged. Read-only evidence: run18-semantic-review-triage/triage.json. Preserve
included claims through a measured generic full review projection within current
budgets before calling a sampled view a complete content review.

## Run18 local-condition correction and complete review coverage

Shared mathematical policy1.8 now requires each zero/shortcut condition to say
locally whether it holds at an instant or throughout an interval. Derivative
terms require their own zero proof; a global warning does not repair a false
local table or checklist claim. Seven existing consumer regressions reproduced
RED before the change; all70 affected tests, typecheck and diffcheck pass.
The unchanged8k fragment fixture initially exceeded its cap at8325; compacting
only341 characters of fixed instruction prose restores7984 without clipping
policy, evidence, schema or IDs. Independent14 policy/budget tests and the
unchanged privacy/8k checks pass. Six real saved Run18 producer envelopes stay
inside unchanged caps, retain the original request and assessment announcement,
and leave all236 canonical hashes unchanged. Proposed repair inputs are marked
as diagnoses, not historical calls. Frozen local checkpoint: `28a6c9e`.

A complete review projection cannot fit the existing45,000-character call cap:
full claims alone occupy40,101 characters; full envelope67,665, and even generic
lossless columnar/dictionary encoding remains59,064 before decoder instructions.
The approved implementation therefore uses at most six sequential complete
packets within the existing content_review stage, with the same model/profile,
per-call cap and at most two original source images each. It preflights every
packet before any call and fails closed for oversized atoms or too many packets.
Each section/formula/example remains complete; combined findings update the
existing repair state and count one validation retry per complete round.
This increases model-call count and total potential review cost; it does not
increase an individual call budget or add a new workflow stage. Actual saved
Run18 is expected to need about three packets. The actual Run18 consumer needs six packets, not the initial three-packet
estimate, because complete warnings/key concepts/quiz claims and image provenance
are retained. All18 sections,19 formulas,eight full examples and eight figures
reach actual sent JSON unchanged; source Q3 pages8+9 are supplied. Largest full
envelope44,397/45,000;236 canonical hashes stay unchanged. The first real
Terra/medium six-packet diagnosis takes186.389s and157,019 input tokens
(26,880 cached/130,139 fresh),8,285 output tokens,zero unknown calls. It detects
the actual hidden derivative null inference and incorrect Earth limiting-case
result. It does not detect the Earth source-axis transcription or the real motor
rounding/sum error. Instead it falsely applies a source vector identity to a
different operand pair, yielding an invalid motor countercalculation; independent
original-geometry review confirms the original first term-1.05 is correct and
only the claimed final-0.688 differs from-0.68942286. The last packet also falsely
calls the global18-topic/19-formula model empty based on local arrays. Both
false positives are explicit follow-up gates before native acceptance; no claim
of complete mathematical detection is made.

Independent checks also found null-owner serialization and an original-only
section without its actual source-index entry. Focused fixes preserve both full
claims and authentic source mappings. First integrated suite passes1,458 tests
with four existing skips/169 files41.83s plus typecheck/diffcheck; a later changed
freeze must be rerun. The next complete suite detects one missing pre-existing scoring-review
instruction after fixed-prose compaction:1,460 pass,one failure,four existing
skips (169 files41.41s); typecheck passes. The existing scoring test is unchanged;
the explicit unsupported-official-points and handoff-boundary instruction must be
restored in full. Initial coverage/operator model probes from that interim
prompt are diagnostic only and cannot stand in for final frozen producer evidence.
Final frozen source `4a68458` restores the full unchanged scoring consumer and
passes1,461 tests/four existing skips in169 files41.46s, typecheck and diffcheck.
Independent final PASS adds53 focused checks and its own full real producer/
236-hash audit. Final scoring-faithful envelopes44,326/40,532/44,122/44,075/
44,283/38,555 stay below45,000. The final focused Packet5 replay correctly finds
the printed motor sum-0.689 versus-0.688 without the former-0.525 false alarm;
it takes32.763s. Packet6 (17.854s) no longer alleges missing global topics/formulas
and flags a genuine source-warning contradiction. Both retain actual request,
source compositions, producer-byte identity and236 unchanged canonical hashes.
The historical motor MISS is preserved separately under
run18-focused-packet-5-diagnostic-pre-scoring-restoration; no retrospective
all-mathematics-pass claim is made. Source-axis detection remains a known model
limit. Source implementation is now independently reviewed and locally committed;
new native output acceptance remains pending.

Fresh Native19 `acfe702c-d2d8-442b-b360-201dd56935c1` sends the exact original
request at10:29:50.087Z on root `4a68458`/fork `a8b31805e`, stored Balanced copy
Terra/medium. Read-only native DB verifies prompt/model/profile, guard shows no
competing active task. Parent stage path2026-10-02T10-30-24-613Z begins normally.
No source changes or repair prompt are permitted during this first-try round.

## Run19 bounded-review capacity failure

The new native first-try round terminates without a PDF: actual unchanged handoff
has17 original sections,16 model topics,16 formulas,10 examples,three figures and
a larger warning base. Full preflight exceeds six packets; no content_review call
is dispatched. The same capacity boundary is retried unchanged to retry_count3,
with correct incomplete/false review state rather than a sampled pass. Independent
actual producer replay reproduces the failure; no mathematics or PDF acceptance
is claimed. The first read examples have correct axes/null conditions, but one
intermediate formula concatenates two equations; this is retained as a consumer
review countercase, not an accepted final rendering.

Native coordinator ready/last_error=null at10:37:55.311Z, no attachments; owned
worker2911390/2911409 has exited. Nine known model calls:210,026 input,
33,024 cached,177,002 fresh,17,711 output tokens,zero unknown; no transport failures.
No owner-followup/narrower prompt was sent and canonical artifacts remain untouched.
The coordinator's narrower-prompt suggestion is not treated as fulfillment of the
original request. A generic complete-packing measurement against this actual new
state is underway under unchanged per-call budgets and source-image boundaries.
Campaign remains active with zero accepted candidates; native round19 quality0/4.

Actual packing triage finds seven complete source-less checklist atoms totaling
298 JSON characters alone in packet7; no extra formula/example/topic or source
image requires that packet. All seven fit unchanged into existing packet1
(43,231/45k versus43,008), also other compatible packets. Fixed envelope36,245,
warnings6,946,quiz claims empty; aliases/image slots are not the cause.
All105 native canonical hashes remain unchanged. A generic compatible-atom
backfill before creating an extra packet is authorized, keeping max6, per-call
cap, full data and image/provenance limits unchanged. The saved actual countercase
and Run18 control pass through the real Nodeconsumer before Native20.
The14-line generic backfill keeps all17 original sections,16 formulas,10 examples,
three figures and15 checklist strings exactly once in six actual client packets:
43,202/43,553/44,354/42,449/43,913/44,488 under45k (512 margin retained), unchanged
original-image pairs and105 canonical hashes. Six former tail atoms backfill into
an earlier packet; the seventh fits the last existing packet. Run18's six full
producer bodies stay byte-identical and236 hashes stay unchanged. Fifty-one focused
checks and independent54 tests pass. Final root suite1,462 tests/four existing
skips,169 files42.95s, typecheck/diffcheck and independent final PASS. Local
checkpoint `389167c`, no push or release. Source artifacts are read-only throughout.

Fresh Native20 `0d0a0c35-e55b-46e7-a8bf-3ebf546b2486` sends the same original at
10:50:29.115Z on root `389167c`/fork `a8b31805e`, stored Balanced copy/Terra-medium,
verified through actual native DB. Parent10-50-57-283Z begins normally after a clear
guard. No source change or follow-up repair prompt during this round. Output
acceptance remains pending.

## Run20 multi-unit global-metadata capacity failure

Native20 completes19 model calls including15 Analyzerfragment calls, then fails
before any content_review model call. Three units share original sources; aggregate
model47 topics/51 formulas/26 examples/16 figures/57 warnings/112 sources/43 checklist
items makes even the first full topic atom exceed the45k envelope (61,011 bodychars).
Empty faithful envelope is61,048/45k; repeated warnings23,593, filtered sourceindex
5,725, chapters1,903,globalcoverage/Exampleledger4,515. Full individual claim atoms
are small (largest1,543), but their complete JSON total117,821. Repeating full
warnings/metadata rather than long mathematics causes the failure. Merely removing
repeated warnings leaves37,455 fixedchars and cannot hold all content in six calls.
No clipping or sampled quality pass is allowed.

Actual intermediate chapter reviews find an Earth normal-axis transcription error,
motor result-0.683 versus source-0.688 and correct-0.68942286, frame-relative velocity
for a rigid attached point incorrectlynonzero, and an ambiguous dot(phi)^(2)
Tangentialnotation interpreted as squared first derivative. These are retained
original countercases, not accepted final mathematics. The ordinary complete review
never runs, so no PDF can be evaluated or delivered.129 canonical hashes unchanged.

Coordinator ready/no last_error11:06:05.360Z, no attachments; owned2964824/2964840
exited.19 known calls442,772 input/157,184 cached/285,588 fresh/40,017 output;
zero unknown calls and no transport failures. Validation stops at retry_count3
after identical deterministic capacity failures. No narrower follow-up is sent.
Campaign stays active, no accepted candidate; Native20 quality0/4.

A measured structural projection repair is authorized: complete warning/quizclaims
become atomic content rather than every-call global repetition; each packet gets
authentic source mappings for actual cited/global assessment IDs. Exact identical
originalURL/page/image aliases may share image slots if evidence demonstrates the
need. Full original request/evaluated contract/directassessmentcontext/policies/
coverage remain per packet, all owned claims and IDs survive.45k per-call/twoimages/
threeunsuccessfulrounds unchanged; no newstage/topicmatcher/Roleoverride. If six
calls are provably insufficient after lossless scoping, choose the smallest measured
useful finite count up to16, explicitly increasing/documenting total review cost.
Six was an implementation choice, not an owner-requested limit. Preflight all calls,
aggregate all findings and fail closed; actual20 RED→GREEN and18/19 controls are
required before Native21. Implementation/output acceptance remain pending.

Current complete-packing work retains all140 normalized claim atoms,57 full warning
strings with explicit German/English chapter owners,43 checklist strings, and raw
quiz/formula content where the normalized model lacks it. Exact referenced source
closure and originalURL/page/file attachment compatibility allow14 initial packets
within45k/twoimages without deleting mathematics or replacing references. Repair
round capacity and final finite limit remain under measurement; this is not yet
an accepted implementation or native output.

A separate runtime audit finds the native20 adaptive normal window is18 minutes
(base config14), workflow26 minutes. Complete review is additional real work;
FIFO admission pause does not suspend productive model time. Existing estimation
assumes one Analyzercall per module and fixed reviewer cost, despite actual15
Analyzerfragment calls and14 forthcoming content-review packets. The existing
38-minute workflow ceiling and explicit short budgets must remain authoritative;
packet-aware sizing is being reviewed before freeze. No test-only timeout override
or weakened quality boundary is authorized.

Initial Actual20 existing-node testdouble replay reaches14 complete calls at
44,444/44,459/44,286/44,375/44,380/44,318/44,350/44,364/44,386/44,472/
44,350/44,064/44,358/41,283 envelope characters, preserving every original
claim/owner/source/warning and129 canonical hashes. This saved terminal state has
retry_count3, so its attempt4 calls are historical diagnostic reachability only.
A separate isolated initial retry0/repair retry1 control is required before freeze;
no saved canonical retry value is rewritten.

The full1,950-character feedback from three genuine historical Run18 focused
Packet5/6 findings exceeds16 packets in the initial greedy/scoped repair control.
Those messages are explicitly historical repair control, not a preceding native
Run20 review. The limit has not been increased; exact original-source cohort
ordering is being measured while each chapter owner/source alias/full claim remains
intact. Initial-only capacity is insufficient evidence for future repairs.

Final measured original-source cohort control retains14 initial packets but
needs18 packets with the full1,950-character authentic historical repair feedback;
repair envelopes43,898–44,483/45k and129 canonical hashes remain unchanged. Root
explicitly authorizes the smallest measured max18 round bound, updating the prior
max16 implementation choice. Keep full repair feedback in each packet instead of
moving it out of the repair context. At most54 review calls are structurally possible
over three validation rounds, but the unchanged38-minute workflow ceiling remains
hard and does not promise all54 can run.45k per call/two original images/three retry
rounds remain unchanged. A true19-packet overflow must fail before any model call.
Initial/repair APIattempt1/2 controls and independent/root gates precede Native21.

A pure Actual20 formatter prompt measures165,886 characters versus118,976 body
capacity. This alone does not predict native failure: actual renderStrategy=auto
with26 worked examples selects the pre-existing deterministic renderer before that
prompt. The actual node/Typst consumer path is being verified in isolation before
any renderer change; no native success or mathematical correctness follows from
this diagnostic. The earlier broad failure interpretation is corrected.

The actual unchanged Actual20 auto-renderer consumer succeeds through its existing
large-example deterministic branch: zero Codex calls,141,945 Typst characters,
real Typst validation successful in1,100ms;129 canonical file hashes unchanged.
Evidence run20-formatter-consumer/replay.json. No renderer code change is necessary.
The static PDFreview producer with eight page labels andtwo images is2,757/45k;
this is a prompt-capacity control, not a real PDF quality pass. Lossless formatter
compression was not implemented because the actual native path already handles
this handoff size. Native final mathematics/layout/source gates remain required.

Final frozen-source consumer count is15 initial packets, rather than the earlier
14 measured before the last cohort/ownership delta; repair remains18. All140
normalized content atoms,57 warning strings,43 checklists and their exact
ownership/provenance reach clientattempt1/2 exactly once on isolated retry0/1
clones. Largest envelope44,483/45k, max two original images,129 unchanged canonical
hashes in each case. Original Run18/19 controls now each use four complete packets,
with all full content and236/105 unchanged canonical hashes; partition changes are
expected after warning/source projection, not content loss.53 focused tests and
typecheck/diffcheck pass; final independent/root and native gates remain pending.

Runtime source freeze passes70 focused Vitest checks plus18 Node wrapper checks,
typecheck/diffcheck and Bash syntax. Existing-source prepare/progress hooks account
for the actual packet round/attempt; genuine measured costs can extend a repair
start before its first call, avoiding a boundary race. Actual historical14-packet
control:895,835ms active before review, initial large24/38, measured progress
24.075min,18-packet repair35.229min under36-minute extraction ceiling(38−2reserve).
The final15-packet projection is being reconfirmed separately. Explicit CLI/env
runtime provenance, absolute owner deadlines, admission accounting and earlier
owner/tier deadlines on both wrapper outcomes are preserved.129 hashes unchanged;
these are deterministic budget controls, not fresh model/runtime acceptance.

First final root integration suite catches one incomplete legacy Telemetrymock:
Analyzer checkpoint test expects StudyBuddyCheckpointError, but new active-time
accounting invokes getRuntimeBudgetPausedMs missing on its as-never fixture. Root
result1,475 pass/one failure/four existing skips in169 files58.11s; typecheck passed.
The narrow fix uses the real existing ExecutionTelemetry class for this fixture,
retaining the checkpoint/no-modelcall assertions and explicit10-minute limit.
This failure log remains preserved; final repeated suite must pass before native.

Final15-packet runtime control is stored separately in
run20-complete-review-runtime-control-final15, leaving historical14-control bytes
unchanged. Initial large24/38, measured15-packet progress24.621 minutes,18-packet
repair35.229 minutes≤36;129 original and all runtime source/test freeze hashes
unchanged. Independent reviewer-only delta PASS:126 checks across eight files,
exact atoms/owners/closure/attempts1/2 and direct canonicalhashverification. Combined
runtime fix/full suite/native acceptance remain pending. Wrapper test counts refer
to different commands: four new runtime +14 existing quiz wrappers=18; root package
check plus four runtime=5. Final root wrapper set will include all19.

Final root integration passes1,476 tests/four existing skips in169 files50.51s,
typecheck/diffcheck and19 Node wrapper/package checks. All13 final source/test
hashes match before local scoped commit `e8f5628`; independent combined PASS.
No code is pushed, merged, packaged or release-accepted. Fresh Native21 sends the
exact original11:52:55.669Z in Electron desktop-dev thread
`f53efdb8-2a88-4ff4-99db-abbb7c06d7f6`, verified stored Balanced copy/custom
Terra-medium, root e8f5628/fork a8b31805e. Parent11-53-13-848Z begins normally after
clear guard; zero repair/narrowing follow-up and no source changes during the run.
Worker, coordinator, artifact and final quality acceptance remain separate/pending.

## Native21 complete review succeeds, then source-error fallback loses scope

Native21 first architecture is one coherent Relativkinematik module with nine exact
PDF reading targets andthree explicit unrelated-source exclusions. Theory retrieval
requests Q3 pages8+9 together; actual Earthxi/eta/zeta components are correct.
Initial handoff22 sections/21 formulas/nine examples still contains motor-.593/-.683
instead correct-.59942286/-.68942286, false exclusive Corioliszero condition,
unspecified radial constantomega and physically inconsistent constants/u≠0 for a
sliding-sleeve task. Course/documentmetadata initially calls the course Baukasten;
no final acceptable title can be assessed without a PDF.

The full existing semantic review completes allfive packets and blocks six real
findings: motor transcription/result, Coriolisparallelcase, overly exclusive harmonic
omega0 conclusion, DS_allgemein source does not support the cited relative/Coriolis
claims, missing Ringelspiel gamma and wrongly dismissed Kollergang rest condition.
This is genuine same-profile review reachability/judgment evidence, not an accepted
final output or guarantee of every condition check.

SourceArchitectR3, triggered by the citationfinding, fails before a model call:
60,175 prompt/schema characters exceed60,000. Its catch creates a six-module
portal fallback, discards every former exclusion and is later drained to sufficient.
Previously excluded Massengeometrie is actually analyzed at12:04:00Z, followed by
other portal-derived modules. This is an established semantic scope regression.
Root stops exactly the owned native coordinator before official cancellation of
verified owned3128668/3128708; both gone, coordinator ready/noerror. No PDF,
Native21 quality0/4.17 completed known calls409,900 input/50,944 cached/358,956 fresh/
30,286 output;18 starts includeone canceled unrecorded in-flight call with unknown
usage.17 recorded calls have unknownUsageCalls0, but total usage is incomplete.
Canonical stale running metrics are preserved rather than rewritten as terminal.
Independent144-file snapshot and13 originalPDF byte comparisons retained.

A narrow source-architecture fix is authorized: lossless compact serialization of
the existing course scope/brief/catalog JSON; prove actual R3 initial/repair envelopes
under unchanged60k before any native rerun. On a later planner error, retain the
already valid semantic architecture and exact exclusions/ownership/assessment
context; a portal probe must never replace it with sufficient unverified curriculum.
Existing SourceReadingRequestError boundary remains. No text/claim clipping,
newstage/cap/schema/role/topicmatcher/mathprompt change. Deterministic countercases,
actual existing-node consumer and unchanged originals precede independent/root
checks, local commit and fresh Native22 with the exact original prompt.

Native21 metadata diagnosis is clarified: Baukasten arises only in raw individual
chapter handoffs because dense-chapter assembly selects the alphabetically first
actual Moodle navigation course(id25292). Fourteen actual fragmentcache files
contain no such course/title value, so this is neither fixture leakage nor a cached
model hallucination. Existing reconcileRequestedCourseIdentity corrects both real
aggregated extracted-data files to Höhere Kinetik/33819. Pure formatterproducer
82,375 characters contains the correct title and no Baukasten; no renderer change
is required. Native21 never reached rendering, so a real finalPDF identity gate
remains. Evidence round21-metadata-origin/replay.json;144 canonical hashes unchanged.

The narrow source-planner fix reproduces three counterexamples RED then GREEN:
compact existing complete JSON; preserve prior semantic scope/exclusions/pending
reads and abort on later planner failure; bootstrap known acquisition remains
exploration with empty unconfirmed curriculum and no reusable readiness cache.
Sourcearchitect cache namespace .8-planner-failure-scope invalidates historically
cached broad fallback readiness. One older cachetest depended on that unsafe
fallback; its valid prior architecture/ModuleLimit assertions are retained under
the corrected blocked/uncached contract. Actual native countercase reconstruction
and independent/root gates are still pending before Native22.

SourceArchitecture final code freeze isb7768c342627661624a5aaa26951ea7507ed095a124d307fc8b4ddafab36933a;
onlySourceArchitect andits test plus ownplan/backlog change.86 focused tests/four
files, TypeScript/diffcheck pass. Actual reconstructed historicalR3 matches the genuine
failed60,175 envelope exactly, then compact identicalcourseScope/brief/catalogJSON
reaches the existing node/API at55,399; bounded existingJSONrepair55,728/60k.
Reconstructed predownloadinitial39,750. Every originalrequest/feedback/value persists,
prior requestedURLs/architecture/exclusions/readings/reasons are retained on error,
statusblocked+abort preventsreadinessdrain/cachewrite.144 canonicalhashes unchanged.
Earlier rejected21 andallstale statusdata remainimmutable. Final root suite and
independent freeze review pending before local commit andNative22; no push/release.

Root final1479 tests/four existing skips,169 files52.63s, TypeScript/diffcheck and
19 Node wrapper/package checks pass. Independent source/test freeze b7768c… PASS,
semantic JSON identical/all other prompt prose byte-identical and144 directly verified
canonical hashes unchanged. Scoped local commit `253ee06` follows; no push/release.
Native22 exact original12:22:17.463Z, desktop-dev thread
`e63754b3-6286-4134-98bc-11f165afca55`, same stored Balancedcopy/Terra-medium,
root253ee06/forka8b31805e; actualparent12-22-42-053Z. No repair/narrowing follow-up
or source changes during native run.

Guard falsely reports historicNative14childPID3198486 as active after kernel PID
reuse. Actual /proc command is unrelated Chrome NetworkService, cwdCCE Construction
Cost Evaluator/Website, incompatible with recorded StudyBuddyworker owner/start.
All extant historic PID records are checked by actual command identity;zero real
StudyBuddyworkers exist before newSend. No unrelated process is modified/canceled,
no canonical record rewritten. Proof round22-guard-pid-reuse-proof.json retains the
false report and identity evidence; a PID existing alone does not establish ownership.
Native22 quality acceptance remains pending, campaigncandidate0.

## Owner steering and concrete artifact delivery

At approximately 12:29 UTC the owner reported the unacceptable eleven-hour
delay without a usable PDF. No further native round will start after22. The
ongoing original-prompt round22 may finish; source freeze253ee06 remains intact.
Do not turn a manually repaired artifact into native campaign acceptance.

A separate agent-corrected copy of the Run18 Typst was rendered under
latest-kinetik-pdf-contract/evidence/manual-verified-pdf. The local instantaneous
omega=0 shortcut now retains a possible Euler term, and solution1 retains the
possible translational origin acceleration. Original worked examples and all
five exercise prompts remain intact. The cover explicitly labels agent correction.
All236 canonical Run18 hashes remain unchanged. Two independent reviewers read
the actual complete PDF; the mathematical/layout reviewer also viewed all15
physical pages and independently recomputed the examples and solutions. Final
artifact delivery PASS4/4, source/scope reviewer PASS. Neither is native app PASS.

Canonical document.pdf:15A4 pages,1154875bytes, SHA256
b64ed2f2bbfe1efc785f18f00d8abd918d718e8230ec67ee83f580f87e15c4c7.
The unused /tmp/kinetik-minitest-1-geprueft-2026-10-02.pdf is byte-equal and has
already been delivered to the owner. The original retained PDF is not overwritten.
Independent evidence: manual-verified-pdf/independent-final-review.json,
verification.json,changes.diff,delivery-proof.json and all15 actual page images.
German user report: evidence/reparaturbericht.md. Native22 then completed normally,
rendering20pages/2933015bytes with technical/model visualPASS. Its PDF SHA is
8ccb3d685e33c02a529d7632a937a5cfbbc0411ffdd4a57da4a5800cffdf7b2f.
Final physicalPDFpage12 merges originalQ3page8 e_xi into e_zeta in the general
Earth acceleration formula; correct equator numerics hide that nonzero-angle
defect. Actual final output is rejected independently2/4 after all20 physical
pages and full text are inspected. Additional actualfinal findings: physical6
claims a_rel can be zero only for interval-constant v_rel, wrongly excluding
instantaneous derivative zero (counterexamplev_rel=t²e_x at0); physical14
concatenates two v_A equations; physical7/17 have orphaned one-sentence/exercise
continuations. Missing fullsolutions1/2/3/5 are not an artificial requirement:
actual originalRequestContract does not mandate them. Native acceptance remains
unresolved,candidate0; no release/push/merge implied. No new native round starts.

Native22 recorded29 completed model calls/963704input/384512cached/579192fresh/
72965output, unknownCalls0. Renderer ended12:49:48.425Z, about27minutes from
parentstart12:22:42.053Z. First formatter fails for LaTeX inline syntax in Typst,
second for unquotedmath AC; third compiles. These automatic repair costs and the
false-negative source-axis model review remain known limitations, not proof of
speed or guaranteed accuracy. Final coordinatorDBready/noerror and actual
/proc checks3240873,3240882,3297150 allabsent. No cancellation/stalePIDkill needed;
unrelated reused historicPID remains untouched. Evidence round22-terminal-root.json
and two actual formatter diagnostics. All15 root source/testfreeze hashes remain
unchanged. Delivered manual artifact stillindependentPASS4/4, separate provenance.

## Handoff

Runtime fixes are committed locally as root `957bbd4` and UI `a8b31805e`.
Root source/scope repair is `bd287e1`, course identity/exclusion repair is
`9f2746c`, scoring repair is `bc89f8d`, and chapter warning/global repair is
`ed0eedb`. Mathematical/table contracts are `2b651d9`; structured concrete
defect classification is `ce7cfae`. Request-level document context and source
fidelity are `cacde07`; bounded evaluator priority and cache repair are
`3e5cb00`. Generated task consistency and derivative assumptions are
`ac6ed8b`; source PDF composition preservation is `151c94b`; complete analyzer producer
budgeting is `10b2f7e`. Duplicate fallback projection is `378b102`, safe unary
vector notation is `9d54a61`, and assigned-source routing/provenance/review is
`bcfcf04`; acquired-reading handoff is `b850384` and exploratory sequencing is `d8abac0`; mathematical interpretation and determining conditions are `42f26a9`; prior-acquisition exploration and cache identity are `553fb16a`; assigned original reading is `7d3e2ef`; existing semantic/layout review audit is `6d75190`; local temporal conditions are `28a6c9e`; complete bounded review is `4a68458`; unbound claim backfill is `389167c`.
Automatic PDF output acceptance remains unresolved after finalNative22 rejection;
the separately delivered agent-corrected PDF is independently accepted4/4.
Changes are not pushed, merged, packaged,
deployed to production, published or release-accepted. Exact frozen-candidate
Windows/Fedora acceptance remains part of the later release workflow.
