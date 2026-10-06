# Hybrid architecture — development completion

2026-09-15. Implementation is ready for owner human review. The performance
campaign remains open: no live model comparison, new desktop end-to-end run or
packaged acceptance was performed. No installed release was updated.

The implementation keeps the task catalogue as configuration and telemetry
vocabulary. It does not turn its 34 operations into 34 agents or mandatory calls.
The existing source planner already has a constrained dynamic acquisition loop;
adding another planner would repeat its decisions. It remains authoritative only
over observed source IDs and authorized actions.

## Execution decisions

| Boundary | Final implementation and reason |
| --- | --- |
| Source discovery | Retain the existing validated planner/acquisition loop, deterministic draining of known resources, provenance and permission checks. Producer policy now participates in source-plan cache identity. |
| Standard guide layout | Deterministic compatibility checkpoint; remove the unused layout-model call. Other interactive artifact types retain model planning. |
| Guide authoring | Default to hybrid: one existing content operation can author a prompt-bounded batch or delegate exact chapter partitions. Maximum delegation depth one, bounded three-child parallelism, exact partition validation and durable reuse. Fixed mode remains available. |
| Assessment planning and independent reviews | Retain because evidence/coverage planning and checking answers are different contracts. No review is removed based on operation count alone. |
| Progression repair | Retain valid placements and stage definitions; replan only changed items. Persist partial repairs separately so interruption cannot replace the full checkpoint with a subset. |
| Solution recovery | Preserve successful sibling items and validated draft bindings. Retry malformed verification without regenerating; invalidate and regenerate a substantively rejected draft. Each stage starts on its own primary policy. |
| Extraction and nested retries | Persist bounded operation reservations across resume. Do not bypass policy-bound caches through old unchecked chapter handoffs. Preserve the three-unsuccessful-validation ceiling. |
| Model dispatch | Shared admission/deadline/cancellation and selective bounded transport fallback across document, page and quiz/search clients. Transport attempts and semantic attempts remain separate. |
| Cache reuse | Require effective producer policy and source/request identity. Local content checkpoints also verify content hashes. Legacy profiles remain usable; unbound old caches may require recomputation. |
| Native provider execution | Keep coordinator/provider-native delegation separate from workflow operations. Preserve cumulative usage counters and native IDs; import explicit complete turn-boundary snapshots for whole-turn accounting. |

Core code: `src/custom-skills/shared/operationCheckpoint.ts`,
`src/custom-skills/web-layout/authoringDelegation.ts`,
`nodes/studyGuideContentNode.ts` within web-layout,
`assessmentSolutions.ts`, `learningProgressionPlan.ts`,
`src/custom-skills/moodle/nodes/analyzerNode.ts`, the three Codex clients,
and `t3code-fork/apps/server/src/provider/Layers/CodexAdapter.ts`.
The application retains source integrity, quiz permissions, canonical state,
checkpoints, deterministic validation and publication gates. Plans cannot grant
permissions, acquire arbitrary sources or submit quiz attempts. No subject or
institution label selects a hard-coded learning template.

`STUDY_BUDDY_ARCHITECTURE=fixed` selects fixed guide batching;
`STUDY_BUDDY_ARCHITECTURE=hybrid` is the default. The page CLI also accepts
`--architecture fixed|hybrid`; the sanitized run configuration persists the mode.
A single chapter remains direct. Prompt grouping uses the actual producer prompt
length, not chapter count alone. The guard is a character bound, not a tokenizer.
Operation locks serialize within a process; cross-process ownership still relies
on the application's existing run lease.

## Development evidence

- Root suite: 146 files; 1,150 tests passed, four skipped; root TypeScript passed.
- CLI accounting/comparison and task metrics: five tests passed.
- Desktop provider adapter: 26 tests passed. Full fork format/lint and all 13
  workspace typechecks passed on the development working tree.
- Fault tests cover invalid delegation, sibling interruption/resume, third-attempt
  success/exhaustion, cache tampering and policy changes, malformed/rejected
  solution reviews, subset progression repair, capacity fallback and cancellation.

Logs and the canned comparison are under
`study-buddy-data/optimization-campaigns/hybrid-agent-architecture-input/`.
The paired test executes the real content node and content/question-bank gates
with identical canned producer and reviewer responses:

| Four-chapter fixture | Fixed | Hybrid |
| --- | ---: | ---: |
| Authoring calls | 4 | 1 |
| Total calls in tested path | 8 | 5 |
| Producer/reviewer prompt characters | 100,241 | 78,388 |
| Canonical validated content | Identical | Identical |
| Live tokens and model duration | Unmeasured | Unmeasured |

