# Task-level model profiles

Execution profiles retain the coordinator and five worker-role defaults. Under
**Advanced task assignments**, each concrete workflow task displays its effective
primary model, reasoning effort, fallback model, and the source of those settings.
Custom profiles autosave edits; built-ins can be duplicated to customize them.
Override a task to change its settings independently, or reset it to inherit again.

The catalogue has 34 concrete operations and three shared search/repair defaults.
Examples include request evaluation, source selection, activity triage, activity
exclusion review, chapter extraction, learning-content generation, solution
generation, solution verification, document/page building, and item-local repair.
These are kinds of work, not counts of agent instances. Repeated chapter calls
share a task policy; no automatic difficulty classifier is introduced.

Resolution order:

1. Explicit operator global model/reasoning override.
2. Concrete task override.
3. Search or repair default, where applicable.
4. Worker-role default.
5. Backend built-in policy when no profile configuration is supplied.

Old custom profiles without `taskOverrides` remain valid. Search and repair now
inherit their parent roles rather than silently retaining unrelated backend
defaults. Duplicated built-ins preserve their explicit search/repair choices.
The built-in editor values match the existing backend choices, including its
more conservative content-analysis and review models; this change does not retune
those models. An independent item's first call starts on its primary policy;
its position in a batch is not a retry. Quiz visual verification has its own
primary/fallback sequence, and a verification retry preserves the first answer.

## Implementation contract

The canonical catalogue is `src/custom-skills/shared/modelTaskCatalog.ts`.
`node scripts/sync-model-task-catalog.mjs` updates its generated desktop copy in
the fork. The copy keeps packaged workers and the desktop independent of the
source checkout; the integration test requires byte-for-byte parity.

Calls carry both their existing `task` category (access policy, budgets, and
legacy metrics) and a concrete `operation` (model selection and task metrics).
Unknown overrides and mismatched operation/category pairs fail explicitly.
Add new operations to the catalogue and annotate their production callsites;
the callsite-coverage test catches missing assignments.

Profiles persist only explicit `taskOverrides`, using the same complete
primary/fallback structure as worker roles. The app sends role defaults and
explicit task policies through `--profile-overrides-json`; inherited task values
are not flattened into saved profiles. Search, quiz solving/review, document
generation and interactive-page generation use the same policy resolver.

Moodle preflight resolves concrete operation overrides and inherited search
policies for the selected graph, including retry models. It excludes page and
quiz operations that merely share a worker role. Compatibility fallback records
an explicit failed-model-to-replacement mapping in the run configuration; healthy
assignments and explicit operator choices retain their policies.

Document, page and interactive quiz/search SDK calls share admission and deadline
control. Their deadlines start after admission; caller cancellation propagates to
the SDK. Admission remains unthrottled unless the existing concurrency setting is
configured. Leaf results containing tool calls are rejected and their observed
usage is retained. This is result rejection, not proof that the provider disabled
every tool capability. The application still owns source and quiz permissions.
The document client's inline transport fallback remains separate from the page
and quiz clients' caller-driven retries; unifying that behavior is pending.

Standard study guides persist a deterministic layout checkpoint and use their
existing validated content/blueprint renderer. They do not invoke `html_planning`.
Other page kinds retain that operation; saved task overrides remain valid.
Question-item repair reserves at most three model dispatches per item and
request/source binding, persisted before dispatch and carried across resume.
The final permitted replacement is reviewed before the publication decision.
This does not yet unify every pipeline's nested retry budget.

The coordinator remains configured through the provider model selection. Native
provider delegation and model-availability probes are not additional workflow
tasks in this catalogue.

## Task metrics

Document and page workers add `operation` and `policySource` to their existing
`run-metrics.json` model-call entries. Interactive quiz/search workers persist the
same identifiers and usage in `run-model-calls.jsonl`. No prompts or source
contents are added to these metric records.

Run:

```sh
node scripts/model-task-metrics.mjs /path/to/run [/path/to/another/run]
```

The JSON report groups by task, model and reasoning effort, with calls, retries,
repair calls, failures, duration, queue wait, token usage (including reasoning
output) and policy origins. Older runs fall back to their
coarse task category; their missing task detail cannot be reconstructed. Durations
are summed model-call time, not parallel workflow wall time. Validation-triggered
retries are counted by the attempt number; a completed model response can still
fail a downstream validator. `repairCalls` separately counts operations/categories
ending in `_repair`, including their first dispatch. These counts overlap with
retries and must not be added together. Repairs performed inside another named
operation are visible as attempts but are not classified as dedicated repair calls.
Unknown token usage remains unavailable at the provider boundary; zero-valued
legacy fields are not evidence that a failed call was free. These diagnostics support future comparisons and
do not establish model-quality or performance improvements by themselves.

Acceptance for this development change is deterministic policy/SDK/serialization
testing plus browser diagnostics of the profile editor. Frozen-candidate packaged
desktop acceptance remains part of the release process.
