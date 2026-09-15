# Hybrid architecture implementation checkpoint

2026-09-15. Owner authorized implementation of the three-phase architecture
proposal. This checkpoint records the first development batch, not completion of
the hybrid migration or release acceptance.

## Implemented foundation

| Change | Result and regression evidence |
| --- | --- |
| Shared model-call lifecycle | Document, page and quiz/search clients use admission, cancellation and a deadline that starts after admission. SDK boundary tests cover all three clients; shared-control tests cover waiting, cancellation and release. |
| Strict leaf-result handling | Tool-using leaf results fail and retain observed usage/tool counts. Application permissions remain authoritative; SDK result rejection does not itself disable tools. |
| Operation-aware preflight | The selected Moodle graph resolves concrete overrides, inherited search and fallback policies. Page/quiz operations sharing roles no longer enter its probe list. |
| Selective compatibility fallback | Only failed model assignments are substituted. Healthy assignments survive; an already-verified target needs no second canary. Explicit global model choices still fail rather than silently changing. |
| Correct task attempts | Independent assessment items each begin generation and verification at attempt one. Quiz visual verification begins on its own primary; a malformed verification retries verification alone. |
| Deterministic guide planning | Standard guides persist a compatibility layout checkpoint without an AI layout call. Their content, question-bank validation, review and renderer remain active. Other page types retain model planning. |
| Bounded question repair | Each item/request/source binding reserves at most three repair dispatches, survives resume and changed item content hashes, and validates the third replacement before deciding publication. An exhausted budget stops outer content retries. |
| Repair telemetry | Dedicated repair calls are separate from attempt-based retries. Task summaries include reasoning tokens and queue wait while reading legacy records. |
| Source module scope | `src/package.json` restores the workflow's ESM interpretation after the latest root metadata change, without replacing desktop package metadata. TypeScript verifies the source boundary. |

The initial unchanged-code regressions demonstrated unused standard-guide
planning, incorrect quiz-verification attempt selection, and missing operation
preflight. Additional tests exercise the second assessment item, primary and
fallback SDK choices, tool-result rejection, deadlines, and repair/resume behavior.

Validation commands use the installed workflow dependencies directly because the
current root desktop manifest no longer exposes the former workflow scripts:

```sh
node_modules/.bin/tsc --noEmit
node_modules/.bin/vitest run --reporter=dot
node --test scripts/model-task-metrics.test.mjs
git diff --check
```

All 1,134 workflow tests passed (four skipped), both metrics CLI tests passed,
and TypeScript compilation passed. Logs and the unchanged baseline are in
`study-buddy-data/optimization-campaigns/hybrid-agent-architecture-input/`.

## Remaining within the three-phase plan

Finish the execution foundation before drawing architecture comparisons:

- Give logical operations and transport attempts distinct telemetry identifiers;
  include coordinator/native delegation and availability-probe costs in the
  umbrella measurement. Existing task summaries do not measure the whole turn.
- Unify transport fallback policy across clients. The shared lifecycle does not
  change the document client's inline fallback versus caller-driven page/quiz
  retries. Extend durable retry ownership beyond question-item repair to
  extraction, solution generation/review and other nested recovery paths.
- Preserve effective policy and source provenance on cache reuse; compare warm
  and cold caches separately. Verify displayed versus actual choices at the
  desktop/provider boundary, including compatibility substitutions and legacy
  quiz settings.

Then introduce the hybrid planner behind an explicit compatibility switch:
one evidence planner with application-validated observed IDs, provenance and
coverage; bounded authoring delegation over independent evidence partitions;
one independent correctness gate plus deterministic schema, rendering and
publication gates. Keep the task catalogue as policy and telemetry vocabulary.
Do not turn it into a mandatory call sequence. Merge contract/planning work only
when the same evidence and validation responsibilities can survive the merge.

The application retains quiz permissions, source acquisition controls, durable
checkpoints and the three-retry ceiling. Planner decisions select among authorized
actions; they never grant permissions. Delegate for independent evidence/context
or useful parallelism, not because another operation name exists. A subject or
institution label must never select a fixed learning template.

## Controlled comparison to run after the hybrid path exists

Do not launch live comparisons as part of this foundation checkpoint. The current
campaign has no equivalent-input live baseline/candidate pair and is not accepted.

Use four frozen, de-identified cases: ambiguous source discovery, a sourced PDF,
an interactive guide with mixed assessment formats, and image-based quiz
assistance. Include at least two unrelated subject areas/source structures. Use
identical request text, source bytes, permissions, installed runtime, model IDs,
reasoning efforts, primary/fallback policies and quality gates in both arms.
Select one shared model configuration before running; do not simultaneously test
a different architecture and newer models. Keep coordinator and workers in that
accounting. Pin the current baseline and hybrid commit, root/UI pins and cache
condition in every run record.

Run one paired pilot per case, alternating arm order, to check feasibility.
Repeat the most representative two cases until each arm has three comparable
runs if the pilot justifies the cost. Report pilot-only or small differences as
inconclusive. Use existing campaign tooling to retain evidence and scores; do not
replace missing measurements with zero. A meaningful performance comparison
requires the same requested workload and published coverage, not just fewer
model calls.

Record whole-turn wall time, summed active model duration, queue wait, fresh and
cached input, output/reasoning tokens, coordinator/delegate costs, logical calls,
transport attempts, semantic repairs, cache hits and checkpoint reuse. Report
failed runs and timeouts alongside successful runs. Review outputs blind using
source-backed correctness and completeness anchors, zero permission/provenance
regressions, and the unchanged PDF/HTML interaction and publication gates.

Use deterministic fault injection for malformed model JSON, one invalid item,
third-repair success, persistent invalidity, provider capacity failure, timeout,
cancellation and resume. Compare which approved items survive, which operations
repeat, whether the retry budget persists, and whether incomplete outputs remain
unpublished. Mocked durations and token counts verify instrumentation only; they
are not performance measurements.

Source tests, mocked SDK traces and browser diagnostics remain development
evidence. After the accumulated batch is deliberately frozen, one exact candidate
must pass clean packaged Windows/Fedora acceptance. Any changed candidate bytes
invalidate affected acceptance. No tag, push, deployment or publication is part
of this checkpoint.