Harness timings are not model latency. This does not execute complete browser
artifact publication, establish general quality improvement or justify merging
additional reviews. It verifies the chosen optimization is reachable with
unchanged content gates. Historical run accounting without complete native scopes
is deliberately reported incomplete.

## Controlled live comparison protocol

After owner review, use frozen source-discovery, sourced-PDF, multi-chapter guide
and image-quiz cases spanning at least two unrelated subjects/source structures.
Keep original prompt, source bytes, permissions, complete effective primary and
fallback policies (including coordinator), runtime, cache condition and quality
gates equivalent. Pin root/UI revisions and execution mode. Architecture changes
must not be mixed with a newer-model comparison. Fixed mode isolates batching;
the original `ec337b9` baseline is required to assess the entire migration.

Begin with one pair per case, alternating order. If the pilot warrants its cost,
repeat the two most representative cases until each arm has three runs. Include
failures, retries, cancellation, recovery and unpublished outputs. Review outputs
blind against source-backed coverage/correctness anchors and unchanged permission,
PDF/HTML interaction and publication gates. Small/pilot differences remain
inconclusive. Use deterministic fault injection for precise recovery comparisons;
do not mislabel its mocked timings as live evidence.

```sh
node scripts/model-task-metrics.mjs /path/to/run
node scripts/study-buddy-run-accounting.mjs /path/to/run
node scripts/compare-study-buddy-architectures.mjs /path/to/pair.json
```

The accounting reader uses `run-metrics.json`, `run-model-calls.jsonl` and
`codex-runtime.json`. To include native costs, provide `provider-turn-usage.json`
in the main run directory. Example shape (illustrative values only):

```json
{
  "scopeSemantics": "exclusive",
  "delegationComplete": true,
  "workflowCoverageComplete": true,
  "workflowRunDirs": [".", "../associated-extraction-run"],
  "wallMs": 12345,
  "threads": [{
    "id": "native-thread-id",
    "role": "coordinator",
    "fresh": true,
    "after": {
      "providerThreadId": "native-thread-id",
      "totalInputTokens": 1000,
      "totalCachedInputTokens": 100,
      "totalOutputTokens": 200,
      "totalReasoningOutputTokens": 50
    }
  }]
}
```

List exactly one coordinator and all native delegates, each with exclusive cost
scope. For an existing thread use `before` and `after` snapshots instead of
`fresh`. Counters are cumulative: use deltas, never sum notifications. Declare
completeness only after verifying all native scopes and workflow run directories;
this file is an explicit export bridge, not automatic proof of full delegation
coverage. Missing/reset counters and unknown failed-call usage prevent a complete
claim. Reasoning tokens are reported separately and must not be added to output
tokens when already included there.

The comparison manifest has `baseline` and `candidate` objects, each containing
`runDir`, `caseId`, `revision` (root and UI identity), `surface` (`desktop-dev` or
`desktop-installed`), `cacheCondition`, `originalPrompt`, `sourceFiles` (ordered
paths relative to the manifest), `modelSettings` (the same complete effective
policy structure), and `gates`. The six gate booleans are `sourceIntegrity`,
`quizPermissions`, `coverage`, `correctness`, `publication`, `artifactValidation`;
they require recorded review evidence, not inferred success from exit status.
The tool hashes source bytes and policy JSON, rejects mismatched inputs/failed
gates and withholds savings when accounting is incomplete or the surface is not
desktop. It reports wall duration and fresh-input/output differences; full reports
also expose cached/reasoning usage, physical/logical calls, queue time, probes and
semantic/transport retries. Checkpoint and authoring traces provide recovery detail.

## Handoff state

Foundation commits: `7465bb8`, `ec337b9`. Main hybrid/checkpoint implementation:
`79ff78e`; follow-up completion commit contains recovery fixes, accounting tools,
tests and this record. UI dependency: `e8782f83b22c2d9fd6f49af859cee97645e8f3f9`.
All are local-only; no remote availability, merge, deployment or release acceptance
is claimed. Existing unrelated dirty UI work is preserved and excluded from these
commits. Checks on that combined working tree do not certify isolated release bytes.
See [human-review.md](./human-review.md) for the owner test checklist.

The accumulated batch must be deliberately frozen and reviewed before building
one exact candidate for clean Windows/Fedora packaged acceptance. Any subsequent
byte change invalidates affected acceptance. No tag or publication is authorized
by this implementation handoff.
