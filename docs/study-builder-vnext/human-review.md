# Study Buddy — ready for human review

2026-09-15. The architecture implementation is complete for development review.
Test the development desktop app from this checkout; the installed release has
not been rebuilt or updated. Changes are local commits, with no push, deployment
or release publication. Existing unrelated desktop edits remain in the working tree.

## Start the development desktop

From `t3code-fork/`, use the existing Study Buddy launcher:

```sh
node scripts/study-buddy-runner.ts app
```

Use fresh threads and your usual profile. Guide authoring defaults to `hybrid`.
It can produce several chapters together or delegate validated chapter partitions;
source, answer-review and publication gates remain enforced by the application.
The visible operation catalogue is still a model configuration interface.

## Suggested review

Use at least two unrelated subjects and your own authorized sources:

1. Ask an ambiguous source question. Check that the chosen sources match your
   intent, missing evidence is acknowledged and source links remain traceable.
2. Request a sourced PDF. Check coverage, factual claims, formulas where relevant,
   references and rendered pages against the originals.
3. Request a multi-chapter interactive study guide. Check chapter coverage,
   answer correctness, feedback, progression and offline interactions. Several
   chapters may now share one authoring call.
4. Try authorized quiz assistance, including an image question if available.
   Check that permission restrictions hold and no final attempt is submitted.
5. If a run fails naturally, resume through the existing workflow and check that
   successful work survives, retries stop at the limit and incomplete artifacts
   are not presented as successfully published.

For a problem, retain the thread/run ID, exact request, selected profile, expected
result and affected artifact/page/question. Avoid repeatedly retrying a failed run
before recording its original evidence.

For a fixed/hybrid comparison, close the development app and relaunch it with
`STUDY_BUDDY_ARCHITECTURE=fixed node scripts/study-buddy-runner.ts app`.
Use the same sources, request and model settings in fresh threads. Revert with
`STUDY_BUDDY_ARCHITECTURE=hybrid`. Verify the guide run's saved `architectureMode`;
cache condition and coordinator costs must also match before comparing speed.
The CLI comparison protocol is in the architecture development record.

## Evidence already available

- 1,150 workflow tests passed; four skipped. Root TypeScript passed.
- Five accounting/metrics CLI tests and 26 provider adapter tests passed.
- Full desktop workspace format/lint and all 13 typechecks passed.
- A canned four-chapter comparison produced identical validated content with
  eight calls in fixed mode and five in hybrid mode (four versus one authoring
  calls). This verifies reduced orchestration on that fixture. Live token cost,
  duration and general output quality remain unmeasured.

No costly live workflows were launched for this implementation. Development checks
and this human review do not replace clean Windows/Fedora acceptance of an exact
frozen package. Technical details, local commit identities and the controlled
comparison contract are in `docs/study-builder-vnext/hybrid-architecture-development.md`.
