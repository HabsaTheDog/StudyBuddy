# Conversational source evidence

For weekly obligations and preparation, the desktop coordinator calls:

```sh
study_buddy_task source-evidence '<original request>' --original-user-prompt '<original request>' --language en --execution-profile balanced
```

The broker resolves configured sources and credentials inside its child process. The command cannot execute quiz or assignment attempts. It retains the existing source scope, supervised acquisition, coverage tracking, and bounded validation retries.

The workflow publishes `answer-evidence.json`, containing native course outlines, activity indexes and inspected landing text, with direct URLs and access levels. Linked resources retain their descriptions even if they are not assessed tasks. `course-activities-<id>.json` preserves course organization for targeted reading. `moodle_raw.txt` contains these source observations, not synthesized classifier conclusions. Missing native captures remain explicit gaps.

`answer.json` has kind `source_evidence`; `answer.md` is an internal handoff identifying sources and paths. Neither is the learner's final answer. The coordinator chooses relevant local reads, reconciles conflicting text, and composes a natural response to the complete original request. It must retain direct citations, personal status, displayed dates and uncertainties, distinguish recommendations from official requirements, and disclose unread material. No fixed number of headings, subjects or preparation items is imposed.

Known date conflicts are surfaced near the top of the handoff using the actual displayed field and source note. The coordinator explains their significance in its own words.

A generic instructor note about setting dates must not erase displayed closing fields or completed/in-progress attempts. Classification keeps the source warning alongside its semantically interpreted facts. Native evidence remains available even when a classifier makes an error. The evidence-cache fingerprint changes when this interpretation contract changes.

PDF and HTML workflows retain their existing rendering and publication contracts. Source handoff success establishes acquisition, not conversational answer quality: desktop acceptance also inspects the final agent response against every part of the learner's request.
